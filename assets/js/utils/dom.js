/* ==========================================================================
   UTILITAS DOM, KEAMANAN HTML, NOTIFIKASI, & PWA
   Lokasi file: website/assets/js/utils/dom.js
   
   Tujuan utama file ini:
   Menyediakan fungsi-fungsi pembantu antarmuka pengguna (UI) yang dipakai berulang
   kali di berbagai halaman agar tidak terjadi duplikasi kode.
   ========================================================================== */

/**
 * Menampilkan notifikasi melayang (Toast) di pojok kanan bawah layar.
 * Digunakan kapan: Saat proses enkripsi berhasil, dekripsi gagal/sukses,
 * atau teks berhasil disalin ke clipboard.
 * 
 * @param {string} message - Pesan teks yang ingin ditampilkan kepada pengguna.
 * @param {'success'|'error'} type - Jenis notifikasi untuk menentukan ikon dan aksen border.
 */
export function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    // Hentikan fungsi secara aman jika elemen wadah tidak ditemukan di halaman
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    // Memilih ikon vektor SVG monokrom yang sesuai dengan status pesan
    const iconSvg = type === 'error'
        ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`
        : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`;

    // Menggunakan escapeHTML() pada message untuk mencegah injeksi kode HTML berbahaya
    toast.innerHTML = `${iconSvg} <span>${escapeHTML(message)}</span>`;
    container.appendChild(toast);

    // Jeda 10ms agar browser sempat merender posisi awal sebelum memicu transisi CSS masuk
    setTimeout(() => toast.classList.add('show'), 10);

    // Otomatis menyembunyikan dan menghapus elemen DOM toast setelah 3 detik
    setTimeout(() => {
        toast.classList.remove('show');
        // Tunggu 300ms hingga animasi geser keluar selesai sebelum menghapus node dari DOM
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

/**
 * Memberikan jeda waktu berbasis Promise (non-blocking).
 * Digunakan kapan: Tepat sebelum proses PBKDF2 yang berat dimulai, sehingga browser
 * memiliki kesempatan memperbarui teks tombol (misal: "Mendekripsi...") sebelum CPU sibuk.
 * 
 * @param {number} ms - Durasi jeda dalam milidetik.
 * @returns {Promise<void>}
 */
export const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Mengubah karakter khusus HTML menjadi entitas aman (HTML Entities).
 * Digunakan kapan: Setiap kali teks dari input pengguna atau file JSON eksternal
 * (seperti judul di metadata.json atau isi artikel) hendak disisipkan ke innerHTML.
 * Fungsi ini adalah benteng pertahanan utama melawan serangan Cross-Site Scripting (XSS).
 * 
 * @param {string} str - Teks mentah yang berpotensi mengandung tag HTML/skrip.
 * @returns {string} Teks yang sudah aman untuk dirender ke DOM.
 */
export function escapeHTML(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Menambahkan tombol "Intip Sandi" (ikon mata) secara otomatis pada seluruh
 * kolom <input type="password"> di halaman yang sedang aktif.
 * Digunakan kapan: Saat halaman view.html, create.html, atau raw.html selesai dimuat.
 * Membantu UX pengguna mobile/desktop agar terhindar dari kesalahan ketik (typo) kata sandi.
 * Menambahkan tombol "Intip Sandi" (ikon mata) secara tunggal dan aman
 * pada seluruh kolom <input type="password"> di halaman yang sedang aktif.
 */
export function initPasswordToggles() {
    const eyeOpenSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
    const eyeOffSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;

    document.querySelectorAll('input[type="password"]').forEach((input) => {
        // Cegah duplikasi jika input sudah diinisialisasi atau sudah memiliki tombol toggle
        if (
            input.dataset.pwInit === 'true' ||
            input.parentElement?.classList.contains('password-field-wrapper') ||
            input.parentElement?.querySelector('.pw-toggle-btn')
        ) {
            return;
        }

        input.dataset.pwInit = 'true';

        // Pastikan input selalu memiliki kelas .pw-input agar pseudo-element browser ikut tersembunyi
        input.classList.add('pw-input');

        const wrapper = document.createElement('div');
        wrapper.className = 'password-field-wrapper';
        input.parentNode.insertBefore(wrapper, input);
        wrapper.appendChild(input);

        const toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.className = 'pw-toggle-btn';
        toggleBtn.setAttribute('aria-label', 'Tampilkan kata sandi');
        toggleBtn.innerHTML = eyeOpenSvg;

        toggleBtn.addEventListener('click', () => {
            const isHidden = input.type === 'password';
            input.type = isHidden ? 'text' : 'password';
            toggleBtn.innerHTML = isHidden ? eyeOffSvg : eyeOpenSvg;
            toggleBtn.setAttribute('aria-label', isHidden ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi');
            toggleBtn.style.color = isHidden ? 'var(--text-primary)' : 'var(--text-muted)';
            input.focus();
        });

        wrapper.appendChild(toggleBtn);
    });
}

/**
 * Mendaftarkan file sw.js sebagai Service Worker untuk mendukung instalasi PWA.
 * Digunakan kapan: Dipanggil di awal pemuatan setiap halaman HTML.
 */
export function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js')
                .then(reg => console.log('[PWA] Service Worker terdaftar pada scope:', reg.scope))
                .catch(err => console.error('[PWA] Gagal mendaftarkan Service Worker:', err));
        });
    }
}