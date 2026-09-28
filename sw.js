// Offline-Fähigkeit: Die App-Dateien werden zwischengespeichert und im Hintergrund aktualisiert.
const CACHE = 'kassabuch-v22';
const FILES = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './js/db.js',
  './js/detect.js',
  './js/excel.js',
  './js/i18n.js',
  './js/image.js',
  './js/ledger.js',
  './js/ocr.js',
  './js/rksv.js',
  './js/scanner.js',
  './js/templates.js',
  './vendor/exceljs.min.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

// Jede Datei einzeln, damit eine fehlende Datei nicht die ganze Offline-Fähigkeit verhindert.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.allSettled(FILES.map((f) => c.add(new Request(f, { cache: 'reload' })))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== CDN_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Eigene Dateien: sofort aus dem Zwischenspeicher, gleichzeitig neu laden (für das nächste Öffnen).
// Fremde Adressen (Claude-API, Texterkennung) laufen direkt über das Netz.
// Texterkennung und Excel-Bibliothek vom CDN: einmal laden, danach aus dem Zwischenspeicher (versionierte Adressen).
const CDN_CACHE = 'kassabuch-cdn-v1';
const isCdnAsset = (url) => url.hostname === 'cdn.jsdelivr.net' && /tesseract|exceljs|jsqr/.test(url.pathname);

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET') return;
  if (isCdnAsset(url)) {
    event.respondWith(
      caches.open(CDN_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        // Skripte ohne CORS kommen als "opaque" Antwort (Status 0) und dürfen trotzdem gespeichert werden.
        if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: true });
      // Über die URL, weil Seitenaufrufe (mode "navigate") keine zusätzlichen Optionen erlauben.
      const fresh = fetch(req.url, { cache: 'no-cache' }).then((res) => {
        if (res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => cached);
      return cached || fresh;
    }),
  );
});
