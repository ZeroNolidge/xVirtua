import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { PatientChunk } from '@plainspeak/shared';

vi.mock('../lib/firebase', () => ({
  auth: {},
  db: {},
  functions: {},
  storage: {},
  usingEmulators: true,
}));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  orderBy: vi.fn(),
  query: vi.fn(),
}));
vi.mock('firebase/storage', () => ({
  ref: vi.fn(),
  uploadBytes: vi.fn(),
  uploadBytesResumable: vi.fn(),
}));
vi.mock('../lib/auth', () => ({
  useAuth: () => ({ claims: { role: 'resident', programId: 'irmc' }, user: { uid: 'u1' } }),
}));
vi.mock('../components/PlainWordSearch', () => ({ PlainWordSearch: () => null }));
vi.mock('../lib/errorReport', () => ({ reportError: vi.fn() }));
vi.mock('../lib/session', () => ({
  sessionApi: {
    saveHeard: vi.fn(async () => ({ data: { ok: true } })),
    end: vi.fn(),
    sttToken: vi.fn(),
  },
  streamTurn: vi.fn(async (_i: unknown, _c: (c: PatientChunk) => void) => ({})),
  fetchPatientAudio: vi.fn(async () => null),
  audioFromChunk: vi.fn(),
}));
vi.mock('../lib/voiceRenderer', async (orig) => {
  const m = await orig<typeof import('../lib/voiceRenderer')>();
  class InstantRenderer extends m.VoiceRenderer {
    override async mount() {}
    override async play() {}
  }
  return { ...m, VoiceRenderer: InstantRenderer };
});
// A video face that is slow to connect (Simli on a weak network).
vi.mock('../lib/useAvatar', async (orig) => {
  const m = await orig<typeof import('../lib/useAvatar')>();
  return {
    ...m,
    useAvatar: (id: string) => ({
      ...m.useAvatar(id),
      enabled: true,
      start: () => new Promise(() => {}),
    }),
  };
});

const { Session } = await import('./Session');
const { FACE_WAIT_MS } = await import('../lib/useAvatar');

beforeAll(() => {
  Element.prototype.scrollIntoView = function () {
    return Promise.resolve() as unknown as void;
  };
});

const opening = {
  idx: 0,
  text: 'So, my blood pressure is high?',
  askedQuestion: true,
  delivery: { emotion: 'neutral', volume: 'normal', rate: 'normal', pauseBeforeMs: 0 },
  nonverbal: [],
} as const;

describe('a slow video face', () => {
  it('doesn’t hold Ray’s first line for more than 5 s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(
        <MemoryRouter
          initialEntries={[
            {
              pathname: '/session/s1',
              state: { opening, persona: { name: 'Ray Kowalski', age: 58, pronouns: 'he/him' } },
            },
          ]}
        >
          <Routes>
            <Route path="/session/:id" element={<Session />} />
          </Routes>
        </MemoryRouter>,
      );
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Start the conversation' }));
      });
      await act(async () => {
        vi.advanceTimersByTime(FACE_WAIT_MS - 500);
      });
      expect(screen.queryByText(opening.text)).toBeNull();
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      expect(await screen.findByText(opening.text)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
