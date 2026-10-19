import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { collection, doc, getDoc, getDocs, orderBy, query } from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';
import {
  endOfTurnDelayMs,
  isResidentSpeech,
  type NonverbalCue,
  type PatientChunk,
  type VoiceMode,
} from '@plainspeak/shared';
import { db, storage } from '../lib/firebase';
import { useAuth } from '../lib/auth';
import { friendlyError } from '../lib/api';
import { reportError } from '../lib/errorReport';
import { safeStorage } from '../lib/storage';
import {
  audioFromChunk,
  fetchPatientAudio,
  sessionApi,
  streamTurn,
  type TurnInput,
  type Utterance,
} from '../lib/session';
import { nonverbalLine, ReplyPlayer, VoiceRenderer } from '../lib/voiceRenderer';
import { OpenAIRealtimeStt } from '../lib/stt';
import { SessionRecorder } from '../lib/recorder';
import { PlainWordSearch } from '../components/PlainWordSearch';
import { canContinue, type SessionRow } from '../lib/resume';
import { Loading } from './StatusScreens';
import { LiveConversation } from './LiveSession';

type Phase = 'ready' | 'connecting' | 'patient' | 'listening' | 'thinking' | 'ending';
export interface Bubble {
  key: string;
  who: 'patient' | 'resident';
  text: string;
  nonverbal?: string[];
}
type Persona = { name: string; age: number; pronouns: string };
interface StartState {
  opening: Utterance;
  persona: Persona;
  voiceMode?: VoiceMode;
}

/**
 * If the resident starts talking again within this long of the patient's first
 * words, they were still finishing their thought (not interrupting).
 */
const CONTINUE_WINDOW_MS = 2500;

/** Remembered per phone: send after a pause (default) or only when tapped. */
const SEND_MODE_KEY = 'plainspeak.sendMode';
type SendMode = 'pause' | 'tap';

type Resume =
  | { state: 'loading' }
  | { state: 'missing' }
  | {
      state: 'ok';
      persona: Persona;
      scenarioId: string;
      bubbles: Bubble[];
      canContinue: boolean;
      voiceMode: VoiceMode;
    };

/** Loads a saved conversation, for picking up after a crash or a closed app. */
function useSavedConversation(sessionId: string, enabled: boolean): Resume {
  const [r, setR] = useState<Resume>({ state: 'loading' });
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      const snap = await getDoc(doc(db, 'sessions', sessionId));
      const s = snap.data() as SessionRow | undefined;
      if (!s) return setR({ state: 'missing' });
      let persona = s.persona;
      if (!persona) {
        const v = await getDoc(doc(db, 'scenarios', s.scenarioId, 'versions', s.scenarioVersion));
        persona = (v.data()?.persona as Persona | undefined) ?? {
          name: 'The patient',
          age: 0,
          pronouns: 'they',
        };
      }
      const t = await getDocs(
        query(collection(db, 'sessions', sessionId, 'turns'), orderBy('idx')),
      );
      const bubbles = t.docs.map((d) => {
        const x = d.data() as {
          idx: number;
          speaker: 'patient' | 'resident';
          text: string;
          nonverbal?: string[];
        };
        return { key: `t${x.idx}`, who: x.speaker, text: x.text, nonverbal: x.nonverbal };
      });
      if (!cancelled)
        setR({
          state: 'ok',
          persona,
          scenarioId: s.scenarioId,
          bubbles,
          canContinue: canContinue(s),
          voiceMode: s.voiceMode === 'live' ? 'live' : 'standard',
        });
    })().catch(() => {
      if (!cancelled) setR({ state: 'missing' });
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId, enabled]);
  return r;
}

export function Session() {
  const { id: sessionId = '' } = useParams();
  const nav = useNavigate();
  const location = useLocation();
  // The opening line passed from the briefing is used once. A reload or a
  // "pick up where you left off" must load the saved turns instead.
  const [fresh] = useState(() => location.state as StartState | null);
  useEffect(() => {
    const h = window.history.state as { usr?: unknown } | null;
    if (h?.usr) window.history.replaceState({ ...h, usr: null }, '');
  }, []);
  const saved = useSavedConversation(sessionId, !fresh);
  const [resuming, setResuming] = useState(false);
  // GPT-Live test mode fell back (or was switched off): what to carry on with.
  const [standard, setStandard] = useState<{ notice: string; bubbles: Bubble[] | null } | null>(
    null,
  );
  const fallBack = (notice: string, bubbles: Bubble[] | null) => setStandard({ notice, bubbles });

  if (standard) {
    const persona = fresh?.persona ?? (saved.state === 'ok' ? saved.persona : null);
    if (persona)
      return (
        <Conversation
          sessionId={sessionId}
          persona={persona}
          initialNotice={standard.notice}
          {...(standard.bubbles
            ? { resumeFrom: standard.bubbles }
            : fresh
              ? { opening: fresh.opening }
              : { resumeFrom: saved.state === 'ok' ? saved.bubbles : [] })}
        />
      );
  }
  if (fresh?.voiceMode === 'live')
    return (
      <LiveConversation
        sessionId={sessionId}
        persona={fresh.persona}
        opening={fresh.opening}
        onFallback={fallBack}
      />
    );
  if (fresh)
    return <Conversation sessionId={sessionId} persona={fresh.persona} opening={fresh.opening} />;
  if (saved.state === 'loading') return <Loading label="Loading your conversation…" />;
  if (saved.state === 'missing') {
    return (
      <section>
        <h1>Conversation not found</h1>
        <div className="card">
          <button className="btn" onClick={() => nav('/', { replace: true })}>
            Back to patients
          </button>
        </div>
      </section>
    );
  }
  if (resuming && saved.voiceMode === 'live') {
    return (
      <LiveConversation
        sessionId={sessionId}
        persona={saved.persona}
        resumeFrom={saved.bubbles}
        onFallback={fallBack}
      />
    );
  }
  if (resuming) {
    return (
      <Conversation sessionId={sessionId} persona={saved.persona} resumeFrom={saved.bubbles} />
    );
  }
  const first = saved.persona.name.split(' ')[0];
  return (
    <section>
      <h1>Welcome back</h1>
      <div className="card">
        <p>Your conversation with {first} was interrupted, but everything you said is saved.</p>
        {saved.canContinue ? (
          <button className="btn" onClick={() => setResuming(true)}>
            Pick up where you left off
          </button>
        ) : (
          <button
            className="btn"
            onClick={() => nav(`/scenario/${saved.scenarioId}`, { replace: true })}
          >
            Start this scenario again
          </button>
        )}
        <button
          className="btn btn-secondary"
          onClick={() => nav(`/session/${sessionId}/done`, { replace: true })}
        >
          See what you said so far
        </button>
      </div>
    </section>
  );
}

interface ConversationProps {
  sessionId: string;
  persona: Persona;
  /** Fresh start: the patient's opening line. */
  opening?: Utterance;
  /** Picking up: the turns so far. */
  resumeFrom?: Bubble[];
  /** Shown at the top from the start (e.g. why live voice was switched off). */
  initialNotice?: string;
}

function Conversation({
  sessionId,
  persona,
  opening,
  resumeFrom,
  initialNotice,
}: ConversationProps) {
  const nav = useNavigate();
  const { claims, user } = useAuth();
  const first = persona.name.split(' ')[0];

  const [phase, setPhaseState] = useState<Phase>('ready');
  const phaseRef = useRef<Phase>('ready');
  const setPhase = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhaseState(p);
  }, []);
  const [bubbles, setBubbles] = useState<Bubble[]>(resumeFrom ?? []);
  const [partial, setPartial] = useState('');
  const [typed, setTyped] = useState(false);
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState<string | null>(initialNotice ?? null);
  const [lookupOpen, setLookupOpen] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  const renderer = useRef<VoiceRenderer | null>(null);
  const player = useRef<ReplyPlayer | null>(null);
  const stt = useRef<OpenAIRealtimeStt | null>(null);
  const recorder = useRef<SessionRecorder | null>(null);
  const mic = useRef<MediaStream | null>(null);
  const t0 = useRef(0);
  const pending = useRef<{ text: string[]; tStart: number | null; timer: number | null }>({
    text: [],
    tStart: null,
    timer: null,
  });
  // Timing that leaves out time spent waiting on the app (see PLAN §4).
  const timing = useRef({
    /** When the patient last finished speaking (performance.now()). */
    patientDoneAt: null as number | null,
    /** First keystroke after the patient finished (typed replies). */
    typingStartAt: null as number | null,
    /** How long the app made the resident wait for the last reply. */
    lastAppWaitMs: null as number | null,
    totalAppWaitMs: 0,
  });
  const bottom = useRef<HTMLDivElement>(null);

  // Keep the newest message in view. Block body on purpose: an effect may only
  // return a cleanup function, and scrollIntoView returns a value in Safari.
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [bubbles, partial, phase]);

  const addBubble = (b: Bubble) => setBubbles((xs) => [...xs, b]);
  const updateBubble = (key: string, patch: Partial<Bubble>) =>
    setBubbles((xs) => xs.map((b) => (b.key === key ? { ...b, ...patch } : b)));

  // A typed reply sent while the patient is still answering waits here.
  const [queued, setQueued] = useState<string | null>(null);
  const queuedRef = useRef<string | null>(null);
  const queuedSourceRef = useRef<'voice' | 'typed'>('typed');
  const sendTurnRef = useRef<((text: string, source: 'voice' | 'typed') => Promise<void>) | null>(
    null,
  );

  // ----- two-way voice -----
  // The mic stays on while the patient talks. If the resident talks over them,
  // the patient stops mid-sentence; if the resident keeps talking before the
  // reply plays, that reply is replaced by one answering their whole thought.
  /** The exchange waiting on the server. `supersede`: resident kept talking. */
  const turnRef = useRef<{ residentKey: string; text: string; supersede: boolean } | null>(null);
  /** Reply to replace on the next send (its resident turn index), and what was said. */
  const supersedeRef = useRef<{ idx: number; text: string; residentKey: string } | null>(null);
  /** The resident cut the patient off; only this much was heard. */
  const interruptedRef = useRef<{ heard: string } | null>(null);
  /** The previous send, so turns never overlap on the server. */
  const inFlight = useRef<Promise<void> | null>(null);
  const duckTimer = useRef<number | null>(null);
  /** Whether the speech service judges turn ends by meaning (shorter waits) or by silence. */
  const semanticTurns = useRef(false);
  const scheduleFlushRef = useRef<(() => void) | null>(null);
  /**
   * The reply is fetched as soon as the resident's words are in, but only
   * plays after the end-of-turn wait. Speech during the wait holds it a bit
   * longer while we see if they're carrying on (then it's replaced).
   */
  const gate = useRef({ openAt: 0, holdUntil: 0 });
  /** Just after cutting the patient off, they answer sooner. */
  const quickNext = useRef(false);
  const [showThinking, setShowThinking] = useState(false);

  const startListening = useCallback(() => {
    if (phaseRef.current === 'ending') return;
    timing.current.patientDoneAt = performance.now();
    timing.current.typingStartAt = null;
    stt.current?.setMuted(false);
    setPhase('listening');
    // Anything said while the patient was thinking goes out now.
    if (pending.current.text.length) window.setTimeout(() => scheduleFlushRef.current?.(), 0);
    const next = queuedRef.current;
    if (next) {
      queuedRef.current = null;
      setQueued(null);
      // The resident had already answered, so there was no pause on their side.
      timing.current.typingStartAt = timing.current.patientDoneAt;
      const source = queuedSourceRef.current;
      queuedSourceRef.current = 'typed';
      window.setTimeout(() => void sendTurnRef.current?.(next, source), 0);
    }
  }, [setPhase]);

  /** Plays a stored patient line (the opening line). */
  const speakStored = useCallback(
    async (u: Utterance) => {
      const r = renderer.current;
      if (!r) return;
      setPhase('patient');
      const audio = await fetchPatientAudio(sessionId, u.idx);
      const key = `p${u.idx}`;
      const p = new ReplyPlayer(r, () =>
        addBubble({ key, who: 'patient', text: u.text, nonverbal: u.nonverbal }),
      );
      player.current = p;
      p.say(0, u.text);
      if (audio) p.audio(0, audio);
      p.finish();
      await p.run(u.delivery.pauseBeforeMs);
      startListening();
    },
    [sessionId, setPhase, startListening],
  );

  const sendTurn = useCallback(
    async (said: string, source: 'voice' | 'typed', tStartMs?: number, holdMs = 0) => {
      const r = renderer.current;
      if (!said.trim() || phaseRef.current === 'ending' || !r) return;
      gate.current = { openAt: performance.now() + holdMs, holdUntil: 0 };
      setShowThinking(holdMs === 0);
      // One exchange at a time: wait for the previous one to settle.
      const prev = inFlight.current;
      let settle!: () => void;
      inFlight.current = new Promise<void>((res) => (settle = res));
      if (prev) await prev;
      const sup = supersedeRef.current;
      supersedeRef.current = null;
      const text = sup ? `${sup.text} ${said}` : said;
      const residentKey = sup?.residentKey ?? `r${Date.now()}`;
      if (sup) updateBubble(residentKey, { text });
      else addBubble({ key: residentKey, who: 'resident', text });
      const cutOff = interruptedRef.current;
      interruptedRef.current = null;
      turnRef.current = { residentKey, text, supersede: false };
      setPartial('');
      // Keep listening while the patient thinks: anything said now is held and
      // sent when they finish. The mic mutes only once the patient's voice plays.
      setPhase('thinking');

      const tm = timing.current;
      const now = performance.now();
      const startedAt =
        source === 'voice' && tStartMs !== undefined ? t0.current + tStartMs : tm.typingStartAt;
      const input: TurnInput = {
        sessionId,
        text,
        source,
        ...(tStartMs !== undefined ? { tStartMs } : {}),
        tEndMs: Math.round(now - t0.current),
        ...(tm.patientDoneAt !== null && startedAt !== null
          ? { responseGapMs: Math.max(0, Math.round(startedAt - tm.patientDoneAt)) }
          : {}),
        ...(tm.lastAppWaitMs !== null ? { prevAppWaitMs: Math.round(tm.lastAppWaitMs) } : {}),
        ...(sup ? { supersedes: sup.idx } : {}),
        ...(cutOff ? { prevInterrupted: cutOff } : {}),
      };

      const key = `p${Date.now()}`;
      let shown = false;
      let pauseMs = 0;
      let meta: { nonverbal: NonverbalCue[] } | null = null;
      const p = new ReplyPlayer(r, (sentence) => {
        if (!shown) {
          shown = true;
          setPhase('patient');
          addBubble({ key, who: 'patient', text: sentence, nonverbal: meta?.nonverbal });
        } else {
          setBubbles((xs) =>
            xs.map((b) => (b.key === key ? { ...b, text: `${b.text} ${sentence}` } : b)),
          );
        }
      });
      player.current = p;
      let running: Promise<void> | null = null;
      // Wait out the end-of-turn pause (in parallel with the server), then play.
      const waitForGate = async () => {
        const g = gate.current;
        while (performance.now() < Math.max(g.openAt, g.holdUntil) && !turnRef.current?.supersede) {
          await new Promise((res) => setTimeout(res, 50));
        }
        setShowThinking(true);
      };
      const run = () =>
        (running ??= waitForGate().then(() =>
          turnRef.current?.supersede ? undefined : p.run(pauseMs),
        ));
      const onChunk = (c: PatientChunk) => {
        // The resident kept talking: this reply will be replaced, so don't play it.
        if (turnRef.current?.supersede) return;
        if (c.t === 'meta') {
          meta = { nonverbal: c.nonverbal };
          pauseMs = c.delivery.pauseBeforeMs;
          run();
        } else if (c.t === 'say') {
          p.say(c.seq, c.text);
          run();
        } else if (c.t === 'audio') {
          p.audio(c.seq, audioFromChunk(c.b64, c.mime));
        }
      };

      try {
        const result = await streamTurn(input, onChunk);
        const u = result.patient;
        if (p.received === 0) {
          // No streaming (older server or network): fetch the whole line's voice.
          pauseMs = u.delivery.pauseBeforeMs;
          const audio = await fetchPatientAudio(sessionId, u.idx);
          p.say(0, u.text);
          if (audio) p.audio(0, audio);
        }
        // Drop this reply; the next send answers the resident's whole thought.
        const replace = () => {
          p.interrupt();
          setBubbles((xs) => xs.filter((b) => b.key !== key));
          supersedeRef.current = { idx: u.idx - 1, text, residentKey };
        };
        if (turnRef.current?.supersede) {
          replace();
        } else {
          p.finish();
          await run();
          if (turnRef.current?.supersede) {
            // The resident went on with their thought just as the patient started.
            replace();
          } else if (p.interrupted) {
            // Talked over: the patient only got this far.
            const heard = p.played.join(' ');
            interruptedRef.current = { heard };
            updateBubble(key, { text: `${heard} —`, nonverbal: u.nonverbal });
          } else if (shown) {
            // The saved text is the source of truth (it may be tidied up).
            updateBubble(key, { text: u.text, nonverbal: u.nonverbal });
          }
          if (p.firstSoundAt !== null) {
            const wait = Math.max(0, p.firstSoundAt - now - pauseMs - holdMs);
            tm.lastAppWaitMs = wait;
            tm.totalAppWaitMs += wait;
          }
        }
        turnRef.current = null;
        if (phaseRef.current !== 'listening') startListening();
      } catch (e) {
        p.finish();
        turnRef.current = null;
        setNotice(friendlyError(e));
        startListening();
      } finally {
        settle();
      }
    },
    [sessionId, setPhase, startListening],
  );

  // Voice turns: collect transcript pieces and send after a pause. The pause
  // is longer when the words sound unfinished ("so the plan is, um…").
  const [sendMode, setSendModeState] = useState<SendMode>(() =>
    safeStorage.get(SEND_MODE_KEY) === 'tap' ? 'tap' : 'pause',
  );
  const sendModeRef = useRef(sendMode);
  const cancelAutoSend = useCallback(() => {
    const p = pending.current;
    if (p.timer) window.clearTimeout(p.timer);
    p.timer = null;
  }, []);

  const setSendMode = (m: SendMode) => {
    sendModeRef.current = m;
    setSendModeState(m);
    safeStorage.set(SEND_MODE_KEY, m);
    if (m === 'tap') cancelAutoSend();
  };

  const flushVoice = useCallback(
    (holdMs = 0) => {
      cancelAutoSend();
      const p = pending.current;
      const text = p.text.join(' ').trim();
      const tStart = p.tStart ?? undefined;
      p.text = [];
      p.tStart = null;
      setPartial('');
      if (text) void sendTurn(text, 'voice', tStart, holdMs);
    },
    [sendTurn, cancelAutoSend],
  );

  const scheduleFlush = useCallback(() => {
    cancelAutoSend();
    // While the patient thinks or talks, hold the words; they go out once
    // the patient finishes or is cut off (startListening).
    if (phaseRef.current !== 'listening') return;
    if (sendModeRef.current === 'tap') return;
    const text = pending.current.text.join(' ');
    // The speech service already judged the turn finished by meaning, so only
    // a short extra wait is needed; with plain silence detection, wait longer.
    // Right after cutting the patient off, the interjection is short: answer sooner.
    const factor = quickNext.current ? 0.25 : semanticTurns.current ? 0.6 : 1;
    quickNext.current = false;
    // Send now so the reply is ready; it plays once this wait has passed.
    flushVoice(endOfTurnDelayMs(text) * factor);
  }, [flushVoice, cancelAutoSend]);

  useEffect(() => {
    scheduleFlushRef.current = scheduleFlush;
  }, [scheduleFlush]);

  /** The resident started talking over the patient: stop the patient mid-sentence. */
  const bargeIn = useCallback(() => {
    const p = player.current;
    if (duckTimer.current) window.clearTimeout(duckTimer.current);
    renderer.current?.duck(false);
    if (!p || p.interrupted || phaseRef.current !== 'patient') return;
    p.interrupt();
    // Talking again right as the patient starts means the resident wasn't
    // finished: the patient yields and answers the whole thought, as people do.
    // Later on, it's talking over the patient.
    const sinceStart = p.firstSoundAt === null ? 0 : performance.now() - p.firstSoundAt;
    if ((p.played.length === 0 || sinceStart < CONTINUE_WINDOW_MS) && turnRef.current) {
      turnRef.current.supersede = true;
    } else {
      quickNext.current = true;
    }
    startListening();
  }, [startListening]);

  async function begin() {
    setPhase('connecting');
    setNotice(null);
    renderer.current = new VoiceRenderer();
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
            // Still talking: never send in the middle of a thought.
            cancelAutoSend();
            const p = pending.current;
            p.tStart ??= Math.round(performance.now() - t0.current);
            if (phaseRef.current === 'patient') {
              // Maybe the resident is starting to talk: turn the patient almost
              // silent at once (feels like stopping), back up if it was only echo.
              renderer.current?.duck(true);
              if (duckTimer.current) window.clearTimeout(duckTimer.current);
              duckTimer.current = window.setTimeout(() => renderer.current?.duck(false), 1200);
            } else if (phaseRef.current === 'thinking') {
              // Talking again before the reply plays: hold it while we see if they're carrying on.
              gate.current.holdUntil = performance.now() + 1200;
            }
          },
          onPartial: (t) => {
            if (phaseRef.current === 'patient') {
              // The patient's own voice leaking into the mic isn't the resident.
              if (!isResidentSpeech(t, player.current?.spokenSoFar ?? '')) return;
              bargeIn();
            } else if (
              phaseRef.current === 'thinking' &&
              turnRef.current &&
              t.trim().split(/\s+/).length >= 2
            ) {
              turnRef.current.supersede = true;
            }
            setPartial([...pending.current.text, t].join(' '));
          },
          onFinal: (t) => {
            if (phaseRef.current === 'patient') {
              if (!isResidentSpeech(t, player.current?.spokenSoFar ?? '')) {
                renderer.current?.duck(false);
                return;
              }
              bargeIn();
            } else if (phaseRef.current === 'thinking' && turnRef.current) {
              turnRef.current.supersede = true;
            }
            pending.current.text.push(t);
            setPartial(pending.current.text.join(' '));
            scheduleFlush();
          },
          onError: (m) => {
            setNotice(`${m} You can type instead.`);
            setTyped(true);
          },
        });
        semanticTurns.current = data.turnDetection === 'semantic';
        await stt.current.start(mic.current, data.value);
      } catch (e) {
        stt.current = null;
        setTyped(true);
        reportError('stt.start', e);
        setNotice('Voice input isn’t available right now. You can type your side.');
      }
    }
    if (opening) await speakStored(opening);
    else startListening();
  }

  async function finish() {
    if (!window.confirm('End the conversation and get feedback?')) return;
    setPhase('ending');
    const p = pending.current;
    if (p.timer) window.clearTimeout(p.timer);
    stt.current?.stop();
    player.current?.finish();
    renderer.current?.dispose();
    setSaving('Saving…');
    try {
      await sessionApi.end({
        sessionId,
        appWaitSec: Math.round(timing.current.totalAppWaitMs / 1000),
      });
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

  // Release the mic, voice and speech connection when leaving the screen.
  useEffect(() => {
    const p = pending.current;
    return () => {
      if (p.timer) window.clearTimeout(p.timer);
      stt.current?.stop();
      player.current?.finish();
      renderer.current?.dispose();
      mic.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    sendTurnRef.current = sendTurn;
  }, [sendTurn]);

  function submitTyped(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || phase === 'ending') return;
    setDraft('');
    if (phase === 'listening') return void sendTurn(text, 'typed');
    // Still answering: keep it and send it the moment the patient finishes.
    const combined = queuedRef.current ? `${queuedRef.current} ${text}` : text;
    queuedRef.current = combined;
    queuedSourceRef.current = 'typed';
    setQueued(combined);
  }

  const status: Record<Phase, string> = {
    ready: 'Ready when you are',
    connecting: 'Connecting…',
    patient: `${first} is talking…`,
    listening: typed ? 'Your turn: type your reply' : 'Listening… just talk',
    thinking: `${first} is thinking…`,
    ending: saving ?? 'Wrapping up…',
  };

  return (
    <section className="session">
      <header className="session-head">
        <div className={`avatar ${phase === 'patient' ? 'speaking' : ''}`} aria-hidden="true">
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

      {phase === 'ready' ? (
        <div className="card">
          {resumeFrom ? (
            <p>
              Picking up with {first}. Everything so far is saved. Tap below and carry on where you
              left off.
            </p>
          ) : (
            <p>
              Talk naturally, like you’re in the room. {first} will answer out loud. When you’re
              done, tap <strong>End</strong> to get feedback.
            </p>
          )}
          <p className="muted small">
            We’ll record this practice so you can review it and get feedback (kept up to 3 years).
          </p>
          <button className="btn" onClick={() => void begin()}>
            {resumeFrom ? 'Continue the conversation' : 'Start talking'}
          </button>
        </div>
      ) : null}

      {(phase !== 'ready' || resumeFrom) && (
        <Transcript
          bubbles={bubbles}
          partial={partial}
          thinking={phase === 'thinking' && showThinking}
          patientFirstName={first}
          queued={queued}
        />
      )}
      <div ref={bottom} />

      {phase !== 'ready' && phase !== 'ending' && (
        <div className="session-controls">
          {typed && (
            <form className="typed" onSubmit={submitTyped}>
              <input
                aria-label="Your reply"
                placeholder={
                  phase === 'listening'
                    ? 'Type what you’d say…'
                    : `You can start typing while ${first} answers…`
                }
                value={draft}
                onChange={(e) => {
                  if (timing.current.typingStartAt === null && phaseRef.current === 'listening')
                    timing.current.typingStartAt = performance.now();
                  setDraft(e.target.value);
                }}
              />
              <button className="btn btn-inline" disabled={!draft.trim()}>
                Send
              </button>
            </form>
          )}
          {!typed && sendMode === 'tap' && phase === 'listening' && partial && (
            <div className="send-row">
              <span className="muted small">Tap send when you’re done.</span>
              <button className="btn btn-inline" onClick={() => flushVoice()}>
                Send
              </button>
            </div>
          )}
          <div className="session-buttons">
            <button className="btn btn-secondary btn-inline" onClick={() => setLookupOpen(true)}>
              Plain words
            </button>
            {!typed && (
              <span className={`mic-state ${phase === 'listening' ? 'on' : ''}`} aria-hidden="true">
                {phase === 'listening' ? '● Mic on' : '○ Mic ready'}
              </span>
            )}
            {!typed && (
              <button className="btn btn-text btn-inline" onClick={() => setTyped(true)}>
                Type instead
              </button>
            )}
            {!typed && (
              <button
                className="btn btn-text btn-inline"
                aria-pressed={sendMode === 'tap'}
                onClick={() => setSendMode(sendMode === 'tap' ? 'pause' : 'tap')}
              >
                {sendMode === 'tap' ? 'Send: when I tap' : 'Send: when I pause'}
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

/** The conversation so far. Nonverbal cues sit above the patient's words, outside the bubble. */
export function Transcript({
  bubbles,
  partial = '',
  thinking = false,
  patientFirstName = 'The patient',
  highlightTurns,
  queued = null,
}: {
  bubbles: Bubble[];
  partial?: string;
  thinking?: boolean;
  patientFirstName?: string;
  highlightTurns?: Set<string>;
  /** A typed reply waiting for the patient to finish. */
  queued?: string | null;
}) {
  return (
    <div className="chat" aria-live="polite">
      {bubbles.map((b) => {
        const nv = b.who === 'patient' ? nonverbalLine(b.nonverbal) : '';
        return (
          <div key={b.key} className={`turn ${b.who}`}>
            {nv && <div className="nonverbal">{nv}</div>}
            <div className={`bubble ${b.who} ${highlightTurns?.has(b.key) ? 'marked' : ''}`}>
              {b.text}
            </div>
          </div>
        );
      })}
      {partial && (
        <div className="turn resident">
          <div className="bubble resident partial">{partial}</div>
        </div>
      )}
      {thinking && (
        <div className="turn patient">
          <div
            className="bubble patient thinking"
            role="status"
            aria-label={`${patientFirstName} is thinking`}
          >
            <span className="dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </div>
        </div>
      )}
      {queued && (
        <div className="turn resident">
          <div className="bubble resident partial">{queued}</div>
          <div className="nonverbal queued-note">Sends when {patientFirstName} finishes</div>
        </div>
      )}
    </div>
  );
}
