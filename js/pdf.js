// Crear PDF (con compresión, marca de agua y texto buscable) y unir PDFs.

import { canvasToBlob, mk, loadScript } from './utils.js';
import { KINDS } from './geometry.js';

export const QUALITY = {
  alta:  { label: 'Alta',        hint: 'Para imprimir',       maxLong: 2400, q: 0.9 },
  media: { label: 'Equilibrada', hint: 'Para correo',         maxLong: 1700, q: 0.8 },
  baja:  { label: 'Liviana',     hint: 'Para WhatsApp',       maxLong: 1200, q: 0.66 }
};

const PAPER = { a4: [210, 297], letter: [215.9, 279.4] };

export function drawWatermark(c, text) {
  const x = c.getContext('2d'), w = c.width, h = c.height;
  const fs = Math.max(14, Math.round(Math.max(w, h) / 24));
  x.save();
  x.translate(w / 2, h / 2); x.rotate(-Math.atan2(h, w) * 0.85);
  x.font = `600 ${fs}px "IBM Plex Sans", Arial, sans-serif`;
  x.fillStyle = 'rgba(168,58,24,0.30)'; x.textAlign = 'center'; x.textBaseline = 'middle';
  const diag = Math.hypot(w, h), tw = x.measureText(text).width + fs * 2.2, step = fs * 2.9;
  let row = 0;
  for (let yy = -diag / 2; yy <= diag / 2; yy += step, row++) {
    const off = (row % 2) * tw / 2;
    for (let xx = -diag / 2 - tw + off; xx <= diag / 2 + tw; xx += tw) x.fillText(text, xx, yy);
  }
  x.restore();
}

/** Prepara la imagen de una página para exportar: tamaño según calidad y marca de agua. */
export async function exportCanvas(page, render, { quality, watermark }) {
  const Q = QUALITY[quality] || QUALITY.media;
  const src = await render(page);
  const k = Math.min(1, Q.maxLong / Math.max(src.width, src.height));
  const c = mk(src.width * k, src.height * k), x = c.getContext('2d');
  x.imageSmoothingQuality = 'high';
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  x.drawImage(src, 0, 0, c.width, c.height);
  if (watermark) drawWatermark(c, watermark);
  return c;
}

const winAnsi = s => s.replace(/[^\x20-\x7E -ÿ]/g, '');

function addText(doc, words, box, ocrW, ocrH) {
  if (!words || !words.length) return;
  doc.setFont('helvetica', 'normal');
  const sx = box.w / ocrW, sy = box.h / ocrH;
  for (const wd of words) {
    const t = winAnsi(wd.t);
    if (!t) continue;
    const bw = (wd.x1 - wd.x0) * sx, bh = (wd.y1 - wd.y0) * sy;
    if (bw <= 0 || bh <= 0) continue;
    doc.setFontSize(10);
    const w10 = doc.getTextWidth(t);
    if (!w10) continue;
    const fs = Math.max(1, Math.min(120, 10 * bw / w10));
    doc.setFontSize(fs);
    doc.text(t, box.x + wd.x0 * sx, box.y + wd.y1 * sy - bh * 0.18, { renderingMode: 'invisible', baseline: 'alphabetic' });
  }
}

/**
 * pages: registros de página; render(page) → canvas final.
 * opts: { paper: 'a4'|'letter'|'fit', quality, dniSheet, watermark, text: Map(pageId → ocr) , onProgress }
 */
export async function buildPdf(pages, render, opts) {
  if (!window.jspdf) throw new Error('No se cargó el generador de PDF. Recarga la app.');
  const { jsPDF } = window.jspdf;
  let doc = null;
  const addPage = (w, h) => {
    const o = w > h ? 'l' : 'p';
    if (!doc) doc = new jsPDF({ unit: 'mm', format: [w, h], orientation: o, compress: true });
    else doc.addPage([w, h], o);
  };
  const groups = [];
  if (opts.dniSheet) {
    const dnis = pages.filter(p => p.kind === 'dni');
    let placed = false;
    for (const p of pages) {
      if (p.kind === 'dni' && dnis.length > 1) {
        if (!placed) { for (let i = 0; i < dnis.length; i += 2) groups.push({ sheet: dnis.slice(i, i + 2) }); placed = true; }
      } else groups.push({ page: p });
    }
  } else pages.forEach(p => groups.push({ page: p }));

  const total = pages.length;
  let n = 0;
  const place = async (p, box) => {
    const c = await exportCanvas(p, render, opts);
    const bytes = new Uint8Array(await (await canvasToBlob(c, 'image/jpeg', (QUALITY[opts.quality] || QUALITY.media).q)).arrayBuffer());
    doc.addImage(bytes, 'JPEG', box.x, box.y, box.w, box.h);
    const o = opts.text && opts.text.get(p.id);
    if (o) addText(doc, o.words, box, o.w, o.h);
    n++; if (opts.onProgress) opts.onProgress(n, total);
  };
  const cardBox = (c, PW, y) => {
    const land = c.width >= c.height, w = land ? 85.6 : 54, h = land ? 54 : 85.6;
    return { x: (PW - w) / 2, y, w, h };
  };
  const paperFor = land => {
    const P = PAPER[opts.paper] || PAPER.a4;
    return land ? [P[1], P[0]] : P;
  };

  for (const g of groups) {
    if (g.sheet) {
      const [PW, PH] = paperFor(false);
      addPage(PW, PH);
      let y = 34;
      for (const p of g.sheet) {
        const c = await render(p);
        const b = cardBox(c, PW, y);
        await place(p, b);
        y += b.h + 18;
      }
      continue;
    }
    const p = g.page, c = await render(p);
    const land = c.width > c.height;
    if (opts.paper === 'fit') {
      let w, h;
      const mm = KINDS[p.kind] && KINDS[p.kind].mm;
      if (mm) { w = land ? Math.max(...mm) : Math.min(...mm); h = land ? Math.min(...mm) : Math.max(...mm); }
      else { w = c.width * 25.4 / 200; h = c.height * 25.4 / 200; }
      addPage(w, h);
      await place(p, { x: 0, y: 0, w, h });
      continue;
    }
    if (p.kind === 'dni') {
      const [PW, PH] = paperFor(false);
      addPage(PW, PH);
      await place(p, cardBox(c, PW, 34));
      continue;
    }
    const [PW, PH] = paperFor(land);
    addPage(PW, PH);
    if (p.kind === opts.paper) { await place(p, { x: 0, y: 0, w: PW, h: PH }); continue; }
    const m = 10, k = Math.min((PW - 2 * m) / c.width, (PH - 2 * m) / c.height);
    const w = c.width * k, h = c.height * k;
    await place(p, { x: (PW - w) / 2, y: (PH - h) / 2, w, h });
  }
  return doc.output('blob');
}

export async function buildJpgs(pages, render, opts) {
  const out = [];
  for (let i = 0; i < pages.length; i++) {
    const c = await exportCanvas(pages[i], render, opts);
    out.push(await canvasToBlob(c, 'image/jpeg', (QUALITY[opts.quality] || QUALITY.media).q));
    if (opts.onProgress) opts.onProgress(i + 1, pages.length);
  }
  return out;
}

export async function mergePdfFiles(files, onProgress) {
  await loadScript(new URL('vendor/pdf-lib.min.js', location.href).href);
  const { PDFDocument } = window.PDFLib;
  const out = await PDFDocument.create();
  let pagesTotal = 0;
  for (let i = 0; i < files.length; i++) {
    let src;
    try { src = await PDFDocument.load(await files[i].arrayBuffer(), { ignoreEncryption: true }); }
    catch { throw new Error(`No pude abrir «${files[i].name}». Puede estar dañado o protegido con contraseña.`); }
    const copied = await out.copyPages(src, src.getPageIndices());
    copied.forEach(p => out.addPage(p));
    pagesTotal += copied.length;
    if (onProgress) onProgress(i + 1, files.length);
  }
  const bytes = await out.save();
  return { blob: new Blob([bytes], { type: 'application/pdf' }), pages: pagesTotal };
}
