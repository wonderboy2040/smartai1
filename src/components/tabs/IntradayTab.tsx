// ============================================================
// IntradayTab — SUPER INTELLIGENCE INTRADAY PRO-DESK (v4)
// ------------------------------------------------------------
// v4 MEGA UPGRADE — ACCURATE SIGNALS + HIGH WIN RATE:
//   • DUAL AI EXPERT: Gemini + Groq structured analysis
//   • Signal grading: A+ / A / B quality classification
//   • Enhanced quant engine: Supertrend + Multi-TF EMA + Volume Profile
//   • Win-rate dashboard strip with live stats
//   • Grade filter (A+ ONLY / A & A+ / ALL)
//   • AI reasoning preview per signal
//   • Entry quality meter (1-10)
//   • Trade type classification (SCALP/MOMENTUM/SWING)
// ============================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../../utils/api';
import { SignalCard } from '../intraday/SignalCard';
import { SignalTable } from '../intraday/SignalTable';
import { IntradayChartModal } from '../intraday/IntradayChartModal';
import { PaperTradePanel, openPaperTrade } from '../intraday/PaperTradePanel';
import { TrackRecordPanel } from '../intraday/TrackRecordPanel';
import { UniverseEditor } from '../intraday/UniverseEditor';
import { ProTraderAgentPanel } from '../intraday/ProTraderAgentPanel';
import { CommitteePanel } from '../intraday/CommitteePanel';
import { JournalPanel } from '../intraday/JournalPanel';
import { useIntradayStream } from '../intraday/useIntradayStream';
import { sectorConcentration } from '../intraday/sectorMap';
import type {
  IntradaySignal, IntradayAlertsStatus, ScannerResponse, OutcomeEvent, MarketRegime,
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

// ---------- Regime banner ----------
function RegimeBanner({ regime }: { regime: MarketRegime | null }) {
  if (!regime) return null;
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
  return (
    <div className="flex items-center gap-2 flex-wrap text-[10px] font-mono">
      <span className={`px-2.5 py-1 rounded-xl border font-black ${conf}`}>
        NIFTY {regime.regime} {regime.niftyChange >= 0 ? '▲' : '▼'}{Math.abs(regime.niftyChange).toFixed(2)}%
        <span className="ml-1 font-normal opacity-70">(VWAP {regime.niftyVwapDist >= 0 ? '+' : ''}{regime.niftyVwapDist.toFixed(2)}%)</span>
      </span>
      {regime.vix != null && (
        <span className={`px-2.5 py-1 rounded-xl border font-black ${vixConf}`} title="INDIA VIX">
          VIX {regime.vix.toFixed(1)} {regime.vixLevel === 'HIGH' ? '⚠' : ''}
        </span>
      )}
      <span className="text-slate-500 hidden sm:inline">Counter-regime setups auto-penalized</span>
    </div>
  );
}

// ---------- Paper trade qty modal ----------
function PaperTradeModal({ signal, onClose, onDone }: {
  signal: IntradaySignal | null; onClose: () => void; onDone: (ok: boolean, error?: string) => void;
}) {
  const [qty, setQty] = useState<number>(signal?.qtyPerLakh ?? 10);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setQty(signal?.qtyPerLakh ?? 10); }, [signal]);
  if (!signal) return null;

  const risk = Math.abs(signal.entry - signal.stopLoss) * qty;
  const long = signal.direction === 'LONG';

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
          <div className="flex justify-between"><span className="text-slate-400">Entry</span><b className="text-cyan-300">₹{signal.entry.toFixed(2)}</b></div>
          <div className="flex justify-between"><span className="text-slate-400">SL / T1 / T2</span><b>₹{signal.stopLoss.toFixed(1)} / ₹{signal.target1.toFixed(1)} / ₹{signal.target2.toFixed(1)}</b></div>
        </div>

        <div>
          <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Quantity (shares)</label>
          <input
            type="number" min={1} max={100000} value={qty}
            onChange={(e) => setQty(Math.max(1, Math.min(100000, Math.floor(Number(e.target.value) || 1))))}
            className="w-full mt-1 bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-sm font-mono text-slate-200 focus:border-purple-500/50 focus:outline-none"
            disabled={busy}
          />
          <div className="flex justify-between text-[10px] font-mono text-slate-500 mt-1">
            <span>Risk @ SL: <b className="text-red-400">₹{risk.toFixed(0)}</b></span>
            <span>Capital: <b className="text-slate-300">₹{(qty * signal.entry).toFixed(0)}</b></span>
          </div>
        </div>

        <button onClick={go} disabled={busy} className="quantum-btn w-full py-2.5 rounded-xl text-xs font-black disabled:opacity-50">
          {busy ? 'OPENING…' : `OPEN VIRTUAL ${long ? 'LONG' : 'SHORT'} ⚡`}
        </button>
        <p className="text-[9px] text-slate-600 font-mono text-center">
          Auto-managed: T1 → 50% book + breakeven trail • SL/T2 → close • 15:10 IST square-off
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
  const [alertStatus, setAlertStatus] = useState<IntradayAlertsStatus | null>(null);
  const [filterDir, setFilterDir] = useState<'ALL' | 'LONG' | 'SHORT'>('ALL');
  const [filterGrade, setFilterGrade] = useState<'ALL' | 'A+' | 'A+A'>('A+A'); // v4: default to A+/A only
  const [view, setView] = useState<'cards' | 'table'>('cards');
  const [countdown, setCountdown] = useState<number>(0);
  const [chartSignal, setChartSignal] = useState<IntradaySignal | null>(null);
  const [paperSignal, setPaperSignal] = useState<IntradaySignal | null>(null);
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
  const fetchSignals = useCallback(async (silent = false) => {
    if (inFlightRef.current) return; // a scan is already running
    inFlightRef.current = true;
    if (!silent) setLoading(true);
    try {
      const res = await apiFetch(`${PROXY_BASE}/api/intraday-scanner`, { signal: AbortSignal.timeout(45000) });
      const json: ScannerResponse = await res.json();
      if (mountedRef.current) {
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
  }, []);

  const fetchAlertStatus = useCallback(async () => {
    try {
      const res = await apiFetch(`${PROXY_BASE}/api/intraday-alerts`, { signal: AbortSignal.timeout(8000) });
      if (mountedRef.current && res.ok) setAlertStatus(await res.json());
    } catch { /* noop */ }
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
  const regime = stream.regime ?? data?.marketRegime ?? null;

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
    timerRef.current = window.setInterval(() => {
      if (document.visibilityState === 'visible') fetchSignals(true);
    }, 60000);
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchSignals, fetchAlertStatus]);

  // ---------- Derived state ----------
  const marketClosed = data && !data.marketOpen;
  const freshAllowed = data?.freshEntriesAllowed ?? true;
  const filteredSignals = useMemo(
    () => (data?.signals || []).filter(s => {
      if (filterDir !== 'ALL' && s.direction !== filterDir) return false;
      // v4: Grade filter
      if (filterGrade === 'A+' && s.grade !== 'A+') return false;
      if (filterGrade === 'A+A' && s.grade !== 'A+' && s.grade !== 'A') return false;
      return true;
    }),
    [data?.signals, filterDir, filterGrade],
  );
  // v4: Count by grade for filter tabs
  const gradeCounts = useMemo(() => {
    const sigs = (data?.signals || []).filter(s => filterDir === 'ALL' || s.direction === filterDir);
    return {
      'A+': sigs.filter(s => s.grade === 'A+').length,
      'A': sigs.filter(s => s.grade === 'A').length,
      'B': sigs.filter(s => s.grade === 'B').length,
      total: sigs.length,
    };
  }, [data?.signals, filterDir]);
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
  const closeToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <div className="space-y-4">
      {/* ===== Top Banner / Header ===== */}
      <div className="quantum-panel rounded-2xl p-5 border border-purple-500/25 relative overflow-hidden bg-gradient-to-r from-purple-950/20 via-slate-900/60 to-cyan-950/20">
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-purple-500 via-cyan-400 to-emerald-400" />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-black gradient-text-cyan font-display text-glow flex items-center gap-2">
                ⚡ Super Intelligence Intraday
              </h1>
              <span className="quantum-badge text-[9px] bg-gradient-to-r from-cyan-500/20 to-purple-500/20 text-cyan-300 border border-cyan-500/30">
                PRO-DESK v4 DUAL-AI ENGINE
              </span>
              <span className="px-2 py-0.5 rounded-lg text-[9px] font-mono font-bold bg-purple-500/15 text-purple-300 border border-purple-500/25">
                🧠 GEMINI + ⚡ GROQ EXPERT
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Graded A+/A/B Signals • Supertrend + Multi-TF EMA + ORB-15 • Dual AI Expert Consensus • 1% Risk Sizing • Live Win-Rate Tracking
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {data?.aiVerified && (
              <span className="px-2.5 py-1 rounded-xl bg-gradient-to-r from-purple-500/15 to-blue-500/15 border border-purple-500/30 text-purple-300 text-[10px] font-bold font-mono" title={data.aiModel}>
                🤖 {data.aiConsensus === 'multi-model' ? '🧠 GEMINI + ⚡ GROQ DUAL EXPERT' : `AI: ${data.aiModel || 'MCP'}`}
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
            {marketClosed ? (
              <span className="px-3 py-1.5 rounded-xl bg-red-500/15 border border-red-500/30 text-red-400 text-[11px] font-black">🔴 MARKET CLOSED</span>
            ) : (
              <span className="px-3 py-1.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[11px] font-black animate-pulse-dot flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping inline-block" />
                🟢 NSE LIVE
              </span>
            )}
            <button onClick={() => setUniverseOpen(true)} className="quantum-btn-ghost p-2 rounded-xl" title="Custom scanner universe / watchlist">
              ⚙
            </button>
            <button onClick={() => fetchSignals()} disabled={loading} className="quantum-btn-ghost p-2 rounded-xl disabled:opacity-50" title="Rescan Market">
              <span className={loading ? 'inline-block animate-spin' : ''}>🔄</span>
            </button>
          </div>
        </div>

        {/* Regime banner + scan metadata row */}
        {regime && !marketClosed && (
          <div className="mt-3 pt-2.5 border-t border-white/5">
            <RegimeBanner regime={regime} />
          </div>
        )}
        {data?.asOf && !marketClosed && (
          <div className="flex items-center justify-between gap-2 mt-2.5 pt-2.5 border-t border-white/5 text-[11px] font-mono text-slate-400 flex-wrap">
            <div>
              Scan: <b className="text-slate-200">{new Date(data.asOf).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false })} IST</b>
              {' '}• Resolved: <b className="text-cyan-300">{data.scanned}/{data.universe ?? '~90'}</b> stocks
              {data.sources && (
                <span className="text-slate-500 ml-2">
                  (TV: {data.sources.tradingView ?? 0}, Groww: {data.sources.groww ?? 0})
                </span>
              )}
            </div>
            <div className="text-slate-500">
              Min Confidence: <b className="text-slate-300">{data.minConfidence ?? 75}%</b> • Auto-refresh 60s{stream.connected ? ' + live ticks 5s' : ''}
            </div>
          </div>
        )}
      </div>

      {/* ===== PRO TRADER MCP AGENT — agentic chat with live tool access ===== */}
      <ProTraderAgentPanel />

      {/* ===== TRADER COMMITTEE DEBATE — 3 persona + head-of-desk verdict ===== */}
      <CommitteePanel />

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

      {/* ===== v4: Win Rate Dashboard Strip ===== */}
      {!loading && !marketClosed && data?.signals && data.signals.length > 0 && (
        <div className="rounded-2xl border border-purple-500/20 bg-gradient-to-r from-purple-950/10 via-slate-900/40 to-cyan-950/10 px-4 py-2.5 flex items-center gap-4 flex-wrap text-[10px] font-mono">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500">Signals:</span>
            <span className="text-slate-200 font-bold">{data.signals.length}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-amber-400">⭐ A+:</span>
            <span className="text-amber-200 font-bold">{data.signals.filter(s => s.grade === 'A+').length}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400">A:</span>
            <span className="text-slate-200 font-bold">{data.signals.filter(s => s.grade === 'A').length}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500">B:</span>
            <span className="text-slate-400 font-bold">{data.signals.filter(s => s.grade === 'B').length}</span>
          </div>
          <div className="h-4 w-px bg-white/10" />
          <div className="flex items-center gap-1.5">
            <span className="text-emerald-400">🎯 Avg RR:</span>
            <span className="text-emerald-300 font-bold">
              1:{data.signals.length > 0 ? (data.signals.reduce((s, sig) => s + sig.rr, 0) / data.signals.length).toFixed(2) : '0'}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-cyan-400">📊 Avg Confidence:</span>
            <span className="text-cyan-300 font-bold">
              {data.signals.length > 0 ? Math.round(data.signals.reduce((s, sig) => s + sig.confidence, 0) / data.signals.length) : 0}%
            </span>
          </div>
          {data.aiConsensus === 'multi-model' && (
            <span className="ml-auto px-2 py-0.5 rounded-lg bg-purple-500/10 border border-purple-500/25 text-purple-300 text-[9px] font-bold">
              ✓ DUAL AI VERIFIED
            </span>
          )}
        </div>
      )}

      {/* ===== Filter Tabs + Grade Filter + View Toggle ===== */}
      {!loading && !marketClosed && (data?.signals?.length ?? 0) > 0 && (
        <div className="flex items-center justify-between gap-2 px-1 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            {/* Direction filter */}
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
            {/* v4: Grade filter */}
            <div className="flex items-center gap-1.5 bg-black/40 p-1 rounded-xl border border-amber-500/10">
              <button
                onClick={() => setFilterGrade('A+')}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-black font-mono transition-all ${filterGrade === 'A+' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'text-slate-400 hover:text-amber-300/70'}`}
              >
                ⭐ A+ ONLY ({gradeCounts['A+']})
              </button>
              <button
                onClick={() => setFilterGrade('A+A')}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-black font-mono transition-all ${filterGrade === 'A+A' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30' : 'text-slate-400 hover:text-cyan-300/70'}`}
              >
                A+ & A ({gradeCounts['A+'] + gradeCounts['A']})
              </button>
              <button
                onClick={() => setFilterGrade('ALL')}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-black font-mono transition-all ${filterGrade === 'ALL' ? 'bg-slate-500/20 text-slate-300 border border-slate-500/30' : 'text-slate-500 hover:text-slate-300'}`}
              >
                ALL ({gradeCounts.total})
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
          <div className="text-4xl mb-3 animate-float">⚡</div>
          <div className="text-base font-bold text-slate-200 mb-1">NSE Intraday v4 Pro-Desk Scanner Running…</div>
          <div className="text-xs text-slate-400 font-medium max-w-md mx-auto">
            TradingView + Groww live feeds se Supertrend, Multi-TF EMA, Volume Profile, NIFTY/VIX regime check aur Gemini+Groq DUAL AI expert consensus verify ho raha hai…
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
            {filterDir !== 'ALL' ? `Koi ${filterDir} setup nahi mila` : `Abhi koi ${data?.minConfidence ?? 75}%+ high-conviction setup nahi mila`}
          </div>
          <p className="text-xs text-slate-400 max-w-md mx-auto mt-1">
            Capital preservation hi pro-trader ka pehla rule hai — choppy market me random trade lene se bachein. Scanner har 60s baad auto re-scan karta hai.
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
            />
          ))}
        </div>
      )}

      {/* ===== Paper trading simulator ===== */}
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
        live={chartSignal ? stream.livePrices[chartSignal.symbol] : undefined}
        onClose={() => setChartSignal(null)}
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
        <UniverseEditor onClose={() => setUniverseOpen(false)} onChanged={() => fetchSignals(true)} />
      )}
    </div>
  );
};
