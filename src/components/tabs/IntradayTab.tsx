// ============================================================
// IntradayTab — SUPER INTELLIGENCE INTRADAY PRO-DESK (v4)
// ------------------------------------------------------------
// v4 MEGA upgrades (dual-AI expert desk):
//   • v4 DUAL-AI EXPERT branding (Gemini + Groq structured consensus)
//   • Signal GRADE filter: A+ ONLY / A & A+ / ALL (default A & A+)
//   • Win-rate dashboard strip — live hit-rate, 7-day win-rate, avg R
//   • AI ANALYSIS modal — full Gemini+Groq reasoning per signal
//   • Market-conditions bar — volatility regime + optimal trade window
//   • Dead-zone (14:30–15:00) banner — fresh signals gated
// v3 keeps: SSE live stream, regime banner, fresh-entry ban, chart
//   modal, paper trading, track-record, table+card views, sector
//   concentration warnings, notifications + sound, universe editor.
// ============================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../../utils/api';
import { SignalCard } from '../intraday/SignalCard';
import { SignalTable } from '../intraday/SignalTable';
import { IntradayChartModal } from '../intraday/IntradayChartModal';
import { PaperTradePanel, openPaperTrade } from '../intraday/PaperTradePanel';
import { TrackRecordPanel } from '../intraday/TrackRecordPanel';
import { UniverseEditor } from '../intraday/UniverseEditor';
import { TrendingMovers } from '../intraday/TrendingMovers';
import { MarketIntelPanel } from '../intraday/MarketIntelPanel';
import { TapetidePanel } from '../TapetidePanel';
import { ProTraderAgentPanel } from '../intraday/ProTraderAgentPanel';
import { CommitteePanel } from '../intraday/CommitteePanel';
import { JournalPanel } from '../intraday/JournalPanel';
import { useIntradayStream } from '../intraday/useIntradayStream';
import { sectorConcentration } from '../intraday/sectorMap';
import type {
  IntradaySignal, IntradayAlertsStatus, ScannerResponse, OutcomeEvent, MarketRegime, TrackRecordData,
} from '../intraday/types';

const PROXY_BASE = import.meta.env.VITE_API_PROXY || '';

// ---------- Notification + sound helpers ----------
function playAlertBeep() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const notes = [
      { f: 880, t: 0, d: 0.12 },
      { f: 1174.66, t: 0.13, d: 0.18 },
    ];
    for (const n of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = n.f;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + n.t);
      gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + n.t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + n.t + n.d);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + n.t);
      osc.stop(ctx.currentTime + n.t + n.d + 0.02);
    }
    setTimeout(() => { try { ctx.close(); } catch { /* noop */ } }, 600);
  } catch { /* audio unavailable */ }
}

function pushBrowserNotification(title: string, body: string) {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(title, { body, tag: 'intraday-signal', icon: '/favicon.svg' });
    }
  } catch { /* notifications unavailable */ }
}

function readPref(key: string, fallback: boolean): boolean {
  try { return localStorage.getItem(key) === null ? fallback : localStorage.getItem(key) === '1'; }
  catch { return fallback; }
}

// ---------- Market type ----------
type IntradayMarket = 'INDIA' | 'CRYPTO';

// ---------- Regime banner (v4: + volatility regime + optimal trade window; 2026-09: crypto BTC variant) ----------
function RegimeBanner({ regime, phase, market }: { regime: MarketRegime | null; phase?: string; market?: IntradayMarket }) {
  if (!regime) return null;
  const isCrypto = market === 'CRYPTO';
  const change = isCrypto ? (regime.btcChange ?? 0) : regime.niftyChange;
  const vwapDist = isCrypto ? (regime.btcVwapDist ?? 0) : regime.niftyVwapDist;
  const baseLabel = isCrypto ? 'BTC' : 'NIFTY';
  const conf = {
    BULLISH: 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300',
    BEARISH: 'bg-red-500/10 border-red-500/25 text-red-300',
    NEUTRAL: 'bg-slate-500/10 border-slate-500/25 text-slate-300',
  }[regime.regime];
  const vixConf = regime.vixLevel === 'HIGH'
    ? 'bg-orange-500/10 border-orange-500/25 text-orange-300'
    : regime.vixLevel === 'ELEVATED'
      ? 'bg-amber-500/10 border-amber-500/25 text-amber-300'
      : 'bg-white/5 border-white/10 text-slate-400';
  const volRegime = regime.vixLevel === 'HIGH' ? 'HIGH-VOL ⚠' : regime.vixLevel === 'ELEVATED' ? 'ELEVATED-VOL' : 'CALM';
  // Optimal trade window by session phase (v4 desk heuristic)
  const windowInfo = {
    early: { label: 'OPTIMAL WINDOW — ORB window', cls: 'bg-cyan-500/10 border-cyan-500/25 text-cyan-300', tip: '09:15–09:45 opening-range window — highest-probability ORB breakouts' },
    full: { label: 'STANDARD WINDOW', cls: 'bg-white/5 border-white/10 text-slate-400', tip: 'Mid-session — trade only A/A+ graded setups' },
    'power-hour': { label: 'POWER HOUR', cls: 'bg-rose-500/10 border-rose-500/25 text-rose-300', tip: '14:30+ — momentum moves, but fresh entries gated after 14:30 dead-zone rule' },
  }[phase || 'full'] || { label: 'STANDARD WINDOW', cls: 'bg-white/5 border-white/10 text-slate-400', tip: '' };
  return (
    <div className="flex items-center gap-2 flex-wrap text-[10px] font-mono">
      <span className={`px-2.5 py-1 rounded-xl border font-black ${conf}`}>
        {baseLabel} {regime.regime} {change >= 0 ? '▲' : '▼'}{Math.abs(change).toFixed(2)}%
        <span className="ml-1 font-normal opacity-70">(VWAP {vwapDist >= 0 ? '+' : ''}{vwapDist.toFixed(2)}%)</span>
      </span>
      {regime.vix != null && (
        <span className={`px-2.5 py-1 rounded-xl border font-black ${vixConf}`} title={isCrypto ? 'BTC 24h volatility' : 'INDIA VIX'}>
          {isCrypto ? '24h' : 'VIX'} {regime.vix.toFixed(1)} · {volRegime}
        </span>
      )}
      {phase && !isCrypto && (
        <span className={`px-2.5 py-1 rounded-xl border font-bold ${windowInfo.cls}`} title={windowInfo.tip}>
          ⏱ {windowInfo.label}
        </span>
      )}
      {isCrypto && (
        <span className="px-2.5 py-1 rounded-xl border font-bold bg-purple-500/10 border-purple-500/25 text-purple-300">
          ⚡ 24/7 SESSION — no EOD square-off
        </span>
      )}
      <span className="text-slate-500 hidden sm:inline">Counter-regime setups auto-penalized (v4: -10)</span>
    </div>
  );
}

// ---------- v4: Win-rate dashboard strip ----------
function WinRateStrip({ track, todayCount, todayAPlus }: {
  track: TrackRecordData | null; todayCount: number; todayAPlus: number;
}) {
  const wr = track?.winRate;
  const avgR = track?.avgR;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      <div className="rounded-xl bg-black/40 border border-white/5 px-3 py-2">
        <div className="text-[8px] uppercase font-bold text-slate-500 tracking-wider">Today Signals</div>
        <div className="text-sm font-black font-mono text-cyan-300">{todayCount}
          {todayAPlus > 0 && <span className="ml-1.5 text-[9px] text-amber-300 font-bold">★ {todayAPlus} A+</span>}
        </div>
      </div>
      <div className="rounded-xl bg-black/40 border border-white/5 px-3 py-2">
        <div className="text-[8px] uppercase font-bold text-slate-500 tracking-wider">7-Day Win Rate</div>
        <div className={`text-sm font-black font-mono ${(wr ?? 0) >= 60 ? 'text-emerald-400' : (wr ?? 0) >= 50 ? 'text-amber-400' : wr == null ? 'text-slate-500' : 'text-red-400'}`}>
          {wr != null ? `${wr.toFixed(1)}%` : '—'}
          <span className="ml-1 text-[8px] font-normal text-slate-500">target &gt;60%</span>
        </div>
      </div>
      <div className="rounded-xl bg-black/40 border border-white/5 px-3 py-2">
        <div className="text-[8px] uppercase font-bold text-slate-500 tracking-wider">Avg R (7d)</div>
        <div className={`text-sm font-black font-mono ${(avgR ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
          {avgR != null ? `${avgR >= 0 ? '+' : ''}${avgR.toFixed(2)}R` : '—'}
        </div>
      </div>
      <div className="rounded-xl bg-black/40 border border-white/5 px-3 py-2">
        <div className="text-[8px] uppercase font-bold text-slate-500 tracking-wider">Resolved (7d)</div>
        <div className="text-sm font-black font-mono text-slate-200">
          {track ? `${track.resolved}/${track.totalTracked}` : '—'}
          <span className="ml-1 text-[8px] font-normal text-slate-500">tracked</span>
        </div>
      </div>
    </div>
  );
}

// ---------- v4.9: MARKET DESK SWITCHER — India NSE ↔ Crypto 24/7 ----------
// Simple + detailed: one prominent two-segment control replaces the old
// small NSE/CRYPTO chip + status pill. Each segment carries the market's
// identity (venue, session hours, feed), a live/closed status dot, and a
// distinct active glow (cyan = India desk, amber = crypto desk).
function MarketDeskSwitcher({ market, onSwitch, indiaOpen }: {
  market: IntradayMarket; onSwitch: (m: IntradayMarket) => void; indiaOpen: boolean;
}) {
  const segs = [
    {
      id: 'INDIA' as const,
      icon: '🇮🇳',
      title: 'INDIA MARKET',
      sub: 'NSE Equity • 09:15–15:30 IST • Groww + TV',
      live: indiaOpen,
      liveTxt: indiaOpen ? 'LIVE' : 'CLOSED',
      activeCls: 'from-cyan-500/15 to-sky-500/[0.06] border-cyan-400/40 shadow-[0_0_16px_rgba(34,211,238,0.22)]',
      liveCls: indiaOpen
        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-400/40'
        : 'bg-red-500/15 text-red-300 border-red-400/30',
    },
    {
      id: 'CRYPTO' as const,
      icon: '₿',
      title: 'CRYPTO MARKET',
      sub: '24/7 • CoinDCX INR pairs • TV feeds',
      live: true,
      liveTxt: 'LIVE 24/7',
      activeCls: 'from-amber-500/15 to-orange-500/[0.06] border-amber-400/40 shadow-[0_0_16px_rgba(251,191,36,0.22)]',
      liveCls: 'bg-amber-500/15 text-amber-300 border-amber-400/40',
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-2" aria-label="Market desk switcher">
      {segs.map((seg) => {
        const active = market === seg.id;
        return (
          <button
            key={seg.id}
            type="button"
            aria-pressed={active}
            onClick={() => onSwitch(seg.id)}
            title={`Switch to ${seg.title} desk`}
            className={`group relative text-left rounded-xl border px-3.5 py-2.5 bg-gradient-to-r transition-all duration-300 ${active ? seg.activeCls : 'border-white/10 bg-black/40 hover:border-white/20 hover:bg-black/60'}`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className={`text-xl leading-none transition ${active ? '' : 'opacity-50 grayscale-[40%] group-hover:opacity-80'}`}>{seg.icon}</span>
                <div className="min-w-0">
                  <div className={`text-[11px] font-black tracking-wide truncate ${active ? 'text-white' : 'text-slate-400'}`}>{seg.title}</div>
                  <div className="text-[9px] font-mono text-slate-500 truncate">{seg.sub}</div>
                </div>
              </div>
              <span className={`shrink-0 px-1.5 py-0.5 rounded-md text-[8px] font-black font-mono border flex items-center gap-1 ${active ? seg.liveCls : 'bg-white/5 text-slate-600 border-white/10'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${seg.live ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
                {seg.liveTxt}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ---------- v4.9: DESK QUICK FACTS — the desk's trading rules at a glance ----------
// India desk: session windows + discipline cutoffs. Crypto desk: 24/7 rules.
// Simple chips, detailed tooltips — market-aware, zero extra fetches.
function DeskInfoStrip({ market }: { market: IntradayMarket }) {
  const india = market !== 'CRYPTO';
  const chips: [string, string, string][] = india ? [
    ['⏱', 'Session 09:15–15:30', 'IST trading window (Mon–Fri) — scanner auto-pauses outside'],
    ['⚡', 'ORB 09:15–09:45', 'Opening-range breakout window — highest-probability entries'],
    ['🚫', 'Entries till 15:00', '15:00 IST ke baad naye intraday entries block ho jaate hain'],
    ['⏸', 'Dead-zone 14:30–15:00', 'Statistically weak window — fresh signals gated'],
    ['🏁', 'Sq-off 15:10 IST', 'Mandatory intraday square-off — no overnight carry'],
    ['±', 'Slippage ±7bps/side', 'NSE spread-impact model (entry + exit dono par)'],
  ] : [
    ['♾', '24/7 session', 'Weekend + raat ke trades allowed — koi EOD band nahi'],
    ['🇮🇳', 'INR pairs (CoinDCX)', 'BTC/ETH/altcoins Indian exchange se, ₹ me hi P&L'],
    ['🔢', 'Fractional qty', '0.0027 BTC jaisi units bhi allowed — 1% risk sizing'],
    ['🏁', 'No EOD sq-off', 'Position apni marzi se jitni der rakho'],
    ['±', 'Slippage ±12bps/side', 'Spot taker fee model (INR pairs)'],
    ['🧠', 'BTC regime gate', 'Crypto signals BTC-trend ke against hone par penalty khate hain'],
  ];
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {chips.map(([icon, label, tip]) => (
        <span
          key={label}
          title={tip}
          className="px-2 py-0.5 rounded-lg bg-white/[0.03] border border-white/[0.07] text-[9px] font-mono font-bold text-slate-400 flex items-center gap-1"
        >
          <span className="opacity-80">{icon}</span>{label}
        </span>
      ))}
    </div>
  );
}

// ---------- v4.9: SECTION LABEL — simple ordered desk hierarchy ----------
// The tab is long; numbered section dividers make it read like a pro desk
// runbook: 01 Signals → 02 Market Pulse → 03 India Research → 04 Execution.
function SectionLabel({ n, icon, title, sub }: { n: string; icon: string; title: string; sub?: string }) {
  return (
    <div className="flex items-center gap-2.5 px-1">
      <span className="text-[9px] font-black font-mono text-slate-600 tracking-widest">{n}</span>
      <span className="text-sm leading-none">{icon}</span>
      <span className="text-[11px] font-black text-slate-200 tracking-wider uppercase">{title}</span>
      <span className="h-px flex-1 bg-gradient-to-r from-white/10 to-transparent" />
      {sub && <span className="text-[9px] font-mono text-slate-500 hidden md:inline">{sub}</span>}
    </div>
  );
}

// ---------- v4: Signal detail modal — full dual-expert analysis ----------
function SignalDetailModal({ signal, onClose }: {
  signal: IntradaySignal | null; onClose: () => void;
}) {
  if (!signal) return null;
  const s = signal;
  const long = s.direction === 'LONG';
  const gradeConf = {
    'A+': 'bg-amber-400/15 text-amber-300 border-amber-400/40',
    'A': 'bg-slate-400/15 text-slate-200 border-slate-300/40',
    'B': 'bg-white/5 text-slate-400 border-white/10',
  }[s.grade || 'B'];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div className="quantum-panel rounded-2xl border border-purple-500/25 w-full max-w-lg p-5 space-y-4 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-base font-black text-white">{s.symbol}</span>
            <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black font-mono border ${long ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'bg-red-500/15 text-red-300 border-red-500/30'}`}>
              {s.direction}
            </span>
            <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black font-mono border ${gradeConf}`}>
              {s.grade || 'B'} GRADE{s.grade === 'B' ? ' · WATCH ONLY' : ''}
            </span>
            {s.tradeType && (
              <span className="px-2 py-0.5 rounded-lg text-[9px] font-black font-mono border bg-cyan-500/10 text-cyan-300 border-cyan-500/25">{s.tradeType}</span>
            )}
          </div>
          <button onClick={onClose} className="quantum-btn-ghost px-2.5 py-1 rounded-lg text-xs font-black">✕</button>
        </div>

        {/* Dual confidence breakdown */}
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-black/40 border border-white/5 px-3 py-2 text-center">
            <div className="text-[8px] uppercase font-bold text-slate-500 tracking-wider">Quant Engine</div>
            <div className="text-lg font-black font-mono text-cyan-300">{s.quantConfidence ?? 0}%</div>
          </div>
          <div className="rounded-xl bg-black/40 border border-white/5 px-3 py-2 text-center">
            <div className="text-[8px] uppercase font-bold text-slate-500 tracking-wider">AI Consensus</div>
            <div className="text-lg font-black font-mono text-purple-300">{s.aiConfidence != null ? `${s.aiConfidence}%` : '—'}</div>
          </div>
          <div className="rounded-xl bg-black/40 border border-white/5 px-3 py-2 text-center">
            <div className="text-[8px] uppercase font-bold text-slate-500 tracking-wider">Final</div>
            <div className="text-lg font-black font-mono text-emerald-300">{s.confidence ?? 0}%</div>
          </div>
        </div>

        {/* Per-model verdicts */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-blue-500/[0.06] border border-blue-500/20 px-3 py-2">
            <div className="text-[9px] uppercase font-bold text-blue-300/80 tracking-wider">🧠 Gemini Expert</div>
            {s.geminiVerdict ? (
              <>
                <div className="text-sm font-black font-mono text-blue-200">{s.geminiVerdict.confidence}%</div>
                <p className="text-[10px] text-blue-200/70 font-mono mt-0.5">{s.geminiVerdict.note || '—'}</p>
              </>
            ) : <p className="text-[10px] text-slate-500 font-mono mt-1">Not available (single-model scan)</p>}
          </div>
          <div className="rounded-xl bg-orange-500/[0.06] border border-orange-500/20 px-3 py-2">
            <div className="text-[9px] uppercase font-bold text-orange-300/80 tracking-wider">⚡ Groq Expert</div>
            {s.groqVerdict ? (
              <>
                <div className="text-sm font-black font-mono text-orange-200">{s.groqVerdict.confidence}%</div>
                <p className="text-[10px] text-orange-200/70 font-mono mt-0.5">{s.groqVerdict.note || '—'}</p>
              </>
            ) : <p className="text-[10px] text-slate-500 font-mono mt-1">Not available (single-model scan)</p>}
          </div>
        </div>

        {/* Entry quality */}
        {s.entryQuality != null && (
          <div className="rounded-xl bg-black/40 border border-white/5 px-3 py-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Entry Timing Quality</span>
              <span className="text-sm font-black font-mono text-slate-200">{s.entryQuality}/10</span>
            </div>
            <div className="mt-1.5 h-2 rounded-full bg-white/5 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${s.entryQuality >= 8 ? 'bg-emerald-400' : s.entryQuality >= 6 ? 'bg-cyan-400' : s.entryQuality >= 4 ? 'bg-amber-400' : 'bg-red-400'}`}
                style={{ width: `${s.entryQuality * 10}%` }}
              />
            </div>
          </div>
        )}

        {/* Full reasoning chain */}
        {s.aiReasoning && (
          <div className="rounded-xl bg-purple-500/[0.06] border border-purple-500/20 px-3 py-3">
            <div className="text-[10px] uppercase font-bold text-purple-300/80 tracking-wider mb-1.5">🧠 Full AI Reasoning Chain</div>
            <p className="text-[11px] text-purple-100/80 leading-relaxed font-mono whitespace-pre-line">{s.aiReasoning}</p>
          </div>
        )}

        {/* Risk factors */}
        {s.riskFactors && s.riskFactors.length > 0 && (
          <div className="rounded-xl bg-red-500/[0.05] border border-red-500/20 px-3 py-2">
            <div className="text-[10px] uppercase font-bold text-red-300/80 tracking-wider mb-1">⚠ Risk Factors (AI-identified)</div>
            <div className="flex flex-wrap gap-1">
              {s.riskFactors.map((r, i) => (
                <span key={i} className="px-1.5 py-0.5 rounded-md bg-red-500/10 border border-red-500/20 text-red-300 text-[9px] font-semibold">{r}</span>
              ))}
            </div>
          </div>
        )}

        {/* Levels + adjusted */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center font-mono">
          <div className="rounded-xl bg-white/[0.03] border border-white/5 px-2 py-2">
            <div className="text-[8px] uppercase font-bold text-slate-500">Entry {s.aiAdjustedEntry != null && <span className="text-teal-300">(AI)</span>}</div>
            <div className="text-xs font-black text-cyan-200">₹{((s.aiAdjustedEntry ?? s.entry) ?? 0).toFixed(2)}</div>
          </div>
          <div className="rounded-xl bg-red-500/[0.06] border border-red-500/15 px-2 py-2">
            <div className="text-[8px] uppercase font-bold text-slate-500">Stop {s.aiAdjustedSL != null && <span className="text-teal-300">(AI-tight)</span>}</div>
            <div className="text-xs font-black text-red-300">₹{(s.stopLoss ?? 0).toFixed(2)}</div>
          </div>
          <div className="rounded-xl bg-emerald-500/[0.06] border border-emerald-500/15 px-2 py-2">
            <div className="text-[8px] uppercase font-bold text-slate-500">T1</div>
            <div className="text-xs font-black text-emerald-300">₹{(s.target1 ?? 0).toFixed(2)}</div>
          </div>
          <div className="rounded-xl bg-emerald-500/[0.08] border border-emerald-500/20 px-2 py-2">
            <div className="text-[8px] uppercase font-bold text-slate-500">T2</div>
            <div className="text-xs font-black text-emerald-300">₹{(s.target2 ?? 0).toFixed(2)}</div>
          </div>
        </div>

        <p className="text-[9px] text-slate-600 font-mono text-center">
          Dual-expert analysis (Gemini + Groq) · scan {new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false })} IST
        </p>
      </div>
    </div>
  );
}

// ---------- Paper trade qty modal ----------
function PaperTradeModal({ signal, onClose, onDone }: {
  signal: IntradaySignal | null; onClose: () => void; onDone: (ok: boolean, error?: string) => void;
}) {
  const isCrypto = signal?.market === 'CRYPTO';
  const defaultQty = signal?.qtyPerLakh ?? (isCrypto ? 0.01 : 10);
  const [qty, setQty] = useState<number>(defaultQty);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setQty(signal?.qtyPerLakh ?? (signal?.market === 'CRYPTO' ? 0.01 : 10)); }, [signal]);
  if (!signal) return null;

  const risk = Math.abs((signal.entry ?? 0) - (signal.stopLoss ?? 0)) * qty;
  const long = signal.direction === 'LONG';
  const qtyStep = isCrypto ? 0.0001 : 1;
  const fmtQty = (v: number) => isCrypto ? v.toFixed(4) : String(Math.floor(v));

  const go = async () => {
    setBusy(true);
    const r = await openPaperTrade(signal, qty);
    setBusy(false);
    onDone(r.ok, r.error);
    if (r.ok) onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div className="quantum-panel rounded-2xl border border-purple-500/25 w-full max-w-sm p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-black text-white">📈 Virtual Paper Trade</div>
            <div className="text-[10px] font-mono text-slate-500">No real money — engine-managed simulation</div>
          </div>
          <button onClick={onClose} className="quantum-btn-ghost px-2.5 py-1 rounded-lg text-xs font-black">✕</button>
        </div>

        <div className="rounded-xl bg-black/40 border border-white/5 p-3 space-y-1.5 text-[11px] font-mono">
          <div className="flex justify-between"><span className="text-slate-400">Symbol</span><b className="text-white">{signal.symbol} {long ? '🟢 LONG' : '🔴 SHORT'}</b></div>
          <div className="flex justify-between"><span className="text-slate-400">Entry</span><b className="text-cyan-300">₹{(signal.entry ?? 0).toFixed(2)}</b></div>
          <div className="flex justify-between"><span className="text-slate-400">SL / T1 / T2</span><b>₹{(signal.stopLoss ?? 0).toFixed(1)} / ₹{(signal.target1 ?? 0).toFixed(1)} / ₹{(signal.target2 ?? 0).toFixed(1)}</b></div>
        </div>

        <div>
          <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
            Quantity ({isCrypto ? 'crypto units — fractional OK' : 'shares'})
          </label>
          <input
            type="number" min={isCrypto ? 0.0001 : 1} max={100000} step={qtyStep} value={qty}
            onChange={(e) => {
              const v = Number(e.target.value) || (isCrypto ? 0.0001 : 1);
              setQty(Math.max(isCrypto ? 0.0001 : 1, Math.min(100000, isCrypto ? +v.toFixed(4) : Math.floor(v))));
            }}
            className="w-full mt-1 bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-sm font-mono text-slate-200 focus:border-purple-500/50 focus:outline-none"
            disabled={busy}
          />
          <div className="flex justify-between text-[10px] font-mono text-slate-500 mt-1">
            <span>Risk @ SL: <b className="text-red-400">₹{risk.toFixed(0)}</b></span>
            <span>Capital: <b className="text-slate-300">₹{(qty * (signal.entry ?? 0)).toFixed(0)}</b>{isCrypto && <span className="ml-1 text-purple-300">({fmtQty(qty)} u)</span>}</span>
          </div>
        </div>

        <button onClick={go} disabled={busy} className="quantum-btn w-full py-2.5 rounded-xl text-xs font-black disabled:opacity-50">
          {busy ? 'OPENING…' : `OPEN VIRTUAL ${long ? 'LONG' : 'SHORT'} ⚡`}
        </button>
        <p className="text-[9px] text-slate-600 font-mono text-center">
          {isCrypto
            ? 'Auto-managed: T1 → 50% book + breakeven trail • SL/T2 → close • 24/7 session (no EOD square-off)'
            : 'Auto-managed: T1 → 50% book + breakeven trail • SL/T2 → close • 15:10 IST square-off'}
        </p>
      </div>
    </div>
  );
}

// ---------- Outcome toast ----------
function OutcomeToast({ ev, onClose }: { ev: OutcomeEvent & { id: number }; onClose: () => void }) {
  useEffect(() => {
    const t = window.setTimeout(onClose, 7000);
    return () => clearTimeout(t);
  }, [onClose]);
  const conf = {
    T1_HIT: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
    T2_HIT: 'border-emerald-500/50 bg-emerald-500/15 text-emerald-200',
    SL_HIT: 'border-red-500/40 bg-red-500/10 text-red-300',
    BE_TRAIL_EXIT: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300',
    EOD_EXIT: 'border-slate-500/40 bg-slate-500/10 text-slate-300',
    PAPER_CLOSE: 'border-purple-500/40 bg-purple-500/10 text-purple-300',
    FLIP: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
    OPEN: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300',
  }[ev.type] || 'border-white/20 bg-white/5 text-slate-300';
  const icon = { T1_HIT: '🎯', T2_HIT: '🏆', SL_HIT: '🛑', BE_TRAIL_EXIT: '🔒', EOD_EXIT: '🌙', PAPER_CLOSE: '📝', FLIP: '🔄', OPEN: '⚡' }[ev.type] || 'ℹ️';
  const pnl = ev.pnl != null ? ` • ${ev.pnl >= 0 ? '+' : '−'}₹${Math.abs(ev.pnl).toFixed(0)}${ev.type.startsWith('PAPER') ? '' : '/₹1L'}` : '';
  return (
    <button
      onClick={onClose}
      className={`w-full text-left px-3.5 py-2.5 rounded-xl border backdrop-blur-md shadow-lg shadow-black/30 text-[11px] font-mono font-bold ${conf}`}
    >
      {icon} <b>{ev.symbol}</b> — {ev.type.replace(/_/g, ' ')}{ev.price != null && ` @ ₹${ev.price.toFixed(1)}`}{pnl}
      {ev.note && <span className="block text-[9px] font-normal opacity-70 mt-0.5">{ev.note}</span>}
    </button>
  );
}

// ============================================================
// MAIN TAB
// ============================================================
export const IntradayTab = () => {
  const [data, setData] = useState<ScannerResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastFetch, setLastFetch] = useState<number>(0);
  const [market, setMarket] = useState<IntradayMarket>(() =>
    (localStorage.getItem('intraday_market') === 'CRYPTO' ? 'CRYPTO' : 'INDIA'));
  const [alertStatus, setAlertStatus] = useState<IntradayAlertsStatus | null>(null);
  const [filterDir, setFilterDir] = useState<'ALL' | 'LONG' | 'SHORT'>('ALL');
  const [filterGrade, setFilterGrade] = useState<'A' | 'A+' | 'ALL'>('A'); // v4: default A & A+
  const [view, setView] = useState<'cards' | 'table'>('cards');
  const [countdown, setCountdown] = useState<number>(0);
  const [chartSignal, setChartSignal] = useState<IntradaySignal | null>(null);
  const [paperSignal, setPaperSignal] = useState<IntradaySignal | null>(null);
  const [detailSignal, setDetailSignal] = useState<IntradaySignal | null>(null); // v4 AI-analysis modal
  const [trackStats, setTrackStats] = useState<TrackRecordData | null>(null); // v4 win-rate strip
  const [universeOpen, setUniverseOpen] = useState(false);
  const [paperRefresh, setPaperRefresh] = useState(0);
  const [trackRefresh, setTrackRefresh] = useState(0);
  const [toasts, setToasts] = useState<(OutcomeEvent & { id: number })[]>([]);
  const [notifyEnabled, setNotifyEnabled] = useState(() => readPref('intraday_notify', false));
  const [soundEnabled, setSoundEnabled] = useState(() => readPref('intraday_sound', true));

  const timerRef = useRef<number | null>(null);
  const countdownRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const prevSignalsRef = useRef<Map<string, string>>(new Map());
  const toastIdRef = useRef(0);

  // ---------- Data fetching (60s poll, as before) ----------
  // 2026 perf audit (M7): in-flight guard — the 60s interval + a slow scan
  // (45s timeout) could start overlapping requests whose responses then
  // landed out of order (an older scan overwriting a newer one on setData).
  const inFlightRef = useRef(false);
  const marketRef = useRef<IntradayMarket>(market);
  marketRef.current = market;
  const fetchSignals = useCallback(async (silent = false) => {
    if (inFlightRef.current) return; // a scan is already running
    inFlightRef.current = true;
    if (!silent) setLoading(true);
    try {
      const res = await apiFetch(`${PROXY_BASE}/api/intraday-scanner?market=${marketRef.current}`, { signal: AbortSignal.timeout(45000) });
      const json: ScannerResponse = await res.json();
      // Stale-response guard: a market switch mid-flight must not paint the
      // other market's payload (classic race → wrong-universe signals).
      const responseMarket: IntradayMarket = json?.market === 'CRYPTO' ? 'CRYPTO' : 'INDIA';
      if (mountedRef.current && responseMarket === marketRef.current) {
        setData(json);
        setLastFetch(Date.now());
        if (json.retryAfterSeconds && json.signals.length === 0) {
          setCountdown(json.retryAfterSeconds);
        }
      }
    } catch {
      if (mountedRef.current) {
        setData(prev => prev || { marketOpen: true, signals: [], error: 'Scanner live data reconnecting — auto re-scan chal raha hai.' });
      }
    } finally {
      inFlightRef.current = false;
      if (mountedRef.current) setLoading(false);
    }
  }, [market]);

  const fetchAlertStatus = useCallback(async () => {
    try {
      const res = await apiFetch(`${PROXY_BASE}/api/intraday-alerts`, { signal: AbortSignal.timeout(8000) });
      if (mountedRef.current && res.ok) setAlertStatus(await res.json());
    } catch { /* noop */ }
  }, []);

  // v4: win-rate strip data — 7-day track record (refreshed on scan updates).
  const fetchTrackStats = useCallback(async () => {
    try {
      const res = await apiFetch(`${PROXY_BASE}/api/intraday-track-record?days=7`, { signal: AbortSignal.timeout(8000) });
      if (mountedRef.current && res.ok) setTrackStats(await res.json());
    } catch { /* strip shows '—' */ }
  }, []);

  const toggleAlerts = useCallback(async () => {
    const next = !(alertStatus?.enabled ?? true);
    setAlertStatus(prev => prev ? { ...prev, enabled: next } : prev);
    try {
      const res = await apiFetch(`${PROXY_BASE}/api/intraday-alerts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error('toggle failed');
    } catch {
      setAlertStatus(prev => prev ? { ...prev, enabled: !next } : prev);
    }
  }, [alertStatus?.enabled]);

  // ---------- SSE live stream ----------
  const isCryptoMode = market === 'CRYPTO';
  const streamEnabled = !!data && data.marketOpen !== false;
  const handleOutcome = useCallback((ev: OutcomeEvent) => {
    const id = ++toastIdRef.current;
    setToasts(prev => [{ ...ev, id }, ...prev].slice(0, 4));
    if (ev.type === 'PAPER_CLOSE') setPaperRefresh(k => k + 1);
    else setTrackRefresh(k => k + 1);
    if (soundEnabled && (ev.type === 'T1_HIT' || ev.type === 'T2_HIT' || ev.type === 'SL_HIT')) playAlertBeep();
  }, [soundEnabled]);
  const stream = useIntradayStream(streamEnabled, handleOutcome);

  // Effective regime: prefer the live SSE push, fall back to scan payload.
  // Crypto mode uses the BTC regime frame; India mode the NIFTY one.
  const regime = isCryptoMode
    ? (stream.cryptoRegime ?? (data?.market === 'CRYPTO' ? data.marketRegime : null))
    : (stream.regime ?? (data && data.market !== 'CRYPTO' ? data.marketRegime : null));

  // ---------- New-signal detection → notification + sound ----------
  useEffect(() => {
    const sigs = data?.signals || [];
    if (sigs.length === 0) return;
    const prev = prevSignalsRef.current;
    const fresh = sigs.filter(s => {
      const old = prev.get(s.symbol);
      return !old || old !== s.direction; // new symbol or direction flip
    });
    prevSignalsRef.current = new Map(sigs.map((s): [string, string] => [s.symbol, s.direction]));
    if (prev.size === 0) return; // first load — no fanfare
    const notable = fresh.filter(s => s.confidence >= 80);
    if (notable.length > 0) {
      const names = notable.map(s => `${s.symbol} ${s.direction} (${s.confidence}%)`).join(', ');
      if (soundEnabled) playAlertBeep();
      if (notifyEnabled) {
        pushBrowserNotification(
          `⚡ ${notable.length} new high-conviction setup${notable.length > 1 ? 's' : ''}`,
          names,
        );
      }
      const id = ++toastIdRef.current;
      setToasts(t => [{
        id, type: 'OPEN' as const, symbol: notable[0].symbol, direction: notable[0].direction,
        confidence: notable[0].confidence,
        note: notable.length > 1 ? `+${notable.length - 1} more new setups` : `New ${notable[0].direction} @ ${notable[0].confidence}% confidence`,
      }, ...t].slice(0, 4));
    }
  }, [data?.signals, notifyEnabled, soundEnabled]);

  // ---------- Timers ----------
  useEffect(() => {
    if (countdown > 0) {
      countdownRef.current = window.setTimeout(() => setCountdown(c => c - 1), 1000);
    } else if (countdown === 0 && data?.signals?.length === 0 && data?.marketOpen) {
      fetchSignals(true);
    }
    return () => { if (countdownRef.current) clearTimeout(countdownRef.current); };
  }, [countdown, data?.signals?.length, data?.marketOpen, fetchSignals]);

  useEffect(() => {
    mountedRef.current = true;
    fetchSignals();
    fetchAlertStatus();
    fetchTrackStats();
    timerRef.current = window.setInterval(() => {
      if (document.visibilityState === 'visible') fetchSignals(true);
    }, 60000);
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchSignals, fetchAlertStatus, fetchTrackStats]);

  // 2026-09 multi-market: switching market resets the scan (crypto and NSE
  // never share payloads) and persists the choice.
  const switchMarket = useCallback((m: IntradayMarket) => {
    if (m === market) return;
    try { localStorage.setItem('intraday_market', m); } catch { /* noop */ }
    setMarket(m);
    setData(null);
    setLastFetch(0);
    prevSignalsRef.current = new Map();
    setLoading(true);
  }, [market]);

  // v4: refresh win-rate strip when track-record outcomes change.
  useEffect(() => { fetchTrackStats(); }, [trackRefresh, fetchTrackStats]);

  // ---------- Derived state ----------
  const marketClosed = data && !data.marketOpen; // only possible in INDIA mode (crypto is 24/7)
  const freshAllowed = isCryptoMode ? true : (data?.freshEntriesAllowed ?? true);
  const inDeadZone = !isCryptoMode && !!data?.deadZone;
  // Live session phase (from first signal or fallback).
  const sessionPhase = data?.signals?.[0]?.marketPhase || undefined;
  const gradeMatch = useCallback((s: IntradaySignal) => {
    if (filterGrade === 'ALL') return true;
    if (filterGrade === 'A+') return s.grade === 'A+';
    return s.grade === 'A+' || s.grade === 'A'; // 'A' → A & A+
  }, [filterGrade]);
  const filteredSignals = useMemo(
    () => (data?.signals || []).filter(s => (filterDir === 'ALL' || s.direction === filterDir) && gradeMatch(s)),
    [data?.signals, filterDir, gradeMatch],
  );
  const todayAPlus = useMemo(
    () => (data?.signals || []).filter(s => s.grade === 'A+').length,
    [data?.signals],
  );
  const sectorWarnings = useMemo(
    () => sectorConcentration((data?.signals || []).map(s => s.symbol), 3),
    [data?.signals],
  );
  const paperOpenSymbols = useRef<Set<string>>(new Set()).current; // server enforces duplicates; placeholder for future wiring

  const toggleNotify = async () => {
    if (!notifyEnabled && typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
      try { await Notification.requestPermission(); } catch { /* denied */ }
    }
    const next = !notifyEnabled;
    setNotifyEnabled(next);
    try { localStorage.setItem('intraday_notify', next ? '1' : '0'); } catch { /* noop */ }
  };
  const toggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    try { localStorage.setItem('intraday_sound', next ? '1' : '0'); } catch { /* noop */ }
    if (next) playAlertBeep();
  };

  const openPaperFromCard = useCallback((s: IntradaySignal) => setPaperSignal(s), []);
  const openChart = useCallback((s: IntradaySignal) => setChartSignal(s), []);
  const openDetail = useCallback((s: IntradaySignal) => setDetailSignal(s), []);
  const closeToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <div className="space-y-4">
      {/* ===== Top Banner / Header ===== */}
      <div className="quantum-panel rounded-2xl p-5 border border-purple-500/25 relative overflow-hidden bg-gradient-to-r from-purple-950/20 via-slate-900/60 to-cyan-950/20">
        <div className={`absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r ${isCryptoMode ? 'from-purple-500 via-amber-400 to-orange-400' : 'from-purple-500 via-cyan-400 to-emerald-400'}`} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-black gradient-text-cyan font-display text-glow flex items-center gap-2">
                ⚡ Super Intelligence Intraday
              </h1>
              <span className="quantum-badge text-[9px] bg-cyan-500/10 text-cyan-300 border border-cyan-500/30">
                PRO-DESK ALGO ENGINE v4
              </span>
              <span className="px-2 py-0.5 rounded-lg text-[9px] font-mono font-bold bg-purple-500/15 text-purple-300 border border-purple-500/25">
                DUAL-AI EXPERT · GEMINI + GROQ
              </span>
              <span className="px-2 py-0.5 rounded-lg text-[9px] font-mono font-bold bg-amber-500/10 text-amber-300 border border-amber-500/25" title="Signals graded A+ / A / B — B is watch-only. AI-rejected setups never publish.">
                A+/A/B GRADED
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              {isCryptoMode
                ? 'Top Crypto Setups • Dual-AI Expert Consensus (Gemini + Groq) • TV + CoinDCX Confluence • BTC Regime Gate • 1% Risk Sizing • 24/7 Live Outcome Tracking'
                : 'Top 5 High-Conviction Graded Setups • Dual-AI Expert Consensus (Gemini + Groq) • Supertrend/POC/SMA50 Confluence • NIFTY/VIX Regime Gate • 1% Risk Sizing • Live Outcome Tracking'}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {data?.aiVerified && (
              <span className="px-2.5 py-1 rounded-xl bg-purple-500/15 border border-purple-500/30 text-purple-300 text-[10px] font-bold font-mono" title={data.aiModel}>
                🤖 {data.aiConsensus === 'multi-model' ? 'DUAL-AI CONSENSUS LIVE' : `AI: ${data.aiModel || 'MCP'}`}
              </span>
            )}
            {streamEnabled && (
              <span
                className={`px-2 py-1 rounded-xl text-[9px] font-black font-mono border ${stream.connected
                  ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300' : 'bg-white/5 border-white/10 text-slate-500'}`}
                title={stream.connected ? 'SSE live stream connected (5s ticks)' : 'Stream reconnecting…'}
              >
                {stream.connected ? '📡 LIVE 5s' : '📡 …'}
              </span>
            )}
            <button
              onClick={toggleSound}
              className={`px-2.5 py-1 rounded-xl text-[10px] font-black border transition-all ${soundEnabled
                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300' : 'bg-white/5 border-white/10 text-slate-500'}`}
              title="Alert sound on new high-conviction signals"
            >
              {soundEnabled ? '🔊' : '🔇'}
            </button>
            <button
              onClick={toggleNotify}
              className={`px-2.5 py-1 rounded-xl text-[10px] font-black border transition-all ${notifyEnabled
                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300' : 'bg-white/5 border-white/10 text-slate-500'}`}
              title="Browser notifications for new setups"
            >
              {notifyEnabled ? '🔔' : '🔕'}
            </button>
            <button
              onClick={toggleAlerts}
              disabled={!alertStatus?.telegramConfigured}
              className={`px-3 py-1.5 rounded-xl text-[10px] font-black border transition-all disabled:opacity-40 flex items-center gap-1.5 ${alertStatus?.enabled
                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 shadow-sm shadow-emerald-500/20'
                : 'bg-white/5 border-white/10 text-slate-400 hover:text-slate-300'}`}
              title={!alertStatus?.telegramConfigured
                ? 'Telegram bot configure karein (TG_TOKEN / TG_CHAT_ID)'
                : alertStatus?.enabled
                  ? `Algo Telegram Alerts ACTIVE (${alertStatus?.sentToday ?? 0}/${alertStatus?.maxPerDay ?? 20} sent today) — signals + SL/T1/T2 outcomes`
                  : 'Algo Alerts DISABLED — click to turn ON'}
            >
              <span>🔔</span> ALGO {alertStatus?.enabled ? 'ON' : 'OFF'}
            </button>
            <button onClick={() => setUniverseOpen(true)} className="quantum-btn-ghost p-2 rounded-xl" title="Custom scanner universe / watchlist">
              ⚙
            </button>
            <button onClick={() => fetchSignals()} disabled={loading} className="quantum-btn-ghost p-2 rounded-xl disabled:opacity-50" title="Rescan Market">
              <span className={loading ? 'inline-block animate-spin' : ''}>🔄</span>
            </button>
          </div>
        </div>

        {/* ===== v4.9: MARKET DESK SWITCHER — India NSE ↔ Crypto 24/7.
              Simple + detailed: venue identity, session hours, feeds and
              live/closed status sab ek prominent segmented control me. ===== */}
        <div className="mt-3">
          <MarketDeskSwitcher market={market} onSwitch={switchMarket} indiaOpen={data?.marketOpen !== false} />
        </div>

        {/* ===== v4.9: DESK QUICK FACTS — market-aware trading rules ===== */}
        <div className="mt-2">
          <DeskInfoStrip market={market} />
        </div>

        {/* Regime banner + win-rate strip (v4) — market-aware */}
        {regime && !marketClosed && (
          <div className="mt-3 pt-2.5 border-t border-white/5 space-y-2.5">
            <RegimeBanner regime={regime} phase={sessionPhase} market={market} />
            <WinRateStrip track={trackStats} todayCount={data?.signals?.length ?? 0} todayAPlus={todayAPlus} />
          </div>
        )}

        {/* v4: dead-zone banner (14:30–15:00 IST) — NSE only */}
        {inDeadZone && !marketClosed && (
          <div className="rounded-2xl border border-rose-500/25 bg-rose-500/[0.05] px-4 py-2.5 flex items-center gap-3 mt-3">
            <span className="text-xl">⏸</span>
            <div className="text-[11px] font-mono">
              <b className="text-rose-300">DEAD ZONE (14:30–15:00 IST) — fresh signals gated</b>
              <span className="text-slate-400 block mt-0.5">
                Is window me setups statistically weak hote hain — isliye naye signals publish nahi hote. Open positions normally manage hote rahenge (T1/trail/SL/15:10 sq-off).
              </span>
            </div>
          </div>
        )}
        {data?.asOf && !marketClosed && (
          <div className="flex items-center justify-between gap-2 mt-2.5 pt-2.5 border-t border-white/5 text-[11px] font-mono text-slate-400 flex-wrap">
            <div>
              Scan: <b className="text-slate-200">{new Date(data.asOf).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false })} IST</b>
              {' '}• Resolved: <b className="text-cyan-300">{data.scanned}/{data.universe ?? '~90'}</b> {isCryptoMode ? 'coins' : 'stocks'}
              {data.sources && (
                <span className="text-slate-500 ml-2">
                  (TV: {data.sources.tradingView ?? 0}, {isCryptoMode ? 'CoinDCX' : 'Groww'}: {(isCryptoMode ? data.sources.coindcx : data.sources.groww) ?? 0})
                </span>
              )}
            </div>
            <div className="text-slate-500">
              Min Confidence: <b className="text-slate-300">{data.minConfidence ?? 75}%</b> • Auto-refresh 60s{stream.connected ? ' + live ticks 5s' : ''}
            </div>
          </div>
        )}
      </div>

      {/* ===== v4.9 · 01 — SIGNAL DESK: hero section, pehle graded setups
            (pro desks lead with signals, context panels follow). ===== */}
      <SectionLabel
        n="01" icon="🎯" title="Signal Desk"
        sub={isCryptoMode ? '₿ crypto setups · graded A+/A/B · 60s re-scan' : '🇮🇳 NSE setups · graded A+/A/B · 60s re-scan'}
      />

      {/* ===== Fresh-entry ban warning ===== */}
      {!marketClosed && !freshAllowed && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/[0.06] px-4 py-3 flex items-center gap-3">
          <span className="text-xl">⛔</span>
          <div className="text-[11px] font-mono">
            <b className="text-red-300">FRESH ENTRY WINDOW CLOSED (15:00 IST ke baad)</b>
            <span className="text-slate-400 block mt-0.5">
              Naye intraday entries block ho chuki hain — sirf open positions manage karein (T1 book / trail / sq-off by 15:10).
            </span>
          </div>
        </div>
      )}

      {/* ===== Sector concentration warning ===== */}
      {sectorWarnings.length > 0 && !marketClosed && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.05] px-4 py-2.5 flex items-center gap-3">
          <span className="text-lg">🏭</span>
          <div className="text-[11px] font-mono text-amber-300">
            <b>Sector concentration:</b>{' '}
            {sectorWarnings.map(w => `${w.sector} ×${w.count}`).join(' • ')}
            <span className="text-slate-400"> — ek hi sector me multiple setups = hidden correlation risk. Ek saath sab lene se bachein.</span>
          </div>
        </div>
      )}

      {/* ===== Filter Tabs + View Toggle ===== */}
      {!loading && !marketClosed && (data?.signals?.length ?? 0) > 0 && (
        <div className="flex items-center justify-between gap-2 px-1 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1 bg-black/40 p-1 rounded-xl border border-amber-500/15" title="Signal quality grade filter (v4)">
              {([
                ['A', 'A & A+', 'bg-amber-500/20 text-amber-300 border border-amber-500/30'],
                ['A+', '★ A+ ONLY', 'bg-amber-400/25 text-amber-200 border border-amber-400/50'],
                ['ALL', 'ALL', 'bg-white/5 text-slate-400 border border-white/10'],
              ] as const).map(([g, label, cls]) => (
                <button
                  key={g}
                  onClick={() => setFilterGrade(g as 'A' | 'A+' | 'ALL')}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-black font-mono transition-all ${filterGrade === g ? cls : 'text-slate-500 hover:text-slate-300'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5 bg-black/40 p-1 rounded-xl border border-white/5">
              <button
                onClick={() => setFilterDir('ALL')}
                className={`px-3 py-1 rounded-lg text-xs font-bold font-mono transition-all ${filterDir === 'ALL' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30' : 'text-slate-400 hover:text-slate-200'}`}
              >
                All ({data!.signals.length})
              </button>
              <button
                onClick={() => setFilterDir('LONG')}
                className={`px-3 py-1 rounded-lg text-xs font-bold font-mono transition-all ${filterDir === 'LONG' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'text-slate-400 hover:text-slate-200'}`}
              >
                🟢 Long ({data!.signals.filter(s => s.direction === 'LONG').length})
              </button>
              <button
                onClick={() => setFilterDir('SHORT')}
                className={`px-3 py-1 rounded-lg text-xs font-bold font-mono transition-all ${filterDir === 'SHORT' ? 'bg-red-500/20 text-red-300 border border-red-500/30' : 'text-slate-400 hover:text-slate-200'}`}
              >
                🔴 Short ({data!.signals.filter(s => s.direction === 'SHORT').length})
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {lastFetch > 0 && (
              <div className="text-[10px] text-slate-500 font-mono hidden sm:block">
                Updated {new Date(lastFetch).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false })} IST
              </div>
            )}
            <div className="flex items-center gap-1 bg-black/40 p-1 rounded-xl border border-white/5">
              <button
                onClick={() => setView('cards')}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-black font-mono ${view === 'cards' ? 'bg-cyan-500/20 text-cyan-300' : 'text-slate-500 hover:text-slate-300'}`}
                title="Card view"
              >
                ▦ CARDS
              </button>
              <button
                onClick={() => setView('table')}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-black font-mono ${view === 'table' ? 'bg-cyan-500/20 text-cyan-300' : 'text-slate-500 hover:text-slate-300'}`}
                title="Dense table view (sortable)"
              >
                ☰ TABLE
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Main Body ===== */}
      {loading && !data ? (
        <div className="quantum-panel rounded-2xl p-12 text-center border border-white/5">
          <div className="text-4xl mb-3 animate-float">{isCryptoMode ? '₿' : '⚡'}</div>
          <div className="text-base font-bold text-slate-200 mb-1">
            {isCryptoMode ? 'Crypto Intraday Pro-Desk Scanner Running…' : 'NSE Intraday Pro-Desk Scanner Running…'}
          </div>
          <div className="text-xs text-slate-400 font-medium max-w-md mx-auto">
            {isCryptoMode
              ? 'TradingView crypto indicators + CoinDCX INR live prices se setups, BTC regime check aur MCP AI consensus verify ho raha hai…'
              : 'TradingView + Groww live feeds se real-time indicators, NIFTY/VIX regime check aur MCP AI consensus verify ho raha hai…'}
          </div>
        </div>
      ) : marketClosed ? (
        <div className="quantum-panel rounded-2xl p-12 text-center border border-white/5">
          <div className="text-5xl mb-4">🌙</div>
          <div className="text-lg font-black text-slate-200 mb-1">NSE Market Band Hai</div>
          <p className="text-sm text-slate-400 max-w-md mx-auto">{data?.message || 'Indian Equity Market trading hours: 09:15 AM to 03:30 PM IST (Mon–Fri).'}</p>
          <p className="text-[11px] text-slate-500 mt-3 font-mono">Scanner agle trading day 09:15 IST pe auto-active ho jayega</p>
        </div>
      ) : data?.error ? (
        <div className="quantum-panel rounded-2xl p-8 text-center border border-amber-500/30 bg-amber-500/[0.02]">
          <div className="text-3xl mb-2">⏳</div>
          <div className="text-base font-bold text-amber-300 mb-1">Live Feeds Active</div>
          <div className="text-sm text-slate-300 max-w-lg mx-auto">{data.error}</div>
          {countdown > 0 && (
            <div className="mt-4 max-w-xs mx-auto space-y-2">
              <div className="flex justify-between text-xs font-mono text-cyan-300">
                <span>Auto re-scan in progress:</span>
                <b>{countdown}s</b>
              </div>
              <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                <div
                  className="bg-cyan-400 h-full transition-all duration-1000 ease-linear"
                  style={{ width: `${((30 - countdown) / 30) * 100}%` }}
                />
              </div>
              <button
                onClick={() => { setCountdown(0); fetchSignals(); }}
                className="quantum-btn text-xs py-1.5 px-4 mt-2"
              >
                Scan Now ⚡
              </button>
            </div>
          )}
        </div>
      ) : filteredSignals.length === 0 ? (
        <div className="quantum-panel rounded-2xl p-10 text-center border border-white/5">
          <div className="text-4xl mb-3">🎯</div>
          <div className="text-base font-black text-slate-200 mb-1">
            {(data?.signals?.length ?? 0) > 0 && filterGrade === 'A+'
              ? 'Koi A+ ELITE grade signal abhi nahi hai'
              : (data?.signals?.length ?? 0) > 0 && filterGrade === 'A'
                ? 'Koi A/A+ grade signal nahi mila — jo hain wo B-grade (watch-only) hain'
                : filterDir !== 'ALL' ? `Koi ${filterDir} setup nahi mila` : `Abhi koi ${data?.minConfidence ?? 75}%+ high-conviction setup nahi mila`}
          </div>
          <p className="text-xs text-slate-400 max-w-md mx-auto mt-1">
            {(data?.signals?.length ?? 0) > 0 && filterGrade !== 'ALL'
              ? 'Grade filter ALL karke saare setups dekh sakte hain — ya scanner 60s me auto re-scan karega.'
              : 'Capital preservation hi pro-trader ka pehla rule hai — choppy market me random trade lene se bachein. Scanner har 60s baad auto re-scan karta hai.'}
          </p>
        </div>
      ) : view === 'table' ? (
        <SignalTable
          signals={filteredSignals}
          livePrices={stream.livePrices}
          freshEntriesAllowed={freshAllowed}
          onChart={openChart}
          onPaper={openPaperFromCard}
        />
      ) : (
        <div className="grid gap-3.5 md:grid-cols-2 xl:grid-cols-3">
          {filteredSignals.map(s => (
            <SignalCard
              key={s.symbol}
              s={s}
              live={stream.livePrices[s.symbol]}
              freshEntriesAllowed={freshAllowed}
              paperOpenForSymbol={paperOpenSymbols.has(s.symbol)}
              onChart={openChart}
              onPaper={openPaperFromCard}
              onDetail={openDetail}
            />
          ))}
        </div>
      )}

      {/* ===== v4.9 · 02 — MARKET PULSE: movers + global intel ===== */}
      <SectionLabel n="02" icon="🔥" title="Market Pulse" sub="trending movers · index & sector pulse · whale intel" />

      {/* TRENDING MOVERS (2026-09) — top up/down list + deep analysis
            for BOTH markets (India NSE today / Crypto 24h). v4.5: index
            pulse, sector heat, most-active view + per-row chart/paper-trade
            bridge into this tab's existing modals. */}
      <TrendingMovers key={market} market={market} onChart={openChart} onPaper={openPaperFromCard} />

      {/* GLOBAL CRYPTO INTEL (2026-09 v4.6) — external free keyless
            sources: CoinLobster whale flows + liquidations, CoinGecko
            trending, Fear & Greed. Global crypto context — dono
            markets (NSE + CRYPTO desk) par useful. */}
      <MarketIntelPanel />

      {/* ===== v4.9 · 03 — INDIA RESEARCH DESK: NSE-only MCP tools ===== */}
      {!isCryptoMode && (
        <>
          <SectionLabel n="03" icon="🇮🇳" title="India Research Desk" sub="Tapetide MCP · ProTrader agent · committee" />
          {/* TAPETIDE (v4.7) — India's AI-first stock research MCP
                (NSE/BSE): OAuth account login, auto-discovered tool
                catalog, run-any-tool desk. NSE desk only. */}
          <TapetidePanel />
          {/* PRO TRADER MCP AGENT + COMMITTEE — NSE desk tools */}
          <ProTraderAgentPanel />
          <CommitteePanel />
        </>
      )}

      {/* ===== v4.9 · 04 — EXECUTION & RECORDS: paper desk → tracking → journal ===== */}
      <SectionLabel n="04" icon="📋" title="Execution & Records" sub="paper desk · track record · AI journal" />

      {/* Paper trading simulator (both markets — rows carry market badges) */}
      {!marketClosed && (
        <PaperTradePanel livePrices={stream.livePrices} refreshKey={paperRefresh} />
      )}

      {/* ===== Signal track record ===== */}
      <TrackRecordPanel refreshKey={trackRefresh} />

      {/* ===== AUTO TRADE JOURNAL — AI-reviewed virtual trade log ===== */}
      <JournalPanel refreshKey={paperRefresh} />

      {/* ===== Pro Trader Execution Rules & Disclaimer ===== */}
      <div className="quantum-panel rounded-2xl p-4 border border-white/5 space-y-2 bg-black/40">
        <div className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
          <span>🛡️</span> Pro Trader Intraday Execution Discipline:
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-[11px] text-slate-400 font-mono">
          <div className="rounded-lg bg-white/[0.02] p-2 border border-white/5">
            <b>1. Risk Discipline:</b> Kabhi bhi kisi single trade me total trading capital ka 1% se zyada risk na lein.
          </div>
          <div className="rounded-lg bg-white/[0.02] p-2 border border-white/5">
            <b>2. Profit Booking:</b> Target 1 aane pe 50% profit book karke remaining quantity ka Stop Loss Entry Price pe shift karein.
          </div>
          <div className="rounded-lg bg-white/[0.02] p-2 border border-white/5">
            <b>3. Strict Square-Off:</b> Sabhi intraday trades ko 15:10 IST tak close karein — overnight carry na karein.
          </div>
        </div>
        <p className="text-[10px] text-slate-600 leading-relaxed text-center pt-1 border-t border-white/5">
          {data?.disclaimer || 'Educational analysis only — not investment advice. Intraday trading me market risk rehta hai.'}
        </p>
      </div>

      {/* ===== Overlays: toasts, chart modal, paper modal, universe editor ===== */}
      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-50 w-80 max-w-[calc(100vw-2rem)] space-y-2">
          {toasts.map(t => <OutcomeToast key={t.id} ev={t} onClose={() => closeToast(t.id)} />)}
        </div>
      )}

      <IntradayChartModal
        signal={chartSignal}
        market={market}
        live={chartSignal ? stream.livePrices[chartSignal.symbol] : undefined}
        onClose={() => setChartSignal(null)}
      />

      {/* v4: full dual-expert AI analysis modal */}
      <SignalDetailModal
        signal={detailSignal}
        onClose={() => setDetailSignal(null)}
      />

      <PaperTradeModal
        signal={paperSignal}
        onClose={() => setPaperSignal(null)}
        onDone={(ok, error) => {
          const id = ++toastIdRef.current;
          setToasts(prev => [{
            id,
            type: 'PAPER_CLOSE' as const,
            symbol: paperSignal?.symbol || '',
            direction: paperSignal?.direction,
            note: ok ? 'Virtual trade opened ✓ — panel me track karein' : `Open failed: ${error || 'error'}`,
          }, ...prev].slice(0, 4));
          if (ok) setPaperRefresh(k => k + 1);
        }}
      />

      {universeOpen && (
        <UniverseEditor market={market} onClose={() => setUniverseOpen(false)} onChanged={() => fetchSignals(true)} />
      )}
    </div>
  );
};
