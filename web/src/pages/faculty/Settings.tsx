import { useEffect, useState } from 'react';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import type { PatientModel, Program } from '@plainspeak/shared';
import { db } from '../../lib/firebase';
import { useAuth } from '../../lib/auth';
import { MODEL_LABELS } from '../../lib/models';

export function Settings() {
  const { claims } = useAuth();
  const [program, setProgram] = useState<Program | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!claims) return;
    return onSnapshot(doc(db, 'programs', claims.programId), (s) =>
      setProgram(s.data() as Program),
    );
  }, [claims]);

  async function setModel(m: PatientModel) {
    if (!claims) return;
    setSaved(false);
    await updateDoc(doc(db, 'programs', claims.programId), { patientModel: m });
    setSaved(true);
  }

  if (!program) return null;
  return (
    <div className="card">
      <h2>Program settings</h2>
      <label className="field">
        <span>Patient model for residents</span>
        <select
          value={program.patientModel}
          onChange={(e) => void setModel(e.target.value as PatientModel)}
        >
          {Object.entries(MODEL_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      {saved && <p className="ok small">Saved. New conversations use this model.</p>}
      <p className="muted small">
        Audio kept {program.audioRetentionMonths} months · transcripts kept{' '}
        {program.transcriptRetentionMonths} months
      </p>
    </div>
  );
}
