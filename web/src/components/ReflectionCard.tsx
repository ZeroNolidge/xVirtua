import { useState, type FormEvent } from 'react';
import {
  RATING_LABEL,
  REFLECTION_RATINGS,
  TECH_ISSUES,
  type ReflectionRating,
  type TechIssue,
} from '@plainspeak/shared';

export interface ReflectionInput {
  rating: ReflectionRating;
  note?: string;
  issues?: TechIssue[];
  issueNote?: string;
}

/**
 * While the feedback is being written: the resident's own take first (how
 * it went, one thing they'd do differently), and anything that went wrong
 * technically. Nothing is required; "Skip" is always there.
 */
export function ReflectionCard({
  first,
  onSave,
  onSkip,
}: {
  first: string;
  onSave: (r: ReflectionInput) => Promise<void> | void;
  onSkip: () => void;
}) {
  const [rating, setRating] = useState<ReflectionRating | null>(null);
  const [note, setNote] = useState('');
  const [issues, setIssues] = useState<TechIssue[]>([]);
  const [issueNote, setIssueNote] = useState('');
  const [busy, setBusy] = useState(false);
  const toggle = (id: TechIssue) =>
    setIssues((all) => (all.includes(id) ? all.filter((x) => x !== id) : [...all, id]));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!rating) return;
    setBusy(true);
    try {
      await onSave({
        rating,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(issues.length ? { issues } : {}),
        ...(issueNote.trim() ? { issueNote: issueNote.trim() } : {}),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card reflection" onSubmit={(e) => void submit(e)}>
      <h2>While we write your feedback…</h2>
      <p>How did that go with {first}?</p>
      <div className="chips" role="group" aria-label="How did it go">
        {REFLECTION_RATINGS.map((r) => (
          <button
            key={r}
            type="button"
            className="chip"
            aria-pressed={rating === r}
            onClick={() => setRating(r)}
          >
            {RATING_LABEL[r]}
          </button>
        ))}
      </div>
      <label className="field">
        <span>One thing you’d do differently? (optional)</span>
        <textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <p className="small">Anything go wrong technically? (optional)</p>
      <div className="chips" role="group" aria-label="Technical problems">
        {TECH_ISSUES.map((i) => (
          <button
            key={i.id}
            type="button"
            className="chip"
            aria-pressed={issues.includes(i.id)}
            onClick={() => toggle(i.id)}
          >
            {i.label}
          </button>
        ))}
      </div>
      {issues.length > 0 && (
        <label className="field">
          <span>What happened? (optional)</span>
          <textarea
            rows={2}
            maxLength={500}
            value={issueNote}
            onChange={(e) => setIssueNote(e.target.value)}
          />
        </label>
      )}
      <div className="reflection-actions">
        <button className="btn" type="submit" disabled={!rating || busy}>
          Done
        </button>
        <button className="btn btn-text" type="button" onClick={onSkip} disabled={busy}>
          Skip
        </button>
      </div>
    </form>
  );
}
