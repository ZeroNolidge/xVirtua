/**
 * Opens a page as a fresh page load, not an in-app move. After a
 * conversation this drops every audio connection the old one left behind,
 * so on Android the next conversation's sound goes to Bluetooth again
 * (an in-app move kept the old audio routing and played it on the phone).
 */
export const freshPage = {
  open(path: string) {
    window.location.replace(path);
  },
};
