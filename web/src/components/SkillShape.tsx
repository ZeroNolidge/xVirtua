import { BANDS, METRICS, type Metric } from '@plainspeak/shared';
import { METRIC_LABEL } from './metricLabels';

/** A level per area: 1 (Just starting) to 4 (Strong); averages can fall in between. */
export type Levels = Partial<Record<Metric, number | null>>;

const SIZE = 300;
const C = SIZE / 2;
const R = 130;
/** Each area's direction: one per corner (more room for the labels), clockwise from top left. */
const ANGLE: Record<Metric, number> = { jargon: -135, clarity: -45, empathy: 45, cue: 135 };
const rad = (d: number) => (d * Math.PI) / 180;
const at = (m: Metric, level: number) => {
  const r = (R * Math.max(0, Math.min(4, level))) / 4;
  return [C + r * Math.cos(rad(ANGLE[m])), C + r * Math.sin(rad(ANGLE[m]))] as const;
};
const shape = (v: Levels) =>
  METRICS.map((m) => at(m, v[m] ?? 0))
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ');
const complete = (v: Levels | null | undefined): v is Levels =>
  !!v && METRICS.every((m) => v[m] != null);
const bandName = (level: number) => BANDS[Math.max(0, Math.min(3, Math.round(level) - 1))]!;

/** Where each area's button sits around the graph. */
const PLACE: Record<Metric, React.CSSProperties> = {
  jargon: { left: 0, top: 0, textAlign: 'left' },
  clarity: { right: 0, top: 0, textAlign: 'right' },
  empathy: { right: 0, bottom: 0, textAlign: 'right' },
  cue: { left: 0, bottom: 0, textAlign: 'left' },
};

/**
 * The circle graph: one axis per area, rings for the four bands (bigger is
 * better). The solid green shape is now; the dashed amber one is before.
 * Tapping an area (its label or its part of the graph) selects it.
 */
export function SkillShape({
  now,
  before,
  nowLabel,
  beforeLabel,
  selected,
  onSelect,
}: {
  now: Levels;
  before?: Levels | null;
  nowLabel: string;
  beforeLabel?: string;
  selected: Metric | null;
  onSelect: (m: Metric | null) => void;
}) {
  const showBefore = complete(before);
  const toggle = (m: Metric) => onSelect(selected === m ? null : m);
  return (
    <div>
      {showBefore && (
        <div className="chart-legend" aria-hidden="true">
          <span>
            <span className="key" />
            {nowLabel}
          </span>
          <span>
            <span className="key before" />
            {beforeLabel}
          </span>
        </div>
      )}
      <div className="skill-shape">
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          role="img"
          aria-label={describe(now, before, nowLabel, beforeLabel)}
        >
          {[1, 2, 3, 4].map((k) => (
            <polygon
              key={k}
              className="ring"
              points={METRICS.map((m) => at(m, k).join(',')).join(' ')}
            />
          ))}
          {METRICS.map((m) => {
            const [x, y] = at(m, 4);
            return <line key={m} className="spoke" x1={C} y1={C} x2={x} y2={y} />;
          })}
          {/* Tap targets: each area's quarter of the graph. */}
          {METRICS.map((m, i) => {
            const prev = METRICS[(i + 3) % 4]!;
            const next = METRICS[(i + 1) % 4]!;
            const [ax, ay] = at(m, 4);
            const [px, py] = at(prev, 4);
            const [nx, ny] = at(next, 4);
            const kite = [
              [C, C],
              [(ax + px) / 2, (ay + py) / 2],
              [ax, ay],
              [(ax + nx) / 2, (ay + ny) / 2],
            ];
            return (
              <polygon
                key={m}
                className={`wedge${selected === m ? ' on' : ''}`}
                points={kite.map((p) => p.join(',')).join(' ')}
                onClick={() => toggle(m)}
                aria-hidden="true"
              />
            );
          })}
          {showBefore && <polygon className="before" points={shape(before)} pointerEvents="none" />}
          <polygon className="now" points={shape(now)} pointerEvents="none" />
          {showBefore &&
            METRICS.map((m) => {
              const [x, y] = at(m, before[m] ?? 0);
              return (
                <circle key={m} className="dot-before" cx={x} cy={y} r={4} pointerEvents="none" />
              );
            })}
          {METRICS.map((m) => {
            const [x, y] = at(m, now[m] ?? 0);
            return <circle key={m} className="dot-now" cx={x} cy={y} r={5} pointerEvents="none" />;
          })}
        </svg>
        {METRICS.map((m) => (
          <button
            key={m}
            type="button"
            className={`axis-btn${selected === m ? ' on' : ''}`}
            style={PLACE[m]}
            aria-pressed={selected === m}
            onClick={() => toggle(m)}
          >
            {METRIC_LABEL[m]}
            {now[m] != null && <span className="axis-band">{bandName(now[m]!)}</span>}
          </button>
        ))}
      </div>
      <p className="small muted center-text">Center: Just starting · Edge: Strong</p>
      <details className="small">
        <summary>As a list</summary>
        <table className="small">
          <thead>
            <tr>
              <th scope="col">Area</th>
              <th scope="col">{nowLabel}</th>
              {showBefore && <th scope="col">{beforeLabel}</th>}
            </tr>
          </thead>
          <tbody>
            {METRICS.map((m) => (
              <tr key={m}>
                <th scope="row">{METRIC_LABEL[m]}</th>
                <td>{now[m] != null ? bandName(now[m]!) : '—'}</td>
                {showBefore && <td>{bandName(before[m]!)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

function describe(
  now: Levels,
  before: Levels | null | undefined,
  nowLabel: string,
  beforeLabel?: string,
) {
  const part = (v: Levels) =>
    METRICS.map((m) => `${METRIC_LABEL[m]}: ${v[m] != null ? bandName(v[m]!) : 'no score'}`).join(
      ', ',
    );
  return `${nowLabel}: ${part(now)}.${complete(before) ? ` ${beforeLabel}: ${part(before)}.` : ''}`;
}
