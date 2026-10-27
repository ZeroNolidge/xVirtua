import { useEffect, useRef, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { LIVE_VOICES, type LiveVoice } from '@plainspeak/shared';
import { functions } from '../../lib/firebase';
import { friendlyError } from '../../lib/api';
import { TAG_LABEL, type VoiceTag } from './voiceTags';

const getSample = httpsCallable<{ voice: LiveVoice }, { voice: string; wav: string }>(
  functions,
  'voiceSample',
);

/**
 * Faculty: hear each GPT-Live voice (a short recording, made once) and tag how
 * it sounds, so the right voice can be picked for each patient.
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
  const urls = useRef(new Map<LiveVoice, string>());
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => () => audio.current?.pause(), []);

  async function play(voice: LiveVoice) {
    setError(null);
    audio.current?.pause();
    // Created inside the tap so phones allow it to play.
    const a = new Audio();
    audio.current = a;
    setPlaying(voice);
    try {
      let url = urls.current.get(voice);
      if (!url) {
        const { data } = await getSample({ voice });
        const bytes = Uint8Array.from(atob(data.wav), (ch) => ch.charCodeAt(0));
        url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
        urls.current.set(voice, url);
      }
      a.src = url;
      a.onended = () => setPlaying((p) => (p === voice ? null : p));
      await a.play();
    } catch (e) {
      setError(friendlyError(e));
      setPlaying(null);
    }
  }

  return (
    <div className="voice-samples">
      <p className="muted small">
        Tap play to hear each voice say a line, then tag how it sounds. Your tags show in the voice
        lists above.
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
