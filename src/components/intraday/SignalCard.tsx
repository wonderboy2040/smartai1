// ============================================================
// intraday/SignalCard — pro-desk signal card (v4 DUAL-AI EXPERT)
// ------------------------------------------------------------
// v4 upgrades:
//   • Signal GRADE badge — A+ (gold glow) / A (silver) / B (watch-only)
//   • Dual confidence ring — quant engine + AI consensus separately
//   • Trade-type badge (SCALP / MOMENTUM / SWING) from AI classification
//   • Entry-quality meter (1-10, AI scored)
//   • Risk↔Reward proportional bars (red vs green)
//   • AI reasoning preview (expandable, Gemini + Groq chains)
//   • Model indicator — which experts verified the setup
// v3 keeps: LIVE LTP, SL↔T2 meter, sector badge, counter-regime
//   warning, no-fresh-entry state, slippage-RR, chart + paper-trade.
// ============================================================
import { memo, useState } from 'react';
import type { IntradaySignal, LiveQuote } from './types';
import { sectorOf } from './sectorMap';

const GRADE_STYLE: Record<string, string> = {
  'A+': 'bg-gradient-to-r from-amber-400/25 to-yellow-500/25 text-amber-300 border border-amber-400/50 shadow-[0_0_12px_rgba(251,191,36,0.35)]',
  'A': 'bg-slate-400/15 text-slate-200 border border-slate-300/40',
  'B': 'bg-white/5 text-slate-500 border border-white/10',
};

function GradeBadge({ grade }: { grade?: string }) {
  if (!grade) return null;
  if (grade === 'B') {
    return (
      <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black font-mono tracking-wider ${GRADE_STYLE.B}`} title="Below A-grade gates — track only, entry not recommended">
        ◔ B · WATCH ONLY
      </span>
    );
  }
  return (
    <span className={`px-2 py-0.5 rounded-lg text-[11px] font-black font-mono tracking-wider ${GRADE_STYLE[grade]}`} title={grade === 'A+' ? 'Highest-probability class: conf ≥88 · RR ≥1.8 · vol ≥1.5x · ADX ≥25 · VWAP+regime aligned' : 'High conviction: conf ≥80 · RR ≥1.5 · vol ≥1.2x'}>
      {grade === 'A+' ? '★ A+ ELITE' : 'A'}
    </span>
  );
}

function TradeTypeBadge({ t }: { t?: string | null }) {
  if (!t) return null;
  const conf = {
    SCALP: 'bg-cyan-500/10 text-cyan-300 border border-cyan-500/25',
    MOMENTUM: 'bg-fuchsia-500/10 text-fuchsia-300 border border-fuchsia-500/25',
    SWING: 'bg-indigo-500/10 text-indigo-300 border border-indigo-500/25',
  }[t] || 'bg-white/5 text-slate-400 border border-white/10';
  const icon = { SCALP: '⚡', MOMENTUM: '🚀', SWING: '🌊' }[t] || '';
  return <span className={`px-1.5 py-0.5 rounded-md text-[9px] font-black font-mono ${conf}`}>{icon} {t}</span>;
}

// Dual ring: outer = final confidence, inner label shows quant engine score.
function ConfidenceRing({ value, quant }: { value: number; quant?: number }) {
  const color = value >= 85 ? 'text-emerald-400' : value >= 75 ? 'text-cyan-400' : 'text-amber-400';
  const stroke = value >= 85 ? '#34d399' : value >= 75 ? '#22d3ee' : '#fbbf24';
  const circ = 2 * Math.PI * 26;
  return (
    <div className="relative w-16 h-16 flex-shrink-0">
      <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64">
        <circle cx="32" cy="32" r="26" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" />
        <circle
          cx="32" cy="32" r="26" fill="none" stroke={stroke} strokeWidth="6"
          strokeLinecap="round" strokeDasharray={circ}
          strokeDashoffset={circ - (circ * Math.min(100, value)) / 100}
          className="transition-all duration-700"
        />
      </svg>
      <div className={`absolute inset-0 flex flex-col items-center justify-center leading-none ${color}`}>
        <span className="text-sm font-black font-mono">{Math.round(value)}%</span>
        {quant != null && (
          <span className="text-[7px] font-mono text-slate-500 mt-0.5" title="Quant engine score (pre-AI)">Q{Math.round(quant)}</span>
        )}
      </div>
    </div>
  );
}

// Entry-quality meter — AI scored 1-10.
function EntryQualityMeter({ q }: { q?: number | null }) {
  if (q == null) return null;
  const pct = Math.max(0, Math.min(100, q * 10));
  const color = q >= 8 ? 'bg-emerald-400' : q >= 6 ? 'bg-cyan-400' : q >= 4 ? 'bg-amber-400' : 'bg-red-400';
  return (
    <div className="flex items-center gap-1.5" title={`AI entry-timing quality: ${q}/10`}>
      <span className="text-[8px] uppercase font-bold text-slate-500 tracking-wider">Entry</span>
      <div className="w-12 h-1.5 rounded-full bg-white/5 overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[9px] font-black font-mono text-slate-300">{q}/10</span>
    </div>
  );
}

// Risk vs Reward proportional bars.
function RiskRewardBars({ s }: { s: IntradaySignal }) {
  const risk = Math.abs(s.entry - s.stopLoss);
  const reward = Math.abs(s.target2 - s.entry);
  const max = Math.max(risk, reward) || 1;
  const rr = (s.effRR ?? s.rr) || s.rr;
  return (
    <div className="flex items-center gap-2 text-[9px] font-mono">
      <div className="flex-1 flex items-center gap-1" title={`Risk: ₹${risk.toFixed(1)}/share`}>
        <span className="text-red-400/80 w-7">RISK</span>
        <div className="flex-1 h-1.5 rounded-full bg-red-500/10 overflow-hidden">
          <div className="h-full bg-gradient-to-r from-red-500/60 to-red-400 rounded-full" style={{ width: `${(risk / max) * 100}%` }} />
        </div>
      </div>
      <span className={`font-black ${rr >= 1.5 ? 'text-emerald-400' : 'text-amber-400'}`} title={`Slippage-adjusted RR 1:${rr.toFixed(2)}`}>
        1:{rr.toFixed(2)}
      </span>
      <div className="flex-1 flex items-center gap-1" title={`Reward (T2): ₹${reward.toFixed(1)}/share`}>
        <div className="flex-1 h-1.5 rounded-full bg-emerald-500/10 overflow-hidden">
          <div className="h-full bg-gradient-to-r from-emerald-400 to-emerald-500/60 rounded-full" style={{ width: `${(reward / max) * 100}%` }} />
        </div>
        <span className="text-emerald-400/80 w-9 text-right">REWARD</span>
      </div>
    </div>
  );
}

// Expandable AI reasoning preview (2-3 lines collapsed).
function AiReasoningPreview({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  const short = text.length > 180 && !open;
  return (
    <button
      onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
      className="w-full text-left rounded-xl bg-purple-500/[0.06] border border-purple-500/15 px-2.5 py-2 space-y-1 hover:bg-purple-500/[0.1] transition-colors"
      title="Gemini + Groq expert reasoning chain — click to expand"
    >
      <div className="flex items-center gap-1.5 text-[9px] uppercase font-bold text-purple-300/80 tracking-wider">
        <span>🧠</span> AI Reasoning Chain {open ? '▾' : '▸'}
      </div>
      <p className={`text-[10px] text-purple-200/80 leading-relaxed font-mono whitespace-pre-line ${short ? 'line-clamp-2' : ''}`}>
        {short ? text.slice(0, 180) + '…' : text}
      </p>
      {short && <span className="text-[8px] text-purple-400/60 font-mono">click for full analysis</span>}
    </button>
  );
}

// SL ←→ T2 progress meter with T1 marker. Uses LIVE price when available.
function ProximityMeter({ s, live }: { s: IntradaySignal; live?: LiveQuote }) {
  const price = live?.price ?? s.ltp;
  const lo = Math.min(s.stopLoss, s.target2);
  const hi = Math.max(s.stopLoss, s.target2);
  const span = hi - lo;
  if (!(span > 0)) return null;
  const pct = Math.max(2, Math.min(98, ((price - lo) / span) * 100));
  const t1Pct = Math.max(2, Math.min(98, ((s.target1 - lo) / span) * 100));
  const zone = pct < 25 ? 'risk' : pct < t1Pct ? 'mid' : 'reward';
  const zoneColor = zone === 'risk' ? 'bg-red-400' : zone === 'mid' ? 'bg-cyan-400' : 'bg-emerald-400';
  const distT1 = ((s.target1 - price) / price) * 100;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[8px] font-mono text-slate-500">
        <span>SL {s.stopLoss.toFixed(1)}</span>
        <span className={zone === 'reward' ? 'text-emerald-400' : 'text-slate-400'}>
          {zone === 'reward' ? 'TARGET ZONE' : `T1 ${Math.abs(distT1).toFixed(1)}% ${distT1 >= 0 ? 'away' : 'passed'}`}
        </span>
        <span>T2 {s.target2.toFixed(1)}</span>
      </div>
      <div className="relative h-1.5 rounded-full bg-gradient-to-r from-red-500/25 via-slate-700/40 to-emerald-500/25 overflow-visible">
        {/* T1 marker */}
        <div className="absolute top-[-2px] w-0.5 h-2.5 bg-emerald-500/60" style={{ left: `${t1Pct}%` }} />
        {/* live price puck */}
        <div
          className={`absolute top-[-2.5px] w-3 h-3 rounded-full ${zoneColor} shadow-[0_0_8px_rgba(34,211,238,0.5)] border border-black/40 transition-all duration-700`}
          style={{ left: `calc(${pct}% - 6px)` }}
        />
      </div>
    </div>
  );
}

interface SignalCardProps {
  s: IntradaySignal;
  live?: LiveQuote;
  freshEntriesAllowed: boolean;
  paperOpenForSymbol: boolean;
  onChart: (s: IntradaySignal) => void;
  onPaper: (s: IntradaySignal) => void;
  onDetail?: (s: IntradaySignal) => void;
}

export const SignalCard = memo(function SignalCard({
  s, live, freshEntriesAllowed, paperOpenForSymbol, onChart, onPaper, onDetail,
}: SignalCardProps) {
  const long = s.direction === 'LONG';
  const risk = Math.abs(s.entry - s.stopLoss);
  const reward1 = Math.abs(s.target1 - s.entry);
  const reward2 = Math.abs(s.target2 - s.entry);
  const sector = sectorOf(s.symbol);
  const isB = s.grade === 'B';

  const livePrice = live?.price;
  const priceUp = livePrice != null && livePrice > s.ltp;
  const priceDown = livePrice != null && livePrice < s.ltp;
  const noFresh = !freshEntriesAllowed || s.freshEntriesAllowed === false;

  return (
    <div className={`quantum-panel rounded-2xl p-4 border ${long ? 'border-emerald-500/25 bg-gradient-to-b from-emerald-500/[0.04] to-transparent' : 'border-red-500/25 bg-gradient-to-b from-red-500/[0.04] to-transparent'} ${isB ? 'opacity-75' : ''} relative overflow-hidden flex flex-col justify-between gap-3 shadow-lg shadow-black/20`}>
      <div className={`absolute top-0 left-0 right-0 h-1 ${long ? 'bg-gradient-to-r from-emerald-400 via-teal-400 to-transparent' : 'bg-gradient-to-r from-red-400 via-rose-400 to-transparent'}`} />

      {/* Header Row */}
      <div>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <GradeBadge grade={s.grade} />
              <span className="text-lg font-black text-white tracking-wide">{s.symbol}</span>
              {s.exchange && (
                <span className={`px-1.5 py-0.5 rounded-md text-[9px] font-black font-mono border ${s.exchange === 'BSE' ? 'bg-amber-500/10 text-amber-300 border-amber-500/25' : 'bg-sky-500/10 text-sky-300 border-sky-500/25'}`}>
                  {s.exchange}
                </span>
              )}
              <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black font-mono tracking-wider ${long ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/35' : 'bg-red-500/20 text-red-300 border border-red-500/35'}`}>
                {long ? '🟢 LONG BUY' : '🔴 SHORT SELL'}
              </span>
              <TradeTypeBadge t={s.tradeType} />
              {s.trendStrength && (
                <span className={`px-1.5 py-0.5 rounded-md text-[9px] font-bold font-mono ${s.trendStrength === 'STRONG' ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30' : 'bg-white/5 text-slate-400 border border-white/10'}`}>
                  ⚡ {s.trendStrength}
                </span>
              )}
              <span className="px-1.5 py-0.5 rounded-md text-[9px] font-bold font-mono bg-slate-800/60 text-slate-400 border border-slate-700/40" title={`Sector: ${sector}`}>
                {sector}
              </span>
              {s.counterTrend && (
                <span className="px-1.5 py-0.5 rounded-md text-[9px] font-bold font-mono bg-orange-500/15 text-orange-300 border border-orange-500/30" title="NIFTY regime ke against setup — confidence penalty applied">
                  ⚠ Counter-regime
                </span>
              )}
            </div>
            <div className="flex items-baseline gap-2 mt-1.5">
              <span className={`text-2xl font-black font-mono transition-colors duration-300 ${priceUp ? 'text-emerald-300' : priceDown ? 'text-red-300' : 'text-cyan-300'}`}>
                ₹{(livePrice ?? s.ltp).toFixed(2)}
              </span>
              {livePrice != null && (
                <span className="text-[9px] font-mono text-cyan-500/80 animate-pulse">● LIVE</span>
              )}
              <span className={`text-xs font-black font-mono ${(live?.change ?? s.changePct) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {(live?.change ?? s.changePct) >= 0 ? '+' : ''}{(live?.change ?? s.changePct).toFixed(2)}%
              </span>
              {s.gapPct != null && Math.abs(s.gapPct) >= 0.2 && (
                <span className="text-[10px] font-mono text-slate-400 bg-white/5 px-1.5 py-0.5 rounded">
                  Gap {s.gapPct >= 0 ? '+' : ''}{s.gapPct.toFixed(1)}%
                </span>
              )}
            </div>
          </div>
          <ConfidenceRing value={s.confidence} quant={s.quantConfidence} />
        </div>

        {/* AI & Market Phase Badges */}
        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
          {s.aiConfidence != null && (
            <span className="px-2 py-0.5 rounded-md text-[9px] font-bold bg-purple-500/15 text-purple-300 border border-purple-500/30 flex items-center gap-1">
              <span>🤖</span>
              {s.aiModel?.includes('+')
                ? <span title={`Experts: ${s.aiModel}`}>🧠 GEMINI + ⚡ GROQ CONSENSUS</span>
                : <span>MCP AI {s.aiModel || 'EXPERT'} VERIFIED</span>}
            </span>
          )}
          {s.aiAdjustedSL != null && (
            <span className="px-1.5 py-0.5 rounded-md text-[9px] font-bold font-mono bg-teal-500/10 text-teal-300 border border-teal-500/25" title="AI suggested a tighter structural stop — levels rebuilt on the new risk">
              ✂ AI-TIGHT SL ₹{s.aiAdjustedSL.toFixed(1)}
            </span>
          )}
          {s.marketPhase === 'early' && (
            <span className="px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-amber-500/10 text-amber-300 border border-amber-500/20">
              ⚡ Early Range
            </span>
          )}
          {s.marketPhase === 'power-hour' && (
            <span className="px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-rose-500/10 text-rose-300 border border-rose-500/20">
              🔥 Power Hour
            </span>
          )}
          {noFresh && (
            <span className="px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-red-500/15 text-red-300 border border-red-500/30 animate-pulse">
              ⛔ NO FRESH ENTRY
            </span>
          )}
        </div>
      </div>

      {/* Pro Execution Grid: Entry Zone, SL, T1, T2 */}
      <div className="space-y-2">
        <div className="grid grid-cols-4 gap-1.5">
          <div className="rounded-xl bg-white/[0.04] border border-white/5 px-2 py-2 text-center">
            <div className="text-[8px] uppercase font-bold text-slate-400 tracking-wider">Entry Trig</div>
            <div className="text-xs font-black font-mono text-cyan-200">₹{s.entry.toFixed(2)}</div>
            {s.entryZoneLow && s.entryZoneHigh && (
              <div className="text-[8px] font-mono text-slate-500 mt-0.5">
                {s.entryZoneLow.toFixed(1)}–{s.entryZoneHigh.toFixed(1)}
              </div>
            )}
          </div>
          <div className="rounded-xl bg-red-500/[0.08] border border-red-500/20 px-2 py-2 text-center">
            <div className="text-[8px] uppercase font-bold text-red-400/80 tracking-wider">Stop Loss</div>
            <div className="text-xs font-black font-mono text-red-400">₹{s.stopLoss.toFixed(2)}</div>
            <div className="text-[8px] font-mono text-red-400/70 mt-0.5">-₹{risk.toFixed(1)}</div>
          </div>
          <div className="rounded-xl bg-emerald-500/[0.08] border border-emerald-500/20 px-2 py-2 text-center">
            <div className="text-[8px] uppercase font-bold text-emerald-400/80 tracking-wider">Target 1 (1.6R)</div>
            <div className="text-xs font-black font-mono text-emerald-400">₹{s.target1.toFixed(2)}</div>
            <div className="text-[8px] font-mono text-emerald-400/70 mt-0.5">+₹{reward1.toFixed(1)}</div>
          </div>
          <div className="rounded-xl bg-emerald-500/[0.12] border border-emerald-500/30 px-2 py-2 text-center">
            <div className="text-[8px] uppercase font-bold text-emerald-300/80 tracking-wider">Target 2 (2.6R)</div>
            <div className="text-xs font-black font-mono text-emerald-300">₹{s.target2.toFixed(2)}</div>
            <div className="text-[8px] font-mono text-emerald-300/70 mt-0.5">+₹{reward2.toFixed(1)}</div>
          </div>
        </div>

        {/* SL↔T2 live proximity meter */}
        <ProximityMeter s={s} live={live} />

        {/* v4: Entry quality meter + risk↔reward bars */}
        <div className="space-y-1.5">
          <EntryQualityMeter q={s.entryQuality} />
          <RiskRewardBars s={s} />
        </div>

        {/* v4: AI reasoning chain preview */}
        <AiReasoningPreview text={s.aiReasoning || ''} />

        {/* Position Sizing & Trailing SL Box */}
        <div className="rounded-xl bg-black/40 border border-white/5 p-2.5 space-y-1.5 text-[10px] font-mono">
          <div className="flex items-center justify-between text-slate-300">
            <span className="text-slate-400">💼 Position Sizing (₹1L Cap):</span>
            <b className="text-cyan-300 font-bold">{s.qtyPerLakh ? `${s.qtyPerLakh} shares` : '—'} (1% Max Risk)</b>
          </div>
          <div className="flex items-center justify-between text-slate-300">
            <span className="text-slate-400">🛡️ Trailing SL Rule:</span>
            <span className="text-emerald-300">Once T1 hit → Trail SL to ₹{s.trailAfterT1 ?? s.entry.toFixed(2)} (Breakeven)</span>
          </div>
          {s.slippage != null && s.slippage > 0 && (
            <div className="flex items-center justify-between text-slate-400 border-t border-white/5 pt-1.5">
              <span className="text-slate-500">⚙ Slippage model (±7bps/side):</span>
              <span>±₹{s.slippage.toFixed(2)}/share • Net RR 1:{(s.effRR ?? s.rr).toFixed(2)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Technical Confluence Strip */}
      <div className="flex items-center gap-1.5 text-[10px] font-mono text-slate-400 flex-wrap bg-white/[0.02] p-2 rounded-xl border border-white/5">
        <span>RR <b className="text-slate-200">1:{s.rr.toFixed(2)}</b></span>
        <span>•</span>
        <span>VWAP <b className="text-slate-200">₹{s.vwap.toFixed(1)}</b> {s.vwapDist != null && <span className={s.vwapDist >= 0 ? 'text-emerald-400' : 'text-red-400'}>({s.vwapDist >= 0 ? '+' : ''}{s.vwapDist.toFixed(1)}%)</span>}</span>
        <span>•</span>
        <span>RSI <b className={s.rsi > 70 ? 'text-red-400' : s.rsi < 30 ? 'text-emerald-400' : 'text-slate-200'}>{Math.round(s.rsi)}</b></span>
        <span>•</span>
        {s.adx != null && (
          <>
            <span>ADX <b className={s.adx >= 25 ? 'text-amber-300' : 'text-slate-200'}>{Math.round(s.adx)}</b></span>
            <span>•</span>
          </>
        )}
        <span>Vol <b className={s.volumeRatio >= 1.4 ? 'text-amber-400' : 'text-slate-200'}>{s.volumeRatio.toFixed(1)}x</b></span>
        <span>•</span>
        <span>ATR <b className="text-slate-200">₹{s.atr.toFixed(1)}</b></span>
        {s.orbMode && (
          <>
            <span>•</span>
            <span title={s.orbMode === 'LIVE' ? '09:15–09:45 opening range — exact' : 'ATR-proxy band around day open — approximate'}>
              ORB-15 <b className={s.orbMode === 'LIVE' ? 'text-cyan-300' : 'text-slate-500'}>{s.orbMode}</b>
            </span>
          </>
        )}
      </div>

      {/* Reasons & Strategy Tags */}
      <div className="flex flex-wrap gap-1">
        {s.reasons.slice(0, 4).map((r, i) => (
          <span key={i} className="px-1.5 py-0.5 rounded-md bg-cyan-500/[0.07] border border-cyan-500/15 text-cyan-300/90 text-[9px] font-semibold">
            {r}
          </span>
        ))}
        {s.aiNote && (
          <span className="px-1.5 py-0.5 rounded-md bg-purple-500/[0.08] border border-purple-500/20 text-purple-300 text-[9px] font-semibold">
            AI: {s.aiNote}
          </span>
        )}
        <span className="px-1.5 py-0.5 rounded-md bg-slate-800/60 border border-slate-700/40 text-slate-400 text-[9px] font-mono ml-auto">
          ⏰ Sq-Off: {s.sqOffBy || '15:10 IST'}
        </span>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => onChart(s)}
          className="flex-1 quantum-btn-ghost py-1.5 rounded-xl text-[10px] font-black font-mono flex items-center justify-center gap-1.5"
          title="Live 5-min chart with Entry/SL/T1/T2 overlays"
        >
          📊 CHART
        </button>
        {onDetail && (
          <button
            onClick={() => onDetail(s)}
            className="flex-1 py-1.5 rounded-xl text-[10px] font-black font-mono flex items-center justify-center gap-1.5 border bg-purple-500/10 border-purple-500/30 text-purple-300 hover:bg-purple-500/20 transition-all"
            title="Full Gemini + Groq dual-expert analysis"
          >
            🧠 AI ANALYSIS
          </button>
        )}
        <button
          onClick={() => onPaper(s)}
          disabled={paperOpenForSymbol || noFresh || isB}
          className={`flex-1 py-1.5 rounded-xl text-[10px] font-black font-mono flex items-center justify-center gap-1.5 border transition-all disabled:opacity-40 ${paperOpenForSymbol
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
            : 'bg-purple-500/10 border-purple-500/30 text-purple-300 hover:bg-purple-500/20'}`}
          title={paperOpenForSymbol ? 'Virtual trade already open' : isB ? 'B-grade = WATCH ONLY — entries not recommended' : noFresh ? 'Fresh entries blocked after 15:00 IST' : 'Open a virtual (paper) trade with these levels'}
        >
          {paperOpenForSymbol ? '✓ PAPER OPEN' : '📈 PAPER TRADE'}
        </button>
      </div>
    </div>
  );
});
