import Anthropic from '@anthropic-ai/sdk';
import type { CueScriptEntry, ScenarioBriefing, ScenarioScript } from '@plainspeak/shared';

/**
 * GPT-Live steer mode: after each exchange, Claude reads the conversation and
 * writes one private note for the patient's next reply (or none). GPT-Live
 * keeps answering at once; the note steers it toward the script.
 */
export interface Director {
  note(input: DirectorInput): Promise<string | null>;
}

export interface DirectorInput {
  briefing: ScenarioBriefing;
  script: ScenarioScript;
  /** The conversation so far, oldest first. */
  transcript: { speaker: 'resident' | 'patient'; text: string }[];
  /** A scripted cue the patient should perform next, if one fired. */
  cue: CueScriptEntry | null;
}

export const DIRECTOR_MODEL = 'claude-haiku-5-5';

export function directorPrompt(i: DirectorInput): { system: string; user: string } {
  const first = i.briefing.persona.name.split(' ')[0] ?? 'The patient';
  const system = `You direct an actor playing ${i.briefing.persona.name}, a patient in a communication practice scenario for doctors in training. Another system voices ${first} and answers the doctor right away. After each exchange you may give the actor ONE short private note (at most 30 words) for ${first}'s next reply, so the scene follows the script. Return null when no note is needed (most turns).

The script:
- Hidden concern: ${i.script.hiddenConcern}
  ${first} keeps it back at first, hints at it once the doctor builds trust, asks an open question about worries, or shows empathy, and shares it fully when asked directly and kindly.
- What ${first} knows: ${i.script.patientKnows.join('; ')}
- How ${first} feels: ${i.script.emotionalState}

Write a note when: the doctor just gave an opening for the hidden concern that ${first} didn't take; a scripted cue (given below) should happen next; ${first} is repeating an earlier story or drifting out of character; or ${first} seemed to understand jargon the patient wouldn't know. Never script medical facts, never tell the actor to explain medicine, and don't repeat a note that's already been followed.`;
  const lines = i.transcript
    .slice(-16)
    .map((t) => `${t.speaker === 'resident' ? 'DOCTOR' : first.toUpperCase()}: ${t.text}`)
    .join('\n');
  const cue = i.cue
    ? `\n\nScripted cue to perform in the next reply: ${i.cue.cue}. Line to convey (in ${first}'s own words): "${i.cue.performance.say}". If ${first} already said this earlier, don't ask for it again.`
    : '';
  return { system, user: `Conversation so far:\n${lines}${cue}\n\nYour note (or null):` };
}

const NOTE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['note'],
  properties: { note: { type: ['string', 'null'] } },
} as const;

export class ClaudeDirector implements Director {
  private client: Anthropic;
  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey, maxRetries: 1, timeout: 15_000 });
  }

  async note(i: DirectorInput): Promise<string | null> {
    const p = directorPrompt(i);
    const res = await this.client.beta.messages.create({
      model: DIRECTOR_MODEL,
      max_tokens: 300,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: p.system,
      messages: [{ role: 'user', content: p.user }],
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: NOTE_SCHEMA as unknown as Record<string, unknown> },
      },
    });
    const raw = res.content
      .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
      .map((b) => b.text)
      .join('');
    const note = (JSON.parse(raw) as { note: string | null }).note?.trim();
    return note ? note.slice(0, 400) : null;
  }
}

/** Offline stand-in: passes a fired cue straight through. */
export class FakeDirector implements Director {
  readonly calls: DirectorInput[] = [];
  async note(i: DirectorInput) {
    this.calls.push(i);
    return i.cue ? `Next, in your own words: ${i.cue.performance.say}` : null;
  }
}
