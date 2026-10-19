import { useEffect, useState } from 'react';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import {
  LIVE_VOICES,
  type LiveVoice,
  type PatientModel,
  type Program,
  type VoiceMode,
} from '@plainspeak/shared';
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

  async function save(change: Partial<Program>) {
    if (!claims) return;
    setSaved(false);
    await updateDoc(doc(db, 'programs', claims.programId), change);
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
          onChange={(e) => void save({ patientModel: e.target.value as PatientModel })}
        >
          {Object.entries(MODEL_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Patient voice for residents</span>
        <select
          value={program.voiceMode ?? 'standard'}
          onChange={(e) => void save({ voiceMode: e.target.value as VoiceMode })}
        >
          <option value="standard">Standard (turn by turn)</option>
          <option value="live">GPT-Live (test: talks and listens at once)</option>
        </select>
      </label>
      <label className="field">
        <span>GPT-Live voice (when GPT-Live is on)</span>
        <select
          value={program.liveVoice ?? 'marin'}
          onChange={(e) => void save({ liveVoice: e.target.value as LiveVoice })}
        >
          {LIVE_VOICES.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </label>
      {saved && <p className="ok small">Saved. New conversations use these settings.</p>}
      <p className="muted small">
        Audio kept {program.audioRetentionMonths} months · transcripts kept{' '}
        {program.transcriptRetentionMonths} months
      </p>
    </div>
  );
}
