// ============================================================
// Auto Trader — INDMoney (Tradetron) + CoinDCX Futures
// ------------------------------------------------------------
// Replaces the old AngelOne-based autoTrader.
// Now supports:
//   1. India equities via Tradetron → INDMoney
//   2. Crypto futures via CoinDCX direct API
//
// The frontend drives the tick loop every ~30s during market hours.
// Config and state are kept in-memory (resets on server restart).
// ============================================================
import { indmoneyEnabled, executeTradetronSignal } from './indmoneyTradetron.js';
import { coindcxEnabled, placeFuturesOrder } from './coindcxFutures.js';

const config = {
  enabled: false,
  mode: 'both', // 'equity' | 'crypto' | 'both'
  maxAmount: 0,
  minReturnPct: 3,
  maxDailyTrades: 5,
  cryptoLeverage: 5,
  lastAction: '',
  lastState: 'stopped',
  currentTrade: null,
  tradeLog: [],
  dailyTradeCount: 0,
  dailyTradeDate: '',
  regime: 'NEUTRAL',
  regimeMultiplier: 1,
  tradeStats: { total: 0, wins: 0, losses: 0, totalReturn: 0 },
};

export function getAutoConfig() {
  return {
    ...config,
    lastAction: config.lastAction.substring(0, 200),
    tradeLog: config.tradeLog.slice(-20),
    tradeStats: config.tradeStats,
    indmoneyEnabled: indmoneyEnabled(),
    coindcxEnabled: coindcxEnabled(),
  };
}

export function setAutoConfig(cfg) {
  if (typeof cfg.enabled === 'boolean') config.enabled = cfg.enabled;
  if (typeof cfg.mode === 'string') config.mode = cfg.mode;
  if (typeof cfg.maxAmount === 'number') config.maxAmount = cfg.maxAmount;
  if (typeof cfg.minReturnPct === 'number') config.minReturnPct = cfg.minReturnPct;
  if (typeof cfg.maxDailyTrades === 'number') config.maxDailyTrades = Math.min(15, Math.max(1, cfg.maxDailyTrades));
  if (typeof cfg.cryptoLeverage === 'number') config.cryptoLeverage = Math.min(20, Math.max(1, cfg.cryptoLeverage));
  if (typeof cfg.regime === 'string') config.regime = cfg.regime;
  if (typeof cfg.regimeMultiplier === 'number') config.regimeMultiplier = Math.min(2, Math.max(0.3, cfg.regimeMultiplier));
  return getAutoConfig();
}

function isIndiaMarketOpen() {
  const now = new Date();
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const h = ist.getHours(), m = ist.getMinutes(), d = ist.getDay();
  if (d === 0 || d === 6) return false;
  const t = h * 100 + m;
  return t >= 915 && t < 1530;
}

// Crypto trades 24/7 — always "open"
function isCryptoMarketOpen() {
  return true;
}

function getDailyCount() {
  const today = new Date().toISOString().slice(0, 10);
  if (config.dailyTradeDate !== today) {
    config.dailyTradeCount = 0;
    config.dailyTradeDate = today;
  }
  return config.dailyTradeCount;
}

function scoreSignal(s, maxCash, regimeMult) {
  if (s.direction !== 'LONG' || !(s.entry > 0)) return null;
  const entry = s.entry;
  const qty = Math.floor(maxCash / entry);
  if (qty < 1) return null;
  const targetReturnPct = ((s.target1 - entry) / entry) * 100;
  if (targetReturnPct < config.minReturnPct) return null;
  const regimeBonus = regimeMult > 1 ? 1.2 : regimeMult < 1 ? 0.8 : 1;
  const rrfactor = Math.min(3, s.riskReward || 1);
  const score = targetReturnPct * (s.conviction || 50) * regimeBonus * rrfactor;
  return { ...s, maxQty: qty, returnPct: targetReturnPct, _score: score };
}

export async function autoTick(rawSignals) {
  if (!config.enabled) return { state: 'disabled', message: 'Auto-trading disabled' };

  const anyBroker = indmoneyEnabled() || coindcxEnabled();
  if (!anyBroker) return { state: 'no_broker', message: 'No broker configured. Set TRADETRON or COINDCX credentials.' };

  const mode = config.mode;
  const equityOpen = isIndiaMarketOpen();
  const cryptoOpen = isCryptoMarketOpen();

  if (mode === 'equity' && !equityOpen) return { state: 'market_closed', message: 'India market closed (9:15-3:30 IST)' };
  if (mode === 'both' && !equityOpen && !cryptoOpen) return { state: 'market_closed', message: 'All markets closed' };

  try {
    const usedToday = getDailyCount();
    const regimeMult = config.regimeMultiplier || 1;
    const effectiveMaxTrades = Math.max(1, Math.round(config.maxDailyTrades * regimeMult));

    if (usedToday >= effectiveMaxTrades) {
      config.lastState = 'limit_reached';
      return { state: 'limit_reached', message: `Daily limit ${effectiveMaxTrades} reached`, used: usedToday };
    }

    const signals = Array.isArray(rawSignals) ? rawSignals : [];
    const maxCash = config.maxAmount > 0 ? config.maxAmount : 100000; // default max
    const scored = signals
      .map(s => scoreSignal(s, maxCash, regimeMult))
      .filter(Boolean);
    scored.sort((a, b) => b._score - a._score);

    // Separate equity and crypto signals
    const equitySignals = scored.filter(s => !isCryptoSym(s.symbol));
    const cryptoSignals = scored.filter(s => isCryptoSym(s.symbol));

    let result = null;

    // Try equity first (if market open and INDMoney configured)
    if ((mode === 'equity' || mode === 'both') && equityOpen && indmoneyEnabled() && equitySignals.length > 0) {
      const best = equitySignals[0];
      result = await executeTradetronSignal({
        symbol: best.symbol,
        side: 'BUY',
        orderType: 'LIMIT',
        price: best.entry,
        qty: best.maxQty,
        productType: 'MIS', // Intraday
        exchange: 'NSE',
        tag: 'smartai_auto',
      });
      if (result?.orderId || result?.status === 'success') {
        config.dailyTradeCount++;
        config.lastAction = `📈 EQUITY ENTER ${best.symbol} x${best.maxQty} @₹${best.entry} via Tradetron→INDMoney ✓`;
        config.tradeLog.push({
          time: Date.now(), type: 'ENTER', symbol: best.symbol, qty: best.maxQty,
          entry: best.entry, returnPct: best.returnPct, broker: 'indmoney',
          orderId: result.orderId || '',
        });
        config.lastState = 'entered';
        return { state: 'entered', symbol: best.symbol, qty: best.maxQty, entry: best.entry, returnPct: best.returnPct, orderId: result.orderId, broker: 'indmoney' };
      }
    }

    // Try crypto futures (if CoinDCX configured)
    if ((mode === 'crypto' || mode === 'both') && coindcxEnabled() && cryptoSignals.length > 0) {
      const best = cryptoSignals[0];
      const cryptoMarket = `B-${best.symbol}_USDT`;
      result = await placeFuturesOrder({
        side: 'buy',
        orderType: 'limit_order',
        market: cryptoMarket,
        price: best.entry,
        qty: best.maxQty || 1,
        leverage: config.cryptoLeverage,
      });
      if (result?.orderId || result?.status === 'success') {
        config.dailyTradeCount++;
        config.lastAction = `🪙 CRYPTO ENTER ${best.symbol} x${config.cryptoLeverage} @$${best.entry} via CoinDCX Futures ✓`;
        config.tradeLog.push({
          time: Date.now(), type: 'ENTER', symbol: best.symbol, qty: best.maxQty,
          entry: best.entry, returnPct: best.returnPct, broker: 'coindcx',
          orderId: result.orderId || '',
        });
        config.lastState = 'entered';
        return { state: 'entered', symbol: best.symbol, entry: best.entry, broker: 'coindcx', orderId: result.orderId };
      }
    }

    config.lastState = 'scanning';
    return {
      state: 'scanning',
      message: `No suitable trade found (regime: ${config.regime})`,
      signals: signals.length,
      equityOpen,
      cryptoOpen,
    };
  } catch (e) {
    config.lastAction = `Error: ${e?.message || 'Unknown'}`;
    return { state: 'error', message: e?.message || 'Tick error' };
  }
}

function isCryptoSym(sym) {
  const clean = (sym || '').toUpperCase().replace('USDT', '').replace('USD', '');
  return ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'AVAX', 'DOT', 'LINK'].includes(clean);
}
