import { useState } from 'react';
import { appCheckDebugInfo } from '../lib/appCheckDebug';

/** Shown only in App Check debug mode (a test browser): the token, and a Copy button. */
export function AppCheckDebugBar() {
  const { on, token } = appCheckDebugInfo();
  const [copied, setCopied] = useState(false);
  if (!on || !token) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // No clipboard access: the token is on screen to copy by hand.
    }
  };
  return (
    <div className="appcheck-debug-bar" role="status">
      <span>
        App Check debug mode. Token: <code>{token}</code>
      </span>
      <button type="button" className="btn btn-text btn-inline" onClick={() => void copy()}>
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}
