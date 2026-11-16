/**
 * ==========================================================================
 * FILE: parser.js
 * DESKRIPSI: Mesin penerjemah (Custom Markup Parser) berbasis JavaScript Vanila.
 *            Tahan terhadap anomali data ekstrem:
 *            - Angka jutaan/desimal/negatif pada grafik
 *            - Label sumbu X yang sangat panjang (otomatis dipangkas rapi)
 *            - Layar HiDPI/Retina tajam dengan horizontal scroll
 *            - Indentasi list acak (misal langsung meloncat ke 8 spasi)
 *            - Sanitasi URL ketat anti-XSS & anti-path traversal
 * ==========================================================================
 */

const ZineParser = {
  debugMode: false,

  logDebug(lineNumber, type, detail) {
    if (this.debugMode) {
      console.log(`[ZineParser Baris ${lineNumber}] Tipe: ${type} ->`, detail);
    }
  },

  render(rawText, container) {
    if (!container) {
      console.error('[ZineParser Error]: Elemen kontainer target tidak ditemukan.');
      return;
    }

    container.innerHTML = '';
    const lines = String(rawText || '').split(/\r?\n/);
    let listStack = [];

    const closeActiveList = () => {
      listStack = [];
    };

    lines.forEach((rawLine, index) => {
      const lineNumber = index + 1;
      const trimmedLine = rawLine.trim();

      if (trimmedLine === '') {
        closeActiveList();
        return;
      }

      if (trimmedLine.startsWith('### ')) {
        closeActiveList();
        const h3 = document.createElement('h3');
        h3.textContent = trimmedLine.slice(4).trim();
        container.appendChild(h3);
        return;
      }

      if (trimmedLine.startsWith('## ')) {
        closeActiveList();
        const h2 = document.createElement('h2');
        h2.textContent = trimmedLine.slice(3).trim();
        container.appendChild(h2);
        return;
      }

      if (trimmedLine.startsWith('# ')) {
        closeActiveList();
        const h1 = document.createElement('h1');
        h1.textContent = trimmedLine.slice(2).trim();
        container.appendChild(h1);
        return;
      }

      // Batasi kedalaman list maksimal level 3 agar tidak menjorok keluar layar ponsel
      const listMatch = rawLine.match(/^(\s*)-\s+(.*)$/);
      if (listMatch) {
        const leadingSpaces = listMatch[1].length;
        const itemText = listMatch[2].trim();
        const targetLevel = Math.min(3, Math.floor(leadingSpaces / 2));

        this.appendNestedListItem(container, listStack, targetLevel, itemText);
        return;
      }

      closeActiveList();

      const chartMatch = trimmedLine.match(/^\[chart:(bar|line)\s*\|\s*([^|]+)\|\s*([^\]]+)\]$/i);
      if (chartMatch) {
        const chartType = chartMatch[1].toLowerCase();
        const chartTitle = chartMatch[2].trim();
        const rawDataString = chartMatch[3].trim();

        const chartElement = this.buildChartBlock(chartType, chartTitle, rawDataString, lineNumber);
        container.appendChild(chartElement);
        return;
      }

      const mediaMatch = trimmedLine.match(/^\[(image|audio|video):([^|\]]+)(?:\|\s*([^\]]+))?\]$/i);
      if (mediaMatch) {
        const mediaType = mediaMatch[1].toLowerCase();
        const mediaSrc = mediaMatch[2].trim();
        const caption = mediaMatch[3] ? mediaMatch[3].trim() : '';

        const mediaElement = this.buildMediaBlock(mediaType, mediaSrc, caption);
        container.appendChild(mediaElement);
        return;
      }

      const p = document.createElement('p');
      p.textContent = trimmedLine;
      container.appendChild(p);
    });
  },

  appendNestedListItem(container, listStack, level, text) {
    if (level === 0) {
      if (listStack.length === 0) {
        const rootUl = document.createElement('ul');
        container.appendChild(rootUl);
        listStack.push(rootUl);
      } else {
        listStack.length = 1;
      }
    } else {
      while (listStack.length <= level) {
        const parentUl = listStack[listStack.length - 1];
        if (!parentUl) {
          const rootUl = document.createElement('ul');
          container.appendChild(rootUl);
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
    li.textContent = text;
    listStack[level].appendChild(li);
  },

  /**
   * Memformat angka besar atau desimal agar ringkas di sumbu Y (misal 1500000 -> 1.5jt)
   */
  formatCompactNumber(num) {
    const abs = Math.abs(num);
    const sign = num < 0 ? '-' : '';
    if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(1).replace(/\.0$/, '')}M`;
    if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(1).replace(/\.0$/, '')}jt`;
    if (abs >= 1e4) return `${sign}${(abs / 1e3).toFixed(1).replace(/\.0$/, '')}rb`;
    if (Number.isInteger(num)) return String(num);
    return Number(num.toFixed(2)).toString();
  },

  /**
   * Memotong label sumbu X yang terlalu panjang agar tidak menabrak kolom sebelahnya
   */
  truncateLabel(text, maxChars = 10) {
    if (text.length <= maxChars) return text;
    return text.slice(0, maxChars - 1) + '…';
  },

  buildChartBlock(type, title, rawDataString, lineNumber) {
    const wrapper = document.createElement('div');
    wrapper.className = 'retro-media-box';

    const labels = [];
    const values = [];

    const pairs = rawDataString.split(',');
    pairs.forEach((pair) => {
      const colonIdx = pair.indexOf(':');
      if (colonIdx > 0) {
        const label = pair.slice(0, colonIdx).trim();
        const numericValue = parseFloat(pair.slice(colonIdx + 1).trim());

        if (label !== '' && Number.isFinite(numericValue)) {
          labels.push(label);
          values.push(numericValue);
        }
      }
    });

    if (labels.length === 0) {
      const warnText = document.createElement('div');
      warnText.style.color = '#800000';
      warnText.style.fontFamily = '"Courier New", monospace';
      warnText.textContent = `[Error Grafik Baris ${lineNumber}]: Format data harus "Label:Angka, Label:Angka"`;
      wrapper.appendChild(warnText);
      return wrapper;
    }

    const titleDiv = document.createElement('div');
    titleDiv.style.marginBottom = '6px';
    titleDiv.style.overflowWrap = 'anywhere';
    const boldTitle = document.createElement('b');
    boldTitle.textContent = `[GRAFIK ${type.toUpperCase()}] ${title}`;
    titleDiv.appendChild(boldTitle);

    const minIdealWidth = 440;
    const widthPerItem = 76;
    const logicalWidth = Math.max(minIdealWidth, 84 + labels.length * widthPerItem);
    const logicalHeight = 250;

    const scrollContainer = document.createElement('div');
    scrollContainer.className = 'retro-chart-scroll';

    const canvas = document.createElement('canvas');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = logicalWidth * dpr;
    canvas.height = logicalHeight * dpr;
    canvas.className = 'retro-chart';
    canvas.style.width = `${logicalWidth}px`;
    canvas.style.height = `${logicalHeight}px`;

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
    ctx.scale(dpr, dpr);
    ctx.font = '11px "Courier New", monospace';

    const minData = Math.min(0, ...values);
    const maxData = Math.max(0, ...values);
    const range = maxData - minData || 1;

    // Hitung lebar teks sumbu Y terpanjang agar padLeft dinamis & tidak pernah terpotong
    const gridSteps = 4;
    let maxYLabelWidth = 34;
    const yTicks = [];
    for (let i = 0; i <= gridSteps; i++) {
      const val = maxData - (range / gridSteps) * i;
      const formatted = this.formatCompactNumber(val);
      yTicks.push({ val, text: formatted });
      const w = ctx.measureText(formatted).width;
      if (w > maxYLabelWidth) maxYLabelWidth = w;
    }

    const padLeft = Math.ceil(maxYLabelWidth) + 16;
    const padRight = 24;
    const padTop = 26;
    const padBottom = 38;

    const plotWidth = width - padLeft - padRight;
    const plotHeight = height - padTop - padBottom;
    const zeroY = padTop + (maxData / range) * plotHeight;

    ctx.clearRect(0, 0, width, height);

    // 1. Garis grid horizontal & label sumbu Y
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

    // 2. Sumbu Y utama dan garis dasar nol (Baseline X)
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

    // 3A. Grafik Batang (mendukung nilai positif & negatif)
    if (type === 'bar') {
      const barWidth = Math.min(44, stepX * 0.54);

      values.forEach((val, idx) => {
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
      });
    }

    // 3B. Grafik Garis
    if (type === 'line') {
      const points = values.map((val, idx) => ({
        x: padLeft + idx * stepX + stepX / 2,
        y: padTop + ((maxData - val) / range) * plotHeight,
        value: val,
        label: labels[idx]
      }));

      ctx.strokeStyle = '#cc0000';
      ctx.lineWidth = 2;
      ctx.beginPath();
      points.forEach((pt, idx) => {
        if (idx === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      });
      ctx.stroke();

      points.forEach((pt) => {
        ctx.fillStyle = '#ffff00';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#000000';
        ctx.fillText(this.formatCompactNumber(pt.value), pt.x, pt.y - 9);
        ctx.fillText(this.truncateLabel(pt.label, 10), pt.x, padTop + plotHeight + 18);
      });
    }
  },

  sanitizeMediaUrl(rawUrl) {
    const trimmed = String(rawUrl || '').trim();
    if (!trimmed) return null;

    if (trimmed.includes('..') || /^(javascript|vbscript|file):/i.test(trimmed)) {
      return null;
    }

    if (/^https?:\/\//i.test(trimmed) || /^[a-zA-Z0-9_./-]+$/.test(trimmed)) {
      return trimmed;
    }

    return null;
  },

  buildMediaBlock(type, src, caption) {
    const box = document.createElement('div');
    box.className = 'retro-media-box';

    const safeSrc = this.sanitizeMediaUrl(src);
    if (!safeSrc) {
      box.appendChild(this.createMediaErrorNote('Sumber media tidak valid.'));
      return box;
    }

    if (type === 'image') {
      const img = document.createElement('img');
      img.src = safeSrc;
      img.alt = caption || 'Gambar Artikel';
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      img.onerror = () => {
        img.replaceWith(this.createMediaErrorNote('Gambar tidak dapat dimuat.'));
      };
      box.appendChild(img);
    } else if (type === 'audio') {
      const audio = document.createElement('audio');
      audio.controls = true;
      audio.preload = 'metadata';
      audio.src = safeSrc;
      audio.onerror = () => {
        audio.replaceWith(this.createMediaErrorNote('Audio tidak dapat dimuat.'));
      };
      box.appendChild(audio);
    } else if (type === 'video') {
      const video = document.createElement('video');
      video.controls = true;
      video.preload = 'metadata';
      video.playsInline = true;
      video.src = safeSrc;
      video.onerror = () => {
        video.replaceWith(this.createMediaErrorNote('Video tidak dapat dimuat.'));
      };
      box.appendChild(video);
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