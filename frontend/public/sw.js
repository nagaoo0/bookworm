// Bookworm service worker.
// - Precaches the app shell so a cold offline launch can still open the app.
// - Navigations: network first, falling back to the cached /index.html.
// - Hashed build assets (/assets/*): cache first (their URLs change with content).
// - /api/* and /.well-known/* are never touched or cached.
const CACHE = 'bookworm-v2';
const PRECACHE = ['/', '/index.html', '/manifest.json', '/logo.png', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      // allSettled: one missing file must not abort the install
      .then(cache => Promise.allSettled(PRECACHE.map(url => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/.well-known/')) return;

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(res => {
          // Keep the offline shell pointing at the latest hashed bundles
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(cache => cache.put('/index.html', copy));
          }
          return res;
        })
        .catch(async () => (await caches.match('/index.html')) ?? Response.error())
    );
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(
      caches.match(req).then(hit => hit ?? fetch(req).then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(cache => cache.put(req, copy));
        }
        return res;
      }))
    );
  }
});
