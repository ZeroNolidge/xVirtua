import { useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { SEED_JARGON, type JargonTerm } from '@plainspeak/shared';
import { db } from './firebase';

let cache: JargonTerm[] | null = null;

/**
 * The dictionary for lookup. Starts with the bundled seed list so search is
 * instant (and works offline), then swaps in the program's live list.
 */
export function useJargonTerms(programId: string | undefined): JargonTerm[] {
  const [terms, setTerms] = useState<JargonTerm[]>(cache ?? SEED_JARGON);
  useEffect(() => {
    if (!programId || cache) return;
    let cancelled = false;
    const col = collection(db, 'jargonTerms');
    Promise.all([
      getDocs(query(col, where('programId', '==', null))),
      getDocs(query(col, where('programId', '==', programId))),
    ])
      .then(([global, local]) => {
        const byId = new Map<string, JargonTerm>();
        for (const d of [...global.docs, ...local.docs]) byId.set(d.id, d.data() as JargonTerm);
        if (byId.size === 0) return; // not seeded yet: keep the bundled list
        cache = [...byId.values()];
        if (!cancelled) setTerms(cache);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [programId]);
  return terms;
}
