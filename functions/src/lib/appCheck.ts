import { getAppCheck } from 'firebase-admin/app-check';
import { defineBoolean } from 'firebase-functions/params';
import type { Request } from 'express';

/**
 * When true, every function rejects requests without a valid App Check token
 * (proof the request came from our web app). The deploy job sets this in
 * functions/.env once App Check is registered for the project.
 */
export const APP_CHECK_ENFORCE = defineBoolean('APP_CHECK_ENFORCE', {
  default: false,
  description: 'Reject requests without a valid App Check token.',
});

/** For plain HTTP functions (callables check App Check themselves). */
export async function appCheckOk(req: Request): Promise<boolean> {
  if (!APP_CHECK_ENFORCE.value()) return true;
  const token = req.get('x-firebase-appcheck');
  if (!token) return false;
  try {
    await getAppCheck().verifyToken(token);
    return true;
  } catch {
    return false;
  }
}
