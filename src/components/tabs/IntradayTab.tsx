import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../utils/api';

const PROXY_BASE = import.meta.env.VITE_API_PROXY || '';

interface IntradaySignal {
  symbol: string;
  ltp: number;
  changePct: number;
  direction: 'LONG' | 'SHORT';
  confidence: number;
  quantConfidence: number;
  aiConfidence: number | null;
  aiModel: string;
  aiNote: string;
  exchange?: 'NSE' | 'BSE';
  entry: number;
  entryZoneLow?: number;
  entryZoneHigh?: number;
  stopLoss: number;
  target1: number;
  target2: number;
  trailingSL?: number;
  trailAfterT1?: number;
  qtyPerLakh?: number;
  trendStrength?: string;
  freshEntriesAllowed?: boolean;
  sqOffBy?: string;
  marketPhase?: string;
  gapPct?: number;
  adx?: number;
  vwapDist?: number;
  rr: number;
  atr: number;
  vwap: number;
  rsi: number;
  volumeRatio: number;
  reasons: string[];
}

interface IntradayAlertsStatus {
  enabled: boolean;
  telegramConfigured: boolean;
  cooldownMinutes: number;
  maxPerDay: number;
  sentToday: number;
}

interface ScannerResponse {
  marketOpen: boolean;
  istTime?: string;
  weekday?: string;
  asOf?: string;
  scanned?: number;
  universe?: number;
  minConfidence?: number;
  aiVerified?: boolean;
  aiModel?: string;
  aiConsensus?: string;
  aiEngine?: string;
  engine?: string;
  sources?: { tradingView?: number; groww?: number };
  signals: IntradaySignal[];
  message?: string;
  error?: string;
  retryAfterSeconds?: number;
  disclaimer?: string;
}

function ConfidenceRing({ value }: { value: number }) {
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
      <div className={`absolute inset-0 flex items-center justify-center text-sm font-black font-mono ${color}`}>
        {Math.round(value)}%
      </div>
    </div>
  );
}

function SignalCard({ s }: { s: IntradaySignal }) {
  const long = s.direction === 'LONG';
  const risk = Math.abs(s.entry - s.stopLoss);
  const reward1 = Math.abs(s.target1 - s.entry);
  const reward2 = Math.abs(s.target2 - s.entry);

  return (
    <div className={`quantum-panel rounded-2xl p-4 border ${long ? 'border-emerald-500/25 bg-gradient-to-b from-emerald-500/[0.04] to-transparent' : 'border-red-500/25 bg-gradient-to-b from-red-500/[0.04] to-transparent'} relative overflow-hidden flex flex-col justify-between gap-3 shadow-lg shadow-black/20`}>
      <div className={`absolute top-0 left-0 right-0 h-1 ${long ? 'bg-gradient-to-r from-emerald-400 via-teal-400 to-transparent' : 'bg-gradient-to-r from-red-400 via-rose-400 to-transparent'}`} />

      {/* Header Row */}
      <div>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-lg font-black text-white tracking-wide">{s.symbol}</span>
              {s.exchange && (
                <span className={`px-1.5 py-0.5 rounded-md text-[9px] font-black font-mono border ${s.exchange === 'BSE' ? 'bg-amber-500/10 text-amber-300 border-amber-500/25' : 'bg-sky-500/10 text-sky-300 border-sky-500/25'}`}>
                  {s.exchange}
                </span>
              )}
              <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black font-mono tracking-wider ${long ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/35' : 'bg-red-500/20 text-red-300 border border-red-500/35'}`}>
                {long ? '🟢 LONG BUY' : '🔴 SHORT SELL'}
              </span>
              {s.trendStrength && (
                <span className={`px-1.5 py-0.5 rounded-md text-[9px] font-bold font-mono ${s.trendStrength === 'STRONG' ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30' : 'bg-white/5 text-slate-400 border border-white/10'}`}>
                  ⚡ {s.trendStrength}
                </span>
              )}
            </div>
            <div className="flex items-baseline gap-2 mt-1.5">
              <span className="text-2xl font-black font-mono text-cyan-300">₹{s.ltp.toFixed(2)}</span>
              <span className={`text-xs font-black font-mono ${s.changePct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {s.changePct >= 0 ? '+' : ''}{s.changePct.toFixed(2)}%
              </span>
              {s.gapPct != null && Math.abs(s.gapPct) >= 0.2 && (
                <span className="text-[10px] font-mono text-slate-400 bg-white/5 px-1.5 py-0.5 rounded">
                  Gap {s.gapPct >= 0 ? '+' : ''}{s.gapPct.toFixed(1)}%
                </span>
              )}
            </div>
          </div>
          <ConfidenceRing value={s.confidence} />
        </div>

        {/* AI & Market Phase Badges */}
        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
          {s.aiConfidence != null && (
            <span className="px-2 py-0.5 rounded-md text-[9px] font-bold bg-purple-500/15 text-purple-300 border border-purple-500/30 flex items-center gap-1">
              <span>🤖</span> MCP AI {s.aiModel?.includes('+') ? 'CONSENSUS' : 'EXPERT'} VERIFIED
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

        {/* Position Sizing & Trailing SL Box */}
        <div className="rounded-xl bg-black/40 border border-white/5 p-2.5 space-y-1.5 text-[10px] font-mono">
          <div className="flex items-center justify-between text-slate-300">
            <span className="text-slate-400">💼 Position Sizing (₹1L Cap):</span>
            <b className="text-cyan-300 font-bold">{s.qtyPerLakh ? `${s.qtyPerLakh} shares` : '—'} (1% Max Risk)</b>
          </div>
          <div className="flex items-center justify-between text-slate-300 border-t border-white/5 pt-1.5">
            <span className="text-slate-400">🛡️ Trailing SL Rule:</span>
            <span className="text-emerald-300">Once T1 hit → Trail SL to ₹{s.trailAfterT1 ?? s.entry.toFixed(2)} (Breakeven)</span>
          </div>
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
    </div>
  );
}

export const IntradayTab = () => {
  const [data, setData] = useState<ScannerResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastFetch, setLastFetch] = useState<number>(0);
  const [alertStatus, setAlertStatus] = useState<IntradayAlertsStatus | null>(null);
  const [filterDir, setFilterDir] = useState<'ALL' | 'LONG' | 'SHORT'>('ALL');
  const [countdown, setCountdown] = useState<number>(0);
  const timerRef = useRef<number | null>(null);
  const countdownRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  const fetchSignals = useCallback(async (silent = false) => {
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

  // Countdown timer effect
  useEffect(() => {
    if (countdown > 0) {
      countdownRef.current = window.setTimeout(() => {
        setCountdown(c => c - 1);
      }, 1000);
    } else if (countdown === 0 && data?.signals?.length === 0 && data?.marketOpen) {
      // Auto trigger re-scan when countdown reaches 0
      fetchSignals(true);
    }
    return () => {
      if (countdownRef.current) clearTimeout(countdownRef.current);
    };
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

  const marketClosed = data && !data.marketOpen;
  const filteredSignals = (data?.signals || []).filter(s => {
    if (filterDir === 'ALL') return true;
    return s.direction === filterDir;
  });

  return (
    <div className="space-y-4">
      {/* Top Banner / Header */}
      <div className="quantum-panel rounded-2xl p-5 border border-purple-500/25 relative overflow-hidden bg-gradient-to-r from-purple-950/20 via-slate-900/60 to-cyan-950/20">
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-purple-500 via-cyan-400 to-emerald-400" />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-black gradient-text-cyan font-display text-glow flex items-center gap-2">
                ⚡ Super Intelligence Intraday
              </h1>
              <span className="quantum-badge text-[9px] bg-cyan-500/10 text-cyan-300 border border-cyan-500/30">
                PRO-DESK ALGO ENGINE v2.0
              </span>
              <span className="px-2 py-0.5 rounded-lg text-[9px] font-mono font-bold bg-purple-500/15 text-purple-300 border border-purple-500/25">
                MCP REALTIME EXPERT
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Top 5 High-Conviction Setups • Dual TradingView + Groww Live Feed • 1% Capital Risk Position Sizing • Structural ATR Stops & Targets
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {data?.aiVerified && (
              <span className="px-2.5 py-1 rounded-xl bg-purple-500/15 border border-purple-500/30 text-purple-300 text-[10px] font-bold font-mono" title={data.aiModel}>
                🤖 {data.aiConsensus === 'multi-model' ? 'MCP CONSENSUS (GEMINI+GROQ)' : `AI: ${data.aiModel || 'MCP'}`}
              </span>
            )}
            <button
              onClick={toggleAlerts}
              disabled={!alertStatus?.telegramConfigured}
              className={`px-3 py-1.5 rounded-xl text-[10px] font-black border transition-all disabled:opacity-40 flex items-center gap-1.5 ${alertStatus?.enabled
                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 shadow-sm shadow-emerald-500/20'
                : 'bg-white/5 border-white/10 text-slate-400 hover:text-slate-300'}`}
              title={!alertStatus?.telegramConfigured
                ? 'Telegram bot configure karein (TG_TOKEN / TG_CHAT_ID)'
                : alertStatus?.enabled
                  ? `Algo Telegram Alerts ACTIVE (${alertStatus?.sentToday ?? 0}/${alertStatus?.maxPerDay ?? 20} sent today)`
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
            <button onClick={() => fetchSignals()} disabled={loading} className="quantum-btn-ghost p-2 rounded-xl disabled:opacity-50" title="Rescan Market">
              <span className={loading ? 'inline-block animate-spin' : ''}>🔄</span>
            </button>
          </div>
        </div>

        {/* Scan metadata row */}
        {data?.asOf && !marketClosed && (
          <div className="flex items-center justify-between gap-2 mt-3 pt-2.5 border-t border-white/5 text-[11px] font-mono text-slate-400 flex-wrap">
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
              Min Confidence: <b className="text-slate-300">{data.minConfidence ?? 75}%</b> • Auto-refresh 60s
            </div>
          </div>
        )}
      </div>

      {/* Filter Tabs if signals exist */}
      {!loading && !marketClosed && (data?.signals?.length ?? 0) > 0 && (
        <div className="flex items-center justify-between gap-2 px-1">
          <div className="flex items-center gap-1.5 bg-black/40 p-1 rounded-xl border border-white/5">
            <button
              onClick={() => setFilterDir('ALL')}
              className={`px-3 py-1 rounded-lg text-xs font-bold font-mono transition-all ${filterDir === 'ALL' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30' : 'text-slate-400 hover:text-slate-200'}`}
            >
              All Setups ({data!.signals.length})
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
          {lastFetch > 0 && (
            <div className="text-[10px] text-slate-500 font-mono hidden sm:block">
              Updated {new Date(lastFetch).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false })} IST
            </div>
          )}
        </div>
      )}

      {/* Main Body */}
      {loading && !data ? (
        <div className="quantum-panel rounded-2xl p-12 text-center border border-white/5">
          <div className="text-4xl mb-3 animate-float">⚡</div>
          <div className="text-base font-bold text-slate-200 mb-1">NSE Intraday Pro-Desk Scanner Running…</div>
          <div className="text-xs text-slate-400 font-medium max-w-md mx-auto">
            TradingView + Groww live feeds se real-time indicators aur MCP AI consensus verify ho raha hai…
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
      ) : (
        <div className="grid gap-3.5 md:grid-cols-2 xl:grid-cols-3">
          {filteredSignals.map(s => <SignalCard key={s.symbol} s={s} />)}
        </div>
      )}

      {/* Pro Trader Execution Rules & Disclaimer */}
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
    </div>
  );
};

