import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BluetoothNote } from './BluetoothNote';

function withHeadset(userAgent: string) {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      enumerateDevices: async () => [
        { kind: 'audioinput', label: 'Bluetooth headset', deviceId: 'b' },
      ],
    },
  });
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);
}
afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
});

describe('BluetoothNote', () => {
  it('on Android: names Android; no "(test)" anywhere', async () => {
    withHeadset('Mozilla/5.0 (Linux; Android 14; Pixel) Chrome/130');
    render(<BluetoothNote first="Ray" />);
    expect(await screen.findByText(/choppy on Android/)).toBeInTheDocument();
    expect(screen.queryByText(/\(test\)/)).toBeNull();
    expect(
      screen.getByRole('checkbox', { name: /Talk into the phone instead:/ }),
    ).toBeInTheDocument();
  });
  it('elsewhere: no mention of Android', async () => {
    withHeadset('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/605');
    render(<BluetoothNote first="Ray" />);
    expect(await screen.findByText(/can make Ray’s voice narrow and choppy\./)).toBeInTheDocument();
    expect(screen.queryByText(/Android/)).toBeNull();
  });
});
