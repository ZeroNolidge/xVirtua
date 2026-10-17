import { CONSENT_VERSION, type UserClaims, type UserDoc } from '@plainspeak/shared';

export type AuthStatus =
  | 'loading'
  | 'signedOut'
  | 'claiming' // signed in, waiting for the server to apply the invite
  | 'notInvited'
  | 'needsConsent'
  | 'ready';

export interface AuthInputs {
  authReady: boolean;
  signedIn: boolean;
  notInvited: boolean;
  claims: UserClaims | null;
  userDoc: UserDoc | null | undefined; // undefined = still loading
}

/** Pure routing decision for the auth gate. */
export function resolveAuthStatus(i: AuthInputs): AuthStatus {
  if (i.notInvited) return 'notInvited';
  if (!i.authReady) return 'loading';
  if (!i.signedIn) return 'signedOut';
  if (!i.claims) return 'claiming';
  if (i.userDoc === undefined) return 'loading';
  if (i.userDoc === null) return 'claiming';
  if (i.userDoc.consent?.version !== CONSENT_VERSION) return 'needsConsent';
  return 'ready';
}

export function claimsFrom(token: Record<string, unknown>): UserClaims | null {
  const { role, programId } = token;
  if ((role === 'resident' || role === 'faculty') && typeof programId === 'string') {
    return { role, programId };
  }
  return null;
}
