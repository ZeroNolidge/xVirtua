import { useEffect, useRef, useState } from 'react';
import { SESSION_LIMITS } from '@plainspeak/shared';

/** Nobody said anything for this long: ask "Still there?". */
export const QUIET_ASK_MS = 2 * 60_000;
/** No answer to "Still there?" for this long: pause. */
export const QUIET_PAUSE_MS = 30_000;
/** Warn this long before the time limit. */
export const CAP_WARN_MS = 5 * 60_000;

export type PauseReason = 'hidden' | 'quiet';

export interface CallGuard {
  /** "Still there?" is showing. */
  askingStillThere: boolean;
  /** The resident answered "I'm here". */
  stillHere(): void;
  /** Note that someone said something (resets the quiet timer). */
  activity(): void;
}

/**
 * Keeps the mic and the paid voice connection from running when nobody is
 * using them: pauses when the app is hidden or after 2 quiet minutes (with a
 * "Still there?" first), and ends the conversation at the time limit.
 */
export function useCallGuard(opts: {
  /** The mic is on and the call is running. */
  active: boolean;
  /** Date.now() when the conversation started. */
  startedAtMs: number;
  onPause(reason: PauseReason): void;
  onWarn(minutesLeft: number): void;
  onTimeUp(): void;
}): CallGuard {
  const [asking, setAsking] = useState(false);
  const lastActivity = useRef(Date.now());
  const askedAt = useRef<number | null>(null);
  const warned = useRef(false);
  const cb = useRef(opts);
  useEffect(() => {
    cb.current = opts;
  });

  const activity = () => {
    lastActivity.current = Date.now();
    if (askedAt.current !== null) {
      askedAt.current = null;
      setAsking(false);
    }
  };

  // Coming back from a pause starts the quiet timer over.
  useEffect(() => {
    if (opts.active) activity();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.active]);

  useEffect(() => {
    if (!opts.active) return;
    const onHide = () => {
      if (document.visibilityState === 'hidden') cb.current.onPause('hidden');
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    const t = window.setInterval(() => {
      const now = Date.now();
      const left = cb.current.startedAtMs + SESSION_LIMITS.maxMinutes * 60_000 - now;
      if (left <= 0) return cb.current.onTimeUp();
      if (left <= CAP_WARN_MS && !warned.current) {
        warned.current = true;
        cb.current.onWarn(Math.ceil(left / 60_000));
      }
      if (askedAt.current !== null) {
        if (now - askedAt.current >= QUIET_PAUSE_MS) {
          askedAt.current = null;
          lastActivity.current = now;
          setAsking(false);
          cb.current.onPause('quiet');
        }
      } else if (now - lastActivity.current >= QUIET_ASK_MS) {
        askedAt.current = now;
        setAsking(true);
      }
    }, 1000);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
      window.clearInterval(t);
    };
  }, [opts.active]);

  return { askingStillThere: asking, stillHere: activity, activity };
}
