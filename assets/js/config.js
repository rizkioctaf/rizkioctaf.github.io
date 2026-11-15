/* ==========================================================================
   PUSAT KONFIGURASI GLOBAL (SINGLE SOURCE OF TRUTH)
   Lokasi file: website/assets/js/config.js
   
   Tujuan utama file ini:
   Menyimpan seluruh konstanta, path folder, durasi jeda (debounce), dan parameter
   kriptografi di satu tempat. Jika di kemudian hari Anda memindahkan folder data
   atau memperketat keamanan enkripsi, Anda cukup mengubah nilai di file ini tanpa
   perlu mencari-cari di seluruh kode aplikasi.
   ========================================================================== */

export const CONFIG = {
    // Lokasi file indeks utama yang berisi daftar ID, judul, dan tanggal seluruh artikel.
    // Digunakan oleh: index.js saat memuat halaman Beranda.
    METADATA_PATH: './data/metadata.json',

    // Direktori tempat menyimpan file-file artikel terenkripsi (.json).
    // Digunakan oleh: view.js saat mengambil dokumen berdasarkan parameter ?id=...
    ARTICLES_DIR: './data/articles',

    // Jumlah maksimal kartu artikel yang dirender dalam satu gelombang scroll (Virtual Rendering).
    // Mencegah browser lag/macet jika daftar artikel di metadata.json mencapai ribuan entri.
    ITEMS_PER_LOAD: 20,

    // Masa berlaku sesi otomatis masuk (auto-login) dalam satuan milidetik.
    // 24 jam * 60 menit * 60 detik * 1000 milidetik = 86.400.000 ms.
    // Digunakan oleh: view.js agar pembaca tidak perlu mengetik ulang sandi dalam 24 jam.
    AUTO_LOGIN_TTL_MS: 24 * 60 * 60 * 1000,

    // Kunci otomatis hanya jika user diam tanpa aktivitas sama sekali selama 15 menit
    IDLE_TIMEOUT_MS: 15 * 60 * 1000,

    // Jumlah pengulangan fungsi hash PBKDF2 untuk membentuk kunci enkripsi dari kata sandi.
    // Semakin tinggi nilainya, semakin lambat serangan brute-force dilakukan peretas.
    // Digunakan oleh: crypto.js saat enkripsi maupun dekripsi.
    PBKDF2_ITERATIONS: 10000,

    // Panjang kunci AES dalam satuan Word (32-bit).
    // 256 / 32 = 8 words (setara dengan standar militer AES-256 bit).
    PBKDF2_KEY_SIZE: 256 / 32,

    // Waktu tunda (ms) setelah pengguna berhenti mengetik di bilah pencarian Beranda
    // sebelum penyaringan daftar artikel dieksekusi (mencegah pemrosesan berlebihan tiap ketukan tombol).
    SEARCH_DEBOUNCE_MS: 300,

    // Waktu tunda (ms) setelah penulis berhenti mengetik di Creator Studio (create.html)
    // sebelum pratinjau langsung (Live Preview) dan grafik Chart.js dirender ulang.
    PREVIEW_DEBOUNCE_MS: 500
};