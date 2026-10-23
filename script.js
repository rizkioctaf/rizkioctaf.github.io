/* ==========================================================================
   A. FUNGSI UTILITAS GLOBAL (Dipakai di banyak tempat)
   ========================================================================== */

// Menyimpan daftar grafik (Chart) yang sedang aktif di layar.
// Ini sangat krusial untuk mencegah HP nge-lag / RAM penuh (Memory Leak) 
// dengan cara menghapus grafik lama sebelum menggambar grafik baru.
let activeCharts = [];

/**
 * Fungsi pembuat Notifikasi Pop-up (Toast) yang cantik dan modern.
 * @param {string} message - Pesan yang ingin disampaikan ke pengguna.
 * @param {string} type - 'success' (ikon centang) atau 'error' (ikon silang).
 */
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    // Pilih ikon SVG (Vector) berdasarkan tipe pesan
    if (type === 'error') {
        toast.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg> ${message}`;
    } else {
        toast.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg> ${message}`;
    }
    
    container.appendChild(toast);
    
    // Jeda 10ms agar CSS sempat membaca elemen baru dan memicu animasi masuk
    setTimeout(() => toast.classList.add('show'), 10);
    
    // Hapus notifikasi setelah 3 detik (3000ms)
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300); // Tunggu animasi selesai baru elemen dibuang
    }, 3000);
}

/**
 * Fungsi penunda waktu (Delay) buatan.
 * Sangat berguna untuk memberi jeda agar tulisan "Memproses..." di tombol sempat 
 * muncul sebelum mesin browser membeku (freeze) akibat menghitung algoritma sandi yang berat.
 */
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));


/* ==========================================================================
   B. MESIN PARSER (PENGUBAH TEKS JADI TAMPILAN WEB)
   ========================================================================== */

/**
 * Fungsi ini membaca tulisan rahasia Anda dan mengubah simbol khusus (##, **, dll) 
 * menjadi tag desain HTML yang sesungguhnya.
 */
function parseContent(text) {
    // 1. Mengubah pola Markdown dasar (Judul, Tebal, Miring, Media, dan Grafik)
    let html = text
        .replace(/^### (.*$)/gim, '<h3>$1</h3>')
        .replace(/^## (.*$)/gim, '<h2>$1</h2>')
        .replace(/^# (.*$)/gim, '<h1>$1</h1>')
        .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/gim, '<em>$1</em>')
        .replace(/!\[(.*?)\]\((.*?)\)/gim, '<img alt="$1" src="$2" loading="lazy">') // loading="lazy" agar gambar berat tidak melambatkan web
        .replace(/@audio\[(.*?)\]\((.*?)\)/gim, '<audio controls><source src="$2"></audio>')
        .replace(/@video\[(.*?)\]\((.*?)\)/gim, '<video controls><source src="$2"></video>')
        // Membuat wadah (Canvas) kosong yang nanti akan digambar oleh fungsi renderCharts()
        .replace(/@grafik\[(.*?)\]\((.*?)\)/gim, '<div class="chart-wrapper"><div class="chart-container"><canvas class="custom-chart" data-type="$1" data-data="$2"></canvas></div></div>');

    // 2. Logika Pembuat Tabel (Tahan Bug)
    let inTable = false;
    let tableRows = html.split('\n'); // Pisahkan tiap baris tulisan
    
    for (let i = 0; i < tableRows.length; i++) {
        // Jika baris dimulai dengan garis lurus "|", jadikan itu sebagai tabel
        if (tableRows[i].trim().startsWith('|')) {
            let cells = tableRows[i].split('|').filter(c => c.trim() !== '');
            let rowHtml = cells.map(c => `<td>${c.trim()}</td>`).join('');
            
            if (!inTable) { 
                // Awal tabel
                tableRows[i] = `<div class="table-responsive"><table><tbody><tr>${rowHtml}</tr>`; 
                inTable = true; 
            } else { 
                // Isi tabel
                tableRows[i] = `<tr>${rowHtml}</tr>`; 
            }
        } else if (inTable) { 
            // Akhir tabel (jika menemukan baris kosong / teks biasa)
            tableRows[i-1] += '</tbody></table></div>'; 
            inTable = false; 
        }
    }
    if (inTable) tableRows[tableRows.length - 1] += '</tbody></table></div>';
    html = tableRows.join('\n');

    // 3. Merapikan Enter (Spasi Kosong)
    html = html.replace(/\n*(<\/?(h1|h2|h3|table|tbody|tr|td|div|audio|video|img)[^>]*>)\n*/gi, '$1');
    html = html.replace(/\n{3,}/g, '\n\n'); // Cegah user menekan enter berkali-kali sampai layar bolong
    return html.replace(/\n(?![^<]*>)/g, '<br>');
}

/**
 * Fungsi untuk menggambar grafik visual (Chart.js) dengan Tema Monokrom Murni
 */
function renderCharts(container) {
    // Bersihkan layar dari grafik lama agar browser tidak jebol (Memory Leak)
    activeCharts.forEach(c => c.destroy());
    activeCharts = [];
    
    container.querySelectorAll('.custom-chart').forEach((canvas) => {
        const type = canvas.getAttribute('data-type') === 'line' ? 'line' : 'bar'; 
        const rawData = canvas.getAttribute('data-data'); 
        
        const labels = []; 
        const data = [];   
        
        // Logika Anti-Crash: Memilah data yang benar-benar angka
        if (rawData) {
            rawData.split(',').forEach(item => {
                const parts = item.split(':');
                if (parts.length === 2) {
                    const lbl = parts[0].trim();
                    const val = Number(parts[1].trim()); 
                    // Pastikan yang diinput adalah angka sungguhan, bukan huruf/typo (isNaN = is Not a Number)
                    if (lbl && !isNaN(val)) { 
                        labels.push(lbl); 
                        data.push(val); 
                    }
                }
            });
        }
        
        // Perintah melukis grafik
        const ctx = canvas.getContext('2d');
        const newChart = new Chart(ctx, {
            type: type,
            data: { 
                labels: labels, 
                datasets: [{ 
                    label: 'Data Statistik', 
                    data: data, 
                    backgroundColor: 'rgba(0, 0, 0, 0.6)', // Hitam Monokrom 60% Transparan
                    borderColor: '#000000',                // Garis Pinggir Hitam Pekat Murni
                    borderWidth: 2, 
                    tension: 0.3, // Efek kelengkungan halus
                    fill: type === 'line' 
                }] 
            },
            options: { 
                responsive: true, 
                maintainAspectRatio: false, 
                plugins: { legend: { display: false } } // Legenda dimatikan agar desain minimalis
            }
        });
        
        activeCharts.push(newChart); // Catat grafik baru ini ke buku riwayat
    });
}


/* ==========================================================================
   C. PENGATUR JALUR HALAMAN (ROUTER)
   ========================================================================== */
// Setelah HTML siap 100%, sistem akan mengecek ID halaman untuk menyalakan fungsi yang pas
document.addEventListener('DOMContentLoaded', () => {
    const pageId = document.body.id; 
    
    if (pageId === 'page-index') initIndex();
    else if (pageId === 'page-view') initView();
    else if (pageId === 'page-create') initCreate();
});


/* ==========================================================================
   D. LOGIKA BERANDA (INDEX.HTML) - Virtual Rendering & Pencarian
   ========================================================================== */
function initIndex() {
    let allArticles = [];      // Memori penyimpan SELURUH (jutaan) data artikel
    let filteredArticles = []; // Memori penyimpan hasil saringan pencarian
    let itemsRendered = 0;     // Pencatat jumlah kotak yang sudah tayang
    const itemsPerLoad = 20;   // Batasan tayang tiap scroll (Sangat penting agar HP tidak lag)
    let debounceTimer;         // Penunda mesin pencari

    const container = document.getElementById('articleList');
    const loadTrigger = document.getElementById('loadMoreTrigger');

    // --- Efek Tombol Cari ---
    document.getElementById('searchOpenBtn').addEventListener('click', () => {
        document.getElementById('searchInputGroup').classList.add('active'); 
        document.getElementById('searchOpenBtn').classList.add('hide'); 
        document.getElementById('navContainer').classList.add('search-active');
        
        // PERBAIKAN: Ubah angka 100 menjadi 400. 
        // Ini memastikan kursor baru berkedip (focus) SETELAH animasi CSS selesai sepenuhnya (400ms).
        setTimeout(() => document.getElementById('searchInput').focus(), 400);
    });
    
    document.getElementById('searchCloseBtn').addEventListener('click', () => {
        document.getElementById('searchInputGroup').classList.remove('active');
        document.getElementById('searchOpenBtn').classList.remove('hide');
        document.getElementById('navContainer').classList.remove('search-active');
        
        const input = document.getElementById('searchInput');
        if (input.value) { 
            input.value = ''; // Hapus teks ketikan
            input.dispatchEvent(new Event('input')); // Paksa reset filter ke tampilan normal
        }
    });

    // --- Mengambil Data Master (Metadata.json) ---
    async function fetchMetadata() {
        try {
            const res = await fetch('metadata.json');
            if (!res.ok) throw new Error();
            const data = await res.json();
            
            // Urutkan artikel agar yang paling baru (tanggalnya) berada paling atas
            data.sort((a, b) => new Date(b.date) - new Date(a.date));
            
            allArticles = data;
            filteredArticles = [...allArticles];
            
            renderChunk(true); // Mulai gambar 20 data pertama
        } catch (e) {
            container.innerHTML = `<div class="empty-state" style="color:var(--toast-error)">Gagal memuat metadata. Pastikan berjalan di Local Server.</div>`;
        }
    }

    // --- Pembuat Kotak secara Dicicil (Chunking / Lazy Load) ---
    function renderChunk(reset = false) {
        if (reset) { 
            container.innerHTML = ''; 
            itemsRendered = 0; 
        }
        
        if (filteredArticles.length === 0) {
            container.innerHTML = `<div class="empty-state">Tidak ada artikel yang ditemukan.</div>`;
            return;
        }

        // Iris data (Contoh: iris data index 0 sampai 20)
        const toRender = filteredArticles.slice(itemsRendered, itemsRendered + itemsPerLoad);
        if (toRender.length === 0) return; // Jika mentok, sudahi

        const html = toRender.map(art => `
            <a href="view.html?id=${art.id}" class="article-card" aria-label="Baca artikel: ${art.title}">
                <div class="article-info">
                    <h3>${art.title}</h3>
                    <p>${new Date(art.date).toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
                </div>
                <div class="lock-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                </div>
            </a>
        `).join('');
        
        container.insertAdjacentHTML('beforeend', html);
        itemsRendered += toRender.length;
    }

    // --- Mata-mata Layar (Intersection Observer) ---
    // Jika kotak pemicu transparan di bawah layar terlihat, panggil 20 artikel lagi
    const observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) renderChunk();
    }, { rootMargin: '100px' });
    observer.observe(loadTrigger);

    // --- Logika Mesin Pencari (Debounce) ---
    document.getElementById('searchInput').addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        // Tahan eksekusi selama 300ms saat jari menari di atas keyboard
        debounceTimer = setTimeout(() => {
            const keyword = e.target.value.toLowerCase().trim();
            // Filter 100% menggunakan RAM (Bukan mencari elemen HTML), jadi Anti-Hang!
            filteredArticles = allArticles.filter(art => art.title.toLowerCase().includes(keyword));
            renderChunk(true); 
        }, 300); 
    });

    fetchMetadata();
}


/* ==========================================================================
   E. LOGIKA PEMBACA ARTIKEL (VIEW.HTML) - Dekripsi & Anti-Bocor
   ========================================================================== */
function initView() {
    // Mengambil kata di balik URL (Contoh: view.html?id=berita-1)
    const currentArticleId = new URLSearchParams(window.location.search).get('id');
    const CACHE_KEY = `secure_pwd_${currentArticleId}`; // Kunci brankas ingatan browser
    
    if (!currentArticleId) window.location.replace("index.html");
    else document.getElementById('articleTargetName').innerText = `ID Dokumen: ${currentArticleId}`;

    // --- SISTEM KEAMANAN (Mencegah Kebocoran / Copas Teks) ---
    document.addEventListener('copy', e => { 
        e.clipboardData.setData('text/plain', 'Peringatan: Dokumen ini terenkripsi. Dilarang menyalin isi rahasia.'); 
        e.preventDefault(); 
    });
    // Cegah klik kanan (Mencegah Save Image As / Inspect Element)
    document.addEventListener('contextmenu', e => e.preventDefault());
    // Cegah jalan pintas keyboard milik Developer (Contoh: F12, Ctrl+U, Print Layout)
    document.onkeydown = e => { 
        if (e.keyCode === 123 || (e.ctrlKey && e.shiftKey && (e.keyCode === 73 || e.keyCode === 74 || e.keyCode === 67)) || (e.ctrlKey && (e.keyCode === 85 || e.keyCode === 80 || e.keyCode === 83))) { 
            e.preventDefault(); return false; 
        } 
    };
    // Keamanan Ekstra: Jika ukuran layar menciut drastis (pertanda layar samping Inspect Element dibuka secara paksa), kick pengguna!
    setInterval(() => { 
        if ((window.outerWidth - window.innerWidth > 160) || (window.outerHeight - window.innerHeight > 160)) window.location.replace("index.html"); 
    }, 1000);


    // --- SISTEM LOGIN 24 JAM OTOMATIS ---
    // Ditunda 300ms agar halaman memiliki waktu berkedip di balik layar loading
    setTimeout(async () => {
        const savedData = localStorage.getItem(CACHE_KEY); 
        if (savedData) {
            const parsed = JSON.parse(savedData);
            // Apakah umur password belum sampai 24 jam?
            if (Date.now() < parsed.expiry) {
                await executeDecryption(parsed.pwd, true); 
                return;
            } else {
                localStorage.removeItem(CACHE_KEY); // Jika basi, hapus
            }
        }
        
        // Hapus layar loading dan paksa pengguna mengetik password manual
        document.getElementById('mainLoader').style.display = 'none';
        document.getElementById('passwordPrompt').style.display = 'block';
    }, 300);

    // Ketika pengguna menekan tombol Buka Gembok
    document.getElementById('decryptForm').addEventListener('submit', async (e) => {
        e.preventDefault(); 
        await executeDecryption(document.getElementById('readPassword').value, false);
    });

    /**
     * Mesin Inti Kriptografi (Membuka Sandi AES menggunakan Password + Garam/Salt)
     */
    async function executeDecryption(pwd, isAutoLogin) {
        const btn = document.getElementById('btnUnlock');
        
        if(!isAutoLogin) { 
            btn.textContent = 'Mendekripsi...'; 
            btn.disabled = true; 
        }
        
        // Tarik napas 50ms agar animasi tombol CSS sempat terlihat pengguna
        await delay(50); 

        try {
            // Ambil file yang terenkripsi
            const res = await fetch(`./articles/${currentArticleId}.json`);
            if (!res.ok) throw new Error('File tidak ditemukan');
            const encData = await res.json();
            
            // PBKDF2 (Password-Based Key Derivation Function 2)
            // Memutar password dan Salt sebanyak 10.000 kali agar prosesnya sangat lambat 
            // sehingga hacker penembak sandi (Brute-forcer) akan frustrasi dan kehabisan waktu.
            const key = CryptoJS.PBKDF2(pwd, CryptoJS.enc.Hex.parse(encData.salt), { 
                keySize: 256/32, iterations: 10000, hasher: CryptoJS.algo.SHA256 
            });
            
            // Buka sandi dengan metode AES-CBC
            const decrypted = CryptoJS.AES.decrypt(encData.ciphertext, key, { 
                iv: CryptoJS.enc.Hex.parse(encData.iv), 
                mode: CryptoJS.mode.CBC, 
                padding: CryptoJS.pad.Pkcs7 
            });
            
            const plaintext = decrypted.toString(CryptoJS.enc.Utf8);
            
            // Jika kosong, artinya password tidak cocok sama sekali
            if (!plaintext) throw new Error('Sandi Salah');

            // --- JIKA SUKSES ---
            // Hadiahkan pengguna kebebasan login 24 Jam ke depan
            localStorage.setItem(CACHE_KEY, JSON.stringify({ pwd: pwd, expiry: Date.now() + (24 * 60 * 60 * 1000) }));

            // Ganti tampilan
            document.getElementById('mainLoader').style.display = 'none';
            document.getElementById('passwordPrompt').style.display = 'none';
            
            const contentArea = document.getElementById('decryptedContent');
            contentArea.style.display = 'block';
            contentArea.innerHTML = parseContent(plaintext); // Cetak HTML
            
            renderCharts(contentArea); // Gambar grafik
            buildTableOfContents(contentArea); // Buat daftar isi
            
            showToast('Akses dokumen berhasil dibuka.', 'success');

        } catch (err) {
            // --- JIKA GAGAL ---
            if (isAutoLogin) {
                // Auto-login gagal = Kemungkinan file asli di server sudah dirubah oleh admin.
                localStorage.removeItem(CACHE_KEY);
                document.getElementById('mainLoader').style.display = 'none';
                document.getElementById('passwordPrompt').style.display = 'block';
            } else {
                showToast('Kata sandi salah atau dokumen korup/rusak!', 'error');
                document.getElementById('readPassword').value = '';
                document.getElementById('readPassword').focus();
            }
        } finally {
            if(!isAutoLogin) { 
                btn.textContent = 'Buka Gembok'; 
                btn.disabled = false; 
            }
        }
    }

    // --- Fungsi Daftar Isi (TOC) ---
    function buildTableOfContents(container) {
        const headings = container.querySelectorAll('h2'); // Hanya memburu Sub-Judul Utama
        
        if (headings.length > 0) {
            const wrapper = document.getElementById('tocWrapper');
            const list = document.getElementById('tocList');
            const btn = document.getElementById('tocBtn');
            
            wrapper.style.display = 'block';
            
            headings.forEach((h2, idx) => {
                h2.id = `h2-${idx}`;
                const a = document.createElement('a');
                a.href = `#${h2.id}`; 
                a.className = 'toc-item'; 
                a.innerText = h2.innerText;
                
                a.onclick = e => { 
                    e.preventDefault(); 
                    h2.scrollIntoView({ behavior:'smooth' }); // Meluncur mulus ke tujuan
                    document.getElementById('tocDropdown').classList.remove('show'); 
                    btn.setAttribute('aria-expanded', 'false'); // Untuk pembaca layar
                };
                list.appendChild(a);
            });
        }
    }

    // Fungsi klik buka-tutup TOC
    document.getElementById('tocBtn').onclick = function(e) { 
        e.stopPropagation(); 
        const dropdown = document.getElementById('tocDropdown');
        const isExpanded = dropdown.classList.toggle('show'); 
        this.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
    };
    document.onclick = e => { 
        if (!e.target.closest('#tocWrapper')) {
            document.getElementById('tocDropdown').classList.remove('show'); 
            document.getElementById('tocBtn').setAttribute('aria-expanded', 'false');
        }
    };
}


/* ==========================================================================
   F. LOGIKA STUDIO PEMBUAT (CREATE.HTML) - Editor & Generator
   ========================================================================== */
function initCreate() {
    let debounceTimer;

    // --- Live Preview Pintar (Debounce) ---
    // Jangan menyiksa memori RAM dengan mengkalkulasi ulang tampilan tiap 1 huruf diketik.
    // Tahan kalkulasi sampai penulis berhenti mengetik selama 500ms.
    document.getElementById('articleContent').addEventListener('input', function() {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            const val = this.value;
            const prev = document.getElementById('previewContainer');
            
            if(!val.trim()) { 
                prev.innerHTML = '<div style="text-align:center; color:var(--text-muted); margin-top:100px;">Mulai mengetik di kolom sebelah kiri untuk melihat hasil desain secara langsung...</div>'; 
                return; 
            }
            
            prev.innerHTML = parseContent(val);
            renderCharts(prev);
        }, 500);
    });

    // --- Fungsi Utama Penulis (Mengunci Artikel) ---
    window.encryptAndGenerate = async function() {
        // Membersihkan ID Artikel menggunakan REGEX (Membuang karakter spasi & simbol aneh)
        const id = document.getElementById('articleId').value.trim().replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase(); 
        const title = document.getElementById('articleTitle').value.trim();
        const pwd = document.getElementById('articlePassword').value;
        const content = document.getElementById('articleContent').value;
        const btn = document.getElementById('btnEncrypt');

        // Proteksi Form Kosong
        if (!id || !title || !pwd || !content) { 
            showToast('Harap isi semua kolom termasuk isi konten artikel!', 'error'); 
            return; 
        }

        btn.textContent = 'Memproses Kriptografi...'; 
        btn.disabled = true;
        await delay(50); // Jeda anti-beku UI

        try {
            // 1. Buat Bumbu Pengacak (Salt & Initialization Vector)
            // Tanpa ini, jika 2 artikel punya isi dan sandi sama, pola enkripsinya akan sama.
            // Dengan Salt/IV, pola hasil enkripsi akan SELALU BERUBAH ACAK meskipun passwordnya kembar.
            const salt = CryptoJS.lib.WordArray.random(128/8);
            const iv = CryptoJS.lib.WordArray.random(128/8);
            
            // 2. Aduk Password dengan Garam/Salt (PBKDF2)
            const key = CryptoJS.PBKDF2(pwd, salt, { 
                keySize: 256/32, iterations: 10000, hasher: CryptoJS.algo.SHA256 
            });
            
            // 3. Masukkan ke Mesin Cincang (Enkripsi AES Mode CBC)
            const enc = CryptoJS.AES.encrypt(content, key, { 
                iv: iv, padding: CryptoJS.pad.Pkcs7, mode: CryptoJS.mode.CBC 
            });

            // 4. Bungkus hasilnya menjadi file teks JSON siap unduh
            // PENTING: Password asli Anda SAMA SEKALI tidak diikutkan dalam penyimpanan ini!
            const dataToSave = JSON.stringify({ 
                salt: CryptoJS.enc.Hex.stringify(salt), 
                iv: CryptoJS.enc.Hex.stringify(iv), 
                ciphertext: enc.toString() 
            }, null, 2);

            // 5. Trik Mendownload File secara Langsung via Client-Side JS (Tanpa Backend/PHP)
            const blob = new Blob([dataToSave], { type: 'application/json' });
            const a = document.createElement('a'); 
            a.href = URL.createObjectURL(blob); 
            a.download = `${id}.json`; // File akan diunduh dengan nama ID
            
            document.body.appendChild(a); 
            a.click(); // Paksa klik
            document.body.removeChild(a);

            // 6. Siapkan tulisan informasi untuk file "metadata.json"
            const metaStr = JSON.stringify({ id: id, title: title, date: new Date().toISOString().split('T')[0] }, null, 2);
            document.getElementById('metadataResult').style.display = 'block';
            document.getElementById('metadataResult').innerHTML = `<b>✅ Enkripsi Selesai!</b> File <b>${id}.json</b> berhasil diunduh.<br>Pindahkan file tersebut ke folder /articles/ Anda.<br><br>Selanjutnya, tambahkan kode baru ini ke dalam file metadata.json:<pre>${metaStr},</pre>`;
            
            showToast('Dokumen berhasil dienkripsi dan diunduh.', 'success');

        } catch (e) { 
            showToast('Terjadi kesalahan sistem saat mencoba enkripsi.', 'error'); 
        } finally { 
            btn.textContent = 'Enkripsi & Unduh .json'; 
            btn.disabled = false; 
        }
    };
}


/* ==========================================================================
   G. PENDAFTARAN MODE OFFLINE (PWA SERVICE WORKER)
   ========================================================================== */
// Cek jika browser yang dipakai modern dan mendukung fitur Offline
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(registration => {
                console.log('✅ Sistem Keamanan Offline (Service Worker) aktif bersiaga.', registration.scope);
            })
            .catch(error => {
                console.error('❌ Gagal mengaktifkan sistem offline:', error);
            });
    });
}
