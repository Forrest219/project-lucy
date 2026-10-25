/**
 * Lucy v0.25 — L25-05 可选 SMTP 通知: the profile / secret contract.
 *
 * The profile is deployment configuration, not a user setting. It is read once at
 * startup and cached; a change takes effect on restart (Spec §3.2).
 *
 * Two rules shape this module:
 * 1. **The password only ever comes from a separate Secret file.** There is no
 *    inline `password` in the profile and no `LUCY_SMTP_PASSWORD` env var.
 * 2. **A rejected profile never throws the server down.** The caller turns a
 *    failure into `state: "unavailable"`; the application keeps serving.
 */

import { parse as parseYaml } from "yaml";

export const SMTP_PROFILE_FILE_ENV = "LUCY_SMTP_PROFILE_FILE";
export const SMTP_PASSWORD_FILE_ENV = "LUCY_SMTP_PASSWORD_FILE";
export const SMTP_CA_FILE_ENV = "LUCY_SMTP_CA_FILE";

export const SMTP_MAX_RECIPIENTS = 20;
export const SMTP_MAX_ADDRESS_LENGTH = 254;
export const SMTP_MAX_HOST_LENGTH = 253;
export const SMTP_MAX_USERNAME_LENGTH = 256;

/** Closed reason codes — the raw reason never reaches the API or the logs. */
export const SMTP_PROFILE_ERROR_CODES = [
  "smtp_profile_invalid",
  "smtp_secret_unavailable",
  "smtp_ca_unavailable",
  "smtp_auth_incomplete"
] as const;

export type SmtpProfileErrorCode = (typeof SMTP_PROFILE_ERROR_CODES)[number];

export class SmtpProfileError extends Error {
  readonly code: SmtpProfileErrorCode;
  constructor(code: SmtpProfileErrorCode, message: string) {
    super(message);
    this.name = "SmtpProfileError";
    this.code = code;
  }
}

export type SmtpSecurity = "tls" | "starttls";

export type SmtpProfile = {
  enabled: boolean;
  host: string;
  port: number;
  security: SmtpSecurity;
  from: string;
  username?: string;
  recipients: string[];
  notifications: { auditHealth: boolean };
};

/** CR／LF and the other control characters are the header-injection vector. */
const CONTROL_OR_SPACE = /[\s\u0000-\u001f\u007f-\u009f]/;
const LOCAL_PART_RE = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+$/;

function isValidEmailAddress(value: string): boolean {
  if (!value || value.length > SMTP_MAX_ADDRESS_LENGTH) return false;
  if (CONTROL_OR_SPACE.test(value)) return false;
  const at = value.indexOf("@");
  if (at <= 0 || at !== value.lastIndexOf("@")) return false;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (!local || local.length > 64) return false;
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) return false;
  if (!LOCAL_PART_RE.test(local)) return false;
  if (!domain || domain.length > 253) return false;
  if (domain.startsWith("[") || domain.endsWith("]")) {
    return /^\[[0-9A-Fa-f:.]+\]$/.test(domain);
  }
  // A single label is allowed: private SMTP hosts are a real deployment shape.
  return domain
    .split(".")
    .every(
      (label) =>
        label.length > 0 &&
        label.length <= 63 &&
        /^[A-Za-z0-9-]+$/.test(label) &&
        !label.startsWith("-") &&
        !label.endsWith("-")
    );
}

function isValidHost(value: string): boolean {
  if (!value || value.length > SMTP_MAX_HOST_LENGTH) return false;
  if (CONTROL_OR_SPACE.test(value)) return false;
  if (value.includes("://")) return false; // a scheme is not a host
  if (value.includes("/")) return false; // a path is not a host
  if (value.includes("@")) return false; // userinfo is not a host
  if (value.startsWith("[") && value.endsWith("]")) {
    return /^\[[0-9A-Fa-f:.]+\]$/.test(value); // IPv6 literal
  }
  if (value.includes(":")) return false; // the port has its own field
  return value
    .split(".")
    .every(
      (label) =>
        label.length > 0 &&
        label.length <= 63 &&
        /^[A-Za-z0-9-]+$/.test(label) &&
        !label.startsWith("-") &&
        !label.endsWith("-")
    );
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SmtpProfileError("smtp_profile_invalid", `${what} must be an object`);
  }
  return value as Record<string, unknown>;
}

/**
 * Parse and validate the profile document. Throws `SmtpProfileError` with a
 * closed code — the message is for the operator, never for the API response.
 */
export function parseSmtpProfile(raw: string): SmtpProfile {
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch {
    throw new SmtpProfileError("smtp_profile_invalid", "the SMTP profile is not valid YAML");
  }
  const root = asRecord(parsed, "the SMTP profile");

  const enabled = root.enabled === undefined ? false : root.enabled;
  if (typeof enabled !== "boolean") {
    throw new SmtpProfileError("smtp_profile_invalid", "`enabled` must be a boolean");
  }

  const host = root.host;
  if (typeof host !== "string" || !isValidHost(host)) {
    throw new SmtpProfileError("smtp_profile_invalid", "`host` must be a host name or IP address");
  }

  const port = root.port;
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new SmtpProfileError("smtp_profile_invalid", "`port` must be an integer between 1 and 65535");
  }

  const security = root.security;
  if (security !== "tls" && security !== "starttls") {
    throw new SmtpProfileError("smtp_profile_invalid", "`security` must be `tls` or `starttls`");
  }

  const from = root.from;
  if (typeof from !== "string" || !isValidEmailAddress(from)) {
    throw new SmtpProfileError("smtp_profile_invalid", "`from` must be a single email address");
  }

  const rawRecipients = root.recipients;
  if (!Array.isArray(rawRecipients) || rawRecipients.length === 0) {
    throw new SmtpProfileError("smtp_profile_invalid", "`recipients` must list at least one address");
  }
  if (rawRecipients.length > SMTP_MAX_RECIPIENTS) {
    throw new SmtpProfileError("smtp_profile_invalid", `\`recipients\` must not exceed ${SMTP_MAX_RECIPIENTS} entries`);
  }
  const recipients: string[] = [];
  for (const entry of rawRecipients) {
    if (typeof entry !== "string" || !isValidEmailAddress(entry)) {
      throw new SmtpProfileError("smtp_profile_invalid", "`recipients` must contain email addresses only");
    }
    if (!recipients.includes(entry)) recipients.push(entry);
  }
  if (recipients.length === 0) {
    throw new SmtpProfileError("smtp_profile_invalid", "`recipients` must list at least one address");
  }

  const notificationsRaw = root.notifications === undefined ? {} : root.notifications;
  const notifications = asRecord(notificationsRaw, "`notifications`");
  const auditHealth = notifications.auditHealth === undefined ? false : notifications.auditHealth;
  if (typeof auditHealth !== "boolean") {
    throw new SmtpProfileError("smtp_profile_invalid", "`notifications.auditHealth` must be a boolean");
  }

  const username = root.username;
  if (username !== undefined && username !== null) {
    if (typeof username !== "string" || !username.trim() || username.length > SMTP_MAX_USERNAME_LENGTH) {
      throw new SmtpProfileError("smtp_profile_invalid", "`username` must be a non-empty string");
    }
    if (CONTROL_OR_SPACE.test(username)) {
      throw new SmtpProfileError("smtp_profile_invalid", "`username` must not contain whitespace");
    }
  }

  // A profile that carries a secret inline is rejected outright: the password
  // has exactly one home, and it is the Secret file.
  for (const forbidden of ["password", "pass", "secret"]) {
    if (Object.prototype.hasOwnProperty.call(root, forbidden)) {
      throw new SmtpProfileError(
        "smtp_profile_invalid",
        `the SMTP profile must not carry \`${forbidden}\`; the password belongs in the Secret file`
      );
    }
  }

  const profile: SmtpProfile = {
    enabled,
    host,
    port,
    security,
    from,
    recipients,
    notifications: { auditHealth }
  };
  if (typeof username === "string") profile.username = username.trim();
  return profile;
}

/**
 * The password file: read only when a username is configured. The file content is
 * trimmed of trailing newlines only — a password may legitimately contain spaces.
 */
export function parseSmtpPassword(raw: string): string {
  const password = raw.replace(/\r?\n$/, "");
  if (!password) {
    throw new SmtpProfileError("smtp_secret_unavailable", "the SMTP password file is empty");
  }
  if (CONTROL_OR_SPACE.test(password.replace(/ /g, ""))) {
    throw new SmtpProfileError("smtp_secret_unavailable", "the SMTP password file contains control characters");
  }
  return password;
}

/** The private CA file is PEM text; it only appends trust. */
export function parseSmtpCa(raw: string): string {
  const ca = raw.trim();
  if (!ca) {
    throw new SmtpProfileError("smtp_ca_unavailable", "the SMTP CA file is empty");
  }
  if (!ca.includes("-----BEGIN CERTIFICATE-----")) {
    throw new SmtpProfileError("smtp_ca_unavailable", "the SMTP CA file is not a PEM certificate");
  }
  return ca;
}
