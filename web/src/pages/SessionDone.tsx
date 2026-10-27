import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { collection, doc, getDoc, getDocs, onSnapshot, orderBy, query } from 'firebase/firestore';
import type { ResidentFeedback } from '@plainspeak/shared';
import { db } from '../lib/firebase';
import { friendlyError, isConnectionError } from '../lib/api';
import { reportError } from '../lib/errorReport';
import { sessionApi } from '../lib/session';
import { ScoreView } from '../components/ScoreView';
import { Loading } from './StatusScreens';
import { Transcript, type Bubble } from './Session';
import { canContinue, type SessionRow } from '../lib/resume';

type Meta = Partial<SessionRow>;

type FeedbackState =
  | { state: 'loading' }
  | { state: 'missing' }
  | { state: 'working' }
  | { state: 'ok'; feedback: ResidentFeedback }
  | { state: 'error'; message: string };

/** The saved conversation plus its saved feedback (read live, never rescored). */
function useConversation(id: string) {
  const [bubbles, setBubbles] = useState<Bubble[] | null>(null);
  const [meta, setMeta] = useState<Meta>({});
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [s, t] = await Promise.all([
        getDoc(doc(db, 'sessions', id)),
        getDocs(query(collection(db, 'sessions', id, 'turns'), orderBy('idx'))),
      ]);
      if (cancelled) return;
      setMeta((s.data() as Meta | undefined) ?? {});
      setBubbles(
        t.docs.map((d) => {
          const x = d.data() as {
            idx: number;
            speaker: 'patient' | 'resident';
            text: string;
            nonverbal?: string[];
          };
          return { key: `t${x.idx}`, who: x.speaker, text: x.text, nonverbal: x.nonverbal };
        }),
      );
    })().catch(() => {
      if (!cancelled) setBubbles([]);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);
  return { bubbles, meta };
}

/** Quiet retries when the answer is lost to a dropped signal. */
const RETRIES = 3;
const RETRY_WAIT_MS = 3000;

function useSavedFeedback(id: string): [FeedbackState, (s: FeedbackState) => void] {
  const [fb, setFb] = useState<FeedbackState>({ state: 'loading' });
  useEffect(() => {
    return onSnapshot(
      doc(db, 'sessions', id, 'feedback', 'current'),
      (snap) => {
        if (snap.exists()) setFb({ state: 'ok', feedback: snap.data() as ResidentFeedback });
        else setFb((cur) => (cur.state === 'loading' ? { state: 'missing' } : cur));
      },
      () => setFb((cur) => (cur.state === 'loading' ? { state: 'missing' } : cur)),
    );
  }, [id]);
  return [fb, setFb];
}

export function SessionDone() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const { bubbles, meta } = useConversation(id);
  const [fb, setFb] = useSavedFeedback(id);
  const [showTranscript, setShowTranscript] = useState(false);
  const asked = useRef(false);

  const residentTurns = bubbles?.filter((b) => b.who === 'resident').length ?? 0;
  const resumable = meta.status === 'live' && canContinue(meta as SessionRow);

  /** Scores once on the server. The saved result then arrives through the listener above. */
  async function requestFeedback() {
    asked.current = true;
    setFb({ state: 'working' });
    // A dropped signal loses the answer, not the work: the server keeps the
    // feedback, so asking again soon just fetches it.
    for (let attempt = 0; ; attempt++) {
      try {
        const { data } = await sessionApi.score({ sessionId: id });
        if (data.feedback) setFb({ state: 'ok', feedback: data.feedback });
        return;
      } catch (e) {
        if (isConnectionError(e) && attempt < RETRIES) {
          await new Promise((r) => setTimeout(r, RETRY_WAIT_MS));
          continue;
        }
        return failed(e);
      }
    }
    function failed(e: unknown) {
      const code = typeof e === 'object' && e && 'code' in e ? String(e.code) : '';
      // Another tab or an earlier visit is already writing it: wait for it to arrive.
      if (code.endsWith('aborted')) return;
      reportError('scoreSession', e);
      setFb({ state: 'error', message: friendlyError(e) });
    }
  }

  // Only when nothing is saved yet: a finished conversation with something said.
  const needsScoring =
    fb.state === 'missing' &&
    bubbles !== null &&
    residentTurns > 0 &&
    meta.status !== undefined &&
    !resumable;
  useEffect(() => {
    if (!needsScoring || asked.current) return;
    const t = window.setTimeout(() => void requestFeedback(), 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsScoring]);

  if (!bubbles || fb.state === 'loading') return <Loading label="Loading your conversation…" />;
  const first = meta.persona?.name.split(' ')[0] ?? 'the patient';
  const practiceSec = Math.max(0, (meta.durationSec ?? 0) - (meta.appWaitSec ?? 0));
  const mins = practiceSec ? Math.max(1, Math.round(practiceSec / 60)) : null;

  // Nothing was said: no praise, just an easy way back in.
  if (residentTurns === 0) {
    return (
      <section>
        <h1>This one didn’t get going.</h1>
        <div className="card">
          <p>Want to try again?</p>
          <Link to={meta.scenarioId ? `/scenario/${meta.scenarioId}` : '/'} className="btn">
            Try again
          </Link>
          <Link to="/" className="btn btn-text">
            Back to patients
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section>
      <h1>
        {fb.state === 'ok' ? 'Nice work 👏' : resumable ? 'What you said so far' : 'Your feedback'}
      </h1>
      <p className="muted">
        {meta.scenarioTitle ? `${meta.scenarioTitle} · ` : ''}
        {residentTurns} {residentTurns === 1 ? 'turn' : 'turns'}
        {mins ? ` · about ${mins} min` : ''}
      </p>

      {resumable && fb.state === 'missing' && (
        <div className="card">
          <p>This conversation is still open. Everything you said is saved.</p>
          <button className="btn" onClick={() => nav(`/session/${id}`, { replace: true })}>
            Pick up where you left off
          </button>
          <button className="btn btn-secondary" onClick={() => void requestFeedback()}>
            Get feedback on what you said
          </button>
        </div>
      )}

      {fb.state === 'working' && (
        <div className="card center-card">
          <div className="spinner" aria-hidden="true" />
          <p className="muted">
            Reading your conversation and writing feedback… This takes about 30 seconds.
          </p>
        </div>
      )}
      {fb.state === 'error' && (
        <div className="card">
          <p className="error" role="alert">
            {fb.message}
          </p>
          <button className="btn" onClick={() => void requestFeedback()}>
            Try again
          </button>
        </div>
      )}
      {fb.state === 'ok' && <ScoreView feedback={fb.feedback} patientFirstName={first} />}

      <button
        className="btn btn-text"
        aria-expanded={showTranscript}
        onClick={() => setShowTranscript((x) => !x)}
      >
        {showTranscript ? 'Hide the conversation' : 'Show the whole conversation'}
      </button>
      {showTranscript && (
        <div className="card">
          <Transcript bubbles={bubbles} patientFirstName={first} />
          <p className="muted small">{meta.audioPath ? 'Recording saved.' : 'Transcript saved.'}</p>
        </div>
      )}

      {fb.state !== 'working' && !resumable && (
        <Link to="/" className="btn">
          Practice again
        </Link>
      )}
    </section>
  );
}
