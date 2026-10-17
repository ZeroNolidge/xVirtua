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

export interface ScenarioVersion {
  title: string;
  difficulty: Difficulty;
  persona: { name: string; age: number; pronouns: string; background: string };
  reasonForVisit: string;
  residentTask: string;
  healthLiteracy: HealthLiteracy;
  emotionalState: string;
  hiddenConcern: string;
  learningObjectives: string[];
  openingLine: string;
  cueScript: CueScriptEntry[];
}

export interface Evidence {
  turnIdx: number;
  quote: string;
}

export interface MetricScore {
  score: number;
  evidence: Evidence[];
  whatWentWell?: string;
  tryThisInstead?: { original: string; rewrite: string };
}
