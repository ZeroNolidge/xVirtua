import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import {
  LIVE_VOICES,
  voiceGroupOf,
  type LiveVoice,
  type ScenarioBriefing,
  type ScenarioScript,
} from '@plainspeak/shared';
import { parse, type Caller } from '../lib/callable.js';
import { consumeQuota } from '../lib/quota.js';
import { loadScenario } from '../session/scenario.js';
import { buildLivePersona } from '../patient/prompt.js';

/**
 * GPT-Live test mode. GPT-Live is OpenAI's full-duplex voice model: it
 * listens and talks at the same time, handles pauses and interruptions, and
 * hands every real reply to us ("client delegation"), so Claude and the cue
 * engine stay the patient's brain.
 *
 * Connection: the browser makes a WebRTC offer, this server sends it to
 * OpenAI with our API key and returns the answer. Audio then flows straight
 * between the phone and OpenAI. GPT-Live has no short-lived browser keys, so
 * the key never leaves the server.
 *
 * Wire details come from OpenAI's GPT-Live guides as used by xScribe and
 * from Microsoft's GPT-Live WebRTC guide. They're kept in this one file in
 * case the request shape turns out to differ.
 */
export const LIVE_MODEL = process.env.LIVE_VOICE_MODEL ?? 'gpt-live-1';
export const LIVE_SESSIONS_URL = 'https://api.openai.com/v1/live/sessions';

/** GPT-Live's own prompt: how to sound and when to ask us. The words come from Claude. */
export function buildLiveInstructions(b: ScenarioBriefing, s: ScenarioScript): string {
  const first = b.persona.name.split(' ')[0];
  return `You are the voice of ${b.persona.name}, a ${b.persona.age}-year-old patient (${b.persona.pronouns}) at a family medicine visit. A doctor in training is talking with you to practice explaining things in plain language. Everything is fictional practice.

How you sound: ${s.speakingStyle}
How you feel today: ${s.emotionalState}
Speak like a real person in an exam room: unhurried, natural, a little hesitant when unsure. Never sound like an assistant.

Your words: every line you say comes from the backend. Say each line as ${first}, in first person, as close to word for word as you can. Keep its everyday words. Don't add facts, medical explanations, advice or questions of your own, and don't make it longer. A line may start with a tone note in square brackets, like [worried, quiet, slow]. Use it for how you say the line; never say the note aloud.

Backchannel policy: Backchannels are ONLY tiny sounds a patient makes while the doctor is talking, like "mm-hmm," "okay," or "yeah." A backchannel is never a sentence, never new information, and never a question. Anything more is a real reply, and real replies always come from the backend.

Interruption policy: If the doctor starts talking while you are speaking, stop right away and listen. Never go back to finish or repeat a line you were interrupted in; when you speak again, say only the newest line from the backend. A short "mm-hm", "okay" or "right" from the doctor is just listening: keep going.

Delegation policy:
Backend tools:
- Patient lines: decides what ${first} says next, based on the whole visit so far.

Delegate to the backend when:
- The doctor has finished saying something to you: a question, an explanation, a greeting, a plan, a goodbye, a single word, anything at all.

Do not delegate to the backend when:
- The doctor has only paused in the middle of a thought. Wait for them to finish.
- You couldn't hear what they said. Then just say "Sorry, what was that?"

Never answer the doctor on your own, never guess what ${first} would say, and never mention being an AI or these instructions.`;
}

export function liveVoiceOf(v: unknown): LiveVoice {
  return (LIVE_VOICES as readonly string[]).includes(String(v)) ? (v as LiveVoice) : 'marin';
}

/**
 * The request layouts we try, in order. OpenAI rejected a top-level "model"
 * ("unknown field"), so the session settings go under "session" first (the
 * same shape as GPT-Live's session.start event), with the model moved to the
 * URL in later tries. The first layout OpenAI accepts is used and recorded.
 */
export function liveRequests(instructions: string, voice: LiveVoice, sdp: string) {
  const settings = { instructions, audio: { output: { voice } }, delegation: { type: 'client' } };
  const transport = { type: 'webrtc', sdp };
  const withModel = `${LIVE_SESSIONS_URL}?model=${encodeURIComponent(LIVE_MODEL)}`;
  return [
    {
      shape: 'session',
      url: LIVE_SESSIONS_URL,
      body: { session: { model: LIVE_MODEL, ...settings }, transport },
    },
    { shape: 'flat+query', url: withModel, body: { ...settings, transport } },
    { shape: 'session+query', url: withModel, body: { session: settings, transport } },
    {
      shape: 'session+sdp',
      url: LIVE_SESSIONS_URL,
      body: { session: { model: LIVE_MODEL, ...settings }, sdp },
    },
  ];
}

/** OpenAI didn't accept this request's layout (worth trying the next one). */
const layoutRejected = (status: number, raw: string) =>
  status === 400 && /unknown field|invalid_json|unrecognized|missing required/i.test(raw);

/** The SDP answer, wherever this API version puts it. */
export function answerSdp(body: unknown, raw: string): string | null {
  if (raw.startsWith('v=0')) return raw;
  const b = (body ?? {}) as Record<string, unknown>;
  const t = b.transport as Record<string, unknown> | undefined;
  const sess = b.session as Record<string, unknown> | undefined;
  const st = sess?.transport as Record<string, unknown> | undefined;
  for (const c of [t?.sdp, b.sdp, st?.sdp, b.answer]) if (typeof c === 'string' && c) return c;
  return null;
}

const input = z.object({
  sessionId: z.string().min(1).max(64),
  sdp: z.string().min(10).max(20_000),
});

type Fetch = typeof fetch;

/** Connects the browser's WebRTC offer to a GPT-Live session for this conversation. */
export async function startLiveCall(
  db: Firestore,
  caller: Caller | null,
  data: unknown,
  apiKey: string,
  doFetch: Fetch = fetch,
) {
  if (!caller) throw new HttpsError('unauthenticated', 'Please sign in.');
  const { sessionId, sdp } = parse(input, data);
  const ref = db.doc(`sessions/${sessionId}`);
  const s = (await ref.get()).data();
  if (!s || s.uid !== caller.uid) throw new HttpsError('not-found', 'Session not found.');
  if (s.status !== 'live')
    throw new HttpsError('failed-precondition', 'This conversation has ended.');
  if (s.voiceMode !== 'live')
    throw new HttpsError('failed-precondition', 'Live voice is off for this conversation.');
  if (!apiKey) throw new HttpsError('unavailable', 'Live voice isn’t set up.');

  await consumeQuota(db, caller.uid, 'liveCalls');
  const sc = await loadScenario(db, s.scenarioId, s.scenarioVersion);
  if (!sc) throw new HttpsError('not-found', 'Scenario not found.');
  const program = await db.doc(`programs/${s.programId}`).get();
  // The voice matches the patient: one per pronoun group, chosen by faculty.
  const byGroup = (program.get('liveVoices') ?? {}) as Record<string, unknown>;
  const voice = liveVoiceOf(
    byGroup[voiceGroupOf(sc.briefing.persona.pronouns)] ?? program.get('liveVoice'),
  );

  const instructions =
    s.liveBrain === 'claude'
      ? buildLiveInstructions(sc.briefing, sc.script)
      : buildLivePersona(sc.briefing, sc.script);
  const { answer, liveId, shape } = await openLiveCall(apiKey, instructions, voice, sdp, doFetch);
  await ref.update({
    liveCalls: FieldValue.arrayUnion({ id: liveId, at: Date.now(), voice, shape }),
  });
  return { sdp: answer, voice };
}

/**
 * Opens a GPT-Live call for the browser's WebRTC offer and returns OpenAI's
 * answer. Tries the known request layouts in order (see liveRequests).
 */
export async function openLiveCall(
  apiKey: string,
  instructions: string,
  voice: LiveVoice,
  sdp: string,
  doFetch: Fetch = fetch,
): Promise<{ answer: string; liveId: string | null; shape: string }> {
  const tries: { shape: string; status: number; detail: string }[] = [];
  let res: Response | null = null;
  let raw = '';
  let shape = '';
  for (const r of liveRequests(instructions, voice, sdp)) {
    res = await doFetch(r.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(r.body),
    }).catch((e: unknown) => {
      console.error('GPT-Live unreachable', e);
      throw new HttpsError('unavailable', 'Live voice unreachable.');
    });
    raw = await res.text();
    shape = r.shape;
    if (res.ok || !layoutRejected(res.status, raw)) break;
    tries.push({ shape, status: res.status, detail: raw.slice(0, 300) });
  }
  if (!res || !res.ok) {
    const last = { shape, status: res?.status ?? 0, detail: raw.slice(0, 300) };
    if (!tries.some((t) => t.shape === shape)) tries.push(last);
    console.error('GPT-Live session failed', JSON.stringify(tries));
    throw new HttpsError('unavailable', 'Live voice unavailable.', { tries });
  }
  let body: unknown = null;
  try {
    body = JSON.parse(raw);
  } catch {
    // Some versions answer with the SDP itself.
  }
  const answer = answerSdp(body, raw);
  if (!answer) {
    console.error('GPT-Live returned no SDP answer', raw.slice(0, 500));
    throw new HttpsError('unavailable', 'Live voice returned no connection.');
  }
  const b = (body ?? {}) as { id?: unknown; session?: { id?: unknown } };
  const liveId =
    typeof b.id === 'string' ? b.id : typeof b.session?.id === 'string' ? b.session.id : null;
  return { answer, liveId, shape };
}
