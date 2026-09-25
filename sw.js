// Copia Clara · guarda la app en el celular para que funcione sin internet.
// Al cambiar cualquier archivo, sube VERSION para que los celulares descarguen la nueva versión.
const VERSION = 'v2.0.0';
const CORE = `copia-clara-core-${VERSION}`;
const EXTRA = 'copia-clara-extra-v2';   // lector de texto y unión de PDF: se guardan al usarse
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/utils.js', 'js/geometry.js', 'js/enhance.js', 'js/store.js', 'js/render.js',
  'js/camera.js', 'js/sign.js', 'js/ocr.js', 'js/pdf.js',
  'vendor/jspdf.umd.min.js',
  'vendor/fonts/ibm-plex-sans-latin-400-normal.woff2', 'vendor/fonts/ibm-plex-sans-latin-500-normal.woff2',
  'vendor/fonts/ibm-plex-sans-latin-600-normal.woff2', 'vendor/fonts/ibm-plex-sans-latin-700-normal.woff2',
  'vendor/fonts/ibm-plex-mono-latin-500-normal.woff2', 'vendor/fonts/ibm-plex-mono-latin-600-normal.woff2',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CORE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('copia-clara-') && k !== CORE && k !== EXTRA).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const extra = url.pathname.includes('/vendor/tesseract/') || url.pathname.endsWith('/vendor/pdf-lib.min.js');
  event.respondWith((async () => {
    const hit = await caches.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(extra ? EXTRA : CORE).then(c => c.put(req, copy));
      }
      return res;
    } catch (e) {
      if (req.mode === 'navigate') {
        const shell = await caches.match('index.html');
        if (shell) return shell;
      }
      throw e;
    }
  })());
});
