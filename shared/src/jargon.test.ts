import { describe, expect, it } from 'vitest';
import {
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
      'ekg',
    ]);
    expect(terms('Take it PRN, or b.i.d. if needed.')).toEqual(['prn', 'bid']);
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
    expect(r.flagged.map((f) => f.term).sort()).toEqual(['hypertension', 'prn', 'uncontrolled']);
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
    expect(searchJargon(SEED_JARGON, 'a1c')[0]?.term).toBe('hemoglobin a1c');
    expect(searchJargon(SEED_JARGON, 'PRN')[0]?.plain).toContain('as needed');
  });

  it('finds terms by their plain meaning too', () => {
    expect(searchJargon(SEED_JARGON, 'water pill').map((t) => t.term)).toContain('diuretic');
  });

  it('returns nothing for empty queries', () => {
    expect(searchJargon(SEED_JARGON, '  ')).toEqual([]);
  });
});
