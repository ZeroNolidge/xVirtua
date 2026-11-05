import { describe, expect, it, vi } from 'vitest';
import { DEBUG_FLAG_KEY, DEBUG_TOKEN_KEY, setupAppCheckDebug } from './appCheckDebug';

function memoryStore() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    m,
  };
}
const page = (href: string) => {
  const hist = { state: null, replaceState: vi.fn() };
  return { loc: { href }, hist };
};

describe('App Check debug mode', () => {
  it('is off for normal visits', () => {
    const store = memoryStore();
    const { loc, hist } = page('https://x.web.app/progress');
    expect(setupAppCheckDebug(loc, hist, store, () => 'tok')).toBeNull();
    expect(hist.replaceState).not.toHaveBeenCalled();
    expect(store.m.size).toBe(0);
  });

  it('?appcheck-debug=1 turns it on, strips the param, and keeps one token across loads', () => {
    const store = memoryStore();
    const first = page('https://x.web.app/progress?appcheck-debug=1&tab=a#top');
    const make = vi.fn(() => 'token-1');
    expect(setupAppCheckDebug(first.loc, first.hist, store, make)).toBe('token-1');
    expect(first.hist.replaceState).toHaveBeenCalledWith(null, '', '/progress?tab=a#top');
    expect(store.getItem(DEBUG_FLAG_KEY)).toBe('1');
    // A later load, no param: same token, no new one made.
    const later = page('https://x.web.app/');
    expect(setupAppCheckDebug(later.loc, later.hist, store, make)).toBe('token-1');
    expect(make).toHaveBeenCalledTimes(1);
    expect(later.hist.replaceState).not.toHaveBeenCalled();
  });

  it('?appcheck-debug=0 turns it off and forgets the token', () => {
    const store = memoryStore();
    store.setItem(DEBUG_FLAG_KEY, '1');
    store.setItem(DEBUG_TOKEN_KEY, 'old');
    const p = page('https://x.web.app/?appcheck-debug=0');
    expect(setupAppCheckDebug(p.loc, p.hist, store, () => 'new')).toBeNull();
    expect(p.hist.replaceState).toHaveBeenCalledWith(null, '', '/');
    expect(store.m.size).toBe(0);
  });

  it('never throws when storage is blocked', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    const p = page('https://x.web.app/?appcheck-debug=1');
    expect(setupAppCheckDebug(p.loc, p.hist, blocked, () => 't')).toBeNull();
  });
});
