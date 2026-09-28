// Live-Scanner: Kamera läuft als Videobild, mehrmals pro Sekunde wird nach dem RKSV-QR-Code gesucht.
// Android/Chrome: eingebauter BarcodeDetector. iPhone/Safari: jsQR auf einem verkleinerten Einzelbild.
import { parseRksv, loadQrLib } from './rksv.js';

let stream = null;
let timer = null;
let video = null;
let detector = null;
let busy = false;
const work = document.createElement('canvas');

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
}

/**
 * Startet Kamera und Suche. onRksv(inhalt, bild) wird beim ersten gültigen RKSV-Code aufgerufen,
 * onOther() bei anderen QR-Codes (z. B. Feedback-Links), onError(fehler) wenn die Kamera nicht verfügbar ist.
 */
export async function startScanner(videoEl, { onRksv, onOther, onError, stillWanted }) {
  stopScanner();
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
        if (q) { onRksv(q, grabFrame()); return; }
      }
      if (texts.length && onOther) onOther();
    } catch (e) {
      console.warn('Scan', e);
    } finally {
      busy = false;
    }
  };
  timer = setInterval(tick, 170);
}
