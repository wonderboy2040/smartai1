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

// ------------------------------------------------------------
// 4) ASSETS SNAPSHOT → CSV (v4.5 — the live assets-table view)
// One row per holding with live LTP, cost basis, value, unrealized
// P&L and today's P&L — the exact sync-truth numbers the Portfolio
// TAB renders (assetPnl engine), frozen to a spreadsheet.
// ------------------------------------------------------------
export interface AssetSnapshotRow {
  symbol: string;
  name?: string;
  market: string;           // IN | US | CRYPTO
  qty: number;
  avgPrice: number;         // native currency
  ltp: number;              // native currency
  changePct: number;        // day change %
  investedNative: number;   // cost basis, native currency
  valueNative: number;      // live equity value, native currency
  pnlNative: number;        // unrealized P&L, native currency
  pnlPct: number | null;    // unrealized P&L % (null = no cost basis)
  todayPLNative: number;    // today's P&L, native currency
  valueINR: number;         // FX-consistent INR value
}

export function buildAssetsSnapshotCSV(rows: AssetSnapshotRow[], usdInr: number): string {
  const headers = [
    'Symbol', 'Name', 'Market', 'Qty', 'Avg Price (native)', 'LTP (native)', 'Day Change %',
    'Cost (native)', 'Value (native)', 'Unrealized P&L (native)', 'P&L %',
    "Today's P&L (native)", 'Value (INR)',
  ];
  const body: (unknown[])[] = rows.map(a => [
    a.symbol.replace('.NS', '').replace('.BO', ''),
    a.name || '',
    a.market,
    a.qty,
    a.avgPrice.toFixed(2),
    a.ltp.toFixed(2),
    a.changePct.toFixed(2),
    a.investedNative.toFixed(2),
    a.valueNative.toFixed(2),
    a.pnlNative.toFixed(2),
    a.pnlPct != null ? a.pnlPct.toFixed(2) : '',
    a.todayPLNative.toFixed(2),
    a.valueINR.toFixed(0),
  ]);
  // totals footer (INR bucket — FX-consistent)
  const totValINR = rows.reduce((s, r) => s + r.valueINR, 0);
  body.push(['TOTAL', '', '', '', '', '', '', '', '', '', '', '', totValINR.toFixed(0)]);
  const csv = toCSV(headers, body);
  // (usdInr recorded in a trailing comment row for audit)
  return `${csv}\r\n# USD/INR at export: ${usdInr.toFixed(2)}`;
}

export function exportAssetsSnapshotCSV(rows: AssetSnapshotRow[], usdInr: number) {
  downloadFile(`assets_snapshot_${stamp()}.csv`, buildAssetsSnapshotCSV(rows, usdInr));
}
