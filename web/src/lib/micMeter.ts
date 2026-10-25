/**
 * Measures how loud the resident's mic is, every 50 ms. Echo cancellation
 * keeps the patient's voice from the speaker mostly out of it, so a loud mic
 * while the patient talks is a good sign the resident is speaking.
 */
export class MicMeter {
  private ctx: AudioContext | null = null;
  private stopped = false;
  /** performance.now() when the mic was last loud. */
  lastLoudAt = 0;

  constructor(stream: MediaStream, threshold = 18) {
    try {
      this.ctx = new AudioContext();
      void this.ctx.resume();
      const src = this.ctx.createMediaStreamSource(stream);
      const a = this.ctx.createAnalyser();
      a.fftSize = 512;
      src.connect(a);
      const levels = new Uint8Array(new ArrayBuffer(a.fftSize));
      const tick = () => {
        if (this.stopped) return;
        a.getByteTimeDomainData(levels);
        let peak = 0;
        for (const v of levels) peak = Math.max(peak, Math.abs(v - 128));
        if (peak > threshold) this.lastLoudAt = performance.now();
        window.setTimeout(tick, 50);
      };
      tick();
    } catch {
      this.ctx = null;
    }
  }

  /** False when the meter couldn't start (then callers fall back to the transcript alone). */
  get working() {
    return this.ctx !== null;
  }

  loudWithin(ms: number) {
    return performance.now() - this.lastLoudAt < ms;
  }

  stop() {
    this.stopped = true;
    void this.ctx?.close().catch(() => undefined);
  }
}
