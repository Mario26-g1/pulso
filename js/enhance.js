// Filtros de imagen. Todo trabaja sobre ImageData en el propio celular.

export const FILTERS = {
  documento: 'Documento',
  color: 'Original',
  mejorado: 'Color vivo',
  grises: 'Grises',
  bn: 'Blanco y negro'
};

export const DEFAULT_FILTER = { dni: 'mejorado', a4: 'documento', letter: 'documento', free: 'documento' };

const luma = (d, i) => (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;

function percentile(hist, total, p) {
  let acc = 0;
  for (let t = 0; t < 256; t++) { acc += hist[t]; if (acc >= total * p) return t; }
  return 255;
}

function lumaHist(d) {
  const h = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) h[luma(d, i)]++;
  return h;
}

function applyLUT(d, lut) {
  for (let i = 0; i < d.length; i += 4) { d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]]; }
}

/**
 * Quita sombras y deja el papel blanco: estima la iluminación del fondo
 * (máximo por bloques, suavizado) y divide cada píxel por ella.
 */
function flatten(img) {
  const { width: W, height: H, data: d } = img;
  const bs = Math.max(8, Math.round(Math.max(W, H) / 44));
  const gw = Math.ceil(W / bs), gh = Math.ceil(H / bs);
  let g = new Float32Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    let m = 0;
    const y1 = Math.min(H, (gy + 1) * bs), x1 = Math.min(W, (gx + 1) * bs);
    for (let y = gy * bs; y < y1; y += 2) for (let x = gx * bs; x < x1; x += 2) {
      const l = luma(d, (y * W + x) * 4);
      if (l > m) m = l;
    }
    g[gy * gw + gx] = m;
  }
  const pass = (fn) => {
    const o = new Float32Array(g.length);
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      let acc = fn === 'max' ? 0 : 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = Math.min(gh - 1, Math.max(0, y + dy)), xx = Math.min(gw - 1, Math.max(0, x + dx));
        const v = g[yy * gw + xx];
        if (fn === 'max') { if (v > acc) acc = v; } else { acc += v; n++; }
      }
      o[y * gw + x] = fn === 'max' ? acc : acc / n;
    }
    g = o;
  };
  pass('max'); pass('avg'); pass('avg'); pass('avg');

  const gx0 = new Int32Array(W), gfx = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    const f = Math.min(gw - 1, Math.max(0, (x + 0.5) / bs - 0.5));
    gx0[x] = Math.min(gw - 2, Math.floor(f)); gfx[x] = f - gx0[x];
    if (gw === 1) { gx0[x] = 0; gfx[x] = 0; }
  }
  const at = (xx, yy) => g[Math.min(gh - 1, yy) * gw + Math.min(gw - 1, xx)];
  for (let y = 0; y < H; y++) {
    const f = Math.min(gh - 1, Math.max(0, (y + 0.5) / bs - 0.5));
    let y0 = Math.min(gh - 2, Math.floor(f)), fy = f - y0;
    if (gh === 1) { y0 = 0; fy = 0; }
    for (let x = 0; x < W; x++) {
      const x0 = gx0[x], fx = gfx[x];
      const bg = (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
      const s = 255 / Math.max(bg, 48), i = (y * W + x) * 4;
      d[i] = Math.min(255, d[i] * s); d[i + 1] = Math.min(255, d[i + 1] * s); d[i + 2] = Math.min(255, d[i + 2] * s);
    }
  }
  // Curva: el papel casi blanco pasa a blanco puro y el texto se oscurece un poco.
  const hist = lumaHist(d), n = W * H;
  const bp = Math.min(90, percentile(hist, n, 0.004)), wp = 232;
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) {
    const t = Math.min(1, Math.max(0, (v - bp) / (wp - bp)));
    lut[v] = 255 * Math.pow(t, 1.25);
  }
  applyLUT(d, lut);
}

function autoLevels(img, sat = 1.12) {
  const d = img.data, hist = lumaHist(d), n = d.length / 4;
  const lo = percentile(hist, n, 0.008), hi = Math.max(lo + 30, percentile(hist, n, 0.992));
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) lut[v] = (v - lo) * 255 / (hi - lo);
  applyLUT(d, lut);
  if (sat !== 1) {
    for (let i = 0; i < d.length; i += 4) {
      const l = luma(d, i);
      d[i] = l + (d[i] - l) * sat; d[i + 1] = l + (d[i + 1] - l) * sat; d[i + 2] = l + (d[i + 2] - l) * sat;
    }
  }
}

/** Nitidez: resalta la diferencia con un desenfoque de 3×3. */
function sharpen(img, amount) {
  const { width: W, height: H, data: d } = img;
  const src = new Uint8ClampedArray(d);
  for (let c = 0; c < 3; c++) {
    const row = new Uint16Array(W * H);
    for (let y = 0; y < H; y++) {
      const r = y * W;
      for (let x = 0; x < W; x++) {
        const i = (r + x) * 4 + c;
        row[r + x] = src[i] + src[x > 0 ? i - 4 : i] + src[x < W - 1 ? i + 4 : i];
      }
    }
    for (let y = 0; y < H; y++) {
      const up = (y > 0 ? y - 1 : y) * W, dn = (y < H - 1 ? y + 1 : y) * W, r = y * W;
      for (let x = 0; x < W; x++) {
        const mean = (row[up + x] + row[r + x] + row[dn + x]) / 9, i = (r + x) * 4 + c;
        d[i] = src[i] + amount * (src[i] - mean);
      }
    }
  }
}

function toGray(d) {
  for (let i = 0; i < d.length; i += 4) { const l = luma(d, i); d[i] = d[i + 1] = d[i + 2] = l; }
}

function binarize(img) {
  const d = img.data, hist = lumaHist(d), n = d.length / 4;
  let sum = 0; for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sB = 0, wB = 0, best = -1, th = 160;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = n - wB; if (!wF) break;
    sB += t * hist[t];
    const v = wB * wF * (sB / wB - (sum - sB) / wF) ** 2;
    if (v > best) { best = v; th = t; }
  }
  th = Math.min(205, Math.max(120, th));
  for (let i = 0; i < d.length; i += 4) { const v = luma(d, i) < th ? 0 : 255; d[i] = d[i + 1] = d[i + 2] = v; }
}

export function applyFilter(img, filter) {
  switch (filter) {
    case 'documento': flatten(img); sharpen(img, 0.45); break;
    case 'mejorado': autoLevels(img, 1.15); sharpen(img, 0.5); break;
    case 'grises': flatten(img); toGray(img.data); sharpen(img, 0.4); break;
    case 'bn': flatten(img); binarize(img); break;
    default: break;
  }
}

/** Brillo y contraste en rango -100…100. */
export function adjust(img, bright = 0, contrast = 0) {
  if (!bright && !contrast) return;
  const b = bright * 0.8, c = contrast >= 0 ? 1 + contrast / 70 : 1 + contrast / 140;
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) lut[v] = (v - 128) * c + 128 + b;
  applyLUT(img.data, lut);
}

/** Imagen preparada para leer texto: grises con el fondo aplanado. */
export function forOcr(img) { flatten(img); toGray(img.data); }
