import { registerSW } from 'virtual:pwa-register';

let updateWaiting = false;
const inConversation = () => /^\/session\/[^/]+$/.test(window.location.pathname);

/**
 * New app versions activate in the background. Reloading mid-conversation
 * would wipe the session, so the reload waits until the user leaves it.
 */
export function setupPwa() {
  registerSW({
    immediate: true,
    onNeedReload() {
      if (inConversation()) updateWaiting = true;
      else window.location.reload();
    },
  });
}

/** Call on navigation: applies a waiting update once it's safe. */
export function applyWaitingUpdate() {
  if (updateWaiting && !inConversation()) window.location.reload();
}
