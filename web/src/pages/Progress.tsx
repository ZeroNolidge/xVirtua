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
import { ProgressDashboard } from '../components/ProgressDashboard';
import { PatientBadge } from '../components/PatientBadge';
import { usePatientProgress } from '../lib/patientProgress';
import { useScenarioList } from '../lib/scenarios';
import { useProgramName } from '../lib/program';
import { neverStarted, type SessionRow } from '../lib/resume';

interface Row extends Partial<SessionRow> {
  id: string;
  status: 'live' | 'ended';
  startedAt?: Timestamp;
  /** A word like "Solid": residents never see the numbers. */
  feedbackBand?: string | null;
}

/**
 * The resident's past conversations, newest first. `programId`: faculty
 * looking at a resident (the rules need the program on the query).
 */
export function useHistory(uid: string | undefined, programId?: string) {
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    if (!uid) return;
    const q = programId
      ? query(
          collection(db, 'sessions'),
          where('uid', '==', uid),
          where('programId', '==', programId),
        )
      : query(
          collection(db, 'sessions'),
          where('uid', '==', uid),
          orderBy('startedAt', 'desc'),
          limit(30),
        );
    return onSnapshot(
      q,
      (snap) =>
        setRows(
          snap.docs
            .map((d) => ({ id: d.id, ...(d.data() as Omit<Row, 'id'>) }))
            .filter((r) => !neverStarted(r))
            .sort((a, b) => (b.startedAt?.toMillis() ?? 0) - (a.startedAt?.toMillis() ?? 0))
            .slice(0, 30),
        ),
      () => setRows([]),
    );
  }, [uid, programId]);
  return rows;
}

/** One conversation in a history list (the resident's own, or seen by faculty). */
export function HistoryRow({ r }: { r: Row }) {
  return (
    <li>
      <Link to={`/session/${r.id}/done`} className="history-link">
        <span>{r.scenarioTitle ?? 'Practice conversation'}</span>
        <span className="muted small">
          {r.startedAt?.toDate().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          {r.status === 'live' ? ' · open' : ''}
        </span>
      </Link>
      {r.feedbackBand && <span className="score-pill">{r.feedbackBand}</span>}
    </li>
  );
}

export function Progress() {
  const { userDoc, claims, signOut, user } = useAuth();
  const rows = useHistory(user?.uid);
  const programName = useProgramName(claims?.programId);
  return (
    <section>
      <h1>Your progress</h1>
      <PatientsDone uid={user?.uid} />
      <ProgressDashboard uid={user?.uid} />
      <div className="card">
        <h2>Your history</h2>
        {rows === null ? (
          <p className="muted">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="muted">No conversations yet.</p>
        ) : (
          <ul className="list">
            {rows.map((r) => (
              <HistoryRow key={r.id} r={r} />
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
            {claims?.role === 'faculty' ? 'Faculty' : 'Resident'} · {programName}
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

/** How many patients they've completed, and each one's status (theirs, or a resident faculty look at). */
export function PatientsDone({ uid }: { uid: string | undefined }) {
  const { claims } = useAuth();
  const rows = useScenarioList(claims)?.filter((s) => s.status === 'active');
  const progress = usePatientProgress(uid);
  if (!rows?.length || !progress) return null;
  const done = rows.filter((s) => ['completed', 'mastered'].includes(progress[s.id]?.status ?? ''));
  const mastered = rows.filter((s) => progress[s.id]?.status === 'mastered');
  return (
    <div className="card">
      <h2>Your patients</h2>
      <p>
        <strong>
          {done.length} of {rows.length}
        </strong>{' '}
        completed{mastered.length ? `, ${mastered.length} mastered` : ''}.
      </p>
      <ul className="tight">
        {rows.map((s) => (
          <li key={s.id} className="scenario-top">
            <Link to={`/scenario/${s.id}`}>
              {s.patientName}: {s.title}
            </Link>
            <PatientBadge status={progress[s.id]?.status} />
          </li>
        ))}
      </ul>
      <p className="small muted">
        Complete a patient with Solid or better in all four areas, and by picking up on what matters
        most to them, in one conversation.
      </p>
    </div>
  );
}
