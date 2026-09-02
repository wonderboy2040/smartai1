// ============================================================
// intraday/SignalCard — pro-desk signal card (v4)
// ------------------------------------------------------------
// v4 MEGA UPGRADE over v3:
//   • Signal GRADE badge (A+ gold glow, A silver, B dim + WATCH ONLY)
//   • AI Reasoning preview — expandable 2-3 line summary from Gemini+Groq
//   • Trade Type badge — SCALP / MOMENTUM / SWING classification
//   • Entry Quality meter — 1-10 bar showing entry timing quality
//   • Per-model AI indicators — shows Gemini & Groq individual verdicts
//   • Risk factors list — what can go wrong
//   • AI-adjusted levels when models suggest tighter SL/entry
//   • LIVE LTP from the SSE stream (flash tick, 5s cadence)
//   • SL↔T2 proximity meter
//   • Sector badge + counter-regime warning
//   • Slippage-adjusted RR line (±7bps model)
//   • One-click Chart modal + Paper-trade launch
// ============================================================
import { memo, useState } from 'react';
import type { IntradaySignal, LiveQuote } from './types';
import { sectorOf } from './sectorMap';

// v4: Grade badge with distinct styling
function GradeBadge({ grade }: { grade?: string }) {
  if (!grade) return null;
  const conf = {
    'A+': 'bg-gradient-to-r from-amber-500/25 to-yellow-500/25 border-amber-400/50 text-amber-200 shadow-amber-500/20 shadow-lg',
    'A': 'bg-gradient-to-r from-slate-400/15 to-slate-300/15 border-slate-400/40 text-slate-200',
    'B': 'bg-white/5 border-white/15 text-slate-500',
  }[grade] || 'bg-white/5 border-white/15 text-slate-500';
  const label = grade === 'B' ? `${grade} WATCH` : grade;
  return (
    <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black font-mono tracking-wider border ${conf}`}>
      {grade === 'A+' && '⭐ '}{label}
    </span>
  );
}

// v4: Trade type badge
function TradeTypeBadge({ type }: { type?: string | null }) {
  if (!type) return null;
  const conf = {
    SCALP: 'bg-orange-500/10 text-orange-300 border-orange-500/25',
    MOMENTUM: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/25',
    SWING: 'bg-purple-500/10 text-purple-300 border-purple-500/25',
  }[type] || 'bg-white/5 text-slate-400 border-white/10';
  const icon = { SCALP: '⚡', MOMENTUM: '🚀', SWING: '🌊' }[type] || '📊';
  return (
    <span className={`px-1.5 py-0.5 rounded-md text-[9px] font-bold font-mono border ${conf}`}>
      {icon} {type}
    </span>
  );
}

// v4: Entry quality meter (1-10 visual bar)
function EntryQualityMeter({ value }: { value?: number }) {
  if (value == null) return null;
  const pct = Math.max(0, Math.min(100, (value / 10) * 100));
  const color = value >= 8 ? 'bg-emerald-400' : value >= 6 ? 'bg-cyan-400' : value >= 4 ? 'bg-amber-400' : 'bg-red-400';
  const label = value >= 8 ? 'EXCELLENT' : value >= 6 ? 'GOOD' : value >= 4 ? 'FAIR' : 'POOR';
  return (
    <div className="flex items-center gap-2 text-[9px] font-mono">
      <span className="text-slate-500 shrink-0">Entry:</span>
      <div className="flex-1 h-1.5 rounded-full bg-slate-800 overflow-hidden">
        <div
          className={`h-full rounded-full ${color} transition-all duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`font-bold ${value >= 6 ? 'text-emerald-400' : 'text-amber-400'}`}>
        {value}/10 {label}
      </span>
    </div>
  );
}

function ConfidenceRing({ value, quantValue }: { value: number; quantValue?: number }) {
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
      <div className={`absolute inset-0 flex flex-col items-center justify-center ${color}`}>
        <span className="text-sm font-black font-mono">{Math.round(value)}%</span>
        {quantValue != null && quantValue !== value && (
          <span className="text-[7px] font-mono text-slate-500">Q:{quantValue}</span>
        )}
      </div>
    </div>
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
}

export const SignalCard = memo(function SignalCard({
  s, live, freshEntriesAllowed, paperOpenForSymbol, onChart, onPaper,
}: SignalCardProps) {
  const long = s.direction === 'LONG';
  const risk = Math.abs(s.entry - s.stopLoss);
  const reward1 = Math.abs(s.target1 - s.entry);
  const reward2 = Math.abs(s.target2 - s.entry);
  const sector = sectorOf(s.symbol);
  const [showAiDetail, setShowAiDetail] = useState(false);

  const livePrice = live?.price;
  const priceUp = livePrice != null && livePrice > s.ltp;
  const priceDown = livePrice != null && livePrice < s.ltp;
  const noFresh = !freshEntriesAllowed || s.freshEntriesAllowed === false;

  // v4: Grade-based card border styling
  const gradeGlow = s.grade === 'A+'
    ? 'ring-1 ring-amber-400/20 shadow-amber-500/10 shadow-xl'
    : s.grade === 'A' ? 'shadow-lg shadow-black/20' : 'opacity-80';

  return (
    <div className={`quantum-panel rounded-2xl p-4 border ${long ? 'border-emerald-500/25 bg-gradient-to-b from-emerald-500/[0.04] to-transparent' : 'border-red-500/25 bg-gradient-to-b from-red-500/[0.04] to-transparent'} relative overflow-hidden flex flex-col justify-between gap-3 ${gradeGlow}`}>
      <div className={`absolute top-0 left-0 right-0 h-1 ${long ? 'bg-gradient-to-r from-emerald-400 via-teal-400 to-transparent' : 'bg-gradient-to-r from-red-400 via-rose-400 to-transparent'}`} />

      {/* v4: B grade overlay */}
      {s.grade === 'B' && (
        <div className="absolute top-2 right-2 z-10 px-2 py-0.5 rounded-md bg-slate-800/90 border border-slate-600/40 text-[9px] font-black font-mono text-slate-400 animate-pulse">
          👁 WATCH ONLY
        </div>
      )}

      {/* Header Row */}
      <div>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-lg font-black text-white tracking-wide">{s.symbol}</span>
              {/* v4: Grade badge */}
              <GradeBadge grade={s.grade} />
              {s.exchange && (
                <span className={`px-1.5 py-0.5 rounded-md text-[9px] font-black font-mono border ${s.exchange === 'BSE' ? 'bg-amber-500/10 text-amber-300 border-amber-500/25' : 'bg-sky-500/10 text-sky-300 border-sky-500/25'}`}>
                  {s.exchange}
                </span>
              )}
              <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black font-mono tracking-wider ${long ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/35' : 'bg-red-500/20 text-red-300 border border-red-500/35'}`}>
                {long ? '🟢 LONG BUY' : '🔴 SHORT SELL'}
              </span>
              {/* v4: Trade type badge */}
              <TradeTypeBadge type={s.tradeType} />
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
          <ConfidenceRing value={s.confidence} quantValue={s.quantConfidence} />
        </div>

        {/* v4: AI & Model Badges — enhanced with dual-model display */}
        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
          {s.aiConfidence != null && (
            <span className="px-2 py-0.5 rounded-md text-[9px] font-bold bg-purple-500/15 text-purple-300 border border-purple-500/30 flex items-center gap-1">
              <span>🤖</span>
              {s.aiModel?.includes('+')
                ? <>🧠 GEMINI + ⚡ GROQ <b className="text-purple-200 ml-0.5">CONSENSUS</b></>
                : <>AI {s.aiModel?.toUpperCase() || 'MCP'} EXPERT</>
              }
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

      {/* v4: Entry Quality Meter */}
      <EntryQualityMeter value={s.entryQuality} />

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
            {/* v4: AI-adjusted entry indicator */}
            {s.aiAdjustedEntry != null && s.aiAdjustedEntry !== s.entry && (
              <div className="text-[7px] font-mono text-purple-400 mt-0.5" title="AI suggested entry">
                AI: ₹{s.aiAdjustedEntry.toFixed(1)}
              </div>
            )}
          </div>
          <div className="rounded-xl bg-red-500/[0.08] border border-red-500/20 px-2 py-2 text-center">
            <div className="text-[8px] uppercase font-bold text-red-400/80 tracking-wider">Stop Loss</div>
            <div className="text-xs font-black font-mono text-red-400">₹{s.stopLoss.toFixed(2)}</div>
            <div className="text-[8px] font-mono text-red-400/70 mt-0.5">-₹{risk.toFixed(1)}</div>
            {/* v4: AI-adjusted SL indicator */}
            {s.aiAdjustedSL != null && s.aiAdjustedSL !== s.stopLoss && (
              <div className="text-[7px] font-mono text-purple-400 mt-0.5" title="AI suggested SL">
                AI: ₹{s.aiAdjustedSL.toFixed(1)}
              </div>
            )}
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

      {/* v4: AI Reasoning & Risk Factors — expandable section */}
      {(s.aiReasoning || (s.riskFactors && s.riskFactors.length > 0)) && (
        <div>
          <button
            onClick={() => setShowAiDetail(d => !d)}
            className="w-full text-left px-2.5 py-1.5 rounded-xl bg-purple-500/[0.06] border border-purple-500/20 text-[10px] font-mono text-purple-300 hover:bg-purple-500/[0.1] transition-colors flex items-center justify-between"
          >
            <span className="flex items-center gap-1.5">
              🧠 AI Expert Analysis
              {s.geminiVerdict && s.groqVerdict && (
                <span className="text-[8px] text-purple-400/70">
                  (Gemini {s.geminiVerdict.confidence}% + Groq {s.groqVerdict.confidence}%)
                </span>
              )}
            </span>
            <span className={`transition-transform ${showAiDetail ? 'rotate-180' : ''}`}>▼</span>
          </button>
          {showAiDetail && (
            <div className="mt-1.5 px-2.5 py-2 rounded-xl bg-black/50 border border-purple-500/15 space-y-2">
              {/* Per-model verdicts */}
              {(s.geminiVerdict || s.groqVerdict) && (
                <div className="flex gap-2 text-[9px] font-mono">
                  {s.geminiVerdict && (
                    <div className="flex-1 rounded-lg bg-blue-500/[0.06] border border-blue-500/20 p-1.5">
                      <div className="font-bold text-blue-300">🧠 Gemini ({s.geminiVerdict.confidence}%)</div>
                      <div className="text-slate-400 mt-0.5 leading-relaxed">{s.geminiVerdict.note}</div>
                    </div>
                  )}
                  {s.groqVerdict && (
                    <div className="flex-1 rounded-lg bg-green-500/[0.06] border border-green-500/20 p-1.5">
                      <div className="font-bold text-green-300">⚡ Groq ({s.groqVerdict.confidence}%)</div>
                      <div className="text-slate-400 mt-0.5 leading-relaxed">{s.groqVerdict.note}</div>
                    </div>
                  )}
                </div>
              )}

              {/* AI reasoning chain */}
              {s.aiReasoning && (
                <div className="text-[9px] font-mono text-slate-400 leading-relaxed border-t border-white/5 pt-1.5">
                  <span className="text-purple-300 font-bold">Analysis:</span> {s.aiReasoning}
                </div>
              )}

              {/* Risk factors */}
              {s.riskFactors && s.riskFactors.length > 0 && (
                <div className="border-t border-white/5 pt-1.5">
                  <div className="text-[9px] font-mono font-bold text-red-400 mb-1">⚠ Risk Factors:</div>
                  <div className="flex flex-wrap gap-1">
                    {s.riskFactors.map((rf, i) => (
                      <span key={i} className="px-1.5 py-0.5 rounded-md bg-red-500/[0.08] border border-red-500/20 text-red-300/80 text-[8px] font-mono">
                        {rf}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => onChart(s)}
          className="flex-1 quantum-btn-ghost py-1.5 rounded-xl text-[10px] font-black font-mono flex items-center justify-center gap-1.5"
          title="Live 5-min chart with Entry/SL/T1/T2 overlays"
        >
          📊 CHART
        </button>
        <button
          onClick={() => onPaper(s)}
          disabled={paperOpenForSymbol || noFresh || s.grade === 'B'}
          className={`flex-1 py-1.5 rounded-xl text-[10px] font-black font-mono flex items-center justify-center gap-1.5 border transition-all disabled:opacity-40 ${paperOpenForSymbol
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
            : 'bg-purple-500/10 border-purple-500/30 text-purple-300 hover:bg-purple-500/20'}`}
          title={paperOpenForSymbol ? 'Virtual trade already open' : noFresh ? 'Fresh entries blocked after 15:00 IST' : s.grade === 'B' ? 'B grade = WATCH ONLY — upgrade to A/A+ for trading' : 'Open a virtual (paper) trade with these levels'}
        >
          {paperOpenForSymbol ? '✓ PAPER OPEN' : s.grade === 'B' ? '👁 WATCH' : '📈 PAPER TRADE'}
        </button>
      </div>
    </div>
  );
});
