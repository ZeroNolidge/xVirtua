import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ResidentFeedback } from '@plainspeak/shared';
import { ScoreView } from './ScoreView';

const area = (
  band: ResidentFeedback['areas']['clarity']['band'],
  summary: string,
  rewrite?: string,
) => ({
  band,
  summary,
  evidence: [{ turnIdx: 3, quote: `${summary} quote`, note: 'n' }],
  tryThisInstead: rewrite ? { turnIdx: 3, original: 'orig', rewrite } : null,
});
const feedback: ResidentFeedback = {
  rubricVersion: '2026-11-v2',
  overall: { band: 'Getting there', trend: 'up' },
  highlight: {
    metric: 'empathy',
    turnIdx: 3,
    quote: 'That sounds really stressful',
    note: 'You named his worry.',
  },
  fixes: [
    {
      metric: 'cue',
      turnIdx: 5,
      quote: 'Let’s talk meds',
      note: 'He asked about his job.',
      rewrite: 'It sounds like your job is on your mind. Tell me more.',
    },
    {
      metric: 'jargon',
      turnIdx: 1,
      quote: 'hypertension',
      note: 'Say “high blood pressure”.',
      rewrite: 'Your blood pressure is high.',
    },
  ],
  areas: {
    jargon: {
      ...area('Solid', 'Mostly plain', 'per-area jargon rewrite'),
      flagged: [{ term: 'hypertension', plain: ['high blood pressure'], uses: 2 }],
      explained: [],
    },
    clarity: area('Getting there', 'Mostly clear', 'per-area clarity rewrite'),
    empathy: area('Strong', 'Warm'),
    cue: { ...area('Just starting', 'Missed a cue'), cueResults: [] },
  },
  createdAt: '2026-10-18T00:00:00Z',
};

describe('score screen', () => {
  it('shows a word and trend (no numbers), one strength, two fixes, the rest behind a tap', () => {
    const { container } = render(<ScoreView feedback={feedback} patientFirstName="Ray" />);
    expect(screen.getByText('Getting there, up from last time')).toBeInTheDocument();
    const headings = screen.getAllByRole('heading').map((h) => h.textContent);
    expect(headings).toEqual(['What went well', 'Two things to try next time']);
    expect(screen.getAllByText('Try saying this instead')).toHaveLength(1);
    // Per-area rewrites are folded away until asked for.
    expect(screen.queryByText(/per-area clarity rewrite/)).toBeNull();
    expect(container.textContent).not.toMatch(/\b\d{1,3}\b/);

    fireEvent.click(screen.getByRole('button', { name: 'See all suggestions' }));
    expect(screen.getByText('“per-area clarity rewrite”')).toBeInTheDocument();
    for (const w of ['Solid', 'Strong', 'Just starting'])
      expect(screen.getAllByText(w).length).toBeGreaterThan(0);
    expect(container.textContent).not.toMatch(/\b\d{2,3}\b/);
  });
});
