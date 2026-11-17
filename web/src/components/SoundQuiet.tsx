import { useState } from 'react';
import { freshPage } from '../lib/freshPage';

/** Android only: Chrome treats the conversation like a phone call and routes its sound. */
export const onAndroid = () => /android/i.test(navigator.userAgent);

/**
 * Android sometimes plays the patient through the earpiece, very quietly,
 * after a car or headset was on Bluetooth: Chrome treats the conversation
 * like a phone call and keeps that route. A page can't pick the speaker,
 * but a fresh page load resets it, and the conversation picks up where it
 * left off.
 */
export function SoundQuiet({
  sessionId,
  first = 'the patient',
}: {
  sessionId: string;
  first: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  if (!onAndroid()) return null;
  return (
    <>
      <button className="btn btn-text btn-inline" onClick={() => setOpen((o) => !o)}>
        Sound quiet?
      </button>
      {open && (
        <div className="notice sound-quiet" role="status">
          <p>
            If {first}’s voice is faint, the phone is playing it through the earpiece: that happens
            after a car or headset was on Bluetooth. Reloading fixes the sound, and your
            conversation picks up where you left off.
          </p>
          <div className="session-buttons">
            <button
              className="btn btn-inline"
              onClick={() => freshPage.open(`/session/${sessionId}`)}
            >
              Reload and continue
            </button>
            <button className="btn btn-text btn-inline" onClick={() => setOpen(false)}>
              Never mind
            </button>
          </div>
        </div>
      )}
    </>
  );
}
