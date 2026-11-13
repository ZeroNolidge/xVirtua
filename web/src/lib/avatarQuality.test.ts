import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AvatarQuality, describeQuality, STALL_MS, watchConnection } from './avatarQuality';

/** A video element whose frames the test presents by hand. */
function fakeVideo() {
  let cb: ((now: number, meta: { presentedFrames: number }) => void) | null = null;
  const el = {
    srcObject: null,
    requestVideoFrameCallback(f: typeof cb) {
      cb = f;
      return 1;
    },
    cancelVideoFrameCallback() {
      cb = null;
    },
    present(now: number) {
      cb?.(now, { presentedFrames: 0 });
    },
  };
  return el as unknown as HTMLVideoElement & { present(now: number): void };
}

describe('avatar quality', () => {
  let clock = 0;
  let sounding = false;
  beforeEach(() => {
    vi.useFakeTimers();
    clock = 0;
    sounding = false;
  });
  afterEach(() => vi.useRealTimers());

  const meter = () => new AvatarQuality(() => clock, () => sounding);
  const run = (q: AvatarQuality, ms: number) => {
    for (let t = 0; t < ms; t += 50) {
      clock += 50;
      vi.advanceTimersByTime(50);
    }
    void q;
  };

  it('lip-sync delay: from the first words going out until Simli’s player sounds', () => {
    const q = meter();
    q.attach(fakeVideo(), { srcObject: null } as unknown as HTMLAudioElement);
    q.speechStarted();
    run(q, 900);
    sounding = true;
    run(q, 50);
    // Still sounding: not a new line.
    run(q, 500);
    sounding = false;
    run(q, 300);
    q.speechStarted();
    run(q, 1400);
    sounding = true;
    run(q, 50);
    const s = q.summary();
    expect(s.delayCount).toBe(2);
    expect(s.delayMedianMs).toBe(1200); // the middle of 950 and 1450
    expect(s.delayMaxMs).toBe(1450);
    q.stop();
  });

  it('a line that never comes back is given up, not counted', () => {
    const q = meter();
    q.attach(fakeVideo(), { srcObject: null } as unknown as HTMLAudioElement);
    q.speechStarted();
    run(q, 6500);
    sounding = true;
    run(q, 50);
    expect(q.summary().delayCount).toBe(0);
    q.stop();
  });

  it('video: frames per second and gaps over 100 ms', () => {
    const q = meter();
    const v = fakeVideo();
    q.attach(v, { srcObject: null } as unknown as HTMLAudioElement);
    // 10 s of frames at 25 fps, with one 400 ms gap.
    let t = 0;
    for (let i = 0; i < 250; i++) {
      t += i === 100 ? 400 : 40;
      v.present(t);
    }
    clock = 10_000;
    const s = q.summary();
    expect(s.fps).toBe(25);
    expect(s.videoStalls).toBe(1);
    expect(s.videoStallMs).toBe(400 - STALL_MS);
    q.stop();
  });

  it('audio and video smoothness from the WebRTC counters, measured from the first reading', async () => {
    const q = meter();
    const audioTrack = { id: 'a1' };
    const videoTrack = { id: 'v1' };
    const audio = { srcObject: { getAudioTracks: () => [audioTrack] } } as unknown as HTMLAudioElement;
    const video = {
      ...fakeVideo(),
      srcObject: { getVideoTracks: () => [videoTrack] },
    } as unknown as HTMLVideoElement;
    let reading = 0;
    const pc = {
      async getStats() {
        reading++;
        const k = reading;
        const rows = [
          {
            type: 'inbound-rtp',
            kind: 'audio',
            trackIdentifier: 'a1',
            concealmentEvents: 2 + 3 * k,
            concealedSamples: 1000 * k,
            totalSamplesReceived: 100_000 * k,
            packetsLost: k,
            jitter: 0.02,
          },
          {
            type: 'inbound-rtp',
            kind: 'video',
            trackIdentifier: 'v1',
            freezeCount: 1 + k,
            totalFreezesDuration: 0.5 * k,
          },
          { type: 'inbound-rtp', kind: 'audio', trackIdentifier: 'other', concealmentEvents: 999 },
        ];
        return { forEach: (f: (r: unknown) => void) => rows.forEach(f) };
      },
    } as unknown as RTCPeerConnection;
    watchConnection(pc);
    q.attach(video, audio);
    await q.readStats(); // first reading: the base
    await q.readStats();
    await q.readStats();
    const s = q.summary();
    expect(s.audioStutters).toBe(6); // 11 - 5
    expect(s.audioConcealedPct).toBe(1); // 2000 of 200000
    expect(s.audioJitterMs).toBe(20);
    expect(s.packetsLost).toBe(2);
    expect(s.videoFreezes).toBe(2);
    expect(s.videoFreezeMs).toBe(1000);
    q.stop();
  });

  it('reads as one sentence', () => {
    expect(
      describeQuality({
        seconds: 185,
        delayMedianMs: 920,
        delayMaxMs: 1410,
        delayCount: 7,
        audioStutters: 6,
        audioConcealedPct: 0.4,
        audioJitterMs: 18,
        packetsLost: 0,
        videoFreezes: 2,
        videoFreezeMs: 800,
        fps: 24.6,
        videoStalls: 3,
        videoStallMs: 650,
      }),
    ).toBe(
      'Lip-sync delay 0.9 s median, 1.4 s worst (7 lines). Audio: 6 stutters, jitter 18 ms. Video: 2 freezes (0.8 s), 24.6 fps, 3 gaps (0.7 s). Over 3 min.',
    );
  });

  it('a face swap brings new streams whose counters restart: the totals add up, never go negative', async () => {
    const q = meter();
    const mk = (a: string, v: string, k: number) => ({
      audio: { srcObject: { getAudioTracks: () => [{ id: a }] } } as unknown as HTMLAudioElement,
      video: { ...fakeVideo(), srcObject: { getVideoTracks: () => [{ id: v }] } } as unknown as HTMLVideoElement,
      pc: {
        async getStats() {
          const rows = [
            { type: 'inbound-rtp', kind: 'audio', trackIdentifier: a, concealmentEvents: 10 * k, concealedSamples: 0, totalSamplesReceived: 1000, packetsLost: 5 * k, jitter: 0.01 },
            { type: 'inbound-rtp', kind: 'video', trackIdentifier: v, freezeCount: 4 * k, totalFreezesDuration: 1 * k },
          ];
          return { forEach: (f: (r: unknown) => void) => rows.forEach(f) };
        },
      } as unknown as RTCPeerConnection,
    });
    // First face: counters at 10 / 5 / 4 on the base reading, then unchanged.
    const first = mk('a3', 'v3', 1);
    watchConnection(first.pc);
    q.attach(first.video, first.audio);
    await q.readStats();
    await q.readStats();
    // Swap to the next face: a new stream starting from smaller counters.
    const second = mk('a4', 'v4', 1);
    let reads = 0;
    second.pc.getStats = async () => {
      reads++;
      const k = reads; // 1 on the base reading, then 2: one more of everything
      const rows = [
        { type: 'inbound-rtp', kind: 'audio', trackIdentifier: 'a4', concealmentEvents: k, concealedSamples: 0, totalSamplesReceived: 1000, packetsLost: k, jitter: 0.01 },
        { type: 'inbound-rtp', kind: 'video', trackIdentifier: 'v4', freezeCount: k, totalFreezesDuration: 0.25 * k },
      ];
      return { forEach: (f: (r: unknown) => void) => rows.forEach(f) } as unknown as RTCStatsReport;
    };
    watchConnection(second.pc);
    q.attach(second.video, second.audio);
    await q.readStats();
    await q.readStats();
    const s = q.summary();
    expect(s.audioStutters).toBe(1);
    expect(s.packetsLost).toBe(1);
    expect(s.videoFreezes).toBe(1);
    expect(s.videoFreezeMs).toBe(250);
    q.stop();
  });
});
