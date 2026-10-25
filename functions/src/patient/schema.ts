import { z } from 'zod';
import {
  EMOTIONS,
  NONVERBAL_CUES,
  stripStageDirections,
  type PatientUtterance,
} from '@plainspeak/shared';

/** JSON schema Claude must follow for every patient reply. */
export const PATIENT_REPLY_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  // Order matters: delivery and nonverbal cues stream first, so the voice can
  // start on the first sentence of "text" with the right emotion.
  required: ['delivery', 'nonverbal', 'text', 'askedQuestion', 'cueId'],
  properties: {
    delivery: {
      type: 'object',
      additionalProperties: false,
      required: ['emotion', 'volume', 'rate', 'pauseBeforeMs'],
      properties: {
        emotion: { type: 'string', enum: [...EMOTIONS] },
        volume: { type: 'string', enum: ['quiet', 'normal'] },
        rate: { type: 'string', enum: ['slow', 'normal'] },
        pauseBeforeMs: { type: 'integer', description: 'Silence before speaking, 0–5000 ms.' },
      },
    },
    nonverbal: { type: 'array', items: { type: 'string', enum: [...NONVERBAL_CUES] } },
    text: {
      type: 'string',
      description:
        'Exactly what the patient says out loud. 1–3 short sentences. Words only: no stage directions or actions in parentheses.',
    },
    askedQuestion: {
      type: 'boolean',
      description: 'True if the patient asked the resident a question.',
    },
    cueId: {
      type: ['string', 'null'],
      description: 'The id of the scripted cue being performed this turn, or null.',
    },
  },
} as const;

const replySchema = z.object({
  text: z.string().trim().min(1).max(600),
  askedQuestion: z.boolean(),
  cueId: z.string().nullable(),
  delivery: z.object({
    emotion: z.enum(EMOTIONS),
    volume: z.enum(['quiet', 'normal']),
    rate: z.enum(['slow', 'normal']),
    pauseBeforeMs: z.number().int(),
  }),
  nonverbal: z.array(z.enum(NONVERBAL_CUES)).max(4),
});

/** The patient never trails off: a reply ending in "—" or "…" ends with a period instead. */
export function finishSentence(text: string): string {
  const t = text.replace(/\s*(?:[—–-]+|\.{2,}|…)\s*$/u, '').trim();
  if (!t) return '';
  return /[.!?"'”’)]$/.test(t) ? t : `${t}.`;
}

/** Parses and sanitizes Claude's JSON. Throws on anything malformed. */
export function parsePatientReply(raw: string): PatientUtterance {
  const r = replySchema.parse(JSON.parse(raw));
  const text = finishSentence(stripStageDirections(r.text));
  if (!text) throw new Error('Reply had no spoken words');
  const u: PatientUtterance = {
    text,
    askedQuestion: r.askedQuestion,
    delivery: {
      ...r.delivery,
      pauseBeforeMs: Math.min(5000, Math.max(0, r.delivery.pauseBeforeMs)),
    },
    nonverbal: [...new Set(r.nonverbal)],
  };
  if (r.cueId) u.cueId = r.cueId;
  return u;
}
