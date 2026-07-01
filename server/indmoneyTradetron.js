// ============================================================
// INDMoney Algo Trading via Tradetron
// ------------------------------------------------------------
// Sends algo signals from our AI engine to Tradetron's webhook
// API. Tradetron then routes orders to the user's INDMoney
// broker account (connected via access token on Tradetron).
//
// Flow: AI Signal → Tradetron Webhook → INDMoney order execution
//
// Env vars (set in Render / .env):
//   TRADETRON_API_KEY     — your Tradetron API key
//   TRADETRON_STRATEGY_ID — the strategy ID to execute on
//   INDMONEY_ACCESS_TOKEN — your INDMoney access token (for status display)
//
// Benefits over direct broker API:
//   • No static IP required (Tradetron handles IP whitelisting)
//   • Strategy backtesting built-in on Tradetron
//   • Paper trading mode available
//   • Multi-leg order support
// ============================================================

const TRADETRON_BASE = 'https://tradetron.tech/api';

const CFG = {
  apiKey: process.env.TRADETRON_API_KEY || '',
  strategyId: process.env.TRADETRON_STRATEGY_ID || '',
  indmoneyToken: process.env.INDMONEY_ACCESS_TOKEN || '',
};

export function indmoneyEnabled() {
  return !!(CFG.apiKey && CFG.strategyId);
}

export function getIndmoneyStatus() {
  return {
    tradetronConnected: !!CFG.apiKey,
    strategyConfigured: !!CFG.strategyId,
    indmoneyLinked: !!CFG.indmoneyToken,
    enabled: indmoneyEnabled(),
  };
}

// ------------------------------------------------------------
// Tradetron Webhook — trigger strategy execution
// This sends a signal to Tradetron which then places the order
// on INDMoney via the pre-configured broker connection.
// ------------------------------------------------------------
export async function executeTradetronSignal(params) {
  if (!indmoneyEnabled()) return { error: 'Tradetron/INDMoney not configured' };
  try {
    const payload = {
      auth_token: CFG.apiKey,
      strategy_id: CFG.strategyId,
      transaction_type: params.side?.toUpperCase() || 'BUY', // BUY | SELL
      instrument: params.symbol || '',
      exchange: params.exchange || 'NSE',
      order_type: params.orderType || 'LIMIT', // MARKET | LIMIT | SL | SL-M
      product_type: params.productType || 'MIS', // MIS (intraday) | CNC (delivery) | NRML
      quantity: params.qty || 1,
      price: params.price || 0,
      trigger_price: params.triggerPrice || 0,
      disclosed_quantity: 0,
      validity: 'DAY',
      tag: params.tag || 'smartai_algo',
    };

    const r = await fetch(`${TRADETRON_BASE}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
    const j = await r.json();

    if (j?.status === 'success' || j?.message?.includes('success')) {
      return {
        orderId: j.order_id || j.id || `TT-${Date.now()}`,
        message: j.message || 'Order routed via Tradetron → INDMoney',
        status: 'success',
      };
    }
    return { error: j?.message || j?.error || 'Tradetron order failed' };
  } catch (e) {
    return { error: e?.message || 'Tradetron execution error' };
  }
}

// Deploy a strategy on Tradetron
export async function deployStrategy(params) {
  if (!indmoneyEnabled()) return { error: 'Tradetron/INDMoney not configured' };
  try {
    const r = await fetch(`${TRADETRON_BASE}/strategy/deploy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CFG.apiKey}`,
      },
      body: JSON.stringify({
        strategy_id: CFG.strategyId,
        multiplier: params.multiplier || 1,
        ...params,
      }),
      signal: AbortSignal.timeout(10000),
    });
    const j = await r.json();
    return j?.status === 'success' ? { message: 'Strategy deployed', ...j } : { error: j?.message || 'Deploy failed' };
  } catch (e) {
    return { error: e?.message || 'Deploy error' };
  }
}

// Pause/resume strategy
export async function toggleStrategy(action) {
  if (!indmoneyEnabled()) return { error: 'Tradetron/INDMoney not configured' };
  try {
    const endpoint = action === 'pause' ? 'strategy/pause' : 'strategy/resume';
    const r = await fetch(`${TRADETRON_BASE}/${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CFG.apiKey}`,
      },
      body: JSON.stringify({ strategy_id: CFG.strategyId }),
      signal: AbortSignal.timeout(10000),
    });
    const j = await r.json();
    return j?.status === 'success' ? { message: `Strategy ${action}d`, ...j } : { error: j?.message || `${action} failed` };
  } catch (e) {
    return { error: e?.message || `${action} error` };
  }
}

// Get strategy PnL and execution history
export async function getStrategyStatus() {
  if (!indmoneyEnabled()) return { error: 'Tradetron/INDMoney not configured' };
  try {
    const r = await fetch(`${TRADETRON_BASE}/strategy/status?strategy_id=${CFG.strategyId}`, {
      headers: { 'Authorization': `Bearer ${CFG.apiKey}` },
      signal: AbortSignal.timeout(10000),
    });
    const j = await r.json();
    return j || {};
  } catch (e) {
    return { error: e?.message || 'Status fetch error' };
  }
}

// Get trade history from Tradetron
export async function getTradeHistory() {
  if (!indmoneyEnabled()) return { trades: [] };
  try {
    const r = await fetch(`${TRADETRON_BASE}/strategy/trades?strategy_id=${CFG.strategyId}`, {
      headers: { 'Authorization': `Bearer ${CFG.apiKey}` },
      signal: AbortSignal.timeout(10000),
    });
    const j = await r.json();
    return { trades: Array.isArray(j?.data) ? j.data : [] };
  } catch {
    return { trades: [] };
  }
}

// Get portfolio/positions from Tradetron
export async function getPositions() {
  if (!indmoneyEnabled()) return { positions: [] };
  try {
    const r = await fetch(`${TRADETRON_BASE}/strategy/positions?strategy_id=${CFG.strategyId}`, {
      headers: { 'Authorization': `Bearer ${CFG.apiKey}` },
      signal: AbortSignal.timeout(10000),
    });
    const j = await r.json();
    return { positions: Array.isArray(j?.data) ? j.data : [] };
  } catch {
    return { positions: [] };
  }
}
