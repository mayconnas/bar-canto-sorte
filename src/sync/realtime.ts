/**
 * Sincronização em TEMPO REAL do PDV Canto da Sorte (Supabase Realtime).
 *
 * Objetivo: quando um aparelho (web ou celular) altera uma tabela pdv.*, o
 * Supabase Realtime emite o evento; ESTE módulo, rodando nos OUTROS aparelhos,
 * recebe a mudança, aplica no SQLite local via applyRemoteRow (last-write-wins
 * por updated_at) e notifica o app (onChange) para repopular o estado/tela.
 *
 * DEGRADAÇÃO GRACIOSA: se o Supabase não estiver configurado (modo local puro),
 * startRealtime() devolve um handle válido com stop() no-op e nada é subscrito.
 *
 * REGRA CRÍTICA (evitar loop de push):
 *  - O aparelho que fez a escrita também recebe o evento realtime da própria
 *    mudança. applyRemoteRow é idempotente (LWW): a linha remota == local, então
 *    nada muda.
 *  - Mais importante: applyRemoteRow grava no SQLite SEM chamar enqueue(), logo
 *    aplicar uma linha remota NÃO reenfileira na sync_queue — não há loop de push.
 *
 * TOLERÂNCIA A FALHA: um erro ao aplicar uma linha (payload inesperado, etc.)
 * é logado e engolido, sem derrubar a subscrição das demais tabelas/eventos.
 */
import type {
  RealtimeChannel,
  RealtimePostgresChangesPayload,
} from '@supabase/supabase-js';

import { applyRemoteRow, type RemoteEntity } from '../db/database';
import { getSupabase, isSupabaseConfigured, PDV_SCHEMA } from './supabaseClient';

/** Handle devolvido por startRealtime para encerrar a subscrição. */
export interface RealtimeHandle {
  /** Remove o canal e para de receber eventos. Idempotente. */
  stop: () => void;
}

/**
 * Tabelas pdv.* observadas em tempo real. São exatamente os nomes das tabelas no
 * Supabase (iguais aos valores de RemoteEntity), então servem para o filtro do
 * postgres_changes E para o applyRemoteRow sem conversão.
 */
const REALTIME_TABLES: RemoteEntity[] = [
  'sections',
  'products',
  'tables',
  'order_items',
  'sales',
];

/** Nome único do canal realtime deste app. */
const CHANNEL_NAME = 'pdv-realtime';

/**
 * Indica se há uma subscrição realtime ativa (canal SUBSCRIBED). Meramente
 * informativo (ex.: badge de status "ao vivo"); não interfere no push/pull.
 */
let active = false;

/**
 * Extrai a linha relevante do payload do Realtime.
 *  - INSERT/UPDATE: usa `new` (estado após a mudança).
 *  - DELETE: usa `old` (só temos o estado anterior; com REPLICA IDENTITY FULL o
 *    `old` vem completo, e o applyRemoteRow trata o soft-delete via deleted/updated_at).
 */
function extractRow(
  payload: RealtimePostgresChangesPayload<Record<string, unknown>>,
): Record<string, unknown> | null {
  const novo = payload.new as Record<string, unknown> | null | undefined;
  if (novo && typeof novo === 'object' && Object.keys(novo).length > 0) {
    return novo;
  }
  const antigo = payload.old as Record<string, unknown> | null | undefined;
  if (antigo && typeof antigo === 'object' && Object.keys(antigo).length > 0) {
    return antigo;
  }
  return null;
}

/**
 * Subscreve aos eventos do Supabase Realtime das 5 tabelas pdv.* e aplica cada
 * mudança localmente via applyRemoteRow, chamando onChange(entity) para o store
 * repopular a memória/tela.
 *
 * @param onChange callback disparado após aplicar uma linha; recebe o nome da
 *   tabela que mudou (ex.: 'tables'). O store deve usar isso para recarregar
 *   (ex.: reloadAllFromLocal ou uma recarga direcionada).
 * @returns handle com stop(). Se o Supabase não estiver configurado, stop é no-op.
 */
export function startRealtime(onChange: (entity: string) => void): RealtimeHandle {
  // Degrada: sem credenciais ou sem cliente, não há realtime — modo local puro.
  if (!isSupabaseConfigured()) {
    return { stop: () => {} };
  }
  const supabase = getSupabase();
  if (supabase === null) {
    return { stop: () => {} };
  }

  // Handler compartilhado por todas as tabelas: aplica a linha e notifica.
  const makeHandler =
    (table: RemoteEntity) =>
    (payload: RealtimePostgresChangesPayload<Record<string, unknown>>): void => {
      // Não usar async direto na assinatura do .on (o supabase-js espera void);
      // encapsulamos em uma IIFE assíncrona com tratamento de erro próprio.
      void (async () => {
        try {
          const row = extractRow(payload);
          if (row === null) return; // payload sem dados úteis: ignora
          await applyRemoteRow(table, row);
          // Notifica o app para recarregar o estado a partir do SQLite local.
          onChange(table);
        } catch (erro) {
          // Erro ao aplicar UMA linha não pode derrubar a subscrição.
          console.warn(`[realtime] falha ao aplicar mudança de '${table}':`, erro);
        }
      })();
    };

  // UM único canal para as 5 tabelas.
  let channel: RealtimeChannel = supabase.channel(CHANNEL_NAME);

  for (const table of REALTIME_TABLES) {
    channel = channel.on(
      // O supabase-js tipa este overload de forma estrita; 'postgres_changes'
      // como string literal casa em runtime. Cast evita atrito de tipos do genérico.
      'postgres_changes' as unknown as 'system',
      { event: '*', schema: PDV_SCHEMA, table } as never,
      makeHandler(table) as never,
    );
  }

  channel.subscribe((status: string) => {
    // Estados possíveis: 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED'.
    if (status === 'SUBSCRIBED') {
      active = true;
      console.log('[realtime] canal pdv-realtime SUBSCRIBED (ao vivo).');
    } else if (status === 'CHANNEL_ERROR') {
      active = false;
      console.warn('[realtime] canal pdv-realtime CHANNEL_ERROR.');
    } else {
      active = false;
      console.log(`[realtime] canal pdv-realtime status: ${status}.`);
    }
  });

  let stopped = false;
  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      active = false;
      try {
        // removeChannel também dá unsubscribe no canal.
        void supabase.removeChannel(channel);
      } catch (erro) {
        console.warn('[realtime] falha ao remover canal:', erro);
      }
    },
  };
}

/**
 * Retorna se a subscrição realtime está ativa neste momento (canal SUBSCRIBED).
 * Uso opcional para UI de status; não afeta push/pull.
 */
export function isRealtimeActive(): boolean {
  return active;
}
