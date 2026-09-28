// Live-Scanner: Kamera läuft als Videobild, mehrmals pro Sekunde wird nach dem RKSV-QR-Code gesucht.
// Android/Chrome: eingebauter BarcodeDetector. iPhone/Safari: jsQR auf einem verkleinerten Einzelbild.
// Zusätzlich wird etwa zweimal pro Sekunde nach Kassenbons gesucht: Liegt ein Bon ruhig im Bild, wird er übernommen.
import { parseRksv, loadQrLib } from './rksv.js';
import { detectReceipts } from './detect.js';

let stream = null;
let timer = null;
let video = null;
let detector = null;
let busy = false;
const work = document.createElement('canvas');
const detWork = document.createElement('canvas');
const DETECT_EVERY = 450; // ms zwischen zwei Bonsuchen
const STABLE_HITS = 3; // so oft hintereinander an derselben Stelle, dann gilt der Bon als ruhig gehalten
let lastDetect = 0;
let track = null; // { box, hits } des aktuell verfolgten Bons
// Zuletzt übernommener Bon: erst wieder auslösen, wenn er aus dem Bild war oder sich deutlich bewegt hat.
let blocked = null;

const iou = (a, b) => {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const i = ix * iy;
  return i / (a.w * a.h + b.w * b.h - i);
};

export const scannerActive = () => !!stream;

// Nach einem Neuzeichnen der Oberfläche das neue Videoelement mit der laufenden Kamera verbinden.
export function attachScanner(videoEl) {
  if (!stream || !videoEl || videoEl === video) return;
  video = videoEl;
  video.srcObject = stream;
  video.play().catch(() => {});
}

// Aktuelles Kamerabild in voller Auflösung (für das Auslesen des Lieferanten).
export function grabFrame() {
  const c = document.createElement('canvas');
  c.width = video ? video.videoWidth : 0;
  c.height = video ? video.videoHeight : 0;
  if (c.width) c.getContext('2d').drawImage(video, 0, 0);
  return c;
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

// Bonsuche auf einem verkleinerten Kamerabild. Liefert die Bons und, sobald einer ruhig liegt, true.
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
    return false;
  }
  track = track && iou(track.box, main) >= 0.8 ? { box: main, hits: track.hits + 1 } : { box: main, hits: 1 };
  if (onBoxes) onBoxes(boxes, track.hits / STABLE_HITS);
  if (track.hits < STABLE_HITS) return false;
  blocked = main;
  return true;
}

/**
 * Startet Kamera und Suche. onRksv(inhalt, bild) wird beim ersten gültigen RKSV-Code aufgerufen,
 * onOther() bei anderen QR-Codes (z. B. Feedback-Links), onError(fehler) wenn die Kamera nicht verfügbar ist.
 * onReceipt(bild) wird aufgerufen, wenn ein Bon ohne lesbaren Code ruhig im Bild liegt; onBoxes(bons, fortschritt)
 * nach jeder Bonsuche für die Anzeige. fresh: neue Scan-Runde, ein zuvor übernommener Bon zählt wieder.
 */
export async function startScanner(videoEl, { onRksv, onOther, onError, stillWanted, onReceipt, onBoxes, fresh }) {
  stopScanner();
  if (fresh) blocked = null;
  lastDetect = Date.now() + 600; // erste Bonsuche erst, wenn die Kamera scharf gestellt hat
  let s;
  try {
    s = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
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
      let texts = [];
      if (detector) {
        texts = (await detector.detect(video)).map((c) => c.rawValue);
      } else {
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        const sc = Math.min(1, 960 / Math.max(vw, vh));
        work.width = Math.round(vw * sc);
        work.height = Math.round(vh * sc);
        const ctx = work.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(video, 0, 0, work.width, work.height);
        const img = ctx.getImageData(0, 0, work.width, work.height);
        const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
        if (code && code.data) texts = [code.data];
      }
      for (const txt of texts) {
        const q = parseRksv(txt);
        if (q) {
          // Dieser Bon ist über seinen Code erledigt (oder schon erfasst): nicht zusätzlich als Foto übernehmen.
          if (onReceipt) { detectStep(null); blocked = (track && track.box) || blocked; track = null; }
          onRksv(q, grabFrame());
          return;
        }
      }
      if (texts.length && onOther) onOther();
      if (onReceipt && Date.now() - lastDetect >= DETECT_EVERY) {
        lastDetect = Date.now();
        if (detectStep(onBoxes)) { onReceipt(grabFrame()); return; }
      }
    } catch (e) {
      console.warn('Scan', e);
    } finally {
      busy = false;
    }
  };
  timer = setInterval(tick, 170);
}
