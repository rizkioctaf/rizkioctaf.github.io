/* ==========================================================================
   SERVICE WORKER (PWA INSTALLABILITY HANDLER)
   Lokasi file: website/sw.js (Harus berada di root folder agar scope-nya 
   mencakup seluruh halaman: index.html, view.html, create.html, dan raw.html).
   
   Tujuan utama file ini:
   Memenuhi syarat teknis browser (Chromium, Edge, Safari, Firefox) agar aplikasi 
   dapat di-install ke perangkat (Add to Home Screen / Install App) tanpa 
   menyimpan cache file statis secara agresif, sehingga pembaruan artikel dan 
   kode selalu langsung terlihat secara real-time.
   ========================================================================== */

/**
 * 1. EVENT 'INSTALL'
 * Dipicu satu kali oleh browser ketika Service Worker pertama kali didaftarkan
 * oleh `registerServiceWorker()` di `dom.js`, atau ketika isi file `sw.js` 
 * mengalami perubahan sekecil apa pun.
 */
self.addEventListener('install', (event) => {
    // Memaksa Service Worker versi baru langsung masuk ke fase aktif
    // tanpa menunggu pengguna menutup seluruh tab aplikasi yang sedang terbuka.
    self.skipWaiting();
});

/**
 * 2. EVENT 'ACTIVATE'
 * Dipicu tepat setelah fase 'install' selesai dan Service Worker siap bertugas.
 * Biasanya digunakan untuk membersihkan cache versi lama (jika memakai cache).
 */
self.addEventListener('activate', (event) => {
    // Mengambil alih kendali atas seluruh halaman/tab yang terbuka di bawah scope ini
    // secara langsung tanpa perlu pengguna me-refresh halaman terlebih dahulu.
    event.waitUntil(self.clients.claim());
});

/**
 * 3. EVENT 'FETCH'
 * Mencegat setiap permintaan jaringan (HTML, CSS, JS, JSON, gambar) yang keluar 
 * dari aplikasi. Keberadaan listener 'fetch' merupakan syarat mutlak dari browser 
 * agar tombol "Install App" dimunculkan.
 */
self.addEventListener('fetch', (event) => {
    // Sesuai arsitektur aplikasi: tidak menggunakan penyimpanan Cache lokal 
    // agar data artikel terenkripsi dan metadata.json selalu diambil terbaru 
    // langsung dari jaringan/server (Network-Only pass-through).
    return;
});