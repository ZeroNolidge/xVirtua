import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  type Timestamp,
} from 'firebase/firestore';
import { RETENTION_NOTICE } from '@plainspeak/shared';
import { db } from '../lib/firebase';
import { useAuth } from '../lib/auth';

interface Row {
  id: string;
  scenarioTitle?: string;
  status: 'live' | 'ended';
  startedAt?: Timestamp;
  overall?: number | null;
}

/** The resident's past conversations, newest first. */
function useHistory(uid: string | undefined) {
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    if (!uid) return;
    const q = query(
      collection(db, 'sessions'),
      where('uid', '==', uid),
      orderBy('startedAt', 'desc'),
      limit(30),
    );
    return onSnapshot(
      q,
      (snap) => setRows(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Row, 'id'>) }))),
      () => setRows([]),
    );
  }, [uid]);
  return rows;
}

export function Progress() {
  const { userDoc, claims, signOut, user } = useAuth();
  const rows = useHistory(user?.uid);
  return (
    <section>
      <h1>Your progress</h1>
      <div className="card">
        <p className="muted">XP, streaks and badges arrive in Phase 5.</p>
      </div>
      <div className="card">
        <h2>Your history</h2>
        {rows === null ? (
          <p className="muted">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="muted">No conversations yet.</p>
        ) : (
          <ul className="list">
            {rows.map((r) => (
              <li key={r.id}>
                <Link to={`/session/${r.id}/done`} className="history-link">
                  <span>{r.scenarioTitle ?? 'Practice conversation'}</span>
                  <span className="muted small">
                    {r.startedAt
                      ?.toDate()
                      .toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    {r.status === 'live' ? ' · open' : ''}
                  </span>
                </Link>
                {typeof r.overall === 'number' && <span className="score-pill">{r.overall}</span>}
              </li>
            ))}
          </ul>
        )}
        <p className="muted small retention-note">{RETENTION_NOTICE}</p>
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
        <p className="center-text">
          <Link to="/privacy" className="small muted">
            Privacy
          </Link>
        </p>
      </div>
    </section>
  );
}
