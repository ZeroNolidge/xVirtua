import { httpsCallable } from 'firebase/functions';
import type { PatientModel, PatientUtterance } from '@plainspeak/shared';
import { auth, functions, usingEmulators } from './firebase';

export type Utterance = PatientUtterance & { idx: number };

export const sessionApi = {
  start: httpsCallable<
    { scenarioId: string; model?: PatientModel },
    { sessionId: string; opening: Utterance; persona: { name: string; age: number; pronouns: string }; patientModel: PatientModel }
  >(functions, 'startSession'),
  turn: httpsCallable<
    { sessionId: string; text: string; source: 'voice' | 'typed'; tStartMs?: number; tEndMs?: number },
    { patient: Utterance; latencyMs: number }
  >(functions, 'patientTurn'),
  end: httpsCallable<{ sessionId: string; audioExt?: string }, { sessionId: string; status: 'ended' }>(
    functions,
    'endSession',
  ),
  sttToken: httpsCallable<{ sessionId: string }, { value: string; expiresAt: number | null; model: string }>(
    functions,
    'getSttToken',
  ),
};

const WARM_FUNCTIONS = ['startSession', 'getSttToken', 'patientTurn'] as const;
let lastWarm = 0;

/**
 * Wakes the conversation servers (they scale to zero when idle) so the first
 * reply has no cold start. Sent on app open, briefing open and app resume;
 * throttled to once every 2 minutes.
 */
export function prewarmConversation() {
  if (Date.now() - lastWarm < 120_000) return;
  lastWarm = Date.now();
  for (const name of WARM_FUNCTIONS) {
    void httpsCallable(functions, name)({ warmup: true }).catch(() => undefined);
  }
  void fetch(ttsUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ warmup: true }),
  }).catch(() => undefined);
}

function ttsUrl(): string {
  const project = import.meta.env.VITE_FIREBASE_PROJECT_ID || 'demo-plainspeak';
  return usingEmulators
    ? `http://${window.location.hostname}:5001/${project}/us-east1/tts`
    : `https://us-east1-${project}.cloudfunctions.net/tts`;
}

/** Fetches the patient's voice for a stored turn. Returns null if TTS is unavailable. */
export async function fetchPatientAudio(sessionId: string, turnIdx: number): Promise<ReadableStream<Uint8Array> | null> {
  try {
    const token = await auth.currentUser?.getIdToken();
    const res = await fetch(ttsUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ sessionId, turnIdx }),
    });
    return res.ok && res.body ? res.body : null;
  } catch {
    return null;
  }
}
