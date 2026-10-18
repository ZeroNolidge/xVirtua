import type { Timestamp } from 'firebase/firestore';
import { SESSION_LIMITS } from '@plainspeak/shared';

export interface SessionRow {
  uid: string;
  status: 'live' | 'ended';
  scenarioId: string;
  scenarioVersion: string;
  scenarioTitle?: string;
  persona?: { name: string; age: number; pronouns: string };
  turnCount: number;
  startedAt?: Timestamp;
  lastActivityAt?: Timestamp;
  durationSec?: number;
  appWaitSec?: number;
  audioPath?: string | null;
}

/** Whether a saved conversation can still take turns (mirrors the server's limits). */
export function canContinue(s: SessionRow, now = Date.now()): boolean {
  if (s.status !== 'live' || !s.startedAt) return false;
  if (s.turnCount >= SESSION_LIMITS.maxResidentTurns * 2) return false;
  if (now - s.startedAt.toMillis() > SESSION_LIMITS.maxMinutes * 60000) return false;
  const last = (s.lastActivityAt ?? s.startedAt).toMillis();
  return now - last <= SESSION_LIMITS.idleMinutes * 60000;
}
