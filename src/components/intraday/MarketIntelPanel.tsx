// ============================================================
// MarketIntelPanel — Global crypto EXTERNAL intelligence desk
// (2026-09 v4.6)
// ------------------------------------------------------------
// Data: GET /api/intraday-intel (60s server cache) — verified
// keyless free sources:
//   • CoinLobster MCP  → whale leaders, unusual-flow radar,
//                        forced liquidations, 24h movers board
//   • CoinGecko        → trending coins (retail interest gauge)
//   • alternative.me   → Crypto Fear & Greed Index
//   • HONEST source registry (Tapetide/Upstox/Bitget dead-auth
//     status) so the panel never fakes a "connected" source.
// Shown on BOTH Intraday markets — whale flow + F&G is global
// crypto context (NSE desk + crypto desk dono ke liye useful).
// Deterministic Hinglish deep analysis (server-side, zero AI
// tokens): sentiment zone, whale net-flow direction, liquidation
// skew, retail-whale divergence, thin-volume pump warning.
// Auto-refresh: 60s poll (visible tab only). No paper-trade
// bridge here — USD board coins, site paper-trade is INR-anchored
// (use Trending Movers for one-click trades).
// ============================================================
import { memo, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../utils/api';

const PROXY_BASE = import.meta.env.VITE_API_PROXY || '';

interface WhaleLeader { coin: string; netUsd24h: number | null }
interface RadarFlag { coin: string; window: string; direction: string; unusual: boolean; locked?: boolean }
interface RadarRow { coin: string; window: string; netUsd: number | null; buyUsd: number | null; sellUsd: number | null }
interface MoverCoin { coin: string; priceUsd: number | null; chgPct24h: number | null; volUsd24h: number | null }
interface TrendingCoin { symbol: string; name: string; rank: number | null; chgPct24hUsd: number | null }

interface IntelResponse {
  ok: boolean;
  asOf: string;
  latencyMs: number;
  fearGreed: { value: number; label: string; zone: string; rawLabel: string } | null;
  digest: {
    buyers: WhaleLeader[]; sellers: WhaleLeader[]; radarNow: RadarFlag[];
    topMovers: MoverCoin[]; liqLongUsd: number | null; liqShortUsd: number | null; summary: string;
  } | null;
  radar: RadarRow[] | null;
  movers: { gainers: MoverCoin[]; losers: MoverCoin[] } | null;
  trending: TrendingCoin[] | null;
  analysis: {
    bullets: string[]; bias: string; verdict: string; score: number;
    sentiment: { zone: string; value: number; note: string } | null;
    whales: { netUsd: number | null; direction: string; buySumUsd: number | null; sellSumUsd: number | null } | null;
    liquidations: { longUsd: number | null; shortUsd: number | null; longSharePct: number | null } | null;
  } | null;
  sources: { name: string; kind: string; status: string; note: string }[];
  error?: string;
}

const fmtUsd = (v: number | null) => {
  if (v == null || !Number.isFinite(v)) return '—';
  const sign = v < 0 ? '-' : '';
  const a = Math.abs(v);
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(0)}K`;
  return `${sign}$${a.toFixed(0)}`;
};

const fmtPx = (v: number | null) => {
  if (v == null || !Number.isFinite(v)) return '—';
  if (v >= 1000) return `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(5)}`;
};

/** Fear & Greed horizontal gauge (0-100) with zone marker. */
function FgGauge({ fg }: { fg: { value: number; label: string; zone: string; rawLabel?: string } }) {
  const v = Math.max(0, Math.min(100, fg.value));
  const txtCls = v <= 44 ? 'text-red-300' : v <= 55 ? 'text-amber-300' : 'text-emerald-300';
  return (
    <div className="min-w-[220px] flex-1">
      <div className="flex items-center justify-between text-[9px] font-mono font-bold mb-1">
        <span className="text-slate-500 uppercase tracking-wider">Fear &amp; Greed</span>
        <span className={txtCls}>{fg.rawLabel || fg.zone} · {fg.value}/100</span>
      </div>
      <div className="relative h-2 rounded-full overflow-hidden bg-gradient-to-r from-red-600/60 via-amber-500/50 to-emerald-500/60">
        <div className="absolute top-0 h-full w-[3px] bg-white rounded-sm shadow-[0_0_4px_rgba(255,255,255,0.8)]" style={{ left: `${v}%` }} />
      </div>
    </div>
  );
}

/** Whale leader row — coin + net flow with sign-colored bar. */
function WhaleRow({ w, max }: { w: WhaleLeader; max: number }) {
  const net = w.netUsd24h ?? 0;
  const wPct = max > 0 ? Math.min(100, (Math.abs(net) / max) * 100) : 0;
  const buy = net >= 0;
  return (
    <div className="flex items-center gap-2 text-[10px] font-mono py-0.5">
      <span className="w-10 shrink-0 font-black text-white truncate" title={w.coin}>{w.coin}</span>
      <span className="flex-1 h-1.5 rounded-full bg-slate-800 overflow-hidden relative">
        <span className={`absolute top-0 h-full rounded-full ${buy ? 'bg-emerald-500/80' : 'bg-red-500/80'}`} style={{ left: buy ? 0 : `${100 - wPct}%`, width: `${wPct}%` }} />
      </span>
      <span className={`w-14 text-right font-bold ${buy ? 'text-emerald-300' : 'text-red-300'}`}>{fmtUsd(net)}</span>
    </div>
  );
}

/** Liquidation skew — long vs short stacked bar. */
function LiqBar({ longUsd, shortUsd }: { longUsd: number | null; shortUsd: number | null }) {
  const l = longUsd ?? 0, s = shortUsd ?? 0;
  const total = l + s;
  if (total <= 0) return null;
  const lp = Math.round((l / total) * 100);
  return (
    <div className="flex-1 min-w-[220px]">
      <div className="flex items-center justify-between text-[9px] font-mono font-bold mb-1">
        <span className="text-slate-500 uppercase tracking-wider">24h Forced Liquidations</span>
        <span className="text-slate-400">{fmtUsd(total)} total</span>
      </div>
      <div className="h-2 rounded-full overflow-hidden flex bg-slate-800">
        <div className="bg-red-500/80" style={{ width: `${lp}%` }} title={`Long-side ${fmtUsd(l)} (${lp}%)`} />
        <div className="bg-cyan-500/70 flex-1" title={`Short-side ${fmtUsd(s)} (${100 - lp}%)`} />
      </div>
      <div className="flex justify-between text-[8px] font-mono text-slate-500 mt-0.5">
        <span className="text-red-400">longs {fmtUsd(l)}</span>
        <span className="text-cyan-400">shorts {fmtUsd(s)}</span>
      </div>
    </div>
  );
}

/** Compact mover coin row (CoinLobster board). */
function CoinMoverRow({ c }: { c: MoverCoin }) {
  const up = (c.chgPct24h ?? 0) >= 0;
  return (
    <div className="flex items-center justify-between gap-2 text-[10px] font-mono px-2 py-1 hover:bg-white/[0.02]">
      <span className="font-black text-white truncate w-14">{c.coin}</span>
      <span className="text-slate-400">{fmtPx(c.priceUsd)}</span>
      <span className={`font-bold w-16 text-right ${up ? 'text-emerald-300' : 'text-red-300'}`}>
        {up ? '▲' : '▼'}{Math.abs(c.chgPct24h ?? 0).toFixed(1)}%
      </span>
    </div>
  );
}

export const MarketIntelPanel = memo(function MarketIntelPanel() {
  const [data, setData] = useState<IntelResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSources, setShowSources] = useState(false);
  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);

  const fetchIntel = async (silent = false) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    if (!silent) setLoading(true);
    try {
      const res = await apiFetch(`${PROXY_BASE}/api/intraday-intel?t=${Date.now()}`, { signal: AbortSignal.timeout(30000) });
      const json: IntelResponse = await res.json();
      if (mountedRef.current) setData(json);
    } catch { /* keep last good data */ }
    finally {
      inFlightRef.current = false;
      if (mountedRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    void fetchIntel();
    const t = window.setInterval(() => {
      if (document.visibilityState === 'visible') void fetchIntel(true);
    }, 60000);
    return () => { mountedRef.current = false; clearInterval(t); };
  }, []);

  const fg = data?.fearGreed ?? null;
  const digest = data?.digest ?? null;
  const radarRows = data?.radar ?? null;
  const movers = data?.movers ?? null;
  const trending = data?.trending ?? null;
  const analysis = data?.analysis ?? null;

  const whaleMax = digest
    ? Math.max(1, ...digest.buyers.map((b) => Math.abs(b.netUsd24h ?? 0)), ...digest.sellers.map((s) => Math.abs(s.netUsd24h ?? 0)))
    : 1;

  const biasCls = analysis?.bias === 'RISK-ON' ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
    : analysis?.bias === 'RISK-OFF' ? 'bg-red-500/15 text-red-300 border-red-500/30'
    : analysis?.bias === 'CAUTIOUS-BULLISH' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
    : analysis?.bias === 'CAUTIOUS-BEARISH' ? 'bg-red-500/10 text-red-400 border-red-500/20'
    : 'bg-slate-500/10 text-slate-400 border-slate-500/20';

  const liveSources = (data?.sources || []).filter((s) => s.status === 'LIVE');

  return (
    <div className="quantum-panel rounded-2xl border border-purple-500/15 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-gradient-to-r from-purple-950/30 via-slate-900/40 to-cyan-950/20 border-b border-white/5">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-base">🛰️</span>
            <span className="text-sm font-black text-white">Global Crypto Intel</span>
            <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-300 border border-purple-500/25">
              🐋 WHALES · 📊 SENTIMENT
            </span>
            {analysis && (
              <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border ${biasCls}`}>
                {analysis.bias}
              </span>
            )}
            {liveSources.length > 0 && (
              <span className="text-[9px] font-mono text-slate-500">{liveSources.length} free sources live</span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setShowSources((s) => !s)}
              className="quantum-btn-ghost px-2 py-1 rounded-lg text-[10px] font-black"
              title="Data-source registry (honest status)"
            >
              📡
            </button>
            <button
              onClick={() => void fetchIntel()}
              className="quantum-btn-ghost px-2 py-1 rounded-lg text-[10px] font-black"
              title="Refresh intel"
            >
              <span className={loading ? 'inline-block animate-spin' : ''}>🔄</span>
            </button>
          </div>
        </div>

        {/* Gauges row: Fear&Greed + Liquidation skew */}
        {(fg || (digest?.liqLongUsd != null || digest?.liqShortUsd != null)) && (
          <div className="flex items-center gap-5 flex-wrap mt-3">
            {fg && <FgGauge fg={fg} />}
            {digest && <LiqBar longUsd={digest.liqLongUsd} shortUsd={digest.liqShortUsd} />}
          </div>
        )}
      </div>

      {/* Body */}
      {!data && loading ? (
        <div className="px-4 py-6 text-center text-xs text-slate-500 font-mono">
          Whale + sentiment intel load ho raha hai (CoinLobster MCP + CoinGecko + F&amp;G)…
        </div>
      ) : data?.error && !digest && !fg ? (
        <div className="px-4 py-6 text-center text-xs text-amber-400/80 font-mono">{data.error}</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-0 divide-y md:divide-y-0 md:divide-x divide-white/[0.03]">
          {/* LEFT: Whale leaders + radar */}
          <div className="p-3 space-y-3">
            <div>
              <p className="text-[9px] font-black uppercase tracking-wider text-slate-500 mb-1.5">🐋 24h Whale Leaders (net $ flow)</p>
              {digest && (digest.buyers.length || digest.sellers.length) ? (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[8px] font-mono font-bold text-emerald-400/70 mb-0.5 uppercase">Accumulating</p>
                    {digest.buyers.slice(0, 5).map((w) => <WhaleRow key={w.coin} w={w} max={whaleMax} />)}
                  </div>
                  <div>
                    <p className="text-[8px] font-mono font-bold text-red-400/70 mb-0.5 uppercase">Distributing</p>
                    {digest.sellers.slice(0, 5).map((w) => <WhaleRow key={w.coin} w={w} max={whaleMax} />)}
                  </div>
                </div>
              ) : (
                <p className="text-[10px] text-slate-600 font-mono">whale digest unavailable</p>
              )}
            </div>

            {/* Unusual-flow radar */}
            {radarRows && radarRows.length > 0 && (
              <div>
                <p className="text-[9px] font-black uppercase tracking-wider text-slate-500 mb-1.5">📡 Unusual Flow Radar (vs own baseline)</p>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {radarRows.slice(0, 8).map((r) => {
                    const buy = (r.netUsd ?? 0) >= 0;
                    return (
                      <span
                        key={`${r.window}-${r.coin}`}
                        className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border ${buy
                          ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25'
                          : 'bg-red-500/10 text-red-300 border-red-500/25'}`}
                        title={`${r.coin} ${r.window} window — net ${fmtUsd(r.netUsd)} (buy ${fmtUsd(r.buyUsd)} / sell ${fmtUsd(r.sellUsd)})`}
                      >
                        {r.coin} {buy ? '🟢' : '🔴'} {r.window}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Deep-analysis bullets */}
            {analysis && analysis.bullets.length > 0 && (
              <div>
                <p className="text-[9px] font-black uppercase tracking-wider text-slate-500 mb-1">🧠 Deep Analysis (deterministic)</p>
                <ul className="space-y-1">
                  {analysis.bullets.map((b, i) => (
                    <li key={i} className="text-[10px] text-slate-400 font-mono leading-relaxed flex gap-1.5">
                      <span className="text-purple-400/60 shrink-0">▸</span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* RIGHT: movers board + trending */}
          <div className="p-3 space-y-3">
            <div>
              <p className="text-[9px] font-black uppercase tracking-wider text-slate-500 mb-1.5">📊 24h Movers Board (top-300 coins)</p>
              {movers ? (
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg border border-emerald-500/15 overflow-hidden">
                    <p className="text-[8px] font-mono font-black text-emerald-400/80 px-2 py-1 bg-emerald-500/5 uppercase">Gainers</p>
                    {movers.gainers.slice(0, 6).map((c) => <CoinMoverRow key={c.coin} c={c} />)}
                  </div>
                  <div className="rounded-lg border border-red-500/15 overflow-hidden">
                    <p className="text-[8px] font-mono font-black text-red-400/80 px-2 py-1 bg-red-500/5 uppercase">Losers</p>
                    {movers.losers.slice(0, 6).map((c) => <CoinMoverRow key={c.coin} c={c} />)}
                  </div>
                </div>
              ) : (
                <p className="text-[10px] text-slate-600 font-mono">movers board unavailable</p>
              )}
            </div>

            {/* CoinGecko trending */}
            {trending && trending.length > 0 && (
              <div>
                <p className="text-[9px] font-black uppercase tracking-wider text-slate-500 mb-1.5">🔥 Retail Trending (CoinGecko searches)</p>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {trending.map((t) => {
                    const up = (t.chgPct24hUsd ?? 0) >= 0;
                    return (
                      <span
                        key={t.symbol}
                        className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border ${up
                          ? 'bg-amber-500/10 text-amber-300 border-amber-500/25'
                          : 'bg-slate-500/10 text-slate-400 border-slate-500/20'}`}
                        title={`${t.name}${t.rank != null ? ` · rank #${t.rank}` : ''} · 24h ${t.chgPct24hUsd != null ? `${up ? '+' : ''}${t.chgPct24hUsd.toFixed(1)}%` : '—'}`}
                      >
                        #{t.symbol}{up ? ' ↗' : ' ↘'}
                      </span>
                    );
                  })}
                </div>
                <p className="text-[8px] text-slate-600 font-mono mt-1">retail search interest — leading indicator, price se pehle move karta</p>
              </div>
            )}

            {/* Final verdict */}
            {analysis?.verdict && (
              <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 px-2.5 py-2">
                <p className="text-[9px] font-black uppercase tracking-wider text-purple-300/70 mb-0.5">Verdict</p>
                <p className="text-[10px] text-slate-300 font-mono leading-relaxed">{analysis.verdict}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Source registry (collapsible) */}
      {showSources && data?.sources && (
        <div className="px-3 py-2 border-t border-white/5 bg-black/20 space-y-1">
          <p className="text-[9px] font-black uppercase tracking-wider text-slate-500 mb-1">📡 Free MCP/REST source registry (reality-checked 2026-09)</p>
          {data.sources.map((s) => (
            <div key={s.name} className="flex items-center gap-2 text-[9px] font-mono">
              <span className={`font-black px-1 py-0.5 rounded border shrink-0 ${s.status === 'LIVE'
                ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25'
                : s.status === 'DOWN' ? 'bg-amber-500/10 text-amber-300 border-amber-500/25'
                : s.status === 'AUTH' ? 'bg-slate-500/10 text-slate-400 border-slate-500/25'
                : 'bg-red-500/10 text-red-300 border-red-500/25'}`}>
                {s.status}
              </span>
              <span className="text-slate-300 font-bold shrink-0">{s.name}</span>
              <span className="text-slate-600 truncate" title={s.note}>{s.note}</span>
            </div>
          ))}
          <p className="text-[8px] text-slate-600 font-mono pt-1">
            India-side free MCP keyless available nahi (Tapetide 401, Upstox demo dead, Kite/Groww broker-login) — NSE desk apne TV+Groww scanner par chalta hai.
          </p>
        </div>
      )}

      {data?.asOf && (
        <div className="px-4 py-1.5 border-t border-white/5 text-[9px] text-slate-600 font-mono flex justify-between">
          <span>Keyless sources · whale flow · F&amp;G · liquidations · zero AI tokens</span>
          <span>{new Date(data.asOf).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false })} IST · 60s{data.latencyMs != null ? ` · ${data.latencyMs}ms` : ''}</span>
        </div>
      )}
    </div>
  );
});

export default MarketIntelPanel;
