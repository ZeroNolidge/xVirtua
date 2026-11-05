import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/firebase', () => ({ db: {} }));
vi.mock('../lib/auth', () => ({
  useAuth: () => ({
    user: { uid: 'u1' },
    claims: { role: 'resident', programId: 'irmc' },
    userDoc: { email: 'r@example.com' },
    signOut: vi.fn(),
  }),
}));
vi.mock('../components/ProgressDashboard', () => ({ ProgressDashboard: () => null }));
vi.mock('../lib/scenarios', () => ({ useScenarioList: () => [] }));
vi.mock('../lib/patientProgress', () => ({ usePatientProgress: () => ({}) }));

const ts = (ms: number) => ({ toMillis: () => ms, toDate: () => new Date(ms) });
const day = 864e5;
const sessions = [
  {
    id: 'a',
    scenarioTitle: 'Spoke and ended',
    status: 'ended',
    turnCount: 2,
    startedAt: ts(Date.now() - 3 * day),
  },
  // Ray spoke, the resident never did; the server ended it.
  {
    id: 'b',
    scenarioTitle: 'Never spoke, ended',
    status: 'ended',
    turnCount: 1,
    startedAt: ts(Date.now() - 2 * day),
  },
  {
    id: 'c',
    scenarioTitle: 'Never spoke, too late',
    status: 'live',
    turnCount: 1,
    startedAt: ts(Date.now() - day),
  },
  {
    id: 'd',
    scenarioTitle: 'Never spoke, still open',
    status: 'live',
    turnCount: 1,
    startedAt: ts(Date.now() - 6e4),
    lastActivityAt: ts(Date.now() - 6e4),
  },
];
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  limit: vi.fn(),
  orderBy: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  onSnapshot: (_q: unknown, next: (s: unknown) => void) => {
    next({ docs: sessions.map((s) => ({ id: s.id, data: () => s })) });
    return () => {};
  },
}));

const { Progress } = await import('./Progress');

describe('Your history', () => {
  it('leaves out conversations the resident never spoke in, unless they can still continue', () => {
    render(
      <MemoryRouter>
        <Progress />
      </MemoryRouter>,
    );
    expect(screen.getByText('Spoke and ended')).toBeInTheDocument();
    expect(screen.getByText('Never spoke, still open')).toBeInTheDocument();
    expect(screen.queryByText('Never spoke, ended')).toBeNull();
    expect(screen.queryByText('Never spoke, too late')).toBeNull();
  });
});
