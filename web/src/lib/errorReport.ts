import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

const report = httpsCallable<Record<string, unknown>, void>(functions, 'reportClientError');
let sent = 0;

/** Sends a crash/error report to the server (max 5 per page load). Never throws. */
export function reportError(kind: string, err: unknown, extra: Record<string, unknown> = {}) {
  if (sent >= 5) return;
  sent++;
  const e = err instanceof Error ? err : new Error(String(err));
  void report({
    kind,
    message: e.message.slice(0, 500),
    stack: (e.stack ?? '').slice(0, 2000),
    path: window.location.pathname,
    userAgent: navigator.userAgent.slice(0, 300),
    ...extra,
  }).catch(() => undefined);
}

export function installGlobalErrorReporting() {
  window.addEventListener('error', (ev) => reportError('window.error', ev.error ?? ev.message));
  window.addEventListener('unhandledrejection', (ev) => reportError('unhandledrejection', ev.reason));
}
