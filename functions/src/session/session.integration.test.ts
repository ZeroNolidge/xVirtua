import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { CONSENT_VERSION, DAILY_LIMITS, type PatientChunk } from '@plainspeak/shared';
import { dayKey } from '../lib/quota.js';
import { SEED_SCENARIOS } from '@plainspeak/shared/seed';
import { endSession, patientTurn, startSession } from './session.js';
import { FakeBrain } from '../patient/fakeBrain.js';
import type { Caller } from '../lib/callable.js';
import { startLiveCall } from '../voice/live.js';

const PROJECT_ID = 'demo-plainspeak';
let app: App;
let db: Firestore;
const resident: Caller = { uid: 'res1', claims: { role: 'resident', programId: 'irmc' } };
const otherResident: Caller = { uid: 'res2', claims: { role: 'resident', programId: 'irmc' } };
const faculty: Caller = { uid: 'fac1', claims: { role: 'faculty', programId: 'irmc' } };
const htn = SEED_SCENARIOS[0]!;

async function seedScenario(status: 'active' | 'draft') {
  const ref = db.doc(`scenarios/${htn.id}`);
  await ref.set({ programId: 'irmc', status, currentVersion: '1', title: htn.briefing.title });
  await ref.collection('versions').doc('1').set(htn.briefing);
  await ref.collection('versions').doc('1').collection('private').doc('script').set(htn.script);
}

beforeAll(() => {
  app = initializeApp({ projectId: PROJECT_ID }, 'session-test');
  db = getFirestore(app);
});
beforeEach(async () => {
  await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: 'DELETE' },
  );
  await db.doc('programs/irmc').set({ patientModel: 'claude-sonnet-5-5' });
  for (const u of ['res1', 'res2', 'fac1']) {
    await db.doc(`users/${u}`).set({ programId: 'irmc', consent: { version: CONSENT_VERSION } });
  }
  await seedScenario('active');
});
afterAll(async () => {
  await deleteApp(app);
});

describe('startSession', () => {
  it('creates a live session with the opening line as turn 0, using the program model', async () => {
    const r = await startSession(db, resident, { scenarioId: htn.id });
    expect(r.opening.text).toBe(htn.script.openingLine);
    expect(r.patientModel).toBe('claude-sonnet-5-5');
    const s = (await db.doc(`sessions/${r.sessionId}`).get()).data()!;
    expect(s).toMatchObject({
      uid: 'res1',
      programId: 'irmc',
      status: 'live',
      turnCount: 1,
      audioPath: null,
      persona: htn.briefing.persona,
    });
    // Retention: deleted after 3 years at most.
    const years = (s.deleteAfter.toMillis() - Date.now()) / (365.25 * 86400000);
    expect(years).toBeGreaterThan(2.9);
    expect(years).toBeLessThanOrEqual(3.01);
    expect((await db.doc(`sessions/${r.sessionId}/turns/0`).get()).get('speaker')).toBe('patient');
  });

  it('requires consent', async () => {
    await db.doc('users/res1').set({ programId: 'irmc', consent: null });
    await expect(startSession(db, resident, { scenarioId: htn.id })).rejects.toMatchObject({
      code: 'failed-precondition',
    });
  });

  it('only faculty can practice drafts, and only faculty can pick the model', async () => {
    await seedScenario('draft');
    await expect(startSession(db, resident, { scenarioId: htn.id })).rejects.toMatchObject({
      code: 'not-found',
    });
    const f = await startSession(db, faculty, { scenarioId: htn.id, model: 'claude-haiku-5-5' });
    expect(f.patientModel).toBe('claude-haiku-5-5');
    await seedScenario('active');
    await expect(
      startSession(db, resident, { scenarioId: htn.id, model: 'claude-haiku-5-5' }),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    const r = await startSession(db, resident, { scenarioId: htn.id });
    expect(r.patientModel).toBe('claude-sonnet-5-5');
  });
});

describe('patientTurn', () => {
  it('saves both turns, fires scripted cues, and records cue context for scoring', async () => {
    const brain = new FakeBrain();
    const { sessionId } = await startSession(db, resident, { scenarioId: htn.id });

    const r1 = await patientTurn(
      db,
      resident,
      { sessionId, text: 'Hi Ray. Your blood pressure is high.', source: 'typed' },
      brain,
    );
    expect(r1.patient.cueId).toBeUndefined();

    const r2 = await patientTurn(
      db,
      resident,
      { sessionId, text: 'I think we should start a pill for it.' },
      brain,
    );
    expect(r2.patient.cueId).toBe('job-worry');
    expect(brain.calls[1]!.message).toContain('DIRECTOR NOTE');
    expect(brain.calls[1]!.history.length).toBe(2); // resident 1 + patient 2

    const r3 = await patientTurn(
      db,
      resident,
      { sessionId, text: 'That is a fair worry. Treated blood pressure usually keeps your card.' },
      brain,
    );
    expect(r3.patient.idx).toBe(6);

    const turns = (
      await db.collection(`sessions/${sessionId}/turns`).orderBy('idx').get()
    ).docs.map((d) => d.data());
    expect(turns.map((t) => t.speaker)).toEqual([
      'patient',
      'resident',
      'patient',
      'resident',
      'patient',
      'resident',
      'patient',
    ]);
    expect(turns[5]).toMatchObject({ afterPatientCueId: 'job-worry', speaker: 'resident' });
    expect(turns[1]).toMatchObject({ source: 'typed', understandingCheck: null });
    const s = (await db.doc(`sessions/${sessionId}`).get()).data()!;
    expect(s.turnCount).toBe(7);
    expect(s.cueState.fired['job-worry']).toBe(1);
    expect(s.pending).toBe(false);
    expect(s.inputMode).toBe('mixed');
  });

  it('blocks other users, ended sessions and overlapping turns', async () => {
    const brain = new FakeBrain();
    const { sessionId } = await startSession(db, resident, { scenarioId: htn.id });
    await expect(
      patientTurn(db, otherResident, { sessionId, text: 'hi' }, brain),
    ).rejects.toMatchObject({ code: 'not-found' });
    await db.doc(`sessions/${sessionId}`).update({ pending: true });
    await expect(patientTurn(db, resident, { sessionId, text: 'hi' }, brain)).rejects.toMatchObject(
      { code: 'aborted' },
    );
    await db.doc(`sessions/${sessionId}`).update({ pending: false, status: 'ended' });
    await expect(patientTurn(db, resident, { sessionId, text: 'hi' }, brain)).rejects.toMatchObject(
      { code: 'failed-precondition' },
    );
  });

  it('times out old sessions and releases the lock when the brain fails', async () => {
    const { sessionId } = await startSession(db, resident, { scenarioId: htn.id });
    const failing = {
      reply: async () => {
        throw new Error('boom');
      },
    };
    await expect(
      patientTurn(db, resident, { sessionId, text: 'hi' }, failing),
    ).rejects.toMatchObject({ code: 'unavailable' });
    expect((await db.doc(`sessions/${sessionId}`).get()).get('pending')).toBe(false);
    expect((await db.collection(`sessions/${sessionId}/turns`).get()).size).toBe(1);
    await db
      .doc(`sessions/${sessionId}`)
      .update({ startedAt: Timestamp.fromMillis(Date.now() - 50 * 60000) });
    await expect(
      patientTurn(db, resident, { sessionId, text: 'hi' }, new FakeBrain()),
    ).rejects.toMatchObject({ code: 'deadline-exceeded' });
  });

  it('can be picked up after a crash: a stuck reply unlocks, idle conversations close', async () => {
    const { sessionId } = await startSession(db, resident, { scenarioId: htn.id });
    const ref = db.doc(`sessions/${sessionId}`);
    // App closed mid-reply 2 minutes ago: the lock is released.
    await ref.update({ pending: true, pendingAt: Timestamp.fromMillis(Date.now() - 120_000) });
    const r = await patientTurn(
      db,
      resident,
      { sessionId, text: 'Where were we?' },
      new FakeBrain(),
    );
    expect(r.patient.idx).toBe(2);
    // Idle for 40 minutes: closed.
    await ref.update({ lastActivityAt: Timestamp.fromMillis(Date.now() - 40 * 60000) });
    await expect(
      patientTurn(db, resident, { sessionId, text: 'hi' }, new FakeBrain()),
    ).rejects.toMatchObject({ code: 'deadline-exceeded' });
  });

  it('streams sentences with voice in order, then saves the turn and app-free timing', async () => {
    const { sessionId } = await startSession(db, resident, { scenarioId: htn.id });
    const chunks: PatientChunk[] = [];
    const spoken: string[] = [];
    const voice = {
      voiceId: async () => 'voice-1',
      synthesize: async (_id: string, text: string) => {
        spoken.push(text);
        // Later sentences finish first: order must still hold.
        await new Promise((r) => setTimeout(r, text.length % 3 === 0 ? 5 : 1));
        return new TextEncoder().encode(`mp3:${text}`).buffer as ArrayBuffer;
      },
    };
    const brain = {
      reply: async (
        _req: unknown,
        onText?: (t: string, p: Record<string, unknown> | null) => void,
      ) => {
        const prefix = {
          delivery: { emotion: 'worried', pauseBeforeMs: 400 },
          nonverbal: ['frown'],
        };
        const text = 'Oh no, that sounds bad. (frowns) Will I need pills forever? I hate pills.';
        for (let i = 1; i <= text.length; i++) onText?.(text.slice(0, i), prefix);
        return {
          utterance: {
            text: 'Oh no, that sounds bad. Will I need pills forever? I hate pills.',
            askedQuestion: true,
            delivery: {
              emotion: 'worried' as const,
              volume: 'normal' as const,
              rate: 'normal' as const,
              pauseBeforeMs: 400,
            },
            nonverbal: ['frown' as const],
          },
          raw: '{}',
          model: 'test',
          latencyMs: 3,
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        };
      },
    };
    const r = await patientTurn(
      db,
      resident,
      { sessionId, text: 'Your blood pressure is high.', source: 'typed', responseGapMs: 2100 },
      brain,
      { send: async (c) => void chunks.push(c), voice },
    );
    expect(r.voiced).toBe(true);
    expect(chunks[0]).toMatchObject({
      t: 'meta',
      nonverbal: ['frown'],
      delivery: { emotion: 'worried', pauseBeforeMs: 400 },
    });
    const says = chunks.filter((c) => c.t === 'say');
    expect(says.map((c) => c.text)).toEqual([
      'Oh no, that sounds bad.',
      'Will I need pills forever?',
      'I hate pills.',
    ]);
    expect(spoken.join(' ')).not.toContain('(frowns)');
    // Every sentence's audio follows its text, in order.
    const order = chunks
      .filter((c) => c.t !== 'meta')
      .map((c) => `${c.t}${'seq' in c ? c.seq : ''}`);
    expect(order).toEqual(['say0', 'audio0', 'say1', 'audio1', 'say2', 'audio2']);

    const s = (await db.doc(`sessions/${sessionId}`).get()).data()!;
    expect(s.voiceId).toBe('voice-1');
    const t1 = (await db.doc(`sessions/${sessionId}/turns/1`).get()).data()!;
    expect(t1.responseGapMs).toBe(2100);

    // The next turn reports how long the app made the resident wait for that reply.
    await patientTurn(
      db,
      resident,
      { sessionId, text: 'Let us talk about it.', prevAppWaitMs: 1800 },
      new FakeBrain(),
    );
    expect((await db.doc(`sessions/${sessionId}/turns/2`).get()).get('appWaitMs')).toBe(1800);
  });

  it('enforces the daily limit on patient replies', async () => {
    const { sessionId } = await startSession(db, resident, { scenarioId: htn.id });
    await db.doc(`usage/res1/days/${dayKey()}`).set({ patientTurns: DAILY_LIMITS.patientTurns });
    await expect(
      patientTurn(db, resident, { sessionId, text: 'hi' }, new FakeBrain()),
    ).rejects.toMatchObject({ code: 'resource-exhausted' });
  });
});

describe('endSession', () => {
  it('ends once, records duration, and attaches audio only if the upload exists', async () => {
    const { sessionId } = await startSession(db, resident, { scenarioId: htn.id });
    const exists = new Set<string>();
    await endSession(db, resident, { sessionId }, async (p) => exists.has(p));
    const s = (await db.doc(`sessions/${sessionId}`).get()).data()!;
    expect(s.status).toBe('ended');
    expect(typeof s.durationSec).toBe('number');

    await expect(
      endSession(db, resident, { sessionId, audioExt: 'webm' }, async (p) => exists.has(p)),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    const path = `audio/irmc/res1/${sessionId}/recording.webm`;
    exists.add(path);
    await endSession(db, resident, { sessionId, audioExt: 'webm' }, async (p) => exists.has(p));
    expect((await db.doc(`sessions/${sessionId}`).get()).get('audioPath')).toBe(path);
    await expect(
      endSession(db, otherResident, { sessionId }, async () => true),
    ).rejects.toMatchObject({ code: 'not-found' });
  });
});

describe('callable null handling', () => {
  it('accepts nulls for optional fields (how callable clients send missing values)', async () => {
    const { sessionId } = await startSession(db, resident, { scenarioId: htn.id, model: null });
    const r = await patientTurn(
      db,
      resident,
      { sessionId, text: 'Hello', source: 'typed', tStartMs: null, tEndMs: null },
      new FakeBrain(),
    );
    expect(r.patient.idx).toBe(2);
    await endSession(db, resident, { sessionId, audioExt: null }, async () => false);
  });
});

describe('two-way voice', () => {
  it('replaces an exchange whose reply never played, restoring the cue state', async () => {
    const brain = new FakeBrain();
    const { sessionId } = await startSession(db, resident, { scenarioId: htn.id });
    await patientTurn(db, resident, { sessionId, text: 'Hi Ray.' }, brain);
    // This one fires the "job worry" cue (mentions a pill)...
    const r = await patientTurn(db, resident, { sessionId, text: 'We could start a pill.' }, brain);
    expect(r.patient.cueId).toBe('job-worry');
    // ...but the resident kept talking before it played: replace that exchange.
    const r2 = await patientTurn(
      db,
      resident,
      {
        sessionId,
        text: 'We could start a pill. It is a small one, taken once a day.',
        supersedes: 3,
      },
      brain,
    );
    expect(r2.patient.idx).toBe(4);
    const turns = (
      await db.collection(`sessions/${sessionId}/turns`).orderBy('idx').get()
    ).docs.map((d) => d.data());
    expect(turns.map((t) => t.idx)).toEqual([0, 1, 2, 3, 4]);
    expect(turns[3]!.text).toBe('We could start a pill. It is a small one, taken once a day.');
    // The cue wasn't used up by the replaced reply, so it fires for the real one.
    expect(r2.patient.cueId).toBe('job-worry');
    const s = (await db.doc(`sessions/${sessionId}`).get()).data()!;
    expect(s.turnCount).toBe(5);
    expect(s.cueState.fired['job-worry']).toBe(1);
  });

  it('remembers when the resident talked over the patient, and the patient only "said" what was heard', async () => {
    const brain = new FakeBrain();
    const { sessionId } = await startSession(db, resident, { scenarioId: htn.id });
    await patientTurn(db, resident, { sessionId, text: 'Hi Ray.' }, brain);
    await patientTurn(
      db,
      resident,
      { sessionId, text: 'Sorry, go on.', prevInterrupted: { heard: 'Okay.' } },
      brain,
    );
    const p = (await db.doc(`sessions/${sessionId}/turns/2`).get()).data()!;
    expect(p).toMatchObject({ interrupted: true, heardText: 'Okay.' });
    const last = brain.calls.at(-1)!;
    expect(last.message).toContain('The resident talked over you');
    expect(last.history.at(-1)!.content).toContain('"text":"Okay. —"');
  });
});

describe('GPT-Live test mode', () => {
  const okFetch = (calls: { url: string; body: Record<string, unknown> }[]) =>
    (async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
      return new Response(JSON.stringify({ id: 'live_1', transport: { sdp: 'v=0 answer' } }), {
        status: 200,
      });
    }) as unknown as typeof fetch;

  it('is off unless the program (or faculty, per session) turns it on', async () => {
    const r = await startSession(db, resident, { scenarioId: htn.id });
    expect(r.voiceMode).toBe('standard');
    await expect(
      startLiveCall(
        db,
        resident,
        { sessionId: r.sessionId, sdp: 'v=0 offer....' },
        'sk-x',
        okFetch([]),
      ),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    await expect(
      startSession(db, resident, { scenarioId: htn.id, voiceMode: 'live' }),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    const f = await startSession(db, faculty, { scenarioId: htn.id, voiceMode: 'live' });
    expect(f.voiceMode).toBe('live');
  });

  it('connects the call with client delegation, the program voice, and no hidden script', async () => {
    await db.doc('programs/irmc').set({ voiceMode: 'live', liveVoice: 'cinder' }, { merge: true });
    const { sessionId, voiceMode } = await startSession(db, resident, { scenarioId: htn.id });
    expect(voiceMode).toBe('live');
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const r = await startLiveCall(
      db,
      resident,
      { sessionId, sdp: 'v=0 offer....' },
      'sk-x',
      okFetch(calls),
    );
    expect(r.sdp).toBe('v=0 answer');
    expect(calls[0]!.url).toBe('https://api.openai.com/v1/live/sessions');
    expect(calls[0]!.body).toMatchObject({
      model: 'gpt-live-1',
      delegation: { type: 'client' },
      audio: { output: { voice: 'cinder' } },
      transport: { type: 'webrtc', sdp: 'v=0 offer....' },
    });
    // GPT-Live only voices the patient: the hidden concern stays with Claude.
    expect(String(calls[0]!.body.instructions)).not.toContain(htn.script.hiddenConcern);
    expect((await db.doc(`sessions/${sessionId}`).get()).get('liveCalls')[0].id).toBe('live_1');
    // Someone else's session is not theirs to call.
    await expect(
      startLiveCall(db, otherResident, { sessionId, sdp: 'v=0 offer....' }, 'sk-x', okFetch([])),
    ).rejects.toMatchObject({ code: 'not-found' });
  });

  it('skips the Cartesia voice for live turns and keeps what GPT-Live actually said', async () => {
    await db.doc('programs/irmc').set({ voiceMode: 'live' }, { merge: true });
    const { sessionId } = await startSession(db, resident, { scenarioId: htn.id });
    let synthesized = 0;
    const voice = {
      voiceId: async () => 'v',
      synthesize: async () => {
        synthesized++;
        return new ArrayBuffer(4);
      },
    };
    const chunks: PatientChunk[] = [];
    const send = async (c: PatientChunk) => chunks.push(c);
    const brain = new FakeBrain();
    await patientTurn(db, resident, { sessionId, text: 'Hi Ray.', live: true }, brain, {
      send,
      voice,
    });
    expect(synthesized).toBe(0);
    expect(chunks.some((c) => c.t === 'say')).toBe(true);
    expect(chunks.some((c) => c.t === 'audio')).toBe(false);
    await patientTurn(
      db,
      resident,
      { sessionId, text: 'How are you?', live: true, prevSpoken: 'Hey doc, so my pressure is up?' },
      brain,
      { send, voice },
    );
    expect((await db.doc(`sessions/${sessionId}/turns/2`).get()).get('liveSpokenText')).toBe(
      'Hey doc, so my pressure is up?',
    );
  });
});
