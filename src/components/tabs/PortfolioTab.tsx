import React, { useMemo, useState, useRef, useEffect } from 'react';
import { useApp } from '../../hooks/AppContext';
import { getTodayString } from '../../utils/constants';
import { calculatePortfolioXIRR } from '../../utils/wealthEngine';
import { MonthlyReturnReport } from '../MonthlyReturnReport';
import { MonthlyPlanTracker } from '../MonthlyPlanTracker';
import { DailyPLTracker } from '../DailyPLTracker';
import TransactionHistoryPanel from '../TransactionHistoryPanel';
import PriceAlertsPanel from '../PriceAlertsPanel';
import { QualityScorecard } from '../QualityScorecard';
import { exportTransactionsCSV, exportMonthlyReturnsCSV } from '../../utils/exportData';
import { LivePrice } from '../LivePrice';
import { WidgetSetup } from '../WidgetSetup';

type SortKey = 'alloc' | 'pnl' | 'pnlPct' | 'xirr' | 'value' | 'name';

const PortfolioTab = React.memo(function PortfolioTab() {
  const {
    portfolio, livePrices, usdInrRate, metrics, transactions,
    openAddModal, pushTelegramReport, syncStatus, loadFromCloud, setPortfolio,
    setAddSymbol, setCurrentMarket, setAddQty, setAddPrice, setAddDate,
    setEditId, setTransactionType, setShowAddModal, setModalPrice,
    refreshAll, isRefreshing,
  } = useApp();

  // FEATURE 3: Track which holding the user wants to score.
  const [scorecardSymbol, setScorecardSymbol] = useState<string>('');
  const [scorecardMarket, setScorecardMarket] = useState<'IN' | 'US'>('IN');
  useEffect(() => {
    // Default to first holding if user hasn't picked one.
    if (!scorecardSymbol && portfolio.length > 0) {
      setScorecardSymbol(portfolio[0].symbol);
      setScorecardMarket(portfolio[0].market as 'IN' | 'US');
    }
  }, [portfolio, scorecardSymbol]);

  // --- Search / filter / sort controls ---
  const [search, setSearch] = useState('');
  const [cloudMsg, setCloudMsg] = useState('');
  const handleCloudSync = async () => {
    setCloudMsg('📥 Loading…');
    try {
      const data = await loadFromCloud();
      if (data && data.length > 0) {
        setPortfolio(data);
        setCloudMsg(`✅ Loaded ${data.length}`);
      } else {
        setCloudMsg('⚠️ Nothing in cloud');
      }
    } catch {
      setCloudMsg('⚠️ Sync failed');
    }
    // FIX L41: previously a bare setTimeout with no cleanup — if the user
    // unmounted PortfolioTab within 2.5s, React logged an unmounted-setState
    // warning. Store the timer and clear it on unmount.
    if (cloudMsgTimerRef.current) clearTimeout(cloudMsgTimerRef.current);
    cloudMsgTimerRef.current = setTimeout(() => { setCloudMsg(''); cloudMsgTimerRef.current = null; }, 2500);
  };
  // (declared near top of component)
  const cloudMsgTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (cloudMsgTimerRef.current) clearTimeout(cloudMsgTimerRef.current); }, []);
  const [marketFilter, setMarketFilter] = useState<'all' | 'IN' | 'US'>('all');
  const [sortKey, setSortKey] = useState<SortKey>('alloc');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');

  // --- XIRR Calculator ---
  const xirrData = useMemo(() =>
    calculatePortfolioXIRR(portfolio, livePrices, usdInrRate),
    [portfolio, livePrices, usdInrRate]
  );
  const xirrMap = useMemo(() => {
    const map: Record<string, number | null> = {};
    xirrData.perAsset.forEach(a => { map[`${a.market}_${a.symbol}`] = a.xirr; });
    return map;
  }, [xirrData]);

  // --- Filtered + sorted view of the portfolio grid ---
  const visiblePortfolio = useMemo(() => {
    const q = search.trim().toUpperCase();
    const withMetrics = portfolio
      .filter(p => marketFilter === 'all' || p.market === marketFilter)
      .filter(p => !q || p.symbol.toUpperCase().includes(q))
      .map(p => {
        const key = `${(p.market || 'IN').toUpperCase()}_${p.symbol}`;
        const data = livePrices[key];
        const curPrice = data?.price || p.avgPrice;
        const posSize = p.avgPrice * p.qty;
        const inv = posSize / (p.leverage || 1);
        const curVal = curPrice * p.qty;
        const pl = curVal - posSize;
        const plPct = inv > 0 ? (pl / inv) * 100 : 0;
        const eqVal = inv + pl;
        const allocPct = metrics.totalValue > 0 ? (eqVal * (p.market === 'US' ? usdInrRate : 1) / metrics.totalValue) * 100 : 0;
        const valINR = eqVal * (p.market === 'US' ? usdInrRate : 1);
        const plINR = pl * (p.market === 'US' ? usdInrRate : 1);
        return { p, allocPct, pl, plPct, plINR, valINR, xirr: xirrMap[key] ?? null };
      });
    const dir = sortDir === 'desc' ? -1 : 1;
    withMetrics.sort((a, b) => {
      switch (sortKey) {
        case 'name': return dir * a.p.symbol.localeCompare(b.p.symbol);
        case 'pnl': return dir * (a.plINR - b.plINR);
        case 'pnlPct': return dir * (a.plPct - b.plPct);
        case 'xirr': return dir * ((a.xirr ?? -9999) - (b.xirr ?? -9999));
        case 'value': return dir * (a.valINR - b.valINR);
        case 'alloc':
        default: return dir * (a.allocPct - b.allocPct);
      }
    });
    return withMetrics.map(w => w.p);
  }, [portfolio, livePrices, usdInrRate, metrics.totalValue, xirrMap, search, marketFilter, sortKey, sortDir]);

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-black gradient-text-cyan font-display">
          💼 Portfolio
        </h2>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={refreshAll}
            disabled={isRefreshing}
            className="quantum-btn-ghost px-4 py-2 rounded-xl font-semibold text-sm disabled:opacity-50"
            title="Force-refresh prices + forex"
          >
            <span className={isRefreshing ? 'inline-block animate-spin' : ''}>🔄</span> Refresh All
          </button>
          <button
            onClick={handleCloudSync}
            className="quantum-btn-ghost px-4 py-2 rounded-xl font-semibold text-sm"
            title="Load portfolio from Google Sheets cloud"
          >
            📥 {cloudMsg || 'Sync'}
          </button>
          <div className="relative group">
            <button className="quantum-btn-ghost px-4 py-2 rounded-xl font-semibold text-sm text-emerald-300 border border-emerald-500/20">
              ⬇️ Export
            </button>
            <div className="absolute right-0 mt-1 w-52 quantum-modal rounded-xl p-1 shadow-2xl z-30 hidden group-hover:block">
              <button
                onClick={() => exportTransactionsCSV(transactions)}
                className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/5 text-xs font-semibold text-slate-300"
              >
                🧾 Transactions (CSV)
              </button>
              <button
                onClick={() => exportMonthlyReturnsCSV(transactions, usdInrRate)}
                className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/5 text-xs font-semibold text-slate-300"
              >
                📈 Return Report (CSV)
              </button>
            </div>
          </div>
          <button
            onClick={() => openAddModal()}
            className="quantum-btn-primary px-5 py-2 bg-gradient-to-r from-cyan-600 to-indigo-600 rounded-xl font-bold text-sm text-white"
          >
            + Add Asset
          </button>
          <button
            onClick={pushTelegramReport}
            className="quantum-btn-ghost px-4 py-2 rounded-xl font-semibold text-sm text-indigo-300 border-indigo-500/20"
          >
            📲 TG {syncStatus}
          </button>
          <WidgetSetup />
        </div>
      </div>

      {/* USD/INR */}
      <div className="quantum-panel rounded-xl p-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-base">💱</div>
          <span className="text-sm font-medium text-slate-400">USD/INR</span>
          <span className="text-base font-black text-emerald-400 font-mono">₹{usdInrRate.toFixed(2)}</span>
        </div>
        <span className="text-[10px] text-cyan-500/60 font-bold uppercase tracking-wider">Live Forex • 24×7 · 30s</span>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="quantum-stat rounded-2xl p-4 animate-fade-in-up">
          <div className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">Capital Deployed</div>
          <div className="text-xl font-black text-white font-mono mt-1">₹{Math.round(metrics.totalInvested).toLocaleString('en-IN')}</div>
          <div className="text-[10px] text-slate-400 mt-1 font-mono flex items-center gap-1 flex-wrap">
            <span>🇮🇳 ₹{Math.round(metrics.totalInvestedINR || 0).toLocaleString('en-IN')}</span>
            <span className="text-slate-600 font-bold">•</span>
            <span>🦅 ${Math.round(metrics.totalInvestedUSD || 0).toLocaleString('en-US')}</span>
          </div>
        </div>
        <div className="quantum-stat rounded-2xl p-4 border-cyan-500/15 animate-fade-in-up delay-75">
          <div className="text-cyan-500/80 text-[10px] font-bold uppercase tracking-wider">Current Equity</div>
          <div className="text-xl font-black text-cyan-400 font-mono mt-1">₹{Math.round(metrics.totalValue).toLocaleString('en-IN')}</div>
          <div className="text-[10px] text-slate-400 mt-1 font-mono flex items-center gap-1 flex-wrap">
            <span>🇮🇳 ₹{Math.round(metrics.totalValueINR || 0).toLocaleString('en-IN')}</span>
            <span className="text-slate-600 font-bold">•</span>
            <span>🦅 ${Math.round(metrics.totalValueUSD || 0).toLocaleString('en-US')}</span>
          </div>
        </div>
        <div className="quantum-stat rounded-2xl p-4 animate-fade-in-up delay-150">
          <div className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">Total P&L</div>
          <div className={`text-xl font-black font-mono mt-1 ${metrics.totalPL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {metrics.totalPL >= 0 ? '+' : ''}₹{Math.round(metrics.totalPL).toLocaleString('en-IN')}
          </div>
          <div className="flex flex-col gap-0.5 mt-1">
            <div className={`text-xs font-bold ${metrics.totalPL >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
              {metrics.plPct >= 0 ? '+' : ''}{metrics.plPct.toFixed(2)}%
            </div>
            <div className="text-[9px] text-slate-400 font-mono flex items-center gap-1 flex-wrap mt-0.5">
              <span className={metrics.totalValueINR - metrics.totalInvestedINR >= 0 ? 'text-emerald-500/80' : 'text-red-500/80'}>
                🇮🇳 {metrics.totalValueINR - metrics.totalInvestedINR >= 0 ? '+' : ''}₹{Math.round(metrics.totalValueINR - metrics.totalInvestedINR).toLocaleString('en-IN')}
              </span>
              <span className="text-slate-600 font-bold">•</span>
              <span className={metrics.totalValueUSD - metrics.totalInvestedUSD >= 0 ? 'text-emerald-500/80' : 'text-red-500/80'}>
                🦅 {metrics.totalValueUSD - metrics.totalInvestedUSD >= 0 ? '+' : ''}${Math.round(metrics.totalValueUSD - metrics.totalInvestedUSD).toLocaleString('en-US')}
              </span>
            </div>
          </div>
        </div>
        <div className="quantum-stat rounded-2xl p-4 animate-fade-in-up delay-200">
          <div className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">Today's P&L</div>
          <div className={`text-xl font-black font-mono mt-1 ${metrics.todayPL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {metrics.todayPL >= 0 ? '+' : ''}₹{Math.round(metrics.todayPL).toLocaleString('en-IN')}
          </div>
          <div className="flex flex-wrap gap-2 mt-1.5">
            <span className={`text-[10px] px-1.5 py-0.5 rounded bg-black/20 font-bold ${metrics.indPL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              🇮🇳 IN: {metrics.indPL >= 0 ? '+' : ''}₹{Math.round(metrics.indPL).toLocaleString('en-IN')}
            </span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded bg-black/20 font-bold ${metrics.usPL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              🦅 US: {metrics.usPL >= 0 ? '+' : ''}₹{Math.round(metrics.usPL).toLocaleString('en-IN')}
            </span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded bg-black/20 font-bold ${metrics.cryptoPL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              🪙 Crypto: {metrics.cryptoPL >= 0 ? '+' : ''}₹{Math.round(metrics.cryptoPL).toLocaleString('en-IN')}
            </span>
          </div>
        </div>
      </div>

      {/* XIRR + Portfolio Intelligence */}
      {portfolio.length > 0 && (
        <div className="quantum-panel rounded-xl p-4 animate-fade-in-up delay-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center text-base">📊</div>
              <div>
                <div className="text-[10px] text-purple-400/80 font-bold uppercase tracking-wider">Portfolio XIRR (True Return)</div>
                <div className="text-[9px] text-slate-500">Time-weighted annualized return accounting for all buy dates</div>
              </div>
            </div>
            <div className={`text-2xl font-black font-mono ${(xirrData.overallXIRR || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {xirrData.overallXIRR !== null ? `${xirrData.overallXIRR >= 0 ? '+' : ''}${xirrData.overallXIRR.toFixed(1)}%` : 'N/A'}
            </div>
          </div>
          {/* Top/Bottom XIRR mini-list */}
          <div className="grid grid-cols-2 gap-3 mt-3">
            <div>
              <div className="text-[9px] text-emerald-400 font-bold uppercase mb-1">🏆 Best Performers</div>
              {xirrData.perAsset.filter(a => a.xirr !== null && a.xirr > 0).slice(0, 3).map(a => (
                <div key={a.symbol} className="flex justify-between text-[10px] py-0.5">
                  <span className="text-slate-300">{a.symbol.replace('.NS', '')}</span>
                  <span className="text-emerald-400 font-mono font-bold">+{a.xirr?.toFixed(1)}%</span>
                </div>
              ))}
            </div>
            <div>
              <div className="text-[9px] text-red-400 font-bold uppercase mb-1">⚠️ Needs Attention</div>
              {xirrData.perAsset.filter(a => a.xirr !== null).sort((a, b) => (a.xirr || 0) - (b.xirr || 0)).slice(0, 3).map(a => (
                <div key={a.symbol} className="flex justify-between text-[10px] py-0.5">
                  <span className="text-slate-300">{a.symbol.replace('.NS', '')}</span>
                  <span className={`font-mono font-bold ${(a.xirr || 0) >= 0 ? 'text-amber-400' : 'text-red-400'}`}>{a.xirr !== null ? `${a.xirr >= 0 ? '+' : ''}${a.xirr.toFixed(1)}%` : 'N/A'}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}


      {/* FEATURE: Monthly Plan Tracker — planned vs actual per market */}
      <MonthlyPlanTracker />

      {/* FEATURE: Daily P&L Tracker — today + last 7 days + monthly report */}
      <DailyPLTracker />

      {/* Monthly Return Report (month-wise booked + unrealized returns) */}
      <MonthlyReturnReport />

      {/* FEATURE 3: Stock Quality Scorecard — fundamental analysis */}
      {portfolio.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <div className="text-[10px] text-cyan-500/70 font-bold uppercase tracking-wider">Pick a holding for fundamental analysis:</div>
            <select
              value={scorecardSymbol}
              onChange={e => {
                const pos = portfolio.find(p => p.symbol === e.target.value);
                if (pos) {
                  setScorecardSymbol(pos.symbol);
                  setScorecardMarket(pos.market as 'IN' | 'US');
                }
              }}
              className="bg-black/40 border border-white/10 rounded-lg px-2 py-1 text-[11px] text-white outline-none"
            >
              {portfolio.map(p => (
                <option key={`${p.market}_${p.symbol}`} value={p.symbol}>
                  {p.symbol} ({p.market})
                </option>
              ))}
            </select>
          </div>
          {scorecardSymbol && (
            <QualityScorecard symbol={scorecardSymbol} market={scorecardMarket} />
          )}
        </div>
      )}

      {/* Price Alerts (target / stop-loss → Telegram) */}
      <PriceAlertsPanel />

      {/* Transaction History (full ledger with edit/delete) */}
      <TransactionHistoryPanel />

      {/* Search / Filter / Sort toolbar (helpful when assets pile up) */}
      {portfolio.length > 0 && (
        <div className="quantum-panel rounded-xl p-3 flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="🔍 Search asset…"
            className="quantum-input rounded-lg px-3 py-1.5 text-xs text-white bg-slate-900/60 flex-1 min-w-[140px]"
          />
          <select value={marketFilter} onChange={e => setMarketFilter(e.target.value as 'all' | 'IN' | 'US')}
            className="quantum-input rounded-lg px-2 py-1.5 text-xs text-white bg-slate-900/60">
            <option value="all">All markets</option>
            <option value="IN">🇮🇳 India</option>
            <option value="US">🇺🇸 US</option>
          </select>
          <select value={sortKey} onChange={e => setSortKey(e.target.value as SortKey)}
            className="quantum-input rounded-lg px-2 py-1.5 text-xs text-white bg-slate-900/60">
            <option value="alloc">Allocation</option>
            <option value="pnl">P&L (₹)</option>
            <option value="pnlPct">P&L %</option>
            <option value="xirr">XIRR</option>
            <option value="value">Value</option>
            <option value="name">Name</option>
          </select>
          <button
            onClick={() => setSortDir(d => (d === 'desc' ? 'asc' : 'desc'))}
            className="quantum-btn-ghost px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-300"
            title="Toggle sort direction"
          >
            {sortDir === 'desc' ? '↓ Desc' : '↑ Asc'}
          </button>
          <span className="text-[10px] text-slate-500 font-mono">{visiblePortfolio.length}/{portfolio.length}</span>
        </div>
      )}

      {/* Advance Pro Trader Portfolio Grid */}
      <div className="quantum-panel rounded-2xl overflow-hidden animate-fade-in-up delay-200 p-1">
        {/* Desktop Header */}
        <div className="hidden lg:grid grid-cols-[1.5fr_1fr_1fr_1fr_1fr_auto] gap-4 px-6 py-3 bg-black/40 border-b border-white/5 text-[10px] uppercase tracking-wider text-slate-500 font-bold">
          <div>Asset & Allocation</div>
          <div>LTP & 24H Range</div>
          <div className="text-right">Today's P&L</div>
          <div className="text-right">Value (Eq)</div>
          <div className="text-right">Unrealized P&L</div>
          <div className="text-center w-20">Trade</div>
        </div>

        <div className="divide-y divide-white/[0.03]">
          {visiblePortfolio.map(p => {
            const key = `${(p.market || 'IN').toUpperCase()}_${p.symbol}`;
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
            const prevPrice = change <= -100 ? curPrice * 2 : curPrice / (1 + (change / 100));
            const todayPL = (curPrice - prevPrice) * p.qty;
            const assetXirr = xirrMap[key];

            // Pro UI Calculations
            const low = data?.low || curPrice * 0.98;
            const high = data?.high || curPrice * 1.02;
            const rangePct = Math.max(0, Math.min(100, ((curPrice - low) / (high - low)) * 100)) || 50;
            const allocPct = metrics.totalValue > 0 ? (eqVal * (p.market === 'US' ? usdInrRate : 1) / metrics.totalValue) * 100 : 0;

            return (
              <div key={p.id} className="p-4 hover:bg-white/[0.02] transition-colors group relative lg:grid lg:grid-cols-[1.5fr_1fr_1fr_1fr_1fr_auto] lg:items-center lg:gap-4">

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
                        {assetXirr !== null && assetXirr !== undefined && <span className={`text-[9px] px-1.5 py-0.5 rounded border font-bold font-mono ${assetXirr >= 15 ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : assetXirr >= 0 ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>XIRR {assetXirr >= 0 ? '+' : ''}{assetXirr.toFixed(0)}%</span>}
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
                    <LivePrice value={curPrice} prefix={cur} decimals={2} />
                    <div className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] ${change >= 0 ? 'bg-emerald-500/10' : 'bg-red-500/10'}`}>
                      {change >= 0 ? '▲' : '▼'} {Math.abs(change).toFixed(2)}%
                    </div>
                  </div>
                  {/* 24H Scrubber */}
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
                    onClick={() => {
                      setAddSymbol(p.symbol);
                      setCurrentMarket(p.market);
                      setAddQty('');
                      setAddPrice(data?.price?.toString() || p.avgPrice.toString());
                      setAddDate(getTodayString());

                      setEditId(null);
                      setTransactionType('buy');
                      setShowAddModal(true);
                      setModalPrice(data ? { price: data.price, change: data.change, market: data.market } : null);
                    }}
                    className="px-3 py-1.5 md:w-8 md:h-8 md:p-0 flex items-center justify-center bg-cyan-500/10 hover:bg-cyan-500 w-full md:hover:rotate-12 hover:shadow-[0_0_15px_rgba(6,182,212,0.4)] border border-cyan-500/30 rounded-lg transition-all text-xs text-cyan-400 hover:text-white font-bold uppercase tracking-wider"
                    title="Buy / Accumulate"
                  >
                    <span className="md:hidden mr-1">Buy</span> B
                  </button>
                  <button
                    onClick={() => {
                      setAddSymbol(p.symbol);
                      setCurrentMarket(p.market);
                      setAddQty(p.qty.toString());
                      setAddPrice(data?.price?.toString() || p.avgPrice.toString());
                      setAddDate(p.dateAdded);

                      setEditId(p.id);
                      setTransactionType('sell');
                      setShowAddModal(true);
                      setModalPrice(data ? { price: data.price, change: data.change, market: data.market } : null);
                    }}
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
        {portfolio.length > 0 && visiblePortfolio.length === 0 && (
          <div className="p-10 text-center text-slate-500">
            <div className="text-4xl mb-3">🔍</div>
            <p className="text-sm">No assets match your search / filter.</p>
          </div>
        )}
      </div>
    </div>
  );
});

export default PortfolioTab;
