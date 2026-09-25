// Lectura de texto (OCR) con Tesseract, ejecutada dentro del celular.

import { loadScript, mk } from './utils.js';

const base = new URL('.', location.href);
const P = f => new URL(f, base).href;

export const OCR_FILES = [
  'vendor/tesseract/tesseract.min.js',
  'vendor/tesseract/worker.min.js',
  'vendor/tesseract/lang/spa.traineddata.gz'
];

let workerP = null;
let progressFn = null;

const STEP = {
  'loading tesseract core': 'Preparando el lector de texto',
  'initializing tesseract': 'Preparando el lector de texto',
  'loading language traineddata': 'Cargando el idioma español',
  'initializing api': 'Preparando el lector de texto',
  'recognizing text': 'Leyendo el texto'
};

function getWorker() {
  if (!workerP) {
    workerP = (async () => {
      await loadScript(P('vendor/tesseract/tesseract.min.js'));
      const w = await window.Tesseract.createWorker('spa', 1, {
        workerPath: P('vendor/tesseract/worker.min.js'),
        corePath: P('vendor/tesseract/core'),
        langPath: P('vendor/tesseract/lang'),
        gzip: true,
        cacheMethod: 'none',
        workerBlobURL: false,
        logger: m => { if (progressFn) progressFn(STEP[m.status] || 'Leyendo el texto', m.progress || 0, m.status); }
      });
      return w;
    })();
    workerP.catch(() => { workerP = null; });
  }
  return workerP;
}

/**
 * Lee el texto de un canvas ya preparado (grises, fondo aplanado).
 * Devuelve { text, words:[{t,x0,y0,x1,y1}], w, h } en coordenadas del canvas recibido.
 */
export async function recognize(canvas, onProgress) {
  progressFn = onProgress || null;
  const w = await getWorker();
  const long = Math.max(canvas.width, canvas.height);
  const k = Math.min(2.4, Math.max(0.6, 2200 / long));
  const c = mk(canvas.width * k, canvas.height * k), x = c.getContext('2d');
  x.imageSmoothingQuality = 'high';
  x.drawImage(canvas, 0, 0, c.width, c.height);
  const { data } = await w.recognize(c, {}, { text: true, blocks: true });
  const words = [];
  for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) for (const wd of l.words || []) {
    const t = (wd.text || '').trim();
    if (!t || wd.confidence < 25) continue;
    words.push({ t, x0: wd.bbox.x0 / k, y0: wd.bbox.y0 / k, x1: wd.bbox.x1 / k, y1: wd.bbox.y1 / k });
  }
  progressFn = null;
  return { text: cleanText(data.text || ''), words: words.filter(w => /[\p{L}\p{N}]/u.test(w.t)), w: canvas.width, h: canvas.height };
}

/** Quita líneas de ruido (bordes, sombras) que el lector convierte en símbolos sueltos. */
export function cleanText(t) {
  return t.split('\n')
    .filter(l => {
      const s = l.trim();
      if (!s) return true;
      const letters = (s.match(/[\p{L}\p{N}]/gu) || []).length;
      return letters >= 2 && letters / s.replace(/\s/g, '').length >= 0.5;
    })
    .join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Busca el número de DNI peruano (8 dígitos) en el texto leído. */
export function findDni(text) {
  if (!text) return null;
  const up = text.toUpperCase();
  const flat = up.replace(/\s+/g, '');
  const mrz = flat.match(/I[<K]?PER(\d{8})/);
  if (mrz) return mrz[1];
  const near = up.match(/D\s*\.?\s*N\s*\.?\s*I\b[^0-9]{0,14}(\d{8})(?!\d)/);
  if (near) return near[1];
  const cui = up.match(/(?<!\d)(\d{8})\s*[-–]\s*\d(?!\d)/);
  if (cui) return cui[1];
  const all = [...new Set([...up.matchAll(/(?<!\d)(\d{8})(?!\d)/g)].map(m => m[1]))];
  return all.length === 1 ? all[0] : null;
}

/** ¿Están los archivos del lector guardados para usarse sin internet? */
export async function ocrCached() {
  if (!('caches' in window)) return false;
  try {
    const core = await caches.match(P('vendor/tesseract/core/tesseract-core-simd-lstm.wasm.js'))
      || await caches.match(P('vendor/tesseract/core/tesseract-core-lstm.wasm.js'));
    const lang = await caches.match(P('vendor/tesseract/lang/spa.traineddata.gz'));
    return !!(core && lang);
  } catch { return false; }
}

/** Descarga por adelantado los archivos del lector (los guarda el service worker). */
export async function preloadOcr(onProgress) {
  const simd = WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
  const files = [...OCR_FILES, `vendor/tesseract/core/tesseract-core${simd ? '-simd' : ''}-lstm.wasm.js`];
  let done = 0;
  for (const f of files) {
    const r = await fetch(P(f), { cache: 'no-cache' });
    if (!r.ok) throw new Error('No se pudo descargar ' + f);
    await r.arrayBuffer();
    done++;
    if (onProgress) onProgress(done / files.length);
  }
}
