import { initializeApp } from 'firebase-admin/app';
import { setGlobalOptions } from 'firebase-functions/v2';
import { onRequest } from 'firebase-functions/v2/https';
import { RUBRIC_VERSION, CONSENT_VERSION } from '@plainspeak/shared';
import { REGION } from './config.js';

initializeApp();
setGlobalOptions({ region: REGION, maxInstances: 10 });

/** Liveness check. Returns no secrets or user data. */
export const health = onRequest((_req, res) => {
  res.json({ ok: true, rubricVersion: RUBRIC_VERSION, consentVersion: CONSENT_VERSION });
});
