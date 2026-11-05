import { useEffect, useState } from 'react';

/** Shown when the browser gives us no microphone (they type instead). */
export const NO_MIC_NOTICE = 'No microphone access, so you can type your side for now.';

/**
 * The mic indicator beside the controls, or null when it shouldn't show:
 * typing, or no mic (only one state on screen, never "Mic ready" under a
 * "no microphone" alert).
 */
export function micIndicator(typed: boolean, notice: string | null, listening: boolean) {
  if (typed || notice === NO_MIC_NOTICE) return null;
  return listening ? '● Mic on' : '○ Mic ready';
}

/** The mic opened after all: the "no microphone" alert no longer applies. */
export const afterMicOpened = (notice: string | null) => (notice === NO_MIC_NOTICE ? null : notice);

const FAILED_KEY = 'ps.noMic';

/** The mic couldn't be opened: remember it, so the next screens say they'll type. */
export function rememberMicFailed() {
  try {
    localStorage.setItem(FAILED_KEY, '1');
  } catch {
    // Storage blocked (private mode): the wording just won't carry over.
  }
}

/** A mic opened: forget any earlier failure. */
export function rememberMicOpened() {
  try {
    localStorage.removeItem(FAILED_KEY);
  } catch {
    // Nothing stored, or storage blocked.
  }
}

function micFailedBefore(): boolean {
  try {
    return localStorage.getItem(FAILED_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * True when we know there's no mic before anyone taps: none in the browser,
 * or the last try to open it failed.
 */
export function micKnownMissing(): boolean {
  return !navigator.mediaDevices?.getUserMedia || micFailedBefore();
}

/**
 * Whether we already know there's no mic: none in the browser, an earlier
 * failure, permission denied, or no audio input device listed. Starts with
 * what's known at once; the permission and device answers can follow.
 */
export function useNoMic(knownAlready = false): [boolean, (v: boolean) => void] {
  const [noMic, setNoMic] = useState(() => knownAlready || micKnownMissing());
  useEffect(() => {
    let live = true;
    const none = () => live && setNoMic(true);
    navigator.permissions
      ?.query({ name: 'microphone' as PermissionName })
      .then((s) => s.state === 'denied' && none())
      .catch(() => undefined);
    navigator.mediaDevices
      ?.enumerateDevices?.()
      .then((d) => !d.some((x) => x.kind === 'audioinput') && none())
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return [noMic, setNoMic];
}
