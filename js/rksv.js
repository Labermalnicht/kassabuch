// Maschinenlesbarer Code nach der österreichischen Registrierkassensicherheitsverordnung (RKSV).
// Seit 2017 trägt jeder Registrierkassenbeleg diesen Code (meist als QR-Code). Aufbau, Felder mit "_" getrennt:
//   _R1-AT<n>_<Kassen-ID>_<Belegnummer>_<JJJJ-MM-TTThh:mm:ss>_<Betrag Normal 20 %>_<Ermäßigt-1 10 %>
//   _<Ermäßigt-2 13 %>_<Null 0 %>_<Besonders 19 % bzw. seit 1. 7. 2026 auch 4,9 %>_<Umsatzzähler>_<Zertifikat>_<Signaturen>
// Beträge sind Bruttobeträge mit Dezimalkomma. Daraus ergeben sich Datum und Endbetrag exakt.

const QR_LIB = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
const RKSV_RE = /_R1-AT\d+_([^_]+)_([^_]+)_(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2})?_(-?\d+[.,]\d{2})_(-?\d+[.,]\d{2})_(-?\d+[.,]\d{2})_(-?\d+[.,]\d{2})_(-?\d+[.,]\d{2})_/;

const cents = (s) => Math.round(parseFloat(s.replace(',', '.')) * 100);

/** Liest den RKSV-Inhalt aus einem Text (QR-Inhalt). null, wenn es kein RKSV-Code ist. */
export function parseRksv(text) {
  const m = String(text || '').match(RKSV_RE);
  if (!m) return null;
  const amounts = {
    normal: cents(m[5]), erm1: cents(m[6]), erm2: cents(m[7]), null: cents(m[8]), besonders: cents(m[9]),
  };
  const total = Object.values(amounts).reduce((s, v) => s + v, 0);
  return { kassenId: m[1], belegNr: m[2], date: m[3], time: m[4], amounts, total };
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

function canvasOf(src, maxSide, region = { x: 0, y: 0, w: 1, h: 1 }) {
  const sw = src.width * region.w;
  const sh = src.height * region.h;
  const scale = Math.min(1.5, maxSide / Math.max(sw, sh));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sw * scale));
  c.height = Math.max(1, Math.round(sh * scale));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, src.width * region.x, src.height * region.y, sw, sh, 0, 0, c.width, c.height);
  return c;
}

/**
 * Sucht auf dem Bild (ImageBitmap/Canvas) QR-Codes und liefert den ersten RKSV-Inhalt oder null.
 * Ein Beleg kann mehrere QR-Codes haben (z. B. Feedback-Link); darum werden auch Bildausschnitte abgesucht.
 */
export async function scanRksv(src) {
  const found = [];
  // 1. Eingebauter Barcode-Leser (Android/Chrome), schnell und robust
  if ('BarcodeDetector' in window) {
    try {
      const det = new window.BarcodeDetector({ formats: ['qr_code'] });
      for (const code of await det.detect(src)) found.push(code.rawValue);
      const hit = found.map(parseRksv).find(Boolean);
      if (hit) return hit;
    } catch { /* nicht unterstützt */ }
  }
  // 2. jsQR über das ganze Bild und über Ausschnitte (Hälften, Drittel), damit auch kleine oder zweite Codes gefunden werden
  let jsQR;
  try { jsQR = await loadQrLib(); } catch { return null; }
  const regions = [
    { x: 0, y: 0, w: 1, h: 1 },
    { x: 0, y: 0.5, w: 1, h: 0.5 }, { x: 0, y: 0, w: 1, h: 0.5 },
    { x: 0, y: 0.66, w: 1, h: 0.34 }, { x: 0, y: 0.33, w: 1, h: 0.34 }, { x: 0, y: 0, w: 1, h: 0.34 },
  ];
  for (const r of regions) {
    for (const size of [1400, 900]) {
      const c = canvasOf(src, size, r);
      const img = c.getContext('2d').getImageData(0, 0, c.width, c.height);
      const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
      if (code && code.data) {
        const hit = parseRksv(code.data);
        if (hit) return hit;
      }
    }
  }
  return null;
}
