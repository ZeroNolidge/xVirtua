import { describe, expect, it } from 'vitest';
import { createJargonMatcher, scoreJargon, SEED_JARGON } from '@plainspeak/shared';
import {
  assembleScore,
  buildScoringPrompt,
  locateQuote,
  runScoring,
  steamrollHints,
  validateQuotes,
  type ClaudeScore,
  type Turn,
} from './score.js';

const turns: Turn[] = [
  { idx: 0, speaker: 'patient', text: 'So my blood pressure is high?', askedQuestion: true },
  {
    idx: 1,
    speaker: 'resident',
    text: 'Yes, you have hypertension. We should start a medication.',
    responseGapMs: 1200,
  },
  {
    idx: 2,
    speaker: 'patient',
    text: 'I drive a truck. Will I lose my license?',
    cueId: 'job-worry',
    askedQuestion: true,
  },
  {
    idx: 3,
    speaker: 'resident',
    text: 'That sounds really stressful. Most people keep their license.',
    understandingCheck: null,
  },
  { idx: 4, speaker: 'patient', text: 'Okay.' },
  {
    idx: 5,
    speaker: 'resident',
    text: 'Can you tell me in your own words what we will do?',
    understandingCheck: 'teachback',
  },
];

const m = (quote: string, turnIdx = 3) => ({
  score: 80,
  summary: 's',
  evidence: [{ turnIdx, quote, note: 'n' }],
  tryThisInstead: null,
});
const good: ClaudeScore = {
  jargonTryThisInstead: {
    turnIdx: 1,
    original: 'you have hypertension',
    rewrite: 'Your blood pressure is high.',
  },
  clarity: m('in your own words', 5),
  empathy: m('That sounds really stressful'),
  cue: {
    ...m('Most people keep their license'),
    cueResults: [
      {
        cueId: 'job-worry',
        patientTurnIdx: 2,
        addressed: true,
        residentTurnIdx: 3,
        quote: 'Most people keep their license',
      },
    ],
    steamrolls: [],
  },
  highlight: {
    metric: 'empathy',
    turnIdx: 3,
    quote: 'That sounds really stressful',
    note: 'Named the worry.',
  },
  fixes: [
    {
      metric: 'jargon',
      turnIdx: 1,
      quote: 'you have hypertension',
      note: 'Plain words.',
      rewrite: 'Your blood pressure is high.',
    },
  ],
};

describe('quote validation', () => {
  it('accepts verbatim quotes (ignoring case and punctuation) and fixes wrong turn numbers', () => {
    expect(locateQuote('that sounds REALLY stressful', 3, turns)).toBe(3);
    expect(locateQuote('That sounds really stressful', 1, turns)).toBe(3);
    expect(locateQuote('I drive a truck', 2, turns)).toBeNull(); // patient words don't count
    expect(locateQuote('something never said', 3, turns)).toBeNull();
  });

  it('drops made-up quotes and reports them', () => {
    const bad = { ...good, empathy: m('I totally understand your feelings') };
    const v = validateQuotes(bad, turns);
    expect(v.bad).toHaveLength(1);
    expect(v.score.empathy.evidence).toHaveLength(0);
  });

  it('retries once with the problems listed, then marks the score for review', async () => {
    const prompts: string[] = [];
    const bad = { ...good, highlight: { ...good.highlight, quote: 'made up' } };
    const scorer = async (_s: string, u: string) => {
      prompts.push(u);
      return { raw: JSON.stringify(bad), model: 'test' };
    };
    const r = await runScoring(scorer, { system: 's', user: 'u' }, turns);
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain('not in the transcript');
    expect(r.needsReview).toBe(true);

    const ok = await runScoring(
      async () => ({ raw: JSON.stringify(good), model: 't' }),
      { system: 's', user: 'u' },
      turns,
    );
    expect(ok.needsReview).toBe(false);
  });
});

describe('scoring prompt and result', () => {
  const jargon = scoreJargon(
    turns.filter((t) => t.speaker === 'resident').map((t) => ({ idx: t.idx, text: t.text })),
    createJargonMatcher(SEED_JARGON),
  );
  const cues = [
    {
      id: 'job-worry',
      cue: 'Hints he is worried about his job',
      trigger: { type: 'turn_index' as const, value: 1 },
      maxFires: 1,
      performance: { say: 'x', delivery: {}, nonverbal: [] },
      expectedResidentResponse: 'Acknowledge the worry and ask about it',
    },
  ];

  it('marks cues, app-free timing and understanding checks in the transcript', () => {
    const p = buildScoringPrompt({
      scenario: {
        title: 'New HTN',
        residentTask: 'Explain',
        learningObjectives: ['Teach-back'],
        patientName: 'Ray Kowalski',
      },
      cues,
      turns,
      jargon,
    });
    expect(p.user).toContain(
      '[T2] PATIENT (CUE job-worry: Hints he is worried about his job; asked a question)',
    );
    expect(p.user).toContain('began ~1.2s after Ray finished');
    expect(p.user).toContain('understanding check: teachback');
    expect(p.user).toContain('"hypertension"');
    expect(p.system).toMatch(/excludes any time the resident spent waiting on the app/);
  });

  it('builds the score doc: equal weights, highlight first, at most two fixes', () => {
    const doc = assembleScore({
      claude: { ...good, fixes: [...good.fixes, good.fixes[0]!, good.fixes[0]!] },
      jargon,
      turns,
      cues,
      weights: { jargon: 0.25, clarity: 0.25, empathy: 0.25, cue: 0.25 },
      needsReview: false,
      model: 'm',
      promptHash: 'h',
    });
    expect(doc.fixes).toHaveLength(2);
    expect(doc.highlight?.quote).toBe('That sounds really stressful');
    expect(doc.metrics.jargon.flagged.map((f) => f.term)).toContain('hypertension');
    expect(doc.overall).toBe(Math.round((jargon.score + 80 + 80 + 80) / 4));
    expect(doc.understandingCheck).toBe('teachback');
    expect(doc.metrics.cue.cueResults[0]).toMatchObject({
      cue: 'Hints he is worried about his job',
      addressed: true,
    });
  });

  it('flags a likely steamroll: long reply that ignores the question', () => {
    const long = Array.from({ length: 45 }, () => 'medication').join(' ');
    const t: Turn[] = [
      { idx: 0, speaker: 'patient', text: 'Will I lose my trucking license?', askedQuestion: true },
      { idx: 1, speaker: 'resident', text: long },
    ];
    expect(steamrollHints(t)).toEqual([{ patientTurnIdx: 0, residentTurnIdx: 1 }]);
    t[1] = { idx: 1, speaker: 'resident', text: `${long} and your license is safe` };
    expect(steamrollHints(t)).toEqual([]);
  });
});
