/* ==========================================================================
   PENGONTROL HALAMAN RAW EXTRACTOR (RAW.HTML)
   Lokasi file: website/assets/js/pages/raw.js
   
   Tujuan utama file ini:
   1. Membaca file artikel terenkripsi (.json) yang diunggah pengguna dari perangkat lokal
      menggunakan FileReader API (100% diproses di memori browser tanpa unggah ke server).
   2. Mendekripsi file menggunakan crypto.js untuk mengembalikan kode Markdown mentah.
   3. Menyediakan tombol "Salin Semua" menggunakan Clipboard API modern (dengan fallback).
   ========================================================================== */

import { showToast, delay, initPasswordToggles, registerServiceWorker } from '../utils/dom.js';
import { decryptArticle } from '../utils/crypto.js';

registerServiceWorker();

document.addEventListener('DOMContentLoaded', () => {
    // Aktifkan tombol intip sandi pada kolom Kata Sandi Artikel
    initPasswordToggles();

    /**
     * Pembungkus FileReader berbasis Promise agar pembacaan file lokal dapat
     * dijalankan secara bersih menggunakan sintaks async/await.
     * 
     * @param {File} file - Objek file .json yang dipilih pengguna dari <input type="file">.
     * @returns {Promise<object>} Objek hasil parsing JSON.
     */
    const readUploadedFile = (file) => new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (e) => {
            try {
                const parsedJson = JSON.parse(e.target.result);
                resolve(parsedJson);
            } catch (_) {
                reject(new Error('Format file rusak atau bukan file JSON yang valid.'));
            }
        };

        reader.onerror = () => {
            reject(new Error('Gagal membaca file dari penyimpanan perangkat.'));
        };

        reader.readAsText(file);
    });

    // =========================================================================
    // 1. PENANGANAN FORMULIR EKSTRAKSI FILE JSON
    // =========================================================================
    document.getElementById('extractForm').addEventListener('submit', async (e) => {
        e.preventDefault();

        const fileInput = document.getElementById('jsonFile');
        const pwd = document.getElementById('password').value;
        const btn = document.getElementById('btnExtract');

        if (!fileInput.files || fileInput.files.length === 0) {
            showToast('Harap pilih file .json terlebih dahulu!', 'error');
            return;
        }

        btn.textContent = 'Membaca & Mendekripsi...';
        btn.disabled = true;
        await delay(50);

        try {
            // 1. Baca dan parse file JSON dari perangkat pengguna
            const encData = await readUploadedFile(fileInput.files[0]);

            // 2. Dekripsi menggunakan modul crypto.js
            const plaintext = decryptArticle(encData, pwd);

            // 3. Sembunyikan panel unggah dan tampilkan panel berisi kode Markdown mentah
            document.getElementById('extractPanel').style.display = 'none';
            document.getElementById('rawResult').style.display = 'block';
            document.getElementById('rawTextContent').value = plaintext;

            showToast('Berhasil membongkar teks Markdown asli!', 'success');
        } catch (err) {
            console.error('[Raw] Gagal mengekstrak file:', err);
            showToast(err.message || 'Gagal mendekripsi file.', 'error');
        } finally {
            btn.textContent = 'Bongkar File JSON';
            btn.disabled = false;
        }
    });

    // =========================================================================
    // 2. TOMBOL SALIN SELURUH TEKS KE CLIPBOARD
    // =========================================================================
    document.getElementById('btnCopy').addEventListener('click', async () => {
        const textArea = document.getElementById('rawTextContent');

        try {
            // Menggunakan Clipboard API modern (aman di konteks HTTPS / localhost)
            await navigator.clipboard.writeText(textArea.value);
            showToast('Seluruh teks berhasil disalin ke clipboard!', 'success');
        } catch (_) {
            // Fallback untuk browser lama atau lingkungan tanpa izin Clipboard API
            textArea.select();
            textArea.setSelectionRange(0, 99999);
            document.execCommand('copy');
            showToast('Seluruh teks berhasil disalin ke clipboard!', 'success');
        }
    });
});