import { getSession, angelOneEnabled } from './angelone.js';

const BASE = 'https://apiconnect.angelone.in';

function baseHeaders(jwt) {
  return {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Authorization': `Bearer ${jwt}`,
    'X-PrivateKey': process.env.SMARTAPI_KEY || '',
  };
}

// Place an order: BUY or SELL, LIMIT/MARKET/SLM, with optional SL & target
export async function placeOrder(params) {
  if (!angelOneEnabled()) return { error: 'AngelOne not configured' };
  try {
    const session = await getSession();
    const { jwt } = session;
    const body = {
      variety: params.variety || 'NORMAL',
      tradingsymbol: params.symbol,
      symboltoken: params.token || '',
      exchange: params.exchange || 'NSE',
      transactiontype: params.side.toUpperCase(), // BUY | SELL
      ordertype: params.orderType.toUpperCase(),  // MARKET | LIMIT | STOPLOSS_LIMIT | STOPLOSS_MARKET
      producttype: params.productType || 'DELIVERY', // DELIVERY | INTRADAY | CNC
      duration: 'DAY',
      price: params.price || 0,
      quantity: params.qty,
      squareoff: params.target || 0,
      stoploss: params.stopLoss || 0,
    };
    const r = await fetch(`${BASE}/rest/secure/angelbroking/order/v1/placeOrder`, {
      method: 'POST',
      headers: baseHeaders(jwt),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    const j = await r.json();
    if (j?.status !== true) return { error: j?.message || j?.error?.message || 'Order placement failed' };
    return {
      orderId: j.data?.orderid || j.data?.uniqueorderid || '',
      message: j.message || 'Order placed',
    };
  } catch (e) {
    return { error: e?.message || 'Order placement error' };
  }
}

export async function cancelOrder(orderId) {
  if (!angelOneEnabled()) return { error: 'AngelOne not configured' };
  try {
    const session = await getSession();
    const { jwt } = session;
    const r = await fetch(`${BASE}/rest/secure/angelbroking/order/v1/cancelOrder`, {
      method: 'POST',
      headers: baseHeaders(jwt),
      body: JSON.stringify({ variety: 'NORMAL', orderid: orderId }),
      signal: AbortSignal.timeout(8000),
    });
    const j = await r.json();
    if (j?.status !== true) return { error: j?.message || 'Cancel failed' };
    return { message: j.message || 'Order cancelled' };
  } catch (e) {
    return { error: e?.message || 'Cancel error' };
  }
}

export async function getOrderBook() {
  if (!angelOneEnabled()) return { error: 'AngelOne not configured' };
  try {
    const session = await getSession();
    const { jwt } = session;
    const r = await fetch(`${BASE}/rest/secure/angelbroking/order/v1/getOrderBook`, {
      method: 'GET',
      headers: baseHeaders(jwt),
      signal: AbortSignal.timeout(8000),
    });
    const j = await r.json();
    if (j?.status !== true) return { orders: [] };
    return { orders: Array.isArray(j.data) ? j.data : [] };
  } catch {
    return { orders: [] };
  }
}

export async function getTradeBook() {
  if (!angelOneEnabled()) return { error: 'AngelOne not configured' };
  try {
    const session = await getSession();
    const { jwt } = session;
    const r = await fetch(`${BASE}/rest/secure/angelbroking/order/v1/tradeBook`, {
      method: 'GET',
      headers: baseHeaders(jwt),
      signal: AbortSignal.timeout(8000),
    });
    const j = await r.json();
    if (j?.status !== true) return { trades: [] };
    return { trades: Array.isArray(j.data) ? j.data : [] };
  } catch {
    return { trades: [] };
  }
}

export async function getHoldings() {
  if (!angelOneEnabled()) return { error: 'AngelOne not configured' };
  try {
    const session = await getSession();
    const { jwt } = session;
    const r = await fetch(`${BASE}/rest/secure/angelbroking/portfolio/v1/getAllHolding`, {
      method: 'GET',
      headers: baseHeaders(jwt),
      signal: AbortSignal.timeout(8000),
    });
    const j = await r.json();
    if (j?.status !== true) return { holdings: [] };
    return { holdings: Array.isArray(j.data) ? j.data : [] };
  } catch {
    return { holdings: [] };
  }
}

export async function getPositions() {
  if (!angelOneEnabled()) return { error: 'AngelOne not configured' };
  try {
    const session = await getSession();
    const { jwt } = session;
    const r = await fetch(`${BASE}/rest/secure/angelbroking/portfolio/v1/getPosition`, {
      method: 'GET',
      headers: baseHeaders(jwt),
      signal: AbortSignal.timeout(8000),
    });
    const j = await r.json();
    if (j?.status !== true) return { positions: [] };
    return { positions: Array.isArray(j.data) ? j.data : [] };
  } catch {
    return { positions: [] };
  }
}

export async function getRMS() {
  if (!angelOneEnabled()) return { error: 'AngelOne not configured' };
  try {
    const session = await getSession();
    const { jwt } = session;
    const r = await fetch(`${BASE}/rest/secure/angelbroking/portfolio/v1/getRMS`, {
      method: 'GET',
      headers: baseHeaders(jwt),
      signal: AbortSignal.timeout(8000),
    });
    const j = await r.json();
    if (j?.status !== true) return {};
    return j.data || {};
  } catch {
    return {};
  }
}
