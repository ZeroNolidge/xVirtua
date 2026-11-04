import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import type { PatientProgress } from '@plainspeak/shared';
import { db } from './firebase';

/** Their best with each patient (userProgress/{uid}.scenarios), live. */
export function usePatientProgress(uid: string | undefined) {
  const [byScenario, setByScenario] = useState<Record<string, PatientProgress> | null>(null);
  useEffect(() => {
    if (!uid) return;
    return onSnapshot(
      doc(db, 'userProgress', uid),
      (s) => setByScenario((s.get('scenarios') as Record<string, PatientProgress>) ?? {}),
      () => setByScenario({}),
    );
  }, [uid]);
  return byScenario;
}
