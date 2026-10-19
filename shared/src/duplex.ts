import { tokenize } from './jargon.js';

/**
 * Two-way voice: the mic stays on while the patient talks, so speech heard
 * then is either the resident talking over the patient, or the patient's own
 * voice leaking back from the phone speaker (echo). Echo repeats the patient's
 * words; the resident says new ones.
 */
export function isResidentSpeech(heard: string, patientSaying: string): boolean {
  const words = tokenize(heard).filter((w) => w.length > 1);
  if (words.length < 2) return false;
  const patient = new Set(tokenize(patientSaying));
  const novel = words.filter((w) => !patient.has(w));
  return novel.length >= 2 && novel.length / words.length >= 0.5;
}
