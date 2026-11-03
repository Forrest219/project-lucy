/**
 * Hive connection configuration model + Lucy unified connection view.
 *
 * Authority: docs/specs/lucy-20261025-v0p25-hive-direct-connection-spec.md §3.2
 * Plan:      docs/plans/2026-10-25-lucy-v0.25-p1-implementation-plan.md §7.2 (H1, H2)
 *
 * Two rules drive the whole shape of this module:
 *
 * 1. **Credentials never live here.** This file holds connection *references*
 *    only (secret paths / keytab references / trust material references). A
 *    plaintext secret in `hive-connections.yaml` would end up in the config
 *    backup, the config audit diff and the customer delivery package, so the
 *    parser rejects any inline credential shape instead of ignoring it.
 *
 * 2. **NONE and NOSASL are different protocols, not one "no auth" branch.**
 *    HS2 `NONE` means the transport carries no SASL negotiation; `NOSASL`
 *    means the SASL layer is explicitly disabled. They need different server
 *    configuration and different failure modes, so they are modelled as two
 *    separate variants of the discriminated union and cannot carry credentials.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse, stringify } from "yaml";
import { safeWriteAtomic } from "../fs-safe.js";
import { loadContentPaths } from "../paths.js";
import { withDisplayWriteBarrier } from "../display-generation.js";
import { withKtxYamlWriteLock } from "../ktx-yaml-write-lock.js";
import type { ConnectionInfo } from "../model.js";

/** Where the committed Hive connection configuration lives (project-root relative). */
export const HIVE_CONNECTIONS_REL_PATH = "webui/config/hive-connections.yaml";

/**
 * Display scopes a Hive connection write invalidates.
 *
 * `C` (connections / project / enabled tables) because the unified connection
 * view changes; `D` (semantic summaries) and `P` (permission display) because
 * the source map is derived from the connection set. `scopesForPath()` does not
 * classify `webui/config/*` (only `access.yaml` is known there), so the write
 * path has to declare the scopes explicitly instead of relying on the helper.
 */
export const HIVE_CONFIG_DISPLAY_SCOPES = ["C", "D", "P"] as const;

export type HiveTransport = "tcp" | "http";

/**
 * Authentication kinds. `none` and `nosasl` are intentionally distinct
 * variants — see the module header.
 */
export type HiveAuthKind = "none" | "nosasl" | "ldap" | "kerberos" | "custom";

export type HiveAuth =
  | { kind: "none" }
  | { kind: "nosasl" }
  | {
      kind: "ldap";
      username?: string;
      /** Reference to the password material. Never the password itself. */
      passwordRef: string;
      baseDn?: string;
      url?: string;
    }
  | {
      kind: "kerberos";
      principal?: string;
      /** Reference to the keytab material. Never key bytes. */
      keytabRef: string;
      realm?: string;
    }
  | {
      kind: "custom";
      mechanism?: string;
      /** Reference to the credential material. Never the credential itself. */
      credentialRef: string;
    };

export type HiveTlsConfig = {
  /** Reference to the trust material (truststore / CA bundle). */
  trustMaterialRef?: string;
  verifyServerCertificate?: boolean;
  protocol?: string;
};

export type HiveConnection = {
  id: string;
  host: string;
  port: number;
  /** Database used when a query does not name one. */
  defaultDatabase?: string;
  /** Databases this connection is allowed to reach. */
  allowedDatabases: string[];
  /**
   * Enabled table scope. Hive physical objects are `database.table`; a bare
   * table name is rejected because it cannot be routed without a database.
   */
  enabledTables: string[];
  transport: HiveTransport;
  /** HTTP path for the `http` transport (e.g. `/cliservice`). */
  httpPath?: string;
  auth: HiveAuth;
  tls?: HiveTlsConfig;
};

export type UnifiedConnectionOrigin = "ktx" | "hive";

export type UnifiedConnection = {
  id: string;
  origin: UnifiedConnectionOrigin;
  driver?: string;
  engine?: string;
  host?: string;
  port?: string;
  database?: string;
  schemas: string[];
  enabledTables: string[];
};

// ── failure shape ────────────────────────────────────────────────────────────

export type HiveConfigFailureReason =
  | "hive_config_unreadable"
  | "hive_config_invalid"
  | "hive_config_secret_inline_forbidden"
  | "hive_connection_id_conflict";

export type HiveConfigResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: HiveConfigFailureReason; detail: string };

// ── parsing helpers ──────────────────────────────────────────────────────────

const CONNECTION_ID_RE = /^[a-z][a-z0-9_-]{0,63}$/;
const DATABASE_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HOST_RE = /^[A-Za-z0-9._:-]+$/;
const REFERENCE_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;
const REFERENCE_MAX_LENGTH = 512;
const MAX_PORT = 65535;

/**
 * A URL that carries its credential in the authority component
 * (`scheme://user:pass@host`).
 *
 * The key-name check below only catches a field literally called `password`.
 * A URL carries the same secret inside its value, so the VALUE has to be
 * inspected too — otherwise `ldap://admin:s3cret@ldap.corp` passes the parser,
 * lands in the config file, is echoed by the admin GET and shows up in the
 * audit diff.
 */
const EMBEDDED_CREDENTIALS_URL_RE = /[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/i;

/**
 * Keys that would carry a secret inline. The parser rejects the whole
 * connection when one of them shows up: silently dropping a plaintext
 * password would make the operator believe authentication is configured.
 */
const INLINE_SECRET_KEYS = new Set([
  "password",
  "passwd",
  "secret",
  "secret_key",
  "secretkey",
  "token",
  "passphrase",
  "keytab",
  "private_key",
  "privatekey",
  "client_secret",
  "access_key",
  "credential",
  "credentials",
  "connection_id",
  "connectionid"
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function recordOf(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

/**
 * A credential reference is a *pointer* to material managed elsewhere
 * (`secret://…`, `file:…`, a path under the secret store). It must not look
 * like inline material, must be bounded in length, and must not contain
 * characters that only appear in a literal secret.
 */
function assertCredentialReference(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HiveConfigError(
      "hive_config_invalid",
      `${label} must be a non-empty credential reference`
    );
  }
  const ref = value.trim();
  if (ref.length > REFERENCE_MAX_LENGTH) {
    throw new HiveConfigError(
      "hive_config_invalid",
      `${label} exceeds the maximum credential reference length`
    );
  }
  if (!REFERENCE_RE.test(ref)) {
    throw new HiveConfigError(
      "hive_config_secret_inline_forbidden",
      `${label} is not a valid credential reference; inline secrets are not accepted`
    );
  }
  return ref;
}

export class HiveConfigError extends Error {
  readonly reason: HiveConfigFailureReason;
  readonly code: string;

  constructor(reason: HiveConfigFailureReason, message: string) {
    super(message);
    this.name = "HiveConfigError";
    this.reason = reason;
    this.code = reason;
  }
}

function assertNoInlineSecrets(value: unknown, trail: string): void {
  if (typeof value === "string") {
    if (EMBEDDED_CREDENTIALS_URL_RE.test(value)) {
      // The message names the FIELD, never the value: the value is the secret.
      throw new HiveConfigError(
        "hive_config_secret_inline_forbidden",
        `Inline credentials in a URL are not allowed (field '${trail || "value"}'); store a credential reference instead`
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoInlineSecrets(item, `${trail}[${index}]`));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.toLowerCase();
    if (INLINE_SECRET_KEYS.has(normalized)) {
      throw new HiveConfigError(
        "hive_config_secret_inline_forbidden",
        `Inline secret field '${trail ? `${trail}.` : ""}${key}' is not allowed; store a credential reference instead`
      );
    }
    assertNoInlineSecrets(child, trail ? `${trail}.${key}` : key);
  }
}

function assertOnlyKeys(record: Record<string, unknown>, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      throw new HiveConfigError(
        "hive_config_invalid",
        `Unknown field '${label ? `${label}.` : ""}${key}'`
      );
    }
  }
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new HiveConfigError("hive_config_invalid", `Field '${key}' must be a string`);
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function optionalBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") {
    throw new HiveConfigError("hive_config_invalid", `Field '${key}' must be a boolean`);
  }
  return value;
}

function optionalStringList(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new HiveConfigError("hive_config_invalid", `Field '${key}' must be a list of strings`);
  }
  return (value as string[]).map((item) => item.trim()).filter((item) => item.length > 0);
}

/** The URL schemes an LDAP endpoint may use. */
const LDAP_URL_PROTOCOLS = new Set(["ldap:", "ldaps:"]);

/**
 * Validate the LDAP endpoint URL.
 *
 * The URL may point at the directory server, but it must not carry an
 * identity or a secret: `ldap://admin:s3cret@ldap.corp` would put a plaintext
 * password into the config file, into the admin GET echo and into the audit
 * diff. The identity belongs in `username`, the secret in `password_ref`.
 *
 * The failure reasons reuse the existing codes: a URL that carries a secret is
 * `hive_config_secret_inline_forbidden`, a URL that is not a usable LDAP
 * endpoint is `hive_config_invalid`.
 */
function assertLdapUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new HiveConfigError(
      "hive_config_invalid",
      "Field 'auth.url' must be a valid ldap:// or ldaps:// URL"
    );
  }
  if (!LDAP_URL_PROTOCOLS.has(parsed.protocol)) {
    throw new HiveConfigError(
      "hive_config_invalid",
      `Field 'auth.url' must use the ldap:// or ldaps:// scheme, got '${parsed.protocol.replace(":", "")}'`
    );
  }
  if (parsed.password) {
    // The message never repeats the URL — the URL IS the secret here.
    throw new HiveConfigError(
      "hive_config_secret_inline_forbidden",
      "Field 'auth.url' must not embed a password; use 'password_ref' instead"
    );
  }
  if (parsed.username) {
    throw new HiveConfigError(
      "hive_config_invalid",
      "Field 'auth.url' must not embed a user name; use the 'username' field instead"
    );
  }
  return value;
}

function parseAuth(raw: unknown): HiveAuth {
  if (!isRecord(raw)) {
    throw new HiveConfigError("hive_config_invalid", "Field 'auth' must be a mapping");
  }
  const kind = optionalString(raw, "kind");
  if (!kind) {
    throw new HiveConfigError("hive_config_invalid", "Field 'auth.kind' is required");
  }
  switch (kind) {
    case "none":
      assertOnlyKeys(raw, ["kind"], "auth");
      return { kind: "none" };
    case "nosasl":
      assertOnlyKeys(raw, ["kind"], "auth");
      return { kind: "nosasl" };
    case "ldap": {
      assertOnlyKeys(raw, ["kind", "username", "password_ref", "base_dn", "url"], "auth");
      const passwordRef = assertCredentialReference(raw.password_ref, "auth.password_ref");
      const url = optionalString(raw, "url");
      return {
        kind: "ldap",
        username: optionalString(raw, "username"),
        passwordRef,
        baseDn: optionalString(raw, "base_dn"),
        url: url === undefined ? undefined : assertLdapUrl(url)
      };
    }
    case "kerberos": {
      assertOnlyKeys(raw, ["kind", "principal", "keytab_ref", "realm"], "auth");
      const keytabRef = assertCredentialReference(raw.keytab_ref, "auth.keytab_ref");
      return {
        kind: "kerberos",
        principal: optionalString(raw, "principal"),
        keytabRef,
        realm: optionalString(raw, "realm")
      };
    }
    case "custom": {
      assertOnlyKeys(raw, ["kind", "mechanism", "credential_ref"], "auth");
      const credentialRef = assertCredentialReference(raw.credential_ref, "auth.credential_ref");
      return {
        kind: "custom",
        mechanism: optionalString(raw, "mechanism"),
        credentialRef
      };
    }
    default:
      throw new HiveConfigError(
        "hive_config_invalid",
        `Unknown auth kind '${kind}'; supported kinds are none, nosasl, ldap, kerberos, custom`
      );
  }
}

function parseTls(raw: unknown): HiveTlsConfig | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!isRecord(raw)) {
    throw new HiveConfigError("hive_config_invalid", "Field 'tls' must be a mapping");
  }
  assertOnlyKeys(
    raw,
    ["trust_material_ref", "verify_server_certificate", "protocol"],
    "tls"
  );
  const trustMaterialRef =
    raw.trust_material_ref === undefined || raw.trust_material_ref === null
      ? undefined
      : assertCredentialReference(raw.trust_material_ref, "tls.trust_material_ref");
  const verify = optionalBoolean(raw, "verify_server_certificate");
  const protocol = optionalString(raw, "protocol");
  if (trustMaterialRef === undefined && verify === undefined && protocol === undefined) {
    return undefined;
  }
  return {
    trustMaterialRef,
    verifyServerCertificate: verify,
    protocol
  };
}

/** Hive physical objects are `database.table`; a bare name cannot be routed. */
function assertQualifiedTable(value: string, label: string): string {
  const parts = value.split(".");
  if (parts.length !== 2 || !parts.every((part) => DATABASE_RE.test(part))) {
    throw new HiveConfigError(
      "hive_config_invalid",
      `${label} must be a qualified 'database.table' name, got '${value}'`
    );
  }
  return value;
}

function parseConnection(id: string, raw: unknown): HiveConnection {
  if (!isRecord(raw)) {
    throw new HiveConfigError("hive_config_invalid", `Connection '${id}' must be a mapping`);
  }
  assertOnlyKeys(
    raw,
    [
      "host",
      "port",
      "default_database",
      "allowed_databases",
      "enabled_tables",
      "transport",
      "http_path",
      "auth",
      "tls"
    ],
    `connections.${id}`
  );

  const host = optionalString(raw, "host");
  if (!host) {
    throw new HiveConfigError("hive_config_invalid", `Connection '${id}' requires 'host'`);
  }
  if (!HOST_RE.test(host)) {
    throw new HiveConfigError(
      "hive_config_invalid",
      `Connection '${id}' has an invalid 'host' value`
    );
  }

  const rawPort = raw.port;
  const port = typeof rawPort === "number" ? rawPort : Number(rawPort);
  if (!Number.isInteger(port) || port <= 0 || port > MAX_PORT) {
    throw new HiveConfigError(
      "hive_config_invalid",
      `Connection '${id}' requires an integer 'port' between 1 and ${MAX_PORT}`
    );
  }

  const transport = optionalString(raw, "transport") ?? "tcp";
  if (transport !== "tcp" && transport !== "http") {
    throw new HiveConfigError(
      "hive_config_invalid",
      `Connection '${id}' has an unknown 'transport' '${transport}'; supported transports are tcp and http`
    );
  }

  const httpPath = optionalString(raw, "http_path");
  if (transport === "http" && !httpPath) {
    throw new HiveConfigError(
      "hive_config_invalid",
      `Connection '${id}' uses the http transport and therefore requires 'http_path'`
    );
  }
  if (transport === "tcp" && httpPath) {
    throw new HiveConfigError(
      "hive_config_invalid",
      `Connection '${id}' uses the tcp transport and must not define 'http_path'`
    );
  }

  const defaultDatabase = optionalString(raw, "default_database");
  if (defaultDatabase && !DATABASE_RE.test(defaultDatabase)) {
    throw new HiveConfigError(
      "hive_config_invalid",
      `Connection '${id}' has an invalid 'default_database' value`
    );
  }

  const allowedDatabases = optionalStringList(raw, "allowed_databases");
  for (const database of allowedDatabases) {
    if (!DATABASE_RE.test(database)) {
      throw new HiveConfigError(
        "hive_config_invalid",
        `Connection '${id}' has an invalid entry in 'allowed_databases'`
      );
    }
  }
  if (defaultDatabase && allowedDatabases.length > 0 && !allowedDatabases.includes(defaultDatabase)) {
    throw new HiveConfigError(
      "hive_config_invalid",
      `Connection '${id}' sets 'default_database' outside 'allowed_databases'`
    );
  }

  const enabledTables = optionalStringList(raw, "enabled_tables");
  for (const table of enabledTables) {
    assertQualifiedTable(table, `Connection '${id}' entry in 'enabled_tables'`);
  }
  if (allowedDatabases.length > 0) {
    for (const table of enabledTables) {
      const database = table.split(".")[0]!;
      if (!allowedDatabases.includes(database)) {
        throw new HiveConfigError(
          "hive_config_invalid",
          `Connection '${id}' enables table '${table}' outside 'allowed_databases'`
        );
      }
    }
  }

  return {
    id,
    host,
    port,
    defaultDatabase,
    allowedDatabases,
    enabledTables,
    transport,
    httpPath,
    auth: parseAuth(raw.auth),
    tls: parseTls(raw.tls)
  };
}

// ── public API ───────────────────────────────────────────────────────────────

export type HiveConnectionsSnapshot = {
  version: number;
  connections: HiveConnection[];
};

/**
 * Parse the raw YAML of `hive-connections.yaml`.
 *
 * Fails closed on: unreadable YAML, unknown fields, unknown auth kinds,
 * inline secrets, out-of-range ports, and enabled tables outside the allowed
 * database scope. A malformed configuration never degrades into "no Hive
 * connections" — that would silently disable governance for a configured
 * connection.
 */
export function parseHiveConnectionsYaml(text: string): HiveConfigResult<HiveConnectionsSnapshot> {
  let parsed: unknown;
  try {
    parsed = parse(text);
  } catch (error) {
    return {
      ok: false,
      reason: "hive_config_invalid",
      detail: error instanceof Error ? error.message : String(error)
    };
  }
  if (parsed === null || parsed === undefined) {
    return { ok: true, value: { version: 1, connections: [] } };
  }
  if (!isRecord(parsed)) {
    return { ok: false, reason: "hive_config_invalid", detail: "Root must be a mapping" };
  }

  try {
    assertOnlyKeys(parsed, ["version", "connections"], "");
    assertNoInlineSecrets(parsed, "");

    const version = parsed.version === undefined ? 1 : parsed.version;
    if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
      throw new HiveConfigError("hive_config_invalid", "Field 'version' must be a positive integer");
    }

    const rawConnections = parsed.connections;
    if (rawConnections === undefined || rawConnections === null) {
      return { ok: true, value: { version, connections: [] } };
    }
    if (!isRecord(rawConnections)) {
      throw new HiveConfigError("hive_config_invalid", "Field 'connections' must be a mapping");
    }

    const connections: HiveConnection[] = [];
    const seen = new Set<string>();
    for (const [id, raw] of Object.entries(rawConnections)) {
      if (!CONNECTION_ID_RE.test(id)) {
        throw new HiveConfigError(
          "hive_config_invalid",
          `Connection id '${id}' must match ${CONNECTION_ID_RE.source}`
        );
      }
      if (seen.has(id)) {
        throw new HiveConfigError(
          "hive_config_invalid",
          `Duplicate connection id '${id}'`
        );
      }
      seen.add(id);
      connections.push(parseConnection(id, raw));
    }
    connections.sort((a, b) => a.id.localeCompare(b.id));
    return { ok: true, value: { version, connections } };
  } catch (error) {
    if (error instanceof HiveConfigError) {
      return { ok: false, reason: error.reason, detail: error.message };
    }
    return {
      ok: false,
      reason: "hive_config_invalid",
      detail: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Read the committed Hive connection configuration.
 *
 * A missing file means "no Hive connection is configured" — that is a valid
 * state, not a failure. A malformed file IS a failure: the caller must not
 * fall back to "there are no Hive connections".
 */
export async function readHiveConnections(
  projectRoot: string
): Promise<HiveConfigResult<HiveConnectionsSnapshot>> {
  const absPath = path.join(projectRoot, HIVE_CONNECTIONS_REL_PATH);
  let text: string;
  try {
    text = await readFile(absPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: true, value: { version: 1, connections: [] } };
    }
    return {
      ok: false,
      reason: "hive_config_unreadable",
      detail: error instanceof Error ? error.message : String(error)
    };
  }
  return parseHiveConnectionsYaml(text);
}

/** Serialize the Hive connection configuration back to YAML. */
export function serializeHiveConnections(connections: HiveConnection[]): string {
  const payload: Record<string, unknown> = { version: 1, connections: {} };
  const bucket = payload.connections as Record<string, unknown>;
  for (const connection of [...connections].sort((a, b) => a.id.localeCompare(b.id))) {
    const entry: Record<string, unknown> = {
      host: connection.host,
      port: connection.port
    };
    if (connection.defaultDatabase) entry.default_database = connection.defaultDatabase;
    if (connection.allowedDatabases.length > 0) entry.allowed_databases = connection.allowedDatabases;
    if (connection.enabledTables.length > 0) entry.enabled_tables = connection.enabledTables;
    entry.transport = connection.transport;
    if (connection.httpPath) entry.http_path = connection.httpPath;
    const auth: Record<string, unknown> = { kind: connection.auth.kind };
    if (connection.auth.kind === "ldap") {
      if (connection.auth.username) auth.username = connection.auth.username;
      auth.password_ref = connection.auth.passwordRef;
      if (connection.auth.baseDn) auth.base_dn = connection.auth.baseDn;
      if (connection.auth.url) auth.url = connection.auth.url;
    } else if (connection.auth.kind === "kerberos") {
      if (connection.auth.principal) auth.principal = connection.auth.principal;
      auth.keytab_ref = connection.auth.keytabRef;
      if (connection.auth.realm) auth.realm = connection.auth.realm;
    } else if (connection.auth.kind === "custom") {
      if (connection.auth.mechanism) auth.mechanism = connection.auth.mechanism;
      auth.credential_ref = connection.auth.credentialRef;
    }
    entry.auth = auth;
    if (connection.tls) {
      const tls: Record<string, unknown> = {};
      if (connection.tls.trustMaterialRef) tls.trust_material_ref = connection.tls.trustMaterialRef;
      if (connection.tls.verifyServerCertificate !== undefined) {
        tls.verify_server_certificate = connection.tls.verifyServerCertificate;
      }
      if (connection.tls.protocol) tls.protocol = connection.tls.protocol;
      entry.tls = tls;
    }
    bucket[connection.id] = entry;
  }
  return stringify(payload, { lineWidth: 0 });
}

/**
 * Hooks the caller plugs into a Hive connection write.
 *
 * The audit lives in the admin layer (`admin/audit.ts` + `admin/config-audit-write.ts`),
 * which pulls in the audit database. This module stays free of that dependency
 * and takes the intent/terminal callbacks instead, so the same write path can
 * be used from a non-audit context without dragging the audit store along.
 */
export type HiveConnectionWriteHooks = {
  /** Called BEFORE the write. Returns the durable intent id. */
  beginIntent?: () => Promise<number | undefined>;
  /** Called AFTER a successful write. */
  completeIntent?: (intentId: number | undefined) => Promise<void>;
  /** Called when the write failed. */
  failIntent?: (intentId: number | undefined, reason: string) => Promise<void>;
};

/**
 * Write the Hive connection configuration.
 *
 * Reuses the single-instance write serialization (`withKtxYamlWriteLock` — the
 * repo-wide in-process write queue) and the display generation barrier, so a
 * concurrent read never observes a half-written configuration and the
 * unified connection view is invalidated exactly once per commit.
 *
 * The lock is NOT reentrant: it is a plain promise chain, so a caller that
 * already holds it must use {@link mutateHiveConnections} (or the internal
 * unlocked writer) instead of nesting another `withKtxYamlWriteLock` — a
 * nested acquisition would wait for the outer one, which waits for the inner
 * one, and the request would deadlock.
 */
export async function writeHiveConnections(
  projectRoot: string,
  connections: HiveConnection[],
  hooks: HiveConnectionWriteHooks = {}
): Promise<{ auditId?: number }> {
  return withKtxYamlWriteLock(() => writeHiveConnectionsLocked(projectRoot, connections, hooks));
}

/**
 * The write half of {@link writeHiveConnections}, without the lock.
 *
 * The caller must already hold the write lock (or be the only writer).
 */
async function writeHiveConnectionsLocked(
  projectRoot: string,
  connections: HiveConnection[],
  hooks: HiveConnectionWriteHooks
): Promise<{ auditId?: number }> {
  const content = serializeHiveConnections(connections);
  // Fail before touching disk if the candidate configuration is invalid.
  const parsed = parseHiveConnectionsYaml(content);
  if (!parsed.ok) {
    throw new HiveConfigError(parsed.reason, parsed.detail);
  }

  const intentId = hooks.beginIntent ? await hooks.beginIntent() : undefined;

  try {
    await withDisplayWriteBarrier(HIVE_CONFIG_DISPLAY_SCOPES, async () => {
      const paths = await loadContentPaths();
      await safeWriteAtomic(paths, projectRoot, HIVE_CONNECTIONS_REL_PATH, content);
    });
  } catch (error) {
    if (hooks.failIntent) {
      await hooks.failIntent(
        intentId,
        error instanceof Error ? error.message : String(error)
      ).catch(() => undefined);
    }
    throw error;
  }

  if (hooks.completeIntent) {
    await hooks.completeIntent(intentId);
  }
  return intentId === undefined ? {} : { auditId: intentId };
}

// ── locked read-modify-write ────────────────────────────────────────────────

/** The failure codes a Hive connection mutation can report. */
export type HiveMutationFailureCode =
  | "hive_config_unreadable"
  | "hive_connection_id_conflict"
  | "hive_connection_not_found";

/**
 * What the mutation decided, given the baseline it was handed.
 *
 * `ok: false` aborts the write: nothing is written and the audit intent is
 * never opened.
 */
export type HiveMutationDecision<T> =
  | { ok: true; value: T; connections: HiveConnection[] }
  | { ok: false; code: HiveMutationFailureCode; message: string };

export type HiveMutationOutcome<T> =
  | { ok: true; value: T; auditId?: number }
  | { ok: false; code: HiveMutationFailureCode; message: string; detail?: string };

export type HiveMutationContext = {
  /** The connections read UNDER the write lock — the merge baseline. */
  current: HiveConnection[];
  /** The connections the mutation wants to write. */
  next: HiveConnection[];
};

/**
 * Read the Hive connections, merge, and write — under ONE lock acquisition.
 *
 * The defect this closes: the lock used to be taken only by the write, so the
 * read happened outside it. Two concurrent upserts both read the same
 * baseline, both merged against it and the second write dropped the first
 * one's connection (a lost update). The Hive configuration has no
 * `expectedVersion` optimistic check like `access.yaml`, so the lock is the
 * only thing standing between the caller and a lost update.
 *
 * The baseline the mutation receives is therefore the one that was read
 * under the lock, and the write happens in the same critical section.
 *
 * The mutation callback runs while the lock is held: it must NOT call
 * {@link writeHiveConnections} (that would take the same non-reentrant lock
 * again and deadlock) — it returns the connections to write instead.
 */
export async function mutateHiveConnections<T>(
  projectRoot: string,
  mutate: (
    current: HiveConnection[]
  ) => HiveMutationDecision<T> | Promise<HiveMutationDecision<T>>,
  hooks?: (context: HiveMutationContext) => HiveConnectionWriteHooks
): Promise<HiveMutationOutcome<T>> {
  return withKtxYamlWriteLock(async () => {
    const current = await readHiveConnections(projectRoot);
    if (!current.ok) {
      return {
        ok: false,
        code: "hive_config_unreadable",
        message: "The Hive connection configuration could not be read",
        detail: current.detail
      };
    }

    const decision = await mutate(current.value.connections);
    if (!decision.ok) {
      return { ok: false, code: decision.code, message: decision.message };
    }

    const context: HiveMutationContext = {
      current: current.value.connections,
      next: decision.connections
    };
    const written = await writeHiveConnectionsLocked(
      projectRoot,
      decision.connections,
      hooks ? hooks(context) : {}
    );
    return { ok: true, value: decision.value, auditId: written.auditId };
  });
}

// ── unified connection view (H2) ─────────────────────────────────────────────

function hiveToUnified(connection: HiveConnection): UnifiedConnection {
  const schemas = connection.allowedDatabases.length > 0
    ? [...connection.allowedDatabases]
    : Array.from(
        new Set(connection.enabledTables.map((table) => table.split(".")[0]!))
      ).sort();
  return {
    id: connection.id,
    origin: "hive",
    driver: "hive",
    engine: "hive",
    host: connection.host,
    port: String(connection.port),
    database: connection.defaultDatabase,
    schemas,
    enabledTables: [...connection.enabledTables]
  };
}

function ktxToUnified(connection: ConnectionInfo): UnifiedConnection {
  return {
    id: connection.id,
    origin: "ktx",
    driver: connection.driver,
    engine: connection.engine,
    host: connection.host,
    port: connection.port,
    database: connection.database,
    schemas: [...connection.schemas],
    enabledTables: [...connection.enabledTables]
  };
}

export type UnifiedConnectionMerge =
  | { ok: true; connections: UnifiedConnection[] }
  | {
      ok: false;
      reason: "hive_connection_id_conflict";
      detail: string;
      conflictingId: string;
      /** Origins that claim the same id — never silently resolved by priority. */
      origins: UnifiedConnectionOrigin[];
    };

/**
 * Merge the KTX connection view and the Hive connection view into one list.
 *
 * Connection IDs are globally unique. When the same ID appears in both
 * sources the merge FAILS: the alternative (overwriting one with the other, or
 * hiding one behind a priority rule) would let a caller address the wrong
 * database without any visible sign.
 */
export function mergeUnifiedConnections(
  ktxConnections: readonly ConnectionInfo[],
  hiveConnections: readonly HiveConnection[]
): UnifiedConnectionMerge {
  const merged: UnifiedConnection[] = [];
  const originsById = new Map<string, UnifiedConnectionOrigin[]>();

  for (const connection of ktxConnections) {
    originsById.set(connection.id, ["ktx"]);
    merged.push(ktxToUnified(connection));
  }
  for (const connection of hiveConnections) {
    const existing = originsById.get(connection.id);
    if (existing) {
      return {
        ok: false,
        reason: "hive_connection_id_conflict",
        conflictingId: connection.id,
        origins: [...existing, "hive"],
        detail: `Connection id '${connection.id}' is declared by both the KTX and the Hive configuration; resolve the conflict instead of overriding one side`
      };
    }
    originsById.set(connection.id, ["hive"]);
    merged.push(hiveToUnified(connection));
  }
  merged.sort((a, b) => a.id.localeCompare(b.id));
  return { ok: true, connections: merged };
}
