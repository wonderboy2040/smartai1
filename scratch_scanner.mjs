// ========== TRADING UNIVERSE ==========
const TRADING_CRYPTO = [
  { sym: 'BTC', name: 'Bitcoin', market: 'CRYPTO', sector: 'Layer 1', avgATR: 3.5, maxLev: 10 },
  { sym: 'ETH', name: 'Ethereum', market: 'CRYPTO', sector: 'Layer 1', avgATR: 4.2, maxLev: 10 },
  { sym: 'SOL', name: 'Solana', market: 'CRYPTO', sector: 'Layer 1', avgATR: 6.0, maxLev: 8 },
  { sym: 'BNB', name: 'BNB', market: 'CRYPTO', sector: 'Exchange', avgATR: 3.8, maxLev: 8 },
  { sym: 'XRP', name: 'Ripple', market: 'CRYPTO', sector: 'Payments', avgATR: 5.0, maxLev: 8 },
  { sym: 'DOGE', name: 'Dogecoin', market: 'CRYPTO', sector: 'Meme', avgATR: 7.0, maxLev: 5 },
  { sym: 'AVAX', name: 'Avalanche', market: 'CRYPTO', sector: 'Layer 1', avgATR: 5.5, maxLev: 5 },
  { sym: 'LINK', name: 'Chainlink', market: 'CRYPTO', sector: 'Oracle', avgATR: 5.0, maxLev: 5 },
];

const TRADING_US = [
  { sym: 'NVDA', name: 'NVIDIA', market: 'US', sector: 'Semis', avgATR: 3.5, maxLev: 5 },
  { sym: 'TSLA', name: 'Tesla', market: 'US', sector: 'EV', avgATR: 4.0, maxLev: 5 },
  { sym: 'AAPL', name: 'Apple', market: 'US', sector: 'Tech', avgATR: 1.8, maxLev: 5 },
  { sym: 'META', name: 'Meta', market: 'US', sector: 'Social', avgATR: 2.8, maxLev: 5 },
  { sym: 'AMD', name: 'AMD', market: 'US', sector: 'Semis', avgATR: 3.5, maxLev: 5 },
  { sym: 'COIN', name: 'Coinbase', market: 'US', sector: 'Crypto', avgATR: 5.0, maxLev: 3 },
  { sym: 'PLTR', name: 'Palantir', market: 'US', sector: 'AI', avgATR: 4.0, maxLev: 3 },
  { sym: 'MSFT', name: 'Microsoft', market: 'US', sector: 'Tech', avgATR: 1.5, maxLev: 5 },
  { sym: 'AMZN', name: 'Amazon', market: 'US', sector: 'E-Com', avgATR: 2.2, maxLev: 5 },
  { sym: 'GOOGL', name: 'Alphabet', market: 'US', sector: 'Tech', avgATR: 2.0, maxLev: 5 },
];

const TRADING_IN = [
  { sym: 'RELIANCE', name: 'Reliance', market: 'IN', sector: 'Conglomerate', avgATR: 1.8, maxLev: 5 },
  { sym: 'TATAMOTORS', name: 'Tata Motors', market: 'IN', sector: 'Auto', avgATR: 2.5, maxLev: 5 },
  { sym: 'BAJFINANCE', name: 'Bajaj Finance', market: 'IN', sector: 'NBFC', avgATR: 2.2, maxLev: 5 },
  { sym: 'ADANIENT', name: 'Adani Ent', market: 'IN', sector: 'Conglomerate', avgATR: 3.5, maxLev: 3 },
  { sym: 'SBIN', name: 'SBI', market: 'IN', sector: 'Banking', avgATR: 2.0, maxLev: 5 },
  { sym: 'ICICIBANK', name: 'ICICI Bank', market: 'IN', sector: 'Banking', avgATR: 1.8, maxLev: 5 },
  { sym: 'HDFCBANK', name: 'HDFC Bank', market: 'IN', sector: 'Banking', avgATR: 1.5, maxLev: 5 },
  { sym: 'INFY', name: 'Infosys', market: 'IN', sector: 'IT', avgATR: 1.8, maxLev: 5 },
];

// ========== FETCH DATA ==========
async function fetchPrices() {
  const results = {};
  const columns = ['name', 'close', 'change', 'high', 'low', 'volume', 'SMA20', 'SMA50', 'RSI', 'MACD.macd', 'ATR', 'BB.upper', 'BB.lower'];

  const inTickers = TRADING_IN.map(s => `NSE:${s.sym}`);
  const usTickers = TRADING_US.map(s => {
    const exMap = {
      'NVDA': 'NASDAQ', 'TSLA': 'NASDAQ', 'AAPL': 'NASDAQ', 'META': 'NASDAQ',
      'AMD': 'NASDAQ', 'COIN': 'NASDAQ', 'PLTR': 'NASDAQ', 'MSFT': 'NASDAQ',
      'AMZN': 'NASDAQ', 'GOOGL': 'NASDAQ'
    };
    return `${exMap[s.sym] || 'NASDAQ'}:${s.sym}`;
  });
  const cryptoTickers = TRADING_CRYPTO.map(s => `BINANCE:${s.sym}USDT`);

  const scanBatch = async (endpoint, tickers, market) => {
    try {
      const res = await fetch(`https://scanner.tradingview.com/${endpoint}/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({ symbols: { tickers }, columns }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.data) {
          for (const item of data.data) {
            if (!item.d || item.d[1] === null) continue;
            let sym = item.s.split(':')[1];
            if (market === 'CRYPTO') sym = sym.replace('USDT', '');
            const price = parseFloat(item.d[1]);
            results[`${market}_${sym}`] = {
              price,
              change: parseFloat(item.d[2]) || 0,
              high: parseFloat(item.d[3]) || price,
              low: parseFloat(item.d[4]) || price,
              volume: parseFloat(item.d[5]) || 0,
              sma20: parseFloat(item.d[6]) || undefined,
              sma50: parseFloat(item.d[7]) || undefined,
              rsi: parseFloat(item.d[8]) || 50,
              macd: parseFloat(item.d[9]) || undefined,
              time: Date.now(),
              market
            };
          }
        }
      } else {
        console.warn(`Endpoint ${endpoint} returned status: ${res.status}`);
      }
    } catch (e) {
      console.warn(`Failed for ${endpoint}:`, e.message);
    }
  };

  await Promise.allSettled([
    scanBatch('india', inTickers, 'IN'),
    scanBatch('america', usTickers, 'US'),
    scanBatch('crypto', cryptoTickers, 'CRYPTO'),
  ]);
  return results;
}

// ========== SCORING SYSTEM ==========
function calcTechScore(rsi, sma20, sma50, macd, price) {
  let s = 0;
  if (rsi >= 30 && rsi <= 40) s += 25;
  else if (rsi >= 60 && rsi <= 70) s += 22;
  else if (rsi >= 40 && rsi <= 60) s += 15;
  else if (rsi < 30) s += 20;
  else s += 8;

  if (macd > 0.5) s += 25;
  else if (macd > 0) s += 18;
  else if (macd > -0.5) s += 10;
  else s += 5;

  if (sma20 > 0 && sma50 > 0) {
    const cross = ((sma20 - sma50) / sma50) * 100;
    if (cross > 2) s += 25;
    else if (cross > 0) s += 18;
    else if (cross > -2) s += 10;
    else s += 4;
  } else s += 12;

  if (sma20 > 0) {
    const dist = ((price - sma20) / sma20) * 100;
    if (dist > 0 && dist < 3) s += 25;
    else if (dist < 0 && dist > -3) s += 22;
    else if (dist > 3) s += 12;
    else s += 8;
  } else s += 12;
  return s;
}

function calcMomentumScore(change, rsi, volume) {
  let s = 0;
  const absChange = Math.abs(change);
  if (absChange > 5) s += 40;
  else if (absChange > 3) s += 32;
  else if (absChange > 1.5) s += 24;
  else if (absChange > 0.5) s += 16;
  else s += 8;

  if (rsi > 55 && rsi < 75) s += 30;
  else if (rsi > 40 && rsi <= 55) s += 20;
  else if (rsi < 35) s += 25;
  else s += 10;

  if (volume > 10000000) s += 30;
  else if (volume > 5000000) s += 22;
  else if (volume > 1000000) s += 15;
  else s += 8;
  return s;
}

function calcVolatilityScore(high, low, price, avgATR) {
  const atrPct = price > 0 ? ((high - low) / price) * 100 : avgATR;
  let s = 0;
  if (atrPct > 5) s += 60;
  else if (atrPct > 3) s += 48;
  else if (atrPct > 2) s += 36;
  else if (atrPct > 1) s += 24;
  else s += 12;

  if (atrPct > avgATR * 1.3) s += 40;
  else if (atrPct > avgATR * 0.8) s += 28;
  else s += 15;
  return s;
}

function calcSentimentScore(vix, change) {
  let s = 50;
  if (vix > 25) s += 30;
  else if (vix > 20) s += 20;
  else if (vix > 15) s += 10;
  else s += 5;
  if (Math.abs(change) > 3) s += 20;
  else if (Math.abs(change) > 1) s += 10;
  return s;
}

// ========== RUN SCAN ==========
async function main() {
  console.log('⚡ Starting Quantum Live Market Scan (Crypto + India + US)...');
  const prices = await fetchPrices();
  console.log(`📊 Total Prices Fetched: ${Object.keys(prices).length}`);
  const allAssets = [...TRADING_CRYPTO, ...TRADING_US, ...TRADING_IN];
  console.log(`📋 Total Assets to scan: ${allAssets.length}`);
  const signals = [];

  for (const asset of allAssets) {
    const key = `${asset.market}_${asset.sym}`;
    const pd = prices[key];
    if (!pd) continue;

    const price = pd.price;
    const change = pd.change;
    const rsi = pd.rsi;
    const sma20 = pd.sma20 || price;
    const sma50 = pd.sma50 || price;
    const macd = pd.macd || 0;
    const volume = pd.volume || 0;
    const high = pd.high || price;
    const low = pd.low || price;
    const atr = (high - low) || price * (asset.avgATR / 100);

    const tech = calcTechScore(rsi, sma20, sma50, macd, price);
    const mom = calcMomentumScore(change, rsi, volume);
    const vol = calcVolatilityScore(high, low, price, asset.avgATR);
    const sent = calcSentimentScore(15, change);

    const aiScore = Math.round(tech * 0.40 + mom * 0.30 + vol * 0.20 + sent * 0.10);

    const bullSignals = [rsi < 45 && rsi > 25, macd > 0, sma20 > sma50, change > 0.5, price > sma20].filter(Boolean).length;
    const bearSignals = [rsi > 65, macd < 0, sma20 < sma50, change < -0.5, price < sma20].filter(Boolean).length;
    const isLong = bullSignals >= bearSignals;
    const direction = isLong ? 'LONG' : 'SHORT';

    const entryPrice = price;
    const slDistance = atr * 1.5;
    const stopLoss = isLong ? price - slDistance : price + slDistance;
    const target1 = isLong ? price + atr * 3.0 : price - atr * 3.0;
    const target2 = isLong ? price + atr * 4.5 : price - atr * 4.5;
    const target3 = isLong ? price + atr * 6.0 : price - atr * 6.0;

    const riskPercent = (slDistance / price) * 100;
    const potentialReturn = ((Math.abs(target1 - price)) / price) * 100;
    const riskReward = riskPercent > 0 ? potentialReturn / riskPercent : 1;

    // Filters R:R >= 2:1
    if (riskReward < 2.0) continue;

    let signalStrength = '';
    if (isLong && aiScore >= 70) signalStrength = 'STRONG_LONG';
    else if (isLong) signalStrength = 'LONG';
    else if (!isLong && aiScore >= 70) signalStrength = 'STRONG_SHORT';
    else signalStrength = 'SHORT';

    const volFactor = asset.avgATR > 4 ? 0.5 : asset.avgATR > 2.5 ? 0.7 : 1;
    const leverage = Math.min(asset.maxLev, Math.max(2, Math.round(aiScore / 20 * volFactor)));

    const conviction = Math.min(99, Math.max(80, Math.round(aiScore * 1.1)));

    signals.push({
      symbol: asset.sym,
      name: asset.name,
      market: asset.market,
      sector: asset.sector,
      price,
      change,
      rsi,
      direction,
      leverage,
      aiScore,
      conviction,
      riskReward: Math.round(riskReward * 10) / 10,
      entryPrice,
      stopLoss,
      target1,
      target2,
      target3,
      signalStrength
    });
  }

  signals.sort((a, b) => b.aiScore - a.aiScore);

  const printCategory = (title, marketName) => {
    const filtered = signals.filter(s => s.market === marketName).slice(0, 3);
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📡 TOP 3 ${title} TRADE SETUPS`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    if (filtered.length === 0) {
      console.log('   No high-conviction setups found satisfying R:R >= 2.0 right now.');
      return;
    }
    filtered.forEach((s, i) => {
      const cur = s.market === 'IN' ? '₹' : '$';
      console.log(`\n${i + 1}. [${s.signalStrength}] ${s.symbol} — ${s.direction} ${s.leverage}x`);
      console.log(`   Current Price: ${cur}${s.price.toFixed(2)} (${s.change >= 0 ? '+' : ''}${s.change.toFixed(2)}%) | RSI: ${s.rsi.toFixed(0)}`);
      console.log(`   AI Score: ${s.aiScore}/100 | AI Confidence: ${s.conviction}% | R:R Ratio: ${s.riskReward}:1`);
      console.log(`   🎯 Entry Zone: ${cur}${s.entryPrice.toFixed(2)}`);
      console.log(`   🛑 Stop Loss: ${cur}${s.stopLoss.toFixed(2)}`);
      console.log(`   🏆 Targets: T1: ${cur}${s.target1.toFixed(2)} | T2: ${cur}${s.target2.toFixed(2)} | T3: ${cur}${s.target3.toFixed(2)}`);
    });
  };

  console.log('\n=============================================================');
  console.log('🚀 DEEPMIND QUANTUM ADVANCED PRO REAL-TIME SCANNER');
  console.log('=============================================================');
  printCategory('CRYPTO', 'CRYPTO');
  printCategory('INDIA (NSE)', 'IN');
  printCategory('USA (NASDAQ/NYSE)', 'US');
  console.log('\n=============================================================\n');
}

main();
