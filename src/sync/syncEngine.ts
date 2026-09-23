/**
 * Motor de sincronização offline-first do PDV Canto da Sorte.
 *
 * Filosofia (offline-first):
 *  - O SQLite local é a fonte da verdade para o uso diário. Toda escrita do app
 *    grava localmente E enfileira uma operação na tabela `sync_queue`.
 *  - Este motor drena a fila para o Supabase quando há rede e credenciais.
 *  - Se o Supabase NÃO estiver configurado, tudo degrada para modo local:
 *    processQueue() não faz nada e getSyncStatus() retorna 'disabled'.
 *  - Nunca perdemos dados: se um upsert falha, os itens permanecem na fila e
 *    serão retentados no próximo ciclo.
 *
 * CONTRATO COM ../db/database (o que o database.ts DEVE expor):
 *  - getSyncQueue(): Promise<SyncQueueItem[]>
 *        Lê as operações pendentes (ordenadas por createdAt asc / id asc).
 *  - clearSyncQueueItems(ids: string[]): Promise<void>
 *        Remove da fila as operações já confirmadas no Supabase.
 *  - (opcional, para pullRemote) upsertRemoteRows(entity, rows): Promise<void>
 *        Aplica no SQLite local linhas vindas do remoto (last-write-wins por
 *        updatedAt). Uma implementação por entidade também serve — ver abaixo.
 *  - (opcional, para pullRemote) getLastPulledAt(): Promise<number>
 *        e setLastPulledAt(ts: number): Promise<void> para o cursor incremental.
 *
 * FORMATO ESPERADO de um item da fila (SyncQueueItem):
 *  {
 *    id: string;              // id único da operação de fila
 *    entity: SyncEntity;      // 'sections' | 'products' | 'tables' | 'order_items' | 'sales'
 *    op: 'upsert' | 'delete'; // tipo da operação
 *    payload: Record<string, unknown>; // linha já no formato da tabela REMOTA (snake_case)
 *    createdAt: number;       // timestamp ms (para ordenação FIFO)
 *  }
 *
 * O database.ts é responsável por gerar `payload` já mapeado para as colunas
 * do Supabase (ver seção "MAPEAMENTO DE COLUNAS" abaixo). Assim o motor de sync
 * fica agnóstico ao schema local e apenas repassa o payload no upsert/delete.
 */
import * as Network from 'expo-network';

import type { SyncStatus } from '../types';
import { getSupabase, isSupabaseConfigured } from './supabaseClient';
import * as database from '../db/database';

/** Entidades sincronizáveis — nomes iguais aos das tabelas no Supabase. */
export type SyncEntity = 'sections' | 'products' | 'tables' | 'order_items' | 'sales';

/**
 * Operação enfileirada localmente aguardando envio ao remoto.
 * Espelha o que database.ts expõe em getSyncQueue(): id é INTEGER AUTOINCREMENT
 * (number), entity é o nome da tabela remota (plural), payload já vem no formato
 * snake_case pronto para `supabase.from(entity).upsert(payload)`.
 */
export interface SyncQueueItem {
  id: number;
  entity: SyncEntity;
  entityId: string;
  op: 'upsert' | 'delete';
  payload: Record<string, unknown>;
  createdAt: number;
}

/**
 * Assinatura mínima do módulo de banco que este motor consome.
 * Os nomes/tipos casam EXATAMENTE com os exports de ../db/database.
 * (upsertRemoteRows/getLastPulledAt/setLastPulledAt são opcionais: usados só pelo
 *  pullRemote, que fica como esqueleto até essas funções existirem no banco.)
 */
interface DatabaseModule {
  getSyncQueue: (limit?: number) => Promise<SyncQueueItem[]>;
  removeSyncQueueItems: (ids: number[]) => Promise<void>;
  upsertRemoteRows?: (entity: SyncEntity, rows: Array<Record<string, unknown>>) => Promise<void>;
  getLastPulledAt?: () => Promise<number>;
  setLastPulledAt?: (ts: number) => Promise<void>;
}

/** Ordem das tabelas ao aplicar upserts (respeita dependências de FK). */
const ENTITY_ORDER: SyncEntity[] = ['sections', 'products', 'tables', 'order_items', 'sales'];

/** Estado interno de status para a UI. Começa coerente com a configuração. */
let currentStatus: SyncStatus = isSupabaseConfigured() ? 'synced' : 'disabled';

/** Guarda para evitar ciclos de processamento concorrentes. */
let processing = false;

/**
 * Falhas consecutivas de rodada. O badge só deve alarmar ('error') após algumas
 * falhas seguidas — uma falha transitória (rede oscilando) não deve pintar o
 * header de vermelho. Zera assim que uma rodada termina sem erro.
 */
let consecutiveFailures = 0;

/** Quantas rodadas seguidas precisam falhar antes de mostrar 'error' na UI. */
const ERROR_THRESHOLD = 3;

/**
 * Epoch (ms) da última sincronização BEM-SUCEDIDA (processQueue concluiu sem erro
 * e a fila ficou drenada/vazia). null = nunca sincronizou neste dispositivo.
 * Mantido em memória para leitura síncrona na UI; hidratado do banco no boot via
 * loadLastSyncedAt() e persistido em meta('last_synced_at').
 */
let lastSyncedAt: number | null = null;

/** Chave usada na tabela `meta` para persistir o timestamp da última sync. */
const LAST_SYNCED_AT_KEY = 'last_synced_at';

/**
 * Retorna, de forma SÍNCRONA, o epoch (ms) da última sincronização bem-sucedida
 * conhecida em memória (ou null). Para uso direto no render de um badge.
 * Combine com formatLastSync() de ./syncTime para exibir amigável.
 */
export function getLastSyncedAt(): number | null {
  return lastSyncedAt;
}

/**
 * Hidrata `lastSyncedAt` a partir do banco (meta 'last_synced_at'). Chame uma vez
 * no boot do app, após initDatabase(). Best-effort: em erro, mantém null.
 * @returns o valor carregado (ou null).
 */
export async function loadLastSyncedAt(): Promise<number | null> {
  try {
    const raw = await database.getMeta(LAST_SYNCED_AT_KEY);
    if (raw !== null) {
      const parsed = Number(raw);
      lastSyncedAt = Number.isFinite(parsed) ? parsed : null;
    }
  } catch {
    // Ignora: sem persistência ainda, segue com o valor em memória (null).
  }
  return lastSyncedAt;
}

/**
 * Marca "agora" como o instante da última sincronização bem-sucedida: atualiza a
 * memória e persiste em meta. Chamado pelos pontos de sucesso de processQueue.
 * Best-effort na persistência — o valor em memória é o que a UI lê de imediato.
 */
function markSyncedNow(): void {
  lastSyncedAt = Date.now();
  void database.setMeta(LAST_SYNCED_AT_KEY, String(lastSyncedAt));
}

/**
 * Referência estática ao módulo de banco. Import estático (não dinâmico) porque
 * o Metro/Hermes exige especificadores literais para empacotar corretamente no
 * APK — um import() com string computada não resolve de forma confiável em release.
 */
function loadDatabase(): DatabaseModule {
  return database as unknown as DatabaseModule;
}

/** Verifica conectividade real via expo-network (não lança). */
async function isOnline(): Promise<boolean> {
  try {
    const state = await Network.getNetworkStateAsync();
    return Boolean(state.isConnected) && state.isInternetReachable !== false;
  } catch {
    // Em caso de dúvida, assume offline para não tentar rede à toa.
    return false;
  }
}

/**
 * Processa a fila local: envia operações pendentes ao Supabase e limpa as que
 * forem confirmadas. É seguro chamar a qualquer momento — se offline, sem
 * credenciais ou sem itens, retorna sem efeito.
 *
 * @returns quantidade de operações confirmadas com sucesso nesta rodada.
 */
export async function processQueue(): Promise<number> {
  // 1) Sem credenciais => modo local puro.
  if (!isSupabaseConfigured()) {
    currentStatus = 'disabled';
    return 0;
  }

  // 2) Evita concorrência (timer + listener podem disparar juntos).
  if (processing) {
    return 0;
  }

  // 3) Precisa estar online.
  if (!(await isOnline())) {
    currentStatus = 'offline';
    return 0;
  }

  const supabase = getSupabase();
  if (supabase === null) {
    currentStatus = 'disabled';
    return 0;
  }

  processing = true;
  currentStatus = 'syncing';

  try {
    const db = loadDatabase();

    const queue = await db.getSyncQueue();
    if (queue.length === 0) {
      // Fila vazia = tudo em dia. Nunca deve virar 'error'.
      consecutiveFailures = 0;
      currentStatus = 'synced';
      markSyncedNow();
      return 0;
    }

    // Agrupa por entidade e operação para enviar em lote (upserts juntos).
    const confirmedIds: number[] = [];
    let hadError = false;

    // Processa upserts respeitando a ordem de dependências entre tabelas.
    for (const entity of ENTITY_ORDER) {
      const upserts = queue.filter((q) => q.entity === entity && q.op === 'upsert');
      if (upserts.length > 0) {
        const rows = upserts.map((q) => q.payload);
        const { error } = await supabase.from(entity).upsert(rows, { onConflict: 'id' });
        if (error) {
          hadError = true;
        } else {
          for (const q of upserts) confirmedIds.push(q.id);
        }
      }

      // Deletes lógicos: aqui tratamos como upsert do próprio payload (que já
      // carrega deleted=true vindo do banco). Caso queira DELETE físico, troque
      // por supabase.from(entity).delete().eq('id', ...). Mantemos soft-delete
      // para preservar histórico e o last-write-wins por updated_at.
      const deletes = queue.filter((q) => q.entity === entity && q.op === 'delete');
      if (deletes.length > 0) {
        const rows = deletes.map((q) => q.payload);
        const { error } = await supabase.from(entity).upsert(rows, { onConflict: 'id' });
        if (error) {
          hadError = true;
        } else {
          for (const q of deletes) confirmedIds.push(q.id);
        }
      }
    }

    // Remove da fila apenas o que foi confirmado; o resto permanece p/ retry.
    if (confirmedIds.length > 0) {
      await db.removeSyncQueueItems(confirmedIds);
    }

    if (hadError) {
      consecutiveFailures += 1;
      // Só alarma após N falhas seguidas; até lá mantém 'syncing' (menos assustador).
      currentStatus = consecutiveFailures >= ERROR_THRESHOLD ? 'error' : 'syncing';
    } else {
      consecutiveFailures = 0;
      currentStatus = 'synced';
      markSyncedNow();
    }
    return confirmedIds.length;
  } catch {
    // Falha inesperada (rede caiu no meio, etc.): mantém a fila intacta.
    consecutiveFailures += 1;
    currentStatus = consecutiveFailures >= ERROR_THRESHOLD ? 'error' : 'syncing';
    return 0;
  } finally {
    processing = false;
  }
}

/**
 * Baixa mudanças remotas mais recentes e as aplica localmente (last-write-wins
 * por updated_at). Esqueleto FUNCIONAL: busca por entidade tudo que mudou desde
 * o último cursor e delega a aplicação ao database.ts (upsertRemoteRows).
 *
 * Requisitos no banco para operar de fato:
 *  - db.upsertRemoteRows(entity, rows): grava as linhas remotas no SQLite,
 *    ignorando as que forem mais antigas que a versão local (LWW por updatedAt).
 *  - db.getLastPulledAt()/setLastPulledAt(ts): cursor incremental persistido.
 *
 * Se essas funções não existirem, o pull vira no-op silencioso.
 *
 * @returns total de linhas aplicadas localmente.
 */
export async function pullRemote(): Promise<number> {
  if (!isSupabaseConfigured()) return 0;
  if (!(await isOnline())) return 0;

  const supabase = getSupabase();
  if (supabase === null) return 0;

  const db = loadDatabase();
  if (typeof db.upsertRemoteRows !== 'function') {
    // Sem aplicador local, não há como materializar o pull com segurança.
    // (esqueleto: implementar upsertRemoteRows/getLastPulledAt no database.ts
    //  quando o pull multi-dispositivo for necessário — pós-MVP.)
    return 0;
  }

  // Cursor: a partir de quando buscar. Como updated_at local é number (ms),
  // convertemos para ISO ao consultar o remoto (coluna timestamptz).
  let since = 0;
  if (typeof db.getLastPulledAt === 'function') {
    try {
      since = await db.getLastPulledAt();
    } catch {
      since = 0;
    }
  }
  const sinceIso = new Date(since).toISOString();

  let applied = 0;
  let maxUpdatedAt = since;

  try {
    for (const entity of ENTITY_ORDER) {
      // Busca incremental por updated_at. Ordena asc para avançar o cursor de
      // forma monotônica mesmo se paginarmos no futuro.
      const { data, error } = await supabase
        .from(entity)
        .select('*')
        .gt('updated_at', sinceIso)
        .order('updated_at', { ascending: true });

      if (error || !Array.isArray(data) || data.length === 0) {
        continue;
      }

      const rows = data as Array<Record<string, unknown>>;
      await db.upsertRemoteRows(entity, rows);
      applied += rows.length;

      // Avança o cursor considerando o maior updated_at recebido.
      for (const row of rows) {
        const raw = row['updated_at'];
        const ts =
          typeof raw === 'string'
            ? Date.parse(raw)
            : typeof raw === 'number'
            ? raw
            : NaN;
        if (!Number.isNaN(ts) && ts > maxUpdatedAt) {
          maxUpdatedAt = ts;
        }
      }
    }

    // Persiste o novo cursor se avançou.
    if (maxUpdatedAt > since && typeof db.setLastPulledAt === 'function') {
      await db.setLastPulledAt(maxUpdatedAt);
    }

    return applied;
  } catch {
    // Pull é best-effort; não altera a fila de push nem trava o app.
    return applied;
  }
}

/**
 * PULL INICIAL (bootstrap sync).
 *
 * Ao abrir o app, baixa do Supabase TODAS as linhas "em andamento" e as aplica
 * no SQLite local, para que um aparelho VEJA as MESAS/ITENS já abertos por outro
 * aparelho. O realtime (startRealtime) só traz o que muda AO VIVO — não baixa o
 * que já existia antes de subscrever; por isso este pull é necessário no boot.
 *
 * Diferente do pullRemote() (esqueleto incremental por cursor), esta função usa
 * o applyRemoteRow do database.ts, que já:
 *  - aplica LAST-WRITE-WINS por updated_at (só sobrescreve o local se o remoto
 *    for mais novo) — idempotente, seguro para reexecução;
 *  - NÃO chama enqueue()/reenfileira na sync_queue — anti-loop: o pull NUNCA
 *    dispara novos pushes.
 *
 * Degradação graciosa:
 *  - Supabase não configurado OU cliente null => retorna 0 (modo local puro).
 *  - Offline (mesma checagem de expo-network do processQueue) => retorna 0 sem erro.
 *
 * Robustez:
 *  - Percorre as entidades na ORDEM de dependências de FK (sections -> products
 *    -> tables -> order_items -> sales), igual ao push.
 *  - Erro em UMA entidade (ou em UMA linha) é logado (console.warn) e NÃO derruba
 *    as demais — o boot nunca trava por causa do pull.
 *
 * @returns total de linhas aplicadas localmente (soma de todas as entidades).
 */
export async function pullAllRemote(): Promise<number> {
  // 1) Sem credenciais => modo local puro.
  if (!isSupabaseConfigured()) return 0;

  // 2) Precisa estar online (mesma verificação que o processQueue faz).
  if (!(await isOnline())) return 0;

  const supabase = getSupabase();
  if (supabase === null) return 0;

  let applied = 0;

  for (const entity of ENTITY_ORDER) {
    try {
      let query = supabase.from(entity).select('*');

      // 'sales' cresce indefinidamente e, para a UI, só importa o TOTAL DO DIA.
      // Baixamos apenas as vendas fechadas HOJE (closed_at é epoch em ms, igual
      // ao que o push grava), reduzindo o volume sem perder o que a tela mostra.
      if (entity === 'sales') {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        query = query.gte('closed_at', startOfDay.getTime());
      }

      const { data, error } = await query;
      if (error) {
        // Falha de UMA entidade não impede as demais.
        console.warn(`[pullAllRemote] falha ao baixar '${entity}':`, error);
        continue;
      }
      if (!Array.isArray(data)) continue;

      for (const row of data as Array<Record<string, unknown>>) {
        try {
          // applyRemoteRow: LWW por updated_at e SEM reenfileirar push.
          await database.applyRemoteRow(entity, row as Record<string, unknown>);
          applied += 1;
        } catch (rowErr) {
          // Uma linha problemática (payload inesperado) não derruba as demais.
          console.warn(
            `[pullAllRemote] falha ao aplicar linha de '${entity}':`,
            rowErr,
          );
        }
      }
    } catch (entityErr) {
      // Erro por entidade (rede caiu no meio, etc.): loga e segue as demais.
      console.warn(`[pullAllRemote] erro na entidade '${entity}':`, entityErr);
    }
  }

  // Best-effort: se algo foi aplicado, registra "agora" como última sync
  // bem-sucedida (só melhora o indicador do header; não interfere na máquina de
  // status do push nem em consecutiveFailures).
  if (applied > 0) {
    markSyncedNow();
  }

  return applied;
}

/** Handle retornado por startAutoSync para encerrar o ciclo automático. */
export interface AutoSyncHandle {
  /** Para o timer e remove listeners. Idempotente. */
  stop: () => void;
}

/**
 * Inicia a sincronização automática:
 *  - dispara processQueue() imediatamente;
 *  - repete a cada `intervalMs`;
 *  - também reage a mudanças de conectividade do expo-network (quando a rede
 *    volta, drena a fila na hora).
 *
 * Retorna um handle com stop(). Se o Supabase não estiver configurado, ainda
 * retorna um handle válido (com stop no-op relevante), mas o ciclo é ocioso.
 */
export function startAutoSync(intervalMs = 15000): AutoSyncHandle {
  // Modo local puro: nada a agendar, mas devolvemos um handle válido.
  if (!isSupabaseConfigured()) {
    currentStatus = 'disabled';
    return { stop: () => {} };
  }

  let stopped = false;

  // Timer periódico. void para não segurar promises não tratadas.
  const timer = setInterval(() => {
    if (!stopped) void processQueue();
  }, intervalMs);

  // Listener de rede: quando (re)conecta, tenta drenar imediatamente.
  let networkSub: { remove: () => void } | null = null;
  try {
    networkSub = Network.addNetworkStateListener((state) => {
      if (stopped) return;
      if (state.isConnected && state.isInternetReachable !== false) {
        void processQueue();
      }
    });
  } catch {
    // API indisponível na plataforma atual: o timer periódico já cobre o caso.
    networkSub = null;
  }

  // Primeira drenagem imediata.
  void processQueue();

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      if (networkSub) {
        try {
          networkSub.remove();
        } catch {
          /* ignora */
        }
        networkSub = null;
      }
    },
  };
}

/**
 * Status atual para exibição na UI.
 *  - 'disabled': Supabase não configurado (app roda 100% local).
 *  - 'offline' : configurado, porém sem conectividade agora.
 *  - 'syncing' : drenando a fila neste momento.
 *  - 'synced'  : fila vazia / última rodada OK.
 *  - 'error'   : última rodada falhou; itens permanecem na fila p/ retry.
 *
 * É síncrono (retorna o último estado conhecido) para uso direto em render.
 * Faz também uma checagem barata de configuração para nunca reportar 'syncing'
 * quando as credenciais foram removidas.
 */
export function getSyncStatus(): SyncStatus {
  if (!isSupabaseConfigured()) {
    currentStatus = 'disabled';
  }
  return currentStatus;
}

/**
 * Consulta assíncrona de status que também considera a conectividade real.
 * Útil para um badge que precise refletir offline sem esperar o próximo ciclo.
 */
export async function refreshSyncStatus(): Promise<SyncStatus> {
  if (!isSupabaseConfigured()) {
    currentStatus = 'disabled';
    return currentStatus;
  }
  if (processing) {
    return 'syncing';
  }
  if (!(await isOnline())) {
    currentStatus = 'offline';
    return currentStatus;
  }
  // Online e configurado: preserva o resultado da última rodada (synced/error).
  if (currentStatus === 'disabled' || currentStatus === 'offline') {
    currentStatus = 'synced';
  }
  return currentStatus;
}
