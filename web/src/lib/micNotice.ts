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
