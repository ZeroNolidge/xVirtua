import { useState } from 'react';
import { METRICS, type AreaFeedback, type Moment, type ResidentFeedback } from '@plainspeak/shared';
import { METRIC_LABEL, trendLine } from './metricLabels';

function YouSaid({ text }: { text: string }) {
  return (
    <div className="you-said">
      <div className="said-label">You said:</div>
      <blockquote className="quote">“{text}”</blockquote>
    </div>
  );
}

function MomentCard({
  m,
  kind,
  patientFirstName,
}: {
  m: Moment;
  kind: 'good' | 'fix';
  patientFirstName: string;
}) {
  return (
    <div className={`moment ${kind}`}>
      <div className="moment-tag">{METRIC_LABEL[m.metric]}</div>
      {m.before && (
        <p className="before small muted">
          Before this, {patientFirstName} said: “{m.before}”
        </p>
      )}
      <YouSaid text={m.quote} />
      <p>{m.note}</p>
      {kind === 'fix' && m.rewrite && (
        <div className="rewrite">
          <div className="rewrite-label">Try saying this instead</div>
          <p>“{m.rewrite}”</p>
        </div>
      )}
    </div>
  );
}

function Area({ name, a, extra }: { name: string; a: AreaFeedback; extra?: React.ReactNode }) {
  return (
    <div className="metric">
      <div className="metric-head">
        <strong>{a.summary}</strong>
        <span className="band small">
          {name} · {a.band}
        </span>
      </div>
      {a.evidence.length > 0 && (
        <ul className="evidence">
          {a.evidence.map((e, i) => (
            <li key={i}>
              <YouSaid text={e.quote} />
              <span className="small muted">{e.note}</span>
            </li>
          ))}
        </ul>
      )}
      {extra}
      {a.tryThisInstead && (
        <div className="rewrite">
          <div className="rewrite-label">Try saying this instead</div>
          <p className="small muted">Instead of “{a.tryThisInstead.original}”</p>
          <p>“{a.tryThisInstead.rewrite}”</p>
        </div>
      )}
    </div>
  );
}

/**
 * Coaching-style results: one strength, two fixes from two different areas
 * (each with something to say instead), and the full scores one tap away.
 * Residents see words and trends, never numbers. The overall word is the
 * page heading (SessionDone).
 */
export function ScoreView({
  feedback,
  patientFirstName,
}: {
  feedback: ResidentFeedback;
  patientFirstName: string;
}) {
  const [open, setOpen] = useState(false);
  const { areas } = feedback;
  return (
    <>
      {feedback.overall && feedback.overall.trend !== 'first' && (
        <p className="overall-word" aria-label="Compared with last time">
          {trendLine(feedback.overall.trend)}
        </p>
      )}

      {feedback.highlight && (
        <div className="card">
          <h2>What went well</h2>
          <MomentCard m={feedback.highlight} kind="good" patientFirstName={patientFirstName} />
        </div>
      )}

      {feedback.fixes.length > 0 && (
        <div className="card">
          <h2>
            {feedback.fixes.length === 1
              ? 'One thing to try next time'
              : 'Two things to try next time'}
          </h2>
          {feedback.fixes.slice(0, 2).map((f, i) => (
            <MomentCard key={i} m={f} kind="fix" patientFirstName={patientFirstName} />
          ))}
        </div>
      )}

      <button className="btn btn-secondary" aria-expanded={open} onClick={() => setOpen((x) => !x)}>
        {open ? 'Hide full scores' : 'See full scores'}
      </button>

      {open && (
        <div className="card scores">
          {METRICS.map((m) => (
            <Area
              key={m}
              name={METRIC_LABEL[m]}
              a={areas[m]}
              extra={
                m === 'jargon' ? (
                  areas.jargon.explained.length > 0 && (
                    <p className="small ok">
                      Nice: you explained{' '}
                      {areas.jargon.explained.map((e) => `“${e.term}”`).join(', ')}.
                    </p>
                  )
                ) : m === 'cue' && areas.cue.cueResults.length > 0 ? (
                  <ul className="cue-results">
                    {areas.cue.cueResults.map((c, i) => (
                      <li key={i}>
                        <span aria-hidden="true">{c.addressed ? '✅' : '◻️'}</span>{' '}
                        {patientFirstName}: {c.cue}
                        {c.quote && <span className="muted small"> — you said “{c.quote}”</span>}
                      </li>
                    ))}
                  </ul>
                ) : null
              }
            />
          ))}
        </div>
      )}
    </>
  );
}
