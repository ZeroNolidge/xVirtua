import type { Firestore } from 'firebase-admin/firestore';
import type { ScenarioBriefing, ScenarioDoc, ScenarioScript } from '@plainspeak/shared';

export interface LoadedScenario {
  id: string;
  doc: ScenarioDoc;
  version: string;
  briefing: ScenarioBriefing;
  script: ScenarioScript;
}

// Versions are immutable, so caching them per instance is safe.
const cache = new Map<string, { briefing: ScenarioBriefing; script: ScenarioScript }>();

export async function loadScenario(
  db: Firestore,
  id: string,
  version?: string,
): Promise<LoadedScenario | null> {
  const snap = await db.doc(`scenarios/${id}`).get();
  if (!snap.exists) return null;
  const doc = snap.data() as ScenarioDoc;
  const v = version ?? doc.currentVersion;
  const key = `${id}@${v}`;
  let content = cache.get(key);
  if (!content) {
    const vRef = db.doc(`scenarios/${id}/versions/${v}`);
    const [vs, ps] = await Promise.all([
      vRef.get(),
      vRef.collection('private').doc('script').get(),
    ]);
    if (!vs.exists || !ps.exists) return null;
    content = { briefing: vs.data() as ScenarioBriefing, script: ps.data() as ScenarioScript };
    cache.set(key, content);
  }
  return { id, doc, version: v, ...content };
}
