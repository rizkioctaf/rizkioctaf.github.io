const CACHE_NAME = 'toolbox-cache-v1';
const assetsToCache = [
    'index.html',
    'database.json',
    'manifest.json'
];

// Saat Service Worker diinstal
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(assetsToCache);
        })
    );
});

// Mengambil aset dari cache saat offline/dimuat
self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request).then((response) => {
            return response || fetch(event.request);
        })
    );
});