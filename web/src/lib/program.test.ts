import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  getDoc: async () => ({ get: (k: string) => (k === 'name' ? 'IRMC' : undefined) }),
}));
const { useProgramName } = await import('./program');

describe('useProgramName', () => {
  it('the id until the program loads, then its name', async () => {
    const { result } = renderHook(() => useProgramName('irmc'));
    expect(result.current).toBe('irmc');
    await act(async () => {});
    expect(result.current).toBe('IRMC');
  });
});
