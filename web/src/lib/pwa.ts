import { registerSW } from 'virtual:pwa-register';

let updateWaiting = false;
const listeners = new Set<() => void>();
const inConversation = () => /^\/session\/[^/]+$/.test(window.location.pathname);

/** True once a new version is ready but we held the reload (mid-conversation). */
export const isUpdateWaiting = () => updateWaiting;
export function onUpdateWaiting(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/**
 * New app versions take over as soon as they're installed (skipWaiting +
 * clientsClaim in the service worker). Outside a conversation the page reloads
 * right away; during one we show "New version — tap to refresh" instead.
 * The app also checks for a new version every 30 minutes and whenever it
 * comes back to the foreground (iPhone home-screen apps rarely check on their own).
 */
export function setupPwa() {
  // A new version was deployed and an old page asked for a file that's gone:
  // load the new version (never mid-conversation).
  window.addEventListener('vite:preloadError', (e) => {
    if (inConversation()) return;
    e.preventDefault();
    window.location.reload();
  });
  registerSW({
    immediate: true,
    onNeedReload() {
      if (!inConversation()) return window.location.reload();
      updateWaiting = true;
      for (const fn of listeners) fn();
    },
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      const check = () => void reg.update().catch(() => undefined);
      window.setInterval(check, 30 * 60_000);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
    },
  });
}

/** Call on navigation: applies a waiting update once it's safe. */
export function applyWaitingUpdate() {
  if (updateWaiting && !inConversation()) window.location.reload();
}
