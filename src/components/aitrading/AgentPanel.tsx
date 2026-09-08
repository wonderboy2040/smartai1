// ============================================================
// src/components/aitrading/AgentPanel.tsx — SUPERINTELLIGENCE
// AUTO-AGENT console (v6.8)
// ------------------------------------------------------------
// The autonomous desk in ONE panel:
//   ┌ AGENT STATUS     running/idle/paused · mode · scans · uptime
//   ├ WALLET           live CoinDCX balance fetch — spot INR/USDT +
//   │                  futures margin + equity (kitna bacha hai)
//   ├ 3-TRADE METER    daily quota slots · realized P&L · loss cap
//   ├ CONFIG           risk%/trade · min conf · leverage · hold · cooldown
//   ├ OPEN POSITIONS   age vs time-exit · SL/TP · margin
//   ├ TODAY'S TRADES   fill log with sizes + reasons
//   ├ TOP PICKS        India intraday + futures + spot STRONG picks
//   └ LIVE LOG         every scan decision (entry/skip/exit/error)
//
// The agent runs SERVER-SIDE (60s loop). This panel polls /api/ai/agent
// every 15s — start/stop are real API calls, not local state.
// ============================================================
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { fetchAgentStatus, startAgent, stopAgent, saveAgentConfig, fetchWallet } from './useAITrading';
import type { AgentView, AgentLogLine, AgentPick, WalletView } from './types';

const POLL_MS = 15_000;

const fmtINR = (n: number | null | undefined, dp = 0) => {
  if (n == null || !Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`;
  if (Math.abs(n) >= 1e5) return `₹${(n / 1e5).toFixed(2)}L`;
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: dp })}`;
};
const fmtUSDT = (n: number | null | undefined, dp = 2) =>
  n == null || !Number.isFinite(n) ? '—' : `${n.toLocaleString('en-US', { maximumFractionDigits: dp })} USDT`;
const ago = (ts: number | null) => {
  if (!ts) return '—';
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
};

const LOG_STYLE: Record<string, string> = {
  entry: 'text-emerald-300',
  exit: 'text-orange-300',
  error: 'text-red-400',
  skip: 'text-slate-500',
  info: 'text-cyan-300',
};

function WalletCard({ wallet }: { wallet: WalletView | null }) {
  if (!wallet) {
    return (
      <div className="bg-black/25 rounded-xl p-3 text-[11px] text-slate-500">
        <div className="font-black text-slate-400 mb-1">📱 COINDCX WALLET</div>
        <div>Wallet fetch pending / API key not connected — agent paper mode equity ₹10,000 practice budget use karega.</div>
      </div>
    );
  }
  const fut = wallet.futures?.usdt as { free?: number; locked?: number; total?: number } | undefined;
  const spotINR = wallet.spot?.inr as { free?: number; locked?: number; total?: number } | undefined;
  const spotUSDT = wallet.spot?.usdt as { free?: number; locked?: number; total?: number } | undefined;
  return (
    <div className="bg-black/25 rounded-xl p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-black text-amber-300 tracking-wider">📱 COINDCX WALLET · LIVE</span>
        <span className="text-[9px] font-mono text-slate-500">{ago(wallet.fetchedAt)}</span>
      </div>
      <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono">
        <div className="bg-black/30 rounded-lg px-2 py-1.5">
          <div className="text-slate-500 text-[9px] font-bold">TOTAL EQUITY</div>
          <div className="text-emerald-300 font-black text-xs">{fmtINR(wallet.equityINR, 0)}</div>
        </div>
        <div className="bg-black/30 rounded-lg px-2 py-1.5">
          <div className="text-slate-500 text-[9px] font-bold">FUTURES MARGIN (USDT)</div>
          <div className="text-cyan-300 font-black text-xs">{fmtUSDT(fut?.free)}</div>
          <div className="text-slate-500 text-[9px]">locked {fmtUSDT(fut?.locked)} · ≈ {fmtINR((fut?.total ?? 0) * (wallet.usdInr || 84))}</div>
        </div>
        <div className="bg-black/30 rounded-lg px-2 py-1.5">
          <div className="text-slate-500 text-[9px] font-bold">SPOT INR</div>
          <div className="text-slate-200 font-black">{fmtINR(spotINR?.free)}</div>
          <div className="text-slate-500 text-[9px]">locked {fmtINR(spotINR?.locked)}</div>
        </div>
        <div className="bg-black/30 rounded-lg px-2 py-1.5">
          <div className="text-slate-500 text-[9px] font-bold">SPOT USDT</div>
          <div className="text-slate-200 font-black">{fmtUSDT(spotUSDT?.free)}</div>
          <div className="text-slate-500 text-[9px]">USD/₹ {wallet.usdInr ?? '—'}</div>
        </div>
      </div>
      {(wallet.spot?.error || wallet.futures?.error) && (
        <div className="text-[9px] text-amber-500/80 mt-1.5 font-mono">
          ⚠ {wallet.spot?.error || wallet.futures?.error}
        </div>
      )}
      <div className="text-[9px] text-slate-500 mt-1.5">
        Agent in futures trades sirf {fmtUSDT(wallet.deployableFuturesUSDT)} free margin ka 60% tak use karta hai — liquidation buffer hamesha bacha rehta hai.
      </div>
    </div>
  );
}

function TradeSlots({ used, total, pnlINR, lossCapINR }: { used: number; total: number; pnlINR: number; lossCapINR: number }) {
  return (
    <div className="bg-black/25 rounded-xl p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-black text-cyan-300 tracking-wider">⚡ DAILY TRADE QUOTA</span>
        <span className={`font-mono text-[10px] font-black ${pnlINR > 0 ? 'text-emerald-400' : pnlINR < 0 ? 'text-red-400' : 'text-slate-400'}`}>
          today {pnlINR > 0 ? '+' : ''}{fmtINR(pnlINR)}
        </span>
      </div>
      <div className="flex gap-1.5 mb-1.5">
        {Array.from({ length: Math.min(total, 10) }).map((_, i) => (
          <div key={i} className={`flex-1 h-6 rounded-md flex items-center justify-center text-[10px] font-black font-mono border ${i < used
            ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
            : 'bg-black/30 text-slate-500 border-slate-700/40'}`}>
            {i < used ? '✓' : i + 1}
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[9px] font-mono text-slate-500">
        <span>{used}/{total} trades used · resets IST midnight</span>
        <span>loss cap −{fmtINR(lossCapINR)}</span>
      </div>
    </div>
  );
}

type CfgKey = 'maxTradesPerDay' | 'minConfidence' | 'riskPerTradePct' | 'maxLeverage' | 'maxHoldMin' | 'cooldownMin' | 'dailyLossCapPct';
const CFG_FIELDS: { key: CfgKey; label: string; min: number; max: number; step: number; suffix: string; hint: string }[] = [
  { key: 'maxTradesPerDay', label: 'Trades/day', min: 1, max: 10, step: 1, suffix: '', hint: 'user spec: 3' },
  { key: 'minConfidence', label: 'Min confidence', min: 55, max: 95, step: 1, suffix: '%', hint: 'agent STRONG bar' },
  { key: 'riskPerTradePct', label: 'Risk/trade', min: 0.25, max: 10, step: 0.25, suffix: '%', hint: '% of wallet equity' },
  { key: 'maxLeverage', label: 'Max leverage', min: 1, max: 10, step: 1, suffix: 'x', hint: 'futures ceiling' },
  { key: 'maxHoldMin', label: 'Max hold', min: 5, max: 480, step: 5, suffix: 'm', hint: 'time-exit' },
  { key: 'cooldownMin', label: 'Cooldown', min: 1, max: 240, step: 1, suffix: 'm', hint: 'between entries' },
  { key: 'dailyLossCapPct', label: 'Day loss cap', min: 0.5, max: 50, step: 0.5, suffix: '%', hint: 'stand-down' },
];

function AgentConfigEditor({ cfg, onSaved }: { cfg: AgentView['config']; onSaved: (ok: boolean, msg: string) => void }) {
  const [draft, setDraft] = useState<Partial<Record<CfgKey, number>>>({});
  const [saving, setSaving] = useState(false);
  const dirty = Object.keys(draft).length > 0;
  const save = async () => {
    setSaving(true);
    const r = await saveAgentConfig(draft);
    setSaving(false);
    if (r.ok) { setDraft({}); onSaved(true, '✅ Agent config saved — next scan se live'); }
    else onSaved(false, `⛔ ${r.error}`);
  };
  return (
    <div className="bg-black/25 rounded-xl p-3">
      <div className="text-[10px] font-black text-violet-300 tracking-wider mb-2">⚙ AGENT RULES (server-side enforced)</div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
        {CFG_FIELDS.map(f => {
          const value = draft[f.key] != null ? draft[f.key] : Number(cfg[f.key]);
          return (
            <label key={f.key} className="bg-black/30 rounded-lg px-2 py-1.5 block" title={f.hint}>
              <div className="flex justify-between items-baseline">
                <span className="text-[9px] font-bold text-slate-500">{f.label}</span>
                <span className="text-[10px] font-mono font-black text-slate-200">{value}{f.suffix}</span>
              </div>
              <input type="range" min={f.min} max={f.max} step={f.step} value={value}
                onChange={e => setDraft(d => ({ ...d, [f.key]: Number(e.target.value) }))}
                className="w-full h-1 mt-1 accent-cyan-500 cursor-pointer" aria-label={f.label} />
            </label>
          );
        })}
      </div>
      <div className="flex items-center gap-2 mt-2">
        <button onClick={save} disabled={!dirty || saving}
          className={`px-3 py-1.5 rounded-lg text-[10px] font-black transition-colors ${dirty && !saving ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 hover:bg-cyan-500/30' : 'bg-black/30 text-slate-500 border border-slate-700/40'}`}>
          {saving ? 'saving…' : dirty ? 'SAVE RULES' : 'saved'}
        </button>
        {dirty && <span className="text-[9px] text-amber-400/80 font-mono">unsaved changes</span>}
        <span className="ml-auto text-[9px] font-mono text-slate-500">
          agent STRONG bar: {Number(cfg.minConfidence)}% + {Math.round(Number(cfg.minAgreement) * 100)}% agreement (manual se strict)
        </span>
      </div>
    </div>
  );
}

function OpenPositions({ positions }: { positions: AgentView['openPositions'] }) {
  if (positions.length === 0) {
    return <div className="bg-black/25 rounded-xl p-3 text-[11px] text-slate-500">No open agent positions — agent scans every 60s, entry sirf top-conviction signal par.</div>;
  }
  return (
    <div className="bg-black/25 rounded-xl p-3 space-y-1.5">
      <div className="text-[10px] font-black text-orange-300 tracking-wider mb-1">🤖 OPEN AGENT POSITIONS — AUTO-EXIT ARMED</div>
      {positions.map(p => {
        const holdPct = p.ageMin != null ? Math.min(100, (p.ageMin / Math.max(1, p.maxHoldMin)) * 100) : 0;
        return (
          <div key={p.id} className="bg-black/30 rounded-lg px-2.5 py-2">
            <div className="flex items-center gap-2 flex-wrap text-[10px] font-mono font-bold">
              <span className={p.side === 'LONG' ? 'text-emerald-400' : 'text-red-400'}>{p.side}</span>
              <span className="text-slate-200">{p.pair}</span>
              <span className="text-slate-400">{p.mode.toUpperCase()}</span>
              {p.leverage != null && <span className="text-amber-300">{p.leverage}x</span>}
              <span className="text-slate-300">{p.qty} @ {p.entryPrice}</span>
              <span className="text-slate-500">SL {p.sl ?? '—'} · T2 {p.tp2 ?? '—'}</span>
              {p.marginUSDT != null && <span className="text-cyan-300">margin {p.marginUSDT} USDT</span>}
              <span className="ml-auto text-slate-400">{p.ageMin ?? '?'}m old</span>
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <div className="flex-1 h-1 rounded-full bg-black/40 overflow-hidden" role="img" aria-label="time to auto exit">
                <div className={`h-full rounded-full ${holdPct > 80 ? 'bg-red-500/70' : 'bg-orange-400/60'}`} style={{ width: `${holdPct}%` }} />
              </div>
              <span className="text-[9px] font-mono text-slate-500">time-exit {p.maxHoldMin}m</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TodayTrades({ trades }: { trades: AgentView['today']['trades'] }) {
  if (trades.length === 0) {
    return <div className="bg-black/25 rounded-xl p-3 text-[11px] text-slate-500">Aaj koi agent trade abhi nahi — STRONG setup ka intezaar.</div>;
  }
  return (
    <div className="bg-black/25 rounded-xl p-3 space-y-1.5">
      <div className="text-[10px] font-black text-emerald-300 tracking-wider mb-1">📋 TODAY'S AGENT TRADES</div>
      {trades.slice().reverse().map((t, i) => (
        <div key={`${t.ts}-${i}`} className="bg-black/30 rounded-lg px-2.5 py-1.5 flex items-center gap-2 flex-wrap text-[10px] font-mono">
          <span className="text-slate-500">{new Date(t.ts).toLocaleTimeString('en-IN', { hour12: false })}</span>
          <span className={t.side === 'LONG' ? 'text-emerald-400' : 'text-red-400'}>{t.side}</span>
          <span className="text-slate-200">{t.pair}</span>
          <span className="text-slate-500">{t.mode.toUpperCase()}</span>
          {t.leverage != null && <span className="text-amber-300">{t.leverage}x</span>}
          {t.qty != null && <span className="text-slate-300">{t.qty} @ {t.price}</span>}
          {t.marginUSDT != null && <span className="text-cyan-300">m {t.marginUSDT} USDT</span>}
          <span className={`ml-auto px-1.5 py-0.5 rounded text-[9px] font-black ${t.status === 'FILLED' || t.status === 'SUBMITTED' ? 'bg-emerald-500/15 text-emerald-300' : t.status === 'REJECTED' ? 'bg-red-500/15 text-red-300' : 'bg-slate-600/20 text-slate-400'}`}>{t.status}</span>
          {t.reason && <div className="w-full text-[9px] text-slate-500 truncate" title={t.reason}>{t.reason}</div>}
        </div>
      ))}
    </div>
  );
}

function PickStrip({ title, picks, accent }: { title: string; picks: AgentPick[] | undefined | null; accent: string }) {
  if (!picks || picks.length === 0) return null;
  return (
    <div className="bg-black/25 rounded-xl p-3">
      <div className={`text-[10px] font-black ${accent} tracking-wider mb-2`}>{title}</div>
      {/* v6.10: roomier pick cards — 2-per-row on sm+ (was 3, too
          cramped), E/SL/T2 plan chips with labels + color coding,
          grade pill instead of floating text, conf as a mini bar. */}
      <div className="grid gap-2 sm:grid-cols-2">
        {picks.map((pick) => (
          <div key={pick.symbol} className="bg-black/30 rounded-lg px-2.5 py-2 space-y-1.5">
            <div className="flex items-center gap-2">
              <span className={`px-1.5 py-0.5 rounded text-[9px] font-black ${pick.side === 'LONG' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300'}`}>{pick.side}</span>
              <span className="text-[11px] text-slate-100 font-black font-mono">{pick.symbol}</span>
              <span className="ml-auto text-[9px] font-black text-amber-300/90 bg-amber-500/10 border border-amber-500/25 rounded px-1.5 py-0.5">{pick.grade}</span>
            </div>
            <div className="flex items-center gap-1.5" title="model confidence">
              <div className="flex-1 h-1 rounded-full bg-black/40 overflow-hidden">
                <div className="h-full rounded-full bg-cyan-500/60" style={{ width: `${Math.min(100, Math.max(0, pick.confidence ?? 0))}%` }} />
              </div>
              <span className="text-[9px] text-slate-400 font-mono font-bold shrink-0">{pick.confidence}%</span>
            </div>
            {pick.plan && (
              <div className="flex items-center gap-1 flex-wrap text-[9px] font-mono">
                <span className="px-1.5 py-0.5 rounded bg-black/40 text-slate-400" title="entry">E {pick.plan.entry}</span>
                <span className="px-1.5 py-0.5 rounded bg-red-500/10 text-red-300/90" title="stop loss">SL {pick.plan.stopLoss}</span>
                <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300/90" title="target 2">T2 {pick.plan.target2}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function LogFeed({ log }: { log: AgentLogLine[] }) {
  return (
    <div className="bg-black/25 rounded-xl p-3">
      <div className="text-[10px] font-black text-slate-400 tracking-wider mb-1.5">🛰 AGENT LOG (live — every 60s scan)</div>
      <div className="max-h-44 overflow-y-auto space-y-0.5 font-mono text-[10px]">
        {log.length === 0 && <div className="text-slate-500">no log lines yet — agent start karo</div>}
        {log.map((l, i) => (
          <div key={`${l.ts}-${i}`} className="flex gap-2">
            <span className="text-slate-500 shrink-0">{new Date(l.ts).toLocaleTimeString('en-IN', { hour12: false })}</span>
            <span className={LOG_STYLE[l.level] || 'text-slate-300'}>{l.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export const AgentPanel = memo(function AgentPanel({ notify }: { notify: (ok: boolean, text: string) => void }) {
  const [view, setView] = useState<AgentView | null>(null);
  const [wallet, setWallet] = useState<WalletView | null>(null);
  const [busy, setBusy] = useState(false);
  const [livePhrase, setLivePhrase] = useState('');
  const [showLive, setShowLive] = useState(false);
  const viewRef = useRef(view);
  viewRef.current = view;

  const load = useCallback(async () => {
    const v = await fetchAgentStatus();
    if (v) setView(v);
  }, []);
  const loadWallet = useCallback(async () => {
    const w = await fetchWallet();
    if (w) setWallet(w);
  }, []);

  useEffect(() => {
    load();
    loadWallet();
    const t = setInterval(() => { if (!document.hidden) load(); }, POLL_MS);
    const w = setInterval(() => { if (!document.hidden) loadWallet(); }, 60_000);
    return () => { clearInterval(t); clearInterval(w); };
  }, [load, loadWallet]);

  const cfg = view?.config;
  const running = !!view?.state?.running;
  const paused = view?.today?.paused || view?.state?.pausedToday;
  const liveArmed = view?.trading?.mode === 'live' && view?.trading?.allowAuto && view?.trading?.connected;

  const onStart = useCallback(async (mode: 'paper' | 'live' | 'notify') => {
    setBusy(true);
    const r = await startAgent(mode, mode === 'live' ? livePhrase : undefined);
    setBusy(false);
    if (r.ok) {
      notify(true, mode === 'live'
        ? '🔴 SUPERINTELLIGENCE AGENT LIVE — wallet se real orders, max 3/day, auto entry+exit armed'
        : mode === 'notify'
          ? '🔔 Agent NOTIFY mode live — STRONG signals Telegram par pingenge, koi order nahi'
          : '🧠 Agent PAPER mode live — wallet-based sizing ke saath practice trades');
      setShowLive(false); setLivePhrase('');
      load();
    } else {
      notify(false, `⛔ ${r.error}`);
    }
  }, [livePhrase, notify, load]);

  const onStop = useCallback(async () => {
    setBusy(true);
    const r = await stopAgent();
    setBusy(false);
    if (r.ok) { notify(true, '⏹ Agent stopped — open positions watcher se manage honge'); load(); }
    else notify(false, `⛔ ${r.error}`);
  }, [notify, load]);

  if (!view) {
    return (
      <div className="quantum-panel rounded-2xl p-6 text-center">
        <div className="text-3xl mb-2 animate-float">🤖</div>
        <div className="text-xs text-slate-400 font-bold">Loading Superintelligence Agent…</div>
      </div>
    );
  }

  const statusChip = running
    ? (paused ? { text: `STOOD DOWN — ${paused.reason?.slice(0, 60)}`, cls: 'bg-amber-500/15 text-amber-300 border-amber-500/40' }
      : { text: `RUNNING · ${view.config.mode.toUpperCase()} · scan ${ago(view.state.lastScanAt)}`, cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40 animate-pulse' })
    : { text: 'STOPPED', cls: 'bg-slate-600/20 text-slate-400 border-slate-600/30' };

  return (
    <div className="quantum-panel rounded-2xl p-4 bg-gradient-to-r from-cyan-500/[0.07] via-transparent to-amber-500/[0.05]">
      {/* header */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className={`text-2xl ${running && !paused ? 'animate-float' : ''}`}>🤖</span>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-black gradient-text-cyan tracking-wide">SUPERINTELLIGENCE AUTO-AGENT</h3>
              <span className="quantum-badge">v6.8</span>
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">
              wallet-fetch · auto entry/exit · {cfg?.maxTradesPerDay ?? 3} trades/day · SL-based sizing · time-exit · native TP/SL · 60s server loop
            </div>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <span className={`px-2.5 py-1 rounded-lg border text-[10px] font-black font-mono ${statusChip.cls}`} role="status">
            {statusChip.text}
          </span>
          {running ? (
            <button onClick={onStop} disabled={busy}
              className="px-4 py-2 rounded-xl text-xs font-black bg-red-500/15 text-red-300 border border-red-500/40 hover:bg-red-500/25 disabled:opacity-50">
              ⏹ STOP
            </button>
          ) : (
            <>
              <button onClick={() => onStart('paper')} disabled={busy}
                className="px-4 py-2 rounded-xl text-xs font-black bg-cyan-500/15 text-cyan-300 border border-cyan-500/40 hover:bg-cyan-500/25 disabled:opacity-50">
                ▶ START PAPER
              </button>
              <button onClick={() => onStart('notify')} disabled={busy}
                title="NOTIFY mode (v6.11) — agent STRONG signals dhoondhega aur Telegram par alert karega. Koi order/place position nahi — 3/day quota bhi nahi jalta."
                className="px-4 py-2 rounded-xl text-xs font-black bg-sky-500/15 text-sky-300 border border-sky-500/40 hover:bg-sky-500/25 disabled:opacity-50">
                🔔 START NOTIFY
              </button>
              <button onClick={() => setShowLive(s => !s)} disabled={busy || !liveArmed}
                className={`px-4 py-2 rounded-xl text-xs font-black border disabled:opacity-40 ${liveArmed ? 'bg-red-500/15 text-red-300 border-red-500/40 hover:bg-red-500/25' : 'bg-black/30 text-slate-500 border-slate-700/40'}`}
                title={liveArmed ? 'Real orders — typed LIVE confirmation' : 'Pehle Risk settings me mode LIVE (typed) + Auto-execution ON karo'}>
                🔴 START LIVE
              </button>
            </>
          )}
        </div>
      </div>

      {!liveArmed && !running && (
        <div className="text-[10px] text-slate-500 mt-2 font-mono">
          LIVE ke liye: Execution Console → Risk settings → mode LIVE (type "LIVE") + Auto-execution ON + CoinDCX connected. Agent LIVE start par bhi typed "LIVE" maangta hai.
        </div>
      )}

      {showLive && (
        <div className="mt-2 bg-red-500/[0.07] border border-red-500/30 rounded-xl p-3 flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-black text-red-300">TYPE "LIVE" TO ARM REAL ORDERS:</span>
          <input value={livePhrase} onChange={e => setLivePhrase(e.target.value)} placeholder="LIVE"
            className="bg-black/40 border border-red-500/30 rounded-lg px-2 py-1 text-xs font-mono w-28 text-slate-200" aria-label="live confirmation phrase" />
          <button onClick={() => onStart('live')} disabled={busy || livePhrase.trim().toUpperCase() !== 'LIVE'}
            className="px-3 py-1.5 rounded-lg text-[10px] font-black bg-red-500/25 text-red-200 border border-red-500/40 disabled:opacity-40">
            ARM REAL MONEY
          </button>
          <span className="text-[9px] text-slate-500">kill switch / caps / gauntlet sab apply hote hain — ye agent ke liye private koi bypass nahi hai</span>
        </div>
      )}

      {/* body grid */}
      <div className="grid gap-3 mt-3 lg:grid-cols-2">
        <div className="space-y-3">
          <WalletCard wallet={wallet || view.wallet} />
          <TradeSlots
            used={view.today.tradesCount}
            total={view.today.maxTrades}
            pnlINR={view.today.realizedPnlINR}
            lossCapINR={view.today.lossCapINR} />
          <AgentConfigEditor cfg={view.config} onSaved={notify} />
        </div>
        <div className="space-y-3">
          <OpenPositions positions={view.openPositions} />
          <TodayTrades trades={view.today.trades} />
          <PickStrip title="🇮🇳 INDIA INTRADAY PICKS (agent watch)" picks={view.picks.INDIA} accent="text-orange-300" />
          <PickStrip title="⚡ FUTURES PICKS (auto-trade desk)" picks={view.picks.FUTURES} accent="text-amber-300" />
          <PickStrip title="₿ SPOT PICKS" picks={view.picks.CRYPTO} accent="text-cyan-300" />
        </div>
      </div>

      <div className="mt-3">
        <LogFeed log={view.state.log} />
      </div>
    </div>
  );
});
