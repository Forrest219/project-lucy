const SHA_RE = /^[0-9a-f]{40}$/;

declare const __LUCY_BUILD_GIT_SHA__: string | undefined;
declare const __LUCY_BUILD_GIT_DIRTY__: string | undefined;

const injectedSha = typeof __LUCY_BUILD_GIT_SHA__ === "string" ? __LUCY_BUILD_GIT_SHA__.trim() : "";

/** Full source commit inlined at bundle build, or `unknown`. */
export const LUCY_GIT_SHA: string = SHA_RE.test(injectedSha) ? injectedSha : "unknown";

export const LUCY_GIT_DIRTY: boolean = LUCY_GIT_SHA !== "unknown" && __LUCY_BUILD_GIT_DIRTY__ === "1";

/** Sidebar label: `e8863b8`, `e8863b8-dirty`, or `unknown`. */
export function formatLucyRevisionLabel(sha: string = LUCY_GIT_SHA, dirty: boolean = LUCY_GIT_DIRTY): string {
  if (!SHA_RE.test(sha)) return "unknown";
  const short = sha.slice(0, 7);
  return dirty ? `${short}-dirty` : short;
}

export function lucyRevisionTitle(sha: string = LUCY_GIT_SHA, dirty: boolean = LUCY_GIT_DIRTY): string {
  if (!SHA_RE.test(sha)) return "unknown";
  return dirty ? `${sha} dirty` : sha;
}
