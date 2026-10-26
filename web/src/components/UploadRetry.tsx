/** Shown when the recording couldn't upload. The conversation itself is already saved. */
export function UploadRetry({
  busy,
  onRetry,
  onSkip,
}: {
  busy: boolean;
  onRetry(): void;
  onSkip(): void;
}) {
  return (
    <div className="card" role="alert">
      <p>
        <strong>The recording didn’t finish uploading.</strong> Your conversation is saved, so you
        can still get feedback.
      </p>
      <p className="muted small">Check your connection, then try again.</p>
      <button className="btn" disabled={busy} onClick={onRetry}>
        {busy ? 'Uploading…' : 'Try again'}
      </button>
      <button className="btn btn-secondary" disabled={busy} onClick={onSkip}>
        Skip, see my feedback
      </button>
    </div>
  );
}
