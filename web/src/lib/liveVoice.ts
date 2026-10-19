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
  /** Words GPT-Live actually said as the patient (pieces, in order). */
  onSpoken(delta: string): void;
  onError(message: string): void;
  onClosed(): void;
}

/** Exchanges the browser's offer for OpenAI's answer, through our server. */
export type Connect = (offerSdp: string) => Promise<string>;

interface LiveEvent {
  type?: string;
  delta?: string;
  delegation?: { id?: string };
  error?: { message?: string };
}

export class LiveVoiceCall {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private track: MediaStreamTrack | null = null;
  private audioEl: HTMLAudioElement;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private levels: Uint8Array<ArrayBuffer> | null = null;
  private seq = 0;
  private closing: (() => void) | null = null;
  /** performance.now() when the patient's voice was last audible. */
  lastSoundAt = 0;

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

  async start(mic: MediaStream, connect: Connect): Promise<void> {
    // A clone, so the recording keeps its own track.
    const track = mic.getAudioTracks()[0]?.clone();
    if (!track) throw new Error('No microphone track');
    this.track = track;
    const pc = new RTCPeerConnection();
    this.pc = pc;
    pc.addTrack(track, new MediaStream([track]));
    pc.ontrack = (e) => {
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      this.audioEl.srcObject = stream;
      void this.audioEl.play().catch(() => undefined);
      this.watchLevel(stream);
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

  /** Measures the patient's voice, to tell when he is audibly talking. */
  private watchLevel(stream: MediaStream) {
    if (!this.ctx || this.analyser) return;
    try {
      const src = this.ctx.createMediaStreamSource(stream);
      const a = this.ctx.createAnalyser();
      a.fftSize = 512;
      src.connect(a);
      this.analyser = a;
      this.levels = new Uint8Array(new ArrayBuffer(a.fftSize));
      const tick = () => {
        if (!this.analyser || !this.levels) return;
        this.analyser.getByteTimeDomainData(this.levels);
        let peak = 0;
        for (const v of this.levels) peak = Math.max(peak, Math.abs(v - 128));
        if (peak > 6) this.lastSoundAt = performance.now();
        window.setTimeout(tick, 50);
      };
      tick();
    } catch {
      this.analyser = null;
    }
  }

  /** True while the patient's voice is coming through (or was, very recently). */
  patientAudible(windowMs = 300): boolean {
    return performance.now() - this.lastSoundAt < windowMs;
  }

  /** Silences the patient on our side (GPT-Live may keep talking after an interruption). */
  mutePatient(muted: boolean) {
    this.audioEl.muted = muted;
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
        if (ev.delta) this.cb.onSpoken(ev.delta);
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
    this.analyser = null;
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

