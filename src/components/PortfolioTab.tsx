import { TradeJournal } from './TradeJournal';

export function PortfolioTab(props: any) {
  const {
    loadFromCloud, setPortfolio, openAddModal, pushTelegramReport, syncStatus,
    usdInrRate, metrics, portfolio, livePrices, setAddSymbol, setTransactionType,
    setShowAddModal, fetchModalPriceData, setAddQty
  } = props;

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-black gradient-text-cyan font-display">
          💼 Portfolio
        </h2>
        <div className="flex gap-2">
          <button
            onClick={() => loadFromCloud().then((data: any) => { if (data) setPortfolio(data); })}
            className="btn-glass px-4 py-2 rounded-xl font-semibold text-sm"
          >
            📥 Sync
          </button>
          <button
            onClick={() => openAddModal()}
            className="btn-primary px-5 py-2 bg-gradient-to-r from-cyan-600 to-indigo-600 rounded-xl font-bold text-sm text-white"
          >
            + Add Asset
          </button>
          <button
            onClick={pushTelegramReport}
            className="btn-glass px-4 py-2 rounded-xl font-semibold text-sm text-indigo-300 border-indigo-500/20"
          >
            📲 TG {syncStatus}
          </button>
        </div>
      </div>

      <div className="glass-card rounded-xl p-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-base">💱</div>
          <span className="text-sm font-medium text-slate-400">USD/INR</span>
          <span className="text-base font-black text-emerald-400 font-mono">₹{usdInrRate.toFixed(2)}</span>
        </div>
        <span className="text-[10px] text-cyan-500/60 font-bold uppercase tracking-wider">Live Forex</span>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="stat-card glass-card rounded-2xl p-4 animate-fade-in-up">
          <div className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">Capital Deployed</div>
          <div className="text-xl font-black text-white font-mono mt-1">₹{Math.round(metrics.totalInvested).toLocaleString('en-IN')}</div>
          <div className="text-[10px] text-slate-600 mt-1 font-mono">${Math.round(metrics.totalInvested / usdInrRate).toLocaleString('en-US')}</div>
        </div>
        <div className="stat-card glass-card rounded-2xl p-4 border-cyan-500/15 animate-fade-in-up delay-75">
          <div className="text-cyan-500/80 text-[10px] font-bold uppercase tracking-wider">Current Equity</div>
          <div className="text-xl font-black text-cyan-400 font-mono mt-1">₹{Math.round(metrics.totalValue).toLocaleString('en-IN')}</div>
          <div className="text-[10px] text-slate-600 mt-1 font-mono">${Math.round(metrics.totalValue / usdInrRate).toLocaleString('en-US')}</div>
        </div>
        <div className="stat-card glass-card rounded-2xl p-4 animate-fade-in-up delay-150">
          <div className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">Total P&L</div>
          <div className={`text-xl font-black font-mono mt-1 ${metrics.totalPL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {metrics.totalPL >= 0 ? '+' : ''}₹{Math.round(metrics.totalPL).toLocaleString('en-IN')}
          </div>
          <div className={`text-xs font-bold mt-1 ${metrics.totalPL >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
            {metrics.plPct >= 0 ? '+' : ''}{metrics.plPct.toFixed(2)}%
          </div>
        </div>
        <div className="stat-card glass-card rounded-2xl p-4 animate-fade-in-up delay-200">
          <div className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">Today's P&L</div>
          <div className={`text-xl font-black font-mono mt-1 ${metrics.todayPL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {metrics.todayPL >= 0 ? '+' : ''}₹{Math.round(metrics.todayPL).toLocaleString('en-IN')}
          </div>
          <div className="flex gap-3 mt-1.5">
            <span className={`text-[10px] font-bold ${metrics.indPL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              🇮🇳 {metrics.indPL >= 0 ? '+' : ''}₹{Math.round(metrics.indPL).toLocaleString('en-IN')}
            </span>
            <span className={`text-[10px] font-bold ${metrics.usPL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              🦅 {metrics.usPL >= 0 ? '+' : ''}₹{Math.round(metrics.usPL).toLocaleString('en-IN')}
            </span>
          </div>
        </div>
      </div>

      <div className="glass-card rounded-2xl overflow-hidden animate-fade-in-up delay-200 p-1">
        <div className="hidden md:grid grid-cols-[1.5fr_1fr_1fr_1fr_1fr_auto] gap-4 px-6 py-3 bg-black/40 border-b border-white/5 text-[10px] uppercase tracking-wider text-slate-500 font-bold">
          <div>Asset & Allocation</div>
          <div>LTP & 24H Range</div>
          <div className="text-right">Today's P&L</div>
          <div className="text-right">Value (Eq)</div>
          <div className="text-right">Unrealized P&L</div>
          <div className="text-center w-20">Trade</div>
        </div>

        <div className="divide-y divide-white/[0.03]">
          {portfolio.map((p: any) => {
            const key = `${p.market}_${p.symbol}`;
            const data = livePrices[key];
            const curPrice = data?.price || p.avgPrice;
            const change = data?.change || 0;
            const cur = p.market === 'IN' ? '₹' : '$';
            const posSize = p.avgPrice * p.qty;
            const inv = posSize / (p.leverage || 1);
            const curVal = curPrice * p.qty;
            const pl = curVal - posSize;
            const plPct = inv > 0 ? (pl / inv) * 100 : 0;
            const eqVal = inv + pl;
            const prevPrice = curPrice / (1 + (change / 100));
            const todayPL = (curPrice - prevPrice) * p.qty;
            
            // Pro UI Calculations
            const low = data?.low || curPrice * 0.98;
            const high = data?.high || curPrice * 1.02;
            const rangePct = Math.max(0, Math.min(100, ((curPrice - low) / (high - low)) * 100)) || 50;
            const allocPct = metrics.totalValue > 0 ? (eqVal * (p.market === 'US' ? usdInrRate : 1) / metrics.totalValue) * 100 : 0;

            return (
              <div key={p.id} className="grid grid-cols-1 md:grid-cols-[1.5fr_1fr_1fr_1fr_1fr_auto] md:items-center gap-4 p-4 hover:bg-white/[0.02] transition-colors group relative">
                {/* 1. ASSET & ALLOCATION */}
                <div>
                  <div className="flex items-center justify-between md:justify-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-slate-800 to-slate-900 border border-white/10 shadow-inner flex items-center justify-center font-black text-xs text-white">
                      {p.symbol.substring(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1">
                      <div className="font-black text-white text-base tracking-tight flex items-center gap-2">
                        {p.symbol.replace('.NS', '')}
                        {p.leverage > 1 && <span className="bg-indigo-500/20 text-indigo-400 text-[9px] px-1.5 py-0.5 rounded border border-indigo-500/20">{p.leverage}x</span>}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${p.market === 'IN' ? 'bg-orange-500/10 text-orange-400' : 'bg-blue-500/10 text-blue-400'}`}>
                          {p.market === 'IN' ? 'NSE' : 'US'}
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono">Qty: {p.qty} @ {cur}{p.avgPrice.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                  {/* Dominance Bar */}
                  <div className="mt-3 flex items-center gap-2">
                    <div className="flex-1 h-1 bg-slate-800/80 rounded-full overflow-hidden">
                      <div className="h-full bg-cyan-500 transition-all rounded-full" style={{ width: `${allocPct}%` }} />
                    </div>
                    <div className="text-[9px] text-slate-500 font-mono w-7 text-right">{allocPct.toFixed(1)}%</div>
                  </div>
                </div>

                {/* 2. LTP & 24H RANGE */}
                <div className="flex justify-between md:block py-2 border-t border-b md:border-0 border-white/5 md:py-0">
                  <div className="md:hidden text-[10px] text-slate-500 uppercase font-bold mb-1">LTP Range</div>
                  <div className={`font-black font-mono text-lg md:text-base tracking-tight flex items-center gap-2 ${change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {cur}{curPrice.toFixed(2)}
                    <div className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] ${change >= 0 ? 'bg-emerald-500/10' : 'bg-red-500/10'}`}>
                      {change >= 0 ? '▲' : '▼'} {Math.abs(change).toFixed(2)}%
                    </div>
                  </div>
                  <div className="mt-2 text-[9px] text-slate-500 flex items-center justify-between xl:w-4/5 font-mono">
                    <span>L</span>
                    <div className="flex-1 mx-2 h-1 bg-slate-800 rounded-full relative">
                      <div className="absolute top-1/2 -translate-y-1/2 w-1.5 h-2.5 bg-white rounded-sm shadow-[0_0_5px_rgba(255,255,255,0.5)] transition-all z-10" style={{ left: `${rangePct}%` }} />
                      <div className="absolute top-0 bottom-0 left-0 bg-gradient-to-r from-red-500/30 to-emerald-500/30 rounded-full" style={{ width: `100%` }} />
                    </div>
                    <span>H</span>
                  </div>
                </div>

                {/* 3. TODAY'S P&L */}
                <div className="flex justify-between md:block md:text-right">
                  <div className="md:hidden text-[10px] text-slate-500 uppercase font-bold">Today</div>
                  <div className={`font-bold font-mono text-base ${todayPL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {todayPL >= 0 ? '+' : ''}{cur}{todayPL.toFixed(2)}
                  </div>
                  {data?.rsi && (
                    <div className="text-[9px] mt-1 hidden md:block">
                      <span className="text-slate-500">RSI: </span>
                      <span className={`font-bold font-mono ${data.rsi < 35 ? 'text-cyan-400' : data.rsi > 70 ? 'text-red-400' : 'text-slate-300'}`}>
                        {data.rsi.toFixed(0)}
                      </span>
                    </div>
                  )}
                </div>

                {/* 4. VALUE */}
                <div className="flex justify-between md:block md:text-right">
                  <div className="md:hidden text-[10px] text-slate-500 uppercase font-bold">Value</div>
                  <div className="font-bold font-mono text-base text-white tracking-tight">
                    {cur}{eqVal.toFixed(2)}
                  </div>
                  <div className="text-[9px] text-slate-500 mt-1 font-mono hidden md:block">
                    Eq Value
                  </div>
                </div>

                {/* 5. UNREALIZED P&L */}
                <div className="flex justify-between md:block md:text-right">
                  <div className="md:hidden text-[10px] text-slate-500 uppercase font-bold">Total P&L</div>
                  <div>
                    <div className={`font-black font-mono text-base tracking-tight ${pl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {pl >= 0 ? '+' : ''}{cur}{pl.toFixed(2)}
                    </div>
                    <div className={`text-[10px] font-bold mt-0.5 ${plPct >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                      ({plPct >= 0 ? '+' : ''}{plPct.toFixed(2)}%)
                    </div>
                  </div>
                </div>

                {/* 6. ACTIONS */}
                <div className="pt-2 md:pt-0 mt-3 border-t border-white/5 md:border-0 md:mt-0 flex justify-end gap-2 md:justify-center">
                  <button
                    onClick={() => { setAddSymbol(p.symbol); setTransactionType('buy'); setShowAddModal(true); fetchModalPriceData(p.symbol); }}
                    className="px-3 py-1.5 md:w-8 md:h-8 md:p-0 flex items-center justify-center bg-cyan-500/10 hover:bg-cyan-500 w-full md:hover:rotate-12 hover:shadow-[0_0_15px_rgba(6,182,212,0.4)] border border-cyan-500/30 rounded-lg transition-all text-xs text-cyan-400 hover:text-white font-bold uppercase tracking-wider"
                    title="Buy / Accumulate"
                  >
                    <span className="md:hidden mr-1">Buy</span> B
                  </button>
                  <button
                    onClick={() => { setAddSymbol(p.symbol); setAddQty(p.qty.toString()); setTransactionType('sell'); setShowAddModal(true); fetchModalPriceData(p.symbol); }}
                    className="px-3 py-1.5 md:w-8 md:h-8 md:p-0 flex items-center justify-center bg-red-500/10 hover:bg-red-500 w-full md:hover:-rotate-12 hover:shadow-[0_0_15px_rgba(239,68,68,0.4)] border border-red-500/30 rounded-lg transition-all text-xs text-red-400 hover:text-white font-bold uppercase tracking-wider"
                    title="Sell / Distribute"
                  >
                    <span className="md:hidden mr-1">Sell</span> S
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {portfolio.length === 0 && (
          <div className="p-12 text-center text-slate-500">
            <div className="text-6xl mb-4">🛰️</div>
            <p className="text-lg font-bold text-cyan-300/50 uppercase tracking-widest">Sensors Offline</p>
            <p className="text-sm mt-2">No assets detected in the neural grid.</p>
          </div>
        )}
      </div>

      <TradeJournal />
    </div>
  );
}
