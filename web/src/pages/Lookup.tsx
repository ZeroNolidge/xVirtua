import { PlainWordSearch } from '../components/PlainWordSearch';

export function Lookup() {
  return (
    <section>
      <h1>Plain words</h1>
      <p className="muted">Look up a medical word and get an everyday way to say it.</p>
      <PlainWordSearch />
    </section>
  );
}
