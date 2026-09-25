// Copia Clara: guarda la app en el celular para que funcione sin internet.
// Cuando cambies cualquier archivo, sube el número de VERSION para que los celulares descarguen la nueva versión.
const VERSION = 'v1';
const CACHE = `copia-clara-${VERSION}`;
const FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'vendor/jspdf.umd.min.js',
  'vendor/fonts/ibm-plex-sans-latin-400-normal.woff2',
  'vendor/fonts/ibm-plex-sans-latin-500-normal.woff2',
  'vendor/fonts/ibm-plex-sans-latin-600-normal.woff2',
  'vendor/fonts/ibm-plex-sans-latin-700-normal.woff2',
  'vendor/fonts/ibm-plex-mono-latin-500-normal.woff2',
  'vendor/fonts/ibm-plex-mono-latin-600-normal.woff2',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('copia-clara-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match('index.html')))
  );
});
