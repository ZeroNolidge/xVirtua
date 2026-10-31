/**
 * Face check: records what the video panel shows — the live face, with the
 * body-language clip drawn on top at its current fade and position — plus
 * the patient's voice as Simli plays it. A small clock in the corner lines
 * the video up with the timing notes.
 */
export class StageRecorder {
  private canvas = document.createElement('canvas');
  /** The clip is drawn here first, then trimmed to the soft oval. */
  private layer = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D | null;
  private raf = 0;
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private audioCtx: AudioContext | null = null;
  private dest: MediaStreamAudioDestinationNode | null = null;
  private attached = new Set<MediaStream>();
  private t0 = 0;
  readonly mimeType: string;

  constructor(
    private readonly live: () => HTMLVideoElement | null,
    private readonly clip: HTMLVideoElement,
    private readonly voice: () => HTMLAudioElement | null,
    private readonly size = 480,
  ) {
    this.canvas.width = this.canvas.height = size;
    this.layer.width = this.layer.height = size;
    this.ctx = this.canvas.getContext('2d');
    const types = ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
    this.mimeType =
      typeof MediaRecorder !== 'undefined'
        ? (types.find((t) => MediaRecorder.isTypeSupported(t)) ?? '')
        : '';
  }

  get ext(): 'webm' | 'mp4' {
    return this.mimeType.includes('mp4') ? 'mp4' : 'webm';
  }

  /** Seconds since recording started (the same clock as the one drawn on the video). */
  now(): number {
    return this.t0 ? (performance.now() - this.t0) / 1000 : 0;
  }

  start() {
    if (!this.ctx || typeof MediaRecorder === 'undefined') return false;
    const video = this.canvas.captureStream(30);
    try {
      this.audioCtx = new AudioContext();
      this.dest = this.audioCtx.createMediaStreamDestination();
      this.attachVoice();
    } catch {
      this.audioCtx = null;
    }
    const tracks = [...video.getVideoTracks(), ...(this.dest?.stream.getAudioTracks() ?? [])];
    this.rec = new MediaRecorder(
      new MediaStream(tracks),
      this.mimeType ? { mimeType: this.mimeType } : undefined,
    );
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.t0 = performance.now();
    this.rec.start(1000);
    const draw = () => {
      this.draw();
      this.raf = requestAnimationFrame(draw);
    };
    draw();
    return true;
  }

  /** Records the voice element showing now (call again after the face switches). */
  attachVoice() {
    const el = this.voice();
    if (!el || !this.audioCtx || !this.dest) return;
    const src =
      el.srcObject instanceof MediaStream
        ? el.srcObject
        : (el as HTMLAudioElement & { captureStream?: () => MediaStream }).captureStream?.();
    if (!src || this.attached.has(src) || !src.getAudioTracks().length) return;
    this.attached.add(src);
    this.audioCtx.createMediaStreamSource(src).connect(this.dest);
  }

  private draw() {
    const ctx = this.ctx!;
    const n = this.size;
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, n, n);
    const live = this.live();
    if (live && live.readyState >= 2) ctx.drawImage(live, 0, 0, n, n);
    const clip = this.clip;
    const cs = getComputedStyle(clip);
    const opacity = parseFloat(cs.opacity || '0');
    if (opacity > 0 && clip.readyState >= 2) {
      // The clip's current shift and zoom (it lines up with the live head),
      // about the middle of the picture as in the page.
      const m = /matrix\(([^)]+)\)/.exec(cs.transform);
      const v = m ? m[1]!.split(',').map(Number) : [1, 0, 0, 1, 0, 0];
      const k = clip.clientWidth ? n / clip.clientWidth : 1;
      const lay = this.layer.getContext('2d')!;
      lay.setTransform(1, 0, 0, 1, 0, 0);
      lay.globalCompositeOperation = 'source-over';
      lay.clearRect(0, 0, n, n);
      lay.translate(n / 2, n / 2);
      lay.transform(v[0] ?? 1, v[1] ?? 0, v[2] ?? 0, v[3] ?? 1, (v[4] ?? 0) * k, (v[5] ?? 0) * k);
      lay.drawImage(clip, -n / 2, -n / 2, n, n);
      // The same soft oval as the page (only the patient comes from the clip).
      if (!clip.classList.contains('whole')) {
        lay.globalCompositeOperation = 'destination-in';
        lay.fillStyle = this.mask(lay);
        lay.fillRect(-n / 2, -n / 2, n, n);
      }
      ctx.globalAlpha = opacity;
      ctx.drawImage(this.layer, 0, 0);
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, n - 22, 70, 22);
    ctx.fillStyle = '#fff';
    ctx.font = '14px monospace';
    ctx.fillText(`${this.now().toFixed(2)}s`, 6, n - 6);
  }

  /** CLIP_MASK: an oval 40% × 62% of the picture around (50%, 60%), solid to 60%, then fading out. */
  private mask(ctx: CanvasRenderingContext2D) {
    const n = this.size;
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, '#000');
    g.addColorStop(0.6, '#000');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    // An oval: draw a unit circle stretched to the oval's size, about its centre.
    ctx.translate(0, 0.1 * n);
    ctx.scale(0.4 * n, 0.62 * n);
    return g;
  }

  stop(): Promise<Blob | null> {
    cancelAnimationFrame(this.raf);
    const rec = this.rec;
    const done = () => {
      void this.audioCtx?.close().catch(() => undefined);
      return this.chunks.length
        ? new Blob(this.chunks, { type: this.mimeType.split(';')[0] || 'video/webm' })
        : null;
    };
    if (!rec || rec.state === 'inactive') return Promise.resolve(done());
    return new Promise((resolve) => {
      rec.onstop = () => resolve(done());
      rec.stop();
    });
  }
}
