import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';
import { useAuth } from './auth';

const KEY = 'plainspeak.captions';

function stored(): boolean | null {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === 'on' ? true : v === 'off' ? false : null;
  } catch {
    return null;
  }
}

/**
 * Captions (the live transcript) during a conversation. Off by default, like
 * a real visit; the program can turn them on by default, and each phone
 * remembers its own choice.
 */
export function useCaptions(): [boolean, () => void] {
  const { claims } = useAuth();
  const [mine, setMine] = useState<boolean | null>(stored);
  const [programDefault, setProgramDefault] = useState(false);
  useEffect(() => {
    if (mine !== null || !claims?.programId) return;
    let live = true;
    Promise.resolve()
      .then(() => getDoc(doc(db, 'programs', claims.programId)))
      .then((s) => live && setProgramDefault(s.get('captionsDefault') === true))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [mine, claims?.programId]);
  const on = mine ?? programDefault;
  const toggle = () => {
    const next = !on;
    setMine(next);
    try {
      window.localStorage.setItem(KEY, next ? 'on' : 'off');
    } catch {
      // Private mode: the choice lasts for this visit.
    }
  };
  return [on, toggle];
}
