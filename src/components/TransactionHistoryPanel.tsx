import React, { useMemo, useState } from 'react';
import { useApp } from '../hooks/AppContext';
import { Transaction, TransactionType } from '../types';
import { exportTransactionsCSV } from '../utils/exportData';

// ============================================================
// TRANSACTION HISTORY PANEL
// Full buy/sell ledger with filters (type / market / symbol /
// date range), inline edit + delete. Surfaces the data that
// powers the monthly analytics & return reports (no more black box).
// ============================================================

type TypeFilter = 'all' | TransactionType;
type MarketFilter = 'all' | 'IN' | 'US';

const TransactionHistoryPanel = React.memo(function TransactionHistoryPanel() {
  const { transactions, deleteTransaction, editTransaction, usdInrRate } = useApp();

  const [open, setOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [marketFilter, setMarketFilter] = useState<MarketFilter>('all');
  const [symbolQuery, setSymbolQuery] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  // Inline edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editQty, setEditQty] = useState('');
  const [editPrice, setEditPrice] = useState('');
  const [editDate, setEditDate] = useState('');

  const filtered = useMemo(() => {
    const q = symbolQuery.trim().toUpperCase();
    return [...transactions]
      .filter(t => {
        if (typeFilter !== 'all' && t.type !== typeFilter) return false;
        if (marketFilter !== 'all' && t.market !== marketFilter) return false;
        if (q && !t.symbol.toUpperCase().includes(q)) return false;
        if (fromDate && t.date < fromDate) return false;
        if (toDate && t.date > toDate) return false;
        return true;
      })
      .sort((a, b) => (b.ts || 0) - (a.ts || 0));
  }, [transactions, typeFilter, marketFilter, symbolQuery, fromDate, toDate]);

  // Quick stats over the filtered set (INR-normalised)
  const stats = useMemo(() => {
    let buys = 0, sells = 0, investedINR = 0, realizedINR = 0;
    for (const t of filtered) {
      const amtINR = t.market === 'US' ? t.amount * usdInrRate : t.amount;
      if (t.type === 'buy') { buys++; investedINR += amtINR; }
      else {
        sells++;
        if (typeof t.realizedPL === 'number') realizedINR += t.market === 'US' ? t.realizedPL * usdInrRate : t.realizedPL;
      }
    }
    return { buys, sells, investedINR, realizedINR, count: filtered.length };
  }, [filtered, usdInrRate]);

  const startEdit = (t: Transaction) => {
    setEditingId(t.id);
    setEditQty(String(t.qty));
    setEditPrice(String(t.price));
    setEditDate(t.date);
  };

  const saveEdit = (t: Transaction) => {
    const qty = parseFloat(editQty);
    const price = parseFloat(editPrice);
    if (isNaN(qty) || qty <= 0 || isNaN(price) || price <= 0 || !editDate) {
      alert('Qty / price / date sahi daalo bhai.');
      return;
    }
    editTransaction(t.id, { qty, price, date: editDate });
    setEditingId(null);
  };

  const resetFilters = () => {
    setTypeFilter('all'); setMarketFilter('all'); setSymbolQuery(''); setFromDate(''); setToDate('');
  };

  const cur = (m: 'IN' | 'US') => (m === 'IN' ? '₹' : '$');

  return (
    <div className="quantum-panel rounded-2xl overflow-hidden animate-fade-in-up">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center text-base">🧾</div>
          <div className="text-left">
            <div className="text-sm font-black text-white">Transaction History</div>
            <div className="text-[10px] text-slate-500">{transactions.length} recorded · buy/sell ledger</div>
          </div>
        </div>
        <span className={`text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`}>▼</span>
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-white/5">
          {/* Toolbar */}
          <div className="flex flex-wrap items-end gap-2 mt-3 mb-3">
            <div className="flex flex-col">
              <label className="text-[9px] text-slate-500 font-bold uppercase tracking-wider mb-1">Type</label>
              <select value={typeFilter} onChange={e => setTypeFilter(e.target.value as TypeFilter)}
                className="quantum-input rounded-lg px-2 py-1.5 text-xs text-white bg-slate-900/60">
                <option value="all">All</option>
                <option value="buy">Buy</option>
                <option value="sell">Sell</option>
              </select>
            </div>
            <div className="flex flex-col">
              <label className="text-[9px] text-slate-500 font-bold uppercase tracking-wider mb-1">Market</label>
              <select value={marketFilter} onChange={e => setMarketFilter(e.target.value as MarketFilter)}
                className="quantum-input rounded-lg px-2 py-1.5 text-xs text-white bg-slate-900/60">
                <option value="all">All</option>
                <option value="IN">🇮🇳 India</option>
                <option value="US">🇺🇸 US</option>
              </select>
            </div>
            <div className="flex flex-col">
              <label className="text-[9px] text-slate-500 font-bold uppercase tracking-wider mb-1">Symbol</label>
              <input value={symbolQuery} onChange={e => setSymbolQuery(e.target.value)} placeholder="Search…"
                className="quantum-input rounded-lg px-2 py-1.5 text-xs text-white w-28 bg-slate-900/60" />
            </div>
            <div className="flex flex-col">
              <label className="text-[9px] text-slate-500 font-bold uppercase tracking-wider mb-1">From</label>
              <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
                className="quantum-input rounded-lg px-2 py-1.5 text-xs text-slate-300 bg-slate-900/60" />
            </div>
            <div className="flex flex-col">
              <label className="text-[9px] text-slate-500 font-bold uppercase tracking-wider mb-1">To</label>
              <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
                className="quantum-input rounded-lg px-2 py-1.5 text-xs text-slate-300 bg-slate-900/60" />
            </div>
            <button onClick={resetFilters} className="quantum-btn-ghost px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-400">Reset</button>
            <button
              onClick={() => exportTransactionsCSV(filtered.length ? filtered : transactions)}
              className="quantum-btn-ghost px-3 py-1.5 rounded-lg text-xs font-semibold text-emerald-400 border border-emerald-500/20"
              title="Export filtered transactions to CSV"
            >
              ⬇️ Export CSV
            </button>
          </div>

          {/* Quick stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
            <div className="bg-black/20 rounded-lg p-2">
              <div className="text-[9px] text-slate-500 uppercase font-bold">Showing</div>
              <div className="text-sm font-black text-white font-mono">{stats.count}</div>
            </div>
            <div className="bg-black/20 rounded-lg p-2">
              <div className="text-[9px] text-emerald-500 uppercase font-bold">Buys / Sells</div>
              <div className="text-sm font-black text-white font-mono">{stats.buys} / {stats.sells}</div>
            </div>
            <div className="bg-black/20 rounded-lg p-2">
              <div className="text-[9px] text-cyan-500 uppercase font-bold">Invested (INR)</div>
              <div className="text-sm font-black text-cyan-400 font-mono">₹{Math.round(stats.investedINR).toLocaleString('en-IN')}</div>
            </div>
            <div className="bg-black/20 rounded-lg p-2">
              <div className="text-[9px] text-slate-500 uppercase font-bold">Realized P&L</div>
              <div className={`text-sm font-black font-mono ${stats.realizedINR >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {stats.realizedINR >= 0 ? '+' : ''}₹{Math.round(stats.realizedINR).toLocaleString('en-IN')}
              </div>
            </div>
          </div>

          {/* List */}
          <div className="max-h-[420px] overflow-y-auto rounded-xl border border-white/5 divide-y divide-white/[0.03]">
            {filtered.length === 0 && (
              <div className="p-8 text-center text-slate-500 text-sm">No transactions match the filters.</div>
            )}
            {filtered.map(t => {
              const c = cur(t.market);
              const isEditing = editingId === t.id;
              return (
                <div key={t.id} className="p-3 hover:bg-white/[0.02] transition-colors">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`text-[9px] font-black px-1.5 py-0.5 rounded uppercase ${t.type === 'buy' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
                        {t.type}
                      </span>
                      <span className="font-bold text-white text-sm">{t.symbol.replace('.NS', '')}</span>
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${t.market === 'IN' ? 'bg-orange-500/10 text-orange-400' : 'bg-blue-500/10 text-blue-400'}`}>
                        {t.market === 'IN' ? 'NSE' : 'US'}
                      </span>
                      <span className="text-[10px] text-slate-500 font-mono">{t.date}</span>
                    </div>
                    {!isEditing && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-slate-300">{t.qty} @ {c}{t.price.toFixed(2)}</span>
                        <span className="text-xs font-mono font-bold text-white">= {c}{t.amount.toFixed(2)}</span>
                        {typeof t.realizedPL === 'number' && (
                          <span className={`text-[10px] font-mono font-bold ${t.realizedPL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            P&L {t.realizedPL >= 0 ? '+' : ''}{c}{t.realizedPL.toFixed(2)}
                          </span>
                        )}
                        <button onClick={() => startEdit(t)} className="px-2 py-1 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20 text-[10px] font-bold text-cyan-400" title="Edit">✏️</button>
                        <button
                          onClick={() => { if (confirm(`Delete this ${t.type} of ${t.symbol.replace('.NS', '')}? (Position holdings stay unchanged.)`)) deleteTransaction(t.id); }}
                          className="px-2 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-[10px] font-bold text-red-400" title="Delete">🗑️</button>
                      </div>
                    )}
                  </div>

                  {isEditing && (
                    <div className="flex flex-wrap items-end gap-2 mt-2">
                      <div className="flex flex-col">
                        <label className="text-[9px] text-slate-500 uppercase font-bold mb-1">Qty</label>
                        <input type="number" value={editQty} onChange={e => setEditQty(e.target.value)} className="quantum-input rounded-lg px-2 py-1 text-xs text-white w-20 bg-slate-900/60" />
                      </div>
                      <div className="flex flex-col">
                        <label className="text-[9px] text-slate-500 uppercase font-bold mb-1">Price</label>
                        <input type="number" value={editPrice} onChange={e => setEditPrice(e.target.value)} className="quantum-input rounded-lg px-2 py-1 text-xs text-white w-24 bg-slate-900/60" />
                      </div>
                      <div className="flex flex-col">
                        <label className="text-[9px] text-slate-500 uppercase font-bold mb-1">Date</label>
                        <input type="date" value={editDate} onChange={e => setEditDate(e.target.value)} className="quantum-input rounded-lg px-2 py-1 text-xs text-slate-300 bg-slate-900/60" />
                      </div>
                      <button onClick={() => saveEdit(t)} className="px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-xs font-bold text-emerald-400">Save</button>
                      <button onClick={() => setEditingId(null)} className="px-3 py-1.5 rounded-lg bg-white/5 text-xs font-bold text-slate-400">Cancel</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-[9px] text-slate-600 mt-2">
            Note: editing/deleting a ledger entry adjusts your reports &amp; analytics. Current portfolio holdings are not recalculated.
          </p>
        </div>
      )}
    </div>
  );
});

export default TransactionHistoryPanel;
