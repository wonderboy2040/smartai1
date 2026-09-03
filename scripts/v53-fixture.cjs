// v53-fixture.cjs — the real live-synced asset rows (v52 live forensics,
// 2026-09-03) shared by the E2E check scripts. crypto rows WITH basis.
module.exports = {
  ok: true, reason: null, hiddenCount: 2,
  hiddenAssets: [
    { key: 'indm:MIRAEASSETNI:2', market: 'IN', value: 7742.79, invested: 7742.79 },
    { key: 'indm:USTOP100STOC', market: 'IN', value: 5181.76, invested: 5181.76 },
  ],
  counts: { assets: 11, live: 10, noLive: 1, resolved: 10, coindcx: 2, hidden: 2 },
  summary: { totalValue: 488007.8, totalInvested: 442130.33, totalPnl: 35845.72, totalPnlPct: 8.11, holdingCount: 11, withBasis: 9 },
  positions: [],
  sources: { indmoney: true, coindcx: true },
  coindcx: { connected: true, connectedAt: 1788373493989, lastSyncAt: Date.now(), balanceCount: 5, lastError: null },
  syncedAt: Date.now(), stale: false, slots: ['09:30', '21:30'], lastRuns: {}, nextSyncAt: null, lastError: null,
  assets: [
    { id: 'indm-MOTILALOSWAL-0', key: 'indm:MOTILALOSWAL', name: 'Motilal Oswal Nifty 500 Momentum 50 ETF', source: 'indmoney', symbol: 'MOMENTUM50', market: 'IN', kind: 'etf', qty: 1990, avgPrice: 51.95, lastPrice: 54.25, value: 107957.5, invested: 103380.5, pnl: 4577, pnlPct: 4.42, oneDayChangePct: 0.57, assetType: 'ETF', assetEnum: 'IND_STOCK', noLive: false },
    { id: 'indm-MIRAEASSETNI-1', key: 'indm:MIRAEASSETNI', name: 'Mirae Asset Nifty Smallcap 250 Momen.Quali. 100ETF', source: 'indmoney', symbol: 'SMALLCAP', market: 'IN', kind: 'etf', qty: 1774, avgPrice: 42.27, lastPrice: 49.06, value: 87032.44, invested: 74986.98, pnl: 12045.46, pnlPct: 16.06, oneDayChangePct: 1.18, assetType: 'ETF', assetEnum: 'IND_STOCK', noLive: false },
    { id: 'indm-NIPPONINDIAE-2', key: 'indm:NIPPONINDIAE', name: 'Nippon India ETF Nifty Midcap 150', source: 'indmoney', symbol: 'MID150BEES', market: 'IN', kind: 'etf', qty: 330, avgPrice: 221.38, lastPrice: 240.14, value: 79246.2, invested: 73056.7, pnl: 6189.5, pnlPct: 8.48, oneDayChangePct: 0.43, assetType: 'ETF', assetEnum: 'IND_STOCK', noLive: false },
    { id: 'indm-NIPPONINDIAE-3', key: 'indm:NIPPONINDIAE:2', name: 'Nippon India ETF Nifty Next 50 Junior BeES', source: 'indmoney', symbol: 'JUNIORBEES', market: 'IN', kind: 'etf', qty: 40, avgPrice: 720.99, lastPrice: 788.74, value: 31549.6, invested: 28839.4, pnl: 2710.2, pnlPct: 9.4, oneDayChangePct: 0.2, assetType: 'ETF', assetEnum: 'IND_STOCK', noLive: false },
    { id: 'indm-SBIETFNIFTY5-4', key: 'indm:SBIETFNIFTY5', name: 'SBI ETF Nifty 50', source: 'indmoney', symbol: 'SETFNIF50', market: 'IN', kind: 'etf', qty: 45, avgPrice: 260.57, lastPrice: 257.33, value: 11579.85, invested: 11725.65, pnl: -145.8, pnlPct: -1.24, oneDayChangePct: 0.16, assetType: 'ETF', assetEnum: 'IND_STOCK', noLive: false },
    { id: 'indm-VANECKSEMICO-7', key: 'indm:VANECKSEMICO', name: 'VanEck Semiconductor ETF', source: 'indmoney', symbol: 'SMH', market: 'US', kind: 'stock', qty: 1.9241956, avgPrice: 474.46, lastPrice: 544.46, value: 99414.61, invested: 86631.66, pnl: 12782.95, pnlPct: 14.76, oneDayChangePct: 0.05, assetType: 'ETF', assetEnum: 'US_STOCK', noLive: false },
    { id: 'indm-MICRONTECHNO-8', key: 'indm:MICRONTECHNO', name: 'Micron Technology Inc.', source: 'indmoney', symbol: 'MU', market: 'US', kind: 'stock', qty: 0.4639806, avgPrice: 997.37, lastPrice: 951.98, value: 41914.18, invested: 43912.52, pnl: -1998.34, pnlPct: -4.55, oneDayChangePct: -0.53, assetType: 'Stock', assetEnum: 'US_STOCK', noLive: false },
    { id: 'indm-SPACEX-9', key: 'indm:SPACEX', name: 'SpaceX', source: 'indmoney', symbol: 'SPCX', market: 'US', kind: 'stock', qty: 1.2557423, avgPrice: 144.8, lastPrice: 140.46, value: 16737.2, invested: 17254.6, pnl: -517.4, pnlPct: -3, oneDayChangePct: 0.13, assetType: 'Stock', assetEnum: 'US_STOCK', noLive: false },
    { id: 'indm-VANGUARDSP50-10', key: 'indm:VANGUARDSP50', name: 'Vanguard S&P 500 Growth ETF', source: 'indmoney', symbol: null, market: 'US', kind: 'stock', qty: 0.3214695, avgPrice: 76.78, lastPrice: 83.41, value: 2544.47, invested: 2342.32, pnl: 202.15, pnlPct: 8.63, oneDayChangePct: -0.12, assetType: 'ETF', assetEnum: 'US_STOCK', noLive: true },
    // CoinDCX rows WITH basis (ledger/manual — app: invested 8,485)
    { id: 'cdcx-BTC', key: 'cdcx:BTC', name: 'Bitcoin (CoinDCX)', symbol: 'BTC', market: 'IN', kind: 'crypto', source: 'coindcx', qty: 0.000736, avgPrice: 7145470.11, lastPrice: 7790000, value: 5733.44, invested: 5259.07, pnl: 474.37, pnlPct: 9.02, oneDayChangePct: 0.53, assetType: 'Crypto', assetEnum: 'CRYPTO', basisSource: 'ledger', noLive: false },
    { id: 'cdcx-ETH', key: 'cdcx:ETH', name: 'Ethereum (CoinDCX)', symbol: 'ETH', market: 'IN', kind: 'crypto', source: 'coindcx', qty: 0.01794521012936, avgPrice: 179770.5, lastPrice: 239523.9, value: 4298.31, invested: 3226.0, pnl: 1072.31, pnlPct: 33.23, oneDayChangePct: -0.27, assetType: 'Crypto', assetEnum: 'CRYPTO', basisSource: 'ledger', noLive: false },
  ],
};
