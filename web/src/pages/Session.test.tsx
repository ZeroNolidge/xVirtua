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

/** Set to hold the next reply until released (to type while Ray is "thinking"). */
let hold: Promise<void> | null = null;
const streamTurn = vi.fn(async (_input: unknown, onChunk: (c: PatientChunk) => void) => {
  if (hold) await hold;
  onChunk({
    t: 'meta',
    delivery: { emotion: 'worried', volume: 'normal', rate: 'normal', pauseBeforeMs: 0 },
    nonverbal: ['frown'],
  });
  onChunk({ t: 'say', seq: 0, text: 'Will I lose my license?' });
  return {
    patient: {
      idx: 2,
      text: 'Will I lose my license?',
      askedQuestion: true,
      delivery: { emotion: 'worried', volume: 'normal', rate: 'normal', pauseBeforeMs: 0 },
      nonverbal: ['frown'],
    },
    latencyMs: 5,
    voiced: false,
  };
});
vi.mock('../lib/session', () => ({
  sessionApi: {
    saveHeard: vi.fn(async () => ({ data: { ok: true } })),
    end: vi.fn(async () => ({ data: {} })),
    sttToken: vi.fn(),
  },
  streamTurn: (i: unknown, c: (c: PatientChunk) => void) => streamTurn(i, c),
  fetchPatientAudio: vi.fn(async () => null),
  audioFromChunk: vi.fn(),
}));
// Real queueing, instant playback (jsdom has no audio).
vi.mock('../lib/voiceRenderer', async (orig) => {
  const m = await orig<typeof import('../lib/voiceRenderer')>();
  class InstantRenderer extends m.VoiceRenderer {
    override async mount() {}
    override async play() {}
  }
  return { ...m, VoiceRenderer: InstantRenderer };
});

const { Session, Conversation } = await import('./Session');
const { NO_MIC_NOTICE } = await import('../lib/micNotice');

beforeAll(() => {
  // Safari returns a value from scrollIntoView. An effect that returns it
  // crashes React on the next update ("l is not a function").
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

function renderSession() {
  return render(
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
}

describe('conversation screen', () => {
  it('survives a typed reply and leaving the screen (Safari scrollIntoView)', async () => {
    const { unmount } = renderSession();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start the conversation' }));
    });
    expect(await screen.findByText(opening.text)).toBeInTheDocument();

    const box = await screen.findByRole('textbox', { name: /your reply/i });
    await act(async () => {
      fireEvent.change(box, { target: { value: 'Your blood pressure is a bit high.' } });
      fireEvent.submit(box.closest('form')!);
    });
    expect(await screen.findByText('Will I lose my license?')).toBeInTheDocument();
    // Nonverbal cue sits above the words, outside the bubble.
    const cue = screen.getByText('frowns');
    expect(cue).toHaveClass('nonverbal');
    expect(cue.closest('.bubble')).toBeNull();
    expect(streamTurn).toHaveBeenCalledTimes(1);

    // Leaving the screen runs every effect cleanup.
    expect(() => unmount()).not.toThrow();
  });

  it('queues a reply sent while Ray is still answering and sends it when he finishes', async () => {
    streamTurn.mockClear();
    let release!: () => void;
    hold = new Promise<void>((r) => (release = r));
    const { unmount } = renderSession();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start the conversation' }));
    });
    const box = await screen.findByRole('textbox', { name: /your reply/i });
    await act(async () => {
      fireEvent.change(box, { target: { value: 'First thing.' } });
      fireEvent.submit(box.closest('form')!);
    });
    // Ray is thinking: Enter on the next message must not drop it.
    await act(async () => {
      fireEvent.change(box, { target: { value: 'And one more thing.' } });
      fireEvent.submit(box.closest('form')!);
    });
    expect(screen.getByText('And one more thing.')).toBeInTheDocument();
    expect(screen.getByText(/sends when ray finishes/i)).toBeInTheDocument();
    expect(streamTurn).toHaveBeenCalledTimes(1);

    hold = null;
    await act(async () => {
      release();
    });
    await vi.waitFor(() => expect(streamTurn).toHaveBeenCalledTimes(2));
    expect((streamTurn.mock.calls[1]![0] as { text: string }).text).toBe('And one more thing.');
    expect(screen.queryByText(/sends when ray finishes/i)).toBeNull();
    unmount();
  });

  it('without a mic: the alert shows and "Mic ready" doesn\u2019t', async () => {
    renderSession();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start the conversation' }));
    });
    expect(
      await screen.findByText('No microphone access, so you can type your side for now.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Mic ready/)).toBeNull();
  });

  it('no mic known before the tap: the card says they’ll type, and one tap opens the text box', async () => {
    const { unmount } = renderSession();
    expect(
      screen.getByText(/You’ll type your side, and Ray’s replies show here as text/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/will answer out loud/)).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start the conversation' }));
    });
    expect(await screen.findByRole('textbox', { name: /your reply/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start the conversation' })).toBeNull();
    unmount();
  });

  it('live voice fell back for no mic: types straight away, no second tap', async () => {
    const { unmount } = render(
      <MemoryRouter>
        <Conversation
          sessionId="s1"
          persona={{ name: 'Ray Kowalski', age: 58, pronouns: 'he/him' }}
          opening={{ ...opening, nonverbal: [] }}
          initialNotice={NO_MIC_NOTICE}
          startNow
        />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('textbox', { name: /your reply/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start the conversation' })).toBeNull();
    expect(screen.getByText(NO_MIC_NOTICE)).toBeInTheDocument();
    unmount();
  });

  it('button label: “Start the conversation” with no mic, “Start talking” with one', async () => {
    const first = renderSession();
    expect(screen.getByRole('button', { name: 'Start the conversation' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start talking' })).toBeNull();
    first.unmount();
    // An earlier no-mic test left “the mic failed last time” behind.
    localStorage.clear();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(),
        enumerateDevices: async () => [{ kind: 'audioinput' }],
      },
    });
    try {
      const { unmount } = renderSession();
      await act(async () => {});
      expect(screen.getByRole('button', { name: 'Start talking' })).toBeInTheDocument();
      unmount();
    } finally {
      Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
    }
  });
});
