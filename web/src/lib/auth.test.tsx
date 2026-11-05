import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FirebaseError } from 'firebase/app';

// A plain function, not vi.fn(): a mock that returns a rejected promise is
// reported as unhandled by the test runner, even when the app handles it.
let failWith: Error = new Error('unset');
const claimInvite = () => Promise.reject(failWith);
vi.mock('./firebase', () => ({ auth: {}, db: {} }));
vi.mock('./api', () => ({ api: { claimInvite: () => claimInvite() } }));
vi.mock('./errorReport', () => ({ reportError: vi.fn() }));
vi.mock('firebase/firestore', () => ({ doc: vi.fn(), onSnapshot: vi.fn(() => () => undefined) }));
vi.mock('firebase/auth', () => ({
  // Signed in, no role yet: the app asks the server to apply the invite.
  onIdTokenChanged: (_a: unknown, cb: (u: unknown) => void) => {
    void cb({
      uid: 'u1',
      getIdTokenResult: async () => ({ claims: {} }),
      getIdToken: async () => '',
    });
    return () => undefined;
  },
  signOut: vi.fn(),
}));

const { AuthProvider, useAuth } = await import('./auth');

function ShowError() {
  return <p>{useAuth().error ?? 'none'}</p>;
}

describe('account setup errors', () => {
  it('App Check or sign-in rejected the setup call: says the browser could not be verified', async () => {
    failWith = new FirebaseError('functions/unauthenticated', 'App Check');
    render(
      <AuthProvider>
        <ShowError />
      </AuthProvider>,
    );
    await waitFor(() =>
      expect(
        screen.getByText(
          'This browser couldn’t be verified. Reload the page, or try another browser.',
        ),
      ).toBeInTheDocument(),
    );
  });

  it('any other failure: the usual message', async () => {
    failWith = new FirebaseError('functions/internal', 'boom');
    render(
      <AuthProvider>
        <ShowError />
      </AuthProvider>,
    );
    await waitFor(() =>
      expect(
        screen.getByText('We couldn’t finish setting up your account. Please try again.'),
      ).toBeInTheDocument(),
    );
  });
});
