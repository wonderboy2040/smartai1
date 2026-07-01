// ============================================================
// CoinDCX Futures Trading API
// ------------------------------------------------------------
// Provides crypto futures trading on CoinDCX for Indian users.
// Supports up to 100x leverage, 150+ crypto pairs, 24/7 trading.
//
// Auth: HMAC-SHA256 (API key + secret)
// Env vars:
//   COINDCX_API_KEY    — CoinDCX API key
//   COINDCX_API_SECRET — CoinDCX API secret
//
// Base URL: https://api.coindcx.com
// ============================================================
import crypto from 'node:crypto';

const BASE = 'https://api.coindcx.com';

const KEY    = process.env.COINDCX_API_KEY || '';
const SECRET = process.env.COINDCX_API_SECRET || '';

export function coindcxEnabled() {
  return !!(KEY && SECRET);
}

export function getCoindcxStatus() {
  return {
    enabled: coindcxEnabled(),
    hasKey: !!KEY,
    hasSecret: !!SECRET,
  };
}

function sign(payload) {
  const body = JSON.stringify(payload);
  const signature = crypto
    .createHmac('sha256', SECRET)
    .update(body)
    .digest('hex');
  return { body, signature };
}

function authHeaders(signature) {
  return {
    'Content-Type': 'application/json',
    'X-AUTH-APIKEY': KEY,
    'X-AUTH-SIGNATURE': signature,
  };
}

// ============================================================
// FUTURES — Place Order
// ============================================================
export async function placeFuturesOrder(params) {
  if (!coindcxEnabled()) return { error: 'CoinDCX not configured — API key/secret required' };
  try {
    const payload = {
      side: params.side?.toLowerCase() || 'buy', // buy | sell
      order_type: params.orderType?.toLowerCase() || 'limit_order', // limit_order | market_order
      market: params.market || 'B-BTC_USDT', // CoinDCX futures market pair
      price_per_unit: params.price || 0,
      total_quantity: params.qty || 0,
      leverage: params.leverage || 1,
      timestamp: Date.now(),
    };

    if (params.stopPrice) payload.stop_price = params.stopPrice;
    if (params.takeProfit) payload.take_profit = params.takeProfit;

    const { body, signature } = sign(payload);
    const r = await fetch(`${BASE}/exchange/v1/futures/create`, {
      method: 'POST',
      headers: authHeaders(signature),
      body,
      signal: AbortSignal.timeout(10000),
    });
    const j = await r.json();
    if (j?.id || j?.order_id) {
      return {
        orderId: j.id || j.order_id,
        message: `Futures ${params.side} order placed`,
        status: 'success',
      };
    }
    return { error: j?.message || j?.error || 'Futures order failed' };
  } catch (e) {
    return { error: e?.message || 'Futures order error' };
  }
}

// ============================================================
// FUTURES — Cancel Order
// ============================================================
export async function cancelFuturesOrder(orderId) {
  if (!coindcxEnabled()) return { error: 'CoinDCX not configured' };
  try {
    const payload = { id: orderId, timestamp: Date.now() };
    const { body, signature } = sign(payload);
    const r = await fetch(`${BASE}/exchange/v1/futures/cancel`, {
      method: 'POST',
      headers: authHeaders(signature),
      body,
      signal: AbortSignal.timeout(8000),
    });
    const j = await r.json();
    return j?.message?.includes('success') || j?.status === 200
      ? { message: 'Futures order cancelled' }
      : { error: j?.message || 'Cancel failed' };
  } catch (e) {
    return { error: e?.message || 'Cancel error' };
  }
}

// ============================================================
// FUTURES — Get Open Orders
// ============================================================
export async function getFuturesOrders() {
  if (!coindcxEnabled()) return { orders: [] };
  try {
    const payload = { timestamp: Date.now() };
    const { body, signature } = sign(payload);
    const r = await fetch(`${BASE}/exchange/v1/futures/orders`, {
      method: 'POST',
      headers: authHeaders(signature),
      body,
      signal: AbortSignal.timeout(8000),
    });
    const j = await r.json();
    return { orders: Array.isArray(j) ? j : (j?.orders || []) };
  } catch {
    return { orders: [] };
  }
}

// ============================================================
// FUTURES — Get Active Positions
// ============================================================
export async function getFuturesPositions() {
  if (!coindcxEnabled()) return { positions: [] };
  try {
    const payload = { timestamp: Date.now() };
    const { body, signature } = sign(payload);
    const r = await fetch(`${BASE}/exchange/v1/futures/positions`, {
      method: 'POST',
      headers: authHeaders(signature),
      body,
      signal: AbortSignal.timeout(8000),
    });
    const j = await r.json();
    return { positions: Array.isArray(j) ? j : (j?.positions || []) };
  } catch {
    return { positions: [] };
  }
}

// ============================================================
// FUTURES — Get Account Balance
// ============================================================
export async function getFuturesBalance() {
  if (!coindcxEnabled()) return { balance: null };
  try {
    const payload = { timestamp: Date.now() };
    const { body, signature } = sign(payload);
    const r = await fetch(`${BASE}/exchange/v1/users/balances`, {
      method: 'POST',
      headers: authHeaders(signature),
      body,
      signal: AbortSignal.timeout(8000),
    });
    const j = await r.json();
    // Find USDT or INR balance
    const balances = Array.isArray(j) ? j : [];
    const usdt = balances.find(b => b.currency === 'USDT' || b.currency === 'usdt');
    const inr = balances.find(b => b.currency === 'INR' || b.currency === 'inr');
    return {
      balance: {
        usdt: usdt ? parseFloat(usdt.balance || '0') : 0,
        inr: inr ? parseFloat(inr.balance || '0') : 0,
        all: balances,
      },
    };
  } catch {
    return { balance: null };
  }
}

// ============================================================
// FUTURES — Get Trade History
// ============================================================
export async function getFuturesTradeHistory() {
  if (!coindcxEnabled()) return { trades: [] };
  try {
    const payload = { timestamp: Date.now() };
    const { body, signature } = sign(payload);
    const r = await fetch(`${BASE}/exchange/v1/futures/fills`, {
      method: 'POST',
      headers: authHeaders(signature),
      body,
      signal: AbortSignal.timeout(8000),
    });
    const j = await r.json();
    return { trades: Array.isArray(j) ? j : (j?.trades || []) };
  } catch {
    return { trades: [] };
  }
}

// ============================================================
// FUTURES — Available Markets (public, no auth)
// ============================================================
let _marketsCache = { data: null, ts: 0 };
export async function getFuturesMarkets() {
  const now = Date.now();
  if (_marketsCache.data && (now - _marketsCache.ts) < 300000) return _marketsCache.data;
  try {
    const r = await fetch(`${BASE}/exchange/v1/futures/markets`, {
      signal: AbortSignal.timeout(8000),
    });
    const j = await r.json();
    const markets = Array.isArray(j) ? j : [];
    _marketsCache = { data: markets, ts: now };
    return markets;
  } catch {
    return _marketsCache.data || [];
  }
}

// Top crypto picks for futures trading (high volume, good volatility)
export const TOP_CRYPTO_FUTURES = [
  { symbol: 'BTC', market: 'B-BTC_USDT', name: 'Bitcoin', minLeverage: 1, maxLeverage: 100 },
  { symbol: 'ETH', market: 'B-ETH_USDT', name: 'Ethereum', minLeverage: 1, maxLeverage: 75 },
  { symbol: 'SOL', market: 'B-SOL_USDT', name: 'Solana', minLeverage: 1, maxLeverage: 50 },
  { symbol: 'BNB', market: 'B-BNB_USDT', name: 'BNB', minLeverage: 1, maxLeverage: 50 },
  { symbol: 'XRP', market: 'B-XRP_USDT', name: 'XRP', minLeverage: 1, maxLeverage: 50 },
  { symbol: 'DOGE', market: 'B-DOGE_USDT', name: 'Dogecoin', minLeverage: 1, maxLeverage: 50 },
  { symbol: 'AVAX', market: 'B-AVAX_USDT', name: 'Avalanche', minLeverage: 1, maxLeverage: 50 },
  { symbol: 'ADA', market: 'B-ADA_USDT', name: 'Cardano', minLeverage: 1, maxLeverage: 50 },
  { symbol: 'LINK', market: 'B-LINK_USDT', name: 'Chainlink', minLeverage: 1, maxLeverage: 50 },
  { symbol: 'DOT', market: 'B-DOT_USDT', name: 'Polkadot', minLeverage: 1, maxLeverage: 50 },
];
