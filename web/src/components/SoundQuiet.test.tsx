import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SoundQuiet } from './SoundQuiet';
import { freshPage } from '../lib/freshPage';

const ua = (s: string) => vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(s);

describe('SoundQuiet', () => {
  afterEach(() => vi.restoreAllMocks());

  it('on Android: explains the earpiece and reloads into the same conversation', () => {
    ua('Mozilla/5.0 (Linux; Android 14) Chrome/157');
    const open = vi.spyOn(freshPage, 'open').mockImplementation(() => undefined);
    render(<SoundQuiet sessionId="s1" first="Ray" />);
    fireEvent.click(screen.getByRole('button', { name: 'Sound quiet?' }));
    expect(screen.getByText(/Ray’s voice is faint/)).toBeInTheDocument();
    expect(screen.getByText(/car or headset was on Bluetooth/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reload and continue' }));
    expect(open).toHaveBeenCalledWith('/session/s1');
  });

  it('elsewhere: nothing', () => {
    ua('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Safari');
    render(<SoundQuiet sessionId="s1" first="Ray" />);
    expect(screen.queryByRole('button', { name: 'Sound quiet?' })).toBeNull();
  });
});
