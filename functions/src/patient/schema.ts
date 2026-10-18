import { z } from 'zod';
import { EMOTIONS, NONVERBAL_CUES, type PatientUtterance } from '@plainspeak/shared';

/** JSON schema Claude must follow for every patient reply. */
export const PATIENT_REPLY_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['text', 'askedQuestion', 'cueId', 'delivery', 'nonverbal'],
  properties: {
    text: {
      type: 'string',
      description: 'Exactly what the patient says out loud. 1–3 short sentences.',
    },
    askedQuestion: {
      type: 'boolean',
      description: 'True if the patient asked the resident a question.',
    },
    cueId: {
      type: ['string', 'null'],
      description: 'The id of the scripted cue being performed this turn, or null.',
    },
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

/** Parses and sanitizes Claude's JSON. Throws on anything malformed. */
export function parsePatientReply(raw: string): PatientUtterance {
  const r = replySchema.parse(JSON.parse(raw));
  const u: PatientUtterance = {
    text: r.text,
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
