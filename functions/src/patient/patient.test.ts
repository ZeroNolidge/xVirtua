import { describe, expect, it } from 'vitest';
import { SEED_SCENARIOS } from '@plainspeak/shared/seed';
import { finishSentence, parsePatientReply } from './schema.js';
import { applyCue } from './brain.js';
import { buildPatientSystemPrompt, buildResidentMessage } from './prompt.js';

const sc = SEED_SCENARIOS[0]!;
const cue = sc.script.cueScript[0]!;
const reply = {
  text: 'Okay.',
  askedQuestion: false,
  cueId: null,
  delivery: { emotion: 'neutral', volume: 'normal', rate: 'normal', pauseBeforeMs: 9000 },
  nonverbal: ['nod', 'nod'],
};

describe('parsePatientReply', () => {
  it('validates, clamps pauses and dedupes nonverbal cues', () => {
    const u = parsePatientReply(JSON.stringify(reply));
    expect(u.delivery.pauseBeforeMs).toBe(5000);
    expect(u.nonverbal).toEqual(['nod']);
    expect(u.cueId).toBeUndefined();
  });

  it('rejects malformed output', () => {
    expect(() => parsePatientReply('not json')).toThrow();
    expect(() =>
      parsePatientReply(
        JSON.stringify({ ...reply, delivery: { ...reply.delivery, emotion: 'ecstatic' } }),
      ),
    ).toThrow();
    expect(() => parsePatientReply(JSON.stringify({ ...reply, text: '' }))).toThrow();
  });
});

describe('applyCue', () => {
  it('forces the scripted cue id, delivery and nonverbal cues', () => {
    const u = applyCue(parsePatientReply(JSON.stringify(reply)), cue);
    expect(u.cueId).toBe(cue.id);
    expect(u.delivery.volume).toBe('quiet');
    expect(u.delivery.pauseBeforeMs).toBe(2500);
    expect(u.nonverbal).toEqual(['look_away']);
  });

  it('strips a cue id the model invented when no cue was due', () => {
    const u = applyCue(parsePatientReply(JSON.stringify({ ...reply, cueId: 'made-up' })), null);
    expect(u.cueId).toBeUndefined();
  });
});

describe('prompts', () => {
  it('system prompt carries persona, hidden concern and literacy', () => {
    const p = buildPatientSystemPrompt(sc.briefing, sc.script);
    expect(p).toContain(sc.briefing.persona.name);
    expect(p).toContain(sc.script.hiddenConcern);
    expect(p).toContain('average health literacy');
    expect(p).not.toContain('undefined');
  });

  it('resident message quotes the resident and adds a director note only when a cue fires', () => {
    expect(buildResidentMessage('Hi there', null)).not.toContain('DIRECTOR NOTE');
    const m = buildResidentMessage('Hi """ there', cue);
    expect(m).toContain(`cueId: ${cue.id}`);
    expect(m).toContain(cue.performance.say);
    expect(m.match(/"""/g)?.length).toBe(2);
  });
});

describe('after a cut-off', () => {
  it('never trails off: a reply ending in a dash or "…" ends with a period', () => {
    expect(finishSentence('My dad had a stroke and I —')).toBe('My dad had a stroke and I.');
    expect(finishSentence('I just worry…')).toBe('I just worry.');
    expect(finishSentence('Okay?')).toBe('Okay?');
    expect(finishSentence('Sure thing')).toBe('Sure thing.');
    const u = parsePatientReply(JSON.stringify({ ...reply, text: 'Well, I was going to say —' }));
    expect(u.text).toBe('Well, I was going to say.');
  });

  it('tells the patient to answer the resident, not pick the old sentence back up', () => {
    const m = buildResidentMessage('Sorry, go on.', null, { heard: 'My dad had a' });
    expect(m).toContain('You only got to say: "My dad had a"');
    expect(m).toContain("Don't pick that sentence back up where it stopped");
  });
});
