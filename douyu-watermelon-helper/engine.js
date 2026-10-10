(function (root) {
  'use strict';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const colorDistance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const pixel = (image, x, y) => {
    const i = (clamp(Math.round(y), 0, image.height - 1) * image.width + clamp(Math.round(x), 0, image.width - 1)) * 4;
    return Array.from(image.data.slice(i, i + 3));
  };

  function histogram(image, x, y, r) {
    const bins = new Array(20).fill(0);
    let count = 0;
    const step = Math.max(1, Math.floor(r / 12));
    const inner = Math.max(2, r * 0.64);
    for (let yy = Math.max(0, Math.floor(y - inner)); yy < Math.min(image.height, y + inner); yy += step) {
      for (let xx = Math.max(0, Math.floor(x - inner)); xx < Math.min(image.width, x + inner); xx += step) {
        if ((xx - x) ** 2 + (yy - y) ** 2 > inner ** 2) continue;
        const i = (yy * image.width + xx) * 4;
        const rr = image.data[i] / 255, g = image.data[i + 1] / 255, b = image.data[i + 2] / 255;
        const max = Math.max(rr, g, b), min = Math.min(rr, g, b), delta = max - min;
        let bin;
        if (delta < 0.12) bin = 16 + Math.min(3, Math.floor(max * 4));
        else {
          let hue = max === rr ? (g - b) / delta : max === g ? (b - rr) / delta + 2 : (rr - g) / delta + 4;
          hue = ((hue / 6) % 1 + 1) % 1;
          bin = Math.min(15, Math.floor(hue * 16));
        }
        bins[bin]++;
        count++;
      }
    }
    return bins.map(n => n / Math.max(1, count));
  }

  function similarity(a, b) {
    const color = a.hist.reduce((s, v, i) => s + Math.sqrt(v * b.hist[i]), 0);
    const ratio = Math.min(a.r, b.r) / Math.max(a.r, b.r);
    // 相邻级水果颜色有时相近，尺寸差异也必须足够小。
    return ratio < 0.76 ? 0 : color * ratio ** 1.5;
  }

  function makeMask(image, rect, colors, threshold, scale = 1) {
    const w = Math.max(1, Math.floor(rect.w / scale)), h = Math.max(1, Math.floor(rect.h / scale));
    const data = new Uint8Array(w * h);
    let foreground = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const p = pixel(image, rect.x + x * scale, rect.y + y * scale);
        if (colors.every(c => colorDistance(p, c) > threshold)) { data[y * w + x] = 1; foreground++; }
      }
    }
    // 填补完全封闭的背景洞（水果纹理），保留连通到棋盘边缘的背景。
    const outside = new Uint8Array(w * h), queue = new Int32Array(w * h);
    let head = 0, tail = 0;
    function push(i) { if (!data[i] && !outside[i]) { outside[i] = 1; queue[tail++] = i; } }
    for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
    while (head < tail) {
      const i = queue[head++], x = i % w, y = Math.floor(i / w);
      if (x) push(i - 1); if (x + 1 < w) push(i + 1);
      if (y) push(i - w); if (y + 1 < h) push(i + w);
    }
    for (let i = 0; i < data.length; i++) if (!outside[i]) data[i] = 1;
    return { data, w, h, fraction: foreground / (w * h) };
  }

  function currentFruit(image, rect, threshold = 38) {
    const margin = 3;
    const colors = [[margin, margin], [rect.w - margin, margin], [margin, rect.h - margin], [rect.w - margin, rect.h - margin]]
      .map(([x, y]) => pixel(image, rect.x + x, rect.y + y));
    const m = makeMask(image, rect, colors, threshold);
    const seen = new Uint8Array(m.data.length);
    let best = null;
    for (let i = 0; i < m.data.length; i++) {
      if (!m.data[i] || seen[i]) continue;
      const queue = [i]; seen[i] = 1;
      let head = 0, minX = m.w, minY = m.h, maxX = 0, maxY = 0;
      while (head < queue.length) {
        const k = queue[head++], x = k % m.w, y = Math.floor(k / m.w);
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        for (const n of [x ? k - 1 : -1, x + 1 < m.w ? k + 1 : -1, y ? k - m.w : -1, y + 1 < m.h ? k + m.w : -1]) {
          if (n >= 0 && m.data[n] && !seen[n]) { seen[n] = 1; queue.push(n); }
        }
      }
      const bw = maxX - minX + 1, bh = maxY - minY + 1;
      const circular = Math.min(bw, bh) / Math.max(bw, bh);
      if (bw < 6 || bh < 6 || circular < 0.65 || queue.length / (bw * bh) < 0.45) continue;
      if (!best || queue.length > best.area) best = { x: rect.x + (minX + maxX) / 2, y: rect.y + (minY + maxY) / 2, r: (bw + bh) / 4, area: queue.length };
    }
    if (!best) return null;
    best.hist = histogram(image, best.x, best.y, best.r);
    return best;
  }

  function detect(image, board, colors, threshold = 38, minRadius = 8, excluded = null) {
    const scale = Math.max(1, board.w / 320);
    const m = makeMask(image, board, colors, threshold, scale);
    if (excluded) {
      for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
        const ax = board.x + x * scale, ay = board.y + y * scale;
        if (ax >= excluded.x && ax < excluded.x + excluded.w && ay >= excluded.y && ay < excluded.y + excluded.h) m.data[y * m.w + x] = 0;
      }
    }
    const dist = new Float32Array(m.data.length);
    const { w, h } = m;
    for (let i = 0; i < dist.length; i++) dist[i] = m.data[i] ? w + h : 0;
    const diagonal = Math.SQRT2;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (dist[i]) dist[i] = Math.min(dist[i], dist[i - 1] + 1, dist[i - w] + 1, dist[i - w - 1] + diagonal, dist[i - w + 1] + diagonal);
    }
    for (let y = h - 2; y > 0; y--) for (let x = w - 2; x > 0; x--) {
      const i = y * w + x;
      if (dist[i]) dist[i] = Math.min(dist[i], dist[i + 1] + 1, dist[i + w] + 1, dist[i + w + 1] + diagonal, dist[i + w - 1] + diagonal);
    }
    const candidates = [];
    for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
      const i = y * w + x, r = dist[i];
      if (r * scale < minRadius) continue;
      if ([i - 1, i + 1, i - w, i + w, i - w - 1, i - w + 1, i + w - 1, i + w + 1].some(k => dist[k] > r)) continue;
      candidates.push({ x: board.x + x * scale, y: board.y + y * scale, r: r * scale });
    }
    candidates.sort((a, b) => b.r - a.r);
    const fruits = [];
    for (const c of candidates) {
      if (fruits.some(f => Math.hypot(c.x - f.x, c.y - f.y) < (c.r + f.r) * 0.76)) continue;
      // 边框或大块非圆形遮挡不应被当作水果。
      let rim = 0;
      for (let i = 0; i < 24; i++) {
        const angle = i * Math.PI / 12;
        const x = Math.round((c.x - board.x + Math.cos(angle) * c.r * 1.35) / scale);
        const y = Math.round((c.y - board.y + Math.sin(angle) * c.r * 1.35) / scale);
        if (x >= 0 && x < w && y >= 0 && y < h && m.data[y * w + x]) rim++;
      }
      if (rim > 19) continue;
      c.hist = histogram(image, c.x, c.y, c.r);
      fruits.push(c);
      if (fruits.length > 100) break;
    }
    return { fruits, fraction: m.fraction };
  }

  function plan(board, fruits, current) {
    const r = current.r, left = board.x + r + 2, right = board.x + board.w - r - 2;
    if (right <= left) return null;
    const xs = Array.from({ length: 31 }, (_, i) => left + (right - left) * i / 30);
    for (const f of fruits) {
      xs.push(clamp(f.x, left, right));
      xs.push(clamp(f.x - f.r - r, left, right), clamp(f.x + f.r + r, left, right));
    }
    const choices = [];
    for (const x of xs) {
      let y = board.y + board.h - r, hit = null;
      for (const f of fruits) {
        const dx = Math.abs(x - f.x), sum = r + f.r;
        if (dx >= sum) continue;
        const yy = f.y - Math.sqrt(Math.max(0, sum * sum - dx * dx));
        if (yy < y) { y = yy; hit = f; }
      }
      const match = hit ? similarity(current, hit) : 0;
      const alignment = hit ? 1 - Math.abs(x - hit.x) / (r + hit.r) : 0;
      const merge = match >= 0.68 && alignment >= 0.2;
      const depth = clamp((y - board.y) / board.h, -1, 1);
      const heightRisk = Math.max(0, 0.4 - depth);
      const centerBias = 1 - Math.abs(x - (board.x + board.w / 2)) / (board.w / 2);
      // 垂直首个碰撞体匹配才奖励，避免为了埋在底下的同类水果堆高。
      const score = (merge ? 115 * match * (0.6 + 0.4 * alignment) : 0) + depth * 48 - heightRisk * 200 + centerBias * 1.5;
      choices.push({ x, y, score, merge, match, hit });
    }
    choices.sort((a, b) => b.score - a.score);
    return choices[0];
  }

  function motion(a, b, rect) {
    if (!a || a.width !== b.width || a.height !== b.height) return 1;
    let changed = 0, count = 0;
    for (let y = Math.ceil(rect.y); y < rect.y + rect.h; y += 5) for (let x = Math.ceil(rect.x); x < rect.x + rect.w; x += 5) {
      if (colorDistance(pixel(a, x, y), pixel(b, x, y)) > 34) changed++;
      count++;
    }
    return changed / Math.max(1, count);
  }

  const api = { pixel, histogram, similarity, currentFruit, detect, plan, motion };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WatermelonEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
