import { TREND_TEXT, type Metric, type ResidentFeedback } from '@plainspeak/shared';

export const METRIC_LABEL: Record<Metric, string> = {
  jargon: 'Plain language',
  clarity: 'Clear explaining',
  empathy: 'Empathy',
  cue: 'Picking up on cues',
};

/** "Up from last time" (nothing for a first conversation). */
export function trendLine(t: NonNullable<ResidentFeedback['overall']>['trend']) {
  const text = TREND_TEXT[t];
  return text.charAt(0).toUpperCase() + text.slice(1);
}
