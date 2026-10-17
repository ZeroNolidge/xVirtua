import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { setGlobalOptions } from 'firebase-functions/v2';
import { onCall, onRequest, type CallableRequest } from 'firebase-functions/v2/https';
import { RUBRIC_VERSION, CONSENT_VERSION } from '@plainspeak/shared';
import { REGION } from './config.js';
import * as invites from './auth/invites.js';

initializeApp();
// invoker 'public': callable functions do their own auth checks; Cloud Run must
// still let the browser reach them.
setGlobalOptions({ region: REGION, maxInstances: 10, invoker: 'public' });

const db = () => getFirestore();
const auth = () => getAuth();

function callerOf(req: CallableRequest): invites.Caller | null {
  if (!req.auth) return null;
  return {
    uid: req.auth.uid,
    email: req.auth.token.email,
    emailVerified: req.auth.token.email_verified,
    claims: req.auth.token as invites.Caller['claims'],
  };
}

/** Liveness check. Returns no secrets or user data. */
export const health = onRequest((_req, res) => {
  res.json({ ok: true, rubricVersion: RUBRIC_VERSION, consentVersion: CONSENT_VERSION });
});

export const createInvite = onCall((req) =>
  invites.createInvite(db(), auth(), callerOf(req), req.data),
);
export const revokeInvite = onCall((req) => invites.revokeInvite(db(), callerOf(req), req.data));
export const claimInvite = onCall((req) => invites.claimInvite(db(), auth(), callerOf(req)));
export const acceptConsent = onCall((req) => invites.acceptConsent(db(), callerOf(req), req.data));
