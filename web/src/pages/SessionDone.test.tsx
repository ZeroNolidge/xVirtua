import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/firebase', () => ({ db: {}, functions: {} }));
vi.mock('../lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
vi.mock('../lib/session', () => ({ sessionApi: { score: vi.fn() } }));
vi.mock('../lib/errorReport', () => ({ reportError: vi.fn() }));

const ts = (ms: number) => ({ toMillis: () => ms, toDate: () => new Date(ms) });
let meta: Record<string, unknown> = {};
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn(),
  limit: vi.fn(),
  orderBy: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  getDoc: async () => ({ data: () => meta }),
  // Only Ray's opening line: the resident never spoke.
  getDocs: async () => ({
    docs: [{ id: 't0', data: () => ({ idx: 0, speaker: 'patient', text: 'Hi, doc.' }) }],
  }),
  onSnapshot: (_r: unknown, next: (s: unknown) => void) => {
    next({ exists: () => false });
    return () => {};
  },
}));

const { SessionDone } = await import('./SessionDone');

function renderDone() {
  return render(
    <MemoryRouter initialEntries={['/session/s1/done']}>
      <Routes>
        <Route path="/session/:id/done" element={<SessionDone />} />
        <Route path="/session/:id" element={<p>conversation screen</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const base = {
  uid: 'u1',
  scenarioId: 'ray',
  scenarioVersion: '1',
  persona: { name: 'Ray Kowalski', age: 58, pronouns: 'he/him' },
  turnCount: 1,
};

describe('a conversation the resident never spoke in', () => {
  beforeEach(() => {
    meta = {};
  });

  it('still open (only Ray’s opening line saved, as when it was opened and left): offers to continue it', async () => {
    const now = Date.now();
    meta = { ...base, status: 'live', startedAt: ts(now - 60e3), lastActivityAt: ts(now - 60e3) };
    renderDone();
    const go = await screen.findByRole('button', { name: 'Continue the conversation' });
    expect(screen.queryByText(/didn’t get going/)).toBeNull();
    expect(
      screen.getByText('This conversation is still open. Pick it up whenever you’re ready.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/left off/)).toBeNull();
    go.click();
    expect(await screen.findByText('conversation screen')).toBeInTheDocument();
  });

  it('too late to continue: Try again', async () => {
    meta = { ...base, status: 'ended', startedAt: ts(Date.now() - 864e5) };
    renderDone();
    expect(await screen.findByText(/didn’t get going/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /continue/i })).toBeNull();
  });
});
