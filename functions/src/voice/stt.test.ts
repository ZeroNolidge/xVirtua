import { describe, expect, it } from 'vitest';
import { clientSecretBody, MAX_STT_PROMPT, sttPrompt } from './stt.js';

describe('OpenAI transcription config', () => {
  it('keeps the jargon hint under the 1024-character API limit', () => {
    const p = sttPrompt();
    expect(p.length).toBeLessThanOrEqual(MAX_STT_PROMPT);
    expect(p).toContain('hypertension');
    expect(clientSecretBody().session.audio.input.transcription.prompt).toBe(p);
  });
});
