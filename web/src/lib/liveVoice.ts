import type { Delivery } from '@plainspeak/shared';

/**
 * GPT-Live test mode (see functions/src/voice/live.ts). One WebRTC call to
 * OpenAI carries both voices: GPT-Live listens and talks at once, and asks us
 * (a "delegation") whenever the patient should answer. We get the reply from
 * Claude through patientTurn and hand it back as commentary for GPT-Live to say.
 */
export interface LiveCallbacks {
  onStarted(): void;
  /** GPT-Live wants the patient's next line. */
  onDelegation(id: string): void;
  /** Words GPT-Live heard from the resident (pieces, in order). */
  onHeard(delta: string): void;
  /** Words GPT-Live actually said as the patient (pieces, in order), with their start time. */
  onSpoken(delta: string, startMs?: number): void;
  onError(message: string): void;
  onClosed(): void;
  /** Every event GPT-Live sends (for diagnostics). */
  onEvent?(type: string, ev: Record<string, unknown>): void;
}

/** Exchanges the browser's offer for OpenAI's answer, through our server. */
export type Connect = (offerSdp: string) => Promise<string>;

interface LiveEvent {
  type?: string;
  delta?: string;
  start_ms?: number;
  delegation?: { id?: string };
  error?: { message?: string };
}

/** GPT-Live's "the listener cut in here" event, once confirmed in its docs. */
export const TRUNCATE_EVENT: string | null = null;

export class LiveVoiceCall {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private track: MediaStreamTrack | null = null;
  private audioEl: HTMLAudioElement;
  private ctx: AudioContext | null = null;
  private stopped = false;
  private seq = 0;
  private closing: (() => void) | null = null;
  /** performance.now() when the patient's voice was last audible. */
  lastSoundAt = 0;
  /** performance.now() when the resident's mic got loud and stayed loud; null when quiet. */
  private micLoudSince: number | null = null;
  private micQuietAt = 0;
  /** performance.now() when the resident's mic was last loud. */
  lastMicLoudAt = 0;

  constructor(private readonly cb: LiveCallbacks) {
    this.audioEl = new Audio();
    this.audioEl.autoplay = true;
  }

  /** Call inside the tap that starts the conversation (unlocks audio on iOS). */
  unlockAudio() {
    void this.audioEl.play().catch(() => undefined);
    try {
      this.ctx = new AudioContext();
      void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  /** `mic` null: listen only (e.g. a voice preview); the mic is never opened. */
  async start(mic: MediaStream | null, connect: Connect): Promise<void> {
    const pc = new RTCPeerConnection();
    this.pc = pc;
    if (!mic) {
      pc.addTransceiver('audio', { direction: 'recvonly' });
    } else {
      // A clone, so the recording keeps its own track.
      const track = mic.getAudioTracks()[0]?.clone();
      if (!track) throw new Error('No microphone track');
      this.track = track;
      pc.addTrack(track, new MediaStream([track]));
    }
    // The mic's own level tells us the resident started talking right away,
    // well before GPT-Live's transcript of it arrives. Echo cancellation keeps
    // the patient's voice out of it.
    if (this.track) this.watchLevel(new MediaStream([this.track]), 18, (loud) => {
      const now = performance.now();
      if (loud) {
        this.lastMicLoudAt = now;
        this.micLoudSince ??= now;
        this.micQuietAt = 0;
      } else if (this.micLoudSince !== null) {
        // Allow short dips between syllables.
        this.micQuietAt ||= now;
        if (now - this.micQuietAt > 150) this.micLoudSince = null;
      }
    });
    let remoteWatched = false;
    pc.ontrack = (e) => {
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      this.audioEl.srcObject = stream;
      void this.audioEl.play().catch(() => undefined);
      if (remoteWatched) return;
      remoteWatched = true;
      this.watchLevel(stream, 6, (loud) => {
        if (loud) this.lastSoundAt = performance.now();
      });
    };
    this.bindChannel(pc.createDataChannel('oai-events'));
    // In case OpenAI opens its own events channel instead.
    pc.ondatachannel = (e) => this.bindChannel(e.channel);
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') this.cb.onError('Live voice connection lost.');
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const answer = await connect(offer.sdp ?? '');
    await pc.setRemoteDescription({ type: 'answer', sdp: answer });
  }

  private bindChannel(dc: RTCDataChannel) {
    this.dc ??= dc;
    dc.onmessage = (e) => this.handle(String(e.data));
  }

  /** Measures a stream's loudness every 50 ms. */
  private watchLevel(stream: MediaStream, threshold: number, onLevel: (loud: boolean) => void) {
    if (!this.ctx) return;
    try {
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
        onLevel(peak > threshold);
        window.setTimeout(tick, 50);
      };
      tick();
    } catch {
      // No meter: we fall back to the transcript alone.
    }
  }

  /** How long the resident has been audibly talking without a break (0 if not). */
  micLoudFor(): number {
    return this.micLoudSince === null ? 0 : performance.now() - this.micLoudSince;
  }

  /** True while the patient's voice is coming through (or was, very recently). */
  patientAudible(windowMs = 300): boolean {
    return performance.now() - this.lastSoundAt < windowMs;
  }

  /** Silences the patient on our side (GPT-Live may keep talking after an interruption). */
  mutePatient(muted: boolean) {
    this.audioEl.muted = muted;
    if (!muted) this.audioEl.volume = 1;
  }

  /**
   * Turns the patient almost silent while we check it's really the resident
   * talking. iPhones ignore volume changes, so there it mutes instead.
   */
  duckPatient(on: boolean) {
    if (!on) {
      this.audioEl.volume = 1;
      this.audioEl.muted = false;
      return;
    }
    this.audioEl.volume = 0.08;
    if (this.audioEl.volume > 0.5) this.audioEl.muted = true;
  }

  private send(ev: Record<string, unknown>) {
    if (this.dc?.readyState !== 'open') return false;
    this.dc.send(JSON.stringify({ event_id: `ps_${++this.seq}`, ...ev }));
    return true;
  }

  /** The patient's line, for GPT-Live to say. null: not tied to a request (the opening line). */
  say(delegationId: string | null, content: string) {
    return this.send({ type: 'session.commentary.append', delegation_id: delegationId, content });
  }

  /**
   * Tells GPT-Live the patient was cut off after `audioEndMs` of the reply had
   * played, so it knows the rest wasn't heard. Off until we have GPT-Live's
   * event name for this (TRUNCATE_EVENT); meanwhile the patient is muted on
   * our side and only the heard words are saved.
   */
  truncate(delegationId: string | null, audioEndMs: number) {
    if (!TRUNCATE_EVENT) return false;
    return this.send({ type: TRUNCATE_EVENT, delegation_id: delegationId, audio_end_ms: audioEndMs });
  }

  /** Silent context for GPT-Live (not spoken). */
  note(delegationId: string | null, content: string) {
    return this.send({ type: 'session.thinking.append', delegation_id: delegationId, content });
  }

  private handle(raw: string) {
    let ev: LiveEvent;
    try {
      ev = JSON.parse(raw) as LiveEvent;
    } catch {
      return;
    }
    this.cb.onEvent?.(String(ev.type ?? '?'), ev as Record<string, unknown>);
    switch (ev.type) {
      case 'session.started':
        return this.cb.onStarted();
      case 'session.delegation.created':
        if (ev.delegation?.id) this.cb.onDelegation(ev.delegation.id);
        return;
      case 'session.input_transcript.delta':
        if (ev.delta) this.cb.onHeard(ev.delta);
        return;
      case 'session.output_transcript.delta':
        if (ev.delta)
          this.cb.onSpoken(ev.delta, typeof ev.start_ms === 'number' ? ev.start_ms : undefined);
        return;
      case 'session.closed': {
        const done = this.closing;
        this.closing = null;
        done?.();
        return this.cb.onClosed();
      }
      case 'error':
        return this.cb.onError(ev.error?.message ?? 'Live voice error');
    }
  }

  /** Ends the call politely (so OpenAI stops billing), then hangs up. */
  async close(): Promise<void> {
    if (!this.pc) return;
    if (this.send({ type: 'session.close' })) {
      await new Promise<void>((r) => {
        this.closing = r;
        window.setTimeout(r, 3000);
      });
    }
    this.hangUp();
  }

  hangUp() {
    this.stopped = true;
    this.track?.stop();
    this.pc?.close();
    this.pc = null;
    this.audioEl.srcObject = null;
    void this.ctx?.close().catch(() => undefined);
  }
}

/** "[worried, quiet] " so GPT-Live knows how to say the line. */
export function toneNote(d: Delivery | undefined): string {
  if (!d) return '';
  const parts = [
    d.emotion !== 'neutral' ? d.emotion : '',
    d.volume === 'quiet' ? 'quiet' : '',
    d.rate === 'slow' ? 'slow' : '',
  ].filter(Boolean);
  return parts.length ? `[${parts.join(', ')}] ` : '';
}

