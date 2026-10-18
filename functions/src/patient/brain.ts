import Anthropic from '@anthropic-ai/sdk';
import type { BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import {
  JsonStringFieldReader,
  parseJsonPrefix,
  stripStageDirections,
  type CueScriptEntry,
  type PatientModel,
  type PatientUtterance,
} from '@plainspeak/shared';
import { PATIENT_REPLY_JSON_SCHEMA, parsePatientReply } from './schema.js';

export interface BrainTurn {
  speaker: 'resident' | 'patient';
  /** Resident: the message sent to Claude. Patient: Claude's raw JSON. */
  content: string;
}

export interface BrainRequest {
  model: PatientModel;
  system: string;
  history: BrainTurn[];
  /** The new user message (resident text + optional director note). */
  message: string;
  cue: CueScriptEntry | null;
}

export interface BrainResult {
  utterance: PatientUtterance;
  raw: string;
  model: string;
  latencyMs: number;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

/**
 * Called with the patient's spoken words so far, as they stream in. `prefix`
 * holds the fields that arrived before the words (delivery, nonverbal).
 */
export type OnText = (textSoFar: string, prefix: Record<string, unknown> | null) => void;

export interface PatientBrain {
  reply(req: BrainRequest, onText?: OnText): Promise<BrainResult>;
}

/** Enforces the scripted cue even if the model drifted from the director note. */
export function applyCue(u: PatientUtterance, cue: CueScriptEntry | null): PatientUtterance {
  if (!cue) {
    const { cueId: _drop, ...rest } = u;
    return rest;
  }
  const d = cue.performance.delivery;
  return {
    ...u,
    cueId: cue.id,
    delivery: {
      emotion: d.emotion ?? u.delivery.emotion,
      volume: d.volume ?? u.delivery.volume,
      rate: d.rate ?? u.delivery.rate,
      pauseBeforeMs: d.pauseBeforeMs ?? u.delivery.pauseBeforeMs,
    },
    nonverbal: cue.performance.nonverbal.length ? [...cue.performance.nonverbal] : u.nonverbal,
  };
}

const NEUTRAL: PatientUtterance['delivery'] = {
  emotion: 'neutral',
  volume: 'normal',
  rate: 'normal',
  pauseBeforeMs: 0,
};

export class ClaudeBrain implements PatientBrain {
  private client: Anthropic;
  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey, maxRetries: 2, timeout: 30_000 });
  }

  async reply(req: BrainRequest, onText?: OnText): Promise<BrainResult> {
    const messages: BetaMessageParam[] = req.history.map((t) => ({
      role: t.speaker === 'resident' ? 'user' : 'assistant',
      content: t.content,
    }));
    messages.push({
      role: 'user',
      // Rolling cache breakpoint on the newest turn keeps long conversations cheap.
      content: [{ type: 'text', text: req.message, cache_control: { type: 'ephemeral' } }],
    });

    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      const t0 = Date.now();
      const reader = new JsonStringFieldReader('text');
      let spoke = false;
      const stream = this.client.beta.messages.stream({
        model: req.model,
        max_tokens: 2000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
        messages,
        output_config: {
          // Short in-character replies: low effort keeps latency down.
          effort: 'low',
          format: {
            type: 'json_schema',
            schema: PATIENT_REPLY_JSON_SCHEMA as unknown as Record<string, unknown>,
          },
        },
      });
      if (onText) {
        stream.on('text', (delta) => {
          const before = reader.value;
          const now = reader.push(delta);
          if (now !== before) {
            spoke = true;
            onText(now, parseJsonPrefix(reader.before));
          }
        });
      }
      let res;
      try {
        res = await stream.finalMessage();
      } catch (e) {
        // Once words have been spoken we can't retry without repeating them.
        if (spoke) throw e;
        lastErr = e;
        continue;
      }
      const latencyMs = Date.now() - t0;
      const usage = {
        input: res.usage.input_tokens,
        output: res.usage.output_tokens,
        cacheRead: res.usage.cache_read_input_tokens ?? 0,
        cacheWrite: res.usage.cache_creation_input_tokens ?? 0,
      };
      const raw = res.content
        .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
        .map((b) => b.text)
        .join('');
      let utterance: PatientUtterance | null = null;
      if (res.stop_reason !== 'refusal') {
        try {
          utterance = parsePatientReply(raw);
        } catch (e) {
          lastErr = e;
        }
      } else {
        lastErr = new Error('Model declined this turn');
      }
      // If the JSON broke after words were already spoken, keep those words.
      const spoken = stripStageDirections(reader.value);
      if (!utterance && spoke && spoken) {
        utterance = {
          text: spoken,
          askedQuestion: /\?\s*$/.test(spoken),
          delivery: NEUTRAL,
          nonverbal: [],
        };
      }
      if (!utterance) continue;
      const final = applyCue(utterance, req.cue);
      return { utterance: final, raw: JSON.stringify(final), model: res.model, latencyMs, usage };
    }
    throw lastErr instanceof Error ? lastErr : new Error('Patient reply failed');
  }
}
