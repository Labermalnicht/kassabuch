// Maschinenlesbarer Code nach der österreichischen Registrierkassensicherheitsverordnung (RKSV).
// Seit 2017 trägt jeder Registrierkassenbeleg diesen Code (meist als QR-Code). Aufbau, Felder mit "_" getrennt:
//   _R1-AT<n>_<Kassen-ID>_<Belegnummer>_<JJJJ-MM-TTThh:mm:ss>_<Betrag Normal 20 %>_<Ermäßigt-1 10 %>
//   _<Ermäßigt-2 13 %>_<Null 0 %>_<Besonders 19 % bzw. seit 1. 7. 2026 auch 4,9 %>_<Umsatzzähler>_<Zertifikat>_<Signaturen>
// Beträge sind Bruttobeträge mit Dezimalkomma. Daraus ergeben sich Datum und Endbetrag exakt.
// Das Feld Zertifikat enthält bei Kassen großer Unternehmen (geschlossenes System) den Ordnungsbegriff, meist die
// UID-Nummer mit Endung ("U:ATU12345678-001"), sonst die Seriennummer des Signaturzertifikats des Betriebs.
// Beides bleibt für alle Kassen und Filialen eines Unternehmens gleich, die Kassen-ID dagegen nicht.

const QR_LIB = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
const RKSV_RE = /_R1-AT\d+_([^_]+)_([^_]+)_(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2})?_(-?\d+[.,]\d{2})_(-?\d+[.,]\d{2})_(-?\d+[.,]\d{2})_(-?\d+[.,]\d{2})_(-?\d+[.,]\d{2})_(?:[^_]*_([^_]+))?/;

const cents = (s) => Math.round(parseFloat(s.replace(',', '.')) * 100);

/** Liest den RKSV-Inhalt aus einem Text (QR-Inhalt). null, wenn es kein RKSV-Code ist. */
export function parseRksv(text) {
  const m = String(text || '').match(RKSV_RE);
  if (!m) return null;
  const amounts = {
    normal: cents(m[5]), erm1: cents(m[6]), erm2: cents(m[7]), null: cents(m[8]), besonders: cents(m[9]),
  };
  const total = Object.values(amounts).reduce((s, v) => s + v, 0);
  return { kassenId: m[1], belegNr: m[2], date: m[3], time: m[4], amounts, total, cert: m[10] || '' };
}

let libPromise = null;
export function loadQrLib() {
  if (window.jsQR) return Promise.resolve(window.jsQR);
  if (!libPromise) {
    libPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = QR_LIB;
      s.onload = () => resolve(window.jsQR);
      s.onerror = () => { libPromise = null; reject(new Error('jsQR')); };
      document.head.appendChild(s);
    });
  }
  return libPromise;
}

// Ausschnitt region (Anteile) als Canvas; so skaliert, dass die Breite etwa targetW Pixel hat
// (kleine Codes werden dabei vergrößert, das hilft jsQR deutlich), höchstens maxSide Pixel an der längeren Seite.
function canvasOf(src, targetW, region = { x: 0, y: 0, w: 1, h: 1 }, maxSide = 2000) {
  const sw = src.width * region.w;
  const sh = src.height * region.h;
  const scale = Math.min(3, targetW / sw, maxSide / Math.max(sw, sh));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sw * scale));
  c.height = Math.max(1, Math.round(sh * scale));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, src.width * region.x, src.height * region.y, sw, sh, 0, 0, c.width, c.height);
  return c;
}

/**
 * Liest mit jsQR alle Codes eines Bildes nacheinander: jsQR meldet nur einen Code, darum wird jeder gefundene
 * Code übermalt und weitergesucht (z. B. steht unter dem RKSV-Code oft ein Feedback-QR-Code).
 * Liefert den ersten RKSV-Inhalt oder null; onText(text) für jeden gelesenen Code.
 */
export function jsqrRksv(jsQR, img, onText) {
  for (let k = 0; k < 3; k++) {
    const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
    if (!code || !code.data) return null;
    if (onText) onText(code.data);
    const hit = parseRksv(code.data);
    if (hit) return hit;
    const L = code.location;
    const xs = [L.topLeftCorner.x, L.topRightCorner.x, L.bottomLeftCorner.x, L.bottomRightCorner.x];
    const ys = [L.topLeftCorner.y, L.topRightCorner.y, L.bottomLeftCorner.y, L.bottomRightCorner.y];
    const m = 0.15 * (Math.max(...xs) - Math.min(...xs));
    const x0 = Math.max(0, Math.floor(Math.min(...xs) - m));
    const x1 = Math.min(img.width, Math.ceil(Math.max(...xs) + m));
    const y0 = Math.max(0, Math.floor(Math.min(...ys) - m));
    const y1 = Math.min(img.height, Math.ceil(Math.max(...ys) + m));
    for (let y = y0; y < y1; y++) img.data.fill(255, (y * img.width + x0) * 4, (y * img.width + x1) * 4);
  }
  return null;
}

// Überlappende waagrechte Streifen, damit kein Code an einer Streifengrenze zerschnitten wird.
function strips(h) {
  const out = [];
  for (let y = 0; y + h <= 1.001; y += h / 2) out.push({ x: 0, y: Math.min(y, 1 - h), w: 1, h });
  return out;
}

/**
 * Sucht auf dem Bild (ImageBitmap/Canvas) QR-Codes und liefert den ersten RKSV-Inhalt oder null.
 * Ein Beleg kann mehrere QR-Codes haben (z. B. Feedback-Link); darum werden auch vergrößerte Ausschnitte abgesucht.
 */
export async function scanRksv(src) {
  // 1. Eingebauter Barcode-Leser (Android/Chrome), schnell und robust, liefert alle Codes
  if ('BarcodeDetector' in window) {
    try {
      const det = new window.BarcodeDetector({ formats: ['qr_code'] });
      const hit = (await det.detect(src)).map((code) => parseRksv(code.rawValue)).find(Boolean);
      if (hit) return hit;
    } catch { /* nicht unterstützt */ }
  }
  // 2. jsQR über das ganze Bild und über überlappende, vergrößerte Streifen (Hälften, Drittel, Viertel)
  let jsQR;
  try { jsQR = await loadQrLib(); } catch { return null; }
  const regions = [{ x: 0, y: 0, w: 1, h: 1 }, ...strips(0.5), ...strips(1 / 3), ...strips(0.25)];
  for (const r of regions) {
    for (const targetW of [1100, 800]) {
      const c = canvasOf(src, targetW, r);
      const hit = jsqrRksv(jsQR, c.getContext('2d').getImageData(0, 0, c.width, c.height));
      if (hit) return hit;
    }
  }
  return null;
}
