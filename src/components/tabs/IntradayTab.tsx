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
  entry: number;
  stopLoss: number;
  target1: number;
  target2: number;
  rr: number;
  atr: number;
  vwap: number;
  rsi: number;
  volumeRatio: number;
  reasons: string[];
}

interface ScannerResponse {
  marketOpen: boolean;
  istTime?: string;
  weekday?: string;
  asOf?: string;
  scanned?: number;
  minConfidence?: number;
  aiVerified?: boolean;
  aiModel?: string;
  signals: IntradaySignal[];
  message?: string;
  error?: string;
  disclaimer?: string;
}

function ConfidenceRing({ value }: { value: number }) {
  const color = value >= 95 ? 'text-emerald-400' : 'text-cyan-400';
  const stroke = value >= 95 ? '#34d399' : '#22d3ee';
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
  return (
    <div className={`quantum-panel rounded-2xl p-4 border ${long ? 'border-emerald-500/20' : 'border-red-500/20'} relative overflow-hidden`}>
      <div className={`absolute top-0 left-0 right-0 h-0.5 ${long ? 'bg-gradient-to-r from-emerald-500/60 to-transparent' : 'bg-gradient-to-r from-red-500/60 to-transparent'}`} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-base font-black text-white tracking-wide">{s.symbol}</span>
            <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black font-mono ${long ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25' : 'bg-red-500/15 text-red-400 border border-red-500/25'}`}>
              {long ? 'LONG' : 'SHORT'}
            </span>
            {s.aiConfidence != null && (
              <span className="px-2 py-0.5 rounded-lg text-[9px] font-bold bg-purple-500/15 text-purple-300 border border-purple-500/25" title={`Verified by ${s.aiModel}`}>
                MCP AI VERIFIED
              </span>
            )}
          </div>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-xl font-black font-mono text-cyan-300">₹{s.ltp.toFixed(2)}</span>
            <span className={`text-xs font-bold font-mono ${s.changePct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {s.changePct >= 0 ? '+' : ''}{s.changePct.toFixed(2)}%
            </span>
          </div>
        </div>
        <ConfidenceRing value={s.confidence} />
      </div>

      {/* Trade plan */}
      <div className="grid grid-cols-4 gap-1.5 mt-3">
        <div className="rounded-xl bg-white/[0.03] px-2 py-1.5 text-center">
          <div className="text-[8px] uppercase font-bold text-slate-500 tracking-wider">Entry</div>
          <div className="text-xs font-black font-mono text-slate-200">{s.entry.toFixed(2)}</div>
        </div>
        <div className="rounded-xl bg-red-500/[0.06] px-2 py-1.5 text-center">
          <div className="text-[8px] uppercase font-bold text-red-400/70 tracking-wider">SL</div>
          <div className="text-xs font-black font-mono text-red-400">{s.stopLoss.toFixed(2)}</div>
        </div>
        <div className="rounded-xl bg-emerald-500/[0.06] px-2 py-1.5 text-center">
          <div className="text-[8px] uppercase font-bold text-emerald-400/70 tracking-wider">T1</div>
          <div className="text-xs font-black font-mono text-emerald-400">{s.target1.toFixed(2)}</div>
        </div>
        <div className="rounded-xl bg-emerald-500/[0.09] px-2 py-1.5 text-center">
          <div className="text-[8px] uppercase font-bold text-emerald-300/70 tracking-wider">T2</div>
          <div className="text-xs font-black font-mono text-emerald-300">{s.target2.toFixed(2)}</div>
        </div>
      </div>

      {/* Metrics */}
      <div className="flex items-center gap-2 mt-2 text-[10px] font-mono text-slate-500 flex-wrap">
        <span>RR <b className="text-slate-300">1:{s.rr.toFixed(2)}</b></span>
        <span>•</span>
        <span>VWAP <b className="text-slate-300">{s.vwap.toFixed(2)}</b></span>
        <span>•</span>
        <span>RSI <b className={s.rsi > 70 ? 'text-red-400' : s.rsi < 30 ? 'text-emerald-400' : 'text-slate-300'}>{s.rsi}</b></span>
        <span>•</span>
        <span>Vol <b className={s.volumeRatio >= 1.4 ? 'text-amber-400' : 'text-slate-300'}>{s.volumeRatio.toFixed(1)}x</b></span>
        <span>•</span>
        <span>ATR <b className="text-slate-300">{s.atr.toFixed(2)}</b></span>
      </div>

      {/* Reasons */}
      <div className="flex flex-wrap gap-1 mt-2.5">
        {s.reasons.slice(0, 5).map((r, i) => (
          <span key={i} className="px-1.5 py-0.5 rounded-md bg-cyan-500/[0.07] border border-cyan-500/15 text-cyan-300/80 text-[9px] font-semibold">{r}</span>
        ))}
        {s.aiNote && (
          <span className="px-1.5 py-0.5 rounded-md bg-purple-500/[0.07] border border-purple-500/15 text-purple-300/80 text-[9px] font-semibold">AI: {s.aiNote}</span>
        )}
      </div>
    </div>
  );
}

export const IntradayTab = () => {
  const [data, setData] = useState<ScannerResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastFetch, setLastFetch] = useState<number>(0);
  const timerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  const fetchSignals = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await apiFetch(`${PROXY_BASE}/api/intraday-scanner`, { signal: AbortSignal.timeout(45000) });
      const json: ScannerResponse = await res.json();
      if (mountedRef.current) {
        setData(json);
        setLastFetch(Date.now());
      }
    } catch {
      if (mountedRef.current) setData(prev => prev || { marketOpen: true, signals: [], error: 'Scanner unreachable — retry ho raha hai.' });
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    fetchSignals();
    // Poll every 60s while tab visible — scanner itself caches server-side.
    timerRef.current = window.setInterval(() => {
      if (document.visibilityState === 'visible') fetchSignals(true);
    }, 60000);
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchSignals]);

  const marketClosed = data && !data.marketOpen;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="quantum-panel rounded-2xl p-5 border border-purple-500/20 relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-purple-500 via-cyan-500 to-transparent" />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-black gradient-text-cyan font-display text-glow flex items-center gap-2">
              ⚡ Super Intelligence Intraday
              <span className="quantum-badge text-[9px]">NSE DEEP SCAN</span>
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              Top 5 high-confidence setups • VWAP + ORB-15 + EMA stack + CPR + Volume • MCP AI verified • Win-rate filter 90%+
            </p>
          </div>
          <div className="flex items-center gap-2">
            {data?.aiVerified && (
              <span className="px-2 py-1 rounded-lg bg-purple-500/10 border border-purple-500/25 text-purple-300 text-[9px] font-bold font-mono">
                AI: {data.aiModel || 'MCP'}
              </span>
            )}
            {marketClosed ? (
              <span className="px-3 py-1.5 rounded-xl bg-red-500/10 border border-red-500/25 text-red-400 text-[11px] font-black">🔴 MARKET CLOSED</span>
            ) : (
              <span className="px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 text-[11px] font-black animate-pulse-dot">🟢 NSE LIVE</span>
            )}
            <button onClick={() => fetchSignals()} disabled={loading} className="quantum-btn-ghost p-2 rounded-xl disabled:opacity-50" title="Rescan">
              <span className={loading ? 'inline-block animate-spin' : ''}>🔄</span>
            </button>
          </div>
        </div>
        {data?.istTime && marketClosed && (
          <p className="text-[11px] text-slate-500 mt-2 font-mono">Current: {data.istTime} ({data.weekday}) • Window: 09:15–15:30 IST Mon-Fri</p>
        )}
        {data?.asOf && !marketClosed && (
          <p className="text-[11px] text-slate-500 mt-2 font-mono">
            Scan: {new Date(data.asOf).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false })} IST • Universe scanned: {data.scanned} stocks • Auto-refresh 60s
          </p>
        )}
      </div>

      {/* Body */}
      {loading && !data ? (
        <div className="quantum-panel rounded-2xl p-12 text-center">
          <div className="text-4xl mb-3 animate-float">⚡</div>
          <div className="text-sm text-slate-400 font-medium">NSE universe deep-scanning… VWAP / ORB / CPR / volume engine chal raha hai</div>
        </div>
      ) : marketClosed ? (
        <div className="quantum-panel rounded-2xl p-12 text-center border border-white/5">
          <div className="text-5xl mb-4">🌙</div>
          <div className="text-lg font-black text-slate-300 mb-1">NSE Market Band Hai</div>
          <p className="text-sm text-slate-500 max-w-md mx-auto">{data?.message}</p>
          <p className="text-[11px] text-slate-600 mt-3 font-mono">Scanner kal 09:15 IST pe auto-active ho jayega</p>
        </div>
      ) : data?.error ? (
        <div className="quantum-panel rounded-2xl p-8 text-center border border-amber-500/20">
          <div className="text-3xl mb-2">⏳</div>
          <div className="text-sm text-amber-300 font-semibold">{data.error}</div>
        </div>
      ) : (data?.signals?.length ?? 0) === 0 ? (
        <div className="quantum-panel rounded-2xl p-10 text-center border border-white/5">
          <div className="text-4xl mb-3">🎯</div>
          <div className="text-base font-black text-slate-300 mb-1">Abhi koi 90%+ setup nahi mila</div>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Discipline hi edge hai — choppy/sideways market me scanner trade nahi deta. Har 60 second baad auto re-scan hota hai.
          </p>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between px-1">
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              🏆 Top {data!.signals.length} Setups — {data!.minConfidence}%+ AI Confidence
            </div>
            {lastFetch > 0 && (
              <div className="text-[10px] text-slate-600 font-mono">
                Updated {new Date(lastFetch).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false })}
              </div>
            )}
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {data!.signals.map(s => <SignalCard key={s.symbol} s={s} />)}
          </div>
        </>
      )}

      {/* Disclaimer */}
      <div className="quantum-panel rounded-2xl p-3 border border-white/5">
        <p className="text-[10px] text-slate-600 leading-relaxed text-center">
          {data?.disclaimer || 'Educational analysis only — not investment advice. Intraday trading me capital loss ka risk hai.'}
          {' '}Levels ATR-based hain; execution se pehle price confirm karein.
        </p>
      </div>
    </div>
  );
};
