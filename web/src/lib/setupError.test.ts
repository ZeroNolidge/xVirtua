import { describe, expect, it } from 'vitest';
import { FirebaseError } from 'firebase/app';
import { setupErrorMessage } from './setupError';

const VERIFY = 'This browser couldn’t be verified. Reload the page, or try another browser.';
const GENERIC = 'We couldn’t finish setting up your account. Please try again.';

describe('account setup error', () => {
  it('says the browser could not be verified when App Check or auth rejects the call', () => {
    expect(setupErrorMessage(new FirebaseError('functions/unauthenticated', 'x'))).toBe(VERIFY);
    expect(setupErrorMessage(new FirebaseError('appCheck/fetch-status-error', 'x'))).toBe(VERIFY);
  });
  it('keeps the usual message for anything else', () => {
    expect(setupErrorMessage(new FirebaseError('functions/internal', 'x'))).toBe(GENERIC);
    expect(setupErrorMessage(new Error('offline'))).toBe(GENERIC);
    expect(setupErrorMessage(null)).toBe(GENERIC);
  });
});
