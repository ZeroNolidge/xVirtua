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
import { distinctFixes, withContext } from './feedback.js';
import { rewriteProblems } from './rewriteCheck.js';

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
  it('replaces a near-miss quote with the exact words, and drops quotes of the patient script', async () => {
    const scripted = {
      ...good,
      empathy: {
        ...good.empathy,
        summary: 'When Ray said “my dad had a stroke at fifty” you paused.',
      },
      fixes: [
        {
          metric: 'cue' as const,
          turnIdx: 3,
          quote: 'That sounds stressful. Most people keep their license',
          note: 'Ray said “I worry I will end up like my dad” and you moved on.',
          rewrite: 'Tell me more about your dad.',
        },
        good.fixes[0]!,
      ],
    };
    const scorer = async () => ({ raw: JSON.stringify(scripted), model: 'm' });
    const r = await runScoring(scorer, { system: 's', user: 'u' }, turns, 'Ray');
    // Asked again, still wrong: flagged for review and the bad parts are gone.
    expect(r.needsReview).toBe(true);
    expect(r.claude.fixes.map((f) => f.metric)).toEqual(['jargon']);
    expect(r.claude.empathy.summary).not.toContain('stroke');
    const fuzzy = validateQuotes(
      {
        ...good,
        highlight: { ...good.highlight, quote: 'That sounds so really stressful' },
      },
      turns,
      'Ray',
    );
    expect(fuzzy.bad).toEqual([]);
    expect(fuzzy.score.highlight.quote).toBe('That sounds really stressful.');
  });

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
    expect(p.user).toContain('[T2] PATIENT (CUE job-worry; asked a question)');
    // The cue's description is in the script section, never in the transcript.
    expect(p.user).toMatch(
      /script: cues that fired \(what Ray MIGHT say; this is NOT the transcript\)/,
    );
    const transcript = p.user.slice(p.user.indexOf('# Transcript'));
    expect(transcript).not.toContain('Hints he is worried about his job');
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

describe('fixes from two different areas', () => {
  const metric = (score: number, rewrite: string | null) => ({
    score,
    summary: `summary ${score}`,
    evidence: [],
    tryThisInstead: rewrite ? { turnIdx: 1, original: 'orig', rewrite } : null,
  });
  const metrics = {
    jargon: { ...metric(90, 'plain rewrite'), flagged: [], explained: [] },
    clarity: metric(60, 'clear rewrite'),
    empathy: metric(80, 'warm rewrite'),
    cue: { ...metric(50, 'cue rewrite'), cueResults: [], steamrolls: [] },
  };
  const fix = (m: 'cue' | 'clarity', q: string) => ({
    metric: m,
    turnIdx: 1,
    quote: q,
    note: 'n',
    rewrite: 'r',
  });

  it('swaps a same-area second fix for the top fix from the next-weakest area', () => {
    const out = distinctFixes({ fixes: [fix('cue', 'a'), fix('cue', 'b')], metrics });
    expect(out.map((f) => f.metric)).toEqual(['cue', 'clarity']);
    expect(out[1]).toMatchObject({ rewrite: 'clear rewrite', note: 'summary 60' });
  });

  it('fills a missing second fix and keeps different areas as they are', () => {
    expect(distinctFixes({ fixes: [fix('clarity', 'a')], metrics }).map((f) => f.metric)).toEqual([
      'clarity',
      'cue',
    ]);
    expect(
      distinctFixes({ fixes: [fix('clarity', 'a'), fix('cue', 'b')], metrics }).map((f) => f.quote),
    ).toEqual(['a', 'b']);
  });

  it('never shows a fix without something to say instead', () => {
    const { rewrite: _r, ...bare } = { ...fix('clarity', 'a'), turnIdx: 9 };
    const out = distinctFixes({ fixes: [bare, fix('cue', 'b')], metrics });
    expect(out.map((f) => f.quote)).toEqual(['b', 'orig']);
    expect(out.every((f) => f.rewrite)).toBe(true);
    // Same line as the area's own suggestion: it borrows that rewrite.
    const { rewrite: _r2, ...sameLine } = fix('clarity', 'a');
    expect(distinctFixes({ fixes: [sameLine], metrics })[0]).toMatchObject({
      quote: 'a',
      rewrite: 'clear rewrite',
    });
  });

  it('adds what the patient said just before each quoted line', () => {
    const out = withContext({ highlight: null, fixes: [fix('clarity', 'a')] }, turns);
    expect(out.fixes[0]!.before).toBe('So my blood pressure is high?');
  });
});

describe('rewrites must not add facts', () => {
  const said = 'Your blood pressure is high. We could start a small pill and check again soon.';
  it('flags licensing claims, drug names and numbers the resident never said', () => {
    expect(rewriteProblems('Don’t worry, you won’t lose your CDL license.', said).join()).toMatch(
      /licensing/,
    );
    expect(rewriteProblems('Let’s start lisinopril 10 mg.', said).join()).toMatch(
      /drug: "lisinopril"/,
    );
    expect(rewriteProblems('Let’s start lisinopril 10 mg.', said).join()).toMatch(/number: "10"/);
    expect(rewriteProblems('We’ll recheck in two weeks.', said).join()).toMatch(
      /number: "two weeks"/,
    );
    expect(rewriteProblems('Losartan works well.', said).join()).toMatch(/losartan/);
  });
  it('allows rephrasing what the resident did say', () => {
    expect(
      rewriteProblems(
        'Your blood pressure is high, so a small pill could help. Can you tell me in your own words what we’ll do?',
        said,
      ),
    ).toEqual([]);
    expect(
      rewriteProblems('I hear you. Let’s talk about what this means for your job.', said),
    ).toEqual([]);
    expect(rewriteProblems('We can check it again in April.', said)).toEqual([]);
  });
  it('allows a drug the resident named themselves', () => {
    expect(
      rewriteProblems('Lisinopril is a blood pressure pill.', 'I want to start lisinopril.'),
    ).toEqual([]);
  });
});

describe('interruptions in the scoring transcript', () => {
  it('shows where the resident cut the patient off and only what was heard', () => {
    const p = buildScoringPrompt({
      scenario: { title: 't', residentTask: 'x', learningObjectives: [], patientName: 'Ray K' },
      cues: [],
      turns: [
        { idx: 1, speaker: 'resident', text: 'Hi.' },
        {
          idx: 2,
          speaker: 'patient',
          text: 'My dad had a stroke and I worry that I will end up the same.',
          interrupted: true,
          heardText: 'My dad had a stroke',
        },
        { idx: 3, speaker: 'resident', text: 'Anyway, about your pills.' },
      ],
      jargon: { score: 100, flagged: [], explained: [] },
    });
    expect(p.user).toContain(
      '[T2] PATIENT (cut off: the resident talked over them): My dad had a stroke —',
    );
    expect(p.user).not.toContain('end up the same');
    expect(p.system).toMatch(/Talking over the patient/);
  });
});
