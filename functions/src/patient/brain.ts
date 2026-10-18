import Anthropic from '@anthropic-ai/sdk';
import type { BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { CueScriptEntry, PatientModel, PatientUtterance } from '@plainspeak/shared';
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

export interface PatientBrain {
  reply(req: BrainRequest): Promise<BrainResult>;
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

export class ClaudeBrain implements PatientBrain {
  private client: Anthropic;
  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey, maxRetries: 2, timeout: 30_000 });
  }

  async reply(req: BrainRequest): Promise<BrainResult> {
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
      const res = await this.client.beta.messages.create({
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
      const latencyMs = Date.now() - t0;
      if (res.stop_reason === 'refusal') {
        lastErr = new Error('Model declined this turn');
        continue;
      }
      const raw = res.content
        .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
        .map((b) => b.text)
        .join('');
      try {
        const utterance = applyCue(parsePatientReply(raw), req.cue);
        return {
          utterance,
          raw: JSON.stringify(utterance),
          model: res.model,
          latencyMs,
          usage: {
            input: res.usage.input_tokens,
            output: res.usage.output_tokens,
            cacheRead: res.usage.cache_read_input_tokens ?? 0,
            cacheWrite: res.usage.cache_creation_input_tokens ?? 0,
          },
        };
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('Patient reply failed');
  }
}
