import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, uploadBytes } from 'firebase/storage';
import { isResidentSpeech, type PatientChunk } from '@plainspeak/shared';
import { storage } from '../lib/firebase';
import { useAuth } from '../lib/auth';
import { friendlyError } from '../lib/api';
import { reportError } from '../lib/errorReport';
import { sessionApi, streamTurn, type TurnInput, type Utterance } from '../lib/session';
import { LiveVoiceCall, toneNote } from '../lib/liveVoice';
import { SessionRecorder } from '../lib/recorder';
import { PlainWordSearch } from '../components/PlainWordSearch';
import { Transcript, type Bubble } from './Session';

type Persona = { name: string; age: number; pronouns: string };
type Phase = 'ready' | 'connecting' | 'live' | 'ending';

/** How long GPT-Live gets to answer the call before we fall back to the standard voice. */
const START_TIMEOUT_MS = 12_000;
/** The resident must still be talking this long after starting over the patient to cut him off (echo blips stop sooner). */
const BARGE_IN_CONFIRM_MS = 250;
/** The resident's mic must stay loud this long while the patient talks before he is turned down. */
const MIC_TALK_MS = 150;
/** If no words from the resident arrive this long after turning the patient down, it wasn't them. */
const DUCK_CONFIRM_MS = 1500;
/** After cutting the patient off, his voice stays muted until it's been quiet this long... */
const RESUME_QUIET_MS = 600;
/** ...or this long at most. */
const MAX_MUTE_MS = 6000;

export interface LiveConversationProps {
  sessionId: string;
  persona: Persona;
  opening?: Utterance;
  resumeFrom?: Bubble[];
  /** Live voice failed or was switched off: carry on with the standard voice. */
  onFallback(reason: string, bubbles: Bubble[] | null): void;
}

/**
 * GPT-Live test mode: one open call where the patient listens and talks at
 * the same time, like a real conversation. GPT-Live decides when the
 * resident has finished and asks us for each reply; Claude still writes every
 * word the patient says, and everything is saved and scored the same way.
 */
export function LiveConversation({
  sessionId,
  persona,
  opening,
  resumeFrom,
  onFallback,
}: LiveConversationProps) {
  const first = persona.name.split(' ')[0];
  const nav = useNavigate();
  const { claims, user } = useAuth();
  const [phase, setPhase] = useState<Phase>('ready');
  const [bubbles, setBubblesState] = useState<Bubble[]>(resumeFrom ?? []);
  const bubblesRef = useRef<Bubble[]>(resumeFrom ?? []);
  const [heard, setHeard] = useState('');
  const [thinking, setThinking] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [lookupOpen, setLookupOpen] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  const call = useRef<LiveVoiceCall | null>(null);
  const mic = useRef<MediaStream | null>(null);
  const recorder = useRef<SessionRecorder | null>(null);
  const started = useRef(false);
  const ended = useRef(false);
  /** What the resident said since the last reply was asked for. */
  const heardBuf = useRef('');
  const heardAt = useRef(0);
  /** What GPT-Live has said aloud of the current reply. */
  const spokenBuf = useRef('');
  /** Set when the resident cut the patient off: what the patient got out before that. */
  const cutOff = useRef<string | null>(null);
  const muteTimer = useRef<number | null>(null);
  /** When the patient was turned down because the resident's mic got loud (0: not). */
  const duckedAt = useRef(0);
  const confirmTimer = useRef<number | null>(null);
  const inFlight = useRef<Promise<void>>(Promise.resolve());
  const lastWaitMs = useRef<number | null>(null);
  const totalWaitMs = useRef(0);
  const bottom = useRef<HTMLDivElement>(null);

  const setBubbles = (f: (b: Bubble[]) => Bubble[]) => {
    bubblesRef.current = f(bubblesRef.current);
    setBubblesState(bubblesRef.current);
  };

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [bubbles, heard, thinking]);

  // "Is the patient talking" comes from his audio level, not from events.
  useEffect(() => {
    if (phase !== 'live') return;
    const t = window.setInterval(() => setSpeaking(!!call.current?.patientAudible(250)), 150);
    return () => window.clearInterval(t);
  }, [phase]);

  // The resident starts talking over the patient: turn him down at once, from
  // the mic's sound alone. The words (a second later) confirm it.
  useEffect(() => {
    if (phase !== 'live') return;
    const t = window.setInterval(() => {
      const c = call.current;
      if (!c || cutOff.current !== null) return;
      const now = performance.now();
      if (!duckedAt.current && c.patientAudible() && c.micLoudFor() >= MIC_TALK_MS) {
        duckedAt.current = now;
        c.duckPatient(true);
      } else if (duckedAt.current && now - duckedAt.current > DUCK_CONFIRM_MS) {
        duckedAt.current = 0;
        c.duckPatient(false);
      }
    }, 50);
    return () => window.clearInterval(t);
  }, [phase]);

  function release() {
    call.current?.hangUp();
    call.current = null;
    mic.current?.getTracks().forEach((t) => t.stop());
    mic.current = null;
    if (muteTimer.current) window.clearTimeout(muteTimer.current);
    if (confirmTimer.current) window.clearTimeout(confirmTimer.current);
  }

  function fallBack(reason: string) {
    if (ended.current) return;
    ended.current = true;
    void recorder.current?.stop().catch(() => undefined);
    release();
    const said = bubblesRef.current;
    onFallback(reason, said.length > (opening ? 1 : 0) || resumeFrom ? said : null);
  }

  /** The resident is talking over the patient: silence the patient on our side until GPT-Live stops. */
  function cutPatientOff() {
    const c = call.current;
    if (!c || cutOff.current !== null) return;
    cutOff.current = spokenBuf.current.trim();
    duckedAt.current = 0;
    c.mutePatient(true);
    setBubbles((b) => {
      const i = b.map((x) => x.who).lastIndexOf('patient');
      if (i < 0 || b[i]!.text.endsWith('—')) return b;
      const copy = [...b];
      const heardSoFar = cutOff.current || b[i]!.text;
      copy[i] = { ...b[i]!, text: `${heardSoFar} —` };
      return copy;
    });
    const mutedAt = performance.now();
    const check = () => {
      const quiet = !c.patientAudible(RESUME_QUIET_MS);
      if (quiet || performance.now() - mutedAt > MAX_MUTE_MS) {
        c.mutePatient(false);
        muteTimer.current = null;
        return;
      }
      muteTimer.current = window.setTimeout(check, 150);
    };
    muteTimer.current = window.setTimeout(check, 150);
  }

  function onHeard(delta: string) {
    heardBuf.current += delta;
    heardAt.current = performance.now();
    setHeard(heardBuf.current.trim());
    const c = call.current;
    if (!c || cutOff.current !== null) return;
    const ducked = !!duckedAt.current;
    if (!ducked && !c.patientAudible()) return;
    // The patient's own voice leaking into the mic isn't the resident.
    if (!isResidentSpeech(heardBuf.current, spokenBuf.current)) return;
    // Already turned down on the mic's sound: these words confirm it.
    if (ducked) return cutPatientOff();
    if (confirmTimer.current) return;
    const at = heardAt.current;
    confirmTimer.current = window.setTimeout(() => {
      confirmTimer.current = null;
      if (heardAt.current > at && call.current?.patientAudible()) cutPatientOff();
    }, BARGE_IN_CONFIRM_MS);
  }

  async function reply(delegationId: string) {
    const c = call.current;
    if (!c || ended.current) return;
    const askedAt = performance.now();
    // The last words can land just after GPT-Live asks.
    for (let i = 0; i < 8 && !heardBuf.current.trim(); i++)
      await new Promise((r) => setTimeout(r, 100));
    const text = heardBuf.current.trim();
    heardBuf.current = '';
    setHeard('');
    if (!text) {
      c.note(delegationId, 'The doctor has not said anything new. Do not reply; keep listening.');
      return;
    }
    setBubbles((b) => [...b, { key: `r${Date.now()}`, who: 'resident', text }]);
    const input: TurnInput = {
      sessionId,
      text,
      source: 'voice',
      live: true,
      ...(spokenBuf.current.trim() ? { prevSpoken: spokenBuf.current.trim() } : {}),
      ...(cutOff.current !== null ? { prevInterrupted: { heard: cutOff.current } } : {}),
      ...(lastWaitMs.current != null ? { prevAppWaitMs: lastWaitMs.current } : {}),
    };
    spokenBuf.current = '';
    cutOff.current = null;
    lastWaitMs.current = null;
    setThinking(true);
    let tone = '';
    let sent = 0;
    const sayLine = (line: string) => {
      if (!sent) {
        lastWaitMs.current = Math.round(performance.now() - askedAt);
        totalWaitMs.current += lastWaitMs.current;
      }
      c.say(delegationId, (sent ? '' : tone) + line);
      sent++;
    };
    try {
      const result = await streamTurn(input, (chunk: PatientChunk) => {
        if (chunk.t === 'meta') tone = toneNote(chunk.delivery);
        else if (chunk.t === 'say') sayLine(chunk.text);
      });
      if (!sent) {
        tone = toneNote(result.patient.delivery);
        sayLine(result.patient.text);
      }
      setBubbles((b) => [
        ...b,
        {
          key: `t${result.patient.idx}`,
          who: 'patient',
          text: result.patient.text,
          nonverbal: result.patient.nonverbal,
        },
      ]);
    } catch (e) {
      reportError('live.turn', e);
      setNotice(friendlyError(e));
      c.say(delegationId, 'Sorry, what was that?');
    } finally {
      setThinking(false);
    }
  }

  async function begin() {
    setPhase('connecting');
    setNotice(null);
    const c = new LiveVoiceCall({
      onStarted: () => {
        if (started.current) return;
        started.current = true;
        setPhase('live');
        if (opening) {
          c.say(null, toneNote(opening.delivery) + opening.text);
          setBubbles((b) => [
            ...b,
            { key: 't0', who: 'patient', text: opening.text, nonverbal: opening.nonverbal },
          ]);
        } else if (bubblesRef.current.length) {
          const recent = bubblesRef.current
            .slice(-8)
            .map((b) => `${b.who === 'patient' ? first : 'Doctor'}: ${b.text}`)
            .join('\n');
          c.note(
            null,
            `This visit is picking up after a break. So far:\n${recent}\nWait for the doctor to speak.`,
          );
        }
      },
      onDelegation: (id) => {
        inFlight.current = inFlight.current.then(() => reply(id)).catch(() => undefined);
      },
      onHeard,
      onSpoken: (d) => {
        spokenBuf.current += d;
      },
      onError: (m) => {
        reportError('live.call', new Error(m));
        if (!started.current)
          fallBack('GPT-Live couldn’t connect, so this uses the standard voice.');
        else setNotice(m);
      },
      onClosed: () => {
        if (!ended.current)
          fallBack('The live voice call ended, so this continues with the standard voice.');
      },
    });
    call.current = c;
    c.unlockAudio(); // inside the tap (iOS)

    try {
      mic.current = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      return fallBack('No microphone access, so you can type your side for now.');
    }
    recorder.current = new SessionRecorder(mic.current);
    recorder.current.start();
    window.setTimeout(() => {
      if (!started.current)
        fallBack('GPT-Live didn’t answer in time, so this uses the standard voice.');
    }, START_TIMEOUT_MS);
    try {
      await c.start(mic.current, async (sdp) => {
        const { data } = await sessionApi.startLiveCall({ sessionId, sdp });
        return data.sdp;
      });
    } catch (e) {
      reportError('live.start', e);
      fallBack('GPT-Live isn’t available right now, so this uses the standard voice.');
    }
  }

  async function finish() {
    if (!window.confirm('End the conversation and get feedback?')) return;
    ended.current = true;
    setPhase('ending');
    setSaving('Saving…');
    await call.current?.close().catch(() => undefined);
    release();
    try {
      await sessionApi.end({ sessionId, appWaitSec: Math.round(totalWaitMs.current / 1000) });
      const blob = await recorder.current?.stop();
      if (blob && claims && user) {
        setSaving('Saving your recording…');
        const ext = recorder.current!.ext;
        const path = `audio/${claims.programId}/${user.uid}/${sessionId}/recording.${ext}`;
        await uploadBytes(ref(storage, path), blob, { contentType: blob.type || 'audio/webm' });
        await sessionApi.end({ sessionId, audioExt: ext });
      }
    } catch (e) {
      console.warn('end/upload failed', e);
    }
    nav(`/session/${sessionId}/done`, { replace: true });
  }

  useEffect(
    () => () => {
      ended.current = true;
      call.current?.hangUp();
      mic.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  const status: Record<Phase, string> = {
    ready: 'Ready when you are',
    connecting: 'Connecting…',
    live: speaking
      ? `${first} is talking…`
      : thinking
        ? `${first} is thinking…`
        : 'Listening… just talk',
    ending: saving ?? 'Wrapping up…',
  };

  return (
    <section className="session">
      <header className="session-head">
        <div className={`avatar ${speaking ? 'speaking' : ''}`} aria-hidden="true">
          {persona.name
            .split(' ')
            .map((x) => x[0])
            .join('')}
        </div>
        <div>
          <div className="patient-name">{persona.name}</div>
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

      {phase === 'ready' && (
        <div className="card">
          <p>
            Talk naturally, like you’re in the room. {first} listens while talking, so you can
            pause, carry on, or cut in. When you’re done, tap <strong>End</strong> to get feedback.
          </p>
          <p className="muted small">GPT-Live voice (test).</p>
          <p className="muted small">
            We’ll record this practice so you can review it and get feedback (kept up to 3 years).
          </p>
          <button className="btn" onClick={() => void begin()}>
            {resumeFrom ? 'Continue the conversation' : 'Start talking'}
          </button>
        </div>
      )}

      {(phase !== 'ready' || resumeFrom) && (
        <Transcript
          bubbles={bubbles}
          partial={heard}
          thinking={thinking && !speaking}
          patientFirstName={first}
        />
      )}
      <div ref={bottom} />

      {phase !== 'ready' && phase !== 'ending' && (
        <div className="session-controls">
          <div className="session-buttons">
            <button className="btn btn-secondary btn-inline" onClick={() => setLookupOpen(true)}>
              Plain words
            </button>
            <span className={`mic-state ${phase === 'live' ? 'on' : ''}`} aria-hidden="true">
              {phase === 'live' ? '● Mic on' : '○ Mic ready'}
            </span>
            <button
              className="btn btn-text btn-inline"
              onClick={() => fallBack('Switched to the standard voice.')}
            >
              Standard voice
            </button>
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
