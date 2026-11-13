import { useEffect, useState } from 'react';

/**
 * The wait between tapping Start and the patient's first words can be ten
 * seconds or more (the room, the voice, the video face). A spinner and a
 * line that moves on every few seconds say it's on purpose, not stuck.
 */
export const READY_STEPS: { atMs: number; text: (first: string) => string }[] = [
  { atMs: 0, text: () => 'Preparing the room…' },
  { atMs: 2500, text: (first) => `Getting ${first} ready…` },
  { atMs: 6000, text: () => 'Adding the final touches…' },
  { atMs: 12000, text: () => 'Almost there…' },
];

export function GettingReady({
  first,
  from = 0,
}: {
  first: string;
  /** Which step to start on (later screens pick up where the last left off). */
  from?: number;
}) {
  /** The furthest step the timers have reached. */
  const [reached, setReached] = useState(from);
  useEffect(() => {
    const start = READY_STEPS[from]?.atMs ?? 0;
    const timers = READY_STEPS.map((s, i) =>
      i > from ? window.setTimeout(() => setReached(i), s.atMs - start) : null,
    );
    return () => timers.forEach((t) => t !== null && window.clearTimeout(t));
  }, [from]);
  const current = READY_STEPS[Math.min(Math.max(from, reached), READY_STEPS.length - 1)]!;
  return (
    <div className="card center-card getting-ready" role="status" aria-live="polite">
      <div className="spinner" aria-hidden="true" />
      <p className="getting-ready-step">{current.text(first)}</p>
    </div>
  );
}
