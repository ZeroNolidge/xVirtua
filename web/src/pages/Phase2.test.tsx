import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { SEED_SCENARIOS } from '@plainspeak/shared/seed';

const role = { current: 'resident' as 'resident' | 'faculty' };
vi.mock('../lib/firebase', () => ({ auth: {}, db: {}, functions: {}, usingEmulators: true }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  getDocs: vi.fn(() => new Promise(() => {})),
  doc: vi.fn(),
  getDoc: vi.fn(async () => ({ data: () => ({ liveVoiceTags: { stone: 'male' } }) })),
}));
vi.mock('../lib/api', () => ({
  api: { setScenarioStatus: vi.fn(), setScenarioVoice: vi.fn(async () => ({ data: {} })) },
  friendlyError: () => 'x',
}));
vi.mock('../lib/session', () => ({ sessionApi: {}, prewarmConversation: vi.fn() }));
const lookupOnServer = vi.fn(async (_term: string) => null);
vi.mock('../lib/jargon', async (orig) => ({
  ...(await orig<typeof import('../lib/jargon')>()),
  lookupOnServer: (t: string) => lookupOnServer(t),
}));
vi.mock('../lib/auth', () => ({
  useAuth: () => ({
    claims: { role: role.current, programId: 'irmc' },
    userDoc: { displayName: 'Tim' },
  }),
}));

const seed = SEED_SCENARIOS[0]!;
vi.mock('../lib/scenarios', () => ({
  useScenario: (_id: string, isFaculty: boolean) => ({
    status: 'ok',
    detail: {
      summary: { id: seed.id, status: 'draft', currentVersion: '1' },
      briefing: seed.briefing,
      script: isFaculty ? seed.script : null,
    },
  }),
}));

const { Lookup } = await import('./Lookup');
const { Briefing } = await import('./Briefing');

beforeEach(() => {
  role.current = 'resident';
});

describe('Plain words lookup', () => {
  it('shows a plain swap instantly as you type', () => {
    render(<Lookup />);
    fireEvent.change(screen.getByPlaceholderText(/type a medical word/i), {
      target: { value: 'hypert' },
    });
    expect(screen.getAllByText('hypertension')[0]).toBeInTheDocument();
    expect(screen.getByText('“high blood pressure”')).toBeInTheDocument();
  });

  it('shows abbreviations the way clinicians write them', () => {
    render(<Lookup />);
    const box = screen.getByPlaceholderText(/type a medical word/i);
    const cases: [string, string][] = [
      ['ascvd', 'ASCVD'],
      ['bp', 'BP'],
      ['prn', 'PRN'],
      ['a1c', 'hemoglobin A1c'],
    ];
    for (const [typed, shown] of cases) {
      fireEvent.change(box, { target: { value: typed } });
      expect(screen.getAllByText(shown)[0]).toBeInTheDocument();
    }
    expect(screen.queryByText('ascvd')).toBeNull();
  });

  it('a misspelled word finds the dictionary entry, without asking the server', async () => {
    vi.useFakeTimers();
    try {
      render(<Lookup />);
      fireEvent.change(screen.getByPlaceholderText(/type a medical word/i), {
        target: { value: 'hypertention' },
      });
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.getAllByText('hypertension')[0]).toBeInTheDocument();
      expect(screen.getByText('“high blood pressure”')).toBeInTheDocument();
      expect(screen.queryByText('Looking…')).toBeNull();
      expect(lookupOnServer).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a word with no close match still asks the server', async () => {
    render(<Lookup />);
    fireEvent.change(screen.getByPlaceholderText(/type a medical word/i), {
      target: { value: 'zzqqxx' },
    });
    await vi.waitFor(() => expect(lookupOnServer).toHaveBeenCalledWith('zzqqxx'));
  });

  it('offers suggestion chips when empty', () => {
    render(<Lookup />);
    fireEvent.click(screen.getByRole('button', { name: 'PRN' }));
    expect(screen.getByText('“as needed”')).toBeInTheDocument();
  });
});

function renderBriefing() {
  return render(
    <MemoryRouter initialEntries={[`/scenario/${seed.id}`]}>
      <Routes>
        <Route path="/scenario/:id" element={<Briefing />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Briefing', () => {
  it('shows residents the briefing but not the hidden script', () => {
    renderBriefing();
    expect(screen.getByText(seed.briefing.persona.name)).toBeInTheDocument();
    expect(screen.getByText(seed.briefing.residentTask)).toBeInTheDocument();
    expect(screen.queryByText(/faculty review/i)).not.toBeInTheDocument();
    expect(screen.queryByText(seed.script.hiddenConcern)).not.toBeInTheDocument();
  });

  it('with no mic: says they’ll type their side; with a mic: talk out loud', () => {
    const { unmount } = renderBriefing();
    expect(
      screen.getByText(/you’ll type your side and .+’s replies show as text/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/You’ll talk out loud/)).toBeNull();
    unmount();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn() },
    });
    try {
      renderBriefing();
      expect(screen.getByText(/You’ll talk out loud/)).toBeInTheDocument();
    } finally {
      Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
    }
  });

  it('shows faculty the review panel with hidden concern, cues and publish', () => {
    role.current = 'faculty';
    renderBriefing();
    expect(screen.getByText(/faculty review/i)).toBeInTheDocument();
    expect(screen.getByText(seed.script.hiddenConcern)).toBeInTheDocument();
    expect(screen.getByText(seed.script.cueScript[0]!.cue)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /publish to residents/i })).toBeInTheDocument();
  });

  it('lets faculty pick this patient’s GPT-Live voice, showing their voice tags', async () => {
    role.current = 'faculty';
    renderBriefing();
    const pick = screen.getByLabelText(/patient voice \(gpt-live\)/i);
    expect(await screen.findByRole('option', { name: 'stone (Male)' })).toBeInTheDocument();
    fireEvent.change(pick, { target: { value: 'stone' } });
    const { api } = await import('../lib/api');
    await vi.waitFor(() =>
      expect(api.setScenarioVoice).toHaveBeenCalledWith({ scenarioId: seed.id, voice: 'stone' }),
    );
  });
});
