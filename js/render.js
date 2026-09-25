// Del registro de una página a la imagen final: enderezar, girar, filtrar, ajustar y firmar.

import { warpImageData, outSize } from './geometry.js';
import { applyFilter, adjust, forOcr } from './enhance.js';
import { blobToCanvas, mk, canvasToBlob, scaleCanvas } from './utils.js';
import { store } from './store.js';

class LRU {
  constructor(n) { this.n = n; this.m = new Map(); }
  get(k) { if (!this.m.has(k)) return undefined; const v = this.m.get(k); this.m.delete(k); this.m.set(k, v); return v; }
  set(k, v) { this.m.delete(k); this.m.set(k, v); while (this.m.size > this.n) this.m.delete(this.m.keys().next().value); }
  dropPrefix(p) { for (const k of [...this.m.keys()]) if (k.startsWith(p)) this.m.delete(k); }
}

const srcCache = new LRU(2);
const baseCache = new LRU(3);
const renderCache = new LRU(4);
const sigCache = new LRU(6);

/** Mueve cada esquina un poco hacia el centro para que no quede una rayita del fondo en la orilla. */
function inset(q, f) {
  const c = { x: q.reduce((s, p) => s + p.x, 0) / 4, y: q.reduce((s, p) => s + p.y, 0) / 4 };
  return q.map(p => ({ x: p.x + (c.x - p.x) * f * 2, y: p.y + (c.y - p.y) * f * 2 }));
}

export const quadKey = q => q.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(';');

export async function getSource(page) {
  let c = srcCache.get(page.id);
  if (!c) { c = await blobToCanvas(page.srcBlob); srcCache.set(page.id, c); }
  return c;
}

/** Imagen enderezada, a resolución completa, sin filtros. */
export async function getBase(page) {
  const key = `${page.id}|${quadKey(page.quad)}|${page.kind}`;
  let c = baseCache.get(key);
  if (c) return c;
  const src = await getSource(page);
  const sd = src.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, src.width, src.height);
  const [W, H] = outSize(page.kind, page.quad);
  const out = warpImageData(sd, inset(page.quad, 0.004), W, H);
  if (!out) throw new Error('Recorte inválido');
  c = mk(W, H);
  c.getContext('2d').putImageData(out, 0, 0);
  baseCache.dropPrefix(page.id + '|');
  baseCache.set(key, c);
  return c;
}

function rotated(src, rot) {
  rot = ((rot % 360) + 360) % 360;
  if (!rot) return src;
  const w = rot % 180 ? src.height : src.width, h = rot % 180 ? src.width : src.height;
  const c = mk(w, h), x = c.getContext('2d');
  x.translate(w / 2, h / 2); x.rotate(rot * Math.PI / 180);
  x.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

export async function sigCanvas(id) {
  let c = sigCache.get(id);
  if (!c) {
    const s = await store.getSig(id);
    if (!s) return null;
    c = await blobToCanvas(s.blob);
    sigCache.set(id, c);
  }
  return c;
}

/**
 * Imagen final de la página. `maxDim` limita el tamaño (para vistas previas).
 * `filter` permite forzar otro filtro (miniaturas de filtros).
 */
export async function renderPage(page, { maxDim = 0, filter = page.filter, sigs = true, adjustOn = true } = {}) {
  const sigKey = sigs ? (page.sigs || []).map(s => `${s.sigId}:${s.x.toFixed(3)},${s.y.toFixed(3)},${s.w.toFixed(3)}`).join('/') : '';
  const key = `${page.id}|${quadKey(page.quad)}|${page.kind}|${page.rot}|${filter}|${adjustOn ? page.bright + ',' + page.contrast : ''}|${sigKey}|${maxDim}`;
  const hit = renderCache.get(key);
  if (hit) return hit;
  let c = await getBase(page);
  if (maxDim) c = scaleCanvas(c, maxDim);
  c = rotated(c, page.rot);
  const out = mk(c.width, c.height), x = out.getContext('2d', { willReadFrequently: true });
  x.drawImage(c, 0, 0);
  if (filter !== 'color' || (adjustOn && (page.bright || page.contrast))) {
    const img = x.getImageData(0, 0, out.width, out.height);
    applyFilter(img, filter);
    if (adjustOn) adjust(img, page.bright, page.contrast);
    x.putImageData(img, 0, 0);
  }
  if (sigs && page.sigs && page.sigs.length) {
    for (const s of page.sigs) {
      const sc = await sigCanvas(s.sigId);
      if (!sc) continue;
      const w = s.w * out.width, h = w * sc.height / sc.width;
      x.drawImage(sc, s.x * out.width, s.y * out.height, w, h);
    }
  }
  renderCache.set(key, out);
  return out;
}

export async function makeThumb(page) {
  const c = await renderPage(page, { maxDim: 360 });
  return canvasToBlob(c, 'image/jpeg', 0.82);
}

/** Imagen preparada para OCR (girada como la página, sin filtros de color). */
export async function ocrImage(page) {
  const base = rotated(await getBase(page), page.rot);
  const c = mk(base.width, base.height), x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(base, 0, 0);
  const img = x.getImageData(0, 0, c.width, c.height);
  forOcr(img);
  x.putImageData(img, 0, 0);
  whiteFrame(c);
  return c;
}

/** Blanquea un margen fino: restos del fondo en la orilla confunden al lector de texto. */
export function whiteFrame(c, frac = 0.012) {
  const x = c.getContext('2d'), m = Math.max(3, Math.round(Math.max(c.width, c.height) * frac));
  x.fillStyle = '#fff';
  x.fillRect(0, 0, c.width, m); x.fillRect(0, c.height - m, c.width, m);
  x.fillRect(0, 0, m, c.height); x.fillRect(c.width - m, 0, m, c.height);
}

export const ocrKey = page => `${quadKey(page.quad)}|${page.rot}|${page.kind}`;

export function forget(pageId) {
  srcCache.dropPrefix(pageId); baseCache.dropPrefix(pageId + '|'); renderCache.dropPrefix(pageId + '|');
}
export function forgetSig(id) { sigCache.m.delete(id); renderCache.m.clear(); }
