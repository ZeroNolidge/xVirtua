import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

let displayName: string | undefined;
vi.mock('../lib/auth', () => ({
  useAuth: () => ({
    claims: { role: 'resident', programId: 'irmc' },
    user: { uid: 'u1' },
    userDoc: { displayName },
  }),
}));
vi.mock('../lib/scenarios', () => ({ useScenarioList: () => [] }));
vi.mock('../lib/patientProgress', () => ({ usePatientProgress: () => ({}) }));

const { Home } = await import('./Home');

function greeting(name: string | undefined) {
  displayName = name;
  render(
    <MemoryRouter>
      <Home />
    </MemoryRouter>,
  );
  return screen.getByRole('heading', { level: 1 }).textContent;
}

describe('Home greeting', () => {
  it('uses the preferred name exactly as typed, never shortened', () => {
    expect(greeting('Dr. Lee')).toBe('Ready to practice, Dr. Lee?');
  });
  it('a single name', () => {
    expect(greeting('Sam')).toBe('Ready to practice, Sam?');
  });
  it('a two-word first name, with spaces trimmed', () => {
    expect(greeting('  Mary Ann ')).toBe('Ready to practice, Mary Ann?');
  });
  it('no name yet', () => {
    expect(greeting(undefined)).toBe('Ready to practice?');
  });
});
