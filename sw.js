/* ==========================================================================
   SERVICE WORKER (DUMMY) - HANYA UNTUK SYARAT INSTALASI
   ========================================================================== */
// Seluruh fitur Cache dan Mode Offline telah dihapus sesuai permintaan.
// File ini dipertahankan murni agar browser mengenali web ini sebagai Aplikasi
// dan memunculkan tombol "Install" (Add to Home Screen).

self.addEventListener('install', (event) => {
    // Memaksa Service Worker langsung aktif tanpa menunggu
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    // Langsung mengambil alih kontrol halaman
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    // Syarat mutlak PWA: Harus ada event 'fetch' yang terdaftar.
    // Karena kita tidak memakai Cache, kita biarkan kosong (return).
    // Browser akan secara otomatis mengambil file langsung dari internet/server.
    return;
});
