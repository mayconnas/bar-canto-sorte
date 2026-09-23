/**
 * Store Zustand — o "cérebro" do PDV Canto da Sorte.
 *
 * É a ÚNICA fonte de verdade para a UI. Na inicialização abre o banco local
 * (SQLite, offline-first), carrega seções/produtos/mesas/vendas e inicia o
 * motor de sincronização. Toda mutação:
 *   1. persiste no banco (chamando ../db/database, que enfileira o sync);
 *   2. re-sincroniza o estado em memória (recarrega do banco ou atualiza
 *      localmente de forma consistente);
 *   3. sinaliza feedback ao usuário via `flash`/`toast` quando faz sentido.
 *
 * Erros de banco NUNCA derrubam a UI: são capturados e viram um toast.
 */
import { create, type StoreApi } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

import type {
  OrderItem,
  PaymentMethod,
  Product,
  Section,
  SyncStatus,
  Table,
} from '../types';
import * as db from '../db/database';
import {
  getSyncStatus,
  startAutoSync,
  loadLastSyncedAt,
  processQueue,
  pullAllRemote,
  type AutoSyncHandle,
} from '../sync/syncEngine';
import { startRealtime } from '../sync/realtime';
import type { RemoteEntity } from '../db/database';

/**
 * Dispara uma sincronização imediata (fire-and-forget) após uma mutação.
 * Não bloqueia a UI nem propaga erro: se offline/sem config, o processQueue
 * apenas não faz nada e a fila é drenada depois pelo auto-sync periódico.
 * Chamado ao fim de toda ação que altera dados (mesa, item, cardápio, venda),
 * para que "quando alterou, já sincroniza".
 */
function triggerSync(): void {
  void processQueue().catch(() => {
    /* silencioso: o auto-sync periódico tenta de novo */
  });
}

// ---------------------------------------------------------------------------
// Zoom manual da UI (preferência do usuário, persistida em `meta`).
// ---------------------------------------------------------------------------

/** Zoom manual mínimo/máximo e passo do controle +/− do header. */
const ZOOM_MIN = 0.8;
const ZOOM_MAX = 1.4;
const ZOOM_STEP = 0.1;
/** Chave em `meta` onde o zoom escolhido é salvo (persiste entre sessões). */
const ZOOM_META_KEY = 'zoom_factor';

/** Limita `z` ao intervalo válido de zoom; valores inválidos caem em 1.0. */
function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return 1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}

// ---------------------------------------------------------------------------
// Helpers derivados (puros) — podem ser usados dentro ou fora do store.
// ---------------------------------------------------------------------------

/** Formata um número como moeda BR: 12.5 -> "R$ 12,50". */
export function money(n: number): string {
  return 'R$ ' + (n ?? 0).toFixed(2).replace('.', ',');
}

/** Quantidade total de itens de uma mesa (soma das quantidades). */
export function tableCount(t: Pick<Table, 'items'> | null | undefined): number {
  if (!t || !t.items) return 0;
  return t.items.reduce((acc, i) => acc + i.qty, 0);
}

/** Total (R$) de uma mesa (soma preço * quantidade). */
export function tableTotal(t: Pick<Table, 'items'> | null | undefined): number {
  if (!t || !t.items) return 0;
  return t.items.reduce((acc, i) => acc + i.price * i.qty, 0);
}

/**
 * Normaliza o status da mesa a partir da presença de itens.
 * No modelo do PDV uma mesa está "ocupada" quando tem itens e "livre" quando
 * vazia — garantimos essa coerência ao carregar do banco (o campo `status`
 * armazenado pode ficar defasado após esvaziar a comanda).
 */
function withDerivedStatus(t: Table): Table {
  const status = tableCount(t) > 0 ? 'ocupada' : 'livre';
  return t.status === status ? t : { ...t, status };
}

// ---------------------------------------------------------------------------
// Aplicação (debounced) de mudanças vindas do REALTIME no estado do store.
// ---------------------------------------------------------------------------

/**
 * Consome o conjunto `realtimePending` (entidades que mudaram no remoto e já
 * foram aplicadas no SQLite por applyRemoteRow) e recarrega do banco APENAS as
 * fatias afetadas, atualizando os arrays no estado.
 *
 * A atualização é INVISÍVEL:
 *  - usa merge parcial do zustand (passa só { tables } / { sections } / ...),
 *    então `selectedTableId`, `activeCategory` e o resto do estado NÃO mudam;
 *  - não chama flash()/toast — nada pisca, a tela não é recriada, o React apenas
 *    re-renderiza suavemente a partir dos novos arrays.
 *
 * 'tables' e 'order_items' recarregam ambos as mesas (os itens vivem embutidos
 * na mesa via db.getTables()). Erros por fatia são logados e engolidos para não
 * derrubar as demais recargas.
 */
async function applyRealtimeChanges(
  set: StoreApi<PdvState>['setState'],
): Promise<void> {
  // Drena o conjunto pendente (copiando antes de limpar para não perder eventos
  // que cheguem durante os awaits abaixo).
  const pending = new Set(realtimePending);
  realtimePending.clear();
  if (pending.size === 0) return;

  // Mesas e itens compartilham a mesma recarga (itens embutidos na mesa).
  const reloadTables = pending.has('tables') || pending.has('order_items');

  if (reloadTables) {
    try {
      const tables = await db.getTables();
      // NÃO mexe em selectedTableId: mesmo que a mesa selecionada tenha sumido
      // remotamente, mantemos o id — os seletores resolvem para null com
      // segurança (selectSelectedTable) e a UI não quebra.
      set({ tables: tables.map(withDerivedStatus) });
    } catch (err) {
      console.error('[usePdvStore.realtime.tables]', err);
    }
  }

  if (pending.has('sections')) {
    try {
      set({ sections: await db.getSections() });
    } catch (err) {
      console.error('[usePdvStore.realtime.sections]', err);
    }
  }

  if (pending.has('products')) {
    try {
      set({ products: await db.getProducts() });
    } catch (err) {
      console.error('[usePdvStore.realtime.products]', err);
    }
  }

  if (pending.has('sales')) {
    try {
      set({ salesTodayTotal: await db.getSalesTodayTotal() });
    } catch (err) {
      console.error('[usePdvStore.realtime.sales]', err);
    }
  }
}

/**
 * PULL INICIAL (bootstrap) em BACKGROUND.
 *
 * Baixa do Supabase as MESAS/ITENS (e seções/produtos/vendas do dia) já abertos
 * por OUTROS aparelhos e aplica no SQLite local via pullAllRemote — que é
 * last-write-wins por updated_at e NÃO reenfileira push (anti-loop). Depois, se
 * algo foi aplicado, RECARREGA o estado do banco local e atualiza os arrays da
 * UI para refletir o que veio do Supabase.
 *
 * A atualização é INVISÍVEL (igual ao realtime):
 *  - merge parcial do zustand — só { sections, products, tables, salesTodayTotal }
 *    são passados, então selectedTableId, activeCategory, zoom e o resto do estado
 *    NÃO mudam e a tela NÃO pisca;
 *  - não chama flash()/toast.
 *
 * Tolerante a erro: se o pull falhar (offline, sem config, rede oscilando), o app
 * segue com o que já tinha do banco local — o boot NUNCA trava por causa disto.
 */
async function runBootstrapPull(
  set: StoreApi<PdvState>['setState'],
): Promise<void> {
  try {
    const applied = await pullAllRemote();
    // Nada veio do remoto (offline / sem config / já estava tudo em dia): evita
    // recarregar e re-renderizar à toa.
    if (applied <= 0) return;

    const { sections, products, tables, salesTodayTotal } =
      await db.reloadAllFromLocal();
    // Merge parcial: preserva selectedTableId, activeCategory, zoomFactor, etc.
    set({
      sections,
      products,
      tables: tables.map(withDerivedStatus),
      salesTodayTotal,
    });
  } catch (err) {
    // Best-effort: falha no pull inicial não afeta a UI (segue com o local).
    console.error('[usePdvStore.bootstrapPull]', err);
  }
}

// ---------------------------------------------------------------------------
// Tipos de rascunho usados pela gestão de cardápio.
// ---------------------------------------------------------------------------

/** Rascunho para criar um produto novo (id gerado pelo banco). */
export interface NewProductDraft {
  id?: undefined;
  sectionId: string;
  name: string;
  price: number;
  icon?: string;
  imageUrl?: string;
  available?: boolean;
}

/** Rascunho para atualizar um produto existente (id obrigatório). */
export interface UpdateProductDraft {
  id: string;
  sectionId?: string;
  name?: string;
  price?: number;
  icon?: string;
  imageUrl?: string;
  available?: boolean;
}

// ---------------------------------------------------------------------------
// Formato do estado + ações.
// ---------------------------------------------------------------------------

export interface PdvState {
  // ---- Estado ----
  sections: Section[];
  products: Product[];
  tables: Table[];
  selectedTableId: string | null;
  activeCategory: string | null;
  salesTodayTotal: number;
  syncStatus: SyncStatus;
  toast: string;
  ready: boolean;
  /** Zoom manual da UI (1.0 = padrão). Multiplica a escala responsiva. */
  zoomFactor: number;

  // ---- Zoom manual da UI ----
  /** Define o zoom (clamp em [0.8, 1.4]) e persiste em `meta`. */
  setZoom: (z: number) => void;
  /** Aumenta o zoom em um passo (+0.1). */
  zoomIn: () => void;
  /** Diminui o zoom em um passo (−0.1). */
  zoomOut: () => void;

  // ---- Ciclo de vida ----
  /** Abre o banco, carrega tudo, define a categoria ativa e liga o auto-sync. */
  init: () => Promise<void>;
  /** Encerra o motor de sync (hot reload / desmontagem). */
  teardown: () => void;

  // ---- Seleção / navegação ----
  selectTable: (id: string | null) => void;
  setActiveCategory: (id: string | null) => void;

  // ---- Mesas ----
  addTable: (name?: string) => Promise<Table | null>;
  renameTable: (id: string, name: string) => Promise<void>;
  removeTable: (id: string) => Promise<void>;
  /** Adiciona 1 unidade do produto à mesa selecionada (respeita disponibilidade). */
  addProductToTable: (product: Product) => Promise<void>;
  /** Ajusta a quantidade de um item da comanda (+1/-1). Remove se chegar a 0. */
  changeQty: (tableId: string, itemId: string, delta: number) => Promise<void>;

  // ---- Gestão de cardápio ----
  addSection: (label: string) => Promise<Section | null>;
  renameSection: (id: string, label: string) => Promise<void>;
  removeSection: (id: string) => Promise<void>;
  addProduct: (draft: NewProductDraft) => Promise<Product | null>;
  updateProduct: (draft: UpdateProductDraft) => Promise<void>;
  removeProduct: (id: string) => Promise<void>;
  toggleAvailable: (id: string) => Promise<void>;

  // ---- Fechamento de venda ----
  /** Registra a venda, esvazia a mesa (vira "livre") e soma às vendas do dia. */
  finalizeTable: (tableId: string, payment: PaymentMethod) => Promise<void>;

  // ---- Feedback ----
  flash: (msg: string) => void;

  // ---- Recargas internas (mantêm memória == banco) ----
  reloadTables: () => Promise<void>;
  reloadCatalog: () => Promise<void>;
  reloadSalesTotal: () => Promise<void>;
  refreshSyncBadge: () => void;
}

// ---------------------------------------------------------------------------
// Estado interno fora do store (não reativo): handle do auto-sync e timers.
// ---------------------------------------------------------------------------

let autoSyncHandle: AutoSyncHandle | null = null;
let realtimeHandle: { stop: () => void } | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;
let syncBadgeTimer: ReturnType<typeof setInterval> | null = null;
let initPromise: Promise<void> | null = null;

/**
 * Debounce dos eventos de realtime: uma rajada de mudanças remotas (ex.: abrir
 * uma mesa gera vários INSERTs em order_items) chega em milissegundos; agrupamos
 * as entidades afetadas e recarregamos UMA vez por entidade, evitando N recargas
 * seguidas do banco/estado.
 */
let realtimeTimer: ReturnType<typeof setTimeout> | null = null;
const realtimePending = new Set<RemoteEntity>();

/** Janela de agrupamento (ms) das rajadas de eventos de realtime. */
const REALTIME_DEBOUNCE_MS = 200;

/** Duração do toast na tela (ms). */
const TOAST_MS = 1900;
/** Intervalo de atualização do badge de status de sync (ms). */
const SYNC_BADGE_MS = 5000;

// ---------------------------------------------------------------------------
// Store.
// ---------------------------------------------------------------------------

export const usePdvStore = create<PdvState>((set, get) => ({
  // ---- Estado inicial ----
  sections: [],
  products: [],
  tables: [],
  selectedTableId: null,
  activeCategory: null,
  salesTodayTotal: 0,
  syncStatus: getSyncStatus(),
  toast: '',
  ready: false,
  zoomFactor: 1.0,

  // ---- Zoom manual da UI ----------------------------------------------------

  setZoom: (z) => {
    const clamped = clampZoom(z);
    set({ zoomFactor: clamped });
    // Persiste de forma isolada e tolerante a erro (não bloqueia a UI).
    void db.setMeta(ZOOM_META_KEY, String(clamped)).catch((err) => {
      console.error('[usePdvStore.setZoom]', err);
    });
  },

  zoomIn: () => get().setZoom(get().zoomFactor + ZOOM_STEP),

  zoomOut: () => get().setZoom(get().zoomFactor - ZOOM_STEP),

  // ---- Ciclo de vida --------------------------------------------------------

  init: async () => {
    // Idempotente: chamadas concorrentes compartilham a mesma inicialização.
    if (get().ready) return;
    if (initPromise) return initPromise;

    initPromise = (async () => {
      try {
        await db.initDatabase();
        // Hidrata o timestamp da última sincronização (para o indicador do header).
        await loadLastSyncedAt();

        // Carrega o zoom manual salvo (isolado e tolerante a erro: falha aqui
        // nunca impede a inicialização; cai no default 1.0).
        try {
          const savedZoom = await db.getMeta(ZOOM_META_KEY);
          if (savedZoom) set({ zoomFactor: clampZoom(Number(savedZoom)) });
        } catch (zoomErr) {
          console.error('[usePdvStore.init.zoom]', zoomErr);
        }

        const [sections, products, tables, salesTodayTotal] = await Promise.all([
          db.getSections(),
          db.getProducts(),
          db.getTables(),
          db.getSalesTodayTotal(),
        ]);

        const normalizedTables = tables.map(withDerivedStatus);
        const activeCategory = sections.length > 0 ? sections[0].id : null;

        set({
          sections,
          products,
          tables: normalizedTables,
          salesTodayTotal,
          activeCategory,
          syncStatus: getSyncStatus(),
          ready: true,
        });

        // Liga o motor de sincronização (no-op silencioso se Supabase off).
        if (!autoSyncHandle) {
          autoSyncHandle = startAutoSync();
        }
        // Atualiza o badge de status periodicamente para a UI.
        if (!syncBadgeTimer) {
          syncBadgeTimer = setInterval(() => {
            get().refreshSyncBadge();
          }, SYNC_BADGE_MS);
        }

        // Liga a sincronização em TEMPO REAL entre aparelhos (no-op se Supabase
        // off). O callback apenas recarrega do SQLite a fatia afetada e atualiza
        // os arrays no estado — atualização INVISÍVEL: não recria a tela, não
        // perde selectedTableId e não dispara flash/toast. Um pequeno debounce
        // agrupa rajadas de eventos (ver applyRealtimeChanges).
        if (!realtimeHandle) {
          realtimeHandle = startRealtime((entity) => {
            // `entity` chega como string do módulo realtime; só nos interessam as
            // entidades conhecidas. Enfileira e agenda o flush debounced.
            realtimePending.add(entity as RemoteEntity);
            if (realtimeTimer) clearTimeout(realtimeTimer);
            realtimeTimer = setTimeout(() => {
              realtimeTimer = null;
              void applyRealtimeChanges(set);
            }, REALTIME_DEBOUNCE_MS);
          });
        }

        // PULL INICIAL (bootstrap) em BACKGROUND — fire-and-forget.
        // O app JÁ está pronto (ready=true) e mostrando o estado LOCAL; NÃO damos
        // await aqui para não bloquear a abertura esperando a rede. Assim que o
        // pull baixar as mesas/itens abertos por outros aparelhos, runBootstrapPull
        // recarrega o estado do banco e atualiza a UI de forma invisível (sem
        // perder selectedTableId, sem piscar). Se falhar (offline), segue local.
        void runBootstrapPull(set);
      } catch (err) {
        // Mesmo falhando, liberamos a UI para não travar em tela de carregando.
        set({ ready: true });
        get().flash('Falha ao iniciar o banco de dados');
        // eslint-disable-next-line no-console
        console.error('[usePdvStore.init]', err);
      }
    })();

    try {
      await initPromise;
    } finally {
      initPromise = null;
    }
  },

  teardown: () => {
    if (autoSyncHandle) {
      autoSyncHandle.stop();
      autoSyncHandle = null;
    }
    if (realtimeHandle) {
      realtimeHandle.stop();
      realtimeHandle = null;
    }
    if (realtimeTimer) {
      clearTimeout(realtimeTimer);
      realtimeTimer = null;
    }
    realtimePending.clear();
    if (syncBadgeTimer) {
      clearInterval(syncBadgeTimer);
      syncBadgeTimer = null;
    }
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
  },

  // ---- Seleção / navegação --------------------------------------------------

  selectTable: (id) => set({ selectedTableId: id }),

  setActiveCategory: (id) => set({ activeCategory: id }),

  // ---- Mesas ----------------------------------------------------------------

  addTable: async (name) => {
    try {
      const table = await db.addTable(name);
      // Insere no topo (getTables ordena por abertura desc) e já seleciona.
      set((s) => ({
        tables: [withDerivedStatus(table), ...s.tables],
        selectedTableId: table.id,
      }));
      triggerSync();
      return table;
    } catch (err) {
      get().flash('Não foi possível abrir a mesa');
      console.error('[usePdvStore.addTable]', err);
      return null;
    }
  },

  renameTable: async (id, name) => {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      get().flash('Informe um nome para a mesa');
      return;
    }
    try {
      const updated = await db.renameTable(id, trimmed);
      if (updated) {
        set((s) => ({
          tables: s.tables.map((t) =>
            t.id === id ? withDerivedStatus(updated) : t,
          ),
        }));
        triggerSync();
      }
    } catch (err) {
      get().flash('Não foi possível renomear a mesa');
      console.error('[usePdvStore.renameTable]', err);
    }
  },

  removeTable: async (id) => {
    try {
      await db.removeTable(id);
      set((s) => ({
        tables: s.tables.filter((t) => t.id !== id),
        selectedTableId: s.selectedTableId === id ? null : s.selectedTableId,
      }));
      triggerSync();
    } catch (err) {
      get().flash('Não foi possível remover a mesa');
      console.error('[usePdvStore.removeTable]', err);
    }
  },

  addProductToTable: async (product) => {
    // Produto esgotado não pode ser lançado.
    if (!product.available) {
      get().flash(product.name + ' está esgotado');
      return;
    }
    const tableId = get().selectedTableId;
    if (!tableId) {
      get().flash('Selecione uma mesa primeiro');
      return;
    }
    try {
      const updated = await db.addItemToTable(tableId, {
        id: product.id,
        name: product.name,
        price: product.price,
      });
      if (updated) {
        set((s) => ({
          tables: s.tables.map((t) =>
            t.id === tableId ? withDerivedStatus(updated) : t,
          ),
        }));
        triggerSync();
      }
    } catch (err) {
      get().flash('Não foi possível adicionar o item');
      console.error('[usePdvStore.addProductToTable]', err);
    }
  },

  changeQty: async (tableId, itemId, delta) => {
    const table = get().tables.find((t) => t.id === tableId);
    if (!table) return;
    const item = table.items.find((i) => i.id === itemId);
    if (!item) return;

    const nextQty = item.qty + delta;
    try {
      const updated = await db.setItemQty(tableId, itemId, nextQty);
      if (updated) {
        set((s) => ({
          tables: s.tables.map((t) =>
            t.id === tableId ? withDerivedStatus(updated) : t,
          ),
        }));
        triggerSync();
      }
    } catch (err) {
      get().flash('Não foi possível alterar a quantidade');
      console.error('[usePdvStore.changeQty]', err);
    }
  },

  // ---- Gestão de cardápio ---------------------------------------------------

  addSection: async (label) => {
    const trimmed = label.trim();
    if (trimmed.length === 0) {
      get().flash('Informe o nome da seção');
      return null;
    }
    try {
      const section = await db.addSection(trimmed);
      set((s) => ({
        sections: [...s.sections, section],
        // Se ainda não havia categoria ativa, ativa a recém-criada.
        activeCategory: s.activeCategory ?? section.id,
      }));
      triggerSync();
      get().flash('Seção criada e salva');
      return section;
    } catch (err) {
      get().flash('Não foi possível criar a seção');
      console.error('[usePdvStore.addSection]', err);
      return null;
    }
  },

  renameSection: async (id, label) => {
    const trimmed = label.trim();
    if (trimmed.length === 0) {
      get().flash('Informe o nome da seção');
      return;
    }
    try {
      const updated = await db.renameSection(id, trimmed);
      if (updated) {
        set((s) => ({
          sections: s.sections.map((sec) => (sec.id === id ? updated : sec)),
        }));
        triggerSync();
      }
    } catch (err) {
      get().flash('Não foi possível renomear a seção');
      console.error('[usePdvStore.renameSection]', err);
    }
  },

  removeSection: async (id) => {
    try {
      await db.removeSection(id);
      set((s) => {
        const sections = s.sections.filter((sec) => sec.id !== id);
        // Os produtos NÃO são apagados: apenas DESVINCULADOS (sectionId = '').
        // Continuam salvos e aparecem em "Todos os produtos" como "Sem seção".
        const products = s.products.map((p) =>
          p.sectionId === id ? { ...p, sectionId: '' } : p,
        );
        // Reajusta a categoria ativa caso a removida estivesse selecionada.
        const activeCategory =
          s.activeCategory === id
            ? sections.length > 0
              ? sections[0].id
              : null
            : s.activeCategory;
        return { sections, products, activeCategory };
      });
      triggerSync();
      get().flash('Seção removida');
    } catch (err) {
      get().flash('Não foi possível remover a seção');
      console.error('[usePdvStore.removeSection]', err);
    }
  },

  addProduct: async (draft) => {
    const name = draft.name.trim();
    if (name.length === 0) {
      get().flash('Informe o nome do produto');
      return null;
    }
    try {
      const product = await db.addProduct({
        sectionId: draft.sectionId,
        name,
        price: draft.price,
        icon: draft.icon,
        imageUrl: draft.imageUrl,
        available: draft.available,
      });
      set((s) => ({ products: [...s.products, product] }));
      get().flash('Produto cadastrado e salvo');
      return product;
    } catch (err) {
      get().flash('Não foi possível cadastrar o produto');
      console.error('[usePdvStore.addProduct]', err);
      return null;
    }
  },

  updateProduct: async (draft) => {
    if (draft.name !== undefined && draft.name.trim().length === 0) {
      get().flash('Informe o nome do produto');
      return;
    }
    try {
      const updated = await db.updateProduct({
        id: draft.id,
        sectionId: draft.sectionId,
        name: draft.name,
        price: draft.price,
        icon: draft.icon,
        imageUrl: draft.imageUrl,
        available: draft.available,
      });
      if (updated) {
        set((s) => ({
          products: s.products.map((p) => (p.id === draft.id ? updated : p)),
        }));
        get().flash('Produto atualizado');
      }
    } catch (err) {
      get().flash('Não foi possível atualizar o produto');
      console.error('[usePdvStore.updateProduct]', err);
    }
  },

  removeProduct: async (id) => {
    try {
      await db.removeProduct(id);
      set((s) => ({ products: s.products.filter((p) => p.id !== id) }));
      get().flash('Produto removido');
    } catch (err) {
      get().flash('Não foi possível remover o produto');
      console.error('[usePdvStore.removeProduct]', err);
    }
  },

  toggleAvailable: async (id) => {
    try {
      const updated = await db.toggleAvailable(id);
      if (updated) {
        set((s) => ({
          products: s.products.map((p) => (p.id === id ? updated : p)),
        }));
        get().flash(
          updated.available
            ? updated.name + ' disponível'
            : updated.name + ' marcado como esgotado',
        );
      }
    } catch (err) {
      get().flash('Não foi possível alterar a disponibilidade');
      console.error('[usePdvStore.toggleAvailable]', err);
    }
  },

  // ---- Fechamento de venda --------------------------------------------------

  finalizeTable: async (tableId, payment) => {
    const table = get().tables.find((t) => t.id === tableId);
    if (!table) {
      get().flash('Selecione uma mesa');
      return;
    }
    const items: OrderItem[] = table.items;
    if (tableCount(table) === 0) {
      get().flash('Adicione itens antes de finalizar');
      return;
    }
    const amount = tableTotal(table);

    try {
      // 1) Registra a venda (snapshot dos itens no histórico + fila de sync).
      await db.recordSale({
        tableId: table.id,
        tableName: table.name,
        // Clona os itens para o snapshot não referenciar o array vivo da mesa.
        items: items.map((i) => ({ ...i })),
        total: amount,
        payment,
      });

      // 2) Ao finalizar, a mesa SOME do mapa (a venda já foi registrada no
      //    histórico). removeTable apaga os itens e marca a mesa como deletada.
      await db.removeTable(tableId);

      // 3) Recarrega o total de vendas do dia direto do banco (fonte de verdade).
      const salesTodayTotal = await db.getSalesTodayTotal();

      set((s) => ({
        tables: s.tables.filter((t) => t.id !== tableId),
        selectedTableId:
          s.selectedTableId === tableId ? null : s.selectedTableId,
        salesTodayTotal,
      }));

      triggerSync();
      get().flash('Mesa ' + table.num + ' finalizada — ' + money(amount));
    } catch (err) {
      get().flash('Não foi possível finalizar a mesa');
      console.error('[usePdvStore.finalizeTable]', err);
    }
  },

  // ---- Feedback -------------------------------------------------------------

  flash: (msg) => {
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
    set({ toast: msg });
    toastTimer = setTimeout(() => {
      set({ toast: '' });
      toastTimer = null;
    }, TOAST_MS);
  },

  // ---- Recargas internas ----------------------------------------------------

  reloadTables: async () => {
    try {
      const tables = await db.getTables();
      set({ tables: tables.map(withDerivedStatus) });
    } catch (err) {
      console.error('[usePdvStore.reloadTables]', err);
    }
  },

  reloadCatalog: async () => {
    try {
      const [sections, products] = await Promise.all([
        db.getSections(),
        db.getProducts(),
      ]);
      set((s) => {
        const activeStillExists = sections.some(
          (sec) => sec.id === s.activeCategory,
        );
        const activeCategory = activeStillExists
          ? s.activeCategory
          : sections.length > 0
            ? sections[0].id
            : null;
        return { sections, products, activeCategory };
      });
    } catch (err) {
      console.error('[usePdvStore.reloadCatalog]', err);
    }
  },

  reloadSalesTotal: async () => {
    try {
      const salesTodayTotal = await db.getSalesTodayTotal();
      set({ salesTodayTotal });
    } catch (err) {
      console.error('[usePdvStore.reloadSalesTotal]', err);
    }
  },

  refreshSyncBadge: () => {
    const status = getSyncStatus();
    if (get().syncStatus !== status) {
      set({ syncStatus: status });
    }
  },
}));

// ---------------------------------------------------------------------------
// Seletores/derivados prontos para a UI (evitam recomputar em cada componente).
// ---------------------------------------------------------------------------

/** Quantidade de mesas ocupadas (com pelo menos 1 item). */
export function selectOccupiedCount(state: PdvState): number {
  return state.tables.reduce(
    (acc, t) => (tableCount(t) > 0 ? acc + 1 : acc),
    0,
  );
}

/** Mesa atualmente selecionada (ou null). */
export function selectSelectedTable(state: PdvState): Table | null {
  const id = state.selectedTableId;
  if (!id) return null;
  return state.tables.find((t) => t.id === id) ?? null;
}

/** Produtos de uma categoria/seção, ordenados por posição. */
export function selectProductsByCategory(
  state: PdvState,
  categoryId: string | null,
): Product[] {
  if (!categoryId) return [];
  return state.products
    .filter((p) => p.sectionId === categoryId)
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
}

/**
 * Hook conveniente: produtos da categoria ativa. Lê do próprio store e sempre
 * reflete a seleção atual (usado pela lista de produtos do painel lateral).
 */
export function useProductsByActiveCategory(): Product[] {
  // useShallow estabiliza a referência (o seletor cria um array novo a cada
  // chamada); sem ele o React re-renderizaria a lista em todo ciclo do store.
  return usePdvStore(
    useShallow((s) => selectProductsByCategory(s, s.activeCategory)),
  );
}

/** Hook conveniente: contagem de mesas ocupadas. */
export function useOccupiedCount(): number {
  return usePdvStore(selectOccupiedCount);
}

/** Hook conveniente: mesa selecionada. */
export function useSelectedTable(): Table | null {
  return usePdvStore(selectSelectedTable);
}
