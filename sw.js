/* ==========================================================================
   FILE: sw.js
   DESKRIPSI: Service Worker Arsip Digital - Selalu Sinkron & Anti-Stale
              - Mengecek versi terbaru secara aktif saat aktivasi & fetch
              - Network-First (cache: 'no-store') untuk HTML, metadata.json,
                dan berkas artikel agar publikasi baru selalu tampil
              - Stale-While-Revalidate untuk CSS, parser.js, dan manifest
              - Mengirim sinyal pembaruan ke klien aktif bila versi berubah
   ========================================================================== */

const CACHE_VERSION = 'arsip-digital-2026-11-21-v2';
const SHELL_ASSETS = [
  './',
  './index.html',
  './view.html',
  './style.css',
  './parser.js',
  './manifest.webmanifest'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      Promise.all(
        SHELL_ASSETS.map((asset) =>
          fetch(new Request(asset, { cache: 'no-store' }))
            .then((res) => (res.ok ? cache.put(asset, res) : null))
            .catch(() => null)
        )
      )
    )
  );
  // Segera aktifkan versi baru tanpa menunggu antrean lama
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_VERSION)
            .map((oldKey) => caches.delete(oldKey))
        )
      )
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
      .then((clients) => {
        clients.forEach((client) => {
          client.postMessage({ type: 'SW_UPDATED', version: CACHE_VERSION });
        });
      })
  );
});

async function networkFirstWithCacheUpdate(request, fallbackPath) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const freshRequest = new Request(request, { cache: 'no-store' });
    const networkResponse = await fetch(freshRequest);
    if (networkResponse && networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (fallbackPath) {
      return (await cache.match(fallbackPath)) || Response.error();
    }
    return Response.error();
  }
}

function staleWhileRevalidate(request) {
  return caches.open(CACHE_VERSION).then(async (cache) => {
    const cached = await cache.match(request);
    const networkPromise = fetch(new Request(request, { cache: 'no-store' }))
      .then((networkResponse) => {
        if (networkResponse && networkResponse.ok) {
          cache.put(request, networkResponse.clone());
        }
        return networkResponse;
      })
      .catch(() => null);

    return cached || (await networkPromise) || Response.error();
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 1. Halaman navigasi & berkas artikel/indeks -> selalu utamakan versi terbaru dari server
  const isDynamicContent =
    req.mode === 'navigate' ||
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('/metadata.json') ||
    url.pathname.includes('/posts/');

  if (isDynamicContent) {
    const fallback = url.pathname.endsWith('view.html') ? './view.html' : './index.html';
    event.respondWith(networkFirstWithCacheUpdate(req, fallback));
    return;
  }

  // 2. Aset antarmuka & parser -> tampil instan dari cache sambil perbarui di latar belakang
  event.respondWith(staleWhileRevalidate(req));
});
