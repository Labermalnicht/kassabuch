// Bereitet ein Belegfoto auf: Vorschau, JPEG für Claude und ein kontrastreiches Graustufenbild für die Offline-Erkennung.

async function decode(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('decode'));
      img.src = URL.createObjectURL(file);
    });
  }
}

// minWidth: kleine Bilder (z. B. zugeschnittene Belege) für die Texterkennung vergrößern.
function draw(src, maxSide, minWidth = 0) {
  const w = src.width;
  const h = src.height;
  let scale = Math.min(1, maxSide / Math.max(w, h));
  if (minWidth && w * scale < minWidth) scale = Math.min(minWidth / w, (maxSide * 1.5) / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * scale));
  c.height = Math.max(1, Math.round(h * scale));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

// Graustufen mit festem, leicht erhöhtem Kontrast. Hat bei den getesteten Belegfotos am besten funktioniert.
function grayscale(canvas) {
  const ctx = canvas.getContext('2d');
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    let v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    v = Math.max(0, Math.min(255, (v - 128) * 1.4 + 128));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// Zweiter Versuch für schwierige Fotos (z. B. farbiges Papier): der Helligkeitsbereich wird gestreckt
// (dunkelste 2 % werden schwarz, hellste 10 % weiß).
function autoLevels(canvas) {
  const ctx = canvas.getContext('2d');
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
    d[i] = v;
    hist[v]++;
  }
  const total = d.length / 4;
  let lo = 0;
  let hi = 255;
  for (let acc = 0; lo < 255 && (acc += hist[lo]) < total * 0.02;) lo++;
  for (let acc = 0; hi > 0 && (acc += hist[hi]) < total * 0.10;) hi--;
  if (hi - lo < 40) { lo = Math.max(0, lo - 20); hi = Math.min(255, hi + 20); }
  const k = 255 / Math.max(1, hi - lo);
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.max(0, Math.min(255, (d[i] - lo) * k));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export async function prepareImage(file) {
  const src = await decode(file);
  const main = draw(src, 1568);
  const dataUrl = main.toDataURL('image/jpeg', 0.85);
  return {
    src,
    thumb: draw(src, 480).toDataURL('image/jpeg', 0.7),
    base64: dataUrl.slice(dataUrl.indexOf(',') + 1),
    ocrCanvas: grayscale(draw(src, 2200, 1100)),
    ocrCanvasAlt: autoLevels(draw(src, 2200, 1100)),
  };
}

// Zum Zuschneiden: dekodiertes Bild in voller Auflösung und eine Vorschau für den Bildschirm.
export async function decodeForCrop(file) {
  const src = await decode(file);
  return { src, preview: draw(src, 1400).toDataURL('image/jpeg', 0.8) };
}

// Schneidet den Bereich r (Anteile von 0 bis 1) in voller Auflösung aus.
export async function cropToBlob(src, r) {
  const x = Math.round(r.x * src.width);
  const y = Math.round(r.y * src.height);
  const w = Math.max(1, Math.round(r.w * src.width));
  const h = Math.max(1, Math.round(r.h * src.height));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(src, x, y, w, h, 0, 0, w, h);
  return new Promise((resolve) => c.toBlob(resolve, 'image/jpeg', 0.92));
}
