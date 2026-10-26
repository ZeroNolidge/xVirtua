import { httpsCallable } from 'firebase/functions';
import type {
  PatientChunk,
  PatientModel,
  PatientUtterance,
  ResidentFeedback,
  VoiceMode,
} from '@plainspeak/shared';
import { appCheckHeaders, auth, functions, usingEmulators } from './firebase';

export type Utterance = PatientUtterance & { idx: number };

export interface TurnInput {
  sessionId: string;
  text: string;
  source: 'voice' | 'typed';
  tStartMs?: number;
  tEndMs?: number;
  /** Resident's own response time, counted from when the patient finished speaking. */
  responseGapMs?: number;
  /** How long the app made the resident wait for the previous patient reply. */
  prevAppWaitMs?: number;
  /** Replace the exchange starting at this resident turn (the resident kept talking). */
  supersedes?: number;
  /** The resident talked over the previous reply; only this much was heard. */
  prevInterrupted?: { heard: string };
  /** Live voice: GPT-Live speaks the reply (no Cartesia voice). */
  live?: boolean;
  /** Live voice: what GPT-Live actually said for the previous reply. */
  prevSpoken?: string;
}
export interface TurnResult {
  patient: Utterance;
  latencyMs: number;
  /** True when every sentence's voice arrived in the stream. */
  voiced?: boolean;
}

const patientTurn = httpsCallable<TurnInput, TurnResult, PatientChunk>(functions, 'patientTurn', {
  timeout: 70_000,
});

export const sessionApi = {
  start: httpsCallable<
    { scenarioId: string; model?: PatientModel; voiceMode?: VoiceMode },
    {
      sessionId: string;
      opening: Utterance;
      persona: { name: string; age: number; pronouns: string };
      patientModel: PatientModel;
      voiceMode?: VoiceMode;
    }
  >(functions, 'startSession'),
  /** Saves what the patient actually said (cut-offs, GPT-Live's wording) and late resident words. */
  saveHeard: httpsCallable<
    {
      sessionId: string;
      idx: number;
      spoken?: string;
      cutOff?: { heard: string };
      residentAppend?: string;
    },
    { ok: true }
  >(functions, 'saveHeard'),
  /** Saves an exchange GPT-Live answered on its own. */
  saveLiveExchange: httpsCallable<
    { sessionId: string; resident: string; patient: string },
    { residentIdx: number; patientIdx: number; note: string | null }
  >(functions, 'saveLiveExchange'),
  /** GPT-Live test mode: trades the browser's WebRTC offer for OpenAI's answer. */
  startLiveCall: httpsCallable<{ sessionId: string; sdp: string }, { sdp: string; voice: string }>(
    functions,
    'startLiveCall',
  ),
  end: httpsCallable<
    { sessionId: string; audioExt?: string; appWaitSec?: number },
    { sessionId: string; status: 'ended' }
  >(functions, 'endSession'),
  sttToken: httpsCallable<
    { sessionId: string },
    {
      value: string;
      expiresAt: number | null;
      model: string;
      /** semantic: the speech service judges turn ends by meaning. */
      turnDetection?: 'semantic' | 'silence';
    }
  >(functions, 'getSttToken'),
  /** Scores once; the result is saved and read from Firestore after that. */
  score: httpsCallable<
    { sessionId: string },
    { feedback: ResidentFeedback | null; cached: boolean; reason?: 'no-turns' }
  >(functions, 'scoreSession', { timeout: 300_000 }),
};

/**
 * Sends the resident's turn and streams the reply: `onChunk` gets the
 * patient's first sentence (and its voice) while the rest is still being
 * written.
 */
export async function streamTurn(
  input: TurnInput,
  onChunk: (c: PatientChunk) => void,
): Promise<TurnResult> {
  const { stream, data } = await patientTurn.stream(input);
  // Read chunks in the background; the final result arrives on `data`.
  const reading = (async () => {
    try {
      for await (const c of stream) onChunk(c);
    } catch {
      // The final result (or its error) comes from `data`.
    }
  })();
  const result = await data;
  await reading;
  return result;
}

let lastWarm = 0;

/**
 * Wakes the conversation servers (they scale to zero when idle) so the first
 * reply has no cold start. One ping to the free /warm route, sent on app open,
 * briefing open and app resume, only when signed in; throttled to once every
 * 2 minutes. The server wakes the others through their warm-up path, which
 * returns before any paid service is called.
 */
export function prewarmConversation() {
  if (!auth.currentUser || Date.now() - lastWarm < 120_000) return;
  lastWarm = Date.now();
  void voiceHeaders()
    .then((headers) => fetch(functionUrl('warm'), { method: 'POST', headers, body: '{}' }))
    .catch(() => undefined);
}

function functionUrl(name: string): string {
  const project = import.meta.env.VITE_FIREBASE_PROJECT_ID || 'demo-plainspeak';
  return usingEmulators
    ? `http://${window.location.hostname}:5001/${project}/us-east1/${name}`
    : `https://us-east1-${project}.cloudfunctions.net/${name}`;
}

const ttsUrl = () => functionUrl('tts');

/** Sign-in and App Check headers for the voice endpoint. */
async function voiceHeaders(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');
  const [token, check] = await Promise.all([user.getIdToken(), appCheckHeaders()]);
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...check };
}

/** Fetches the patient's voice for a stored turn. Returns null if voice is unavailable. */
export async function fetchPatientAudio(
  sessionId: string,
  turnIdx: number,
  /** Just this sentence of the turn (when its voice didn't arrive with the reply). */
  sentence?: string,
): Promise<Blob | null> {
  try {
    const res = await fetch(ttsUrl(), {
      method: 'POST',
      headers: await voiceHeaders(),
      body: JSON.stringify({ sessionId, turnIdx, ...(sentence ? { sentence } : {}) }),
    });
    if (!res.ok) return null;
    const blob = await res.blob();
    return blob.size ? blob : null;
  } catch {
    return null;
  }
}

/** Decodes a base64 audio chunk from the stream. */
export function audioFromChunk(b64: string, mime: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
