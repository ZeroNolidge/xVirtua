import { useEffect, useState, type FormEvent } from 'react';
import { collection, onSnapshot, query, where, type Timestamp } from 'firebase/firestore';
import { sendSignInLinkToEmail } from 'firebase/auth';
import type { Role } from '@plainspeak/shared';
import { auth, db } from '../../lib/firebase';
import { api, friendlyError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { signInLinkSettings } from '../../lib/signInLink';
import { Settings } from './Settings';

interface InviteRow {
  email: string;
  role: Role;
  status: 'pending' | 'accepted' | 'revoked';
  createdAt?: Timestamp;
}

export function Invites() {
  const { claims } = useAuth();
  const [rows, setRows] = useState<InviteRow[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('resident');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (!claims) return;
    const q = query(collection(db, 'invites'), where('programId', '==', claims.programId));
    return onSnapshot(q, (snap) => {
      const list = snap.docs.map((d) => d.data() as InviteRow);
      list.sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0));
      setRows(list);
    });
  }, [claims]);

  async function invite(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const { data } = await api.createInvite({ email, role });
      // Firebase emails them a sign-in link. The invite is what lets them in.
      await sendSignInLinkToEmail(auth, data.email, signInLinkSettings());
      setMsg({ kind: 'ok', text: `Invite sent to ${data.email}.` });
      setEmail('');
    } catch (err) {
      setMsg({ kind: 'error', text: friendlyError(err) });
    } finally {
      setBusy(false);
    }
  }

  async function revoke(address: string) {
    try {
      await api.revokeInvite({ email: address });
    } catch (err) {
      setMsg({ kind: 'error', text: friendlyError(err) });
    }
  }

  return (
    <section>
      <h1>Invite people</h1>
      <form className="card" onSubmit={invite}>
        <label className="field">
          <span>Email</span>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span>Role</span>
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="resident">Resident</option>
            <option value="faculty">Faculty</option>
          </select>
        </label>
        {msg && (
          <p className={msg.kind === 'error' ? 'error' : 'ok'} role="status">
            {msg.text}
          </p>
        )}
        <button className="btn" disabled={busy}>
          {busy ? 'Sending…' : 'Send invite'}
        </button>
      </form>

      <div className="card">
        <h2>Invites</h2>
        {rows.length === 0 && <p className="muted">No invites yet.</p>}
        <ul className="list">
          {rows.map((r) => (
            <li key={r.email}>
              <div>
                <div>{r.email}</div>
                <div className="muted small">
                  {r.role} · {r.status}
                </div>
              </div>
              {r.status === 'pending' && (
                <button className="btn btn-text btn-inline" onClick={() => void revoke(r.email)}>
                  Revoke
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
      <Settings />
    </section>
  );
}
