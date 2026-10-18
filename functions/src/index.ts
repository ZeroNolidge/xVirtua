import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { setGlobalOptions } from 'firebase-functions/v2';
import { onCall, onRequest, type CallableRequest } from 'firebase-functions/v2/https';
import { RUBRIC_VERSION, CONSENT_VERSION } from '@plainspeak/shared';
import { ANTHROPIC_API_KEY, CARTESIA_API_KEY, OPENAI_API_KEY, REGION } from './config.js';
import * as invites from './auth/invites.js';
import * as scenarios from './content/scenarios.js';
import * as session from './session/session.js';
import { ClaudeBrain, type PatientBrain } from './patient/brain.js';
import { FakeBrain } from './patient/fakeBrain.js';
import { handleTts } from './voice/tts.js';
import { getSttToken as mintSttToken } from './voice/stt.js';
import type { Caller } from './lib/callable.js';

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

/** Liveness check. Returns no secrets or user data. */
export const health = onRequest((_req, res) => {
  res.json({ ok: true, rubricVersion: RUBRIC_VERSION, consentVersion: CONSENT_VERSION });
});

// ----- accounts -----
export const createInvite = onCall((req) =>
  invites.createInvite(db(), auth(), callerOf(req), req.data),
);
export const revokeInvite = onCall((req) => invites.revokeInvite(db(), callerOf(req), req.data));
export const claimInvite = onCall((req) => invites.claimInvite(db(), auth(), callerOf(req)));
export const acceptConsent = onCall((req) => invites.acceptConsent(db(), callerOf(req), req.data));

// ----- content -----
export const setScenarioStatus = onCall((req) =>
  scenarios.setScenarioStatus(db(), callerOf(req), req.data),
);

// ----- live conversation -----
export const startSession = onCall((req) => session.startSession(db(), callerOf(req), req.data));

let brain: PatientBrain | null = null;
// In the local emulator without an Anthropic key, use the offline fake patient.
const useFakeBrain = () =>
  process.env.FUNCTIONS_EMULATOR === 'true' && !process.env.ANTHROPIC_API_KEY;
export const patientTurn = onCall(
  { secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 60, memory: '512MiB', minInstances: 0 },
  (req) => {
    brain ??= useFakeBrain() ? new FakeBrain() : new ClaudeBrain(ANTHROPIC_API_KEY.value());
    return session.patientTurn(db(), callerOf(req), req.data, brain);
  },
);

export const endSession = onCall((req) =>
  session.endSession(db(), callerOf(req), req.data, async (path) => {
    const [exists] = await getStorage().bucket().file(path).exists();
    return exists;
  }),
);

export const getSttToken = onCall({ secrets: [OPENAI_API_KEY] }, (req) =>
  mintSttToken(db(), callerOf(req), req.data, OPENAI_API_KEY.value()),
);

export const tts = onRequest(
  { secrets: [CARTESIA_API_KEY], cors: true, timeoutSeconds: 30 },
  (req, res) => handleTts(req, res, db(), auth(), CARTESIA_API_KEY.value()),
);
