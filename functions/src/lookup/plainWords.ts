import Anthropic from '@anthropic-ai/sdk';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { normalize, slugify } from '@plainspeak/shared';
import { parse, type Caller } from '../lib/callable.js';
import { consumeQuota } from '../lib/quota.js';

export const LOOKUP_MODEL = 'claude-haiku-5-5';

export interface PlainWordAnswer {
  term: string;
  plain: string[];
  explanation: string;
  isMedical: boolean;
  source: 'ai';
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['isMedical', 'plain', 'explanation'],
  properties: {
    isMedical: { type: 'boolean', description: 'False if this is not a medical or health term.' },
    plain: {
      type: 'array',
      items: { type: 'string' },
      description: '1 to 3 everyday words or short phrases a doctor could say instead.',
    },
    explanation: {
      type: 'string',
      description: 'One plain sentence (under 25 words) a patient would understand.',
    },
  },
} as const;

const answer = z.object({
  isMedical: z.boolean(),
  plain: z.array(z.string().trim().min(1).max(80)).max(3),
  explanation: z.string().trim().max(300),
});

const input = z.object({ term: z.string().trim().min(2).max(60) });

export type AskPlainWords = (term: string) => Promise<z.infer<typeof answer>>;

export function claudePlainWords(apiKey: string): AskPlainWords {
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 15_000 });
  return async (term) => {
    const res = await client.messages.create({
      model: LOOKUP_MODEL,
      max_tokens: 400,
      system:
        'You help family medicine residents swap medical jargon for plain words patients understand (about a 6th-grade reading level). Be accurate and brief.',
      messages: [{ role: 'user', content: `Medical word or phrase: "${term.replace(/"/g, '')}"` }],
      output_config: {
        format: { type: 'json_schema', schema: SCHEMA as unknown as Record<string, unknown> },
      },
    });
    const raw = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
    return answer.parse(JSON.parse(raw));
  };
}

/**
 * Fallback for the plain-words lookup when a word isn't in the dictionary.
 * The app searches its built-in dictionary first; this is only called when
 * that finds nothing. Answers are cached for everyone.
 */
export async function lookupPlainWords(
  db: Firestore,
  caller: Caller | null,
  data: unknown,
  ask: AskPlainWords,
): Promise<{ result: PlainWordAnswer | null }> {
  if (!caller?.claims.programId) throw new HttpsError('unauthenticated', 'Please sign in.');
  const { term } = parse(input, data);
  const key = slugify(normalize(term)).slice(0, 80);
  if (!key) return { result: null };
  const cacheRef = db.doc(`plainWordCache/${key}`);
  const cached = await cacheRef.get();
  if (cached.exists) return { result: (cached.data()!.result as PlainWordAnswer | null) ?? null };

  await consumeQuota(db, caller.uid, 'lookups');
  let a: z.infer<typeof answer>;
  try {
    a = await ask(term);
  } catch (e) {
    console.error('plain words lookup failed', e);
    throw new HttpsError('unavailable', 'Lookup is unavailable right now.');
  }
  const result: PlainWordAnswer | null =
    a.isMedical && a.plain.length
      ? { term, plain: a.plain, explanation: a.explanation, isMedical: true, source: 'ai' }
      : null;
  await cacheRef.set({ result, model: LOOKUP_MODEL, createdAt: FieldValue.serverTimestamp() });
  return { result };
}
