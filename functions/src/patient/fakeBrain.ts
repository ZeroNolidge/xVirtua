import type { BrainRequest, BrainResult, OnText, PatientBrain } from './brain.js';
import { applyCue } from './brain.js';

/**
 * Offline stand-in for Claude, used only by tests and the local emulator
 * (never in production). Performs scripted cues verbatim; otherwise gives a
 * short generic reply.
 */
export class FakeBrain implements PatientBrain {
  calls: BrainRequest[] = [];
  async reply(req: BrainRequest, onText?: OnText): Promise<BrainResult> {
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
    if (onText) {
      // Stream word by word, like the real model.
      const words = utterance.text.split(' ');
      const prefix = { delivery: utterance.delivery, nonverbal: utterance.nonverbal };
      for (let i = 1; i <= words.length; i++) onText(words.slice(0, i).join(' '), prefix);
    }
    return {
      utterance,
      raw: JSON.stringify(utterance),
      model: `fake:${req.model}`,
      latencyMs: 1,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    };
  }
}
