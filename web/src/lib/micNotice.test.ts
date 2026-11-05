import { describe, expect, it } from 'vitest';
import { afterMicOpened, micIndicator, NO_MIC_NOTICE } from './micNotice';

describe('one mic state on screen', () => {
  it('no mic: no "Mic ready" under the alert', () => {
    expect(micIndicator(false, NO_MIC_NOTICE, false)).toBeNull();
    expect(micIndicator(true, null, false)).toBeNull(); // typing
  });
  it('mic working: the indicator shows', () => {
    expect(micIndicator(false, null, false)).toBe('○ Mic ready');
    expect(micIndicator(false, 'Five minutes left.', true)).toBe('● Mic on');
  });
  it('the mic opens after all: the alert goes, other notices stay', () => {
    expect(afterMicOpened(NO_MIC_NOTICE)).toBeNull();
    expect(afterMicOpened('Five minutes left.')).toBe('Five minutes left.');
  });
});
