import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const reportError = vi.fn();
vi.mock('../lib/errorReport', () => ({ reportError: (...a: unknown[]) => reportError(...a) }));
const { ErrorBoundary } = await import('./ErrorBoundary');

function Boom(): never {
  throw new Error('kaboom secret-code-123');
}

function renderAt(path: string) {
  window.history.pushState({}, '', path);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  return render(
    <ErrorBoundary>
      <Boom />
    </ErrorBoundary>,
  );
}

describe('ErrorBoundary', () => {
  it('in a conversation: says it is saved, offers to continue or get feedback, shows no raw error', () => {
    renderAt('/session/abc123');
    expect(screen.getByText('Your conversation so far is saved.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pick up where you left off' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Get feedback on what you said' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/kaboom|secret-code/)).toBeNull();
    // Details still reach the error log.
    expect(reportError).toHaveBeenCalledWith('react.crash', expect.any(Error), expect.anything());
  });

  it('elsewhere: a calm message, no raw error', () => {
    renderAt('/progress');
    expect(screen.getByText('Sorry, something went wrong')).toBeInTheDocument();
    expect(screen.queryByText(/kaboom/)).toBeNull();
  });
});
