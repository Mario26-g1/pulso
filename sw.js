// Copia Clara · guarda la app en el celular para que funcione sin internet.
// Al cambiar cualquier archivo, sube VERSION para que los celulares descarguen la nueva versión.
const VERSION = 'v2.7.0';
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
  // cache: 'reload' obliga a bajar los archivos de internet, no de la caché del navegador.
  event.waitUntil(caches.open(CORE)
    .then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('copia-clara-') && k !== CORE && k !== EXTRA).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Código de la app (HTML, CSS, JS): primero internet, así cada cambio se ve al abrir;
// sin conexión o si tarda más de 3 s, se usa la copia guardada.
// Librerías, fuentes e íconos: primero la copia guardada (no cambian).
const isStatic = p => p.includes('/vendor/') || p.includes('/icons/');

async function fromNetwork(req, cacheName) {
  const res = await fetch(req, { cache: 'no-cache' });
  if (res.ok && res.type === 'basic') {
    const copy = res.clone();
    caches.open(cacheName).then(c => c.put(req, copy));
  }
  return res;
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const extra = url.pathname.includes('/vendor/tesseract/') || url.pathname.endsWith('/vendor/pdf-lib.min.js');
  const cacheName = extra ? EXTRA : CORE;

  if (isStatic(url.pathname)) {
    event.respondWith((async () => {
      const hit = await caches.match(req, { ignoreSearch: true });
      return hit || fromNetwork(req, cacheName);
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = () => caches.match(req, { ignoreSearch: true })
      .then(h => h || (req.mode === 'navigate' ? caches.match('index.html') : null));
    try {
      const net = fromNetwork(req, cacheName);
      const timeout = new Promise(r => setTimeout(() => r(null), 3000));
      const res = await Promise.race([net, timeout]);
      if (res) return res;
      const h = await cached();
      return h || await net;
    } catch (e) {
      const h = await cached();
      if (h) return h;
      throw e;
    }
  })());
});
