import { useEffect, useState } from 'react';
import { isUpdateWaiting, onUpdateWaiting } from '../lib/pwa';

/** "New version — tap to refresh". Refreshing mid-conversation is safe: it picks up where you left off. */
export function UpdateBanner() {
  const [waiting, setWaiting] = useState(isUpdateWaiting);
  useEffect(() => onUpdateWaiting(() => setWaiting(true)), []);
  if (!waiting) return null;
  return (
    <button className="update-banner" onClick={() => window.location.reload()}>
      New version — tap to refresh
    </button>
  );
}
