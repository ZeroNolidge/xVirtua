import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const reportError = vi.fn();
vi.mock('../lib/errorReport', () => ({ reportError: (...a: unknown[]) => reportError(...a) }));
const { ErrorBoundary } = await import('./ErrorBoundary');

function Boom(): never {
  throw new Error('kaboom');
}

describe('ErrorBoundary', () => {
  it('shows the error instead of a blank screen and reports it', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText(/Error: kaboom/)).toBeInTheDocument();
    expect(reportError).toHaveBeenCalledWith('react.crash', expect.any(Error), expect.anything());
  });
});
