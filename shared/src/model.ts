/** Firestore document shapes. See PLAN.md §2. */

export type Role = 'resident' | 'faculty';
export const METRICS = ['jargon', 'clarity', 'empathy', 'cue'] as const;
export type Metric = (typeof METRICS)[number];
export type PatientModel = 'claude-opus-5-5' | 'claude-sonnet-5-5' | 'claude-haiku-5-5';

export type ScoringWeights = Record<Metric, number>;

export interface Program {
  name: string;
  timezone: string;
  audioRetentionMonths: number;
  transcriptRetentionMonths: number;
  scoringWeights: ScoringWeights;
  patientModel: PatientModel;
  currentRubricVersion: string;
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
  /** At most two things to work on. The first carries the rewrite. */
  fixes: Moment[];
  understandingCheck: 'teachback' | 'weak' | null;
  needsReview: boolean;
  model: string;
  promptHash: string;
  createdAt: string;
}
