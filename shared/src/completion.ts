import { BANDS, METRICS, type Band, type Metric } from './model.js';

/**
 * Completing a patient: Solid or better in all four areas in one
 * conversation, and their key moment (the worry the conversation turns on)
 * picked up. Mastered: Strong in all four, and the key moment.
 */
export const PATIENT_STATUS = ['started', 'completed', 'mastered'] as const;
export type PatientStatus = (typeof PATIENT_STATUS)[number];
export type Completion = Exclude<PatientStatus, 'started'>;

/**
 * Each patient's key moments: their hidden worry's cue (scenario cue ids).
 * A scenario's own script can name them instead (ScenarioScript.keyCueIds).
 */
export const KEY_MOMENTS: Record<string, string[]> = {
  'htn-new-diagnosis': ['job-worry'],
  't2dm-new-diagnosis': ['insulin-fear'],
  'statin-start': ['cost'],
  'new-med-side-effects': ['zombie-fear'],
  'abnormal-lab-followup': ['cancer-fear'],
  'smoking-cessation': ['caregiver-stress'],
};

export interface KeyMoment {
  /** What the patient did (null: it never came up, so it isn't named). */
  cue: string | null;
  addressed: boolean;
}

export interface CompletionResult {
  /** What this conversation reached (null: not yet). */
  status: Completion | null;
  /** Areas below Solid this time. */
  short: Metric[];
  keyMoments: KeyMoment[];
  /** First time they reached this (or a higher) level with this patient. */
  newlyReached: boolean;
}

const at = (b: Band) => BANDS.indexOf(b);

export function completionOf(
  bands: Record<Metric, Band>,
  keys: readonly KeyMoment[],
): Completion | null {
  if (!keys.every((k) => k.addressed)) return null;
  if (METRICS.every((m) => at(bands[m]) >= at('Strong'))) return 'mastered';
  if (METRICS.every((m) => at(bands[m]) >= at('Solid'))) return 'completed';
  return null;
}

/** Areas that still need to reach Solid. */
export function shortOf(bands: Record<Metric, Band>): Metric[] {
  return METRICS.filter((m) => at(bands[m]) < at('Solid'));
}

export const statusRank = (s: PatientStatus | null | undefined) =>
  s ? PATIENT_STATUS.indexOf(s) : -1;

/** The better of two statuses (a patient never goes back down). */
export function bestStatus(
  a: PatientStatus | null | undefined,
  b: PatientStatus | null | undefined,
): PatientStatus {
  return statusRank(a) >= statusRank(b) ? (a ?? 'started') : (b ?? 'started');
}

/** userProgress/{uid}.scenarios[scenarioId]: their best with each patient. */
export interface PatientProgress {
  status: PatientStatus;
  /** The conversation that reached it. */
  sessionId?: string;
  updatedAt?: unknown;
}
