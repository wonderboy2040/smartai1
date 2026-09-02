// ============================================================
// TrendingMovers — India & Crypto main trending UP/DOWN list
// with per-row DEEP ANALYSIS (2026-09 v4.4).
// ------------------------------------------------------------
// Data: GET /api/intraday-movers?market=INDIA|CRYPTO (60s server
// cache, same TV+Groww/CoinDCX indicator batch the scanner uses).
// v4.5 upgrades:
//   • INDEX PULSE — NIFTY/BANKNIFTY/SENSEX/INDIAVIX chips (India),
//     BTC/ETH majors (crypto) — server-merged into the payload
//   • View toggle: TOP GAINERS | TOP LOSERS | MOST ACTIVE (volume)
//   • SECTOR PULSE heat strip — per-sector avg move + adv/dec
//   • Per-row actions: live 5M chart modal + one-click virtual
//     paper trade (bridges into IntradayTab's existing modals)
// v4.4 keeps:
//   • breadth strip — advances / declines / bias / avg move
//   • every row: LTP, change%, RSI heat, VWAP side, volume surge,
//     day-range position + a one-line Hinglish verdict
// Auto-refresh: 60s poll (visible tab only) + instant on market
// switch (parent re-mounts via key). No AI tokens, no extra load
// on the price streams — pure read of the scanner's batch.
// ============================================================
import { memo, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../utils/api';
import type { IntradaySignal } from './types';

const PROXY_BASE = import.meta.env.VITE_API_PROXY || '';

interface MoverRow {
  symbol: string;
  market: string;
  ltp: number;
  changePct: number;
  high: number | null;
  low: number | null;
  volume: number | null;
  relVolume: number | null;
  rsi: number | null;
  adx: number | null;
  vwapDist: number | null;
  dayRangePos: number | null;
  pivotRoomUp: number | null;
  pivotRoomDown: number | null;
  tags: string[];
  analysis: string;
}

interface IndexRow {
  symbol: string;
  name: string;
  ltp: number;
  changePct: number;
  vwapDist: number | null;
  rsi: number | null;
}

interface SectorRow {
  name: string;
  count: number;
  advancing: number;
  declining: number;
  avgPct: number;
}

interface MoversResponse {
  ok: boolean;
  market: 'INDIA' | 'CRYPTO';
  asOf: string;
  marketOpen: boolean;
  gainers: MoverRow[];
  losers: MoverRow[];
  mostActive?: MoverRow[];
  sectors?: SectorRow[];
  indices?: IndexRow[];
  breadth: {
    scanned: number; advanced: number; declined: number; unchanged: number;
    avgChangePct: number; advanceDeclineRatio: number | null; bias: 'BULLISH' | 'BEARISH' | 'MIXED';
  } | null;
  error?: string;
}

type MoverView = 'gainers' | 'losers' | 'active';

const fmtLtp = (v: number, isCrypto: boolean) =>
  isCrypto ? `₹${v >= 1000 ? v.toLocaleString('en-IN', { maximumFractionDigits: 0 }) : v.toFixed(2)}` : `₹${v.toFixed(2)}`;

const fmtVol = (v: number | null) => {
  if (v == null || v <= 0) return null;
  if (v >= 1e7) return `${(v / 1e7).toFixed(1)}Cr`;
  if (v >= 1e5) return `${(v / 1e5).toFixed(1)}L`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return String(Math.round(v));
};

const RSI_CONF = (rsi: number | null) => {
  if (rsi == null) return { cls: 'text-slate-500', bar: 'bg-slate-600', w: 0 };
  if (rsi >= 70) return { cls: 'text-red-400', bar: 'bg-red-400', w: Math.min(100, rsi) };
  if (rsi >= 55) return { cls: 'text-emerald-400', bar: 'bg-emerald-400', w: rsi };
  if (rsi >= 45) return { cls: 'text-slate-300', bar: 'bg-slate-400', w: rsi };
  if (rsi >= 30) return { cls: 'text-amber-400', bar: 'bg-amber-400', w: rsi };
  return { cls: 'text-cyan-400', bar: 'bg-cyan-400', w: Math.max(4, rsi) };
};

/**
 * Synthesize a scanner-grade IntradaySignal from a mover row so the
 * existing CHART modal (level overlays) and PAPER-TRADE modal (qty
 * prompt + risk math) work straight off the movers list.
 * Convention mirrors the engine: 1% stop, T1 = 1.6R, T2 = 2.6R.
 */
export function moverToSignal(m: MoverRow, market: 'INDIA' | 'CRYPTO'): IntradaySignal {
  const ltp = m.ltp > 0 ? m.ltp : 1;
  const long = (m.changePct ?? 0) >= 0; // momentum-aligned default
  const risk = ltp * 0.01;              // 1% initial stop distance
  const dir = long ? 1 : -1;
  const vol = Math.max(0.004, (m.adx ?? 20) / 20 * 0.01); // ADX-scaled fallback ATR%
  return {
    symbol: m.symbol,
    ltp,
    changePct: m.changePct ?? 0,
    direction: long ? 'LONG' : 'SHORT',
    confidence: 0,
    quantConfidence: 0,
    aiConfidence: null,
    aiModel: 'movers',
    aiNote: `Trending ${long ? 'UP' : 'DOWN'} ${(Math.abs(m.changePct ?? 0)).toFixed(2)}% — movers-quick entry (chart/paper-trade se, scanner grade nahi)`,
    market,
    entry: ltp,
    stopLoss: ltp - dir * risk,
    target1: ltp + dir * risk * 1.6,
    target2: ltp + dir * risk * 2.6,
    rr: 1.6,
    atr: ltp * vol,
    vwap: (m.vwapDist != null && m.ltp > 0) ? m.ltp / (1 + m.vwapDist / 100) : ltp,
    rsi: m.rsi ?? 50,
    volumeRatio: m.relVolume ?? 1,
    reasons: m.tags?.length ? [...m.tags] : ['MOVERS-QUICK'],
  };
}

function MoverRowItem({ m, isCrypto, onChart, onPaper }: {
  m: MoverRow; isCrypto: boolean;
  onChart?: (s: IntradaySignal) => void; onPaper?: (s: IntradaySignal) => void;
}) {
  const up = (m.changePct ?? 0) >= 0;
  const rsi = RSI_CONF(m.rsi);
  const vol = fmtVol(m.volume);
  return (
    <div className="px-3 py-2 hover:bg-white/[0.03] transition-colors group">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-1 h-6 rounded-full shrink-0 ${up ? 'bg-emerald-500/70' : 'bg-red-500/70'}`} />
          <span className="font-black text-white text-xs font-mono truncate">{m.symbol}</span>
          <span className="font-mono text-[11px] text-slate-400 shrink-0">{fmtLtp(m.ltp, isCrypto)}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {/* v4.5 row actions — live chart + one-click paper trade */}
          {onChart && (
            <button
              onClick={() => onChart(moverToSignal(m, isCrypto ? 'CRYPTO' : 'INDIA'))}
              className="w-6 h-6 hidden sm:flex items-center justify-center rounded-md bg-cyan-500/10 border border-cyan-500/25 text-cyan-300 text-[10px] hover:bg-cyan-500/30 transition-all font-black"
              title={`Live 5M chart — ${m.symbol}`}
            >
              📈
            </button>
          )}
          {onPaper && (
            <button
              onClick={() => onPaper(moverToSignal(m, isCrypto ? 'CRYPTO' : 'INDIA'))}
              className="w-6 h-6 hidden sm:flex items-center justify-center rounded-md bg-purple-500/10 border border-purple-500/25 text-purple-300 text-[10px] hover:bg-purple-500/30 transition-all font-black"
              title={`Virtual paper trade — ${m.symbol} (1% SL, T1 1.6R, T2 2.6R)`}
            >
              💰
            </button>
          )}
          <span className={`font-black font-mono text-xs px-1.5 py-0.5 rounded ${up ? 'text-emerald-400 bg-emerald-500/10' : 'text-red-400 bg-red-500/10'}`}>
            {up ? '▲' : '▼'} {Math.abs(m.changePct ?? 0).toFixed(2)}%
          </span>
        </div>
      </div>

      {/* Deep-analysis chips: RSI heat + VWAP + Vol + day-range */}
      <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
        {m.rsi != null && (
          <span className="flex items-center gap-1 text-[9px] font-mono" title={`RSI ${m.rsi.toFixed(0)}`}>
            <span className="w-8 h-1 bg-slate-800 rounded-full overflow-hidden inline-block">
              <span className={`block h-full ${rsi.bar}`} style={{ width: `${rsi.w}%` }} />
            </span>
            <span className={rsi.cls}>{m.rsi.toFixed(0)}</span>
          </span>
        )}
        {m.vwapDist != null && (
          <span className={`text-[9px] font-mono font-bold px-1 py-0.5 rounded border ${m.vwapDist >= 0 ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25' : 'bg-red-500/10 text-red-300 border-red-500/25'}`} title="LTP vs VWAP">
            VWAP {m.vwapDist >= 0 ? '+' : ''}{m.vwapDist.toFixed(1)}%
          </span>
        )}
        {m.relVolume != null && m.relVolume >= 1.2 && (
          <span className="text-[9px] font-mono font-bold px-1 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/25" title="Volume vs 10-day average">
            VOL {m.relVolume.toFixed(1)}x
          </span>
        )}
        {vol && (
          <span className="text-[9px] font-mono text-slate-500" title="Session volume">📊 {vol}</span>
        )}
        {m.dayRangePos != null && (
          <span className="flex items-center gap-1 text-[9px] font-mono" title={`Day range position: ${m.dayRangePos}% (0 = day low, 100 = day high)`}>
            <span className="w-10 h-1 bg-slate-800 rounded-full relative inline-block">
              <span className="absolute top-1/2 -translate-y-1/2 w-1 h-2 bg-white rounded-sm" style={{ left: `${m.dayRangePos}%` }} />
            </span>
            {m.dayRangePos}%
          </span>
        )}
      </div>

      {/* One-line Hinglish deep verdict */}
      <p className="text-[9px] text-slate-500 font-mono mt-1 truncate" title={m.analysis}>
        {m.analysis}
      </p>
    </div>
  );
}

/** Index pulse chip — NIFTY/BANKNIFTY/SENSEX/VIX (India) ya BTC/ETH (crypto). */
function IndexChip({ idx }: { idx: IndexRow }) {
  const up = idx.changePct >= 0;
  const isVix = /vix/i.test(idx.name);
  return (
    <span
      className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[10px] font-mono font-bold ${isVix
        ? 'bg-orange-500/10 border-orange-500/25 text-orange-300'
        : up
          ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300'
          : 'bg-red-500/10 border-red-500/25 text-red-300'}`}
      title={`${idx.name} — ${idx.rsi != null ? `RSI ${idx.rsi}` : 'no RSI'}${idx.vwapDist != null ? ` · VWAP ${idx.vwapDist >= 0 ? '+' : ''}${idx.vwapDist}%` : ''}`}
    >
      <span className="text-slate-400 font-black">{idx.name}</span>
      <span className="text-white">{idx.ltp >= 100000 ? `${(idx.ltp / 100000).toFixed(2)}L` : idx.ltp.toLocaleString('en-IN', { maximumFractionDigits: 1 })}</span>
      <span>{up ? '▲' : '▼'}{Math.abs(idx.changePct).toFixed(2)}%</span>
    </span>
  );
}

/** Sector heat chip — avg move + advancing/declining within the sector. */
function SectorChip({ s }: { s: SectorRow }) {
  const pct = s.avgPct;
  const heat =
    pct >= 1.5 ? 'bg-emerald-500/25 border-emerald-500/40 text-emerald-200'
    : pct >= 0.4 ? 'bg-emerald-500/12 border-emerald-500/25 text-emerald-300'
    : pct <= -1.5 ? 'bg-red-500/25 border-red-500/40 text-red-200'
    : pct <= -0.4 ? 'bg-red-500/12 border-red-500/25 text-red-300'
    : 'bg-white/5 border-white/10 text-slate-400';
  return (
    <span
      className={`px-1.5 py-0.5 rounded-md border text-[9px] font-mono font-bold ${heat}`}
      title={`${s.name}: ${s.count} scanned — ${s.advancing} adv / ${s.declining} dec · avg ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`}
    >
      {s.name} {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
      <span className="text-slate-500 ml-0.5">{s.advancing}/{s.declining}</span>
    </span>
  );
}

export const TrendingMovers = memo(function TrendingMovers({ market, onChart, onPaper }: {
  market: 'INDIA' | 'CRYPTO';
  onChart?: (s: IntradaySignal) => void;
  onPaper?: (s: IntradaySignal) => void;
}) {
  const [data, setData] = useState<MoversResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<MoverView>('gainers');
  const mountedRef = useRef(true);
  const marketRef = useRef(market);
  marketRef.current = market;
  const inFlightRef = useRef(false);

  const fetchMovers = async (silent = false) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    if (!silent) setLoading(true);
    try {
      const res = await apiFetch(`${PROXY_BASE}/api/intraday-movers?market=${marketRef.current}`, { signal: AbortSignal.timeout(20000) });
      const json: MoversResponse = await res.json();
      const respMarket = json?.market === 'CRYPTO' ? 'CRYPTO' : 'INDIA';
      if (mountedRef.current && respMarket === marketRef.current) setData(json);
    } catch { /* keep last good data */ }
    finally {
      inFlightRef.current = false;
      if (mountedRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    setData(null);           // market switch → fresh panel, no stale paint
    void fetchMovers();
    const t = window.setInterval(() => {
      if (document.visibilityState === 'visible') void fetchMovers(true);
    }, 60000);
    return () => { mountedRef.current = false; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market]);

  const isCrypto = market === 'CRYPTO';
  const br = data?.breadth;
  const advPct = br && br.scanned > 0 ? (br.advanced / br.scanned) * 100 : 50;
  const indices = data?.indices || [];
  const sectors = data?.sectors || [];
  const activeList = data?.mostActive || [];
  const list = view === 'gainers' ? (data?.gainers || []) : view === 'losers' ? (data?.losers || []) : activeList;

  const VIEW_META: Record<MoverView, { label: string; cls: string; empty: string }> = {
    gainers: { label: '📈 TOP GAINERS', cls: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/35', empty: 'koi gainer nahi' },
    losers: { label: '📉 TOP LOSERS', cls: 'bg-red-500/20 text-red-300 border border-red-500/35', empty: 'koi loser nahi' },
    active: { label: '⚡ MOST ACTIVE', cls: 'bg-amber-500/20 text-amber-300 border border-amber-500/35', empty: 'volume data nahi mila' },
  };

  return (
    <div className="quantum-panel rounded-2xl border border-cyan-500/15 overflow-hidden">
      {/* Header + index pulse + breadth strip */}
      <div className="px-4 py-3 bg-gradient-to-r from-cyan-950/30 via-slate-900/40 to-purple-950/20 border-b border-white/5">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-base">🔥</span>
            <span className="text-sm font-black text-white">
              Trending Movers — {isCrypto ? 'Crypto 24h' : 'NSE Today'}
            </span>
            <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-300 border border-cyan-500/25">
              {isCrypto ? '₿ COINDCX + TV' : '🇮🇳 GROWW + TV'}
            </span>
            {data && (
              <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border ${data.marketOpen
                ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25' : 'bg-slate-500/10 text-slate-400 border-slate-500/25'}`}>
                {data.marketOpen ? (isCrypto ? 'LIVE 24/7' : 'LIVE') : 'CLOSED — last session'}
              </span>
            )}
          </div>
          <button
            onClick={() => void fetchMovers()}
            className="quantum-btn-ghost px-2 py-1 rounded-lg text-[10px] font-black"
            title="Refresh movers"
          >
            <span className={loading ? 'inline-block animate-spin' : ''}>🔄</span>
          </button>
        </div>

        {/* v4.5 INDEX PULSE — market's headline gauges at a glance */}
        {indices.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap mt-2.5">
            {indices.map(idx => <IndexChip key={idx.symbol} idx={idx} />)}
          </div>
        )}

        {/* v4.5 SECTOR PULSE — rotated heat strip (top 5 + worst 3) */}
        {sectors.length > 1 && (
          <div className="flex items-center gap-1.5 flex-wrap mt-2">
            <span className="text-[8px] font-black uppercase tracking-wider text-slate-500">Sectors</span>
            {(() => {
              const best = sectors.slice(0, 5);
              const worst = sectors.slice(-3).reverse().filter(s => !best.includes(s));
              return [...best, ...worst].map(s => <SectorChip key={s.name} s={s} />);
            })()}
          </div>
        )}

        {/* Breadth bar: advances vs declines */}
        {br && br.scanned > 0 && (
          <div className="mt-2.5">
            <div className="flex items-center justify-between text-[9px] font-mono font-bold mb-1">
              <span className="text-emerald-400">▲ {br.advanced} advancing</span>
              <span className={br.bias === 'BULLISH' ? 'text-emerald-300' : br.bias === 'BEARISH' ? 'text-red-300' : 'text-slate-400'}>
                {br.bias} · avg {br.avgChangePct >= 0 ? '+' : ''}{br.avgChangePct.toFixed(2)}%
                {br.advanceDeclineRatio != null && ` · A/D ${br.advanceDeclineRatio.toFixed(2)}`}
              </span>
              <span className="text-red-400">▼ {br.declined} declining</span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden flex bg-slate-800">
              <div className="bg-emerald-500/80" style={{ width: `${advPct}%` }} />
              <div className="bg-slate-600/60" style={{ width: `${(br.unchanged / br.scanned) * 100}%` }} />
              <div className="bg-red-500/80 flex-1" />
            </div>
          </div>
        )}
      </div>

      {/* v4.5 View toggle — Gainers | Losers | Most Active */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-white/5 bg-black/20">
        {(['gainers', 'losers', 'active'] as MoverView[]).map(v => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`px-2.5 py-1 rounded-lg text-[9px] font-black font-mono transition-all ${view === v ? VIEW_META[v].cls : 'text-slate-500 hover:text-slate-300'}`}
          >
            {VIEW_META[v].label}
          </button>
        ))}
        {view === 'active' && (
          <span className="text-[8px] text-slate-500 font-mono ml-1" title="Session-volume leaders — participation ka sabse saaf signal">
            volume se rank hua hai
          </span>
        )}
      </div>

      {/* Active list (single column — the three views share one renderer) */}
      {!data && loading ? (
        <div className="px-4 py-6 text-center text-xs text-slate-500 font-mono">
          Movers feed load ho raha hai (TV + {isCrypto ? 'CoinDCX' : 'Groww'} batch)…
        </div>
      ) : data?.error && !list.length ? (
        <div className="px-4 py-6 text-center text-xs text-amber-400/80 font-mono">{data.error}</div>
      ) : (
        <div className="divide-y divide-white/[0.03]">
          {list.map(m => (
            <MoverRowItem key={`${view}-${m.symbol}`} m={m} isCrypto={isCrypto} onChart={onChart} onPaper={onPaper} />
          ))}
          {!list.length && (
            <div className="px-3 py-4 text-[10px] text-slate-600 font-mono text-center">{VIEW_META[view].empty}</div>
          )}
        </div>
      )}

      {data?.asOf && (
        <div className="px-4 py-1.5 border-t border-white/5 text-[9px] text-slate-600 font-mono flex justify-between">
          <span>Deep analysis: RSI · VWAP · RelVol · ADX · SMA50 · Pivots (scanner batch se, AI-free)</span>
          <span>{new Date(data.asOf).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false })} IST · 60s</span>
        </div>
      )}
    </div>
  );
});

export default TrendingMovers;
