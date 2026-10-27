import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { setGlobalOptions } from 'firebase-functions/v2';
import {
  HttpsError,
  onCall,
  onRequest,
  type CallableOptions,
  type CallableRequest,
  type CallableResponse,
} from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import {
  RUBRIC_VERSION,
  CONSENT_VERSION,
  DEFAULT_TIMEZONE,
  type PatientChunk,
} from '@plainspeak/shared';
import { ANTHROPIC_API_KEY, CARTESIA_API_KEY, OPENAI_API_KEY, REGION } from './config.js';
import * as invites from './auth/invites.js';
import * as scenarios from './content/scenarios.js';
import * as session from './session/session.js';
import { ClaudeBrain, type PatientBrain } from './patient/brain.js';
import { FakeBrain } from './patient/fakeBrain.js';
import { ClaudeDirector, FakeDirector, type Director } from './patient/director.js';
import { handleTts } from './voice/tts.js';
import { pickVoice, synthesize } from './voice/cartesia.js';
import type { VoiceService } from './voice/streamVoice.js';
import { getSttToken as mintSttToken } from './voice/stt.js';
import { startLiveCall as connectLive } from './voice/live.js';
import { voicePreview as makeVoicePreview } from './voice/voiceSample.js';
import type { Caller } from './lib/callable.js';
import { APP_CHECK_ENFORCE } from './lib/appCheck.js';
import { reportClientError as storeClientError } from './lib/clientErrors.js';
import { checkAppCheck, handleWarm, wakeOverHttp } from './warm/warm.js';
import * as retention from './retention/retention.js';
import { claudePlainWords, lookupPlainWords as lookup } from './lookup/plainWords.js';
import { claudeScorer, scoreSession as score } from './scoring/score.js';
import { fakeScorer } from './scoring/fakeScorer.js';

initializeApp();
// invoker 'public': callable functions do their own auth checks; Cloud Run must
// still let the browser reach them.
setGlobalOptions({ region: REGION, maxInstances: 10, invoker: 'public' });

const db = () => getFirestore();
const auth = () => getAuth();

function callerOf(req: CallableRequest): Caller | null {
  if (!req.auth) return null;
  return {
    uid: req.auth.uid,
    email: req.auth.token.email,
    emailVerified: req.auth.token.email_verified,
    claims: req.auth.token as Caller['claims'],
  };
}

/**
 * Every callable requires a valid App Check token once enforcement is on, so
 * only our web app can call them.
 */
function callable(
  opts: CallableOptions,
  handler: (req: CallableRequest, res?: CallableResponse<unknown>) => unknown,
) {
  return onCall({ enforceAppCheck: APP_CHECK_ENFORCE, ...opts }, handler);
}

/** Liveness check. Returns no secrets or user data. */
export const health = onRequest((_req, res) => {
  res.json({ ok: true, rubricVersion: RUBRIC_VERSION, consentVersion: CONSENT_VERSION });
});

/**
 * A `{ warmup: true }` call just starts the container (sent when the app
 * opens). It must come from a signed-in user, and it returns before any paid
 * service is called.
 */
function warmup(req: CallableRequest): { warm: true } | null {
  const d = req.data as unknown;
  if (typeof d !== 'object' || d === null || !('warmup' in d)) return null;
  if (!req.auth) throw new HttpsError('unauthenticated', 'Please sign in.');
  return { warm: true };
}

// In the local emulator without vendor keys, use offline fakes.
const inEmulator = process.env.FUNCTIONS_EMULATOR === 'true';
const keyOf = (s: { value(): string }) => {
  try {
    return s.value();
  } catch {
    return '';
  }
};

// ----- accounts -----
export const createInvite = callable({}, (req) =>
  invites.createInvite(db(), auth(), callerOf(req), req.data),
);
export const revokeInvite = callable({}, (req) =>
  invites.revokeInvite(db(), callerOf(req), req.data),
);
export const claimInvite = callable({}, (req) => invites.claimInvite(db(), auth(), callerOf(req)));
export const acceptConsent = callable({}, (req) =>
  invites.acceptConsent(db(), callerOf(req), req.data),
);

// ----- content -----
export const setScenarioStatus = callable({}, (req) =>
  scenarios.setScenarioStatus(db(), callerOf(req), req.data),
);

// ----- live conversation -----
export const startSession = callable(
  {},
  (req) => warmup(req) ?? session.startSession(db(), callerOf(req), req.data),
);

let brain: PatientBrain | null = null;
let voice: VoiceService | null | undefined;
function voiceService(): VoiceService | null {
  if (voice !== undefined) return voice;
  const key = keyOf(CARTESIA_API_KEY);
  voice = key
    ? {
        voiceId: (pronouns, scenarioId) => pickVoice(key, pronouns, scenarioId),
        synthesize: (id, text, d) => synthesize(key, id, text, d),
      }
    : null;
  return voice;
}

export const patientTurn = callable(
  // Scales to zero when idle; the app sends a warm-up call when it opens.
  { secrets: [ANTHROPIC_API_KEY, CARTESIA_API_KEY], timeoutSeconds: 60, memory: '512MiB' },
  (req, res) => {
    const w = warmup(req);
    if (w) return w;
    const anthropicKey = keyOf(ANTHROPIC_API_KEY);
    brain ??= inEmulator && !anthropicKey ? new FakeBrain() : new ClaudeBrain(anthropicKey);
    const streaming = req.acceptsStreaming && res;
    return session.patientTurn(db(), callerOf(req), req.data, brain, {
      ...(streaming ? { send: (chunk: PatientChunk) => res.sendChunk(chunk) } : {}),
      voice: voiceService(),
    });
  },
);

/** Saves what the patient actually said out loud (cut-offs, GPT-Live's wording). */
export const saveHeard = callable({}, (req) => session.saveHeard(db(), callerOf(req), req.data));

/** Saves a GPT-Live exchange the voice model answered on its own. */
let director: Director | null = null;
export const saveLiveExchange = callable({ secrets: [ANTHROPIC_API_KEY] }, (req) => {
  const key = keyOf(ANTHROPIC_API_KEY);
  director ??= inEmulator && !key ? new FakeDirector() : new ClaudeDirector(key);
  return session.saveLiveExchange(db(), callerOf(req), req.data, director);
});

export const endSession = callable({}, (req) =>
  session.endSession(db(), callerOf(req), req.data, async (path) => {
    const [exists] = await getStorage().bucket().file(path).exists();
    return exists;
  }),
);

export const getSttToken = callable(
  { secrets: [OPENAI_API_KEY] },
  (req) => warmup(req) ?? mintSttToken(db(), callerOf(req), req.data, OPENAI_API_KEY.value()),
);

/** GPT-Live test mode: connects the browser's call (see voice/live.ts). */
export const startLiveCall = callable(
  { secrets: [OPENAI_API_KEY], timeoutSeconds: 30 },
  (req) => warmup(req) ?? connectLive(db(), callerOf(req), req.data, keyOf(OPENAI_API_KEY)),
);

/** Faculty tool: hear a GPT-Live voice (a short listen-only call from the browser). */
export const voiceSample = callable({ secrets: [OPENAI_API_KEY], timeoutSeconds: 30 }, (req) =>
  makeVoicePreview(db(), callerOf(req), req.data, keyOf(OPENAI_API_KEY)),
);

const CORS = [
  /^https:\/\/[a-z0-9-]+\.(web\.app|firebaseapp\.com)$/,
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
];

/**
 * The app's only keep-warm ping (sent on open, resume and briefing). Free:
 * it wakes the conversation servers through their warm-up path, which returns
 * before any paid call. Also counts App Check tokens for the rollout.
 */
export const warm = onRequest({ cors: CORS, timeoutSeconds: 20, memory: '256MiB' }, (req, res) =>
  handleWarm(req, res, {
    db: db(),
    auth: auth(),
    enforceAppCheck: APP_CHECK_ENFORCE.value(),
    appCheck: checkAppCheck,
    wake: wakeOverHttp(process.env.GCLOUD_PROJECT ?? 'demo-plainspeak', REGION, inEmulator),
  }),
);

/** Replays a stored patient line (the opening line, or when streaming had no voice). */
export const tts = onRequest(
  {
    secrets: [CARTESIA_API_KEY],
    cors: [
      /^https:\/\/[a-z0-9-]+\.(web\.app|firebaseapp\.com)$/,
      /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
    ],
    timeoutSeconds: 30,
  },
  (req, res) => handleTts(req, res, db(), auth(), CARTESIA_API_KEY.value()),
);

export const reportClientError = callable({}, (req) =>
  storeClientError(db(), callerOf(req), req.data),
);

// ----- coaching -----
export const lookupPlainWords = callable({ secrets: [ANTHROPIC_API_KEY] }, (req) => {
  const key = keyOf(ANTHROPIC_API_KEY);
  const ask =
    inEmulator && !key
      ? async (term: string) => ({
          isMedical: true,
          plain: [`plain words for ${term}`],
          explanation: 'Offline example.',
        })
      : claudePlainWords(key);
  return lookup(db(), callerOf(req), req.data, ask);
});

export const scoreSession = callable(
  { secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 300, memory: '512MiB' },
  (req) => {
    const key = keyOf(ANTHROPIC_API_KEY);
    return score(
      db(),
      callerOf(req),
      req.data,
      inEmulator && !key ? fakeScorer() : claudeScorer(key),
    );
  },
);

// ----- retention -----
function audioStore(): retention.AudioStore {
  const bucket = getStorage().bucket();
  return {
    deletePrefix: async (prefix) => {
      await bucket.deleteFiles({ prefix, force: true });
    },
    listOld: async (prefix, olderThan, limit) => {
      const [files] = await bucket.getFiles({ prefix, maxResults: limit, autoPaginate: false });
      return files
        .filter((f) => new Date(String(f.metadata.timeCreated ?? 0)) < olderThan)
        .map((f) => f.name);
    },
    delete: async (path) => {
      await bucket.file(path).delete({ ignoreNotFound: true });
    },
  };
}

/** Nightly: delete expired recordings and transcripts, close abandoned conversations. */
export const retentionSweep = onSchedule(
  { schedule: 'every day 03:17', timeZone: DEFAULT_TIMEZONE, timeoutSeconds: 540 },
  async () => {
    const r = await retention.retentionSweep(db(), audioStore());
    console.log('retention sweep', r);
  },
);

export const setResidentEndDate = callable({}, (req) =>
  retention.setResidentEndDate(db(), callerOf(req), req.data),
);
export const deleteResidentData = callable({ timeoutSeconds: 300 }, (req) =>
  retention.deleteResidentData(db(), audioStore(), callerOf(req), req.data),
);
