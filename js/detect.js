// Findet Kassenzettel auf einem Foto, ohne Zusatzbibliothek.
// Idee: Thermopapier ist leicht cremefarben (Rot deutlich über Blau), Kopierpapier und Tisch sind neutral oder kühl.
// Helle, warme Flächen mit Schrift und Belegform werden als Beleg vorgeschlagen.
// Entwickelt und abgestimmt an echten Belegfotos (mehrere Belege nebeneinander, Kopien darunter, Hand im Bild).

const W0 = 240;

// Mittelwert über ein Quadrat mit Radius r (Summenbild, Rand wird fortgesetzt).
function boxBlur(src, w, h, r) {
  const W = w + 1;
  const sum = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += src[y * w + x];
      sum[(y + 1) * W + x + 1] = sum[y * W + x + 1] + row;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const s = sum[y1 * W + x1] - sum[y0 * W + x1] - sum[y1 * W + x0] + sum[y0 * W + x0];
      out[y * w + x] = s / ((y1 - y0) * (x1 - x0));
    }
  }
  return out;
}

// Otsu-Schwelle: teilt die Werte in zwei Gruppen (Papier und Beleg). Liefert [Schwelle, Mittel unten, Mittel oben].
function otsu(values) {
  if (values.length < 100) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) { if (v < min) min = v; if (v > max) max = v; }
  if (max - min < 1) return null;
  const bins = 64;
  const hist = new Float64Array(bins);
  const step = (max - min) / bins;
  for (const v of values) hist[Math.min(bins - 1, Math.floor((v - min) / step))]++;
  const center = (i) => min + (i + 0.5) * step;
  let best = null;
  let bestS = 0;
  for (let i = 1; i < bins; i++) {
    let w0 = 0; let s0 = 0; let w1 = 0; let s1 = 0;
    for (let j = 0; j < i; j++) { w0 += hist[j]; s0 += hist[j] * center(j); }
    for (let j = i; j < bins; j++) { w1 += hist[j]; s1 += hist[j] * center(j); }
    if (!w0 || !w1) continue;
    const m0 = s0 / w0;
    const m1 = s1 / w1;
    const s = w0 * w1 * (m0 - m1) ** 2;
    if (s > bestS) { bestS = s; best = [min + i * step, m0, m1]; }
  }
  return best;
}

function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))))];
}

// Zusammenhängende Flächen (4er-Nachbarschaft) als Listen von Pixelindizes.
function components(mask, w, h) {
  const label = new Int32Array(w * h);
  const out = [];
  const stack = new Int32Array(w * h);
  let n = 0;
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || label[i]) continue;
    n++;
    let top = 0;
    stack[top++] = i;
    label[i] = n;
    const pts = [];
    while (top) {
      const p = stack[--top];
      pts.push(p);
      const x = p % w;
      const y = (p - x) / w;
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (const q of nb) {
        if (q >= 0 && mask[q] && !label[q]) { label[q] = n; stack[top++] = q; }
      }
    }
    out.push(pts);
  }
  return out;
}

/**
 * Sucht Belege auf dem Bild (ImageBitmap, Image oder Canvas).
 * Ergebnis: Rechtecke { x, y, w, h } als Anteile von 0 bis 1, von links nach rechts sortiert.
 */
export function detectReceipts(src) {
  const w = W0;
  const h = Math.max(1, Math.round((W0 * src.height) / src.width));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const N = w * h;
  const L = new Float32Array(N);
  const warm = new Float32Array(N);
  const bright = new Uint8Array(N);
  const brightW = [];
  for (let i = 0; i < N; i++) {
    const r = px[i * 4];
    const g = px[i * 4 + 1];
    const b = px[i * 4 + 2];
    L[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    warm[i] = r - b;
    if (L[i] > 140) { bright[i] = 1; brightW.push(warm[i]); }
  }
  // Schwelle je Foto: warmes Belegpapier gegen neutrales Umfeld.
  const o = otsu(brightW);
  if (!o || o[2] - o[1] < 12) return [];
  const cand = new Float32Array(N);
  // Hell, wärmer als die Schwelle, aber nicht so warm wie Haut (Haut ist außerdem dunkler und fällt schon über "hell" weg).
  for (let i = 0; i < N; i++) cand[i] = bright[i] && warm[i] > o[0] && warm[i] < 50 ? 1 : 0;

  // Schrift schließen: Anteil warmer Pixel unter den hellen Pixeln der Umgebung.
  const num = boxBlur(cand, w, h, 3);
  const den = boxBlur(Float32Array.from(bright), w, h, 3);
  const m0 = new Float32Array(N);
  for (let i = 0; i < N; i++) m0[i] = cand[i] || (den[i] > 0.2 && num[i] / Math.max(den[i], 1e-3) > 0.5) ? 1 : 0;
  const m1 = boxBlur(m0, w, h, 2);
  const mask = new Uint8Array(N);
  for (let i = 0; i < N; i++) mask[i] = m1[i] > 0.5 ? 1 : 0;
  // Abtragen, damit dünne Brücken zu warm beleuchteten Flächen reißen.
  const ER = 3;
  const er = boxBlur(Float32Array.from(mask), w, h, ER);
  const core = new Uint8Array(N);
  for (let i = 0; i < N; i++) core[i] = er[i] > 0.97 ? 1 : 0;
  // Schrift: dunkler als die Umgebung.
  const Lb = boxBlur(L, w, h, 6);
  const ink = new Uint8Array(N);
  for (let i = 0; i < N; i++) ink[i] = L[i] < Math.max(60, Lb[i] - 35) ? 1 : 0;

  const meanIn = (arr, x0, y0, x1, y1) => {
    let s = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) s += arr[y * w + x];
    return s / Math.max(1, (x1 - x0) * (y1 - y0));
  };

  const found = [];
  for (const pts of components(core, w, h)) {
    if (pts.length / N < 0.02) continue;
    const xsAll = Int32Array.from(pts, (p) => p % w);
    const ysAll = Int32Array.from(pts, (p) => Math.floor(p / w));
    const sx = Int32Array.from(xsAll).sort();
    const sy = Int32Array.from(ysAll).sort();
    const x0 = percentile(sx, 1);
    const x1 = percentile(sx, 99);
    const y0 = percentile(sy, 1);
    const y1 = percentile(sy, 99);
    let parts = [[xsAll, ysAll]];
    // Zu breit für einen Beleg: vermutlich zwei nebeneinander, an der am dünnsten gefüllten Spalte teilen.
    if ((x1 - x0) / (y1 - y0 + 1) > 0.6) {
      const cols = new Float32Array(w);
      for (const x of xsAll) cols[x]++;
      const lo = Math.floor(x0 + (x1 - x0) * 0.3);
      const hi = Math.floor(x0 + (x1 - x0) * 0.7);
      let cut = lo;
      let bestV = Infinity;
      for (let x = lo; x < hi; x++) {
        let s = 0;
        for (let k = -2; k <= 2; k++) s += cols[Math.min(w - 1, Math.max(0, x + k))];
        if (s < bestV) { bestV = s; cut = x; }
      }
      const left = [[], []];
      const right = [[], []];
      for (let i = 0; i < xsAll.length; i++) {
        const t = xsAll[i] < cut ? left : right;
        t[0].push(xsAll[i]);
        t[1].push(ysAll[i]);
      }
      parts = [left, right];
    }
    for (const [pxs, pys] of parts) {
      if (pxs.length / N < 0.02) continue;
      const qx = Int32Array.from(pxs).sort();
      const qy = Int32Array.from(pys).sort();
      let bx0 = Math.max(0, percentile(qx, 1) - ER);
      let bx1 = Math.min(w, percentile(qx, 99) + 1 + ER);
      let by0 = Math.max(0, percentile(qy, 0.5) - ER);
      let by1 = Math.min(h, percentile(qy, 99.5) + 1 + ER);
      // Ränder zurückschneiden, solange sie deutlich dünner gefüllt sind als die dichtesten Spalten/Zeilen.
      for (let it = 0; it < 150; it++) {
        if (bx1 - bx0 < 10 || by1 - by0 < 10) break;
        const colMeans = [];
        for (let x = bx0; x < bx1; x++) colMeans.push(meanIn(mask, x, by0, x + 1, by1));
        const rowMeans = [];
        for (let y = by0; y < by1; y++) rowMeans.push(meanIn(mask, bx0, y, bx1, y + 1));
        const cm = percentile(Float32Array.from(colMeans).sort(), 90);
        const rm = percentile(Float32Array.from(rowMeans).sort(), 90);
        let moved = false;
        if (colMeans[0] < 0.75 * cm) { bx0++; moved = true; }
        if (colMeans[colMeans.length - 1] < 0.75 * cm) { bx1--; moved = true; }
        if (rowMeans[0] < 0.4 * rm) { by0++; moved = true; }
        if (rowMeans[rowMeans.length - 1] < 0.4 * rm) { by1--; moved = true; }
        if (!moved) break;
      }
      const touches = (bx0 <= 1) + (by0 <= 1) + (bx1 >= w - 1) + (by1 >= h - 1);
      const fill = meanIn(mask, bx0, by0, bx1, by1);
      const inkD = meanIn(ink, bx0, by0, bx1, by1);
      const aspect = (bx1 - bx0) / (by1 - by0);
      if (touches >= 2 && fill < 0.7) continue; // Fläche über mehrere Bildränder: eher Licht oder Unterlage
      if (inkD < 0.02 || fill < 0.45 || aspect > 1.2) continue; // keine Schrift, zu löchrig oder zu breit
      // Sicherheitsrand: lieber etwas Hintergrund als abgeschnittene Schrift.
      const rx0 = Math.max(0, bx0 / w - 0.03);
      const ry0 = Math.max(0, by0 / h - 0.015);
      const rx1 = Math.min(1, bx1 / w + 0.03);
      const ry1 = Math.min(1, by1 / h + 0.015);
      found.push({ x: rx0, y: ry0, w: rx1 - rx0, h: ry1 - ry0 });
    }
  }
  return found.sort((a, b) => a.x - b.x);
}
