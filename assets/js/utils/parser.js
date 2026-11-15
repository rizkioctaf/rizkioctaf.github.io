/* ==========================================================================
   MESIN PARSER MARKDOWN KUSTOM & SANITASI MEDIA
   Lokasi file: website/assets/js/utils/parser.js
   
   Tujuan utama file ini:
   Mengubah sintaks Markdown kustom (#, **, list bertingkat, tabel, @audio, @video,
   dan @grafik) menjadi elemen HTML yang terstruktur dan aman dari serangan XSS.
   Digunakan oleh: view.js (saat menampilkan artikel) dan create.js (Live Preview).
   ========================================================================== */

import { escapeHTML } from './dom.js';

/**
 * Memastikan URL sumber media (gambar, audio, video) hanya menggunakan protokol yang aman.
 * Mencegah serangan injeksi URL seperti `javascript:alert(1)` atau `data:text/html,...`.
 * 
 * @param {string} url - Alamat URL yang ditulis penulis di dalam tanda kurung `(...)`.
 * @returns {string} URL asli jika valid, atau `'#'` jika terdeteksi mencurigakan.
 */
function sanitizeMediaUrl(url) {
    const clean = url.trim();
    // Mengizinkan tautan eksternal (http/https) maupun jalur file lokal relatif (./ atau /)
    return /^(https?:\/\/|\.\/|\/)/i.test(clean) ? clean : '#';
}

/**
 * Mengonversi teks mentah Markdown kustom menjadi string HTML siap render.
 * 
 * @param {string} text - Teks mentah hasil dekripsi atau ketikan di editor.
 * @returns {string} Markup HTML yang sudah disanitasi dan diformat.
 */
export function parseContent(text) {
    // TAHAP 0: SANITASI ANTI-XSS
    // Menetralkan seluruh tag HTML bawaan yang mungkin diselipkan di dalam teks
    // sebelum kita memproses sintaks Markdown kita sendiri.
    let html = escapeHTML(text);

    // TAHAP 1: PEMFORMATAN DASAR & MEDIA KUSTOM
    html = html
        // Mengubah `# Judul`, `## Sub-judul`, dan `### Sub-bab` menjadi tag heading HTML
        .replace(/^### (.*$)/gim, '<h3>$1</h3>')
        .replace(/^## (.*$)/gim, '<h2>$1</h2>')
        .replace(/^# (.*$)/gim, '<h1>$1</h1>')
        // Mengubah `**teks**` menjadi cetak tebal dan `*teks*` menjadi cetak miring
        .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/gim, '<em>$1</em>')
        // Mengubah `![alt](url)` menjadi elemen gambar dengan lazy loading
        .replace(/!\[(.*?)\]\((.*?)\)/gim, (_, alt, url) => `<img alt="${alt}" src="${sanitizeMediaUrl(url)}" loading="lazy">`)
        // Mengubah `@audio[judul](url)` menjadi pemutar audio HTML5
        .replace(/@audio\[(.*?)\]\((.*?)\)/gim, (_, alt, url) => `<audio controls><source src="${sanitizeMediaUrl(url)}"></audio>`)
        // Mengubah `@video[judul](url)` menjadi pemutar video HTML5
        .replace(/@video\[(.*?)\]\((.*?)\)/gim, (_, alt, url) => `<video controls><source src="${sanitizeMediaUrl(url)}"></video>`)
        // Mengubah `@grafik[bar|line](Label1:Nilai1, Label2:Nilai2)` menjadi wadah kanvas
        // yang nantinya akan digambar oleh fungsi renderCharts() di chart.js
        .replace(/@grafik\[(.*?)\]\((.*?)\)/gim, '<div class="chart-wrapper"><div class="chart-container"><canvas class="custom-chart" data-type="$1" data-data="$2"></canvas></div></div>');

    // TAHAP 2: PEMROSESAN DAFTAR BERTINGKAT (NESTED BULLET & NUMBERED LIST)
    // Menggunakan algoritma berbasis Stack untuk melacak kedalaman spasi (indentasi)
    const lines = html.split('\n');
    const processedLines = [];
    const listStack = []; // Menyimpan objek { tag: 'ul'|'ol', indent: jumlah_spasi }

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Mendeteksi baris daftar tak berurut (- atau *) beserta spasi di depannya
        const ulMatch = line.match(/^(\s*)([-*])\s+(.*)/);
        // Mendeteksi baris daftar bernomor (1., 2., dst.) beserta spasi di depannya
        const olMatch = line.match(/^(\s*)(\d+\.)\s+(.*)/);

        if (ulMatch || olMatch) {
            const indent = ulMatch ? ulMatch[1].length : olMatch[1].length;
            const content = ulMatch ? ulMatch[3] : olMatch[3];
            const listType = ulMatch ? 'ul' : 'ol';

            // Jika indentasi baris ini lebih kecil dari sebelumnya, tutup daftar yang lebih dalam
            while (listStack.length > 0 && listStack[listStack.length - 1].indent > indent) {
                const closedList = listStack.pop();
                processedLines.push(`</li></${closedList.tag}>`);
            }

            // Jika memulai daftar baru atau masuk ke sub-daftar yang lebih menjorok ke dalam
            if (listStack.length === 0 || listStack[listStack.length - 1].indent < indent) {
                listStack.push({ tag: listType, indent });
                processedLines.push(`<${listType}>`);
            } else if (listStack[listStack.length - 1].indent === indent) {
                // Jika kedalaman indentasi sama namun tipe daftar berganti (misal dari ul ke ol)
                if (listStack[listStack.length - 1].tag !== listType) {
                    processedLines.push(`</li></${listStack.pop().tag}>`);
                    listStack.push({ tag: listType, indent });
                    processedLines.push(`<${listType}>`);
                } else {
                    // Tutup item daftar sebelumnya sebelum membuka item baru di level yang sama
                    processedLines.push(`</li>`);
                }
            }
            processedLines.push(`<li>${content}`);
        } else {
            // Jika baris bukan merupakan daftar, tutup seluruh daftar yang masih terbuka
            while (listStack.length > 0) {
                const closedList = listStack.pop();
                processedLines.push(`</li></${closedList.tag}>`);
            }
            processedLines.push(line);
        }
    }

    // Pastikan seluruh tag daftar yang tersisa di akhir dokumen tertutup dengan rapi
    while (listStack.length > 0) {
        const closedList = listStack.pop();
        processedLines.push(`</li></${closedList.tag}>`);
    }
    html = processedLines.join('\n');

    // TAHAP 3: PEMROSESAN TABEL MARKDOWN (| Kolom 1 | Kolom 2 |)
    const tableRows = html.split('\n');
    let inTable = false;

    for (let i = 0; i < tableRows.length; i++) {
        let line = tableRows[i].trim();
        if (line.startsWith('|')) {
            // Hapus karakter pipa '|' di ujung kanan jika ada
            if (line.endsWith('|')) line = line.slice(1, -1);
            const cells = line.split('|').map(c => c.trim());

            // Mendeteksi baris pemisah header tabel (contoh: |---|---| atau |:---:|---:|)
            if (cells.every(c => /^[-:]+$/.test(c) || c === '')) {
                // Mengubah baris di atas pemisah dari sel biasa (<td>) menjadi sel judul (<th>)
                if (inTable && tableRows[i - 1].includes('<td>')) {
                    tableRows[i - 1] = tableRows[i - 1].replace(/<td>/g, '<th>').replace(/<\/td>/g, '</th>');
                }
                tableRows[i] = '';
                continue;
            }

            const rowHtml = cells.map(c => `<td>${c}</td>`).join('');
            if (!inTable) {
                // Bungkus tabel di dalam .table-responsive agar bisa digeser horizontal di HP
                tableRows[i] = `<div class="table-responsive"><table><tbody><tr>${rowHtml}</tr>`;
                inTable = true;
            } else {
                tableRows[i] = `<tr>${rowHtml}</tr>`;
            }
        } else if (inTable) {
            // Tutup tabel ketika menemui baris non-tabel
            tableRows[i - 1] += '</tbody></table></div>';
            inTable = false;
        }
    }
    if (inTable) tableRows[tableRows.length - 1] += '</tbody></table></div>';

    html = tableRows.filter(line => line !== '').join('\n');

    // TAHAP 4: PEMBERSIHAN BARIS BARU (LINE BREAK CLEANUP)
    // Menghapus karakter newline berlebih di sekitar tag blok agar tidak menciptakan jarak kosong aneh
    html = html.replace(/\n*(<\/?(h1|h2|h3|table|tbody|tr|td|th|div|audio|video|img|ul|ol|li)[^>]*>)\n*/gi, '$1');
    // Membatasi maksimal 2 baris kosong berturut-turut
    html = html.replace(/\n{3,}/g, '\n\n');

    // Mengubah sisa karakter enter (\n) di dalam paragraf menjadi tag <br>
    return html.replace(/\n(?![^<]*>)/g, '<br>');
}