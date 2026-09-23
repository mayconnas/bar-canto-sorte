/**
 * Cliente Supabase (singleton) para o PDV Canto da Sorte.
 *
 * Offline-first: se o Supabase não estiver configurado (ver ../config/env),
 * getSupabase() retorna null e toda a camada de sync degrada graciosamente
 * para o modo somente-local.
 *
 * IMPORTANTE: o polyfill de URL precisa ser importado ANTES do supabase-js,
 * pois o React Native não traz uma implementação completa de URL.
 */
import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { SUPABASE_URL, SUPABASE_ANON_KEY, isSupabaseConfigured } from '../config/env';

/** Nome do schema isolado onde vivem as tabelas do PDV neste Supabase compartilhado. */
export const PDV_SCHEMA = 'pdv';

/**
 * Cliente tipado de forma frouxa (any). Sem um tipo Database gerado, o supabase-js
 * infere schema 'never' e rejeita os payloads dinâmicos do motor de sync; usar
 * `any` nos genéricos mantém .from()/.upsert() utilizáveis com o schema 'pdv'.
 */
type AnyClient = SupabaseClient<any, any, any>;

/** Instância única, criada sob demanda na primeira chamada de getSupabase(). */
let client: AnyClient | null = null;

/**
 * Retorna o cliente Supabase, ou null se as credenciais não estiverem
 * configuradas. A instância é memoizada (criada uma única vez).
 *
 * A persistência de auth usa AsyncStorage. Em React Native não há detecção
 * de sessão na URL, então detectSessionInUrl é desativado.
 */
export function getSupabase(): AnyClient | null {
  if (!isSupabaseConfigured()) {
    return null;
  }
  if (client === null) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      // As tabelas do PDV vivem no schema isolado "pdv" (não em "public"), para
      // não se misturar com os outros projetos deste Supabase compartilhado.
      // Todas as chamadas .from('sections'/'products'/...) passam a mirar pdv.*.
      db: { schema: PDV_SCHEMA },
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });
  }
  return client;
}

/** Reexporta o helper por conveniência para quem só importa este módulo. */
export { isSupabaseConfigured };
