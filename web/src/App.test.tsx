import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthStatus } from './lib/authStatus';

const state: { status: AuthStatus; role: 'resident' | 'faculty' } = {
  status: 'loading',
  role: 'resident',
};

vi.mock('./lib/firebase', () => ({ auth: {}, db: {}, functions: {}, usingEmulators: true }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  onSnapshot: vi.fn(() => () => {}),
}));
vi.mock('./lib/auth', () => ({
  useAuth: () => ({
    status: state.status,
    claims: { role: state.role, programId: 'irmc' },
    userDoc: { email: 'a@x.org' },
    user: null,
    error: null,
    signOut: vi.fn(),
    clearNotInvited: vi.fn(),
  }),
}));

const { App } = await import('./App');

function renderAt(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  state.role = 'resident';
});

describe('auth gate', () => {
  it.each<[AuthStatus, RegExp]>([
    ['signedOut', /welcome to plainspeak/i],
    ['claiming', /setting up your account/i],
    ['notInvited', /not on the list/i],
    ['needsConsent', /before you start/i],
    ['ready', /ready to practice/i],
  ])('%s shows the right screen', (status, text) => {
    state.status = status;
    renderAt();
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('consent screen mentions recording, CCC use and 3-year retention', () => {
    state.status = 'needsConsent';
    renderAt();
    expect(screen.getByText(/your voice is recorded/i)).toBeInTheDocument();
    expect(screen.getByText(/clinical competency committee/i)).toBeInTheDocument();
    expect(screen.getByText(/kept for 3 years/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /let’s go/i })).toBeDisabled();
  });

  it('hides the Faculty tab and route from residents', () => {
    state.status = 'ready';
    renderAt('/faculty');
    expect(screen.queryByRole('link', { name: 'Faculty' })).not.toBeInTheDocument();
    expect(screen.getByText(/ready to practice/i)).toBeInTheDocument();
  });

  it('shows the Faculty tab to faculty', () => {
    state.status = 'ready';
    state.role = 'faculty';
    renderAt('/faculty');
    expect(screen.getByRole('link', { name: 'Faculty' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /invite people/i })).toBeInTheDocument();
  });
});
