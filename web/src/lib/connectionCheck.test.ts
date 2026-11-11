import { describe, expect, it, vi } from 'vitest';
import {
  checkConnection,
  connectionLine,
  MAX_RTT_MS,
  MIN_DOWN_MBPS,
  PROBE_BYTES,
} from './connectionCheck';

/** A fake network: each round trip takes `rttMs`, the download `downloadMs` more. */
function fakeNet(rttMs: number, downloadMs: number, ok = true) {
  let clock = 0;
  const now = () => clock;
  const doFetch = (async (_url: string, init?: RequestInit) => {
    clock += rttMs;
    if (init?.method !== 'HEAD') clock += downloadMs;
    return {
      ok,
      arrayBuffer: async () => new ArrayBuffer(PROBE_BYTES),
    } as Response;
  }) as typeof fetch;
  return { now, doFetch };
}

describe('connection check', () => {
  it('a fast connection: good', async () => {
    const { now, doFetch } = fakeNet(60, 100); // 256 KB in 160 ms ≈ 13 Mbps
    const r = await checkConnection(doFetch, now);
    expect(r?.verdict).toBe('good');
    expect(r?.rttMs).toBe(60);
    expect(r?.downMbps).toBeGreaterThan(MIN_DOWN_MBPS);
    expect(connectionLine(r)).toBe('Your connection looks good.');
  });

  it('a slow download: slow, with the speed in the sentence', async () => {
    const { now, doFetch } = fakeNet(60, 2500); // 256 KB in 2.56 s ≈ 0.8 Mbps
    const r = await checkConnection(doFetch, now);
    expect(r?.verdict).toBe('slow');
    expect(connectionLine(r)).toMatch(/slow right now \(about 0\.8 Mbps\)\. The patient’s voice and video/);
  });

  it('a long delay: slow, even when the download is quick', async () => {
    const { now, doFetch } = fakeNet(MAX_RTT_MS + 200, 50);
    const r = await checkConnection(doFetch, now);
    expect(r?.verdict).toBe('slow');
    expect(r?.reasons).toEqual([`a ${MAX_RTT_MS + 200} ms delay`]);
  });

  it('can’t tell (offline or blocked): says nothing', async () => {
    const { now, doFetch } = fakeNet(10, 10, false);
    expect(await checkConnection(doFetch, now)).toBeNull();
    const failing = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await checkConnection(failing, now)).toBeNull();
    expect(connectionLine(null)).toBeNull();
  });

  it('gives up if the check itself takes too long', async () => {
    vi.useFakeTimers();
    try {
      const never = (() => new Promise<Response>(() => {})) as typeof fetch;
      const p = checkConnection(never, () => 0, 1000);
      await vi.advanceTimersByTimeAsync(1001);
      expect(await p).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('names the patient, and in typed mode talks about slow replies, not voice and video', async () => {
    const { now, doFetch } = fakeNet(60, 2500);
    const r = await checkConnection(doFetch, now);
    expect(connectionLine(r, { first: 'Linda' })).toMatch(/Linda’s voice and video may stutter/);
    expect(connectionLine(r, { first: 'Linda', typed: true })).toMatch(/Replies may be slow\./);
    expect(connectionLine(r, { first: 'Linda', typed: true })).not.toMatch(/voice|video/);
  });
});
