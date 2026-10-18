import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { isSignInWithEmailLink, sendSignInLinkToEmail, signInWithEmailLink } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { friendlyError } from '../lib/api';
import { EMAIL_FOR_SIGN_IN, safeStorage } from '../lib/storage';
import { signInLinkSettings } from '../lib/signInLink';

/** Codes for a link that expired or was already used (hospital email scanners often open links first). */
const STALE_LINK = new Set(['auth/invalid-action-code', 'auth/expired-action-code']);

/** Landing page for the emailed sign-in link. */
export function FinishSignIn() {
  const navigate = useNavigate();
  // No saved email means the link was opened on a different device.
  const [savedEmail] = useState(() => safeStorage.get(EMAIL_FOR_SIGN_IN));
  const needEmail = !savedEmail;
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const started = useRef(false);
  const href = window.location.href;
  const validLink = isSignInWithEmailLink(auth, href);

  async function finish(address: string) {
    try {
      await signInWithEmailLink(auth, address.trim(), href);
      safeStorage.remove(EMAIL_FOR_SIGN_IN);
      navigate('/', { replace: true });
    } catch (err) {
      const code = typeof err === 'object' && err && 'code' in err ? String(err.code) : '';
      if (STALE_LINK.has(code)) setStale(true);
      else setError(friendlyError(err));
    }
  }

  useEffect(() => {
    if (started.current || !validLink || !savedEmail) return;
    started.current = true;
    void finish(savedEmail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validLink, savedEmail]);

  if (stale) return <SendNewLink email={savedEmail ?? email} />;

  // A broken or partial link gets the same calm path.
  if (!validLink) return <SendNewLink email={savedEmail ?? ''} />;

  function submit(e: FormEvent) {
    e.preventDefault();
    void finish(email);
  }

  return (
    <section>
      <h1>Signing you in…</h1>
      <div className="card">
        {needEmail && (
          <form onSubmit={submit}>
            <label className="field">
              <span>Confirm your email</span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <button className="btn">Continue</button>
          </form>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {!needEmail && !error && <p className="muted">One moment.</p>}
      </div>
    </section>
  );
}

/** One calm sentence and a button to get a fresh link. */
function SendNewLink({ email: initial }: { email: string }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState(initial);
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  async function send(e: FormEvent) {
    e.preventDefault();
    setState('sending');
    try {
      await sendSignInLinkToEmail(auth, email.trim(), signInLinkSettings());
      safeStorage.set(EMAIL_FOR_SIGN_IN, email.trim());
      setState('sent');
    } catch {
      setState('error');
    }
  }

  return (
    <section>
      <h1>Let’s get you a fresh link</h1>
      <div className="card">
        {state === 'sent' ? (
          <p>
            A new link is on its way to <strong>{email.trim()}</strong>. Open the newest email.
          </p>
        ) : (
          <form onSubmit={send}>
            <p>
              This sign-in link has expired or was already used, which can happen when email
              security opens links first.
            </p>
            {!initial && (
              <label className="field">
                <span>Your program email</span>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
            )}
            {state === 'error' && (
              <p className="error" role="alert">
                That didn’t go through. Please try again.
              </p>
            )}
            <button className="btn" disabled={state === 'sending' || !email.trim()}>
              {state === 'sending' ? 'Sending…' : 'Send a new link'}
            </button>
          </form>
        )}
        <button className="btn btn-text" onClick={() => navigate('/', { replace: true })}>
          Back to sign in
        </button>
      </div>
    </section>
  );
}
