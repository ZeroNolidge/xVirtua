import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { ref, uploadBytes, uploadString } from 'firebase/storage';
import {
  LIVE_VOICES,
  MOODS,
  VIDEO_CHARACTERS,
  type LiveVoice,
  type Program,
} from '@plainspeak/shared';
import { db, functions, storage } from '../../lib/firebase';
import { useAuth } from '../../lib/auth';
import { friendlyError } from '../../lib/api';
import { PatientAvatar } from '../../lib/avatar';
import { BodyLanguage, type ClipManifest, type Mood } from '../../lib/bodyLanguage';
import { HeadMatcher } from '../../lib/headMatch';
import { StageRecorder } from '../../lib/stageRecorder';
import { AvatarStage, type AvatarElements } from '../../components/AvatarStage';

const faceToken = httpsCallable<{ patient: string; mood: Mood }, { token: string; faceId: string }>(
  functions,
  'faceCheck',
);
const voiceSample = httpsCallable<{ voice: LiveVoice }, { voice: string; wav: string }>(
  functions,
  'voiceSample',
);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(ok: () => boolean, ms: number) {
  const end = performance.now() + ms;
  while (!ok() && performance.now() < end) await sleep(100);
  return ok();
}

interface Note {
  t: number;
  type: string;
  [k: string]: unknown;
}

/**
 * Faculty: a one-tap, about one-minute test of a patient's video face. It
 * connects his face, has him say a recorded line, plays each body-language
 * clip and the mood change, records what the panel showed (with his voice),
 * and uploads the recording and timing notes for review.
 */
export function FaceCheck() {
  const { user, claims } = useAuth();
  const stage = useRef<AvatarElements | null>(null);
  const [slug, setSlug] = useState(Object.keys(VIDEO_CHARACTERS)[0] ?? '');
  const patient = VIDEO_CHARACTERS[slug]?.name ?? slug;
  const [voice, setVoice] = useState<LiveVoice>('stone');
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const cleanup = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    if (!claims) return;
    void getDoc(doc(db, 'programs', claims.programId)).then((s) => {
      const p = s.data() as Program | undefined;
      const v = p?.liveVoices?.he ?? p?.liveVoice;
      if (v) setVoice(v);
    });
  }, [claims]);
  useEffect(() => () => void cleanup.current?.(), []);

  async function run() {
    if (!claims || !user || !stage.current || running) return;
    const els = stage.current;
    setRunning(true);
    setError(null);
    setResult(null);
    setNotes([]);
    const log: Note[] = [];
    let clock = () => 0;
    const note = (type: string, extra: Record<string, unknown> = {}) => {
      const n = { t: +clock().toFixed(2), type, ...extra };
      log.push(n);
      setNotes((all) => [...all, n]);
    };
    // Created inside the tap, so phones allow the sound.
    const voiceEl = new Audio();
    const avatar = new PatientAvatar(els.video, els.audio, els.spare);
    avatar.onFail = (e) => note('face-error', { message: String(e).slice(0, 200) });
    const recorder = new StageRecorder(
      () => avatar.activeVideo,
      els.clip,
      () => avatar.activeAudio,
    );
    let sampler = 0;
    // Keep the screen on: a locked screen or another app pauses the videos.
    const nav = navigator as Navigator & {
      wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> };
    };
    const lock = await nav.wakeLock?.request('screen').catch(() => null);
    let hidden = false;
    const onHide = () => {
      if (document.hidden) {
        hidden = true;
        note('page-hidden');
      }
    };
    document.addEventListener('visibilitychange', onHide);
    const stillHere = () => {
      if (hidden)
        throw new Error(
          'The face check stopped because the screen locked or another app opened. Keep this page open and run it again.',
        );
    };
    cleanup.current = async () => {
      document.removeEventListener('visibilitychange', onHide);
      void lock?.release().catch(() => undefined);
      window.clearInterval(sampler);
      voiceEl.pause();
      await recorder.stop();
      await avatar.dispose();
    };
    try {
      setStatus('Loading his clips and voice…');
      const base = `/avatars/${slug}`;
      const r = await fetch(`${base}/manifest.json`);
      if (!r.ok || !r.headers.get('content-type')?.includes('json'))
        throw new Error(`No clips found for ${patient}.`);
      const manifest = (await r.json()) as ClipManifest;
      const { data } = await voiceSample({ voice });
      const wav = Uint8Array.from(atob(data.wav), (c) => c.charCodeAt(0));
      voiceEl.src = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));

      const body = new BodyLanguage(manifest, base, els.clip, () => avatar.activeVideo, 1500, 0);
      body.onEvent = (e) => note(String(e.type), e);
      body.onPrepare = async (m) => {
        const t = performance.now();
        const ok = await avatar.prepareFace(
          async () => (await faceToken({ patient: slug, mood: m })).data.token,
        );
        note('next-face-ready', { ok, ms: Math.round(performance.now() - t) });
        return ok;
      };
      let swappedFaces = false;
      body.onMood = (m) => {
        const swapped = avatar.commitFace();
        swappedFaces = true;
        note('face-swap', { mood: m, swapped });
        recorder.attachVoice();
        body.reveal();
      };
      await body.load();

      setStatus('Connecting his face…');
      const t = performance.now();
      const up = await avatar.connect(
        async () => (await faceToken({ patient: slug, mood: 'guarded' })).data.token,
      );
      if (!up) throw new Error('His face didn’t connect. Check the face IDs in Settings.');
      avatar.feedElement(voiceEl);
      recorder.start();
      clock = () => recorder.now();
      note('face-up', { connectMs: Math.round(performance.now() - t), voice });

      // Where his live head drifts, 4 times a second (the clips start from his resting pose).
      const heads = new HeadMatcher();
      for (const m of Object.values(manifest.moods))
        if (m?.poster) await heads.addReference(`${base}/${m.poster}`).catch(() => undefined);
      sampler = window.setInterval(() => {
        const o = heads.offset(avatar.activeVideo, body.poster);
        if (o)
          note('head', {
            x: +(o.x * 100).toFixed(2),
            y: +(o.y * 100).toFixed(2),
            scale: +o.scale.toFixed(3),
          });
      }, 250);

      const say = async () => {
        stillHere();
        note('says');
        body.setSpeaking(true);
        voiceEl.currentTime = 0;
        await voiceEl.play();
        await until(() => voiceEl.ended, 20_000);
        body.setSpeaking(false);
        note('said');
      };
      const clips = async (mood: Mood) => {
        for (const cue of Object.keys(manifest.moods[mood]?.clips ?? {})) {
          stillHere();
          setStatus(`Clip: ${cue.replace(/_/g, ' ')}`);
          note('cue', { cue });
          const played = await body.cue([cue as never]);
          if (played) await until(() => !els.clip.classList.contains('on'), 10_000);
          await sleep(1500);
        }
      };

      await sleep(1500);
      setStatus('He says a line (guarded face)…');
      await say();
      await sleep(1000);
      await clips(manifest.start);
      // Then every other mood they have: down the ladder and back, then up.
      const have = (m: Mood) => !!manifest.moods[m];
      const at = MOODS.indexOf(manifest.start);
      const down = MOODS.slice(0, at).reverse().filter(have);
      const higher = MOODS.slice(at + 1).filter(have);
      const route = [...down, ...(down.length && higher.length ? [manifest.start] : []), ...higher];
      for (const m of route) {
        stillHere();
        setStatus(`Mood: ${m.replace('_', ' ')}…`);
        note('move', { to: m });
        swappedFaces = false;
        body.moveTo(m);
        await until(() => swappedFaces && !els.clip.classList.contains('on'), 30_000);
        await sleep(1500);
        if (m === manifest.start) continue; // already tested
        setStatus(`A line (${m.replace('_', ' ')} face)…`);
        await say();
        await sleep(1000);
        await clips(m);
      }
      stillHere();
      note('stats', { ...body.stats });

      setStatus('Uploading the recording…');
      window.clearInterval(sampler);
      const video = await recorder.stop();
      await avatar.dispose();
      cleanup.current = null;
      const id = `fc-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      const folder = `faceChecks/${claims.programId}/${user.uid}`;
      if (video)
        await uploadBytes(ref(storage, `${folder}/${id}.${recorder.ext}`), video, {
          contentType: recorder.mimeType.split(';')[0] || 'video/webm',
        });
      await uploadString(
        ref(storage, `${folder}/${id}.json`),
        JSON.stringify({ id, patient, voice, userAgent: navigator.userAgent, notes: log }),
        'raw',
        { contentType: 'application/json' },
      );
      setResult(id);
      setStatus(null);
    } catch (e) {
      setError(friendlyError(e));
      setStatus(null);
      await cleanup.current?.();
      cleanup.current = null;
    } finally {
      document.removeEventListener('visibilitychange', onHide);
      void lock?.release().catch(() => undefined);
      setRunning(false);
    }
  }

  return (
    <main className="page">
      <p>
        <Link to="/faculty">← Faculty</Link>
      </p>
      <h1>Face check</h1>
      <p className="muted">
        A one-minute test of a patient’s video face: he says a recorded line, then each
        body-language clip plays, then he relaxes and does it again on his at-ease face. The
        recording and timing notes are saved for review. Uses about a minute of the video avatar.
      </p>
      <label className="field">
        <span>Patient</span>
        <select value={slug} disabled={running} onChange={(e) => setSlug(e.target.value)}>
          {Object.entries(VIDEO_CHARACTERS).map(([id, c]) => (
            <option key={id} value={id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Voice for his line</span>
        <select
          value={voice}
          disabled={running}
          onChange={(e) => setVoice(e.target.value as LiveVoice)}
        >
          {LIVE_VOICES.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <AvatarStage ref={stage} show={running || !!result} name={patient} />
      {status && (
        <p className="muted" role="status">
          {status}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {result && (
        <p role="status">
          Done. Saved as <strong>{result}</strong>. Tell Claude the face check is ready.
        </p>
      )}
      <button className="btn btn-primary" disabled={running} onClick={() => void run()}>
        {running ? 'Running…' : result ? 'Run again' : 'Run face check'}
      </button>
      {notes.length > 0 && (
        <details className="field">
          <summary>Timing notes ({notes.length})</summary>
          <ul className="tight small">
            {notes
              .filter((n) => n.type !== 'head')
              .map((n, i) => (
                <li key={i}>
                  {n.t.toFixed(2)}s {n.type}{' '}
                  {Object.entries(n)
                    .filter(([k]) => k !== 't' && k !== 'type')
                    .map(([k, v]) => `${k}=${String(v)}`)
                    .join(' ')}
                </li>
              ))}
          </ul>
        </details>
      )}
    </main>
  );
}
