/* ==========================================================================
   FILE: sw.js
   DESKRIPSI: Service Worker Bichig San (Instalasi, Luring & Pembaruan Otomatis)
   - Normalisasi kunci cache berbasis scope agar bebas duplikasi kunci
   - Network-First (cache: 'no-store' + HTTP cache-bust header) untuk HTML,
     metadata.json, berkas artikel (.txt), CSS, dan parser.js
   - Timeout jaringan cepat (3.5 detik) agar jaringan lambat otomatis beralih
     ke tembolok luring tanpa menggantung antarmuka
   - Cache-First hanya untuk aset biner statis (ikon & font)
   - Pembatasan kuota artikel luring (maksimal 50 berkas .txt dengan urutan LRU)
   - Pengecualian cache untuk stream audio/video & Range Request (206)
   ========================================================================== */

const CACHE_VERSION = 'bichig-san-v4';
const MAX_CACHED_ARTICLES = 50;
const NETWORK_TIMEOUT_MS = 3500;

const SHELL_ASSETS = [
  './',
  './index.html',
  './view.html',
  './style.css',
  './parser.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './font/Inconsolata.ttf'
];

const IMMUTABLE_BINARIES = /\.(ttf|woff2?|png|jpg|jpeg|gif|webp|ico)$/i;
const STREAMING_MEDIA_EXT = /\.(mp4|webm|ogv|mov|mp3|ogg|wav|m4a|flac|aac)$/i;

/**
 * Mengubah path relatif/URL menjadi pathname kanonis yang konsisten di root maupun subfolder.
 */
function toCanonicalPathname(pathOrUrl) {
  return new URL(pathOrUrl, self.registration.scope).pathname;
}

/**
 * Fetch jaringan dengan batas waktu & pemaksa bypass HTTP cache peladen/peramban.
 */
async function fetchFreshWithTimeout(request, timeoutMs = NETWORK_TIMEOUT_MS) {
  const controller = new AbortController();
  const timerId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const freshReq = new Request(request.url, {
      method: 'GET',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache'
      },
      cache: 'no-store',
      credentials: 'same-origin',
      redirect: 'follow',
      signal: controller.signal
    });

    return await fetch(freshReq);
  } finally {
    clearTimeout(timerId);
  }
}

/**
 * Menyimpan respons ke cache secara aman dengan penimpaan bersih & pemangkasan LRU
 * untuk artikel .txt agar penyimpanan perangkat tidak penuh.
 */
async function safePutCache(cache, canonicalPath, response, isArticleFile = false) {
  try {
    if (!response || response.status !== 200 || response.type === 'opaque') return;

    // Hapus entri lama terlebih dahulu agar pembaruan benar-benar menimpa data lama
    await cache.delete(canonicalPath, { ignoreSearch: true });

    if (isArticleFile) {
      const keys = await cache.keys();
      const articleKeys = keys.filter((req) => {
        const p = new URL(req.url).pathname;
        return p.includes('/posts/') && p.endsWith('.txt');
      });

      if (articleKeys.length >= MAX_CACHED_ARTICLES) {
        const excessCount = articleKeys.length - MAX_CACHED_ARTICLES + 1;
        for (let i = 0; i < excessCount; i++) {
          await cache.delete(articleKeys[i]);
        }
      }
    }

    await cache.put(canonicalPath, response);
  } catch {
    // Abaikan secara aman jika kuota penyimpanan perangkat terbatas
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      Promise.all(
        SHELL_ASSETS.map(async (asset) => {
          const canonicalPath = toCanonicalPathname(asset);
          try {
            const res = await fetchFreshWithTimeout(new Request(canonicalPath), 6000);
            if (res && res.status === 200) {
              await safePutCache(cache, canonicalPath, res, false);
            }
          } catch {
            // Jangan gagalkan instalasi jika salah satu aset opsional belum tersedia
          }
        })
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
 * Strategi Network-First: selalu mengambil data terbaru saat daring,
 * dan otomatis menyajikan tembolok luring saat terputus atau jaringan lambat.
 */
async function networkFirstWithCacheUpdate(request, url, fallbackPaths = []) {
  const cache = await caches.open(CACHE_VERSION);
  const isHtmlRequest = request.mode === 'navigate' || url.pathname.endsWith('.html');
  const isArticleFile = url.pathname.includes('/posts/') && url.pathname.endsWith('.txt');
  const isMetadataFile = url.pathname.endsWith('/metadata.json');

  const normalizedPaths = fallbackPaths.map(toCanonicalPathname);
  const canonicalKey =
    isHtmlRequest && normalizedPaths.length > 0 ? normalizedPaths[0] : url.pathname;

  try {
    const networkResponse = await fetchFreshWithTimeout(request);

    if (networkResponse && networkResponse.status === 200) {
      const contentType = (networkResponse.headers.get('content-type') || '').toLowerCase();
      const isSoft404Html = (isArticleFile || isMetadataFile) && contentType.includes('text/html');

      if (!isSoft404Html) {
        await safePutCache(cache, canonicalKey, networkResponse.clone(), isArticleFile);
      }
      return networkResponse;
    }

    // Jika peladen mengembalikan galat sementara (5xx), coba tembolok terlebih dahulu
    if (networkResponse && networkResponse.status >= 500) {
      const cachedOnServerErr = await cache.match(canonicalKey, { ignoreSearch: true });
      if (cachedOnServerErr) return cachedOnServerErr;
    }

    return networkResponse;
  } catch {
    const cachedExact = await cache.match(canonicalKey, { ignoreSearch: true });
    if (cachedExact) return cachedExact;

    for (const fbPath of normalizedPaths) {
      const cachedFallback = await cache.match(fbPath, { ignoreSearch: true });
      if (cachedFallback) return cachedFallback;
    }

    return Response.error();
  }
}

/**
 * Strategi Cache-First + Revalidasi Latar Belakang khusus aset biner berat (font & ikon).
 */
async function cacheFirstForBinaries(event, request, url) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(url.pathname, { ignoreSearch: true });

  const updatePromise = fetchFreshWithTimeout(request, 6000)
    .then(async (networkResponse) => {
      if (networkResponse && networkResponse.status === 200) {
        await safePutCache(cache, url.pathname, networkResponse.clone(), false);
      }
      return networkResponse;
    })
    .catch(() => null);

  if (cached) {
    event.waitUntil(updatePromise);
    return cached;
  }

  return (await updatePromise) || Response.error();
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // Lewati Range Request (streaming media parsial) langsung ke jaringan
  if (req.headers.has('range')) return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Media streaming audio/video langsung ke jaringan (hemat kuota & penyimpanan)
  if (STREAMING_MEDIA_EXT.test(url.pathname)) return;

  // Aset biner (font & ikon): gunakan Cache-First dengan pembaruan latar belakang aman
  if (IMMUTABLE_BINARIES.test(url.pathname)) {
    event.respondWith(cacheFirstForBinaries(event, req, url));
    return;
  }

  // Seluruh dokumen teks & kode aplikasi (HTML, metadata.json, artikel .txt, CSS, JS):
  // Wajib Network-First agar perubahan langsung tampil tanpa perlu hapus cache manual
  const fallbacks = url.pathname.endsWith('view.html')
    ? ['./view.html']
    : req.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname.endsWith('/')
    ? ['./index.html', './']
    : [];

  event.respondWith(networkFirstWithCacheUpdate(req, url, fallbacks));
});
