/**
 * Spec 188 (R1) — restore-candidate preview.
 *
 * `buildRestoreCandidate(current, target)` consumes caller-supplied materials
 * — the current connection, current Schema Manifest physical tables, content
 * fingerprints, and mirror old directories (all collected up front by the
 * caller) — together with the proposed `target` (connection id + two
 * `schema.table` references) and emits a JSON candidate that records the
 * before/after differences for the locked R1 scope:
 *
 *   1. connection id delta,
 *   2. Schema Manifest entries to keep (only the two target tables),
 *   3. overlay relative paths to keep (only those two tables),
 *   4. role selector `connection` rewritten to `mysql-aliyun`,
 *   5. mirror directories under the old connection id tagged as
 *      `mirror_only` (never `delete`),
 *   6. the Schema Manifest entries that already exist but are not part of
 *      the target — they go to `droppedManifestTables` and the candidate
 *      does NOT widen the target back to four tables.
 *
 * The candidate is a preview only — its `apply` field is locked to `false`
 * until operators apply it during R2. The function never reads disk, never
 * connects to a database, and accepts / returns no password, no full bearer
 * token, and no full token hash.
 *
 * Decisions applied (locked in the serial plan):
 *   D1 — restore scope is two business tables; UID-named sources are
 *        rejected; the target is not widened to four even when more tables
 *        already live in the Manifest.
 *   D2 — handled upstream (effective source = enabled scope intersection);
 *        R1 only records the keep/drop split.
 *   D3 — final connection id is `mysql-aliyun`. R1 rejects any candidate
 *        whose `target.connectionId` is not `mysql-aliyun`.
 */

import type { ReadonlySnapshotPlan } from "./readonly-snapshot-plan.js";

/** D1–D3 decision identifiers shared with the R0 inventory. */
const DECISION_IDS = ["D1", "D2", "D3"] as const;

// --------------------------------------------------------------------
// Public types.
// --------------------------------------------------------------------

/**
 * Current connection — the part the caller already read from `ktx.yaml`
 * (R0 plan inventory). `id` may differ from the target's `mysql-aliyun` so
 * the candidate records the rename.
 */
export type RestoreCurrentConnection = {
  /** Connection id in the current snapshot (may be the old name before D3). */
  id: string;
  /** Logical database name surfaced in catalogs. */
  database: string;
  /** Tables this connection currently enables on the role layer. */
  enabledTables: string[];
};

/**
 * One Schema Manifest physical table currently published under the
 * content root. The `manifestPath` is the relative path of the schema file
 * under `semantic-layer/<conn>/_schema/<schema>.yaml` — multiple physical
 * tables can share the same file (one schema file holds many sources).
 */
export type RestoreCurrentManifestTable = {
  /** `schema.table` form (e.g. `fin.fin_ledger`). */
  physicalTable: string;
  /** Relative path of the schema YAML under the content root. */
  manifestPath: string;
};

/** Caller-supplied content fingerprint — `relativePath` + 64-char sha256. */
export type RestoreCurrentContentFingerprint = {
  relativePath: string;
  sha256: string;
};

/**
 * A mirror directory keyed by the old connection id. The candidate never
 * declares these for deletion — only `mirror_only`.
 */
export type RestoreCurrentMirrorDirectory = {
  /** Relative path of the mirror directory under the content root. */
  relativePath: string;
  /** Connection id that originally owned the directory. */
  connectionId: string;
};

/**
 * Caller-supplied current snapshot. Matches the shape the R0 inventory
 * produces plus the Schema Manifest physical tables the operator already
 * collected (R1 does not read the manifest — it accepts it).
 */
export type RestoreCurrent = {
  connection: RestoreCurrentConnection;
  /** Schema Manifest physical tables currently published. */
  manifestTables: RestoreCurrentManifestTable[];
  /** Caller-supplied content fingerprints (relative path + sha256). */
  contentFingerprints: RestoreCurrentContentFingerprint[];
  /** Caller-supplied mirror old directories. Optional. */
  mirrorOldDirectories?: RestoreCurrentMirrorDirectory[];
};

/**
 * Proposed restore target. R1 only accepts candidates whose target
 * connection id is `mysql-aliyun` and whose `tables` list contains exactly
 * two `schema.table` identifiers, none of which contain `uid` in either
 * the full name or the source-name portion.
 */
export type RestoreTarget = {
  /** The target connection id. Always `mysql-aliyun` after D3. */
  connectionId: string;
  /**
   * Exactly two `schema.table` identifiers. Rejected when the length is
   * anything else, when the format is invalid, or when any name contains
   * `uid` (case-insensitive) anywhere in the full or source-only form.
   */
  tables: string[];
};

/** Connection id before / after the candidate. `after` is always `mysql-aliyun`. */
export type RestoreConnectionDiff = {
  before: string;
  after: "mysql-aliyun";
};

/** A Schema Manifest physical table the candidate keeps. */
export type RestoreKeptManifestTable = {
  /** `schema.table` form (e.g. `fin.fin_ledger`). */
  physicalTable: string;
  /** Relative path of the schema YAML under the content root. */
  manifestPath: string;
};

/** An overlay file path the candidate keeps. */
export type RestoreKeptOverlay = {
  /** `schema.table` form (e.g. `fin.fin_ledger`). */
  physicalTable: string;
  /** Relative path of the overlay YAML (`semantic-layer/<conn>/<source>.yaml`). */
  overlayPath: string;
};

/** A Schema Manifest physical table that already exists but is not in target. */
export type RestoreDroppedManifestTable = {
  physicalTable: string;
  manifestPath: string;
};

/** A mirror directory under the old connection id. The action is locked to `mirror_only`. */
export type RestoreMirrorOldDirectory = {
  relativePath: string;
  connectionId: string;
  /** Always `mirror_only`. The candidate never declares mirror deletion. */
  action: "mirror_only";
};

/**
 * The full R1 candidate preview. `apply` is locked to `false` until R2
 * deliberately applies the candidate; consumers branch on it before any
 * write.
 */
export type RestoreCandidate = {
  /** Locked to `false` — the candidate is a preview, not an apply-set. */
  apply: false;
  connection: RestoreConnectionDiff;
  /** Schema Manifest tables the target asks to keep — exactly two. */
  keptManifestTables: RestoreKeptManifestTable[];
  /** Overlay file paths the target asks to keep — exactly two. */
  keptOverlayPaths: RestoreKeptOverlay[];
  /**
   * Schema Manifest tables present today but not in target. Kept here so
   * the operator can see what was set aside; the candidate does NOT
   * silently expand the target back to four.
   */
  droppedManifestTables: RestoreDroppedManifestTable[];
  /** Locked to `mysql-aliyun` after D3. */
  roleSelectorConnection: "mysql-aliyun";
  /** Mirror directories under the old connection id, action locked to `mirror_only`. */
  mirrorOldDirectories: RestoreMirrorOldDirectory[];
};

// --------------------------------------------------------------------
// Errors.
// --------------------------------------------------------------------

/**
 * Spec 188 R1 §2 — rejects invalid candidates. Caller-side rejections live
 * on `code = "RESTORE_CANDIDATE_TARGET_INVALID"` with status 400; input-side
 * rejections (missing fields, forbidden credential shapes) live on
 * `code = "RESTORE_CANDIDATE_INPUT_INVALID"`.
 */
export class RestoreCandidateInvalidError extends Error {
  code: "RESTORE_CANDIDATE_TARGET_INVALID" | "RESTORE_CANDIDATE_INPUT_INVALID";
  statusCode: number;
  detail: { reasons?: string[] };

  constructor(
    message: string,
    options: {
      code: RestoreCandidateInvalidError["code"];
      statusCode?: number;
      reasons?: string[];
    }
  ) {
    super(message);
    this.name = "RestoreCandidateInvalidError";
    this.code = options.code;
    this.statusCode = options.statusCode ?? 400;
    this.detail = options.reasons ? { reasons: [...options.reasons] } : {};
  }
}

// --------------------------------------------------------------------
// Constants — locked decisions R1 enforces.
// --------------------------------------------------------------------

/** Final connection id per D3. */
export const RESTORE_CONNECTION_ID = "mysql-aliyun";

/** R1 fixed restore scope per D1. */
export const RESTORE_TABLE_COUNT = 2;

/** R1 D1 — reject any candidate whose name (or source-only portion) contains this substring (case-insensitive). */
export const RESTORE_REJECTED_NAME_SUBSTRING = "uid";

// --------------------------------------------------------------------
// Forbidden field walker — same defensive wall as R0.
// --------------------------------------------------------------------

/** Field names that must never appear in the input or output of R1. */
const FORBIDDEN_FIELD_NAMES: ReadonlySet<string> = new Set([
  "password",
  "passwd",
  "pwd",
  "token",
  "bearer",
  "access_token",
  "accessToken",
  "refresh_token",
  "refreshToken",
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

function rejectForbiddenFields(value: unknown, location: string): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectForbiddenFields(entry, `${location}[${index}]`));
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_FIELD_NAMES.has(key)) {
      throw new RestoreCandidateInvalidError(
        `buildRestoreCandidate: forbidden credential field "${key}" at ${location}`,
        { code: "RESTORE_CANDIDATE_INPUT_INVALID" }
      );
    }
    rejectForbiddenFields(child, `${location}.${key}`);
  }
}

// --------------------------------------------------------------------
// Helpers.
// --------------------------------------------------------------------

const SHA256_RE = /^[0-9a-f]{64}$/;

function assertNonEmptyString(value: unknown, location: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new RestoreCandidateInvalidError(
      `buildRestoreCandidate: ${location} must be a non-empty string`,
      { code: "RESTORE_CANDIDATE_INPUT_INVALID" }
    );
  }
  return value;
}

function assertSha256(value: string, location: string): void {
  if (!SHA256_RE.test(value)) {
    throw new RestoreCandidateInvalidError(
      `buildRestoreCandidate: ${location} must be a 64-char lowercase sha256 hex`,
      { code: "RESTORE_CANDIDATE_INPUT_INVALID" }
    );
  }
}

/** `schema.table` token — `[a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*`. */
const SCHEMA_DOT_TABLE_RE = /^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Parse a `schema.table` identifier into `{ schema, table }`. Always returns
 * the segment after the last dot as `table` so "uid" matches the source
 * name only (`fin.fin_uid_dirty` → table = `fin_uid_dirty`).
 */
function splitSchemaTable(value: string): { schema: string; table: string } {
  const lastDot = value.lastIndexOf(".");
  return {
    schema: value.slice(0, lastDot),
    table: value.slice(lastDot + 1)
  };
}

/** True when any token in `tables` is malformed or contains `uid` (case-insensitive). */
function rejectUidOrMalformed(tables: string[]): void {
  const reasons: string[] = [];
  for (const [index, table] of tables.entries()) {
    if (typeof table !== "string") {
      reasons.push(`tables[${index}] must be a string in schema.table form`);
      continue;
    }
    if (!SCHEMA_DOT_TABLE_RE.test(table)) {
      reasons.push(`tables[${index}] '${table}' must match schema.table form`);
      continue;
    }
    const normalized = table.toLowerCase();
    if (normalized.includes(RESTORE_REJECTED_NAME_SUBSTRING)) {
      reasons.push(`tables[${index}] '${table}' contains forbidden substring '${RESTORE_REJECTED_NAME_SUBSTRING}'`);
      continue;
    }
    const { table: sourceName } = splitSchemaTable(table);
    if (sourceName.toLowerCase().includes(RESTORE_REJECTED_NAME_SUBSTRING)) {
      reasons.push(
        `tables[${index}] source name '${sourceName}' contains forbidden substring '${RESTORE_REJECTED_NAME_SUBSTRING}'`
      );
    }
  }
  if (reasons.length > 0) {
    throw new RestoreCandidateInvalidError(
      `buildRestoreCandidate: target tables rejected: ${reasons.join("; ")}`,
      { code: "RESTORE_CANDIDATE_TARGET_INVALID", reasons }
    );
  }
}

/** Stable sort by `physicalTable`, ties broken by `relativePath` / `manifestPath`. */
function sortByTable<T extends { physicalTable: string } & Record<string, unknown>>(
  entries: T[]
): T[] {
  return [...entries].sort((a, b) => {
    const byTable = a.physicalTable.localeCompare(b.physicalTable);
    if (byTable !== 0) return byTable;
    const aPath = typeof a.manifestPath === "string" ? a.manifestPath : "";
    const bPath = typeof b.manifestPath === "string" ? b.manifestPath : "";
    return aPath.localeCompare(bPath);
  });
}

// --------------------------------------------------------------------
// Input validator.
// --------------------------------------------------------------------

function assertArray(value: unknown, location: string): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw new RestoreCandidateInvalidError(
      `buildRestoreCandidate: ${location} must be an array`,
      { code: "RESTORE_CANDIDATE_INPUT_INVALID" }
    );
  }
}

function assertObject(
  value: unknown,
  location: string
): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new RestoreCandidateInvalidError(
      `buildRestoreCandidate: ${location} must be an object`,
      { code: "RESTORE_CANDIDATE_INPUT_INVALID" }
    );
  }
}

function validateCurrent(input: unknown): asserts input is RestoreCurrent {
  assertObject(input, "current");
  const current = input as Record<string, unknown>;

  assertObject(current.connection, "current.connection");
  const conn = current.connection as Record<string, unknown>;
  assertNonEmptyString(conn.id, "current.connection.id");
  assertNonEmptyString(conn.database, "current.connection.database");
  assertArray(conn.enabledTables, "current.connection.enabledTables");
  for (const [index, table] of (conn.enabledTables as unknown[]).entries()) {
    if (typeof table !== "string" || table.length === 0) {
      throw new RestoreCandidateInvalidError(
        `buildRestoreCandidate: current.connection.enabledTables[${index}] must be a non-empty string`,
        { code: "RESTORE_CANDIDATE_INPUT_INVALID" }
      );
    }
  }

  assertArray(current.manifestTables, "current.manifestTables");
  for (const [index, entry] of (current.manifestTables as unknown[]).entries()) {
    assertObject(entry, `current.manifestTables[${index}]`);
    const row = entry as Record<string, unknown>;
    assertNonEmptyString(row.physicalTable, `current.manifestTables[${index}].physicalTable`);
    assertNonEmptyString(row.manifestPath, `current.manifestTables[${index}].manifestPath`);
  }

  assertArray(current.contentFingerprints, "current.contentFingerprints");
  for (const [index, fp] of (current.contentFingerprints as unknown[]).entries()) {
    assertObject(fp, `current.contentFingerprints[${index}]`);
    const row = fp as Record<string, unknown>;
    assertNonEmptyString(row.relativePath, `current.contentFingerprints[${index}].relativePath`);
    assertSha256(row.sha256 as string, `current.contentFingerprints[${index}].sha256`);
  }

  if (current.mirrorOldDirectories !== undefined) {
    assertArray(current.mirrorOldDirectories, "current.mirrorOldDirectories");
    for (const [index, dir] of (current.mirrorOldDirectories as unknown[]).entries()) {
      assertObject(dir, `current.mirrorOldDirectories[${index}]`);
      const row = dir as Record<string, unknown>;
      assertNonEmptyString(row.relativePath, `current.mirrorOldDirectories[${index}].relativePath`);
      assertNonEmptyString(row.connectionId, `current.mirrorOldDirectories[${index}].connectionId`);
    }
  }
}

function validateTarget(input: unknown): asserts input is { connectionId: string; tables: string[] } {
  assertObject(input, "target");
  const target = input as Record<string, unknown>;

  if (typeof target.connectionId !== "string" || target.connectionId.length === 0) {
    throw new RestoreCandidateInvalidError(
      "buildRestoreCandidate: target.connectionId must be a non-empty string",
      { code: "RESTORE_CANDIDATE_INPUT_INVALID" }
    );
  }
  assertArray(target.tables, "target.tables");
}

// --------------------------------------------------------------------
// Builder.
// --------------------------------------------------------------------

/**
 * Spec 188 R1 — pure candidate builder. Reads only from the two arguments;
 * never reads disk or touches a database. Always returns `apply: false`.
 */
export function buildRestoreCandidate(
  current: unknown,
  target: unknown
): RestoreCandidate {
  // Defensive wall first — never echo a credential-shaped field even when
  // a caller passes a stray key.
  rejectForbiddenFields(current, "current");
  rejectForbiddenFields(target, "target");

  validateCurrent(current);
  validateTarget(target);

  // ── Target preflight (R1 §2) ─────────────────────────────────────────────
  // D1 enforces `tables.length === RESTORE_TABLE_COUNT` and rejects UID-named
  // sources. We do these checks before D3 so the caller sees the right
  // failure mode.
  if (target.tables.length !== RESTORE_TABLE_COUNT) {
    throw new RestoreCandidateInvalidError(
      `buildRestoreCandidate: target.tables must contain exactly ${RESTORE_TABLE_COUNT} schema.table entries (saw ${target.tables.length})`,
      {
        code: "RESTORE_CANDIDATE_TARGET_INVALID",
        reasons: [`tables.length=${target.tables.length} (expected ${RESTORE_TABLE_COUNT})`]
      }
    );
  }
  if (target.connectionId !== RESTORE_CONNECTION_ID) {
    throw new RestoreCandidateInvalidError(
      `buildRestoreCandidate: target.connectionId must be '${RESTORE_CONNECTION_ID}' (saw '${target.connectionId}')`,
      {
        code: "RESTORE_CANDIDATE_TARGET_INVALID",
        reasons: [
          `target.connectionId='${target.connectionId}' (expected '${RESTORE_CONNECTION_ID}')`
        ]
      }
    );
  }
  rejectUidOrMalformed(target.tables);

  // ── Keep / drop split (R1 §2) ────────────────────────────────────────────
  const wantedTables = new Set(target.tables);
  const keptManifestTables: RestoreKeptManifestTable[] = [];
  const droppedManifestTables: RestoreDroppedManifestTable[] = [];
  for (const entry of current.manifestTables) {
    if (wantedTables.has(entry.physicalTable)) {
      keptManifestTables.push({
        physicalTable: entry.physicalTable,
        manifestPath: entry.manifestPath
      });
    } else {
      droppedManifestTables.push({
        physicalTable: entry.physicalTable,
        manifestPath: entry.manifestPath
      });
    }
  }
  const sortedKept = sortByTable(keptManifestTables);
  const sortedDropped = sortByTable(droppedManifestTables);

  // R1 forbids silently widening the target when more tables exist in the
  // Manifest than the target asks for. `droppedManifestTables` is the
  // explicit, diff-friendly record.
  if (sortedKept.length !== RESTORE_TABLE_COUNT) {
    throw new RestoreCandidateInvalidError(
      `buildRestoreCandidate: kept Manifest tables must equal ${RESTORE_TABLE_COUNT} (saw ${sortedKept.length}); tables in target that are missing from current Manifest: ${target.tables
        .filter((table) => !current.manifestTables.some((row) => row.physicalTable === table))
        .join(", ")}`,
      {
        code: "RESTORE_CANDIDATE_TARGET_INVALID",
        reasons: [
          `kept.length=${sortedKept.length} (expected ${RESTORE_TABLE_COUNT})`,
          "table(s) in target not present in current Manifest — candidates must not silently widen target"
        ]
      }
    );
  }

  // ── Overlay keep list (R1 §2) ────────────────────────────────────────────
  // The candidate records the overlay relative paths the target keeps.
  // Each kept physicalTable maps to one overlay file under
  // `semantic-layer/<conn>/<source>.yaml`. We pair the kept manifest entry
  // with the synthesised overlay path for the target connection id; the
  // caller can verify the synthesis matches a fingerprint in their input.
  const keptOverlayPaths: RestoreKeptOverlay[] = sortedKept.map((entry) => {
    const { table: sourceName } = splitSchemaTable(entry.physicalTable);
    return {
      physicalTable: entry.physicalTable,
      overlayPath: `semantic-layer/${target.connectionId}/${sourceName}.yaml`
    };
  });

  // ── Mirror old directories (R1 §2) ───────────────────────────────────────
  const mirrorOldDirectories: RestoreMirrorOldDirectory[] = (current.mirrorOldDirectories ?? [])
    .map((dir) => ({
      relativePath: dir.relativePath,
      connectionId: dir.connectionId,
      action: "mirror_only" as const
    }))
    .sort((a, b) => {
      const byPath = a.relativePath.localeCompare(b.relativePath);
      return byPath !== 0 ? byPath : a.connectionId.localeCompare(b.connectionId);
    });

  return {
    apply: false,
    connection: { before: current.connection.id, after: RESTORE_CONNECTION_ID },
    keptManifestTables: sortedKept,
    keptOverlayPaths,
    droppedManifestTables: sortedDropped,
    roleSelectorConnection: RESTORE_CONNECTION_ID,
    mirrorOldDirectories
  };
}

/**
 * Convenience helper — caller has an R0 plan in hand and wants to feed the
 * same materials into `buildRestoreCandidate`. Not part of the spec text;
 * keeps the two helpers composable without making R1 depend on R0's IO.
 */
export function buildRestoreCandidateFromSnapshotPlan(
  plan: ReadonlySnapshotPlan,
  target: unknown,
  extra?: {
    manifestTables?: RestoreCurrentManifestTable[];
    mirrorOldDirectories?: RestoreCurrentMirrorDirectory[];
  }
): RestoreCandidate {
  const connection = plan.connections[0];
  if (!connection) {
    throw new RestoreCandidateInvalidError(
      "buildRestoreCandidateFromSnapshotPlan: R0 plan has no connections — refuse to infer current state",
      { code: "RESTORE_CANDIDATE_INPUT_INVALID" }
    );
  }
  return buildRestoreCandidate(
    {
      connection: {
        id: connection.id,
        database: connection.database,
        enabledTables: [...connection.enabledTables]
      },
      manifestTables: extra?.manifestTables ?? [],
      contentFingerprints: plan.contentFingerprints.map((fp) => ({
        relativePath: fp.relativePath,
        sha256: fp.sha256
      })),
      mirrorOldDirectories: extra?.mirrorOldDirectories
    },
    target
  );
}

// Re-export D1–D3 decision identifiers so downstream tools can refer to the
// same convention without depending on the R0 module.
export { DECISION_IDS };
