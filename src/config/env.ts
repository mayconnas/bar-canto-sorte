/**
 * Credenciais e configuração de ambiente do PDV Canto da Sorte.
 *
 * Os valores vêm de variáveis de ambiente com prefixo EXPO_PUBLIC_, carregadas
 * automaticamente pelo Expo CLI a partir do arquivo .env na raiz do projeto.
 * Copie .env.example para .env e preencha com os valores do seu projeto
 * Supabase (Project Settings > API).
 *
 * Enquanto estiverem vazios, o app funciona 100% offline: grava apenas no
 * SQLite local e o status de sincronização permanece 'disabled'.
 *
 * OBS.: como este é um app offline-first, NUNCA lance exceção por falta de
 * credenciais. A ausência é um estado válido (modo somente-local).
 *
 * OBS. 2: variáveis EXPO_PUBLIC_ são embutidas em texto puro no bundle
 * compilado. Use apenas a chave anônima (anon/public), nunca a service_role.
 */

/** URL do projeto Supabase (self-hosted, atrás do Kong). */
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';

/** Chave pública anônima (anon/public key) do projeto Supabase. */
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

/**
 * Indica se o Supabase está configurado (ambas credenciais preenchidas).
 * Usado por toda a camada de sync para decidir entre modo local e modo nuvem.
 */
export function isSupabaseConfigured(): boolean {
  return SUPABASE_URL.trim().length > 0 && SUPABASE_ANON_KEY.trim().length > 0;
}
