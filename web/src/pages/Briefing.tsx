import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { CueTrigger, PatientModel, ScenarioScript, ScenarioStatus } from '@plainspeak/shared';
import { useAuth } from '../lib/auth';
import { useScenario, type ScenarioRow } from '../lib/scenarios';
import { api, friendlyError } from '../lib/api';
import { Difficulty } from '../components/Difficulty';
import { Loading } from './StatusScreens';
import { sessionApi } from '../lib/session';
import { MODEL_LABELS } from '../lib/models';

export function Briefing() {
  const { id } = useParams();
  const { claims } = useAuth();
  const isFaculty = claims?.role === 'faculty';
  const { detail, status } = useScenario(id, isFaculty);
  const nav = useNavigate();
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [model, setModel] = useState<PatientModel | ''>('');

  async function startConversation() {
    if (!id) return;
    setStarting(true);
    setStartError(null);
    try {
      const { data } = await sessionApi.start({ scenarioId: id, ...(model ? { model } : {}) });
      nav(`/session/${data.sessionId}`, {
        state: { opening: data.opening, persona: data.persona },
      });
    } catch (e) {
      setStartError(friendlyError(e));
      setStarting(false);
    }
  }

  if (status === 'loading') return <Loading />;
  if (!detail) {
    return (
      <section>
        <h1>Patient not found</h1>
        <div className="card">
          <p>This scenario isn’t available.</p>
          <Link to="/" className="btn">
            Back to patients
          </Link>
        </div>
      </section>
    );
  }

  const b = detail.briefing;
  return (
    <section>
      <Link to="/" className="back">
        ← Patients
      </Link>
      <h1>{b.title}</h1>
      <Difficulty level={b.difficulty} />

      <div className="card patient-card">
        <div className="avatar" aria-hidden="true">
          {b.persona.name
            .split(' ')
            .map((p) => p[0])
            .join('')}
        </div>
        <div>
          <div className="patient-name">{b.persona.name}</div>
          <div className="muted small">
            {b.persona.age} · {b.persona.pronouns}
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Why they’re here</h2>
        <p>{b.reasonForVisit}</p>
        <h2>Your job</h2>
        <p>{b.residentTask}</p>
        <h2>What you know</h2>
        <ul className="tight">
          {b.residentFacts.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
        <h2>Focus on</h2>
        <ul className="tight">
          {b.learningObjectives.map((o) => (
            <li key={o}>{o}</li>
          ))}
        </ul>
        <p className="muted small">About {b.estimatedMinutes} minutes.</p>
      </div>

      {isFaculty && (
        <label className="field">
          <span>Patient model (faculty testing)</span>
          <select value={model} onChange={(e) => setModel(e.target.value as PatientModel | '')}>
            <option value="">Program default</option>
            {Object.entries(MODEL_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
      )}
      {startError && (
        <p className="error" role="alert">
          {startError}
        </p>
      )}
      <button className="btn" disabled={starting} onClick={() => void startConversation()}>
        {starting ? 'Getting the room ready…' : 'Start conversation'}
      </button>
      <p className="muted small center-text">Find a quiet spot. You’ll talk out loud.</p>

      {isFaculty && <FacultyReview summary={detail.summary} script={detail.script} />}
    </section>
  );
}

function describeTrigger(t: CueTrigger): string {
  switch (t.type) {
    case 'resident_turn_words_gt':
      return `After a resident turn longer than ${t.value} words`;
    case 'jargon_in_turn_gte':
      return `When a resident turn has ${t.value}+ jargon words`;
    case 'turn_index':
      return `At patient turn ${t.value}`;
    case 'topic_mentioned':
      return `When the resident mentions: ${t.topics.join(', ')}`;
    case 'no_understanding_check_for_turns':
      return `If no check for understanding for ${t.value} turns`;
  }
}

const STATUS_TEXT: Record<ScenarioStatus, string> = {
  draft: 'Draft: only faculty can see it.',
  active: 'Published: residents can practice it.',
  archived: 'Archived: hidden from everyone.',
};

function FacultyReview({
  summary,
  script,
}: {
  summary: ScenarioRow;
  script: ScenarioScript | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function setStatus(status: ScenarioStatus) {
    setBusy(true);
    setError(null);
    try {
      await api.setScenarioStatus({ scenarioId: summary.id, status });
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card faculty-review">
      <h2>Faculty review</h2>
      <p className="muted small">Residents never see this section.</p>
      <p>
        <strong>Status:</strong> {STATUS_TEXT[summary.status]}
      </p>

      {script ? (
        <>
          <dl className="facts">
            <dt>Health literacy</dt>
            <dd>{script.healthLiteracy}</dd>
            <dt>Emotional state</dt>
            <dd>{script.emotionalState}</dd>
            <dt>Hidden concern</dt>
            <dd>{script.hiddenConcern}</dd>
            <dt>Background</dt>
            <dd>{script.background}</dd>
            <dt>Opening line</dt>
            <dd>“{script.openingLine}”</dd>
            <dt>Patient knows</dt>
            <dd>
              <ul className="tight">
                {script.patientKnows.map((k) => (
                  <li key={k}>{k}</li>
                ))}
              </ul>
            </dd>
          </dl>
          <h2>Cue script</h2>
          <ol className="cues">
            {script.cueScript.map((c) => (
              <li key={c.id}>
                <div>
                  <strong>{c.cue}</strong>
                </div>
                <div className="muted small">{describeTrigger(c.trigger)}</div>
                <div>Patient: “{c.performance.say}”</div>
                {c.performance.nonverbal.length > 0 && (
                  <div className="muted small">
                    Nonverbal: {c.performance.nonverbal.join(', ').replace(/_/g, ' ')}
                  </div>
                )}
                <div className="small">Good response: {c.expectedResidentResponse}</div>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <p className="muted">Patient script unavailable.</p>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {summary.status !== 'active' && (
        <button className="btn" disabled={busy} onClick={() => void setStatus('active')}>
          Publish to residents
        </button>
      )}
      {summary.status === 'active' && (
        <button
          className="btn btn-secondary"
          disabled={busy}
          onClick={() => void setStatus('draft')}
        >
          Move back to draft
        </button>
      )}
      {summary.status !== 'archived' && (
        <button className="btn btn-text" disabled={busy} onClick={() => void setStatus('archived')}>
          Archive
        </button>
      )}
    </div>
  );
}
