/**
 * App Check debug mode for a test browser: open the app once with
 * ?appcheck-debug=1 and this browser gets its own debug token (kept in
 * localStorage). Register that token in the Firebase console (App Check →
 * Manage debug tokens) and the browser passes App Check without reCAPTCHA.
 * ?appcheck-debug=0 turns it off and forgets the token. Normal users never
 * see or get any of this.
 */
export const DEBUG_FLAG_KEY = 'ps.appCheckDebug';
export const DEBUG_TOKEN_KEY = 'ps.appCheckDebugToken';
const PARAM = 'appcheck-debug';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const safe = {
  get(s: Store | null, k: string): string | null {
    try {
      return s?.getItem(k) ?? null;
    } catch {
      return null;
    }
  },
  set(s: Store | null, k: string, v: string) {
    try {
      s?.setItem(k, v);
    } catch {
      // Storage blocked (private mode): debug mode just won't stick.
    }
  },
  remove(s: Store | null, k: string) {
    try {
      s?.removeItem(k);
    } catch {
      // As above.
    }
  },
};

function defaultStore(): Store | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Reads ?appcheck-debug (and strips it from the address bar), then returns
 * this browser's debug token when debug mode is on, else null.
 */
export function setupAppCheckDebug(
  loc: Pick<Location, 'href'> = window.location,
  hist: Pick<History, 'replaceState' | 'state'> = window.history,
  store: Store | null = defaultStore(),
  newToken: () => string = () => crypto.randomUUID(),
): string | null {
  let url: URL | null = null;
  try {
    url = new URL(loc.href);
  } catch {
    url = null;
  }
  const asked = url?.searchParams.get(PARAM);
  if (url && asked !== null && asked !== undefined) {
    if (asked === '1') safe.set(store, DEBUG_FLAG_KEY, '1');
    if (asked === '0') {
      safe.remove(store, DEBUG_FLAG_KEY);
      safe.remove(store, DEBUG_TOKEN_KEY);
    }
    url.searchParams.delete(PARAM);
    try {
      hist.replaceState(hist.state, '', url.pathname + url.search + url.hash);
    } catch {
      // Couldn't tidy the address bar; harmless.
    }
  }
  if (safe.get(store, DEBUG_FLAG_KEY) !== '1') return null;
  let token = safe.get(store, DEBUG_TOKEN_KEY);
  if (!token) {
    token = newToken();
    safe.set(store, DEBUG_TOKEN_KEY, token);
  }
  return token;
}

let current: string | null = null;

/** firebase.ts records the token it gave App Check (null: debug mode off). */
export function rememberAppCheckDebugToken(token: string | null) {
  current = token;
}

/** For the debug bar: is debug mode on, and this browser's token. */
export function appCheckDebugInfo(): { on: boolean; token: string | null } {
  return { on: current !== null, token: current };
}
