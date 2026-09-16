// ============================================================
// src/components/aitrading/ManualTradeMonitor.tsx
// ------------------------------------------------------------
// v10.16 SECTION 2C — the dedicated MANUAL TRADE tracking section
// (rendered in both desks, above the paper-trade positions).
//
// Per trade: live LTP (5s refresh — the T1-tier cadence), live P&L in
// ₹/USDT and %, distance to SL and each target, time in trade, the
// LIVE CONVICTION BAR (ensemble re-vote vs the frozen entry snapshot),
// and the escalating STATE BANNER:
//   THESIS INTACT (green) — ensemble still backs the original side
//   WEAKENING     (amber) — conviction decaying, consider tightening
//   EXIT NOW      (red, pulsing, PINNED TO TOP) — ensemble FLIPPED
//   TARGET HIT    (blue) — price reached T1/T2
// Self-contained: fetches /api/manual-trades itself (5s while open
// trades exist, 30s idle), so the tabs need zero wiring beyond
// dropping the section in.
// ============================================================
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch, getProxyBase } from '../../utils/api';

interface ManualTradeView {
  id: number;
  market: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  assetKind?: 'OPTION' | null;
  entryPrice: number;
  qty: number;
  lotSize?: number;
  strike?: number;
  expiry?: string;
  optType?: string;
  status: string;
  entryTime: number;
  openedAt: number;
  closedAt?: number;
  exitPrice?: number;
  exitPnlINR?: number;
  exitPnlPct?: number;
  closeReason?: string;
  note?: string;
  origin?: {
    aiScore: number | null;
    grade: string | null;
    regime: string | null;
    voters: number | null;
    plan: { entry: number | null; stopLoss: number | null; target1: number | null; target2: number | null; riskPct: number | null; atr: number | null } | null;
    votes: Array<{ id: string; name: string; dir: number; conf: number | null }>;
  } | null;
  __ltp?: number | null;
  __view?: {
    ltp: number | null;
    ageMin: number | null;
    pnl: { pnlINR: number; pnlPct: number; pnlUSDT: number | null; currency: 'INR' | 'USDT' };
    distances: { sl?: number | null; t1?: number | null; t2?: number | null };
    conviction: { state: string | null; delta: number | null; currentScore: number | null; entryScore: number | null };
    banner: 'THESIS_INTACT' | 'WEAKENING' | 'EXIT_NOW' | 'TARGET_HIT' | 'STALE';
  };
}

interface Props {
  /** 'INDIA' desk shows only India trades; 'CRYPTO' desk shows crypto+global; null = all. */
  desk?: 'INDIA' | 'CRYPTO' | null;
  notify?: (ok: boolean, text: string) => void;
}

const BANNER_STYLE: Record<string, { chip: string; label: string; icon: string }> = {
  THESIS_INTACT: { chip: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300', label: 'THESIS INTACT', icon: '🟢' },
  WEAKENING: { chip: 'bg-amber-500/15 border-amber-500/40 text-amber-300', label: 'WEAKENING — consider tightening', icon: '🟡' },
  EXIT_NOW: { chip: 'bg-red-500/20 border-red-500/60 text-red-300', label: 'EXIT NOW — ensemble FLIPPED', icon: '🚨' },
  TARGET_HIT: { chip: 'bg-sky-500/15 border-sky-500/40 text-sky-300', label: 'TARGET HIT', icon: '🎯' },
  STALE: { chip: 'bg-slate-500/15 border-slate-500/40 text-slate-400', label: 'STALE — conviction data missing', icon: '⏸' },
};

const pxFmt = (v: number | null | undefined, usd = false): string => {
  if (v == null || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  const dp = a >= 1000 ? 2 : a >= 1 ? 2 : a >= 0.01 ? 4 : a >= 0.0001 ? 6 : 8;
  const s = v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  return usd ? (a >= 1000 ? `$${s}` : `$${s}`) : `₹${s}`;
};

const pnlFmt = (n: number | null | undefined): string => {
  if (n == null || !Number.isFinite(n)) return '—';
  const sign = n >= 0 ? '+' : '−';
  const a = Math.abs(n);
  return a >= 1000 ? `${sign}${a >= 100000 ? (a / 100000).toFixed(2) + 'L' : Math.round(a).toLocaleString('en-IN')}` : `${sign}${a.toFixed(2)}`;
};

const ageFmt = (min: number | null): string => {
  if (min == null) return '—';
  if (min < 60) return `${Math.round(min)}m`;
  return `${Math.floor(min / 60)}h ${Math.round(min % 60)}m`;
};

/** The live conviction bar: entry score → current score, with the delta. */
const ConvictionBar = memo(function ConvictionBar({ view }: { view: NonNullable<ManualTradeView['__view']> }) {
  const c = view.conviction;
  const entry = c.entryScore ?? 0;
  const cur = c.currentScore ?? 0;
  const side = (c.state ?? '').toUpperCase();
  const barColor = side === 'FLIPPED' ? 'bg-red-500'
    : side === 'WEAKENING' ? 'bg-amber-400'
    : side === 'STRENGTHENING' ? 'bg-emerald-400'
    : 'bg-cyan-400';
  return (
    <div className="min-w-[128px]">
      <div className="flex items-center justify-between text-[9px] text-slate-500 mb-0.5">
        <span>CONVICTION</span>
        <span className="text-slate-400 font-mono">
          {entry ? Math.round(entry) : '—'} → {cur ? Math.round(cur) : '—'}
          {c.delta != null && (
            <span className={c.delta >= 0 ? 'text-emerald-400' : 'text-red-400'}> ({c.delta >= 0 ? '+' : ''}{c.delta})</span>
          )}
        </span>
      </div>
      <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden flex">
        <div className="h-full bg-slate-600/70" style={{ width: `${Math.min(100, Math.max(0, entry))}%` }} />
        <div className={`h-full ${barColor} transition-all duration-700`} style={{ width: `${Math.max(0, Math.min(100, cur) - Math.min(100, Math.max(0, entry)))}%` }} />
      </div>
    </div>
  );
});

/** One open manual trade row. */
const ManualRow = memo(function ManualRow({ t, onClose, busy }: { t: ManualTradeView; onClose: (t: ManualTradeView) => void; busy: boolean }) {
  const v = t.__view;
  const usd = t.market === 'FUTURES' || t.market === 'GLOBALFUTURES';
  const banner = v?.banner ?? 'STALE';
  const bs = BANNER_STYLE[banner] ?? BANNER_STYLE.STALE;
  const pnl = v?.pnl;
  const dist = v?.distances ?? {};
  const long = t.side === 'BUY';
  return (
    <div className={`rounded-xl border p-3 space-y-2.5 transition-all
      ${banner === 'EXIT_NOW' ? 'border-red-500/50 bg-red-950/30 animate-pulse' : 'border-slate-700/50 bg-slate-900/40'}`}>
      {/* line 1: identity + banner */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-black text-slate-100 truncate">{t.symbol}</span>
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${long ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
            {long ? 'LONG' : 'SHORT'}
          </span>
          {t.assetKind === 'OPTION' && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300">
              {t.optType} {t.strike} · {t.expiry}
            </span>
          )}
          <span className="text-[10px] text-slate-500">{t.market}</span>
        </div>
        <span className={`text-[10px] font-black px-2 py-1 rounded-lg border ${bs.chip}`}>
          {bs.icon} {bs.label}
        </span>
      </div>

      {/* line 2: price + P&L + distances */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
        <div>
          <div className="text-slate-500 text-[9px] uppercase tracking-wide font-bold">Entry → Live</div>
          <div className="font-mono text-slate-200">
            {pxFmt(t.entryPrice, usd)} → <b className="text-cyan-300">{pxFmt(v?.ltp, usd)}</b>
          </div>
        </div>
        <div>
          <div className="text-slate-500 text-[9px] uppercase tracking-wide font-bold">P&L ({pnl?.currency === 'USDT' ? 'USDT' : 'INR'})</div>
          <div className={`font-mono font-bold ${(pnl?.pnlPct ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {pnlFmt(pnl?.currency === 'USDT' ? pnl?.pnlUSDT : pnl?.pnlINR)} · {pnl?.pnlPct != null ? `${pnl.pnlPct >= 0 ? '+' : ''}${pnl.pnlPct.toFixed(2)}%` : '—'}
          </div>
        </div>
        <div>
          <div className="text-slate-500 text-[9px] uppercase tracking-wide font-bold">SL / T1 / T2 dist</div>
          <div className="font-mono text-slate-300">
            <span className="text-red-400/90">{dist.sl != null ? `${dist.sl.toFixed(1)}%` : '—'}</span>
            {' / '}
            <span className="text-emerald-400/90">{dist.t1 != null ? `${dist.t1.toFixed(1)}%` : '—'}</span>
            {' / '}
            <span className="text-emerald-300/90">{dist.t2 != null ? `${dist.t2.toFixed(1)}%` : '—'}</span>
          </div>
        </div>
        <div>
          <div className="text-slate-500 text-[9px] uppercase tracking-wide font-bold">Time in trade</div>
          <div className="font-mono text-slate-300">{ageFmt(v?.ageMin ?? null)}</div>
        </div>
      </div>

      {/* line 3: conviction bar + snapshot chips + close */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <ConvictionBar view={v!} />
        <div className="flex items-center gap-2 flex-wrap">
          {t.origin?.aiScore != null && (
            <span className="text-[9px] text-slate-500 border border-slate-700/50 rounded px-1.5 py-0.5">
              entry AI {Math.round(t.origin.aiScore)} · {t.origin.grade ?? '—'}{t.origin.voters ? ` · ${t.origin.voters} voters` : ''}
            </span>
          )}
          {t.origin?.regime && (
            <span className="text-[9px] text-slate-500 border border-slate-700/50 rounded px-1.5 py-0.5">{t.origin.regime}</span>
          )}
          <button onClick={() => onClose(t)} disabled={busy}
            className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600/60 text-slate-200 disabled:opacity-40">
            CLOSE @ LIVE
          </button>
        </div>
      </div>

      {banner === 'EXIT_NOW' && (
        <div className="text-[11px] text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-2.5 py-1.5">
          🚨 <b>Ensemble ab opposite side vote kar raha hai</b> — thesis invalid. SL pe wait karne ki jagah ab exit judge karo.
          Telegram pe <b>kyon</b> (kaunse models flip hue) ka push already gaya hai.
        </div>
      )}
      {banner === 'WEAKENING' && (
        <div className="text-[11px] text-amber-300/90 bg-amber-500/10 border border-amber-500/30 rounded-lg px-2.5 py-1.5">
          🟡 Conviction decay ho rahi hai — SL ko breakeven/T1 ki taraf tighten karna consider karo (noise se churn nahi, sirf protect).
        </div>
      )}
    </div>
  );
});

/** One closed manual trade row (compact history). */
const ClosedRow = memo(function ClosedRow({ t }: { t: ManualTradeView }) {
  const won = (t.exitPnlPct ?? 0) >= 0;
  const usd = t.market === 'FUTURES' || t.market === 'GLOBALFUTURES';
  return (
    <div className="flex items-center justify-between gap-2 text-[11px] py-1.5 border-b border-slate-800/60 last:border-0">
      <div className="flex items-center gap-2 min-w-0">
        <span className="font-bold text-slate-300 truncate">{t.symbol}</span>
        <span className={t.side === 'BUY' ? 'text-emerald-500' : 'text-red-500'}>{t.side === 'BUY' ? 'L' : 'S'}</span>
        {t.assetKind === 'OPTION' && <span className="text-[9px] text-violet-400">{t.optType} {t.strike}</span>}
      </div>
      <div className="flex items-center gap-3 text-slate-500 shrink-0">
        <span className="font-mono">{pxFmt(t.entryPrice, usd)} → {pxFmt(t.exitPrice, usd)}</span>
        <span className={`font-mono font-bold ${won ? 'text-emerald-400' : 'text-red-400'}`}>
          {t.exitPnlPct != null ? `${won ? '+' : ''}${t.exitPnlPct.toFixed(2)}%` : '—'}
          {t.exitPnlINR != null && !usd && ` · ${pnlFmt(t.exitPnlINR)}`}
        </span>
        <span className="text-[9px] max-w-[90px] truncate">{t.closeReason}</span>
      </div>
    </div>
  );
});

export function ManualTradeMonitor({ desk, notify }: Props) {
  const [trades, setTrades] = useState<ManualTradeView[] | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const activeRef = useRef(true);
  const tradesRef = useRef<ManualTradeView[] | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch(`${getProxyBase()}/api/manual-trades`, { signal: AbortSignal.timeout(20000) })
        .then(x => x.json()).catch(() => null);
      if (!r?.ok) { setError(true); return; }
      setError(false);
      let list: ManualTradeView[] = r.trades || [];
      if (desk === 'INDIA') list = list.filter(t => t.market === 'INDIA');
      else if (desk === 'CRYPTO') list = list.filter(t => t.market !== 'INDIA');
      setTrades(list);
    } catch { setError(true); }
  }, [desk]);

  // 5s refresh while open trades exist (the plan's T1-tier cadence —
  // the monitor's LTP sweep is already running server-side; this just
  // repaints), 30s when idle.
  useEffect(() => {
    activeRef.current = true;
    load();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      const openCount = (tradesRef.current || []).filter(t => t.status === 'OPEN').length;
      timer = setTimeout(async () => {
        if (!activeRef.current) return;
        await load();
        schedule();
      }, openCount > 0 ? 5000 : 30000);
    };
    schedule();
    return () => { activeRef.current = false; if (timer) clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  useEffect(() => { tradesRef.current = trades; }, [trades]);

  const close = useCallback(async (t: ManualTradeView) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await apiFetch(`${getProxyBase()}/api/manual-trade/${t.id}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }).then(x => x.json()).catch(() => ({ ok: false, error: 'network error' }));
      if (r.ok) notify?.(true, `✅ ${t.symbol} closed @ ${r.trade?.exitPrice} · P&L ${r.pnl?.pnlPct?.toFixed(2)}%`);
      else notify?.(false, `⛔ ${r.error || 'close failed'}`);
      await load();
    } finally { setBusy(false); }
  }, [busy, notify, load]);

  const open = (trades || []).filter(t => t.status === 'OPEN');
  const closed = (trades || []).filter(t => t.status === 'CLOSED');
  const exitNow = open.filter(t => t.__view?.banner === 'EXIT_NOW');
  const rest = open.filter(t => t.__view?.banner !== 'EXIT_NOW');

  if (trades && open.length === 0 && closed.length === 0) {
    // No trades yet — the section stays collapsed to a single hint line
    // (the button on signal cards is the entry point).
    return (
      <div className="text-[11px] text-slate-600 border border-dashed border-slate-800/60 rounded-xl px-3 py-2.5">
        📝 Manual Trade Tracker — signal card pe <b className="text-slate-500">"✋ Maine ye trade liya hai"</b> button se apna REAL trade record karo; yahan live conviction tracking milegi.
      </div>
    );
  }

  return (
    <div className="quantum-panel rounded-2xl p-3.5 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <div className="text-xs font-black text-slate-100 flex items-center gap-1.5">
            ✋ MANUAL TRADE TRACKER
            {open.length > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">{open.length} open</span>}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">
            aapke REAL trades — live LTP (5s) · P&L · SL/T distances · <span className="text-cyan-400">ensemble conviction re-vote (30s)</span> vs entry snapshot
          </div>
        </div>
        <div className="flex items-center gap-2">
          {closed.length > 0 && (
            <button onClick={() => setShowClosed(s => !s)}
              className="text-[10px] font-bold px-2 py-1 rounded-lg bg-slate-800/70 hover:bg-slate-700/70 border border-slate-700/50 text-slate-400">
              {showClosed ? 'hide' : 'show'} closed ({closed.length})
            </button>
          )}
          <span className={`text-[9px] px-1.5 py-0.5 rounded border flex items-center gap-1
            ${error ? 'text-red-400 border-red-500/30 bg-red-500/10' : 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${error ? 'bg-red-400' : 'bg-emerald-400 animate-pulse'}`} />
            {error ? 'LIVE OFF' : 'LIVE 5s'}
          </span>
        </div>
      </div>

      {error && <div className="text-[11px] text-red-400/80">tracker fetch fail — retry ho raha hai…</div>}

      {/* EXIT NOW rows pinned to the top — the highlighted exit line */}
      {exitNow.map(t => <ManualRow key={t.id} t={t} onClose={close} busy={busy} />)}
      {rest.map(t => <ManualRow key={t.id} t={t} onClose={close} busy={busy} />)}

      {showClosed && closed.length > 0 && (
        <div className="pt-1">
          <div className="text-[9px] uppercase tracking-wide font-bold text-slate-600 mb-1">Closed ({closed.length})</div>
          {closed.slice(0, 20).map(t => <ClosedRow key={t.id} t={t} />)}
        </div>
      )}

      {open.length === 0 && closed.length > 0 && (
        <div className="text-[11px] text-slate-600">koi open manual trade nahi — sab closed me hai ✅</div>
      )}
    </div>
  );
}
