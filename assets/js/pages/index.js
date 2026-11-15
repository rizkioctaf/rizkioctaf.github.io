/* ==========================================================================
   PENGONTROL HALAMAN BERANDA (INDEX.HTML)
   Lokasi file: website/assets/js/pages/index.js
   
   Tujuan utama file ini:
   1. Mengambil daftar indeks artikel dari data/metadata.json.
   2. Mengurutkan artikel berdasarkan tanggal terbaru secara otomatis.
   3. Merender kartu artikel secara bertahap (Virtual Rendering / Chunking)
      menggunakan IntersectionObserver agar tetap super ringan meski artikel ribuan.
   4. Mengelola bilah pencarian interaktif dengan jeda debounce (300ms).
   ========================================================================== */

import { CONFIG } from '../config.js';
import { escapeHTML, registerServiceWorker } from '../utils/dom.js';

registerServiceWorker();

document.addEventListener('DOMContentLoaded', () => {
    let allArticles = [];
    let filteredArticles = [];
    let itemsRendered = 0;
    let debounceTimer;

    const container = document.getElementById('articleList');
    const loadTrigger = document.getElementById('loadMoreTrigger');
    const searchInput = document.getElementById('searchInput');
    const searchInputGroup = document.getElementById('searchInputGroup');
    const searchOpenBtn = document.getElementById('searchOpenBtn');
    const searchCloseBtn = document.getElementById('searchCloseBtn');
    const navContainer = document.getElementById('navContainer');

    // =========================================================================
    // 1. LOGIKA BUKA/TUTUP BILAH PENCARIAN NATURAL
    // =========================================================================
    searchOpenBtn.addEventListener('click', () => {
        searchInputGroup.classList.add('active');
        searchOpenBtn.classList.add('hide');
        navContainer.classList.add('search-active');
        setTimeout(() => searchInput.focus(), 180);
    });

    searchCloseBtn.addEventListener('click', () => {
        searchInputGroup.classList.remove('active');
        searchOpenBtn.classList.remove('hide');
        navContainer.classList.remove('search-active');

        if (searchInput.value) {
            searchInput.value = '';
            filteredArticles = [...allArticles];
            renderChunk(true);
        }
    });

    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            searchCloseBtn.click();
        }
    });

    // =========================================================================
    // 2. PEMFORMATAN TANGGAL AMAN (ANTI "INVALID DATE")
    // =========================================================================
    function formatSafeDate(dateStr) {
        if (!dateStr) return 'Tanpa tanggal';
        const parsed = new Date(dateStr);
        if (Number.isNaN(parsed.getTime())) {
            return String(dateStr);
        }
        return parsed.toLocaleDateString('id-ID', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    }

    // =========================================================================
    // 3. PENGAMBILAN DATA METADATA DARI SERVER
    // =========================================================================
    async function fetchMetadata() {
        try {
            const res = await fetch(CONFIG.METADATA_PATH);
            if (!res.ok) throw new Error(`Status HTTP: ${res.status}`);

            const data = await res.json();
            if (!Array.isArray(data)) throw new Error('Format metadata bukan array.');

            // Urutkan terbaru ke terlama dengan penanganan aman jika tanggal tidak valid
            data.sort((a, b) => {
                const timeA = new Date(a.date).getTime() || 0;
                const timeB = new Date(b.date).getTime() || 0;
                return timeB - timeA;
            });

            allArticles = data;
            filteredArticles = [...allArticles];
            renderChunk(true);
        } catch (err) {
            console.error('[Index] Error memuat metadata:', err);
            container.innerHTML = `
                <div class="empty-state">
                    Gagal memuat daftar artikel. Pastikan aplikasi dijalankan melalui server lokal (HTTP/HTTPS) dan file <code>data/metadata.json</code> tersedia.
                </div>`;
        }
    }

    function renderChunk(reset = false) {
        if (reset) {
            container.innerHTML = '';
            itemsRendered = 0;
        }

        if (filteredArticles.length === 0) {
            container.innerHTML = `<div class="empty-state">Tidak ada dokumen yang cocok dengan kata kunci pencarian Anda.</div>`;
            return;
        }

        const toRender = filteredArticles.slice(itemsRendered, itemsRendered + CONFIG.ITEMS_PER_LOAD);
        if (toRender.length === 0) return;

        const html = toRender.map(art => {
            const safeTitle = escapeHTML(art.title || 'Dokumen Tanpa Judul');
            const safeDate = escapeHTML(formatSafeDate(art.date));
            const safeId = encodeURIComponent(art.id || '');

            return `
                <a href="view.html?id=${safeId}" class="article-card" role="listitem" aria-label="Buka dokumen: ${safeTitle}">
                    <div class="article-info">
                        <h3>${safeTitle}</h3>
                        <p>${safeDate}</p>
                    </div>
                    <div class="lock-icon" aria-hidden="true">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                        </svg>
                    </div>
                </a>
            `;
        }).join('');

        container.insertAdjacentHTML('beforeend', html);
        itemsRendered += toRender.length;
    }

    const observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) {
            renderChunk(false);
        }
    }, { rootMargin: '100px' });
    observer.observe(loadTrigger);

    searchInput.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            const keyword = e.target.value.toLowerCase().trim();
            filteredArticles = allArticles.filter(art =>
                String(art.title || '').toLowerCase().includes(keyword)
            );
            renderChunk(true);
        }, CONFIG.SEARCH_DEBOUNCE_MS);
    });

    fetchMetadata();
});