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
  partial_tp: 'text-emerald-400 font-bold',
};

function ProStrategyCard({ sizing, cfg }: { sizing?: AgentView['sizingPreview']; cfg?: AgentView['config'] }) {
  const riskPct = cfg?.riskPerTradePct ?? 1.5;
  const tp1Pct = cfg?.tp1ClosePct ?? 40;
  const tp2Pct = cfg?.tp2ClosePct ?? 40;
  const runnerPct = cfg?.runnerPct ?? 20;
  const beActive = cfg?.breakEvenAfterTp1 !== false;

  return (
    <div className="bg-gradient-to-br from-indigo-950/40 via-purple-950/20 to-black/40 border border-purple-500/25 rounded-xl p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <span className="text-sm">🎯</span>
          <span className="text-[10px] font-black text-purple-300 tracking-wider">PRO TRADER ENGINE · 3-STAGE AUTO-EXIT</span>
        </div>
        <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30 font-bold">
          WALLET-SCALED
        </span>
      </div>

      {sizing && (
        <div className="grid grid-cols-3 gap-1.5 mb-2 text-[10px] font-mono">
          <div className="bg-black/30 rounded-lg p-2 border border-purple-500/15">
            <div className="text-slate-400 text-[8.5px] font-bold">WALLET RISK / TRADE</div>
            <div className="text-emerald-300 font-black text-xs">₹{sizing.riskINR}</div>
            <div className="text-slate-500 text-[8.5px]">{riskPct}% equity ({sizing.riskUSDT} USDT)</div>
          </div>
          <div className="bg-black/30 rounded-lg p-2 border border-cyan-500/15">
            <div className="text-slate-400 text-[8.5px] font-bold">SPOT ALLOCATION</div>
            <div className="text-cyan-300 font-black text-xs">≈ ₹{sizing.spotEstimatedOrderINR.toLocaleString('en-IN')}</div>
            <div className="text-slate-500 text-[8.5px]">max 60% free spot</div>
          </div>
          <div className="bg-black/30 rounded-lg p-2 border border-amber-500/15">
            <div className="text-slate-400 text-[8.5px] font-bold">FUTURES MARGIN</div>
            <div className="text-amber-300 font-black text-xs">{sizing.futuresEstimatedMarginUSDT} USDT</div>
            <div className="text-slate-500 text-[8.5px]">@ {sizing.leverage}x (cap {sizing.futuresCapUSDT} U)</div>
          </div>
        </div>
      )}

      {/* 3-Stage Exit Ladder */}
      <div className="space-y-1 text-[9.5px] font-mono">
        <div className="flex items-center gap-2 p-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/25">
          <span className="px-1.5 py-0.5 rounded bg-emerald-500/25 text-emerald-300 font-black text-[9px]">STAGE 1 · T1</span>
          <span className="text-slate-200 font-bold">{tp1Pct}% Position Closed</span>
          <span className="ml-auto text-emerald-300 font-black text-[9px]">
            {beActive ? '🛡 SL ➔ BREAKEVEN (RISK-FREE)' : 'PROFIT BOOKED'}
          </span>
        </div>

        <div className="flex items-center gap-2 p-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/25">
          <span className="px-1.5 py-0.5 rounded bg-cyan-500/25 text-cyan-300 font-black text-[9px]">STAGE 2 · T2</span>
          <span className="text-slate-200 font-bold">{tp2Pct}% Position Closed</span>
          <span className="ml-auto text-cyan-300 font-black text-[9px]">
            🔒 SL ➔ T1 LEVEL (PROFIT LOCKED)
          </span>
        </div>

        <div className="flex items-center gap-2 p-1.5 rounded-lg bg-amber-500/10 border border-amber-500/25">
          <span className="px-1.5 py-0.5 rounded bg-amber-500/25 text-amber-300 font-black text-[9px]">STAGE 3 · RUNNER</span>
          <span className="text-slate-200 font-bold">{runnerPct}% Moonbag Runner</span>
          <span className="ml-auto text-amber-300 font-black text-[9px]">
            🏃 TRAILING SL TO THE MOON
          </span>
        </div>
      </div>
    </div>
  );
}

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

type CfgKey = 'maxTradesPerDay' | 'minConfidence' | 'riskPerTradePct' | 'maxLeverage' | 'maxHoldMin' | 'cooldownMin' | 'dailyLossCapPct' | 'tp1ClosePct' | 'tp2ClosePct' | 'runnerPct';
const CFG_FIELDS: { key: CfgKey; label: string; min: number; max: number; step: number; suffix: string; hint: string }[] = [
  { key: 'maxTradesPerDay', label: 'Trades/day', min: 1, max: 10, step: 1, suffix: '', hint: 'user spec: 3 trades daily' },
  { key: 'minConfidence', label: 'Min confidence', min: 55, max: 95, step: 1, suffix: '%', hint: 'agent STRONG bar' },
  { key: 'riskPerTradePct', label: 'Risk/trade', min: 0.25, max: 10, step: 0.25, suffix: '%', hint: '% of wallet equity' },
  { key: 'maxLeverage', label: 'Max leverage', min: 1, max: 10, step: 1, suffix: 'x', hint: 'futures ceiling' },
  { key: 'tp1ClosePct', label: 'T1 Close', min: 10, max: 80, step: 5, suffix: '%', hint: 'close % at target 1 (breakeven lock)' },
  { key: 'tp2ClosePct', label: 'T2 Close', min: 10, max: 80, step: 5, suffix: '%', hint: 'close % at target 2' },
  { key: 'runnerPct', label: 'Runner', min: 0, max: 50, step: 5, suffix: '%', hint: 'runner % left to trail' },
  { key: 'maxHoldMin', label: 'Max hold', min: 5, max: 480, step: 5, suffix: 'm', hint: 'time-exit' },
  { key: 'cooldownMin', label: 'Cooldown', min: 1, max: 240, step: 1, suffix: 'm', hint: 'between entries' },
  { key: 'dailyLossCapPct', label: 'Day loss cap', min: 0.5, max: 50, step: 0.5, suffix: '%', hint: 'stand-down' },
];

function AgentConfigEditor({ cfg, onSaved }: { cfg: AgentView['config']; onSaved: (ok: boolean, msg: string) => void }) {
  const [draft, setDraft] = useState<Partial<Record<CfgKey, number>>>({});
  const [partialTp, setPartialTp] = useState<boolean>(cfg.partialTpEnabled !== false);
  const [breakEven, setBreakEven] = useState<boolean>(cfg.breakEvenAfterTp1 !== false);
  const [saving, setSaving] = useState(false);
  const dirty = Object.keys(draft).length > 0 || partialTp !== (cfg.partialTpEnabled !== false) || breakEven !== (cfg.breakEvenAfterTp1 !== false);

  const save = async () => {
    setSaving(true);
    const payload = {
      ...draft,
      partialTpEnabled: partialTp,
      breakEvenAfterTp1: breakEven,
    };
    const r = await saveAgentConfig(payload);
    setSaving(false);
    if (r.ok) { setDraft({}); onSaved(true, '✅ Agent Pro config saved — next scan se live'); }
    else onSaved(false, `⛔ ${r.error}`);
  };

  return (
    <div className="bg-black/25 rounded-xl p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-black text-violet-300 tracking-wider">⚙ PRO AGENT RULES & TAKE-PROFIT</span>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-[9px] font-mono font-bold text-slate-400 cursor-pointer">
            <input type="checkbox" checked={partialTp} onChange={e => setPartialTp(e.target.checked)} className="accent-purple-500 rounded" />
            Auto-TP (40/40/20)
          </label>
          <label className="flex items-center gap-1 text-[9px] font-mono font-bold text-slate-400 cursor-pointer">
            <input type="checkbox" checked={breakEven} onChange={e => setBreakEven(e.target.checked)} className="accent-emerald-500 rounded" />
            BE Lock
          </label>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
        {CFG_FIELDS.map(f => {
          const value = draft[f.key] != null ? draft[f.key] : Number(cfg[f.key] ?? (f.key === 'tp1ClosePct' ? 40 : f.key === 'tp2ClosePct' ? 40 : f.key === 'runnerPct' ? 20 : 0));
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
          agent STRONG bar: {Number(cfg.minConfidence)}% + {Math.round(Number(cfg.minAgreement) * 100)}% agreement
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
    <div className="bg-black/25 rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-black text-orange-300 tracking-wider">🤖 OPEN AGENT POSITIONS — AUTO-EXIT ARMED</span>
        <span className="text-[9px] font-mono text-slate-500">{positions.length} active</span>
      </div>
      {positions.map(p => {
        const holdPct = p.ageMin != null ? Math.min(100, (p.ageMin / Math.max(1, p.maxHoldMin)) * 100) : 0;
        const isLong = p.side === 'LONG';
        const stageBadge = p.exitStage === 'RUNNER_ACTIVE'
          ? { text: '🏃 20% RUNNER · TRAILING', cls: 'bg-amber-500/20 text-amber-300 border-amber-500/40' }
          : p.exitStage === 'TP1_BOOKED_BE_LOCKED'
            ? { text: '🛡 T1 BOOKED · BREAKEVEN LOCKED', cls: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' }
            : { text: '⚡ ACTIVE · T1/T2 ARMED', cls: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40' };

        return (
          <div key={p.id} className="bg-black/30 rounded-lg px-2.5 py-2 border border-slate-800/80">
            <div className="flex items-center gap-2 flex-wrap text-[10px] font-mono font-bold">
              <span className={isLong ? 'text-emerald-400' : 'text-red-400'}>{p.side}</span>
              <span className="text-slate-200">{p.pair}</span>
              <span className="text-slate-400">{p.mode.toUpperCase()}</span>
              {p.leverage != null && <span className="text-amber-300">{p.leverage}x</span>}
              <span className="text-slate-300">
                {p.qty}{p.initialQty && p.initialQty !== p.qty ? ` (orig ${p.initialQty})` : ''} @ {p.entryPrice}
              </span>
              <span className={`px-1.5 py-0.5 rounded text-[8.5px] font-black border font-mono ml-auto ${stageBadge.cls}`}>
                {stageBadge.text}
              </span>
            </div>

            <div className="mt-1 flex items-center justify-between text-[9px] font-mono text-slate-400">
              <span>SL {p.sl ?? '—'} · T1 {p.tp ?? '—'} · T2 {p.tp2 ?? '—'}</span>
              {p.bookedPnlINR != null && p.bookedPnlINR > 0 && (
                <span className="text-emerald-400 font-bold">Booked: +₹{p.bookedPnlINR}</span>
              )}
              {p.marginUSDT != null && <span className="text-cyan-300">margin {p.marginUSDT} USDT</span>}
              <span className="text-slate-400">{p.ageMin ?? '?'}m old</span>
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
              <span className="quantum-badge bg-gradient-to-r from-cyan-500/30 to-purple-500/30 text-purple-200 border border-purple-400/40 shadow-sm">
                v7.0 PRO
              </span>
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              wallet-proportional sizing · auto entry · 3-stage pro take-profit (40% T1 + BE lock · 40% T2 · 20% runner) · 60s server loop
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
          <ProStrategyCard sizing={view.sizingPreview} cfg={view.config} />
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
          <PickStrip title="⚡ FUTURES PICKS (auto-trade desk)" picks={view.picks.FUTURES} accent="text-amber-300" />
          <PickStrip title="₿ SPOT PICKS" picks={view.picks.CRYPTO} accent="text-cyan-300" />
          <PickStrip title="🇮🇳 INDIA INTRADAY PICKS (agent watch)" picks={view.picks.INDIA} accent="text-orange-300" />
        </div>
      </div>

      <div className="mt-3">
        <LogFeed log={view.state.log} />
      </div>
    </div>
  );
});
