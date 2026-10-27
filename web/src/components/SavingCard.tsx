/** Shown after End while the conversation and recording save, so nobody has to guess. */
export function SavingCard({ step, progress }: { step: string; progress: number | null }) {
  const pct = progress === null ? null : Math.round(progress * 100);
  return (
    <div className="card saving-card" role="status" aria-live="polite">
      <div className="spinner" aria-hidden="true" />
      <p>
        <strong>{step}</strong>
      </p>
      {pct !== null && (
        <div
          className="progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label="Recording upload"
        >
          <div className="progress-fill" style={{ width: `${pct}%` }} />
        </div>
      )}
      <p className="muted small">
        Your feedback opens next. This usually takes a few seconds — please keep this page open.
      </p>
    </div>
  );
}
