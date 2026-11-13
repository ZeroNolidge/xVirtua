import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  type Timestamp,
} from 'firebase/firestore';
import {
  BANDS,
  METRICS,
  speechClarityPct,
  type Metric,
  type ResidentFeedback,
  type SpeechStats,
} from '@plainspeak/shared';
import { db } from '../lib/firebase';
import { bandLevel, levelsOf, METRIC_ABOUT, METRIC_LABEL } from './metricLabels';
import { SkillShape, type Levels } from './SkillShape';
import { neverStarted } from '../lib/resume';

interface Session {
  id: string;
  scenarioTitle?: string;
  status: 'live' | 'ended';
  startedAt?: Timestamp;
  durationSec?: number;
  appWaitSec?: number;
  feedbackBand?: string | null;
  speechStats?: SpeechStats;
  turnCount?: number;
}
interface Scored extends Session {
  at: Date;
  overall: number;
  levels: Levels;
}

/**
 * Their conversations (newest 100), with each scored one's bands per area.
 * `programId`: faculty looking at a resident; the rules need the program on
 * the query, and that query is sorted here instead (no extra index).
 */
function useScoredHistory(uid: string | undefined, programId?: string) {
  const [all, setAll] = useState<Session[] | null>(null);
  const [areas, setAreas] = useState<Record<string, Levels>>({});
  useEffect(() => {
    if (!uid) return;
    const q = programId
      ? query(
          collection(db, 'sessions'),
          where('uid', '==', uid),
          where('programId', '==', programId),
        )
      : query(
          collection(db, 'sessions'),
          where('uid', '==', uid),
          orderBy('startedAt', 'desc'),
          limit(100),
        );
    return onSnapshot(
      q,
      (snap) =>
        setAll(
          snap.docs
            .map((d) => ({ id: d.id, ...(d.data() as Omit<Session, 'id'>) }))
            .sort((a, b) => (b.startedAt?.toMillis() ?? 0) - (a.startedAt?.toMillis() ?? 0))
            .slice(0, 100),
        ),
      () => setAll([]),
    );
  }, [uid, programId]);
  useEffect(() => {
    if (!all) return;
    const missing = all.filter((s) => s.feedbackBand && !areas[s.id]);
    if (!missing.length) return;
    let cancelled = false;
    void Promise.all(
      missing.map(async (s) => {
        const f = await getDoc(doc(db, 'sessions', s.id, 'feedback', 'current')).catch(() => null);
        const a = (f?.data() as ResidentFeedback | undefined)?.areas;
        return [s.id, a ? levelsOf(a) : {}] as const;
      }),
    ).then((pairs) => {
      if (!cancelled) setAreas((old) => ({ ...old, ...Object.fromEntries(pairs) }));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all]);
  return { all, areas };
}

type Range = 'all' | '30' | '7' | 'from';
const DAY = 24 * 3600 * 1000;

/** Average level per area over some conversations. */
function average(rows: Scored[]): Levels {
  return Object.fromEntries(
    METRICS.map((m) => {
      const v = rows.map((r) => r.levels[m]).filter((x): x is number => x != null);
      return [m, v.length ? v.reduce((a, b) => a + b, 0) / v.length : null];
    }),
  ) as Levels;
}

/**
 * The resident's progress: practice totals for a time range, their skills
 * then vs now (the circle graph: tap an area for its trend), and the trend.
 */
export function ProgressDashboard({
  uid,
  programId,
}: {
  uid: string | undefined;
  /** Faculty looking at a resident of their program. */
  programId?: string;
}) {
  const { all, areas } = useScoredHistory(uid, programId);
  const [range, setRange] = useState<Range>('all');
  const [from, setFrom] = useState('');
  const [picked, setPicked] = useState<Metric | null>(null);

  // "Today", fixed when the page opens (the ranges count back from it).
  const [today] = useState(() => Date.now());
  const since = useMemo(() => {
    if (range === '30') return today - 30 * DAY;
    if (range === '7') return today - 7 * DAY;
    if (range === 'from' && from) return new Date(`${from}T00:00:00`).getTime();
    return 0;
  }, [range, from, today]);

  // Ones the resident never spoke in don't count as practice.
  const inRange = (all ?? []).filter(
    (s) =>
      s.status === 'ended' && !neverStarted(s, today) && (s.startedAt?.toMillis() ?? 0) >= since,
  );
  const scored: Scored[] = inRange
    .filter((s) => s.feedbackBand && s.startedAt && areas[s.id])
    .map((s) => ({
      ...s,
      at: s.startedAt!.toDate(),
      overall: bandLevel(s.feedbackBand) ?? 0,
      levels: areas[s.id]!,
    }))
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  const minutes = Math.round(
    inRange.reduce((t, s) => t + Math.max(0, (s.durationSec ?? 0) - (s.appWaitSec ?? 0)), 0) / 60,
  );
  const clarity = inRange
    .filter((s) => speechClarityPct(s.speechStats) !== null)
    .map((s) => ({ at: s.startedAt!.toDate(), pct: speechClarityPct(s.speechStats)! }))
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  // Then vs now: the first few against the last few (one bad day doesn't decide it).
  const k = Math.min(3, Math.floor(scored.length / 2));
  const then = k ? average(scored.slice(0, k)) : null;
  const now = scored.length ? average(scored.slice(-Math.max(k, 1))) : null;

  // Wait for every scored conversation's areas too, or it flashes "no feedback".
  const areasPending = (all ?? []).some((s) => s.feedbackBand && !areas[s.id]);
  if (all === null || areasPending) return <p className="muted">Loading…</p>;

  return (
    <>
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

      <div className="card">
        <div className="stat-row">
          <div className="stat">
            <span className="num">{inRange.length}</span>
            <span className="lbl">{inRange.length === 1 ? 'conversation' : 'conversations'}</span>
          </div>
          <div className="stat">
            <span className="num">{minutes}</span>
            <span className="lbl">minutes practiced</span>
          </div>
          <div className="stat">
            <span className="num">{scored.length}</span>
            <span className="lbl">with feedback</span>
          </div>
        </div>
      </div>

      {now ? (
        <div className="card">
          <h2>{then ? 'Your skills, then and now' : 'Your skills'}</h2>
          {then && (
            <p className="small muted">
              Your first {k === 1 ? 'conversation' : `${k} conversations`} in this range against
              your latest {k === 1 ? 'one' : k}.
            </p>
          )}
          <SkillShape
            now={now}
            before={then}
            nowLabel="Now"
            beforeLabel="When you started"
            selected={picked}
            onSelect={setPicked}
          />
          <p className="small muted">
            {picked ? METRIC_ABOUT[picked] : 'Tap an area to see how it has changed.'}
          </p>
          <Trend
            title={picked ? METRIC_LABEL[picked] : 'Overall'}
            points={scored.map((s) => ({
              id: s.id,
              at: s.at,
              level: picked ? (s.levels[picked] ?? null) : s.overall,
              note: s.scenarioTitle ?? 'Conversation',
            }))}
          />
        </div>
      ) : (
        <div className="card">
          <p className="muted">
            {inRange.length
              ? 'No feedback in this range yet.'
              : 'No conversations in this range yet.'}
          </p>
        </div>
      )}

      {clarity.length > 0 && (
        <div className="card">
          <h2>How clearly you came through</h2>
          <ClarityTrend points={clarity} />
          <p className="muted small">
            Less exact than the other feedback, and not part of your score: a weak microphone, a
            noisy room or an accent can lower it too.
          </p>
        </div>
      )}
    </>
  );
}

const W = 320;
const H = 150;
const PAD = { l: 86, r: 12, t: 10, b: 22 };
const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/** A band over time: one row per band, one point per conversation; tap a point for it. */
export function Trend({
  title,
  points,
}: {
  title: string;
  points: { id: string; at: Date; level: number | null; note: string }[];
}) {
  const [on, setOn] = useState<number | null>(null);
  const pts = points.filter((p) => p.level != null);
  if (pts.length < 2) return null;
  const x = (i: number) => PAD.l + ((W - PAD.l - PAD.r) * i) / Math.max(1, pts.length - 1);
  const y = (lv: number) => PAD.t + ((H - PAD.t - PAD.b) * (4 - lv)) / 3;
  const sel = on != null ? pts[on] : null;
  return (
    <div className="trend">
      <h3 className="small">{title} over time</h3>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title} over time`}>
        {[1, 2, 3, 4].map((lv) => (
          <g key={lv}>
            <line className="grid-line" x1={PAD.l} x2={W - PAD.r} y1={y(lv)} y2={y(lv)} />
            <text className="row-label" x={PAD.l - 8} y={y(lv) + 4} textAnchor="end">
              {BANDS[lv - 1]}
            </text>
          </g>
        ))}
        <polyline className="line" points={pts.map((p, i) => `${x(i)},${y(p.level!)}`).join(' ')} />
        {pts.map((p, i) => (
          <g key={p.id} onClick={() => setOn(on === i ? null : i)}>
            <circle className={`pt${on === i ? ' on' : ''}`} cx={x(i)} cy={y(p.level!)} r={4.5} />
            <circle className="hit" cx={x(i)} cy={y(p.level!)} r={14} />
          </g>
        ))}
        <text className="row-label" x={PAD.l} y={H - 4}>
          {fmt(pts[0]!.at)}
        </text>
        <text className="row-label" x={W - PAD.r} y={H - 4} textAnchor="end">
          {fmt(pts[pts.length - 1]!.at)}
        </text>
      </svg>
      <p className="trend-tip" aria-live="polite">
        {sel ? (
          <>
            {fmt(sel.at)} · {sel.note}: {BANDS[Math.round(sel.level!) - 1]} ·{' '}
            <Link to={`/session/${sel.id}/done`}>Open it</Link>
          </>
        ) : (
          'Tap a point to see that conversation.'
        )}
      </p>
    </div>
  );
}

/** Speech clarity over time (share of words heard clearly). */
export function ClarityTrend({ points }: { points: { at: Date; pct: number }[] }) {
  if (points.length === 1)
    return <p>{points[0]!.pct}% of your words came through clearly last time.</p>;
  const lo = Math.max(0, Math.min(...points.map((p) => p.pct)) - 10);
  const x = (i: number) => 40 + ((W - 52) * i) / (points.length - 1);
  const y = (v: number) => 10 + ((H - 32) * (100 - v)) / (100 - lo || 1);
  return (
    <div className="trend">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Speech clarity over time">
        {[lo, Math.round((lo + 100) / 2), 100].map((v) => (
          <g key={v}>
            <line className="grid-line" x1={40} x2={W - 12} y1={y(v)} y2={y(v)} />
            <text className="row-label" x={34} y={y(v) + 4} textAnchor="end">
              {v}%
            </text>
          </g>
        ))}
        <polyline className="line" points={points.map((p, i) => `${x(i)},${y(p.pct)}`).join(' ')} />
        {points.map((p, i) => (
          <circle key={i} className="pt" cx={x(i)} cy={y(p.pct)} r={4.5}>
            <title>
              {fmt(p.at)}: {p.pct}%
            </title>
          </circle>
        ))}
      </svg>
    </div>
  );
}
