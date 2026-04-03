import { useEffect, useState } from 'react';

export interface TradeLog {
  id: string;
  symbol: string;
  market: 'IN' | 'US';
  qty: number;
  entryPrice: number;
  exitPrice: number;
  date: number;
  pnl: number;
  pnlPct: number;
}

export function TradeJournal() {
  const [logs, setLogs] = useState<TradeLog[]>([]);

  useEffect(() => {
    const saved = localStorage.getItem('WEALTH_AI_JOURNAL');
    if (saved) setLogs(JSON.parse(saved));
  }, []);

  if (logs.length === 0) return null;

  const totalTrades = logs.length;
  const wins = logs.filter(l => l.pnl > 0).length;
  const winRate = (wins / totalTrades) * 100;
  
  const totalPnl = logs.reduce((a, b) => a + b.pnl, 0);

  return (
    <div className="glass-card rounded-2xl p-5 mt-5 border-white/5 animate-fade-in-up">
      <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
        <span className="w-7 h-7 rounded-lg bg-indigo-500/10 flex items-center justify-center text-sm">📓</span>
        AI Trade Journal
      </h3>
      
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="bg-black/20 p-3 rounded-xl border border-white/5 text-center">
          <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">Total Trades</div>
          <div className="text-xl font-black text-white font-mono">{totalTrades}</div>
        </div>
        <div className="bg-black/20 p-3 rounded-xl border border-white/5 text-center">
          <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">Win Rate</div>
          <div className={`text-xl font-black font-mono ${winRate >= 50 ? 'text-emerald-400' : 'text-amber-400'}`}>{winRate.toFixed(1)}%</div>
        </div>
        <div className="bg-black/20 p-3 rounded-xl border border-white/5 text-center">
          <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">Realized P&L</div>
          <div className={`text-lg font-black font-mono ${totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{totalPnl >= 0 ? '+' : ''}₹{totalPnl.toFixed(0)}</div>
        </div>
      </div>

      <div className="space-y-2 max-h-60 overflow-y-auto pr-2 custom-scrollbar">
        {logs.slice().reverse().map(l => {
          const isWin = l.pnl > 0;
          return (
            <div key={l.id} className="flex items-center justify-between p-3 bg-black/30 rounded-xl border border-white/5 hover:bg-white/5 transition-colors">
              <div>
                <div className="font-bold text-white text-sm flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${isWin ? 'bg-emerald-500' : 'bg-red-500'}`} />
                  {l.symbol.replace('.NS', '')}
                </div>
                <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                  {new Date(l.date).toLocaleDateString()} • Qty {l.qty}
                </div>
              </div>
              <div className="text-right">
                <div className={`font-black font-mono text-sm ${isWin ? 'text-emerald-400' : 'text-red-400'}`}>
                  {isWin ? '+' : ''}{l.pnl.toFixed(2)}
                </div>
                <div className={`text-[10px] font-bold ${isWin ? 'text-emerald-500' : 'text-red-500'}`}>
                  {isWin ? '+' : ''}{l.pnlPct.toFixed(2)}%
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Utility to save log outside component
export function logTrade(log: Omit<TradeLog, 'id'>) {
  const existing = localStorage.getItem('WEALTH_AI_JOURNAL');
  const logs: TradeLog[] = existing ? JSON.parse(existing) : [];
  logs.push({ ...log, id: Date.now().toString() });
  localStorage.setItem('WEALTH_AI_JOURNAL', JSON.stringify(logs));
}
