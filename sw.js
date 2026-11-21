/* Offline AI Stack — service worker
 *
 * Strategy: precache every page and asset on first visit, then serve
 * cache-first and refresh the cache from the network in the background
 * (stale-while-revalidate). All CSS, JS, fonts (system fonts) and images
 * are inline in the HTML pages, so caching the pages caches everything.
 *
 * Content updates need no change here: the background refresh picks up a
 * new index.html on the next visit and tells open tabs a new version is
 * ready. Bump VERSION only when the PRECACHE list itself changes.
 */
const VERSION = '2026-11-21.1';
const CACHE = 'aotl-' + VERSION;
const PRECACHE = [
  '/',
  '/about.html',
  '/contact.html',
  '/privacy.html',
  '/affiliate-disclosure.html',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/favicon-32.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // 'no-cache' revalidates with the server (a cheap 304 when the browser
    // already holds the file from this visit) instead of downloading again.
    await Promise.all(PRECACHE.map(async (path) => {
      const res = await fetch(new Request(path, { cache: 'no-cache' }));
      if (!res.ok) throw new Error('Precache failed for ' + path + ' (' + res.status + ')');
      await cache.put(path, res);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('aotl-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
    await notify({ type: 'OFFLINE_READY', version: VERSION });
  })());
});

// Every same-origin URL maps to one cache key: query strings and hashes are
// ignored (so shared links like /?b=… still open offline) and /index.html is /.
function keyFor(url) {
  const path = url.pathname === '/index.html' ? '/' : url.pathname;
  return path;
}

// A cheap fingerprint so the 13 MB page is only rewritten when it changed.
function signature(res) {
  return res.headers.get('etag') || ((res.headers.get('last-modified') || '') + '|' + (res.headers.get('content-length') || ''));
}

async function notify(message) {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  windows.forEach((client) => client.postMessage(message));
}

async function refresh(cache, key, cached) {
  const res = await fetch(key, { cache: 'no-cache', credentials: 'same-origin' });
  if (res.ok && res.type === 'basic') {
    const fresh = signature(res);
    const unknown = fresh === '|';
    if (!cached || unknown || fresh !== signature(cached)) {
      await cache.put(key, res.clone());
      if (cached && !unknown && key === '/') await notify({ type: 'UPDATED', path: key });
    }
  }
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Stores, maker sites and anything else off-site go straight to the
  // network; the page itself shows a "needs internet" state for those.
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/sw.js') return;

  const key = keyFor(url);
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(key);
    const network = refresh(cache, key, cached);
    if (cached) {
      event.waitUntil(network.catch(() => {}));
      return cached;
    }
    try {
      return await network;
    } catch (err) {
      if (req.mode === 'navigate') {
        const home = await cache.match('/');
        if (home) return home;
      }
      return new Response('You are offline and this page has not been saved yet.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }
  })());
});

// The page asks whether everything is saved before it shows the badge.
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type !== 'STATUS' || !event.ports[0]) return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const missing = [];
    for (const path of PRECACHE) {
      if (!(await cache.match(path))) missing.push(path);
    }
    event.ports[0].postMessage({ ready: missing.length === 0, missing, version: VERSION });
  })());
});
