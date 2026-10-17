import { useState, type FormEvent } from 'react';
import { sendSignInLinkToEmail } from 'firebase/auth';
import { auth, usingEmulators } from '../lib/firebase';
import { friendlyError } from '../lib/api';
import { EMAIL_FOR_SIGN_IN, safeStorage } from '../lib/storage';
import { signInLinkSettings } from '../lib/signInLink';

export function Login() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const clean = email.trim();
    try {
      await sendSignInLinkToEmail(auth, clean, signInLinkSettings());
      safeStorage.set(EMAIL_FOR_SIGN_IN, clean);
      setSent(true);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <section>
        <h1>Check your email</h1>
        <div className="card">
          <p>
            We sent a sign-in link to <strong>{email.trim()}</strong>. Open it on this phone to jump
            right in.
          </p>
          {usingEmulators && (
            <p className="muted">
              Dev mode: find the link in the Emulator UI → Authentication, or in the emulator log.
            </p>
          )}
          <button className="btn btn-secondary" onClick={() => setSent(false)}>
            Use a different email
          </button>
        </div>
      </section>
    );
  }

  return (
    <section>
      <h1>Welcome to PlainSpeak</h1>
      <p className="muted">Practice explaining medicine in plain, kind language.</p>
      <form className="card" onSubmit={submit}>
        <label className="field">
          <span>Your program email</span>
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@hospital.org"
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="btn" disabled={busy}>
          {busy ? 'Sending…' : 'Email me a sign-in link'}
        </button>
        <p className="muted small">
          PlainSpeak is invite-only. Ask your program director if you can’t get in.
        </p>
      </form>
    </section>
  );
}
