import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../hooks/AppContext';
import { scanAlgoSignals, formatAlgoAlert, AlgoSignal } from '../../utils/algoEngine';
import { sendTelegramAlert } from '../../utils/api';
import { secureStorage } from '../../utils/secureStorage';
import { isAnyMarketOpen, getMarketStatus } from '../../utils/telegram';

const cur = (m: string) => (m === 'IN' ? '₹' : '$');
const ALERT_COOLDOWN_MS = 15 * 60 * 1000; // 15 min per symbol

const dirStyle = (d: AlgoSignal['direction']) =>
  d === 'LONG' ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30'
    : d === 'SHORT' ? 'text-red-400 bg-red-500/10 border-red-500/30'
      : 'text-amber-400 bg-amber-500/10 border-amber-500/30';

function FactorChip({ label, state, detail }: { label: string; state: string; detail: string }) {
  const c = state === 'bull' ? 'text-emerald-400 border-emerald-500/20 bg-emerald-500/5'
    : state === 'bear' ? 'text-red-400 border-red-500/20 bg-red-500/5'
      : 'text-slate-400 border-white/10 bg-white/5';
  return (
    <span title={detail} className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border ${c}`}>
      {label}: {state === 'bull' ? '▲' : state === 'bear' ? '▼' : '•'}
    </span>
  );
}

function SignalCard({ sig, onSelect }: { sig: AlgoSignal; onSelect: () => void }) {
  const c = cur(sig.market);
  return (
    <button
      onClick={onSelect}
      className="text-left quantum-panel rounded-2xl p-4 border border-white/5 hover:-translate-y-0.5 transition-all w-full"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <div className="font-black text-white text-base">{sig.symbol}</div>
          <div className="text-[10px] text-slate-500 font-semibold">{sig.market} · {sig.strategy}</div>
        </div>
        <div className="text-right">
          <span className={`px-2.5 py-1 rounded-lg text-xs font-black border ${dirStyle(sig.direction)}`}>{sig.direction}</span>
          <div className="mt-1 text-[10px] font-bold text-cyan-400">🤖 AI {sig.aiScore}/100</div>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-2">
        <span className="font-mono text-sm text-slate-200">{c}{sig.price}</span>
        <span className={`text-xs font-bold ${sig.change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
          {sig.change >= 0 ? '+' : ''}{sig.change}%
        </span>
        <span className="ml-auto text-[10px] text-slate-500">R:R 1:{sig.riskReward}</span>
      </div>

      {/* Conviction bar */}
      <div className="w-full h-1.5 bg-black/40 rounded-full overflow-hidden mb-3">
        <div
          className={`h-full ${sig.direction === 'SHORT' ? 'bg-red-500' : 'bg-emerald-500'}`}
          style={{ width: `${sig.conviction}%` }}
        />
      </div>

      <div className="grid grid-cols-2 gap-1.5 text-[10px] mb-3">
        <div className="bg-black/30 rounded-lg px-2 py-1.5 border border-white/5"><span className="text-slate-500">Entry</span><div className="font-mono text-cyan-300 font-bold">{c}{sig.entry}</div></div>
        <div className="bg-black/30 rounded-lg px-2 py-1.5 border border-white/5"><span className="text-slate-500">Stop</span><div className="font-mono text-red-300 font-bold">{c}{sig.stopLoss}</div></div>
        <div className="bg-black/30 rounded-lg px-2 py-1.5 border border-white/5"><span className="text-slate-500">Target 1</span><div className="font-mono text-emerald-300 font-bold">{c}{sig.target1}</div></div>
        <div className="bg-black/30 rounded-lg px-2 py-1.5 border border-white/5"><span className="text-slate-500">Target 2</span><div className="font-mono text-emerald-300 font-bold">{c}{sig.target2}</div></div>
      </div>

      <div className="flex flex-wrap gap-1">
        {sig.factors.map((f, i) => <FactorChip key={i} {...f} />)}
      </div>
    </button>
  );
}

const IntradayProTab = React.memo(function IntradayProTab() {
  const { portfolio, livePrices, currentSymbol, setCurrentSymbol, setCurrentMarket } = useApp();

  const [autoAlerts, setAutoAlerts] = useState<boolean>(() => secureStorage.getItem('algoAutoAlerts') === '1');
  const [alertMsg, setAlertMsg] = useState('');
  const lastAlertRef = useRef<Record<string, number>>({});

  // Build the intraday watchlist from everything we have live data for
  // (portfolio + default subscribed indices/ETFs/crypto), excluding VIX.
  const watchKeys = useMemo(() => {
    const keys = new Set<string>();
    portfolio.forEach(p => keys.add(`${p.market}_${p.symbol}`));
    Object.keys(livePrices).forEach(k => keys.add(k));
    return [...keys].filter(k => !/_(INDIAVIX|VIX)$/i.test(k));
  }, [portfolio, livePrices]);

  const signals = useMemo(() => scanAlgoSignals(watchKeys, livePrices), [watchKeys, livePrices]);
  const actionable = signals.filter(s => s.direction !== 'WAIT');
  const top = signals[0];

  const longs = actionable.filter(s => s.direction === 'LONG').length;
  const shorts = actionable.filter(s => s.direction === 'SHORT').length;

  // --- Telegram alerting (auto + manual) ---
  const pushAlerts = async (sigs: AlgoSignal[], respectCooldown: boolean) => {
    const [token, chatId] = await Promise.all([
      secureStorage.getItemAsync('TG_TOKEN'), secureStorage.getItemAsync('TG_CHAT_ID'),
    ]);
    const now = Date.now();
    let sent = 0;
    for (const s of sigs) {
      if (respectCooldown) {
        const last = lastAlertRef.current[s.symbol] || 0;
        if (now - last < ALERT_COOLDOWN_MS) continue;
      }
      try {
        const ok = await sendTelegramAlert(token || '', chatId || '', formatAlgoAlert(s));
        if (ok) { sent++; lastAlertRef.current[s.symbol] = now; }
      } catch { /* ignore */ }
    }
    return sent;
  };

  const sendTopNow = async () => {
    const picks = actionable.slice(0, 5);
    if (picks.length === 0) { setAlertMsg('No actionable signals'); setTimeout(() => setAlertMsg(''), 2500); return; }
    setAlertMsg('📤 Sending…');
    const sent = await pushAlerts(picks, false);
    setAlertMsg(sent > 0 ? `✅ Sent ${sent} to Telegram` : '⚠️ Telegram not configured');
    setTimeout(() => setAlertMsg(''), 3000);
  };

  // Auto-alert loop: high-conviction signals only, with per-symbol cooldown.
  useEffect(() => {
    if (!autoAlerts) return;
    const run = async () => {
      if (!isAnyMarketOpen()) return;
      const hot = scanAlgoSignals(watchKeys, livePrices)
        .filter(s => s.direction !== 'WAIT' && s.conviction >= 65)
        .slice(0, 6);
      if (hot.length) await pushAlerts(hot, true);
    };
    run();
    const id = window.setInterval(run, 60000); // every 60s
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAlerts, watchKeys, livePrices]);

  const toggleAuto = () => {
    setAutoAlerts(prev => {
      const next = !prev;
      secureStorage.setItem('algoAutoAlerts', next ? '1' : '0');
      return next;
    });
  };

  const selectSignal = (s: AlgoSignal) => {
    setCurrentSymbol(s.symbol);
    setCurrentMarket(s.market);
  };

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-black gradient-text-cyan font-display flex items-center gap-2">
            ⚡ Intraday Pro <span className="quantum-badge">ALGO</span>
          </h2>
          <p className="text-[11px] text-slate-500 mt-1">Advance Pro Algo Trading · Super Intelligence · {getMarketStatus()}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={toggleAuto}
            className={`px-4 py-2 rounded-xl font-semibold text-sm border transition-all ${autoAlerts ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'quantum-btn-ghost border-white/10'}`}
            title="Auto Telegram alerts for high-conviction intraday signals"
          >
            {autoAlerts ? '🔔 Auto-Alerts ON' : '🔕 Auto-Alerts OFF'}
          </button>
          <button onClick={sendTopNow} className="quantum-btn-primary px-4 py-2 bg-gradient-to-r from-cyan-600 to-indigo-600 rounded-xl font-bold text-sm text-white">
            📲 {alertMsg || 'Send Top to Telegram'}
          </button>
        </div>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="quantum-panel rounded-xl p-3 text-center border border-white/5">
          <div className="text-[10px] text-slate-500 font-bold uppercase">Signals</div>
          <div className="text-xl font-black text-white">{signals.length}</div>
        </div>
        <div className="quantum-panel rounded-xl p-3 text-center border border-emerald-500/10">
          <div className="text-[10px] text-slate-500 font-bold uppercase">Long Setups</div>
          <div className="text-xl font-black text-emerald-400">{longs}</div>
        </div>
        <div className="quantum-panel rounded-xl p-3 text-center border border-red-500/10">
          <div className="text-[10px] text-slate-500 font-bold uppercase">Short Setups</div>
          <div className="text-xl font-black text-red-400">{shorts}</div>
        </div>
        <div className="quantum-panel rounded-xl p-3 text-center border border-cyan-500/10">
          <div className="text-[10px] text-slate-500 font-bold uppercase">Top AI Score</div>
          <div className="text-xl font-black text-cyan-400">{top ? `${top.aiScore}` : '—'}</div>
        </div>
      </div>

      {/* Hero — top conviction trade */}
      {top && top.direction !== 'WAIT' && (
        <div className="quantum-panel rounded-2xl p-5 border border-cyan-500/20 animate-fade-in-up">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">🎯 Highest-Conviction Trade</h3>
            <span className={`px-3 py-1 rounded-lg text-xs font-black border ${dirStyle(top.direction)}`}>{top.direction} · {top.strategy}</span>
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <div className="text-3xl font-black text-white">{top.symbol}</div>
              <div className="text-xs text-slate-500">{cur(top.market)}{top.price} ({top.change >= 0 ? '+' : ''}{top.change}%)</div>
            </div>
            <div className="text-center">
              <div className="text-[10px] text-slate-500 font-bold uppercase">AI Score</div>
              <div className="text-3xl font-black text-cyan-400">{top.aiScore}</div>
            </div>
            <div className="ml-auto grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
              <div className="bg-black/30 rounded-lg px-3 py-2 border border-white/5"><span className="text-slate-500">Entry</span><div className="font-mono text-cyan-300 font-bold">{cur(top.market)}{top.entry}</div></div>
              <div className="bg-black/30 rounded-lg px-3 py-2 border border-white/5"><span className="text-slate-500">Stop</span><div className="font-mono text-red-300 font-bold">{cur(top.market)}{top.stopLoss}</div></div>
              <div className="bg-black/30 rounded-lg px-3 py-2 border border-white/5"><span className="text-slate-500">T1 / T2</span><div className="font-mono text-emerald-300 font-bold">{top.target1} / {top.target2}</div></div>
              <div className="bg-black/30 rounded-lg px-3 py-2 border border-white/5"><span className="text-slate-500">R:R · Size</span><div className="font-mono text-white font-bold">1:{top.riskReward} · {top.positionSizePct}%</div></div>
            </div>
          </div>
          <p className="text-xs text-slate-400 mt-3 italic">{top.reasoning}</p>
        </div>
      )}

      {/* All signals grid */}
      {signals.length === 0 ? (
        <div className="quantum-panel rounded-2xl p-10 text-center border border-dashed border-white/10">
          <div className="text-4xl mb-2 animate-float">📡</div>
          <p className="text-slate-400 font-medium">Waiting for live data…</p>
          <p className="text-xs text-slate-600 mt-1">Add holdings or wait for the realtime feed to populate.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {signals.map(s => (
            <SignalCard key={`${s.market}_${s.symbol}`} sig={s} onSelect={() => selectSignal(s)} />
          ))}
        </div>
      )}

      <p className="text-[10px] text-slate-600 text-center">
        ⚠️ Algorithmic intraday signals for educational use. Always use a stop-loss. Not financial advice.
        {currentSymbol ? ` · Tracking ${currentSymbol.replace('.NS', '')}` : ''}
      </p>
    </div>
  );
});

export default IntradayProTab;
