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

function draw(src, maxSide) {
  const w = src.width;
  const h = src.height;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * scale));
  c.height = Math.max(1, Math.round(h * scale));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

function grayscale(canvas) {
  const ctx = canvas.getContext('2d');
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    let v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    v = Math.max(0, Math.min(255, (v - 128) * 1.4 + 128)); // mehr Kontrast für Thermopapier
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
    thumb: draw(src, 480).toDataURL('image/jpeg', 0.7),
    base64: dataUrl.slice(dataUrl.indexOf(',') + 1),
    ocrCanvas: grayscale(draw(src, 2200)),
  };
}
