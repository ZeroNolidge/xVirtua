import { useEffect, useRef, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { LIVE_VOICES, type LiveVoice } from '@plainspeak/shared';
import { functions } from '../../lib/firebase';
import { LiveVoiceCall } from '../../lib/liveVoice';
import { friendlyError } from '../../lib/api';
import { TAG_LABEL, type VoiceTag } from './voiceTags';

const startPreview = httpsCallable<
  { voice: LiveVoice; sdp: string },
  { sdp: string; line: string }
>(functions, 'voiceSample', { timeout: 30_000 });

/** Longest a preview call stays open. */
const MAX_PREVIEW_MS = 15_000;

/**
 * Faculty: hear each GPT-Live voice and tag how it sounds, so the right voice
 * can be picked for each patient. Each play is a short listen-only GPT-Live
 * call (the mic is never opened) that says one line.
 */
export function VoiceSamples({
  tags,
  onTag,
}: {
  tags: Partial<Record<LiveVoice, VoiceTag>>;
  onTag(voice: LiveVoice, tag: VoiceTag): void;
}) {
  const [playing, setPlaying] = useState<LiveVoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<LiveVoiceCall | null>(null);

  useEffect(() => () => current.current?.hangUp(), []);

  async function play(voice: LiveVoice) {
    setError(null);
    current.current?.hangUp();
    setPlaying(voice);
    let line = '';
    let heard = false;
    const stop = () => {
      window.clearInterval(watch);
      window.clearTimeout(cap);
      void c.close().catch(() => undefined);
      if (current.current === c) {
        current.current = null;
        setPlaying(null);
      }
    };
    const c = new LiveVoiceCall({
      onStarted: () => line && c.say(null, line),
      onDelegation: (id) => c.note(id, 'Say only the sample line.'),
      onHeard: () => undefined,
      onSpoken: () => undefined,
      onError: (m) => {
        setError(m);
        stop();
      },
      onClosed: () => stop(),
    });
    current.current = c;
    c.unlockAudio(); // inside the tap (iOS)
    // Hang up once it has finished speaking.
    const watch = window.setInterval(() => {
      if (c.patientAudible(300)) heard = true;
      else if (heard && !c.patientAudible(1200)) stop();
    }, 200);
    const cap = window.setTimeout(stop, MAX_PREVIEW_MS);
    try {
      await c.start(null, async (sdp) => {
        const { data } = await startPreview({ voice, sdp });
        line = data.line;
        return data.sdp;
      });
    } catch (e) {
      setError(friendlyError(e));
      stop();
    }
  }

  return (
    <div className="voice-samples">
      <p className="muted small">
        Tap play to hear each voice say a line, then tag how it sounds. Your tags show in the voice
        lists above. Each play takes a few seconds to connect.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <ul className="tight">
        {LIVE_VOICES.map((v) => (
          <li key={v} className="voice-row">
            <button
              className="btn btn-secondary btn-inline"
              aria-label={`Play ${v}`}
              disabled={playing !== null && playing !== v}
              onClick={() => void play(v)}
            >
              {playing === v ? '♪' : '▶'}
            </button>
            <span className="voice-name">{v}</span>
            <span role="radiogroup" aria-label={`How ${v} sounds`}>
              {(Object.keys(TAG_LABEL) as VoiceTag[]).map((t) => (
                <label key={t} className="small">
                  <input
                    type="radio"
                    name={`tag-${v}`}
                    checked={tags[v] === t}
                    onChange={() => onTag(v, t)}
                  />{' '}
                  {TAG_LABEL[t]}
                </label>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
