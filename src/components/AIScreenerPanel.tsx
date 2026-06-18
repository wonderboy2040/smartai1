import React, { useMemo, useState, useCallback } from 'react';
import { Position, PriceData } from '../types';
import { runAdvancedScreener, ScreenerFilters, DEFAULT_FILTERS, SECTORS, getFilterSummary, ScreenerResultEx } from '../utils/advancedScreener';
import { sendTelegramAlert } from '../utils/api';
import { secureStorage } from '../utils/secureStorage';

interface AIScreenerPanelProps {
  portfolio: Position[];
  livePrices: Record<string, PriceData>;
}

const signalColors: Record<string, string> = {
  STRONG_BUY: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
  BUY: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30',
  HOLD: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
  AVOID: 'text-red-400 bg-red-500/10 border-red-500/30',
};

const sectorColors: Record<string, string> = {
  Technology: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
  Finance: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
  Healthcare: 'bg-pink-500/15 text-pink-400 border-pink-500/20',
  Energy: 'bg-orange-500/15 text-orange-400 border-orange-500/20',
  Consumer: 'bg-purple-500/15 text-purple-400 border-purple-500/20',
  Industrial: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/20',
  ETF: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
  Crypto: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/20',
};

function scoreColor(s: number): string {
  if (s >= 75) return 'text-emerald-400';
  if (s >= 55) return 'text-cyan-400';
  if (s >= 35) return 'text-amber-400';
  return 'text-red-400';
}

export const AIScreenerPanel = React.memo(({ portfolio, livePrices }: AIScreenerPanelProps) => {
  const [filters, setFilters] = useState<ScreenerFilters>(DEFAULT_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [sending, setSending] = useState(false);

  const results = useMemo(() => {
    return runAdvancedScreener(portfolio, livePrices, filters);
  }, [portfolio, livePrices, filters]);

  const displayed = useMemo(() => {
    return showAll ? results : results.slice(0, 12);
  }, [results, showAll]);

  const counts = useMemo(() => ({
    total: results.length,
    STRONG_BUY: results.filter(r => r.signal === 'STRONG_BUY').length,
    BUY: results.filter(r => r.signal === 'BUY').length,
    HOLD: results.filter(r => r.signal === 'HOLD').length,
    AVOID: results.filter(r => r.signal === 'AVOID').length,
  }), [results]);

  const updateFilter = useCallback(<K extends keyof ScreenerFilters>(key: K, value: ScreenerFilters[K]) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  }, []);

  const resetFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
  }, []);

  const sendToTelegram = useCallback(async () => {
    setSending(true);
    try {
      const token = await secureStorage.getItemAsync('TG_TOKEN');
      const chatId = await secureStorage.getItemAsync('TG_CHAT_ID');
      if (!token || !chatId) {
        alert('Telegram credentials not configured');
        return;
      }
      const lines = results.slice(0, 20).map(r => {
        const cur = r.market === 'IN' ? '₹' : '$';
        return `${r.signal === 'STRONG_BUY' ? '🟢' : r.signal === 'BUY' ? '🔵' : r.signal === 'HOLD' ? '🟡' : '🔴'} <b>${r.symbol}</b> — ${r.name}\nScore: ${r.alphaScore}/100 | Q:${r.qualityScore} M:${r.momentumScore} V:${r.valueScore}\n${cur}${r.price.toFixed(2)} | RSI: ${r.rsi.toFixed(0)} | CAGR: ${r.cagr}% | ${r.sector}\n${r.reason}\n`;
      }).join('\n');

      const msg = `<b>📊 AI STOCK SCREENER</b>\n━━━━━━━━━━━━━━━━━━━━━━━\n<i>${getFilterSummary(filters)}</i>\n\n${lines}\n━━━━━━━━━━━━━━━━━━━━━━━\n<i>Powered by Deep Mind AI</i>`;

      await sendTelegramAlert(token, chatId, msg);
      alert('Sent to Telegram!');
    } catch (e) {
      console.error('Telegram send error:', e);
    } finally {
      setSending(false);
    }
  }, [results, filters]);

  if (portfolio.length === 0) return null;

  return (
    <div className="quantum-panel p-4 mb-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-h2 text-on-surface flex items-center gap-2">
            <span>🤖</span> AI STOCK SCREENER
          </h3>
          <div className="text-[10px] text-slate-500 mt-0.5">{getFilterSummary(filters)}</div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`quantum-btn-ghost px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5 ${showFilters ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30' : ''}`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
            Filters
          </button>
          <button
            onClick={sendToTelegram}
            disabled={sending}
            className="quantum-btn-ghost px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5 text-emerald-400 hover:bg-emerald-500/10"
          >
            📱 {sending ? 'Sending...' : 'Telegram'}
          </button>
        </div>
      </div>

      {/* Filter Panel */}
      {showFilters && (
        <div className="mb-3 p-3 bg-black/30 rounded-xl border border-white/5 space-y-3 animate-fade-in">
          {/* Row 1: Market + Signal + Sector */}
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[9px] text-slate-500 font-bold uppercase block mb-1">Market</label>
              <select
                value={filters.market}
                onChange={e => updateFilter('market', e.target.value as ScreenerFilters['market'])}
                className="w-full bg-slate-800/50 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white"
              >
                <option value="ALL">All Markets</option>
                <option value="IN">🇮🇳 India</option>
                <option value="US">🇺🇸 US</option>
              </select>
            </div>
            <div>
              <label className="text-[9px] text-slate-500 font-bold uppercase block mb-1">Signal</label>
              <select
                value={filters.signal}
                onChange={e => updateFilter('signal', e.target.value as ScreenerFilters['signal'])}
                className="w-full bg-slate-800/50 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white"
              >
                <option value="ALL">All Signals</option>
                <option value="STRONG_BUY">🟢 Strong Buy</option>
                <option value="BUY">🔵 Buy</option>
                <option value="HOLD">🟡 Hold</option>
                <option value="AVOID">🔴 Avoid</option>
              </select>
            </div>
            <div>
              <label className="text-[9px] text-slate-500 font-bold uppercase block mb-1">Sector</label>
              <select
                value={filters.sector}
                onChange={e => updateFilter('sector', e.target.value)}
                className="w-full bg-slate-800/50 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white"
              >
                {SECTORS.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Row 2: RSI Range */}
          <div>
            <label className="text-[9px] text-slate-500 font-bold uppercase block mb-1">
              RSI Range: <span className="text-cyan-400">{filters.rsiMin} — {filters.rsiMax}</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                type="range" min={0} max={100} value={filters.rsiMin}
                onChange={e => updateFilter('rsiMin', +e.target.value)}
                className="flex-1 accent-cyan-500"
              />
              <input
                type="range" min={0} max={100} value={filters.rsiMax}
                onChange={e => updateFilter('rsiMax', +e.target.value)}
                className="flex-1 accent-cyan-500"
              />
            </div>
          </div>

          {/* Row 3: Change % Range */}
          <div>
            <label className="text-[9px] text-slate-500 font-bold uppercase block mb-1">
              Change %: <span className="text-cyan-400">{filters.changeMin}% — {filters.changeMax}%</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                type="range" min={-50} max={50} value={filters.changeMin}
                onChange={e => updateFilter('changeMin', +e.target.value)}
                className="flex-1 accent-cyan-500"
              />
              <input
                type="range" min={-50} max={50} value={filters.changeMax}
                onChange={e => updateFilter('changeMax', +e.target.value)}
                className="flex-1 accent-cyan-500"
              />
            </div>
          </div>

          {/* Row 4: Sort */}
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <label className="text-[9px] text-slate-500 font-bold uppercase block mb-1">Sort By</label>
              <select
                value={filters.sortBy}
                onChange={e => updateFilter('sortBy', e.target.value as ScreenerFilters['sortBy'])}
                className="w-full bg-slate-800/50 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white"
              >
                <option value="alphaScore">Alpha Score</option>
                <option value="qualityScore">Quality Score</option>
                <option value="momentumScore">Momentum Score</option>
                <option value="valueScore">Value Score</option>
                <option value="rsi">RSI</option>
                <option value="cagr">CAGR</option>
                <option value="change">Change %</option>
                <option value="price">Price</option>
              </select>
            </div>
            <button
              onClick={() => updateFilter('sortOrder', filters.sortOrder === 'desc' ? 'asc' : 'desc')}
              className="quantum-btn-ghost px-3 py-1.5 rounded-lg text-xs mt-5"
            >
              {filters.sortOrder === 'desc' ? '↓ Desc' : '↑ Asc'}
            </button>
            <button
              onClick={resetFilters}
              className="quantum-btn-ghost px-3 py-1.5 rounded-lg text-xs text-red-400 hover:bg-red-500/10 mt-5"
            >
              Reset
            </button>
          </div>
        </div>
      )}

      {/* Signal Counts */}
      <div className="flex gap-1.5 mb-3">
        {(['STRONG_BUY', 'BUY', 'HOLD', 'AVOID'] as const).map(sig => (
          <button
            key={sig}
            onClick={() => updateFilter('signal', filters.signal === sig ? 'ALL' : sig)}
            className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-all ${
              filters.signal === sig
                ? signalColors[sig]
                : 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/10'
            }`}
          >
            {sig.replace('_', ' ')} ({counts[sig]})
          </button>
        ))}
      </div>

      {/* Results */}
      <div className="space-y-1.5">
        {displayed.map(r => (
          <ScreenerRow key={r.symbol} r={r} />
        ))}
      </div>

      {/* Show More */}
      {results.length > 12 && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="w-full mt-2 text-xs text-cyan-400 hover:text-cyan-300 py-1"
        >
          {showAll ? 'Show Less' : `Show All ${results.length} Results`}
        </button>
      )}

      {/* Legend */}
      <div className="mt-2 pt-2 border-t border-slate-700/50 flex flex-wrap items-center gap-3 text-[9px] text-slate-500">
        <span><span className="text-purple-400">Q</span> Quality (CAGR, DD)</span>
        <span><span className="text-cyan-400">M</span> Momentum (RSI, SMA)</span>
        <span><span className="text-amber-400">V</span> Value (PEG, Discount)</span>
        <span>Alpha = 40%Q + 30%M + 30%V</span>
      </div>
    </div>
  );
});

AIScreenerPanel.displayName = 'AIScreenerPanel';

// ========================================
// Screener Row Component
// ========================================
const ScreenerRow = React.memo(function ScreenerRow({ r }: { r: ScreenerResultEx }) {
  const cur = r.market === 'IN' ? '₹' : '$';
  const sectorCls = sectorColors[r.sector] || 'bg-slate-500/15 text-slate-400 border-slate-500/20';

  return (
    <div className="flex items-center gap-2 quantum-stat px-3 py-2 hover:bg-white/[0.02] transition-colors">
      {/* Symbol + Signal + Sector */}
      <div className="w-32">
        <div className="text-xs font-medium text-slate-200 truncate">{r.symbol}</div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className={`text-[9px] font-bold ${signalColors[r.signal]?.split(' ')[0]}`}>
            {r.signal.replace('_', ' ')}
          </span>
          <span className={`text-[8px] px-1.5 py-0.5 rounded border ${sectorCls}`}>
            {r.sector}
          </span>
        </div>
      </div>

      {/* Alpha Score */}
      <div className="w-12 text-center">
        <div className={`text-lg font-black font-mono ${scoreColor(r.alphaScore)}`}>{r.alphaScore}</div>
        <div className="text-[8px] text-slate-600">ALPHA</div>
      </div>

      {/* Factor Bars */}
      <div className="flex-1 grid grid-cols-3 gap-1.5">
        <FactorBar label="Q" value={r.qualityScore} color="bg-purple-500" />
        <FactorBar label="M" value={r.momentumScore} color="bg-cyan-500" />
        <FactorBar label="V" value={r.valueScore} color="bg-amber-500" />
      </div>

      {/* Key Metrics */}
      <div className="w-28 text-right">
        <div className="text-[10px] text-slate-300 font-mono">{cur}{r.price.toFixed(2)}</div>
        <div className="text-[9px] text-slate-500">
          RSI:{r.rsi.toFixed(0)} | {r.change >= 0 ? '+' : ''}{r.change.toFixed(1)}%
        </div>
        <div className="text-[8px] text-slate-600">CAGR: {r.cagr}%</div>
      </div>
    </div>
  );
});

function FactorBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div className="flex items-center justify-between text-[8px] mb-0.5">
        <span className="text-slate-500">{label}</span>
        <span className={scoreColor(value)}>{value}</span>
      </div>
      <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}
