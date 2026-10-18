import { describe, expect, it } from 'vitest';
import {
  assertEphemeral,
  clientSecretBody,
  MAX_STT_PROMPT,
  STT_KEY_TTL_SECONDS,
  sttPrompt,
} from './stt.js';

describe('OpenAI transcription config', () => {
  it('keeps the jargon hint under the 1024-character API limit', () => {
    const p = sttPrompt();
    expect(p.length).toBeLessThanOrEqual(MAX_STT_PROMPT);
    expect(p).toContain('hypertension');
    expect(clientSecretBody().session.audio.input.transcription.prompt).toBe(p);
  });
});

describe('speech key sent to the browser', () => {
  it('is transcription-only and expires within a minute', () => {
    const b = clientSecretBody();
    expect(b.session.type).toBe('transcription');
    expect(b.expires_after).toEqual({ anchor: 'created_at', seconds: STT_KEY_TTL_SECONDS });
    expect(STT_KEY_TTL_SECONDS).toBeLessThanOrEqual(60);
  });

  it('is never the real API key', () => {
    expect(() => assertEphemeral('ek_abc123', 'sk-proj-real')).not.toThrow();
    expect(() => assertEphemeral('sk-proj-real', 'sk-proj-real')).toThrow();
    expect(() => assertEphemeral('sk-other', 'sk-proj-real')).toThrow();
  });
});
