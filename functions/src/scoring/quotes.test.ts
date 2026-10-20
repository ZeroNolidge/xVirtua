import { describe, expect, it } from 'vitest';
import { badInlineQuotes, findQuote, matchQuote } from './quotes.js';

const turns = [
  {
    idx: 1,
    speaker: 'resident' as const,
    text: 'So, um, your blood pressure is a little high today.',
  },
  { idx: 2, speaker: 'patient' as const, text: 'Will I lose my license? I drive a truck.' },
  { idx: 3, speaker: 'resident' as const, text: 'We will figure this out together, okay?' },
];

describe('matchQuote', () => {
  it('matches exactly, and returns the words as said', () => {
    expect(matchQuote('your blood pressure is a little high', turns[0]!.text)).toBe(
      'your blood pressure is a little high',
    );
  });

  it('allows small wording differences and gives back the exact words', () => {
    expect(matchQuote('So your blood pressure is a little high today', turns[0]!.text)).toBe(
      'So, um, your blood pressure is a little high today.',
    );
  });

  it('rejects quotes that were not said, and short quotes must be exact', () => {
    expect(matchQuote('your cholesterol is a little high today', turns[0]!.text)).toBeNull();
    expect(matchQuote('pressure is low', turns[0]!.text)).toBeNull();
  });

  it('matches pieces around "…" in order', () => {
    expect(matchQuote('We will figure … together', turns[2]!.text)).toBe(
      'We will figure … together',
    );
  });
});

describe('findQuote', () => {
  it('only accepts the named speaker, fixing the turn number', () => {
    expect(findQuote('We will figure this out together', 1, turns, 'resident')).toEqual({
      idx: 3,
      quote: 'We will figure this out together',
    });
    expect(findQuote('Will I lose my license?', 2, turns, 'resident')).toBeNull();
    expect(findQuote('Will I lose my license?', 2, turns, 'patient')?.idx).toBe(2);
  });
});

describe('quotes inside notes', () => {
  it('must have been said, by whoever the note names', () => {
    expect(
      badInlineQuotes('When Ray asked “Will I lose my license?” you moved on.', turns, 'Ray'),
    ).toEqual([]);
    // A scripted line Ray never said.
    expect(
      badInlineQuotes('Ray said “my dad had a stroke at my age” and you missed it.', turns, 'Ray'),
    ).toEqual(['my dad had a stroke at my age']);
    // Attributed to the wrong person.
    expect(badInlineQuotes('You said “I drive a truck”.', turns, 'Ray')).toEqual([
      'I drive a truck',
    ]);
  });
});
