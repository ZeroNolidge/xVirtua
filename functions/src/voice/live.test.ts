import { describe, expect, it } from 'vitest';
import { SEED_SCENARIOS } from '@plainspeak/shared/seed';
import { answerSdp, buildLiveInstructions, liveVoiceOf } from './live.js';

describe('GPT-Live', () => {
  it('finds the SDP answer wherever the API puts it', () => {
    expect(answerSdp({ transport: { sdp: 'v=0 a' } }, '')).toBe('v=0 a');
    expect(answerSdp({ sdp: 'v=0 b' }, '')).toBe('v=0 b');
    expect(answerSdp(null, 'v=0 raw')).toBe('v=0 raw');
    expect(answerSdp({ id: 'x' }, '{"id":"x"}')).toBeNull();
  });

  it('falls back to the default voice for unknown ones', () => {
    expect(liveVoiceOf('cinder')).toBe('cinder');
    expect(liveVoiceOf('alloy')).toBe('marin');
    expect(liveVoiceOf(undefined)).toBe('marin');
  });

  it('tells GPT-Live to voice our lines and always delegate, without the hidden script', () => {
    const s = SEED_SCENARIOS[0]!;
    const p = buildLiveInstructions(s.briefing, s.script);
    expect(p).toContain(s.briefing.persona.name);
    expect(p).toContain('Delegate to the backend when');
    expect(p).toContain('never say the note aloud');
    expect(p).not.toContain(s.script.hiddenConcern);
    for (const k of s.script.patientKnows) expect(p).not.toContain(k);
  });
});
