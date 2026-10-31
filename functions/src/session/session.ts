import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import {
  CONSENT_VERSION,
  createJargonMatcher,
  decideCue,
  DEFAULT_TRANSCRIPT_RETENTION_MONTHS,
  EMOTIONS,
  initialCueState,
  NONVERBAL_CUES,
  SEED_JARGON,
  SentenceSplitter,
  SESSION_LIMITS,
  stripStageDirections,
  type CueScriptEntry,
  type CueState,
  type Delivery,
  type NonverbalCue,
  type PatientChunk,
  type PatientModel,
  type PatientUtterance,
  type VoiceMode,
  type LiveBrain,
  cueAlreadyCovered,
  VOICE_MODES,
  MOODS,
  stepToward,
  type Mood,
} from '@plainspeak/shared';
import type { Caller } from '../lib/callable.js';
import { parse } from '../lib/callable.js';
import { LIMITS } from '../config.js';
import { consumeQuota } from '../lib/quota.js';
import { SentenceVoicer, type VoiceService } from '../voice/streamVoice.js';
import type { OnText, PatientBrain } from '../patient/brain.js';
import { buildPatientSystemPrompt, buildResidentMessage } from '../patient/prompt.js';
import type { Director } from '../patient/director.js';
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
  pendingAt?: Timestamp;
  startedAt: Timestamp;
  lastActivityAt?: Timestamp;
  persona?: { name: string; age: number; pronouns: string };
  voiceId?: string;
  endedAt?: Timestamp;
  durationSec?: number;
  audioPath?: string | null;
  inputMode?: 'voice' | 'typed' | 'mixed';
  voiceMode?: VoiceMode;
  liveBrain?: LiveBrain;
  /** Video avatar: the patient's mood (set by the director in GPT-Live mode). */
  mood?: Mood;
  /** Steer mode: the cue the last director note asked for. */
  directedCueId?: string | null;
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
  /** Faculty only: try the other voice mode for this session. */
  voiceMode: z.enum(VOICE_MODES).nullish(),
});

export async function startSession(db: Firestore, caller: Caller | null, data: unknown) {
  const me = requireMember(caller);
  const { scenarioId, model, voiceMode: askedMode } = parse(startInput, data);
  // The patient model is a faculty setting; residents can't pick one per session.
  if (model && me.role !== 'faculty') {
    throw new HttpsError('permission-denied', 'Only faculty can choose the patient model.');
  }
  if (askedMode && me.role !== 'faculty') {
    throw new HttpsError('permission-denied', 'Only faculty can choose the voice mode.');
  }

  await consumeQuota(db, me.uid, 'sessions');
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
    // Default: the fastest model that stayed in character in the bench (docs/patient-model-bench.md).
    (program.get('patientModel') as PatientModel | undefined) ?? 'claude-haiku-5-5';
  const keepMonths =
    (program.get('transcriptRetentionMonths') as number | undefined) ??
    DEFAULT_TRANSCRIPT_RETENTION_MONTHS;
  const deleteAfter = new Date();
  deleteAfter.setMonth(deleteAfter.getMonth() + keepMonths);
  const patientModel = me.role === 'faculty' && model ? model : programModel;
  const programMode = program.get('voiceMode') === 'live' ? 'live' : 'standard';
  const voiceMode: VoiceMode = askedMode ?? programMode;
  const liveBrain: LiveBrain = program.get('liveBrain') === 'claude' ? 'claude' : 'steer';

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
    // Kept on the session so a crashed conversation can be picked up again.
    persona: sc.briefing.persona,
    status: 'live',
    patientModel,
    voiceMode,
    ...(voiceMode === 'live' ? { liveBrain } : {}),
    cueState: initialCueState(),
    turnCount: 1,
    pending: false,
    startedAt: FieldValue.serverTimestamp(),
    lastActivityAt: FieldValue.serverTimestamp(),
    audioPath: null,
    // Retention: deleted by the nightly job after this date (or at graduation).
    deleteAfter: Timestamp.fromDate(deleteAfter),
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
    voiceMode,
  };
}

// ---------- turn ----------

/**
 * What the patient model sees of its own earlier reply: what was actually
 * said out loud (only the part before a cut-off, or GPT-Live's wording).
 */
function patientHistoryText(t: Record<string, unknown>): string {
  const said =
    t.plannedText !== undefined
      ? String(t.text ?? '')
      : t.interrupted
        ? `${String(t.heardText ?? '')} —`
        : null;
  if (said === null) return String(t.raw);
  try {
    return JSON.stringify({ ...JSON.parse(String(t.raw)), text: said });
  } catch {
    return String(t.raw);
  }
}

/**
 * The saved patient line becomes what was said out loud. Claude's planned
 * line is kept as plannedText. A cut-off line ends in "—".
 */
export function spokenUpdate(
  turn: Record<string, unknown>,
  said: { spoken?: string | null; cutOff?: { heard: string } | null },
): Record<string, unknown> | null {
  const planned = String(turn.plannedText ?? turn.text ?? '');
  if (said.cutOff) {
    const heard = said.cutOff.heard.trim();
    return {
      interrupted: true,
      heardText: heard,
      text: heard ? `${heard} —` : '—',
      plannedText: planned,
    };
  }
  const spoken = said.spoken?.trim();
  if (!spoken || turn.interrupted) return null;
  return { text: spoken, liveSpokenText: spoken, plannedText: planned };
}

const ms = z
  .number()
  .int()
  .nonnegative()
  .max(24 * 3600 * 1000)
  .nullish();
const turnInput = z.object({
  sessionId: z.string().min(1).max(64),
  text: z.string().trim().min(1).max(LIMITS.maxTurnChars),
  source: z.enum(['voice', 'typed']).default('voice'),
  // Callable clients send missing values as null.
  tStartMs: ms,
  tEndMs: ms,
  /**
   * How long the resident took to start answering, counted from when the
   * patient finished speaking. Time spent waiting on the app (the patient
   * thinking, the voice loading) is not included.
   */
  responseGapMs: ms,
  /** How long the app made the resident wait for the previous patient reply. */
  prevAppWaitMs: ms,
  /**
   * The resident kept talking before the patient's reply played: replace that
   * exchange (this resident turn index and the reply after it) with this turn.
   */
  supersedes: z.number().int().positive().nullish(),
  /** The resident talked over the patient's last reply; only this much was heard. */
  prevInterrupted: z.object({ heard: z.string().max(2000) }).nullish(),
  /** Live voice: GPT-Live speaks the reply, so no Cartesia voice is made. */
  live: z.boolean().nullish(),
  /** Live voice: what GPT-Live actually said for the previous reply (it may reword). */
  prevSpoken: z.string().max(4000).nullish(),
});

/** Why a live session can no longer take turns, or null if it can. */
export function closedReason(s: SessionDoc, now = Date.now()): string | null {
  if (s.status !== 'live') return 'This conversation has ended.';
  if (s.turnCount >= SESSION_LIMITS.maxResidentTurns * 2)
    return 'This conversation has reached its limit. Please end it.';
  if ((now - s.startedAt.toMillis()) / 60000 > SESSION_LIMITS.maxMinutes)
    return 'This conversation timed out. Please end it.';
  const last = (s.lastActivityAt ?? s.startedAt).toMillis();
  if ((now - last) / 60000 > SESSION_LIMITS.idleMinutes)
    return 'This conversation was idle too long. Please end it.';
  return null;
}

/** A reply in progress is considered stuck (e.g. the app closed) after this long. */
const STUCK_PENDING_MS = 90_000;

export interface TurnOptions {
  /** Streams reply pieces to the app. Omit when the app can't stream. */
  send?: (chunk: PatientChunk) => Promise<unknown>;
  voice?: VoiceService | null;
}

const NEUTRAL: Delivery = {
  emotion: 'neutral',
  volume: 'normal',
  rate: 'normal',
  pauseBeforeMs: 0,
};

/** Delivery and nonverbal cues for the voice, from the streamed prefix plus the scripted cue. */
function streamedDelivery(
  prefix: Record<string, unknown> | null,
  cue: CueScriptEntry | null,
): { delivery: Delivery; nonverbal: NonverbalCue[] } {
  const d = (prefix?.delivery ?? {}) as Partial<Delivery>;
  const base: Delivery = {
    emotion: EMOTIONS.includes(d.emotion as never) ? d.emotion! : 'neutral',
    volume: d.volume === 'quiet' ? 'quiet' : 'normal',
    rate: d.rate === 'slow' ? 'slow' : 'normal',
    pauseBeforeMs: Math.min(5000, Math.max(0, Number(d.pauseBeforeMs) || 0)),
  };
  const nv = Array.isArray(prefix?.nonverbal)
    ? (prefix.nonverbal as unknown[]).filter((n): n is NonverbalCue =>
        NONVERBAL_CUES.includes(n as NonverbalCue),
      )
    : [];
  if (!cue) return { delivery: base, nonverbal: nv };
  const c = cue.performance.delivery;
  return {
    delivery: {
      ...NEUTRAL,
      ...base,
      ...Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined)),
    },
    nonverbal: cue.performance.nonverbal.length ? [...cue.performance.nonverbal] : nv,
  };
}

export async function patientTurn(
  db: Firestore,
  caller: Caller | null,
  data: unknown,
  brain: PatientBrain,
  opts: TurnOptions = {},
) {
  const me = requireMember(caller);
  const input = parse(turnInput, data);
  const ref = db.doc(`sessions/${input.sessionId}`);
  const t0 = Date.now();
  // Read the conversation so far while the lock is taken (saves a round trip).
  const turnsEarly = ref.collection('turns').orderBy('idx').get();

  // Reserve two turn slots (resident + patient) so concurrent calls can't collide.
  const [s] = await Promise.all([
    db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const s = snap.data() as SessionDoc | undefined;
      if (!s || s.uid !== me.uid) throw new HttpsError('not-found', 'Session not found.');
      if (s.status !== 'live')
        throw new HttpsError('failed-precondition', 'This conversation has ended.');
      const stuck = s.pendingAt && Date.now() - s.pendingAt.toMillis() > STUCK_PENDING_MS;
      if (s.pending && !stuck) throw new HttpsError('aborted', 'The patient is still answering.');
      const closed = closedReason(s);
      if (closed) {
        throw new HttpsError(
          s.turnCount >= SESSION_LIMITS.maxResidentTurns * 2
            ? 'resource-exhausted'
            : 'deadline-exceeded',
          closed,
        );
      }
      // Replace an exchange whose reply was never played (the resident kept talking).
      const sup = input.supersedes;
      if (sup != null && s.turnCount === sup + 2) {
        const residentRef = ref.collection('turns').doc(String(sup));
        const replyRef = ref.collection('turns').doc(String(sup + 1));
        const [rSnap, pSnap] = await Promise.all([tx.get(residentRef), tx.get(replyRef)]);
        if (rSnap.get('speaker') === 'resident' && pSnap.get('speaker') === 'patient') {
          const before = (pSnap.get('cueStateBefore') as CueState | undefined) ?? s.cueState;
          tx.delete(residentRef);
          tx.delete(replyRef);
          tx.update(ref, {
            turnCount: sup,
            cueState: before,
            pending: true,
            pendingAt: FieldValue.serverTimestamp(),
          });
          return { ...s, turnCount: sup, cueState: before };
        }
      }
      tx.update(ref, { pending: true, pendingAt: FieldValue.serverTimestamp() });
      return s;
    }),
    consumeQuota(db, me.uid, 'patientTurns'),
  ]);

  try {
    const [sc, early] = await Promise.all([
      loadScenario(db, s.scenarioId, s.scenarioVersion),
      turnsEarly,
    ]);
    if (!sc) throw new HttpsError('not-found', 'Scenario not found.');
    // If a turn landed between the early read and the lock, read again.
    const turnsSnap =
      early.size === s.turnCount ? early : await ref.collection('turns').orderBy('idx').get();
    const turns = turnsSnap.docs.map((d) => d.data());
    const prevPatient = [...turns].reverse().find((t) => t.speaker === 'patient');
    // Talked over: the patient only "said" what the resident let them say.
    const heard = input.prevInterrupted?.heard.trim();
    const interrupted = !!(prevPatient && prevPatient.idx > 0 && input.prevInterrupted);
    if (prevPatient) {
      const said = spokenUpdate(prevPatient, {
        spoken: input.prevSpoken,
        cutOff: interrupted ? { heard: heard ?? '' } : null,
      });
      if (said) Object.assign(prevPatient, said);
    }

    const decision = decideCue(
      sc.script.cueScript,
      s.cueState,
      input.text,
      matcher,
      turns.filter((t) => t.speaker === 'patient').map((t) => String(t.text ?? '')),
    );
    const message = buildResidentMessage(
      input.text,
      decision.cue,
      interrupted ? { heard: heard ?? '' } : undefined,
    );

    // Streaming: send each finished sentence (and its voice) while Claude writes the rest.
    let voicer: SentenceVoicer | null = null;
    let voiceId: string | null = s.voiceId ?? null;
    let onText: OnText | undefined;
    // Where the time goes, for tuning (stored on the patient turn).
    const timing: Record<string, number> = { preMs: Date.now() - t0 };
    let finishStream: ((finalText: string) => Promise<void>) | undefined;
    if (opts.send) {
      let voiceReady: Promise<string | null> | null = null;
      if (opts.voice && !input.live) {
        const voice = opts.voice;
        voiceReady = consumeQuota(db, me.uid, 'voice')
          .then(async () => {
            voiceId ??= await voice.voiceId(sc.briefing.persona.pronouns, s.scenarioId);
            return voiceId;
          })
          .catch((e: unknown) => {
            console.warn('voice unavailable', e instanceof Error ? e.message : e);
            return null;
          });
      }
      let delivery: Delivery = NEUTRAL;
      const send = opts.send;
      voicer = new SentenceVoicer(
        send,
        voiceReady
          ? async (text) => {
              const id = await voiceReady;
              if (!id) throw new Error('no voice');
              return opts.voice!.synthesize(id, text, delivery);
            }
          : null,
      );
      // The first piece is voiced at the first clause, so the patient starts sooner.
      const splitter = new SentenceSplitter({ firstClauseMinWords: 4 });
      let started = false;
      let streamed = '';
      onText = (soFar: string, prefix: Record<string, unknown> | null) => {
        streamed = soFar;
        if (!started) {
          started = true;
          timing.firstTextMs = Date.now() - t0;
          const meta = streamedDelivery(prefix, decision.cue);
          delivery = meta.delivery;
          void send({ t: 'meta', ...meta });
        }
        for (const sentence of splitter.take(soFar)) {
          const clean = stripStageDirections(sentence);
          if (clean) voicer!.add(clean);
        }
      };
      finishStream = async (finalText: string) => {
        // Speak whatever is left (everything, if nothing streamed).
        for (const sentence of splitter.take(streamed || finalText, true)) {
          const clean = stripStageDirections(sentence);
          if (clean) voicer!.add(clean);
        }
        await voicer!.flush().catch(() => undefined);
        await send({ t: 'end', sentences: voicer!.sentences }).catch(() => undefined);
      };
    }

    const result = await brain.reply(
      {
        model: s.patientModel,
        system: buildPatientSystemPrompt(sc.briefing, sc.script),
        history: turns
          .filter((t) => t.idx > 0)
          .map((t) => ({
            speaker: t.speaker,
            content: t.speaker === 'resident' ? t.prompt : patientHistoryText(t),
          })),
        message,
        cue: decision.cue,
      },
      onText,
    );
    await finishStream?.(result.utterance.text);
    const voiced = !!voicer && voicer.sentences > 0 && voicer.voiced === voicer.sentences;

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
      responseGapMs: input.responseGapMs ?? null,
      words: decision.turnFacts.words,
      jargonCount: decision.turnFacts.jargonCount,
      understandingCheck: decision.turnFacts.understandingCheck,
      // What this turn was responding to, for cue scoring later.
      afterPatientCueId: prevPatient?.cueId ?? null,
      afterPatientQuestion: prevPatient?.askedQuestion ?? false,
      createdAt: FieldValue.serverTimestamp(),
    });
    // The wait the app caused before the previous patient reply, measured by the app,
    // and whether the resident talked over it.
    if (prevPatient) {
      const said = spokenUpdate(prevPatient, {
        spoken: input.prevSpoken,
        cutOff: interrupted ? { heard: heard ?? '' } : null,
      });
      const update = {
        ...(prevPatient.idx > 0 && input.prevAppWaitMs != null
          ? { appWaitMs: input.prevAppWaitMs }
          : {}),
        ...said,
      };
      if (Object.keys(update).length)
        batch.update(ref.collection('turns').doc(String(prevPatient.idx)), update);
    }
    batch.set(ref.collection('turns').doc(String(pIdx)), {
      idx: pIdx,
      speaker: 'patient',
      ...result.utterance,
      raw: result.raw,
      model: result.model,
      latencyMs: result.latencyMs,
      usage: result.usage,
      timing: {
        ...timing,
        ...(voicer?.firstAudioAt ? { firstAudioMs: voicer.firstAudioAt - t0 } : {}),
        totalMs: Date.now() - t0,
      },
      voicedInStream: voiced,
      // So this exchange can be replaced if the resident keeps talking.
      cueStateBefore: s.cueState,
      createdAt: FieldValue.serverTimestamp(),
    });
    const mode = s.inputMode && s.inputMode !== input.source ? 'mixed' : input.source;
    batch.update(ref, {
      turnCount: pIdx + 1,
      cueState: decision.next,
      pending: false,
      inputMode: mode,
      lastActivityAt: FieldValue.serverTimestamp(),
      ...(voiceId && !s.voiceId ? { voiceId } : {}),
      ...(input.live ? { liveTurns: FieldValue.increment(1) } : {}),
    });
    await batch.commit();
    return { patient: { idx: pIdx, ...result.utterance }, latencyMs: result.latencyMs, voiced };
  } catch (e) {
    await ref.update({ pending: false }).catch(() => undefined);
    if (e instanceof HttpsError) throw e;
    console.error('patientTurn failed', e);
    throw new HttpsError('unavailable', 'The patient didn’t answer. Please try again.');
  }
}

// ---------- GPT-Live answered on its own ----------

const exchangeInput = z.object({
  sessionId: z.string().min(1).max(64),
  /** What the resident said. */
  resident: z.string().trim().min(1).max(LIMITS.maxTurnChars),
  /** What GPT-Live said back, without asking Claude. */
  patient: z.string().trim().max(4000),
});

/**
 * Saves an exchange GPT-Live handled itself (it replied without asking us for
 * the line), so the conversation is still complete for review and scoring.
 * The patient turn is marked `selfReply` (no scripted cue, no Claude).
 */
export async function saveLiveExchange(
  db: Firestore,
  caller: Caller | null,
  data: unknown,
  director: Director | null = null,
) {
  const me = requireMember(caller);
  const input = parse(exchangeInput, data);
  const ref = db.doc(`sessions/${input.sessionId}`);
  await consumeQuota(db, me.uid, 'patientTurns');
  const first = (await ref.get()).data() as SessionDoc | undefined;
  const [sc, prior] = await Promise.all([
    first ? loadScenario(db, first.scenarioId, first.scenarioVersion) : null,
    ref.collection('turns').orderBy('idx').get(),
  ]);
  const saved = await db.runTransaction(async (tx) => {
    const s = (await tx.get(ref)).data() as SessionDoc | undefined;
    if (!s || s.uid !== me.uid) throw new HttpsError('not-found', 'Session not found.');
    if (s.status !== 'live')
      throw new HttpsError('failed-precondition', 'This conversation has ended.');
    if (s.voiceMode !== 'live')
      throw new HttpsError('failed-precondition', 'Live voice is off for this conversation.');
    if (s.pending) throw new HttpsError('aborted', 'The patient is still answering.');
    // Steer mode: did the patient just perform the cue the last note asked for?
    const directed = s.directedCueId
      ? sc?.script.cueScript.find((c) => c.id === s.directedCueId)
      : undefined;
    const squash = (t: string) =>
      t
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
    const performed =
      directed &&
      input.patient &&
      (cueAlreadyCovered(directed, [input.patient]) ||
        squash(input.patient).includes(squash(directed.performance.say)))
        ? directed
        : null;
    const patientSaid = [
      ...prior.docs.filter((d) => d.get('speaker') === 'patient').map((d) => String(d.get('text'))),
      input.patient,
    ];
    // Which cue (if any) should come next, given what the resident just said.
    const decision = decideCue(
      sc && s.liveBrain !== 'claude' ? sc.script.cueScript : [],
      s.cueState,
      input.resident,
      matcher,
      patientSaid,
    );
    const facts = decision.turnFacts;
    const rIdx = s.turnCount;
    const pIdx = rIdx + 1;
    tx.set(ref.collection('turns').doc(String(rIdx)), {
      idx: rIdx,
      speaker: 'resident',
      text: input.resident,
      prompt: input.resident,
      source: 'voice',
      ...facts,
      afterPatientCueId: null,
      afterPatientQuestion: false,
      createdAt: FieldValue.serverTimestamp(),
    });
    const said = input.patient || '…';
    const utterance: PatientUtterance = {
      text: said,
      askedQuestion: /\?\s*$/.test(said),
      delivery: NEUTRAL,
      nonverbal: [],
    };
    tx.set(ref.collection('turns').doc(String(pIdx)), {
      idx: pIdx,
      speaker: 'patient',
      ...utterance,
      raw: JSON.stringify(utterance),
      selfReply: true,
      liveSpokenText: said,
      ...(performed ? { cueId: performed.id } : {}),
      cueStateBefore: s.cueState,
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.update(ref, {
      turnCount: pIdx + 1,
      cueState: decision.next,
      directedCueId: decision.cue?.id ?? null,
      lastActivityAt: FieldValue.serverTimestamp(),
      liveSelfReplies: FieldValue.increment(1),
    });
    return { residentIdx: rIdx, patientIdx: pIdx, cue: decision.cue };
  });
  // Steer mode: a private note for the patient's next reply (never blocks the call),
  // and the patient's mood (for the video avatar).
  let note: string | null = null;
  let mood: Mood = first?.mood ?? 'guarded';
  if (director && sc && first?.liveBrain !== 'claude') {
    const transcript = [
      ...prior.docs
        .map((d) => d.data())
        .filter((t) => t.idx > 0 || t.speaker === 'patient')
        .map((t) => ({ speaker: t.speaker as 'resident' | 'patient', text: String(t.text ?? '') })),
      { speaker: 'resident' as const, text: input.resident },
      { speaker: 'patient' as const, text: input.patient },
    ];
    const out = await director
      .direct({
        briefing: sc.briefing,
        script: sc.script,
        transcript,
        cue: saved.cue,
        mood,
      })
      .catch((e: unknown) => {
        console.warn('director note failed', e instanceof Error ? e.message : e);
        return null;
      });
    note = out?.note ?? null;
    if (out && out.mood !== mood) {
      mood = stepToward(mood, out.mood);
      await ref.update({ mood }).catch(() => undefined);
    }
  }
  return {
    residentIdx: saved.residentIdx,
    patientIdx: saved.patientIdx,
    note,
    mood,
    // For an app that hasn't updated yet.
    atEase: MOODS.indexOf(mood) >= MOODS.indexOf('at_ease'),
  };
}

// ---------- what was actually said ----------

const heardInput = z.object({
  sessionId: z.string().min(1).max(64),
  /** The patient turn. */
  idx: z.number().int().nonnegative(),
  /** GPT-Live's transcript of what the patient said out loud. */
  spoken: z.string().max(4000).nullish(),
  /** The resident cut in: only this much was said. */
  cutOff: z.object({ heard: z.string().max(2000) }).nullish(),
  /** Late words from the resident that belong to the turn before this reply. */
  residentAppend: z.string().max(2000).nullish(),
});

/**
 * Saves what the patient actually said (and late resident words) as soon as
 * it's known, so it survives a reload or an immediate End.
 */
export async function saveHeard(db: Firestore, caller: Caller | null, data: unknown) {
  const me = requireMember(caller);
  const input = parse(heardInput, data);
  const ref = db.doc(`sessions/${input.sessionId}`);
  await db.runTransaction(async (tx) => {
    const s = (await tx.get(ref)).data() as SessionDoc | undefined;
    if (!s || s.uid !== me.uid) throw new HttpsError('not-found', 'Session not found.');
    if (s.status !== 'live')
      throw new HttpsError('failed-precondition', 'This conversation has ended.');
    const pRef = ref.collection('turns').doc(String(input.idx));
    const rRef = ref.collection('turns').doc(String(input.idx - 1));
    const [pSnap, rSnap] = await Promise.all([
      tx.get(pRef),
      input.residentAppend && input.idx > 0 ? tx.get(rRef) : Promise.resolve(null),
    ]);
    // The turn may have been replaced (the resident kept talking): nothing to do.
    if (pSnap.get('speaker') !== 'patient') return;
    const update = spokenUpdate(pSnap.data()!, input);
    if (update) tx.update(pRef, update);
    const extra = input.residentAppend?.trim();
    if (extra && rSnap?.get('speaker') === 'resident') {
      tx.update(rRef, {
        text: `${String(rSnap.get('text') ?? '')} ${extra}`.trim(),
        lateText: extra,
      });
    }
  });
  return { ok: true };
}

// ---------- end ----------

/** Counts by name (cue or reason): a handful of short names. */
const counts = z
  .record(z.string().max(40), z.number().int().nonnegative().max(10_000))
  .refine((r) => Object.keys(r).length <= 30, 'too many names');
const endInput = z.object({
  sessionId: z.string().min(1).max(64),
  /** How often body-language clips played, and why others didn't (for tuning). */
  bodyStats: z
    .object({
      shown: counts,
      skipped: counts,
      stillWaitMs: z
        .number()
        .int()
        .nonnegative()
        .max(24 * 3600 * 1000),
      relaxed: z.boolean(),
    })
    .nullish(),
  audioExt: z.enum(['webm', 'm4a', 'mp4', 'ogg']).nullish(),
  /** Seconds the resident spent waiting on the app; left out of practice time. */
  appWaitSec: z
    .number()
    .int()
    .nonnegative()
    .max(24 * 3600)
    .nullish(),
});

export async function endSession(
  db: Firestore,
  caller: Caller | null,
  data: unknown,
  audioExists: (path: string) => Promise<boolean>,
) {
  const me = requireMember(caller);
  const { sessionId, audioExt, appWaitSec, bodyStats } = parse(endInput, data);
  const ref = db.doc(`sessions/${sessionId}`);
  const snap = await ref.get();
  const s = snap.data() as SessionDoc | undefined;
  if (!s || s.uid !== me.uid) throw new HttpsError('not-found', 'Session not found.');

  const update: Record<string, unknown> = {};
  if (bodyStats) update.bodyStats = bodyStats;
  if (s.status === 'live') {
    const durationSec = Math.round((Date.now() - s.startedAt.toMillis()) / 1000);
    Object.assign(update, {
      status: 'ended',
      endedAt: FieldValue.serverTimestamp(),
      durationSec,
      ...(appWaitSec != null ? { appWaitSec: Math.min(appWaitSec, durationSec) } : {}),
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
