/* ==========================================================================
   PENGONTROL HALAMAN PEMBACA ARTIKEL (VIEW.HTML)
   Lokasi file: website/assets/js/pages/view.js
   
   Tujuan utama file ini:
   1. Membaca parameter ?id=... dari URL dan memvalidasi keberadaan sesi Auto-Login 24 jam.
   2. Mengambil file JSON terenkripsi dari data/articles/ dan mendekripsinya via crypto.js.
   3. Merender isi artikel (parser.js) beserta grafik statistiknya (chart.js).
   4. Membangun menu Daftar Isi (Table of Contents) otomatis dari tag <h2>.
   5. Mengaktifkan ergonomi baca (Reading Progress Bar & Auto-Hide Header saat scroll)
      serta sistem proteksi konten (Anti-Copy, Klik Kanan, & DevTools Guard).
   ========================================================================== */

import { CONFIG } from '../config.js';
import { showToast, delay, initPasswordToggles, registerServiceWorker } from '../utils/dom.js';
import { deriveSessionKeys, decryptWithDerivedKeys, decryptArticle } from '../utils/crypto.js';
import { parseContent } from '../utils/parser.js';
import { renderCharts } from '../utils/chart.js';

registerServiceWorker();

document.addEventListener('DOMContentLoaded', () => {
    const rawId = new URLSearchParams(window.location.search).get('id') || '';
    const currentArticleId = /^[a-zA-Z0-9-_]+$/.test(rawId) ? rawId : '';
    const SESSION_KEY = `sr_key_${currentArticleId}`;

    if (!currentArticleId) {
        window.location.replace('index.html');
        return;
    }

    document.getElementById('articleTargetName').innerText = `ID Dokumen: ${currentArticleId}`;
    localStorage.removeItem(`secure_pwd_${currentArticleId}`);

    let isArticleUnlocked = false;
    let idleTimer = null;
    let tocInitialized = false;
    let ergonomicsInitialized = false;

    initPasswordToggles();
    initSecurityGuards();

    // =========================================================================
    // 1. FUNGSI PENGUNCIAN & PENGATUR WAKTU DIAM (IDLE TIMEOUT)
    // =========================================================================
    function lockArticle(clearSession = true, message = '') {
        clearTimeout(idleTimer);
        if (clearSession) {
            sessionStorage.removeItem(SESSION_KEY);
        }
        isArticleUnlocked = false;

        const contentArea = document.getElementById('decryptedContent');
        if (contentArea) {
            contentArea.innerHTML = '';
            contentArea.style.display = 'none';
        }

        const tocWrapper = document.getElementById('tocWrapper');
        if (tocWrapper) tocWrapper.style.display = 'none';

        const quickLockBtn = document.getElementById('quickLockBtn');
        if (quickLockBtn) quickLockBtn.remove();

        const scrollTopBtn = document.getElementById('scrollTopBtn');
        if (scrollTopBtn) scrollTopBtn.classList.remove('show');

        document.getElementById('mainLoader').style.display = 'none';
        document.getElementById('passwordPrompt').style.display = 'block';

        if (message) {
            showToast(message, 'success');
        }
    }

    function resetIdleTimer() {
        if (!isArticleUnlocked) return;
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
            lockArticle(true, 'Sesi dikunci otomatis karena tidak ada aktivitas selama 15 menit.');
        }, CONFIG.IDLE_TIMEOUT_MS);
    }

    // Pantau aktivitas alami pengguna untuk memperpanjang sesi baca secara mulus
    ['mousemove', 'keydown', 'scroll', 'touchstart', 'click'].forEach((evt) => {
        document.addEventListener(evt, resetIdleTimer, { passive: true });
    });

    // =========================================================================
    // 2. PEMERIKSAAN KUNCI TURUNAN DI SESSIONSTORAGE
    // =========================================================================
    setTimeout(async () => {
        const savedSession = sessionStorage.getItem(SESSION_KEY);
        if (savedSession) {
            try {
                const parsed = JSON.parse(savedSession);
                if (Date.now() < parsed.expiry && parsed.encKeyHex) {
                    await executeDecryption({ derived: parsed }, true);
                    return;
                }
            } catch (_) { /* Abaikan sesi rusak */ }
            sessionStorage.removeItem(SESSION_KEY);
        }

        document.getElementById('mainLoader').style.display = 'none';
        document.getElementById('passwordPrompt').style.display = 'block';
    }, 200);

    document.getElementById('decryptForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const pwd = document.getElementById('readPassword').value;
        await executeDecryption({ password: pwd }, false);
    });

    // =========================================================================
    // 3. EKSEKUSI DEKRIPSI & PENYIAPAN ANTARMUKA BACA
    // =========================================================================
    async function executeDecryption(credentials, isAutoLogin) {
        const btn = document.getElementById('btnUnlock');
        if (!isAutoLogin) {
            btn.textContent = 'Membuka Gembok...';
            btn.disabled = true;
        }

        await delay(50);

        try {
            const res = await fetch(`${CONFIG.ARTICLES_DIR}/${encodeURIComponent(currentArticleId)}.json`);
            if (!res.ok) throw new Error('File dokumen tidak ditemukan di server.');
            const encData = await res.json();

            let plaintext = '';
            let sessionPayload = null;

            if (credentials.derived) {
                plaintext = decryptWithDerivedKeys(
                    encData,
                    credentials.derived.encKeyHex,
                    credentials.derived.macKeyHex
                );
            } else {
                plaintext = decryptArticle(encData, credentials.password);
                if (encData.mac) {
                    const keys = deriveSessionKeys(credentials.password, encData.salt);
                    sessionPayload = {
                        encKeyHex: keys.encKeyHex,
                        macKeyHex: keys.macKeyHex,
                        expiry: Date.now() + CONFIG.AUTO_LOGIN_TTL_MS
                    };
                }
            }

            if (sessionPayload) {
                sessionStorage.setItem(SESSION_KEY, JSON.stringify(sessionPayload));
            }

            const pwInput = document.getElementById('readPassword');
            pwInput.value = '';
            pwInput.type = 'password';

            document.getElementById('mainLoader').style.display = 'none';
            document.getElementById('passwordPrompt').style.display = 'none';

            const contentArea = document.getElementById('decryptedContent');
            contentArea.style.display = 'block';
            contentArea.innerHTML = parseContent(plaintext);
            isArticleUnlocked = true;

            resetIdleTimer();
            renderCharts(contentArea);
            buildTableOfContents(contentArea);
            initQuickLockButton();
            initReadingErgonomics();

            if (!isAutoLogin) {
                showToast('Akses dokumen berhasil dibuka.', 'success');
            }
        } catch (err) {
            console.error('[View] Gagal mendekripsi dokumen:', err);
            sessionStorage.removeItem(SESSION_KEY);
            if (isAutoLogin) {
                document.getElementById('mainLoader').style.display = 'none';
                document.getElementById('passwordPrompt').style.display = 'block';
            } else {
                showToast(err.message || 'Kata sandi salah atau dokumen rusak!', 'error');
                const pwInput = document.getElementById('readPassword');
                pwInput.value = '';
                pwInput.focus();
            }
        } finally {
            if (!isAutoLogin) {
                btn.textContent = 'Buka Gembok';
                btn.disabled = false;
            }
        }
    }

    // =========================================================================
    // 4. TOMBOL KUNCI MANUAL DI HEADER
    // =========================================================================
    function initQuickLockButton() {
        const nav = document.querySelector('.nav-container');
        if (!nav || document.getElementById('quickLockBtn')) return;

        let actionsGroup = nav.querySelector('.view-actions');
        if (!actionsGroup) {
            actionsGroup = document.createElement('div');
            actionsGroup.className = 'view-actions';
            const tocWrapper = document.getElementById('tocWrapper');
            if (tocWrapper) {
                tocWrapper.parentNode.insertBefore(actionsGroup, tocWrapper);
                actionsGroup.appendChild(tocWrapper);
            } else {
                nav.appendChild(actionsGroup);
            }
        }

        const lockBtn = document.createElement('button');
        lockBtn.type = 'button';
        lockBtn.id = 'quickLockBtn';
        lockBtn.className = 'icon-btn';
        lockBtn.setAttribute('aria-label', 'Kunci kembali dokumen sekarang');
        lockBtn.setAttribute('title', 'Kunci Dokumen');
        lockBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`;

        lockBtn.addEventListener('click', () => lockArticle(true, 'Dokumen telah dikunci kembali.'));
        actionsGroup.insertBefore(lockBtn, actionsGroup.firstChild);
    }

    // =========================================================================
    // 5. PENJAGA KEAMANAN DOKUMEN (TANPA MENGGANGGU PINDAH TAB)
    // =========================================================================
    function initSecurityGuards() {
        document.addEventListener('copy', (e) => {
            e.clipboardData.setData('text/plain', 'Peringatan: Dokumen ini terenkripsi. Dilarang menyalin isi rahasia.');
            e.preventDefault();
        });

        document.addEventListener('dragstart', (e) => e.preventDefault());
        document.addEventListener('contextmenu', (e) => e.preventDefault());

        document.addEventListener('keydown', (e) => {
            if (
                e.key === 'F12' ||
                (e.ctrlKey && e.shiftKey && ['I', 'J', 'C', 'i', 'j', 'c'].includes(e.key)) ||
                (e.ctrlKey && ['u', 'p', 's', 'U', 'P', 'S'].includes(e.key))
            ) {
                e.preventDefault();
                return false;
            }
        });

        setInterval(() => {
            const zoomFactor = window.devicePixelRatio || 1;
            const widthDiff = (window.outerWidth - window.innerWidth) * zoomFactor;
            const heightDiff = (window.outerHeight - window.innerHeight) * zoomFactor;
            if (widthDiff > 260 || heightDiff > 260) {
                lockArticle(true);
                window.location.replace('index.html');
            }
        }, 1200);
    }

    // =========================================================================
    // 6. DAFTAR ISI (TABLE OF CONTENTS)
    // =========================================================================
    function buildTableOfContents(container) {
        const headings = container.querySelectorAll('h2');
        const wrapper = document.getElementById('tocWrapper');
        const list = document.getElementById('tocList');
        const btn = document.getElementById('tocBtn');
        const dropdown = document.getElementById('tocDropdown');

        if (headings.length > 0) {
            wrapper.style.display = 'block';
            list.innerHTML = '';

            headings.forEach((h2, idx) => {
                h2.id = `section-${idx}`;
                const a = document.createElement('a');
                a.href = `#${h2.id}`;
                a.className = 'toc-item';
                a.setAttribute('role', 'menuitem');
                a.innerText = h2.innerText;

                a.addEventListener('click', (e) => {
                    e.preventDefault();
                    h2.scrollIntoView({ behavior: 'smooth' });
                    dropdown.classList.remove('show');
                    btn.setAttribute('aria-expanded', 'false');
                });

                list.appendChild(a);
            });
        } else {
            wrapper.style.display = 'none';
        }

        if (!tocInitialized) {
            tocInitialized = true;
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const isExpanded = dropdown.classList.toggle('show');
                btn.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
            });

            document.addEventListener('click', (e) => {
                if (!e.target.closest('#tocWrapper')) {
                    dropdown.classList.remove('show');
                    btn.setAttribute('aria-expanded', 'false');
                }
            });
        }
    }

    // =========================================================================
    // 7. ERGONOMI BACA: PROGRESS BAR, AUTO-HIDE HEADER, & TOMBOL KE ATAS
    // =========================================================================
    function initReadingErgonomics() {
        if (ergonomicsInitialized) return;
        ergonomicsInitialized = true;

        const header = document.querySelector('header');
        const dropdown = document.getElementById('tocDropdown');
        if (!header) return;

        const progressBar = document.createElement('div');
        progressBar.className = 'reading-progress';
        header.appendChild(progressBar);

        const scrollTopBtn = document.createElement('button');
        scrollTopBtn.type = 'button';
        scrollTopBtn.id = 'scrollTopBtn';
        scrollTopBtn.className = 'scroll-top-btn';
        scrollTopBtn.setAttribute('aria-label', 'Kembali ke bagian atas halaman');
        scrollTopBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="18 15 12 9 6 15"></polyline></svg>`;
        scrollTopBtn.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
        document.body.appendChild(scrollTopBtn);

        let lastScrollY = window.scrollY;

        window.addEventListener('scroll', () => {
            const currentScrollY = window.scrollY;
            const docHeight = document.documentElement.scrollHeight - window.innerHeight;

            if (docHeight > 0) {
                const progress = Math.min(100, Math.max(0, (currentScrollY / docHeight) * 100));
                progressBar.style.width = `${progress}%`;
            }

            if (isArticleUnlocked && currentScrollY > 400) {
                scrollTopBtn.classList.add('show');
            } else {
                scrollTopBtn.classList.remove('show');
            }

            if (currentScrollY > 120 && currentScrollY > lastScrollY) {
                header.classList.add('header-hidden');
                if (dropdown) dropdown.classList.remove('show');
            } else {
                header.classList.remove('header-hidden');
            }

            lastScrollY = currentScrollY;
        }, { passive: true });
    }
});