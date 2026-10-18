import { useEffect, useMemo, useState } from 'react';
import { searchJargon } from '@plainspeak/shared';
import { useAuth } from '../lib/auth';
import { lookupOnServer, useJargonTerms, type ServerAnswer } from '../lib/jargon';

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
  // The built-in dictionary answers instantly, on every keystroke.
  const results = useMemo(() => searchJargon(terms, q, 15), [terms, q]);
  const term = q.trim();
  // Only when it has nothing do we ask the server (after a short pause in typing).
  const needServer = term.length >= 3 && results.length === 0;
  const [server, setServer] = useState<{
    term: string;
    answer: ServerAnswer | null;
    failed?: boolean;
  } | null>(null);
  useEffect(() => {
    if (!needServer) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      lookupOnServer(term)
        .then((answer) => {
          if (!cancelled) setServer({ term, answer });
        })
        .catch(() => {
          if (!cancelled) setServer({ term, answer: null, failed: true });
        });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [needServer, term]);
  const serverForTerm = server && server.term === term ? server : null;
  const looking = needServer && !serverForTerm;

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

      {term && results.length === 0 && term.length < 3 && <p className="muted">Keep typing…</p>}
      {looking && (
        <p className="muted" role="status">
          Looking…
        </p>
      )}
      {serverForTerm && !serverForTerm.answer && (
        <p className="muted">
          {serverForTerm.failed ? 'Couldn’t look that up right now.' : 'No match.'} Try a shorter or
          different word.
        </p>
      )}
      {serverForTerm?.answer && (
        <ul className="results">
          <li className="result">
            <div className="result-term">{serverForTerm.answer.term}</div>
            <div className="result-plain">
              Say:{' '}
              {serverForTerm.answer.plain.map((p, i) => (
                <span key={p}>
                  {i > 0 && <span className="muted"> or </span>}
                  <strong>“{p}”</strong>
                </span>
              ))}
            </div>
            {serverForTerm.answer.explanation && (
              <div className="small">{serverForTerm.answer.explanation}</div>
            )}
            <div className="muted small">
              Suggested by AI, not from the program’s dictionary. Double-check it.
            </div>
          </li>
        </ul>
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
