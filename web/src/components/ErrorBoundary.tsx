import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportError } from '../lib/errorReport';

interface State {
  error: Error | null;
}

/** Shows what went wrong instead of a blank screen, so testers can screenshot it. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('App crashed', error, info.componentStack);
    reportError('react.crash', error, {
      componentStack: (info.componentStack ?? '').slice(0, 1500),
    });
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    // Mid-conversation: everything said so far is saved, so offer to continue.
    const inSession = /^\/session\/[^/]+/.exec(window.location.pathname)?.[0];
    return (
      <div className="app">
        <section>
          <h1>Something went wrong</h1>
          <div className="card">
            <p>Sorry, the app hit an error. Your conversation so far is saved.</p>
            <pre className="error-detail">{`${error.name}: ${error.message}\n${(error.stack ?? '').split('\n').slice(1, 6).join('\n')}`}</pre>
            <p className="muted small">A screenshot of this box helps us fix it.</p>
            {inSession && (
              <button className="btn" onClick={() => (window.location.href = inSession)}>
                Pick up where you left off
              </button>
            )}
            <button
              className={inSession ? 'btn btn-secondary' : 'btn'}
              onClick={() => (window.location.href = '/')}
            >
              Back to start
            </button>
          </div>
        </section>
      </div>
    );
  }
}
