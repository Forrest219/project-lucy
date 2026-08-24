/**
 * UI paths that must remain reachable without a WebUI admin session.
 * Keep in sync with `isPublicApi` in `webui/server/auth/guard.ts` for Help APIs.
 *
 * Rationale: when auth is required, users who cannot log in still need the
 * system handbook (especially break-glass recovery). Gating `/help` behind
 * login creates a deadlock.
 */
export function isPublicUiPath(pathname: string): boolean {
  return pathname === "/login" || pathname === "/help";
}
