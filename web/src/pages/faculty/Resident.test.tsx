import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../../lib/auth', () => ({
  useAuth: () => ({ claims: { role: 'faculty', programId: 'irmc' } }),
}));
vi.mock('../../lib/scenarios', () => ({ useScenarioList: () => [] }));
vi.mock('../../lib/patientProgress', () => ({ usePatientProgress: () => ({}) }));
const dashboards: { uid: string; programId?: string }[] = [];
vi.mock('../../components/ProgressDashboard', () => ({
  ProgressDashboard: (p: { uid: string; programId?: string }) => {
    dashboards.push(p);
    return <p>dashboard for {p.uid}</p>;
  },
}));
const queries: unknown[][] = [];
const ts = (ms: number) => ({ toMillis: () => ms, toDate: () => new Date(ms) });
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn(),
  getDoc: async () => ({ data: () => ({ displayName: 'Dr. Lee', email: 'lee@x.org' }) }),
  limit: vi.fn(),
  orderBy: vi.fn(),
  query: (...args: unknown[]) => {
    queries.push(args);
    return args;
  },
  where: (field: string, _op: string, value: unknown) => ({ field, value }),
  onSnapshot: (_q: unknown, next: (s: unknown) => void) => {
    const s = {
      id: 's1',
      scenarioTitle: 'New high blood pressure',
      status: 'ended',
      turnCount: 5,
      startedAt: ts(Date.now() - 864e5),
      feedbackBand: 'Solid',
    };
    next({ docs: [{ id: s.id, data: () => s }] });
    return () => {};
  },
}));

const { Resident } = await import('./Resident');

describe('faculty view of one resident', () => {
  it('their name, progress (scoped to the program), patients and conversations', async () => {
    render(
      <MemoryRouter initialEntries={['/faculty/residents/r1']}>
        <Routes>
          <Route path="/faculty/residents/:uid" element={<Resident />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { level: 1, name: 'Dr. Lee' })).toBeInTheDocument();
    expect(screen.getByText('dashboard for r1')).toBeInTheDocument();
    expect(dashboards[0]).toMatchObject({ uid: 'r1', programId: 'irmc' });
    // The history query carries the program (the rules need it for faculty).
    const field = (w: unknown) => (w as { field?: string } | undefined)?.field;
    const history = queries.find((q) => q.some((w) => field(w) === 'uid'))!;
    expect(history).toContainEqual({ field: 'programId', value: 'irmc' });
    expect(screen.getByRole('link', { name: /New high blood pressure/ })).toHaveAttribute(
      'href',
      '/session/s1/done',
    );
    expect(screen.getByText('Solid')).toBeInTheDocument();
  });
});
