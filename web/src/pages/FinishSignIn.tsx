import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { isSignInWithEmailLink, signInWithEmailLink } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { friendlyError } from '../lib/api';
import { EMAIL_FOR_SIGN_IN, safeStorage } from '../lib/storage';

/** Landing page for the emailed sign-in link. */
export function FinishSignIn() {
  const navigate = useNavigate();
  // No saved email means the link was opened on a different device.
  const [savedEmail] = useState(() => safeStorage.get(EMAIL_FOR_SIGN_IN));
  const needEmail = !savedEmail;
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  const href = window.location.href;
  const validLink = isSignInWithEmailLink(auth, href);

  async function finish(address: string) {
    try {
      await signInWithEmailLink(auth, address.trim(), href);
      safeStorage.remove(EMAIL_FOR_SIGN_IN);
      navigate('/', { replace: true });
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  useEffect(() => {
    if (started.current || !validLink || !savedEmail) return;
    started.current = true;
    void finish(savedEmail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validLink, savedEmail]);

  if (!validLink) {
    return (
      <section>
        <h1>That link didn’t work</h1>
        <div className="card">
          <p>It may be incomplete or expired.</p>
          <button className="btn" onClick={() => navigate('/', { replace: true })}>
            Back to sign in
          </button>
        </div>
      </section>
    );
  }

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
