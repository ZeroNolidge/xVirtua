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
    // Details were already sent to our error log (componentDidCatch); never shown here.
    const sessionPath = /^\/session\/[^/]+/.exec(window.location.pathname)?.[0];
    return (
      <div className="app">
        <section>
          {sessionPath ? (
            <>
              <h1>Sorry, that hiccuped</h1>
              <div className="card">
                <p>Your conversation so far is saved.</p>
                <button className="btn" onClick={() => (window.location.href = sessionPath)}>
                  Pick up where you left off
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => (window.location.href = `${sessionPath}/done`)}
                >
                  Get feedback on what you said
                </button>
              </div>
            </>
          ) : (
            <>
              <h1>Sorry, something went wrong</h1>
              <div className="card">
                <p>Please try again. If it keeps happening, let your program director know.</p>
                <button className="btn" onClick={() => (window.location.href = '/')}>
                  Back to start
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    );
  }
}
