import { useMemo, useState } from 'react';
import { searchJargon } from '@plainspeak/shared';
import { useAuth } from '../lib/auth';
import { useJargonTerms } from '../lib/jargon';

const SUGGESTIONS = [
  'hypertension',
  'A1c',
  'statin',
  'chronic',
  'benign',
  'PRN',
  'renal',
  'lipids',
];

/** Instant "plain word" lookup. Reused as a quick sheet during conversations (Phase 3). */
export function PlainWordSearch({ autoFocus = false }: { autoFocus?: boolean }) {
  const { claims } = useAuth();
  const terms = useJargonTerms(claims?.programId);
  const [q, setQ] = useState('');
  const results = useMemo(() => searchJargon(terms, q, 15), [terms, q]);

  return (
    <div className="lookup">
      <label className="field">
        <span className="sr-only">Search a medical word</span>
        <input
          type="search"
          inputMode="search"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          autoFocus={autoFocus}
          placeholder="Type a medical word…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </label>

      {!q.trim() && (
        <div className="chips" aria-label="Try one">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" className="chip" onClick={() => setQ(s)}>
              {s}
            </button>
          ))}
        </div>
      )}

      {q.trim() && results.length === 0 && (
        <p className="muted">No match yet. Try a shorter word.</p>
      )}

      <ul className="results">
        {results.map((t) => (
          <li key={t.id} className="result">
            <div className="result-term">{t.term}</div>
            <div className="result-plain">
              Say:{' '}
              {t.plain.map((p, i) => (
                <span key={p}>
                  {i > 0 && <span className="muted"> or </span>}
                  <strong>“{p}”</strong>
                </span>
              ))}
            </div>
            {t.allowedIfExplained && (
              <div className="muted small">Fine to use if you explain it in plain words.</div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
