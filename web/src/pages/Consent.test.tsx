import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CONSENT_VERSION } from '@plainspeak/shared';

const acceptConsent = vi.fn(async (_x: unknown) => ({ data: undefined }));
let suggestedName: string | null = null;
vi.mock('../lib/api', () => ({
  api: { acceptConsent: (x: unknown) => acceptConsent(x) },
  friendlyError: () => 'error',
}));
vi.mock('../lib/auth', () => ({
  useAuth: () => ({
    claims: { role: 'resident', programId: 'irmc' },
    signOut: vi.fn(),
    userDoc: { displayName: 'timiflow3+plainspeak', nameChosen: false, suggestedName },
  }),
}));

const { Consent } = await import('./Consent');

describe('consent screen', () => {
  it('needs a preferred name, never offers the email prefix, and saves it with consent', async () => {
    suggestedName = null;
    render(<Consent />);
    const name = screen.getByRole('textbox', { name: /what should we call you/i });
    expect(name).toHaveValue('');
    fireEvent.click(screen.getByRole('checkbox'));
    const go = screen.getByRole('button', { name: /let’s go/i });
    expect(go).toBeDisabled();
    fireEvent.change(name, { target: { value: '  Sam  ' } });
    expect(go).toBeEnabled();
    fireEvent.click(go);
    expect(acceptConsent).toHaveBeenCalledWith({ version: CONSENT_VERSION, name: 'Sam' });
  });

  it('offers the name faculty put on the invite', () => {
    suggestedName = 'Dr. Jordan';
    render(<Consent />);
    expect(screen.getByRole('textbox', { name: /what should we call you/i })).toHaveValue(
      'Dr. Jordan',
    );
  });
});
