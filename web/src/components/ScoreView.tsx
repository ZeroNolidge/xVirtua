import { useState } from 'react';
import type { Metric, MetricScore, Moment, ScoreDoc } from '@plainspeak/shared';
import { METRIC_LABEL } from './metricLabels';

function Quote({ text }: { text: string }) {
  return <blockquote className="quote">“{text}”</blockquote>;
}

function MomentCard({
  m,
  kind,
  showRewrite,
}: {
  m: Moment;
  kind: 'good' | 'fix';
  showRewrite: boolean;
}) {
  return (
    <div className={`moment ${kind}`}>
      <div className="moment-tag">{METRIC_LABEL[m.metric]}</div>
      <Quote text={m.quote} />
      <p>{m.note}</p>
      {showRewrite && m.rewrite && (
        <div className="rewrite">
          <div className="rewrite-label">Try saying this instead</div>
          <p>“{m.rewrite}”</p>
        </div>
      )}
    </div>
  );
}

function Bar({ score }: { score: number }) {
  return (
    <div className="bar" role="img" aria-label={`${score} out of 100`}>
      <div className="bar-fill" style={{ width: `${Math.max(2, Math.min(100, score))}%` }} />
    </div>
  );
}

function MetricDetail({
  metric,
  m,
  extra,
}: {
  metric: Metric;
  m: MetricScore;
  extra?: React.ReactNode;
}) {
  return (
    <div className="metric">
      <div className="metric-head">
        <strong>{METRIC_LABEL[metric]}</strong>
        <span className="metric-score">{m.score}</span>
      </div>
      <Bar score={m.score} />
      <p className="muted">{m.summary}</p>
      {m.evidence.length > 0 && (
        <ul className="evidence">
          {m.evidence.map((e, i) => (
            <li key={i}>
              <Quote text={e.quote} />
              <span className="small muted">{e.note}</span>
            </li>
          ))}
        </ul>
      )}
      {extra}
      {m.tryThisInstead && (
        <div className="rewrite">
          <div className="rewrite-label">Try saying this instead</div>
          <p className="small muted">Instead of “{m.tryThisInstead.original}”</p>
          <p>“{m.tryThisInstead.rewrite}”</p>
        </div>
      )}
    </div>
  );
}

/** Coaching-style results: one win first, at most two fixes, full scores one tap away. */
export function ScoreView({
  score,
  patientFirstName,
}: {
  score: ScoreDoc;
  patientFirstName: string;
}) {
  const [open, setOpen] = useState(false);
  const { metrics: m } = score;
  return (
    <>
      {score.highlight && (
        <div className="card">
          <h2>What went well</h2>
          <MomentCard m={score.highlight} kind="good" showRewrite={false} />
        </div>
      )}

      {score.fixes.length > 0 && (
        <div className="card">
          <h2>
            {score.fixes.length === 1
              ? 'One thing to try next time'
              : 'Two things to try next time'}
          </h2>
          {score.fixes.slice(0, 2).map((f, i) => (
            <MomentCard key={i} m={f} kind="fix" showRewrite={i === 0} />
          ))}
        </div>
      )}

      <button className="btn btn-secondary" aria-expanded={open} onClick={() => setOpen((x) => !x)}>
        {open ? 'Hide full scores' : 'See full scores'}
      </button>

      {open && (
        <div className="card scores">
          {score.overall !== null && (
            <div className="overall">
              <span className="overall-num">{score.overall}</span>
              <span className="muted small">overall, out of 100</span>
            </div>
          )}
          <MetricDetail
            metric="jargon"
            m={m.jargon}
            extra={
              <>
                {m.jargon.flagged.length > 0 && (
                  <ul className="swaps">
                    {m.jargon.flagged.map((f) => (
                      <li key={f.term}>
                        <strong>{f.term}</strong> → {f.plain.join(' or ')}
                        {f.uses > 1 && <span className="muted small"> ({f.uses}×)</span>}
                      </li>
                    ))}
                  </ul>
                )}
                {m.jargon.explained.length > 0 && (
                  <p className="small ok">
                    Nice: you explained {m.jargon.explained.map((e) => `“${e.term}”`).join(', ')}.
                  </p>
                )}
              </>
            }
          />
          <MetricDetail metric="clarity" m={m.clarity} />
          <MetricDetail metric="empathy" m={m.empathy} />
          <MetricDetail
            metric="cue"
            m={m.cue}
            extra={
              m.cue.cueResults.length > 0 && (
                <ul className="cue-results">
                  {m.cue.cueResults.map((c, i) => (
                    <li key={i}>
                      <span aria-hidden="true">{c.addressed ? '✅' : '◻️'}</span> {patientFirstName}
                      : {c.cue}
                      {c.quote && <span className="muted small"> — you said “{c.quote}”</span>}
                    </li>
                  ))}
                </ul>
              )
            }
          />
          <p className="muted small">
            Each area counts {Math.round(score.weights.jargon * 100)}% of the overall score. Rubric{' '}
            {score.rubricVersion}.
            {score.needsReview &&
              ' Some quotes couldn’t be matched to the transcript, so faculty may review this one.'}
          </p>
        </div>
      )}
    </>
  );
}
