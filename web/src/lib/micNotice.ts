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

/** True when there's no mic to use before anyone taps: none in the browser, or it's blocked. */
export function micKnownMissing(): boolean {
  return !navigator.mediaDevices?.getUserMedia;
}

/**
 * Whether we already know there's no mic (none in the browser, or permission
 * denied). Starts with what's known at once; the permission answer can follow.
 */
export function useNoMic(knownAlready = false): [boolean, (v: boolean) => void] {
  const [noMic, setNoMic] = useState(() => knownAlready || micKnownMissing());
  useEffect(() => {
    let live = true;
    navigator.permissions
      ?.query({ name: 'microphone' as PermissionName })
      .then((s) => live && s.state === 'denied' && setNoMic(true))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return [noMic, setNoMic];
}
