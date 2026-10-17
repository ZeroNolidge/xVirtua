import { describe, expect, it } from 'vitest';
import { SEED_SCENARIOS } from './scenarios.js';
import { EMOTIONS, NONVERBAL_CUES } from '../patient.js';

const TRIGGERS = [
  'resident_turn_words_gt',
  'jargon_in_turn_gte',
  'turn_index',
  'topic_mentioned',
  'no_understanding_check_for_turns',
];

describe('seed scenarios', () => {
  it('has the six required scenarios with unique ids', () => {
    expect(SEED_SCENARIOS.map((s) => s.id)).toEqual([
      'htn-new-diagnosis',
      't2dm-new-diagnosis',
      'statin-start',
      'new-med-side-effects',
      'abnormal-lab-followup',
      'smoking-cessation',
    ]);
  });

  it.each(SEED_SCENARIOS.map((s) => [s.id, s] as const))('%s is complete and valid', (_id, s) => {
    const b = s.briefing;
    expect(b.title && b.reasonForVisit && b.residentTask).toBeTruthy();
    expect(b.persona.age).toBeGreaterThan(17);
    expect([1, 2, 3]).toContain(b.difficulty);
    expect(b.learningObjectives.length).toBeGreaterThanOrEqual(3);
    expect(b.residentFacts.length).toBeGreaterThan(0);

    const sc = s.script;
    expect(['low', 'moderate', 'high']).toContain(sc.healthLiteracy);
    expect(sc.hiddenConcern && sc.openingLine && sc.emotionalState).toBeTruthy();
    expect(sc.cueScript.length).toBeGreaterThanOrEqual(3);
    const ids = sc.cueScript.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of sc.cueScript) {
      expect(TRIGGERS).toContain(c.trigger.type);
      expect(c.performance.say.length).toBeGreaterThan(0);
      expect(c.expectedResidentResponse.length).toBeGreaterThan(0);
      if (c.performance.delivery.emotion)
        expect(EMOTIONS).toContain(c.performance.delivery.emotion);
      for (const n of c.performance.nonverbal) expect(NONVERBAL_CUES).toContain(n);
    }
  });

  it('the resident-facing briefing never contains the hidden concern', () => {
    for (const s of SEED_SCENARIOS) {
      expect(JSON.stringify(s.briefing)).not.toContain(s.script.hiddenConcern);
    }
  });
});
