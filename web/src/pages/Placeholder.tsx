export function Placeholder({
  title,
  phase,
  children,
}: {
  title: string;
  phase: number;
  children?: React.ReactNode;
}) {
  return (
    <section>
      <h1>{title}</h1>
      <div className="card">
        {children}
        <p className="muted">Coming in Phase {phase}.</p>
      </div>
    </section>
  );
}
