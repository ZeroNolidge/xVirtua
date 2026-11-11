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
    expect(screen.getByText('A little higher than last time')).toBeInTheDocument();
    const headings = screen.getAllByRole('heading').map((h) => h.textContent);
    expect(headings).toEqual([
      'What went well',
      'Two things to try next time',
      'Your skills this time',
    ]);
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

  it('the circle graph opens an area when tapped, and shows last time behind it', () => {
    const { container } = render(
      <ScoreView
        feedback={feedback}
        patientFirstName="Ray"
        previous={{ jargon: 2, clarity: 2, empathy: 3, cue: 1 }}
      />,
    );
    expect(screen.getAllByText('Last time').length).toBeGreaterThan(0);
    expect(container.querySelector('.skill-shape .before')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Clear explaining/ }));
    expect(screen.getByText('“per-area clarity rewrite”')).toBeInTheDocument();
    expect(screen.getByText(/in a clear order/)).toBeInTheDocument();
    // Tapping it again closes it.
    fireEvent.click(screen.getByRole('button', { name: /Clear explaining/ }));
    expect(screen.queryByText('“per-area clarity rewrite”')).toBeNull();
    expect(container.textContent).not.toMatch(/\b\d{2,3}\b/);
  });

  it('celebrates completing the patient, or says what is left without giving the worry away', () => {
    const { rerender } = render(
      <ScoreView
        feedback={{
          ...feedback,
          completion: { status: 'completed', short: [], keyMoments: [], newlyReached: true },
        }}
        patientFirstName="Ray"
      />,
    );
    expect(screen.getByText('✓ You completed Ray!')).toBeInTheDocument();
    rerender(
      <ScoreView
        feedback={{
          ...feedback,
          completion: {
            status: null,
            short: ['cue'],
            keyMoments: [{ cue: null, addressed: false }],
            newlyReached: false,
          },
        }}
        patientFirstName="Ray"
      />,
    );
    expect(screen.getByText('To complete Ray')).toBeInTheDocument();
    expect(screen.getByText(/Reach Solid in Picking up on cues/)).toBeInTheDocument();
    expect(screen.getByText(/had something on their mind/)).toBeInTheDocument();
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

  it('uses the patient’s pronouns, and drops the “To complete” list once they’re already done', () => {
    const notDone = {
      ...feedback,
      completion: {
        status: null,
        short: ['cue' as const],
        keyMoments: [{ cue: null, addressed: false }],
        newlyReached: false,
      },
    };
    const { rerender } = render(
      <ScoreView feedback={notDone} patientFirstName="Ray" pronouns="he/him" />,
    );
    expect(
      screen.getByText(/Ray had something on his mind he didn’t get to share/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Ask what worries him\./)).toBeInTheDocument();
    rerender(
      <ScoreView
        feedback={notDone}
        patientFirstName="Ray"
        pronouns="he/him"
        patientStatus="mastered"
      />,
    );
    expect(screen.queryByText('To complete Ray')).toBeNull();
    expect(
      screen.getByText(
        /You’ve already mastered Ray\. This one didn’t reach Strong in every area, or his main worry\./,
      ),
    ).toBeInTheDocument();
    rerender(
      <ScoreView
        feedback={notDone}
        patientFirstName="Ray"
        pronouns="he/him"
        patientStatus="completed"
      />,
    );
    expect(
      screen.getByText(/You’ve already completed Ray\. This one didn’t reach Solid/),
    ).toBeInTheDocument();
  });

  it('says when the patient raised a worry himself', () => {
    render(
      <ScoreView
        feedback={{
          ...feedback,
          areas: {
            ...feedback.areas,
            cue: {
              ...feedback.areas.cue,
              cueResults: [
                {
                  cue: 'Worries about his driver card',
                  addressed: false,
                  quote: null,
                  raisedByPatient: true,
                },
              ],
            },
          },
        }}
        patientFirstName="Ray"
        pronouns="he/him"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'See full scores' }));
    fireEvent.click(screen.getByRole('button', { name: /Picking up on cues/ }));
    expect(screen.getAllByText(/he brought it up himself/).length).toBeGreaterThan(0);
  });
});
