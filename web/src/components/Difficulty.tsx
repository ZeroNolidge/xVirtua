const LABELS = { 1: 'Warm-up', 2: 'Medium', 3: 'Challenge' } as const;

export function Difficulty({ level }: { level: 1 | 2 | 3 }) {
  return (
    <span className="difficulty" aria-label={`Difficulty: ${LABELS[level]}`}>
      {[1, 2, 3].map((i) => (
        <span key={i} className={i <= level ? 'dot on' : 'dot'} aria-hidden="true" />
      ))}
      <span className="small muted">{LABELS[level]}</span>
    </span>
  );
}
