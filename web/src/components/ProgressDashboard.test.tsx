import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/firebase', () => ({ db: {} }));

const ts = (ms: number) => ({ toMillis: () => ms, toDate: () => new Date(ms) });
const sessions = [
  { id: 'a', status: 'ended', startedAt: ts(Date.now() - 2e8), feedbackBand: 'Solid' },
  { id: 'b', status: 'ended', startedAt: ts(Date.now() - 1e8), feedbackBand: 'Strong' },
];
/** Releases the per-session feedback reads (held until the test says so). */
let release!: () => void;
const areasReady = new Promise<void>((r) => (release = r));
const band = { band: 'Solid', summary: '', evidence: [], tryThisInstead: null };

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn(),
  limit: vi.fn(),
  orderBy: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  onSnapshot: (_q: unknown, next: (s: unknown) => void) => {
    next({ docs: sessions.map((s) => ({ id: s.id, data: () => s })) });
    return () => {};
  },
  getDoc: async () => {
    await areasReady;
    return {
      data: () => ({
        areas: { clarity: band, jargon: band, empathy: band, cue: band },
      }),
    };
  },
}));

const { ProgressDashboard } = await import('./ProgressDashboard');

describe('ProgressDashboard', () => {
  it('stays on Loading until each scored conversation’s areas arrive (no “no feedback” flash)', async () => {
    render(
      <MemoryRouter>
        <ProgressDashboard uid="u1" />
      </MemoryRouter>,
    );
    // Sessions are in, areas still pending.
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByText(/No feedback in this range/)).toBeNull();
    expect(screen.queryByText('with feedback')).toBeNull();

    await act(async () => release());
    expect(await screen.findByText('with feedback')).toBeInTheDocument();
    expect(screen.getAllByText('2')[0]).toBeInTheDocument();
    expect(screen.queryByText(/No feedback in this range/)).toBeNull();
  });
});
