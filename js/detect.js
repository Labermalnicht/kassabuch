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

function medianRange(arr, a, b) {
  const v = [];
  for (let x = a; x < b; x++) if (!Number.isNaN(arr[x])) v.push(arr[x]);
  v.sort((p, q) => p - q);
  return v.length ? v[Math.floor(v.length / 2)] : NaN;
}

// Teilt eine Fläche, wenn darin mehrere Belege nebeneinander liegen (auch überlappend). Zwei Belege sind fast nie
// gleich lang: Ober- oder Unterkante springt dort dauerhaft, wo der eine Beleg aufhört. Ein einzelner Beleg ist
// überall gleich lang. Geschnitten wird an jeder deutlichen, bleibenden Stufe. Schmale Streifen am Rand
// (Papierstapel, Mappe, Licht) fallen weg, schmale Streifen dazwischen kommen zum ähnlicheren Nachbarn.
function splitReceipts(xs, ys, w, h, ink, inner, mask) {
  const n = xs.length;
  const sx = Int32Array.from(xs).sort();
  const sy = Int32Array.from(ys).sort();
  const x0 = percentile(sx, 1);
  const x1 = percentile(sx, 99);
  const height = percentile(sy, 99) - percentile(sy, 1) + 1;
  if (n < 50 || (x1 - x0) / height <= 0.4) return [[xs, ys]];

  const colYs = Array.from({ length: w }, () => []);
  for (let i = 0; i < n; i++) colYs[xs[i]].push(ys[i]);
  const top = new Float32Array(w).fill(NaN);
  const bottom = new Float32Array(w).fill(NaN);
  for (let x = x0; x <= x1; x++) {
    if (colYs[x].length > 5) {
      const c = Float32Array.from(colYs[x]).sort();
      top[x] = percentile(c, 3);
      bottom[x] = percentile(c, 97);
    }
  }
  // Stufe je Spalte: Median der Kanten links gegen rechts, je über ein Fenster von WIN Spalten.
  // Zählt nur, wenn der überstehende Teil Schrift trägt (sonst ist es Mappe, Papierrand oder Licht).
  const WIN = 8;
  // Schriftanteil nur im Inneren des Papiers (dunkler Tisch und Kanten daneben zählen nicht).
  const inkIn = (a, b, ya, yb) => {
    let s = 0;
    let c = 0;
    for (let y = Math.max(0, Math.round(ya)); y < Math.round(yb); y++) {
      for (let x = a; x < b; x++) { const i = y * w + x; if (inner[i]) { s += ink[i]; c++; } }
    }
    return c > 10 ? s / c : 0;
  };
  // Wie vollflächig ein Bereich zur Fläche gehört: ein überstehender Bon ist ein volles Rechteck,
  // eine schräg anliegende Mappe oder ein Lichtfleck nicht.
  const fillIn = (a, b, ya, yb) => {
    let s = 0;
    let c = 0;
    for (let y = Math.max(0, Math.round(ya)); y < Math.round(yb); y++) for (let x = a; x < b; x++) { s += mask[y * w + x]; c++; }
    return c ? s / c : 0;
  };
  const stepAt = (c) => {
    const la = Math.max(x0, c - WIN);
    const rb = Math.min(x1 + 1, c + 1 + WIN);
    let s = 0;
    for (const [arr, isTop] of [[top, true], [bottom, false]]) {
      const l = medianRange(arr, la, c);
      const r = medianRange(arr, c + 1, rb);
      const d = Math.abs(l - r);
      if (Number.isNaN(d) || d / height < 0.04) continue;
      // Reicht der überstehende Teil bis an den Bildrand, ist es Hintergrund (Mappe, Papierstapel), kein Beleg.
      if (isTop ? Math.min(l, r) < 0.03 * h : Math.max(l, r) > 0.97 * h - 1) continue;
      // Die längere Seite steht über: oben die mit der kleineren Oberkante, unten die mit der größeren Unterkante.
      const leftLonger = isTop ? l < r : l > r;
      // Der überstehende Teil muss ein volles Stück Papier mit Schrift sein (insgesamt und nahe der Schnittstelle).
      // Die Schwellen sind niedrig, weil Live-Kamerabilder oft leicht unscharf sind.
      const span = (k) => (leftLonger ? [Math.max(x0, c - k * WIN), c] : [c + 1, Math.min(x1 + 1, c + 1 + k * WIN)]);
      const ya = Math.min(l, r);
      const yb = Math.max(l, r);
      if (fillIn(...span(4), ya, yb) >= 0.88 && inkIn(...span(4), ya, yb) >= 0.012 && inkIn(...span(2), ya, yb) >= 0.004) s += d;
    }
    return s / height;
  };
  const steps = new Float32Array(w);
  for (let c = x0 + 3; c <= x1 - 3; c++) steps[c] = stepAt(c);
  // Örtliche Spitzen über der Schwelle, mindestens WIN Spalten auseinander.
  const cuts = [];
  for (let c = x0 + 3; c <= x1 - 3; c++) {
    if (steps[c] < 0.12) continue;
    let peak = true;
    for (let d = -WIN; d <= WIN && peak; d++) {
      const v = steps[c + d] || 0;
      if (v > steps[c] || (v === steps[c] && d < 0)) peak = false;
    }
    if (peak) cuts.push(c);
  }
  if (!cuts.length) return [[xs, ys]];
  // Abschnitte bilden. Schmale Abschnitte innen kommen zum Nachbarn mit ähnlicheren Kanten; am Rand ebenso, wenn sie
  // innerhalb der Höhe des Nachbarn liegen (Randstück desselben Bons), sonst fallen sie weg (Papierstapel, Mappe).
  const bounds = [x0, ...cuts, x1 + 1];
  const segs = bounds.slice(0, -1).map((a, i) => ({ a, b: bounds[i + 1] }));
  const minW = Math.max(6, 0.12 * height);
  const edgesOf = (sg) => [medianRange(top, sg.a, sg.b), medianRange(bottom, sg.a, sg.b)];
  for (;;) {
    const i = segs.findIndex((sg) => sg.b - sg.a < minW);
    if (i < 0 || segs.length === 1) break;
    const [t, bt] = edgesOf(segs[i]);
    if (i === 0 || i === segs.length - 1) {
      const nb = segs[i === 0 ? 1 : i - 1];
      const [nt, nbt] = edgesOf(nb);
      const tol = 0.1 * height;
      if (t >= nt - tol && bt <= nbt + tol) { nb.a = Math.min(nb.a, segs[i].a); nb.b = Math.max(nb.b, segs[i].b); }
      segs.splice(i, 1);
      continue;
    }
    const diff = (sg) => { const [t2, b2] = edgesOf(sg); return Math.abs(t - t2) + Math.abs(bt - b2); };
    const j = diff(segs[i - 1]) <= diff(segs[i + 1]) ? i - 1 : i + 1;
    segs[j] = { a: Math.min(segs[i].a, segs[j].a), b: Math.max(segs[i].b, segs[j].b) };
    segs.splice(i, 1);
  }
  const out = segs.map(() => [[], []]);
  for (let i = 0; i < n; i++) {
    const k = segs.findIndex((sg) => xs[i] >= sg.a && xs[i] < sg.b);
    if (k >= 0) { out[k][0].push(xs[i]); out[k][1].push(ys[i]); }
  }
  return out.filter((o) => o[0].length);
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
  // Schrift: dunkler als die Umgebung (Schwelle so, dass auch leicht unscharfe Kamerabilder reichen).
  const Lb = boxBlur(L, w, h, 6);
  const ink = new Uint8Array(N);
  for (let i = 0; i < N; i++) ink[i] = L[i] < Math.max(60, Lb[i] - 25) ? 1 : 0;

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
    const parts = splitReceipts(xsAll, ysAll, w, h, ink, core, mask);
    const kept = [];
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
      let warmSum = 0;
      let warmN = 0;
      for (let y = by0; y < by1; y++) {
        for (let x = bx0; x < bx1; x++) {
          const i = y * w + x;
          if (mask[i] && bright[i]) { warmSum += warm[i]; warmN++; }
        }
      }
      kept.push({ box: { x: rx0, y: ry0, w: rx1 - rx0, h: ry1 - ry0 }, warmth: warmN ? warmSum / warmN : 0 });
    }
    // Aus derselben Fläche nur Teile, die ähnlich warm sind wie der wärmste: Thermopapier ist deutlich wärmer
    // als daneben liegendes, nur warm angestrahltes Kopierpapier.
    const maxWarm = Math.max(0, ...kept.map((k) => k.warmth));
    for (const k of kept) if (k.warmth >= 0.6 * maxWarm) found.push(k.box);
  }
  return found.sort((a, b) => a.x - b.x);
}
