import { useEffect, useState } from 'react';

/**
 * A quick look at the connection before a conversation starts: a few small
 * round trips and one short download from our own site, plus what the phone
 * itself reports. It never blocks starting; it only warns when the
 * connection looks too slow for smooth voice and video.
 */
export interface ConnectionReport {
  /** Round trip to our site, ms (median of a few). */
  rttMs: number | null;
  /** Download speed, Mbit/s. */
  downMbps: number | null;
  /** The phone's own estimate ("4g", "3g", …), when it gives one. */
  effectiveType: string | null;
  /** The phone asked for less data (data saver). */
  saveData: boolean;
  verdict: 'good' | 'slow';
  /** Why it's slow, for the sentence shown. */
  reasons: string[];
}

/** The file we time the download of (random bytes, so nothing compresses it). */
export const PROBE_PATH = '/connection-probe.bin';
export const PROBE_BYTES = 262_144;

/** Ray's voice and video want about this much; below it they stutter. */
export const MIN_DOWN_MBPS = 1.5;
/** Round trips above this make the live voice lag and cut in late. */
export const MAX_RTT_MS = 400;

interface NetworkInformationLike {
  effectiveType?: string;
  saveData?: boolean;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? null;
};

/** Runs the check. Resolves null when it can't tell (offline, blocked, too slow to finish). */
export async function checkConnection(
  doFetch: typeof fetch = fetch,
  now: () => number = () => performance.now(),
  timeoutMs = 6000,
): Promise<ConnectionReport | null> {
  const bust = () => `${PROBE_PATH}?t=${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const deadline = new Promise<null>((r) => setTimeout(() => r(null), timeoutMs));
  const run = (async () => {
    const rtts: number[] = [];
    for (let i = 0; i < 3; i++) {
      const t = now();
      const r = await doFetch(bust(), { method: 'HEAD', cache: 'no-store' });
      if (!r.ok) return null;
      rtts.push(now() - t);
    }
    const t = now();
    const r = await doFetch(bust(), { cache: 'no-store' });
    if (!r.ok) return null;
    const bytes = (await r.arrayBuffer()).byteLength;
    const seconds = Math.max(0.001, (now() - t) / 1000);
    return { rttMs: median(rtts), downMbps: (bytes * 8) / seconds / 1e6 };
  })().catch(() => null);
  const measured = await Promise.race([run, deadline]);
  if (!measured) return null;

  const net = (navigator as Navigator & { connection?: NetworkInformationLike }).connection;
  const effectiveType = net?.effectiveType ?? null;
  const saveData = net?.saveData === true;
  const reasons: string[] = [];
  if (measured.downMbps !== null && measured.downMbps < MIN_DOWN_MBPS)
    reasons.push(`about ${measured.downMbps.toFixed(1)} Mbps`);
  if (measured.rttMs !== null && measured.rttMs > MAX_RTT_MS)
    reasons.push(`a ${Math.round(measured.rttMs)} ms delay`);
  if (effectiveType && ['slow-2g', '2g', '3g'].includes(effectiveType))
    reasons.push(`a ${effectiveType.toUpperCase()} signal`);
  return {
    ...measured,
    effectiveType,
    saveData,
    verdict: reasons.length ? 'slow' : 'good',
    reasons,
  };
}

/**
 * What the briefing says about the connection; null while checking or when
 * it can't tell. `typed`: no mic, so no voice or video to stutter.
 */
export function connectionLine(
  r: ConnectionReport | null,
  who: { first: string; typed?: boolean } = { first: 'The patient' },
): string | null {
  if (!r) return null;
  if (r.verdict === 'good') return 'Your connection looks good.';
  const why = r.reasons.join(', ');
  const effect = who.typed
    ? 'Replies may be slow.'
    : `${who.first}’s voice and video may stutter.`;
  return `Your connection is slow right now (${why}). ${effect} Wi‑Fi usually helps.`;
}

/** Checks once when the screen opens. */
export function useConnectionCheck(): ConnectionReport | null {
  const [report, setReport] = useState<ConnectionReport | null>(null);
  useEffect(() => {
    let live = true;
    void checkConnection().then((r) => live && setReport(r));
    return () => {
      live = false;
    };
  }, []);
  return report;
}
