/**
 * Measures what the resident actually sees and hears from the video avatar,
 * so "it feels laggy" becomes numbers that can be compared before and after
 * a change, and sent to Simli:
 *
 * - Lip-sync delay: from the app sending the patient's first words to Simli
 *   until sound comes back from Simli's player (per line; median and worst).
 * - Audio smoothness: the WebRTC stream's concealment events (moments the
 *   phone papered over missing audio: the stutters), jitter and packet loss.
 * - Video smoothness: the stream's freezes, plus frames per second and
 *   gaps over 100 ms between frames shown on screen.
 */

export interface AvatarQualitySummary {
  /** Seconds the face was measured for. */
  seconds: number;
  /** Lip-sync delay, ms: median and worst over the lines measured. */
  delayMedianMs: number | null;
  delayMaxMs: number | null;
  delayCount: number;
  /** Audio stutters (WebRTC concealment events) and what they covered. */
  audioStutters: number;
  audioConcealedPct: number | null;
  audioJitterMs: number | null;
  packetsLost: number;
  /** Video freezes reported by WebRTC, and their total length. */
  videoFreezes: number;
  videoFreezeMs: number;
  /** Frames shown per second on screen, and gaps over 100 ms between them. */
  fps: number | null;
  videoStalls: number;
  videoStallMs: number;
}

/** A gap between shown frames longer than this is a stall. */
export const STALL_MS = 100;
/** Simli's output counts as sound above this (analyser byte units, 128 = silence). */
const SOUND_PEAK = 6;
/** A delay measurement is given up after this long without sound. */
const DELAY_TIMEOUT_MS = 6000;

interface AudioCounters {
  concealmentEvents: number;
  concealedSamples: number;
  totalSamples: number;
  jitterMs: number[];
  packetsLost: number;
}
interface VideoCounters {
  freezeCount: number;
  totalFreezesDuration: number;
}

type VideoFrameCb = (now: number, meta: { presentedFrames: number }) => void;
type VideoWithFrames = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: VideoFrameCb) => number;
  cancelVideoFrameCallback?: (h: number) => void;
};

/** Every RTCPeerConnection made while the face runs (Simli's, and any other). */
const connections = new Set<RTCPeerConnection>();
/** Tests: a stand-in connection whose getStats() the meter reads. */
export const watchConnection = (pc: RTCPeerConnection) => connections.add(pc);
let patched = false;
function watchConnections() {
  if (patched || typeof RTCPeerConnection === 'undefined') return;
  patched = true;
  const Orig = RTCPeerConnection;
  const Watched = function (this: RTCPeerConnection, ...args: ConstructorParameters<typeof Orig>) {
    const pc = new Orig(...args);
    connections.add(pc);
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'closed') connections.delete(pc);
    });
    return pc;
  } as unknown as typeof RTCPeerConnection;
  Watched.prototype = Orig.prototype;
  Object.setPrototypeOf(Watched, Orig);
  (globalThis as { RTCPeerConnection: typeof RTCPeerConnection }).RTCPeerConnection = Watched;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

export class AvatarQuality {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private levels = new Uint8Array(256);
  private video: VideoWithFrames | null = null;
  private audio: HTMLAudioElement | null = null;
  private frameHandle: number | null = null;
  private timer: number | null = null;
  private startedAt: number | null = null;
  private stopped = false;

  private delays: number[] = [];
  /** performance.now() when the patient's first words of a line went out; null between lines. */
  private sentAt: number | null = null;
  private simliSounding = false;

  private frames = 0;
  private lastFrameAt: number | null = null;
  private stalls = 0;
  private stallMs = 0;

  /** Latest WebRTC counters (cumulative), by stream. */
  private audioStats: AudioCounters = { concealmentEvents: 0, concealedSamples: 0, totalSamples: 0, jitterMs: [], packetsLost: 0 };
  private videoStats: VideoCounters = { freezeCount: 0, totalFreezesDuration: 0 };
  private statsBase: { audio: AudioCounters; video: VideoCounters } | null = null;

  private statsTimer: number | null = null;

  constructor(
    private now: () => number = () => performance.now(),
    /** Tests: stands in for the analyser ("is Simli's player sounding right now?"). */
    private probe: (() => boolean) | null = null,
  ) {
    watchConnections();
  }

  /** Measures this video and audio element (called again after a face swap). */
  attach(video: HTMLVideoElement, audio: HTMLAudioElement) {
    if (this.stopped) return;
    this.detachMedia();
    this.video = video as VideoWithFrames;
    this.audio = audio;
    this.startedAt ??= this.now();
    this.listen();
    this.watchFrames();
    if (this.timer === null) this.timer = window.setInterval(() => this.tick(), 50);
    if (this.statsTimer === null)
      this.statsTimer = window.setInterval(() => void this.readStats(), 5000);
  }

  /** The patient's first words of a line just went to Simli. */
  speechStarted() {
    if (this.stopped || this.sentAt !== null) return;
    this.sentAt = this.now();
  }

  /** Reads one audio snapshot from Simli's player (via the stream it plays). */
  private listen() {
    const stream = this.audio?.srcObject as MediaStream | null | undefined;
    if (!stream || typeof stream.getAudioTracks !== 'function' || !stream.getAudioTracks().length)
      return;
    try {
      this.ctx ??= new AudioContext();
      this.source?.disconnect();
      this.source = this.ctx.createMediaStreamSource(stream);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.source.connect(this.analyser);
    } catch {
      this.analyser = null;
    }
  }

  private watchFrames() {
    const v = this.video;
    if (!v?.requestVideoFrameCallback) return;
    const onFrame: VideoFrameCb = (now) => {
      if (this.stopped || this.video !== v) return;
      this.frames++;
      if (this.lastFrameAt !== null) {
        const gap = now - this.lastFrameAt;
        if (gap > STALL_MS) {
          this.stalls++;
          this.stallMs += gap - STALL_MS;
        }
      }
      this.lastFrameAt = now;
      this.frameHandle = v.requestVideoFrameCallback!(onFrame);
    };
    this.frameHandle = v.requestVideoFrameCallback(onFrame);
  }

  private tick() {
    if (this.stopped) return;
    // Simli's player: is sound coming out right now?
    if (!this.analyser && this.audio?.srcObject) this.listen();
    let sounding = false;
    if (this.probe) sounding = this.probe();
    else if (this.analyser) {
      this.analyser.getByteTimeDomainData(this.levels);
      let peak = 0;
      for (const v of this.levels) peak = Math.max(peak, Math.abs(v - 128));
      sounding = peak > SOUND_PEAK;
    }
    if (this.sentAt !== null) {
      const waited = this.now() - this.sentAt;
      if (sounding && !this.simliSounding) {
        this.delays.push(waited);
        this.sentAt = null;
      } else if (waited > DELAY_TIMEOUT_MS) this.sentAt = null;
    }
    this.simliSounding = sounding;
  }

  /** Pulls the WebRTC counters for the streams the face plays. */
  async readStats() {
    const audioId = (this.audio?.srcObject as MediaStream | null)?.getAudioTracks()[0]?.id;
    const videoId = (this.video?.srcObject as MediaStream | null)?.getVideoTracks()[0]?.id;
    for (const pc of connections) {
      let report: RTCStatsReport;
      try {
        report = await pc.getStats();
      } catch {
        continue;
      }
      report.forEach((s: RTCStats & Record<string, unknown>) => {
        if (s.type !== 'inbound-rtp') return;
        const kind = s.kind as string;
        const track = s.trackIdentifier as string | undefined;
        if (kind === 'audio' && track === audioId) {
          const a = this.audioStats;
          a.concealmentEvents = Number(s.concealmentEvents ?? 0);
          a.concealedSamples = Number(s.concealedSamples ?? 0);
          a.totalSamples = Number(s.totalSamplesReceived ?? 0);
          a.packetsLost = Number(s.packetsLost ?? 0);
          if (typeof s.jitter === 'number') a.jitterMs.push(s.jitter * 1000);
        } else if (kind === 'video' && track === videoId) {
          this.videoStats.freezeCount = Number(s.freezeCount ?? 0);
          this.videoStats.totalFreezesDuration = Number(s.totalFreezesDuration ?? 0);
        }
      });
    }
    // Counters are cumulative per connection: measure from the first reading.
    this.statsBase ??= {
      audio: { ...this.audioStats, jitterMs: [] },
      video: { ...this.videoStats },
    };
  }

  summary(): AvatarQualitySummary {
    const seconds = this.startedAt === null ? 0 : Math.round((this.now() - this.startedAt) / 1000);
    const base = this.statsBase ?? { audio: { ...this.audioStats, jitterMs: [] }, video: { ...this.videoStats } };
    const a = this.audioStats;
    const totalSamples = a.totalSamples - base.audio.totalSamples;
    const concealed = a.concealedSamples - base.audio.concealedSamples;
    const jitter = a.jitterMs.length ? a.jitterMs.reduce((x, y) => x + y, 0) / a.jitterMs.length : null;
    return {
      seconds,
      delayMedianMs: median(this.delays) === null ? null : Math.round(median(this.delays)!),
      delayMaxMs: this.delays.length ? Math.round(Math.max(...this.delays)) : null,
      delayCount: this.delays.length,
      audioStutters: a.concealmentEvents - base.audio.concealmentEvents,
      audioConcealedPct: totalSamples > 0 ? Math.round((concealed / totalSamples) * 1000) / 10 : null,
      audioJitterMs: jitter === null ? null : Math.round(jitter),
      packetsLost: a.packetsLost - base.audio.packetsLost,
      videoFreezes: this.videoStats.freezeCount - base.video.freezeCount,
      videoFreezeMs: Math.round((this.videoStats.totalFreezesDuration - base.video.totalFreezesDuration) * 1000),
      fps: seconds > 0 ? Math.round((this.frames / seconds) * 10) / 10 : null,
      videoStalls: this.stalls,
      videoStallMs: Math.round(this.stallMs),
    };
  }

  private detachMedia() {
    if (this.frameHandle !== null && this.video?.cancelVideoFrameCallback)
      this.video.cancelVideoFrameCallback(this.frameHandle);
    this.frameHandle = null;
    this.lastFrameAt = null;
    this.source?.disconnect();
    this.source = null;
    this.analyser = null;
  }

  stop() {
    this.stopped = true;
    this.detachMedia();
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    if (this.statsTimer !== null) window.clearInterval(this.statsTimer);
    this.statsTimer = null;
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }
}

/** One line for people: "Lip-sync delay 0.9 s median, 1.4 s worst. Audio: 6 stutters…" */
export function describeQuality(q: AvatarQualitySummary): string {
  const s = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
  const delay =
    q.delayMedianMs === null
      ? 'Lip-sync delay: not measured'
      : `Lip-sync delay ${s(q.delayMedianMs)} median, ${s(q.delayMaxMs ?? q.delayMedianMs)} worst (${q.delayCount} ${q.delayCount === 1 ? 'line' : 'lines'})`;
  const audio = `Audio: ${q.audioStutters} ${q.audioStutters === 1 ? 'stutter' : 'stutters'}${
    q.audioJitterMs !== null ? `, jitter ${q.audioJitterMs} ms` : ''
  }${q.packetsLost ? `, ${q.packetsLost} packets lost` : ''}`;
  const video = `Video: ${q.videoFreezes} ${q.videoFreezes === 1 ? 'freeze' : 'freezes'} (${s(q.videoFreezeMs)})${
    q.fps !== null ? `, ${q.fps} fps` : ''
  }${q.videoStalls ? `, ${q.videoStalls} gaps (${s(q.videoStallMs)})` : ''}`;
  const mins = q.seconds >= 60 ? `${Math.round(q.seconds / 60)} min` : `${q.seconds} s`;
  return `${delay}. ${audio}. ${video}. Over ${mins}.`;
}
