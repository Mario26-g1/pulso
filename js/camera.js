// Cámara en vivo con la cámara trasera del celular.

import { mk, blobToCanvas } from './utils.js';

export class Camera {
  constructor(video) {
    this.video = video;
    this.stream = null;
    this.track = null;
    this.torchOn = false;
  }

  get available() { return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia); }

  async start() {
    if (this.stream) return;
    if (!this.available) throw Object.assign(new Error('Este navegador no permite usar la cámara aquí.'), { code: 'unsupported' });
    const tries = [
      { video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1920 } }, audio: false },
      { video: { facingMode: { ideal: 'environment' } }, audio: false },
      { video: true, audio: false }
    ];
    let err = null;
    for (const c of tries) {
      try { this.stream = await navigator.mediaDevices.getUserMedia(c); break; }
      catch (e) { err = e; if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) break; }
    }
    if (!this.stream) {
      const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
      throw Object.assign(new Error(denied
        ? 'No diste permiso para usar la cámara. Actívalo en los ajustes del navegador o usa una foto de la galería.'
        : 'No se pudo abrir la cámara. Usa una foto de la galería.'), { code: denied ? 'denied' : 'failed' });
    }
    this.track = this.stream.getVideoTracks()[0];
    this.video.srcObject = this.stream;
    this.video.setAttribute('playsinline', '');
    this.video.muted = true;
    await this.video.play().catch(() => {});
    await new Promise(r => { if (this.video.readyState >= 2) r(); else this.video.addEventListener('loadeddata', r, { once: true }); });
    try {
      const caps = this.track.getCapabilities ? this.track.getCapabilities() : {};
      if (caps.focusMode && caps.focusMode.includes('continuous')) await this.track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
    } catch { /* opcional */ }
  }

  get torchSupported() {
    try { return !!(this.track && this.track.getCapabilities && this.track.getCapabilities().torch); } catch { return false; }
  }

  async setTorch(on) {
    if (!this.torchSupported) return false;
    try { await this.track.applyConstraints({ advanced: [{ torch: on }] }); this.torchOn = on; return true; } catch { return false; }
  }

  stop() {
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    this.stream = null; this.track = null; this.torchOn = false;
    this.video.srcObject = null;
  }

  /** Foto a la mayor resolución disponible (máx. 3000 px). */
  async capture() {
    const v = this.video;
    if (this.track && 'ImageCapture' in window) {
      try {
        const ic = new window.ImageCapture(this.track);
        const blob = await Promise.race([
          ic.takePhoto(this.torchOn ? { fillLightMode: 'flash' } : {}),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3500))
        ]);
        const c = await blobToCanvas(blob, 3000);
        const sameOrient = (c.width >= c.height) === (v.videoWidth >= v.videoHeight);
        if (sameOrient && Math.max(c.width, c.height) >= Math.max(v.videoWidth, v.videoHeight)) return c;
      } catch { /* se usa el cuadro del video */ }
    }
    const c = mk(v.videoWidth, v.videoHeight);
    c.getContext('2d').drawImage(v, 0, 0);
    return c;
  }
}
