import { useEffect, useState } from 'react';

/**
 * Bluetooth headsets and the microphone. On Android, the moment a web page
 * opens a Bluetooth headset's mic, the phone switches the headset to its
 * "phone call" profile: narrow, mono, telephone-quality sound, and often
 * choppy. No web page can choose the profile. What works: listen on the
 * headset but talk into the phone's own mic, with the browser's own sound
 * processing off (that processing is what tells Android "this is a call").
 */

const PHONE_MIC_KEY = 'ps.phoneMic';

/** The resident chose to talk into the phone instead of the headset's mic. */
export function phoneMicPreferred(): boolean {
  try {
    return localStorage.getItem(PHONE_MIC_KEY) === '1';
  } catch {
    return false;
  }
}

export function setPhoneMicPreferred(on: boolean) {
  try {
    if (on) localStorage.setItem(PHONE_MIC_KEY, '1');
    else localStorage.removeItem(PHONE_MIC_KEY);
  } catch {
    // Storage blocked: the choice just doesn't carry over.
  }
}

const BLUETOOTH = /bluetooth|\bbt\b|airpods|buds|\bble\b/i;

/** The microphones the browser lists (labels only once the mic has been allowed). */
async function inputs(): Promise<MediaDeviceInfo[]> {
  try {
    const all = await navigator.mediaDevices?.enumerateDevices?.();
    return (all ?? []).filter((d) => d.kind === 'audioinput');
  } catch {
    return [];
  }
}

/** A Bluetooth headset's microphone is among the inputs. */
export async function bluetoothMicPresent(): Promise<boolean> {
  return (await inputs()).some((d) => BLUETOOTH.test(d.label));
}

/** The phone's own mic (or a wired one): anything that isn't Bluetooth or the "default" alias. */
function phoneMicId(list: MediaDeviceInfo[]): string | null {
  const own = list.filter(
    (d) => d.deviceId && !BLUETOOTH.test(d.label) && !/^(default|communications)$/i.test(d.deviceId),
  );
  const builtIn = own.find((d) => /speaker|built|phone|internal/i.test(d.label));
  return (builtIn ?? own[0])?.deviceId ?? null;
}

export const DEFAULT_MIC: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

/**
 * How to ask for the mic. The phone's own mic (processing off, so Android
 * leaves the headset in its good profile) only when the resident chose it
 * and a Bluetooth mic is actually present; otherwise the usual mic.
 */
export async function micConstraints(): Promise<MediaTrackConstraints> {
  if (!phoneMicPreferred()) return DEFAULT_MIC;
  const list = await inputs();
  if (!list.some((d) => BLUETOOTH.test(d.label))) return DEFAULT_MIC;
  const id = phoneMicId(list);
  if (!id) return DEFAULT_MIC;
  return {
    deviceId: { exact: id },
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  };
}

/** Opens the mic the resident wants; if that one can't be opened, the usual one. */
export async function openMic(): Promise<MediaStream> {
  const wanted = await micConstraints();
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: wanted });
  } catch (e) {
    if (wanted === DEFAULT_MIC) throw e;
    return navigator.mediaDevices.getUserMedia({ audio: DEFAULT_MIC });
  }
}

/** Whether a Bluetooth mic is present (checked now, and again when devices change) and the choice. */
export function useBluetoothMic(): {
  present: boolean;
  phoneMic: boolean;
  setPhoneMic: (on: boolean) => void;
} {
  const [present, setPresent] = useState(false);
  const [phoneMic, setPhoneMicState] = useState(phoneMicPreferred);
  useEffect(() => {
    let live = true;
    const check = () => void bluetoothMicPresent().then((p) => live && setPresent(p));
    check();
    const devices = navigator.mediaDevices;
    devices?.addEventListener?.('devicechange', check);
    return () => {
      live = false;
      devices?.removeEventListener?.('devicechange', check);
    };
  }, []);
  return {
    present,
    phoneMic,
    setPhoneMic: (on) => {
      setPhoneMicPreferred(on);
      setPhoneMicState(on);
    },
  };
}
