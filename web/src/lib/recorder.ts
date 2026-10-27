/**
 * Records the resident's mic for the whole session (webm on Android/desktop,
 * mp4 on iOS). It records through an audio mixer, so the conversation can
 * pause (mic fully off) and continue with a new mic, all in one file.
 */
export class SessionRecorder {
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private ctx: AudioContext | null = null;
  private dest: MediaStreamAudioDestinationNode | null = null;
  private src: MediaStreamAudioSourceNode | null = null;
  readonly mimeType: string;
  readonly ext: 'webm' | 'm4a' | 'ogg';

  constructor(private stream: MediaStream) {
    const options = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    const supported =
      typeof MediaRecorder !== 'undefined'
        ? options.find((t) => MediaRecorder.isTypeSupported(t))
        : undefined;
    this.mimeType = supported ?? '';
    this.ext = this.mimeType.includes('mp4')
      ? 'm4a'
      : this.mimeType.includes('ogg')
        ? 'ogg'
        : 'webm';
  }

  async start() {
    if (typeof MediaRecorder === 'undefined') return;
    let source: MediaStream = this.stream;
    try {
      const ctx = new AudioContext();
      await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 500))]);
      // A stopped mixer would record silence: then record the mic directly.
      if (ctx.state === 'running') {
        this.ctx = ctx;
        this.dest = ctx.createMediaStreamDestination();
        this.connect(this.stream);
        source = this.dest.stream;
      } else void ctx.close().catch(() => undefined);
    } catch {
      this.ctx = null;
    }
    this.rec = new MediaRecorder(source, this.mimeType ? { mimeType: this.mimeType } : undefined);
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.rec.start(1000);
  }

  private connect(stream: MediaStream | null) {
    this.src?.disconnect();
    this.src = null;
    if (!stream || !this.ctx || !this.dest) return;
    this.src = this.ctx.createMediaStreamSource(stream);
    this.src.connect(this.dest);
  }

  /** The mic is about to be turned off. */
  pause() {
    if (this.rec?.state === 'recording') this.rec.pause();
    this.connect(null);
  }

  /** Carry on with a new mic. Without the mixer, only the part before the pause is kept. */
  resume(stream: MediaStream) {
    this.stream = stream;
    if (!this.ctx) return;
    void this.ctx.resume().catch(() => undefined);
    this.connect(stream);
    if (this.rec?.state === 'paused') this.rec.resume();
  }

  stop(): Promise<Blob | null> {
    const rec = this.rec;
    const done = () => {
      this.connect(null);
      void this.ctx?.close().catch(() => undefined);
      return this.blob();
    };
    if (!rec || rec.state === 'inactive') return Promise.resolve(done());
    return new Promise((resolve) => {
      rec.onstop = () => resolve(done());
      rec.stop();
    });
  }

  private blob(): Blob | null {
    if (!this.chunks.length) return null;
    return new Blob(this.chunks, { type: this.mimeType.split(';')[0] || 'audio/webm' });
  }
}
