import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  type RulesTestContext,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';

export const PROJECT_ID = 'demo-plainspeak';

export async function makeEnv(): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
    storage: { rules: readFileSync('storage.rules', 'utf8'), host: '127.0.0.1', port: 9199 },
  });
}

/** Cast of characters used across the rules tests. */
export function actors(env: RulesTestEnvironment) {
  return {
    anon: env.unauthenticatedContext(),
    /** Signed in but never claimed an invite: no role/program claims. */
    noClaims: env.authenticatedContext('stranger'),
    resA: env.authenticatedContext('resA', { role: 'resident', programId: 'irmc' }),
    resB: env.authenticatedContext('resB', { role: 'resident', programId: 'irmc' }),
    facultyIrmc: env.authenticatedContext('facIrmc', { role: 'faculty', programId: 'irmc' }),
    facultyOther: env.authenticatedContext('facOther', { role: 'faculty', programId: 'other' }),
    /** Claims with a bogus role (e.g. a forged/old token). */
    badRole: env.authenticatedContext('hacker', { role: 'admin', programId: 'irmc' }),
  } satisfies Record<string, RulesTestContext>;
}
