/** Where the emailed sign-in link sends people back to. */
export const signInLinkSettings = () => ({
  url: `${window.location.origin}/auth/finish`,
  handleCodeInApp: true,
});
