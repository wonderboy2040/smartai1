import { angelOneEnabled } from './angelone.js';
import { placeOrder, getPositions, getOrderBook, getRMS } from './angelTrade.js';

const config = { enabled: false, maxAmount: 0, minReturnPct: 3, lastAction: '', lastState: 'stopped', currentTrade: null, tradeLog: [] };

export function getAutoConfig() { return { ...config, lastAction: config.lastAction.substring(0, 200), tradeLog: config.tradeLog.slice(-20) }; }

export function setAutoConfig(cfg) {
  if (typeof cfg.enabled === 'boolean') config.enabled = cfg.enabled;
  if (typeof cfg.maxAmount === 'number') config.maxAmount = cfg.maxAmount;
  if (typeof cfg.minReturnPct === 'number') config.minReturnPct = cfg.minReturnPct;
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

function bestAffordable(signals, cash) {
  if (!Array.isArray(signals) || !cash) return null;
  let best = null, bestScore = -1;
  for (const s of signals) {
    if (s.direction !== 'LONG' || !(s.entry > 0)) continue;
    const entry = s.entry, qty = Math.floor(cash / entry);
    if (qty < 10) continue;
    const targetReturnPct = ((s.target1 - entry) / entry) * 100;
    if (targetReturnPct < config.minReturnPct) continue;
    const score = targetReturnPct * s.conviction;
    if (score > bestScore) { bestScore = score; best = { ...s, maxQty: qty, returnPct: targetReturnPct }; }
  }
  return best;
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

    // EXIT LOGIC — check if open position hit target or stop
    if (openPos) {
      const netQty = parseInt(openPos.netqty);
      const buyAvg = parseFloat(openPos.buyavgprice) || 0;
      const ltp = parseFloat(openPos.ltp) || 0;
      const pnlPct = buyAvg > 0 ? ((ltp - buyAvg) / buyAvg) * 100 : 0;

      // Target hit → exit with profit
      if (pnlPct >= 1.0) {
        const result = await placeOrder({
          symbol: openPos.tradingsymbol, side: 'SELL', orderType: 'MARKET',
          qty: Math.abs(netQty), variety: 'NORMAL', productType: 'DELIVERY', exchange: 'NSE',
        });
        config.lastAction = `EXIT ${openPos.tradingsymbol} profit ${pnlPct.toFixed(1)}% ${result.orderId ? '✓' : '✗'}`;
        config.tradeLog.push({ time: Date.now(), type: 'EXIT', symbol: openPos.tradingsymbol, pnl: pnlPct, orderId: result.orderId || '' });
        config.currentTrade = null;
        return { state: 'exited', symbol: openPos.tradingsymbol, pnl: pnlPct, orderId: result.orderId };
      }

      // Stop loss hit → exit
      if (pnlPct <= -2.0) {
        const result = await placeOrder({
          symbol: openPos.tradingsymbol, side: 'SELL', orderType: 'MARKET',
          qty: Math.abs(netQty), variety: 'NORMAL', productType: 'DELIVERY', exchange: 'NSE',
        });
        config.lastAction = `SL HIT ${openPos.tradingsymbol} ${pnlPct.toFixed(1)}% ${result.orderId ? '✓' : '✗'}`;
        config.tradeLog.push({ time: Date.now(), type: 'SL', symbol: openPos.tradingsymbol, pnl: pnlPct, orderId: result.orderId || '' });
        config.currentTrade = null;
        return { state: 'sl_hit', symbol: openPos.tradingsymbol, pnl: pnlPct, orderId: result.orderId };
      }

      config.lastState = 'holding';
      return { state: 'holding', symbol: openPos.tradingsymbol, pnl: pnlPct, qty: netQty };
    }

    // ENTRY LOGIC — no open position, find best signal
    if (!openPos && pendingOrders.length === 0 && cash >= 50) {
      const signals = Array.isArray(rawSignals) ? rawSignals : [];
      const best = bestAffordable(signals, config.maxAmount > 0 ? Math.min(cash, config.maxAmount) : cash);
      if (best) {
        const result = await placeOrder({
          symbol: best.symbol.includes('.NS') ? best.symbol : `${best.symbol}.NS`,
          side: 'BUY', orderType: 'LIMIT', price: best.entry,
          qty: best.maxQty, variety: 'NORMAL', productType: 'DELIVERY', exchange: 'NSE',
        });
        config.lastAction = `ENTER ${best.symbol} x${best.maxQty} @ ${best.entry} target ${best.returnPct.toFixed(1)}% ${result.orderId ? '✓' : '✗'}`;
        config.tradeLog.push({ time: Date.now(), type: 'ENTER', symbol: best.symbol, qty: best.maxQty, entry: best.entry, returnPct: best.returnPct, orderId: result.orderId || '' });
        config.currentTrade = { symbol: best.symbol, qty: best.maxQty, entry: best.entry, target: best.target1, stop: best.stopLoss, placedAt: Date.now() };
        config.lastState = 'entered';
        return { state: 'entered', symbol: best.symbol, qty: best.maxQty, entry: best.entry, returnPct: best.returnPct, orderId: result.orderId };
      }
      config.lastState = 'scanning';
      return { state: 'scanning', message: 'No suitable trade found', signals: signals.length, cash };
    }

    config.lastState = 'waiting';
    return { state: 'waiting', message: 'No action' };
  } catch (e) {
    config.lastAction = `Error: ${e?.message || 'Unknown'}`;
    return { state: 'error', message: e?.message || 'Tick error' };
  }
}
