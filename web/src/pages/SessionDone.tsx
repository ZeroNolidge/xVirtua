import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { collection, doc, getDoc, getDocs, orderBy, query } from 'firebase/firestore';
import type { ScoreDoc } from '@plainspeak/shared';
import { db } from '../lib/firebase';
import { friendlyError } from '../lib/api';
import { sessionApi } from '../lib/session';
import { ScoreView } from '../components/ScoreView';
import { Loading } from './StatusScreens';
import { Transcript, type Bubble } from './Session';
import { canContinue, type SessionRow } from '../lib/resume';

type Meta = Partial<SessionRow>;

type ScoreState =
  | { state: 'idle' }
  | { state: 'working' }
  | { state: 'ok'; score: ScoreDoc }
  | { state: 'none' }
  | { state: 'error'; message: string };

export function SessionDone() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const [bubbles, setBubbles] = useState<Bubble[] | null>(null);
  const [meta, setMeta] = useState<Meta>({});
  const [score, setScore] = useState<ScoreState>({ state: 'idle' });
  const [showTranscript, setShowTranscript] = useState(false);

  async function getFeedback() {
    setScore({ state: 'working' });
    try {
      const { data } = await sessionApi.score({ sessionId: id });
      setScore(data.score ? { state: 'ok', score: data.score } : { state: 'none' });
    } catch (e) {
      setScore({ state: 'error', message: friendlyError(e) });
    }
  }

  // Load the saved conversation, then score it if it's finished.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await getDoc(doc(db, 'sessions', id));
      const t = await getDocs(query(collection(db, 'sessions', id, 'turns'), orderBy('idx')));
      if (cancelled) return;
      const m = (s.data() as Meta | undefined) ?? {};
      const list = t.docs.map((d) => {
        const x = d.data() as {
          idx: number;
          speaker: 'patient' | 'resident';
          text: string;
          nonverbal?: string[];
        };
        return { key: `t${x.idx}`, who: x.speaker, text: x.text, nonverbal: x.nonverbal };
      });
      setMeta(m);
      setBubbles(list);
      const open = m.status === 'live' && canContinue(m as SessionRow);
      if (!open && list.some((b) => b.who === 'resident')) await getFeedback();
    })().catch(() => {
      if (!cancelled) setBubbles([]);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const residentTurns = bubbles?.filter((b) => b.who === 'resident').length ?? 0;
  const resumable = meta.status === 'live' && canContinue(meta as SessionRow);

  if (!bubbles) return <Loading label="Loading your conversation…" />;
  const first = meta.persona?.name.split(' ')[0] ?? 'the patient';
  const practiceSec = Math.max(0, (meta.durationSec ?? 0) - (meta.appWaitSec ?? 0));
  const mins = practiceSec ? Math.max(1, Math.round(practiceSec / 60)) : null;

  return (
    <section>
      <h1>
        {score.state === 'ok'
          ? 'Nice work 👏'
          : meta.status === 'live'
            ? 'What you said so far'
            : 'Nice work 👏'}
      </h1>
      <p className="muted">
        {meta.scenarioTitle ? `${meta.scenarioTitle} · ` : ''}
        {residentTurns} {residentTurns === 1 ? 'turn' : 'turns'}
        {mins ? ` · about ${mins} min` : ''}
      </p>

      {resumable && score.state === 'idle' && (
        <div className="card">
          <p>This conversation is still open. Everything you said is saved.</p>
          <button className="btn" onClick={() => nav(`/session/${id}`, { replace: true })}>
            Pick up where you left off
          </button>
          <button
            className="btn btn-secondary"
            disabled={!residentTurns}
            onClick={() => void getFeedback()}
          >
            Finish and get feedback
          </button>
        </div>
      )}

      {residentTurns === 0 && (
        <div className="card">
          <p>You didn’t get to say anything yet, so there’s nothing to give feedback on.</p>
          {meta.scenarioId && (
            <Link to={`/scenario/${meta.scenarioId}`} className="btn">
              Start this scenario again
            </Link>
          )}
        </div>
      )}

      {score.state === 'working' && (
        <div className="card center-card">
          <div className="spinner" aria-hidden="true" />
          <p className="muted">
            Reading your conversation and writing feedback… This takes about 30 seconds.
          </p>
        </div>
      )}
      {score.state === 'error' && (
        <div className="card">
          <p className="error" role="alert">
            {score.message}
          </p>
          <button className="btn" onClick={() => void getFeedback()}>
            Try again
          </button>
        </div>
      )}
      {score.state === 'ok' && <ScoreView score={score.score} patientFirstName={first} />}

      {residentTurns > 0 && (
        <>
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
              <p className="muted small">
                {meta.audioPath ? 'Recording saved.' : 'Transcript saved.'}
              </p>
            </div>
          )}
        </>
      )}

      {score.state !== 'working' && !resumable && (
        <Link to="/" className="btn">
          Practice again
        </Link>
      )}
    </section>
  );
}
