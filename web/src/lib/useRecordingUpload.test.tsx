import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./auth', () => ({ useAuth: () => ({ claims: null, user: null }) }));
vi.mock('./errorReport', () => ({ reportError: vi.fn() }));
vi.mock('./recording', () => ({ uploadRecording: vi.fn() }));
const { freshPage } = await import('./freshPage');
const { useRecordingUpload } = await import('./useRecordingUpload');

describe('after a conversation ends', () => {
  it('opens the feedback as a fresh page load (old audio routing doesn’t carry over)', async () => {
    const open = vi.spyOn(freshPage, 'open').mockImplementation(() => {});
    const { result } = renderHook(() => useRecordingUpload('s1'));
    await act(async () => result.current.save(null, 'webm'));
    expect(open).toHaveBeenCalledWith('/session/s1/done');
    open.mockClear();
    act(() => result.current.skip());
    expect(open).toHaveBeenCalledWith('/session/s1/done');
    open.mockRestore();
  });
});
