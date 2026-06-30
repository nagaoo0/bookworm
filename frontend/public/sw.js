// Minimal service worker — required for TWA to hide the browser address bar
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));

// Network-first for navigation; everything else (API, assets) passes through untouched
self.addEventListener('fetch', e => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(
    fetch(e.request).catch(() => caches.match('/index.html'))
  );
});
