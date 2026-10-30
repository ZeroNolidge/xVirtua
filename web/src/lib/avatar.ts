import type { SimliClient } from 'simli-client';

/** Mints a Simli session for this conversation (server; the key never reaches the browser). */
export type GetAvatarToken = () => Promise<string>;

/**
 * Test: the patient as a lip-synced video face (Simli). Only the patient's
 * voice is sent to Simli, never the resident's mic. Simli plays the voice
 * back in step with the face, so our own player is silenced while it runs.
 * If anything fails, the patient's voice simply plays as before.
 *
 * Create it inside the tap that starts the conversation (iOS audio unlock).
 * It survives pauses: stop() hangs up Simli, connect() starts a new session.
 */
export class PatientAvatar {
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private client: SimliClient | null = null;
  private elementSource: MediaElementAudioSourceNode | null = null;
  private trackSource: MediaStreamAudioSourceNode | null = null;
  private feedingTrack: MediaStreamTrack | null = null;
  private disposed = false;
  /** Simli is showing the face and playing the voice. */
  ready = false;
  onChange: ((ready: boolean) => void) | null = null;
  onFail: ((e: unknown) => void) | null = null;

  constructor(
    private video: HTMLVideoElement,
    private audio: HTMLAudioElement,
    /** A second, hidden video and audio element: the next face connects there (no gap). */
    private spare: { video: HTMLVideoElement; audio: HTMLAudioElement } | null = null,
  ) {
    if (spare) spare.video.style.opacity = '0';
    try {
      this.ctx = new AudioContext({ sampleRate: 16000 });
      void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  private setReady(r: boolean) {
    if (this.ready === r) return;
    this.ready = r;
    // Without the face, our own player plays the voice again.
    if (!r && this.elementSource && this.ctx) this.elementSource.connect(this.ctx.destination);
    else if (r && this.elementSource && this.ctx) {
      try {
        this.elementSource.disconnect(this.ctx.destination);
      } catch {
        // Wasn't connected.
      }
    }
    this.onChange?.(r);
  }

  /** Starts a Simli session. Resolves true once the face is on screen. */
  async connect(getToken: GetAvatarToken, timeoutMs = 10_000): Promise<boolean> {
    if (this.disposed || !this.ctx) return false;
    try {
      await this.ctx.resume();
      if (!this.node) {
        await this.ctx.audioWorklet.addModule('/pcm16-worklet.js');
        this.node = new AudioWorkletNode(this.ctx, 'pcm16');
        this.node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
          if (!this.ready) return;
          try {
            this.client?.sendAudioData(new Uint8Array(e.data));
          } catch {
            // Connection closing; the next session takes over.
          }
        };
        // Keeps the worklet running (it outputs nothing audible).
        const sink = this.ctx.createGain();
        sink.gain.value = 0;
        this.node.connect(sink).connect(this.ctx.destination);
      }
      const [{ SimliClient, LogLevel }, token] = await Promise.all([
        import('simli-client'),
        getToken(),
      ]);
      if (this.disposed) return false;
      const client = new SimliClient(token, this.video, this.audio, null, LogLevel.ERROR);
      this.client = client;
      this.watch(client);
      await Promise.race([
        client.start(),
        new Promise((_, no) => setTimeout(() => no(new Error('Simli start timed out')), timeoutMs)),
      ]);
      if (this.disposed || this.client !== client) {
        void client.stop().then(
          () => closeInternalAudio(client),
          () => undefined,
        );
        return false;
      }
      this.audio.muted = false;
      this.setReady(true);
      return true;
    } catch (e) {
      this.onFail?.(e);
      const c = this.client;
      void c?.stop().then(
        () => closeInternalAudio(c),
        () => undefined,
      );
      this.client = null;
      this.setReady(false);
      return false;
    }
  }

  /** The face showing now (it changes when switching faces). */
  get activeVideo(): HTMLVideoElement {
    return this.video;
  }

  /** If this session drops, the patient's voice plays from our own player again. */
  private watch(client: SimliClient) {
    const lost = (e: unknown) => {
      // His next face dropped before taking over: there's nothing to swap to.
      if (this.pending === client) this.pending = null;
      if (this.client !== client) return;
      this.setReady(false);
      this.onFail?.(e);
    };
    client.on('error', (d) => lost(new Error(`Simli: ${d}`)));
    client.on('stop', () => lost(new Error('Simli session ended')));
  }

  /** His next face, connected on the spare elements and waiting to take over. */
  private pending: SimliClient | null = null;

  /**
   * Connects his next face (his other mood) in the background, on the spare
   * elements, while this one keeps going. commitFace() then swaps to it.
   * Resolves false if it can't connect (this face stays).
   */
  async prepareFace(getToken: GetAvatarToken, timeoutMs = 10_000): Promise<boolean> {
    const spare = this.spare;
    const current = this.client;
    if (!spare || !current || !this.ready) return false;
    this.dropPending();
    let client: SimliClient | null = null;
    try {
      const [{ SimliClient, LogLevel }, token] = await Promise.all([
        import('simli-client'),
        getToken(),
      ]);
      if (this.disposed || this.client !== current) return false;
      client = new SimliClient(token, spare.video, spare.audio, null, LogLevel.ERROR);
      this.watch(client);
      await Promise.race([
        client.start(),
        new Promise((_, no) => setTimeout(() => no(new Error('Simli start timed out')), timeoutMs)),
      ]);
    } catch (e) {
      this.onFail?.(e);
      hangUp(client);
      return false;
    }
    if (this.disposed || this.client !== current) {
      hangUp(client);
      return false;
    }
    this.pending = client;
    return true;
  }

  /**
   * Swaps to the face prepareFace() connected: it shows and plays the voice,
   * and the old one hangs up. The voice keeps flowing the same way. False if
   * there was nothing ready to swap to.
   */
  commitFace(): boolean {
    const next = this.pending;
    const spare = this.spare;
    const old = this.client;
    if (!next || !spare || !old) return false;
    this.pending = null;
    const muted = this.audio.muted;
    this.spare = { video: this.video, audio: this.audio };
    this.video = spare.video;
    this.audio = spare.audio;
    this.audio.muted = muted;
    this.audio.volume = 1;
    this.client = next;
    this.video.style.opacity = '';
    this.spare.video.style.opacity = '0';
    hangUp(old);
    return true;
  }

  private dropPending() {
    hangUp(this.pending);
    this.pending = null;
  }

  /** prepareFace() then commitFace(). */
  async switchFace(getToken: GetAvatarToken, timeoutMs = 10_000): Promise<boolean> {
    return (await this.prepareFace(getToken, timeoutMs)) && this.commitFace();
  }

  /** Standard voice: send what this player plays (it goes quiet locally while the face runs). */
  feedElement(el: HTMLMediaElement) {
    if (!this.ctx || !this.node || this.elementSource) return;
    try {
      this.elementSource = this.ctx.createMediaElementSource(el);
      this.elementSource.connect(this.node);
      if (!this.ready) this.elementSource.connect(this.ctx.destination);
    } catch (e) {
      this.onFail?.(e);
    }
  }

  /** GPT-Live: send the patient's voice track. */
  feedTrack(track: MediaStreamTrack) {
    if (!this.ctx || !this.node || this.feedingTrack === track) return;
    this.trackSource?.disconnect();
    this.feedingTrack = track;
    this.trackSource = this.ctx.createMediaStreamSource(new MediaStream([track]));
    this.trackSource.connect(this.node);
  }

  /** The resident cut in: drop what Simli still has queued, and silence it. */
  mute(on: boolean) {
    this.audio.muted = on;
    if (on) this.clear();
    // Back to full volume (he may have been turned down just before the cut-in).
    else this.audio.volume = 1;
  }

  /** Almost silent while we check it's really the resident talking. */
  duck(on: boolean) {
    this.audio.volume = on ? 0.08 : 1;
    // iPhones ignore volume: mute there instead.
    if (on && this.audio.volume > 0.5) this.audio.muted = true;
    if (!on) this.audio.muted = false;
  }

  clear() {
    try {
      this.client?.ClearBuffer();
    } catch {
      // Not connected.
    }
  }

  /** Hangs up Simli (pause, end). Our own player plays the voice again. */
  async stop() {
    this.dropPending();
    const c = this.client;
    this.client = null;
    this.setReady(false);
    await c?.stop().catch(() => undefined);
    closeInternalAudio(c);
  }

  /** For diagnostics: what state the audio is in. */
  describe(): string {
    return `face ${this.ready ? 'up' : 'down'}, mixer ${this.ctx?.state ?? 'none'}, voice ${
      this.audio.muted ? 'muted' : 'on'
    }${this.audio.paused ? ' (paused)' : ''}`;
  }

  /** Leaving the screen. */
  async dispose() {
    this.disposed = true;
    await this.stop();
    void this.ctx?.close().catch(() => undefined);
  }
}

/**
 * Simli's client opens its own audio context and never closes it. Phones
 * only allow a few at once, so a leftover one from an earlier conversation
 * can leave the next one silent.
 */
function hangUp(c: SimliClient | null) {
  void c?.stop().then(
    () => closeInternalAudio(c),
    () => undefined,
  );
}

function closeInternalAudio(c: SimliClient | null) {
  const ctx = (c as unknown as { audioContext?: AudioContext } | null)?.audioContext;
  if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => undefined);
}
