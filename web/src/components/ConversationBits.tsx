import { useEffect, useState } from 'react';

export type TurnState = 'you' | 'patient' | 'thinking' | 'waiting';

/** Whose turn it is, just above the controls. */
export function StatusPill({ state, text }: { state: TurnState; text: string }) {
  return (
    <div className={`status-pill ${state}`} role="status" aria-live="polite">
      {state === 'you' && <span className="mic-pulse" aria-hidden="true" />}
      {text}
    </div>
  );
}

/** How loud the mic is, so residents know they're being heard. */
export function MicLevel({ read }: { read: () => number }) {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setLevel(read()), 100);
    return () => window.clearInterval(t);
  }, [read]);
  return (
    <div className="mic-level" aria-hidden="true">
      <div className="mic-level-fill" style={{ width: `${Math.round(level * 100)}%` }} />
    </div>
  );
}

/** Captions on or off (remembered on this phone). */
export function CaptionsToggle({ on, onToggle }: { on: boolean; onToggle(): void }) {
  return (
    <button className="btn btn-text btn-inline" aria-pressed={on} onClick={onToggle}>
      {on ? 'Captions: on' : 'Captions: off'}
    </button>
  );
}

/** Shown in place of the words while captions are off. */
export function CaptionsOff({ first = 'the patient' }: { first?: string }) {
  return (
    <p className="captions-off muted small">
      Captions are off, like a real visit. Listen to {first} and talk naturally. The full
      conversation is on your feedback screen.
    </p>
  );
}
