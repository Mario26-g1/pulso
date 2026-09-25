// Firma con el dedo: trazos suaves con grosor según la velocidad.

import { mk } from './utils.js';

export class SignaturePad {
  constructor(canvas) {
    this.c = canvas;
    this.strokes = [];
    this.color = '#101820';
    this.cur = null;
    this.onChange = null;
    const down = e => {
      e.preventDefault();
      this.c.setPointerCapture(e.pointerId);
      this.cur = { color: this.color, pts: [this.pt(e)] };
      this.strokes.push(this.cur);
      this.draw();
    };
    const move = e => {
      if (!this.cur) return;
      e.preventDefault();
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of evs) this.cur.pts.push(this.pt(ev));
      this.draw();
    };
    const up = () => { if (this.cur) { this.cur = null; this.onChange && this.onChange(); } };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    this.resize();
  }

  pt(e) {
    const r = this.c.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, t: e.timeStamp };
  }

  resize() {
    const r = this.c.getBoundingClientRect(), dpr = Math.min(2.5, window.devicePixelRatio || 1);
    this.c.width = Math.max(1, Math.round(r.width * dpr)); this.c.height = Math.max(1, Math.round(r.height * dpr));
    this.draw();
  }

  clear() { this.strokes = []; this.draw(); this.onChange && this.onChange(); }
  undo() { this.strokes.pop(); this.draw(); this.onChange && this.onChange(); }
  get empty() { return !this.strokes.some(s => s.pts.length > 1); }

  paint(ctx, W, H, scale = 1) {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const s of this.strokes) {
      const p = s.pts;
      if (!p.length) continue;
      ctx.strokeStyle = s.color; ctx.fillStyle = s.color;
      if (p.length === 1) { ctx.beginPath(); ctx.arc(p[0].x * W, p[0].y * H, 1.6 * scale, 0, Math.PI * 2); ctx.fill(); continue; }
      let lw = 2.6 * scale;
      for (let i = 1; i < p.length; i++) {
        const a = p[i - 1], b = p[i];
        const d = Math.hypot((b.x - a.x) * 400, (b.y - a.y) * 400 * H / W), dt = Math.max(1, b.t - a.t);
        const target = Math.max(1.3, Math.min(3.6, 3.8 - (d / dt) * 1.1)) * scale;
        lw = lw * 0.7 + target * 0.3;
        const m0 = i > 1 ? { x: (p[i - 2].x + a.x) / 2, y: (p[i - 2].y + a.y) / 2 } : a;
        const m1 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.moveTo(m0.x * W, m0.y * H);
        ctx.quadraticCurveTo(a.x * W, a.y * H, m1.x * W, m1.y * H);
        ctx.stroke();
      }
    }
  }

  draw() {
    const x = this.c.getContext('2d');
    x.clearRect(0, 0, this.c.width, this.c.height);
    this.paint(x, this.c.width, this.c.height, Math.min(2.5, window.devicePixelRatio || 1));
  }

  /** Firma recortada a su contorno, fondo transparente, en alta resolución. */
  toCanvas() {
    const W = 1400, H = Math.round(1400 * this.c.height / this.c.width);
    const big = mk(W, H), x = big.getContext('2d');
    this.paint(x, W, H, W / (this.c.width / Math.min(2.5, window.devicePixelRatio || 1)));
    const d = x.getImageData(0, 0, W, H).data;
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) if (d[(y * W + xx) * 4 + 3] > 8) {
      if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (x1 < 0) return null;
    const m = 12;
    x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(W - 1, x1 + m); y1 = Math.min(H - 1, y1 + m);
    const out = mk(x1 - x0 + 1, y1 - y0 + 1);
    out.getContext('2d').drawImage(big, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
    return out;
  }
}
