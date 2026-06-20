// ============================================================
// EXPORT DATA ENGINE
// Converts the transaction ledger, monthly analytics and monthly
// return report into CSV and triggers a browser download (Blob).
// Zero dependencies — pure browser APIs. Useful for tax-filing
// and record-keeping. CSV opens directly in Excel / Google Sheets.
// ============================================================
import { Transaction } from '../types';
import { buildMonthlyAnalytics, buildMonthlyReturns, MonthlyReturn } from './portfolioAnalytics';
import { MonthlyAnalytics } from '../types';

// Escape a single CSV cell — wraps in quotes if it contains comma/quote/newline.
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// Build a CSV string from a header row + array of row arrays.
export function toCSV(headers: string[], rows: (unknown[])[]): string {
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) lines.push(row.map(csvCell).join(','));
  // Prepend BOM so Excel detects UTF-8 (₹ / emojis render correctly).
  return '\uFEFF' + lines.join('\r\n');
}

// Trigger a client-side download of a text blob.
export function downloadFile(filename: string, content: string, mime = 'text/csv;charset=utf-8;') {
  try {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revoke after a tick so Safari/iOS has time to start the download.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) {
    console.error('Download failed', e);
    alert('Export fail ho gaya bhai — browser ne download block kiya.');
  }
}

function stamp(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

// ------------------------------------------------------------
// 1) TRANSACTIONS → CSV (full buy/sell ledger)
// ------------------------------------------------------------
export function exportTransactionsCSV(transactions: Transaction[]) {
  const headers = [
    'Date', 'Symbol', 'Market', 'Type', 'Qty', 'Price', 'Amount (native)',
    'Prev Qty', 'Prev Avg', 'New Qty', 'New Avg', 'Realized P&L', 'Recorded At',
  ];
  // newest-first for readability
  const sorted = [...transactions].sort((a, b) => (b.ts || 0) - (a.ts || 0));
  const rows = sorted.map(t => [
    t.date,
    t.symbol.replace('.NS', '').replace('.BO', ''),
    t.market,
    t.type.toUpperCase(),
    t.qty,
    t.price.toFixed(4),
    t.amount.toFixed(2),
    t.prevQty,
    t.prevAvg.toFixed(4),
    t.newQty,
    t.newAvg.toFixed(4),
    typeof t.realizedPL === 'number' ? t.realizedPL.toFixed(2) : '',
    t.ts ? new Date(t.ts).toISOString() : '',
  ]);
  downloadFile(`transactions_${stamp()}.csv`, toCSV(headers, rows));
}

// ------------------------------------------------------------
// 2) MONTHLY ANALYTICS → CSV (Planner deep data analytics)
// ------------------------------------------------------------
export function exportMonthlyAnalyticsCSV(transactions: Transaction[], usdInr: number) {
  const rows: MonthlyAnalytics[] = buildMonthlyAnalytics(transactions, usdInr);
  const headers = [
    'Month', 'Range', 'Buy Qty', 'Invested (INR)', 'Sell Qty', 'Redeemed (INR)',
    'Net Invested (INR)', 'Realized P&L (INR)', 'Txns', 'Symbols',
    'India Buys (INR)', 'India Txns', 'USA Buys (USD-native)', 'USA Buys (INR)', 'USA Txns',
    'Crypto Buys (INR)', 'Crypto Txns',
  ];
  const body = rows.map(m => [
    m.label, m.rangeLabel, m.buyQty, m.buyAmountINR.toFixed(0), m.sellQty, m.sellAmountINR.toFixed(0),
    m.netInvestedINR.toFixed(0), m.realizedPLINR.toFixed(0), m.txnCount, m.symbols.join(' | '),
    m.india.buyAmountINR.toFixed(0), m.india.txnCount,
    m.usa.buyAmount.toFixed(2), m.usa.buyAmountINR.toFixed(0), m.usa.txnCount,
    m.crypto.buyAmountINR.toFixed(0), m.crypto.txnCount,
  ]);
  downloadFile(`monthly_analytics_${stamp()}.csv`, toCSV(headers, body));
}

// ------------------------------------------------------------
// 3) MONTHLY RETURN REPORT → CSV (Portfolio month-wise returns)
// ------------------------------------------------------------
export function exportMonthlyReturnsCSV(transactions: Transaction[], usdInr: number) {
  const { rows, totalRealizedINR }: { rows: MonthlyReturn[]; totalRealizedINR: number } =
    buildMonthlyReturns(transactions, usdInr);
  const headers = [
    'Month', 'Range', 'Net Invested (INR)', 'Realized P&L (INR)',
    'Realized Return %', 'Cumulative Invested (INR)',
  ];
  const body: (unknown[])[] = rows.map(r => [
    r.label, r.rangeLabel, r.netInvestedINR.toFixed(0), r.realizedPLINR.toFixed(0),
    r.realizedReturnPct.toFixed(2), r.cumulativeInvestedINR.toFixed(0),
  ]);
  // total footer row
  body.push(['TOTAL', '', '', totalRealizedINR.toFixed(0), '', '']);
  downloadFile(`monthly_returns_${stamp()}.csv`, toCSV(headers, body));
}
