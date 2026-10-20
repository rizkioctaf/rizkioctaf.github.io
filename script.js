// ==========================================
// A. FUNGSI SHARED (Digunakan Bersama)
// ==========================================
let activeCharts = []; // Global untuk mencegah memory leak chart

// Custom Markdown & Parser
function parseContent(text) {
    let html = text
        .replace(/^### (.*$)/gim, '<h3>$1</h3>')
        .replace(/^## (.*$)/gim, '<h2>$1</h2>')
        .replace(/^# (.*$)/gim, '<h1>$1</h1>')
        .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/gim, '<em>$1</em>')
        .replace(/!\[(.*?)\]\((.*?)\)/gim, '<img alt="$1" src="$2">')
        .replace(/@audio\[(.*?)\]\((.*?)\)/gim, '<audio controls><source src="$2"></audio>')
        .replace(/@video\[(.*?)\]\((.*?)\)/gim, '<video controls><source src="$2"></video>')
        .replace(/@grafik\[(.*?)\]\((.*?)\)/gim, '<div class="chart-wrapper"><div class="chart-container"><canvas class="custom-chart" data-type="$1" data-data="$2"></canvas></div></div>');

    let inTable = false;
    let tableRows = html.split('\n');
    for (let i = 0; i < tableRows.length; i++) {
        if (tableRows[i].trim().startsWith('|')) {
            let cells = tableRows[i].split('|').filter(c => c.trim() !== '');
            let rowHtml = cells.map(c => `<td>${c.trim()}</td>`).join('');
            if (!inTable) { 
                tableRows[i] = `<div class="table-responsive"><table><tbody><tr>${rowHtml}</tr>`; 
                inTable = true; 
            } else { tableRows[i] = `<tr>${rowHtml}</tr>`; }
        } else if (inTable) { tableRows[i-1] += '</tbody></table></div>'; inTable = false; }
    }
    if (inTable) tableRows[tableRows.length - 1] += '</tbody></table></div>';
    html = tableRows.join('\n');

    html = html.replace(/\n*(<\/?(h1|h2|h3|table|tbody|tr|td|div|audio|video|img)[^>]*>)\n*/gi, '$1');
    html = html.replace(/\n{3,}/g, '\n\n');
    html = html.replace(/\n(?![^<]*>)/g, '<br>');
    return html;
}

// Chart JS Renderer
function renderCharts(container) {
    activeCharts.forEach(c => c.destroy());
    activeCharts = [];
    container.querySelectorAll('.custom-chart').forEach((canvas) => {
        const type = canvas.getAttribute('data-type'); 
        const rawData = canvas.getAttribute('data-data'); 
        const labels = [], data = [];
        
        rawData.split(',').forEach(item => {
            const [lbl, val] = item.split(':');
            if(lbl && val && !isNaN(Number(val.trim()))) {
                labels.push(lbl.trim());
                data.push(Number(val.trim()));
            }
        });

        activeCharts.push(new Chart(canvas.getContext('2d'), {
            type: type === 'line' ? 'line' : 'bar',
            data: { labels: labels, datasets: [{ label: 'Statistik', data: data, backgroundColor: 'rgba(79, 70, 229, 0.7)', borderColor: '#4F46E5', borderWidth: 2, tension: 0.3, fill: type === 'line' }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
        }));
    });
}

// ==========================================
// B. ROUTER (Menjalankan fungsi sesuai halaman)
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    const pageId = document.body.id;

    if (pageId === 'page-index') initIndex();
    else if (pageId === 'page-view') initView();
    else if (pageId === 'page-create') initCreate();
});


// ==========================================
// C. LOGIKA INDEX.HTML
// ==========================================
function initIndex() {
    let allArticles = [];
    let debounceTimer;

    const openBtn = document.getElementById('searchOpenBtn');
    const closeBtn = document.getElementById('searchCloseBtn');
    const searchGroup = document.getElementById('searchInputGroup');
    const searchInput = document.getElementById('searchInput');
    const navContainer = document.getElementById('navContainer');

    // UI Animasi Pencarian
    openBtn.addEventListener('click', () => {
        searchGroup.classList.add('active'); openBtn.classList.add('hide'); navContainer.classList.add('search-active');
        setTimeout(() => searchInput.focus(), 100);
    });

    closeBtn.addEventListener('click', () => {
        searchGroup.classList.remove('active'); openBtn.classList.remove('hide'); navContainer.classList.remove('search-active');
        if(searchInput.value.trim() !== '') { searchInput.value = ''; searchInput.dispatchEvent(new Event('input')); }
    });

    // Fetch Metadata
    async function fetchMetadata() {
        try {
            const response = await fetch('metadata.json');
            if (!response.ok) throw new Error();
            let data = await response.json();
            data.sort((a, b) => new Date(b.date) - new Date(a.date));
            allArticles = data;
            renderArticleList(allArticles);
        } catch (error) {
            document.getElementById('articleList').innerHTML = `<div class="empty-state" style="color:var(--danger)">Gagal memuat metadata.json. Pastikan server lokal berjalan.</div>`;
        }
    }

    function renderArticleList(articles) {
        const container = document.getElementById('articleList');
        if (articles.length === 0) {
            container.innerHTML = `<div class="empty-state">Tidak ada artikel yang ditemukan.</div>`;
            return;
        }
        container.innerHTML = articles.map(art => `
            <a href="view.html?id=${art.id}" class="article-card">
                <div class="article-info">
                    <h3>${art.title}</h3>
                    <p>${new Date(art.date).toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
                </div>
                <div class="lock-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg></div>
            </a>
        `).join('');
    }

    searchInput.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            const keyword = e.target.value.toLowerCase().trim();
            renderArticleList(allArticles.filter(art => art.title.toLowerCase().includes(keyword)));
        }, 300); 
    });

    fetchMetadata();
}


// ==========================================
// D. LOGIKA VIEW.HTML
// ==========================================
function initView() {
    const currentArticleId = new URLSearchParams(window.location.search).get('id');
    const CACHE_KEY = `secure_pwd_${currentArticleId}`; 

    if (!currentArticleId) window.location.replace("index.html");
    else document.getElementById('articleTargetName').innerText = `Membaca: ${currentArticleId}`;

    // Sistem Keamanan
    document.addEventListener('copy', e => { e.clipboardData.setData('text/plain', 'Peringatan: Artikel ini bersifat rahasia.'); e.preventDefault(); });
    document.addEventListener('contextmenu', e => e.preventDefault());
    document.onkeydown = e => {
        if (e.keyCode === 123 || (e.ctrlKey && e.shiftKey && (e.keyCode === 73 || e.keyCode === 74 || e.keyCode === 67)) || (e.ctrlKey && (e.keyCode === 85 || e.keyCode === 80 || e.keyCode === 83))) {
            e.preventDefault(); return false;
        }
    };
    setInterval(() => {
        if ((window.outerWidth - window.innerWidth > 160) || (window.outerHeight - window.innerHeight > 160)) window.location.replace("index.html");
    }, 1000);

    // Auto Login 24 Jam
    const savedData = localStorage.getItem(CACHE_KEY);
    if (savedData) {
        const parsed = JSON.parse(savedData);
        if (Date.now() < parsed.expiry) executeDecryption(parsed.pwd, true);
        else localStorage.removeItem(CACHE_KEY);
    }

    document.getElementById('decryptForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        await executeDecryption(document.getElementById('readPassword').value, false);
    });

    async function executeDecryption(pwd, isAutoLogin) {
        const btn = document.getElementById('btnUnlock');
        const errorMsg = document.getElementById('errorMsg');
        
        errorMsg.style.display = 'none'; btn.textContent = 'Mendekripsi...'; btn.disabled = true;

        try {
            const res = await fetch(`./articles/${currentArticleId}.json`);
            if (!res.ok) throw new Error('File tidak ditemukan');
            const encData = await res.json();
            const key = CryptoJS.PBKDF2(pwd, CryptoJS.enc.Hex.parse(encData.salt), { keySize: 256/32, iterations: 10000, hasher: CryptoJS.algo.SHA256 });
            const decrypted = CryptoJS.AES.decrypt(encData.ciphertext, key, { iv: CryptoJS.enc.Hex.parse(encData.iv), mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 });
            const plaintext = decrypted.toString(CryptoJS.enc.Utf8);
            
            if (!plaintext) throw new Error();

            localStorage.setItem(CACHE_KEY, JSON.stringify({ pwd: pwd, expiry: Date.now() + (24 * 60 * 60 * 1000) }));

            document.getElementById('passwordPrompt').style.display = 'none';
            const contentArea = document.getElementById('decryptedContent');
            contentArea.style.display = 'block';
            contentArea.innerHTML = parseContent(plaintext);
            
            renderCharts(contentArea);
            buildTableOfContents(contentArea);

        } catch (err) {
            if (isAutoLogin) localStorage.removeItem(CACHE_KEY); 
            else { errorMsg.style.display = 'block'; document.getElementById('readPassword').value = ''; document.getElementById('readPassword').focus(); }
        } finally {
            btn.textContent = 'Buka Gembok'; btn.disabled = false;
        }
    }

    // Daftar Isi (TOC)
    function buildTableOfContents(container) {
        const headings = container.querySelectorAll('h2');
        const tocWrapper = document.getElementById('tocWrapper');
        const tocList = document.getElementById('tocList');
        
        if (headings.length > 0) {
            tocWrapper.style.display = 'block';
            headings.forEach((h2, idx) => {
                const headingId = `subjudul-${idx}`; h2.id = headingId;
                const link = document.createElement('a');
                link.href = `#${headingId}`; link.className = 'toc-item'; link.innerText = h2.innerText;
                link.addEventListener('click', (e) => {
                    e.preventDefault();
                    h2.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    document.getElementById('tocDropdown').classList.remove('show');
                });
                tocList.appendChild(link);
            });
        }
    }

    document.getElementById('tocBtn').addEventListener('click', (e) => {
        e.stopPropagation(); document.getElementById('tocDropdown').classList.toggle('show');
    });
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#tocWrapper')) document.getElementById('tocDropdown').classList.remove('show');
    });
}


// ==========================================
// E. LOGIKA CREATE.HTML
// ==========================================
function initCreate() {
    let debounceTimer;

    // Live Preview
    document.getElementById('articleContent').addEventListener('input', function() {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            const content = this.value;
            const preview = document.getElementById('previewContainer');
            if(!content.trim()) {
                preview.innerHTML = `<div style="text-align:center; color:var(--text-muted); margin-top:100px;"><p>Mulai mengetik untuk melihat pratinjau...</p></div>`;
                return;
            }
            preview.innerHTML = parseContent(content);
            renderCharts(preview); 
        }, 500); 
    });

    // Enkripsi & Generate
    window.encryptAndGenerate = function() {
        let id = document.getElementById('articleId').value.trim().replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase(); 
        const title = document.getElementById('articleTitle').value.trim();
        const password = document.getElementById('articlePassword').value;
        const content = document.getElementById('articleContent').value;

        if (!id || !title || !password || !content) return alert('Isi seluruh form!');

        try {
            const salt = CryptoJS.lib.WordArray.random(128 / 8);
            const iv = CryptoJS.lib.WordArray.random(128 / 8);
            const key = CryptoJS.PBKDF2(password, salt, { keySize: 256 / 32, iterations: 10000, hasher: CryptoJS.algo.SHA256 });
            const encrypted = CryptoJS.AES.encrypt(content, key, { iv: iv, padding: CryptoJS.pad.Pkcs7, mode: CryptoJS.mode.CBC });

            const fileData = {
                salt: CryptoJS.enc.Hex.stringify(salt),
                iv: CryptoJS.enc.Hex.stringify(iv),
                ciphertext: encrypted.toString()
            };

            const blob = new Blob([JSON.stringify(fileData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = `${id}.json`;
            document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);

            const metaBox = document.getElementById('metadataResult');
            metaBox.style.display = 'block';
            metaBox.innerHTML = `<p>✅ Berhasil! Pindahkan <b>${id}.json</b> ke folder /articles/ dan tambahkan JSON berikut ke metadata.json:</p>
            <pre>${JSON.stringify({ id: id, title: title, date: new Date().toISOString().split('T')[0] }, null, 2)},</pre>`;

        } catch (error) { alert('Terjadi kesalahan enkripsi.'); }
    };
}