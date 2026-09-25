// Copia Clara · lógica principal.

import { $, $$, uid, nextFrame, mk, canvasToBlob, blobToCanvas, fmtBytes, fmtWhen, todayPE, slugify, toast, download, shareFiles, canShareFiles, settings, vibrate } from './utils.js';
import { KINDS, detectQuad, detectAt, refineQuad, defaultQuad, orderQuad, polyArea, dist, homography } from './geometry.js';
import { FILTERS, DEFAULT_FILTER, forOcr } from './enhance.js';
import { store, initStore, isPersistent, setPersistent } from './store.js';
import { renderPage, makeThumb, getSource, ocrImage, ocrKey, forget, forgetSig } from './render.js';
import { Camera } from './camera.js';
import { SignaturePad } from './sign.js';
import { recognize, findDni, ocrCached, preloadOcr } from './ocr.js';
import { QUALITY, buildPdf, buildJpgs, mergePdfFiles } from './pdf.js';

const VERSION = '2.1';

/* =================================================================== */
/* Navegación: pila de pantallas y hojas, integrada con el botón atrás */
/* =================================================================== */

function showEl(el) {
  el.hidden = false;
  if (el.classList.contains('screen')) {
    el.classList.remove('enter'); void el.offsetWidth; el.classList.add('enter');
  }
}
function hideEl(el) { el.hidden = true; }

const Nav = {
  stack: [],
  after: null,
  push(id, opts = {}) {
    this.stack.push({ id, onHide: opts.onHide });
    history.pushState({ d: this.stack.length }, '');
    showEl($('#' + id));
    chrome();
  },
  replace(id, opts = {}) {
    const top = this.stack.pop();
    if (top) { hideEl($('#' + top.id)); if (top.onHide) top.onHide(); }
    this.stack.push({ id, onHide: opts.onHide });
    showEl($('#' + id));
    chrome();
  },
  back(then, n = 1) {
    if (!this.stack.length) { if (then) then(); return; }
    n = Math.min(n, this.stack.length);
    this.after = then || null;
    history.go(-n);
  },
  popTo(d) {
    while (this.stack.length > d) {
      const v = this.stack.pop();
      hideEl($('#' + v.id));
      if (v.onHide) v.onHide();
    }
    chrome();
    const f = this.after; this.after = null;
    if (f) f();
  },
  top() { return this.stack.length ? this.stack[this.stack.length - 1].id : null; },
  has(id) { return this.stack.some(v => v.id === id); }
};
history.replaceState({ d: 0 }, '');
window.addEventListener('popstate', e => {
  const d = (e.state && e.state.d) || 0;
  if (d < Nav.stack.length) Nav.popTo(d);
  else if (Nav.after) { const f = Nav.after; Nav.after = null; f(); }
});

function chrome() {
  $('#tabbar').hidden = Nav.stack.some(v => v.id.startsWith('scr-'));
}

let tab = 'home';
function switchTab(t) {
  tab = t;
  $('#scr-home').hidden = t !== 'home';
  $('#scr-tools').hidden = t !== 'tools';
  $$('.tab-btn').forEach(b => {
    const on = b.dataset.tab === t;
    b.classList.toggle('on', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  if (t === 'tools') updateOcrNote();
}

/* =================================================================== */
/* Estado                                                              */
/* =================================================================== */

let session = null;             // escaneo en curso: { docId, origin, kind, side, added }
const cur = { doc: null, pages: [], idx: -1 };
const urls = { home: [], doc: [], misc: [] };
const revoke = k => { urls[k].forEach(u => URL.revokeObjectURL(u)); urls[k] = []; };
const objURL = (k, blob) => { const u = URL.createObjectURL(blob); urls[k].push(u); return u; };

function kindSeg(container, value, onChange) {
  container.innerHTML = '';
  for (const k of Object.keys(KINDS)) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'seg-btn' + (k === value ? ' on' : '');
    b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(k === value));
    b.dataset.v = k; b.textContent = KINDS[k].short;
    b.addEventListener('click', () => {
      $$('.seg-btn', container).forEach(x => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', String(on)); });
      onChange(k);
    });
    container.appendChild(b);
  }
}

function segValue(container, value, onChange) {
  $$('.seg-btn', container).forEach(b => {
    const on = b.dataset.v === value;
    b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on));
    b.onclick = () => { segValue(container, b.dataset.v, onChange); onChange(b.dataset.v); };
  });
}

const docName = kind => `${KINDS[kind].label} ${todayPE()}`;
const sideLabel = s => (s === 'anverso' ? 'Anverso' : s === 'reverso' ? 'Reverso' : '');

/* =================================================================== */
/* Inicio                                                              */
/* =================================================================== */

async function renderHome() {
  const docs = await store.allDocs();
  revoke('home');
  const list = $('#docList');
  list.innerHTML = '';
  for (const d of docs) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'doc-item';
    const th = document.createElement('span'); th.className = 'doc-thumb';
    if (d.thumbBlob) { const im = document.createElement('img'); im.alt = ''; im.src = objURL('home', d.thumbBlob); th.appendChild(im); }
    const txt = document.createElement('span');
    const nm = document.createElement('span'); nm.className = 'doc-name'; nm.textContent = d.name;
    const sub = document.createElement('span'); sub.className = 'doc-sub';
    const n = d.pageIds.length;
    sub.textContent = `${n} ${n === 1 ? 'página' : 'páginas'} · ${fmtWhen(d.updatedAt)}`;
    txt.append(nm, sub);
    b.append(th, txt);
    b.insertAdjacentHTML('beforeend', '<svg class="ic sm chev"><use href="#i-chev"/></svg>');
    b.addEventListener('click', () => openDoc(d.id));
    li.appendChild(b); list.appendChild(li);
  }
  $('#homeEmpty').hidden = docs.length > 0;
  $('#storeNote').textContent = isPersistent() ? 'Guardados en este celular' : 'Se borran al cerrar la app';
}

/* =================================================================== */
/* Cámara                                                              */
/* =================================================================== */

const cam = new Camera($('#camVideo'));
const live = { run: false, raf: 0, last: 0, quad: null, miss: 0, stable: 0, prevT: 0, shooting: false };
let autoOn = settings.get('auto', false);

function startCapture(kind, docId = null) {
  session = { docId, origin: docId ? 'doc' : 'home', kind, side: kind === 'dni' ? 'anverso' : null, added: 0 };
  kindSeg($('#camKind'), kind, k => {
    session.kind = k; session.side = k === 'dni' ? 'anverso' : null;
    settings.set('lastKind', k); live.quad = null; camHint();
  });
  $('#camDone').hidden = true;
  $('#camAuto').setAttribute('aria-pressed', String(autoOn));
  Nav.push('scr-camera', { onHide: stopCamera });
  openCamera();
}

async function openCamera() {
  $('#camFallback').hidden = true;
  setHint('Abriendo la cámara…');
  try { await cam.start(); }
  catch (e) {
    $('#camFallbackText').textContent = e.message;
    $('#camFallback').hidden = false;
    return;
  }
  if (Nav.top() !== 'scr-camera' && !Nav.has('scr-camera')) { cam.stop(); return; }
  $('#camTorch').hidden = !cam.torchSupported;
  $('#camTorch').setAttribute('aria-pressed', 'false');
  startLive();
}

function stopCamera() { stopLive(); cam.stop(); }

function setHint(t, ok = false) {
  const h = $('#camHint');
  if (h.textContent !== t) h.textContent = t;
  h.classList.toggle('ok', ok);
}

function camHint() {
  if (!session) return;
  const dni = session.kind === 'dni';
  if (live.quad) setHint(autoOn ? 'No te muevas… se toma sola' : 'Documento detectado. Toca el botón para capturar.', true);
  else if (dni) setHint(`Coloca el ${session.side || 'anverso'} del DNI dentro del recuadro`);
  else setHint('Apunta al documento. Mejor sobre un fondo oscuro.');
}

function startLive() {
  stopLive();
  live.run = true; live.quad = null; live.miss = 0; live.stable = 0; live.prevT = performance.now();
  const loop = () => {
    if (!live.run) return;
    live.raf = requestAnimationFrame(loop);
    const now = performance.now();
    if (now - live.last < 150) return;
    const dt = now - live.last; live.last = now;
    const v = cam.video;
    if (v.readyState < 2 || !v.videoWidth) return;
    const r = detectQuad(v, v.videoWidth, v.videoHeight, 256, session.kind);
    const diag = Math.hypot(v.videoWidth, v.videoHeight);
    if (r) {
      live.miss = 0;
      if (live.quad) {
        const q = orderQuad(r.quad);
        const move = Math.max(...q.map((p, i) => dist(p, live.quad[i]))) / diag;
        live.stable = move < 0.018 ? live.stable + dt : 0;
        live.quad = move < 0.1 ? live.quad.map((p, i) => ({ x: p.x * 0.45 + q[i].x * 0.55, y: p.y * 0.45 + q[i].y * 0.55 })) : q;
      } else { live.quad = orderQuad(r.quad); live.stable = 0; }
    } else if (++live.miss > 4) { live.quad = null; live.stable = 0; }
    drawOverlay();
    camHint();
    const need = 1100;
    $('#camRing').style.setProperty('--p', autoOn && live.quad ? `${Math.min(360, live.stable / need * 360)}deg` : '0deg');
    if (autoOn && live.quad && live.stable >= need && !live.shooting) shoot();
  };
  loop();
}

function stopLive() {
  live.run = false;
  cancelAnimationFrame(live.raf);
  const o = $('#camOverlay'); o.getContext('2d').clearRect(0, 0, o.width, o.height);
  $('#camRing').style.setProperty('--p', '0deg');
}

function drawOverlay() {
  const o = $('#camOverlay'), v = cam.video;
  const cw = o.clientWidth, ch = o.clientHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
  if (o.width !== Math.round(cw * dpr) || o.height !== Math.round(ch * dpr)) { o.width = Math.round(cw * dpr); o.height = Math.round(ch * dpr); }
  const x = o.getContext('2d');
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  x.clearRect(0, 0, cw, ch);
  const vw = v.videoWidth, vh = v.videoHeight;
  if (!vw) return;
  const s = Math.max(cw / vw, ch / vh), ox = (cw - vw * s) / 2, oy = (ch - vh * s) / 2;
  const map = p => ({ x: p.x * s + ox, y: p.y * s + oy });
  if (live.quad) {
    const q = live.quad.map(map);
    x.beginPath(); x.moveTo(q[0].x, q[0].y); for (let i = 1; i < 4; i++) x.lineTo(q[i].x, q[i].y); x.closePath();
    x.fillStyle = 'rgba(61,199,154,0.18)'; x.fill();
    x.lineWidth = 3; x.strokeStyle = '#3DC79A'; x.stroke();
    for (const p of q) { x.beginPath(); x.arc(p.x, p.y, 6, 0, Math.PI * 2); x.fillStyle = '#fff'; x.fill(); }
  } else if (session && session.kind === 'dni') {
    const r = 85.6 / 54;
    const w = Math.min(cw * 0.86, ch * 0.6 * r), h = w / r;
    const gx = (cw - w) / 2, gy = (ch - h) / 2 - 20;
    x.setLineDash([10, 8]); x.lineWidth = 2.5; x.strokeStyle = 'rgba(255,255,255,0.9)';
    x.beginPath(); x.roundRect ? x.roundRect(gx, gy, w, h, 14) : x.rect(gx, gy, w, h); x.stroke(); x.setLineDash([]);
  }
}

async function shoot() {
  if (live.shooting || !cam.stream) return;
  live.shooting = true;
  $('#camShutter').disabled = true;
  const f = $('#camFlash'); f.classList.add('on'); setTimeout(() => f.classList.remove('on'), 60);
  vibrate(18);
  try {
    const photo = await cam.capture();
    openCrop({ src: photo, kind: session.kind, side: session.side, mode: 'new', origin: 'camera', queue: [] });
  } catch { toast('No se pudo tomar la foto. Inténtalo otra vez.', 'err'); }
  finally { live.shooting = false; live.stable = 0; $('#camShutter').disabled = false; }
}

$('#camShutter').addEventListener('click', shoot);
$('#camAuto').addEventListener('click', () => {
  autoOn = !autoOn; settings.set('auto', autoOn);
  $('#camAuto').setAttribute('aria-pressed', String(autoOn)); live.stable = 0; camHint();
  toast(autoOn ? 'Captura automática activada' : 'Captura automática desactivada');
});
$('#camTorch').addEventListener('click', async () => {
  const on = !cam.torchOn, ok = await cam.setTorch(on);
  $('#camTorch').setAttribute('aria-pressed', String(ok && on));
  if (ok && on && session && session.kind === 'dni') toast('Ojo: la linterna puede reflejarse sobre el holograma del DNI.');
});
$('#camDone').addEventListener('click', finishSession);

function updateDoneBtn(thumbBlob) {
  const b = $('#camDone');
  b.hidden = !session || session.added === 0;
  $('#camCount').textContent = `Listo (${session.added})`;
  if (thumbBlob) { revoke('misc'); $('#camThumb').style.backgroundImage = `url("${objURL('misc', thumbBlob)}")`; }
}

async function finishSession() {
  if (!session || !session.docId) { Nav.back(); return; }
  const id = session.docId, origin = session.origin;
  session = null;
  if (origin === 'doc') Nav.back(() => openDoc(id, 'refresh'));
  else openDoc(id, 'replace');
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (cam.stream) stopCamera(); }
  else if (Nav.top() === 'scr-camera') openCamera();
});

/* =================================================================== */
/* Recorte                                                             */
/* =================================================================== */

let crop = null;
const stage = $('#cropStage'), sctx = stage.getContext('2d');
let view = { k: 1, w: 0, h: 0, dpr: 1 };
let dragIdx = -1;

async function openCrop(opts, how = 'push') {
  crop = { ...opts, srcChanged: false, total: opts.total || 1, idx: opts.idx || 1 };
  kindSeg($('#cropKind'), crop.kind, k => {
    crop.kind = k;
    if (crop.mode === 'new' && session) { session.kind = k; session.side = k === 'dni' ? (session.side || 'anverso') : null; crop.side = session.side; settings.set('lastKind', k); }
    if (crop.mode === 'edit') crop.side = k === 'dni' ? (crop.page.side || 'anverso') : null;
    $('#crop-title').textContent = crop.kind === 'dni' && crop.side ? `DNI · ${sideLabel(crop.side)}` : 'Ajusta las esquinas';
  });
  const cnt = $('#cropCount');
  cnt.hidden = crop.total < 2; cnt.textContent = `Foto ${crop.idx} de ${crop.total}`;
  $('#cropSkip').hidden = !(crop.queue && crop.queue.length) && crop.total < 2;
  $('#cropAcceptTxt').textContent = crop.mode === 'edit' ? 'Guardar recorte' : 'Usar recorte';
  $('#crop-title').textContent = crop.kind === 'dni' && crop.side ? `DNI · ${sideLabel(crop.side)}` : 'Ajusta las esquinas';
  if (how === 'push') {
    if (live.run) stopLive();
    Nav.push('scr-crop', {
      onHide: () => {
        crop = null;
        if (Nav.top() === 'scr-camera') { if (cam.stream) startLive(); else openCamera(); }
      }
    });
  }
  await nextFrame();
  if (!crop.quad) {
    const r = detectQuad(crop.src, crop.src.width, crop.src.height, 640, crop.kind);
    if (r) {
      crop.quad = orderQuad(refineQuad(crop.src, crop.src.width, crop.src.height, orderQuad(r.quad)));
      $('#cropHint').textContent = 'Bordes detectados. Revisa las esquinas antes de continuar.';
    } else {
      crop.quad = defaultQuad(crop.src.width, crop.src.height, crop.kind);
      $('#cropHint').textContent = 'No lo detecté solo. Toca el documento en la foto, o arrastra los puntos a sus esquinas.';
    }
  } else $('#cropHint').textContent = 'Arrastra los puntos a las esquinas. Al arrastrar aparece una lupa.';
  layoutCrop();
}

function layoutCrop() {
  if (!crop) return;
  const box = $('#cropBox');
  const maxW = box.clientWidth - 28, maxH = box.clientHeight - 12;
  const k = Math.min(maxW / crop.src.width, maxH / crop.src.height);
  const w = Math.max(1, Math.round(crop.src.width * k)), h = Math.max(1, Math.round(crop.src.height * k));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  stage.width = Math.round(w * dpr); stage.height = Math.round(h * dpr);
  stage.style.width = w + 'px'; stage.style.height = h + 'px';
  view = { k, w, h, dpr };
  drawCrop();
}

function drawCrop() {
  if (!crop || !crop.quad) return;
  const { k, w, h, dpr } = view;
  sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  sctx.clearRect(0, 0, w, h);
  sctx.drawImage(crop.src, 0, 0, w, h);
  const q = crop.quad.map(p => ({ x: p.x * k, y: p.y * k }));
  sctx.beginPath(); sctx.rect(0, 0, w, h);
  sctx.moveTo(q[0].x, q[0].y); for (let i = 1; i < 4; i++) sctx.lineTo(q[i].x, q[i].y); sctx.closePath();
  sctx.fillStyle = 'rgba(4,8,6,.55)'; sctx.fill('evenodd');
  sctx.beginPath(); sctx.moveTo(q[0].x, q[0].y); for (let i = 1; i < 4; i++) sctx.lineTo(q[i].x, q[i].y); sctx.closePath();
  sctx.lineWidth = 2.5; sctx.strokeStyle = '#3DC79A'; sctx.stroke();
  q.forEach((p, i) => {
    sctx.beginPath(); sctx.arc(p.x, p.y, i === dragIdx ? 16 : 13, 0, Math.PI * 2);
    sctx.fillStyle = 'rgba(255,255,255,.95)'; sctx.fill();
    sctx.lineWidth = 3; sctx.strokeStyle = '#0E7458'; sctx.stroke();
  });
  if (dragIdx >= 0) {
    const pv = q[dragIdx], ps = crop.quad[dragIdx];
    const R = Math.min(64, w / 4.5, h / 4), Z = 2.8;
    const cx = pv.x > w / 2 ? R + 10 : w - R - 10, cy = pv.y > h / 2 ? R + 10 : h - R - 10;
    const rs = R / (k * Z);
    sctx.save();
    sctx.beginPath(); sctx.arc(cx, cy, R, 0, Math.PI * 2); sctx.clip();
    sctx.fillStyle = '#000'; sctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
    sctx.drawImage(crop.src, ps.x - rs, ps.y - rs, 2 * rs, 2 * rs, cx - R, cy - R, 2 * R, 2 * R);
    sctx.strokeStyle = '#3DC79A'; sctx.lineWidth = 1.5;
    sctx.beginPath(); sctx.moveTo(cx - R, cy); sctx.lineTo(cx + R, cy); sctx.moveTo(cx, cy - R); sctx.lineTo(cx, cy + R); sctx.stroke();
    sctx.restore();
    sctx.beginPath(); sctx.arc(cx, cy, R, 0, Math.PI * 2); sctx.lineWidth = 3; sctx.strokeStyle = '#fff'; sctx.stroke();
  }
}

const evPt = e => { const r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
let tapStart = null;
stage.addEventListener('pointerdown', e => {
  if (!crop || !crop.quad) return;
  const p = evPt(e);
  let best = -1, bd = 40;
  crop.quad.forEach((c, i) => { const d = Math.hypot(c.x * view.k - p.x, c.y * view.k - p.y); if (d < bd) { bd = d; best = i; } });
  stage.setPointerCapture(e.pointerId);
  e.preventDefault();
  if (best < 0) { tapStart = { ...p, t: performance.now() }; return; }
  dragIdx = best; drawCrop();
});
stage.addEventListener('pointermove', e => {
  if (dragIdx < 0 || !crop) return;
  const p = evPt(e);
  crop.quad[dragIdx] = { x: Math.min(crop.src.width, Math.max(0, p.x / view.k)), y: Math.min(crop.src.height, Math.max(0, p.y / view.k)) };
  drawCrop();
});
const endDrag = e => {
  if (dragIdx >= 0) { dragIdx = -1; drawCrop(); return; }
  if (tapStart && e && e.type === 'pointerup') {
    const p = evPt(e);
    if (Math.hypot(p.x - tapStart.x, p.y - tapStart.y) < 12 && performance.now() - tapStart.t < 800) tapDetect(p);
  }
  tapStart = null;
};
stage.addEventListener('pointerup', endDrag);
stage.addEventListener('pointercancel', endDrag);

async function tapDetect(p) {
  if (!crop) return;
  const x = p.x / view.k, y = p.y / view.k;
  $('#cropHint').textContent = 'Buscando el documento donde tocaste…';
  await nextFrame();
  const r = detectAt(crop.src, crop.src.width, crop.src.height, x, y, crop.kind);
  if (!crop) return;
  if (r) {
    crop.quad = orderQuad(refineQuad(crop.src, crop.src.width, crop.src.height, orderQuad(r.quad)));
    $('#cropHint').textContent = 'Listo. Revisa las esquinas; si algo quedó fuera, arrastra el punto.';
    vibrate(10);
  } else {
    $('#cropHint').textContent = 'No encontré un borde claro ahí. Toca en otra parte del documento o arrastra los puntos.';
  }
  drawCrop();
}
new ResizeObserver(() => { if (crop) layoutCrop(); }).observe($('#cropBox'));

$('#cropRotate').addEventListener('click', () => {
  if (!crop) return;
  const s = crop.src, c = mk(s.height, s.width), x = c.getContext('2d');
  x.translate(c.width, 0); x.rotate(Math.PI / 2); x.drawImage(s, 0, 0);
  const H = s.height;
  crop.quad = orderQuad(crop.quad.map(p => ({ x: H - p.y, y: p.x })));
  crop.src = c; crop.srcChanged = true;
  layoutCrop();
});
$('#cropDetect').addEventListener('click', () => {
  if (!crop) return;
  const r = detectQuad(crop.src, crop.src.width, crop.src.height, 640, crop.kind);
  if (r) {
    crop.quad = orderQuad(refineQuad(crop.src, crop.src.width, crop.src.height, orderQuad(r.quad)));
    $('#cropHint').textContent = 'Bordes detectados. Revisa las esquinas antes de continuar.';
  } else toast('No lo detecté solo. Toca el documento en la foto.');
  drawCrop();
});
$('#cropFull').addEventListener('click', () => {
  if (!crop) return;
  const w = crop.src.width, h = crop.src.height;
  crop.quad = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
  if (crop.kind === 'dni') {
    const b = $('#cropKind .seg-btn[data-v=free]');
    if (b) b.click();
    toast('Cambié el tipo a «Libre» para no deformar la foto.');
  }
  drawCrop();
});
$('#cropSkip').addEventListener('click', () => nextInQueue());
$('#cropAccept').addEventListener('click', acceptCrop);

function quadValid(q, w, h) {
  if (polyArea(q) < w * h * 0.01) return false;
  const hmg = homography([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], q);
  return !!hmg;
}

async function acceptCrop() {
  if (!crop) return;
  const btn = $('#cropAccept');
  const q = orderQuad(crop.quad);
  if (!quadValid(q, crop.src.width, crop.src.height)) { toast('Las esquinas están demasiado juntas. Sepáralas un poco.', 'err'); return; }
  btn.disabled = true;
  await nextFrame();
  try {
    if (crop.mode === 'edit') {
      const page = crop.page;
      if (crop.srcChanged) page.srcBlob = await canvasToBlob(crop.src, 'image/jpeg', 0.9);
      page.quad = q; page.kind = crop.kind; page.ocr = null;
      page.side = page.kind === 'dni' ? (crop.side || 'anverso') : null;
      forget(page.id);
      await persistPage(page);
      Nav.back(() => refreshPage(true));
      return;
    }
    const page = await createPage(crop.src, q, crop.kind, crop.side);
    toast(`Página ${session.added} añadida`);
    if (crop.origin === 'camera') updateDoneBtn(page.thumbBlob);
    await nextInQueue(true);
  } catch (e) {
    console.error(e);
    toast('No se pudo procesar esta foto. Prueba con otra.', 'err');
  } finally { btn.disabled = false; }
}

async function nextInQueue() {
  if (!crop) return;
  if (crop.queue && crop.queue.length) {
    const f = crop.queue.shift();
    try {
      const src = await blobToCanvas(f, 3000);
      await openCrop({ src, quad: null, kind: session.kind, side: session.side, mode: 'new', origin: crop.origin, queue: crop.queue, total: crop.total, idx: crop.idx + 1 }, 'update');
    } catch {
      toast(`No pude abrir «${f.name}». Usa fotos JPG o PNG.`, 'err');
      crop.idx++; return nextInQueue();
    }
    return;
  }
  if (crop.origin === 'camera') { Nav.back(); return; }
  if (!session || !session.docId) { Nav.back(); return; }
  finishSession();
}

async function startImport(files, docId) {
  files = [...files].filter(f => /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name));
  if (!files.length) { toast('Elige fotos en JPG o PNG.', 'err'); return; }
  const kind = settings.get('lastKind', 'a4');
  session = { docId, origin: docId ? 'doc' : 'home', kind, side: kind === 'dni' ? 'anverso' : null, added: 0 };
  await importQueue(files, 'import');
}

async function importQueue(files, origin) {
  const first = files.shift();
  let src;
  try { src = await blobToCanvas(first, 3000); }
  catch { toast(`No pude abrir «${first.name}». Usa fotos JPG o PNG.`, 'err'); if (files.length) return importQueue(files, origin); return; }
  await openCrop({ src, quad: null, kind: session.kind, side: session.side, mode: 'new', origin, queue: files, total: files.length + 1, idx: 1 }, 'push');
}

/* =================================================================== */
/* Documentos y páginas                                                */
/* =================================================================== */

function newDoc(kind) {
  const now = Date.now();
  return { id: uid(), name: docName(kind), nameAuto: true, kind, createdAt: now, updatedAt: now, pageIds: [], thumbBlob: null, dniChecked: false };
}

async function createPage(src, quad, kind, side) {
  let doc = session.docId ? await store.getDoc(session.docId) : null;
  if (!doc) { doc = newDoc(kind); session.docId = doc.id; }
  const page = {
    id: uid(), docId: doc.id, kind, side: kind === 'dni' ? side || 'anverso' : null,
    srcBlob: await canvasToBlob(src, 'image/jpeg', 0.9), quad,
    rot: 0, filter: DEFAULT_FILTER[kind], bright: 0, contrast: 0, sigs: [], ocr: null, createdAt: Date.now()
  };
  page.thumbBlob = await makeThumb(page);
  await store.putPage(page);
  doc.pageIds.push(page.id);
  doc.updatedAt = Date.now();
  if (doc.pageIds.length === 1) doc.thumbBlob = page.thumbBlob;
  await store.putDoc(doc);
  session.added++;
  if (kind === 'dni') session.side = page.side === 'anverso' ? 'reverso' : 'anverso';
  return page;
}

async function persistPage(page) {
  page.thumbBlob = await makeThumb(page);
  await store.putPage(page);
  const doc = cur.doc && cur.doc.id === page.docId ? cur.doc : await store.getDoc(page.docId);
  if (!doc) return;
  if (doc.pageIds[0] === page.id) doc.thumbBlob = page.thumbBlob;
  doc.updatedAt = Date.now();
  await store.putDoc(doc);
}

async function openDoc(id, how = 'push') {
  const doc = await store.getDoc(id);
  if (!doc) { toast('Ese documento ya no existe.', 'err'); renderHome(); return; }
  cur.doc = doc;
  cur.pages = await store.pagesOf(doc);
  renderDoc();
  if (how === 'push') Nav.push('scr-doc', { onHide: onDocHide });
  else if (how === 'replace') Nav.replace('scr-doc', { onHide: onDocHide });
  maybeDniBanner();
}

function onDocHide() { renderHome(); }

function renderDoc() {
  const d = cur.doc, n = cur.pages.length;
  $('#docName').value = d.name;
  const kinds = [...new Set(cur.pages.map(p => KINDS[p.kind].short))].join(', ');
  $('#docMeta').textContent = n ? `${n} ${n === 1 ? 'página' : 'páginas'} · ${kinds} · ${fmtWhen(d.updatedAt)}` : 'Sin páginas. Añade una con la cámara o la galería.';
  revoke('doc');
  const g = $('#pageGrid');
  g.innerHTML = '';
  cur.pages.forEach((p, i) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'pcard';
    b.setAttribute('aria-label', `Editar página ${i + 1}`);
    const box = document.createElement('span'); box.className = 'pcard-img';
    const im = document.createElement('img'); im.alt = ''; if (p.thumbBlob) im.src = objURL('doc', p.thumbBlob);
    box.appendChild(im);
    const lb = document.createElement('span'); lb.className = 'pcard-lbl';
    const num = document.createElement('span'); num.className = 'n'; num.textContent = String(i + 1);
    const tx = document.createElement('small'); tx.textContent = p.kind === 'dni' ? `DNI · ${sideLabel(p.side)}` : KINDS[p.kind].short;
    lb.append(num, tx);
    if (p.sigs && p.sigs.length) lb.insertAdjacentHTML('beforeend', '<svg class="ic sm" aria-label="Firmada"><use href="#i-pen"/></svg>');
    b.append(box, lb);
    b.addEventListener('click', () => openPage(i));
    li.appendChild(b); g.appendChild(li);
  });
  const li = document.createElement('li');
  li.innerHTML = '<button type="button" class="pcard add-card"><span class="pcard-img"><svg class="ic"><use href="#i-plus"/></svg>Añadir página</span></button>';
  li.firstChild.addEventListener('click', () => startCapture(settings.get('lastKind', cur.doc.kind || 'a4'), cur.doc.id));
  g.appendChild(li);
  $('#docExport').disabled = n === 0;
  $('#docText').disabled = n === 0;
}

$('#docName').addEventListener('change', async e => {
  const v = e.target.value.trim();
  cur.doc.name = v || docName(cur.doc.kind);
  cur.doc.nameAuto = !v;
  e.target.value = cur.doc.name;
  cur.doc.updatedAt = Date.now();
  await store.putDoc(cur.doc);
});
$('#docName').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
$('#docAddCam').addEventListener('click', () => startCapture(settings.get('lastKind', cur.doc.kind || 'a4'), cur.doc.id));
$('#docDelete').addEventListener('click', async () => {
  const n = cur.pages.length;
  if (!await confirmSheet('¿Eliminar este documento?', `Se borrarán sus ${n} ${n === 1 ? 'página' : 'páginas'} de este celular. No se puede deshacer.`, 'Eliminar')) return;
  cur.pages.forEach(p => forget(p.id));
  await store.deleteDoc(cur.doc.id);
  Nav.back(() => toast('Documento eliminado'));
});
$('#docText').addEventListener('click', () => showText({ pages: cur.pages, context: 'doc' }));
$('#docExport').addEventListener('click', openExport);

/* ---------- DNI: nombrar con el número ---------- */

async function maybeDniBanner() {
  const d = cur.doc, bn = $('#dniBanner');
  bn.hidden = true;
  if (!settings.get('autoName', true) || !d.nameAuto || d.dniChecked) return;
  const dniPages = cur.pages.filter(p => p.kind === 'dni');
  if (!dniPages.length) return;
  if (await ocrCached()) { runDniName(d, dniPages); return; }
  $('#dniBannerText').textContent = '¿Leo el número del DNI para ponerle ese nombre al archivo? La primera vez descarga el lector de texto (unos 6 MB).';
  $('.banner-btns', bn).hidden = false;
  bn.hidden = false;
}

async function runDniName(d, pages) {
  const bn = $('#dniBanner');
  $('#dniBannerText').textContent = 'Buscando el número del DNI…';
  $('.banner-btns', bn).hidden = true;
  bn.hidden = false;
  let num = null;
  try {
    const ordered = [...pages.filter(p => p.side === 'anverso'), ...pages.filter(p => p.side !== 'anverso')];
    for (const p of ordered) {
      const o = await ensureOcr(p);
      num = findDni(o.text);
      if (num) break;
    }
  } catch {
    if (cur.doc && cur.doc.id === d.id) bn.hidden = true;
    toast('No se pudo cargar el lector de texto. Conéctate a internet e inténtalo de nuevo.', 'err');
    return;
  }
  const fresh = await store.getDoc(d.id);
  if (!fresh) return;
  fresh.dniChecked = true;
  if (num && fresh.nameAuto) { fresh.name = `DNI ${num}`; fresh.nameAuto = false; }
  await store.putDoc(fresh);
  if (cur.doc && cur.doc.id === d.id) {
    cur.doc = fresh;
    $('#docName').value = fresh.name;
    bn.hidden = true;
  }
  toast(num ? `Nombre del archivo: DNI ${num}` : 'No encontré el número del DNI. Puedes escribir el nombre arriba.');
}

$('#dniBannerGo').addEventListener('click', () => runDniName(cur.doc, cur.pages.filter(p => p.kind === 'dni')));
$('#dniBannerNo').addEventListener('click', async () => {
  cur.doc.dniChecked = true; await store.putDoc(cur.doc); $('#dniBanner').hidden = true;
});

/* =================================================================== */
/* Editor de página                                                    */
/* =================================================================== */

let saveTimer = 0, renderTimer = 0, renderSeq = 0;
const miniCache = new Map();

function openPage(i) {
  cur.idx = i;
  Nav.push('scr-page', { onHide: onPageHide });
  setEditTab('filters');
  endPlacement();
  refreshPage(true);
}

async function onPageHide() {
  await flushSave();
  if (cur.doc) { cur.pages = await store.pagesOf(cur.doc); renderDoc(); }
}

const curPage = () => cur.pages[cur.idx];

function previewDim() {
  const s = $('#pgStage'), dpr = Math.min(2, window.devicePixelRatio || 1);
  return Math.min(1800, Math.round(Math.max(s.clientWidth, s.clientHeight) * dpr));
}

async function refreshPage(rebuild) {
  const p = curPage();
  if (!p) return;
  const n = cur.pages.length;
  $('#page-title').textContent = `Página ${cur.idx + 1} de ${n}`;
  $('#pgPrev').disabled = cur.idx === 0;
  $('#pgNext').disabled = cur.idx === n - 1;
  $('#adjBright').value = p.bright; $('#outBright').textContent = p.bright;
  $('#adjContrast').value = p.contrast; $('#outContrast').textContent = p.contrast;
  const seq = ++renderSeq;
  $('#pgBusy').hidden = false;
  await nextFrame();
  try {
    const c = await renderPage(p, { maxDim: previewDim() });
    if (seq !== renderSeq) return;
    const pc = $('#pgCanvas');
    pc.width = c.width; pc.height = c.height;
    pc.getContext('2d').drawImage(c, 0, 0);
    fitPreview();
  } catch (e) { console.error(e); toast('No se pudo mostrar la página.', 'err'); }
  finally { if (seq === renderSeq) $('#pgBusy').hidden = true; }
  if (rebuild) buildFilterChips(p);
  else markFilter(p.filter);
}

function fitPreview() {
  const pc = $('#pgCanvas'), st = $('#pgStage');
  const sw = st.clientWidth - 28, sh = st.clientHeight - 28;
  const k = Math.min(sw / pc.width, sh / pc.height);
  pc.style.width = Math.max(1, Math.floor(pc.width * k)) + 'px';
  pc.style.height = Math.max(1, Math.floor(pc.height * k)) + 'px';
}
new ResizeObserver(() => { if (!$('#scr-page').hidden) fitPreview(); }).observe($('#pgStage'));

async function buildFilterChips(p) {
  const row = $('#filterRow');
  row.innerHTML = '';
  const key = k => `${p.id}|${p.quad.map(q => q.x.toFixed(0) + ',' + q.y.toFixed(0)).join(';')}|${p.rot}|${p.kind}|${k}`;
  const items = [];
  for (const [k, label] of Object.entries(FILTERS)) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'fchip' + (k === p.filter ? ' on' : '');
    b.dataset.f = k; b.setAttribute('aria-pressed', String(k === p.filter));
    b.innerHTML = '<span class="fimg"><img alt=""></span>';
    b.append(label);
    b.addEventListener('click', () => {
      const pg = curPage(); if (!pg || pg.filter === k) return;
      pg.filter = k; markFilter(k); scheduleRender(); scheduleSave();
    });
    row.appendChild(b); items.push([k, b]);
  }
  for (const [k, b] of items) {
    const kk = key(k);
    let url = miniCache.get(kk);
    if (!url) {
      try {
        const c = await renderPage(p, { maxDim: 170, filter: k, sigs: false, adjustOn: false });
        url = c.toDataURL('image/jpeg', 0.75);
        miniCache.set(kk, url);
        if (miniCache.size > 40) miniCache.delete(miniCache.keys().next().value);
      } catch { continue; }
    }
    if (curPage() !== p) return;
    $('img', b).src = url;
  }
}

function markFilter(f) {
  $$('.fchip').forEach(b => { const on = b.dataset.f === f; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
}

function scheduleRender() { clearTimeout(renderTimer); renderTimer = setTimeout(() => refreshPage(false), 90); }
function scheduleSave() {
  clearTimeout(saveTimer);
  const p = curPage();
  saveTimer = setTimeout(() => { saveTimer = 0; persistPage(p).catch(() => {}); }, 500);
  scheduleSave.pending = p;
}
async function flushSave() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = 0; if (scheduleSave.pending) await persistPage(scheduleSave.pending).catch(() => {}); }
}

function setEditTab(t) {
  const f = t === 'filters';
  $('#tabFilters').classList.toggle('on', f); $('#tabFilters').setAttribute('aria-selected', String(f));
  $('#tabAdjust').classList.toggle('on', !f); $('#tabAdjust').setAttribute('aria-selected', String(!f));
  $('#panFilters').hidden = !f; $('#panAdjust').hidden = f;
}
$('#tabFilters').addEventListener('click', () => setEditTab('filters'));
$('#tabAdjust').addEventListener('click', () => setEditTab('adjust'));

for (const [id, key, out] of [['#adjBright', 'bright', '#outBright'], ['#adjContrast', 'contrast', '#outContrast']]) {
  $(id).addEventListener('input', e => {
    const p = curPage(); if (!p) return;
    p[key] = +e.target.value; $(out).textContent = e.target.value;
    scheduleRender(); scheduleSave();
  });
}
$('#adjReset').addEventListener('click', () => {
  const p = curPage(); if (!p) return;
  p.bright = 0; p.contrast = 0; refreshPage(false); scheduleSave();
});

$('#pgRotate').addEventListener('click', () => {
  const p = curPage(); if (!p) return;
  p.rot = (p.rot + 90) % 360;
  if (p.sigs && p.sigs.length) { p.sigs = []; toast('Se quitaron las firmas al girar. Vuelve a colocarlas.'); }
  refreshPage(true); scheduleSave();
});

async function movePage(delta) {
  const i = cur.idx, j = i + delta;
  if (j < 0 || j >= cur.pages.length) return;
  await flushSave();
  [cur.pages[i], cur.pages[j]] = [cur.pages[j], cur.pages[i]];
  cur.doc.pageIds = cur.pages.map(p => p.id);
  cur.doc.thumbBlob = cur.pages[0].thumbBlob;
  cur.doc.updatedAt = Date.now();
  await store.putDoc(cur.doc);
  cur.idx = j;
  refreshPage(false);
  toast(`Ahora es la página ${j + 1}`);
}
$('#pgPrev').addEventListener('click', () => movePage(-1));
$('#pgNext').addEventListener('click', () => movePage(1));

$('#pgDelete').addEventListener('click', async () => {
  const p = curPage(); if (!p) return;
  if (!await confirmSheet('¿Eliminar esta página?', 'Se borrará de este documento. No se puede deshacer.', 'Eliminar')) return;
  clearTimeout(saveTimer); saveTimer = 0; scheduleSave.pending = null;
  await store.delPage(p.id); forget(p.id);
  cur.pages.splice(cur.idx, 1);
  cur.doc.pageIds = cur.pages.map(x => x.id);
  cur.doc.thumbBlob = cur.pages[0] ? cur.pages[0].thumbBlob : null;
  cur.doc.updatedAt = Date.now();
  await store.putDoc(cur.doc);
  toast('Página eliminada');
  if (!cur.pages.length) { Nav.back(); return; }
  cur.idx = Math.min(cur.idx, cur.pages.length - 1);
  refreshPage(true);
});

$('#pgCrop').addEventListener('click', async () => {
  const p = curPage(); if (!p) return;
  await flushSave();
  const s = await getSource(p);
  const src = mk(s.width, s.height); src.getContext('2d').drawImage(s, 0, 0);
  openCrop({ src, quad: p.quad.map(q => ({ ...q })), kind: p.kind, side: p.side, mode: 'edit', page: p, queue: [] });
});

$('#pgText').addEventListener('click', () => { const p = curPage(); if (p) showText({ pages: [p], context: 'doc' }); });

/* ---------- firmas ---------- */

let placing = null;

$('#pgSign').addEventListener('click', async () => {
  const sigs = await store.allSigs();
  const p = curPage();
  if (!sigs.length && !(p.sigs && p.sigs.length)) { openSignPad('place'); return; }
  openSigs('pick');
});

async function openSigs(mode) {
  const grid = $('#sigGrid');
  const sigs = await store.allSigs();
  revoke('misc');
  grid.innerHTML = '';
  $('#sigsHint').textContent = mode === 'pick'
    ? (sigs.length ? 'Toca una firma para colocarla en la página.' : 'Aún no tienes firmas guardadas.')
    : (sigs.length ? 'Tus firmas guardadas en este celular.' : 'Aún no tienes firmas guardadas.');
  for (const s of sigs) {
    const li = document.createElement('li'); li.className = 'sig-item';
    const b = document.createElement('button'); b.type = 'button'; b.className = 'sig-pick';
    b.setAttribute('aria-label', mode === 'pick' ? 'Usar esta firma' : 'Firma guardada');
    const im = document.createElement('img'); im.alt = ''; im.src = objURL('misc', s.blob);
    b.appendChild(im);
    if (mode === 'pick') b.addEventListener('click', () => Nav.back(() => startPlacement(s)));
    const del = document.createElement('button'); del.type = 'button'; del.className = 'sig-del'; del.setAttribute('aria-label', 'Borrar firma');
    del.innerHTML = '<svg class="ic sm"><use href="#i-trash"/></svg>';
    del.addEventListener('click', async ev => {
      ev.stopPropagation();
      await store.delSig(s.id); forgetSig(s.id);
      li.remove();
      toast('Firma borrada');
    });
    li.append(b, del); grid.appendChild(li);
  }
  const p = mode === 'pick' ? curPage() : null;
  $('#sigRemoveAll').hidden = !(p && p.sigs && p.sigs.length);
  $('#sigNew').onclick = () => openSignPad(mode === 'pick' ? 'place-from-sheet' : 'manage');
  if (!Nav.has('sh-sigs')) Nav.push('sh-sigs');
  openSigs.mode = mode;
}

$('#sigRemoveAll').addEventListener('click', () => {
  const p = curPage(); if (!p) return;
  p.sigs = []; scheduleSave();
  Nav.back(() => { refreshPage(false); toast('Firmas quitadas de la página'); });
});

let pad = null;
function openSignPad(mode) {
  Nav.push('sh-sign');
  requestAnimationFrame(() => {
    if (!pad) {
      pad = new SignaturePad($('#signPad'));
      pad.onChange = () => { $('#signSave').disabled = pad.empty; $('#padPh').hidden = !pad.empty; };
    }
    pad.resize(); pad.clear();
  });
  segValue($('#signColor'), pad ? pad.color : '#101820', v => { if (pad) pad.color = v; });
  $('#signSave').onclick = async () => {
    if (!pad || pad.empty) return;
    const c = pad.toCanvas();
    if (!c) return;
    const sig = { id: uid(), blob: await canvasToBlob(c, 'image/png'), w: c.width, h: c.height, createdAt: Date.now() };
    await store.putSig(sig);
    if (mode === 'place') Nav.back(() => startPlacement(sig));
    else if (mode === 'place-from-sheet') Nav.back(() => startPlacement(sig), 2);
    else Nav.back(() => { openSigs('manage'); toast('Firma guardada'); });
  };
}
$('#signClear').addEventListener('click', () => pad && pad.clear());
$('#signUndo').addEventListener('click', () => pad && pad.undo());
window.addEventListener('resize', () => { if (pad && !$('#sh-sign').hidden) pad.resize(); });

function startPlacement(sig) {
  const pc = $('#pgCanvas');
  const cw = pc.clientWidth, ch = pc.clientHeight;
  if (!cw) return;
  const url = URL.createObjectURL(sig.blob);
  const img = $('#sigPlaceImg');
  img.onload = () => URL.revokeObjectURL(url);
  img.src = url;
  const w = cw * 0.4, h = w * sig.h / sig.w;
  placing = { sig, x: cw * 0.52, y: Math.max(0, ch * 0.82 - h), w, ratio: sig.h / sig.w };
  positionPlace();
  $('#sigPlace').hidden = false;
  $('#pgTools').hidden = true; $('#placeBar').hidden = false;
}

function positionPlace() {
  const el = $('#sigPlace'), pc = $('#pgCanvas');
  const cw = pc.clientWidth, ch = pc.clientHeight;
  placing.w = Math.max(40, Math.min(cw, placing.w));
  const h = placing.w * placing.ratio;
  placing.x = Math.max(0, Math.min(cw - placing.w, placing.x));
  placing.y = Math.max(0, Math.min(ch - h, placing.y));
  const off = pc.offsetLeft, offT = pc.offsetTop;
  el.style.left = off + placing.x + 'px'; el.style.top = offT + placing.y + 'px';
  el.style.width = placing.w + 'px'; el.style.height = h + 'px';
}

function endPlacement() {
  placing = null;
  $('#sigPlace').hidden = true;
  $('#pgTools').hidden = false; $('#placeBar').hidden = true;
}

(() => {
  const el = $('#sigPlace'), handle = $('#sigHandle');
  let mode = null, sx = 0, sy = 0, start = null;
  const down = (e, m) => {
    if (!placing) return;
    e.preventDefault(); e.stopPropagation();
    mode = m; sx = e.clientX; sy = e.clientY; start = { ...placing };
    el.setPointerCapture(e.pointerId);
  };
  el.addEventListener('pointerdown', e => down(e, e.target === handle ? 'size' : 'move'));
  el.addEventListener('pointermove', e => {
    if (!mode || !placing) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (mode === 'move') { placing.x = start.x + dx; placing.y = start.y + dy; }
    else { placing.w = start.w + Math.max(dx, dy / placing.ratio); }
    positionPlace();
  });
  const up = () => { mode = null; };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
})();

$('#placeCancel').addEventListener('click', endPlacement);
$('#placeOk').addEventListener('click', () => {
  const p = curPage(); if (!p || !placing) return;
  const pc = $('#pgCanvas'), cw = pc.clientWidth, ch = pc.clientHeight;
  p.sigs = p.sigs || [];
  p.sigs.push({ sigId: placing.sig.id, x: placing.x / cw, y: placing.y / ch, w: placing.w / cw });
  endPlacement();
  refreshPage(false); scheduleSave();
  toast('Firma colocada');
});

/* =================================================================== */
/* Leer texto                                                          */
/* =================================================================== */

async function ensureOcr(page, onProg) {
  const key = ocrKey(page);
  if (page.ocr && page.ocr.key === key) return page.ocr;
  const img = await ocrImage(page);
  const r = await recognize(img, onProg);
  page.ocr = { ...r, key };
  const fresh = await store.getPage(page.id);
  if (fresh) { fresh.ocr = page.ocr; await store.putPage(fresh); }
  return page.ocr;
}

let textRun = 0;
async function showText({ pages = null, canvas = null, context = 'doc' }) {
  const run = ++textRun;
  $('#txtArea').value = '';
  $('#txtDni').hidden = true;
  $('#txt-title').textContent = pages && pages.length === 1 && cur.pages.length > 1 ? `Texto de la página ${cur.pages.indexOf(pages[0]) + 1}` : 'Texto leído';
  const prog = $('#txtProg');
  prog.hidden = false; $('#txtBar').style.width = '3%';
  $('#txtProgText').textContent = 'Preparando el lector de texto…';
  Nav.push('sh-text');
  const upd = (label, frac) => {
    if (run !== textRun) return;
    $('#txtProgText').textContent = label + '…';
    $('#txtBar').style.width = Math.max(3, Math.round(frac * 100)) + '%';
  };
  try {
    let text = '', dniText = '';
    if (canvas) {
      const r = await recognize(canvas, (l, f) => upd(l, f));
      text = r.text; dniText = r.text;
    } else {
      const parts = [];
      for (let i = 0; i < pages.length; i++) {
        const p = pages[i];
        const o = await ensureOcr(p, (l, f) => upd(pages.length > 1 ? `${l} · página ${i + 1} de ${pages.length}` : l, (i + f) / pages.length));
        const n = cur.pages.indexOf(p) + 1;
        parts.push(pages.length > 1 ? `— Página ${n} —\n${o.text}` : o.text);
        if (p.kind === 'dni') dniText += '\n' + o.text;
      }
      text = parts.join('\n\n');
    }
    if (run !== textRun) return;
    prog.hidden = true;
    $('#txtArea').value = text;
    if (!text.trim()) toast('No encontré texto legible. Prueba con una foto más nítida y con buena luz.');
    const num = findDni(dniText || (context === 'photo' ? text : ''));
    if (num) {
      $('#txtDniText').textContent = `Número de DNI encontrado: ${num}`;
      $('#txtDniUse').hidden = context !== 'doc' || !cur.doc;
      $('#txtDni').hidden = false;
      $('#txtDniUse').onclick = async () => {
        cur.doc.name = `DNI ${num}`; cur.doc.nameAuto = false; cur.doc.dniChecked = true;
        await store.putDoc(cur.doc); $('#docName').value = cur.doc.name;
        $('#txtDni').hidden = true; toast(`Nombre del archivo: DNI ${num}`);
      };
    }
  } catch (e) {
    console.error(e);
    if (run !== textRun) return;
    $('#txtBar').style.width = '0%';
    $('#txtProgText').textContent = navigator.onLine
      ? 'No se pudo cargar el lector de texto. Cierra esta ventana e inténtalo de nuevo.'
      : 'Sin conexión. La primera vez, el lector de texto necesita internet para descargarse (unos 6 MB).';
  }
}

$('#txtCopy').addEventListener('click', async () => {
  const t = $('#txtArea');
  if (!t.value) return;
  try { await navigator.clipboard.writeText(t.value); toast('Texto copiado'); }
  catch { t.select(); toast('Selecciona el texto y cópialo.'); }
});
$('#txtShare').addEventListener('click', async () => {
  const v = $('#txtArea').value;
  if (!v) return;
  if (navigator.share) { try { await navigator.share({ text: v }); } catch { /* cancelado */ } }
  else { download(`texto-${slugify(cur.doc ? cur.doc.name : 'foto')}.txt`, new Blob([v], { type: 'text/plain' })); }
});

/* =================================================================== */
/* Exportar                                                            */
/* =================================================================== */

const exp = { fmt: 'pdf', quality: settings.get('quality', 'media'), paper: settings.get('paper', 'a4'), result: null };

function openExport() {
  exp.result = null;
  exp.fmt = 'pdf';
  $('#expName').value = slugify(cur.doc.name);
  const dnis = cur.pages.filter(p => p.kind === 'dni').length;
  $('#expDniRow').hidden = dnis < 2;
  $('#expWmText').value = settings.get('wmText', `Copia para trámite de ________ · ${todayPE()}`);
  buildQuality();
  segValue($('#expFmt'), exp.fmt, v => { exp.fmt = v; syncExport(); });
  segValue($('#expPaper'), exp.paper, v => { exp.paper = v; settings.set('paper', v); syncExport(); });
  syncExport();
  Nav.push('sh-export');
}

function buildQuality() {
  const box = $('#expQuality');
  box.innerHTML = '';
  for (const [k, q] of Object.entries(QUALITY)) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'q-card' + (k === exp.quality ? ' on' : '');
    b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(k === exp.quality));
    const t = document.createElement('b'); t.textContent = q.label;
    const s = document.createElement('small'); s.textContent = q.hint;
    b.append(t, s);
    b.addEventListener('click', () => {
      exp.quality = k; settings.set('quality', k);
      $$('.q-card', box).forEach(x => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', String(on)); });
      syncExport();
    });
    box.appendChild(b);
  }
}

function syncExport() {
  exp.result = null;
  $('#expResult').hidden = true;
  $('#expProg').hidden = true;
  $('#expExt').textContent = exp.fmt === 'pdf' ? '.pdf' : '.jpg';
  $$('.pdf-only', $('#sh-export')).forEach(el => { el.hidden = exp.fmt !== 'pdf' || (el.id === 'expDniRow' && cur.pages.filter(p => p.kind === 'dni').length < 2); });
  $('#expWmField').hidden = !$('#expWm').checked;
  $('#expGo').hidden = false;
  $('#expGo').textContent = exp.fmt === 'pdf' ? 'Crear PDF' : (cur.pages.length > 1 ? `Crear ${cur.pages.length} imágenes` : 'Crear imagen');
}
['#expDni', '#expSearch', '#expWm'].forEach(id => $(id).addEventListener('change', syncExport));
$('#expWmText').addEventListener('input', e => { settings.set('wmText', e.target.value); exp.result = null; $('#expResult').hidden = true; $('#expGo').hidden = false; });
$('#expName').addEventListener('input', () => { if (exp.result) { $('#expResult').hidden = true; exp.result = null; $('#expGo').hidden = false; } });

$('#expGo').addEventListener('click', async () => {
  const go = $('#expGo');
  go.disabled = true;
  const prog = $('#expProg');
  prog.hidden = false; $('#expBar').style.width = '4%';
  const setP = (t, f) => { $('#expProgText').textContent = t; $('#expBar').style.width = Math.max(4, Math.round(f * 100)) + '%'; };
  await flushSave();
  try {
    const pages = cur.pages;
    const base = slugify($('#expName').value) || 'documento';
    const wm = $('#expWm').checked ? ($('#expWmText').value.trim() || '') : '';
    const render = p => renderPage(p);
    if (exp.fmt === 'pdf') {
      let text = null;
      if ($('#expSearch').checked) {
        text = new Map();
        for (let i = 0; i < pages.length; i++) {
          const o = await ensureOcr(pages[i], (l, f) => setP(`${l} · página ${i + 1} de ${pages.length}`, 0.6 * (i + f) / pages.length));
          text.set(pages[i].id, o);
        }
      }
      const off = text ? 0.6 : 0;
      setP('Creando el PDF…', off);
      const blob = await buildPdf(pages, render, {
        paper: exp.paper, quality: exp.quality, dniSheet: $('#expDni').checked, watermark: wm, text,
        onProgress: (i, n) => setP(`Creando el PDF · página ${i} de ${n}`, off + (1 - off) * i / n)
      });
      const name = base + '.pdf';
      exp.result = { files: [new File([blob], name, { type: 'application/pdf' })], size: blob.size, label: name };
    } else {
      const blobs = await buildJpgs(pages, render, { quality: exp.quality, watermark: wm, onProgress: (i, n) => setP(`Creando imagen ${i} de ${n}`, i / n) });
      const files = blobs.map((b, i) => new File([b], `${base}${blobs.length > 1 ? '-' + (i + 1) : ''}.jpg`, { type: 'image/jpeg' }));
      exp.result = { files, size: blobs.reduce((s, b) => s + b.size, 0), label: files.length > 1 ? `${files.length} imágenes JPG` : files[0].name };
    }
    prog.hidden = true;
    $('#expResName').textContent = exp.result.label;
    const n = pages.length;
    $('#expResMeta').textContent = `${fmtBytes(exp.result.size)} · ${n} ${n === 1 ? 'página' : 'páginas'} · calidad ${QUALITY[exp.quality].label.toLowerCase()}`;
    $('#expShare').hidden = !canShareFiles(exp.result.files);
    $('#expResult').hidden = false;
    go.hidden = true;
  } catch (e) {
    console.error(e);
    setP(e && e.message && /lector/.test(e.message) ? e.message : 'No se pudo crear el archivo. Prueba con calidad Liviana o menos páginas.', 0);
    toast('No se pudo crear el archivo.', 'err');
  } finally { go.disabled = false; }
});

async function deliver(files, mode) {
  if (mode === 'share') {
    const r = await shareFiles(files, files[0].name);
    if (r === 'shared') { toast('Listo para enviar'); return; }
    if (r === 'cancelled') return;
  }
  for (let i = 0; i < files.length; i++) {
    download(files[i].name, files[i]);
    if (i < files.length - 1) await new Promise(r => setTimeout(r, 450));
  }
  toast(files.length > 1 ? `Descargadas ${files.length} imágenes. Búscalas en Descargas.` : `Descargado: ${files[0].name}`);
}
$('#expShare').addEventListener('click', () => exp.result && deliver(exp.result.files, 'share'));
$('#expSave').addEventListener('click', () => exp.result && deliver(exp.result.files, 'save'));

/* =================================================================== */
/* Herramientas                                                        */
/* =================================================================== */

const mrg = { files: [], result: null };

function renderMerge() {
  const ol = $('#mrgList');
  ol.innerHTML = '';
  mrg.files.forEach((f, i) => {
    const li = document.createElement('li'); li.className = 'file-row';
    const n = document.createElement('span'); n.className = 'n'; n.textContent = String(i + 1);
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = f.name;
    const sm = document.createElement('small'); sm.textContent = fmtBytes(f.size); nm.appendChild(sm);
    const btns = document.createElement('span'); btns.className = 'row-btns';
    const mkb = (icon, label, fn, dis) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'icon-btn'; b.setAttribute('aria-label', label);
      b.innerHTML = `<svg class="ic sm"><use href="#${icon}"/></svg>`; b.disabled = !!dis; b.addEventListener('click', fn); return b;
    };
    btns.append(
      mkb('i-back', 'Subir', () => { [mrg.files[i - 1], mrg.files[i]] = [mrg.files[i], mrg.files[i - 1]]; mergeChanged(); }, i === 0),
      mkb('i-chev', 'Bajar', () => { [mrg.files[i + 1], mrg.files[i]] = [mrg.files[i], mrg.files[i + 1]]; mergeChanged(); }, i === mrg.files.length - 1),
      mkb('i-close', 'Quitar', () => { mrg.files.splice(i, 1); mergeChanged(); })
    );
    $$('.icon-btn svg', btns).slice(0, 2).forEach(s => { s.style.transform = 'rotate(90deg)'; });
    li.append(n, nm, btns); ol.appendChild(li);
  });
  $('#mrgGo').disabled = mrg.files.length < 2;
  $('#mrgGo').textContent = mrg.files.length < 2 ? 'Añade al menos 2 PDF' : `Unir ${mrg.files.length} PDF`;
}
function mergeChanged() { mrg.result = null; $('#mrgResult').hidden = true; $('#mrgGo').hidden = false; renderMerge(); }

$('#inPdfs').addEventListener('change', e => {
  const fs = [...e.target.files].filter(f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
  e.target.value = '';
  if (!fs.length) { toast('Elige archivos PDF.', 'err'); return; }
  mrg.files.push(...fs); mergeChanged();
});
$('#mrgGo').addEventListener('click', async () => {
  const b = $('#mrgGo'); b.disabled = true; b.textContent = 'Uniendo…';
  try {
    const { blob, pages } = await mergePdfFiles(mrg.files, (i, n) => { b.textContent = `Uniendo ${i} de ${n}…`; });
    const name = `pdf-unido-${new Date().toISOString().slice(0, 10)}.pdf`;
    mrg.result = [new File([blob], name, { type: 'application/pdf' })];
    $('#mrgResName').textContent = name;
    $('#mrgResMeta').textContent = `${fmtBytes(blob.size)} · ${pages} páginas`;
    $('#mrgShare').hidden = !canShareFiles(mrg.result);
    $('#mrgResult').hidden = false; b.hidden = true;
  } catch (e) {
    toast(e.message || 'No se pudieron unir los PDF.', 'err');
    renderMerge();
  } finally { b.disabled = mrg.files.length < 2; }
});
$('#mrgShare').addEventListener('click', () => mrg.result && deliver(mrg.result, 'share'));
$('#mrgSave').addEventListener('click', () => mrg.result && deliver(mrg.result, 'save'));

const join = { order: [] };
async function openJoin() {
  const docs = await store.allDocs();
  join.order = [];
  revoke('misc');
  const ul = $('#joinList');
  ul.innerHTML = '';
  if (docs.length < 2) {
    ul.innerHTML = '<li class="fine">Necesitas al menos dos escaneos guardados para unirlos.</li>';
  }
  for (const d of docs) {
    const li = document.createElement('li');
    const lab = document.createElement('label'); lab.className = 'join-item';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.value = d.id;
    const th = document.createElement('span'); th.className = 'doc-thumb';
    if (d.thumbBlob) { const im = document.createElement('img'); im.alt = ''; im.src = objURL('misc', d.thumbBlob); th.appendChild(im); }
    const tx = document.createElement('span');
    const nm = document.createElement('span'); nm.className = 'doc-name'; nm.textContent = d.name;
    const sb = document.createElement('span'); sb.className = 'doc-sub'; sb.textContent = `${d.pageIds.length} ${d.pageIds.length === 1 ? 'página' : 'páginas'}`;
    tx.append(nm, sb);
    const ord = document.createElement('span'); ord.className = 'ord';
    cb.addEventListener('change', () => {
      if (cb.checked) join.order.push(d.id); else join.order = join.order.filter(x => x !== d.id);
      $$('.join-item', ul).forEach(l => { const id = $('input', l).value, i = join.order.indexOf(id); $('.ord', l).textContent = i >= 0 ? String(i + 1) : ''; });
      $('#joinGo').disabled = join.order.length < 2;
      $('#joinGo').textContent = join.order.length < 2 ? 'Marca al menos 2' : `Unir ${join.order.length} documentos`;
    });
    lab.append(cb, th, tx, ord); li.appendChild(lab); ul.appendChild(li);
  }
  $('#joinGo').disabled = true; $('#joinGo').textContent = 'Marca al menos 2';
  Nav.push('sh-join');
}
$('#joinGo').addEventListener('click', async () => {
  const b = $('#joinGo'); b.disabled = true;
  const docs = [];
  for (const id of join.order) { const d = await store.getDoc(id); if (d) docs.push(d); }
  const nd = newDoc(docs[0].kind);
  nd.name = 'Unión · ' + docs.map(d => d.name).join(' + ').slice(0, 60);
  nd.nameAuto = false; nd.dniChecked = true;
  for (const d of docs) {
    for (const p of await store.pagesOf(d)) {
      const np = { ...p, id: uid(), docId: nd.id, sigs: (p.sigs || []).map(s => ({ ...s })) };
      await store.putPage(np);
      nd.pageIds.push(np.id);
      if (!nd.thumbBlob) nd.thumbBlob = np.thumbBlob;
    }
  }
  await store.putDoc(nd);
  Nav.back(() => { renderHome(); openDoc(nd.id); toast('Documento creado'); });
});

async function ocrPhoto(file) {
  let c;
  try { c = await blobToCanvas(file, 3000); } catch { toast('No pude abrir esa imagen.', 'err'); return; }
  const x = c.getContext('2d', { willReadFrequently: true });
  const img = x.getImageData(0, 0, c.width, c.height);
  forOcr(img); x.putImageData(img, 0, 0);
  showText({ canvas: c, context: 'photo' });
}

async function updateOcrNote() {
  $('#ocrOfflineNote').textContent = await ocrCached() ? 'Listo: funciona sin conexión' : 'Descarga 6 MB una sola vez';
}

async function openOcrOffline() {
  const ready = await ocrCached();
  $('#ocrStatus').textContent = ready
    ? 'El lector de texto ya está guardado en este celular. Funciona sin conexión.'
    : 'Descarga el lector una vez (unos 6 MB) y podrás leer texto aunque no tengas conexión. Te conviene hacerlo con Wi-Fi.';
  $('#ocrGo').hidden = ready;
  $('#ocrProg').hidden = true;
  Nav.push('sh-ocr');
}
$('#ocrGo').addEventListener('click', async () => {
  const b = $('#ocrGo'); b.disabled = true;
  $('#ocrProg').hidden = false; $('#ocrBar').style.width = '5%';
  $('#ocrStatus').textContent = 'Descargando el lector de texto…';
  try {
    await preloadOcr(f => { $('#ocrBar').style.width = Math.round(f * 100) + '%'; });
    $('#ocrStatus').textContent = 'Listo. Ya puedes leer texto sin conexión.';
    b.hidden = true; updateOcrNote();
  } catch {
    $('#ocrStatus').textContent = 'No se pudo descargar. Revisa tu conexión e inténtalo de nuevo.';
  } finally { b.disabled = false; }
});

/* =================================================================== */
/* Ajustes                                                             */
/* =================================================================== */

function openSettings() {
  $('#setSave').checked = isPersistent();
  $('#setAutoName').checked = settings.get('autoName', true);
  $('#setVersion').textContent = `Copia Clara ${VERSION} · ${navigator.onLine ? 'con conexión' : 'sin conexión'}`;
  Nav.push('sh-settings');
}
$('#setSave').addEventListener('change', async e => {
  const on = e.target.checked;
  if (!on) {
    const ok = await confirmSheet('¿Dejar de guardar en este celular?', 'Tus escaneos se quedarán solo mientras la app esté abierta y se borrarán al cerrarla.', 'Dejar de guardar');
    if (!ok) { e.target.checked = true; return; }
  }
  try {
    await setPersistent(on);
    settings.set('save', on);
    toast(on ? 'Los escaneos se guardarán en este celular' : 'Los escaneos ya no se guardan');
    renderHome();
  } catch { e.target.checked = !on; toast('No se pudo cambiar el ajuste.', 'err'); }
});
$('#setAutoName').addEventListener('change', e => settings.set('autoName', e.target.checked));
$('#setClear').addEventListener('click', async () => {
  if (!await confirmSheet('¿Borrar todo?', 'Se eliminarán todos los escaneos y firmas de este celular. No se puede deshacer.', 'Borrar todo')) return;
  const docs = await store.allDocs();
  for (const d of docs) d.pageIds.forEach(forget);
  await store.clearAll();
  renderHome();
  toast('Se borró todo');
});

function confirmSheet(title, text, okLabel = 'Eliminar') {
  return new Promise(res => {
    $('#cf-title').textContent = title;
    $('#cf-text').textContent = text;
    const ok = $('#cfOk');
    ok.textContent = okLabel;
    let done = false;
    ok.onclick = () => { done = true; Nav.back(() => res(true)); };
    Nav.push('sh-confirm', { onHide: () => { if (!done) res(false); } });
    setTimeout(() => ok.focus(), 50);
  });
}

/* =================================================================== */
/* Ejemplo                                                             */
/* =================================================================== */

function makeSample() {
  const W = 1600, H = 1200, c = mk(W, H), x = c.getContext('2d', { willReadFrequently: true });
  const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#4b3d33'); g.addColorStop(1, '#2a221d');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 140; i++) {
    x.strokeStyle = `rgba(255,232,205,${rnd() * 0.05})`; x.lineWidth = 1 + rnd() * 3;
    const y = rnd() * H; x.beginPath(); x.moveTo(0, y);
    x.bezierCurveTo(W * 0.3, y + rnd() * 30 - 15, W * 0.7, y + rnd() * 30 - 15, W, y + rnd() * 20 - 10); x.stroke();
  }
  const fw = 840, fh = 1188, f = mk(fw, fh), fx = f.getContext('2d', { willReadFrequently: true });
  fx.fillStyle = '#f2efe7'; fx.fillRect(0, 0, fw, fh);
  fx.fillStyle = '#1d2a24'; fx.textAlign = 'center';
  fx.font = '700 38px "IBM Plex Sans", Arial, sans-serif'; fx.fillText('CONSTANCIA DE ESTUDIOS', fw / 2, 140);
  fx.font = '500 20px "IBM Plex Sans", Arial, sans-serif'; fx.fillStyle = '#4c5751'; fx.fillText('Documento de ejemplo', fw / 2, 180);
  fx.textAlign = 'left'; fx.fillStyle = '#2b3530'; fx.font = '400 21px "IBM Plex Sans", Arial, sans-serif';
  const lines = [
    'Por medio de la presente se deja constancia de que',
    'la persona indicada cursa estudios en el programa',
    'de Sistemas de Información durante el año 2026.',
    '',
    'Se expide el presente documento a solicitud de la',
    'persona interesada para los fines que considere',
    'convenientes. Este es un texto de ejemplo para',
    'probar el escaneo, los filtros y la lectura de texto.'
  ];
  lines.forEach((l, i) => fx.fillText(l, 90, 290 + i * 38));
  fx.strokeStyle = 'rgba(38,70,150,.75)'; fx.lineWidth = 5;
  fx.beginPath(); fx.arc(625, 1010, 82, 0, Math.PI * 2); fx.stroke();
  fx.lineWidth = 3; fx.beginPath(); fx.arc(625, 1010, 64, 0, Math.PI * 2); fx.stroke();
  fx.fillStyle = 'rgba(38,70,150,.75)'; fx.font = '700 22px "IBM Plex Sans", Arial, sans-serif'; fx.textAlign = 'center'; fx.fillText('SELLO', 625, 1018);
  fx.strokeStyle = '#1f2a3a'; fx.lineWidth = 3; fx.beginPath(); fx.moveTo(150, 1020);
  for (let i = 0; i < 9; i++) fx.quadraticCurveTo(170 + i * 30, 960 + (i % 2) * 70, 190 + i * 30, 1010);
  fx.stroke(); fx.lineWidth = 1.5; fx.beginPath(); fx.moveTo(130, 1050); fx.lineTo(470, 1050); fx.stroke();
  const sg = fx.createLinearGradient(0, 0, fw, fh); sg.addColorStop(0, 'rgba(0,0,0,.22)'); sg.addColorStop(0.5, 'rgba(0,0,0,0)'); sg.addColorStop(1, 'rgba(70,55,30,.12)');
  fx.fillStyle = sg; fx.fillRect(0, 0, fw, fh);
  const quad = [{ x: 400, y: 95 }, { x: 1185, y: 160 }, { x: 1300, y: 1125 }, { x: 290, y: 1070 }];
  x.save(); x.filter = 'blur(16px)'; x.fillStyle = 'rgba(0,0,0,.55)';
  x.beginPath(); quad.forEach((p, i) => (i ? x.lineTo(p.x + 16, p.y + 22) : x.moveTo(p.x + 16, p.y + 22))); x.closePath(); x.fill(); x.restore();
  const td = x.getImageData(0, 0, W, H), t = td.data, fd = fx.getImageData(0, 0, fw, fh).data;
  const h = homography(quad, [{ x: 0, y: 0 }, { x: fw, y: 0 }, { x: fw, y: fh }, { x: 0, y: fh }]);
  for (let yy = 90; yy <= 1130; yy++) for (let xx = 285; xx <= 1305; xx++) {
    const X = xx + 0.5, Y = yy + 0.5, den = h[6] * X + h[7] * Y + 1;
    const u = (h[0] * X + h[1] * Y + h[2]) / den, v = (h[3] * X + h[4] * Y + h[5]) / den;
    if (u < 0 || v < 0 || u >= fw || v >= fh) continue;
    const si = ((v | 0) * fw + (u | 0)) * 4, di = (yy * W + xx) * 4;
    t[di] = fd[si]; t[di + 1] = fd[si + 1]; t[di + 2] = fd[si + 2];
  }
  x.putImageData(td, 0, 0);
  return c;
}

async function createSample() {
  try { await document.fonts.ready; } catch { /* sin fuentes */ }
  const c = makeSample();
  session = { docId: null, origin: 'home', kind: 'a4', side: null, added: 0 };
  const r = detectQuad(c, c.width, c.height, 640, 'a4');
  const q = r ? orderQuad(refineQuad(c, c.width, c.height, orderQuad(r.quad))) : defaultQuad(c.width, c.height, 'a4');
  await createPage(c, q, 'a4', null);
  const d = await store.getDoc(session.docId);
  d.name = 'Ejemplo · Constancia'; d.nameAuto = false;
  await store.putDoc(d);
  const id = session.docId;
  session = null;
  await renderHome();
  openDoc(id);
}

/* =================================================================== */
/* Eventos globales                                                    */
/* =================================================================== */

document.addEventListener('click', e => {
  const scan = e.target.closest('[data-scan]');
  if (scan) { settings.set('lastKind', scan.dataset.scan); startCapture(scan.dataset.scan); return; }
  const t = e.target.closest('[data-tab]');
  if (t) { switchTab(t.dataset.tab); return; }
  const a = e.target.closest('[data-act]');
  if (!a) return;
  switch (a.dataset.act) {
    case 'back': Nav.back(); break;
    case 'settings': openSettings(); break;
    case 'import': $('#inImport').click(); break;
    case 'sample': createSample(); break;
    case 'scan': startCapture(settings.get('lastKind', 'a4')); break;
    case 'merge-pdfs': mrg.files = []; mrg.result = null; $('#mrgResult').hidden = true; $('#mrgGo').hidden = false; renderMerge(); Nav.push('sh-merge'); break;
    case 'join-docs': openJoin(); break;
    case 'ocr-photo': $('#inOcrPhoto').click(); break;
    case 'sigs': openSigs('manage'); break;
    case 'ocr-offline': openOcrOffline(); break;
    default: break;
  }
});

$('#inImport').addEventListener('change', e => { const f = [...e.target.files]; e.target.value = ''; if (f.length) startImport(f, null); });
$('#inDocImport').addEventListener('change', e => { const f = [...e.target.files]; e.target.value = ''; if (f.length) startImport(f, cur.doc.id); });
$('#inCamImport').addEventListener('change', e => {
  const f = [...e.target.files]; e.target.value = '';
  if (!f.length || !session) return;
  importQueue(f, 'camera');
});
$('#inCapture').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f || !session) return;
  try {
    const src = await blobToCanvas(f, 3000);
    openCrop({ src, kind: session.kind, side: session.side, mode: 'new', origin: 'camera', queue: [] });
  } catch { toast('No se pudo abrir la foto.', 'err'); }
});
$('#inOcrPhoto').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) ocrPhoto(f); });

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && Nav.stack.length) {
    if (placing) { endPlacement(); return; }
    Nav.back();
  }
});

/* =================================================================== */
/* Inicio de la app                                                    */
/* =================================================================== */

(async function boot() {
  await initStore(settings.get('save', true));
  switchTab('home');
  await renderHome();
  const scan = new URLSearchParams(location.search).get('scan');
  if (scan && KINDS[scan]) {
    history.replaceState({ d: 0 }, '', location.pathname);
    startCapture(scan);
  }
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').catch(() => {});
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded || !hadController) return;
      reloaded = true;
      toast('Copia Clara se actualizó. Los cambios se ven la próxima vez que la abras.');
    });
  }
})();
