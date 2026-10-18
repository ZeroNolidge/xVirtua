import type { BrainRequest, BrainResult, PatientBrain } from './brain.js';
import { applyCue } from './brain.js';

/**
 * Offline stand-in for Claude, used only by tests and the local emulator
 * (never in production). Performs scripted cues verbatim; otherwise gives a
 * short generic reply.
 */
export class FakeBrain implements PatientBrain {
  calls: BrainRequest[] = [];
  async reply(req: BrainRequest): Promise<BrainResult> {
    this.calls.push(req);
    const base = {
      text: req.cue
        ? req.cue.performance.say
        : 'Okay. Can you tell me more about what that means for me?',
      askedQuestion: !req.cue,
      delivery: {
        emotion: 'neutral',
        volume: 'normal',
        rate: 'normal',
        pauseBeforeMs: 300,
      } as const,
      nonverbal: [],
    };
    const utterance = applyCue(base, req.cue);
    return {
      utterance,
      raw: JSON.stringify(utterance),
      model: `fake:${req.model}`,
      latencyMs: 1,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    };
  }
}
