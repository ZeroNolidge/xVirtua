import { httpsCallable } from 'firebase/functions';
import type { LiveVoice, Role, ScenarioStatus } from '@plainspeak/shared';
import { functions } from './firebase';

type ClaimResult = { status: 'ok'; role: Role; programId: string } | { status: 'not_invited' };

export const api = {
  claimInvite: httpsCallable<void, ClaimResult>(functions, 'claimInvite'),
  acceptConsent: httpsCallable<{ version: number }, void>(functions, 'acceptConsent'),
  createInvite: httpsCallable<{ email: string; role: Role }, { email: string; role: Role }>(
    functions,
    'createInvite',
  ),
  revokeInvite: httpsCallable<{ email: string }, void>(functions, 'revokeInvite'),
  setScenarioStatus: httpsCallable<
    { scenarioId: string; status: ScenarioStatus },
    { scenarioId: string; status: ScenarioStatus }
  >(functions, 'setScenarioStatus'),
  setScenarioVoice: httpsCallable<
    { scenarioId: string; voice: LiveVoice | null },
    { scenarioId: string; voice: LiveVoice | null }
  >(functions, 'setScenarioVoice'),
};

/** Friendly text for Firebase errors. Never shows raw codes to users. */
export function friendlyError(e: unknown): string {
  const code =
    typeof e === 'object' && e && 'code' in e ? String((e as { code: unknown }).code) : '';
  const message =
    typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : '';
  if (code.startsWith('functions/') && message) return message;
  switch (code) {
    case 'auth/invalid-email':
      return 'That email address doesn’t look right.';
    case 'auth/invalid-action-code':
    case 'auth/expired-action-code':
      return 'That sign-in link has expired or was already used. Request a new one.';
    case 'auth/network-request-failed':
      return 'Can’t reach the server. Check your connection and try again.';
    default:
      return 'Something went wrong. Please try again.';
  }
}
