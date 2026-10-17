import { useAuth } from '../lib/auth';

export function Progress() {
  const { userDoc, claims, signOut } = useAuth();
  return (
    <section>
      <h1>Your progress</h1>
      <div className="card">
        <p className="muted">XP, streaks and badges arrive in Phase 5.</p>
      </div>
      <div className="card">
        <h2>Account</h2>
        <p>
          {userDoc?.email}
          <br />
          <span className="muted">
            {claims?.role === 'faculty' ? 'Faculty' : 'Resident'} · {claims?.programId}
          </span>
        </p>
        <button className="btn btn-secondary" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    </section>
  );
}
