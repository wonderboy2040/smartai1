import React, { useState, useEffect } from 'react';

interface MarketHUDProps {
  wsLatency: { avg: number; heartbeat: number };
  liveStatus: string;
}

function pad(n: number) { return n.toString().padStart(2, '0'); }

function getCountdownTo(hour: number, min: number, tz: string): string {
  const now = new Date();
  const local = new Date(now.toLocaleString('en-US', { timeZone: tz }));
  const target = new Date(local);
  target.setHours(hour, min, 0, 0);
  if (target.getTime() <= local.getTime()) target.setDate(target.getDate() + 1);
  const diff = Math.max(0, target.getTime() - local.getTime());
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function isIndiaOpen(): boolean {
  const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const d = ist.getDay();
  if (d === 0 || d === 6) return false;
  const m = ist.getHours() * 60 + ist.getMinutes();
  return m >= 555 && m <= 930;
}

function isUSOpen(): boolean {
  const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const d = et.getDay();
  if (d === 0 || d === 6) return false;
  const m = et.getHours() * 60 + et.getMinutes();
  return m >= 570 && m <= 960;
}

function isIndiaPreMarket(): boolean {
  const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const d = ist.getDay();
  if (d === 0 || d === 6) return false;
  const m = ist.getHours() * 60 + ist.getMinutes();
  return m >= 480 && m < 555;
}

function isUSPreMarket(): boolean {
  const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const d = et.getDay();
  if (d === 0 || d === 6) return false;
  const m = et.getHours() * 60 + et.getMinutes();
  return m >= 240 && m < 570;
}

export const MarketHUD = React.memo(({ wsLatency, liveStatus }: MarketHUDProps) => {
  const [expanded, setExpanded] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const inOpen  = isIndiaOpen();
  const usOpen  = isUSOpen();
  const inPre   = isIndiaPreMarket();
  const usPre   = isUSPreMarket();
  const isLive  = liveStatus.includes('LIVE') || liveStatus.includes('ACTIVE');

  const latencyColor = wsLatency.avg < 300 ? 'text-emerald-400'
    : wsLatency.avg < 800 ? 'text-amber-400' : 'text-red-400';
  const latencyDot = wsLatency.avg < 300 ? 'bg-emerald-400'
    : wsLatency.avg < 800 ? 'bg-amber-400' : 'bg-red-400';

  let countdownLabel = '';
  let countdownVal   = '';
  if (inOpen) {
    countdownLabel = '🇮🇳 Closes';
    countdownVal   = getCountdownTo(15, 30, 'Asia/Kolkata');
  } else if (usOpen) {
    countdownLabel = '🇺🇸 Closes';
    countdownVal   = getCountdownTo(16, 0, 'America/New_York');
  } else if (inPre) {
    countdownLabel = '🇮🇳 Opens';
    countdownVal   = getCountdownTo(9, 15, 'Asia/Kolkata');
  } else {
    countdownLabel = '🇮🇳 Opens';
    countdownVal   = getCountdownTo(9, 15, 'Asia/Kolkata');
  }

  const mktBadge = inOpen || usOpen ? 'text-emerald-400' : inPre || usPre ? 'text-amber-400' : 'text-slate-500';
  const mktText  = inOpen && usOpen ? 'DUAL LIVE' : inOpen ? 'IN LIVE' : usOpen ? 'US LIVE'
    : inPre ? 'IN PRE' : usPre ? 'US PRE' : 'CLOSED';

  return (
    <div className="fixed top-[5.5rem] right-4 z-30 market-hud" style={{ userSelect: 'none' }}>
      {!expanded ? (
        /* ── Pill (collapsed) ── */
        <button
          onClick={() => setExpanded(true)}
          className="flex items-center gap-1.5 bg-slate-950/80 backdrop-blur-xl border border-white/10 rounded-xl px-2.5 py-1.5 shadow-lg hover:border-cyan-500/30 transition-all"
        >
          <div className={`w-1.5 h-1.5 rounded-full ${latencyDot} animate-pulse`} />
          <span className={`text-[10px] font-mono font-bold ${latencyColor}`}>{wsLatency.avg}ms</span>
          <span className="text-slate-700 text-[10px]">│</span>
          <span className={`text-[10px] font-mono font-bold ${mktBadge}`}>{mktText}</span>
        </button>
      ) : (
        /* ── Panel (expanded) ── */
        <div className="bg-slate-950/95 backdrop-blur-xl border border-cyan-500/20 rounded-2xl shadow-2xl shadow-cyan-500/5 w-52 animate-scale-in overflow-hidden">
          <div className="px-3 pt-3 pb-2 border-b border-white/5 flex items-center justify-between">
            <span className="text-[10px] font-bold text-cyan-400/80 uppercase tracking-wider">⚡ Market HUD</span>
            <button onClick={() => setExpanded(false)} className="text-slate-600 hover:text-slate-300 text-xs transition-colors">✕</button>
          </div>

          <div className="p-3 space-y-2">
            {/* Market Status */}
            <div className="grid grid-cols-2 gap-1.5">
              <div className="bg-black/20 rounded-lg p-1.5 text-center">
                <div className="text-[8px] text-slate-500 mb-0.5">🇮🇳 India</div>
                <div className={`text-[10px] font-bold ${inOpen ? 'text-emerald-400' : inPre ? 'text-amber-400' : 'text-slate-500'}`}>
                  {inOpen ? '● LIVE' : inPre ? '◐ PRE-MKT' : '○ CLOSED'}
                </div>
              </div>
              <div className="bg-black/20 rounded-lg p-1.5 text-center">
                <div className="text-[8px] text-slate-500 mb-0.5">🇺🇸 USA</div>
                <div className={`text-[10px] font-bold ${usOpen ? 'text-emerald-400' : usPre ? 'text-amber-400' : 'text-slate-500'}`}>
                  {usOpen ? '● LIVE' : usPre ? '◐ PRE-MKT' : '○ CLOSED'}
                </div>
              </div>
            </div>

            {/* Countdown */}
            <div className="bg-black/30 rounded-xl p-2.5 text-center border border-white/5">
              <div className="text-[8px] text-slate-500 mb-0.5 uppercase tracking-wider">{countdownLabel}</div>
              <div className="text-xl font-black text-cyan-400 font-mono tracking-wider">{countdownVal}</div>
            </div>

            {/* Connection Quality */}
            <div className="space-y-1">
              <div className="flex justify-between items-center">
                <span className="text-[9px] text-slate-500">WS Latency</span>
                <span className={`text-[9px] font-mono font-bold ${latencyColor}`}>{wsLatency.avg}ms</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[9px] text-slate-500">Heartbeat</span>
                <span className="text-[9px] font-mono text-cyan-400">{(wsLatency.heartbeat / 1000).toFixed(0)}s</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[9px] text-slate-500">Feed</span>
                <span className={`text-[9px] font-bold ${isLive ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {isLive ? '● TV SOCKET' : '● HTTP SYNC'}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
