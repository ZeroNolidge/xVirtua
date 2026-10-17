import { useAuth } from '../lib/auth';

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <section className="center" aria-busy="true">
      <div className="spinner" aria-hidden="true" />
      <p className="muted">{label}</p>
    </section>
  );
}

export function SettingUp() {
  const { error, signOut } = useAuth();
  if (!error) return <Loading label="Setting up your account…" />;
  return (
    <section>
      <h1>Hmm, that didn’t work</h1>
      <div className="card">
        <p>{error}</p>
        <button className="btn" onClick={() => window.location.reload()}>
          Try again
        </button>
        <button className="btn btn-text" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    </section>
  );
}

export function NotInvited() {
  const { clearNotInvited } = useAuth();
  return (
    <section>
      <h1>You’re not on the list yet</h1>
      <div className="card">
        <p>
          PlainSpeak is invite-only during the pilot. Ask your program director to invite this
          email, then sign in again.
        </p>
        <button className="btn" onClick={clearNotInvited}>
          Back to sign in
        </button>
      </div>
    </section>
  );
}
