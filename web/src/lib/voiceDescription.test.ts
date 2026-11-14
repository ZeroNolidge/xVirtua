import { describe, expect, it } from 'vitest';
import { plainVoiceDescription } from './voiceDescription';

describe('plainVoiceDescription', () => {
  it('keeps who the voice sounds like and drops the sales pitch', () => {
    expect(
      plainVoiceDescription('Confident, emotive British female for professional assistance'),
    ).toBe('Confident, emotive British female');
    expect(
      plainVoiceDescription('Approachable American female ideal for customer care and support'),
    ).toBe('American female');
    expect(plainVoiceDescription('Nice, young adult female for casual conversations')).toBe(
      'Nice, young adult female',
    );
    // No age or gender given: keep the tone words, just drop the pitch.
    expect(
      plainVoiceDescription('Cora offers a helpful and articulate tone, perfectly suited to', 'Cora'),
    ).toBe('Helpful and articulate tone');
    expect(plainVoiceDescription('Offers a friendly yet professional presence, perfect for')).toBe(
      'Friendly yet professional presence',
    );
  });
  it('empty stays empty', () => {
    expect(plainVoiceDescription('')).toBe('');
  });
});
