// ============================================================
// intraday/SignalTable — pro-desk dense table view (v4)
// ------------------------------------------------------------
// TradingView-style sortable grid for traders who prefer density
// over cards. Click any header to sort; click a row to open the
// live chart modal.
// ============================================================
import { useMemo, useState } from 'react';
import type { IntradaySignal, LiveQuote } from './types';
import { sectorOf } from './sectorMap';

type SortKey = 'symbol' | 'confidence' | 'ltp' | 'changePct' | 'rr' | 'volumeRatio' | 'rsi' | 'adx';

const COLUMNS: { key: SortKey | null; label: string; align?: string; title?: string }[] = [
  { key: 'symbol', label: 'Symbol', align: 'text-left' },
  { key: null, label: 'Grade', title: 'Signal quality grade (A+/A/B)' },
  { key: null, label: 'Dir' },
  { key: null, label: 'Type', title: 'Trade type (SCALP/MOMENTUM/SWING)' },
  { key: 'ltp', label: 'LTP ▉', title: 'Live price (SSE stream)' },
  { key: 'changePct', label: 'Chg%' },
  { key: 'confidence', label: 'Conf' },
  { key: null, label: 'Entry' },
  { key: null, label: 'SL' },
  { key: null, label: 'T1' },
  { key: null, label: 'T2' },
  { key: 'rr', label: 'RR' },
  { key: 'volumeRatio', label: 'Vol' },
  { key: 'rsi', label: 'RSI' },
  { key: 'adx', label: 'ADX' },
  { key: null, label: 'Sector' },
  { key: null, label: '' },
];

interface SignalTableProps {
  signals: IntradaySignal[];
  livePrices: Record<string, LiveQuote>;
  freshEntriesAllowed: boolean;
  onChart: (s: IntradaySignal) => void;
  onPaper: (s: IntradaySignal) => void;
}

export function SignalTable({ signals, livePrices, freshEntriesAllowed, onChart, onPaper }: SignalTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('confidence');
  const [sortAsc, setSortAsc] = useState(false);

  const sorted = useMemo(() => {
    const arr = [...signals];
    arr.sort((a, b) => {
      let va: number | string, vb: number | string;
      if (sortKey === 'ltp') {
        va = livePrices[a.symbol]?.price ?? a.ltp;
        vb = livePrices[b.symbol]?.price ?? b.ltp;
      } else {
        va = a[sortKey] ?? 0; vb = b[sortKey] ?? 0;
      }
      const cmp = typeof va === 'string' ? String(va).localeCompare(String(vb)) : (va as number) - (vb as number);
      return sortAsc ? cmp : -cmp;
    });
    return arr;
  }, [signals, sortKey, sortAsc, livePrices]);

  const toggleSort = (key: SortKey | null) => {
    if (!key) return;
    if (key === sortKey) setSortAsc(a => !a);
    else { setSortKey(key); setSortAsc(false); }
  };

  return (
    <div className="quantum-panel rounded-2xl border border-white/5 overflow-x-auto">
      <table className="w-full text-[11px] font-mono">
        <thead>
          <tr className="border-b border-white/10 bg-black/30">
            {COLUMNS.map((c, i) => (
              <th
                key={i}
                onClick={() => toggleSort(c.key)}
                className={`px-2.5 py-2 uppercase tracking-wider text-[9px] font-bold text-slate-400 whitespace-nowrap ${c.align || 'text-center'} ${c.key ? 'cursor-pointer hover:text-cyan-300 select-none' : ''}`}
                title={c.title}
              >
                {c.label}
                {c.key && sortKey === c.key && <span className="text-cyan-400 ml-0.5">{sortAsc ? '▲' : '▼'}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map(s => {
            const live = livePrices[s.symbol];
            const ltp = live?.price ?? s.ltp;
            const chg = live?.change ?? s.changePct;
            const long = s.direction === 'LONG';
            const noFresh = !freshEntriesAllowed || s.freshEntriesAllowed === false;
            const gradeConf = {
              'A+': 'text-amber-300 font-black',
              'A': 'text-slate-200 font-bold',
              'B': 'text-slate-500',
            }[s.grade || 'B'] || 'text-slate-500';
            const typeIcon = { SCALP: '⚡', MOMENTUM: '🚀', SWING: '🌊' }[s.tradeType || ''] || '';
            return (
              <tr
                key={s.symbol}
                className={`border-b border-white/5 hover:bg-white/[0.03] transition-colors cursor-pointer ${s.grade === 'B' ? 'opacity-60' : ''}`}
                onClick={() => onChart(s)}
              >
                <td className="px-2.5 py-2 text-left">
                  <span className="font-black text-white">{s.symbol}</span>
                  {s.exchange && <span className="ml-1 text-[8px] text-sky-400">{s.exchange}</span>}
                  {s.counterTrend && <span className="ml-1 text-[9px]" title="Counter-regime">⚠</span>}
                </td>
                <td className="px-2.5 py-2 text-center">
                  <span className={`px-1.5 py-0.5 rounded text-[9px] ${gradeConf}`}>
                    {s.grade === 'A+' ? '⭐A+' : s.grade || 'B'}
                  </span>
                </td>
                <td className="px-2.5 py-2 text-center">
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-black ${long ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300'}`}>
                    {long ? 'L' : 'S'}
                  </span>
                  {noFresh && <span className="ml-1 text-red-400" title="No fresh entry after 15:00">⛔</span>}
                </td>
                <td className="px-2.5 py-2 text-center text-[9px] text-slate-400">
                  {typeIcon} {s.tradeType || '—'}
                </td>
                <td className={`px-2.5 py-2 text-center font-bold ${live ? 'text-cyan-200' : 'text-slate-200'}`}>
                  ₹{ltp.toFixed(2)}
                  {live && <span className="ml-0.5 text-[7px] text-cyan-500 animate-pulse">●</span>}
                </td>
                <td className={`px-2.5 py-2 text-center font-bold ${chg >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {chg >= 0 ? '+' : ''}{chg.toFixed(2)}%
                </td>
                <td className="px-2.5 py-2 text-center">
                  <div className="flex items-center gap-1.5 justify-center">
                    <div className="w-10 h-1.5 rounded-full bg-white/10 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${s.confidence >= 85 ? 'bg-emerald-400' : s.confidence >= 75 ? 'bg-cyan-400' : 'bg-amber-400'}`}
                        style={{ width: `${Math.min(100, s.confidence)}%` }}
                      />
                    </div>
                    <b className={s.confidence >= 85 ? 'text-emerald-300' : s.confidence >= 75 ? 'text-cyan-300' : 'text-amber-300'}>
                      {s.confidence}
                    </b>
                  </div>
                </td>
                <td className="px-2.5 py-2 text-center text-cyan-200">₹{s.entry.toFixed(1)}</td>
                <td className="px-2.5 py-2 text-center text-red-400">₹{s.stopLoss.toFixed(1)}</td>
                <td className="px-2.5 py-2 text-center text-emerald-400">₹{s.target1.toFixed(1)}</td>
                <td className="px-2.5 py-2 text-center text-emerald-300">₹{s.target2.toFixed(1)}</td>
                <td className="px-2.5 py-2 text-center text-slate-300">1:{s.rr.toFixed(2)}</td>
                <td className={`px-2.5 py-2 text-center ${s.volumeRatio >= 1.4 ? 'text-amber-400 font-bold' : 'text-slate-400'}`}>
                  {s.volumeRatio.toFixed(1)}x
                </td>
                <td className={`px-2.5 py-2 text-center ${s.rsi > 70 ? 'text-red-400' : s.rsi < 30 ? 'text-emerald-400' : 'text-slate-400'}`}>
                  {Math.round(s.rsi)}
                </td>
                <td className={`px-2.5 py-2 text-center ${(s.adx ?? 0) >= 25 ? 'text-amber-300' : 'text-slate-400'}`}>
                  {s.adx != null ? Math.round(s.adx) : '—'}
                </td>
                <td className="px-2.5 py-2 text-center text-slate-500 text-[9px]">{sectorOf(s.symbol)}</td>
                <td className="px-2.5 py-2 text-center">
                  <button
                    onClick={(e) => { e.stopPropagation(); onPaper(s); }}
                    disabled={noFresh}
                    className="px-1.5 py-0.5 rounded text-[9px] font-black bg-purple-500/10 border border-purple-500/30 text-purple-300 hover:bg-purple-500/20 disabled:opacity-40"
                    title="Open virtual trade"
                  >
                    📈
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
