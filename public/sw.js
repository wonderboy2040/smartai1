/* ============================================================
 * Wealth AI Pro — Service Worker v2
 * ------------------------------------------------------------
 * PWA app shell + offline cache + background price monitoring
 * ============================================================
 * Features:
 *  1. App shell caching (offline support)
 *  2. Periodic Background Sync — fetches portfolio prices every 15 min
 *  3. Push notifications — sends price summary to home screen
 *  4. App icon badge — shows today's P&L % on app icon
 *  5. Widget data endpoint — cached prices for instant widget render
 * ============================================================ */

const CACHE_VERSION = 'wealth-ai-v2';
const SHELL = ['/', '/index.html', '/manifest.json', '/icon.svg'];
const WIDGET_CACHE = 'wealth-ai-widget-data';

// ============================================================
// INSTALL — cache app shell
// ============================================================
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

// ============================================================
// ACTIVATE — clean old caches, claim clients
// ============================================================
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_VERSION && k !== WIDGET_CACHE)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'WIDGET_DATA_UPDATE') {
    // Store widget data for the widget page to read
    caches.open(WIDGET_CACHE).then((cache) => {
      const resp = new Response(JSON.stringify(event.data.payload), {
        headers: { 'Content-Type': 'application/json' },
      });
      cache.put('/widget-data.json', resp);
    });
  }
});

// ============================================================
// FETCH — caching strategy
// ============================================================
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Widget data — serve from cache (instant), update in background
  if (req.url.includes('/widget-data.json')) {
    event.respondWith(
      caches.open(WIDGET_CACHE).then(async (cache) => {
        const cached = await cache.match('/widget-data.json');
        return cached || new Response('{}', { headers: { 'Content-Type': 'application/json' } });
      })
    );
    return;
  }

  // App navigation → network-first, fall back to cached shell
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put('/index.html', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('/index.html').then((r) => r || new Response('Offline', { status: 503 })))
    );
    return;
  }

  // Static assets → stale-while-revalidate
  event.respondWith(
    caches.open(CACHE_VERSION).then(async (cache) => {
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(req, res.clone()).catch(() => {});
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

// ============================================================
// PERIODIC BACKGROUND SYNC — fetch portfolio prices every 15 min
// ============================================================
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'wealth-ai-price-sync') {
    event.waitUntil(fetchPortfolioPricesInBackground());
  }
});

// ============================================================
// Background price fetcher — runs even when app is closed
// ============================================================
async function fetchPortfolioPricesInBackground() {
  try {
    // Get the auth token from all clients
    const clients = await self.clients.matchAll({ includeUncontrolled: true });
    let authToken = null;

    for (const client of clients) {
      // Ask the client for its auth token
      const channel = new MessageChannel();
      const tokenPromise = new Promise((resolve) => {
        channel.port1.onmessage = (e) => resolve(e.data?.token || null);
        setTimeout(() => resolve(null), 3000);
      });
      client.postMessage({ type: 'GET_AUTH_TOKEN' }, [channel.port2]);
      authToken = await tokenPromise;
      if (authToken) break;
    }

    if (!authToken) {
      // Try to get token from cache
      const cache = await caches.open(WIDGET_CACHE);
      const tokenResp = await cache.match('/auth-token');
      if (tokenResp) {
        authToken = await tokenResp.text();
      }
    }

    if (!authToken) return;

    // Determine the backend URL
    const backendUrl = self.location.origin;

    // Fetch portfolio from cloud sync
    const portfolioResp = await fetch(`${backendUrl}/api/cloud/load`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!portfolioResp.ok) return;
    const portfolioData = await portfolioResp.json();
    const portfolio = portfolioData.portfolio || [];
    if (portfolio.length === 0) return;

    // Group symbols by market
    const inSymbols = [...new Set(portfolio.filter(p => p.market === 'IN' && !isCrypto(p.symbol)).map(p => p.symbol))].slice(0, 20);
    const usSymbols = [...new Set(portfolio.filter(p => p.market === 'US').map(p => p.symbol))].slice(0, 20);
    const cryptoSymbols = [...new Set(portfolio.filter(p => isCrypto(p.symbol)).map(p => p.symbol))];

    // Fetch all prices in parallel
    const [inResp, usResp, cryptoResp, forexResp] = await Promise.allSettled([
      inSymbols.length > 0 ? fetch(`${backendUrl}/api/quote?symbols=${inSymbols.join(',')}&market=IN`, {
        headers: { Authorization: `Bearer ${authToken}` },
      }) : Promise.resolve(null),
      usSymbols.length > 0 ? fetch(`${backendUrl}/api/quote?symbols=${usSymbols.join(',')}&market=US`, {
        headers: { Authorization: `Bearer ${authToken}` },
      }) : Promise.resolve(null),
      fetch(`${backendUrl}/api/crypto-prices?t=${Date.now()}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      }),
      fetch(`${backendUrl}/api/forex?t=${Date.now()}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      }),
    ]);

    // Process prices
    const prices = {};
    let usdInr = 85.5;

    if (forexResp.status === 'fulfilled' && forexResp.value?.ok) {
      const f = await forexResp.value.json();
      usdInr = f.usdInr || usdInr;
    }

    if (inResp.status === 'fulfilled' && inResp.value?.ok) {
      const d = await inResp.value.json();
      if (d.quotes) {
        for (const [sym, q] of Object.entries(d.quotes)) {
          prices[`IN_${sym}`] = { price: q.price, change: q.change, prevClose: q.prevClose };
        }
      }
    }

    if (usResp.status === 'fulfilled' && usResp.value?.ok) {
      const d = await usResp.value.json();
      if (d.quotes) {
        for (const [sym, q] of Object.entries(d.quotes)) {
          prices[`US_${sym}`] = { price: q.price, change: q.change, prevClose: q.prevClose };
        }
      }
    }

    if (cryptoResp.status === 'fulfilled' && cryptoResp.value?.ok) {
      const tickers = await cryptoResp.value.json();
      if (Array.isArray(tickers)) {
        for (const t of tickers) {
          const sym = t.market?.replace('USDT', '').replace('INR', '');
          if (cryptoSymbols.includes(sym)) {
            const price = parseFloat(t.last_price) * usdInr;
            const change = parseFloat(t.change_24_hour) || 0;
            prices[`IN_${sym}`] = { price, change, prevClose: price / (1 + change / 100) };
          }
        }
      }
    }

    // Calculate portfolio summary
    let totalValue = 0;
    let totalPrevValue = 0;
    let todayPL = 0;
    let todayPLPct = 0;

    for (const pos of portfolio) {
      const key = `${pos.market}_${pos.symbol}`;
      const p = prices[key];
      if (p) {
        const value = p.price * pos.qty;
        const prevValue = (p.prevClose || p.price) * pos.qty;
        totalValue += value;
        totalPrevValue += prevValue;
        todayPL += value - prevValue;
      } else {
        totalValue += pos.avgPrice * pos.qty;
        totalPrevValue += pos.avgPrice * pos.qty;
      }
    }

    todayPLPct = totalPrevValue > 0 ? (todayPL / totalPrevValue) * 100 : 0;

    // Build widget data
    const widgetData = {
      portfolio: portfolio.map(p => {
        const key = `${p.market}_${p.symbol}`;
        const price = prices[key];
        return {
          symbol: p.symbol,
          market: p.market,
          qty: p.qty,
          price: price?.price || p.avgPrice,
          change: price?.change || 0,
          value: (price?.price || p.avgPrice) * p.qty,
        };
      }),
      summary: {
        totalValue,
        todayPL,
        todayPLPct,
        usdInr,
        assetCount: portfolio.length,
      },
      timestamp: Date.now(),
    };

    // Cache widget data
    const cache = await caches.open(WIDGET_CACHE);
    const resp = new Response(JSON.stringify(widgetData), {
      headers: { 'Content-Type': 'application/json' },
    });
    await cache.put('/widget-data.json', resp);

    // Update app icon badge with today's P&L %
    if ('setAppBadge' in navigator) {
      try {
        const badgeNum = Math.round(Math.abs(todayPLPct));
        if (badgeNum > 0) {
          await navigator.setAppBadge(badgeNum);
        } else {
          await navigator.clearAppBadge();
        }
      } catch (e) { /* badge not supported */ }
    }

    // Send notification with portfolio summary
    if (Notification.permission === 'granted') {
      const trend = todayPL >= 0 ? '📈' : '📉';
      const plStr = `${todayPL >= 0 ? '+' : ''}₹${Math.abs(todayPL).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
      const pctStr = `${todayPLPct >= 0 ? '+' : ''}${todayPLPct.toFixed(2)}%`;

      const title = `${trend} Wealth AI: ${plStr} (${pctStr})`;
      const body = `Equity: ₹${totalValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}\n` +
        `Assets: ${portfolio.length} • USD/INR: ₹${usdInr.toFixed(2)}\n` +
        `Tap to view details`;

      await self.registration.showNotification(title, {
        body,
        icon: '/icon.svg',
        badge: '/icon.svg',
        tag: 'wealth-ai-price-update',
        renotify: true,
        data: { url: '/' },
        silent: false,
        vibrate: [100, 50, 100],
      });
    }

    // Notify all open clients to update their UI
    const allClients = await self.clients.matchAll({ includeUncontrolled: true });
    for (const client of allClients) {
      client.postMessage({ type: 'PRICE_UPDATE', data: widgetData });
    }

    console.log('[SW] Background price sync complete:', widgetData.summary);
  } catch (e) {
    console.error('[SW] Background price sync failed:', e?.message || e);
  }
}

function isCrypto(sym) {
  return ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'AVAX', 'DOT', 'MATIC', 'LINK', 'UNI'].includes(sym?.toUpperCase());
}

// ============================================================
// NOTIFICATION CLICK — open the app
// ============================================================
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Focus existing window if open
      for (const client of clients) {
        if ('focus' in client) return client.focus();
      }
      // Open new window
      if (self.clients.openWindow) {
        return self.clients.openWindow(event.notification.data?.url || '/');
      }
    })
  );
});

// ============================================================
// PUSH — handle push notifications (for server-triggered alerts)
// ============================================================
self.addEventListener('push', (event) => {
  let data = { title: 'Wealth AI Alert', body: '' };
  try {
    if (event.data) data = event.data.json();
  } catch { if (event.data) data.body = event.data.text(); }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon.svg',
      badge: '/icon.svg',
      tag: data.tag || 'wealth-ai-push',
      data: { url: data.url || '/' },
    })
  );
});
