import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { RETENTION_NOTICE } from '@plainspeak/shared';
import { db } from '../../lib/firebase';
import { useAuth } from '../../lib/auth';
import { ProgressDashboard } from '../../components/ProgressDashboard';
import { HistoryRow, PatientsDone, useHistory } from '../Progress';

/** Faculty: one resident's progress, patients and conversations (tap one for its feedback). */
export function Resident() {
  const { uid = '' } = useParams();
  const { claims } = useAuth();
  const programId = claims?.programId;
  const [who, setWho] = useState<{ name: string; email: string } | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    getDoc(doc(db, 'users', uid))
      .then((s) => {
        if (!live) return;
        const d = s.data() as { displayName?: string; email?: string } | undefined;
        setWho(d ? { name: d.displayName?.trim() || d.email || uid, email: d.email ?? '' } : null);
      })
      .catch(() => live && setWho(null));
    return () => {
      live = false;
    };
  }, [uid]);
  const rows = useHistory(uid, programId);

  if (who === null)
    return (
      <section>
        <h1>Resident not found</h1>
        <Link to="/faculty" className="btn">
          Back to residents
        </Link>
      </section>
    );
  return (
    <section>
      <p>
        <Link to="/faculty" className="small">
          ← All residents
        </Link>
      </p>
      <h1>{who?.name ?? '…'}</h1>
      {who?.email && <p className="muted">{who.email}</p>}
      <PatientsDone uid={uid} />
      <ProgressDashboard uid={uid} programId={programId} />
      <div className="card">
        <h2>Conversations</h2>
        {rows === null ? (
          <p className="muted">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="muted">No conversations yet.</p>
        ) : (
          <ul className="list">
            {rows.map((r) => (
              <HistoryRow key={r.id} r={r} viewer="faculty" />
            ))}
          </ul>
        )}
        <p className="muted small retention-note">{RETENTION_NOTICE}</p>
      </div>
    </section>
  );
}
