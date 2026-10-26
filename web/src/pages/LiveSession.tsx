import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, uploadBytes } from 'firebase/storage';
import { isCutIn } from '@plainspeak/shared';
import { storage } from '../lib/firebase';
import { useAuth } from '../lib/auth';
import { friendlyError } from '../lib/api';
import { reportError } from '../lib/errorReport';
import { sessionApi, streamTurn, type TurnInput, type Utterance } from '../lib/session';
import { LiveVoiceCall, toneNote } from '../lib/liveVoice';
import { ECHO_WINDOW_MS, isEcho, LiveReply, MIC_EVIDENCE_MS } from '../lib/liveReply';
import { SessionRecorder } from '../lib/recorder';
import { PlainWordSearch } from '../components/PlainWordSearch';
import { Transcript, type Bubble } from './Session';

type Persona = { name: string; age: number; pronouns: string };
type Phase = 'ready' | 'connecting' | 'live' | 'ending';

/** How long GPT-Live gets to answer the call before we fall back to the standard voice. */
const START_TIMEOUT_MS = 12_000;
/** Resident words this soon after a reply was asked for (before the patient speaks) finish that turn. */
const LATE_WORDS_MS = 2500;
/** The resident is done once no new words (and no mic sound) for this long... */
const SETTLE_QUIET_MS = 700;
/** ...or after this long at most. */
const SETTLE_MAX_MS = 2500;
/** If GPT-Live asks before any words have come in, wait this long for them. */
const SETTLE_EMPTY_MS = 1500;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** The resident's mic must stay loud this long while the patient talks before he is turned down. */
const MIC_TALK_MS = 150;
/** If no words from the resident arrive this long after turning the patient down, it wasn't them. */
const DUCK_CONFIRM_MS = 1500;
/**
 * After a cut-off, GPT-Live may keep saying the rest of the old line. The
 * patient stays muted until it has stopped (no voice and no new words for
 * this long), or his next line starts...
 */
const RESUME_QUIET_MS = 1200;
/** ...or this long at most. */
const MAX_MUTE_MS = 15_000;
/** No transcript of the patient's speech this long after his line went out: show the line itself. */
const NO_TRANSCRIPT_MS = 4000;

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
  /** Words heard while the patient was talking (or just after) that may be his own echo. */
  const suspect = useRef<string[]>([]);
  /** The patient's current reply, and the one before it (for echo checks). */
  const reply = useRef<LiveReply | null>(null);
  const prevSpoken = useRef('');
  const muteTimer = useRef<number | null>(null);
  /** When the patient was turned down because the resident's mic got loud (0: not). */
  const duckedAt = useRef(0);
  const inFlight = useRef<Promise<void>>(Promise.resolve());
  /** Saves still on their way to the server; End waits for them. */
  const saves = useRef<Promise<unknown>[]>([]);
  const lastWaitMs = useRef<number | null>(null);
  const totalWaitMs = useRef(0);
  const delegationOf = useRef<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const setBubbles = (f: (b: Bubble[]) => Bubble[]) => {
    bubblesRef.current = f(bubblesRef.current);
    setBubblesState(bubblesRef.current);
  };
  const setBubbleText = (key: string, text: string) =>
    setBubbles((b) => b.map((x) => (x.key === key ? { ...x, text } : x)));

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [bubbles, heard, thinking]);

  /** Shows (or updates) the patient's bubble for this reply. */
  function showPatient(r: LiveReply, text: string) {
    if (r.idx === null) return;
    const key = `t${r.idx}`;
    r.shown = text;
    setBubbles((b) =>
      b.some((x) => x.key === key)
        ? b.map((x) => (x.key === key ? { ...x, text } : x))
        : [...b, { key, who: 'patient', text, nonverbal: r.nonverbal }],
    );
  }

  /** Saves what was actually said, right away (survives a reload or an immediate End). */
  function save(r: LiveReply) {
    if (r.idx === null) return;
    const jobs: Parameters<typeof sessionApi.saveHeard>[0][] = [];
    if (!r.saved && (r.cut !== null || r.spoken)) {
      r.saved = true;
      jobs.push({
        sessionId,
        idx: r.idx,
        ...(r.cut !== null ? { cutOff: { heard: r.cut } } : { spoken: r.spoken }),
      });
    }
    if (r.late && !r.lateSaved) {
      r.lateSaved = true;
      jobs.push({ sessionId, idx: r.idx, residentAppend: r.late.trim() });
    }
    for (const j of jobs) {
      saves.current.push(
        sessionApi.saveHeard(j).catch((e: unknown) => reportError('live.saveHeard', e)),
      );
    }
  }

  // Watches the patient's voice: talking or not, turning him down when the
  // resident starts over him (from the mic's sound alone; the words a second
  // later confirm it), and saving what he said once he's done.
  useEffect(() => {
    if (phase !== 'live') return;
    let tick = 0;
    const t = window.setInterval(() => {
      const c = call.current;
      if (!c) return;
      const now = performance.now();
      const audible = c.patientAudible();
      if (++tick % 3 === 0) setSpeaking(c.patientAudible(250));
      const r = reply.current;
      if (r && r.firstAudibleAt === null && audible && r.pieces.length) {
        r.firstAudibleAt = now;
        setThinking(false);
      }
      // His words appear as he says them, not before.
      if (r && r.idx !== null && r.cut === null && !r.saved) {
        let text = r.heardSoFar(now);
        if (!r.pieces.length && r.sentAt !== null && now - r.sentAt > NO_TRANSCRIPT_MS) {
          text = r.planned;
          setThinking(false);
        }
        if (text && text !== r.shown) showPatient(r, text);
      }
      // Done talking: what he said out loud becomes the saved line.
      if (
        r &&
        r.idx !== null &&
        !r.saved &&
        r.cut === null &&
        r.pieces.length &&
        now - r.lastPieceAt > 900 &&
        !c.patientAudible(800)
      ) {
        save(r);
        showPatient(r, r.spoken);
      }
      // Words held as possible echo that never turned out to be the resident.
      if (suspect.current.length && !audible && now - c.lastSoundAt > ECHO_WINDOW_MS)
        suspect.current = [];
      if (r?.cut != null) return;
      if (!duckedAt.current && audible && c.micLoudFor() >= MIC_TALK_MS) {
        duckedAt.current = now;
        c.duckPatient(true);
      } else if (duckedAt.current && now - duckedAt.current > DUCK_CONFIRM_MS) {
        duckedAt.current = 0;
        c.duckPatient(false);
      }
    }, 50);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  function release() {
    call.current?.hangUp();
    call.current = null;
    mic.current?.getTracks().forEach((t) => t.stop());
    mic.current = null;
    if (muteTimer.current) window.clearTimeout(muteTimer.current);
  }

  function fallBack(reason: string) {
    if (ended.current) return;
    ended.current = true;
    void recorder.current?.stop().catch(() => undefined);
    release();
    const said = bubblesRef.current;
    onFallback(reason, said.length > (opening ? 1 : 0) || resumeFrom ? said : null);
  }

  /** The resident is talking over the patient: silence him on our side until GPT-Live stops. */
  function cutPatientOff() {
    const c = call.current;
    const r = reply.current;
    if (!c || !r || r.cut !== null) return;
    const heardText = r.cutOff();
    c.truncate(delegationOf.current, r.cutAtMs ?? 0);
    c.note(
      delegationOf.current,
      'The doctor just started talking over you. Stop speaking now and listen. Do not finish or come back to this line.',
    );
    duckedAt.current = 0;
    c.mutePatient(true);
    if (r.idx !== null) {
      showPatient(r, heardText ? `${heardText} —` : '—');
      save(r);
    }
    const mutedAt = performance.now();
    const check = () => {
      const now = performance.now();
      // Done with the old line: no voice and no new words for a while.
      const oldDone = !c.patientAudible(RESUME_QUIET_MS) && now - r.lastPieceAt > RESUME_QUIET_MS;
      // Or his next line has started.
      const next = reply.current;
      const nextStarted = next !== r && !!next?.pieces.length;
      if (oldDone || nextStarted || now - mutedAt > MAX_MUTE_MS) {
        c.mutePatient(false);
        muteTimer.current = null;
        return;
      }
      muteTimer.current = window.setTimeout(check, 150);
    };
    muteTimer.current = window.setTimeout(check, 150);
  }

  function onHeard(delta: string) {
    const c = call.current;
    if (!c) return;
    const now = performance.now();
    const r = reply.current;
    // Late words: the reply was already asked for but the patient hasn't
    // started. They finish the resident's last turn, not the next one.
    if (
      r &&
      r.residentKey &&
      r.firstAudibleAt === null &&
      !c.patientAudible() &&
      now - r.takenAt < LATE_WORDS_MS
    ) {
      r.late += delta;
      const key = r.residentKey;
      const base = bubblesRef.current.find((b) => b.key === key)?.text ?? '';
      setBubbleText(key, `${base} ${delta}`.replace(/\s+/g, ' ').trim());
      save(r);
      return;
    }
    // While the patient talks, and just after, mic input may be his own echo:
    // it only counts once it's clearly the resident (new words, and the mic was loud).
    const inEcho = c.patientAudible() || now - c.lastSoundAt < ECHO_WINDOW_MS;
    if (inEcho && r?.cut == null) {
      suspect.current.push(delta);
      const his = `${r?.spoken ?? ''} ${prevSpoken.current}`;
      // "Mm-hm" or "right" while he talks is listening, not cutting in.
      const theirs =
        isCutIn(suspect.current.join(''), his) &&
        (!!duckedAt.current || now - c.lastMicLoudAt < MIC_EVIDENCE_MS);
      if (!theirs) return;
      // Keep the resident's words; drop pieces that were only his echo.
      delta = suspect.current.filter((x) => !isEcho(x, his)).join('');
      suspect.current = [];
      heardBuf.current += delta;
      heardAt.current = now;
      setHeard(heardBuf.current.trim());
      if (c.patientAudible()) cutPatientOff();
      return;
    }
    heardBuf.current += delta;
    heardAt.current = now;
    setHeard(heardBuf.current.trim());
  }

  /** Waits for the resident's last words to come in (GPT-Live's transcript lags the voice). */
  async function settle() {
    const c = call.current;
    const start = performance.now();
    for (;;) {
      const now = performance.now();
      const quietFor = now - Math.max(heardAt.current, c?.lastMicLoudAt ?? 0);
      if (heardBuf.current.trim() && quietFor >= SETTLE_QUIET_MS) return;
      if (now - start > (heardBuf.current.trim() ? SETTLE_MAX_MS : SETTLE_EMPTY_MS)) return;
      await new Promise((res) => setTimeout(res, 50));
    }
  }

  async function answer(delegationId: string) {
    const c = call.current;
    if (!c || ended.current) return;
    const askedAt = performance.now();
    await settle();
    const text = heardBuf.current.trim();
    heardBuf.current = '';
    setHeard('');
    if (!text) {
      c.note(delegationId, 'The doctor has not said anything new. Do not reply; keep listening.');
      return;
    }
    const residentKey = `r${Date.now()}`;
    setBubbles((b) => [...b, { key: residentKey, who: 'resident', text }]);
    // The previous reply: tell the server what was really said, if not saved yet.
    const prev = reply.current;
    const prevUnsaved = prev && !prev.saved && prev.idx !== null;
    if (prev) {
      prev.saved = true;
      prevSpoken.current = prev.cut ?? prev.spoken;
    }
    const input: TurnInput = {
      sessionId,
      text,
      source: 'voice',
      live: true,
      ...(prevUnsaved && prev.cut === null && prev.spoken ? { prevSpoken: prev.spoken } : {}),
      ...(prevUnsaved && prev.cut !== null ? { prevInterrupted: { heard: prev.cut } } : {}),
      ...(lastWaitMs.current != null ? { prevAppWaitMs: lastWaitMs.current } : {}),
    };
    const r = new LiveReply(null, residentKey);
    const wasCut = prev?.cut != null;
    reply.current = r;
    delegationOf.current = delegationId;
    lastWaitMs.current = null;
    setThinking(true);
    try {
      // The whole line goes to GPT-Live at once: lines sent in pieces were
      // sometimes cut short (a later piece arriving while it was talking).
      const result = await streamTurn(input, () => undefined);
      const u = result.patient;
      r.idx = u.idx;
      r.planned = u.text;
      r.nonverbal = u.nonverbal;
      lastWaitMs.current = Math.round(performance.now() - askedAt);
      totalWaitMs.current += lastWaitMs.current;
      if (wasCut)
        c.note(
          delegationId,
          'You were cut off earlier. Never finish or repeat that line. Say only this new line.',
        );
      c.say(delegationId, toneNote(u.delivery) + u.text);
      r.sentAt = performance.now();
      // Cut off (or late words) before the server answered: save now.
      if (r.cut !== null) showPatient(r, r.cut ? `${r.cut} —` : '—');
      save(r);
    } catch (e) {
      reportError('live.turn', e);
      setNotice(friendlyError(e));
      c.say(delegationId, 'Sorry, what was that?');
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
          const r = new LiveReply(0, null);
          r.planned = opening.text;
          r.nonverbal = opening.nonverbal;
          reply.current = r;
          delegationOf.current = null;
          c.say(null, toneNote(opening.delivery) + opening.text);
          r.sentAt = performance.now();
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
        inFlight.current = inFlight.current.then(() => answer(id)).catch(() => undefined);
      },
      onHeard,
      onSpoken: (d, startMs) => {
        reply.current?.add(d, startMs);
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
      // Include OpenAI's reason (status and message) so the cause shows up in diagnostics.
      const details = (e as { details?: unknown }).details;
      reportError(
        'live.start',
        details ? new Error(`${(e as Error).message} ${JSON.stringify(details)}`) : e,
      );
      fallBack('GPT-Live isn’t available right now, so this uses the standard voice.');
    }
  }

  /** Saves whatever the patient said so far, and waits (briefly) for every save. */
  async function flushSaves() {
    await Promise.race([inFlight.current, wait(3000)]);
    const r = reply.current;
    if (r) save(r);
    await Promise.race([Promise.allSettled(saves.current), wait(4000)]);
  }

  async function finish() {
    if (!window.confirm('End the conversation and get feedback?')) return;
    ended.current = true;
    setPhase('ending');
    setSaving('Saving…');
    await flushSaves();
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
