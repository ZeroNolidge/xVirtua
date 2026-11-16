import { useEffect, useRef, useState, type FormEvent } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { LIVE_VOICES, type LiveVoice, type Program, type ScenarioAvatar } from '@plainspeak/shared';
import { api, friendlyError } from '../../lib/api';
import { db, functions } from '../../lib/firebase';
import { useAuth } from '../../lib/auth';
import { TAG_LABEL } from './voiceTags';
import { plainVoiceDescription } from '../../lib/voiceDescription';
import type { ScenarioRow } from '../../lib/scenarios';

const MOODS: { key: keyof ScenarioAvatar['faces']; label: string; hint: string }[] = [
  { key: 'guarded', label: 'Guarded (start)', hint: 'Every visit starts on this face.' },
  { key: 'at_ease', label: 'At ease', hint: 'Once the resident has earned some trust.' },
  { key: 'happy', label: 'Happy', hint: 'When the visit goes well.' },
  { key: 'upset', label: 'Upset', hint: 'When it goes badly (optional).' },
];

const voiceSample = httpsCallable<{ voice: LiveVoice }, { voice: string; wav: string }>(
  functions,
  'voiceSample',
);

/**
 * Faculty: this patient's own voices (live and standard) and Simli faces.
 * Without them, the app uses the program's voice for the patient's pronouns,
 * a stable pick for the standard voice, and the built-in faces (Ray, Linda)
 * or the program's generic face.
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
      <h2>Voices and face</h2>
      <LiveVoicePick summary={summary} />
      <StandardVoice summary={summary} pronouns={pronouns} />
      <Faces summary={summary} />
    </div>
  );
}

/** The GPT-Live voice for this patient (with faculty's tags from Settings), and a recorded sample. */
function LiveVoicePick({ summary }: { summary: ScenarioRow }) {
  const { claims } = useAuth();
  const [tags, setTags] = useState<Program['liveVoiceTags']>({});
  const [chosen, setChosen] = useState<LiveVoice | ''>(summary.liveVoice ?? '');
  const [busy, setBusy] = useState<'save' | 'play' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    if (!claims) return;
    void getDoc(doc(db, 'programs', claims.programId)).then((s) =>
      setTags((s.data() as Program | undefined)?.liveVoiceTags ?? {}),
    );
  }, [claims]);
  useEffect(() => () => audio.current?.pause(), []);

  async function choose(v: string) {
    setChosen(v as LiveVoice | '');
    setBusy('save');
    setError(null);
    try {
      await api.setScenarioVoice({ scenarioId: summary.id, voice: v ? (v as LiveVoice) : null });
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
    audio.current?.pause();
    // Created inside the tap so phones allow it to play.
    const a = new Audio();
    audio.current = a;
    try {
      const { data } = await voiceSample({ voice: chosen });
      const bytes = Uint8Array.from(atob(data.wav), (ch) => ch.charCodeAt(0));
      a.src = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
      await a.play();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <label className="field">
        <span>
          Live voice (GPT-Live){' '}
          <span className="muted">— used when a conversation runs in live voice mode</span>
        </span>
        <select
          value={chosen}
          disabled={busy !== null}
          onChange={(e) => void choose(e.target.value)}
        >
          <option value="">Program default for the patient’s pronouns</option>
          {LIVE_VOICES.map((v) => (
            <option key={v} value={v}>
              {v}
              {tags?.[v] ? ` (${TAG_LABEL[tags[v]!]})` : ''}
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
        {busy === 'play' ? 'Loading…' : 'Hear the live voice'}
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </>
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
        <span>
          Standard voice (text-to-speech){' '}
          <span className="muted">— used when a conversation runs in standard mode</span>
        </span>
        <select
          value={chosen}
          disabled={busy !== null || !voices}
          onChange={(e) => void choose(e.target.value)}
        >
          <option value="">A stable pick for the patient’s pronouns</option>
          {voices?.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name.split(' - ')[0]}
              {plainVoiceDescription(v.description, v.name.split(' - ')[0]) &&
                ` — ${plainVoiceDescription(v.description, v.name.split(' - ')[0])}`}
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
        {busy === 'play' ? 'Loading…' : 'Hear the standard voice'}
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
