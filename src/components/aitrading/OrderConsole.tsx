// ============================================================
// src/components/aitrading/OrderConsole.tsx
// ------------------------------------------------------------
// The execution console: live/paper positions with SL/TP tracking,
// daily risk meters, config editor (LIVE arming with typed
// confirmation), kill switch, and the full audit journal.
// ============================================================
import { memo, useState, useEffect, useCallback } from 'react';
import type { DhanStatus, JournalEntry, JournalPosition, TradingConfig, TradingState } from './types';

const fmt = (n: number | null | undefined): string => {
  if (n == null || !Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1e5) return `₹${(n / 1e5).toFixed(2)}L`;
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
};

const ago = (ts: number): string => {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

function RiskBar({ label, value, max, tone }: { label: string; value: number; max: number; tone: 'cyan' | 'red' | 'amber' }) {
  const pct = Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100));
  const color = tone === 'red' ? 'bg-red-500' : tone === 'amber' ? 'bg-amber-500' : 'bg-cyan-500';
  return (
    <div className="flex-1 min-w-[120px]">
      <div className="flex justify-between text-[10px] font-bold mb-1">
        <span className="text-slate-500">{label}</span>
        <span className="text-slate-300 font-mono">{Math.round(value)}/{max}</span>
      </div>
      <div className="h-1.5 bg-black/40 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function ConfigEditor({ config, busy, onSave, state }: {
  config: TradingConfig; busy?: boolean;
  onSave: (patch: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;
  state: TradingState | null;
}) {
  const [minConf, setMinConf] = useState(String(config.minConfidence));
  const [maxOrder, setMaxOrder] = useState(String(config.maxOrderINR));
  const [indiaMaxOrder, setIndiaMaxOrder] = useState(String(config.indiaMaxOrderINR ?? 5000));
  const [dailyTrades, setDailyTrades] = useState(String(config.dailyMaxTrades));
  const [dailyLoss, setDailyLoss] = useState(String(config.dailyMaxLossINR));
  const [maxStop, setMaxStop] = useState(String(config.maxRiskPct ?? 5));
  const [trailArm, setTrailArm] = useState(String(config.trailArmR ?? 1));
  const [trailOff, setTrailOff] = useState(String(config.trailOffsetR ?? 1));
  const [phrase, setPhrase] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // v6.2: resync the number boxes whenever the SERVER config changes (60s
  // state poll, kill-switch auto-disarm, another device's SET) — the boxes
  // were initialized once and then showed stale values while the badges
  // above showed the real ones; clicking SET pushed the stale box back.
  useEffect(() => {
    setMinConf(String(config.minConfidence));
    setMaxOrder(String(config.maxOrderINR));
    setIndiaMaxOrder(String(config.indiaMaxOrderINR ?? 5000));
    setDailyTrades(String(config.dailyMaxTrades));
    setDailyLoss(String(config.dailyMaxLossINR));
    setMaxStop(String(config.maxRiskPct ?? 5));
    setTrailArm(String(config.trailArmR ?? 1));
    setTrailOff(String(config.trailOffsetR ?? 1));
  }, [config]);

  const save = async (patch: Record<string, unknown>) => {
    const r = await onSave(patch);
    setMsg({ ok: r.ok, text: r.ok ? 'Saved ✓' : (r.error || 'failed') });
    setTimeout(() => setMsg(null), 4000);
    return r;
  };

  return (
    <div className="quantum-panel rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-black text-slate-200">🛡️ RISK & EXECUTION SETTINGS</span>
        {msg && <span className={`text-[10px] font-bold ${msg.ok ? 'text-emerald-400' : 'text-red-400'}`}>{msg.text}</span>}
      </div>

      {/* Mode arm/disarm */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`px-3 py-1.5 rounded-xl text-[11px] font-black border ${config.mode === 'live' ? 'bg-red-500/15 text-red-300 border-red-500/40 animate-pulse' : 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'}`}>
          {config.mode === 'live' ? '🔴 LIVE MODE — REAL ORDERS' : '🧪 PAPER MODE — SIMULATED'}
        </span>
        {config.mode === 'paper' ? (
          <div className="flex gap-1.5 items-center">
            <input value={phrase} onChange={e => setPhrase(e.target.value)} placeholder='type LIVE'
              className="quantum-input px-3 py-1.5 rounded-lg text-[11px] font-mono w-28" aria-label="LIVE confirmation phrase" />
            <button onClick={() => { save({ mode: 'live', liveConfirmPhrase: phrase }); setPhrase(''); }}
              disabled={busy || phrase.trim().toUpperCase() !== 'LIVE'}
              className="px-3 py-1.5 rounded-lg text-[11px] font-black bg-red-600/80 text-white hover:bg-red-600 disabled:opacity-40">
              ⚡ ARM LIVE
            </button>
          </div>
        ) : (
          <button onClick={() => save({ mode: 'paper' })} disabled={busy}
            className="px-3 py-1.5 rounded-lg text-[11px] font-black bg-slate-700 text-slate-200 hover:bg-slate-600">
            ✋ Disarm to Paper
          </button>
        )}
      </div>

      {/* Auto toggle */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => save({ allowAuto: !config.allowAuto })}
          disabled={busy || config.mode !== 'live'}
          title="Auto-executor: every 90s, executes only STRONG signals that pass ALL gates"
          className={`px-3 py-1.5 rounded-xl text-[11px] font-black border disabled:opacity-40 ${config.allowAuto ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' : 'bg-slate-600/20 text-slate-400 border-slate-600/30'}`}>
          {config.allowAuto ? '🤖 AUTO-EXECUTE ON (STRONG only)' : '🤖 Auto-execute OFF'}
        </button>
        {state?.blocked.notConnected && <span className="text-[10px] text-amber-400/80 font-bold">⚠️ CoinDCX not connected — Portfolio tab → Connect CoinDCX</span>}
      </div>

      {/* v6.5: TRAILING STOP-LOSS */}
      <div className="flex items-center gap-2 gap-y-1.5 flex-wrap bg-black/20 rounded-xl px-3 py-2.5">
        <button onClick={() => save({ trailEnabled: !config.trailEnabled })}
          disabled={busy}
          title="Winners run: SL locks breakeven at +1R, then trails peak − 1R. Ratchet-only — kabhi loose nahi hota. Dono desks (crypto + India)."
          className={`px-3 py-1.5 rounded-xl text-[11px] font-black border ${config.trailEnabled ? 'bg-amber-500/15 text-amber-300 border-amber-500/40' : 'bg-slate-600/20 text-slate-400 border-slate-600/30'}`}>
          🔗 TRAILING SL {config.trailEnabled ? 'ON' : 'OFF'}
        </button>
        <label className="flex items-center gap-1 text-[9px] font-black text-slate-500 tracking-wider">
          ARM AT
          <input value={trailArm} onChange={e => setTrailArm(e.target.value)} className="quantum-input px-1.5 py-1 rounded-lg text-[10px] font-mono w-14" inputMode="decimal" aria-label="trail arm in R" />
          <span className="text-slate-600">R</span>
        </label>
        <button onClick={() => save({ trailArmR: Number(trailArm) })} disabled={busy || !config.trailEnabled}
          className="quantum-btn-ghost px-2 py-1 rounded-lg text-[9px] font-black disabled:opacity-40">SET</button>
        <label className="flex items-center gap-1 text-[9px] font-black text-slate-500 tracking-wider">
          TRAIL OFFSET
          <input value={trailOff} onChange={e => setTrailOff(e.target.value)} className="quantum-input px-1.5 py-1 rounded-lg text-[10px] font-mono w-14" inputMode="decimal" aria-label="trail offset in R" />
          <span className="text-slate-600">R</span>
        </label>
        <button onClick={() => save({ trailOffsetR: Number(trailOff) })} disabled={busy || !config.trailEnabled}
          className="quantum-btn-ghost px-2 py-1 rounded-lg text-[9px] font-black disabled:opacity-40">SET</button>
        <span className="text-[9px] text-slate-600">profit ≥ {config.trailArmR ?? 1}R → SL = breakeven → peak − {config.trailOffsetR ?? 1}R</span>
      </div>

      {/* Numeric limits */}
      <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
        {[
          { label: 'Min conf %', val: minConf, set: setMinConf, key: 'minConfidence', hint: '50-95' },
          { label: 'Max order ₹ (crypto)', val: maxOrder, set: setMaxOrder, key: 'maxOrderINR', hint: '≥100' },
          { label: 'India Max ₹', val: indiaMaxOrder, set: setIndiaMaxOrder, key: 'indiaMaxOrderINR', hint: '≥100' },
          { label: 'Daily trades', val: dailyTrades, set: setDailyTrades, key: 'dailyMaxTrades', hint: '1-50' },
          { label: 'Daily loss ₹', val: dailyLoss, set: setDailyLoss, key: 'dailyMaxLossINR', hint: '≥50' },
          { label: 'Max stop %', val: maxStop, set: setMaxStop, key: 'maxRiskPct', hint: '1-20' },
        ].map(f => (
          <div key={f.key}>
            <label className="text-[9px] text-slate-500 font-black tracking-wider block mb-1">{f.label.toUpperCase()}</label>
            <div className="flex gap-1">
              <input value={f.val} onChange={e => f.set(e.target.value)} className="quantum-input px-2 py-1.5 rounded-lg text-[11px] font-mono w-full" inputMode="numeric" />
              <button onClick={() => save({ [f.key]: Number(f.val) })} disabled={busy}
                className="quantum-btn-ghost px-2 rounded-lg text-[10px] font-black">SET</button>
            </div>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-slate-500 leading-relaxed">
        Gates enforced SERVER-SIDE on every order: STRONG grade (confidence + agreement), stop-distance ≤ {config.maxRiskPct ?? 5}%
        (v6.4: over-cap stops AUTO-FIT to this cap — SL tightened, targets re-derived; LIVE only fits mild overshoot ≤ 1.5×),
        daily trade/loss caps, one position per pair, 90s signal freshness. CoinDCX key needs trade permission for LIVE.
        v6.5: Trailing SL dono desks par watcher chalata hai (breakeven → peak-trail, ratchet-only).
      </p>
    </div>
  );
}

// ---------------- v6.5: Dhan connect + India LIVE arming ----------------
function DhanPanel({ busy, onSave, dhan, indiaMode, onConnect, onDisconnect, onRefresh }: {
  busy?: boolean;
  onSave: (patch: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;
  dhan: DhanStatus | null;
  indiaMode?: 'paper' | 'live';
  onConnect: (clientId: string, accessToken: string) => Promise<{ ok: boolean; error?: string }>;
  onDisconnect: () => Promise<{ ok: boolean; error?: string }>;
  onRefresh: () => void;
}) {
  const [clientId, setClientId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [phrase, setPhrase] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const connected = !!dhan?.connected;

  const flash = (ok: boolean, text: string) => {
    setMsg({ ok, text });
    setTimeout(() => setMsg(null), 5000);
  };

  const connect = useCallback(async () => {
    const r = await onConnect(clientId.trim(), accessToken.trim());
    flash(r.ok, r.ok ? `✅ Dhan connected${dhan ? '' : ''} — profile verified` : `⛔ ${r.error || 'connect failed'}`);
    if (r.ok) { setClientId(''); setAccessToken(''); onRefresh(); }
  }, [clientId, accessToken, onConnect, onRefresh]);

  const indiaArmed = indiaMode === 'live';

  return (
    <div className="quantum-panel rounded-2xl p-4 space-y-3" aria-label="Dhan broker panel">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-black text-slate-200">🇮🇳 INDIA BROKER — DHAN HQ (v6.5)</span>
        <span className={`px-2 py-0.5 rounded-lg text-[9px] font-black border ${connected ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'bg-slate-600/20 text-slate-500 border-slate-600/30'}`}>
          {connected ? `CONNECTED${dhan?.profile?.name ? ` · ${dhan.profile.name}` : ''}` : 'NOT CONNECTED'}
        </span>
        {msg && <span className={`text-[10px] font-bold ${msg.ok ? 'text-emerald-400' : 'text-red-400'}`}>{msg.text}</span>}
        {dhan?.scrips?.symbols ? <span className="text-[9px] text-slate-600 font-mono ml-auto">scrip master: {dhan.scrips.symbols.toLocaleString('en-IN')} symbols cached</span> : null}
      </div>

      {!connected ? (
        <>
          <div className="grid gap-2 sm:grid-cols-[130px_1fr_auto] items-end">
            <div>
              <label className="text-[9px] text-slate-500 font-black tracking-wider block mb-1">CLIENT ID</label>
              <input value={clientId} onChange={e => setClientId(e.target.value)} placeholder="1100xxxxx" inputMode="numeric"
                className="quantum-input px-3 py-1.5 rounded-lg text-[11px] font-mono w-full" autoComplete="off" aria-label="dhan client id" />
            </div>
            <div>
              <label className="text-[9px] text-slate-500 font-black tracking-wider block mb-1">ACCESS TOKEN (Dhan HQ web → Access Token)</label>
              <input value={accessToken} onChange={e => setAccessToken(e.target.value)} placeholder="paste long token" type="password"
                className="quantum-input px-3 py-1.5 rounded-lg text-[11px] font-mono w-full" autoComplete="off" spellCheck={false} aria-label="dhan access token" />
            </div>
            <button onClick={connect} disabled={busy || !clientId.trim() || !accessToken.trim()}
              className="px-3 py-1.5 rounded-lg text-[10px] font-black bg-gradient-to-r from-orange-600 to-amber-600 text-white disabled:opacity-40">
              🔗 CONNECT
            </button>
          </div>
          <p className="text-[10px] text-slate-500 leading-relaxed">
            Dhan app/web par <b>dhan.co → HQ section → APIs → Access Token</b> generate karo (validity: 24 ghante tak ya jab tak revoke na karo),
            wahi token yaha paste karo. Profile se <b>API segment enabled</b> hona chahiye. Token server-side encrypted backup me save hota hai —
            Render restart par bhi connected rehte ho. Zerodha Kite nahi hai kyunki uska session <b>daily OAuth</b> maangta hai — automation ke liye Dhan hi sahi hai.
          </p>
        </>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={async () => { const r = await onDisconnect(); flash(r.ok, r.ok ? 'Disconnected' : `⛔ ${r.error}`); onRefresh(); }}
            disabled={busy} className="px-3 py-1.5 rounded-lg text-[10px] font-black bg-slate-700 text-slate-200 hover:bg-slate-600">
            ✋ Disconnect
          </button>
          <span className="text-[10px] text-slate-500">India execution: STRONG signals only · entry window 09:30–15:00 · square-off 15:15 IST · shared daily caps</span>
        </div>
      )}

      {/* India LIVE arming (separate from crypto) */}
      <div className="flex items-center gap-2 flex-wrap bg-black/20 rounded-xl px-3 py-2.5">
        <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black border ${indiaArmed ? 'bg-red-500/15 text-red-300 border-red-500/40 animate-pulse' : 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'}`}>
          {indiaArmed ? '🔴 INDIA LIVE ARMED' : '🧪 INDIA PAPER MODE'}
        </span>
        {!indiaArmed ? (
          <div className="flex gap-1.5 items-center">
            <input value={phrase} onChange={e => setPhrase(e.target.value)} placeholder="type LIVE"
              className="quantum-input px-3 py-1.5 rounded-lg text-[11px] font-mono w-28" aria-label="India LIVE confirmation phrase" />
            <button onClick={async () => {
              const r = await onSave({ indiaMode: 'live', liveConfirmPhrase: phrase });
              flash(r.ok, r.ok ? '🔴 India LIVE armed — Dhan par ab STRONG India signals REAL orders de sakte hain' : `⛔ ${r.error}`);
              setPhrase('');
            }} disabled={busy || !connected || phrase.trim().toUpperCase() !== 'LIVE'}
              title={connected ? 'Typed LIVE required' : 'Dhan connect first'}
              className="px-3 py-1.5 rounded-lg text-[11px] font-black bg-red-600/80 text-white hover:bg-red-600 disabled:opacity-40">
              ⚡ ARM INDIA LIVE
            </button>
          </div>
        ) : (
          <button onClick={async () => { const r = await onSave({ indiaMode: 'paper' }); flash(r.ok, r.ok ? 'India disarmed to paper' : `⛔ ${r.error}`); }}
            disabled={busy}
            className="px-3 py-1.5 rounded-lg text-[11px] font-black bg-slate-700 text-slate-200 hover:bg-slate-600">
            ✋ Disarm India
          </button>
        )}
        <span className="text-[9px] text-slate-600">India arming ≠ crypto arming — dono alag, dono me typed LIVE chahiye</span>
      </div>
    </div>
  );
}

interface Props {
  state: TradingState | null;
  positions: JournalPosition[];
  entries: JournalEntry[];
  busy?: boolean;
  onClose: (id: string) => void;
  onSaveConfig: (patch: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;
  /** v6.5: Dhan broker */
  dhan: DhanStatus | null;
  onDhanConnect: (clientId: string, accessToken: string) => Promise<{ ok: boolean; error?: string }>;
  onDhanDisconnect: () => Promise<{ ok: boolean; error?: string }>;
  onDhanRefresh: () => void;
}

export const OrderConsole = memo(function OrderConsole({ state, positions, entries, busy, onClose, onSaveConfig, dhan, onDhanConnect, onDhanDisconnect, onDhanRefresh }: Props) {
  const [tab, setTab] = useState<'positions' | 'journal'>('positions');
  const open = positions.filter(p => p.status === 'OPEN');
  const cfg = state?.config;

  return (
    <section className="space-y-3" aria-label="Execution console">
      {/* Kill switch + risk meters */}
      <div className="quantum-panel rounded-2xl p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => onSaveConfig({ killSwitch: !cfg?.killSwitch })}
            disabled={busy}
            className={`px-4 py-2 rounded-xl text-xs font-black border-2 transition-all ${cfg?.killSwitch
              ? 'bg-red-600 text-white border-red-400 animate-pulse'
              : 'bg-red-500/10 text-red-300 border-red-500/40 hover:bg-red-500/20'}`}>
            ☠️ {cfg?.killSwitch ? 'KILL SWITCH ACTIVE — CLICK TO RELEASE' : 'KILL SWITCH'}
          </button>
          {state && (
            <div className="flex gap-4 flex-1 min-w-[240px]">
              <RiskBar label="Daily trades" value={state.stats.tradesCount} max={cfg?.dailyMaxTrades || 3} tone="cyan" />
              <RiskBar label="Daily loss ₹" value={Math.max(0, -(state.stats.realizedPnlINR || 0))} max={cfg?.dailyMaxLossINR || 500} tone="red" />
            </div>
          )}
        </div>
        {(state?.blocked.dailyTrades || state?.blocked.dailyLoss) && (
          <p className="text-[10px] text-red-400 font-bold mt-2">
            🚫 {state.blocked.dailyTrades ? 'Daily trade cap reached. ' : ''}{state.blocked.dailyLoss ? 'Daily loss cap breached.' : ''} Resets at IST midnight.
          </p>
        )}
      </div>

      {/* Config editor */}
      {cfg && <ConfigEditor config={cfg} state={state} busy={busy} onSave={onSaveConfig} />}

      {/* v6.5: Dhan broker + India LIVE arming */}
      <DhanPanel busy={busy} onSave={onSaveConfig} dhan={dhan} indiaMode={cfg?.indiaMode} onConnect={onDhanConnect} onDisconnect={onDhanDisconnect} onRefresh={onDhanRefresh} />

      {/* Positions / Journal tabs */}
      <div className="quantum-panel rounded-2xl overflow-hidden">
        <div className="flex border-b border-white/5">
          {(['positions', 'journal'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2.5 text-[11px] font-black transition-all ${tab === t ? 'text-cyan-300 border-b-2 border-cyan-400 bg-cyan-500/5' : 'text-slate-500 hover:text-slate-300'}`}>
              {t === 'positions' ? `📋 POSITIONS (${open.length} open)` : '📜 AUDIT JOURNAL'}
            </button>
          ))}
        </div>

        {tab === 'positions' && (
          <div className="max-h-96 overflow-y-auto">
            {positions.length === 0 && (
              <div className="p-8 text-center text-slate-500 text-xs">No positions yet — execute a STRONG signal (PAPER is always available)</div>
            )}
            {positions.map(p => {
              const upnl = p.unrealizedPnlINR ?? 0;
              const open = p.status === 'OPEN';
              const isIndia = p.market === 'INDIA';
              return (
                <div key={p.id} className="px-4 py-3 border-b border-white/[0.03] hover:bg-white/[0.02]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-black font-mono text-white">{p.pair}</span>
                    {isIndia && <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-orange-500/15 text-orange-300">🇮🇳 NSE</span>}
                    <span className={`text-[11px] font-black ${p.side === 'LONG' ? 'text-emerald-400' : 'text-red-400'}`}>{p.side}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-black ${p.mode === 'live' ? 'bg-red-500/15 text-red-300' : 'bg-cyan-500/15 text-cyan-300'}`}>{p.mode.toUpperCase()}</span>
                    {p.trailing && open && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-amber-500/15 text-amber-300" title={`peak ₹${p.peakPrice?.toLocaleString('en-IN')} — ratchet-only`}>
                        🔗 {p.trailing === 'breakeven' ? 'BE LOCKED' : 'TRAILING'}
                      </span>
                    )}
                    {!open && <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-slate-600/20 text-slate-400">{p.closeReason || 'CLOSED'}</span>}
                    <span className="ml-auto text-[11px] font-mono text-slate-400">{p.qty} @ ₹{p.entryPrice?.toLocaleString('en-IN')}</span>
                    {open && p.ltp != null && <span className="text-[11px] font-mono text-slate-300">→ ₹{p.ltp?.toLocaleString('en-IN')}</span>}
                    <span className={`text-xs font-black font-mono ${upnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {upnl >= 0 ? '+' : ''}{fmt(upnl)}
                    </span>
                    {open && (
                      <button onClick={() => onClose(p.id)} disabled={busy}
                        className="quantum-btn-ghost px-2.5 py-1 rounded-lg text-[10px] font-black disabled:opacity-50">
                        CLOSE
                      </button>
                    )}
                  </div>
                  {open && (p.sl != null || p.tp2 != null) && (
                    <div className="flex gap-3 mt-1.5 text-[10px] font-mono flex-wrap">
                      <span className="text-red-400/70">SL ₹{p.sl?.toLocaleString('en-IN')}</span>
                      <span className="text-emerald-400/70">TP ₹{p.tp?.toLocaleString('en-IN')} / ₹{p.tp2?.toLocaleString('en-IN')}</span>
                      {p.peakPrice != null && p.peakPrice > 0 && (
                        <span className="text-amber-400/70" title="best price since entry (trailing anchor)">🔺 peak ₹{p.peakPrice?.toLocaleString('en-IN')}</span>
                      )}
                      <span className="text-slate-600">{isIndia ? 'watcher + 15:15 square-off' : 'watcher auto-closes on breach'}</span>
                    </div>
                  )}
                  <div className="text-[10px] text-slate-600 mt-1">
                    {p.signal?.grade && <span className="text-slate-500">from {p.signal.grade} signal ({p.signal.confidence}%) · </span>}
                    {ago(p.status === 'OPEN' ? p.openedAt : (p.closedAt || p.openedAt))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {tab === 'journal' && (
          <div className="max-h-96 overflow-y-auto">
            {entries.length === 0 && <div className="p-8 text-center text-slate-500 text-xs">Empty — every execution attempt (approved or rejected) lands here</div>}
            {entries.map(e => (
              <div key={e.id} className="px-4 py-2.5 border-b border-white/[0.03] text-[11px] flex items-center gap-2 flex-wrap hover:bg-white/[0.02]">
                <span className={`px-1.5 py-0.5 rounded text-[9px] font-black ${
                  e.status === 'FILLED' || e.status === 'SUBMITTED' ? 'bg-emerald-500/15 text-emerald-300'
                  : e.status === 'REJECTED' || e.status === 'FAILED' ? 'bg-red-500/15 text-red-300'
                  : 'bg-slate-600/20 text-slate-400'}`}>{e.status}</span>
                <span className="font-mono text-slate-300 w-20">{e.pair || '—'}</span>
                <span className="font-mono text-slate-500">{e.side || ''} {e.qty || ''}</span>
                {e.pnlINR != null && <span className={`font-mono font-bold ${(e.pnlINR || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{(e.pnlINR || 0) >= 0 ? '+' : ''}{fmt(e.pnlINR)}</span>}
                {e.reason && <span className="text-slate-500 truncate max-w-[300px]">{e.reason}</span>}
                <span className="ml-auto text-slate-600 font-mono text-[10px]">{ago(e.ts)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
});
