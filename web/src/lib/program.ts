import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';

const names = new Map<string, string>();

/** The program's display name ("IRMC"), from its document; the id until it loads. */
export function useProgramName(programId: string | undefined): string {
  const [name, setName] = useState(() => (programId && names.get(programId)) || programId || '');
  useEffect(() => {
    if (!programId) return;
    if (names.has(programId)) return setName(names.get(programId)!);
    let live = true;
    Promise.resolve()
      .then(() => getDoc(doc(db, 'programs', programId)))
      .then((s) => {
        const n = s.get('name');
        if (typeof n === 'string' && n.trim()) {
          names.set(programId, n.trim());
          if (live) setName(n.trim());
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [programId]);
  return name;
}
