/**
 * ==========================================================================
 * FILE: parser.js
 * DESKRIPSI: Mesin Penerjemah Dokumen Teks & Media (ZineParser)
 * Edisi Lengkap & Final — Selaras 100% dengan index.html, view.html & style.css
 *
 * Fitur Lengkap:
 * 1. Time-Sliced Rendering (1.500 baris/frame) via requestAnimationFrame
 * 2. Generation Token (_currentRenderId) untuk pembatalan render tumpang-tindih
 * 3. Kompatibilitas Callback Progres langsung (fn) & objek ({ onProgress })
 * 4. Pembersihan UTF-8 BOM & karakter kontrol biner tanpa merusak Tab/Newline
 * 5. Sanitasi URL ketat anti-XSS & anti-Directory Traversal (DOM API murni)
 * 6. Click-to-Load Media Facade (0 KB beban awal) untuk Video & Audio
 * 7. Pengatur Pemutaran Media Tunggal & pembersihan sumber saat pindah halaman
 * 8. Kartu Lampiran & Unduhan Langsung (.txt, .zip, .rar, .7z, .pdf, dll.)
 * 9. Grafik Batang & Garis Canvas 2D (DPR 2x, nilai negatif, downsampling,
 *    serta adaptasi otomatis tema kertas Putih / Sepia / Gelap)
 * 10. Daftar bersarang 3 tingkat lintas chunk, tajuk H1-H3, & format sebaris
 * ==========================================================================
 */

const ZineParser = {
  CHUNK_SIZE: 1500,
  MAX_CANVAS_WIDTH: 12000,
  MAX_LIST_DEPTH: 3,
  debugMode: false,

  _currentRenderId: 0,
  _activeMediaElement: null,
  _chartRenderers: [],
  _themeObserverAttached: false,

  // Daftar ekstensi berkas lampiran yang diizinkan untuk unduhan langsung
  ALLOWED_FILE_EXTENSIONS: [
    'txt', 'zip', 'rar', '7z', 'tar', 'gz',
    'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
    'csv', 'json', 'xml', 'md', 'epub'
  ],

  IMAGE_EXTENSIONS: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'],
  VIDEO_EXTENSIONS: ['mp4', 'webm', 'ogv', 'mov'],
  AUDIO_EXTENSIONS: ['mp3', 'ogg', 'wav', 'm4a', 'flac', 'aac'],

  /**
   * Membersihkan karakter BOM UTF-8 dan karakter kontrol biner tersembunyi
   * tanpa merusak baris baru (\n) maupun indentasi tabulasi (\t).
   */
  sanitizeRawText(rawText) {
    if (typeof rawText !== 'string') return '';
    return rawText
      .replace(/^\uFEFF/, '')
      .replace(/\r\n?/g, '\n')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  },

  /**
   * Memvalidasi URL tautan eksternal maupun jalur aset lokal.
   * Menolak skema berbahaya (javascript:, data:, file:, vbscript:, http:, //)
   * serta mencegah traversal direktori (..) dan backslash (\).
   */
  sanitizeMediaUrl(rawUrl) {
    if (typeof rawUrl !== 'string') return null;
    const trimmed = rawUrl.trim();
    if (!trimmed) return null;

    if (/[\x00-\x1F\x7F]/.test(trimmed)) return null;

    // Izinkan hanya protokol HTTPS untuk tautan eksternal
    if (/^https:\/\//i.test(trimmed)) {
      try {
        const parsed = new URL(trimmed);
        return parsed.protocol === 'https:' ? parsed.href : null;
      } catch (_) {
        return null;
      }
    }

    // Blokir skema protokol lain maupun protocol-relative (//)
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) || trimmed.startsWith('//')) {
      return null;
    }

    // Validasi jalur relatif lokal: tolak backslash dan traversal direktori (..)
    if (trimmed.includes('\\')) return null;
    const segments = trimmed.split('?')[0].split('#')[0].split('/');
    if (segments.some((seg) => seg === '..')) {
      return null;
    }

    return trimmed;
  },

  /**
   * Mencatat elemen media aktif dan menjeda media sebelumnya agar audio tidak bertumpuk.
   */
  registerActiveMedia(mediaEl) {
    if (this._activeMediaElement && this._activeMediaElement !== mediaEl) {
      try {
        this._activeMediaElement.pause();
      } catch (_) {
        // Abaikan jika elemen sudah dilepas dari DOM
      }
    }
    this._activeMediaElement = mediaEl;
  },

  /**
   * Menghentikan pemutaran media aktif dan melepas sumbernya saat berpindah artikel.
   */
  stopAllMedia() {
    if (this._activeMediaElement) {
      try {
        this._activeMediaElement.pause();
        this._activeMediaElement.removeAttribute('src');
        this._activeMediaElement.load();
      } catch (_) {
        // Abaikan galat pembersihan media
      }
      this._activeMediaElement = null;
    }
  },

  /**
   * Mengembalikan label kategori berkas lampiran berdasarkan ekstensi.
   */
  getFileCategoryLabel(ext) {
    const cleanExt = (ext || '').toLowerCase();
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(cleanExt)) return 'ARSIP KOMPRESI';
    if (['txt', 'md', 'csv', 'json', 'xml'].includes(cleanExt)) return 'DOKUMEN TEKS / DATA';
    if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'epub'].includes(cleanExt)) {
      return 'DOKUMEN KANTOR / E-BOOK';
    }
    return 'BERKAS LAMPIRAN';
  },

  /**
   * Membuat kartu lampiran berkas dengan tombol unduh langsung (0 KB beban awal).
   */
  createFileDownloadCard(rawUrl, captionText = '') {
    const safeUrl = this.sanitizeMediaUrl(rawUrl);
    if (!safeUrl) {
      const errBox = document.createElement('div');
      errBox.className = 'retro-media-error';
      errBox.textContent = '[Lampiran ditolak: jalur berkas tidak valid atau tidak aman]';
      return errBox;
    }

    const cleanPath = safeUrl.split('?')[0].split('#')[0];
    const fileName = cleanPath.split('/').pop() || 'berkas-unduhan';
    const extMatch = fileName.match(/\.([a-z0-9]+)$/i);
    const ext = extMatch ? extMatch[1].toLowerCase() : '';

    if (!this.ALLOWED_FILE_EXTENSIONS.includes(ext)) {
      const warnBox = document.createElement('div');
      warnBox.className = 'retro-media-error';
      warnBox.textContent = `[Format berkas .${ext || 'unknown'} tidak didukung untuk lampiran]`;
      return warnBox;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'retro-file-card';

    const infoRow = document.createElement('div');
    infoRow.className = 'retro-file-info';

    const badge = document.createElement('span');
    badge.className = 'retro-file-badge';
    badge.textContent = `[${ext.toUpperCase()}]`;

    const metaGroup = document.createElement('div');
    metaGroup.className = 'retro-file-meta';

    const titleEl = document.createElement('strong');
    titleEl.className = 'retro-file-name';
    titleEl.textContent = fileName;

    const subEl = document.createElement('span');
    subEl.className = 'retro-file-sub';
    subEl.textContent = captionText
      ? `${this.getFileCategoryLabel(ext)} — ${captionText}`
      : this.getFileCategoryLabel(ext);

    metaGroup.appendChild(titleEl);
    metaGroup.appendChild(subEl);

    infoRow.appendChild(badge);
    infoRow.appendChild(metaGroup);

    const downloadBtn = document.createElement('a');
    downloadBtn.className = 'retro-file-download-btn';
    downloadBtn.href = safeUrl;
    downloadBtn.setAttribute('download', fileName);
    downloadBtn.setAttribute('rel', 'noopener noreferrer');
    downloadBtn.textContent = `[ Unduh Berkas (.${ext}) ]`;

    wrapper.appendChild(infoRow);
    wrapper.appendChild(downloadBtn);

    return wrapper;
  },

  /**
   * Membuat blok gambar dengan lazy loading, async decoding, dan keterangan opsional.
   */
  createImageBlock(rawUrl, captionText = '') {
    const safeUrl = this.sanitizeMediaUrl(rawUrl);
    if (!safeUrl) {
      const errBox = document.createElement('div');
      errBox.className = 'retro-media-error';
      errBox.textContent = '[Gambar ditolak: jalur berkas tidak valid atau tidak aman]';
      return errBox;
    }

    const box = document.createElement('div');
    box.className = 'retro-media-box';

    const img = document.createElement('img');
    img.src = safeUrl;
    img.alt = captionText || 'Ilustrasi Artikel';
    img.loading = 'lazy';
    img.decoding = 'async';

    img.onerror = () => {
      const fallback = document.createElement('div');
      fallback.className = 'retro-media-error';
      fallback.textContent = `[Gagal memuat gambar: ${safeUrl}]`;
      box.replaceWith(fallback);
    };

    box.appendChild(img);

    if (captionText) {
      const cap = document.createElement('div');
      cap.className = 'retro-media-caption';
      cap.textContent = captionText;
      box.appendChild(cap);
    }

    return box;
  },

  /**
   * Membuat Click-to-Load Media Facade untuk Video dan Audio (0 KB beban awal).
   */
  createMediaFacade(type, rawUrl, captionText = '') {
    const safeUrl = this.sanitizeMediaUrl(rawUrl);
    if (!safeUrl) {
      const errBox = document.createElement('div');
      errBox.className = 'retro-media-error';
      errBox.textContent = `[${type.toUpperCase()} ditolak: jalur berkas tidak valid atau tidak aman]`;
      return errBox;
    }

    const cleanPath = safeUrl.split('?')[0].split('#')[0];
    const fileName = cleanPath.split('/').pop() || `${type}-media`;

    const outerBox = document.createElement('div');
    outerBox.className = 'retro-media-box';

    const facade = document.createElement('div');
    facade.className =
      type === 'audio' ? 'retro-media-facade is-audio' : 'retro-media-facade';

    const badgeEl = document.createElement('div');
    badgeEl.className = 'retro-media-facade-badge';
    badgeEl.textContent =
      type === 'video'
        ? `[VIDEO SIAP PUTAR] ${fileName}`
        : `[AUDIO SIAP PUTAR] ${fileName}`;

    const hintEl = document.createElement('div');
    hintEl.className = 'retro-media-facade-hint';
    hintEl.textContent = 'Hemat Kuota: Media tidak diunduh sebelum tombol ditekan (0 KB)';

    const loadBtn = document.createElement('button');
    loadBtn.type = 'button';
    loadBtn.className = 'classic-btn retro-media-load-btn';
    loadBtn.textContent =
      type === 'video' ? '[ Muat & Putar Video ]' : '[ Muat & Putar Audio ]';

    loadBtn.addEventListener('click', () => {
      const mediaEl = document.createElement(type === 'video' ? 'video' : 'audio');
      mediaEl.controls = true;
      mediaEl.preload = 'metadata';
      if (type === 'video') {
        mediaEl.setAttribute('playsinline', '');
      }
      mediaEl.src = safeUrl;

      mediaEl.addEventListener('play', () => {
        this.registerActiveMedia(mediaEl);
      });

      mediaEl.onerror = () => {
        const errNotice = document.createElement('div');
        errNotice.className = 'retro-media-error';
        errNotice.textContent = `[Gagal memutar ${type}: berkas tidak ditemukan atau format tidak didukung]`;
        outerBox.replaceWith(errNotice);
      };

      facade.replaceWith(mediaEl);
      this.registerActiveMedia(mediaEl);
      mediaEl.play().catch(() => {
        // Biarkan pengguna menekan tombol play bawaan jika autoplay diblokir peramban
      });
    });

    facade.appendChild(badgeEl);
    facade.appendChild(hintEl);
    facade.appendChild(loadBtn);
    outerBox.appendChild(facade);

    if (captionText) {
      const cap = document.createElement('div');
      cap.className = 'retro-media-caption';
      cap.textContent = captionText;
      outerBox.appendChild(cap);
    }

    return outerBox;
  },

  /**
   * Meringkas angka besar menjadi satuan kompak (rb, jt, M, T) untuk sumbu grafik.
   */
  formatCompactNumber(num) {
    const abs = Math.abs(num);
    const sign = num < 0 ? '-' : '';
    if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(1).replace(/\.0$/, '')}T`;
    if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(1).replace(/\.0$/, '')}M`;
    if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(1).replace(/\.0$/, '')}jt`;
    if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1).replace(/\.0$/, '')}rb`;
    return `${num}`;
  },

  /**
   * Mengambil palet warna grafik berdasarkan tema kertas aktif (Putih / Sepia / Gelap).
   */
  getChartPalette() {
    const paperEl = document.querySelector('.portal-main-article');
    if (paperEl && paperEl.classList.contains('paper-dark')) {
      return {
        bg: '#181818',
        grid: '#333333',
        axis: '#cccccc',
        yLabel: '#bbbbbb',
        xLabel: '#dddddd',
        valLabel: '#ffffff',
        posBar: '#5c9ce6',
        negBar: '#e06666',
        barBorder: '#e4e4e4',
        lineStroke: '#8ab4f8',
        posDot: '#4dd0e1',
        negDot: '#f28b82'
      };
    }
    if (paperEl && paperEl.classList.contains('paper-sepia')) {
      return {
        bg: '#fbf6ea',
        grid: '#dfd4be',
        axis: '#221c14',
        yLabel: '#4a3f31',
        xLabel: '#221c14',
        valLabel: '#1a140d',
        posBar: '#000080',
        negBar: '#800000',
        barBorder: '#221c14',
        lineStroke: '#000080',
        posDot: '#006666',
        negDot: '#800000'
      };
    }
    return {
      bg: '#ffffff',
      grid: '#dcdcdc',
      axis: '#000000',
      yLabel: '#333333',
      xLabel: '#222222',
      valLabel: '#000000',
      posBar: '#000080',
      negBar: '#800000',
      barBorder: '#000000',
      lineStroke: '#000080',
      posDot: '#008080',
      negDot: '#800000'
    };
  },

  /**
   * Memasang pengamat perubahan kelas tema kertas (.paper-sepia / .paper-dark)
   * agar kanvas grafik otomatis digambar ulang mengikuti warna kertas.
   */
  ensureThemeObserver() {
    if (this._themeObserverAttached || typeof MutationObserver === 'undefined') return;
    const paperEl = document.querySelector('.portal-main-article');
    if (!paperEl) return;

    this._themeObserverAttached = true;
    const observer = new MutationObserver(() => {
      this._chartRenderers = this._chartRenderers.filter((fn) => fn());
    });
    observer.observe(paperEl, { attributes: true, attributeFilter: ['class'] });
  },

  /**
   * Menggambar grafik batang (bar) atau grafik garis (line) pada Canvas 2D.
   * Mendukung nilai negatif, devicePixelRatio hingga 2x, serta downsampling otomatis.
   */
  createChartBlock(chartType, titleText, rawSeries) {
    const entries = rawSeries
      .split(',')
      .map((pair) => {
        const idx = pair.lastIndexOf(':');
        if (idx === -1) return null;
        const label = pair.slice(0, idx).trim();
        const val = parseFloat(pair.slice(idx + 1).trim());
        if (!label || Number.isNaN(val)) return null;
        return { label, value: val };
      })
      .filter(Boolean);

    if (entries.length === 0) {
      const errBox = document.createElement('div');
      errBox.className = 'retro-media-error';
      errBox.textContent = '[Grafik tidak dapat ditampilkan: format data tidak valid]';
      return errBox;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'retro-media-box';

    const scrollBox = document.createElement('div');
    scrollBox.className = 'retro-chart-scroll';

    // Downsampling jika total lebar melebihi batas aman MAX_CANVAS_WIDTH (12000px)
    const minSlotWidth = 76;
    let displayData = entries;
    let wasDownsampled = false;
    const maxSlots = Math.floor((this.MAX_CANVAS_WIDTH - 90) / minSlotWidth);

    if (entries.length > maxSlots && maxSlots > 2) {
      wasDownsampled = true;
      const step = entries.length / maxSlots;
      displayData = [];
      for (let i = 0; i < maxSlots; i++) {
        displayData.push(entries[Math.floor(i * step)]);
      }
    }

    const padLeft = 64;
    const padRight = 24;
    const padTop = 28;
    const padBottom = 56;
    const logicalWidth = Math.min(
      this.MAX_CANVAS_WIDTH,
      Math.max(420, padLeft + padRight + displayData.length * minSlotWidth)
    );
    const logicalHeight = 260;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const canvas = document.createElement('canvas');
    canvas.className = 'retro-chart';
    canvas.width = Math.floor(logicalWidth * dpr);
    canvas.height = Math.floor(logicalHeight * dpr);
    canvas.style.width = `${logicalWidth}px`;
    canvas.style.height = `${logicalHeight}px`;

    const drawCanvas = () => {
      const palette = this.getChartPalette();
      scrollBox.style.backgroundColor = palette.bg;
      canvas.style.backgroundColor = palette.bg;

      const ctx = canvas.getContext('2d');
      ctx.save();
      ctx.scale(dpr, dpr);

      // Latar belakang kanvas sesuai tema kertas
      ctx.fillStyle = palette.bg;
      ctx.fillRect(0, 0, logicalWidth, logicalHeight);

      const plotW = logicalWidth - padLeft - padRight;
      const plotH = logicalHeight - padTop - padBottom;

      const values = displayData.map((d) => d.value);
      const maxVal = Math.max(0, ...values);
      const minVal = Math.min(0, ...values);
      const range = maxVal - minVal || 1;
      const zeroY = padTop + (maxVal / range) * plotH;

      // Garis kisi horizontal & label nilai sumbu Y
      ctx.strokeStyle = palette.grid;
      ctx.lineWidth = 1;
      ctx.font = '11px "Courier New", monospace';
      ctx.fillStyle = palette.yLabel;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';

      const gridSteps = 4;
      for (let i = 0; i <= gridSteps; i++) {
        const ratio = i / gridSteps;
        const y = padTop + ratio * plotH;
        const valAtLine = maxVal - ratio * range;

        ctx.beginPath();
        ctx.moveTo(padLeft, y);
        ctx.lineTo(logicalWidth - padRight, y);
        ctx.stroke();

        ctx.fillText(
          this.formatCompactNumber(Math.round(valAtLine * 100) / 100),
          padLeft - 8,
          y
        );
      }

      // Garis sumbu nol (X)
      ctx.strokeStyle = palette.axis;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(padLeft, zeroY);
      ctx.lineTo(logicalWidth - padRight, zeroY);
      ctx.stroke();

      // Garis sumbu vertikal (Y)
      ctx.beginPath();
      ctx.moveTo(padLeft, padTop);
      ctx.lineTo(padLeft, padTop + plotH);
      ctx.stroke();

      const slotW = plotW / displayData.length;
      const points = [];

      displayData.forEach((item, index) => {
        const centerX = padLeft + slotW * index + slotW / 2;
        const valY = padTop + ((maxVal - item.value) / range) * plotH;
        points.push({ x: centerX, y: valY, item });

        if (chartType === 'bar') {
          const barW = Math.min(42, slotW * 0.62);
          const barX = centerX - barW / 2;
          const barY = Math.min(zeroY, valY);
          const barH = Math.max(2, Math.abs(valY - zeroY));

          ctx.fillStyle = item.value < 0 ? palette.negBar : palette.posBar;
          ctx.fillRect(barX, barY, barW, barH);

          ctx.strokeStyle = palette.barBorder;
          ctx.lineWidth = 1;
          ctx.strokeRect(barX, barY, barW, barH);
        }

        // Label nilai angka di atas/bawah titik data
        ctx.fillStyle = palette.valLabel;
        ctx.font = 'bold 11px "Courier New", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = item.value < 0 ? 'top' : 'bottom';
        const labelOffsetY = item.value < 0 ? valY + 4 : valY - 4;
        ctx.fillText(this.formatCompactNumber(item.value), centerX, labelOffsetY);

        // Label kategori sumbu X
        ctx.fillStyle = palette.xLabel;
        ctx.font = '11px Verdana, sans-serif';
        ctx.textBaseline = 'top';
        const shortLabel =
          item.label.length > 12 ? `${item.label.slice(0, 11)}…` : item.label;
        ctx.fillText(shortLabel, centerX, padTop + plotH + 10);
      });

      if (chartType === 'line' && points.length > 0) {
        ctx.strokeStyle = palette.lineStroke;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        points.forEach((pt, idx) => {
          if (idx === 0) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
        });
        ctx.stroke();

        points.forEach((pt) => {
          ctx.fillStyle = pt.item.value < 0 ? palette.negDot : palette.posDot;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = palette.barBorder;
          ctx.lineWidth = 1;
          ctx.stroke();
        });
      }

      ctx.restore();
      return canvas.isConnected;
    };

    drawCanvas();
    this.ensureThemeObserver();
    this._chartRenderers.push(drawCanvas);

    scrollBox.appendChild(canvas);
    wrapper.appendChild(scrollBox);

    if (titleText) {
      const cap = document.createElement('div');
      cap.className = 'retro-media-caption';
      cap.textContent = wasDownsampled
        ? `${titleText} (Menampilkan ${displayData.length} sampel dari ${entries.length} titik data)`
        : titleText;
      wrapper.appendChild(cap);
    }

    if (logicalWidth > 460) {
      const hint = document.createElement('div');
      hint.className = 'retro-chart-hint';
      hint.textContent = '<- Geser grafik ke samping jika terpotong di layar sempit ->';
      wrapper.appendChild(hint);
    }

    return wrapper;
  },

  /**
   * Mengurai pemformatan sebaris (**tebal**, *miring*, [teks](url))
   * secara aman menggunakan DOM API murni tanpa innerHTML.
   */
  appendInlineFormattedText(parentEl, text) {
    const tokenRegex =
      /(\*\*[^*]+\*\*|\*[^*]+\*|\[([^\]]+)\]\(([^)]+)\))/g;
    let lastIndex = 0;
    let match;

    while ((match = tokenRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parentEl.appendChild(
          document.createTextNode(text.slice(lastIndex, match.index))
        );
      }

      const fullToken = match[0];

      if (fullToken.startsWith('**') && fullToken.endsWith('**')) {
        const strong = document.createElement('strong');
        strong.textContent = fullToken.slice(2, -2);
        parentEl.appendChild(strong);
      } else if (fullToken.startsWith('*') && fullToken.endsWith('*')) {
        const em = document.createElement('em');
        em.textContent = fullToken.slice(1, -1);
        parentEl.appendChild(em);
      } else if (match[2] && match[3]) {
        const linkLabel = match[2];
        const rawHref = match[3];
        const safeHref = this.sanitizeMediaUrl(rawHref);

        if (safeHref) {
          const anchor = document.createElement('a');
          anchor.href = safeHref;
          anchor.textContent = linkLabel;
          if (/^https:\/\//i.test(safeHref)) {
            anchor.target = '_blank';
            anchor.rel = 'noopener noreferrer';
          }
          parentEl.appendChild(anchor);
        } else {
          parentEl.appendChild(document.createTextNode(linkLabel));
        }
      }

      lastIndex = tokenRegex.lastIndex;
    }

    if (lastIndex < text.length) {
      parentEl.appendChild(document.createTextNode(text.slice(lastIndex)));
    }
  },

  /**
   * Merender dokumen teks mentah ke dalam elemen kontainer secara bertahap (Time-Sliced).
   * Mendukung argumen ketiga berupa fungsi callback langsung maupun objek { onProgress }.
   * @param {string} rawText - Isi mentah dokumen .txt
   * @param {HTMLElement} container - Elemen wadah tujuan (#article-body)
   * @param {Function|Object} options - Fungsi progress (percent) => void atau { onProgress }
   * @returns {Promise<void>}
   */
  render(rawText, container, options = {}) {
    if (!container) return Promise.resolve();

    this.stopAllMedia();
    this._chartRenderers = [];
    const renderId = ++this._currentRenderId;
    container.textContent = '';

    const cleanText = this.sanitizeRawText(rawText);
    const lines = cleanText.split('\n');
    const totalLines = lines.length;

    const onProgress =
      typeof options === 'function'
        ? options
        : options && typeof options.onProgress === 'function'
        ? options.onProgress
        : null;

    let lineIndex = 0;
    let listStack = []; // Tumpukan elemen <ul> bersarang lintas potongan frame

    const closeAllLists = () => {
      listStack = [];
    };

    const genericMediaRegex = /^\[media:\s*([^|\]]+?)(?:\s*\|\s*([^\]]+))?\]$/i;

    return new Promise((resolve) => {
      const processChunk = () => {
        // Batalkan siklus lama jika pemanggilan render() baru telah dimulai
        if (renderId !== this._currentRenderId) {
          resolve();
          return;
        }

        const fragment = document.createDocumentFragment();
        const end = Math.min(lineIndex + this.CHUNK_SIZE, totalLines);

        for (; lineIndex < end; lineIndex++) {
          const rawLine = lines[lineIndex];
          // Konversi tab menjadi 2 spasi untuk konsistensi indentasi daftar
          const normalizedLine = rawLine.replace(/\t/g, '  ');
          const trimmed = normalizedLine.trim();

          if (this.debugMode) {
            console.debug(`[ZineParser:${lineIndex + 1}]`, trimmed);
          }

          // 1. Baris kosong menutup tumpukan daftar aktif
          if (!trimmed) {
            closeAllLists();
            continue;
          }

          // 2. Garis pemisah horizontal (---)
          if (/^-{3,}$/.test(trimmed)) {
            closeAllLists();
            const hr = document.createElement('hr');
            fragment.appendChild(hr);
            continue;
          }

          // 3. Tajuk tiga tingkat (#, ##, ###)
          const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
          if (headingMatch) {
            closeAllLists();
            const level = headingMatch[1].length;
            const headingEl = document.createElement(`h${level}`);
            this.appendInlineFormattedText(headingEl, headingMatch[2].trim());
            fragment.appendChild(headingEl);
            continue;
          }

          // 4. Daftar tidak berurutan bersarang maksimal 3 tingkat (- item)
          const listMatch = normalizedLine.match(/^(\s*)-\s+(.+)$/);
          if (listMatch) {
            const indentSpaces = listMatch[1].length;
            const targetLevel = Math.min(
              this.MAX_LIST_DEPTH - 1,
              Math.floor(indentSpaces / 2)
            );

            // Potong tumpukan daftar jika tingkat saat ini lebih dangkal
            while (listStack.length > targetLevel + 1) {
              listStack.pop();
            }

            // Buat tingkat daftar baru jika belum tersedia
            while (listStack.length <= targetLevel) {
              const newUl = document.createElement('ul');
              if (listStack.length === 0) {
                fragment.appendChild(newUl);
              } else {
                const parentUl = listStack[listStack.length - 1];
                const lastLi =
                  parentUl.lastElementChild ||
                  parentUl.appendChild(document.createElement('li'));
                lastLi.appendChild(newUl);
              }
              listStack.push(newUl);
            }

            const activeUl = listStack[targetLevel];
            const li = document.createElement('li');
            this.appendInlineFormattedText(li, listMatch[2].trim());
            activeUl.appendChild(li);
            continue;
          }

          // 5. Blok Grafik Canvas 2D: [chart:bar|Judul|A:10,B:20] atau [chart:line|...]
          const chartMatch = trimmed.match(
            /^\[chart:\s*(bar|line)\s*\|\s*([^|\]]*)\s*\|\s*([^\]]+)\]$/i
          );
          if (chartMatch) {
            closeAllLists();
            const chartType = chartMatch[1].toLowerCase();
            const chartTitle = chartMatch[2].trim();
            const chartData = chartMatch[3].trim();
            fragment.appendChild(
              this.createChartBlock(chartType, chartTitle, chartData)
            );
            continue;
          }

          // 6. Blok Lampiran & Unduhan Berkas: [file:jalur.zip | Keterangan] atau [berkas:...]
          const fileMatch = trimmed.match(
            /^\[(file|berkas):\s*([^|\]]+?)(?:\s*\|\s*([^\]]+))?\]$/i
          );
          if (fileMatch) {
            closeAllLists();
            const rawUrl = fileMatch[2].trim();
            const caption = fileMatch[3] ? fileMatch[3].trim() : '';
            fragment.appendChild(this.createFileDownloadCard(rawUrl, caption));
            continue;
          }

          // 7. Deteksi otomatis jenis media pada sintaks generik [media:jalur.ext | Keterangan]
          const genericMediaMatch = trimmed.match(genericMediaRegex);
          if (genericMediaMatch) {
            closeAllLists();
            const rawUrl = genericMediaMatch[1].trim();
            const caption = genericMediaMatch[2] ? genericMediaMatch[2].trim() : '';
            const cleanPath = rawUrl.split('?')[0].split('#')[0];
            const extMatch = cleanPath.match(/\.([a-z0-9]+)$/i);
            const ext = extMatch ? extMatch[1].toLowerCase() : '';

            if (this.IMAGE_EXTENSIONS.includes(ext)) {
              fragment.appendChild(this.createImageBlock(rawUrl, caption));
            } else if (this.VIDEO_EXTENSIONS.includes(ext)) {
              fragment.appendChild(this.createMediaFacade('video', rawUrl, caption));
            } else if (this.AUDIO_EXTENSIONS.includes(ext)) {
              fragment.appendChild(this.createMediaFacade('audio', rawUrl, caption));
            } else {
              fragment.appendChild(this.createFileDownloadCard(rawUrl, caption));
            }
            continue;
          }

          // 8. Blok Gambar: [img:jalur.png | Keterangan] atau [gambar:...]
          const imgMatch = trimmed.match(
            /^\[(img|gambar):\s*([^|\]]+?)(?:\s*\|\s*([^\]]+))?\]$/i
          );
          if (imgMatch) {
            closeAllLists();
            const rawUrl = imgMatch[2].trim();
            const caption = imgMatch[3] ? imgMatch[3].trim() : '';
            fragment.appendChild(this.createImageBlock(rawUrl, caption));
            continue;
          }

          // 9. Blok Video: [video:jalur.mp4 | Keterangan]
          const videoMatch = trimmed.match(
            /^\[video:\s*([^|\]]+?)(?:\s*\|\s*([^\]]+))?\]$/i
          );
          if (videoMatch) {
            closeAllLists();
            const rawUrl = videoMatch[1].trim();
            const caption = videoMatch[2] ? videoMatch[2].trim() : '';
            fragment.appendChild(this.createMediaFacade('video', rawUrl, caption));
            continue;
          }

          // 10. Blok Audio: [audio:jalur.mp3 | Keterangan]
          const audioMatch = trimmed.match(
            /^\[audio:\s*([^|\]]+?)(?:\s*\|\s*([^\]]+))?\]$/i
          );
          if (audioMatch) {
            closeAllLists();
            const rawUrl = audioMatch[1].trim();
            const caption = audioMatch[2] ? audioMatch[2].trim() : '';
            fragment.appendChild(this.createMediaFacade('audio', rawUrl, caption));
            continue;
          }

          // 11. Paragraf teks biasa dengan pemformatan sebaris
          closeAllLists();
          const p = document.createElement('p');
          this.appendInlineFormattedText(p, trimmed);
          fragment.appendChild(p);
        }

        container.appendChild(fragment);

        if (onProgress) {
          const percent =
            totalLines === 0
              ? 100
              : Math.min(100, Math.round((lineIndex / totalLines) * 100));
          onProgress(percent);
        }

        if (lineIndex < totalLines) {
          requestAnimationFrame(processChunk);
        } else {
          resolve();
        }
      };

      requestAnimationFrame(processChunk);
    });
  }
};
