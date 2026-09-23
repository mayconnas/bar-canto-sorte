/**
 * Geração do HTML do "Relatório de Vendas" para exportação em PDF.
 *
 * Este módulo é puro: recebe os dados já carregados (o mesmo período/estado
 * exibido no SalesReportModal) e devolve uma string HTML estilizada com a
 * identidade do Canto da Sorte (dourado/marrom/creme). O HTML é consumido por
 * expo-print (Print.printToFileAsync({ html })) para produzir o arquivo PDF.
 *
 * Nada aqui toca o banco nem o estado — mantém a função testável e determinística
 * (a data/hora de geração entra como parâmetro `generatedAt`).
 */
import type { PaymentMethod, Sale } from '../types';
import type { getSalesSummary, getTopProducts } from '../db/database';
import { colors } from '../theme/colors';
import { money } from '../store/usePdvStore';

/** Resumo agregado — mesmo shape de getSalesSummary (reutilizado do DB). */
export type SalesSummary = Awaited<ReturnType<typeof getSalesSummary>>;
/** Produto do ranking — mesmo shape de getTopProducts. */
export type TopProduct = Awaited<ReturnType<typeof getTopProducts>>[number];

/** Dados de entrada para montar o relatório em PDF. */
export interface ReportPdfData {
  /** Período por extenso (ex.: "Hoje — 24/07/2026", "Julho/2026"). */
  periodLabel: string;
  /** Timestamp (ms) de geração do relatório. */
  generatedAt: number;
  summary: SalesSummary;
  top: TopProduct[];
  sales: Sale[];
}

/** Rótulo e ordem de exibição de cada forma de pagamento no PDF. */
const PAYMENT_LABELS: Array<{ id: PaymentMethod; label: string }> = [
  { id: 'dinheiro', label: 'Dinheiro' },
  { id: 'pix', label: 'Pix' },
  { id: 'debito', label: 'Débito' },
  { id: 'credito', label: 'Crédito' },
];

const PAYMENT_LABEL_MAP: Record<PaymentMethod, string> = {
  dinheiro: 'Dinheiro',
  pix: 'Pix',
  debito: 'Débito',
  credito: 'Crédito',
};

/** Escapa caracteres especiais para injeção segura em HTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** "24/07/2026 às 14:35" a partir de um timestamp em ms. */
function formatDateTime(ms: number): string {
  const d = new Date(ms);
  const dd = String(d.getDate()).padStart(2, '0');
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const yy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mo}/${yy} às ${hh}:${mm}`;
}

/** "24/07/2026 14:35" — compacto, para a coluna da tabela de vendas. */
function formatSaleWhen(ms: number): string {
  const d = new Date(ms);
  const dd = String(d.getDate()).padStart(2, '0');
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const yy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mo}/${yy} ${hh}:${mm}`;
}

/**
 * Monta o HTML completo (com CSS inline) do relatório de vendas.
 * Determinístico: a data/hora vem em `generatedAt`.
 */
export function buildSalesReportHtml({
  periodLabel,
  generatedAt,
  summary,
  top,
  sales,
}: ReportPdfData): string {
  const total = summary.total ?? 0;
  const count = summary.count ?? 0;
  const avg = count > 0 ? total / count : 0;

  const paymentRows = PAYMENT_LABELS.map(({ id, label }) => {
    const bucket = summary.byPayment[id];
    const t = bucket?.total ?? 0;
    const c = bucket?.count ?? 0;
    return `
      <tr>
        <td class="left">${label}</td>
        <td class="center">${c}</td>
        <td class="right">${escapeHtml(money(t))}</td>
      </tr>`;
  }).join('');

  const topRows =
    top.length > 0
      ? top
          .map(
            (p, idx) => `
      <tr>
        <td class="rank">${idx + 1}º</td>
        <td class="left">${escapeHtml(p.name)}</td>
        <td class="center">${p.qty}x</td>
        <td class="right">${escapeHtml(money(p.total))}</td>
      </tr>`,
          )
          .join('')
      : `<tr><td class="empty" colspan="4">Sem itens no período.</td></tr>`;

  const saleRows =
    sales.length > 0
      ? sales
          .map(
            (s) => `
      <tr>
        <td class="left">${escapeHtml(s.tableName)}</td>
        <td class="left">${PAYMENT_LABEL_MAP[s.payment] ?? escapeHtml(s.payment)}</td>
        <td class="left">${formatSaleWhen(s.closedAt)}</td>
        <td class="right">${escapeHtml(money(s.total))}</td>
      </tr>`,
          )
          .join('')
      : `<tr><td class="empty" colspan="4">Nenhuma venda no período.</td></tr>`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 28px 30px 40px;
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
    color: ${colors.textHeading};
    background: ${colors.creamCard};
    font-size: 13px;
    line-height: 1.45;
  }
  .header {
    background: ${colors.woodHeader};
    color: ${colors.creamText};
    border-radius: 14px;
    padding: 22px 26px;
    border: 1px solid ${colors.woodBorder};
  }
  .brand {
    font-size: 11px;
    letter-spacing: 3px;
    text-transform: uppercase;
    color: ${colors.amber};
    margin: 0 0 6px;
    font-weight: 700;
  }
  .title {
    font-size: 24px;
    font-weight: 800;
    margin: 0;
    color: ${colors.creamText};
  }
  .period {
    margin: 12px 0 0;
    font-size: 15px;
    font-weight: 700;
    color: ${colors.amber};
  }
  .generated {
    margin: 4px 0 0;
    font-size: 11px;
    color: ${colors.creamCard};
    opacity: 0.75;
  }

  .kpis {
    display: flex;
    gap: 12px;
    margin: 20px 0 4px;
  }
  .kpi {
    flex: 1;
    border: 1px solid ${colors.borderCream};
    border-radius: 12px;
    padding: 14px 16px;
    background: ${colors.white};
  }
  .kpi.strong {
    background: ${colors.woodHeader};
    border-color: ${colors.woodBorder};
  }
  .kpi .label {
    font-size: 9.5px;
    letter-spacing: 1.4px;
    text-transform: uppercase;
    color: ${colors.textMuted};
    margin: 0 0 6px;
    font-weight: 700;
  }
  .kpi.strong .label { color: ${colors.amberSoft}; }
  .kpi .value {
    font-size: 22px;
    font-weight: 800;
    color: ${colors.textHeading};
    margin: 0;
  }
  .kpi.strong .value { color: ${colors.creamText}; }

  h2.section {
    font-size: 11px;
    letter-spacing: 1.8px;
    text-transform: uppercase;
    color: ${colors.goldDeepAlt};
    margin: 26px 0 8px;
    padding-bottom: 6px;
    border-bottom: 2px solid ${colors.borderCream};
  }

  table {
    width: 100%;
    border-collapse: collapse;
    border: 1px solid ${colors.borderCream};
    border-radius: 12px;
    overflow: hidden;
    background: ${colors.white};
  }
  thead th {
    background: ${colors.creamPanel};
    color: ${colors.textMuted};
    font-size: 9.5px;
    letter-spacing: 1px;
    text-transform: uppercase;
    text-align: left;
    padding: 9px 12px;
    border-bottom: 1px solid ${colors.borderCream};
  }
  tbody td {
    padding: 9px 12px;
    border-bottom: 1px solid ${colors.creamAlt};
    font-size: 12.5px;
    color: ${colors.textHeading};
  }
  tbody tr:last-child td { border-bottom: none; }
  tbody tr:nth-child(even) td { background: ${colors.creamCard}; }
  th.center, td.center { text-align: center; }
  th.right, td.right { text-align: right; }
  td.right { font-weight: 700; }
  td.rank {
    font-weight: 800;
    color: ${colors.goldDeep};
    width: 40px;
  }
  td.empty {
    text-align: center;
    color: ${colors.textFaint};
    font-style: italic;
    padding: 16px 12px;
  }

  .footer {
    margin-top: 28px;
    padding-top: 14px;
    border-top: 1px solid ${colors.borderCream};
    text-align: center;
    font-size: 10.5px;
    color: ${colors.textFaint};
  }
</style>
</head>
<body>
  <div class="header">
    <p class="brand">Canto da Sorte</p>
    <h1 class="title">Relatório de Vendas</h1>
    <p class="period">${escapeHtml(periodLabel)}</p>
    <p class="generated">Gerado em ${formatDateTime(generatedAt)}</p>
  </div>

  <div class="kpis">
    <div class="kpi strong">
      <p class="label">Total vendido</p>
      <p class="value">${escapeHtml(money(total))}</p>
    </div>
    <div class="kpi">
      <p class="label">Nº de vendas</p>
      <p class="value">${count}</p>
    </div>
    <div class="kpi">
      <p class="label">Ticket médio</p>
      <p class="value">${escapeHtml(money(avg))}</p>
    </div>
  </div>

  <h2 class="section">Formas de pagamento</h2>
  <table>
    <thead>
      <tr>
        <th class="left">Forma</th>
        <th class="center">Nº de vendas</th>
        <th class="right">Total</th>
      </tr>
    </thead>
    <tbody>${paymentRows}
    </tbody>
  </table>

  <h2 class="section">Mais vendidos</h2>
  <table>
    <thead>
      <tr>
        <th class="left" colspan="2">Produto</th>
        <th class="center">Qtd</th>
        <th class="right">Total</th>
      </tr>
    </thead>
    <tbody>${topRows}
    </tbody>
  </table>

  <h2 class="section">Vendas do período (${sales.length})</h2>
  <table>
    <thead>
      <tr>
        <th class="left">Mesa</th>
        <th class="left">Pagamento</th>
        <th class="left">Data / hora</th>
        <th class="right">Total</th>
      </tr>
    </thead>
    <tbody>${saleRows}
    </tbody>
  </table>

  <p class="footer">Gerado pelo PDV Canto da Sorte</p>
</body>
</html>`;
}
