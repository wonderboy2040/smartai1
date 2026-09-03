import React, { useMemo, useState, useRef, useEffect } from 'react';
import { useApp } from '../../hooks/AppContext';
import type { Position } from '../../types';
import { getTodayString, isCryptoPosition } from '../../utils/constants';
import { getCustomCloudConfig, saveCustomCloudConfig, setCoindcxManualBasis, clearCoindcxManualBasis } from '../../utils/api';
import { calculatePortfolioXIRR } from '../../utils/wealthEngine';
import { syncedAssetPnl } from '../../utils/assetPnl';
import { PortfolioInsights, type InsightsPanelAsset } from '../portfolio/PortfolioInsights';
import { AssetChartModal, type AssetChartTarget } from '../portfolio/AssetChartModal';
import { MonthlyReturnReport } from '../MonthlyReturnReport';
import { MonthlyPlanTracker } from '../MonthlyPlanTracker';
import { DailyPLTracker } from '../DailyPLTracker';
import TransactionHistoryPanel from '../TransactionHistoryPanel';
import PriceAlertsPanel from '../PriceAlertsPanel';
import { QualityScorecard } from '../QualityScorecard';
import { exportTransactionsCSV, exportMonthlyReturnsCSV, exportAssetsSnapshotCSV, type AssetSnapshotRow } from '../../utils/exportData';
import { LivePrice } from '../LivePrice';
import { WidgetSetup } from '../WidgetSetup';
import { INDMoneyPanel } from '../INDMoneyPanel';
import { CoinDcxPanel } from '../CoinDcxPanel';

type SortKey = 'alloc' | 'pnl' | 'pnlPct' | 'xirr' | 'value' | 'name' | 'today' | 'invested';
type AssetGroup = 'india' | 'usa' | 'crypto';

interface GroupedAsset {
  p: ReturnType<typeof useApp>['portfolio'][0];
  allocPct: number;
  pl: number;
  plPct: number;
  plINR: number;
  valINR: number;
  invINR: number;
  /** Native-currency current value (sync-truth + live delta). */
  eqVal: number;
  /** Native-currency cost basis (sync-truth invested ÷ — per-row cost). */
  invNative: number;
  /** Today's P&L in native currency ((live − prevClose) × qty). */
  todayPL: number;
  /** Live LTP in native currency (falls back to avg price). */
  ltp: number;
  xirr: number | null;
  group: AssetGroup;
  /** v5.1: true = genuine cost basis exists (sync-truth / trade ledger /
   *  manual avg) → pl is a real unrealized number. false = CoinDCX row
   *  without trade history → pl is drift-only, excluded from P&L totals. */
  hasBasis: boolean;
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
  /** rows without a cost basis (crypto without trade history) */
  noBasisCount: number;
}

function classifyAsset(p: Position): AssetGroup {
  // v6.2: classify by POSITION (source → name). The symbol name list
  // alone put every non-major coin (SHIB, PEPE, TRX, NEAR, …) in the INDIA
  // group with an NSE badge and polluted the "APP EXACT" 🇮🇳 card.
  if (isCryptoPosition(p)) return 'crypto';
  return p.market === 'US' ? 'usa' : 'india';
}

// Green/red flash when a live value ticks up/down (uses global flashUp/flashDown keyframes).
function useValueFlash(value: number): string {
  const prevRef = useRef(value);
  const [flash, setFlash] = useState('');
  useEffect(() => {
    if (value === prevRef.current) return;
    const dir = value > prevRef.current ? 'flash-up' : 'flash-down';
    prevRef.current = value;
    setFlash(dir);
    const t = setTimeout(() => setFlash(''), 850);
    return () => clearTimeout(t);
  }, [value]);
  return flash;
}

const PortfolioTab = React.memo(function PortfolioTab() {
  const {
    portfolio, livePrices, usdInrRate, usdAppRate, setUsdAppRate, metrics, transactions,
    openAddModal, pushTelegramReport, syncStatus, loadFromCloud, setPortfolio,
    setAddSymbol, setCurrentMarket, setAddQty, setAddPrice, setAddDate,
    setEditId, setTransactionType, setShowAddModal, setModalPrice,
    refreshAll, isRefreshing, loadIndmAssets,
    indmSource, indmMeta, removeIndmAsset, restoreIndmAsset,
  } = useApp();

  // A sync source (INDMoney MCP and/or CoinDCX) drives the asset table
  // → manual entry + Google Sheets UI retired while synced.
  const indmActive = indmSource === 'indmoney' || indmSource === 'coindcx';
  const hiddenAssets = indmMeta?.hiddenAssets || [];
  const [showHidden, setShowHidden] = useState(false);
  const [hidingKeys, setHidingKeys] = useState<Set<string>>(new Set());

  // --- v5.2 APP-PARITY calibration UI state ---
  // "Match App" (USA): INDMoney's app shows USD invested at ITS internal FX
  // (~buy-time rate); the site defaults to the live rate. The user enters
  // the app's $invested ONCE → the implied rate is stored → all 🦅 numbers
  // (invested / avg price / unrealized) match the app exactly.
  const [showMatchApp, setShowMatchApp] = useState(false);
  const [appUsdInput, setAppUsdInput] = useState('');
  // Crypto basis modal (CoinDCX): per-coin invested from the app's coin
  // pages, for keys without trade-history permission.
  const [showBasisModal, setShowBasisModal] = useState(false);
  const [basisInputs, setBasisInputs] = useState<Record<string, string>>({});
  const [basisSaving, setBasisSaving] = useState(false);

  const handleRemoveAsset = (p: (typeof portfolio)[number]) => {
    if (!p.indmKey) return;
    if (!window.confirm(`Remove "${p.name || p.symbol}" from the asset list?\n(Ye syncs ke saath hidden rahega — Restore option ke saath wapas laa sakte ho.)`)) return;
    setHidingKeys(prev => new Set(prev).add(p.indmKey!));
    void removeIndmAsset(p.indmKey).finally(() => {
      setHidingKeys(prev => { const n = new Set(prev); n.delete(p.indmKey!); return n; });
    });
  };

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

  // Live flash for the Today's P&L hero value.
  const todayPlFlash = useValueFlash(Math.round(metrics.todayPL));

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
  // 2026 perf audit (H3): XIRR runs a Newton-Raphson + bisection solve per
  // asset (N+1 numerical solves) — keying on the price-snapshot string
  // instead of the livePrices object identity so it only re-solves when a
  // RELEVANT price actually changed, not when any unrelated symbol ticked.
  const xirrPriceKey = useMemo(() =>
    portfolio.map(p => (livePrices[`${p.market}_${p.symbol}`]?.price ?? 0).toFixed(2)).join('|') + `@${usdInrRate.toFixed(2)}`,
    [portfolio, livePrices, usdInrRate]);
  const xirrData = useMemo(() =>
    calculatePortfolioXIRR(portfolio, livePrices, usdInrRate),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [portfolio, xirrPriceKey]
  );
  const xirrMap = useMemo(() => {
    const map: Record<string, number | null> = {};
    xirrData.perAsset.forEach(a => { map[`${a.market}_${a.symbol}`] = a.xirr; });
    return map;
  }, [xirrData]);

  // --- v4.5/v6.2: per-row metrics over the FULL portfolio ---
  // Computed unfiltered ONCE: the table search filters a COPY for display,
  // while the insights X-ray needs the whole portfolio (feeding it the
  // search-filtered subset against the full-portfolio denominator made
  // HHI / top-weight / market-split silently mutate while typing).
  const portfolioMetrics = useMemo<GroupedAsset[]>(() => portfolio
    .map(p => {
        const key = `${(p.market || 'IN').toUpperCase()}_${p.symbol}`;
        const data = livePrices[key];
        const curPrice = data?.price || p.avgPrice;
        // EXACT-MATCH P&L (v4.4): synced rows ground in INDMoney's own
        // snapshot pnl + live-tick delta (assetPnl.ts) — rows + group
        // totals now match the INDMoney app; manual rows keep legacy math.
        // v5.2: usdAppRate calibrates US rows' invested side to INDMoney's
        // internal FX → the 🦅 avg price / invested / pnl match the app.
        const pnlTruth = syncedAssetPnl(p, curPrice, usdInrRate, usdAppRate);
        const eqVal = pnlTruth.value;
        const pl = pnlTruth.pnl;
        const plPct = pnlTruth.pnlPct ?? 0;
        const allocPct = metrics.totalValue > 0 ? (pnlTruth.valueINR / metrics.totalValue) * 100 : 0;
        const valINR = pnlTruth.valueINR;
        const plINR = pnlTruth.pnlINR;
        const invINR = pnlTruth.investedINR;
        // v4.5: per-row cost + today P&L computed ONCE here (row render,
        // insights, sorting and CSV export all reuse the same numbers).
        // v5.2: US rows convert INR invested at the CALIBRATED rate when
        // set — that is what the app's Avg. Price column shows (the old
        // live-FX conversion was the per-row avg mismatch).
        const usRate = usdAppRate ?? (usdInrRate || 1);
        const invNative = p.market === 'US'
          ? (p.indmInvestedINR != null ? p.indmInvestedINR / usRate : p.avgPrice * p.qty)
          : (p.indmInvestedINR != null ? p.indmInvestedINR : p.avgPrice * p.qty);
        const change = data?.change || 0;
        const prevPrice = (data?.prevClose && data.prevClose > 0)
          ? data.prevClose
          : (change <= -100 ? curPrice * 2 : curPrice / (1 + (change / 100)));
        const todayPL = (curPrice - prevPrice) * p.qty;
        const group = classifyAsset(p);
        const hasBasis = pnlTruth.hasBasis;
        return { p, allocPct, pl, plPct, plINR, valINR, invINR, eqVal, invNative, todayPL, ltp: curPrice, xirr: xirrMap[key] ?? null, group, hasBasis };
    }), [portfolio, livePrices, usdInrRate, usdAppRate, metrics.totalValue, xirrMap]);

  // --- Grouped & sorted (search-filtered) table ---
  const groupedPortfolio = useMemo(() => {
    const q = search.trim().toUpperCase();
    const withMetrics: GroupedAsset[] = q
      ? portfolioMetrics.filter(a => a.p.symbol.toUpperCase().includes(q))
      : portfolioMetrics;

    // Sort within groups
    const dir = sortDir === 'desc' ? -1 : 1;
    withMetrics.sort((a, b) => {
      switch (sortKey) {
        case 'name': return dir * a.p.symbol.localeCompare(b.p.symbol);
        case 'pnl': return dir * (a.plINR - b.plINR);
        case 'pnlPct': return dir * (a.plPct - b.plPct);
        case 'xirr': return dir * ((a.xirr ?? -9999) - (b.xirr ?? -9999));
        case 'value': return dir * (a.valINR - b.valINR);
        case 'today': return dir * (a.todayPL - b.todayPL);
        case 'invested': return dir * (a.invINR - b.invINR);
        case 'alloc':
        default: return dir * (a.allocPct - b.allocPct);
      }
    });

    // Build groups
    const groups: GroupInfo[] = [
      {
        key: 'india', emoji: '🇮🇳', label: 'India', flag: 'NSE/BSE',
        color: 'text-orange-400', borderColor: 'border-orange-500/20', bgColor: 'bg-orange-500/5',
        assets: [], totalValueINR: 0, totalPLINR: 0, totalInvestedINR: 0, allocPct: 0, noBasisCount: 0,
      },
      {
        key: 'usa', emoji: '🇺🇸', label: 'USA', flag: 'NASDAQ/NYSE',
        color: 'text-blue-400', borderColor: 'border-blue-500/20', bgColor: 'bg-blue-500/5',
        assets: [], totalValueINR: 0, totalPLINR: 0, totalInvestedINR: 0, allocPct: 0, noBasisCount: 0,
      },
      {
        key: 'crypto', emoji: '🪙', label: 'Crypto', flag: 'BTC/ETH',
        color: 'text-purple-400', borderColor: 'border-purple-500/20', bgColor: 'bg-purple-500/5',
        assets: [], totalValueINR: 0, totalPLINR: 0, totalInvestedINR: 0, allocPct: 0, noBasisCount: 0,
      },
    ];

    for (const asset of withMetrics) {
      const group = groups.find(g => g.key === asset.group)!;
      group.assets.push(asset);
      group.totalValueINR += asset.valINR;
      // v5.1: P&L sums count basis-known rows ONLY — a basis-less row's
      // value must never masquerade as returns (the India +₹10k bug).
      if (asset.hasBasis) group.totalPLINR += asset.plINR;
      else group.noBasisCount += 1;
      group.allocPct += asset.allocPct;
      // Invested — sync-truth native → INR (v4.4 exact-match pass).
      group.totalInvestedINR += asset.invINR;
    }

    return groups.filter(g => g.assets.length > 0);
  }, [portfolioMetrics, search, sortKey, sortDir]);

  const totalVisible = groupedPortfolio.reduce((s, g) => s + g.assets.length, 0);

  // --- v5.2: raw US INR invested (Σ INDMoney's INR aggregates) — the
  // "Match App" flow divides this by the app's $invested to derive the
  // internal FX rate. ---
  const usInrInvested = useMemo(() => portfolio
    .filter(p => p.market === 'US' && typeof p.indmInvestedINR === 'number')
    .reduce((s, p) => s + (p.indmInvestedINR || 0), 0), [portfolio]);

  // --- v5.2: crypto rows for the manual-basis modal (CoinDCX) ---
  const cryptoRows = useMemo(() => portfolio
    .filter(p => p.source === 'coindcx')
    .map(p => ({ symbol: p.symbol, qty: p.qty, valINR: (p.indmInvestedINR != null ? undefined : p.qty * (p.indmLastPrice || p.avgPrice || 0)) }))
    .filter(r => !!r.symbol), [portfolio]);

  // --- v4.5: save the crypto manual basis (per-coin invested) ---
  const handleSaveBasis = async () => {
    setBasisSaving(true);
    try {
      let any = false;
      let failed = 0;
      for (const [coin, val] of Object.entries(basisInputs)) {
        // v6.2: Indian number format ("1,23,456") is common — strip the
        // separators instead of silently discarding the row (the old NaN
        // skip closed the modal looking saved while nothing was written).
        const n = Number(String(val).replace(/,/g, '').trim());
        if (String(val).trim() === '' || !Number.isFinite(n)) continue;
        if (n > 0) {
          const ok = await setCoindcxManualBasis(coin, n);
          any = any || ok;
          if (!ok) failed++;
        }
        else { await clearCoindcxManualBasis(coin); any = true; }
      }
      if (failed > 0) {
        // v6.2: a rejected save (401 / network) must not close the modal
        // silently — the entered amounts would be lost.
        alert(`${failed} coin ka basis save FAIL hua (session/server issue). Modal open hai — Save dobara dabao.`);
        return;
      }
      if (any) await loadIndmAssets(true); // pull the refreshed rows
      setShowBasisModal(false);
    } finally {
      setBasisSaving(false);
    }
  };

  // --- v4.5: Insights feed (FULL portfolio, same sync-truth rows) ---
  const insightAssets = useMemo<InsightsPanelAsset[]>(() =>
    portfolioMetrics.map(a => ({
      label: (a.p.symbol || '').replace('.NS', '').trim() || (a.p.name || 'ASSET'),
      group: a.group,
      pl: a.pl,
      plPct: a.plPct,
      // v6.2: ₹-normalize before ranking/display — a US row's native $ P&L
      // ranked ~85× too low against ₹ rows in Today's Winners/Losers.
      todayPL: a.p.market === 'US' ? a.todayPL * (usdInrRate || 1) : a.todayPL,
      valINR: a.valINR,
    })),
    [portfolioMetrics, usdInrRate]);

  // --- v4.5: per-row chart modal target ---
  const [chartTarget, setChartTarget] = useState<AssetChartTarget | null>(null);
  const openAssetChart = (p: GroupedAsset['p'], invNative: number) => {
    const key = `${(p.market || 'IN').toUpperCase()}_${p.symbol}`;
    const data = livePrices[key];
    setChartTarget({
      symbol: p.symbol,
      name: p.name,
      market: p.market === 'US' ? 'US' : 'IN',
      avgPrice: invNative > 0 ? invNative / (p.qty || 1) : p.avgPrice,
      qty: p.qty,
      livePrice: data?.price,
      change: data?.change,
    });
  };

  // --- v4.5: assets snapshot CSV (the exact table view frozen to a file) ---
  const handleExportSnapshot = () => {
    const rows: AssetSnapshotRow[] = groupedPortfolio.flatMap(g => g.assets.map(a => {
      const key = `${(a.p.market || 'IN').toUpperCase()}_${a.p.symbol}`;
      const data = livePrices[key];
      return {
        symbol: a.p.symbol,
        name: a.p.name,
        market: g.key === 'crypto' ? 'CRYPTO' : (a.p.market === 'US' ? 'US' : 'IN'),
        qty: a.p.qty,
        avgPrice: a.p.avgPrice,
        ltp: a.ltp,
        changePct: data?.change ?? 0,
        investedNative: a.invNative,
        valueNative: a.eqVal,
        pnlNative: a.pl,
        pnlPct: a.plPct,
        todayPLNative: a.todayPL,
        valueINR: a.valINR,
      };
    }));
    exportAssetsSnapshotCSV(rows, usdInrRate);
  };

  const toggleGroup = (key: AssetGroup) => {
    setCollapsedGroups(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="space-y-5 animate-fade-in">
      {/* INDMoney official MCP integration — real portfolio read-only view */}
      <INDMoneyPanel />
      {/* CoinDCX crypto exchange account — balances in the same table */}
      <CoinDcxPanel />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-black gradient-text-cyan font-display">
          💼 Portfolio
        </h2>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={refreshAll}
            disabled={isRefreshing}
            className="quantum-btn-ghost px-4 py-2 rounded-xl font-semibold text-sm disabled:opacity-50"
            title={indmActive ? 'Re-fetch INDMoney snapshot + refresh prices + forex' : 'Force-refresh prices + forex'}
          >
            <span className={isRefreshing ? 'inline-block animate-spin' : ''}>🔄</span> Refresh All
          </button>
          {!indmActive && (
            <>
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
            </>
          )}
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
              <button
                onClick={handleExportSnapshot}
                className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/5 text-xs font-semibold text-cyan-300"
                title="Live assets-table view — LTP, cost, unrealized P&L, today's P&L, INR values"
              >
                📸 Assets Snapshot (CSV)
              </button>
            </div>
          </div>
          {!indmActive && (
            <button
              onClick={() => openAddModal()}
              className="quantum-btn-primary px-5 py-2 bg-gradient-to-r from-cyan-600 to-indigo-600 rounded-xl font-bold text-sm text-white"
            >
              + Add Asset
            </button>
          )}
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

      {/* v5.2 APP-PARITY SUMMARY — each card mirrors the OFFICIAL app's
          section exactly (the numbers the user cross-checks daily):
          🇮🇳 INDMoney INDIA (INR native, app-exact to the paisa) ·
          🦅 INDMoney USA (USD — invested at the app's internal FX via the
          one-time "Match App" calibration) · 🪙 CoinDCX crypto (invested
          from the trade ledger, or the manual basis fallback).
          The old mixed-level cards (all-market headline + India sub-lines)
          read as "Total Returns 35,372" against the app's INDIA 25,376 —
          the gap was the US pnl's FX gain sitting inside an all-market
          number. Now every number sits at its own clearly-labeled level. */}
      <div className="quantum-panel rounded-xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">All Markets</span>
          <span className="text-sm font-black text-white font-mono">₹{Math.round(metrics.totalValue).toLocaleString('en-IN')}</span>
          <span className="text-[10px] text-slate-500 font-mono">inv ₹{Math.round(metrics.totalInvested).toLocaleString('en-IN')}</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-sm font-black font-mono ${metrics.totalPL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}
            title={`Whole-portfolio P&L in INR. 🦅 contribution uses app-parity (stock-only) math; INDMoney's own INR-native total (US pnl incl. FX gains) would be a few % higher on the US leg when the rupee has moved.`}>
            {metrics.totalPL >= 0 ? '+' : ''}₹{Math.round(metrics.totalPL).toLocaleString('en-IN')}
            <span className={`text-[10px] ml-1 ${metrics.plPct >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>({metrics.plPct >= 0 ? '+' : ''}{metrics.plPct.toFixed(2)}%)</span>
          </span>
          <span className="text-[10px] text-slate-400 font-mono flex items-center gap-1.5 flex-wrap">
            <span className={metrics.totalValueINR - metrics.totalInvestedINR >= 0 ? 'text-emerald-500/80' : 'text-red-500/80'}>🇮🇳 {metrics.totalValueINR - metrics.totalInvestedINR >= 0 ? '+' : ''}₹{Math.round(metrics.totalValueINR - metrics.totalInvestedINR).toLocaleString('en-IN')}</span>
            <span className="text-slate-600 font-bold">•</span>
            <span className={metrics.usPnlUSD >= 0 ? 'text-emerald-500/80' : 'text-red-500/80'}>🦅 {metrics.usPnlUSD >= 0 ? '+' : ''}${Math.round(metrics.usPnlUSD).toLocaleString('en-US')}</span>
            {metrics.totalValueCRYPTO > 0 && (
              <>
                <span className="text-slate-600 font-bold">•</span>
                <span className={metrics.totalInvestedCRYPTO > 0 ? (metrics.totalPLCRYPTO >= 0 ? 'text-emerald-500/80' : 'text-red-500/80') : 'text-slate-500'}>
                  🪙 {metrics.totalInvestedCRYPTO > 0 ? `${metrics.totalPLCRYPTO >= 0 ? '+' : ''}₹${Math.round(metrics.totalPLCRYPTO).toLocaleString('en-IN')}` : 'P&L n/a'}
                </span>
              </>
            )}
          </span>
        </div>
      </div>

      {/* SECTION CARDS — one per official app section */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        {/* 🇮🇳 INDIA — INDMoney app's INDIA section, INR native, app-exact */}
        <div className="quantum-stat rounded-2xl p-4 border border-orange-500/20 bg-orange-500/[0.03] animate-fade-in-up">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-bold uppercase tracking-wider text-orange-400/90">🇮🇳 India · INDMoney</div>
            <span className="text-[8px] font-black text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 rounded px-1.5 py-0.5" title="Invested/Value/Returns match the INDMoney app's INDIA section exactly (same INR numbers, sync-time truth + live ticks)">
              APP EXACT
            </span>
          </div>
          <div className="mt-2.5 space-y-1.5 font-mono">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Invested</span>
              <span className="text-sm font-black text-white">₹{(metrics.totalInvestedINR || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Current Value</span>
              <span className="text-sm font-black text-cyan-300">₹{(metrics.totalValueINR || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
            <div className="flex items-baseline justify-between gap-2 pt-1 border-t border-white/5">
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Total Returns</span>
              <span className={`text-base font-black ${metrics.totalValueINR - metrics.totalInvestedINR >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {metrics.totalValueINR - metrics.totalInvestedINR >= 0 ? '+' : ''}₹{(metrics.totalValueINR - metrics.totalInvestedINR).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                <span className={`text-[10px] ml-1 ${metrics.indiaPct >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>({metrics.indiaPct >= 0 ? '+' : ''}{metrics.indiaPct.toFixed(2)}%)</span>
              </span>
            </div>
          </div>
          <div className="text-[9px] text-slate-500 mt-2">= app ke INDIA section wale numbers (INR)</div>
        </div>

        {/* 🦅 USA — INDMoney app's USA section, USD native */}
        <div className="quantum-stat rounded-2xl p-4 border border-blue-500/20 bg-blue-500/[0.03] animate-fade-in-up delay-75">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-bold uppercase tracking-wider text-blue-400/90">🦅 USA · INDMoney</div>
            {usdAppRate ? (
              <button
                onClick={() => { setAppUsdInput(''); setShowMatchApp(v => !v); }}
                className="text-[8px] font-black text-cyan-300 bg-cyan-500/10 border border-cyan-500/25 rounded px-1.5 py-0.5 hover:bg-cyan-500/20"
                title={`App-parity FX ₹${usdAppRate.toFixed(2)} set hai — click karke update/reset karo`}
              >
                APP FX ₹{usdAppRate.toFixed(2)} ✏️
              </button>
            ) : (
              <button
                onClick={() => { setAppUsdInput(''); setShowMatchApp(v => !v); }}
                className="text-[8px] font-black text-amber-300 bg-amber-500/10 border border-amber-500/25 rounded px-1.5 py-0.5 hover:bg-amber-500/20"
                title="INDMoney app apne USD invested ko apne internal FX rate se convert karta hai (live se nahi). Ek baar app ka $invested daalo — site baaki sab match kar degi."
              >
                ✏️ Match App
              </button>
            )}
          </div>
          <div className="mt-2.5 space-y-1.5 font-mono">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Invested</span>
              <span className="text-sm font-black text-white">${(metrics.totalInvestedUSD || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Current Value</span>
              <span className="text-sm font-black text-cyan-300">${(metrics.totalValueUSD || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
            <div className="flex items-baseline justify-between gap-2 pt-1 border-t border-white/5">
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Unrealized</span>
              <span className={`text-base font-black ${metrics.usPnlUSD >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {metrics.usPnlUSD >= 0 ? '+' : ''}${metrics.usPnlUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          </div>
          <div className="text-[9px] text-slate-500 mt-2" title="Invested USD apne app-parity rate se; Value live USD price se">
            invested @ {usdAppRate ? `app ₹${usdAppRate.toFixed(2)}` : `live ₹${usdInrRate.toFixed(2)}`} · value @ live USD · ☁ server-synced (sab devices)
          </div>
          {/* Match App inline popover */}
          {showMatchApp && (
            <div className="mt-2 rounded-xl bg-black/30 border border-blue-500/20 p-2.5 space-y-2">
              <div className="text-[10px] text-slate-300 leading-relaxed">
                App ka USA <b>Invested ($)</b> daalo — site INDMoney ke internal FX rate se match kar legi
                <span className="block text-slate-500 mt-0.5">Site INR invested: ₹{Math.round(usInrInvested).toLocaleString('en-IN')} {usdAppRate ? `· current app-rate ₹${usdAppRate.toFixed(2)}` : `· live rate se $${(usInrInvested / (usdInrRate || 1)).toFixed(2)}`}</span>
                <span className="block text-emerald-400/80 mt-0.5">☁ Server par save hota hai — sab devices par same, cookies/cache clear hone par bhi safe</span>
              </div>
              <div className="flex gap-2">
                <input
                  value={appUsdInput}
                  onChange={e => setAppUsdInput(e.target.value)}
                  inputMode="decimal"
                  placeholder="1631.97"
                  className="quantum-input rounded-lg px-2.5 py-1.5 text-xs text-white font-mono flex-1 min-w-0 bg-slate-900/60"
                />
                <button
                  onClick={() => {
                    // v6.2: strip Indian comma formats; validate the derived
                    // rate BEFORE saving — out-of-range values used to be
                    // silently coerced to null ("calibrated" look, live-FX
                    // reality) with the popover closing as if saved.
                    const appUsd = Number(String(appUsdInput).replace(/,/g, '').trim());
                    if (!(appUsd > 0) || !(usInrInvested > 0)) {
                      alert('App ka USD invested value daalo (sirf numbers).');
                      return;
                    }
                    const rate = usInrInvested / appUsd;
                    if (!(rate > 50 && rate < 150)) {
                      alert(`Derived rate ₹${rate.toFixed(2)} valid range (50–150) se bahar hai — app value check karke dobara try karo.`);
                      return;
                    }
                    setUsdAppRate(rate);
                    setShowMatchApp(false);
                  }}
                  className="quantum-btn-primary px-3 py-1.5 rounded-lg bg-gradient-to-r from-cyan-600 to-indigo-600 text-white text-xs font-bold shrink-0"
                >
                  Save
                </button>
              </div>
              {usdAppRate && (
                <button onClick={() => { setUsdAppRate(null); setShowMatchApp(false); }} className="text-[10px] text-slate-400 hover:text-slate-200 underline">
                  Reset — live FX use karo
                </button>
              )}
            </div>
          )}
        </div>

        {/* 🪙 CRYPTO — CoinDCX app's crypto section */}
        <div className="quantum-stat rounded-2xl p-4 border border-purple-500/20 bg-purple-500/[0.03] animate-fade-in-up delay-150">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-bold uppercase tracking-wider text-purple-400/90">🪙 Crypto · CoinDCX</div>
            {indmActive && (
              <button
                onClick={() => { setBasisInputs({}); setShowBasisModal(true); }}
                className="text-[8px] font-black text-purple-300 bg-purple-500/10 border border-purple-500/25 rounded px-1.5 py-0.5 hover:bg-purple-500/20"
                title="CoinDCX app ke coin pages se per-coin Invested ₹ daalo (view-only API key ke liye). Trade-history permission wali key par ye automatic aa jata hai."
              >
                ✏️ Set Basis
              </button>
            )}
          </div>
          <div className="mt-2.5 space-y-1.5 font-mono">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Invested</span>
              {metrics.totalInvestedCRYPTO > 0 ? (
                <span className="text-sm font-black text-white">₹{metrics.totalInvestedCRYPTO.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              ) : (
                <span className="text-sm font-black text-slate-500" title="Cost basis unknown — API key me trade-history permission nahi hai, ya basis abhi set nahi hua. 'Set Basis' se app ke numbers daalo.">n/a</span>
              )}
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Current Value</span>
              <span className="text-sm font-black text-cyan-300">₹{(metrics.totalValueCRYPTO || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
            <div className="flex items-baseline justify-between gap-2 pt-1 border-t border-white/5">
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Total P&L</span>
              {metrics.totalInvestedCRYPTO > 0 ? (
                <span className={`text-base font-black ${metrics.totalPLCRYPTO >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {metrics.totalPLCRYPTO >= 0 ? '+' : ''}₹{metrics.totalPLCRYPTO.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  <span className={`text-[10px] ml-1 ${metrics.cryptoPct != null && metrics.cryptoPct >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>({metrics.cryptoPct != null ? `${metrics.cryptoPct >= 0 ? '+' : ''}${metrics.cryptoPct.toFixed(2)}` : '—'}%)</span>
                </span>
              ) : (
                <span className="text-base font-black text-slate-500" title="'Set Basis' par click karke CoinDCX app ke per-coin invested amounts daalo">P&L n/a</span>
              )}
            </div>
          </div>
          <div className="text-[9px] text-slate-500 mt-2">= app ke Crypto section wale numbers (basis ke saath)</div>
        </div>

        {/* TODAY — live day P&L (unchanged card) */}
        <div className="quantum-stat rounded-2xl p-4 animate-fade-in-up delay-200">
          <div className="flex items-center justify-between">
            <div className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">Today's P&L</div>
            <span className="flex items-center gap-1 text-[8px] font-black text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 rounded px-1 py-0.5" title="Live — updates with every market tick">
              <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse-dot" />
              LIVE
            </span>
          </div>
          <div
            className={`text-xl font-black font-mono mt-1 live-price ${todayPlFlash} ${metrics.todayPL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}
            title={`${metrics.todayPct >= 0 ? '+' : ''}${metrics.todayPct.toFixed(2)}% vs yesterday's close`}
          >
            {metrics.todayPL >= 0 ? '+' : ''}₹{Math.round(metrics.todayPL).toLocaleString('en-IN')}
            <span className={`text-xs font-bold ml-2 ${metrics.todayPct >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
              {metrics.todayPct >= 0 ? '+' : ''}{metrics.todayPct.toFixed(2)}%
            </span>
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

      {/* v4.5: PORTFOLIO INSIGHTS — live X-ray (today's movers, all-time
          performers, diversification health, market split) */}
      {insightAssets.length > 0 && (
        <PortfolioInsights assets={insightAssets} totalValueINR={metrics.totalValue} />
      )}

      {/* XIRR + Portfolio Intelligence (manual mode only — INDMoney syncs
          don't carry per-asset buy dates, so XIRR would be meaningless) */}
      {portfolio.length > 0 && !indmActive && (
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

      {/* Transaction History (manual ledger — retired while INDMoney drives the table) */}
      {!indmActive && <TransactionHistoryPanel />}

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
            <option value="today">Today's P&L</option>
            <option value="invested">Cost / Invested</option>
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
                    {/* v5.1: no-basis rows (crypto without trade history) show
                        an honest P&L n/a instead of a fake zero/drift number. */}
                    {group.noBasisCount === group.assets.length ? (
                      <div className="text-[10px] font-bold font-mono text-slate-500" title="Cost basis unknown (no trade-history permission on the API key) — value shown, P&L n/a">
                        P&L n/a · basis?
                      </div>
                    ) : (
                      <div className={`text-[10px] font-bold font-mono ${group.totalPLINR >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {group.totalPLINR >= 0 ? '+' : ''}₹{Math.round(group.totalPLINR).toLocaleString('en-IN')}
                        <span className="ml-1">({plPct >= 0 ? '+' : ''}{plPct.toFixed(1)}%)</span>
                        {group.noBasisCount > 0 && (
                          <span className="ml-1 text-slate-500" title={`${group.noBasisCount} row(s) without cost basis — excluded from P&L`}>·{group.noBasisCount}n/b</span>
                        )}
                      </div>
                    )}
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
                  {/* Desktop Header — FIXED 9.5rem actions track + matching px-4
                      padding so every column lines up with the rows (v4.5: widened
                      from 7rem — manual rows now carry a 4th CHART button; the
                      track must hold 4×32px + gaps WITHOUT per-row 'auto'
                      sizing, which shifted every fr column — the v4.4 lesson). */}
                  <div className="hidden lg:grid grid-cols-[1.5fr_1fr_1fr_1fr_1fr_9.5rem] gap-4 px-4 py-2 bg-black/40 border-b border-white/5 text-[10px] uppercase tracking-wider text-slate-500 font-bold">
                    <div>Asset & Allocation</div>
                    <div>LTP & 24H Range</div>
                    <div className="text-right">Today's P&L</div>
                    <div className="text-right">Value (Eq)</div>
                    <div className="text-right">Unrealized P&L</div>
                    <div className="text-center">{indmActive ? 'Source' : 'Trade'}</div>
                  </div>

                  <div className="divide-y divide-white/[0.03]">
                    {group.assets.map(({ p, allocPct, pl, plPct, eqVal, invNative, todayPL, hasBasis }) => {
                      const key = `${(p.market || 'IN').toUpperCase()}_${p.symbol}`;
                      const data = livePrices[key];
                      const curPrice = data?.price || p.avgPrice;
                      const change = data?.change || 0;
                      const cur = p.market === 'IN' ? '₹' : '$';
                      // v4.5: todayPL + invNative come pre-computed from the
                      // groupedPortfolio memo (ONE source of truth for row,
                      // insights, sorting and the snapshot CSV export).
                      const assetXirr = xirrMap[key];
                      const showCost = invNative > 0;
                      // Chart-able = live IN/US equity row (crypto/NAV rows
                      // have no daily-candle source on the chart proxy).
                      const chartable = !p.noLive && group.key !== 'crypto';

                      // Quote-liveness honesty (deep-analysis fix): the LIVE
                      // badge now reflects an actually-fresh quote; a row whose
                      // feed is dark shows SYNC (last sync's price) instead of
                      // pretending to be live with a stale number.
                      const quoteFresh = !!(data && (data.isRealtime || (Date.now() - (data.time || 0) < 5 * 60_000)));

                      // Pro UI Calculations — the 24h range is drawn ONLY when
                      // the source actually served one (no fake ±2% band on
                      // rows whose feed is dark).
                      const low = data?.low;
                      const high = data?.high;
                      const hasRange = !!(low && high && high > low);
                      const rangePct = hasRange
                        ? Math.max(0, Math.min(100, ((curPrice - low!) / (high! - low!)) * 100))
                        : 50;

                      // ---- TICKER-FIRST LABELS (arrangement fix) ----
                      // Primary label = the exchange TICKER (BTC, AAPL,
                      // MID150BEES…). The long full name moves to a small,
                      // CSS-truncated secondary line so it can never blow out
                      // the row grid. NAV-only rows (MF/FD/bonds) have no real
                      // ticker — their pseudo-symbol is an internal key, so a
                      // trimmed name stays primary for those.
                      const ticker = (p.symbol || '').replace('.NS', '').trim();
                      const cleanName = p.name
                        ? p.name.replace(/\s*\(CoinDCX\)\s*$/i, '').trim()
                        : '';
                      const showTicker = !p.noLive && !!ticker;
                      const primaryLabel = showTicker ? ticker : (cleanName || ticker || 'ASSET');
                      const secondaryName = showTicker ? cleanName : '';
                      const isCryptoRow = group.key === 'crypto';

                      return (
                        <div key={p.id} className="p-4 hover:bg-white/[0.02] transition-colors group relative lg:grid lg:grid-cols-[1.5fr_1fr_1fr_1fr_1fr_9.5rem] lg:items-center lg:gap-4">

                          {/* 1. ASSET & ALLOCATION */}
                          <div>
                            <div className="flex items-center justify-between md:justify-start gap-3">
                              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-slate-800 to-slate-900 border border-white/10 shadow-inner flex items-center justify-center font-black text-xs text-white shrink-0">
                                {(ticker || cleanName || 'A').substring(0, 2).toUpperCase()}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="font-black text-white text-base tracking-tight flex items-center gap-2 truncate">
                                  <span className="truncate" title={cleanName || primaryLabel}>{primaryLabel}</span>
                                  {p.leverage > 1 && <span className="bg-indigo-500/20 text-indigo-400 text-[9px] px-1.5 py-0.5 rounded border border-indigo-500/20 shrink-0">{p.leverage}x</span>}
                                  {!indmActive && assetXirr !== null && assetXirr !== undefined && <span className={`text-[9px] px-1.5 py-0.5 rounded border font-bold font-mono shrink-0 ${assetXirr >= 15 ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : assetXirr >= 0 ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>XIRR {assetXirr >= 0 ? '+' : ''}{assetXirr.toFixed(0)}%</span>}
                                  {indmActive && p.noLive && (
                                    <span className="bg-sky-500/10 text-sky-300 text-[8px] px-1.5 py-0.5 rounded border border-sky-500/20 shrink-0" title="INDMoney NAV-priced (mutual fund / fixed income) — refreshes on each sync">NAV</span>
                                  )}
                                  {indmActive && !p.noLive && quoteFresh && (
                                    <span className="bg-emerald-500/10 text-emerald-400 text-[8px] px-1.5 py-0.5 rounded border border-emerald-500/20 shrink-0 inline-flex items-center gap-1" title="Live exchange price (ticks in real-time)">
                                      <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse-dot" />LIVE
                                    </span>
                                  )}
                                  {indmActive && !p.noLive && !quoteFresh && (
                                    <span className="bg-slate-500/10 text-slate-400 text-[8px] px-1.5 py-0.5 rounded border border-slate-500/20 shrink-0" title="Live feed dark — showing the last synced price; the quote will resume when its source ticks">SYNC</span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 mt-0.5 min-w-0">
                                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${isCryptoRow ? 'bg-amber-500/10 text-amber-400' : p.market === 'IN' ? 'bg-orange-500/10 text-orange-400' : 'bg-blue-500/10 text-blue-400'}`}>
                                    {isCryptoRow ? 'CRYPTO' : (p.market === 'IN' ? 'NSE' : 'US')}
                                  </span>
                                  {secondaryName && (
                                    <span className="text-[10px] text-slate-500 truncate max-w-[120px] sm:max-w-[240px]" title={secondaryName}>{secondaryName}</span>
                                  )}
                                  {/* v5.2: app-parity Qty @ Avg — avg price
                                      comes from the row's ACTUAL cost basis
                                      (sync-truth invested ÷ qty; US rows at
                                      the calibrated app FX when set), NOT the
                                      server's live-FX snapshot avg (that was
                                      the per-row Avg. Price mismatch). Qty
                                      keeps app-level precision (4dp for
                                      shares ≥1, 8dp for micro crypto amounts
                                      — rounding 0.000736 to "0.0007" was the
                                      crypto Quantity mismatch); the exact
                                      value stays in the title tooltip. */}
                                  <span
                                    className="text-[10px] text-slate-500 font-mono shrink-0 hidden sm:inline"
                                    title={`Qty: ${p.qty} @ ${cur}${(invNative > 0 ? invNative / (p.qty || 1) : p.avgPrice).toFixed(2)}`}
                                  >
                                    Qty: {p.qty.toLocaleString('en-IN', { maximumFractionDigits: p.qty >= 1 ? 4 : 8 })} @ {cur}{showCost && (p.qty || 0) > 0 ? (invNative / p.qty).toFixed(2) : p.avgPrice.toFixed(2)}
                                  </span>
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
                            {/* 24H Scrubber — only with a REAL served range */}
                            {hasRange ? (
                              <div className="mt-2 text-[9px] text-slate-500 flex items-center justify-between xl:w-4/5 font-mono">
                                <span>L</span>
                                <div className="flex-1 mx-2 h-1 bg-slate-800 rounded-full relative">
                                  <div className="absolute top-1/2 -translate-y-1/2 w-1.5 h-2.5 bg-white rounded-sm shadow-[0_0_5px_rgba(255,255,255,0.5)] transition-all z-10" style={{ left: `${rangePct}%` }} />
                                  <div className="absolute top-0 bottom-0 left-0 bg-gradient-to-r from-red-500/30 to-emerald-500/30 rounded-full" style={{ width: `100%` }} />
                                </div>
                                <span>H</span>
                              </div>
                            ) : (
                              <div className="mt-2 text-[9px] text-slate-600 font-mono flex items-center gap-1" title="Range will appear once the live feed serves this symbol">
                                <span className="w-1 h-1 rounded-full bg-slate-500 animate-pulse" />awaiting quote
                              </div>
                            )}
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
                            {/* v4.5: cost basis (sync-truth invested native) */}
                            {showCost ? (
                              <div className="text-[9px] text-slate-500 mt-1 font-mono hidden md:block" title="Cost basis — invested amount (sync-truth)">
                                Cost {cur}{invNative.toFixed(0)}
                              </div>
                            ) : (
                              <div className="text-[9px] text-slate-600 mt-1 font-mono hidden md:block">Eq Value</div>
                            )}
                          </div>

                          {/* 5. UNREALIZED P&L — sync-truth (INDMoney's own
                              pnl + live delta) for synced rows; every row now
                              shows a real Unrealized P&L, NAV rows included.
                              v5.1: basis-less CoinDCX rows show an honest n/a
                              (drift-since-sync is NOT unrealized P&L). */}
                          <div className="flex justify-between md:block md:text-right">
                            <div className="md:hidden text-[10px] text-slate-500 uppercase font-bold">Unrealized P&L</div>
                            <div>
                              {!hasBasis ? (
                                <div className="text-[10px] font-bold font-mono text-slate-500 mt-1" title="Cost basis unknown — API key me trade-history permission nahi hai. Value live hai, P&L n/a (CoinDCX app ka Invested sirf unke trade ledger se aata hai).">
                                  P&L n/a · no cost basis
                                </div>
                              ) : (
                                <>
                                  <div className={`font-black font-mono text-base tracking-tight ${pl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                    {pl >= 0 ? '+' : ''}{cur}{pl.toFixed(2)}
                                  </div>
                                  {plPct != null && (
                                    <div className={`text-[10px] font-bold mt-0.5 ${plPct >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                                      ({plPct >= 0 ? '+' : ''}{plPct.toFixed(2)}%)
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          </div>

                          {/* 6. ACTIONS — manual trade buttons in manual mode;
                              synced mode shows the source badge + REMOVE button.
                              Fixed-width cell keeps the grid columns aligned. */}
                          <div className="pt-2 md:pt-0 mt-3 border-t border-white/5 md:border-0 md:mt-0 flex justify-end gap-2 md:justify-center">
                            {indmActive ? (
                              <div className="flex items-center gap-2">
                                <div
                                  className="flex items-center gap-1.5 text-[9px] text-slate-500 font-bold"
                                  title={p.indmKey?.startsWith('cdcx:')
                                    ? `CoinDCX balance synced${indmMeta?.coindcx?.lastSyncAt ? ' ' + new Date(indmMeta.coindcx.lastSyncAt).toLocaleString('en-IN') : ''}`
                                    : indmMeta?.syncedAt ? `INDMoney synced ${new Date(indmMeta.syncedAt).toLocaleString('en-IN')}` : 'INDMoney synced'}
                                >
                                  {p.indmKey?.startsWith('cdcx:') ? '🪙' : '🏦'}{' '}
                                  {p.indmKey?.startsWith('cdcx:')
                                    ? (indmMeta?.coindcx?.lastSyncAt ? new Date(indmMeta.coindcx.lastSyncAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : 'sync')
                                    : (indmMeta?.syncedAt ? new Date(indmMeta.syncedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : 'sync')}
                                </div>
                                {chartable && (
                                  <button
                                    onClick={() => openAssetChart(p, invNative)}
                                    className="w-7 h-7 flex items-center justify-center bg-cyan-500/10 hover:bg-cyan-500 border border-cyan-500/30 hover:border-cyan-500/60 rounded-lg transition-all text-[11px] text-cyan-400 hover:text-white font-black"
                                    title={`Chart — ${p.symbol} (6M daily candles, COST vs LIVE overlay)`}
                                  >
                                    📈
                                  </button>
                                )}
                                <button
                                  onClick={() => handleRemoveAsset(p)}
                                  disabled={hidingKeys.has(p.indmKey || '')}
                                  className="w-7 h-7 flex items-center justify-center bg-red-500/10 hover:bg-red-500 border border-red-500/30 hover:border-red-500/60 rounded-lg transition-all text-[11px] text-red-400 hover:text-white font-black disabled:opacity-40"
                                  title="Remove this asset from the list (Restore kar sakte ho)"
                                >
                                  ✕
                                </button>
                              </div>
                            ) : (
                              <>
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
                                {chartable && (
                                  <button
                                    onClick={() => openAssetChart(p, invNative)}
                                    className="px-3 py-1.5 md:w-8 md:h-8 md:p-0 flex items-center justify-center bg-cyan-500/10 hover:bg-cyan-500 w-full md:hover:rotate-6 hover:shadow-[0_0_15px_rgba(6,182,212,0.4)] border border-cyan-500/30 rounded-lg transition-all text-xs text-cyan-400 hover:text-white font-bold"
                                    title={`Chart — ${p.symbol} (6M daily candles, COST vs LIVE overlay)`}
                                  >
                                    <span className="md:hidden mr-1">Chart</span> 📈
                                  </button>
                                )}
                              </>
                            )}
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

        {/* Removed assets — restore bar (user hid rows via the ✕ button) */}
        {indmActive && hiddenAssets.length > 0 && (
          <div className="quantum-panel rounded-2xl border border-red-500/15 overflow-hidden">
            <button
              onClick={() => setShowHidden(v => !v)}
              className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors"
            >
              <div className="flex items-center gap-2 text-xs font-bold text-slate-300">
                <span className="text-red-400">✕</span>
                {hiddenAssets.length} asset{hiddenAssets.length > 1 ? 's' : ''} removed from the list
                <span className="text-[10px] text-slate-500 font-medium">(syncs me hidden rehte hain)</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={(e) => { e.stopPropagation(); void restoreIndmAsset(undefined, true); }}
                  className="px-3 py-1.5 rounded-lg text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 hover:bg-emerald-500/20 transition-all"
                  title="Sab removed assets wapas laao"
                >
                  ↺ Restore All
                </button>
                <span className={`text-slate-500 transition-transform ${showHidden ? 'rotate-180' : ''}`}>▼</span>
              </div>
            </button>
            {showHidden && (
              <div className="divide-y divide-white/[0.03] border-t border-white/5">
                {hiddenAssets.map(h => (
                  <div key={h.key} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[10px]">{h.source === 'coindcx' ? '🪙' : '🏦'}</span>
                      <span className="text-xs font-semibold text-slate-300 truncate" title={h.name}>{h.name}</span>
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${h.market === 'IN' ? 'bg-orange-500/10 text-orange-400' : 'bg-blue-500/10 text-blue-400'}`}>
                        {h.assetType}
                      </span>
                      {h.value != null && (
                        <span className="text-[10px] text-slate-500 font-mono shrink-0">₹{Math.round(h.value).toLocaleString('en-IN')}</span>
                      )}
                    </div>
                    <button
                      onClick={() => void restoreIndmAsset(h.key)}
                      className="px-3 py-1.5 rounded-lg text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 hover:bg-emerald-500/20 transition-all shrink-0"
                    >
                      ↺ Restore
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {portfolio.length === 0 && (
          <div className="quantum-panel rounded-2xl p-10 text-center space-y-4">
            <div className="text-6xl animate-bounce">📊</div>
            <h3 className="text-xl font-black text-white font-display">
              {indmActive || indmSource === 'unknown' ? 'Waiting for INDMoney Sync…' : 'No Portfolio Assets Loaded'}
            </h3>
            <p className="text-sm text-slate-400 max-w-md mx-auto">
              {indmActive || indmSource === 'unknown'
                ? 'INDMoney connected — the first portfolio sync is running. Your INDIA / USA / Crypto assets will appear here automatically (2× daily thereafter).'
                : 'If your assets are in Google Sheets, link your Google Apps Script Web App URL below to fetch them automatically.'}
            </p>
            {!(indmActive || indmSource === 'unknown') && (
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
            )}
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
                  placeholder="https://smartback-iyuq.onrender.com"
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
                  placeholder="Paste your API_TOKEN secret (required — no default)"
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

      {/* v4.5: per-asset daily-candle chart modal (COST vs LIVE overlays) */}
      <AssetChartModal target={chartTarget} onClose={() => setChartTarget(null)} />

      {/* v5.2: CoinDCX manual cost-basis modal — per-coin invested amounts
          from the official app (fallback for view-only API keys). */}
      {showBasisModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          onClick={() => !basisSaving && setShowBasisModal(false)}
        >
          <div
            className="quantum-modal rounded-2xl p-5 w-full max-w-md space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="text-lg font-black gradient-text-cyan font-display">🪙 Crypto Cost Basis</div>
                <div className="text-[11px] text-slate-400 mt-0.5">CoinDCX app ke coin pages se per-coin <b>Invested ₹</b> daalo</div>
              </div>
              <button
                onClick={() => !basisSaving && setShowBasisModal(false)}
                className="text-slate-400 hover:text-white text-xl font-bold leading-none px-2"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="rounded-xl bg-amber-500/5 border border-amber-500/20 px-3 py-2 text-[11px] text-amber-200/90 leading-relaxed">
              Agar API key me <b>trade-history permission</b> hai to invested automatic aata hai (Match App ki zaroorat nahi).
              View-only key ke liye ye amounts ek baar daal do — syncs ke saath persist rahenge.
              <span className="block text-emerald-400/80 mt-1">☁ Server par encrypted backup ke saath save hota hai — sab devices par same, site restart hone par bhi safe</span>
            </div>

            {cryptoRows.length === 0 ? (
              <div className="text-xs text-slate-400">Koi CoinDCX row nahi mili — pehle CoinDCX connect karo.</div>
            ) : (
              <div className="space-y-2.5">
                {cryptoRows.map(r => (
                  <div key={r.symbol} className="flex items-center gap-3">
                    <span className="w-16 text-sm font-black text-white font-mono shrink-0">{r.symbol}</span>
                    <span className="text-[10px] text-slate-500 font-mono shrink-0">
                      {r.valINR != null ? `≈₹${Math.round(r.valINR).toLocaleString('en-IN')}` : ''}
                    </span>
                    <input
                      value={basisInputs[r.symbol] ?? ''}
                      onChange={e => setBasisInputs(prev => ({ ...prev, [r.symbol]: e.target.value }))}
                      inputMode="decimal"
                      placeholder={`Invested ₹ (${r.symbol})`}
                      className="quantum-input rounded-lg px-3 py-2 text-sm text-white font-mono flex-1 min-w-0 bg-slate-900/60"
                    />
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between gap-2 pt-1">
              <button
                onClick={async () => { await clearCoindcxManualBasis(); await loadIndmAssets(true); setShowBasisModal(false); }}
                disabled={basisSaving}
                className="text-[11px] text-slate-400 hover:text-red-300 underline"
              >
                Clear all
              </button>
              <button
                onClick={handleSaveBasis}
                disabled={basisSaving || cryptoRows.length === 0}
                className="px-5 py-2 bg-gradient-to-r from-cyan-600 to-indigo-600 text-white rounded-xl text-xs font-bold shadow-lg disabled:opacity-50"
              >
                {basisSaving ? 'Saving…' : 'Save & Refresh'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

export default PortfolioTab;
