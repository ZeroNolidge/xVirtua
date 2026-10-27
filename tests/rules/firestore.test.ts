import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { actors, makeEnv } from './setup';

let env: RulesTestEnvironment;
let a: ReturnType<typeof actors>;

const program = {
  name: 'IRMC Rural FM',
  timezone: 'America/New_York',
  audioRetentionMonths: 36,
  transcriptRetentionMonths: 36,
  scoringWeights: { jargon: 0.25, clarity: 0.25, empathy: 0.25, cue: 0.25 },
  patientModel: 'claude-opus-5-5',
  currentRubricVersion: '2026-11-v1',
};

async function seed() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'programs/irmc'), program);
    await setDoc(doc(db, 'programs/other'), { ...program, name: 'Other' });
    for (const [uid, role, pid] of [
      ['resA', 'resident', 'irmc'],
      ['resB', 'resident', 'irmc'],
      ['facIrmc', 'faculty', 'irmc'],
      ['facOther', 'faculty', 'other'],
    ] as const) {
      const base = { programId: pid, role, email: `${uid}@x.org`, displayName: uid, consent: null };
      await setDoc(doc(db, `users/${uid}`), base);
      await setDoc(doc(db, `userProgress/${uid}`), { programId: pid, xp: 10 });
      await setDoc(doc(db, `userStats/${uid}`), { programId: pid, sessionsCompleted: 1 });
    }
    await setDoc(doc(db, 'invites/new@x.org'), {
      programId: 'irmc',
      role: 'resident',
      status: 'pending',
    });
    await setDoc(doc(db, 'sessions/sA'), { uid: 'resA', programId: 'irmc', status: 'scored' });
    await setDoc(doc(db, 'sessions/sA/turns/0'), { idx: 0, speaker: 'patient', text: 'Hi' });
    await setDoc(doc(db, 'sessions/sA/scores/2026-11-v1'), { overall: 70 });
    await setDoc(doc(db, 'sessions/sA/feedback/current'), {
      overall: { band: 'Solid', trend: 'up' },
    });
    await setDoc(doc(db, 'scenarios/htn'), { programId: 'irmc', status: 'active', title: 'HTN' });
    await setDoc(doc(db, 'scenarios/htn/versions/1'), { title: 'HTN' });
    await setDoc(doc(db, 'scenarios/htn/versions/1/private/script'), { hiddenConcern: 'secret' });
    await setDoc(doc(db, 'scenarios/draft1'), {
      programId: 'irmc',
      status: 'draft',
      title: 'Draft',
    });
    await setDoc(doc(db, 'scenarios/draft1/versions/1'), { title: 'Draft' });
    await setDoc(doc(db, 'jargonTerms/hypertension'), { term: 'hypertension', programId: null });
    await setDoc(doc(db, 'jargonTerms/otherOnly'), { term: 'x', programId: 'other' });
    await setDoc(doc(db, 'auditLog/l1'), { programId: 'irmc', action: 'play_audio' });
  });
}

beforeAll(async () => {
  env = await makeEnv();
  a = actors(env);
});
beforeEach(async () => {
  await env.clearFirestore();
  await seed();
});
afterAll(async () => {
  await env?.cleanup();
});

const fs = (ctx: { firestore: () => unknown }) =>
  ctx.firestore() as ReturnType<typeof a.anon.firestore>;

describe('unauthenticated and unclaimed users', () => {
  it('cannot read anything', async () => {
    for (const ctx of [a.anon, a.noClaims, a.badRole]) {
      await assertFails(getDoc(doc(fs(ctx), 'programs/irmc')));
      await assertFails(getDoc(doc(fs(ctx), 'users/resA')));
      await assertFails(getDoc(doc(fs(ctx), 'sessions/sA')));
      await assertFails(getDoc(doc(fs(ctx), 'jargonTerms/hypertension')));
    }
  });
});

describe('programs', () => {
  it('members can read their own program only', async () => {
    await assertSucceeds(getDoc(doc(fs(a.resA), 'programs/irmc')));
    await assertFails(getDoc(doc(fs(a.resA), 'programs/other')));
    await assertFails(getDoc(doc(fs(a.facultyOther), 'programs/irmc')));
  });

  it('faculty can update settings with valid values', async () => {
    await assertSucceeds(
      updateDoc(doc(fs(a.facultyIrmc), 'programs/irmc'), { audioRetentionMonths: 24 }),
    );
  });

  it('rejects invalid settings and protected fields', async () => {
    const ref = doc(fs(a.facultyIrmc), 'programs/irmc');
    await assertFails(updateDoc(ref, { audioRetentionMonths: 0 }));
    await assertFails(updateDoc(ref, { audioRetentionMonths: 1.5 }));
    await assertFails(updateDoc(ref, { patientModel: 'gpt-x' }));
    await assertFails(updateDoc(ref, { scoringWeights: { jargon: 1 } }));
    await assertFails(updateDoc(ref, { currentRubricVersion: 'hacked' }));
  });

  it('residents and other-program faculty cannot update', async () => {
    await assertFails(updateDoc(doc(fs(a.resA), 'programs/irmc'), { audioRetentionMonths: 24 }));
    await assertFails(
      updateDoc(doc(fs(a.facultyOther), 'programs/irmc'), { audioRetentionMonths: 24 }),
    );
  });

  it('only faculty of the program can change the patient model', async () => {
    for (const m of ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']) {
      await assertSucceeds(updateDoc(doc(fs(a.facultyIrmc), 'programs/irmc'), { patientModel: m }));
    }
    for (const who of [a.resA, a.resB, a.facultyOther, a.anon, a.noClaims]) {
      await assertFails(
        updateDoc(doc(fs(who), 'programs/irmc'), { patientModel: 'claude-haiku-5-5' }),
      );
    }
  });

  it('residents and other programs can’t change any voice setting', async () => {
    for (const who of [a.resA, a.resB, a.facultyOther, a.anon, a.noClaims]) {
      const ref = doc(fs(who), 'programs/irmc');
      await assertFails(updateDoc(ref, { voiceMode: 'live' }));
      await assertFails(updateDoc(ref, { liveVoice: 'cinder' }));
      await assertFails(updateDoc(ref, { liveVoices: { he: 'cinder' } }));
      await assertFails(updateDoc(ref, { liveBrain: 'claude' }));
      await assertFails(updateDoc(ref, { liveVoiceTags: { cinder: 'male' } }));
    }
  });

  it('faculty can switch the voice mode and live voice, to known values only', async () => {
    const ref = doc(fs(a.facultyIrmc), 'programs/irmc');
    await assertSucceeds(updateDoc(ref, { voiceMode: 'live', liveVoice: 'cinder' }));
    await assertSucceeds(updateDoc(ref, { voiceMode: 'standard' }));
    await assertFails(updateDoc(ref, { voiceMode: 'turbo' }));
    await assertFails(updateDoc(ref, { liveVoice: 'alloy' }));
    await assertSucceeds(updateDoc(ref, { liveVoices: { he: 'cinder', she: 'marin' } }));
    await assertFails(updateDoc(ref, { liveVoices: { he: 'alloy' } }));
    await assertFails(updateDoc(ref, { liveVoices: { robot: 'marin' } }));
    await assertSucceeds(updateDoc(ref, { liveBrain: 'claude' }));
    await assertFails(updateDoc(ref, { liveBrain: 'gpt' }));
    await assertSucceeds(updateDoc(ref, { liveVoiceTags: { cinder: 'male', marin: 'female' } }));
    await assertFails(updateDoc(ref, { liveVoiceTags: { alloy: 'male' } }));
    await assertFails(updateDoc(doc(fs(a.resA), 'programs/irmc'), { voiceMode: 'live' }));
  });

  it('nobody can create or delete programs from the client', async () => {
    await assertFails(setDoc(doc(fs(a.facultyIrmc), 'programs/new'), program));
    await assertFails(deleteDoc(doc(fs(a.facultyIrmc), 'programs/irmc')));
  });
});

describe('invites', () => {
  it('only same-program faculty can read', async () => {
    await assertSucceeds(getDoc(doc(fs(a.facultyIrmc), 'invites/new@x.org')));
    await assertSucceeds(
      getDocs(query(collection(fs(a.facultyIrmc), 'invites'), where('programId', '==', 'irmc'))),
    );
    await assertFails(getDoc(doc(fs(a.facultyOther), 'invites/new@x.org')));
    await assertFails(getDoc(doc(fs(a.resA), 'invites/new@x.org')));
  });

  it('nobody can write invites from the client', async () => {
    await assertFails(
      setDoc(doc(fs(a.facultyIrmc), 'invites/evil@x.org'), { programId: 'irmc', role: 'faculty' }),
    );
    await assertFails(
      setDoc(doc(fs(a.noClaims), 'invites/me@x.org'), { programId: 'irmc', role: 'faculty' }),
    );
  });
});

describe('users', () => {
  it('residents read only themselves; faculty read their program', async () => {
    await assertSucceeds(getDoc(doc(fs(a.resA), 'users/resA')));
    await assertFails(getDoc(doc(fs(a.resA), 'users/resB')));
    await assertSucceeds(getDoc(doc(fs(a.facultyIrmc), 'users/resA')));
    await assertFails(getDoc(doc(fs(a.facultyOther), 'users/resA')));
    await assertSucceeds(
      getDocs(query(collection(fs(a.facultyIrmc), 'users'), where('programId', '==', 'irmc'))),
    );
    await assertFails(getDocs(collection(fs(a.facultyIrmc), 'users')));
  });

  it('a user can change only their display name', async () => {
    const ref = doc(fs(a.resA), 'users/resA');
    await assertSucceeds(updateDoc(ref, { displayName: 'Dr. A' }));
    await assertFails(updateDoc(ref, { displayName: '' }));
    await assertFails(updateDoc(ref, { role: 'faculty' }));
    await assertFails(updateDoc(ref, { programId: 'other' }));
    await assertFails(updateDoc(ref, { consent: { version: 1, acceptedAt: 'now' } }));
    await assertFails(updateDoc(doc(fs(a.resA), 'users/resB'), { displayName: 'x' }));
  });

  it('nobody creates or deletes user docs from the client', async () => {
    await assertFails(
      setDoc(doc(fs(a.noClaims), 'users/stranger'), { role: 'faculty', programId: 'irmc' }),
    );
    await assertFails(deleteDoc(doc(fs(a.resA), 'users/resA')));
  });
});

describe('progress and stats (server-owned)', () => {
  it('readable by self and same-program faculty, never writable', async () => {
    for (const col of ['userProgress', 'userStats']) {
      await assertSucceeds(getDoc(doc(fs(a.resA), `${col}/resA`)));
      await assertFails(getDoc(doc(fs(a.resA), `${col}/resB`)));
      await assertSucceeds(getDoc(doc(fs(a.facultyIrmc), `${col}/resA`)));
      await assertFails(getDoc(doc(fs(a.facultyOther), `${col}/resA`)));
      await assertFails(setDoc(doc(fs(a.resA), `${col}/resA`), { programId: 'irmc', xp: 99999 }));
      await assertFails(updateDoc(doc(fs(a.facultyIrmc), `${col}/resA`), { xp: 0 }));
    }
  });
});

describe('sessions, turns, scores', () => {
  it('owner and same-program faculty can read the session, turns and word feedback', async () => {
    for (const ctx of [a.resA, a.facultyIrmc]) {
      await assertSucceeds(getDoc(doc(fs(ctx), 'sessions/sA')));
      await assertSucceeds(getDoc(doc(fs(ctx), 'sessions/sA/turns/0')));
      await assertSucceeds(getDoc(doc(fs(ctx), 'sessions/sA/feedback/current')));
    }
  });

  it('exact 0–100 scores are faculty-only: the resident cannot read their own numbers', async () => {
    await assertSucceeds(getDoc(doc(fs(a.facultyIrmc), 'sessions/sA/scores/2026-11-v1')));
    await assertFails(getDoc(doc(fs(a.resA), 'sessions/sA/scores/2026-11-v1')));
    await assertFails(getDocs(collection(fs(a.resA), 'sessions/sA/scores')));
  });

  it('other residents and other-program faculty cannot read', async () => {
    for (const ctx of [a.resB, a.facultyOther]) {
      await assertFails(getDoc(doc(fs(ctx), 'sessions/sA')));
      await assertFails(getDoc(doc(fs(ctx), 'sessions/sA/turns/0')));
      await assertFails(getDoc(doc(fs(ctx), 'sessions/sA/scores/2026-11-v1')));
      await assertFails(getDoc(doc(fs(ctx), 'sessions/sA/feedback/current')));
    }
  });

  it('list queries must be scoped to what the caller may see', async () => {
    await assertSucceeds(
      getDocs(query(collection(fs(a.resA), 'sessions'), where('uid', '==', 'resA'))),
    );
    await assertFails(
      getDocs(query(collection(fs(a.resA), 'sessions'), where('programId', '==', 'irmc'))),
    );
    await assertSucceeds(
      getDocs(query(collection(fs(a.facultyIrmc), 'sessions'), where('programId', '==', 'irmc'))),
    );
  });

  it('nobody can write sessions, turns or scores from the client', async () => {
    await assertFails(setDoc(doc(fs(a.resA), 'sessions/new'), { uid: 'resA', programId: 'irmc' }));
    await assertFails(updateDoc(doc(fs(a.resA), 'sessions/sA'), { status: 'scored' }));
    await assertFails(setDoc(doc(fs(a.resA), 'sessions/sA/turns/1'), { text: 'fake' }));
    await assertFails(setDoc(doc(fs(a.resA), 'sessions/sA/scores/2026-11-v1'), { overall: 100 }));
    await assertFails(setDoc(doc(fs(a.resA), 'sessions/sA/feedback/current'), { overall: null }));
    await assertFails(
      setDoc(doc(fs(a.facultyIrmc), 'sessions/sA/scores/2026-11-v1'), { overall: 0 }),
    );
  });
});

describe('scenarios', () => {
  it('residents see active scenarios in their program only', async () => {
    await assertSucceeds(getDoc(doc(fs(a.resA), 'scenarios/htn')));
    await assertSucceeds(getDoc(doc(fs(a.resA), 'scenarios/htn/versions/1')));
    await assertFails(getDoc(doc(fs(a.resA), 'scenarios/draft1')));
    await assertFails(getDoc(doc(fs(a.resA), 'scenarios/draft1/versions/1')));
  });

  it('faculty see drafts in their program', async () => {
    await assertSucceeds(getDoc(doc(fs(a.facultyIrmc), 'scenarios/draft1')));
    await assertSucceeds(getDoc(doc(fs(a.facultyIrmc), 'scenarios/draft1/versions/1')));
    await assertFails(getDoc(doc(fs(a.facultyOther), 'scenarios/htn')));
  });

  it('the patient script is faculty-only, even for active scenarios', async () => {
    await assertFails(getDoc(doc(fs(a.resA), 'scenarios/htn/versions/1/private/script')));
    await assertSucceeds(getDoc(doc(fs(a.facultyIrmc), 'scenarios/htn/versions/1/private/script')));
    await assertFails(getDoc(doc(fs(a.facultyOther), 'scenarios/htn/versions/1/private/script')));
    await assertFails(
      setDoc(doc(fs(a.facultyIrmc), 'scenarios/htn/versions/1/private/script'), {
        hiddenConcern: 'x',
      }),
    );
  });

  it('residents can list active scenarios but not drafts', async () => {
    const col = collection(fs(a.resA), 'scenarios');
    await assertSucceeds(
      getDocs(query(col, where('programId', '==', 'irmc'), where('status', '==', 'active'))),
    );
    await assertFails(getDocs(query(col, where('programId', '==', 'irmc'))));
    await assertSucceeds(
      getDocs(query(collection(fs(a.facultyIrmc), 'scenarios'), where('programId', '==', 'irmc'))),
    );
  });

  it('jargon list queries work for global and program terms', async () => {
    const col = collection(fs(a.resA), 'jargonTerms');
    await assertSucceeds(getDocs(query(col, where('programId', '==', null))));
    await assertSucceeds(getDocs(query(col, where('programId', '==', 'irmc'))));
    await assertFails(getDocs(query(col, where('programId', '==', 'other'))));
  });

  it('no client writes yet', async () => {
    await assertFails(
      setDoc(doc(fs(a.facultyIrmc), 'scenarios/new'), { programId: 'irmc', status: 'active' }),
    );
    await assertFails(updateDoc(doc(fs(a.resA), 'scenarios/draft1'), { status: 'active' }));
  });
});

describe('jargon dictionary', () => {
  it('global terms are readable by any member; program terms only by that program', async () => {
    await assertSucceeds(getDoc(doc(fs(a.resA), 'jargonTerms/hypertension')));
    await assertFails(getDoc(doc(fs(a.resA), 'jargonTerms/otherOnly')));
    await assertSucceeds(getDoc(doc(fs(a.facultyOther), 'jargonTerms/otherOnly')));
    await assertFails(
      setDoc(doc(fs(a.facultyIrmc), 'jargonTerms/new'), { term: 'x', programId: null }),
    );
  });
});

describe('audit log', () => {
  it('same-program faculty only, read-only', async () => {
    await assertSucceeds(getDoc(doc(fs(a.facultyIrmc), 'auditLog/l1')));
    await assertFails(getDoc(doc(fs(a.resA), 'auditLog/l1')));
    await assertFails(getDoc(doc(fs(a.facultyOther), 'auditLog/l1')));
    await assertFails(setDoc(doc(fs(a.facultyIrmc), 'auditLog/l2'), { programId: 'irmc' }));
  });
});

describe('server-only collections', () => {
  it('usage counters, lookup cache and crash reports are not readable or writable', async () => {
    for (const path of [
      'usage/resA',
      'usage/resA/days/2026-10-18',
      'plainWordCache/a1c',
      'clientErrors/x',
    ]) {
      for (const who of [a.resA, a.facultyIrmc]) {
        await assertFails(getDoc(doc(fs(who), path)));
        await assertFails(setDoc(doc(fs(who), path), { patientTurns: 0 }));
      }
    }
  });
});

describe('unknown collections', () => {
  it('are denied', async () => {
    await assertFails(getDoc(doc(fs(a.facultyIrmc), 'secrets/x')));
    await assertFails(setDoc(doc(fs(a.facultyIrmc), 'secrets/x'), { a: 1 }));
  });
});
