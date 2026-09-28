// Live-Scanner: Kamera läuft als Videobild, mehrmals pro Sekunde wird nach dem RKSV-QR-Code gesucht.
// Android/Chrome: eingebauter BarcodeDetector. iPhone/Safari: jsQR, abwechselnd auf dem ganzen Bild und auf
// vergrößerten Bildstreifen, weil der Code auf einem ganzen Bon im Bild sonst zu klein ist.
// Zusätzlich wird etwa zweimal pro Sekunde nach Kassenbons gesucht: Liegt ein Bon ruhig im Bild, wird er übernommen.
import { parseRksv, loadQrLib, jsqrRksv } from './rksv.js';
import { detectReceipts } from './detect.js';

let stream = null;
let timer = null;
let video = null;
let detector = null;
let busy = false;
let qrTurn = 0;
const work = document.createElement('canvas');
const detWork = document.createElement('canvas');
const DETECT_EVERY = 450; // ms zwischen zwei Bonsuchen
const STABLE_HITS = 3; // so oft hintereinander gleich viele Bons an derselben Stelle, dann gilt das Bild als ruhig
let lastDetect = 0;
let track = null; // { box, n, hits } des aktuell verfolgten Bons (n = Anzahl der Bons im Bild)
// Zuletzt übernommener Bon: erst wieder auslösen, wenn er aus dem Bild war oder sich deutlich bewegt hat.
let blocked = null;
// Abwechselnd abgesuchte Bildbereiche für jsQR: ganzes Bild, dann überlappende Hälften und Drittel.
const QR_REGIONS = [
  { y: 0, h: 1 }, { y: 0, h: 0.5 }, { y: 0.25, h: 0.5 }, { y: 0.5, h: 0.5 },
  { y: 0, h: 1 }, { y: 0.33, h: 0.34 }, { y: 0.66, h: 0.34 }, { y: 0, h: 0.34 },
];

const iou = (a, b) => {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const i = ix * iy;
  return i / (a.w * a.h + b.w * b.h - i);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export const scannerActive = () => !!stream;

// Nach einem Neuzeichnen der Oberfläche das neue Videoelement mit der laufenden Kamera verbinden.
export function attachScanner(videoEl) {
  if (!stream || !videoEl || videoEl === video) return;
  video = videoEl;
  video.srcObject = stream;
  video.play().catch(() => {});
}

// Aktuelles Kamerabild in voller Auflösung.
export function grabFrame() {
  const c = document.createElement('canvas');
  c.width = video ? video.videoWidth : 0;
  c.height = video ? video.videoHeight : 0;
  if (c.width) c.getContext('2d').drawImage(video, 0, 0);
  return c;
}

// Schärfe eines Bildausschnitts: mittlere quadrierte Kantenstärke (Laplace) auf einer verkleinerten Graustufe.
function sharpness(frame, box) {
  const W = 320;
  const sw = frame.width * box.w;
  const sh = frame.height * box.h;
  const H = Math.max(8, Math.round((W * sh) / sw));
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(frame, frame.width * box.x, frame.height * box.y, sw, sh, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data;
  const g = (x, y) => { const i = (y * W + x) * 4; return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; };
  let s = 0;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const l = 4 * g(x, y) - g(x - 1, y) - g(x + 1, y) - g(x, y - 1) - g(x, y + 1);
      s += l * l;
    }
  }
  return s / ((W - 2) * (H - 2));
}

// Mehrere Bilder kurz hintereinander, das schärfste gewinnt (weniger Verwacklung für die Texterkennung).
async function sharpestFrame(box) {
  let best = null;
  for (let k = 0; k < 3 && video; k++) {
    if (k) await wait(120);
    if (!video) break;
    const f = grabFrame();
    const s = sharpness(f, box);
    if (!best || s > best.s) best = { f, s };
  }
  return best ? best.f : grabFrame();
}

export function stopScanner() {
  if (timer) clearInterval(timer);
  timer = null;
  if (stream) stream.getTracks().forEach((tr) => tr.stop());
  stream = null;
  if (video) video.srcObject = null;
  video = null;
  busy = false;
  track = null;
}

// Bonsuche auf einem verkleinerten Kamerabild. Liefert die Bons, sobald das Bild ruhig ist, sonst null.
function detectStep(onBoxes) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const sc = Math.min(1, 480 / Math.max(vw, vh));
  detWork.width = Math.round(vw * sc);
  detWork.height = Math.round(vh * sc);
  detWork.getContext('2d', { willReadFrequently: true }).drawImage(video, 0, 0, detWork.width, detWork.height);
  // Nur ausreichend große Bons: ein winziger Bon im Bild ergibt keine lesbare Schrift.
  const boxes = detectReceipts(detWork).filter((b) => b.w * b.h >= 0.06);
  const main = boxes.reduce((best, b) => (!best || b.w * b.h > best.w * best.h ? b : best), null);
  if (blocked && (!main || iou(main, blocked) < 0.5)) blocked = null;
  if (!main || blocked) {
    track = null;
    if (onBoxes) onBoxes(boxes, 0);
    return null;
  }
  // Ruhig heißt: gleich viele Bons und der größte an derselben Stelle.
  const same = track && track.n === boxes.length && iou(track.box, main) >= 0.8;
  track = { box: main, n: boxes.length, hits: same ? track.hits + 1 : 1 };
  if (onBoxes) onBoxes(boxes, track.hits / STABLE_HITS);
  if (track.hits < STABLE_HITS) return null;
  blocked = main;
  return boxes;
}

// jsQR auf dem nächsten Bildbereich der Reihe (vergrößert, damit auch kleine Codes lesbar sind).
function jsqrTick(jsQR, onText) {
  const r = QR_REGIONS[qrTurn++ % QR_REGIONS.length];
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const sh = vh * r.h;
  const sc = Math.min(2, (r.h === 1 ? 960 : 1200) / Math.max(vw, sh));
  work.width = Math.round(vw * sc);
  work.height = Math.round(sh * sc);
  const ctx = work.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(video, 0, vh * r.y, vw, sh, 0, 0, work.width, work.height);
  return jsqrRksv(jsQR, ctx.getImageData(0, 0, work.width, work.height), onText);
}

/**
 * Startet Kamera und Suche. onRksv(inhalt, bild) wird beim ersten gültigen RKSV-Code aufgerufen,
 * onOther() bei anderen QR-Codes (z. B. Feedback-Links), onError(fehler) wenn die Kamera nicht verfügbar ist.
 * onReceipt(bild, bons) wird aufgerufen, wenn Bons ohne lesbaren Code ruhig im Bild liegen; onBoxes(bons, fortschritt)
 * nach jeder Bonsuche für die Anzeige. fresh: neue Scan-Runde, ein zuvor übernommener Bon zählt wieder.
 */
export async function startScanner(videoEl, { onRksv, onOther, onError, stillWanted, onReceipt, onBoxes, fresh }) {
  stopScanner();
  if (fresh) blocked = null;
  lastDetect = Date.now() + 600; // erste Bonsuche erst, wenn die Kamera scharf gestellt hat
  let s;
  try {
    // Möglichst hohe Auflösung: ganze Bons im Bild brauchen viele Pixel für Schrift und QR-Code.
    s = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } },
      audio: false,
    });
  } catch (e) {
    onError(e);
    return;
  }
  // Fenster wurde inzwischen geschlossen: Kamera gleich wieder freigeben.
  if (stillWanted && !stillWanted()) { s.getTracks().forEach((tr) => tr.stop()); return; }
  stream = s;
  video = videoEl;
  video.setAttribute('playsinline', '');
  video.muted = true;
  video.srcObject = stream;
  await video.play().catch(() => {});

  detector = null;
  if ('BarcodeDetector' in window) {
    try {
      const formats = window.BarcodeDetector.getSupportedFormats ? await window.BarcodeDetector.getSupportedFormats() : ['qr_code'];
      if (formats.includes('qr_code')) detector = new window.BarcodeDetector({ formats: ['qr_code'] });
    } catch { detector = null; }
  }
  let jsQR = null;
  if (!detector) {
    try { jsQR = await loadQrLib(); } catch (e) { onError(e); stopScanner(); return; }
  }

  const tick = async () => {
    if (!stream || busy || !video || video.readyState < 2) return;
    busy = true;
    try {
      const texts = [];
      let q = null;
      if (detector) {
        for (const c of await detector.detect(video)) {
          texts.push(c.rawValue);
          q = q || parseRksv(c.rawValue);
        }
      } else {
        q = jsqrTick(jsQR, (txt) => texts.push(txt));
      }
      if (q) {
        // Dieser Bon ist über seinen Code erledigt (oder schon erfasst): nicht zusätzlich als Foto übernehmen.
        if (onReceipt) { detectStep(null); blocked = (track && track.box) || blocked; track = null; }
        onRksv(q, grabFrame());
        return;
      }
      if (texts.length && onOther) onOther();
      if (onReceipt && Date.now() - lastDetect >= DETECT_EVERY) {
        lastDetect = Date.now();
        const boxes = detectStep(onBoxes);
        if (boxes) {
          const main = boxes.reduce((b, x) => (x.w * x.h > b.w * b.h ? x : b));
          const frame = await sharpestFrame(main);
          if (stream) onReceipt(frame, boxes);
          return;
        }
      }
    } catch (e) {
      console.warn('Scan', e);
    } finally {
      busy = false;
    }
  };
  timer = setInterval(tick, 170);
}
