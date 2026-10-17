import { useEffect, useState } from 'react';
import { collection, doc, getDoc, onSnapshot, query, where } from 'firebase/firestore';
import type { ScenarioBriefing, ScenarioDoc, ScenarioScript } from '@plainspeak/shared';
import { db } from './firebase';
import type { UserClaims } from '@plainspeak/shared';

export type ScenarioRow = ScenarioDoc & { id: string };

/** Residents see active scenarios; faculty also see drafts (not archived). */
export function useScenarioList(claims: UserClaims | null): ScenarioRow[] | null {
  const [rows, setRows] = useState<ScenarioRow[] | null>(null);
  useEffect(() => {
    if (!claims) return;
    const col = collection(db, 'scenarios');
    const q =
      claims.role === 'faculty'
        ? query(col, where('programId', '==', claims.programId))
        : query(col, where('programId', '==', claims.programId), where('status', '==', 'active'));
    return onSnapshot(
      q,
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as ScenarioDoc) }))
          .filter((s) => s.status !== 'archived')
          .sort((a, b) => a.difficulty - b.difficulty || a.title.localeCompare(b.title));
        setRows(list);
      },
      () => setRows([]),
    );
  }, [claims]);
  return rows;
}

export interface ScenarioDetail {
  summary: ScenarioRow;
  briefing: ScenarioBriefing;
  /** Faculty only. */
  script: ScenarioScript | null;
}

export function useScenario(id: string | undefined, isFaculty: boolean) {
  const [state, setState] = useState<{ detail: ScenarioDetail | null; status: 'loading' | 'ok' | 'missing' }>({
    detail: null,
    status: 'loading',
  });
  useEffect(() => {
    if (!id) return;
    return onSnapshot(
      doc(db, 'scenarios', id),
      async (snap) => {
        if (!snap.exists()) return setState({ detail: null, status: 'missing' });
        const summary = { id: snap.id, ...(snap.data() as ScenarioDoc) };
        const vRef = doc(db, 'scenarios', id, 'versions', summary.currentVersion);
        try {
          const [v, p] = await Promise.all([
            getDoc(vRef),
            isFaculty ? getDoc(doc(vRef, 'private', 'script')) : Promise.resolve(null),
          ]);
          if (!v.exists()) return setState({ detail: null, status: 'missing' });
          setState({
            status: 'ok',
            detail: {
              summary,
              briefing: v.data() as ScenarioBriefing,
              script: p?.exists() ? (p.data() as ScenarioScript) : null,
            },
          });
        } catch {
          setState({ detail: null, status: 'missing' });
        }
      },
      () => setState({ detail: null, status: 'missing' }),
    );
  }, [id, isFaculty]);
  return state;
}
