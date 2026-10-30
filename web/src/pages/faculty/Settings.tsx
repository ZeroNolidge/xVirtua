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
import { Link } from 'react-router-dom';
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
        <legend>Video avatar (test)</legend>
        <label className="check">
          <input
            type="checkbox"
            checked={program.avatarOn ?? false}
            onChange={(e) => void save({ avatarOn: e.target.checked })}
          />
          <span>
            Show the patient as a lip-synced video face (Simli). Only the patient’s voice is sent to
            Simli, never the resident’s.
          </span>
        </label>
        {VOICE_GROUPS.map(([group, label]) => (
          <FaceField
            key={group}
            label={label}
            value={program.avatarFaces?.[group] ?? ''}
            onSave={(id) =>
              void save({
                avatarFaces: Object.fromEntries(
                  Object.entries({ ...program.avatarFaces, [group]: id }).filter(([, v]) => v),
                ),
              })
            }
          />
        ))}
        <p className="small">
          <Link to="/faculty/face-check">Face check</Link>: a one-minute test of a patient’s face
          and clips, recorded for review.
        </p>
        <p className="small muted">
          Patients with body-language clips (Ray) have two faces: guarded at the start, and at ease
          once the resident earns his trust. These replace the face above.
        </p>
        <FaceField
          label="Guarded face (start of the visit)"
          value={program.avatarMoodFaces?.guarded ?? ''}
          onSave={(id) =>
            void save({
              avatarMoodFaces: Object.fromEntries(
                Object.entries({ ...program.avatarMoodFaces, guarded: id }).filter(([, v]) => v),
              ),
            })
          }
        />
        <FaceField
          label="At-ease face (once he relaxes)"
          value={program.avatarMoodFaces?.at_ease ?? ''}
          onSave={(id) =>
            void save({
              avatarMoodFaces: Object.fromEntries(
                Object.entries({ ...program.avatarMoodFaces, at_ease: id }).filter(([, v]) => v),
              ),
            })
          }
        />
        <p className="small muted">
          Copy a face ID from your Simli dashboard (Faces). The Simli key is added by the developer
          as a GitHub secret, never here.
        </p>
      </fieldset>
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

const FACE_ID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** A Simli face id, saved once it looks right (or cleared). */
function FaceField({
  label,
  value,
  onSave,
}: {
  label: string;
  value: string;
  onSave(id: string): void;
}) {
  const [draft, setDraft] = useState(value);
  const ok = !draft.trim() || FACE_ID.test(draft.trim());
  return (
    <label className="field">
      <span>{label}</span>
      <input
        value={draft}
        placeholder="Simli face ID"
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const id = draft.trim();
          if (ok && id !== value) onSave(id);
        }}
      />
      {!ok && <span className="small error">That doesn’t look like a Simli face ID.</span>}
    </label>
  );
}
