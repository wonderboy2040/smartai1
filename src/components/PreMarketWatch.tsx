import React, { useState, useEffect, useCallback } from 'react';

interface PreMarketItem {
  price: number;
  change: number;
}

interface PreMarketData {
  giftNifty: PreMarketItem | null;
  esFut:     PreMarketItem | null;
  nqFut:     PreMarketItem | null;
  nikkei:    PreMarketItem | null;
  hangSeng:  PreMarketItem | null;
  dax:       PreMarketItem | null;
  dxy:       PreMarketItem | null;
  gold:      PreMarketItem | null;
  crudeoil:  PreMarketItem | null;
}

const EMPTY: PreMarketData = {
  giftNifty: null, esFut: null, nqFut: null,
  nikkei: null, hangSeng: null, dax: null,
  dxy: null, gold: null, crudeoil: null,
};

// TradingView ticker → field mapping
const TICKER_MAP: Record<string, keyof PreMarketData> = {
  'NSE:GIFT_NIFTY':   'giftNifty',
  'NSE:GIFTYNIFTY':   'giftNifty',
  'CME_MINI:ES1!':    'esFut',
  'CME_MINI:NQ1!':    'nqFut',
  'TVC:NI225':        'nikkei',
  'TVC:HSI':          'hangSeng',
  'XETR:DAX':         'dax',
  'TVC:DXY':          'dxy',
  'COMEX:GC1!':       'gold',
  'NYMEX:CL1!':       'crudeoil',
};

async function fetchPreMarket(): Promise<PreMarketData> {
  const result: PreMarketData = { ...EMPTY };
  const tickers = Object.keys(TICKER_MAP);

  try {
    // Try global scan endpoint (works for futures + international)
    const res = await fetch('https://scanner.tradingview.com/global/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({
        symbols: { tickers },
        columns: ['close', 'change'],
      }),
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

    // If GIFT Nifty failed on global, try India endpoint
    if (!result.giftNifty) {
      const fallbackTickers = ['NSE:GIFT_NIFTY', 'NSE:GIFTYNIFTY', 'NSE:GIFTYNIFTY50'];
      try {
        const r2 = await fetch('https://scanner.tradingview.com/india/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
          body: JSON.stringify({ symbols: { tickers: fallbackTickers }, columns: ['close', 'change'] }),
          signal: AbortSignal.timeout(6000),
        });
        if (r2.ok) {
          const d2 = await r2.json();
          const item = d2?.data?.[0];
          if (item?.d?.[0]) {
            result.giftNifty = { price: parseFloat(item.d[0]), change: parseFloat(item.d[1]) || 0 };
          }
        }
      } catch (_) {}
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

function getVerdict(data: PreMarketData): string {
  const esChg = data.esFut?.change ?? 0;
  const nqChg = data.nqFut?.change ?? 0;
  const giftChg = data.giftNifty?.change ?? 0;
  const avgUS = (esChg + nqChg) / 2;

  if (giftChg > 0.5 || avgUS > 0.5)
    return `🟢 Strong pre-market signal! GIFT Nifty ${giftChg >= 0 ? '+' : ''}${giftChg.toFixed(2)}% — Gap-Up expected. Bullish open ho sakta hai. SIP continue karo!`;
  if (giftChg < -0.5 || avgUS < -0.5)
    return `🔴 Weak pre-market — GIFT ${giftChg.toFixed(2)}%, US Futures ${avgUS.toFixed(2)}%. Gap-Down risk! Wait for first 15-min candle, tab entry karo.`;
  return `🟡 Mixed signals — GIFT ${giftChg >= 0 ? '+' : ''}${giftChg.toFixed(2)}%, US Futures ${avgUS >= 0 ? '+' : ''}${avgUS.toFixed(2)}%. Flat to rangebound open expected.`;
}

interface Props {
  alwaysShow?: boolean;
}

export const PreMarketWatch = React.memo(({ alwaysShow = false }: Props) => {
  const [data, setData] = useState<PreMarketData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(0);

  const inPre = isIndiaPreMarket();
  const usPre = isUSPreMarket();

  const load = useCallback(async () => {
    setLoading(true);
    const d = await fetchPreMarket();
    setData(d);
    setLastUpdate(Date.now());
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 90000); // refresh every 90s
    return () => clearInterval(id);
  }, [load]);

  if (!alwaysShow && !inPre && !usPre) return null; // Hide during market hours

  const fmt = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
  const clr = (v: number) => v >= 0 ? 'text-emerald-400' : 'text-red-400';
  const bg  = (v: number) => v >= 0 ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-red-500/5 border-red-500/20';

  const cells: { label: string; icon: string; key: keyof PreMarketData; prefix: string; digits: number }[] = [
    { label: 'S&P 500 Fut', icon: '🇺🇸', key: 'esFut',    prefix: '$',   digits: 0 },
    { label: 'NASDAQ Fut',  icon: '📱',  key: 'nqFut',    prefix: '$',   digits: 0 },
    { label: 'Nikkei 225',  icon: '🇯🇵', key: 'nikkei',   prefix: '¥',   digits: 0 },
    { label: 'Hang Seng',   icon: '🇭🇰', key: 'hangSeng', prefix: 'HK',  digits: 0 },
    { label: 'DAX',         icon: '🇩🇪', key: 'dax',      prefix: '€',   digits: 0 },
    { label: 'DXY',         icon: '💵',  key: 'dxy',      prefix: '',    digits: 2 },
    { label: 'Gold',        icon: '🥇',  key: 'gold',     prefix: '$',   digits: 0 },
    { label: 'Crude Oil',   icon: '🛢️',  key: 'crudeoil', prefix: '$',   digits: 2 },
  ];

  return (
    <div className={`glass-card rounded-2xl p-5 border-amber-500/15 animate-fade-in-up ${inPre || usPre ? 'premarket-live' : ''}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-bold text-white flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-amber-500/10 flex items-center justify-center text-sm">🌅</span>
          Pre-Market Intelligence
          <span className="badge bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[10px]">
            {inPre ? '🇮🇳 INDIA PRE' : usPre ? '🇺🇸 US PRE' : 'GLOBAL WATCH'}
          </span>
        </h2>
        <div className="flex items-center gap-2">
          {loading && <div className="w-3 h-3 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin" />}
          {lastUpdate > 0 && (
            <span className="text-[8px] text-slate-600 font-mono">
              {new Date(lastUpdate).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <button onClick={load} className="text-slate-600 hover:text-cyan-400 text-[10px] transition-colors" title="Refresh">🔄</button>
        </div>
      </div>

      {/* GIFT Nifty Hero Banner */}
      {inPre && (
        <div className={`rounded-xl p-4 border ${data.giftNifty ? bg(data.giftNifty.change) : 'bg-slate-800/30 border-slate-700/30'} mb-4 flex items-center justify-between`}>
          <div>
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">🎯 GIFT Nifty Futures</div>
            <div className={`text-xl font-black mt-1 ${data.giftNifty ? clr(data.giftNifty.change) : 'text-slate-500'}`}>
              {data.giftNifty
                ? `${data.giftNifty.change >= 0 ? '▲ GAP UP' : '▼ GAP DOWN'} ${fmt(data.giftNifty.change)}`
                : '⏳ Loading...'}
            </div>
            <div className="text-[10px] text-slate-500 mt-1">Expected Nifty opening direction</div>
          </div>
          <div className="text-right">
            {data.giftNifty && (
              <>
                <div className="text-xl font-black font-mono text-white">{data.giftNifty.price.toFixed(0)}</div>
                <div className={`text-xs font-bold ${clr(data.giftNifty.change)}`}>{fmt(data.giftNifty.change)}</div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Global Indices Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
        {cells.map(({ label, icon, key, prefix, digits }) => {
          const item = data[key];
          return (
            <div key={key} className={`bg-black/20 rounded-xl p-3 border ${item ? (item.change >= 0 ? 'border-emerald-500/10' : 'border-red-500/10') : 'border-white/5 opacity-40'} transition-all`}>
              <div className="text-[9px] text-slate-500 mb-1 flex items-center gap-1">{icon} {label}</div>
              {item ? (
                <>
                  <div className="text-sm font-black font-mono text-white">
                    {prefix}{item.price > 1000 ? item.price.toFixed(digits > 0 ? digits : 0) : item.price.toFixed(digits > 0 ? digits : 2)}
                  </div>
                  <div className={`text-[10px] font-bold mt-0.5 ${clr(item.change)}`}>{fmt(item.change)}</div>
                </>
              ) : (
                <div className="text-sm font-mono text-slate-700">—</div>
              )}
            </div>
          );
        })}
      </div>

      {/* AI Verdict */}
      <div className="bg-black/20 rounded-xl p-3 border border-white/5">
        <div className="text-[9px] text-cyan-400/70 uppercase tracking-wider mb-1.5 font-bold">🧠 AI Pre-Market Verdict</div>
        <div className="text-xs text-slate-300 leading-relaxed">{getVerdict(data)}</div>
      </div>
    </div>
  );
});
