/** What to show when account setup (claimInvite) fails. */
export function setupErrorMessage(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  // App Check (or sign-in) rejected the call: this browser, not the account.
  if (
    typeof code === 'string' &&
    (code === 'functions/unauthenticated' || code.startsWith('appCheck/'))
  )
    return 'This browser couldn’t be verified. Reload the page, or try another browser.';
  return 'We couldn’t finish setting up your account. Please try again.';
}
