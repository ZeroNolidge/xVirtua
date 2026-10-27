/** Records the resident's mic for the whole session (webm on Android/desktop, mp4 on iOS). */
export class SessionRecorder {
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  readonly mimeType: string;
  readonly ext: 'webm' | 'm4a' | 'ogg';

  constructor(private readonly stream: MediaStream) {
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

  start() {
    if (typeof MediaRecorder === 'undefined') return;
    this.rec = new MediaRecorder(
      this.stream,
      this.mimeType ? { mimeType: this.mimeType } : undefined,
    );
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.rec.start(1000);
  }

  stop(): Promise<Blob | null> {
    const rec = this.rec;
    if (!rec || rec.state === 'inactive') return Promise.resolve(this.blob());
    return new Promise((resolve) => {
      rec.onstop = () => resolve(this.blob());
      rec.stop();
    });
  }

  private blob(): Blob | null {
    if (!this.chunks.length) return null;
    return new Blob(this.chunks, { type: this.mimeType.split(';')[0] || 'audio/webm' });
  }
}
