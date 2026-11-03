import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { parse } from "yaml";
import { canonicalOidcProfileJson, parseOidcProfile, type OidcProfile } from "./oidc-profile.js";
import { resolveCookieSecure } from "./deployment-mode.js";

/**
 * Startup-time OIDC runtime view (L25-06 Spec §4.3).
 *
 * The profile and the client secret are read exactly once per process. The public
 * view carries no secret: the secret only ever lives in this module's memory and
 * is handed to the token exchange. `GET /api/auth/status` is unauthenticated, so
 * the login methods must come from this cache — the request path never reads a
 * file. A changed file only takes effect after a restart; this release ships no
 * watcher, no polling and no hot-reload endpoint.
 */

export const OIDC_CONFIG_FILE_ENV = "LUCY_OIDC_CONFIG_FILE";
export const OIDC_CLIENT_SECRET_FILE_ENV = "LUCY_OIDC_CLIENT_SECRET_FILE";

/**
 * Acceptable modes for the client secret file.
 *
 * 0440 / 0640 are accepted on purpose: the delivered Chart mounts the Secret
 * with `defaultMode: 0440` and the pod sets `fsGroup: 10001`, so the file is
 * read as `root:10001` mode 0440 — and a runtime that only accepted 0400/0600
 * would silently disable OIDC on every real customer deployment. The rule that
 * matters is that the file is never readable by "other".
 *
 * Spec §4.2 was realigned with this on 2026-10-26 (v0.3-implementation-alignment).
 */
const ALLOWED_SECRET_MODES = new Set([0o400, 0o440, 0o600, 0o640]);

export type OidcRuntimeView = {
  /** True only when the profile AND the client secret file are both valid. */
  enabled: boolean;
  profile: OidcProfile | null;
  /** Digest of the canonical profile (never contains the client secret). */
  profileDigest: string | null;
  /** In-process only. Never serialized, logged, audited or returned to a client. */
  clientSecret: string | null;
  /** Non-sensitive reason the runtime is disabled; safe for an owner-facing health line. */
  configError: string | null;
};

const DISABLED = (configError: string | null): OidcRuntimeView => ({
  enabled: false,
  profile: null,
  profileDigest: null,
  clientSecret: null,
  configError
});

let cached: OidcRuntimeView | null = null;
let loading: Promise<OidcRuntimeView> | null = null;

/** Test-only: forget the cached view so the next read re-loads from disk. */
export function resetOidcRuntimeCache(): void {
  cached = null;
  loading = null;
}

/** The client secret file must carry a single trailing newline at most. */
export function normalizeClientSecret(raw: string): string {
  return raw.replace(/\r?\n$/, "");
}

async function readClientSecretFile(filePath: string): Promise<string> {
  const info = await stat(filePath);
  const mode = info.mode & 0o777;
  if (!ALLOWED_SECRET_MODES.has(mode)) {
    throw new Error(`client secret file mode must be 0400, 0440, 0600 or 0640 (got ${mode.toString(8)})`);
  }
  const text = await readFile(filePath, "utf8");
  const secret = normalizeClientSecret(text);
  if (!secret) throw new Error("client secret file is empty");
  return secret;
}

async function loadRuntimeView(): Promise<OidcRuntimeView> {
  const configPath = process.env[OIDC_CONFIG_FILE_ENV]?.trim();
  if (!configPath) return DISABLED(null); // Not configured: OIDC stays off, local login is untouched.

  // Spec §4.1: OIDC needs an HTTPS public origin and a Secure callback cookie.
  // A deployment that serves non-Secure cookies cannot complete the flow, so it
  // is refused here rather than failing every login in the browser.
  if (!resolveCookieSecure().secure) {
    return DISABLED("the deployment serves non-Secure cookies; single sign-on requires HTTPS");
  }

  const secretPath = process.env[OIDC_CLIENT_SECRET_FILE_ENV]?.trim();
  if (!secretPath) return DISABLED("client secret file is not configured");

  let profile: OidcProfile;
  try {
    const raw = await readFile(configPath, "utf8");
    profile = parseOidcProfile(parse(raw));
  } catch (error) {
    return DISABLED(error instanceof Error ? error.message : "profile is invalid");
  }

  let secret: string;
  try {
    secret = await readClientSecretFile(secretPath);
  } catch (error) {
    return DISABLED(error instanceof Error ? error.message : "client secret file is unavailable");
  }

  return {
    enabled: true,
    profile,
    profileDigest: createHash("sha256").update(canonicalOidcProfileJson(profile)).digest("hex"),
    clientSecret: secret,
    configError: null
  };
}

/**
 * The startup view. The first call loads and caches; every later call returns the
 * same view, so an unauthenticated endpoint can derive the login methods without
 * touching the filesystem.
 */
export async function getStartupOidcRuntimeView(): Promise<OidcRuntimeView> {
  if (cached) return cached;
  loading ??= loadRuntimeView()
    .then((view) => {
      cached = view;
      return view;
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}
