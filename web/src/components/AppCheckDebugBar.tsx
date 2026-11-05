import { useLayoutEffect, useRef, useState } from 'react';
import { appCheckDebugInfo } from '../lib/appCheckDebug';

/**
 * Shown only in App Check debug mode (a test browser): the token, and a Copy
 * button. Its height goes in --debug-bar-h on <body>, so the page, the tab
 * bar and the session controls sit above it instead of under it.
 */
export function AppCheckDebugBar() {
  const { on, token } = appCheckDebugInfo();
  const [copied, setCopied] = useState(false);
  const bar = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = bar.current;
    if (!el) return;
    const body = document.body;
    const measure = () => body.style.setProperty('--debug-bar-h', `${el.offsetHeight}px`);
    body.classList.add('appcheck-debug');
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      body.classList.remove('appcheck-debug');
      body.style.removeProperty('--debug-bar-h');
    };
  }, [on]);

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
    <div className="appcheck-debug-bar" role="status" ref={bar}>
      <span>
        App Check debug mode. Token: <code>{token}</code>
      </span>
      <button type="button" className="btn btn-text btn-inline" onClick={() => void copy()}>
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}
