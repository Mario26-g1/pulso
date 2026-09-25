// Filtros de imagen. Todo trabaja sobre ImageData en el propio celular.

export const FILTERS = {
  documento: 'Documento',
  color: 'Original',
  mejorado: 'Mejorado',
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
/**
 * Iluminación del fondo por píxel: máximo de luminancia por bloques
 * (blocks bloques en el lado mayor), suavizado e interpolado.
 */
function bgMap(img, blocks) {
  const { width: W, height: H, data: d } = img;
  const bs = Math.max(8, Math.round(Math.max(W, H) / blocks));
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
  const pass = (useMax) => {
    const o = new Float32Array(g.length);
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      let acc = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const v = g[Math.min(gh - 1, Math.max(0, y + dy)) * gw + Math.min(gw - 1, Math.max(0, x + dx))];
        if (useMax) { if (v > acc) acc = v; } else { acc += v; n++; }
      }
      o[y * gw + x] = useMax ? acc : acc / n;
    }
    g = o;
  };
  pass(true); pass(false); pass(false); pass(false);

  const out = new Float32Array(W * H);
  const gx0 = new Int32Array(W), gfx = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    const f = Math.min(gw - 1, Math.max(0, (x + 0.5) / bs - 0.5));
    gx0[x] = gw === 1 ? 0 : Math.min(gw - 2, Math.floor(f)); gfx[x] = gw === 1 ? 0 : f - gx0[x];
  }
  const at = (xx, yy) => g[Math.min(gh - 1, yy) * gw + Math.min(gw - 1, xx)];
  for (let y = 0; y < H; y++) {
    const f = Math.min(gh - 1, Math.max(0, (y + 0.5) / bs - 0.5));
    const y0 = gh === 1 ? 0 : Math.min(gh - 2, Math.floor(f)), fy = gh === 1 ? 0 : f - y0;
    for (let x = 0; x < W; x++) {
      const x0 = gx0[x], fx = gfx[x];
      out[y * W + x] = (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
    }
  }
  return out;
}

/**
 * Quita sombras y deja el papel blanco: estima la iluminación del fondo
 * y divide cada píxel por ella.
 */
function flatten(img) {
  const { width: W, height: H, data: d } = img;
  const bg = bgMap(img, 44);
  for (let p = 0, i = 0; p < bg.length; p++, i += 4) {
    const s = 255 / Math.max(bg[p], 48);
    d[i] = Math.min(255, d[i] * s); d[i + 1] = Math.min(255, d[i + 1] * s); d[i + 2] = Math.min(255, d[i + 2] * s);
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

/**
 * Mejorado (para DNI y tarjetas a color): quita sombras sin blanquear el
 * color de la tarjeta, corrige el tinte amarillo de la luz, estira el
 * contraste, aviva los colores apagados y da nitidez al texto.
 */
function magicColor(img) {
  const { width: W, height: H, data: d } = img;
  const n = W * H;
  // 1. Sombras: iluminación a escala media, normalizada a la zona mejor iluminada.
  const bg = bgMap(img, 40);
  const sorted = Float32Array.from(bg).sort();
  const ref = sorted[Math.floor(sorted.length * 0.9)];
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const s = Math.min(2.2, ref / Math.max(bg[p], 40));
    d[i] = Math.min(255, d[i] * s); d[i + 1] = Math.min(255, d[i + 1] * s); d[i + 2] = Math.min(255, d[i + 2] * s);
  }
  // 2. Tinte de la luz: se corrige en parte con los píxeles más claros.
  const hist = lumaHist(d), th = percentile(hist, n, 0.9);
  let r = 0, g = 0, b = 0, c = 0;
  for (let i = 0; i < d.length; i += 16) if (luma(d, i) >= th) { r += d[i]; g += d[i + 1]; b += d[i + 2]; c++; }
  if (c) {
    r /= c; g /= c; b /= c;
    const m = (r + g + b) / 3, k = 0.6;
    const gain = v => Math.min(1.2, Math.max(0.85, 1 + k * (m / Math.max(v, 1) - 1)));
    const gr = gain(r), gg = gain(g), gb = gain(b);
    for (let i = 0; i < d.length; i += 4) { d[i] = d[i] * gr; d[i + 1] = d[i + 1] * gg; d[i + 2] = d[i + 2] * gb; }
  }
  // 3. Contraste: el negro a negro y el fondo de la tarjeta a un claro que conserve su color.
  const h2 = lumaHist(d);
  const lo = percentile(h2, n, 0.006), mid = percentile(h2, n, 0.7);
  // Sin estirar demasiado los claros: evita que el ruido del fondo se convierta en granulado.
  const top = Math.max(mid + 45, percentile(h2, n, 0.998));
  const tgt = 212, lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) {
    let o;
    if (v <= mid) { const t = Math.max(0, (v - lo) / Math.max(1, mid - lo)); o = tgt * Math.pow(t, 1.12); }
    else { const t = Math.min(1, (v - mid) / Math.max(1, top - mid)); o = tgt + (255 - tgt) * t; }
    lut[v] = o;
  }
  applyLUT(d, lut);
  // 4. Viveza: sube más la saturación de los colores apagados que la de los vivos.
  for (let i = 0; i < d.length; i += 4) {
    const R = d[i], G = d[i + 1], B = d[i + 2];
    const mx = Math.max(R, G, B), mn = Math.min(R, G, B), sat = mx ? (mx - mn) / mx : 0;
    const f = 1 + 1.1 * (1 - sat) * (1 - sat);
    const l = (R * 77 + G * 150 + B * 29) >> 8;
    d[i] = l + (R - l) * f; d[i + 1] = l + (G - l) * f; d[i + 2] = l + (B - l) * f;
  }
  smoothChroma(img);
}

/** Quita el granulado de color: promedia el color (no el brillo) en 5×5. */
function smoothChroma(img) {
  const { width: W, height: H, data: d } = img, n = W * H;
  const L = new Float32Array(n), ch = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const l = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) / 256;
    L[p] = l; ch[0][p] = d[i] - l; ch[1][p] = d[i + 1] - l; ch[2][p] = d[i + 2] - l;
  }
  const tmp = new Float32Array(n), R = 2;
  for (const c of ch) {
    for (let y = 0; y < H; y++) {
      const r = y * W;
      for (let x = 0; x < W; x++) {
        let s = 0, k = 0;
        for (let dx = -R; dx <= R; dx++) { const xx = x + dx; if (xx >= 0 && xx < W) { s += c[r + xx]; k++; } }
        tmp[r + x] = s / k;
      }
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let s = 0, k = 0;
      for (let dy = -R; dy <= R; dy++) { const yy = y + dy; if (yy >= 0 && yy < H) { s += tmp[yy * W + x]; k++; } }
      c[y * W + x] = s / k;
    }
  }
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    d[i] = L[p] + ch[0][p]; d[i + 1] = L[p] + ch[1][p]; d[i + 2] = L[p] + ch[2][p];
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
    case 'mejorado': magicColor(img); sharpen(img, 0.6); break;
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
