import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../../lib/auth', () => ({
  useAuth: () => ({ claims: { role: 'faculty', programId: 'irmc' } }),
}));
vi.mock('../../lib/scenarios', () => ({
  useScenarioList: () => [
    { id: 'htn', patientName: 'Ray Kowalski', title: 'New high blood pressure', status: 'active' },
    { id: 't2dm', patientName: 'Linda Park', title: 'New diabetes', status: 'active' },
  ],
}));

const day = 864e5;
const now = Date.now();
const ts = (ms: number) => ({ toMillis: () => ms, toDate: () => new Date(ms) });
const people = [
  { uid: 'r1', displayName: 'Dr. Lee', email: 'lee@x.org', role: 'resident' },
  { uid: 'r2', displayName: 'Sam', email: 'sam@x.org', role: 'resident' },
  { uid: 'r3', displayName: '', email: 'new@x.org', role: 'resident' },
  { uid: 'f1', displayName: 'Prof', email: 'prof@x.org', role: 'faculty' },
];
const sessions = [
  // Lee: two with Ray (one 20 days ago, one 2 days ago), one with Linda yesterday.
  {
    id: 'a',
    uid: 'r1',
    scenarioId: 'htn',
    status: 'ended',
    startedAt: ts(now - 20 * day),
    durationSec: 600,
    appWaitSec: 60,
    feedbackBand: 'Solid',
    turnCount: 9,
  },
  {
    id: 'b',
    uid: 'r1',
    scenarioId: 'htn',
    status: 'ended',
    startedAt: ts(now - 2 * day),
    durationSec: 300,
    appWaitSec: 0,
    feedbackBand: 'Strong',
    turnCount: 7,
  },
  {
    id: 'c',
    uid: 'r1',
    scenarioId: 't2dm',
    status: 'ended',
    startedAt: ts(now - 1 * day),
    durationSec: 240,
    appWaitSec: 0,
    feedbackBand: 'Solid',
    turnCount: 5,
  },
  // Sam: one 30 days ago, Getting there; and one he never spoke in.
  {
    id: 'd',
    uid: 'r2',
    scenarioId: 'htn',
    status: 'ended',
    startedAt: ts(now - 30 * day),
    durationSec: 420,
    appWaitSec: 0,
    feedbackBand: 'Getting there',
    turnCount: 6,
  },
  {
    id: 'e',
    uid: 'r2',
    scenarioId: 'htn',
    status: 'ended',
    startedAt: ts(now - 1 * day),
    durationSec: 30,
    appWaitSec: 0,
    turnCount: 1,
  },
];
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, name: string) => name,
  query: (name: string) => name,
  where: vi.fn(),
  onSnapshot: (name: string, next: (s: unknown) => void) => {
    const docs = name === 'users' ? people : sessions;
    next({
      docs: docs.map((d) => ({
        id: (d as { uid?: string; id?: string }).id ?? (d as { uid: string }).uid,
        data: () => d,
      })),
    });
    return () => {};
  },
}));

const { Residents } = await import('./Residents');

const row = (name: string) => screen.getByRole('link', { name }).closest('tr')!;
const cells = (tr: HTMLElement) => [...tr.querySelectorAll('td')].map((td) => td.textContent);

describe('faculty residents dashboard', () => {
  it('one row per resident (not faculty): conversations, minutes, last active; newest first', () => {
    render(
      <MemoryRouter>
        <Residents />
      </MemoryRouter>,
    );
    expect(screen.queryByText('Prof')).toBeNull();
    const lee = cells(row('Dr. Lee'));
    expect(lee[1]).toBe('3');
    expect(lee[2]).toBe('18'); // (540 + 300 + 240) / 60
    expect(lee[3]).toContain('Solid'); // latest scored
    // Sam: the conversation he never spoke in doesn't count.
    const sam = cells(row('Sam'));
    expect(sam[1]).toBe('1');
    expect(sam[0]).toContain('No conversation for 30 days');
    // Order: Lee (yesterday), Sam (30 days), new@x.org (never).
    const names = screen.getAllByRole('link').map((l) => l.textContent);
    expect(names.slice(0, 3)).toEqual(['Dr. Lee', 'Sam', 'new@x.org']);
    expect(cells(row('new@x.org'))[0]).toContain('No conversations yet');
  });

  it('filters: time range, patient, needs attention', () => {
    render(
      <MemoryRouter>
        <Residents />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Last 7 days' }));
    expect(cells(row('Dr. Lee'))[1]).toBe('2');
    expect(cells(row('Sam'))[1]).toBe('0');
    fireEvent.click(screen.getByRole('button', { name: 'All time' }));
    fireEvent.change(screen.getByLabelText('Patient'), { target: { value: 't2dm' } });
    expect(cells(row('Dr. Lee'))[1]).toBe('1');
    fireEvent.change(screen.getByLabelText('Patient'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /needs attention only/i }));
    expect(screen.queryByRole('link', { name: 'Dr. Lee' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Sam' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'new@x.org' })).toBeInTheDocument();
  });

  it('links each resident to their own progress page', () => {
    render(
      <MemoryRouter>
        <Residents />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Dr. Lee' })).toHaveAttribute(
      'href',
      '/faculty/residents/r1',
    );
  });
});
