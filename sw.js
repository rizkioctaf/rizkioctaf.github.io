/* ==========================================================================
   SERVICE WORKER (PWA) - MESIN OFFLINE SECURE READER
   ========================================================================== */

// NAMA BRANKAS MEMORI (CACHE)
// PENTING: Jika Anda melakukan perubahan desain (CSS) atau logika (JS) di masa depan, 
// ubah angka versi ini (contoh: jadi 'v3'). Ini akan memaksa HP/Laptop pengguna 
// untuk membuang memori lama dan mengunduh desain Anda yang paling baru.
const CACHE_NAME = 'secure-reader-v2';

// DAFTAR FILE WAJIB UNDUH AWAL (Pre-cache)
// File-file ini akan langsung didownload secara diam-diam saat web pertama kali dibuka.
const STATIC_ASSETS = [
    './', // Halaman utama (root)
    './index.html',
    './view.html',
    './create.html',
    './style.css',
    './script.js',
    './manifest.json',
    // Library eksternal juga ikut disimpan agar web tidak butuh internet sama sekali saat dibuka
    'https://cdnjs.cloudflare.com/ajax/libs/crypto-js/4.1.1/crypto-js.min.js',
    'https://cdn.jsdelivr.net/npm/chart.js'
];


/* ==========================================================================
   TAHAP 1: INSTALASI (Mengunduh File ke Memori HP)
   ========================================================================== */
self.addEventListener('install', (event) => {
    // event.waitUntil memastikan proses ini selesai sebelum service worker dianggap sukses terinstal
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[Service Worker] Sedang menyimpan file inti ke memori (Cache)...');
            return cache.addAll(STATIC_ASSETS);
        })
    );
    // skipWaiting() memaksa Service Worker baru untuk langsung aktif bekerja, 
    // tanpa menunggu pengguna menutup browser terlebih dahulu.
    self.skipWaiting();
});


/* ==========================================================================
   TAHAP 2: AKTIVASI (Pembersihan Memori Versi Lama)
   ========================================================================== */
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            // Cek semua brankas memori yang ada di browser pengguna
            return Promise.all(
                cacheNames.map((name) => {
                    // Jika ada nama brankas lama (contoh: v1) yang tidak sama dengan nama CACHE_NAME saat ini (v2),
                    // maka hapus brankas lama tersebut agar memori HP pengguna tidak penuh.
                    if (name !== CACHE_NAME) {
                        console.log('[Service Worker] Menghapus cache usang:', name);
                        return caches.delete(name);
                    }
                })
            );
        })
    );
    // Langsung ambil alih kontrol halaman dari Service Worker yang lama
    self.clients.claim();
});


/* ==========================================================================
   TAHAP 3: FETCH (Strategi Pencegatan Jaringan)
   ========================================================================== */
self.addEventListener('fetch', (event) => {
    // ANTI-BUG: Abaikan permintaan yang bukan bertipe GET (misal POST data)
    // dan abaikan ekstensi browser chrome (seperti AdBlock/Grammarly) yang sering bikin error
    if (event.request.method !== 'GET' || event.request.url.startsWith('chrome-extension')) {
        return; 
    }

    const requestUrl = new URL(event.request.url);

    // ----------------------------------------------------------------------
    // STRATEGI 1: "NETWORK FIRST" (Internet Dulu, Memori Kemudian)
    // Digunakan KHUSUS untuk file Artikel dan Metadata (.json)
    // Kenapa? Karena artikel bisa bertambah kapan saja. Kita butuh data yang paling fresh (baru) dari server.
    // ----------------------------------------------------------------------
    if (requestUrl.pathname.endsWith('.json') && !requestUrl.pathname.includes('manifest.json')) {
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    // JIKA ADA INTERNET:
                    // Gandakan (clone) datanya. Satu diberikan ke layar pengguna, satu lagi disimpan ke memori rahasia (Cache).
                    const clonedResponse = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clonedResponse));
                    return response;
                })
                .catch(() => {
                    // JIKA TIDAK ADA INTERNET (OFFLINE):
                    // Tenang, jangan munculkan layar Dinosaurus Google Chrome. 
                    // Kita ambil data terakhir yang pernah disimpan di memori Cache.
                    return caches.match(event.request);
                })
        );
    } 
    
    // ----------------------------------------------------------------------
    // STRATEGI 2: "CACHE FIRST" (Memori Dulu, Internet Kemudian)
    // Digunakan untuk file Desain/Program (HTML, CSS, JS, Gambar)
    // Kenapa? Karena desain jarang berubah. Jika kita ambil dari memori, web akan meload INSTAN dalam 0.1 detik!
    // ----------------------------------------------------------------------
    else {
        event.respondWith(
            caches.match(event.request).then(response => {
                // JIKA FILE DITEMUKAN DI MEMORI: Langsung tampilkan (Return Response)
                if (response) {
                    return response;
                }
                
                // JIKA FILE BELUM ADA DI MEMORI: Terpaksa ambil dari internet (Fetch)
                return fetch(event.request).then(fetchRes => {
                    // Simpan hasil tarikan dari internet ke memori, supaya besok-besok jadi instan
                    return caches.open(CACHE_NAME).then(cache => {
                        cache.put(event.request, fetchRes.clone());
                        return fetchRes;
                    });
                }).catch(() => {
                    // ANTI-BUG OFFLINE FATAL:
                    // Jika internet mati total dan file HTML tidak ada di memori sama sekali, 
                    // kembalikan saja halaman index (Beranda) sebagai pelampung (Fallback) darurat.
                    if (event.request.mode === 'navigate') {
                        return caches.match('./index.html');
                    }
                });
            })
        );
    }
});
