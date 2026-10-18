import type { ScoringWeights } from './model.js';

/** Bump to re-prompt every user with the consent screen. */
export const CONSENT_VERSION = 2;

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

/** Shown on the consent screen and the resident's history page. */
export const RETENTION_NOTICE =
  'Your recordings and transcripts are kept until you graduate (up to 3 years), then deleted.';

/** A conversation can be picked up again within these limits. */
export const SESSION_LIMITS = {
  /** No reply for this long and the conversation is closed. */
  idleMinutes: 30,
  /** Hard cap on one conversation, start to finish. */
  maxMinutes: 45,
  maxResidentTurns: 60,
};

/**
 * Per-user daily caps on the paid AI and voice calls. Generous for real
 * practice (a session is ~15 turns); they stop runaway loops or a leaked login.
 */
export const DAILY_LIMITS = {
  sessions: 20,
  patientTurns: 400,
  sttTokens: 60,
  voice: 500,
  lookups: 100,
  scoring: 30,
} as const;
export type DailyLimitKind = keyof typeof DAILY_LIMITS;
