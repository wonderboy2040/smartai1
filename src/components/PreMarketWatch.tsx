import React, { useState, useEffect, useCallback, useMemo } from 'react';

interface PreMarketItem {
  price: number;
  change: number;
  volume?: number;
}

interface PreMarketData {
  giftNifty: PreMarketItem | null;
  giftNifty50: PreMarketItem | null;
  bankNifty: PreMarketItem | null;
  sensex: PreMarketItem | null;
  esFut:     PreMarketItem | null;
  nqFut:     PreMarketItem | null;
  nikkei:    PreMarketItem | null;
  hangSeng:  PreMarketItem | null;
  dax:       PreMarketItem | null;
  dxy:       PreMarketItem | null;
  gold:      PreMarketItem | null;
  crudeoil:  PreMarketItem | null;
  vix:       PreMarketItem | null;
  indiaVix:  PreMarketItem | null;
}

const EMPTY: PreMarketData = {
  giftNifty: null, giftNifty50: null, bankNifty: null, sensex: null,
  esFut: null, nqFut: null, nikkei: null, hangSeng: null, dax: null,
  dxy: null, gold: null, crudeoil: null, vix: null, indiaVix: null,
};

const TICKER_MAP: Record<string, keyof PreMarketData> = {
  'NSE:GIFT_NIFTY': 'giftNifty', 'NSE:GIFTYNIFTY': 'giftNifty',
  'NSE:GIFTYNIFTY50': 'giftNifty50', 'NSE:BANKNIFTY': 'bankNifty',
  'BSE:SENSEX': 'sensex', 'CME_MINI:ES1!': 'esFut', 'CME_MINI:NQ1!': 'nqFut',
  'TVC:NI225': 'nikkei', 'TVC:HSI': 'hangSeng', 'XETR:DAX': 'dax',
  'TVC:DXY': 'dxy', 'COMEX:GC1!': 'gold', 'NYMEX:CL1!': 'crudeoil',
  'CBOE:VIX': 'vix', 'NSE:INDIAVIX': 'indiaVix',
};

async function fetchPreMarket(): Promise<PreMarketData> {
  const result: PreMarketData = { ...EMPTY };
  const tickers = Object.keys(TICKER_MAP);

  try {
    const res = await fetch('https://scanner.tradingview.com/global/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ symbols: { tickers }, columns: ['close', 'change', 'volume'] }),
      signal: AbortSignal.timeout(10000),
    });

    if (res.ok) {
      const data = await res.json();
      if (data?.data) {
        for (const item of data.data) {
          const field = TICKER_MAP[item.s];
          if (field && item.d?.[0] != null) {
            const price = parseFloat(item.d[0]);
            const change = parseFloat(item.d[1]) || 0;
            if (!isNaN(price) && price > 0) {
              result[field] = { price, change };
            }
          }
        }
      }
    }
  } catch (e) {
    console.warn('[PreMarket] Fetch error:', e);
  }

  return result;
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

function _isMarketOpen(): boolean {
  const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const d = ist.getDay();
  if (d === 0 || d === 6) return false;
  const m = ist.getHours() * 60 + ist.getMinutes();
  return m >= 555 && m <= 930;
}

interface VerdictResult {
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  gapProbability: number;
  recommendation: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  intradayBias: string;
  keyLevels: { niftySupport: number; niftyResistance: number };
}

function getAdvancedVerdict(data: PreMarketData): VerdictResult {
  const giftChg = data.giftNifty?.change ?? 0;
  const esChg = data.esFut?.change ?? 0;
  const nqChg = data.nqFut?.change ?? 0;
  const bankChg = data.bankNifty?.change ?? 0;
  const sensexChg = data.sensex?.change ?? 0;
  const vix = data.vix?.price ?? 15;
  const inVix = data.indiaVix?.price ?? 15;
  const goldChg = data.gold?.change ?? 0;
  // dxyChg - kept for future macro analysis

  const avgUS = (esChg + nqChg) / 2;
  const avgIndia = (giftChg + bankChg + sensexChg) / 3;
  // globalBias - kept for potential future use

  let direction: VerdictResult['direction'] = 'NEUTRAL';
  let gapProbability = 50;
  let recommendation = '';
  let riskLevel: VerdictResult['riskLevel'] = 'MEDIUM';
  let intradayBias = 'RANGE BOUND';
  let niftySupport = 22500;
  let niftyResistance = 23200;

  const niftyPrev = data.giftNifty?.price ? data.giftNifty.price / (1 + giftChg / 100) : 22800;
  niftySupport = niftyPrev * 0.98;
  niftyResistance = niftyPrev * 1.02;

  if (giftChg > 0.75 || avgUS > 0.75 || avgIndia > 0.75) {
    direction = 'BULLISH';
    gapProbability = 85;
    recommendation = '🟢 STRONG GAP-UP EXPECTED — Bullish global & India cues. Aggressive buy on open with stop below gap fill.';
    riskLevel = 'LOW';
    intradayBias = 'UPTREND';
  } else if (giftChg > 0.3 || avgIndia > 0.3) {
    direction = 'BULLISH';
    gapProbability = 70;
    recommendation = '🟢 MODERATE BULLISH — Positive pre-market. Buy on dips, target resistance.';
    riskLevel = 'LOW';
    intradayBias = 'BULLISH';
  } else if (giftChg < -0.75 || avgUS < -0.75 || avgIndia < -0.75) {
    direction = 'BEARISH';
    gapProbability = 85;
    recommendation = '🔴 STRONG GAP-DOWN RISK — Negative global & India cues. Avoid fresh buys, hold cash.';
    riskLevel = 'HIGH';
    intradayBias = 'DOWNTREND';
  } else if (giftChg < -0.3 || avgIndia < -0.3) {
    direction = 'BEARISH';
    gapProbability = 70;
    recommendation = '🔴 BEARISH PRE-MARKET — Sell on rallies, wait for support hold.';
    riskLevel = 'MEDIUM';
    intradayBias = 'BEARISH';
  } else if (Math.abs(goldChg) > 1) {
    direction = goldChg > 0 ? 'BULLISH' : 'BEARISH';
    gapProbability = 60;
    recommendation = goldChg > 0 
      ? '🟡 GOLD RALLY — Safe haven flow. Defensive play.'
      : '🟡 DOLLAR STRENGTH — Risk off. Stay cautious.';
    riskLevel = 'MEDIUM';
  } else {
    recommendation = '⚖️ MIXED SIGNALS — No clear direction. Wait for first 15-min candle confirmation.';
  }

  if (vix > 25 || inVix > 20) {
    riskLevel = riskLevel === 'LOW' ? 'MEDIUM' : 'HIGH';
    recommendation += ' ⚠️ HIGH VIX: Use strict stops!';
  }

  return { direction, gapProbability, recommendation, riskLevel, intradayBias, keyLevels: { niftySupport, niftyResistance } };
}

function getMarketSession(): string {
  const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const d = ist.getDay();
  const m = ist.getHours() * 60 + ist.getMinutes();
  
  if (d === 0 || d === 6) return 'WEEKEND';
  if (m >= 480 && m < 555) return 'PRE-MARKET';
  if (m >= 555 && m <= 930) return 'LIVE';
  if (m > 930 && m < 960) return 'CLOSE';
  return 'CLOSED';
}

interface Props {
  alwaysShow?: boolean;
}

export const PreMarketWatch = React.memo(({ alwaysShow = false }: Props) => {
  const [data, setData] = useState<PreMarketData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(0);
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const inPre = isIndiaPreMarket();
  const usPre = isUSPreMarket();
  const session = getMarketSession();

  const verdict = useMemo(() => getAdvancedVerdict(data), [data]);

  const load = useCallback(async () => {
    setLoading(true);
    const d = await fetchPreMarket();
    setData(d);
    setLastUpdate(Date.now());
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 60000);
    return () => clearInterval(id);
  }, [load]);

  if (!alwaysShow && !inPre && !usPre) return null;

  const fmt = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
  const clr = (v: number) => v >= 0 ? 'text-emerald-400' : 'text-red-400';
  const bg = (v: number) => v >= 0 ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-red-500/10 border-red-500/30';

  // sessionColor - kept for potential future use

  return (
    <div className={`glass-card rounded-2xl p-5 animate-fade-in-up ${inPre || usPre ? 'premarket-live' : ''}`}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-bold text-white flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 flex items-center justify-center text-sm">🌅</span>
          Pre-Market Intelligence Pro
          <span className={`badge text-[10px] ${session === 'LIVE' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : session === 'PRE-MARKET' ? 'bg-amber-500/20 text-amber-400 border-amber-500/30' : 'bg-slate-500/20 text-slate-400 border-slate-500/30'}`}>
            {session}
          </span>
        </h2>
        <div className="flex items-center gap-2">
          {loading && <div className="w-3 h-3 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin" />}
          <button onClick={load} className="text-slate-600 hover:text-amber-400 text-xs transition-colors" title="Refresh">🔄</button>
        </div>
      </div>

      {/* Gap Probability Meter */}
      <div className="rounded-xl p-4 border mb-4 bg-gradient-to-r from-amber-500/10 to-orange-500/10 border-amber-500/30">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[10px] text-amber-400 font-bold uppercase">Gap Probability</div>
          <div className={`text-xl font-black ${verdict.direction === 'BULLISH' ? 'text-emerald-400' : verdict.direction === 'BEARISH' ? 'text-red-400' : 'text-amber-400'}`}>
            {verdict.gapProbability}%
          </div>
        </div>
        <div className="relative h-3 bg-slate-800/60 rounded-full overflow-hidden">
          <div className={`h-full transition-all ${verdict.direction === 'BULLISH' ? 'bg-gradient-to-r from-emerald-500 to-cyan-500' : verdict.direction === 'BEARISH' ? 'bg-gradient-to-r from-red-500 to-orange-500' : 'bg-gradient-to-r from-amber-500 to-yellow-500'}`} style={{ width: `${verdict.gapProbability}%` }} />
        </div>
        <div className="flex justify-between mt-1 text-[8px] text-slate-500">
          <span>Gap Down</span>
          <span>Range</span>
          <span>Gap Up</span>
        </div>
      </div>

      {/* Nifty & BankNifty Hero */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        {data.giftNifty && (
          <div className={`rounded-xl p-4 border ${bg(data.giftNifty.change)}`}>
            <div className="text-[9px] text-slate-400 font-bold uppercase mb-1">🎯 Nifty Futures</div>
            <div className="text-xl font-black text-white font-mono">{data.giftNifty.price.toFixed(0)}</div>
            <div className={`text-sm font-bold ${clr(data.giftNifty.change)}`}>{fmt(data.giftNifty.change)}</div>
            <div className={`text-[10px] mt-1 ${data.giftNifty.change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {data.giftNifty.change > 0 ? '▲ GAP UP' : data.giftNifty.change < 0 ? '▼ GAP DOWN' : '▬ FLAT'}
            </div>
          </div>
        )}
        {data.bankNifty && (
          <div className={`rounded-xl p-4 border ${bg(data.bankNifty.change)}`}>
            <div className="text-[9px] text-slate-400 font-bold uppercase mb-1">🏦 BankNifty</div>
            <div className="text-xl font-black text-white font-mono">{data.bankNifty.price.toFixed(0)}</div>
            <div className={`text-sm font-bold ${clr(data.bankNifty.change)}`}>{fmt(data.bankNifty.change)}</div>
            <div className={`text-[10px] mt-1 ${data.bankNifty.change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {data.bankNifty.change > 0 ? '📈' : data.bankNifty.change < 0 ? '📉' : '▬'}
            </div>
          </div>
        )}
      </div>

      {/* Intraday Bias & Risk */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-slate-800/30 rounded-xl p-3 border border-slate-700/30">
          <div className="text-[9px] text-slate-500 font-bold uppercase mb-1">📊 Intraday Bias</div>
          <div className={`text-sm font-bold ${verdict.intradayBias.includes('UP') ? 'text-emerald-400' : verdict.intradayBias.includes('DOWN') ? 'text-red-400' : 'text-amber-400'}`}>
            {verdict.intradayBias}
          </div>
        </div>
        <div className="bg-slate-800/30 rounded-xl p-3 border border-slate-700/30">
          <div className="text-[9px] text-slate-500 font-bold uppercase mb-1">⚠️ Risk Level</div>
          <div className={`text-sm font-bold ${verdict.riskLevel === 'LOW' ? 'text-emerald-400' : verdict.riskLevel === 'HIGH' ? 'text-red-400' : 'text-amber-400'}`}>
            {verdict.riskLevel}
          </div>
        </div>
      </div>

      {/* Key Levels */}
      <div className="bg-black/20 rounded-xl p-3 border border-white/5 mb-4">
        <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider mb-2">📍 Expected Key Levels (Nifty)</div>
        <div className="grid grid-cols-2 gap-3">
          <div className="text-center">
            <div className="text-[8px] text-emerald-400">Support</div>
            <div className="text-base font-black text-emerald-400 font-mono">₹{verdict.keyLevels.niftySupport.toFixed(0)}</div>
          </div>
          <div className="text-center">
            <div className="text-[8px] text-red-400">Resistance</div>
            <div className="text-base font-black text-red-400 font-mono">₹{verdict.keyLevels.niftyResistance.toFixed(0)}</div>
          </div>
        </div>
      </div>

      {/* US Futures & Global */}
      <div className="grid grid-cols-4 gap-2 mb-4">
        <div className={`bg-black/20 rounded-xl p-2.5 border ${data.esFut ? (data.esFut.change >= 0 ? 'border-emerald-500/10' : 'border-red-500/10') : 'border-white/5'}`}>
          <div className="text-[8px] text-slate-500">🇺🇸 S&P</div>
          <div className="text-sm font-bold text-white font-mono">{data.esFut?.price.toFixed(0) || '—'}</div>
          <div className={`text-[9px] ${clr(data.esFut?.change ?? 0)}`}>{data.esFut ? fmt(data.esFut.change) : '—'}</div>
        </div>
        <div className={`bg-black/20 rounded-xl p-2.5 border ${data.nqFut ? (data.nqFut.change >= 0 ? 'border-emerald-500/10' : 'border-red-500/10') : 'border-white/5'}`}>
          <div className="text-[8px] text-slate-500">📱 NASDAQ</div>
          <div className="text-sm font-bold text-white font-mono">{data.nqFut?.price.toFixed(0) || '—'}</div>
          <div className={`text-[9px] ${clr(data.nqFut?.change ?? 0)}`}>{data.nqFut ? fmt(data.nqFut.change) : '—'}</div>
        </div>
        <div className="bg-black/20 rounded-xl p-2.5 border border-white/5">
          <div className="text-[8px] text-slate-500">💵 DXY</div>
          <div className="text-sm font-bold text-white font-mono">{data.dxy?.price.toFixed(2) || '—'}</div>
          <div className={`text-[9px] ${clr(data.dxy?.change ?? 0)}`}>{data.dxy ? fmt(data.dxy.change) : '—'}</div>
        </div>
        <div className="bg-black/20 rounded-xl p-2.5 border border-white/5">
          <div className="text-[8px] text-slate-500">🥇 Gold</div>
          <div className="text-sm font-bold text-white font-mono">${data.gold?.price.toFixed(0) || '—'}</div>
          <div className={`text-[9px] ${clr(data.gold?.change ?? 0)}`}>{data.gold ? fmt(data.gold.change) : '—'}</div>
        </div>
      </div>

      {/* Asian Markets */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="bg-black/20 rounded-xl p-2.5 border border-white/5">
          <div className="text-[8px] text-slate-500">🇯🇵 Nikkei</div>
          <div className="text-sm font-bold text-white font-mono">{data.nikkei?.price.toFixed(0) || '—'}</div>
          <div className={`text-[9px] ${clr(data.nikkei?.change ?? 0)}`}>{data.nikkei ? fmt(data.nikkei.change) : '—'}</div>
        </div>
        <div className="bg-black/20 rounded-xl p-2.5 border border-white/5">
          <div className="text-[8px] text-slate-500">🇭🇰 Hang Seng</div>
          <div className="text-sm font-bold text-white font-mono">{data.hangSeng?.price.toFixed(0) || '—'}</div>
          <div className={`text-[9px] ${clr(data.hangSeng?.change ?? 0)}`}>{data.hangSeng ? fmt(data.hangSeng.change) : '—'}</div>
        </div>
        <div className="bg-black/20 rounded-xl p-2.5 border border-white/5">
          <div className="text-[8px] text-slate-500">🇩🇪 DAX</div>
          <div className="text-sm font-bold text-white font-mono">{data.dax?.price.toFixed(0) || '—'}</div>
          <div className={`text-[9px] ${clr(data.dax?.change ?? 0)}`}>{data.dax ? fmt(data.dax.change) : '—'}</div>
        </div>
      </div>

      {/* VIX */}
      <div className="bg-black/20 rounded-xl p-3 border border-white/5 mb-4">
        <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider mb-2">🌊 Volatility Index</div>
        <div className="grid grid-cols-2 gap-3">
          <div className="text-center">
            <div className="text-[8px] text-slate-600">US VIX</div>
            <div className={`text-lg font-bold ${(data.vix?.price ?? 15) > 20 ? 'text-red-400' : (data.vix?.price ?? 15) < 15 ? 'text-emerald-400' : 'text-amber-400'}`}>
              {data.vix?.price.toFixed(1) || '—'}
            </div>
          </div>
          <div className="text-center">
            <div className="text-[8px] text-slate-600">India VIX</div>
            <div className={`text-lg font-bold ${(data.indiaVix?.price ?? 15) > 18 ? 'text-red-400' : (data.indiaVix?.price ?? 15) < 12 ? 'text-emerald-400' : 'text-amber-400'}`}>
              {data.indiaVix?.price.toFixed(1) || '—'}
            </div>
          </div>
        </div>
      </div>

      {/* AI Verdict */}
      <div className="rounded-xl p-4 border bg-gradient-to-r from-cyan-500/5 to-purple-500/5 border-cyan-500/20 mb-3">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-lg">🧠</span>
          <div className="text-[10px] text-cyan-400 font-bold uppercase">AI Verdict</div>
        </div>
        <div className="text-xs text-slate-300 leading-relaxed">{verdict.recommendation}</div>
      </div>

      {/* Trading Action */}
      <div className="grid grid-cols-3 gap-2">
        <button className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-2 text-center hover:bg-emerald-500/20 transition-all">
          <div className="text-[8px] text-emerald-400 font-bold uppercase">If Bullish</div>
          <div className="text-[9px] text-white mt-1">🎯 Buy Dips</div>
        </button>
        <button className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-2 text-center hover:bg-amber-500/20 transition-all">
          <div className="text-[8px] text-amber-400 font-bold uppercase">If Neutral</div>
          <div className="text-[9px] text-white mt-1">⏳ Wait</div>
        </button>
        <button className="bg-red-500/10 border border-red-500/20 rounded-xl p-2 text-center hover:bg-red-500/20 transition-all">
          <div className="text-[8px] text-red-400 font-bold uppercase">If Bearish</div>
          <div className="text-[9px] text-white mt-1">🛡️ Hedge</div>
        </button>
      </div>

      {lastUpdate > 0 && (
        <div className="mt-3 text-[8px] text-slate-600 text-center">
          Last updated: {new Date(lastUpdate).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </div>
      )}
    </div>
  );
});