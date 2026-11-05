import { describe, expect, it } from 'vitest';
import {
  closeJargonMatch,
  createJargonMatcher,
  normalize,
  scoreJargon,
  searchJargon,
  SEED_JARGON,
  JARGON_CATEGORIES,
} from './jargon.js';

const m = createJargonMatcher(SEED_JARGON);
const terms = (text: string) => m.find(text).map((h) => `${h.term}${h.explained ? '+' : ''}`);

describe('seed dictionary', () => {
  it('has at least 300 terms with unique ids, plain swaps and valid categories', () => {
    expect(SEED_JARGON.length).toBeGreaterThanOrEqual(300);
    const ids = new Set(SEED_JARGON.map((t) => t.id));
    expect(ids.size).toBe(SEED_JARGON.length);
    for (const t of SEED_JARGON) {
      expect(t.plain.length, t.term).toBeGreaterThan(0);
      expect(JARGON_CATEGORIES, t.term).toContain(t.category);
    }
  });

  it('plain alternatives are themselves jargon-free', () => {
    const offenders = SEED_JARGON.flatMap((t) =>
      t.plain.flatMap((p) => m.find(p).map((h) => `${t.term} -> "${p}" contains "${h.term}"`)),
    );
    expect(offenders).toEqual([]);
  });

  it('no surface form is claimed by two terms', () => {
    const seen = new Map<string, string>();
    const dupes: string[] = [];
    for (const t of SEED_JARGON) {
      for (const f of [t.term, ...t.variants]) {
        const k = normalize(f)
          .replace(/[^a-z0-9'/ ]/g, '')
          .trim();
        if (seen.has(k) && seen.get(k) !== t.id) dupes.push(`${k}: ${seen.get(k)} & ${t.id}`);
        seen.set(k, t.id);
      }
    }
    expect(dupes).toEqual([]);
  });
});

describe('matcher', () => {
  it('finds single words, phrases, abbreviations and plurals', () => {
    expect(terms('Your hypertension and lipids need work.')).toEqual(['hypertension', 'lipids']);
    expect(terms('We saw a myocardial infarction on the EKG.')).toEqual([
      'myocardial infarction',
      'EKG',
    ]);
    expect(terms('Take it PRN, or b.i.d. if needed.')).toEqual(['PRN', 'BID']);
    expect(terms('Statins help.')).toEqual(['statin']);
    expect(terms('Your A-fib is back.')).toEqual(['atrial fibrillation']);
  });

  it('prefers the longest match', () => {
    expect(terms('That is orthostatic hypotension.')).toEqual(['orthostatic hypotension']);
  });

  it('does not flag plain phrasing', () => {
    expect(terms('Your blood pressure is high, so let’s use a water pill.')).toEqual([]);
    expect(terms("I'm going to check your blood sugar.")).toEqual([]);
  });

  it('counts explained terms when allowed', () => {
    expect(terms('You have hypertension, which means high blood pressure.')).toEqual([
      'hypertension+',
    ]);
    expect(terms('High blood pressure, what we call hypertension, is common.')).toEqual([
      'hypertension+',
    ]);
    expect(terms('This is chronic, meaning long-lasting.')).toEqual(['chronic+']);
  });

  it('never treats always-swap words as explained', () => {
    expect(terms('We will utilize, which means use, a cuff.')).toEqual(['utilize']);
  });
});

describe('scoreJargon', () => {
  it('scores 100 with no jargon', () => {
    expect(scoreJargon([{ idx: 1, text: 'Your blood pressure is high.' }], m).score).toBe(100);
  });

  it('penalizes unique terms and repeats', () => {
    const r = scoreJargon(
      [
        { idx: 1, text: 'Your hypertension is uncontrolled.' },
        { idx: 3, text: 'Hypertension can cause a stroke. Take it PRN.' },
      ],
      m,
    );
    // hypertension x2 (1 repeat), uncontrolled, prn => 3 unique, 1 repeat
    expect(r.flagged.map((f) => f.term).sort()).toEqual(['PRN', 'hypertension', 'uncontrolled']);
    expect(r.score).toBe(100 - 24 - 2);
    expect(r.flagged.find((f) => f.term === 'hypertension')?.turns).toEqual([1, 3]);
  });

  it('later uses are fine once a term has been explained', () => {
    const r = scoreJargon(
      [
        { idx: 1, text: 'This is hypertension, which means high blood pressure.' },
        { idx: 3, text: 'Hypertension is common.' },
      ],
      m,
    );
    expect(r.score).toBe(100);
    expect(r.explained.map((e) => e.term)).toEqual(['hypertension']);
  });

  it('floors at 0', () => {
    const text =
      'Utilize prn bid qd qhs tid qid renal hepatic edema dyspnea syncope emesis myalgia.';
    expect(scoreJargon([{ idx: 1, text }], m).score).toBe(0);
  });
});

describe('searchJargon', () => {
  it('ranks exact and prefix matches first', () => {
    expect(searchJargon(SEED_JARGON, 'hypertension')[0]?.term).toBe('hypertension');
    expect(searchJargon(SEED_JARGON, 'hyperten')[0]?.term).toBe('hypertension');
    expect(searchJargon(SEED_JARGON, 'a1c')[0]?.term).toBe('hemoglobin A1c');
    expect(searchJargon(SEED_JARGON, 'PRN')[0]?.plain).toContain('as needed');
  });

  it('finds terms by their plain meaning too', () => {
    expect(searchJargon(SEED_JARGON, 'water pill').map((t) => t.term)).toContain('diuretic');
  });

  it('returns nothing for empty queries', () => {
    expect(searchJargon(SEED_JARGON, '  ')).toEqual([]);
  });
});

describe('how terms are written', () => {
  const termFor = (q: string) => searchJargon(SEED_JARGON, q)[0]?.term;
  it('shows abbreviations the way clinicians write them, whatever the case typed', () => {
    expect(termFor('ascvd')).toBe('ASCVD');
    expect(termFor('BP')).toBe('BP');
    expect(termFor('bp')).toBe('BP');
    expect(termFor('prn')).toBe('PRN');
    expect(termFor('Bid')).toBe('BID');
    expect(termFor('ldl')).toBe('LDL');
    expect(termFor('egfr')).toBe('eGFR');
    expect(termFor('hba1c')).toBe('hemoglobin A1c');
  });
  it('no term is left as a lower-case abbreviation', () => {
    const short = SEED_JARGON.filter(
      (t) => /^[a-z0-9]{2,5}$/.test(t.term) && !/[aeiouy]/.test(t.term),
    );
    expect(short.map((t) => t.term)).toEqual([]);
  });
});

describe('risk of heart attack and stroke', () => {
  it('cardiovascular and cardiac risk name stroke, not just the heart', () => {
    for (const q of ['cardiovascular risk', 'cardiac risk', 'metabolic syndrome']) {
      const t = searchJargon(SEED_JARGON, q)[0]!;
      expect(t.plain.join(' '), q).toMatch(/heart attack and stroke/);
    }
    expect(SEED_JARGON.flatMap((t) => t.plain).filter((p) => /\bheart risk\b/.test(p))).toEqual([]);
  });
});

describe('closeJargonMatch', () => {
  it('finds the word a spelling slip meant', () => {
    expect(closeJargonMatch(SEED_JARGON, 'hypertention')?.term).toBe('hypertension');
    expect(closeJargonMatch(SEED_JARGON, 'Hypertention')?.term).toBe('hypertension');
    expect(closeJargonMatch(SEED_JARGON, 'diabetis mellitus')?.term).toBe('diabetes mellitus');
  });
  it('leaves short or far-off words to the server', () => {
    expect(closeJargonMatch(SEED_JARGON, 'abcd')).toBeNull();
    expect(closeJargonMatch(SEED_JARGON, 'xylophone')).toBeNull();
  });
});
