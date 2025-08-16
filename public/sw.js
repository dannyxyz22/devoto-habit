const CACHE_NAME = 'leitura-devota-v1';
// Use relative paths so the SW works under GitHub Pages project base
const urlsToCache = [
  './',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// Install service worker
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(urlsToCache))
  );
});

// Fetch event - serve from cache when offline
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // For navigation requests, try network first, then cache fallback (SPA)
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('./'))
    );
    return;
  }

  // For other requests, cache-first then network
  event.respondWith(
    caches.match(req).then((res) => res || fetch(req))
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});