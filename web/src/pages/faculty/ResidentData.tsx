import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where, type Timestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../lib/firebase';
import { useAuth } from '../../lib/auth';
import { friendlyError } from '../../lib/api';

interface ResidentRow {
  uid: string;
  email: string;
  displayName?: string;
  role: string;
  endDate?: Timestamp | null;
}

const setEndDate = httpsCallable<{ uid: string; endDate: string | null }, { ok: true }>(
  functions,
  'setResidentEndDate',
);
const deleteData = httpsCallable<
  { uid: string; confirmEmail: string },
  { ok: true; sessions: number }
>(functions, 'deleteResidentData');

const isoDay = (t: Timestamp | null | undefined) =>
  t ? t.toDate().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) : '';

/**
 * Faculty: when each resident graduates or leaves (their recordings and
 * transcripts are deleted after that date), and deleting one resident's data early.
 */
export function ResidentData() {
  const { claims } = useAuth();
  const [rows, setRows] = useState<ResidentRow[]>([]);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!claims) return;
    const q = query(collection(db, 'users'), where('programId', '==', claims.programId));
    return onSnapshot(q, (snap) => {
      const list = snap.docs
        .map((d) => ({ uid: d.id, ...(d.data() as Omit<ResidentRow, 'uid'>) }))
        .filter((r) => r.role === 'resident')
        .sort((a, b) => a.email.localeCompare(b.email));
      setRows(list);
    });
  }, [claims]);

  async function saveDate(r: ResidentRow, value: string) {
    setBusy(r.uid);
    setMsg(null);
    try {
      await setEndDate({ uid: r.uid, endDate: value || null });
      setMsg({
        kind: 'ok',
        text: value ? `Saved. ${r.email}’s data will be deleted after ${value}.` : 'Date cleared.',
      });
    } catch (e) {
      setMsg({ kind: 'error', text: friendlyError(e) });
    } finally {
      setBusy(null);
    }
  }

  async function deleteNow(r: ResidentRow) {
    const typed = window.prompt(
      `This permanently deletes every recording and transcript for ${r.email}. Their account stays.\n\nType their email to confirm:`,
    );
    if (!typed) return;
    setBusy(r.uid);
    setMsg(null);
    try {
      const { data } = await deleteData({ uid: r.uid, confirmEmail: typed });
      setMsg({
        kind: 'ok',
        text: `Deleted ${data.sessions} conversation${data.sessions === 1 ? '' : 's'} for ${r.email}.`,
      });
    } catch (e) {
      setMsg({ kind: 'error', text: friendlyError(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card">
      <h2>Resident data</h2>
      <p className="muted small">
        Recordings and transcripts are kept until a resident graduates or leaves (up to 3 years),
        then deleted automatically. Set the date below.
      </p>
      {msg && (
        <p className={msg.kind === 'error' ? 'error' : 'ok'} role="status">
          {msg.text}
        </p>
      )}
      {rows.length === 0 && <p className="muted">No residents yet.</p>}
      <ul className="list">
        {rows.map((r) => (
          <li key={r.uid} className="resident-row">
            <div className="resident-email">{r.email}</div>
            <label className="field inline-field">
              <span className="small">Graduates or leaves</span>
              <input
                type="date"
                defaultValue={isoDay(r.endDate)}
                disabled={busy === r.uid}
                onBlur={(e) => {
                  if (e.target.value !== isoDay(r.endDate)) void saveDate(r, e.target.value);
                }}
              />
            </label>
            <button
              className="btn btn-text btn-inline danger"
              disabled={busy === r.uid}
              onClick={() => void deleteNow(r)}
            >
              Delete data now
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
