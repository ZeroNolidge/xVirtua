import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ReflectionCard } from './ReflectionCard';

describe('ReflectionCard', () => {
  it('a rating, an optional note, optional problems; Done needs only the rating', async () => {
    const onSave = vi.fn(async () => {});
    render(<ReflectionCard first="Ray" onSave={onSave} onSkip={() => {}} />);
    expect(screen.getByText('How did that go with Ray?')).toBeInTheDocument();
    const done = screen.getByRole('button', { name: 'Done' });
    expect(done).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Good' }));
    expect(done).toBeEnabled();
    fireEvent.change(screen.getByLabelText(/One thing you’d do differently/), {
      target: { value: '  Ask about his job sooner. ' },
    });
    // No note box for problems until one is picked.
    expect(screen.queryByLabelText(/What happened/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'The face froze or never showed' }));
    fireEvent.click(screen.getByRole('button', { name: 'Long waits' }));
    fireEvent.click(screen.getByRole('button', { name: 'Long waits' })); // and off again
    fireEvent.change(screen.getByLabelText(/What happened/), {
      target: { value: 'Froze after a few minutes' },
    });
    fireEvent.click(done);
    await vi.waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        rating: 'good',
        note: 'Ask about his job sooner.',
        issues: ['face'],
        issueNote: 'Froze after a few minutes',
      }),
    );
  });

  it('Skip is always there', () => {
    const onSkip = vi.fn();
    render(<ReflectionCard first="Ray" onSave={vi.fn()} onSkip={onSkip} />);
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(onSkip).toHaveBeenCalled();
  });
});
