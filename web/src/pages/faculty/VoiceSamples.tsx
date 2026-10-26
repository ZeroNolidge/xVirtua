import { useRef, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { LIVE_VOICES, type LiveVoice } from '@plainspeak/shared';
import { functions } from '../../lib/firebase';
import { friendlyError } from '../../lib/api';
import { TAG_LABEL, type VoiceTag } from './voiceTags';

const getSample = httpsCallable<{ voice: LiveVoice }, { voice: string; wav: string }>(
  functions,
  'voiceSample',
  { timeout: 60_000 },
);

/**
 * Faculty: hear each GPT-Live voice and tag how it sounds, so the right voice
 * can be picked for each patient. The first play of a voice takes a few
 * seconds (it's recorded once on the server), then it's instant.
 */
export function VoiceSamples({
  tags,
  onTag,
}: {
  tags: Partial<Record<LiveVoice, VoiceTag>>;
  onTag(voice: LiveVoice, tag: VoiceTag): void;
}) {
  const [loading, setLoading] = useState<LiveVoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cache = useRef(new Map<LiveVoice, string>());
  const audio = useRef<HTMLAudioElement | null>(null);

  async function play(voice: LiveVoice) {
    setError(null);
    audio.current?.pause();
    let url = cache.current.get(voice);
    if (!url) {
      setLoading(voice);
      try {
        const { data } = await getSample({ voice });
        const bytes = Uint8Array.from(atob(data.wav), (c) => c.charCodeAt(0));
        url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
        cache.current.set(voice, url);
      } catch (e) {
        setError(friendlyError(e));
        return;
      } finally {
        setLoading(null);
      }
    }
    audio.current = new Audio(url);
    void audio.current.play().catch(() => undefined);
  }

  return (
    <div className="voice-samples">
      <p className="muted small">
        Tap play to hear each voice say a line, then tag how it sounds. Your tags show in the voice
        lists above. The first play of each voice takes a few seconds.
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
              disabled={loading !== null}
              onClick={() => void play(v)}
            >
              {loading === v ? '…' : '▶'}
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
