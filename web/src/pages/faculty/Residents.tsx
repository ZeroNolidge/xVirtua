import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, onSnapshot, query, where, type Timestamp } from 'firebase/firestore';
import { neverStarted } from '../../lib/resume';
import { db } from '../../lib/firebase';
import { useAuth } from '../../lib/auth';
import { useScenarioList } from '../../lib/scenarios';

interface Person {
  uid: string;
  displayName?: string;
  email: string;
  role: string;
}
interface SessionLite {
  id: string;
  uid: string;
  scenarioId?: string;
  status: 'live' | 'ended';
  startedAt?: Timestamp;
  durationSec?: number;
  appWaitSec?: number;
  feedbackBand?: string | null;
  turnCount?: number;
}

export interface ResidentSummary {
  uid: string;
  name: string;
  email: string;
  conversations: number;
  minutes: number;
  lastActive: Date | null;
  /** The band of their latest scored conversation (in the range). */
  latestBand: string | null;
}

type Range = 'all' | '30' | '7' | 'from';
const DAY = 24 * 3600 * 1000;
/** No conversation for this long counts as needing attention. */
export const INACTIVE_DAYS = 14;
const BELOW_SOLID = new Set(['Just starting', 'Getting there']);

/** Everyone in the program (residents only are listed). */
function usePeople(programId: string | undefined) {
  const [people, setPeople] = useState<Person[] | null>(null);
  useEffect(() => {
    if (!programId) return;
    const q = query(collection(db, 'users'), where('programId', '==', programId));
    return onSnapshot(
      q,
      (snap) =>
        setPeople(
          snap.docs
            .map((d) => ({ uid: d.id, ...(d.data() as Omit<Person, 'uid'>) }))
            .filter((p) => p.role === 'resident'),
        ),
      () => setPeople([]),
    );
  }, [programId]);
  return people;
}

/** Every conversation in the program (sorted here: no extra index needed). */
function useProgramSessions(programId: string | undefined) {
  const [rows, setRows] = useState<SessionLite[] | null>(null);
  useEffect(() => {
    if (!programId) return;
    const q = query(collection(db, 'sessions'), where('programId', '==', programId));
    return onSnapshot(
      q,
      (snap) =>
        setRows(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<SessionLite, 'id'>) }))),
      () => setRows([]),
    );
  }, [programId]);
  return rows;
}

/** One row per resident, from the conversations in the range (and patient). */
export function summarize(
  people: Person[],
  sessions: SessionLite[],
  since: number,
  scenarioId: string | null,
  now = Date.now(),
): ResidentSummary[] {
  const by = new Map<string, SessionLite[]>();
  for (const s of sessions) {
    if (s.status !== 'ended' || neverStarted(s, now)) continue;
    if ((s.startedAt?.toMillis() ?? 0) < since) continue;
    if (scenarioId && s.scenarioId !== scenarioId) continue;
    if (!by.has(s.uid)) by.set(s.uid, []);
    by.get(s.uid)!.push(s);
  }
  return people
    .map((p) => {
      const mine = (by.get(p.uid) ?? []).sort(
        (a, b) => (b.startedAt?.toMillis() ?? 0) - (a.startedAt?.toMillis() ?? 0),
      );
      const scored = mine.find((s) => s.feedbackBand);
      return {
        uid: p.uid,
        name: p.displayName?.trim() || p.email,
        email: p.email,
        conversations: mine.length,
        minutes: Math.round(
          mine.reduce((t, s) => t + Math.max(0, (s.durationSec ?? 0) - (s.appWaitSec ?? 0)), 0) /
            60,
        ),
        lastActive: mine[0]?.startedAt?.toDate() ?? null,
        latestBand: scored?.feedbackBand ?? null,
      };
    })
    .sort(
      (a, b) =>
        (b.lastActive?.getTime() ?? 0) - (a.lastActive?.getTime() ?? 0) ||
        a.name.localeCompare(b.name),
    );
}

/** Inactive for a while, or their latest conversation came out below Solid. */
export function needsAttention(r: ResidentSummary, now = Date.now()): string | null {
  if (!r.lastActive) return 'No conversations yet';
  const days = Math.floor((now - r.lastActive.getTime()) / DAY);
  if (days >= INACTIVE_DAYS) return `No conversation for ${days} days`;
  if (r.latestBand && BELOW_SOLID.has(r.latestBand)) return `Latest: ${r.latestBand}`;
  return null;
}

const when = (d: Date | null) =>
  d ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'never';

/** Faculty: every resident's practice at a glance, with filters; tap one for their full progress. */
export function Residents() {
  const { claims } = useAuth();
  const programId = claims?.programId;
  const people = usePeople(programId);
  const sessions = useProgramSessions(programId);
  const scenarios = useScenarioList(claims);
  const [range, setRange] = useState<Range>('all');
  const [from, setFrom] = useState('');
  const [scenarioId, setScenarioId] = useState('');
  const [attention, setAttention] = useState(false);
  const [today] = useState(() => Date.now());
  const since = useMemo(() => {
    if (range === '30') return today - 30 * DAY;
    if (range === '7') return today - 7 * DAY;
    if (range === 'from' && from) return new Date(`${from}T00:00:00`).getTime();
    return 0;
  }, [range, from, today]);

  const rows = useMemo(
    () =>
      people && sessions ? summarize(people, sessions, since, scenarioId || null, today) : null,
    [people, sessions, since, scenarioId, today],
  );
  const shown = rows?.filter((r) => !attention || needsAttention(r, today));

  return (
    <section>
      <h1>Residents</h1>
      <p className="muted">
        Each resident’s practice in the range. Tap a name for their progress and feedback.
      </p>
      <p className="faculty-links">
        <Link to="/faculty/invites" className="btn btn-secondary">
          Invite people
        </Link>
        <Link to="/faculty/admin" className="btn btn-secondary">
          Admin
        </Link>
      </p>

      <div className="chips" role="group" aria-label="Time range">
        {(
          [
            ['all', 'All time'],
            ['30', 'Last 30 days'],
            ['7', 'Last 7 days'],
            ['from', 'From a date'],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            type="button"
            className="chip"
            aria-pressed={range === v}
            onClick={() => setRange(v)}
          >
            {label}
          </button>
        ))}
        {range === 'from' && (
          <input
            type="date"
            aria-label="Starting from"
            value={from}
            max={new Date(today).toISOString().slice(0, 10)}
            onChange={(e) => setFrom(e.target.value)}
          />
        )}
      </div>
      <div className="filters">
        <label className="field">
          <span>Patient</span>
          <select value={scenarioId} onChange={(e) => setScenarioId(e.target.value)}>
            <option value="">All patients</option>
            {scenarios?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.patientName}: {s.title}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={attention}
            onChange={(e) => setAttention(e.target.checked)}
          />
          <span>
            Needs attention only (no conversation for {INACTIVE_DAYS}+ days, or latest below Solid)
          </span>
        </label>
      </div>

      <div className="card">
        {!shown ? (
          <p className="muted">Loading…</p>
        ) : shown.length === 0 ? (
          <p className="muted">
            {attention ? 'Nobody needs attention right now.' : 'No residents yet.'}
          </p>
        ) : (
          <table className="residents">
            <thead>
              <tr>
                <th scope="col">Resident</th>
                <th scope="col">Conversations</th>
                <th scope="col">Minutes</th>
                <th scope="col">Last active</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const why = needsAttention(r, today);
                return (
                  <tr key={r.uid}>
                    <td>
                      <Link to={`/faculty/residents/${r.uid}`}>{r.name}</Link>
                      {why && <div className="small attention">{why}</div>}
                    </td>
                    <td>{r.conversations}</td>
                    <td>{r.minutes}</td>
                    <td>
                      {when(r.lastActive)}
                      {r.latestBand && <div className="small muted">{r.latestBand}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <p className="small muted">
        Conversations count those the resident took part in. Minutes leave out time spent waiting on
        the app.
      </p>
    </section>
  );
}
