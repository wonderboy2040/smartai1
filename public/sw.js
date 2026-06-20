/* Wealth AI — Service Worker
 * Provides an installable PWA + offline app shell.
 * Strategy:
 *  - Navigation requests: network-first (so fresh deploys load), fall back to
 *    cached index.html when offline.
 *  - Same-origin static assets (JS/CSS/fonts/icons): stale-while-revalidate.
 *  - Cross-origin + non-GET (APIs, Telegram, TradingView, etc.): passthrough,
 *    never cached — live market data must stay live.
 * The user's portfolio/alerts persist in localStorage, so opening the app
 * offline still shows the last-known data.
 */
const CACHE_VERSION = 'wealth-ai-v1';
const SHELL = ['/', '/index.html', '/manifest.json', '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Only handle same-origin requests; let APIs / external streams go to network.
  if (url.origin !== self.location.origin) return;

  // App navigation → network-first, fall back to cached shell offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put('/index.html', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('/index.html').then((r) => r || caches.match('/')))
    );
    return;
  }

  // Static assets → stale-while-revalidate.
  if (/\.(?:js|css|svg|png|jpg|jpeg|webp|ico|woff2?|ttf)$/.test(url.pathname)) {
    event.respondWith(
      caches.open(CACHE_VERSION).then(async (cache) => {
        const cached = await cache.match(req);
        const network = fetch(req)
          .then((res) => {
            if (res && res.status === 200) cache.put(req, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
  }
});
