import type { PauseReason } from '../lib/useCallGuard';

/** "Still there?" after 2 quiet minutes. */
export function StillThere({ onHere, onEnd }: { onHere(): void; onEnd(): void }) {
  return (
    <div className="card" role="alertdialog" aria-label="Still there?">
      <p>
        <strong>Still there?</strong> No one has spoken for 2 minutes. We’ll pause and turn the mic
        off in 30 seconds.
      </p>
      <button className="btn" onClick={onHere}>
        I’m here
      </button>
      <button className="btn btn-secondary" onClick={onEnd}>
        End and get feedback
      </button>
    </div>
  );
}

/** Paused: the mic and the voice connection are off. */
export function Paused({
  reason,
  busy,
  onContinue,
  onEnd,
}: {
  reason: PauseReason;
  busy?: boolean;
  onContinue(): void;
  onEnd(): void;
}) {
  return (
    <div className="card" role="status">
      <p>
        <strong>Paused. The mic is off.</strong>{' '}
        {reason === 'hidden'
          ? 'You left the app, so we paused the conversation.'
          : 'No one spoke for a while, so we paused the conversation.'}{' '}
        Everything so far is saved.
      </p>
      <button className="btn" disabled={busy} onClick={onContinue}>
        {busy ? 'Starting…' : 'Continue the conversation'}
      </button>
      <button className="btn btn-secondary" disabled={busy} onClick={onEnd}>
        End and get feedback
      </button>
    </div>
  );
}
