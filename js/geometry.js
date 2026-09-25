// Geometría: homografía, enderezado de perspectiva y detección de bordes del documento.

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Tamaños de salida en píxeles. A4 y Carta a 200 ppp, DNI (ID-1) a 300 ppp. */
export const KINDS = {
  dni:    { label: 'DNI',       short: 'DNI',   mm: [85.6, 54],    spec: 'Tarjeta ID-1 · 85,6 × 54 mm' },
  a4:     { label: 'Documento A4', short: 'A4', mm: [210, 297],    spec: 'A4 · 210 × 297 mm' },
  letter: { label: 'Carta',     short: 'Carta', mm: [215.9, 279.4], spec: 'Carta · 215,9 × 279,4 mm' },
  free:   { label: 'Recorte libre', short: 'Libre', mm: null,      spec: 'Tamaño según el recorte' }
};

export function solve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-10) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
}

/** Homografía que lleva los 4 puntos `from` a los 4 puntos `to`. */
export function homography(from, to) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i], { x: u, y: v } = to[i];
    A.push([x, y, 1, 0, 0, 0, -x * u, -y * u]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -x * v, -y * v]); b.push(v);
  }
  return solve(A, b);
}

export function polyArea(p) {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

/** Ordena 4 puntos: arriba-izquierda, arriba-derecha, abajo-derecha, abajo-izquierda. */
export function orderQuad(q) {
  const c = { x: q.reduce((s, p) => s + p.x, 0) / 4, y: q.reduce((s, p) => s + p.y, 0) / 4 };
  const s = [...q].sort((a, b) => Math.atan2(a.y - c.y, a.x - c.x) - Math.atan2(b.y - c.y, b.x - c.x));
  let i0 = 0, best = Infinity;
  s.forEach((p, i) => { if (p.x + p.y < best) { best = p.x + p.y; i0 = i; } });
  return [0, 1, 2, 3].map(j => ({ x: s[(i0 + j) % 4].x, y: s[(i0 + j) % 4].y }));
}

/** Tamaño de salida según el tipo de documento y la forma del recorte. */
export function outSize(kind, q) {
  const w = (dist(q[0], q[1]) + dist(q[3], q[2])) / 2;
  const h = (dist(q[0], q[3]) + dist(q[1], q[2])) / 2;
  const land = w >= h;
  if (kind === 'dni') return land ? [1012, 638] : [638, 1012];
  if (kind === 'a4') return land ? [2339, 1654] : [1654, 2339];
  if (kind === 'letter') return land ? [2200, 1700] : [1700, 2200];
  const k = Math.min(2000 / Math.max(w, h), 2);
  return [Math.max(40, Math.round(w * k)), Math.max(40, Math.round(h * k))];
}

/** Endereza el cuadrilátero `quad` de la imagen `sd` a un rectángulo W×H (interpolación bilineal). */
export function warpImageData(sd, quad, W, H) {
  const h = homography([{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }], quad);
  if (!h) return null;
  const out = new ImageData(W, H), o = out.data, s = sd.data, sw = sd.width, sh = sd.height;
  const maxU = sw - 1.001, maxV = sh - 1.001;
  for (let y = 0; y < H; y++) {
    const yy = y + 0.5;
    const ax = h[1] * yy + h[2], bx = h[4] * yy + h[5], cx = h[7] * yy + 1;
    let oi = y * W * 4;
    for (let x = 0; x < W; x++, oi += 4) {
      const xx = x + 0.5;
      const den = h[6] * xx + cx;
      let u = (h[0] * xx + ax) / den - 0.5;
      let v = (h[3] * xx + bx) / den - 0.5;
      u = u < 0 ? 0 : u > maxU ? maxU : u;
      v = v < 0 ? 0 : v > maxV ? maxV : v;
      const x0 = u | 0, y0 = v | 0, fx = u - x0, fy = v - y0;
      const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
      const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
      o[oi] = s[i00] * w00 + s[i10] * w10 + s[i01] * w01 + s[i11] * w11;
      o[oi + 1] = s[i00 + 1] * w00 + s[i10 + 1] * w10 + s[i01 + 1] * w01 + s[i11 + 1] * w11;
      o[oi + 2] = s[i00 + 2] * w00 + s[i10 + 2] * w10 + s[i01 + 2] * w01 + s[i11 + 2] * w11;
      o[oi + 3] = 255;
    }
  }
  return out;
}

export function defaultQuad(w, h, kind) {
  if (kind === 'dni') {
    // Tarjeta horizontal centrada, de un tamaño razonable para ajustarla rápido.
    const r = 85.6 / 54;
    let qw = Math.min(w * 0.7, h * 0.5 * r), qh = qw / r;
    const x0 = (w - qw) / 2, y0 = (h - qh) / 2;
    return [{ x: x0, y: y0 }, { x: x0 + qw, y: y0 }, { x: x0 + qw, y: y0 + qh }, { x: x0, y: y0 + qh }];
  }
  const mx = w * 0.07, my = h * 0.07;
  return [{ x: mx, y: my }, { x: w - mx, y: my }, { x: w - mx, y: h - my }, { x: mx, y: h - my }];
}

/* ------------------------------------------------------------------ */
/* Detección de bordes                                                 */
/* ------------------------------------------------------------------ */

let scratch = null;
function scratchCtx(W, H) {
  if (!scratch) scratch = document.createElement('canvas');
  if (scratch.width !== W || scratch.height !== H) { scratch.width = W; scratch.height = H; }
  return scratch.getContext('2d', { willReadFrequently: true });
}

function otsu(g) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < g.length; i++) hist[g[i]]++;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sB = 0, wB = 0, best = -1, th = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = g.length - wB; if (!wF) break;
    sB += t * hist[t];
    const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) ** 2;
    if (v > best) { best = v; th = t; }
  }
  return th;
}

function boxBlur(a, W, H) {
  const t = new Uint16Array(a.length);
  for (let y = 0; y < H; y++) {
    const r = y * W;
    for (let x = 0; x < W; x++) {
      const l = x > 0 ? a[r + x - 1] : a[r + x], m = a[r + x], rr = x < W - 1 ? a[r + x + 1] : m;
      t[r + x] = l + m + rr;
    }
  }
  for (let y = 0; y < H; y++) {
    const up = y > 0 ? y - 1 : y, dn = y < H - 1 ? y + 1 : y;
    for (let x = 0; x < W; x++) a[y * W + x] = (t[up * W + x] + t[y * W + x] + t[dn * W + x]) / 9;
  }
}

function erode(m, W, H) {
  const o = new Uint8Array(m.length);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    o[i] = m[i] & m[i - 1] & m[i + 1] & m[i - W] & m[i + W];
  }
  return o;
}
function dilate(m, W, H) {
  const o = new Uint8Array(m.length);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    o[i] = m[i] | (x > 0 && m[i - 1]) | (x < W - 1 && m[i + 1]) | (y > 0 && m[i - W]) | (y < H - 1 && m[i + W]);
  }
  return o;
}

function label(mask, W, H) {
  const lab = new Int32Array(W * H), stack = new Int32Array(W * H), sizes = [0];
  let id = 0;
  for (let i = 0; i < W * H; i++) {
    if (!mask[i] || lab[i]) continue;
    id++; let sp = 0, n = 0;
    stack[sp++] = i; lab[i] = id;
    while (sp) {
      const p = stack[--sp], x = p % W;
      n++;
      if (x > 0 && mask[p - 1] && !lab[p - 1]) { lab[p - 1] = id; stack[sp++] = p - 1; }
      if (x < W - 1 && mask[p + 1] && !lab[p + 1]) { lab[p + 1] = id; stack[sp++] = p + 1; }
      if (p >= W && mask[p - W] && !lab[p - W]) { lab[p - W] = id; stack[sp++] = p - W; }
      if (p < W * (H - 1) && mask[p + W] && !lab[p + W]) { lab[p + W] = id; stack[sp++] = p + W; }
    }
    sizes.push(n);
  }
  return { lab, sizes };
}

function convexHull(pts) {
  const p = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  up.pop(); lo.pop();
  return lo.concat(up);
}

/** Reduce un polígono convexo quitando el vértice que menos área aporta (Visvalingam). */
function simplify(poly, target) {
  const p = poly.slice();
  const tri = (a, b, c) => Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
  while (p.length > target) {
    let bi = 0, ba = Infinity;
    for (let i = 0; i < p.length; i++) {
      const a = tri(p[(i - 1 + p.length) % p.length], p[i], p[(i + 1) % p.length]);
      if (a < ba) { ba = a; bi = i; }
    }
    p.splice(bi, 1);
  }
  return p;
}

/** Cuadrilátero de área máxima con vértices del polígono convexo. */
function maxQuad(p) {
  const n = p.length;
  if (n < 4) return null;
  let best = null, ba = -1;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (let k = j + 1; k < n; k++) for (let l = k + 1; l < n; l++) {
    const q = [p[i], p[j], p[k], p[l]], a = polyArea(q);
    if (a > ba) { ba = a; best = q; }
  }
  return best;
}

/** Penaliza formas muy distintas a la proporción esperada (p. ej. la foto dentro de un DNI). */
function aspectFactor(q, aspect) {
  if (!aspect) return 1;
  const w = (dist(q[0], q[1]) + dist(q[3], q[2])) / 2, h = (dist(q[0], q[3]) + dist(q[1], q[2])) / 2;
  const ar = Math.max(w, h) / Math.max(1, Math.min(w, h));
  const off = Math.abs(Math.log(ar / aspect.r));
  return off < aspect.tol ? 1 : Math.max(0.78, 1 - (off - aspect.tol) * aspect.slope);
}

function angleOk(q) {
  for (let i = 0; i < 4; i++) {
    const a = q[(i + 3) % 4], b = q[i], c = q[(i + 1) % 4];
    const v1x = a.x - b.x, v1y = a.y - b.y, v2x = c.x - b.x, v2y = c.y - b.y;
    const cos = (v1x * v2x + v1y * v2y) / (Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y) || 1);
    const deg = Math.acos(clamp(cos, -1, 1)) * 180 / Math.PI;
    if (deg < 35 || deg > 145) return false;
  }
  return true;
}

function scoreComponent(lab, id, size, W, H, aspect, tap = false) {
  const minX = new Int32Array(H).fill(W), maxX = new Int32Array(H).fill(-1);
  for (let y = 0; y < H; y++) {
    const r = y * W;
    for (let x = 0; x < W; x++) if (lab[r + x] === id) { if (x < minX[y]) minX[y] = x; maxX[y] = x; }
  }
  const pts = [];
  for (let y = 0; y < H; y++) if (maxX[y] >= 0) { pts.push({ x: minX[y], y: y + 0.5 }, { x: maxX[y] + 1, y: y + 0.5 }); }
  if (pts.length < 8) return null;
  const hull = convexHull(pts);
  const hullArea = polyArea(hull);
  if (hullArea < 1) return null;
  const q0 = maxQuad(simplify(hull, 22));
  if (!q0) return null;
  const q = orderQuad(q0);
  const qa = polyArea(q), N = W * H, frac = qa / N;
  if (frac < (tap ? 0.004 : 0.022) || frac > 0.975) return null;
  if (!angleOk(q)) return null;
  const e = 2.2;
  const edge = q.filter(p => p.x < e || p.y < e || p.x > W - e || p.y > H - e).length;
  if (edge >= 3) return null;
  const fit = qa / hullArea;
  if (fit < 0.84) return null;
  const solidity = size / hullArea;
  const score = fit ** 3
    * (0.7 + 0.3 * Math.min(1, frac / 0.15))
    * (edge === 2 ? 0.72 : edge === 1 ? 0.9 : 1)
    * clamp(0.45 + solidity * 0.7, 0, 1)
    * aspectFactor(q, aspect);
  return { quad: q, score };
}

/**
 * Máscara de todo lo que queda encerrado por un contorno: bordes de color,
 * luego se rellena el fondo desde el marco de la imagen y se invierte.
 * Sirve cuando el documento y la mesa tienen un brillo parecido.
 */
function closedContours(R, G, B, W, H) {
  const N = W * H, g = new Uint8Array(N);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    let m = 0;
    for (const A of [R, G, B]) {
      const v = Math.abs(A[i + 1] - A[i - 1]) + Math.abs(A[i + W] - A[i - W]);
      if (v > m) m = v;
    }
    g[i] = m > 255 ? 255 : m;
  }
  const sorted = Uint8Array.from(g).sort();
  const t = Math.max(6, sorted[Math.floor(N * 0.5)] * 2.6);
  let e = Uint8Array.from(g, v => (v > t ? 1 : 0));
  e = dilate(dilate(e, W, H), W, H);
  const reach = new Uint8Array(N), stack = new Int32Array(N);
  let sp = 0;
  const push = i => { if (!e[i] && !reach[i]) { reach[i] = 1; stack[sp++] = i; } };
  for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
  while (sp) {
    const p = stack[--sp], x = p % W;
    if (x > 0) push(p - 1);
    if (x < W - 1) push(p + 1);
    if (p >= W) push(p - W);
    if (p < N - W) push(p + W);
  }
  return Uint8Array.from(reach, v => (v ? 0 : 1));
}

let scratch2 = null;

/**
 * Afina las esquinas a mayor resolución: busca el borde real cerca de cada lado,
 * ajusta una recta por lado y cruza rectas vecinas.
 */
export function refineQuad(source, sw, sh, quad, maxDim = 1400) {
  const k = Math.min(1, maxDim / Math.max(sw, sh));
  const W = Math.round(sw * k), H = Math.round(sh * k);
  if (!scratch2) scratch2 = document.createElement('canvas');
  scratch2.width = W; scratch2.height = H;
  const ctx = scratch2.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data;
  const px = (x, y, out) => {
    x = clamp(x, 0, W - 1.001); y = clamp(y, 0, H - 1.001);
    const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0;
    const i = (y0 * W + x0) * 4, j = i + W * 4;
    for (let c = 0; c < 3; c++) {
      out[c] = (d[i + c] * (1 - fx) + d[i + 4 + c] * fx) * (1 - fy) + (d[j + c] * (1 - fx) + d[j + 4 + c] * fx) * fy;
    }
    return out;
  };
  const q = quad.map(p => ({ x: p.x * k, y: p.y * k }));
  const r = Math.max(6, Math.round(Math.max(W, H) / 110));
  const c1 = [0, 0, 0], c2 = [0, 0, 0];
  const lines = [];
  for (let e = 0; e < 4; e++) {
    const a = q[e], b = q[(e + 1) % 4], len = dist(a, b);
    if (len < 20) { lines.push(null); continue; }
    const tx = (b.x - a.x) / len, ty = (b.y - a.y) / len, nx = -ty, ny = tx;
    const pts = [];
    for (let s = 1; s < 24; s++) {
      const f = 0.1 + 0.8 * s / 24, bx = a.x + (b.x - a.x) * f, by = a.y + (b.y - a.y) * f;
      let best = -1, bo = 0;
      for (let o = -r; o <= r; o += 0.5) {
        px(bx + nx * (o - 1.5), by + ny * (o - 1.5), c1);
        px(bx + nx * (o + 1.5), by + ny * (o + 1.5), c2);
        const g = Math.hypot(c1[0] - c2[0], c1[1] - c2[1], c1[2] - c2[2]);
        if (g > best) { best = g; bo = o; }
      }
      if (best > 14) pts.push({ x: bx + nx * bo, y: by + ny * bo });
    }
    if (pts.length < 7) { lines.push(null); continue; }
    const fit = (P) => {
      const mx = P.reduce((s, p) => s + p.x, 0) / P.length, my = P.reduce((s, p) => s + p.y, 0) / P.length;
      let sxx = 0, syy = 0, sxy = 0;
      for (const p of P) { sxx += (p.x - mx) ** 2; syy += (p.y - my) ** 2; sxy += (p.x - mx) * (p.y - my); }
      const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
      return { mx, my, dx: Math.cos(ang), dy: Math.sin(ang) };
    };
    let L = fit(pts);
    const res = pts.map(p => Math.abs((p.x - L.mx) * -L.dy + (p.y - L.my) * L.dx));
    const medR = res.slice().sort((a2, b2) => a2 - b2)[res.length >> 1];
    const kept = pts.filter((p, i) => res[i] <= Math.max(1, medR * 2.5));
    if (kept.length >= 6) L = fit(kept);
    // La recta debe seguir aproximadamente la dirección del lado original.
    if (Math.abs(L.dx * tx + L.dy * ty) < 0.97) { lines.push(null); continue; }
    lines.push(L);
  }
  const out = q.map(p => ({ ...p }));
  for (let i = 0; i < 4; i++) {
    const A = lines[(i + 3) % 4], Bl = lines[i];
    if (!A || !Bl) continue;
    const den = A.dx * Bl.dy - A.dy * Bl.dx;
    if (Math.abs(den) < 1e-6) continue;
    const t = ((Bl.mx - A.mx) * Bl.dy - (Bl.my - A.my) * Bl.dx) / den;
    const p = { x: A.mx + A.dx * t, y: A.my + A.dy * t };
    if (dist(p, q[i]) <= r * 1.6) out[i] = { x: clamp(p.x, 0, W), y: clamp(p.y, 0, H) };
  }
  return out.map(p => ({ x: p.x / k, y: p.y / k }));
}

/**
 * Busca el documento en la imagen. Devuelve { quad, score } en coordenadas de la fuente, o null.
 * `maxDim` controla la resolución de trabajo (más alta = más precisa y más lenta).
 */
export function detectQuad(source, sw, sh, maxDim = 480, kind = null) {
  const aspect = kind === 'dni' ? { r: 85.6 / 54, tol: 0.14, slope: 0.9 }
    : kind === 'a4' ? { r: 297 / 210, tol: 0.2, slope: 1.4 }
    : kind === 'letter' ? { r: 279.4 / 215.9, tol: 0.2, slope: 1.4 } : null;
  if (!sw || !sh) return null;
  const k = maxDim / Math.max(sw, sh);
  const W = Math.max(16, Math.round(sw * k)), H = Math.max(16, Math.round(sh * k)), N = W * H;
  const ctx = scratchCtx(W, H);
  ctx.drawImage(source, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data;
  const L = new Uint8Array(N), S = new Uint8Array(N), Wt = new Uint8Array(N), D = new Uint8Array(N);
  const R = new Uint8Array(N), G = new Uint8Array(N), B = new Uint8Array(N);
  for (let i = 0, j = 0; i < N; i++, j += 4) {
    const r = d[j], g = d[j + 1], b = d[j + 2];
    R[i] = r; G[i] = g; B[i] = b;
    L[i] = (r * 77 + g * 150 + b * 29) >> 8;
    S[i] = Math.max(r, g, b) - Math.min(r, g, b);
  }
  boxBlur(L, W, H); boxBlur(L, W, H); boxBlur(S, W, H);
  boxBlur(R, W, H); boxBlur(G, W, H); boxBlur(B, W, H);
  for (let i = 0; i < N; i++) Wt[i] = clamp(L[i] - 1.3 * S[i], 0, 255);
  // Color del fondo: mediana del borde de la imagen. El documento suele diferir de ese color.
  const border = [];
  for (let x = 0; x < W; x += 2) border.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y += 2) border.push(y * W, y * W + W - 1);
  const med = arr => { const v = border.map(i => arr[i]).sort((a, b) => a - b); return v[v.length >> 1]; };
  const bR = med(R), bG = med(G), bB = med(B);
  for (let i = 0; i < N; i++) D[i] = clamp(Math.hypot(R[i] - bR, G[i] - bG, B[i] - bB) * 1.4, 0, 255);
  const tL = otsu(L), tW = otsu(Wt), tS = otsu(S), tD = Math.max(18, otsu(D));
  const masks = [
    Uint8Array.from(L, v => (v > tL ? 1 : 0)),
    Uint8Array.from(Wt, v => (v > tW ? 1 : 0)),
    Uint8Array.from(D, v => (v > tD ? 1 : 0)),
    Uint8Array.from(S, v => (v > tS ? 1 : 0)),
    Uint8Array.from(L, v => (v <= tL ? 1 : 0)),
    closedContours(R, G, B, W, H)
  ];
  const cands = [];
  for (const m0 of masks) {
    const m = dilate(erode(m0, W, H), W, H);
    const { lab, sizes } = label(m, W, H);
    const ids = sizes.map((s, i) => [s, i]).slice(1).filter(([s]) => s > N * 0.018).sort((a, b) => b[0] - a[0]).slice(0, 3);
    for (const [size, id] of ids) {
      const r = scoreComponent(lab, id, size, W, H, aspect);
      if (r && r.score >= 0.55) { r.area = polyArea(r.quad); cands.push(r); }
    }
  }
  if (!cands.length) return null;
  // Los documentos tienen rectángulos adentro (foto del DNI, recuadros): se prefiere el más grande
  // siempre que su forma sea casi tan buena como la del mejor candidato.
  const top = Math.max(...cands.map(c => c.score));
  const best = cands.filter(c => c.score >= top * 0.78).sort((a, b) => b.area - a.area)[0];
  return { quad: best.quad.map(p => ({ x: clamp(p.x / k, 0, sw), y: clamp(p.y / k, 0, sh) })), score: best.score };
}

/**
 * Detección a partir de un toque: crece una región desde el punto tocado
 * con varias tolerancias de color y se queda con la forma más rectangular.
 * Sirve con fondos estampados, donde la detección automática se confunde.
 */
export function detectAt(source, sw, sh, px, py, kind = null) {
  const maxDim = 480, k = maxDim / Math.max(sw, sh);
  const W = Math.max(16, Math.round(sw * k)), H = Math.max(16, Math.round(sh * k)), N = W * H;
  const ctx = scratchCtx(W, H);
  ctx.drawImage(source, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data;
  const R = new Uint8Array(N), G = new Uint8Array(N), B = new Uint8Array(N);
  for (let i = 0, j = 0; i < N; i++, j += 4) { R[i] = d[j]; G[i] = d[j + 1]; B[i] = d[j + 2]; }
  boxBlur(R, W, H); boxBlur(G, W, H); boxBlur(B, W, H);
  boxBlur(R, W, H); boxBlur(G, W, H); boxBlur(B, W, H);
  const cx = clamp(Math.round(px * k), 2, W - 3), cy = clamp(Math.round(py * k), 2, H - 3);
  const aspect = kind === 'dni' ? { r: 85.6 / 54, tol: 0.14, slope: 0.9 }
    : kind === 'a4' ? { r: 297 / 210, tol: 0.2, slope: 1.4 }
    : kind === 'letter' ? { r: 279.4 / 215.9, tol: 0.2, slope: 1.4 } : null;
  // El dedo puede caer sobre texto o una foto: se prueban también puntos alrededor.
  const seeds = [[0, 0]];
  for (const rr of [9, 18]) for (let a2 = 0; a2 < 8; a2++) seeds.push([Math.round(Math.cos(a2 * Math.PI / 4) * rr), Math.round(Math.sin(a2 * Math.PI / 4) * rr)]);
  const tried = [];
  let best = null;
  const stack = new Int32Array(N);
  for (const [ox, oy] of seeds) {
    const sx = clamp(cx + ox, 2, W - 3), sy = clamp(cy + oy, 2, H - 3);
    let r0 = 0, g0 = 0, b0 = 0, n = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const i = (sy + dy) * W + sx + dx; r0 += R[i]; g0 += G[i]; b0 += B[i]; n++;
    }
    r0 /= n; g0 /= n; b0 /= n;
    if (tried.some(t => Math.abs(t[0] - r0) + Math.abs(t[1] - g0) + Math.abs(t[2] - b0) < 12)) continue;
    tried.push([r0, g0, b0]);
    for (const tol of [16, 24, 34, 46, 60]) {
      const m = new Uint8Array(N);
      let sp = 0, size = 0;
      const seed = sy * W + sx;
      m[seed] = 1; stack[sp++] = seed;
      const lim = tol * 1.7;
      const ok = i => Math.abs(R[i] - r0) + Math.abs(G[i] - g0) + Math.abs(B[i] - b0) < lim;
      while (sp) {
        const p = stack[--sp], x = p % W; size++;
        if (x > 0 && !m[p - 1] && ok(p - 1)) { m[p - 1] = 1; stack[sp++] = p - 1; }
        if (x < W - 1 && !m[p + 1] && ok(p + 1)) { m[p + 1] = 1; stack[sp++] = p + 1; }
        if (p >= W && !m[p - W] && ok(p - W)) { m[p - W] = 1; stack[sp++] = p - W; }
        if (p < N - W && !m[p + W] && ok(p + W)) { m[p + W] = 1; stack[sp++] = p + W; }
      }
      if (size < N * 0.004) continue;
      if (size > N * 0.9) break;
      const closed = erode(dilate(dilate(m, W, H), W, H), W, H);
      const lab = new Int32Array(N);
      let cnt = 0;
      for (let i = 0; i < N; i++) if (closed[i]) { lab[i] = 1; cnt++; }
      const r = scoreComponent(lab, 1, cnt, W, H, aspect, true);
      // Debe contener el punto tocado (o quedar muy cerca).
      if (r && pointIn(r.quad, cx, cy, 12) && (!best || r.score > best.score)) best = r;
    }
  }
  if (!best || best.score < 0.45) return null;
  return { quad: best.quad.map(p => ({ x: clamp(p.x / k, 0, sw), y: clamp(p.y / k, 0, sh) })), score: best.score };
}

function pointIn(q, x, y, margin = 0) {
  let inside = true;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4];
    const cr = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    if (cr / len < -margin) inside = false;
  }
  return inside;
}

/** Busca el documento solo dentro de una zona (recuadro guía): ignora el fondo de alrededor. */
let roiCanvas = null;
export function detectInRegion(source, roi, maxDim = 480, kind = null) {
  const w = roi.x1 - roi.x0, h = roi.y1 - roi.y0;
  if (w < 20 || h < 20) return null;
  const k = Math.min(1, 1000 / Math.max(w, h));
  if (!roiCanvas) roiCanvas = document.createElement('canvas');
  roiCanvas.width = Math.round(w * k); roiCanvas.height = Math.round(h * k);
  roiCanvas.getContext('2d').drawImage(source, roi.x0, roi.y0, w, h, 0, 0, roiCanvas.width, roiCanvas.height);
  const r = detectQuad(roiCanvas, roiCanvas.width, roiCanvas.height, maxDim, kind);
  if (!r) return null;
  return { quad: r.quad.map(p => ({ x: roi.x0 + p.x / k, y: roi.y0 + p.y / k })), score: r.score };
}

export function expandRect(r, f, W, H) {
  const w = r.x1 - r.x0, h = r.y1 - r.y0;
  return { x0: clamp(r.x0 - w * f, 0, W), y0: clamp(r.y0 - h * f, 0, H), x1: clamp(r.x1 + w * f, 0, W), y1: clamp(r.y1 + h * f, 0, H) };
}

export const rectQuad = r => [{ x: r.x0, y: r.y0 }, { x: r.x1, y: r.y0 }, { x: r.x1, y: r.y1 }, { x: r.x0, y: r.y1 }];

export function quadBox(q) {
  return { x0: Math.min(...q.map(p => p.x)), y0: Math.min(...q.map(p => p.y)), x1: Math.max(...q.map(p => p.x)), y1: Math.max(...q.map(p => p.y)) };
}
