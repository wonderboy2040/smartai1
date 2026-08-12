import React, { useMemo, useState, useRef, useEffect } from 'react';
import { useApp } from '../../hooks/AppContext';
import { getTodayString, isCryptoSymbol } from '../../utils/constants';
import { getCustomCloudConfig, saveCustomCloudConfig } from '../../utils/api';
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
type AssetGroup = 'india' | 'usa' | 'crypto';

interface GroupedAsset {
  p: ReturnType<typeof useApp>['portfolio'][0];
  allocPct: number;
  pl: number;
  plPct: number;
  plINR: number;
  valINR: number;
  xirr: number | null;
  group: AssetGroup;
}

interface GroupInfo {
  key: AssetGroup;
  emoji: string;
  label: string;
  flag: string;
  color: string;
  borderColor: string;
  bgColor: string;
  assets: GroupedAsset[];
  totalValueINR: number;
  totalPLINR: number;
  totalInvestedINR: number;
  allocPct: number;
}

function classifyAsset(symbol: string, market: string): AssetGroup {
  const clean = symbol.replace('.NS', '').replace('.BO', '');
  if (isCryptoSymbol(clean)) return 'crypto';
  return market === 'US' ? 'usa' : 'india';
}

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
  const [showCloudConfigModal, setShowCloudConfigModal] = useState(false);
  const [cfgCloudUrl, setCfgCloudUrl] = useState('');
  const [cfgBackendUrl, setCfgBackendUrl] = useState('');
  const [cfgCloudToken, setCfgCloudToken] = useState('');
  const [savedMsg, setSavedMsg] = useState('');

  useEffect(() => {
    const c = getCustomCloudConfig();
    setCfgCloudUrl(c.cloudUrl);
    setCfgBackendUrl(c.backendUrl);
    setCfgCloudToken(c.cloudToken);
  }, []);
  const handleCloudSync = async () => {
    setCloudMsg('📥 Loading…');
    try {
      const config = getCustomCloudConfig();
      const data = await loadFromCloud();
      if (data && data.length > 0) {
        setPortfolio(data);
        setCloudMsg(`✅ Loaded ${data.length}`);
      } else if (!config.cloudUrl && !config.backendUrl && !(import.meta.env.VITE_API_URL as string)) {
        setCloudMsg('⚙️ Set Cloud URL');
        setShowCloudConfigModal(true);
      } else if (data && data.length === 0) {
        setCloudMsg('⚠️ 0 items in cloud');
      } else {
        setCloudMsg('⚠️ Nothing in cloud');
      }
    } catch {
      setCloudMsg('⚠️ Sync failed');
    }
    if (cloudMsgTimerRef.current) clearTimeout(cloudMsgTimerRef.current);
    cloudMsgTimerRef.current = setTimeout(() => { setCloudMsg(''); cloudMsgTimerRef.current = null; }, 3500);
  };
  // (declared near top of component)
  const cloudMsgTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (cloudMsgTimerRef.current) clearTimeout(cloudMsgTimerRef.current); }, []);
  const [sortKey, setSortKey] = useState<SortKey>('alloc');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');
  const [collapsedGroups, setCollapsedGroups] = useState<Record<AssetGroup, boolean>>({ india: false, usa: false, crypto: false });

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

  // --- Grouped & sorted portfolio ---
  const groupedPortfolio = useMemo(() => {
    const q = search.trim().toUpperCase();
    const withMetrics: GroupedAsset[] = portfolio
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
        const group = classifyAsset(p.symbol, p.market);
        return { p, allocPct, pl, plPct, plINR, valINR, xirr: xirrMap[key] ?? null, group };
      });

    // Sort within groups
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

    // Build groups
    const groups: GroupInfo[] = [
      {
        key: 'india', emoji: '🇮🇳', label: 'India', flag: 'NSE/BSE',
        color: 'text-orange-400', borderColor: 'border-orange-500/20', bgColor: 'bg-orange-500/5',
        assets: [], totalValueINR: 0, totalPLINR: 0, totalInvestedINR: 0, allocPct: 0,
      },
      {
        key: 'usa', emoji: '🇺🇸', label: 'USA', flag: 'NASDAQ/NYSE',
        color: 'text-blue-400', borderColor: 'border-blue-500/20', bgColor: 'bg-blue-500/5',
        assets: [], totalValueINR: 0, totalPLINR: 0, totalInvestedINR: 0, allocPct: 0,
      },
      {
        key: 'crypto', emoji: '🪙', label: 'Crypto', flag: 'BTC/ETH',
        color: 'text-purple-400', borderColor: 'border-purple-500/20', bgColor: 'bg-purple-500/5',
        assets: [], totalValueINR: 0, totalPLINR: 0, totalInvestedINR: 0, allocPct: 0,
      },
    ];

    for (const asset of withMetrics) {
      const group = groups.find(g => g.key === asset.group)!;
      group.assets.push(asset);
      group.totalValueINR += asset.valINR;
      group.totalPLINR += asset.plINR;
      group.allocPct += asset.allocPct;
      // Invested
      const posSize = asset.p.avgPrice * asset.p.qty;
      const inv = posSize / (asset.p.leverage || 1);
      group.totalInvestedINR += inv * (asset.p.market === 'US' ? usdInrRate : 1);
    }

    return groups.filter(g => g.assets.length > 0);
  }, [portfolio, livePrices, usdInrRate, metrics.totalValue, xirrMap, search, sortKey, sortDir]);

  const totalVisible = groupedPortfolio.reduce((s, g) => s + g.assets.length, 0);

  const toggleGroup = (key: AssetGroup) => {
    setCollapsedGroups(prev => ({ ...prev, [key]: !prev[key] }));
  };

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
          <button
            onClick={() => setShowCloudConfigModal(true)}
            className="quantum-btn-ghost px-3 py-2 rounded-xl font-semibold text-sm text-cyan-400 border border-cyan-500/20 hover:border-cyan-500/50"
            title="Configure Cloud Sync & Backend URL"
          >
            ⚙️
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

      {/* Search / Sort toolbar */}
      {portfolio.length > 0 && (
        <div className="quantum-panel rounded-xl p-3 flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="🔍 Search asset…"
            className="quantum-input rounded-lg px-3 py-1.5 text-xs text-white bg-slate-900/60 flex-1 min-w-[140px]"
          />
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
          <span className="text-[10px] text-slate-500 font-mono">{totalVisible}/{portfolio.length}</span>
        </div>
      )}

      {/* ===== GROUPED ASSETS TABLE ===== */}
      <div className="space-y-3 animate-fade-in-up delay-200">
        {groupedPortfolio.map(group => {
          const isCollapsed = collapsedGroups[group.key];
          const plPct = group.totalInvestedINR > 0 ? (group.totalPLINR / group.totalInvestedINR) * 100 : 0;
          return (
            <div key={group.key} className="quantum-panel rounded-2xl overflow-hidden">
              {/* ===== Group Header ===== */}
              <button
                onClick={() => toggleGroup(group.key)}
                className={`w-full flex items-center justify-between p-3 ${group.bgColor} border-b ${group.borderColor} hover:bg-white/[0.02] transition-colors`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-xl">{group.emoji}</span>
                  <div className="text-left">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-black ${group.color}`}>{group.label}</span>
                      <span className="text-[8px] bg-white/5 border border-white/10 rounded px-1 py-0.5 text-slate-400 font-bold">{group.flag}</span>
                      <span className="text-[9px] bg-black/20 border border-white/5 rounded px-1.5 py-0.5 text-slate-300 font-bold">
                        {group.assets.length} asset{group.assets.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <div className="text-[9px] text-slate-500 mt-0.5">
                      Allocation: <span className={`font-bold ${group.color}`}>{group.allocPct.toFixed(1)}%</span> of portfolio
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <div className="text-sm font-black font-mono text-white">₹{Math.round(group.totalValueINR).toLocaleString('en-IN')}</div>
                    <div className={`text-[10px] font-bold font-mono ${group.totalPLINR >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {group.totalPLINR >= 0 ? '+' : ''}₹{Math.round(group.totalPLINR).toLocaleString('en-IN')}
                      <span className="ml-1">({plPct >= 0 ? '+' : ''}{plPct.toFixed(1)}%)</span>
                    </div>
                  </div>
                  {/* Alloc bar */}
                  <div className="hidden md:flex flex-col items-center gap-0.5 w-12">
                    <div className="w-full h-1.5 bg-slate-800/60 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${group.key === 'india' ? 'bg-orange-500' : group.key === 'usa' ? 'bg-blue-500' : 'bg-purple-500'}`}
                        style={{ width: `${Math.min(100, group.allocPct)}%` }} />
                    </div>
                    <span className="text-[8px] text-slate-500 font-mono">{group.allocPct.toFixed(0)}%</span>
                  </div>
                  <span className={`text-slate-500 transition-transform ${isCollapsed ? 'rotate-0' : 'rotate-180'}`}>▼</span>
                </div>
              </button>

              {/* ===== Group Assets ===== */}
              {!isCollapsed && (
                <>
                  {/* Desktop Header */}
                  <div className="hidden lg:grid grid-cols-[1.5fr_1fr_1fr_1fr_1fr_auto] gap-4 px-6 py-2 bg-black/40 border-b border-white/5 text-[10px] uppercase tracking-wider text-slate-500 font-bold">
                    <div>Asset & Allocation</div>
                    <div>LTP & 24H Range</div>
                    <div className="text-right">Today's P&L</div>
                    <div className="text-right">Value (Eq)</div>
                    <div className="text-right">Unrealized P&L</div>
                    <div className="text-center w-20">Trade</div>
                  </div>

                  <div className="divide-y divide-white/[0.03]">
                    {group.assets.map(({ p, allocPct, pl, plPct }) => {
                      const key = `${(p.market || 'IN').toUpperCase()}_${p.symbol}`;
                      const data = livePrices[key];
                      const curPrice = data?.price || p.avgPrice;
                      const change = data?.change || 0;
                      const cur = p.market === 'IN' ? '₹' : '$';
                      const posSize = p.avgPrice * p.qty;
                      const inv = posSize / (p.leverage || 1);
                      const curVal = curPrice * p.qty;
                      const eqVal = inv + (curVal - posSize);
                      const prevPrice = change <= -100 ? curPrice * 2 : curPrice / (1 + (change / 100));
                      const todayPL = (curPrice - prevPrice) * p.qty;
                      const assetXirr = xirrMap[key];

                      // Pro UI Calculations
                      const low = data?.low || curPrice * 0.98;
                      const high = data?.high || curPrice * 1.02;
                      const rangePct = Math.max(0, Math.min(100, ((curPrice - low) / (high - low)) * 100)) || 50;

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
                            <button
                              onClick={() => {
                                openAddModal(p);
                              }}
                              className="px-3 py-1.5 md:w-8 md:h-8 md:p-0 flex items-center justify-center bg-amber-500/10 hover:bg-amber-500 w-full md:hover:scale-110 hover:shadow-[0_0_15px_rgba(245,158,11,0.4)] border border-amber-500/30 rounded-lg transition-all text-xs text-amber-400 hover:text-white font-bold uppercase tracking-wider"
                              title="Edit Position details"
                            >
                              <span className="md:hidden mr-1">Edit</span> ✏️
                            </button>
                          </div>

                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          );
        })}

        {portfolio.length === 0 && (
          <div className="quantum-panel rounded-2xl p-10 text-center space-y-4">
            <div className="text-6xl animate-bounce">📊</div>
            <h3 className="text-xl font-black text-white font-display">No Portfolio Assets Loaded</h3>
            <p className="text-sm text-slate-400 max-w-md mx-auto">
              If your assets are in Google Sheets, link your Google Apps Script Web App URL below to fetch them automatically.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
              <button
                onClick={() => setShowCloudConfigModal(true)}
                className="px-5 py-2.5 bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white font-bold text-xs rounded-xl shadow-lg transition-all flex items-center gap-2"
              >
                ⚙️ Link Google Sheets URL
              </button>
              <button
                onClick={() => openAddModal()}
                className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-bold text-xs rounded-xl transition-all flex items-center gap-2"
              >
                + Add Asset Manually
              </button>
            </div>
          </div>
        )}
        {portfolio.length > 0 && totalVisible === 0 && (
          <div className="quantum-panel rounded-2xl p-10 text-center text-slate-500">
            <div className="text-4xl mb-3">🔍</div>
            <p className="text-sm">No assets match your search / filter.</p>
          </div>
        )}
      </div>

      {showCloudConfigModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700/60 rounded-2xl p-6 max-w-lg w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                ☁️ Cloud Sync & Backend Config
              </h3>
              <button
                onClick={() => setShowCloudConfigModal(false)}
                className="text-slate-400 hover:text-white text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-400">
              Configure your Google Apps Script Web App URL (`.../exec`) and Render Backend Proxy URL.
            </p>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  Google Apps Script URL (`.../exec`) OR Published Google Sheet CSV URL
                </label>
                <input
                  type="text"
                  value={cfgCloudUrl}
                  onChange={(e) => setCfgCloudUrl(e.target.value)}
                  placeholder="https://script.google.com/macros/s/.../exec OR https://docs.google.com/spreadsheets/d/.../pub?output=csv"
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono text-xs focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  Backend Proxy Server URL
                </label>
                <input
                  type="text"
                  value={cfgBackendUrl}
                  onChange={(e) => setCfgBackendUrl(e.target.value)}
                  placeholder="https://smartai1.onrender.com"
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono text-xs focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  Auth Token (Optional)
                </label>
                <input
                  type="text"
                  value={cfgCloudToken}
                  onChange={(e) => setCfgCloudToken(e.target.value)}
                  placeholder="WEALTH_AI_SYNC (default)"
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono text-xs focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => {
                  saveCustomCloudConfig('', '', '');
                  const c = getCustomCloudConfig();
                  setCfgCloudUrl(c.cloudUrl);
                  setCfgBackendUrl(c.backendUrl);
                  setCfgCloudToken(c.cloudToken);
                  setSavedMsg('Reset!');
                  setTimeout(() => setSavedMsg(''), 1500);
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-slate-200"
              >
                Reset Defaults
              </button>
              <button
                onClick={() => {
                  saveCustomCloudConfig(cfgCloudUrl, cfgBackendUrl, cfgCloudToken);
                  setSavedMsg('✅ Saved!');
                  setTimeout(() => {
                    setSavedMsg('');
                    setShowCloudConfigModal(false);
                    handleCloudSync();
                  }, 600);
                }}
                className="px-4 py-2 bg-gradient-to-r from-cyan-600 to-indigo-600 text-white rounded-xl text-xs font-bold shadow-lg"
              >
                {savedMsg || 'Save & Sync'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

export default PortfolioTab;
