/**
 * Explicit-logout signal.
 *
 * The login page may tell a user they left Lucy, but ONLY when they actually
 * logged out. An expired session or a deep link lands on the same page and
 * must not claim a logout (Spec §7.1).
 *
 * The signal lives in session storage: it survives the redirect that follows
 * the logout and dies with the tab.
 */

export const LOGGED_OUT_FLAG = "lucy.loggedOut";

/** Records that the session ended on purpose. */
export function markLoggedOut(): void {
  try {
    window.sessionStorage.setItem(LOGGED_OUT_FLAG, "1");
  } catch {
    // Storage may be unavailable (private mode, blocked cookies); the notice is
    // then simply not shown, which is better than a wrong one.
  }
}

/** Reads and clears the flag. Returns true at most once per logout. */
export function consumeLoggedOut(): boolean {
  try {
    if (window.sessionStorage.getItem(LOGGED_OUT_FLAG) === "1") {
      window.sessionStorage.removeItem(LOGGED_OUT_FLAG);
      return true;
    }
  } catch {
    // Same as above: no storage, no notice.
  }
  return false;
}
