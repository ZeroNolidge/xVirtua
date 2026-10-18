import { TREND_TEXT, type Metric, type ResidentFeedback } from '@plainspeak/shared';

export const METRIC_LABEL: Record<Metric, string> = {
  jargon: 'Plain language',
  clarity: 'Clear explaining',
  empathy: 'Empathy',
  cue: 'Picking up on cues',
};

/** "Getting there, up from last time" (just the word for a first conversation). */
export function overallText(o: NonNullable<ResidentFeedback['overall']>) {
  return o.trend === 'first' ? o.band : `${o.band}, ${TREND_TEXT[o.trend]}`;
}
