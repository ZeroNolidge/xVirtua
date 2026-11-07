import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
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
// Speech recognition never connects here (no network in tests).
vi.mock('../lib/stt', () => ({
  OpenAIRealtimeStt: class {
    async start() {}
    stop() {}
    setMuted() {}
  },
}));
vi.mock('../lib/session', () => ({
  sessionApi: {
    saveHeard: vi.fn(async () => ({ data: { ok: true } })),
    end: vi.fn(async () => ({ data: {} })),
    sttToken: vi.fn(async () => ({ data: { value: 'tok', turnDetection: 'server' } })),
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
// Live voice that gives up at once, the way a start timeout does.
const TIMED_OUT = 'The live voice didn’t answer in time, so this uses the standard voice.';
vi.mock('./LiveSession', () => ({
  LiveConversation: ({ onFallback }: { onFallback: (n: string, b: null) => void }) => {
    useEffect(() => onFallback(TIMED_OUT, null), [onFallback]);
    return <p>live voice connecting</p>;
  },
}));

const { Session } = await import('./Session');

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

describe('live voice falls back for any reason', () => {
  it('carries straight on with the standard voice: no second Start tap', async () => {
    // A phone with a mic: the fallback notice must stay up (begin() clears old notices).
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => ({ getTracks: () => [{ stop() {} }], getAudioTracks: () => [] }),
        enumerateDevices: async () => [{ kind: 'audioinput' }],
      },
    });
    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: '/session/s1',
            state: {
              opening,
              persona: { name: 'Ray Kowalski', age: 58, pronouns: 'he/him' },
              voiceMode: 'live',
            },
          },
        ]}
      >
        <Routes>
          <Route path="/session/:id" element={<Session />} />
        </Routes>
      </MemoryRouter>,
    );
    await act(async () => {});
    expect(await screen.findByText(TIMED_OUT)).toBeInTheDocument();
    // Ray's opening line plays at once; the ready card never shows.
    expect(await screen.findByText(opening.text)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Start/ })).toBeNull();
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
  });
});
