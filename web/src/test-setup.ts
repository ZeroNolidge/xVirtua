import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => cleanup());

// Most conversation tests read the words on screen, so captions start on.
// (Tests of the captions-off default clear this.)
import { beforeEach } from 'vitest';
beforeEach(() => {
  window.localStorage.setItem('plainspeak.captions', 'on');
});
