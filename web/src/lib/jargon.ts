import { useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { SEED_JARGON, type JargonTerm } from '@plainspeak/shared';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from './firebase';

let cache: JargonTerm[] | null = null;

const SEED_BY_ID = new Map(SEED_JARGON.map((t) => [t.id, t]));

/**
 * A built-in entry copied into the database: show the app's current wording
 * (e.g. "BP", not an older "bp"), so wording fixes don't wait for a reseed.
 */
export function withSeedWording(id: string, data: unknown): JargonTerm {
  const t = data as JargonTerm & { seeded?: boolean };
  const seed = t.seeded ? SEED_BY_ID.get(id) : undefined;
  return seed ? { ...t, term: seed.term, plain: seed.plain } : t;
}

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
        for (const d of [...global.docs, ...local.docs])
          byId.set(d.id, withSeedWording(d.id, d.data()));
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

export interface ServerAnswer {
  term: string;
  plain: string[];
  explanation: string;
}

const lookupFn = httpsCallable<{ term: string }, { result: ServerAnswer | null }>(
  functions,
  'lookupPlainWords',
);
const answers = new Map<string, ServerAnswer | null>();

/** Server fallback for words the built-in dictionary doesn't have. Cached per page load. */
export async function lookupOnServer(term: string): Promise<ServerAnswer | null> {
  const key = term.toLowerCase();
  if (answers.has(key)) return answers.get(key) ?? null;
  const { data } = await lookupFn({ term });
  answers.set(key, data.result);
  return data.result;
}
