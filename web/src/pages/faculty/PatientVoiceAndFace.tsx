import { useEffect, useState, type FormEvent } from 'react';
import type { ScenarioAvatar } from '@plainspeak/shared';
import { api, friendlyError } from '../../lib/api';
import type { ScenarioRow } from '../../lib/scenarios';

const MOODS: { key: keyof ScenarioAvatar['faces']; label: string; hint: string }[] = [
  { key: 'guarded', label: 'Guarded (start)', hint: 'Every visit starts on this face.' },
  { key: 'at_ease', label: 'At ease', hint: 'Once the resident has earned some trust.' },
  { key: 'happy', label: 'Happy', hint: 'When the visit goes well.' },
  { key: 'upset', label: 'Upset', hint: 'When it goes badly (optional).' },
];

/**
 * Faculty: this patient's own standard voice and Simli faces. Without them,
 * the app uses a stable pick for the voice, and the built-in faces (Ray,
 * Linda) or the program's generic face.
 */
export function PatientVoiceAndFace({
  summary,
  pronouns,
}: {
  summary: ScenarioRow;
  pronouns: string;
}) {
  return (
    <div className="card">
      <h2>Voice and face</h2>
      <StandardVoice summary={summary} pronouns={pronouns} />
      <Faces summary={summary} />
    </div>
  );
}

function StandardVoice({ summary, pronouns }: { summary: ScenarioRow; pronouns: string }) {
  const [voices, setVoices] = useState<{ id: string; name: string; description: string }[] | null>(
    null,
  );
  const [chosen, setChosen] = useState(summary.ttsVoice ?? '');
  const [busy, setBusy] = useState<'list' | 'save' | 'play' | null>('list');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api
      .listTtsVoices({ pronouns })
      .then((r) => live && setVoices(r.data.voices))
      .catch((e) => live && setError(friendlyError(e)))
      .finally(() => live && setBusy(null));
    return () => {
      live = false;
    };
  }, [summary.id, pronouns]);

  async function choose(id: string) {
    setChosen(id);
    setBusy('save');
    setError(null);
    try {
      await api.setScenarioTtsVoice({ scenarioId: summary.id, voice: id || null });
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(null);
    }
  }

  async function play() {
    if (!chosen) return;
    setBusy('play');
    setError(null);
    try {
      const { data } = await api.ttsSample({ voice: chosen });
      const audio = new Audio(`data:audio/mpeg;base64,${data.mp3}`);
      await audio.play();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <label className="field">
        <span>Standard voice</span>
        <select
          value={chosen}
          disabled={busy !== null || !voices}
          onChange={(e) => void choose(e.target.value)}
        >
          <option value="">A stable pick for the patient’s pronouns</option>
          {voices?.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
              {v.description ? ` — ${v.description.slice(0, 60)}` : ''}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="btn btn-secondary"
        disabled={!chosen || busy !== null}
        onClick={() => void play()}
      >
        {busy === 'play' ? 'Loading…' : 'Play a sample'}
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

function Faces({ summary }: { summary: ScenarioRow }) {
  const saved = summary.avatar;
  const [faces, setFaces] = useState<Record<string, string>>(() => ({
    guarded: saved?.faces.guarded ?? '',
    at_ease: saved?.faces.at_ease ?? '',
    happy: saved?.faces.happy ?? '',
    upset: saved?.faces.upset ?? '',
  }));
  const [background, setBackground] = useState(saved?.background ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const trimmed = Object.fromEntries(Object.entries(faces).map(([k, v]) => [k, v.trim()]));
      const { data } = await api.setScenarioAvatar({
        scenarioId: summary.id,
        faces: trimmed,
        ...(background.trim() ? { background: background.trim() } : {}),
      });
      setMsg({
        kind: 'ok',
        text: data.avatar
          ? 'Saved. New conversations use these faces.'
          : 'Cleared. The built-in or program face applies again.',
      });
    } catch (e) {
      setMsg({ kind: 'error', text: friendlyError(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void save(e)}>
      <h3>Simli faces</h3>
      <p className="muted small">
        Face IDs from app.simli.com (Avatars). Leave all empty to use the built-in faces for this
        patient, or the program’s generic face from Settings.
      </p>
      {MOODS.map((m) => (
        <label key={m.key} className="field">
          <span>
            {m.label} <span className="muted">— {m.hint}</span>
          </span>
          <input
            type="text"
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="Face ID"
            value={faces[m.key] ?? ''}
            onChange={(e) => setFaces((f) => ({ ...f, [m.key]: e.target.value }))}
          />
        </label>
      ))}
      <label className="field">
        <span>
          Room <span className="muted">— a Simli background ID, the same behind every face</span>
        </span>
        <input
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder="Background ID (optional)"
          value={background}
          onChange={(e) => setBackground(e.target.value)}
        />
      </label>
      <button className="btn" type="submit" disabled={busy}>
        {busy ? 'Saving…' : 'Save faces'}
      </button>
      {msg && (
        <p
          className={msg.kind === 'error' ? 'error' : 'ok'}
          role={msg.kind === 'error' ? 'alert' : 'status'}
        >
          {msg.text}
        </p>
      )}
    </form>
  );
}
