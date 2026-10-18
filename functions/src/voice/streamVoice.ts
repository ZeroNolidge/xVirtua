import type { Delivery, PatientChunk } from '@plainspeak/shared';

/** Text to speech, as used while a reply streams. */
export interface VoiceService {
  /** A stable voice for this patient. */
  voiceId(pronouns: string, scenarioId: string): Promise<string>;
  synthesize(voiceId: string, text: string, d: Delivery): Promise<ArrayBuffer>;
}

/**
 * Voices sentences as they arrive: synthesis starts right away for each one
 * (in parallel), and chunks go to the app strictly in order.
 */
export class SentenceVoicer {
  private chain: Promise<void> = Promise.resolve();
  private seq = 0;
  voiced = 0;
  failed = false;
  /** When the first audio chunk was sent (Date.now()). */
  firstAudioAt: number | null = null;

  constructor(
    private readonly send: (chunk: PatientChunk) => Promise<unknown>,
    private readonly speak: ((text: string) => Promise<ArrayBuffer>) | null,
  ) {}

  add(text: string) {
    const seq = this.seq++;
    const audio =
      this.speak && !this.failed ? this.speak(text).catch((e: unknown) => e as Error) : null;
    this.chain = this.chain.then(async () => {
      await this.send({ t: 'say', seq, text });
      if (!audio) return;
      const a = await audio;
      if (a instanceof Error) {
        if (!this.failed) console.warn('voice failed', a.message);
        this.failed = true;
        return;
      }
      this.voiced++;
      this.firstAudioAt ??= Date.now();
      await this.send({
        t: 'audio',
        seq,
        b64: Buffer.from(a).toString('base64'),
        mime: 'audio/mpeg',
      });
    });
  }

  get sentences() {
    return this.seq;
  }

  /** Resolves once every chunk has been sent. */
  flush(): Promise<void> {
    return this.chain;
  }
}
