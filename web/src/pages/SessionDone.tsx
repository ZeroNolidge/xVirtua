import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { collection, doc, getDoc, getDocs, orderBy, query } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { NONVERBAL_TEXT } from '../lib/voiceRenderer';
import { Loading } from './StatusScreens';

interface Turn {
  idx: number;
  speaker: 'patient' | 'resident';
  text: string;
  nonverbal?: string[];
  cueId?: string;
}

export function SessionDone() {
  const { id = '' } = useParams();
  const [turns, setTurns] = useState<Turn[] | null>(null);
  const [meta, setMeta] = useState<{
    durationSec?: number;
    audioPath?: string | null;
    scenarioTitle?: string;
  }>({});

  useEffect(() => {
    void (async () => {
      const s = await getDoc(doc(db, 'sessions', id));
      setMeta((s.data() as typeof meta) ?? {});
      const t = await getDocs(query(collection(db, 'sessions', id, 'turns'), orderBy('idx')));
      setTurns(t.docs.map((d) => d.data() as Turn));
    })().catch(() => setTurns([]));
  }, [id]);

  if (!turns) return <Loading label="Loading your conversation…" />;
  const residentTurns = turns.filter((t) => t.speaker === 'resident').length;
  const mins = meta.durationSec ? Math.max(1, Math.round(meta.durationSec / 60)) : null;

  return (
    <section>
      <h1>Nice work 👏</h1>
      <div className="card">
        <p>
          {meta.scenarioTitle ? `${meta.scenarioTitle}: ` : ''}
          {residentTurns} turns{mins ? `, about ${mins} min` : ''}.
        </p>
        <p className="muted small">
          {meta.audioPath ? 'Recording saved.' : 'Transcript saved.'} Scores and coaching tips
          arrive in the next update.
        </p>
        <Link to="/" className="btn">
          Practice again
        </Link>
      </div>
      <div className="card">
        <h2>Transcript</h2>
        <div className="chat static">
          {turns.map((t) => (
            <div key={t.idx} className={`bubble ${t.speaker}`}>
              {t.nonverbal?.length ? (
                <div className="nonverbal">
                  ({t.nonverbal.map((n) => NONVERBAL_TEXT[n] ?? n).join(', ')})
                </div>
              ) : null}
              {t.text}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
