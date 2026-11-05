import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

let info = { on: true, token: 'tok-123' as string | null };
vi.mock('../lib/appCheckDebug', () => ({ appCheckDebugInfo: () => info }));
const { AppCheckDebugBar } = await import('./AppCheckDebugBar');

describe('App Check debug bar', () => {
  afterEach(() => vi.restoreAllMocks());

  it('pushes the page and the bottom controls above itself, and tidies up after', () => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(38);
    const { unmount } = render(<AppCheckDebugBar />);
    expect(screen.getByText('tok-123')).toBeInTheDocument();
    expect(document.body).toHaveClass('appcheck-debug');
    expect(document.body.style.getPropertyValue('--debug-bar-h')).toBe('38px');
    unmount();
    expect(document.body).not.toHaveClass('appcheck-debug');
    expect(document.body.style.getPropertyValue('--debug-bar-h')).toBe('');
  });

  it('shows nothing and changes nothing for normal users', () => {
    info = { on: false, token: null };
    render(<AppCheckDebugBar />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(document.body).not.toHaveClass('appcheck-debug');
  });
});
