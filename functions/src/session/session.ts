import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import {
  CONSENT_VERSION,
  createJargonMatcher,
  decideCue,
  initialCueState,
  SEED_JARGON,
  type CueState,
  type PatientModel,
  type PatientUtterance,
} from '@plainspeak/shared';
import type { Caller } from '../lib/callable.js';
import { parse } from '../lib/callable.js';
import { LIMITS } from '../config.js';
import type { PatientBrain } from '../patient/brain.js';
import { buildPatientSystemPrompt, buildResidentMessage } from '../patient/prompt.js';
import { loadScenario } from './scenario.js';

const MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'] as const;
const matcher = createJargonMatcher(SEED_JARGON);

export interface SessionDoc {
  uid: string;
  programId: string;
  scenarioId: string;
  scenarioVersion: string;
  status: 'live' | 'ended';
  patientModel: PatientModel;
  cueState: CueState;
  turnCount: number;
  pending: boolean;
  startedAt: Timestamp;
  endedAt?: Timestamp;
  durationSec?: number;
  audioPath?: string | null;
  inputMode?: 'voice' | 'typed' | 'mixed';
}

function requireMember(caller: Caller | null) {
  if (!caller) throw new HttpsError('unauthenticated', 'Please sign in.');
  const { role, programId } = caller.claims;
  if ((role !== 'resident' && role !== 'faculty') || typeof programId !== 'string') {
    throw new HttpsError('permission-denied', 'Your account is not set up yet.');
  }
  return { uid: caller.uid, role, programId };
}

const OPENING_DELIVERY: PatientUtterance['delivery'] = {
  emotion: 'neutral',
  volume: 'normal',
  rate: 'normal',
  pauseBeforeMs: 0,
};

// ---------- start ----------

const startInput = z.object({
  scenarioId: z.string().regex(/^[a-z0-9-]{1,80}$/),
  /** Faculty only: try a different patient model for this session. */
  model: z.enum(MODELS).nullish(),
});

export async function startSession(db: Firestore, caller: Caller | null, data: unknown) {
  const me = requireMember(caller);
  const { scenarioId, model } = parse(startInput, data);

  const user = await db.doc(`users/${me.uid}`).get();
  if (user.get('consent.version') !== CONSENT_VERSION) {
    throw new HttpsError('failed-precondition', 'Please accept the consent form first.');
  }
  const sc = await loadScenario(db, scenarioId);
  const allowed =
    sc &&
    sc.doc.programId === me.programId &&
    (sc.doc.status === 'active' || (me.role === 'faculty' && sc.doc.status === 'draft'));
  if (!sc || !allowed) throw new HttpsError('not-found', 'Scenario not found.');

  const program = await db.doc(`programs/${me.programId}`).get();
  const programModel =
    (program.get('patientModel') as PatientModel | undefined) ?? 'claude-opus-5-5';
  const patientModel = me.role === 'faculty' && model ? model : programModel;

  const ref = db.collection('sessions').doc();
  const opening: PatientUtterance = {
    text: sc.script.openingLine,
    askedQuestion: /\?\s*$/.test(sc.script.openingLine),
    delivery: OPENING_DELIVERY,
    nonverbal: [],
  };
  const batch = db.batch();
  batch.set(ref, {
    uid: me.uid,
    programId: me.programId,
    role: me.role,
    scenarioId,
    scenarioVersion: sc.version,
    scenarioTitle: sc.briefing.title,
    status: 'live',
    patientModel,
    cueState: initialCueState(),
    turnCount: 1,
    pending: false,
    startedAt: FieldValue.serverTimestamp(),
    lastActivityAt: FieldValue.serverTimestamp(),
    audioPath: null,
  });
  batch.set(ref.collection('turns').doc('0'), {
    idx: 0,
    speaker: 'patient',
    ...opening,
    raw: JSON.stringify(opening),
    createdAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();
  return {
    sessionId: ref.id,
    opening: { idx: 0, ...opening },
    persona: sc.briefing.persona,
    patientModel,
  };
}

// ---------- turn ----------

const turnInput = z.object({
  sessionId: z.string().min(1).max(64),
  text: z.string().trim().min(1).max(LIMITS.maxTurnChars),
  source: z.enum(['voice', 'typed']).default('voice'),
  // Callable clients send missing values as null.
  tStartMs: z.number().int().nonnegative().nullish(),
  tEndMs: z.number().int().nonnegative().nullish(),
});

export async function patientTurn(
  db: Firestore,
  caller: Caller | null,
  data: unknown,
  brain: PatientBrain,
) {
  const me = requireMember(caller);
  const input = parse(turnInput, data);
  const ref = db.doc(`sessions/${input.sessionId}`);

  // Reserve two turn slots (resident + patient) so concurrent calls can't collide.
  const s = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const s = snap.data() as SessionDoc | undefined;
    if (!s || s.uid !== me.uid) throw new HttpsError('not-found', 'Session not found.');
    if (s.status !== 'live')
      throw new HttpsError('failed-precondition', 'This conversation has ended.');
    if (s.pending) throw new HttpsError('aborted', 'The patient is still answering.');
    if (s.turnCount >= LIMITS.maxResidentTurns * 2) {
      throw new HttpsError(
        'resource-exhausted',
        'This conversation has reached its limit. Please end it.',
      );
    }
    const ageMin = (Date.now() - s.startedAt.toMillis()) / 60000;
    if (ageMin > LIMITS.maxSessionMinutes) {
      throw new HttpsError('deadline-exceeded', 'This conversation timed out. Please end it.');
    }
    tx.update(ref, { pending: true });
    return s;
  });

  try {
    const sc = await loadScenario(db, s.scenarioId, s.scenarioVersion);
    if (!sc) throw new HttpsError('not-found', 'Scenario not found.');

    const turnsSnap = await ref.collection('turns').orderBy('idx').get();
    const turns = turnsSnap.docs.map((d) => d.data());
    const prevPatient = [...turns].reverse().find((t) => t.speaker === 'patient');

    const decision = decideCue(sc.script.cueScript, s.cueState, input.text, matcher);
    const message = buildResidentMessage(input.text, decision.cue);
    const result = await brain.reply({
      model: s.patientModel,
      system: buildPatientSystemPrompt(sc.briefing, sc.script),
      history: turns
        .filter((t) => t.idx > 0)
        .map((t) => ({ speaker: t.speaker, content: t.speaker === 'resident' ? t.prompt : t.raw })),
      message,
      cue: decision.cue,
    });

    const rIdx = s.turnCount;
    const pIdx = rIdx + 1;
    const batch = db.batch();
    batch.set(ref.collection('turns').doc(String(rIdx)), {
      idx: rIdx,
      speaker: 'resident',
      text: input.text,
      prompt: message,
      source: input.source,
      tStartMs: input.tStartMs ?? null,
      tEndMs: input.tEndMs ?? null,
      words: decision.turnFacts.words,
      jargonCount: decision.turnFacts.jargonCount,
      understandingCheck: decision.turnFacts.understandingCheck,
      // What this turn was responding to, for cue scoring later.
      afterPatientCueId: prevPatient?.cueId ?? null,
      afterPatientQuestion: prevPatient?.askedQuestion ?? false,
      createdAt: FieldValue.serverTimestamp(),
    });
    batch.set(ref.collection('turns').doc(String(pIdx)), {
      idx: pIdx,
      speaker: 'patient',
      ...result.utterance,
      raw: result.raw,
      model: result.model,
      latencyMs: result.latencyMs,
      usage: result.usage,
      createdAt: FieldValue.serverTimestamp(),
    });
    const mode = s.inputMode && s.inputMode !== input.source ? 'mixed' : input.source;
    batch.update(ref, {
      turnCount: pIdx + 1,
      cueState: decision.next,
      pending: false,
      inputMode: mode,
      lastActivityAt: FieldValue.serverTimestamp(),
    });
    await batch.commit();
    return { patient: { idx: pIdx, ...result.utterance }, latencyMs: result.latencyMs };
  } catch (e) {
    await ref.update({ pending: false }).catch(() => undefined);
    if (e instanceof HttpsError) throw e;
    console.error('patientTurn failed', e);
    throw new HttpsError('unavailable', 'The patient didn’t answer. Please try again.');
  }
}

// ---------- end ----------

const endInput = z.object({
  sessionId: z.string().min(1).max(64),
  audioExt: z.enum(['webm', 'm4a', 'mp4', 'ogg']).nullish(),
});

export async function endSession(
  db: Firestore,
  caller: Caller | null,
  data: unknown,
  audioExists: (path: string) => Promise<boolean>,
) {
  const me = requireMember(caller);
  const { sessionId, audioExt } = parse(endInput, data);
  const ref = db.doc(`sessions/${sessionId}`);
  const snap = await ref.get();
  const s = snap.data() as SessionDoc | undefined;
  if (!s || s.uid !== me.uid) throw new HttpsError('not-found', 'Session not found.');

  const update: Record<string, unknown> = {};
  if (s.status === 'live') {
    const durationSec = Math.round((Date.now() - s.startedAt.toMillis()) / 1000);
    Object.assign(update, {
      status: 'ended',
      endedAt: FieldValue.serverTimestamp(),
      durationSec,
      pending: false,
    });
  }
  if (audioExt) {
    const path = `audio/${s.programId}/${s.uid}/${sessionId}/recording.${audioExt}`;
    if (!(await audioExists(path)))
      throw new HttpsError('failed-precondition', 'Recording upload not found.');
    update.audioPath = path;
  }
  if (Object.keys(update).length) await ref.update(update);
  return { sessionId, status: 'ended' as const };
}
