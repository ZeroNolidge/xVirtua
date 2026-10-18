import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ScoreDoc } from '@plainspeak/shared';
import { ScoreView } from './ScoreView';

const metric = (score: number, summary: string) => ({
  score,
  summary,
  evidence: [],
  tryThisInstead: null,
});
const score: ScoreDoc = {
  rubricVersion: '2026-11-v1',
  overall: 74,
  weights: { jargon: 0.25, clarity: 0.25, empathy: 0.25, cue: 0.25 },
  metrics: {
    jargon: {
      ...metric(84, 'Two medical words went unexplained.'),
      flagged: [{ term: 'hypertension', plain: ['high blood pressure'], uses: 2, turns: [1] }],
      explained: [],
    },
    clarity: metric(70, 'Mostly clear.'),
    empathy: metric(80, 'Warm.'),
    cue: { ...metric(62, 'Missed one cue.'), cueResults: [], steamrolls: [] },
  },
  highlight: {
    metric: 'empathy',
    turnIdx: 3,
    quote: 'That sounds really stressful',
    note: 'You named his worry.',
  },
  fixes: [
    {
      metric: 'clarity',
      turnIdx: 5,
      quote: 'Any questions?',
      note: 'Check what he understood.',
      rewrite: 'Can you tell me in your own words what we’ll do next?',
    },
    {
      metric: 'jargon',
      turnIdx: 1,
      quote: 'hypertension',
      note: 'Say “high blood pressure”.',
      rewrite: 'Your blood pressure is high.',
    },
    { metric: 'cue', turnIdx: 7, quote: 'third fix', note: 'never shown', rewrite: 'x' },
  ],
  understandingCheck: 'weak',
  needsReview: false,
  model: 'm',
  promptHash: 'h',
  createdAt: '2026-10-18T00:00:00Z',
};

describe('score screen', () => {
  it('leads with what went well, shows at most two fixes and one rewrite, full scores on tap', () => {
    render(<ScoreView score={score} patientFirstName="Ray" />);
    const headings = screen.getAllByRole('heading').map((h) => h.textContent);
    expect(headings[0]).toBe('What went well');
    expect(headings[1]).toBe('Two things to try next time');
    expect(screen.getByText('“That sounds really stressful”')).toBeInTheDocument();
    expect(screen.queryByText(/third fix/)).toBeNull();
    // One "try saying this instead" up front.
    expect(screen.getAllByText('Try saying this instead')).toHaveLength(1);
    expect(
      screen.getByText('“Can you tell me in your own words what we’ll do next?”'),
    ).toBeInTheDocument();
    // Full scores are one tap away.
    expect(screen.queryByText('74')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /see full scores/i }));
    expect(screen.getByText('74')).toBeInTheDocument();
    for (const label of ['Plain language', 'Clear explaining', 'Empathy', 'Picking up on cues']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getByText('hypertension')).toBeInTheDocument();
  });
});
