import { useBluetoothMic } from '../lib/micChoice';

/**
 * Shown on the ready card when a Bluetooth headset's mic is present: why the
 * sound may be poor, and the choice to talk into the phone instead.
 */
export function BluetoothNote({ first = 'the patient' }: { first: string | undefined }) {
  const bt = useBluetoothMic();
  if (!bt.present) return null;
  const android = /android/i.test(navigator.userAgent);
  return (
    <div className="bluetooth-note">
      <p className="muted small">
        {android
          ? `Bluetooth headset: its microphone makes ${first}’s voice narrow and choppy on Android. `
          : `Bluetooth headset: its microphone can make ${first}’s voice narrow and choppy. `}
        For the best sound, use the phone’s speaker or wired earphones.
      </p>
      <label className="check small">
        <input
          type="checkbox"
          checked={bt.phoneMic}
          onChange={(e) => bt.setPhoneMic(e.target.checked)}
        />
        <span>
          Talk into the phone instead: you listen on the headset, and the phone’s own mic picks you
          up.
        </span>
      </label>
    </div>
  );
}
