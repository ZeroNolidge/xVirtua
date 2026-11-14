import { Link } from 'react-router-dom';
import { Settings } from './Settings';
import { ResidentData } from './ResidentData';

/** Program-wide settings (patient model, live voices, video faces), residents' data and the face check. */
export function Admin() {
  return (
    <section>
      <p>
        <Link to="/faculty" className="small">
          ← Residents’ progress
        </Link>
      </p>
      <h1>Admin</h1>
      <Settings />
      <ResidentData />
      <div className="card">
        <h2>Video face check</h2>
        <p className="muted small">
          A one-minute test of a patient’s video face, saved for review.
        </p>
        <Link to="/faculty/face-check" className="btn btn-secondary">
          Run a face check
        </Link>
      </div>
    </section>
  );
}
