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

const BACKCHANNEL = new Set(
  'sorry mm mmm hm hmm mhm mm-hm mm-hmm uh-huh uhhuh right okay ok yeah yes yep sure oh ah i see go on gotcha got it true'.split(
    ' ',
  ),
);

/** "Sorry", "mm-hm", "right, go on": listening sounds, never a real cut-in. */
export function isBackchannel(text: string): boolean {
  const w = text.toLowerCase().match(/[a-z]+(?:-[a-z]+)*/g) ?? [];
  return w.length > 0 && w.length <= 4 && w.every((x) => BACKCHANNEL.has(x));
}

/** The resident is really cutting in: their own words, and more than a listening sound. */
export function isCutIn(heard: string, patientSaying: string): boolean {
  return isResidentSpeech(heard, patientSaying) && !isBackchannel(heard);
}
