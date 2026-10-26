import { describe, expect, it, vi } from 'vitest';
import { ReplyPlayer, type VoiceRenderer } from './voiceRenderer';

describe('ReplyPlayer', () => {
  it('fetches a sentence’s voice that never arrived, instead of skipping it', async () => {
    const played: [string, boolean][] = [];
    const renderer = {
      stopped: false,
      play: async (b: Blob | null, text: string) => void played.push([text, !!b]),
      stopClip() {},
    } as unknown as VoiceRenderer;
    const p = new ReplyPlayer(renderer, () => undefined);
    const fill = vi.fn(async () => new Blob(['mp3']));
    p.fillVoice = fill;
    p.say(0, 'Under 130 over 80, got it.');
    p.audio(0, new Blob(['a']));
    p.say(1, 'What does too low feel like?');
    p.finish(); // its audio never came
    await p.run(0);
    expect(fill).toHaveBeenCalledWith('What does too low feel like?');
    expect(played).toEqual([
      ['Under 130 over 80, got it.', true],
      ['What does too low feel like?', true],
    ]);
    expect(p.noVoice).toEqual([]);
  });
});
