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

const warmStart = httpsCallable<{ warmup: true }, unknown>(functions, 'startSession');
const warmStt = httpsCallable<{ warmup: true }, unknown>(functions, 'getSttToken');

/** Wakes up the conversation-start functions while the resident reads the briefing. */
export function prewarmConversation() {
  void warmStart({ warmup: true }).catch(() => undefined);
  void warmStt({ warmup: true }).catch(() => undefined);
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
