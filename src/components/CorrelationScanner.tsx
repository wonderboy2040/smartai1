import { Position, PriceData } from '../types';

export function CorrelationScanner({ portfolio, livePrices }: { portfolio: Position[], livePrices: Record<string, PriceData> }) {
  if (portfolio.length === 0) return null;

  // Calculate sector exposure
  const sectors: Record<string, number> = {};
  let totalValue = 0;

  portfolio.forEach(p => {
    const key = `${p.market}_${p.symbol}`;
    const data = livePrices[key];
    const val = (data?.price || p.avgPrice) * p.qty;
    totalValue += val;

    const sector = data?.sector || 'Unknown/Mixed';
    sectors[sector] = (sectors[sector] || 0) + val;
  });

  const alerts = [];
  const sectorEntries = Object.entries(sectors).map(([sector, val]) => {
    const pct = (val / totalValue) * 100;
    if (pct > 40 && sector !== 'Unknown/Mixed') {
      alerts.push(`High concentration (${pct.toFixed(0)}%) in ${sector} sector.`);
    }
    return { sector, pct, val };
  }).sort((a, b) => b.pct - a.pct);

  return (
    <div className="glass-card rounded-2xl p-5 border-amber-500/10 animate-fade-in-up">
      <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
        <span className="w-7 h-7 rounded-lg bg-amber-500/10 flex items-center justify-center text-sm">🕸️</span>
        Portfolio Correlation & Risk
      </h3>

      {alerts.length > 0 && (
        <div className="mb-4 bg-red-500/10 border border-red-500/20 p-3 rounded-xl">
          <div className="text-[10px] text-red-400 font-bold uppercase tracking-wider mb-1">🚨 Concentration Alerts</div>
          {alerts.map((a, i) => <div key={i} className="text-sm text-red-200">{a}</div>)}
        </div>
      )}

      <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-2">Sector Heatmap</div>
      <div className="space-y-3">
        {sectorEntries.map(({ sector, pct }) => (
          <div key={sector}>
            <div className="flex justify-between items-center mb-1 text-xs">
              <span className="text-white font-medium">{sector}</span>
              <span className="text-cyan-400 font-mono font-bold">{pct.toFixed(1)}%</span>
            </div>
            <div className="w-full bg-black/40 rounded-full h-1.5 overflow-hidden">
              <div 
                className={`h-full rounded-full ${pct > 40 ? 'bg-red-500' : pct > 20 ? 'bg-amber-400' : 'bg-emerald-500'}`} 
                style={{ width: `${pct}%` }} 
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
