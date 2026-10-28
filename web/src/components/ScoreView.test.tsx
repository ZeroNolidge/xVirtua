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
  it('shows the trend (no numbers), one strength, two fixes each with a rewrite, the rest behind a tap', () => {
    const fb = {
      ...feedback,
      fixes: [{ ...feedback.fixes[0]!, before: 'I drive a truck, you know.' }, feedback.fixes[1]!],
    };
    const { container } = render(<ScoreView feedback={fb} patientFirstName="Ray" />);
    expect(screen.getByText('Up from last time')).toBeInTheDocument();
    const headings = screen.getAllByRole('heading').map((h) => h.textContent);
    expect(headings).toEqual(['What went well', 'Two things to try next time']);
    expect(screen.getAllByText('Try saying this instead')).toHaveLength(2);
    expect(screen.getAllByText('You said:')).toHaveLength(3);
    expect(
      screen.getByText('Before this, Ray said: “I drive a truck, you know.”'),
    ).toBeInTheDocument();
    // Full scores are folded away until asked for.
    expect(screen.queryByText(/per-area clarity rewrite/)).toBeNull();
    expect(container.textContent).not.toMatch(/\b\d{1,3}\b/);

    fireEvent.click(screen.getByRole('button', { name: 'See full scores' }));
    expect(screen.getByText('“per-area clarity rewrite”')).toBeInTheDocument();
    for (const w of ['Solid', 'Strong', 'Just starting'])
      expect(screen.getAllByText(new RegExp(w)).length).toBeGreaterThan(0);
    // The flagged-word list isn't repeated here.
    expect(screen.queryByText(/hypertension →/)).toBeNull();
    expect(container.textContent).not.toMatch(/\b\d{2,3}\b/);
  });

  it('says nothing about a trend for a first conversation', () => {
    render(
      <ScoreView
        feedback={{ ...feedback, overall: { band: 'Solid', trend: 'first' } }}
        patientFirstName="Ray"
      />,
    );
    expect(screen.queryByLabelText('Compared with last time')).toBeNull();
  });
});
