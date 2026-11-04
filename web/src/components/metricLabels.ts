import { BANDS, METRICS, TREND_TEXT, type Metric, type ResidentFeedback } from '@plainspeak/shared';
import type { Levels } from './SkillShape';

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

/** What each area measures, in a sentence (shown when its part of the graph is tapped). */
export const METRIC_ABOUT: Record<Metric, string> = {
  jargon: 'Using everyday words, or explaining the medical ones you need.',
  clarity: 'Explaining in a clear order, in small pieces, and checking they understood.',
  empathy: 'Noticing how they feel and saying so, kindly and without rushing.',
  cue: 'Hearing the hints they drop (a worry, a hesitation) and coming back to them.',
};

/** A band as a position on the graph: 1 (Just starting) to 4 (Strong). */
export function bandLevel(b: string | null | undefined): number | null {
  const i = (BANDS as readonly string[]).indexOf(b ?? '');
  return i < 0 ? null : i + 1;
}

/** A conversation's band in each area, as graph levels. */
export function levelsOf(areas: ResidentFeedback['areas']): Levels {
  return Object.fromEntries(METRICS.map((m) => [m, bandLevel(areas[m]?.band)])) as Levels;
}
