import { useState, type FormEvent } from 'react';
import { cleanPreferredName } from '@plainspeak/shared';
import { api, friendlyError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { NameField } from '../components/NameField';

/** Asked once of people who signed up before the app asked for a name. */
export function ChooseName() {
  const { userDoc, signOut } = useAuth();
  const [name, setName] = useState(userDoc?.suggestedName ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clean = cleanPreferredName(name);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!clean) return;
    setBusy(true);
    setError(null);
    try {
      await api.setDisplayName({ name: clean });
    } catch (err) {
      setError(friendlyError(err));
      setBusy(false);
    }
  }

  return (
    <section>
      <h1>One quick thing</h1>
      <form className="card" onSubmit={save}>
        <NameField value={name} onChange={setName} />
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="btn" disabled={!clean || busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="btn btn-text" onClick={() => void signOut()}>
          Sign out
        </button>
      </form>
    </section>
  );
}
