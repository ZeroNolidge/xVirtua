import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ref, uploadBytes } from 'firebase/storage';
import { storage } from '../lib/firebase';
import { useAuth } from '../lib/auth';
import { friendlyError } from '../lib/api';
import { fetchPatientAudio, sessionApi, type Utterance } from '../lib/session';
import { NONVERBAL_TEXT, VoiceRenderer } from '../lib/voiceRenderer';
import { OpenAIRealtimeStt } from '../lib/stt';
import { SessionRecorder } from '../lib/recorder';
import { PlainWordSearch } from '../components/PlainWordSearch';

type Phase = 'ready' | 'connecting' | 'patient' | 'listening' | 'thinking' | 'ending';
interface Bubble {
  key: string;
  who: 'patient' | 'resident';
  text: string;
  nonverbal?: string[];
}
interface StartState {
  opening: Utterance;
  persona: { name: string; age: number; pronouns: string };
}

/** Wait this long after the resident stops talking before sending their turn. */
const SEND_AFTER_SILENCE_MS = 1400;

export function Session() {
  const { id: sessionId = '' } = useParams();
  const nav = useNavigate();
  const start = useLocation().state as StartState | null;
  const { claims, user } = useAuth();

  const [phase, setPhaseState] = useState<Phase>('ready');
  const phaseRef = useRef<Phase>('ready');
  const setPhase = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhaseState(p);
  }, []);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [partial, setPartial] = useState('');
  const [typed, setTyped] = useState(false);
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [lookupOpen, setLookupOpen] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  const renderer = useRef<VoiceRenderer | null>(null);
  const stt = useRef<OpenAIRealtimeStt | null>(null);
  const recorder = useRef<SessionRecorder | null>(null);
  const mic = useRef<MediaStream | null>(null);
  const t0 = useRef(0);
  const pending = useRef<{ text: string[]; tStart: number | null; timer: number | null }>({
    text: [],
    tStart: null,
    timer: null,
  });
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => bottom.current?.scrollIntoView({ behavior: 'smooth' }), [bubbles, partial]);

  const addBubble = (b: Bubble) => setBubbles((xs) => [...xs, b]);

  const speak = useCallback(
    async (u: Utterance) => {
      setPhase('patient');
      stt.current?.setMuted(true);
      const audio = await fetchPatientAudio(sessionId, u.idx);
      await renderer.current?.speak(u, audio);
      if (phaseRef.current === 'ending') return;
      stt.current?.setMuted(false);
      setPhase('listening');
    },
    [sessionId, setPhase],
  );

  const sendTurn = useCallback(
    async (text: string, source: 'voice' | 'typed', tStartMs?: number) => {
      if (!text.trim() || phaseRef.current === 'ending') return;
      addBubble({ key: `r${Date.now()}`, who: 'resident', text });
      setPartial('');
      setPhase('thinking');
      stt.current?.setMuted(true);
      try {
        const { data } = await sessionApi.turn({
          sessionId,
          text,
          source,
          ...(tStartMs !== undefined ? { tStartMs } : {}),
          tEndMs: Math.round(performance.now() - t0.current),
        });
        await speak(data.patient);
      } catch (e) {
        setNotice(friendlyError(e));
        stt.current?.setMuted(false);
        setPhase('listening');
      }
    },
    [sessionId, speak, setPhase],
  );

  // Voice turns: collect transcript pieces and send after a short silence.
  const flushVoice = useCallback(() => {
    const p = pending.current;
    if (p.timer) window.clearTimeout(p.timer);
    p.timer = null;
    const text = p.text.join(' ').trim();
    const tStart = p.tStart ?? undefined;
    p.text = [];
    p.tStart = null;
    if (text) void sendTurn(text, 'voice', tStart);
  }, [sendTurn]);

  const scheduleFlush = useCallback(() => {
    const p = pending.current;
    if (p.timer) window.clearTimeout(p.timer);
    p.timer = window.setTimeout(flushVoice, SEND_AFTER_SILENCE_MS);
  }, [flushVoice]);

  async function begin() {
    if (!start) return;
    setPhase('connecting');
    setNotice(null);
    renderer.current = new VoiceRenderer((u, speaking) => {
      if (u && speaking)
        addBubble({ key: `p${Date.now()}`, who: 'patient', text: u.text, nonverbal: u.nonverbal });
    });
    await renderer.current.mount(); // inside the tap: unlocks audio on iOS
    t0.current = performance.now();

    try {
      mic.current = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      recorder.current = new SessionRecorder(mic.current);
      recorder.current.start();
    } catch {
      setTyped(true);
      setNotice('No microphone access, so you can type your side for now.');
    }

    if (mic.current) {
      try {
        const { data } = await sessionApi.sttToken({ sessionId });
        stt.current = new OpenAIRealtimeStt({
          onSpeechStart: () => {
            const p = pending.current;
            if (p.timer) window.clearTimeout(p.timer);
            p.timer = null;
            p.tStart ??= Math.round(performance.now() - t0.current);
          },
          onPartial: (t) => setPartial([...pending.current.text, t].join(' ')),
          onFinal: (t) => {
            pending.current.text.push(t);
            setPartial(pending.current.text.join(' '));
            scheduleFlush();
          },
          onError: (m) => {
            setNotice(`${m} You can type instead.`);
            setTyped(true);
          },
        });
        await stt.current.start(mic.current, data.value);
      } catch (e) {
        stt.current = null;
        setTyped(true);
        setNotice(`Voice input isn’t available (${friendlyError(e)}). You can type your side.`);
      }
    }
    await speak(start.opening);
  }

  async function finish() {
    if (!window.confirm('End the conversation and get feedback?')) return;
    setPhase('ending');
    const p = pending.current;
    if (p.timer) window.clearTimeout(p.timer);
    stt.current?.stop();
    renderer.current?.dispose();
    setSaving('Saving…');
    try {
      await sessionApi.end({ sessionId });
      const blob = await recorder.current?.stop();
      mic.current?.getTracks().forEach((t) => t.stop());
      if (blob && claims && user) {
        setSaving('Saving your recording…');
        const ext = recorder.current!.ext;
        const path = `audio/${claims.programId}/${user.uid}/${sessionId}/recording.${ext}`;
        await uploadBytes(ref(storage, path), blob, { contentType: blob.type || 'audio/webm' });
        await sessionApi.end({ sessionId, audioExt: ext });
      }
    } catch (e) {
      // The transcript is already saved; a failed audio upload shouldn't block feedback.
      console.warn('end/upload failed', e);
    }
    nav(`/session/${sessionId}/done`, { replace: true });
  }

  useEffect(
    () => () => {
      stt.current?.stop();
      renderer.current?.dispose();
      mic.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  function submitTyped(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || phase !== 'listening') return;
    setDraft('');
    void sendTurn(text, 'typed');
  }

  if (!start) {
    return (
      <section>
        <h1>This conversation can’t be resumed</h1>
        <div className="card">
          <p>Start a new one from the patient list.</p>
          <button className="btn" onClick={() => nav('/', { replace: true })}>
            Back to patients
          </button>
        </div>
      </section>
    );
  }

  const status: Record<Phase, string> = {
    ready: 'Ready when you are',
    connecting: 'Connecting…',
    patient: `${start.persona.name.split(' ')[0]} is talking…`,
    listening: typed ? 'Your turn: type your reply' : 'Listening… just talk',
    thinking: `${start.persona.name.split(' ')[0]} is thinking…`,
    ending: saving ?? 'Wrapping up…',
  };

  return (
    <section className="session">
      <header className="session-head">
        <div className={`avatar ${phase === 'patient' ? 'speaking' : ''}`} aria-hidden="true">
          {start.persona.name
            .split(' ')
            .map((x) => x[0])
            .join('')}
        </div>
        <div>
          <div className="patient-name">{start.persona.name}</div>
          <div className="muted small" role="status" aria-live="polite">
            {status[phase]}
          </div>
        </div>
      </header>

      {notice && (
        <p className="notice" role="alert">
          {notice}
        </p>
      )}

      {phase === 'ready' ? (
        <div className="card">
          <p>
            Talk naturally, like you’re in the room. {start.persona.name.split(' ')[0]} will answer
            out loud. When you’re done, tap <strong>End</strong> to get feedback.
          </p>
          <p className="muted small">Your microphone is recorded for this practice session.</p>
          <button className="btn" onClick={() => void begin()}>
            Start talking
          </button>
        </div>
      ) : (
        <div className="chat" aria-live="polite">
          {bubbles.map((b) => (
            <div key={b.key} className={`bubble ${b.who}`}>
              {b.nonverbal?.length ? (
                <div className="nonverbal">
                  ({b.nonverbal.map((n) => NONVERBAL_TEXT[n] ?? n).join(', ')})
                </div>
              ) : null}
              {b.text}
            </div>
          ))}
          {partial && <div className="bubble resident partial">{partial}</div>}
          <div ref={bottom} />
        </div>
      )}

      {phase !== 'ready' && phase !== 'ending' && (
        <div className="session-controls">
          {typed && (
            <form className="typed" onSubmit={submitTyped}>
              <input
                aria-label="Your reply"
                placeholder={phase === 'listening' ? 'Type what you’d say…' : 'Wait for your turn…'}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={phase !== 'listening'}
              />
              <button className="btn btn-inline" disabled={phase !== 'listening' || !draft.trim()}>
                Send
              </button>
            </form>
          )}
          <div className="session-buttons">
            <button className="btn btn-secondary btn-inline" onClick={() => setLookupOpen(true)}>
              Plain words
            </button>
            {!typed && (
              <button className="btn btn-text btn-inline" onClick={() => setTyped(true)}>
                Type instead
              </button>
            )}
            {!typed && phase === 'listening' && partial && (
              <button className="btn btn-text btn-inline" onClick={flushVoice}>
                Send now
              </button>
            )}
            <button className="btn btn-inline end" onClick={() => void finish()}>
              End
            </button>
          </div>
        </div>
      )}

      {lookupOpen && (
        <div className="sheet-backdrop" onClick={() => setLookupOpen(false)}>
          <div
            className="sheet"
            role="dialog"
            aria-label="Plain words"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sheet-head">
              <strong>Plain words</strong>
              <button className="btn btn-text btn-inline" onClick={() => setLookupOpen(false)}>
                Close
              </button>
            </div>
            <PlainWordSearch autoFocus />
          </div>
        </div>
      )}
    </section>
  );
}
