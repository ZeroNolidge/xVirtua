import { describe, expect, it } from 'vitest';
import { CONSENT_VERSION, type UserDoc } from '@plainspeak/shared';
import { claimsFrom, resolveAuthStatus, type AuthInputs } from './authStatus';

const claims = { role: 'resident' as const, programId: 'irmc' };
const doc = (consent: UserDoc['consent'], nameChosen = true): UserDoc => ({
  programId: 'irmc',
  role: 'resident',
  displayName: 'A',
  email: 'a@x.org',
  consent,
  nameChosen,
  createdAt: '',
});
const base: AuthInputs = {
  authReady: true,
  signedIn: true,
  notInvited: false,
  claims,
  userDoc: doc(null),
};

describe('resolveAuthStatus', () => {
  it('walks the sign-in flow in order', () => {
    expect(resolveAuthStatus({ ...base, authReady: false })).toBe('loading');
    expect(resolveAuthStatus({ ...base, signedIn: false })).toBe('signedOut');
    expect(resolveAuthStatus({ ...base, claims: null })).toBe('claiming');
    expect(resolveAuthStatus({ ...base, userDoc: undefined })).toBe('loading');
    expect(resolveAuthStatus({ ...base, userDoc: doc(null) })).toBe('needsConsent');
    expect(
      resolveAuthStatus({ ...base, userDoc: doc({ version: CONSENT_VERSION, acceptedAt: 'x' }) }),
    ).toBe('ready');
  });

  it('asks once for a name if they signed up before we asked for one', () => {
    const agreed = { version: CONSENT_VERSION, acceptedAt: 'x' };
    expect(resolveAuthStatus({ ...base, userDoc: doc(agreed, false) })).toBe('needsName');
    const { nameChosen: _, ...older } = doc(agreed);
    expect(resolveAuthStatus({ ...base, userDoc: older })).toBe('needsName');
    // New sign-ups choose it on the consent screen.
    expect(resolveAuthStatus({ ...base, userDoc: doc(null, false) })).toBe('needsConsent');
  });

  it('re-asks for consent when the version is bumped', () => {
    expect(
      resolveAuthStatus({
        ...base,
        userDoc: doc({ version: CONSENT_VERSION - 1, acceptedAt: 'x' }),
      }),
    ).toBe('needsConsent');
  });

  it('notInvited wins over everything', () => {
    expect(resolveAuthStatus({ ...base, signedIn: false, notInvited: true })).toBe('notInvited');
  });
});

describe('claimsFrom', () => {
  it('accepts only known roles with a program', () => {
    expect(claimsFrom({ role: 'faculty', programId: 'irmc' })).toEqual({
      role: 'faculty',
      programId: 'irmc',
    });
    expect(claimsFrom({ role: 'admin', programId: 'irmc' })).toBeNull();
    expect(claimsFrom({ role: 'resident' })).toBeNull();
  });
});
