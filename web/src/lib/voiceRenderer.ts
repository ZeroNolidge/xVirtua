import type { PatientRenderer, PatientUtterance, RendererCapabilities } from '@plainspeak/shared';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// A tiny silent MP3, played on the first tap to unlock audio on iOS.
const SILENCE =
  'data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQxAADB8AhSmxhIIEVCSiJrDCQBTcu3UrAIwUdkRgQbFAZC1CQEwTJ9mjRvBA4UOLD8nKVOWfh+UlK3z/177OXrfOdKl7pyn3Xf//WreyTRUoAWgBgkOAGbZHBgG1OF6zM82DWbZaUmMBptgQhGjsyYqc9ae9XFz280948NMBWInljyzsNRFLPWdnZGWrddDsjK1unuSrVN9jJsK8KuQtQCtMBjCEtImISdNKJOopIpBFpNSMbIHCSRpRR5iakjTiyzLhchUUBwCgyKiweBv/7UsQbg8isVNoMPMjAAAA0gAAABEVFGmgqK////9bP/6XCykxBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq';

/**
 * v1 patient renderer: voice plus an illustrated portrait. Nonverbal cues are
 * shown as captions (e.g. "(looks away)") because there is no video yet.
 */
export class VoiceRenderer implements PatientRenderer {
  private audio = new Audio();
  private stopped = false;
  private currentUrl: string | null = null;

  constructor(private readonly onCaption: (u: PatientUtterance | null, speaking: boolean) => void) {
    this.audio.preload = 'auto';
  }

  async mount(): Promise<void> {
    // Must be called from a user tap (iOS audio unlock).
    this.audio.src = SILENCE;
    await this.audio.play().catch(() => undefined);
  }

  async speak(u: PatientUtterance, stream: ReadableStream<Uint8Array> | null): Promise<void> {
    if (this.stopped) return;
    const blobPromise = stream ? new Response(stream).blob() : null;
    if (u.delivery.pauseBeforeMs > 0) await sleep(u.delivery.pauseBeforeMs);
    this.onCaption(u, true);
    const blob = await blobPromise?.catch(() => null);
    if (blob && blob.size > 0 && !this.stopped) {
      if (this.currentUrl) URL.revokeObjectURL(this.currentUrl);
      this.currentUrl = URL.createObjectURL(blob);
      this.audio.src = this.currentUrl;
      try {
        await this.audio.play();
        await new Promise<void>((resolve) => {
          this.audio.onended = () => resolve();
          this.audio.onerror = () => resolve();
          this.audio.onpause = () => resolve();
        });
      } catch {
        await sleep(readingTimeMs(u.text));
      }
    } else {
      // No voice available: give time to read the caption.
      await sleep(readingTimeMs(u.text));
    }
    this.onCaption(u, false);
  }

  setListening(): void {}

  interrupt(): void {
    this.audio.pause();
  }

  capabilities(): RendererCapabilities {
    return { video: false, nonverbal: [] };
  }

  dispose(): void {
    this.stopped = true;
    this.audio.pause();
    if (this.currentUrl) URL.revokeObjectURL(this.currentUrl);
  }
}

const readingTimeMs = (text: string) => Math.min(8000, 800 + text.split(/\s+/).length * 300);

export const NONVERBAL_TEXT: Record<string, string> = {
  look_away: 'looks away',
  frown: 'frowns',
  nod: 'nods',
  fidget: 'fidgets',
  avoid_eye_contact: 'avoids eye contact',
  smile: 'smiles',
};
