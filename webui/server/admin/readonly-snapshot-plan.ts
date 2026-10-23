/**
 * Spec 187 (R0) — Read-only snapshot inventory plan.
 *
 * `buildReadonlySnapshotPlan(input)` consumes caller-collected read-only
 * materials — the list of connections, each connection's enabled-table scope,
 * per-file content sha256 fingerprints, and the audit-database snapshot
 * sha256 — and emits a JSON plan that records the serial plan's locked
 * decisions (D1, D2, D3) alongside that inventory. The function never reads
 * disk, never opens a database, never touches the network, and never
 * accepts or returns a password, full bearer token, or full token hash.
 *
 * R0 is inventory only: the plan's `writes` is always an empty array. The
 * plan itself does not propose any write operation. R1 / R2 / T15 do not
 * start here — see the serial plan at
 * `docs/plans/2026-10-18-mcp-audit-serial.md` batches 10–12.
 *
 * Decisions recorded (locked in the serial plan):
 *   D1 — two business tables, no UID sources.
 *   D2 — enabled-table intersection; an empty enabled-table scope does
 *        not fall back to "all tables".
 *   D3 — the final connection id is `mysql-aliyun` (used as the connection
 *        id, the content-root directory name, and the role selector's
 *        `connection` value).
 */

export type ReadonlySnapshotConnectionInput = {
  /** Connection id used by the running instance. D3 pins this to `mysql-aliyun`. */
  id: string;
  /** Logical database name surfaced in catalogs. */
  database: string;
  /**
   * Tables the role layer may touch on this connection. An empty array
   * means "no tables are enabled" — D2 forbids falling back to the
   * full set of physical tables when this list is empty.
   */
  enabledTables: string[];
};

export type ReadonlySnapshotContentFingerprintInput = {
  /** Path of the content file relative to the content root. */
  relativePath: string;
  /** sha256 of the file's bytes, lowercase hex, 64 chars. */
  sha256: string;
};

export type ReadonlySnapshotPlanInput = {
  connections: ReadonlySnapshotConnectionInput[];
  contentFingerprints: ReadonlySnapshotContentFingerprintInput[];
  /**
   * sha256 of the audit-database snapshot file produced by the T13 helper
   * (`snapshotAuditDatabase`). Empty string when no snapshot was produced.
   */
  auditSnapshotSha256: string;
};

export type ReadonlySnapshotDecisionId = "D1" | "D2" | "D3";

export type ReadonlySnapshotDecision = {
  id: ReadonlySnapshotDecisionId;
  /** Concise statement matching §2 of the R0 spec. */
  statement: string;
};

export type ReadonlySnapshotPlan = {
  decisions: ReadonlySnapshotDecision[];
  connections: Array<{
    id: string;
    database: string;
    enabledTables: string[];
  }>;
  contentFingerprints: ReadonlySnapshotContentFingerprintInput[];
  auditSnapshotSha256: string;
  /** Always an empty array — R0 only inventories, it never proposes writes. */
  writes: [];
};

// --------------------------------------------------------------------
// Constants — the serial plan's locked decisions (R0 spec §2).
// --------------------------------------------------------------------

const DECISION_STATEMENTS: Readonly<Record<ReadonlySnapshotDecisionId, string>> = {
  D1: "两张业务表且不含 UID",
  D2: "启用表范围交集",
  D3: "连接 id `mysql-aliyun`"
};

const SHA256_RE = /^[0-9a-f]{64}$/;

/**
 * Field names that must never appear in the input — a defensive wall so
 * the plan cannot accidentally round-trip a password, full bearer token,
 * or full token hash, even when a caller passes a stray key. The walker
 * covers nested objects and array entries.
 */
const FORBIDDEN_FIELD_NAMES: ReadonlySet<string> = new Set([
  // Passwords.
  "password",
  "passwd",
  "pwd",
  // Full bearer / API tokens.
  "token",
  "bearer",
  "access_token",
  "accessToken",
  "refresh_token",
  "refreshToken",
  // Full token hashes.
  "token_hash",
  "tokenHash",
  "client_secret",
  "clientSecret",
  "api_key",
  "apiKey",
  "authorization",
  "auth_header",
  "authHeader"
]);

// --------------------------------------------------------------------
// Defensive walks — reject credentials, validate hashes.
// --------------------------------------------------------------------

function rejectForbiddenFields(value: unknown, location: string): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectForbiddenFields(entry, `${location}[${index}]`));
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_FIELD_NAMES.has(key)) {
      throw new Error(
        `buildReadonlySnapshotPlan: forbidden credential field "${key}" at ${location}`
      );
    }
    rejectForbiddenFields(child, `${location}.${key}`);
  }
}

function assertSha256(value: string, location: string): void {
  if (!SHA256_RE.test(value)) {
    throw new Error(`buildReadonlySnapshotPlan: ${location} must be a 64-char lowercase sha256 hex`);
  }
}

function assertNonEmptyString(value: unknown, location: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`buildReadonlySnapshotPlan: ${location} must be a non-empty string`);
  }
  return value;
}

// --------------------------------------------------------------------
// Plan builder.
// --------------------------------------------------------------------

export function buildReadonlySnapshotPlan(
  input: ReadonlySnapshotPlanInput
): ReadonlySnapshotPlan {
  if (input === null || typeof input !== "object") {
    throw new Error("buildReadonlySnapshotPlan: input is required");
  }
  // Reject any credential-shaped key at any depth before we touch fields.
  rejectForbiddenFields(input, "input");

  if (!Array.isArray(input.connections)) {
    throw new Error("buildReadonlySnapshotPlan: connections must be an array");
  }
  if (!Array.isArray(input.contentFingerprints)) {
    throw new Error("buildReadonlySnapshotPlan: contentFingerprints must be an array");
  }
  if (typeof input.auditSnapshotSha256 !== "string") {
    throw new Error("buildReadonlySnapshotPlan: auditSnapshotSha256 must be a string");
  }

  for (const [index, fingerprint] of input.contentFingerprints.entries()) {
    if (fingerprint === null || typeof fingerprint !== "object") {
      throw new Error(`buildReadonlySnapshotPlan: contentFingerprints[${index}] must be an object`);
    }
    assertNonEmptyString(fingerprint.relativePath, `contentFingerprints[${index}].relativePath`);
    assertSha256(fingerprint.sha256, `contentFingerprints[${index}].sha256`);
  }

  if (input.auditSnapshotSha256.length > 0) {
    assertSha256(input.auditSnapshotSha256, "auditSnapshotSha256");
  }

  for (const [index, connection] of input.connections.entries()) {
    if (connection === null || typeof connection !== "object") {
      throw new Error(`buildReadonlySnapshotPlan: connections[${index}] must be an object`);
    }
    assertNonEmptyString(connection.id, `connections[${index}].id`);
    assertNonEmptyString(connection.database, `connections[${index}].database`);
    if (!Array.isArray(connection.enabledTables)) {
      throw new Error(`buildReadonlySnapshotPlan: connections[${index}].enabledTables must be an array`);
    }
    for (const table of connection.enabledTables) {
      if (typeof table !== "string" || table.length === 0) {
        throw new Error(
          `buildReadonlySnapshotPlan: connections[${index}].enabledTables contains a non-string entry`
        );
      }
    }
  }

  // Stable JSON: sort enabled tables per connection and sort content
  // fingerprints by relative path. Callers serialise the result, so a
  // deterministic order keeps diffs reviewable.
  const connections = input.connections.map((connection) => ({
    id: connection.id,
    database: connection.database,
    enabledTables: [...connection.enabledTables].sort((a, b) => a.localeCompare(b))
  }));
  const contentFingerprints = [...input.contentFingerprints]
    .map((fingerprint) => ({ relativePath: fingerprint.relativePath, sha256: fingerprint.sha256 }))
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  return {
    decisions: [
      { id: "D1", statement: DECISION_STATEMENTS.D1 },
      { id: "D2", statement: DECISION_STATEMENTS.D2 },
      { id: "D3", statement: DECISION_STATEMENTS.D3 }
    ],
    connections,
    contentFingerprints,
    auditSnapshotSha256: input.auditSnapshotSha256,
    writes: []
  };
}