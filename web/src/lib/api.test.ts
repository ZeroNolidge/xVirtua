import { describe, expect, it, vi } from 'vitest';

vi.mock('./firebase', () => ({ functions: {}, auth: {}, db: {} }));
const { friendlyError, isConnectionError } = await import('./api');

describe('isConnectionError', () => {
  it('spots an answer lost to a dropped signal', () => {
    expect(isConnectionError({ code: 'functions/internal', message: 'internal' })).toBe(true);
    expect(isConnectionError({ code: 'functions/internal', message: 'internal [0]' })).toBe(true);
    expect(friendlyError({ code: 'functions/internal', message: 'internal' })).toMatch(
      /Lost the connection/,
    );
  });
  it('leaves real server errors alone', () => {
    const e = { code: 'functions/unavailable', message: 'Feedback isn’t available right now.' };
    expect(isConnectionError(e)).toBe(false);
    expect(friendlyError(e)).toBe('Feedback isn’t available right now.');
  });
});
