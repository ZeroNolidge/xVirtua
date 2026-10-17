import type { ScoringWeights } from './model.js';

/** Bump to re-prompt every user with the consent screen. */
export const CONSENT_VERSION = 1;

/** Stored with every score so trends stay comparable across rubric changes. */
export const RUBRIC_VERSION = '2026-11-v1';

/** D4: equal weights across the four metrics. */
export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  jargon: 0.25,
  clarity: 0.25,
  empathy: 0.25,
  cue: 0.25,
};

/** D8: 3-year retention for audio and transcripts. */
export const DEFAULT_AUDIO_RETENTION_MONTHS = 36;
export const DEFAULT_TRANSCRIPT_RETENTION_MONTHS = 36;

export const DEFAULT_TIMEZONE = 'America/New_York';
