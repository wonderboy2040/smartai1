// ============================================================
// src/components/aitrading/ProPanels.tsx — v6.7 PRO PANELS
// ------------------------------------------------------------
// Four read-only intelligence layers (glama-inspired):
//   • MorningBriefPanel  — one call, the whole desk
//   • SwingDeskPanel     — 3–8 day multi-factor setups (no execution)
//   • WhaleRadarPanel    — volume-spike footprints (2.5x+ vs 20-bar)
//   • SignalLedgerPanel  — SHA-256 tamper-evident track record
//   • OrderbookPanel     — CoinDCX depth + imbalance + walls
// ============================================================
import { memo, useCallback, useEffect, useState } from 'react';
import { fetchMorningBrief, fetchSwingBoard, fetchWhales, fetchLedger, fetchOrderbook } from './useAITrading';
import type { MarketKind, MorningBrief, SwingBoard, WhaleRadar, LedgerView, OrderbookView } from './types';

const inr = (v: number | null | undefined, dp = 0) =>
  v == null || !Number.isFinite(v) ? '—' : `₹${v.toLocaleString('en-IN', { maximumFractionDigits: dp })}`;

function PanelShell({ title, tag, onRefresh, loading, children }: {
  title: string; tag?: string; onRefresh?: () => void; loading?: boolean; children: React.ReactNode;
}) {
  return (
    <div className="quantum-panel rounded-2xl p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <span className="text-xs font-black text-slate-200">{title}</span>
        <div className="flex items-center gap-2">
          {tag && <span className="px-2 py-0.5 rounded-md text-[9px] font-black bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">{tag}</span>}
          {onRefresh && (
            <button onClick={onRefresh} className="quantum-btn-ghost px-2 py-1 rounded-lg text-[10px] font-bold" aria-label={`Refresh ${title}`}>
              <span className={loading ? 'inline-block animate-spin' : ''}>🔄</span>
            </button>
          )}
        </div>
      </div>
      {children}
    </div>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <div className="py-5 text-center text-[11px] text-slate-500">{children}</div>;
}

// ---------------- Morning Brief ----------------
export const MorningBriefPanel = memo(function MorningBriefPanel() {
  const [brief, setBrief] = useState<MorningBrief | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const b = await fetchMorningBrief();
    setBrief(b);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const m = brief?.market;
  const book = brief?.book;
  return (
    <PanelShell title="☀️ Morning Brief — poora desk ek nazar me" tag="v6.7" onRefresh={load} loading={loading}>
      {!brief && <EmptyNote>{loading ? 'Desk assemble ho raha hai…' : 'Brief unavailable — retry in 30s.'}</EmptyNote>}
      {brief && (
        <div className="space-y-3">
          {/* market strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            <div className="bg-black/30 rounded-xl px-2 py-1.5 text-center">
              <div className="text-[8px] text-slate-500 font-black tracking-wider">NIFTY</div>
              <div className="text-xs font-mono font-black text-slate-200">{m?.nifty?.toLocaleString('en-IN', { maximumFractionDigits: 0 }) ?? '—'}</div>
              <div className={`text-[9px] font-mono ${(m?.niftyChangePct ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{m?.niftyChangePct != null ? `${m.niftyChangePct >= 0 ? '+' : ''}${m.niftyChangePct.toFixed(2)}%` : ''}</div>
            </div>
            <div className="bg-black/30 rounded-xl px-2 py-1.5 text-center">
              <div className="text-[8px] text-slate-500 font-black tracking-wider">INDIA VIX</div>
              <div className="text-xs font-mono font-black text-slate-200">{m?.indiaVix?.toFixed(1) ?? '—'}</div>
            </div>
            <div className="bg-black/30 rounded-xl px-2 py-1.5 text-center">
              <div className="text-[8px] text-slate-500 font-black tracking-wider">BTC</div>
              <div className="text-xs font-mono font-black text-slate-200">{m?.btc ? '$' + m.btc.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—'}</div>
              <div className={`text-[9px] font-mono ${(m?.btcChangePct ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{m?.btcChangePct != null ? `${m.btcChangePct >= 0 ? '+' : ''}${m.btcChangePct.toFixed(2)}%` : ''}</div>
            </div>
            <div className="bg-black/30 rounded-xl px-2 py-1.5 text-center">
              <div className="text-[8px] text-slate-500 font-black tracking-wider">NSE</div>
              <div className={`text-xs font-black ${brief.nseOpen ? 'text-emerald-400' : 'text-slate-500'}`}>{brief.nseOpen ? 'OPEN' : 'CLOSED'}</div>
            </div>
          </div>

          {/* top signals */}
          <div className="grid sm:grid-cols-2 gap-2">
            {(['india', 'crypto'] as const).map(k => (
              <div key={k} className="bg-black/25 rounded-xl p-2.5">
                <div className="text-[9px] font-black text-slate-500 tracking-wider mb-1.5">{k === 'india' ? '🇮🇳 TOP NSE SIGNALS' : '₿ TOP CRYPTO SIGNALS'}</div>
                {(brief.topSignals[k] || []).length === 0 && <div className="text-[10px] text-slate-600">koi STRONG/ACTION nahi — silence is a signal</div>}
                {(brief.topSignals[k] || []).map((s, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11px] font-mono py-0.5">
                    <span className={`font-black ${s.side === 'LONG' ? 'text-emerald-400' : 'text-red-400'}`}>{s.side}</span>
                    <span className="text-slate-200 font-bold">{s.symbol}</span>
                    <span className="text-slate-500">{s.grade} {s.confidence}%</span>
                    {s.plan && <span className="text-slate-600 ml-auto text-[10px]">SL {s.plan.stopLoss} · T2 {s.plan.target2}</span>}
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* book + caps */}
          <div className="grid sm:grid-cols-2 gap-2">
            <div className="bg-black/25 rounded-xl p-2.5">
              <div className="text-[9px] font-black text-slate-500 tracking-wider mb-1.5">📋 OPEN BOOK</div>
              {(book?.openPositions || []).length === 0 && <div className="text-[10px] text-slate-600">flat — no open positions</div>}
              {(book?.openPositions || []).map((p, i) => (
                <div key={i} className="flex items-center gap-2 text-[11px] font-mono py-0.5">
                  <span className="text-slate-600">{p.market === 'INDIA' ? '🇮🇳' : '₿'}</span>
                  <span className={`font-black ${p.side === 'LONG' ? 'text-emerald-400' : 'text-red-400'}`}>{p.side}</span>
                  <span className="text-slate-200">{p.symbol}</span>
                  <span className="text-slate-500">{p.mode}</span>
                  <span className={`ml-auto ${(p.uPnl ?? 0) >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>{inr(p.uPnl, 0)}</span>
                </div>
              ))}
              <div className="mt-1.5 pt-1.5 border-t border-white/5 flex justify-between text-[10px] font-mono text-slate-500">
                <span>Today: {book?.tradesToday ?? 0}/{book?.caps?.dailyMaxTrades ?? '—'} trades</span>
                <span className={(book?.todayRealized ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}>{inr(book?.todayRealized ?? null)}</span>
              </div>
            </div>
            <div className="bg-black/25 rounded-xl p-2.5">
              <div className="text-[9px] font-black text-slate-500 tracking-wider mb-1.5">🛡️ GUARDS</div>
              <div className="grid grid-cols-2 gap-1 text-[10px] font-mono">
                {Object.entries(book?.caps?.blocked || {}).filter(([, v]) => v).length === 0
                  ? <div className="col-span-2 text-emerald-400">✅ sab clear — no cap breached</div>
                  : Object.entries(book?.caps?.blocked || {}).filter(([, v]) => v).map(([k2]) => (
                    <div key={k2} className="text-amber-300">⚠ {k2 === 'dailyTrades' ? 'daily trade cap' : k2 === 'dailyLoss' ? 'daily loss cap' : k2 === 'maxOpenPositions' ? 'max open positions' : k2}</div>
                  ))}
                <div className="col-span-2 text-slate-600 mt-1">open positions: {book?.openPositions?.length ?? 0} / {book?.caps?.maxOpenPositions ?? '—'} max</div>
              </div>
              {brief.ledger && (
                <div className="mt-1.5 pt-1.5 border-t border-white/5 flex items-center gap-2 text-[10px] font-mono text-slate-500">
                  <span>{brief.ledger.verified ? '🔒' : '⛔'} ledger {brief.ledger.entries} entries</span>
                  {brief.ledger.winRate != null && <span className={brief.ledger.winRate >= 50 ? 'text-emerald-400' : 'text-red-400'}>{brief.ledger.winRate}% WR</span>}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </PanelShell>
  );
});

// ---------------- Swing Desk ----------------
export const SwingDeskPanel = memo(function SwingDeskPanel({ market }: { market: MarketKind }) {
  const [board, setBoard] = useState<SwingBoard | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setBoard(await fetchSwingBoard(market));
    setLoading(false);
  }, [market]);

  useEffect(() => { load(); }, [load]);

  return (
    <PanelShell title={`🎣 Swing Desk — ${market === 'INDIA' ? '3–8 din ke setups (NSE)' : '2–6 din ke setups (crypto)'}`} tag="analysis only" onRefresh={load} loading={loading}>
      {!board?.ok && <EmptyNote>{loading ? 'Daily candles padh raha hai…' : 'No aligned swing setups right now — trend + momentum + structure sab align hona chahiye.'}</EmptyNote>}
      {board?.ok && (
        <>
          <div className="grid gap-2 lg:grid-cols-2">
            {board.ideas.map(i => (
              <div key={i.symbol} className={`bg-black/25 rounded-xl p-3 ${i.side === 'LONG' ? 'border-l-2 border-l-emerald-500/50' : 'border-l-2 border-l-red-500/50'}`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-black text-white">{i.symbol}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-black ${i.side === 'LONG' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300'}`}>{i.side}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-black ${i.grade === 'A' ? 'bg-cyan-500/15 text-cyan-300' : 'bg-slate-600/20 text-slate-300'}`}>grade {i.grade} · {i.score}/100</span>
                  <span className="text-[11px] font-mono text-slate-400 ml-auto">{inr(i.ltp)}</span>
                </div>
                {i.plan && (
                  <div className="mt-2 grid grid-cols-4 gap-1 text-[10px] font-mono text-center">
                    <div className="bg-black/30 rounded px-1 py-1"><div className="text-slate-600 text-[8px]">ENTRY</div><div className="text-slate-200">{i.plan.entry}</div></div>
                    <div className="bg-red-500/5 rounded px-1 py-1"><div className="text-red-400/70 text-[8px]">STOP</div><div className="text-red-300">{i.plan.stopLoss}</div></div>
                    <div className="bg-emerald-500/5 rounded px-1 py-1"><div className="text-emerald-400/70 text-[8px]">T1</div><div className="text-emerald-300">{i.plan.target1}</div></div>
                    <div className="bg-emerald-500/5 rounded px-1 py-1"><div className="text-emerald-400/70 text-[8px]">T2 (3R)</div><div className="text-emerald-300">{i.plan.target2}</div></div>
                  </div>
                )}
                <ul className="mt-1.5 space-y-0.5">
                  {(i.reasons || []).slice(0, 3).map((r, k) => <li key={k} className="text-[9px] text-slate-500">• {r}</li>)}
                </ul>
                <div className="text-[9px] text-slate-600 mt-1 font-mono">hold: {i.holdDays} · RSI {i.rsi ?? '—'} · risk {i.plan?.riskPct ?? '—'}%</div>
              </div>
            ))}
          </div>
          <p className="text-[9px] text-slate-600 mt-2 italic">⚠️ {board.disclaimer}</p>
        </>
      )}
    </PanelShell>
  );
});

// ---------------- Whale Radar ----------------
export const WhaleRadarPanel = memo(function WhaleRadarPanel({ market }: { market: MarketKind }) {
  const [radar, setRadar] = useState<WhaleRadar | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setRadar(await fetchWhales(market));
    setLoading(false);
  }, [market]);

  useEffect(() => { load(); }, [load]);

  return (
    <PanelShell title={`🐋 Whale Radar — ${market === 'INDIA' ? 'NSE volumes' : 'crypto volumes'}`} tag="flow hints" onRefresh={load} loading={loading}>
      {(!radar || radar.whales.length === 0) && <EmptyNote>{loading ? 'Tape scan ho raha hai…' : (radar?.note || 'No volume anomalies right now — quiet tape.')}</EmptyNote>}
      {radar && radar.whales.length > 0 && (
        <div className="grid gap-1.5 sm:grid-cols-2">
          {radar.whales.map((w, i) => (
            <div key={i} className={`bg-black/25 rounded-xl px-3 py-2 ${w.direction === 'ACCUMULATION' ? 'border-l-2 border-l-emerald-500/50' : 'border-l-2 border-l-red-500/50'}`}>
              <div className="flex items-center gap-2 text-[11px] font-mono">
                <span className="font-black text-white">{w.symbol}</span>
                <span className="text-cyan-300 font-black">{w.spike}×</span>
                <span className="text-slate-500 text-[10px]">vol</span>
                <span className={`ml-auto font-bold ${(w.changePct ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{(w.changePct ?? 0) >= 0 ? '+' : ''}{w.changePct?.toFixed(2) ?? '—'}%</span>
              </div>
              <div className="text-[9px] text-slate-500 mt-0.5">{w.note}</div>
            </div>
          ))}
        </div>
      )}
      {radar && radar.whales.length > 0 && <p className="text-[9px] text-slate-600 mt-2 italic">⚠️ {radar.note}</p>}
    </PanelShell>
  );
});

// ---------------- Signal Ledger (tamper-evident) ----------------
export const SignalLedgerPanel = memo(function SignalLedgerPanel() {
  const [ledger, setLedger] = useState<LedgerView | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLedger(await fetchLedger(20));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <PanelShell title="🔒 Signal Ledger — tamper-evident track record (SHA-256 hash chain)" tag="v6.7" onRefresh={load} loading={loading}>
      {!ledger && <EmptyNote>{loading ? 'Chain verify ho raha hai…' : 'Ledger unavailable'}</EmptyNote>}
      {ledger && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5 text-[10px] font-mono">
            <span className={`px-2 py-1 rounded-lg font-black ${ledger.verified ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/25' : 'bg-red-500/10 text-red-300 border border-red-500/25'}`}>
              {ledger.verified ? `✅ CHAIN INTACT — ${ledger.entries} entries` : `⛔ BROKEN @ ${ledger.brokenAt}`}
            </span>
            <span className="px-2 py-1 rounded-lg bg-black/30 text-slate-400">head <span className="text-cyan-300">{ledger.headHash || '—'}</span></span>
            <span className="px-2 py-1 rounded-lg bg-black/30 text-slate-400">settled {ledger.settled} · open {ledger.open}</span>
            <span className={`px-2 py-1 rounded-lg bg-black/30 ${ledger.winRate != null && ledger.winRate >= 50 ? 'text-emerald-300' : 'text-amber-300'}`}>
              {ledger.wins}W / {ledger.losses}L{ledger.winRate != null ? ` · ${ledger.winRate}%` : ''}
            </span>
          </div>
          <div className="text-[9px] text-slate-600 leading-relaxed">
            Har executed signal hash-chain me stamped hai — history koi (admin bhi) edit nahi kar sakta. Outcome close hone par hash ke andar hi settle hota hai — jo signal us waqt aisa tha, wahi proof hai.
          </div>
          {(ledger.recent || []).length > 0 && (
            <div className="overflow-x-auto max-h-64 overflow-y-auto">
              <table className="w-full text-[10px] font-mono">
                <thead className="sticky top-0 bg-[#0d1424]">
                  <tr className="text-[8px] text-slate-500 font-black tracking-wider">
                    <th className="px-1.5 py-1.5 text-left">TIME</th>
                    <th className="px-1.5 py-1.5 text-left">SYM</th>
                    <th className="px-1.5 py-1.5 text-left">SIDE</th>
                    <th className="px-1.5 py-1.5 text-left">GRADE</th>
                    <th className="px-1.5 py-1.5 text-left">MODE</th>
                    <th className="px-1.5 py-1.5 text-right">R</th>
                    <th className="px-1.5 py-1.5 text-left">HASH</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.recent.map((e, i) => (
                    <tr key={e.id} className={`border-t border-white/[0.03] ${i === 0 ? 'bg-cyan-500/5' : ''}`}>
                      <td className="px-1.5 py-1 text-slate-500">{new Date(e.ts).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })}</td>
                      <td className="px-1.5 py-1 text-slate-200 font-bold">{e.symbol}</td>
                      <td className={`px-1.5 py-1 font-black ${e.side === 'LONG' ? 'text-emerald-400' : 'text-red-400'}`}>{e.side}</td>
                      <td className="px-1.5 py-1 text-slate-500">{e.grade || '—'}</td>
                      <td className="px-1.5 py-1 text-slate-600">{e.mode}</td>
                      <td className={`px-1.5 py-1 text-right font-black ${e.outcome == null ? 'text-slate-600' : (e.outcome.r ?? 0) > 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                        {e.outcome == null ? 'open' : `${(e.outcome.r ?? 0) > 0 ? '+' : ''}${e.outcome.r?.toFixed(2) ?? '—'}`}
                      </td>
                      <td className="px-1.5 py-1 text-cyan-500/70">{e.hash}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </PanelShell>
  );
});

// ---------------- Orderbook (crypto only) ----------------
const BOOK_SYMBOLS = ['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'DOGE'];
export const OrderbookPanel = memo(function OrderbookPanel() {
  const [symbol, setSymbol] = useState('BTC');
  const [view, setView] = useState<OrderbookView | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (sym: string) => {
    setLoading(true);
    setView(await fetchOrderbook(sym));
    setLoading(false);
  }, []);

  useEffect(() => { load(symbol); }, [symbol, load]);

  const imb = view?.imbalancePct ?? 0;
  return (
    <PanelShell title="📖 Orderbook Depth — CoinDCX live book" tag="crypto" onRefresh={() => load(symbol)} loading={loading}>
      <div className="flex gap-1 flex-wrap mb-2.5">
        {BOOK_SYMBOLS.map(s => (
          <button key={s} onClick={() => setSymbol(s)} aria-pressed={symbol === s}
            className={`px-2.5 py-1 rounded-lg text-[10px] font-black transition-all ${symbol === s ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30' : 'text-slate-500 hover:text-slate-300 bg-black/20'}`}>
            {s}
          </button>
        ))}
      </div>
      {!view?.ok && <EmptyNote>{loading ? 'Book fetch ho raha hai…' : (view?.error || 'Orderbook unreachable from this host')}</EmptyNote>}
      {view?.ok && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-center">
            <div className="bg-emerald-500/5 rounded-xl px-2 py-1.5 border border-emerald-500/15">
              <div className="text-[8px] text-emerald-400/70 font-black tracking-wider">BEST BID</div>
              <div className="text-xs font-mono font-black text-emerald-300">{inr(view.bestBid)}</div>
            </div>
            <div className="bg-red-500/5 rounded-xl px-2 py-1.5 border border-red-500/15">
              <div className="text-[8px] text-red-400/70 font-black tracking-wider">BEST ASK</div>
              <div className="text-xs font-mono font-black text-red-300">{inr(view.bestAsk)}</div>
            </div>
            <div className="bg-black/30 rounded-xl px-2 py-1.5">
              <div className="text-[8px] text-slate-500 font-black tracking-wider">SPREAD</div>
              <div className="text-xs font-mono font-black text-slate-200">{view.spreadPct != null ? `${view.spreadPct}%` : '—'}</div>
            </div>
            <div className="bg-black/30 rounded-xl px-2 py-1.5">
              <div className="text-[8px] text-slate-500 font-black tracking-wider">IMBALANCE</div>
              <div className={`text-xs font-mono font-black ${imb > 15 ? 'text-emerald-300' : imb < -15 ? 'text-red-300' : 'text-slate-200'}`}>{imb > 0 ? '+' : ''}{imb}%</div>
            </div>
          </div>
          <div className="flex h-6 rounded-lg overflow-hidden border border-white/5">
            <div className="bg-emerald-500/25 flex items-center px-2 text-[9px] font-mono text-emerald-300" style={{ width: `${Math.max(4, 50 + Math.min(45, imb / 2))}%` }}>BID {view.bidVol?.toFixed(1)}</div>
            <div className="bg-red-500/25 flex items-center justify-end px-2 text-[9px] font-mono text-red-300 ml-auto" style={{ width: `${Math.max(4, 50 - Math.min(45, imb / 2))}%` }}>{view.askVol?.toFixed(1)} ASK</div>
          </div>
          <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono">
            <div className="bg-black/25 rounded-lg px-2 py-1.5 flex justify-between"><span className="text-slate-600">🧱 bid wall</span><span className="text-slate-300">{view.bidWall.price} ({view.bidWall.qty})</span></div>
            <div className="bg-black/25 rounded-lg px-2 py-1.5 flex justify-between"><span className="text-slate-600">🧱 ask wall</span><span className="text-slate-300">{view.askWall.price} ({view.askWall.qty})</span></div>
          </div>
          <div className="text-[10px] text-slate-400 bg-cyan-500/5 border border-cyan-500/15 rounded-lg px-2.5 py-1.5">{view.read}</div>
        </div>
      )}
    </PanelShell>
  );
});
