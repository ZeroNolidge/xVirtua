/**
 * Streaming speech-to-text via OpenAI Realtime (transcription-only session).
 * The browser connects over WebRTC with a short-lived key from our server.
 */
export interface SttCallbacks {
  onSpeechStart(): void;
  onPartial(text: string): void;
  onFinal(text: string): void;
  onError(message: string): void;
}

export class OpenAIRealtimeStt {
  private pc: RTCPeerConnection | null = null;
  private track: MediaStreamTrack | null = null;
  private partials = new Map<string, string>();
  private muted = false;

  constructor(private readonly cb: SttCallbacks) {}

  async start(mic: MediaStream, clientSecret: string): Promise<void> {
    // A clone of the mic, so muting transcription never mutes the recording.
    const track = mic.getAudioTracks()[0]?.clone();
    if (!track) throw new Error('No microphone track');
    this.track = track;
    const pc = new RTCPeerConnection();
    this.pc = pc;
    pc.addTrack(track, new MediaStream([track]));
    const dc = pc.createDataChannel('oai-events');
    dc.onmessage = (e) => this.handle(e.data);
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') this.cb.onError('Speech connection lost.');
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const res = await fetch('https://api.openai.com/v1/realtime/calls', {
      method: 'POST',
      body: offer.sdp,
      headers: { Authorization: `Bearer ${clientSecret}`, 'Content-Type': 'application/sdp' },
    });
    if (!res.ok) throw new Error(`Speech service ${res.status}`);
    await pc.setRemoteDescription({ type: 'answer', sdp: await res.text() });
  }

  /** Mute while the patient talks so their voice isn't transcribed. */
  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.track) this.track.enabled = !muted;
    if (muted) this.partials.clear();
  }

  private handle(raw: string) {
    let ev: { type?: string; item_id?: string; delta?: string; transcript?: string; error?: { message?: string } };
    try {
      ev = JSON.parse(raw);
    } catch {
      return;
    }
    const type = ev.type ?? '';
    if (type === 'error') return this.cb.onError(ev.error?.message ?? 'Speech error');
    if (this.muted) return;
    if (type.endsWith('speech_started')) return this.cb.onSpeechStart();
    if (type.endsWith('input_audio_transcription.delta') && ev.delta) {
      const id = ev.item_id ?? 'x';
      const text = (this.partials.get(id) ?? '') + ev.delta;
      this.partials.set(id, text);
      return this.cb.onPartial(text);
    }
    if (type.endsWith('input_audio_transcription.completed')) {
      this.partials.delete(ev.item_id ?? 'x');
      const text = (ev.transcript ?? '').trim();
      if (text) this.cb.onFinal(text);
    }
  }

  stop() {
    this.track?.stop();
    this.pc?.close();
    this.pc = null;
  }
}
