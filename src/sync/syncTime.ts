/**
 * Helpers PUROS para exibir "quando foi a última sincronização" na UI do PDV.
 *
 * Sem dependência de rede/banco/estado — apenas formatação de tempo. Assim é
 * trivial de testar: passe `ms` (epoch da última sync) e, opcionalmente, `now`
 * (epoch atual) para controlar o "agora" nos testes. Em produção, chame sem o
 * segundo argumento e ele usa Date.now().
 */

/** 1 minuto em ms. */
const MINUTE = 60 * 1000;
/** 1 hora em ms. */
const HOUR = 60 * MINUTE;
/** 1 dia em ms. */
const DAY = 24 * HOUR;

/**
 * Formata o instante da última sincronização de forma amigável, em português.
 *
 * Regras (do mais recente ao mais antigo):
 *  - null / inválido / no futuro ...... "Nunca sincronizado" (para null/inválido)
 *  - < 10s ............................ "Sincronizado agora"
 *  - < 60s ............................ "Sincronizado há 42 s"
 *  - < 60min .......................... "Sincronizado há 1 min" / "há 12 min"
 *  - < 24h ............................ "Sincronizado há 1 hora" / "há 3 horas"
 *  - mesmo dia (>=... raramente) ...... cai nas horas acima
 *  - ontem ............................ "Sincronizado ontem às 14:35"
 *  - mais antigo ...................... "Sincronizado em 24/07 às 14:35"
 *
 * @param ms  epoch (ms) da última sincronização bem-sucedida, ou null.
 * @param now epoch (ms) atual — injetável para testes; default Date.now().
 */
export function formatLastSync(ms: number | null, now: number = Date.now()): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) {
    return 'Nunca sincronizado';
  }

  const diff = now - ms;

  // Relógio adiantado/atrasado: se o timestamp está "no futuro", trata como agora.
  if (diff < 0) {
    return 'Sincronizado agora';
  }

  if (diff < 10 * 1000) {
    return 'Sincronizado agora';
  }

  if (diff < MINUTE) {
    const s = Math.floor(diff / 1000);
    return `Sincronizado há ${s} s`;
  }

  if (diff < HOUR) {
    const mins = Math.floor(diff / MINUTE);
    return `Sincronizado há ${mins} min`;
  }

  if (diff < DAY) {
    const hours = Math.floor(diff / HOUR);
    return `Sincronizado há ${hours} ${hours === 1 ? 'hora' : 'horas'}`;
  }

  // Mais de um dia: mostra data/hora absolutas.
  const when = new Date(ms);
  const time = formatClock(when);

  if (isYesterday(when, new Date(now))) {
    return `Sincronizado ontem às ${time}`;
  }

  const dd = pad2(when.getDate());
  const mm = pad2(when.getMonth() + 1);
  return `Sincronizado em ${dd}/${mm} às ${time}`;
}

/**
 * Versão curta para um badge compacto: "há 2 min", "há 1 hora", "agora",
 * "24/07", "Nunca". Útil quando o espaço é apertado.
 */
export function formatLastSyncShort(ms: number | null, now: number = Date.now()): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) {
    return 'Nunca';
  }
  const diff = now - ms;
  if (diff < 0 || diff < 10 * 1000) return 'agora';
  if (diff < MINUTE) return `há ${Math.floor(diff / 1000)} s`;
  if (diff < HOUR) return `há ${Math.floor(diff / MINUTE)} min`;
  if (diff < DAY) {
    const h = Math.floor(diff / HOUR);
    return `há ${h} ${h === 1 ? 'hora' : 'horas'}`;
  }
  const when = new Date(ms);
  return `${pad2(when.getDate())}/${pad2(when.getMonth() + 1)}`;
}

/** "HH:MM" com zero à esquerda. */
function formatClock(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Inteiro para string de 2 dígitos. */
function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** true se `d` cai no dia civil anterior ao de `ref` (mesma timezone local). */
function isYesterday(d: Date, ref: Date): boolean {
  const yesterday = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() - 1);
  return (
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate()
  );
}
