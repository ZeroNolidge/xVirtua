import { describe, expect, it, vi } from 'vitest';

vi.mock('./firebase', () => ({ db: {}, functions: {} }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => vi.fn() }));
const { withSeedWording } = await import('./jargon');

describe('withSeedWording', () => {
  it('a seeded copy shows the app’s current wording (BP, stroke)', () => {
    expect(
      withSeedWording('bp', { id: 'bp', term: 'bp', plain: ['blood pressure'], seeded: true }).term,
    ).toBe('BP');
    expect(
      withSeedWording('cardiovascular-risk', {
        id: 'cardiovascular-risk',
        term: 'cardiovascular risk',
        plain: ['heart risk'],
        seeded: true,
      }).plain,
    ).toEqual(['risk of heart attack and stroke']);
  });
  it('leaves a program’s own terms as they wrote them', () => {
    const own = { id: 'bp', term: 'bp', plain: ['pressure'], programId: 'irmc' };
    expect(withSeedWording('bp', own)).toEqual(own);
  });
});
