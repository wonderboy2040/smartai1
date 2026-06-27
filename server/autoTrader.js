import { angelOneEnabled } from './angelone.js';
import { placeOrder, getPositions, getOrderBook, getRMS } from './angelTrade.js';

const config = {
  enabled: false, maxAmount: 0, minReturnPct: 3, maxDailyTrades: 3,
  lastAction: '', lastState: 'stopped', currentTrade: null, tradeLog: [],
  dailyTradeCount: 0, dailyTradeDate: '', regime: 'NEUTRAL', regimeMultiplier: 1,
  tradeStats: { total: 0, wins: 0, losses: 0, totalReturn: 0 },
};

export function getAutoConfig() {
  return { ...config, lastAction: config.lastAction.substring(0, 200), tradeLog: config.tradeLog.slice(-20), tradeStats: config.tradeStats };
}

export function setAutoConfig(cfg) {
  if (typeof cfg.enabled === 'boolean') config.enabled = cfg.enabled;
  if (typeof cfg.maxAmount === 'number') config.maxAmount = cfg.maxAmount;
  if (typeof cfg.minReturnPct === 'number') config.minReturnPct = cfg.minReturnPct;
  if (typeof cfg.maxDailyTrades === 'number') config.maxDailyTrades = Math.min(10, Math.max(1, cfg.maxDailyTrades));
  if (typeof cfg.regime === 'string') config.regime = cfg.regime;
  if (typeof cfg.regimeMultiplier === 'number') config.regimeMultiplier = Math.min(2, Math.max(0.3, cfg.regimeMultiplier));
  return getAutoConfig();
}

function isMarketOpen() {
  const now = new Date();
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const h = ist.getHours(), m = ist.getMinutes(), d = ist.getDay();
  if (d === 0 || d === 6) return false;
  const t = h * 100 + m;
  return t >= 915 && t < 1530;
}

function getDailyCount() {
  const today = new Date().toISOString().slice(0, 10);
  if (config.dailyTradeDate !== today) {
    config.dailyTradeCount = 0;
    config.dailyTradeDate = today;
  }
  return config.dailyTradeCount;
}

function scoreSignal(s, cash, regimeMult) {
  if (s.direction !== 'LONG' || !(s.entry > 0)) return null;
  const entry = s.entry;
  const qty = Math.floor(cash / entry);
  if (qty < 1) return null;
  const targetReturnPct = ((s.target1 - entry) / entry) * 100;
  if (targetReturnPct < config.minReturnPct) return null;
  const regimeBonus = regimeMult > 1 ? 1.2 : regimeMult < 1 ? 0.8 : 1;
  const rrfactor = Math.min(3, s.riskReward);
  const score = targetReturnPct * s.conviction * regimeBonus * rrfactor;
  if (s.mlBoost) score * (1 + s.mlBoost / 20);
  return { ...s, maxQty: qty, returnPct: targetReturnPct, _score: score };
}

function hasPendingForSymbol(orders, symbol) {
  const sym = symbol.includes('.NS') ? symbol : `${symbol}.NS`;
  return orders.some(o => o.tradingsymbol === sym && (o.status === 'open' || o.status === 'pending'));
}

export async function autoTick(rawSignals) {
  if (!config.enabled) return { state: 'disabled', message: 'Auto-trading disabled' };
  if (!angelOneEnabled()) return { state: 'no_angel', message: 'AngelOne not configured' };
  if (!isMarketOpen()) return { state: 'market_closed', message: 'Market closed' };

  try {
    const wallet = await getRMS();
    const cash = parseFloat(wallet?.availablecash || '0');
    const allPositions = (await getPositions()).positions || [];
    const orders = (await getOrderBook()).orders || [];
    const openPos = allPositions.find(p => parseInt(p.netqty) !== 0);
    const pendingOrders = orders.filter(o => o.status === 'open' || o.status === 'pending');

    // Regime-based adjustments
    const regimeMult = config.regimeMultiplier || 1;
    const effectiveMaxTrades = Math.max(1, Math.round(config.maxDailyTrades * regimeMult));
    const effectiveMinReturn = config.minReturnPct * (regimeMult < 1 ? 1.5 : 1);

    // EXIT LOGIC
    if (openPos) {
      const netQty = parseInt(openPos.netqty);
      const buyAvg = parseFloat(openPos.buyavgprice) || 0;
      const ltp = parseFloat(openPos.ltp) || 0;
      const pnlPct = buyAvg > 0 ? ((ltp - buyAvg) / buyAvg) * 100 : 0;

      if (hasPendingForSymbol(orders, openPos.tradingsymbol)) {
        return { state: 'exiting', symbol: openPos.tradingsymbol, pnl: pnlPct, qty: netQty, message: 'Exit order pending' };
      }

      // Target hit with dynamic threshold
      const targetThreshold = regimeMult > 1 ? 0.8 : 1.0;
      if (pnlPct >= targetThreshold && config.currentTrade?.target) {
        const result = await placeOrder({
          symbol: openPos.tradingsymbol, side: 'SELL', orderType: 'LIMIT',
          price: config.currentTrade.target, qty: Math.abs(netQty),
          variety: 'NORMAL', productType: 'DELIVERY', exchange: 'NSE', tag: 'auto_tp',
        });
        config.tradeStats.total++;
        if (pnlPct > 0) config.tradeStats.wins++; else config.tradeStats.losses++;
        config.tradeStats.totalReturn += pnlPct;
        config.lastAction = `TP ${openPos.tradingsymbol} ${pnlPct.toFixed(1)}% @${config.currentTrade.target} ${result.orderId ? '✓' : '✗'}`;
        config.tradeLog.push({ time: Date.now(), type: 'TP', symbol: openPos.tradingsymbol, pnl: pnlPct, price: config.currentTrade.target, orderId: result.orderId || '' });
        config.currentTrade = null;
        return { state: 'exiting_target', symbol: openPos.tradingsymbol, pnl: pnlPct, orderId: result.orderId };
      }

      // Stop loss with dynamic threshold
      const slThreshold = regimeMult < 1 ? -1.2 : -1.5;
      if (pnlPct <= slThreshold && config.currentTrade?.stop) {
        const result = await placeOrder({
          symbol: openPos.tradingsymbol, side: 'SELL', orderType: 'STOPLOSS_LIMIT',
          price: config.currentTrade.stop - 0.05, triggerPrice: config.currentTrade.stop,
          qty: Math.abs(netQty),
          variety: 'NORMAL', productType: 'DELIVERY', exchange: 'NSE', tag: 'auto_sl',
        });
        config.tradeStats.total++;
        config.tradeStats.losses++;
        config.tradeStats.totalReturn += pnlPct;
        config.lastAction = `SL ${openPos.tradingsymbol} ${pnlPct.toFixed(1)}% @${config.currentTrade.stop} ${result.orderId ? '✓' : '✗'}`;
        config.tradeLog.push({ time: Date.now(), type: 'SL', symbol: openPos.tradingsymbol, pnl: pnlPct, price: config.currentTrade.stop, orderId: result.orderId || '' });
        config.currentTrade = null;
        return { state: 'exiting_sl', symbol: openPos.tradingsymbol, pnl: pnlPct, orderId: result.orderId };
      }

      // Trailing stop logic
      if (pnlPct > 2 && config.currentTrade?.entry) {
        const trailActivation = 2;
        const trailDistance = 0.8;
        if (pnlPct > trailActivation) {
          const trailStop = config.currentTrade.entry * (1 + (pnlPct - trailDistance) / 100);
          if (config.currentTrade.trailSL) {
            const newTrail = Math.max(config.currentTrade.trailSL, trailStop);
            if (newTrail > config.currentTrade.trailSL) {
              config.currentTrade.trailSL = newTrail;
              config.lastAction = `Trail SL moved to ${newTrail.toFixed(2)} (PnL: ${pnlPct.toFixed(1)}%)`;
            }
          }
        }
      }

      config.lastState = 'holding';
      return { state: 'holding', symbol: openPos.tradingsymbol, pnl: pnlPct, qty: netQty };
    }

    // ENTRY LOGIC
    if (pendingOrders.length === 0 && cash >= 10) {
      const usedToday = getDailyCount();
      if (usedToday >= effectiveMaxTrades) {
        config.lastState = 'limit_reached';
        return { state: 'limit_reached', message: `Daily limit ${effectiveMaxTrades} reached (regime: ${config.regime})`, used: usedToday };
      }

      const signals = Array.isArray(rawSignals) ? rawSignals : [];
      const scored = signals.map(s => scoreSignal(s, config.maxAmount > 0 ? Math.min(cash, config.maxAmount) : cash, regimeMult)).filter(Boolean);
      scored.sort((a, b) => b._score - a._score);
      const best = scored[0] || null;

      if (best) {
        const result = await placeOrder({
          symbol: best.symbol.includes('.NS') ? best.symbol : `${best.symbol}.NS`,
          side: 'BUY', orderType: 'LIMIT', price: best.entry,
          qty: best.maxQty, variety: 'NORMAL', productType: 'DELIVERY', exchange: 'NSE',
          tag: 'auto_entry',
        });
        config.dailyTradeCount++;
        config.lastAction = `ENTER ${best.symbol} x${best.maxQty} @ ${best.entry} target ${best.returnPct.toFixed(1)}% (${usedToday + 1}/${effectiveMaxTrades}) ${best.regime ? `[${best.regime}]` : ''} ${result.orderId ? '✓' : '✗'}`;
        config.tradeLog.push({ time: Date.now(), type: 'ENTER', symbol: best.symbol, qty: best.maxQty, entry: best.entry, returnPct: best.returnPct, regime: best.regime || '', orderId: result.orderId || '' });
        config.currentTrade = { symbol: best.symbol, qty: best.maxQty, entry: best.entry, target: best.target1, stop: best.stopLoss, trailSL: best.trailSL || best.stopLoss, placedAt: Date.now() };
        config.lastState = 'entered';
        return { state: 'entered', symbol: best.symbol, qty: best.maxQty, entry: best.entry, returnPct: best.returnPct, orderId: result.orderId, dailyUsed: config.dailyTradeCount, dailyMax: effectiveMaxTrades, regime: config.regime };
      }
      config.lastState = 'scanning';
      return { state: 'scanning', message: `No suitable trade found (regime: ${config.regime}, minRet: ${effectiveMinReturn}%)`, signals: signals.length, cash };
    }

    config.lastState = 'waiting';
    const reason = !(pendingOrders.length === 0) ? 'pending orders' : `low cash ₹${cash}`;
    return { state: 'waiting', message: `No action — ${reason}`, cash, pending: pendingOrders.length };
  } catch (e) {
    config.lastAction = `Error: ${e?.message || 'Unknown'}`;
    return { state: 'error', message: e?.message || 'Tick error' };
  }
}
