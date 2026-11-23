/* ==========================================================================
   FILE: sw.js
   DESKRIPSI: Service Worker Arsip Digital (Instalasi, Luring & Manajemen Kuota)
              - App Shell & ikon PNG di-cache saat instalasi
              - Network-First (cache: 'no-store') untuk HTML, metadata.json,
                dan berkas artikel agar publikasi baru selalu tampil
              - Pencocokan URL tahan query-string (ignoreSearch) saat luring
              - Pembatasan kuota artikel luring (maksimal 50 berkas .txt)
              - Stale-While-Revalidate untuk CSS, parser.js, manifest & ikon
   ========================================================================== */

const CACHE_VERSION = 'arsip-digital-v2';
const MAX_CACHED_ARTICLES = 50;

const SHELL_ASSETS = [
  './',
  './index.html',
  './view.html',
  './style.css',
  './parser.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
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

/**
 * Menyimpan respons ke cache secara aman dengan pemangkasan artikel lama
 * agar penyimpanan perangkat seluler tidak penuh (QuotaExceededError).
 */
async function safePutCache(cache, cacheKey, response, isArticleFile = false) {
  try {
    if (isArticleFile) {
      const keys = await cache.keys();
      const articleKeys = keys.filter((req) => {
        const pathname = new URL(req.url).pathname;
        return pathname.includes('/posts/') && pathname.endsWith('.txt');
      });

      if (articleKeys.length >= MAX_CACHED_ARTICLES) {
        const excessCount = articleKeys.length - MAX_CACHED_ARTICLES + 1;
        for (let i = 0; i < excessCount; i++) {
          await cache.delete(articleKeys[i]);
        }
      }
    }

    await cache.put(cacheKey, response);
  } catch {
    // Abaikan secara aman jika penyimpanan perangkat penuh atau dibatasi mode privat
  }
}

async function networkFirstWithCacheUpdate(request, url, fallbackPath) {
  const cache = await caches.open(CACHE_VERSION);
  const isHtmlRequest = request.mode === 'navigate' || url.pathname.endsWith('.html');
  const isArticleFile = url.pathname.includes('/posts/') && url.pathname.endsWith('.txt');
  const isMetadataFile = url.pathname.endsWith('/metadata.json');

  // Normalisasi kunci cache agar parameter query tambahan tidak memicu cache miss
  const normalizedCacheKey = isHtmlRequest && fallbackPath ? fallbackPath : url.pathname;

  try {
    const freshRequest = new Request(request, { cache: 'no-store' });
    const networkResponse = await fetch(freshRequest);

    if (networkResponse && networkResponse.ok) {
      const contentType = (networkResponse.headers.get('content-type') || '').toLowerCase();
      const isSoft404Html = (isArticleFile || isMetadataFile) && contentType.includes('text/html');

      if (!isSoft404Html) {
        await safePutCache(cache, normalizedCacheKey, networkResponse.clone(), isArticleFile);
      }
    }

    return networkResponse;
  } catch {
    const cachedExact = await cache.match(normalizedCacheKey, { ignoreSearch: true });
    if (cachedExact) return cachedExact;

    if (fallbackPath) {
      const cachedFallback = await cache.match(fallbackPath, { ignoreSearch: true });
      if (cachedFallback) return cachedFallback;
    }

    return Response.error();
  }
}

function staleWhileRevalidate(request, url) {
  return caches.open(CACHE_VERSION).then(async (cache) => {
    const cached = await cache.match(url.pathname, { ignoreSearch: true });
    const networkPromise = fetch(new Request(request, { cache: 'no-store' }))
      .then(async (networkResponse) => {
        if (networkResponse && networkResponse.ok) {
          await safePutCache(cache, url.pathname, networkResponse.clone(), false);
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

  const isDynamicContent =
    req.mode === 'navigate' ||
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('/metadata.json') ||
    url.pathname.includes('/posts/');

  if (isDynamicContent) {
    const fallback = url.pathname.endsWith('view.html') ? './view.html' : './index.html';
    event.respondWith(networkFirstWithCacheUpdate(req, url, fallback));
    return;
  }

  event.respondWith(staleWhileRevalidate(req, url));
});
