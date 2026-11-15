/* ==========================================================================
   PENGONTROL HALAMAN CREATOR STUDIO (CREATE.HTML)
   Lokasi file: website/assets/js/pages/create.js
   
   Tujuan utama file ini:
   1. Menyediakan pratinjau langsung (Live Preview) dengan jeda debounce 500ms
      saat penulis mengetik di kolom editor Markdown.
   2. Merender grafik Chart.js secara real-time di panel pratinjau.
   3. Mengenkripsi tulisan menggunakan AES-256-CBC (crypto.js) dan mengunduhnya
      sebagai file .json siap unggah.
   4. Menghasilkan potongan kode JSON untuk disalin ke file data/metadata.json.
   ========================================================================== */

import { CONFIG } from '../config.js';
import { showToast, delay, escapeHTML, initPasswordToggles, registerServiceWorker } from '../utils/dom.js';
import { encryptArticle } from '../utils/crypto.js';
import { parseContent } from '../utils/parser.js';
import { renderCharts } from '../utils/chart.js';

registerServiceWorker();

document.addEventListener('DOMContentLoaded', () => {
    let debounceTimer;

    const contentInput = document.getElementById('articleContent');
    const previewContainer = document.getElementById('previewContainer');
    const btnEncrypt = document.getElementById('btnEncrypt');

    // Aktifkan tombol intip sandi pada kolom Kata Sandi
    initPasswordToggles();

    // =========================================================================
    // 1. LIVE PREVIEW (PRATINJAU LANGSUNG SAAT MENGETIK)
    // =========================================================================
    contentInput.addEventListener('input', function () {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            const val = this.value;

            // Jika editor dikosongkan, tampilkan kembali teks instruksi awal
            if (!val.trim()) {
                previewContainer.innerHTML = `
                    <div style="text-align: center; color: var(--text-muted); margin-top: 100px;">
                        Mulai mengetik di kolom sebelah kiri untuk melihat hasil desain secara langsung...
                    </div>`;
                return;
            }

            // Konversi teks Markdown menjadi HTML aman dan render grafik jika ada
            previewContainer.innerHTML = parseContent(val);
            renderCharts(previewContainer);
        }, CONFIG.PREVIEW_DEBOUNCE_MS);
    });

    // =========================================================================
    // 2. PROSES ENKRIPSI & UNDUH FILE .JSON
    // =========================================================================
    btnEncrypt.addEventListener('click', async () => {
        // Sanitasi ID artikel: ubah ke huruf kecil dan ganti spasi/karakter aneh menjadi tanda hubung '-'
        // agar aman dijadikan nama file URL (contoh: "Catatan Rahasia!" -> "catatan-rahasia-")
        const rawId = document.getElementById('articleId').value.trim();
        const id = rawId.replace(/[^a-zA-Z0-9-_]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase();
        
        const title = document.getElementById('articleTitle').value.trim();
        const pwd = document.getElementById('articlePassword').value;
        const content = contentInput.value;

        // Validasi kelengkapan seluruh kolom sebelum memulai kriptografi
        if (!id || !title || !pwd || !content.trim()) {
            showToast('Harap lengkapi ID, judul, kata sandi, dan isi konten artikel!', 'error');
            return;
        }

        btnEncrypt.textContent = 'Memproses Kriptografi...';
        btnEncrypt.disabled = true;
        await delay(50);

        try {
            // 1. Enkripsi konten artikel menjadi objek { salt, iv, ciphertext }
            const encryptedPayload = encryptArticle(content, pwd);
            const dataToSave = JSON.stringify(encryptedPayload, null, 2);

            // 2. Buat file virtual (Blob) dan picu unduhan otomatis ke perangkat pengguna
            const blob = new Blob([dataToSave], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${id}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            // Bebaskan memori URL objek setelah unduhan dipicu
            URL.revokeObjectURL(url);

            // 3. Siapkan potongan metadata JSON dengan tanggal hari ini (YYYY-MM-DD)
            const today = new Date().toISOString().split('T')[0];
            const metaStr = JSON.stringify({
                id,
                title,
                date: today
            }, null, 2);

            // 4. Tampilkan kotak panduan penempatan file & kode metadata di bawah tombol
            const metaBox = document.getElementById('metadataResult');
            metaBox.style.display = 'block';
            metaBox.innerHTML = `<strong>Enkripsi Selesai!</strong> File <strong>${escapeHTML(id)}.json</strong> telah diunduh.<br>Simpan file tersebut ke dalam folder <code>data/articles/</code>.<br><br>Selanjutnya, salin potongan objek berikut ke dalam file <code>data/metadata.json</code>:<pre style="margin-top: 10px; padding: 10px; background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: 6px; overflow-x: auto;">${escapeHTML(metaStr)},</pre>`;

            showToast('Dokumen berhasil dienkripsi dan diunduh.', 'success');
        } catch (err) {
            console.error('[Create] Kesalahan saat mengenkripsi:', err);
            showToast('Terjadi kesalahan sistem saat memproses enkripsi.', 'error');
        } finally {
            btnEncrypt.textContent = 'Enkripsi & Unduh .json';
            btnEncrypt.disabled = false;
        }
    });
});