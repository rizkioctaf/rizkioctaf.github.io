/**
 * ==========================================================================
 * FILE: parser.js
 * DESKRIPSI: Mesin penerjemah (Custom Markup Parser) skala besar (100.000+ baris).
 *            - Time-Sliced Rendering (DocumentFragment + requestAnimationFrame)
 *              sehingga tidak pernah membekukan Main Thread / UI browser.
 *            - Pembatalan otomatis (Generation Token) jika render dipanggil ulang.
 *            - Downsampling otomatis & batas lebar kanvas aman lintas browser.
 *            - Click-to-Load Facade untuk Video & Audio (0 KB unduhan latar
 *              belakang meskipun artikel berisi ratusan video/audio).
 *            - Sanitasi URL ketat selaras CSP & anti-XSS via DOM API murni.
 * ==========================================================================
 */

const ZineParser = {
  debugMode: false,
  _currentRenderId: 0,
  _activeMediaEl: null,
  CHUNK_SIZE: 1500, // Jumlah baris diproses per frame (~4-8ms per frame)
  MAX_CANVAS_WIDTH: 12000, // Batas aman dimensi kanvas di Safari iOS / Chrome

  logDebug(lineNumber, type, detail) {
    if (this.debugMode) {
      console.log(`[ZineParser Baris ${lineNumber}] Tipe: ${type} ->`, detail);
    }
  },

  /**
   * Memastikan hanya 1 media (video/audio) yang diputar dalam satu waktu
   * agar penggunaan CPU/jaringan hemat dan suara tidak bertumpuk.
   */
  registerActiveMedia(mediaEl) {
    if (this._activeMediaEl && this._activeMediaEl !== mediaEl && !this._activeMediaEl.paused) {
      try {
        this._activeMediaEl.pause();
      } catch {}
    }
    this._activeMediaEl = mediaEl;
  },

  /**
   * Mengurai format sebaris aman (**tebal**, *miring*, [label](url)) ke DOM murni
   * tanpa menggunakan innerHTML sehingga bebas dari celah XSS.
   */
  appendFormattedText(parentEl, text) {
    const str = String(text || '');
    const tokenRegex = /(\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;
    let lastIndex = 0;
    let match;

    while ((match = tokenRegex.exec(str)) !== null) {
      if (match.index > lastIndex) {
        parentEl.appendChild(document.createTextNode(str.slice(lastIndex, match.index)));
      }

      const token = match[0];

      if (token.startsWith('**') && token.endsWith('**') && token.length > 4) {
        const strong = document.createElement('strong');
        strong.textContent = token.slice(2, -2);
        parentEl.appendChild(strong);
      } else if (token.startsWith('*') && token.endsWith('*') && token.length > 2) {
        const em = document.createElement('em');
        em.textContent = token.slice(1, -1);
        parentEl.appendChild(em);
      } else if (token.startsWith('[')) {
        const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
        if (linkMatch) {
          const label = linkMatch[1];
          const safeHref = this.sanitizeMediaUrl(linkMatch[2]);
          if (safeHref) {
            const anchor = document.createElement('a');
            anchor.href = safeHref;
            anchor.textContent = label;
            if (/^https:\/\//i.test(safeHref)) {
              anchor.target = '_blank';
              anchor.rel = 'noopener noreferrer';
            }
            parentEl.appendChild(anchor);
          } else {
            parentEl.appendChild(document.createTextNode(label));
          }
        } else {
          parentEl.appendChild(document.createTextNode(token));
        }
      }

      lastIndex = tokenRegex.lastIndex;
    }

    if (lastIndex < str.length) {
      parentEl.appendChild(document.createTextNode(str.slice(lastIndex)));
    }
  },

  /**
   * Merender teks artikel secara bertahap (non-blocking) agar 100.000+ baris
   * langsung tampil instan tanpa freeze.
   * @param {string} rawText
   * @param {HTMLElement} container
   * @param {function(number):void} [onProgress] Callback opsional persentase (0-100)
   * @returns {Promise<void>}
   */
  render(rawText, container, onProgress) {
    if (!container) {
      console.error('[ZineParser Error]: Elemen kontainer target tidak ditemukan.');
      return Promise.resolve();
    }

    // Hentikan media yang sedang berjalan dari artikel sebelumnya jika ada
    if (this._activeMediaEl) {
      try {
        this._activeMediaEl.pause();
        this._activeMediaEl.removeAttribute('src');
        this._activeMediaEl.load();
      } catch {}
      this._activeMediaEl = null;
    }

    // Naikkan token generasi untuk membatalkan render sebelumnya jika masih berjalan
    const renderId = ++this._currentRenderId;
    container.innerHTML = '';

    // Hapus UTF-8 BOM (\uFEFF) dan karakter kontrol berbahaya (kecuali \t, \n, \r)
    const sanitizedText = String(rawText || '')
      .replace(/^\uFEFF/, '')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

    const lines = sanitizedText.split(/\r?\n/);
    const totalLines = lines.length;
    let cursor = 0;

    // State list dipertahankan lintas chunk agar nested list tetap tersambung rapi
    let listStack = [];
    const closeActiveList = () => {
      listStack = [];
    };

    const headingRegex = /^(#{1,3})\s+(.+)$/;
    const hrRegex = /^---+$/;
    const listRegex = /^(\s*)-\s+(.+)$/;
    const chartRegex = /^\[chart:(bar|line)\s*\|\s*([^|]+)\|\s*([^\]]+)\]$/i;
    const mediaRegex = /^\[(image|audio|video):([^|\]]+)(?:\|\s*([^\]]+))?\]$/i;

    return new Promise((resolve) => {
      const processChunk = () => {
        if (renderId !== this._currentRenderId || !container.isConnected) {
          resolve();
          return;
        }

        const fragment = document.createDocumentFragment();
        const end = Math.min(cursor + this.CHUNK_SIZE, totalLines);

        for (; cursor < end; cursor++) {
          const lineNumber = cursor + 1;
          const rawLine = lines[cursor];
          const trimmedLine = rawLine.trim();

          if (trimmedLine === '') {
            closeActiveList();
            continue;
          }

          // 0. Garis Pemisah Horizontal (---)
          if (hrRegex.test(trimmedLine)) {
            closeActiveList();
            this.logDebug(lineNumber, 'HR', trimmedLine);
            const hr = document.createElement('hr');
            fragment.appendChild(hr);
            continue;
          }

          // 1. Heading (h1 - h3)
          const headingMatch = trimmedLine.match(headingRegex);
          if (headingMatch) {
            closeActiveList();
            const level = headingMatch[1].length;
            const headingText = headingMatch[2].trim();
            this.logDebug(lineNumber, `H${level}`, headingText);
            const headingEl = document.createElement(`h${level}`);
            headingEl.textContent = headingText;
            fragment.appendChild(headingEl);
            continue;
          }

          // 2. Nested List (maksimal level 3, tahan indentasi Tab & loncatan acak)
          const normalizedIndentLine = rawLine.indexOf('\t') !== -1
            ? rawLine.replace(/\t/g, '  ')
            : rawLine;
          const listMatch = normalizedIndentLine.match(listRegex);
          if (listMatch) {
            const leadingSpaces = listMatch[1].length;
            const itemText = listMatch[2].trim();

            if (itemText !== '') {
              const requestedLevel = Math.floor(leadingSpaces / 2);
              const maxAllowedLevel = Math.min(3, listStack.length);
              const targetLevel = Math.min(maxAllowedLevel, requestedLevel);

              this.logDebug(lineNumber, `LIST_L${targetLevel}`, itemText);
              this.appendNestedListItem(fragment, listStack, targetLevel, itemText);
              continue;
            }
          }

          closeActiveList();

          // 3. Blok Grafik Canvas & Media
          if (trimmedLine.charCodeAt(0) === 91 /* '[' */) {
            const chartMatch = trimmedLine.match(chartRegex);
            if (chartMatch) {
              const chartType = chartMatch[1].toLowerCase();
              const chartTitle = chartMatch[2].trim();
              this.logDebug(lineNumber, `CHART_${chartType.toUpperCase()}`, chartTitle);
              const chartElement = this.buildChartBlock(
                chartType,
                chartTitle,
                chartMatch[3].trim(),
                lineNumber
              );
              fragment.appendChild(chartElement);
              continue;
            }

            // 4. Blok Media
            const mediaMatch = trimmedLine.match(mediaRegex);
            if (mediaMatch) {
              const mediaType = mediaMatch[1].toLowerCase();
              const mediaSrc = mediaMatch[2].trim();
              const mediaCaption = mediaMatch[3] ? mediaMatch[3].trim() : '';
              this.logDebug(lineNumber, `MEDIA_${mediaType.toUpperCase()}`, mediaSrc);
              const mediaElement = this.buildMediaBlock(
                mediaType,
                mediaSrc,
                mediaCaption
              );
              fragment.appendChild(mediaElement);
              continue;
            }
          }

          // 5. Paragraf Standar
          const p = document.createElement('p');
          this.appendFormattedText(p, trimmedLine);
          fragment.appendChild(p);
        }

        container.appendChild(fragment);

        if (typeof onProgress === 'function') {
          onProgress(Math.min(100, Math.round((cursor / totalLines) * 100)));
        }

        if (cursor < totalLines) {
          requestAnimationFrame(processChunk);
        } else {
          resolve();
        }
      };

      processChunk();
    });
  },

  appendNestedListItem(targetParent, listStack, level, text) {
    if (level === 0) {
      if (listStack.length === 0) {
        const rootUl = document.createElement('ul');
        targetParent.appendChild(rootUl);
        listStack.push(rootUl);
      } else {
        listStack.length = 1;
      }
    } else {
      while (listStack.length <= level) {
        const parentUl = listStack[listStack.length - 1];
        if (!parentUl) {
          const rootUl = document.createElement('ul');
          targetParent.appendChild(rootUl);
          listStack.push(rootUl);
          continue;
        }
        let parentLi = parentUl.lastElementChild;
        if (!parentLi) {
          parentLi = document.createElement('li');
          parentUl.appendChild(parentLi);
        }
        const childUl = document.createElement('ul');
        parentLi.appendChild(childUl);
        listStack.push(childUl);
      }
      listStack.length = level + 1;
    }

    const li = document.createElement('li');
    this.appendFormattedText(li, text);
    listStack[level].appendChild(li);
  },

  formatCompactNumber(num) {
    if (!Number.isFinite(num)) return '0';
    const abs = Math.abs(num);
    const sign = num < 0 ? '-' : '';
    if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(1).replace(/\.0$/, '')}T`;
    if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(1).replace(/\.0$/, '')}M`;
    if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(1).replace(/\.0$/, '')}jt`;
    if (abs >= 1e4) return `${sign}${(abs / 1e3).toFixed(1).replace(/\.0$/, '')}rb`;
    if (Number.isInteger(num)) return String(num);
    return Number(num.toFixed(2)).toString();
  },

  truncateLabel(text, maxChars = 10) {
    const chars = Array.from(String(text));
    if (chars.length <= maxChars) return text;
    return chars.slice(0, maxChars - 1).join('') + '…';
  },

  buildChartBlock(type, title, rawDataString, lineNumber) {
    const wrapper = document.createElement('div');
    wrapper.className = 'retro-media-box';

    let labels = [];
    let values = [];
    const strictNumberPattern = /^-?\d+(?:\.\d+)?$/;

    const pairs = rawDataString.split(',');
    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i];
      const colonIdx = pair.lastIndexOf(':');
      if (colonIdx > 0) {
        const label = pair.slice(0, colonIdx).trim();
        const rawVal = pair.slice(colonIdx + 1).trim();

        if (label !== '' && strictNumberPattern.test(rawVal)) {
          const numericValue = Number(rawVal);
          if (Number.isFinite(numericValue) && Math.abs(numericValue) < 1e15) {
            labels.push(label);
            values.push(numericValue);
          }
        }
      }
    }

    if (labels.length === 0) {
      const warnText = document.createElement('div');
      warnText.style.color = '#800000';
      warnText.style.fontFamily = '"Courier New", monospace';
      warnText.textContent = `[Error Grafik Baris ${lineNumber}]: Format data harus "Label:Angka, Label:Angka"`;
      wrapper.appendChild(warnText);
      return wrapper;
    }

    const maxPoints = Math.floor((this.MAX_CANVAS_WIDTH - 88) / 80);
    let wasSampled = false;
    if (labels.length > maxPoints) {
      wasSampled = true;
      const step = Math.ceil(labels.length / maxPoints);
      const sampledLabels = [];
      const sampledValues = [];
      for (let i = 0; i < labels.length; i += step) {
        sampledLabels.push(labels[i]);
        sampledValues.push(values[i]);
      }
      labels = sampledLabels;
      values = sampledValues;
    }

    const titleDiv = document.createElement('div');
    titleDiv.style.marginBottom = '6px';
    titleDiv.style.overflowWrap = 'anywhere';
    const boldTitle = document.createElement('b');
    boldTitle.textContent = `[GRAFIK ${type.toUpperCase()}] ${title}${wasSampled ? ' (Sampel Data)' : ''}`;
    titleDiv.appendChild(boldTitle);

    const minIdealWidth = 440;
    const widthPerItem = 80;
    const logicalWidth = Math.min(
      this.MAX_CANVAS_WIDTH,
      Math.max(minIdealWidth, 88 + labels.length * widthPerItem)
    );
    const logicalHeight = 260;

    const scrollContainer = document.createElement('div');
    scrollContainer.className = 'retro-chart-scroll';

    const canvas = document.createElement('canvas');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = logicalWidth * dpr;
    canvas.height = logicalHeight * dpr;
    canvas.className = 'retro-chart';
    canvas.style.width = `${logicalWidth}px`;
    canvas.style.height = `${logicalHeight}px`;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', `Grafik ${type} ${title}`);

    scrollContainer.appendChild(canvas);
    wrapper.appendChild(titleDiv);
    wrapper.appendChild(scrollContainer);

    if (labels.length > 5) {
      const hintDiv = document.createElement('div');
      hintDiv.className = 'retro-chart-hint';
      hintDiv.textContent = '<< Geser grafik ke samping untuk melihat seluruh data >>';
      wrapper.appendChild(hintDiv);
    }

    this.drawChartOnCanvas(canvas, type, labels, values, logicalWidth, logicalHeight, dpr);
    return wrapper;
  },

  drawChartOnCanvas(canvas, type, labels, values, width, height, dpr) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.scale(dpr, dpr);
    ctx.font = '11px "Courier New", monospace';

    let rawMin = 0;
    let rawMax = 0;
    for (let i = 0; i < values.length; i++) {
      if (values[i] < rawMin) rawMin = values[i];
      if (values[i] > rawMax) rawMax = values[i];
    }
    const rawRange = rawMax - rawMin || Math.abs(rawMax) || Math.abs(rawMin) || 1;

    const minData = rawMin < 0 ? rawMin - rawRange * 0.14 : 0;
    const maxData = rawMax > 0 ? rawMax + rawRange * 0.14 : (rawMin < 0 ? rawRange * 0.08 : 1);
    const range = maxData - minData || 1;

    const gridSteps = 4;
    let maxYLabelWidth = 36;
    const yTicks = [];
    for (let i = 0; i <= gridSteps; i++) {
      const val = maxData - (range / gridSteps) * i;
      const formatted = this.formatCompactNumber(val);
      yTicks.push({ val, text: formatted });
      const w = ctx.measureText(formatted).width;
      if (w > maxYLabelWidth) maxYLabelWidth = w;
    }

    const padLeft = Math.ceil(maxYLabelWidth) + 20;
    const padRight = 24;
    const padTop = 30;
    const padBottom = 40;

    const plotWidth = width - padLeft - padRight;
    const plotHeight = height - padTop - padBottom;
    const zeroY = padTop + (maxData / range) * plotHeight;

    ctx.clearRect(0, 0, width, height);

    ctx.textAlign = 'right';
    yTicks.forEach((tick, i) => {
      const y = padTop + (plotHeight / gridSteps) * i;
      ctx.strokeStyle = '#e0e0e0';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(padLeft + plotWidth, y);
      ctx.stroke();

      ctx.fillStyle = '#000000';
      ctx.fillText(tick.text, padLeft - 8, y + 4);
    });

    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(padLeft, padTop);
    ctx.lineTo(padLeft, padTop + plotHeight);
    ctx.moveTo(padLeft, zeroY);
    ctx.lineTo(padLeft + plotWidth, zeroY);
    ctx.stroke();

    const stepX = plotWidth / labels.length;
    ctx.textAlign = 'center';

    if (type === 'bar') {
      const barWidth = Math.min(44, stepX * 0.54);
      for (let idx = 0; idx < values.length; idx++) {
        const val = values[idx];
        const centerX = padLeft + idx * stepX + stepX / 2;
        const valY = padTop + ((maxData - val) / range) * plotHeight;
        const barTop = Math.min(zeroY, valY);
        const barHeight = Math.max(1, Math.abs(zeroY - valY));
        const x = centerX - barWidth / 2;

        ctx.fillStyle = val >= 0 ? '#000080' : '#800000';
        ctx.fillRect(x, barTop, barWidth, barHeight);

        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, barTop, barWidth, barHeight);

        ctx.fillStyle = '#000000';
        const valText = this.formatCompactNumber(val);
        const valTextY = val >= 0 ? barTop - 6 : barTop + barHeight + 13;
        ctx.fillText(valText, centerX, valTextY);
        ctx.fillText(this.truncateLabel(labels[idx], 10), centerX, padTop + plotHeight + 18);
      }
    }

    if (type === 'line') {
      ctx.strokeStyle = '#cc0000';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let idx = 0; idx < values.length; idx++) {
        const x = padLeft + idx * stepX + stepX / 2;
        const y = padTop + ((maxData - values[idx]) / range) * plotHeight;
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      for (let idx = 0; idx < values.length; idx++) {
        const val = values[idx];
        const x = padLeft + idx * stepX + stepX / 2;
        const y = padTop + ((maxData - val) / range) * plotHeight;

        ctx.fillStyle = '#ffff00';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#000000';
        ctx.fillText(this.formatCompactNumber(val), x, y - 9);
        ctx.fillText(this.truncateLabel(labels[idx], 10), x, padTop + plotHeight + 18);
      }
    }
  },

  sanitizeMediaUrl(rawUrl) {
    const trimmed = String(rawUrl || '').trim();
    if (!trimmed) return null;

    if (
      trimmed.startsWith('//') ||
      trimmed.includes('\\') ||
      /(?:\.\.|%2e)/i.test(trimmed) ||
      /^(javascript|vbscript|file|data):/i.test(trimmed)
    ) {
      return null;
    }

    if (/^https:\/\//i.test(trimmed)) {
      try {
        const parsed = new URL(trimmed);
        if (parsed.protocol === 'https:' && parsed.hostname !== '') {
          return parsed.href;
        }
      } catch {
        return null;
      }
      return null;
    }

    if (/^(?:\.\/)?[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(trimmed)) {
      return trimmed;
    }

    return null;
  },

  /**
   * Mengekstrak nama berkas yang ringkas untuk ditampilkan di tombol pemuat media
   */
  extractMediaFilename(safeSrc) {
    try {
      const cleanPath = safeSrc.split('?')[0].split('#')[0];
      const segment = cleanPath.split('/').pop();
      return segment ? decodeURIComponent(segment) : safeSrc;
    } catch {
      return safeSrc;
    }
  },

  /**
   * Membangun kotak media:
   * - Image: memakai loading="lazy" + decoding="async"
   * - Video & Audio: memakai Click-to-Load Facade (0 KB unduhan latar belakang)
   *   sehingga artikel dengan ratusan video tetap instan dan hemat kuota.
   */
  buildMediaBlock(type, src, caption) {
    const box = document.createElement('div');
    box.className = 'retro-media-box';

    const safeSrc = this.sanitizeMediaUrl(src);
    if (!safeSrc) {
      box.appendChild(this.createMediaErrorNote('Sumber media tidak valid atau tidak diizinkan oleh kebijakan keamanan.'));
      return box;
    }

    if (type === 'image') {
      const img = document.createElement('img');
      img.src = safeSrc;
      img.alt = caption || 'Gambar Artikel';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.referrerPolicy = 'no-referrer';
      img.onerror = () => {
        img.replaceWith(this.createMediaErrorNote('Gambar tidak dapat dimuat.'));
      };
      box.appendChild(img);
    } else if (type === 'audio' || type === 'video') {
      const isVideo = type === 'video';
      const fileName = this.extractMediaFilename(safeSrc);

      const facade = document.createElement('div');
      facade.className = isVideo ? 'retro-media-facade is-video' : 'retro-media-facade is-audio';

      const badge = document.createElement('div');
      badge.className = 'retro-media-facade-badge';
      badge.textContent = isVideo
        ? `[ BERKAS VIDEO: ${fileName} ]`
        : `[ BERKAS AUDIO: ${fileName} ]`;

      const hint = document.createElement('div');
      hint.className = 'retro-media-facade-hint';
      hint.textContent = 'Media belum diunduh otomatis untuk menghemat kuota data.';

      const loadBtn = document.createElement('button');
      loadBtn.type = 'button';
      loadBtn.className = 'classic-btn retro-media-load-btn';
      loadBtn.textContent = isVideo ? '[ > Muat & Putar Video ]' : '[ > Muat & Putar Audio ]';

      loadBtn.addEventListener('click', () => {
        const mediaEl = document.createElement(isVideo ? 'video' : 'audio');
        mediaEl.controls = true;
        mediaEl.preload = 'auto';
        if (isVideo) {
          mediaEl.playsInline = true;
        }

        mediaEl.addEventListener('play', () => {
          this.registerActiveMedia(mediaEl);
        });

        mediaEl.onerror = () => {
          mediaEl.replaceWith(
            this.createMediaErrorNote(isVideo ? 'Video tidak dapat dimuat.' : 'Audio tidak dapat dimuat.')
          );
        };

        mediaEl.src = safeSrc;
        facade.replaceWith(mediaEl);

        this.registerActiveMedia(mediaEl);
        const playPromise = mediaEl.play();
        if (playPromise && typeof playPromise.catch === 'function') {
          playPromise.catch(() => {
            // Biarkan kontrol pemutar tampil jika browser menahan autoplay
          });
        }
      });

      facade.appendChild(badge);
      facade.appendChild(hint);
      facade.appendChild(loadBtn);
      box.appendChild(facade);
    }

    if (caption !== '') {
      const capDiv = document.createElement('div');
      capDiv.className = 'retro-media-caption';
      capDiv.textContent = `>> ${caption}`;
      box.appendChild(capDiv);
    }

    return box;
  },

  createMediaErrorNote(message) {
    const note = document.createElement('div');
    note.style.color = '#800000';
    note.style.fontFamily = '"Courier New", monospace';
    note.style.fontSize = '12.5px';
    note.style.padding = '8px';
    note.textContent = `[!] ${message}`;
    return note;
  }
};
