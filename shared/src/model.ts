/** Firestore document shapes. See PLAN.md §2. */

export type Role = 'resident' | 'faculty';
export const METRICS = ['jargon', 'clarity', 'empathy', 'cue'] as const;
export type Metric = (typeof METRICS)[number];
export type PatientModel = 'claude-opus-5-5' | 'claude-sonnet-5-5' | 'claude-haiku-5-5';

export type ScoringWeights = Record<Metric, number>;

/**
 * How the patient talks. standard: our speech-to-text, Claude and Cartesia in
 * turns. live: OpenAI GPT-Live carries the conversation (full duplex) and asks
 * Claude for every reply. Test mode for now.
 */
export const VOICE_MODES = ['standard', 'live'] as const;
export type VoiceMode = (typeof VOICE_MODES)[number];
/** GPT-Live's voices (marin is its default). */
export const LIVE_VOICES = [
  'marin',
  'cinder',
  'stone',
  'beacon',
  'delta',
  'meridian',
  'tempo',
  'bossa',
  'quartz',
  'ripple',
  'vesper',
  'willow',
  'gleam',
] as const;
export type LiveVoice = (typeof LIVE_VOICES)[number];
/**
 * Who writes the patient's words in GPT-Live mode. steer: GPT-Live answers at
 * once, in character, and Claude steers it with private notes between turns.
 * claude: GPT-Live asks Claude for every line (slower, follows the script exactly).
 */
export const LIVE_BRAINS = ['steer', 'claude'] as const;
export type LiveBrain = (typeof LIVE_BRAINS)[number];

/** Which voice set a patient uses, from their pronouns. */
export type VoiceGroup = 'he' | 'she' | 'they';
export function voiceGroupOf(pronouns: string): VoiceGroup {
  const p = pronouns.toLowerCase();
  if (/\bhe\b|\bhim\b|\bhis\b/.test(p)) return 'he';
  if (/\bshe\b|\bher\b|\bhers\b/.test(p)) return 'she';
  return 'they';
}

export interface Program {
  name: string;
  timezone: string;
  audioRetentionMonths: number;
  transcriptRetentionMonths: number;
  scoringWeights: ScoringWeights;
  patientModel: PatientModel;
  currentRubricVersion: string;
  /** Unset means standard. */
  voiceMode?: VoiceMode;
  liveVoice?: LiveVoice;
  /** GPT-Live voice by the patient's pronouns (falls back to liveVoice). */
  liveVoices?: Partial<Record<VoiceGroup, LiveVoice>>;
  /** Unset means steer. */
  liveBrain?: LiveBrain;
  /** Faculty's own notes on how each GPT-Live voice sounds. */
  liveVoiceTags?: Partial<Record<LiveVoice, 'male' | 'female' | 'neutral'>>;
  /** Captions (the live transcript) on by default during conversations. Unset: off. */
  captionsDefault?: boolean;
  /** Test: show the patient as a lip-synced video avatar (Simli). Unset: off. */
  avatarOn?: boolean;
  /** Simli face ids by the patient's pronouns. */
  avatarFaces?: Partial<Record<VoiceGroup, string>>;
}

/** Custom claims set on the Firebase Auth token by the server. */
export interface UserClaims {
  role: Role;
  programId: string;
}

export interface UserDoc {
  programId: string;
  role: Role;
  displayName: string;
  email: string;
  consent: { version: number; acceptedAt: string } | null;
  createdAt: string;
}

export type Difficulty = 1 | 2 | 3;
export type HealthLiteracy = 'low' | 'moderate' | 'high';

export type CueTrigger =
  | { type: 'resident_turn_words_gt'; value: number }
  | { type: 'jargon_in_turn_gte'; value: number }
  | { type: 'turn_index'; value: number }
  | { type: 'topic_mentioned'; topics: string[] }
  | { type: 'no_understanding_check_for_turns'; value: number };

export interface CueScriptEntry {
  id: string;
  cue: string;
  trigger: CueTrigger;
  maxFires: number;
  performance: {
    say: string;
    delivery: Partial<import('./patient.js').Delivery>;
    nonverbal: import('./patient.js').NonverbalCue[];
  };
  expectedResidentResponse: string;
}

/** Public part of a scenario version: what the resident sees in the briefing. */
export interface ScenarioBriefing {
  title: string;
  difficulty: Difficulty;
  persona: { name: string; age: number; pronouns: string };
  reasonForVisit: string;
  /** What the resident needs to explain. */
  residentTask: string;
  /** Chart facts the resident would know walking in. */
  residentFacts: string[];
  learningObjectives: string[];
  estimatedMinutes: number;
}

/**
 * Private part: drives the AI patient. Readable by faculty and the server only
 * (stored at scenarios/{id}/versions/{v}/private/script).
 */
export interface ScenarioScript {
  background: string;
  healthLiteracy: HealthLiteracy;
  emotionalState: string;
  hiddenConcern: string;
  openingLine: string;
  /** Facts the patient knows and can share if asked. */
  patientKnows: string[];
  speakingStyle: string;
  cueScript: CueScriptEntry[];
}

export type ScenarioStatus = 'draft' | 'active' | 'archived';

/** scenarios/{id}: summary for the picker. */
export interface ScenarioDoc {
  programId: string;
  status: ScenarioStatus;
  currentVersion: string;
  title: string;
  difficulty: Difficulty;
  patientName: string;
  patientAge: number;
  reasonForVisit: string;
  tags: string[];
  /** GPT-Live voice for this patient, chosen by faculty (else the pronoun default). */
  liveVoice?: LiveVoice | null;
}

export interface ScenarioSeed {
  id: string;
  tags: string[];
  briefing: ScenarioBriefing;
  script: ScenarioScript;
}

export interface Evidence {
  turnIdx: number;
  quote: string;
}

/** One coaching moment from the transcript. */
export interface Moment {
  metric: Metric;
  turnIdx: number;
  quote: string;
  /** Why it worked, or what to change. */
  note: string;
  /** "Try saying this instead" line (fixes only). */
  rewrite?: string;
  /** What the patient said just before (so the resident remembers the moment). */
  before?: string;
}

export interface MetricScore {
  score: number;
  /** One-line plain summary for the resident. */
  summary: string;
  evidence: (Evidence & { note: string })[];
  tryThisInstead: { turnIdx: number; original: string; rewrite: string } | null;
}

export interface JargonMetricScore extends MetricScore {
  flagged: { term: string; plain: string[]; uses: number; turns: number[] }[];
  explained: { term: string; turnIdx: number }[];
}

export interface CueResult {
  cueId: string;
  cue: string;
  patientTurnIdx: number;
  residentTurnIdx: number | null;
  addressed: boolean;
  quote: string | null;
}

/** sessions/{id}/scores/{rubricVersion}. Written by the server only. */
export interface ScoreDoc {
  rubricVersion: string;
  overall: number | null;
  weights: ScoringWeights;
  metrics: {
    jargon: JargonMetricScore;
    clarity: MetricScore;
    empathy: MetricScore;
    cue: MetricScore & {
      cueResults: CueResult[];
      steamrolls: { patientTurnIdx: number; residentTurnIdx: number }[];
    };
  };
  /** The one moment that went well, shown first. */
  highlight: Moment | null;
  /** At most two things to work on, from two different areas, each with a rewrite. */
  fixes: Moment[];
  understandingCheck: 'teachback' | 'weak' | null;
  needsReview: boolean;
  /** Rewrites that added facts the resident didn't say (hidden from the resident). */
  rewriteFlags?: { where: string; rewrite: string; reasons: string[] }[];
  /** Overall score of the resident's previous scored conversation, for the trend. */
  previousOverall?: number | null;
  model: string;
  promptHash: string;
  createdAt: string;
}

/** Words residents see instead of numbers. Exact scores stay in the faculty-only record. */
export const BANDS = ['Just starting', 'Getting there', 'Solid', 'Strong'] as const;
export type Band = (typeof BANDS)[number];

export function bandFor(score: number): Band {
  if (score >= 85) return 'Strong';
  if (score >= 70) return 'Solid';
  if (score >= 50) return 'Getting there';
  return 'Just starting';
}

export type Trend = 'first' | 'up' | 'same' | 'down';

/** Compares with the resident's previous scored conversation (5-point dead zone). */
export function trendFor(now: number, previous: number | null | undefined): Trend {
  if (previous == null) return 'first';
  if (now - previous >= 5) return 'up';
  if (previous - now >= 5) return 'down';
  return 'same';
}

export const TREND_TEXT: Record<Trend, string> = {
  first: 'your first one',
  up: 'up from last time',
  same: 'about the same as last time',
  down: 'a little lower than last time',
};

/** One area of feedback as the resident sees it: no numbers. */
export interface AreaFeedback {
  band: Band;
  summary: string;
  evidence: (Evidence & { note: string })[];
  tryThisInstead: { turnIdx: number; original: string; rewrite: string } | null;
}

/**
 * sessions/{id}/feedback/current: what the resident sees. Written once by the
 * server; holds words and trends only, never the 0–100 scores.
 */
export interface ResidentFeedback {
  rubricVersion: string;
  overall: { band: Band; trend: Trend } | null;
  highlight: Moment | null;
  /** Two fixes from two different areas, most important first. */
  fixes: Moment[];
  areas: {
    jargon: AreaFeedback & {
      flagged: { term: string; plain: string[]; uses: number }[];
      explained: { term: string }[];
    };
    clarity: AreaFeedback;
    empathy: AreaFeedback;
    cue: AreaFeedback & { cueResults: { cue: string; addressed: boolean; quote: string | null }[] };
  };
  createdAt: string;
}
