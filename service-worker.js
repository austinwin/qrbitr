const CACHE_NAME = 'qr-bitr-v1.1';  // Add versioning
// NOTE: Increment CACHE_NAME when deploying new versions to force cache update.
//8-1-2025: release v1.1 - force to auto-update
const FILES_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/app.js',
  './js/modules/decode.js',
  './js/modules/encode.js',
  './js/modules/storage.js',
  './js/components/SendComponent.js',
  './js/components/ReceiveComponent.js',
  './js/utils.js',
  './js/vue.global.prod.js',
  './js/qrcode.min.js',
  './js/jsqr.min.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// INSTALL
self.addEventListener('install', event => {
  self.skipWaiting(); // Activate immediately
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(FILES_TO_CACHE))
      .catch(err => console.error('Cache install failed:', err))
  );
});

// ACTIVATE - clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keyList => {
      return Promise.all(
        keyList.map(key => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim(); // Take control immediately
});

// FETCH
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      return cached || fetch(event.request).catch(() => {
        // Optional: return fallback offline page if needed
        if (event.request.destination === 'document') {
          return caches.match('./index.html');
        }
      });
    })
  );

});

