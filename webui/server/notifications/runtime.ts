/**
 * Lucy v0.25 — L25-05 可选 SMTP 通知: the startup runtime view.
 *
 * Mirrors the OIDC runtime pattern: the profile, the secret and the optional CA
 * are read ONCE at startup and cached. An unauthenticated request never touches
 * the filesystem, and a change takes effect on restart (Spec §3.2).
 *
 * Failures never throw the server down: the view becomes `unavailable` and the
 * application keeps serving (Spec D01).
 */

import { readFile } from "node:fs/promises";
import {
  parseSmtpCa,
  parseSmtpPassword,
  parseSmtpProfile,
  SmtpProfileError,
  SMTP_CA_FILE_ENV,
  SMTP_PASSWORD_FILE_ENV,
  SMTP_PROFILE_FILE_ENV,
  type SmtpProfile
} from "./profile.js";

export type SmtpRuntimeState = "disabled" | "unavailable" | "ok" | "degraded";

export type SmtpRuntimeView = {
  /** Whether notifications are switched on at all. */
  enabled: boolean;
  state: SmtpRuntimeState;
  /** A closed reason code; never a raw file or network message. */
  errorCode: string | null;
  profile: SmtpProfile | null;
  password: string | null;
  caPem: string | null;
};

let cached: SmtpRuntimeView | null = null;
let loading: Promise<SmtpRuntimeView> | null = null;

function disabled(errorCode: string | null = null): SmtpRuntimeView {
  return { enabled: false, state: "disabled", errorCode, profile: null, password: null, caPem: null };
}

function unavailable(errorCode: string): SmtpRuntimeView {
  return { enabled: false, state: "unavailable", errorCode, profile: null, password: null, caPem: null };
}

async function loadRuntimeView(): Promise<SmtpRuntimeView> {
  const profilePath = process.env[SMTP_PROFILE_FILE_ENV]?.trim();
  if (!profilePath) {
    // Not configured: no SMTP, no outbound connection, no behaviour change.
    return disabled();
  }

  let profile: SmtpProfile;
  try {
    profile = parseSmtpProfile(await readFile(profilePath, "utf8"));
  } catch (error) {
    return unavailable(error instanceof SmtpProfileError ? error.code : "smtp_profile_invalid");
  }

  if (!profile.enabled) {
    // Disabled: the password file is NOT read and no worker task is created.
    return { enabled: false, state: "disabled", errorCode: null, profile, password: null, caPem: null };
  }

  let password: string | null = null;
  if (profile.username) {
    const passwordPath = process.env[SMTP_PASSWORD_FILE_ENV]?.trim();
    if (!passwordPath) {
      return unavailable("smtp_auth_incomplete");
    }
    try {
      password = parseSmtpPassword(await readFile(passwordPath, "utf8"));
    } catch (error) {
      return unavailable(error instanceof SmtpProfileError ? error.code : "smtp_secret_unavailable");
    }
  }

  let caPem: string | null = null;
  const caPath = process.env[SMTP_CA_FILE_ENV]?.trim();
  if (caPath) {
    try {
      caPem = parseSmtpCa(await readFile(caPath, "utf8"));
    } catch (error) {
      return unavailable(error instanceof SmtpProfileError ? error.code : "smtp_ca_unavailable");
    }
  }

  return { enabled: true, state: "ok", errorCode: null, profile, password, caPem };
}

/** The startup view. The first call loads and caches; later calls reuse it. */
export async function getSmtpRuntimeView(): Promise<SmtpRuntimeView> {
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

/** Test-only reset; production callers cannot hide a failed configuration. */
export function resetSmtpRuntimeViewForTests(): void {
  cached = null;
  loading = null;
}

/**
 * The status projection. It never carries the password, the username, the host,
 * the from address, or the raw recipient list (Spec §3.2 / §7).
 */
export function smtpRuntimeStatus(view: SmtpRuntimeView): {
  enabled: boolean;
  state: SmtpRuntimeState;
  auditHealth: boolean;
  recipientCount: number;
  errorCode: string | null;
} {
  return {
    enabled: view.enabled,
    state: view.state,
    auditHealth: view.profile?.notifications.auditHealth === true,
    recipientCount: view.profile?.recipients.length ?? 0,
    errorCode: view.errorCode
  };
}
