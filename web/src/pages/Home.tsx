import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useScenarioList } from '../lib/scenarios';
import { Difficulty } from '../components/Difficulty';
import { Loading } from './StatusScreens';

export function Home() {
  const { claims, userDoc } = useAuth();
  const rows = useScenarioList(claims);
  const isFaculty = claims?.role === 'faculty';
  const firstName = userDoc?.displayName?.split(/[\s.]/)[0];

  return (
    <section>
      <h1>Ready to practice{firstName ? `, ${firstName}` : ''}?</h1>
      <p className="muted">Pick a patient. Each conversation takes about 5–8 minutes.</p>

      {rows === null && <Loading label="Loading patients…" />}
      {rows?.length === 0 && (
        <div className="card">
          <p>No patients are available yet.</p>
          {isFaculty ? (
            <p className="muted small">
              Seed scenarios start as drafts. Publish them from each scenario page.
            </p>
          ) : (
            <p className="muted small">Your faculty will add them soon.</p>
          )}
        </div>
      )}

      <ul className="scenario-list">
        {rows?.map((s) => (
          <li key={s.id}>
            <Link to={`/scenario/${s.id}`} className="card scenario-card">
              <div className="scenario-top">
                <span className="scenario-title">{s.title}</span>
                {s.status === 'draft' && <span className="badge">Draft</span>}
              </div>
              <div>
                {s.patientName}, {s.patientAge}
              </div>
              <div className="muted small">{s.reasonForVisit}</div>
              <Difficulty level={s.difficulty} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
