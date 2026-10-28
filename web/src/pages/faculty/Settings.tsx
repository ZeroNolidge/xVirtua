import { useEffect, useState } from 'react';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import {
  LIVE_VOICES,
  type LiveVoice,
  type PatientModel,
  type Program,
  type VoiceGroup,
  type VoiceMode,
} from '@plainspeak/shared';
import { db } from '../../lib/firebase';
import { useAuth } from '../../lib/auth';
import { MODEL_LABELS } from '../../lib/models';
import { VoiceSamples } from './VoiceSamples';
import { TAG_LABEL } from './voiceTags';

const VOICE_GROUPS: [VoiceGroup, string][] = [
  ['he', 'Patients who use he/him'],
  ['she', 'Patients who use she/her'],
  ['they', 'Patients who use they/them'],
];

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
      <label className="check">
        <input
          type="checkbox"
          checked={program.captionsDefault ?? false}
          onChange={(e) => void save({ captionsDefault: e.target.checked })}
        />
        <span>
          Captions on by default during conversations (residents can still switch them on or off on
          their own phone)
        </span>
      </label>
      <fieldset className="field">
        <legend>GPT-Live voices (each patient gets the one for their pronouns)</legend>
        {VOICE_GROUPS.map(([group, label]) => (
          <label key={group} className="field">
            <span>{label}</span>
            <select
              value={program.liveVoices?.[group] ?? program.liveVoice ?? 'marin'}
              onChange={(e) =>
                void save({
                  liveVoices: { ...program.liveVoices, [group]: e.target.value as LiveVoice },
                })
              }
            >
              {LIVE_VOICES.map((v) => (
                <option key={v} value={v}>
                  {v}
                  {program.liveVoiceTags?.[v] ? ` (${TAG_LABEL[program.liveVoiceTags[v]!]})` : ''}
                </option>
              ))}
            </select>
          </label>
        ))}
      </fieldset>
      <section aria-labelledby="voice-samples-h">
        <h3 id="voice-samples-h">Hear the GPT-Live voices</h3>
        <VoiceSamples
          tags={program.liveVoiceTags ?? {}}
          onTag={(voice, tag) =>
            void save({ liveVoiceTags: { ...program.liveVoiceTags, [voice]: tag } })
          }
        />
      </section>
      {saved && <p className="ok small">Saved. New conversations use these settings.</p>}
      <p className="muted small">
        Audio kept {program.audioRetentionMonths} months · transcripts kept{' '}
        {program.transcriptRetentionMonths} months
      </p>
    </div>
  );
}
