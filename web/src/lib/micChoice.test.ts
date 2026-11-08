import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MIC, bluetoothMicPresent, micConstraints, openMic, setPhoneMicPreferred } from './micChoice';

const dev = (kind: string, label: string, deviceId: string) =>
  ({ kind, label, deviceId, groupId: '' }) as MediaDeviceInfo;

type Gum = (c: MediaStreamConstraints) => Promise<MediaStream>;
function devices(list: MediaDeviceInfo[], getUserMedia: Gum = vi.fn(async () => ({}) as MediaStream)) {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { enumerateDevices: async () => list, getUserMedia },
  });
  return getUserMedia;
}

afterEach(() => {
  localStorage.clear();
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
});

describe('Bluetooth headset microphone', () => {
  const phone = dev('audioinput', 'Speakerphone', 'phone1');
  const bt = dev('audioinput', 'Bluetooth headset', 'bt1');
  const dflt = dev('audioinput', 'Default', 'default');

  it('is noticed from the device list', async () => {
    devices([dflt, phone, bt]);
    expect(await bluetoothMicPresent()).toBe(true);
    devices([dflt, phone, dev('audioinput', 'Wired headset', 'w1')]);
    expect(await bluetoothMicPresent()).toBe(false);
  });

  it('the usual mic unless the resident chose the phone’s and a headset is there', async () => {
    devices([dflt, phone, bt]);
    expect(await micConstraints()).toBe(DEFAULT_MIC);
    setPhoneMicPreferred(true);
    expect(await micConstraints()).toEqual({
      deviceId: { exact: 'phone1' },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    });
    // No headset today: the choice doesn't apply (processing stays on).
    devices([dflt, phone]);
    expect(await micConstraints()).toBe(DEFAULT_MIC);
  });

  it('falls back to the usual mic if the phone’s can’t be opened', async () => {
    setPhoneMicPreferred(true);
    const gum = vi.fn(async (c: MediaStreamConstraints) => {
      if ((c.audio as MediaTrackConstraints).deviceId) throw new Error('OverconstrainedError');
      return {} as MediaStream;
    });
    devices([dflt, phone, bt], gum);
    await openMic();
    expect(gum).toHaveBeenCalledTimes(2);
    expect(gum.mock.calls[1]?.[0]).toEqual({ audio: DEFAULT_MIC });
  });
});
