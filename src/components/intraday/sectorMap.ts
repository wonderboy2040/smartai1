// ============================================================
// intraday/sectorMap — NSE symbol → sector mapping
// ------------------------------------------------------------
// Powers sector badges on signal cards and the same-sector
// concentration warning ("3 bank LONGs ek saath = hidden risk").
// Unmapped symbols fall back to 'Other'.
// ============================================================

export const SECTOR_MAP: Record<string, string> = {
  // Banks & Financials
  HDFCBANK: 'Banks', ICICIBANK: 'Banks', SBIN: 'Banks', KOTAKBANK: 'Banks',
  AXISBANK: 'Banks', INDUSINDBK: 'Banks', BANKBARODA: 'Banks', UNIONBANK: 'Banks',
  FEDERALBNK: 'Banks', IDFCFIRSTB: 'Banks', AUBANK: 'Banks', CANBK: 'Banks',
  PNB: 'Banks', YESBANK: 'Banks',
  SBILIFE: 'Insurance', HDFCLIFE: 'Insurance', ICICIPRULI: 'Insurance', LICI: 'Insurance',
  BAJFINANCE: 'NBFC', BAJAJFINSV: 'NBFC', SHRIRAMFIN: 'NBFC', CHOLAFIN: 'NBFC',
  JIOFIN: 'Fintech', PAYTM: 'Fintech', POLICYBZR: 'Fintech',
  // IT
  INFY: 'IT', TCS: 'IT', WIPRO: 'IT', HCLTECH: 'IT', TECHM: 'IT',
  LTIM: 'IT', COFORGE: 'IT', MPHASIS: 'IT', PERSISTENT: 'IT', TATAELXSI: 'IT',
  // Oil, Gas & Power
  ONGC: 'Oil & Gas', BPCL: 'Oil & Gas', IOC: 'Oil & Gas', GAIL: 'Oil & Gas',
  PETRONET: 'Oil & Gas', COALINDIA: 'Mining', NTPC: 'Power', POWERGRID: 'Power',
  TATAPOWER: 'Power', ADANIGREEN: 'Power', ADANIPOWER: 'Power', IREDA: 'Power',
  SUZLON: 'Power',
  // Metals & Mining
  TATASTEEL: 'Metals', JSWSTEEL: 'Metals', HINDALCO: 'Metals', VEDL: 'Metals',
  // FMCG & Consumer
  ITC: 'FMCG', HINDUNILVR: 'FMCG', BRITANNIA: 'FMCG', TITAN: 'Consumer',
  TRENT: 'Consumer', ZOMATO: 'Consumer Tech', NYKAA: 'Consumer Tech',
  // Pharma & Healthcare
  SUNPHARMA: 'Pharma', CIPLA: 'Pharma', DRREDDY: 'Pharma', DIVISLAB: 'Pharma',
  LUPIN: 'Pharma', AUROPHARMA: 'Pharma', APOLLOHOSP: 'Healthcare',
  // Auto
  MARUTI: 'Auto', TATAMOTORS: 'Auto', EICHERMOT: 'Auto', HEROMOTOCO: 'Auto', 'M&M': 'Auto',
  // Infra, Cement & Realty
  LT: 'Infra', ULTRACEMCO: 'Cement', GRASIM: 'Cement', ADANIENT: 'Infra',
  ADANIPORTS: 'Infra', DLF: 'Realty', IRFC: 'Infra', BEL: 'Defense', HAL: 'Defense',
  // Telecom
  BHARTIARTL: 'Telecom', IDEA: 'Telecom',
  // Chemicals & Materials
  ASIANPAINT: 'Chemicals', PIDILITIND: 'Chemicals', HAVELLS: 'Consumer Durables',
  // Conglomerate
  RELIANCE: 'Conglomerate',
  // CRYPTO (2026-09 intraday crypto market) — sub-sectors so the
  // concentration warning stays meaningful (3 Layer-1 LONGs = risk).
  BTC: 'Layer 1', ETH: 'Layer 1', SOL: 'Layer 1', ADA: 'Layer 1',
  AVAX: 'Layer 1', DOT: 'Layer 1', MATIC: 'Layer 2',
  BNB: 'Exchange', UNI: 'DeFi', LINK: 'DeFi',
  XRP: 'Payments', DOGE: 'Meme',
};

export function sectorOf(symbol: string): string {
  return SECTOR_MAP[symbol] || 'Other';
}

// Symbols whose sector appears >= threshold times in the current signal list.
export function sectorConcentration(symbols: string[], threshold = 3): { sector: string; count: number }[] {
  const counts: Record<string, number> = {};
  for (const s of symbols) {
    const sec = sectorOf(s);
    counts[sec] = (counts[sec] || 0) + 1;
  }
  return Object.entries(counts)
    .filter(([, n]) => n >= threshold)
    .map(([sector, count]) => ({ sector, count }));
}
