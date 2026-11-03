// M19 — Semantic Asset Self-Service Publish And Export
//
// Responsibilities (split between this file and `semantic-asset-export.ts`):
//   1. Classify multi-file YAML uploads (schemaManifest / semanticSource).
//   2. Compute target paths strictly server-side; never trust client paths.
//   3. Build a staging project, run `ktx sl validate` as a hard gate, then
//      atomically promote to the formal PVC and kick off async reindex.
//   4. Persist release records to `.ktx-ui/semantic-asset-releases.json` and
//      keep validation snapshots in `.ktx-ui/semantic-asset-snapshots/` so the
//      publish endpoint is stateless and re-runnable.
//
// Hard rules baked into this module (see spec §3.2 / §3.3 / §3.4 / §5):
//   - Staging must never contain `.ktx/secrets/**`.
//   - `ktx sl validate` is the gate; we never touch formal files before it
//     passes for every changed source.
//   - Promote writes to a temp file in the same directory then renames.
//   - Reindex runs after promote but the publish HTTP response must return
//     `accepted: true` + `reindexing` immediately.
//   - Staging directories are removed in `finally`; opportunistic GC removes
//     any directory older than 1 hour.
//   - Dry-Run unified diff uses pure JS (the `diff` library), never `diff`.
//   - Snapshots do NOT retain raw YAML content in the release sidecar; the
//     snapshot sidecar is separate and only used to hand off to publish.

import { createHash, randomUUID } from "node:crypto";
import { gunzipSync, inflateRawSync } from "node:zlib";
import {
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { parseDocument } from "yaml";
import { createTwoFilesPatch } from "diff";

type YamlDocument = ReturnType<typeof parseDocument>;
import { readProject } from "./project";
import { assertSafeTarget } from "./catalog-assets";
import {
  PUBLISH_COORDINATOR_LOCK_REL,
  acquirePublishCoordinatorLock,
  formatPublishWindowBusy,
  publishLockOwnedBy,
  readPublishCoordinatorLock,
  releasePublishCoordinatorLock,
  updatePublishCoordinatorLockPayload,
  type PublishLockHolder,
  type PublishWindowPhase
} from "./publish-coordinator.js";
import {
  completeRecoveryJournal,
  createRecoveryJournal,
  isRecoveryRequired,
  markRecoveryEntryApplied,
  markRecoveryJournalActivationPending,
  markRecoveryJournalBlocked,
  markRecoveryJournalFilesSaved,
  restoreRecoveryJournal,
  syncRuntimeMirror
} from "./semantic-recovery-journal.js";
import {
  listLiveIdempotencyReleaseIds,
  readSemanticIdempotencyKey,
  registerSemanticIdempotencyKey,
  SemanticIdempotencyCapacityError,
  SemanticIdempotencyConflictError
} from "./semantic-idempotency.js";
import {
  assetKindForTarget,
  writeSemanticReleaseSnapshot,
  SemanticReleaseSnapshotError
} from "./semantic-release-snapshots.js";
import {
  recomputeSemanticPlanDigest,
  resolveSemanticInstanceId
} from "./semantic-scopes.js";
import { computeBatchPlanDigestInput } from "./semantic-batch-service.js";
import { SEMANTIC_BATCH_LIMITS } from "./semantic-limits.js";
import { buildSemanticModelIndex } from "./semantic-identity.js";
import {
  advancePublishBaseline,
  capturePublishConsumption,
  collectRetainedBlobDigests,
  detectPublishConsumptionDrift,
  listPublishAttempts,
  prunePublishBlobs,
  PublishBaselineConflictError,
  readPublishBaseline,
  writePublishAttempt,
  type PublishAttempt,
  type PublishConsumptionSnapshot
} from "./publish-workbench-state.js";
import { runSemanticTableCheck } from "./semantic-checks.js";
import { changedFiles } from "./diff.js";
import { ForbiddenPathError } from "./fs-safe";
import { reindexProject, validateSource, type Issue, type ValidationResult } from "./ktx";
import { reloadCatalog } from "./catalog-reload";
import { resolveContentPaths } from "./paths";
import { recordConfigChange } from "./admin/audit.js";
import { isSemanticLayerJunkName } from "./semantic-layer-junk";
import { sanitizeSemanticSourceYaml } from "./semantic-overlay-sanitize";
import {
  checkColumnTypeContract,
  evaluatePublishGate,
  validatePublishExemption,
  type PublishExemptionAudit,
  type PublishGateViolation
} from "./publish-gate";

// ─── Public types (mirror of `webui/src/lib/types.ts`) ─────────────────────

export type SemanticAssetKind = "schemaManifest" | "semanticSource" | "wiki" | "eval";

export type SemanticAssetWarningCode =
  | "TARGET_EXISTS"
  | "EMPTY_MANIFEST"
  | "TABLE_SCHEMA_MISMATCH"
  | "UNKNOWN_MANIFEST_SHAPE"
  | "PUBLISH_LOCKED"
  | "STRIPPED_MANIFEST_COLUMN_KEYS";

export type SemanticAssetErrorCode =
  | "UNKNOWN_CONNECTION"
  | "SCHEMA_NOT_CONFIGURED"
  | "DUPLICATE_FILENAME"
  | "INVALID_FILENAME"
  | "FILE_TOO_LARGE"
  | "PACKAGE_PARSE_FAILED"
  | "YAML_PARSE_FAILED"
  | "INVALID_MANIFEST"
  | "UNSAFE_SOURCE_NAME"
  | "OVERLAY_MISSING_TABLE"
  | "UNKNOWN_SHAPE"
  | "PATH_NOT_ALLOWED"
  | "VALIDATION_SNAPSHOT_NOT_FOUND"
  | "VALIDATION_GATE_FAILED"
  /** Spec 162 §8 / SC-24 — a failing TS/Python contract check. */
  | "CONTRACT_VIOLATION"
  | "PUBLISH_IN_PROGRESS"
  | "REINDEX_IN_PROGRESS"
  /**
   * Spec `lucy-20261030-publish-workbench-three-column-spec.md` §6 — the
   * confirmation was bound to a content version and the content has moved on.
   * The batch keeps its pending range; the operator must re-check.
   */
  | "PUBLISH_CONTENT_VERSION_CHANGED"
  /** Lucy v0.25 / L25-11 §7.1–§7.2 (D3) — an unresolved semantic recovery journal closes publishing and manual reindex. */
  | "semantic_recovery_required"
  /**
   * Lucy v0.25 / L25-11 §7.2 (D14) — the plan digest the confirmation was
   * bound to no longer matches the plan rebuilt from the current disk state.
   */
  | "SEMANTIC_PLAN_DIGEST_MISMATCH"
  /**
   * Lucy v0.25 / L25-11 §7.2 (D15) — the same idempotency key was replayed with
   * a DIFFERENT plan.
   */
  | "SEMANTIC_IDEMPOTENCY_CONFLICT"
  /**
   * Lucy v0.25 / L25-11 §7.2 (D15) — the idempotency key is required for a
   * batch import.
   */
  | "SEMANTIC_IDEMPOTENCY_KEY_REQUIRED"
  /**
   * Lucy v0.25 / L25-11 §7.2 (D15) — the store still holds 500 keys that have
   * not reached 24 hours. The new intent is refused instead of evicting them.
   */
  | "SEMANTIC_IDEMPOTENCY_CAPACITY"
  /** L25-15 — the pre-release snapshot could not be persisted. No formal file was written. */
  | "semantic_snapshot_unavailable"
  /** L25-15 — another content batch is still promoting, reindexing, or waiting on its terminal audit. */
  | "semantic_publish_busy";

export type SemanticAssetWarning = {
  code: SemanticAssetWarningCode;
  message: string;
  filePath?: string;
};

export type SemanticAssetError = {
  code: SemanticAssetErrorCode;
  message: string;
  filePath?: string;
  line?: number;
  column?: number;
};

export type SemanticAssetFilePreview = {
  originalFilename: string;
  kind: SemanticAssetKind;
  targetPath: string;
  exists: boolean;
  sizeBytes: number;
  sha256: string;
  connectionId?: string;
  schema?: string;
  sourceName?: string;
  physicalTable?: string;
  warnings: SemanticAssetWarning[];
};

export type SemanticAssetChangedSource = {
  connectionId: string;
  sourceName: string;
};

export type SemanticAssetValidateRequest = {
  files: Array<{ filename: string; content: string }>;
  packages?: Array<{ filename: string; contentBase64: string }>;
  defaultConnectionId?: string;
  defaultSchema?: string;
};

export type SemanticAssetValidateResponse = {
  valid: boolean;
  validationId: string;
  files: SemanticAssetFilePreview[];
  changedSources: SemanticAssetChangedSource[];
  diff: string;
  warnings: SemanticAssetWarning[];
  errors: SemanticAssetError[];
};

export type SemanticAssetReleaseStatus =
  | "blocked"
  | "promoting"
  | "promote_failed"
  | "reindexing"
  | "published"
  | "reindex_failed";

export type SemanticAssetReleaseFile = {
  targetPath: string;
  kind: SemanticAssetKind;
  sha256: string;
  overwritten: boolean;
};

export type SemanticAssetValidationRow = {
  connectionId: string;
  sourceName: string;
  ok: boolean;
  exitCode: number;
  stdout?: string;
  stderr?: string;
  issues: Array<{ message: string; filePath?: string; line?: number; column?: number }>;
};

export type SemanticAssetReindexRecord = {
  ok: boolean;
  exitCode: number;
  stdout?: string;
  stderr?: string;
};

export type SemanticAssetReleaseTrigger = "webui_publish" | "webui_manual_reindex" | "webui_restore";

export type SemanticAssetReleaseRecord = {
  id: string;
  createdAt: string;
  actor: string;
  status: SemanticAssetReleaseStatus;
  trigger?: SemanticAssetReleaseTrigger;
  connectionIds: string[];
  files: SemanticAssetReleaseFile[];
  changedSources: SemanticAssetChangedSource[];
  diff?: string;
  validation: {
    ok: boolean;
    results: SemanticAssetValidationRow[];
  };
  reindex?: SemanticAssetReindexRecord;
  /**
   * Spec 162 §8 / SC-24 — the TS/Python contract gate decision, including any
   * exemption that was considered and why it did or did not apply.
   */
  contractGate?: {
    violations: PublishGateViolation[];
    /** The exemption that applied, or null when none did. */
    waived: PublishExemptionAudit | null;
    blocking: PublishGateViolation[];
    rejectedReason?: string;
  };
  /**
   * Lucy v0.25 / L25-11 §7.1 (D19) — a recovery obligation is open for this
   * release. `undefined` means "legacy record, unknown", NOT "false".
   */
  recoveryRequired?: boolean;
  /**
   * Lucy v0.25 / L25-11 §7.1 (D19) — whether the activation is CONFIRMED.
   * A legacy `published` record is never upgraded to `confirmed`.
   */
  activationStatus?: "unconfirmed" | "confirmed" | "unknown";
  /** The index attempt that produced the current status (L25-11 §7.2, D20). */
  attemptId?: string;
  /** The plan digest the confirmation was bound to (L25-11 §7.2, D14). */
  planDigest?: string;
  /** The batch this release came from (L25-11 §5). */
  batchId?: string;
  /** The scope snapshot this release came from (L25-11 §4.2). */
  scopeId?: string;
  /** The client idempotency key that produced this release (L25-11 §7.2, D15). */
  idempotencyKey?: string;
  /** L25-15 — this batch's own pre-write snapshot. Missing means unknown, not "has a snapshot". */
  snapshotId?: string;
  /** L25-15 — set only on a restore batch. The source release is left unchanged. */
  restoreOfReleaseId?: string;
  restoreSourceSnapshotId?: string;
  restorePlanDigest?: string;
  /**
   * L25-15 — the terminal audit has not been re-read yet.
   * Public projections must say 生效待确认 while this is true.
   */
  terminalAuditPending?: boolean;
  /** L25-15 — force rebuild when the batch's semantic deletion set is non-empty. */
  reindexMode?: "incremental" | "force";
  recoveryJournalId?: string;
  /**
   * L25-15 — the index scope confirmation object of a restore batch.
   *
   * An index retry is independent of the content restore: it confirms the
   * index scope (the files ktx scans, the mirror sync write set and the
   * index mode) without recomputing a content restore plan. The retry is
   * only allowed while this object still matches the current scope.
   */
  restoreIndexScope?: {
    scope: string[];
    /** The restore write set — excluded from the drift list, like the preview. */
    restoreWriteSet: string[];
    mirrorSyncWriteSet: Array<{
      contentRelPath: string;
      contentDigest: string | null;
      siblingDigest: string | null;
    }>;
    reindexMode: "incremental" | "force";
    scopeDigest: string;
  };
};

export type SemanticAssetReleasesResponse = {
  records: SemanticAssetReleaseRecord[];
  /** Total matching records before limit/offset (Spec 113). */
  total: number;
};

export type SemanticAssetReleaseListQuery = {
  since?: string;
  until?: string;
  trigger?: SemanticAssetReleaseTrigger;
  reindexStatus?: "success" | "failed" | "running" | "not_run";
  actor?: string;
  limit?: number;
  offset?: number;
  /**
   * Spec `lucy-20261030-publish-workbench-three-column-spec.md` §6 — keep only
   * the batches that carried a BUSINESS change. A plain index maintenance run
   * (no files, no sources, no connections) is not a business batch and must
   * not occupy a slot in the workbench's "最近发布" summary.
   *
   * The filter runs on the SERVER, before the sort and the limit, so a
   * maintenance run never pushes a real batch out of the newest five.
   */
  businessChangesOnly?: boolean;
};

export type SemanticAssetReleaseStatusResponse = {
  release: SemanticAssetReleaseRecord;
};

export type SemanticAssetPublishRequest = {
  validationId: string;
  /**
   * @deprecated Lucy v0.25 / L25-11 §7.2 — the global overwrite boolean is
   * REPLACED by `planDigest`. It is still accepted for a snapshot that has no
   * batch state (a single-file legacy import), but a batch import MUST be
   * confirmed with the plan digest it was previewed with.
   */
  confirmOverwrite?: boolean;
  /**
   * Lucy v0.25 / L25-11 §7.2 (D14) — the digest of the COMPLETE plan the
   * operator confirmed. It covers the candidates, the exact target set, every
   * target's expected digest (or its `absent` marker) and the overwrite set.
   */
  planDigest?: string;
  /**
   * The EXACT overwrite set the confirmation covers (L25-11 §7.2). A changed
   * set invalidates the confirmation.
   */
  overwriteTargets?: string[];
  /**
   * Lucy v0.25 / L25-11 §7.2 (D15) — the client-side idempotency key. The
   * server persists the intent (bound to the plan digest and the release id)
   * BEFORE any formal effect, so a retry after a disconnect returns the same
   * release and never writes twice.
   */
  idempotencyKey?: string;
  /**
   * Spec 162 §8 / SC-24 — time-boxed, audited waiver for a failing TS/Python
   * contract check. It is never a way to switch the gate off: operator,
   * reason and expiry are mandatory and an expiry that has passed waives
   * nothing.
   */
  exemption?: {
    operator: string;
    reason: string;
    expiresAt: string;
    checkIds: string[];
    connectionId?: string;
  };
};

export type SemanticAssetPublishResponse = {
  accepted: boolean;
  release: SemanticAssetReleaseRecord;
};

// ─── Internal helpers ──────────────────────────────────────────────────────

/**
 * ★ Lucy v0.25 / L25-11 §5 (D6): the import limits are the SHARED definition.
 * The old 50-YAML / 3 MiB pair was a second, divergent vocabulary — the export
 * allowed 200 files / 16 MiB while the import allowed 50 / 3 MiB, so a package
 * Lucy itself produced could not be re-imported.
 */
const MAX_FILE_BYTES = SEMANTIC_BATCH_LIMITS.maxSingleYamlBytes;
const MAX_PACKAGE_BYTES = SEMANTIC_BATCH_LIMITS.maxUnpackedBytes;
const MAX_YAML_ENTRIES = SEMANTIC_BATCH_LIMITS.maxYamlEntries;
const MAX_PACKAGE_DEPTH = 6;
const MAX_RELEASE_RECORDS = 100;
const MAX_SNAPSHOTS = 50;const SIDECAR_RELEASES_REL = ".ktx-ui/semantic-asset-releases.json";
const SNAPSHOTS_DIR_REL = ".ktx-ui/semantic-asset-snapshots";
const STAGING_DIR_REL = ".ktx-ui/staging/semantic-publish";
const PUBLISH_LOCK_REL = PUBLISH_COORDINATOR_LOCK_REL;
const DEFAULT_STAGING_TTL_MS = 60 * 60 * 1000;
/** Holder of the publish window currently owned by this process. */
let publishLockHolder: PublishLockHolder | null = null;
/** Set only when deleting our lock file threw. A live holder must not be released by the next caller. */
let publishLockReleaseFailed = false;
const REDACT_PATTERNS: RegExp[] = [
  /password\s*[:=]\s*\S+/gi,
  /token\s*[:=]\s*\S+/gi,
  /secret\s*[:=]\s*\S+/gi,
  /api[_-]?key\s*[:=]\s*\S+/gi
];

const SAFE_SEGMENT_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const QUALIFIED_TABLE_RE = /^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/;

export class SemanticAssetValidationError extends Error {
  code: SemanticAssetErrorCode;
  statusCode: 400 | 403 | 404 | 409 | 422;
  errors: SemanticAssetError[];
  release?: SemanticAssetReleaseRecord;

  constructor(
    code: SemanticAssetErrorCode,
    message: string,
    errors: SemanticAssetError[] = [],
    statusCode: 400 | 403 | 404 | 409 | 422 = 400,
    release?: SemanticAssetReleaseRecord
  ) {
    super(message);
    this.name = "SemanticAssetValidationError";
    this.code = code;
    this.statusCode = statusCode;
    this.errors = errors;
    this.release = release;
  }
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}
function pad3(value: number): string {
  return value.toString().padStart(3, "0");
}

function formatTimestamp(date: Date): string {
  return (
    `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}_` +
    `${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}_${pad3(date.getMilliseconds())}`
  );
}

function newValidationId(): string {
  return `val_${formatTimestamp(new Date())}_${randomUUID().slice(0, 8)}`;
}

function newReleaseId(): string {
  return `rel_${formatTimestamp(new Date())}_${randomUUID().slice(0, 8)}`;
}

function newManualReindexId(): string {
  return `idx_${formatTimestamp(new Date())}_${randomUUID().slice(0, 8)}`;
}

function sanitizeFilename(raw: string): string {
  return path.basename(raw);
}

function hasYamlExtension(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith(".yaml") || lower.endsWith(".yml");
}

function hasZipExtension(name: string): boolean {
  return name.toLowerCase().endsWith(".zip");
}

function hasTarGzExtension(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith(".tar.gz") || lower.endsWith(".tgz");
}

function isSafeSegment(value: string): boolean {
  return SAFE_SEGMENT_RE.test(value);
}

function isValidFilename(name: string): boolean {
  if (!name || name.includes("/") || name.includes("\\")) return false;
  if (name === "." || name === "..") return false;
  // Spec 115: reject AppleDouble / Finder junk masquerading as YAML.
  if (name.startsWith("._") || name === ".DS_Store") return false;
  if (!hasYamlExtension(name)) return false;
  return /^[A-Za-z0-9._-]+$/.test(name);
}

function normalizePackageEntryPath(raw: string): string | null {
  const normalized = raw.replace(/\\/g, "/").replace(/^\.\/+/, "");
  if (!normalized || normalized.startsWith("/") || normalized.includes("\0")) return null;
  const parts = normalized.split("/");
  if (parts.length > MAX_PACKAGE_DEPTH) return null;
  if (parts.some((part) => !part || part === "." || part === "..")) return null;
  return normalized;
}

function packageEntryBasename(raw: string): string | null {
  const normalized = normalizePackageEntryPath(raw);
  if (!normalized) return null;
  return path.posix.basename(normalized);
}

function packageEntryFilename(raw: string): string | null {
  const filename = packageEntryBasename(raw);
  if (!filename) return null;
  return isValidFilename(filename) ? filename : null;
}

/** Spec 115: skip AppleDouble / .DS_Store inside zip/tar instead of failing the package. */
function shouldSkipPackageJunkEntry(raw: string): boolean {
  const filename = packageEntryBasename(raw);
  return filename !== null && isSemanticLayerJunkName(filename);
}

function connectionIdFromFilename(filename: string, fallback?: string): string | null {
  const base = sanitizeFilename(filename).replace(/\.(ya?ml)$/i, "");
  if (isSafeSegment(base)) return base;
  return fallback ?? null;
}

function parseTableRef(table: string): { schema: string; table: string } | null {
  if (typeof table !== "string") return null;
  if (!QUALIFIED_TABLE_RE.test(table)) return null;
  const [schema, tableName] = table.split(".");
  return { schema, table: tableName };
}

type Classification =
  | {
      ok: true;
      kind: "schemaManifest";
      schema: string;
      tableCount: number;
      sourceNames: string[];
      warnings: SemanticAssetWarning[];
    }
  | {
      ok: true;
      kind: "semanticSource";
      sourceName: string;
      physicalTable: string;
      warnings: SemanticAssetWarning[];
    }
  | {
      ok: false;
      code: SemanticAssetErrorCode;
      message: string;
      line?: number;
      column?: number;
    };

type YamlAstError = { code: string; message: string; line?: number; column?: number };

function parseYamlAst(text: string): { doc: YamlDocument | null; errors: YamlAstError[] } {
  try {
    const doc = parseDocument(text, { prettyErrors: true, keepSourceTokens: false });
    if (doc.errors.length === 0) {
      return { doc, errors: [] };
    }
    const first = doc.errors[0];
    // `prettyErrors: true` exposes `linePos` with absolute 1-based positions.
    const linePos = (first as unknown as { linePos?: Array<{ line: number; col: number }> })?.linePos?.[0];
    return {
      doc: null,
      errors: [
        {
          code: "YAML_PARSE_FAILED",
          message: first?.message ?? "YAML 解析失败",
          line: linePos?.line,
          column: linePos?.col
        }
      ]
    };
  } catch (error) {
    return {
      doc: null,
      errors: [
        {
          code: "YAML_PARSE_FAILED",
          message: error instanceof Error ? error.message : "YAML 解析失败"
        }
      ]
    };
  }
}

function classifyYaml(
  text: string
): Classification {
  const { doc, errors } = parseYamlAst(text);
  if (!doc) {
    const first = errors[0];
    return {
      ok: false,
      code: "YAML_PARSE_FAILED",
      message: first?.message ?? "YAML 解析失败",
      line: first?.line,
      column: first?.column
    };
  }
  const root = doc.toJSON();
  if (!root || typeof root !== "object" || Array.isArray(root)) {
    return { ok: false, code: "INVALID_MANIFEST", message: "YAML 顶层必须是 mapping" };
  }
  const record = root as Record<string, unknown>;

  // Schema manifest: top-level `tables: { ... }`.
  if (record.tables && typeof record.tables === "object" && !Array.isArray(record.tables)) {
    const tablesRecord = record.tables as Record<string, unknown>;
    const tableNames = Object.keys(tablesRecord);
    if (tableNames.length === 0) {
      return {
        ok: true,
        kind: "schemaManifest",
        schema: "",
        tableCount: 0,
        sourceNames: [],
        warnings: [
          {
            code: "EMPTY_MANIFEST",
            message: "manifest 解析成功但未声明任何表"
          }
        ]
      };
    }
    const unsafe = tableNames.find((name) => !isSafeSegment(name));
    if (unsafe) {
      return {
        ok: false,
        code: "INVALID_MANIFEST",
        message: `manifest source '${unsafe}' 不是安全 source id`
      };
    }
    return {
      ok: true,
      kind: "schemaManifest",
      schema: "",
      tableCount: tableNames.length,
      sourceNames: tableNames,
      warnings: []
    };
  }

  // Semantic source overlay: top-level `name` (and optional `table`).
  if (typeof record.name === "string") {
    const sourceName = record.name.trim();
    if (!isSafeSegment(sourceName)) {
      return {
        ok: false,
        code: "UNSAFE_SOURCE_NAME",
        message: `source name '${sourceName}' 不是安全路径段`
      };
    }
    if (typeof record.table !== "string") {
      return {
        ok: false,
        code: "OVERLAY_MISSING_TABLE",
        message: "overlay 缺少必需的 `table` 字段"
      };
    }
    const ref = parseTableRef(record.table.trim());
    if (!ref) {
      return {
        ok: false,
        code: "OVERLAY_MISSING_TABLE",
        message: `overlay 缺少合法的 <schema>.<table> 引用：${record.table}`
      };
    }
    return {
      ok: true,
      kind: "semanticSource",
      sourceName,
      physicalTable: `${ref.schema}.${ref.table}`,
      warnings: []
    };
  }

  return { ok: false, code: "UNKNOWN_SHAPE", message: "YAML 既不是 schema manifest 也不是 semantic overlay" };
}

function manifestSchemaFromTables(
  text: string,
  defaultSchema?: string
): { schema: string | null; reason?: string } {
  const { doc } = parseYamlAst(text);
  if (!doc) return { schema: null, reason: "YAML 解析失败" };
  const root = doc.toJSON() as Record<string, unknown> | null;
  if (!root) return { schema: null };
  const tables = root.tables;
  if (!tables || typeof tables !== "object" || Array.isArray(tables)) {
    return { schema: null };
  }
  // Pick a representative schema: prefer the one with the most table refs that
  // parse as `<schema>.<table>`.
  const schemas = new Map<string, number>();
  for (const value of Object.values(tables as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const table = (value as Record<string, unknown>).table;
    if (typeof table !== "string") continue;
    const ref = parseTableRef(table.trim());
    if (!ref) continue;
    schemas.set(ref.schema, (schemas.get(ref.schema) ?? 0) + 1);
  }
  if (defaultSchema) {
    // Forced schema: report whichever it is, regardless of content, so the
    // caller can decide whether the connection declares it.
    return { schema: defaultSchema };
  }
  if (schemas.size === 0) {
    return { schema: null, reason: "manifest 中找不到可识别的 <schema>.<table>" };
  }
  const sorted = [...schemas.entries()].sort((a, b) => b[1] - a[1]);
  return { schema: sorted[0]?.[0] ?? null };
}

function buildManifestTargetPath(connectionId: string, schema: string): string {
  return path.posix.join("semantic-layer", connectionId, "_schema", `${schema}.yaml`);
}

function buildOverlayTargetPath(connectionId: string, sourceName: string): string {
  return path.posix.join("semantic-layer", connectionId, `${sourceName}.yaml`);
}

function readExistingTextOrEmpty(projectRoot: string, relPath: string): Promise<string> {
  return readFile(path.resolve(projectRoot, relPath), "utf8").catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return "";
    throw err;
  });
}

function buildUnifiedDiff(
  filePath: string,
  oldText: string,
  newText: string
): string {
  if (oldText === newText) return "";
  return createTwoFilesPatch(filePath, filePath, oldText, newText, "current", "proposed", {
    context: 3
  });
}

function redactText(input: string | undefined, maxLen = 4000): string | undefined {
  if (typeof input !== "string") return undefined;
  let out = input;
  for (const re of REDACT_PATTERNS) {
    out = out.replace(re, (match) => {
      const key = match.split(/[:=]/)[0]?.trim() ?? "secret";
      return `${key}: <REDACTED>`;
    });
  }
  if (out.length > maxLen) {
    out = `${out.slice(0, maxLen)}\n...<truncated ${out.length - maxLen} bytes>...`;
  }
  return out;
}

function collectValidationIssues(rows: SemanticAssetValidationRow[]): Array<{
  message: string;
  filePath?: string;
  line?: number;
  column?: number;
}> {
  const issues: Array<{ message: string; filePath?: string; line?: number; column?: number }> = [];
  for (const row of rows) {
    for (const issue of row.issues) {
      issues.push(issue);
    }
  }
  return issues;
}

function addChangedSource(
  list: SemanticAssetChangedSource[],
  seen: Set<string>,
  source: SemanticAssetChangedSource
): void {
  const key = `${source.connectionId}/${source.sourceName}`;
  if (seen.has(key)) return;
  seen.add(key);
  list.push(source);
}

function extractZipYamlFiles(
  filename: string,
  buffer: Buffer
): Array<{ filename: string; content: string }> {
  const files: Array<{ filename: string; content: string }> = [];
  const eocdSig = 0x06054b50;
  let eocdOffset = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65_558); i -= 1) {
    if (buffer.readUInt32LE(i) === eocdSig) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new Error(`${filename} 不是合法 zip：缺少 central directory`);
  }
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  let cursor = buffer.readUInt32LE(eocdOffset + 16);

  for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error(`${filename} 不是合法 zip：central directory 损坏`);
    }
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLen = buffer.readUInt16LE(cursor + 28);
    const extraLen = buffer.readUInt16LE(cursor + 30);
    const commentLen = buffer.readUInt16LE(cursor + 32);
    const externalAttrs = buffer.readUInt32LE(cursor + 38);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const rawName = buffer.slice(cursor + 46, cursor + 46 + nameLen).toString("utf8");
    cursor += 46 + nameLen + extraLen + commentLen;

    const unixMode = externalAttrs >>> 16;
    if ((unixMode & 0o170000) === 0o120000) {
      throw new Error(`${filename} 包内包含 symlink：${rawName}`);
    }
    if (rawName.endsWith("/")) continue;
    if (shouldSkipPackageJunkEntry(rawName)) continue;
    const entryName = packageEntryFilename(rawName);
    if (!entryName) {
      throw new Error(`${filename} 包内路径不安全或不是 YAML：${rawName}`);
    }
    if (uncompressedSize > MAX_FILE_BYTES) {
      throw new Error(`${filename} 包内文件超过 ${MAX_FILE_BYTES / 1024} KB：${rawName}`);
    }
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error(`${filename} 不是合法 zip：local header 损坏`);
    }
    const localNameLen = buffer.readUInt16LE(localOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buffer.length) {
      throw new Error(`${filename} 不是合法 zip：文件数据越界`);
    }
    const compressed = buffer.slice(dataStart, dataEnd);
    let data: Buffer | null;
    try {
      data =
        method === 0
          ? compressed
          : method === 8
            ? inflateRawSync(compressed, { maxOutputLength: MAX_FILE_BYTES + 1 })
            : null;
    } catch (error) {
      throw new Error(
        `${filename} 包内文件解压失败或超过 ${MAX_FILE_BYTES / 1024} KB：${rawName}`,
        { cause: error }
      );
    }
    if (!data) {
      throw new Error(`${filename} 包内文件使用了不支持的压缩方法：${rawName}`);
    }
    if (data.length > MAX_FILE_BYTES) {
      throw new Error(`${filename} 包内文件解压后超过 ${MAX_FILE_BYTES / 1024} KB：${rawName}`);
    }
    const expandedBytes = files.reduce((sum, file) => sum + Buffer.byteLength(file.content, "utf8"), 0) + data.length;
    if (expandedBytes > MAX_PACKAGE_BYTES) {
      throw new Error(`${filename} 解压后超过 ${MAX_PACKAGE_BYTES / 1024 / 1024} MB 上限`);
    }
    files.push({ filename: entryName, content: data.toString("utf8") });
  }
  return files;
}

function extractTarGzYamlFiles(
  filename: string,
  buffer: Buffer
): Array<{ filename: string; content: string }> {
  let tar: Buffer;
  try {
    tar = gunzipSync(buffer, { maxOutputLength: MAX_PACKAGE_BYTES + 1 });
  } catch (error) {
    throw new Error(
      `${filename} 解压失败或超过 ${MAX_PACKAGE_BYTES / 1024 / 1024} MB 上限`,
      { cause: error }
    );
  }
  if (tar.length > MAX_PACKAGE_BYTES) {
    throw new Error(`${filename} 解压后超过 ${MAX_PACKAGE_BYTES / 1024 / 1024} MB 上限`);
  }
  const files: Array<{ filename: string; content: string }> = [];
  for (let cursor = 0; cursor + 512 <= tar.length;) {
    const header = tar.slice(cursor, cursor + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.slice(0, 100).toString("utf8").replace(/\0.*$/, "");
    const prefix = header.slice(345, 500).toString("utf8").replace(/\0.*$/, "");
    const rawPath = prefix ? `${prefix}/${name}` : name;
    const sizeText = header.slice(124, 136).toString("utf8").replace(/\0.*$/, "").trim();
    const size = Number.parseInt(sizeText || "0", 8);
    const typeflag = header[156];
    cursor += 512;
    if (!Number.isFinite(size) || size < 0) {
      throw new Error(`${filename} 不是合法 tar.gz：文件大小无效`);
    }
    const padded = Math.ceil(size / 512) * 512;
    if (cursor + padded > tar.length) {
      throw new Error(`${filename} 不是合法 tar.gz：文件数据越界`);
    }
    if (typeflag === 50) {
      throw new Error(`${filename} 包内包含 symlink：${rawPath}`);
    }
    if (typeflag === 0 || typeflag === 48) {
      if (shouldSkipPackageJunkEntry(rawPath)) {
        cursor += padded;
        continue;
      }
      const entryName = packageEntryFilename(rawPath);
      if (!entryName) {
        throw new Error(`${filename} 包内路径不安全或不是 YAML：${rawPath}`);
      }
      if (size > MAX_FILE_BYTES) {
        throw new Error(`${filename} 包内文件超过 ${MAX_FILE_BYTES / 1024} KB：${rawPath}`);
      }
      files.push({
        filename: entryName,
        content: tar.slice(cursor, cursor + size).toString("utf8")
      });
    }
    cursor += padded;
  }
  return files;
}

function expandValidateInput(
  request: SemanticAssetValidateRequest,
  errors: SemanticAssetError[]
): Array<{ filename: string; content: string }> {
  const expanded = [...(Array.isArray(request.files) ? request.files : [])];
  for (const pkg of Array.isArray(request.packages) ? request.packages : []) {
    const filename = typeof pkg.filename === "string" ? sanitizeFilename(pkg.filename) : "";
    if (!filename || (!hasZipExtension(filename) && !hasTarGzExtension(filename))) {
      errors.push({
        code: "PACKAGE_PARSE_FAILED",
        message: `语义包文件名 ${filename || "(empty)"} 非法，仅支持 .zip、.tar.gz、.tgz`,
        filePath: filename
      });
      continue;
    }
    let buffer: Buffer;
    try {
      buffer = Buffer.from(pkg.contentBase64, "base64");
    } catch {
      errors.push({
        code: "PACKAGE_PARSE_FAILED",
        message: `${filename} 不是合法 base64 包内容`,
        filePath: filename
      });
      continue;
    }
    if (buffer.length > MAX_PACKAGE_BYTES) {
      errors.push({
        code: "FILE_TOO_LARGE",
        message: `${filename} 超过 ${MAX_PACKAGE_BYTES / 1024 / 1024} MB 包大小上限`,
        filePath: filename
      });
      continue;
    }
    try {
      const files = hasZipExtension(filename)
        ? extractZipYamlFiles(filename, buffer)
        : extractTarGzYamlFiles(filename, buffer);
      expanded.push(...files);
    } catch (error) {
      errors.push({
        code: "PACKAGE_PARSE_FAILED",
        message: error instanceof Error ? error.message : `${filename} 解析失败`,
        filePath: filename
      });
    }
  }
  return expanded;
}

// ─── Connection / schema lookups ───────────────────────────────────────────

type ConnectionSchemas = {
  id: string;
  schemas: Set<string>;
};

async function readConnectionsWithSchemas(projectRoot: string): Promise<ConnectionSchemas[]> {
  const project = await readProject(projectRoot);
  return project.connections.map((c) => ({ id: c.id, schemas: new Set(c.schemas) }));
}

function findConnection(
  list: ConnectionSchemas[],
  hint: string | undefined,
  filename: string
): ConnectionSchemas | null {
  if (hint && isSafeSegment(hint)) {
    const match = list.find((c) => c.id === hint);
    if (match) return match;
  }
  // Fall back to filename-as-connection only when the filename is a valid
  // connection id. Never use raw client strings.
  const fromFilename = connectionIdFromFilename(filename);
  if (fromFilename) {
    const match = list.find((c) => c.id === fromFilename);
    if (match) return match;
  }
  // If the project has exactly one connection, the analyst almost certainly
  // meant it. This keeps the common case friction-free without exposing any
  // path-arbitration attack surface (the connection is server-chosen, not
  // client-supplied).
  if (list.length === 1) {
    return list[0] ?? null;
  }
  return null;
}

function connectionForSchema(
  list: ConnectionSchemas[],
  schema: string
): ConnectionSchemas | null {
  const matches = list.filter((c) => c.schemas.has(schema));
  if (matches.length === 1) return matches[0] ?? null;
  return null;
}

function connectionForOverlayTable(
  list: ConnectionSchemas[],
  physicalTable: string
): ConnectionSchemas | null {
  const [schema] = physicalTable.split(".");
  if (!schema) return null;
  return connectionForSchema(list, schema);
}

// ─── Snapshot sidecar (per-validation, used only by publish) ──────────────

/**
 * The batch staging state of a snapshot (Lucy v0.25 / L25-11 §5 / §7.2).
 *
 * It is present only for a maintenance-package import. It carries the facts
 * the publish contract needs to rebuild the COMPLETE plan and to compare it
 * against the confirmation:
 *
 *   - `planDigest` — the digest the overwrite confirmation is bound to. It
 *     covers the candidates, the exact target set and every target's expected
 *     digest. A global boolean cannot express "the target set changed".
 *   - `targetDigests` — the digest each target had when the plan was built
 *     (`null` = the target must still not exist). This is what makes
 *     "absent → created by somebody else" a conflict.
 *   - `overwriteSet` — the EXACT set of targets the confirmation covers.
 */
type SemanticBatchSnapshotState = {
  batchId: string;
  scopeId: string;
  exportId: string;
  instanceId: string;
  actor: string;
  candidateDigest: string;
  planDigest: string;
  /** The selected identities — part of the plan digest. */
  refs: Array<{ connectionId: string; schema: string; table: string }>;
  /** The read-only dependency identities — part of the plan digest. */
  dependencies: Array<{ connectionId: string; schema: string; table: string }>;
  targetDigests: Array<{ path: string; digest: string | null }>;
  overwriteSet: string[];
};

type ValidationSnapshot = {
  validationId: string;
  createdAt: string;
  files: Array<{
    originalFilename: string;
    content: string;
    kind: SemanticAssetKind;
    connectionId: string;
    schema?: string;
    sourceName?: string;
    physicalTable?: string;
    targetPath: string;
    sha256: string;
  }>;
  changedSources: SemanticAssetChangedSource[];
  diff: string;
  /** Present only for a maintenance-package import (L25-11 §5). */
  batch?: SemanticBatchSnapshotState;
};

function snapshotPath(projectRoot: string, validationId: string): string {
  return path.resolve(projectRoot, SNAPSHOTS_DIR_REL, `${validationId}.json`);
}

async function writeSnapshot(
  projectRoot: string,
  snapshot: ValidationSnapshot
): Promise<void> {
  const dir = path.resolve(projectRoot, SNAPSHOTS_DIR_REL);
  await mkdir(dir, { recursive: true });
  await writeFile(snapshotPath(projectRoot, snapshot.validationId), JSON.stringify(snapshot, null, 2), "utf8");
  // Opportunistically prune the snapshot sidecar to avoid unbounded growth.
  const entries = await readdir(dir).catch(() => [] as string[]);
  const sorted = entries.filter((e) => e.endsWith(".json")).sort();
  const toRemove = sorted.slice(0, Math.max(0, sorted.length - MAX_SNAPSHOTS));
  for (const old of toRemove) {
    await rm(path.join(dir, old), { recursive: true, force: true });
  }
}

async function readSnapshot(
  projectRoot: string,
  validationId: string
): Promise<ValidationSnapshot | null> {
  try {
    const text = await readFile(snapshotPath(projectRoot, validationId), "utf8");
    return JSON.parse(text) as ValidationSnapshot;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function deleteSnapshot(projectRoot: string, validationId: string): Promise<void> {
  await rm(snapshotPath(projectRoot, validationId), { force: true });
}

/**
 * Persist a STAGED batch import so the publish flow can consume it.
 *
 * Lucy v0.25 / L25-11 §5 / §7.2 (D12): the staged candidates live in the
 * controlled staging area until the publish workbench confirms them. Nothing
 * is written to the formal files at this point.
 */
export async function persistSemanticBatchSnapshot(
  projectRoot: string,
  input: {
    validationId: string;
    batchId: string;
    scopeId: string;
    exportId: string;
    instanceId: string;
    actor: string;
    candidateDigest: string;
    planDigest: string;
    refs: ReadonlyArray<{ connectionId: string; schema: string; table: string }>;
    dependencies: ReadonlyArray<{ connectionId: string; schema: string; table: string }>;
    targetDigests: ReadonlyArray<{ path: string; digest: string | null }>;
    overwriteSet: readonly string[];
    candidates: ReadonlyArray<{
      targetPath: string;
      content: string;
      identity: { connectionId: string; schema: string; table: string };
    }>;
    changedSources: ReadonlyArray<{ connectionId: string; sourceName: string }>;
    diff: string;
    now?: () => Date;
  }
): Promise<void> {
  const createdAt = (input.now ?? (() => new Date()))().toISOString();
  const snapshot: ValidationSnapshot = {
    validationId: input.validationId,
    createdAt,
    files: input.candidates.map((candidate) => ({
      originalFilename: `${candidate.identity.connectionId}/${candidate.identity.table}.yaml`,
      content: candidate.content,
      kind: "semanticSource" as SemanticAssetKind,
      connectionId: candidate.identity.connectionId,
      schema: candidate.identity.schema,
      sourceName: candidate.identity.table,
      physicalTable: `${candidate.identity.schema}.${candidate.identity.table}`,
      targetPath: candidate.targetPath,
      sha256: sha256(candidate.content)
    })),
    changedSources: [...input.changedSources],
    diff: input.diff,
    batch: {
      batchId: input.batchId,
      scopeId: input.scopeId,
      exportId: input.exportId,
      instanceId: input.instanceId,
      actor: input.actor,
      candidateDigest: input.candidateDigest,
      planDigest: input.planDigest,
      refs: input.refs.map((ref) => ({ ...ref })),
      dependencies: input.dependencies.map((dependency) => ({ ...dependency })),
      targetDigests: input.targetDigests.map((target) => ({ ...target })),
      overwriteSet: [...input.overwriteSet]
    }
  };
  await writeSnapshot(projectRoot, snapshot);
}

// ─── Release sidecar (no YAML content) ───────────────────────────────────

type SidecarFile = {
  version: 1;
  records: SemanticAssetReleaseRecord[];
};

function emptySidecar(): SidecarFile {
  return { version: 1, records: [] };
}

function normalizeSidecar(raw: unknown): SidecarFile {
  if (!raw || typeof raw !== "object") return emptySidecar();
  const obj = raw as { version?: unknown; records?: unknown };
  if (!Array.isArray(obj.records)) return emptySidecar();
  const records: SemanticAssetReleaseRecord[] = [];
  for (const item of obj.records) {
    if (item && typeof item === "object") {
      // Backfill the `trigger` field for pre-M32 records so the publish
      // history page can render the trigger column consistently. Missing
      // trigger implies the record came from a publish action; explicit
      // `webui_manual_reindex` is left untouched.
      const obj = item as SemanticAssetReleaseRecord;
      if (obj.trigger === undefined) {
        obj.trigger = "webui_publish";
      }
      records.push(obj);
    }
  }
  return { version: 1, records };
}

async function readSidecar(projectRoot: string): Promise<SidecarFile> {
  try {
    const text = await readFile(path.resolve(projectRoot, SIDECAR_RELEASES_REL), "utf8");
    return normalizeSidecar(JSON.parse(text) as unknown);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptySidecar();
    throw err;
  }
}

/**
 * Write the release sidecar ATOMICALLY.
 *
 * The sidecar is read on the idempotent-replay path (readSemanticAssetRelease)
 * while the asynchronous reindex updates it (updateReleaseRecord is a
 * read-modify-write). A plain `writeFile` truncates the file before the new
 * content lands, so a reader that arrives in that window parses a half-written
 * file — `JSON.parse` throws a SyntaxError, which is not a
 * SemanticAssetValidationError and therefore escapes the publish route as an
 * HTTP 500 instead of the replayed release.
 *
 * Writing to a temp file and renaming it makes the swap atomic: a reader sees
 * either the previous file or the new one, never a partial one. This mirrors
 * what the idempotency file already does (semantic-idempotency.ts).
 */
async function writeSidecar(projectRoot: string, sidecar: SidecarFile): Promise<void> {
  const abs = path.resolve(projectRoot, SIDECAR_RELEASES_REL);
  await mkdir(path.dirname(abs), { recursive: true });
  const temp = path.join(path.dirname(abs), `.semantic-asset-releases.tmp-${randomUUID()}`);
  try {
    await writeFile(temp, `${JSON.stringify(sidecar, null, 2)}\n`, "utf8");
    await rename(temp, abs);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function appendReleaseRecord(
  projectRoot: string,
  record: SemanticAssetReleaseRecord
): Promise<void> {
  const current = await readSidecar(projectRoot);
  const combined = [...current.records.filter((item) => item.id !== record.id), record];
  let protectedIds = new Set<string>();
  try {
    protectedIds = await listLiveIdempotencyReleaseIds(projectRoot);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[lucy-semantic] idempotency retention could not be read; release truncation is skipped. ${message}`
    );
    await writeSidecar(projectRoot, { version: 1, records: combined });
    return;
  }
  const visible = combined.slice(-MAX_RELEASE_RECORDS);
  const visibleIds = new Set(visible.map((item) => item.id));
  const protectedExtras = combined.filter(
    (item) => !visibleIds.has(item.id) && protectedIds.has(item.id)
  );
  await writeSidecar(projectRoot, { version: 1, records: [...protectedExtras, ...visible] });
}

export async function updateReleaseRecord(
  projectRoot: string,
  releaseId: string,
  patch: Partial<SemanticAssetReleaseRecord>
): Promise<SemanticAssetReleaseRecord | null> {
  const current = await readSidecar(projectRoot);
  let updated: SemanticAssetReleaseRecord | null = null;
  const records = current.records.map((record) => {
    if (record.id !== releaseId) return record;
    updated = { ...record, ...patch };
    return updated;
  });
  if (!updated) return null;
  await writeSidecar(projectRoot, { version: 1, records });
  return updated;
}

export async function assertNoUnsettledContentRelease(
  projectRoot: string,
  exceptReleaseId?: string
): Promise<void> {
  const sidecar = await readSidecar(projectRoot);
  const blocking = sidecar.records.find((record) => {
    if (exceptReleaseId && record.id === exceptReleaseId) return false;
    if (record.terminalAuditPending === true) return true;
    return record.status === "promoting" || record.status === "reindexing";
  });
  if (!blocking) return;
  throw new SemanticAssetValidationError(
    "semantic_publish_busy",
    "已有批次处于写入中、重建索引或生效待确认，完成前不能开始下一次内容写入。",
    [],
    409
  );
}

export async function openPromotingContentRelease(input: {
  projectRoot: string;
  actor: string;
  trigger?: SemanticAssetReleaseTrigger;
  targets: Array<{
    targetPath: string;
    expectedNewDigest: string | null;
    identity?: { connectionId: string; schema: string; table: string };
    assetKind?: "overlay" | "manifest";
  }>;
  restoreOfReleaseId?: string;
  restoreSourceSnapshotId?: string;
  restorePlanDigest?: string;
  idempotencyKey?: string;
}): Promise<{ releaseId: string; snapshotId: string; attemptId: string }> {
  const releaseId = newReleaseId();
  const attemptId = `att_${randomUUID()}`;
  const connectionIds = Array.from(
    new Set(
      input.targets
        .map((target) => target.identity?.connectionId)
        .filter((value): value is string => Boolean(value))
    )
  );
  const record: SemanticAssetReleaseRecord = {
    id: releaseId,
    createdAt: new Date().toISOString(),
    actor: input.actor,
    status: "promoting",
    trigger: input.trigger ?? "webui_publish",
    connectionIds,
    files: input.targets.map((target) => ({
      targetPath: target.targetPath,
      kind: (target.assetKind ?? assetKindForTarget(target.targetPath)) === "manifest"
        ? "schemaManifest"
        : "semanticSource",
      sha256: target.expectedNewDigest ?? "",
      overwritten: false
    })),
    changedSources: [],
    validation: { ok: true, results: [] },
    recoveryRequired: false,
    activationStatus: "unconfirmed",
    attemptId,
    ...(input.restoreOfReleaseId ? { restoreOfReleaseId: input.restoreOfReleaseId } : {}),
    ...(input.restoreSourceSnapshotId ? { restoreSourceSnapshotId: input.restoreSourceSnapshotId } : {}),
    ...(input.restorePlanDigest ? { restorePlanDigest: input.restorePlanDigest } : {}),
    ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {})
  };
  await appendReleaseRecord(input.projectRoot, record);
  try {
    const written = await writeSemanticReleaseSnapshot({
      projectRoot: input.projectRoot,
      releaseId,
      actor: input.actor,
      entries: input.targets.map((target, order) => ({
        order,
        targetPath: target.targetPath,
        assetKind: target.assetKind ?? assetKindForTarget(target.targetPath),
        ...(target.identity ? { identity: target.identity } : {}),
        expectedNewDigest: target.expectedNewDigest
      }))
    });
    const linked = await updateReleaseRecord(input.projectRoot, releaseId, {
      snapshotId: written.snapshotId
    });
    if (!linked?.snapshotId) {
      throw new SemanticReleaseSnapshotError(
        "semantic_snapshot_unavailable",
        "snapshotId 未能写入发布记录。"
      );
    }
    return { releaseId, snapshotId: written.snapshotId, attemptId };
  } catch (error) {
    await updateReleaseRecord(input.projectRoot, releaseId, {
      status: "promote_failed",
      activationStatus: "unconfirmed",
      recoveryRequired: false
    }).catch(() => undefined);
    throw error;
  }
}

/**
 * L25-15 — close a content batch that has no index step.
 *
 * The single-table save, the single-table YAML import, the manifest upload
 * and the semantic file deletions write the content root and then sync the
 * ktx sibling view. The daemon reads the semantic layer per request, so
 * there is no index command for these paths — the activation is the mirror
 * sync.
 *
 * The release still has to reach a terminal state. A record left at
 * `promoting` blocks every later content write, and the startup settlement
 * would only see it as a batch that needs manual repair.
 *
 * The order is the one of Spec §8.1: terminal audit, then the release
 * terminal state together with the pending flag, then the audit check that
 * clears it, then the recovery journal.
 */
export async function finalizeContentRelease(
  projectRoot: string,
  input: {
    releaseId: string;
    actor: string;
    attemptId: string;
    journalId?: string;
    changeType: string;
    source: string;
    targetId?: string;
    operation: string;
    newSummary?: Record<string, unknown>;
    diff?: string;
  }
): Promise<SemanticAssetReleaseRecord | null> {
  await recordConfigChange({
    filePath: "semantic-layer/",
    changeType: input.changeType,
    assetKind: "publish",
    actor: input.actor,
    actorType: "ui_admin",
    source: input.source,
    targetId: input.targetId,
    operation: input.operation,
    idempotencyKey: semanticTerminalAuditKey(input.releaseId, input.attemptId),
    oldSummary: { releaseId: input.releaseId, attemptId: input.attemptId },
    newSummary: {
      releaseId: input.releaseId,
      attemptId: input.attemptId,
      activationStatus: "confirmed",
      ...(input.newSummary ?? {})
    },
    ...(input.diff ? { diff: input.diff } : {})
  });
  const terminal = await updateReleaseRecord(projectRoot, input.releaseId, {
    status: "published",
    activationStatus: "confirmed",
    recoveryRequired: false,
    terminalAuditPending: true,
    attemptId: input.attemptId
  });
  await updateReleaseRecord(projectRoot, input.releaseId, { terminalAuditPending: false });
  if (input.journalId) {
    await completeRecoveryJournal(projectRoot, input.journalId);
  }
  return terminal;
}

/**
 * L25-15 — the successful end of a content batch that has no index step.
 *
 * The mirror sync is part of the activation here: the ktx daemon reads the
 * sibling view, so a content write is only in effect once the sibling view
 * agrees with the content root.
 */
export async function closeContentBatch(
  projectRoot: string,
  input: {
    releaseId: string;
    attemptId: string;
    actor: string;
    journalId: string;
    changeType: string;
    source: string;
    targetId?: string;
    operation: string;
    newSummary?: Record<string, unknown>;
    diff?: string;
  }
): Promise<void> {
  await syncRuntimeMirror(projectRoot);
  await finalizeContentRelease(projectRoot, input);
}

/**
 * L25-15 — the failed end of a content batch.
 *
 * The journal is rolled back by the actual bytes and the release is settled
 * as `promote_failed`. `recoveryRequired` stays true when the rollback could
 * not be proven, so publishing stays closed until a human checks it.
 */
export async function failContentBatch(
  projectRoot: string,
  input: { releaseId: string; journalId: string; keepLandedWrites?: boolean }
): Promise<void> {
  let rollbackProven = true;
  try {
    const restored = await restoreRecoveryJournal(projectRoot, input.journalId, {
      keepLandedWrites: input.keepLandedWrites === true
    });
    if (!restored || restored.recoveryRequired) rollbackProven = false;
  } catch {
    rollbackProven = false;
  }
  await updateReleaseRecord(projectRoot, input.releaseId, {
    status: "promote_failed",
    activationStatus: "unconfirmed",
    recoveryRequired: !rollbackProven
  }).catch(() => undefined);
}

function matchesReleaseQuery(
  record: SemanticAssetReleaseRecord,
  query: SemanticAssetReleaseListQuery | undefined
): boolean {
  if (!query) return true;
  if (query.businessChangesOnly && !hasBusinessChanges(record)) return false;
  if (query.since && record.createdAt < query.since) return false;
  if (query.until && record.createdAt > query.until) return false;
  if (query.trigger) {
    const trigger =
      record.trigger === "webui_manual_reindex" ||
      record.trigger === "webui_publish" ||
      record.trigger === "webui_restore"
        ? record.trigger
        : "webui_publish";
    if (trigger !== query.trigger) return false;
  }
  if (query.reindexStatus) {
    let status: SemanticAssetReleaseListQuery["reindexStatus"];
    if (record.status === "reindexing") status = "running";
    else if (record.reindex) status = record.reindex.ok ? "success" : "failed";
    else status = "not_run";
    if (status !== query.reindexStatus) return false;
  }
  if (query.actor) {
    const needle = query.actor.trim().toLowerCase();
    if (!needle) return true;
    const hay = (record.actor || "").toLowerCase();
    if (!hay.includes(needle)) return false;
  }
  return true;
}

/**
 * Does this release carry a business change?
 *
 * A plain index maintenance run has no files, no changed sources and no
 * connections. It is a real operation, but it is not a business batch.
 */
export function hasBusinessChanges(record: SemanticAssetReleaseRecord): boolean {
  return (
    (record.files?.length ?? 0) > 0 ||
    (record.changedSources?.length ?? 0) > 0 ||
    (record.connectionIds?.length ?? 0) > 0
  );
}

export async function readSemanticAssetReleases(
  projectRoot: string,
  query?: SemanticAssetReleaseListQuery
): Promise<SemanticAssetReleasesResponse> {
  const sidecar = await readSidecar(projectRoot);
  if (query?.businessChangesOnly) {
    // The business filter runs BEFORE the sort and the limit. Filtering after
    // the limit would let a maintenance run push a real batch out of the
    // newest five — the summary would then show the wrong batches.
    const filtered = sidecar.records.filter((record) => matchesReleaseQuery(record, query));
    const sorted = [...filtered].sort(sortRecordsByCreatedAtDesc).slice(0, MAX_RELEASE_RECORDS);
    const total = sorted.length;
    const offset = query.offset != null && Number.isFinite(query.offset) ? Math.max(0, query.offset) : 0;
    const hasLimit = query.limit != null && Number.isFinite(query.limit);
    const limit = hasLimit ? Math.max(0, query.limit!) : undefined;
    const page = limit === undefined ? sorted : sorted.slice(offset, offset + limit);
    return { records: page, total };
  }
  // Original pipeline, unchanged: cap the sidecar, then filter, then paginate.
  const records = [...sidecar.records].sort(sortRecordsByCreatedAtDesc).slice(0, MAX_RELEASE_RECORDS);
  const filtered = records.filter((record) => matchesReleaseQuery(record, query));
  const total = filtered.length;
  const offset = query?.offset != null && Number.isFinite(query.offset) ? Math.max(0, query.offset) : 0;
  const hasLimit = query?.limit != null && Number.isFinite(query.limit);
  const limit = hasLimit ? Math.max(0, query!.limit!) : undefined;
  const page = limit === undefined ? filtered : filtered.slice(offset, offset + limit);
  return { records: page, total };
}

/**
 * Sort comparator for release history: newest `createdAt` first, falling back
 * to lexicographic `id` ordering when timestamps tie. The id tiebreaker
 * keeps the order deterministic so the audit page never re-shuffles rows
 * for releases written in the same millisecond (e.g. by parallel test
 * workers). The order is part of the public contract — the spec example
 * in §7.2 shows the latest record at the top of the table.
 */
export function sortRecordsByCreatedAtDesc(
  a: SemanticAssetReleaseRecord,
  b: SemanticAssetReleaseRecord
): number {
  if (a.createdAt < b.createdAt) return 1;
  if (a.createdAt > b.createdAt) return -1;
  if (a.id < b.id) return 1;
  if (a.id > b.id) return -1;
  return 0;
}

export async function readAllSemanticAssetReleaseRecords(
  projectRoot: string
): Promise<SemanticAssetReleaseRecord[]> {
  const sidecar = await readSidecar(projectRoot);
  return sidecar.records;
}

/**
 * L25-15 — the terminal audit identity of one attempt.
 *
 * Spec v0.11 §8.1 makes `releaseId + attemptId + "terminal"` the unique key of
 * a terminal audit. The audit store refuses a duplicate `idempotency_key`, so
 * a startup replay that re-appends the same terminal audit is a no-op rather
 * than a second success record.
 */
export function semanticTerminalAuditKey(releaseId: string, attemptId: string): string {
  return `${releaseId}:${attemptId}:terminal`;
}

export async function readSemanticAssetRelease(
  projectRoot: string,
  releaseId: string
): Promise<SemanticAssetReleaseRecord | null> {
  const sidecar = await readSidecar(projectRoot);
  return sidecar.records.find((r) => r.id === releaseId) ?? null;
}

export type ManualReindexInput = {
  actor?: string;
  force: boolean;
  reindex: SemanticAssetReindexRecord;
  startedAt?: string;
  files?: SemanticAssetReleaseFile[];
  changedSources?: SemanticAssetChangedSource[];
  connectionIds?: string[];
};

const PENDING_REVIEW_PREFIXES = ["semantic-layer/", "wiki/", "evals/", "skills/"] as const;

function isPendingReviewPath(filePath: string): boolean {
  if (!filePath || filePath.includes("\0")) return false;
  const parts = filePath.split("/");
  if (parts.includes("..") || parts.includes("")) return false;
  return PENDING_REVIEW_PREFIXES.some((prefix) => filePath.startsWith(prefix));
}

function kindForPendingPath(filePath: string): SemanticAssetKind {
  if (filePath.startsWith("wiki/")) return "wiki";
  if (filePath.startsWith("evals/")) return "eval";
  if (filePath.includes("/_schema/")) return "schemaManifest";
  return "semanticSource";
}

function absoluteContentFile(
  paths: Awaited<ReturnType<typeof resolveContentPaths>>,
  rel: string
): string | null {
  const roots: Array<[string, string]> = [
    ["semantic-layer/", paths.semanticLayer],
    ["wiki/", paths.wiki],
    ["evals/", paths.evals],
    ["skills/", paths.skills]
  ];
  for (const [prefix, root] of roots) {
    if (!rel.startsWith(prefix)) continue;
    return path.join(root, rel.slice(prefix.length));
  }
  return null;
}

/**
 * Snapshot the workbench's pending semantic files into a release record.
 * Index sync does not promote a new upload. `changedSources` names overlays
 * that still exist in the content root. Paths whose files are already gone
 * stay on `files` with an empty digest so history can show them as deleted.
 */
export async function describePendingReleaseAssets(
  projectRoot: string,
  pending: {
    filePaths: string[];
    sources: Array<{ conn: string; schema: string; table: string }>;
  }
): Promise<{
  files: SemanticAssetReleaseFile[];
  changedSources: SemanticAssetChangedSource[];
  connectionIds: string[];
}> {
  const paths = await resolveContentPaths(projectRoot);
  const seen = new Set<string>();
  const files: SemanticAssetReleaseFile[] = [];
  for (const raw of pending.filePaths) {
    const filePath = raw.split("\\").join("/");
    if (!isPendingReviewPath(filePath) || seen.has(filePath)) continue;
    seen.add(filePath);
    const abs = absoluteContentFile(paths, filePath);
    let digest = "";
    let overwritten = false;
    if (abs) {
      try {
        digest = sha256(await readFile(abs, "utf8"));
        overwritten = true;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
    }
    files.push({
      targetPath: filePath,
      kind: kindForPendingPath(filePath),
      sha256: digest,
      overwritten
    });
  }

  const changedSources: SemanticAssetChangedSource[] = [];
  const sourceKeys = new Set<string>();
  function addSource(connectionId: string, sourceName: string) {
    if (!connectionId || !sourceName) return;
    const key = `${connectionId}/${sourceName}`;
    if (sourceKeys.has(key)) return;
    sourceKeys.add(key);
    changedSources.push({ connectionId, sourceName });
  }
  // Only overlays that were readable in the content root count as written
  // sources. A pending path with an empty digest is a deletion (the file is
  // already gone) and must not be listed beside the upload.
  for (const file of files) {
    if (file.kind !== "semanticSource" || !file.sha256) continue;
    const match = /^semantic-layer\/([^/]+)\/([^/]+)\.yaml$/.exec(file.targetPath);
    if (!match || file.targetPath.includes("/_schema/")) continue;
    addSource(match[1], match[2]);
  }

  const connectionIds = Array.from(
    new Set([
      ...changedSources.map((source) => source.connectionId),
      ...files.flatMap((file) => {
        const match = /^semantic-layer\/([^/]+)\//.exec(file.targetPath);
        return match ? [match[1]] : [];
      })
    ])
  );
  return { files, changedSources, connectionIds };
}

export async function recordManualReindex(
  projectRoot: string,
  input: ManualReindexInput
): Promise<SemanticAssetReleaseRecord> {
  // Lucy v0.25 / L25-11 §7.1–§7.2 (D3): while a semantic recovery journal is
  // unresolved, a manual reindex must fail closed — reindexing would re-derive
  // an index state from targets whose write outcome is still unknown.
  if (await isRecoveryRequired(projectRoot)) {
    throw new SemanticAssetValidationError(
      "semantic_recovery_required",
      "A previous semantic write left an unresolved recovery journal; manual reindex is closed until it is resolved.",
      [],
      409
    );
  }
  const createdAt = input.startedAt ?? new Date().toISOString();
  const ok = input.reindex.ok;
  const changedSources = input.changedSources ?? [];
  const record: SemanticAssetReleaseRecord = {
    id: newManualReindexId(),
    createdAt,
    actor: input.actor ?? "local-admin",
    status: ok ? "published" : "reindex_failed",
    trigger: "webui_manual_reindex",
    connectionIds:
      input.connectionIds ?? Array.from(new Set(changedSources.map((source) => source.connectionId))),
    files: input.files ?? [],
    changedSources,
    validation: { ok: true, results: [] },
    reindex: {
      ok: input.reindex.ok,
      exitCode: input.reindex.exitCode,
      stdout: redactText(input.reindex.stdout),
      stderr: redactText(input.reindex.stderr)
    }
  };
  // Reuse the same sidecar that backs the publish history so the
  // `发布记录` page renders manual reindex entries alongside publish batches
  // without introducing a second sidecar.
  await appendReleaseRecord(projectRoot, record);
  void input.force; // `force` is preserved in stdout/exit code, not as a sidecar field.
  return record;
}

// ─── Publish workbench consumption evidence ────────────────────────────────
//
// Spec `lucy-20261030-publish-workbench-three-column-spec.md` §5.3.
//
// The workbench's pending list is the difference between the current author
// content and the last content version with PROVEN sync evidence. To advance
// that baseline honestly, the publish path must know two things:
//
//   1. which content version was handed to the index, and
//   2. that the index did not silently consume a different one.
//
// (1) is answered by capturing the content BEFORE the index reads it. (2) is
// answered by comparing the capture with the content afterwards: any drift
// means the index may have consumed a version nobody confirmed.
//
// Both halves run INSIDE the publish window that already exists. No new lock
// is introduced and the coordinator's lock lifecycle is untouched.
//
// Neither function throws. A failure to record evidence must never fail a
// publish that already succeeded — it only means the baseline does not move,
// so the content stays pending and the operator sees it again.

export interface PublishConsumptionEvidenceResult {
  advanced: boolean;
  drift: Array<{ logicalPath: string; reason: string }>;
  reason?: string;
}

/**
 * Capture the content version that is about to be consumed and persist the
 * attempt BEFORE the index runs.
 *
 * A crash after this point leaves a `prepared` attempt that the startup
 * reconciliation can finish.
 */
export async function beginPublishConsumptionEvidence(
  projectRoot: string,
  attemptId: string,
  releaseId: string
): Promise<PublishConsumptionSnapshot | null> {
  try {
    const capture = await capturePublishConsumption(projectRoot);
    const attempt: PublishAttempt = {
      version: 1,
      attemptId,
      startedAt: capture.capturedAt,
      status: "prepared",
      expectedBaselineGeneration: capture.baselineGeneration,
      consumedDigest: capture.digest,
      consumedFiles: capture.files,
      releaseId
    };
    await writePublishAttempt(projectRoot, attempt);
    return capture;
  } catch (error) {
    // The evidence could not be captured. The publish still runs; the baseline
    // simply does not move, so the content stays pending.
    console.error(
      `[lucy-semantic] 发布消费快照采集失败，本次不推进生效基线：${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
}

/**
 * Commit the consumption evidence: detect drift, then advance the baseline.
 *
 * The baseline moves only when the index succeeded, the terminal evidence is
 * durable, and the consumed content still matches the confirmation.
 */
export async function commitPublishConsumptionEvidence(
  projectRoot: string,
  attemptId: string,
  releaseId: string,
  capture: PublishConsumptionSnapshot | null
): Promise<PublishConsumptionEvidenceResult> {
  if (!capture) {
    return { advanced: false, drift: [], reason: "未采集到消费快照，本次不推进生效基线。" };
  }
  const base: PublishAttempt = {
    version: 1,
    attemptId,
    startedAt: capture.capturedAt,
    status: "prepared",
    expectedBaselineGeneration: capture.baselineGeneration,
    consumedDigest: capture.digest,
    consumedFiles: capture.files,
    releaseId
  };
  try {
    const drift = await detectPublishConsumptionDrift(projectRoot, capture);
    if (drift.length > 0) {
      await writePublishAttempt(projectRoot, {
        ...base,
        status: "uncertain",
        finishedAt: new Date().toISOString(),
        drift,
        failureReason: "索引期间内容发生变化，本次同步未推进生效基线，待重新核对。"
      });
      return { advanced: false, drift };
    }

    await advancePublishBaseline(projectRoot, {
      expectedGeneration: capture.baselineGeneration,
      files: capture.files,
      releaseId,
      attemptId
    });
    await writePublishAttempt(projectRoot, {
      ...base,
      status: "committed",
      finishedAt: new Date().toISOString()
    });
    await prunePublishBlobs(projectRoot, await collectRetainedBlobDigests(projectRoot)).catch(
      () => undefined
    );
    return { advanced: true, drift: [] };
  } catch (error) {
    const reason =
      error instanceof PublishBaselineConflictError
        ? "生效基线代次已被其它发布推进，本次未覆盖新证据。"
        : error instanceof Error
          ? error.message
          : String(error);
    await writePublishAttempt(projectRoot, {
      ...base,
      status: "uncertain",
      finishedAt: new Date().toISOString(),
      failureReason: reason
    }).catch(() => undefined);
    return { advanced: false, drift: [], reason };
  }
}

/**
 * Startup reconciliation for attempts that were prepared but never finished.
 *
 * An attempt is completed only when the terminal evidence proves the index
 * succeeded AND the consumed content still matches what is on disk. Missing
 * evidence keeps the old baseline and marks the attempt as uncertain — the
 * reconciliation never rebuilds the index, never rolls content back, and never
 * writes a success that was not proven.
 */
export async function reconcilePublishWorkbenchAttempts(
  projectRoot: string
): Promise<{ committed: string[]; uncertain: string[] }> {
  const committed: string[] = [];
  const uncertain: string[] = [];
  const attempts = await listPublishAttempts(projectRoot);

  for (const attempt of attempts) {
    if (attempt.status !== "prepared") continue;
    const finish = async (status: "committed" | "uncertain", reason?: string): Promise<void> => {
      await writePublishAttempt(projectRoot, {
        ...attempt,
        status,
        finishedAt: new Date().toISOString(),
        ...(reason ? { failureReason: reason } : {})
      }).catch(() => undefined);
    };

    if (!attempt.releaseId) {
      await finish("uncertain", "缺少发布终态记录，无法证明内容已生效。");
      uncertain.push(attempt.attemptId);
      continue;
    }
    const release = await readSemanticAssetRelease(projectRoot, attempt.releaseId);
    const indexProven = release?.status === "published" && release.reindex?.ok === true;
    if (!indexProven) {
      await finish("uncertain", "发布终态未证明索引成功，未补写生效基线。");
      uncertain.push(attempt.attemptId);
      continue;
    }

    const baseline = await readPublishBaseline(projectRoot);
    const currentGeneration = baseline?.generation ?? 0;
    if (currentGeneration !== attempt.expectedBaselineGeneration) {
      await finish("uncertain", "生效基线代次已变化，未覆盖更新的证据。");
      uncertain.push(attempt.attemptId);
      continue;
    }

    // The consumed content must still be the content on disk. If it moved,
    // the index may have consumed a version nobody confirmed.
    const capture: PublishConsumptionSnapshot = {
      capturedAt: attempt.startedAt,
      files: attempt.consumedFiles ?? {},
      digest: attempt.consumedDigest,
      baselineGeneration: attempt.expectedBaselineGeneration,
      pendingDigest: ""
    };
    const drift = await detectPublishConsumptionDrift(projectRoot, capture);
    if (drift.length > 0) {
      await finish("uncertain", "消费快照与当前内容不一致，未补写生效基线。");
      uncertain.push(attempt.attemptId);
      continue;
    }

    try {
      await advancePublishBaseline(projectRoot, {
        expectedGeneration: attempt.expectedBaselineGeneration,
        files: attempt.consumedFiles ?? {},
        releaseId: attempt.releaseId,
        attemptId: attempt.attemptId
      });
      await finish("committed");
      committed.push(attempt.attemptId);
    } catch (error) {
      await finish(
        "uncertain",
        error instanceof Error ? error.message : "生效基线补齐失败，未补写成功。"
      );
      uncertain.push(attempt.attemptId);
    }
  }

  return { committed, uncertain };
}

// ─── Publish lock (single-process MVP) ────────────────────────────────────
//
// Lucy v0.25 (L25-11 D4) — the publish lock is now the shared publish coordinator's
// lock, so the batch import, the single-table save, the manifest upload, the manual
// reindex and the access.yaml writers all exclude each other. The coordinator also
// reclaims a lock left behind by a crashed process; the previous local lock had no
// stale recovery and blocked every later publish forever.

type LockHandle = {
  validationId: string;
  releaseId: string;
};

async function tryAcquirePublishLock(
  projectRoot: string,
  payload: LockHandle
): Promise<boolean> {
  // Batch publish keeps kind `batch_import`. Restore batches use `semantic_restore`.
  // The phase field distinguishes this publish from a table save or a manual reindex.
  const { acquired, holder } = await acquirePublishCoordinatorLock(projectRoot, "batch_import", {
    validationId: payload.validationId,
    releaseId: payload.releaseId
  });
  if (acquired) publishLockHolder = holder;
  return acquired;
}

async function acquirePublishLock(
  projectRoot: string,
  payload: LockHandle
): Promise<boolean> {
  if (await tryAcquirePublishLock(projectRoot, payload)) return true;
  // A previous release failed while this process was still alive. The file is
  // not stale (the pid is ours), so reclaim will not take it. Retry the delete
  // once, then take the window again.
  if (!(await retryOwnPublishLockRelease(projectRoot))) return false;
  return tryAcquirePublishLock(projectRoot, payload);
}

async function retryOwnPublishLockRelease(projectRoot: string): Promise<boolean> {
  if (!publishLockReleaseFailed || !publishLockHolder) return false;
  const current = await readPublishCoordinatorLock(projectRoot);
  if (!current || !publishLockOwnedBy(current, publishLockHolder)) return false;
  try {
    await releasePublishCoordinatorLock(projectRoot, publishLockHolder);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[lucy-semantic] publish window release retry failed; the holder is kept. ${message}`
    );
    return false;
  }
  publishLockHolder = null;
  publishLockReleaseFailed = false;
  return true;
}

async function releasePublishLock(projectRoot: string): Promise<void> {
  if (!publishLockHolder) return;
  const holder = publishLockHolder;
  try {
    await releasePublishCoordinatorLock(projectRoot, holder);
  } catch (error) {
    publishLockReleaseFailed = true;
    throw error;
  }
  // Clear the in-memory holder only after the file operation succeeded, or
  // after we confirmed the file now belongs to someone else. A thrown delete
  // keeps the holder so the same operationId can be released later.
  publishLockReleaseFailed = false;
  if (publishLockHolder === holder) publishLockHolder = null;
}

async function notePublishPhase(projectRoot: string, phase: PublishWindowPhase): Promise<void> {
  if (!publishLockHolder) return;
  await updatePublishCoordinatorLockPayload(projectRoot, publishLockHolder, { phase });
}

async function readPublishLock(projectRoot: string): Promise<LockHandle | null> {
  const holder = await readPublishCoordinatorLock(projectRoot);
  if (!holder) return null;
  return {
    validationId: holder.validationId ?? "in-progress",
    releaseId: holder.releaseId ?? "pending"
  };
}

// ─── Staging helpers ─────────────────────────────────────────────────────

function stagingDir(projectRoot: string, validationId: string): string {
  return path.resolve(projectRoot, STAGING_DIR_REL, validationId);
}

export async function cleanupSemanticPublishStaging(
  projectRoot: string,
  validationId: string
): Promise<void> {
  await rm(stagingDir(projectRoot, validationId), { recursive: true, force: true });
}

export async function cleanupExpiredSemanticPublishStaging(
  projectRoot: string,
  maxAgeMs: number = DEFAULT_STAGING_TTL_MS
): Promise<{ removed: number; warnings: string[] }> {
  const warnings: string[] = [];
  const base = path.resolve(projectRoot, STAGING_DIR_REL);
  let entries: string[] = [];
  try {
    entries = await readdir(base);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { removed: 0, warnings };
    throw err;
  }
  let removed = 0;
  const now = Date.now();
  for (const entry of entries) {
    const full = path.join(base, entry);
    let info;
    try {
      info = await lstat(full);
    } catch (err) {
      warnings.push(`无法 stat ${entry}: ${(err as Error).message}`);
      continue;
    }
    if (!info.isDirectory()) {
      // Stale lockfile or junk — drop anything that isn't a directory.
      await rm(full, { recursive: true, force: true }).catch((err: NodeJS.ErrnoException) => {
        warnings.push(`无法删除非目录 staging ${entry}: ${err.message}`);
      });
      continue;
    }
    if (now - info.mtimeMs > maxAgeMs) {
      await rm(full, { recursive: true, force: true }).catch((err: NodeJS.ErrnoException) => {
        warnings.push(`无法清理过期 staging ${entry}: ${err.message}`);
      });
      removed += 1;
    }
  }
  return { removed, warnings };
}

// ─── Build staging project (ktx.yaml + proposed files; no secrets) ──────

async function buildStagingProject(
  projectRoot: string,
  validationId: string,
  snapshot: ValidationSnapshot
): Promise<{ stagingRoot: string }> {
  const dir = stagingDir(projectRoot, validationId);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });

  // Mirror ktx.yaml. We never copy `.ktx/secrets/**`; the KTX CLI in staging
  // mode can still reference `password: file:<path>` and read the real secret
  // file from the formal project root if the ktx binary supports it. For our
  // MVP we copy ktx.yaml verbatim and explicitly skip the secrets directory.
  const sourceKtxYaml = await readFile(path.resolve(projectRoot, "ktx.yaml"), "utf8").catch(
    (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return "";
      throw err;
    }
  );
  if (sourceKtxYaml) {
    await writeFile(path.join(dir, "ktx.yaml"), sourceKtxYaml, "utf8");
  }

  // Copy wiki/, evals/ as the existing source of truth (read-only reference).
  // We never overwrite them; the staging project is a snapshot.
  for (const sub of ["wiki", "evals"]) {
    const src = path.resolve(projectRoot, sub);
    const dest = path.join(dir, sub);
    try {
      const info = await stat(src);
      if (info.isDirectory()) {
        await copyDirectory(src, dest, 4);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        // Non-fatal; staging can still proceed without wiki/evals.
      }
    }
  }

  // Write the proposed files into semantic-layer/.
  for (const file of snapshot.files) {
    const targetAbs = path.resolve(dir, file.targetPath);
    if (!targetAbs.startsWith(path.resolve(dir) + path.sep) && targetAbs !== path.resolve(dir)) {
      throw new Error(`Refusing to write outside staging root: ${file.targetPath}`);
    }
    await mkdir(path.dirname(targetAbs), { recursive: true });
    await writeFile(targetAbs, file.content, "utf8");
  }

  return { stagingRoot: dir };
}

async function copyDirectory(src: string, dest: string, maxDepth: number): Promise<void> {
  if (maxDepth < 0) return;
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".ktx" || entry.name === "secrets") continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isSymbolicLink()) continue; // never follow symlinks in staging
    if (entry.isDirectory()) {
      await copyDirectory(s, d, maxDepth - 1);
    } else if (entry.isFile()) {
      await copyFile(s, d);
    }
  }
}

/**
 * Spec 162 §8 / SC-24 — read `columns` out of a semantic-source overlay so the
 * TS/Python SourceColumn contract can be checked before anything is written.
 * Returns null on anything unparseable; the caller then skips the check rather
 * than inventing a result.
 */
function readSemanticSourceColumns(content: string): { columns?: unknown } {
  try {
    const doc = parseDocument(content, { prettyErrors: true });
    if (doc.errors.length > 0) return {};
    const root = doc.toJSON();
    if (!root || typeof root !== "object" || Array.isArray(root)) return {};
    const record = root as Record<string, unknown>;
    if (record.tables && typeof record.tables === "object" && !Array.isArray(record.tables)) {
      const first = Object.values(record.tables as Record<string, unknown>)[0];
      if (first && typeof first === "object" && !Array.isArray(first)) {
        return { columns: (first as Record<string, unknown>).columns };
      }
    }
    return { columns: record.columns };
  } catch {
    return {};
  }
}

// ─── Validate gate (runs `ktx sl validate` for each changed source) ─────

type ValidateGateResult = {
  ok: boolean;
  results: SemanticAssetValidationRow[];
  warnings: string[];
};

async function runValidateGate(
  projectRoot: string,
  validationId: string,
  snapshot: ValidationSnapshot
): Promise<ValidateGateResult> {
  const { stagingRoot } = await buildStagingProject(projectRoot, validationId, snapshot);
  const results: SemanticAssetValidationRow[] = [];
  const warnings: string[] = [];
  if (snapshot.changedSources.length === 0) {
    return {
      ok: false,
      results: [
        {
          connectionId: snapshot.files[0]?.connectionId ?? "",
          sourceName: "",
          ok: false,
          exitCode: 1,
          issues: [
            {
              message: "本次发布没有可执行 ktx sl validate 的 changed source，已阻断写盘。"
            }
          ]
        }
      ],
      warnings
    };
  }
  // ★ Lucy v0.25 / L25-11 §6 (D8): the publish gate reuses the SHARED
  // legality check — the very same implementation the single-table save, the
  // independent batch check and the import pre-check use. It is not a second
  // vocabulary of "what is legal".
  //
  // The KTX validate runs against the STAGING root (the proposed files); the
  // Manifest and the dependency closure are read from the authoritative
  // content root. The column type contract stays with the publish gate's own
  // contract mechanism (Spec §7.1 "既有类型合同门禁"), so it is not counted
  // twice.
  const sharedIndex = await buildSemanticModelIndex(projectRoot).catch(() => null);

  for (const source of snapshot.changedSources) {
    const file = snapshot.files.find(
      (candidate) =>
        candidate.connectionId === source.connectionId && candidate.sourceName === source.sourceName
    );
    const identity = sharedIndex
      ? sharedIndex.entries.find(
          (entry) =>
            entry.identity.connectionId === source.connectionId &&
            entry.identity.table === source.sourceName
        )?.identity
      : undefined;

    if (identity && sharedIndex) {
      const check = await runSemanticTableCheck({
        projectRoot,
        index: sharedIndex,
        identity,
        validationRoot: stagingRoot,
        ...(file ? { candidateOverlay: file.content } : {})
      });
      const reasons = check.reasons.filter((reason) => reason.code !== "COLUMN_TYPE_CONTRACT");
      results.push({
        connectionId: source.connectionId,
        sourceName: source.sourceName,
        ok: check.verdict === "passed",
        exitCode: check.verdict === "passed" ? 0 : 1,
        issues: reasons.map((reason) => ({ message: reason.message }))
      });
      continue;
    }

    // The table is not in the authoritative model yet (a NEW table introduced
    // by a Manifest upload in the same batch). There is no identity to resolve,
    // so the raw KTX gate decides.
    let result: ValidationResult;
    try {
      result = await validateSource(
        stagingRoot,
        source.connectionId,
        /* schema */ "",
        source.sourceName
      );
    } catch (error) {
      results.push({
        connectionId: source.connectionId,
        sourceName: source.sourceName,
        ok: false,
        exitCode: 1,
        stderr: error instanceof Error ? error.message : String(error),
        issues: [
          {
            message:
              error instanceof Error
                ? error.message
                : "validate gate subprocess failed to start"
          }
        ]
      });
      continue;
    }
    results.push({
      connectionId: source.connectionId,
      sourceName: source.sourceName,
      ok: result.ok,
      exitCode: result.exitCode,
      stdout: redactText(result.stdout),
      stderr: redactText(result.stderr),
      issues: (result.issues ?? []).map((issue: Issue) => ({ message: issue.message }))
    });
  }
  return { ok: results.every((r) => r.ok), results, warnings };
}

// ─── Atomic promote ──────────────────────────────────────────────────────

async function promoteFile(
  projectRoot: string,
  targetRel: string,
  content: string
): Promise<{ overwritten: boolean }> {
  const errors: Array<{ code: string; message: string }> = [];
  const safety = await assertSafeTarget(projectRoot, targetRel, errors as never, {
    createParent: true
  });
  if (!safety) {
    throw new SemanticAssetValidationError(
      "PATH_NOT_ALLOWED",
      errors[0]?.message ?? "目标路径不安全",
      [],
      403
    );
  }
  const tempName = `.${randomUUID()}.semantic-publish.tmp`;
  const tempAbs = path.join(safety.safeParentAbs, tempName);
  await writeFile(tempAbs, content, "utf8");
  // Defensive: the temp file must not be a symlink.
  try {
    const stat = await lstat(tempAbs);
    if (stat.isSymbolicLink()) {
      throw new SemanticAssetValidationError(
        "PATH_NOT_ALLOWED",
        "临时文件被替换为符号链接",
        [],
        403
      );
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  await rename(tempAbs, safety.targetAbs);
  // A2: keep the ktx-facing sibling view in sync so MCP query execution sees
  // the promoted overlay immediately (the async reindex below also syncs via
  // prepareSemanticLayerForKtx, but the daemon reads per request).
  await syncRuntimeMirror(projectRoot);
  return { overwritten: safety.exists };
}

// ─── validateSemanticAssets (the public validate API) ────────────────────

export async function validateSemanticAssets(
  projectRoot: string,
  request: SemanticAssetValidateRequest
): Promise<SemanticAssetValidateResponse> {
  const errors: SemanticAssetError[] = [];
  const warnings: SemanticAssetWarning[] = [];
  const filePreviews: SemanticAssetFilePreview[] = [];
  const changedSources: SemanticAssetChangedSource[] = [];
  const changedSourceKeys = new Set<string>();
  const stagedContents: string[] = [];
  const diffParts: string[] = [];
  const inputFiles = expandValidateInput(request, errors);
  const totalInputBytes = inputFiles.reduce((sum, file) => sum + Buffer.byteLength(file.content, "utf8"), 0);

  if (inputFiles.length === 0) {
    const emptyErrors: SemanticAssetError[] =
      errors.length > 0
        ? errors
        : [
            {
              code: "INVALID_MANIFEST",
              message: "未提供任何文件"
            }
          ];
    return {
      valid: false,
      validationId: newValidationId(),
      files: [],
      changedSources: [],
      diff: "",
      warnings: [],
      errors: emptyErrors
    };
  }
  if (inputFiles.length > MAX_YAML_ENTRIES) {
    errors.push({
      code: "PACKAGE_PARSE_FAILED",
      message: `一次最多提交 ${MAX_YAML_ENTRIES} 个 YAML 文件，当前为 ${inputFiles.length} 个`
    });
  }
  if (totalInputBytes > MAX_PACKAGE_BYTES) {
    errors.push({
      code: "FILE_TOO_LARGE",
      message: `本次提交 YAML 总大小超过 ${MAX_PACKAGE_BYTES / 1024 / 1024} MB 上限`
    });
  }

  // Opportunistic GC: do not block on it, just warn.
  await cleanupExpiredSemanticPublishStaging(projectRoot).catch((err: Error) => {
    warnings.push({ code: "PUBLISH_LOCKED", message: `staging GC 失败：${err.message}` });
  });

  const connections = await readConnectionsWithSchemas(projectRoot);
  if (connections.length === 0) {
    return {
      valid: false,
      validationId: newValidationId(),
      files: [],
      changedSources: [],
      diff: "",
      warnings: [],
      errors: [
        {
          code: "UNKNOWN_CONNECTION",
          message: "项目尚未配置任何 connection，请在 ktx.yaml 中添加"
        }
      ]
    };
  }

  const filenameCounts = new Map<string, number>();
  for (const file of inputFiles) {
    const filename = typeof file.filename === "string" ? sanitizeFilename(file.filename) : "";
    filenameCounts.set(filename, (filenameCounts.get(filename) ?? 0) + 1);
  }

  for (const [filename, count] of filenameCounts) {
    if (filename && count > 1) {
      errors.push({
        code: "DUPLICATE_FILENAME",
        message: `文件名 ${filename} 重复；请重命名后重新上传，避免发布内容错配。`,
        filePath: filename
      });
    }
  }

  for (const [inputIndex, file] of inputFiles.entries()) {
    const filename = typeof file.filename === "string" ? file.filename : "";
    const content = typeof file.content === "string" ? file.content : "";
    if (!isValidFilename(filename)) {
      errors.push({
        code: "INVALID_FILENAME",
        message: `文件名 ${filename} 非法`,
        filePath: filename
      });
      continue;
    }
    const sizeBytes = Buffer.byteLength(content, "utf8");
    if (sizeBytes > MAX_FILE_BYTES) {
      errors.push({
        code: "FILE_TOO_LARGE",
        message: `${filename} 超过 ${MAX_FILE_BYTES / 1024} KB 上限`,
        filePath: filename
      });
      continue;
    }

    const classification = classifyYaml(content);
    if (!classification.ok) {
      errors.push({
        code: classification.code,
        message: classification.message,
        filePath: filename,
        line: classification.line,
        column: classification.column
      });
      continue;
    }

    let effectiveContent = content;
    const overlaySanitizeWarnings: SemanticAssetWarning[] = [];
    if (classification.kind === "semanticSource") {
      const sanitized = sanitizeSemanticSourceYaml(content);
      if (sanitized.stripped) {
        effectiveContent = sanitized.text;
        overlaySanitizeWarnings.push({
          code: "STRIPPED_MANIFEST_COLUMN_KEYS",
          message: `已自动移除 overlay 列上不被查询契约接受的字段：${sanitized.strippedKeys.join(", ")}`,
          filePath: filename
        });
      }
    }
    const sizeBytesEffective = Buffer.byteLength(effectiveContent, "utf8");

    // Resolve the connection. We try in order: client-supplied default →
    // inferred from content → inferred from filename → single-connection
    // fallback (handled in `findConnection`).
    let conn: ConnectionSchemas | null = findConnection(
      connections,
      request.defaultConnectionId,
      filename
    );
    if (!conn && classification.kind === "schemaManifest") {
      const detected = manifestSchemaFromTables(content, request.defaultSchema);
      if (detected.schema) {
        conn = connectionForSchema(connections, detected.schema);
      }
    }
    if (!conn && classification.kind === "semanticSource") {
      conn = connectionForOverlayTable(connections, classification.physicalTable);
    }

    if (!conn) {
      errors.push({
        code: "UNKNOWN_CONNECTION",
        message: request.defaultConnectionId
          ? `connection '${request.defaultConnectionId}' 未在 ktx.yaml 中声明`
          : `无法从 ${filename} 推断 connection id`,
        filePath: filename
      });
      continue;
    }
    // If the analyst explicitly named a connection, respect it strictly: do
    // not silently fall back to an inferred one. The hint is server-checked
    // against the configured connections, so a hint that doesn't match must
    // surface as UNKNOWN_CONNECTION.
    if (request.defaultConnectionId && conn.id !== request.defaultConnectionId) {
      errors.push({
        code: "UNKNOWN_CONNECTION",
        message: `connection '${request.defaultConnectionId}' 未在 ktx.yaml 中声明`,
        filePath: filename
      });
      continue;
    }

    if (classification.kind === "schemaManifest") {
      const detected = manifestSchemaFromTables(content, request.defaultSchema);
      if (!detected.schema) {
        errors.push({
          code: "SCHEMA_NOT_CONFIGURED",
          message: detected.reason ?? "manifest 未声明任何 <schema>.<table>",
          filePath: filename
        });
        continue;
      }
      if (!conn.schemas.has(detected.schema)) {
        errors.push({
          code: "SCHEMA_NOT_CONFIGURED",
          message: `schema '${detected.schema}' 未在 connection '${conn.id}' 的 schemas 中声明`,
          filePath: filename
        });
        continue;
      }
      const targetPath = buildManifestTargetPath(conn.id, detected.schema);
      const oldText = await readExistingTextOrEmpty(projectRoot, targetPath);
      const fileWarnings: SemanticAssetWarning[] = [...classification.warnings];
      if (oldText.length > 0) {
        fileWarnings.push({
          code: "TARGET_EXISTS",
          message: `目标文件已存在：${targetPath}`,
          filePath: targetPath
        });
      }
      const preview: SemanticAssetFilePreview = {
        originalFilename: filename,
        kind: "schemaManifest",
        targetPath,
        exists: oldText.length > 0,
        sizeBytes,
        sha256: sha256(content),
        connectionId: conn.id,
        schema: detected.schema,
        warnings: fileWarnings
      };
      filePreviews.push(preview);
      stagedContents.push(content);
      diffParts.push(buildUnifiedDiff(targetPath, oldText, content));
      for (const sourceName of classification.sourceNames) {
        addChangedSource(changedSources, changedSourceKeys, {
          connectionId: conn.id,
          sourceName
        });
      }
    } else {
      // semanticSource
      const ref = parseTableRef(classification.physicalTable);
      if (!ref || !conn.schemas.has(ref.schema)) {
        errors.push({
          code: "SCHEMA_NOT_CONFIGURED",
          message: `overlay 的 table '${classification.physicalTable}' 的 schema 不在 connection '${conn.id}' 中`,
          filePath: filename
        });
        continue;
      }
      const targetPath = buildOverlayTargetPath(conn.id, classification.sourceName);
      const oldText = await readExistingTextOrEmpty(projectRoot, targetPath);
      const fileWarnings: SemanticAssetWarning[] = [
        ...classification.warnings,
        ...overlaySanitizeWarnings
      ];
      if (oldText.length > 0) {
        fileWarnings.push({
          code: "TARGET_EXISTS",
          message: `目标文件已存在：${targetPath}`,
          filePath: targetPath
        });
      }
      const preview: SemanticAssetFilePreview = {
        originalFilename: filename,
        kind: "semanticSource",
        targetPath,
        exists: oldText.length > 0,
        sizeBytes: sizeBytesEffective,
        sha256: sha256(effectiveContent),
        connectionId: conn.id,
        sourceName: classification.sourceName,
        physicalTable: classification.physicalTable,
        warnings: fileWarnings
      };
      filePreviews.push(preview);
      stagedContents.push(effectiveContent);
      diffParts.push(buildUnifiedDiff(targetPath, oldText, effectiveContent));
      addChangedSource(changedSources, changedSourceKeys, {
        connectionId: conn.id,
        sourceName: classification.sourceName
      });
    }
    void inputIndex;
  }

  // Top-level warnings roll up.
  for (const preview of filePreviews) {
    for (const w of preview.warnings) warnings.push(w);
  }

  const valid = errors.length === 0;
  const validationId = newValidationId();

  // Persist the snapshot only when we have at least one file preview — the
  // publish flow needs content + target paths to re-run the gate.
  if (valid && filePreviews.length > 0) {
    const snapshot: ValidationSnapshot = {
      validationId,
      createdAt: new Date().toISOString(),
      files: filePreviews.map((p, index) => ({
        originalFilename: p.originalFilename,
        content: stagedContents[index] ?? "",
        kind: p.kind,
        connectionId: p.connectionId ?? "",
        schema: p.schema,
        sourceName: p.sourceName,
        physicalTable: p.physicalTable,
        targetPath: p.targetPath,
        sha256: p.sha256
      })),
      changedSources,
      diff: diffParts.join("\n")
    };
    await writeSnapshot(projectRoot, snapshot);
  }

  return {
    valid,
    validationId,
    files: filePreviews,
    changedSources,
    diff: diffParts.join("\n"),
    warnings,
    errors
  };
}

// ─── Public publish entry ───────────────────────────────────────────────

export async function publishSemanticAssets(
  projectRoot: string,
  request: SemanticAssetPublishRequest,
  options: {
    actor?: string;
    reindexImpl?: typeof reindexProject;
    now?: () => Date;
    instanceId?: string;
    /**
     * Test seam. Runs at the start of the lock-release step, after the
     * terminal release state has been persisted and before the publish window
     * is given up. Production callers leave it unset.
     */
    beforeLockRelease?: () => Promise<void> | void;
    /** Test seam. Production uses {@link restoreRecoveryJournal}. */
    restoreImpl?: typeof restoreRecoveryJournal;
    /**
     * Test seam. Runs after the publish window is held and before the
     * in-window recovery check. Production callers leave it unset.
     */
    afterLockAcquired?: () => Promise<void> | void;
    /**
     * Test seam. Production uses {@link reloadCatalog}. The return value is
     * not used — the seam exists to inject a failure, not to report a run.
     */
    reloadCatalogImpl?: (projectRoot: string) => Promise<unknown>;
    /**
     * Test seam. Runs after the catalog reload and before the terminal audit.
     * Production callers leave it unset.
     */
    beforeTerminalAudit?: () => Promise<void> | void;
    /**
     * Test seam. Production appends the promote_failed release record.
     * A throw must not skip rollback.
     */
    recordPromoteFailureImpl?: (
      projectRoot: string,
      record: SemanticAssetReleaseRecord
    ) => Promise<void>;
  } = {}
): Promise<SemanticAssetPublishResponse> {
  const actor = options.actor ?? "local-admin";
  const instanceId = options.instanceId ?? (await resolveSemanticInstanceId(projectRoot));
  // Lucy v0.25 / L25-11 §7.1–§7.2 (D3): publishing is closed while a semantic
  // recovery journal is unresolved. The check runs BEFORE the publish lock is
  // taken so a rejected publish does not leave a lock behind.
  if (await isRecoveryRequired(projectRoot)) {
    throw new SemanticAssetValidationError(
      "semantic_recovery_required",
      "上一笔语义写入存在未决恢复日志，恢复核验完成前不允许发布。",
      [],
      409
    );
  }
  // ── Lucy v0.25 / L25-11 §7.2 (D15): idempotent replay ────────────────────
  //
  // The intent is persisted BEFORE any formal effect, so a retry after a
  // disconnect — or after the process restarted and the validation snapshot
  // was already consumed — returns the SAME release id and never writes or
  // indexes twice. The same key with a DIFFERENT plan is a conflict.
  //
  // ★ This check runs BEFORE the snapshot is read: the first publish consumes
  // the snapshot, so a replay after a successful publish would otherwise be
  // refused with "snapshot not found" instead of returning the same release.
  if (request.idempotencyKey) {
    const existing = await readSemanticIdempotencyKey(projectRoot, {
      instanceId,
      actor,
      clientKey: request.idempotencyKey
    });
    if (existing) {
      const confirmedDigest = request.planDigest ?? existing.planDigest;
      if (existing.planDigest !== confirmedDigest) {
        throw new SemanticAssetValidationError(
          "SEMANTIC_IDEMPOTENCY_CONFLICT",
          "该幂等键已绑定另一个计划；同一幂等键不能用于不同的发布计划。",
          [
            {
              code: "SEMANTIC_IDEMPOTENCY_CONFLICT",
              message: `已绑定的计划摘要 ${existing.planDigest} 与本次 ${confirmedDigest} 不一致。`
            }
          ],
          409
        );
      }
      const release = await readSemanticAssetRelease(projectRoot, existing.releaseId);
      if (release) {
        return { accepted: true, release };
      }
    }
  }

  const snapshot = await readSnapshot(projectRoot, request.validationId);
  if (!snapshot) {
    throw new SemanticAssetValidationError(
      "VALIDATION_SNAPSHOT_NOT_FOUND",
      "validationId 已失效或不存在，请重新校验后再发布",
      [],
      404
    );
  }

  if (!request.idempotencyKey && snapshot.batch) {
    // A batch import MUST carry an idempotency key: without it a retry after a
    // disconnect cannot be told apart from a second publish.
    throw new SemanticAssetValidationError(
      "SEMANTIC_IDEMPOTENCY_KEY_REQUIRED",
      "批量导入发布必须携带幂等键。",
      [],
      400
    );
  }

  const acquired = await acquirePublishLock(projectRoot, {
    validationId: request.validationId,
    releaseId: "pending"
  });
  if (!acquired) {
    const current = await readPublishCoordinatorLock(projectRoot);
    throw new SemanticAssetValidationError(
      "PUBLISH_IN_PROGRESS",
      formatPublishWindowBusy(current),
      [],
      409
    );
  }
  // The check before the lock avoids leaving a lock behind on a fast reject.
  // Repeat it inside the window: a writer that does not hold this lock can
  // open a journal between the two checks.
  try {
    if (options.afterLockAcquired) await options.afterLockAcquired();
    if (await isRecoveryRequired(projectRoot)) {
      throw new SemanticAssetValidationError(
        "semantic_recovery_required",
        "上一笔语义写入存在未决恢复日志，恢复核验完成前不允许发布。",
        [],
        409
      );
    }
    await assertNoUnsettledContentRelease(projectRoot);
  } catch (error) {
    try {
      await releasePublishLock(projectRoot);
    } catch (releaseError) {
      const message = releaseError instanceof Error ? releaseError.message : String(releaseError);
      console.error(
        `[lucy-semantic] failed to release the publish window after the in-window recovery check. ${message}`
      );
    }
    throw error;
  }

  const now = options.now ?? (() => new Date());
  const releaseId = newReleaseId();
  await acquirePublishLockReleaseId(projectRoot, releaseId);
  const createdAt = now().toISOString();
  // ★ L25-11 §7.2 (D20): an index retry is a NEW attempt of the SAME release.
  // The failed attempt is kept; the attempt id distinguishes them.
  const attemptId = `att_${randomUUID()}`;

  // ── Lucy v0.25 / L25-11 §7.2 (D14): the CAS plan digest ─────────────────
  //
  // The plan is REBUILT inside the publish window from the current disk state
  // and compared with the digest the operator confirmed. A global boolean
  // cannot express "the target set changed" — the digest can.
  let confirmedPlanDigest = request.planDigest;
  if (snapshot.batch) {
    const rebuilt = await rebuildBatchPlan(projectRoot, snapshot);
    if (!request.planDigest) {
      await releasePublishLock(projectRoot);
      throw new SemanticAssetValidationError(
        "SEMANTIC_PLAN_DIGEST_MISMATCH",
        "批量发布必须携带预览时的 planDigest。",
        [],
        409
      );
    }
    if (rebuilt.planDigest !== request.planDigest) {
      await releasePublishLock(projectRoot);
      throw new SemanticAssetValidationError(
        "SEMANTIC_PLAN_DIGEST_MISMATCH",
        "预览后计划已变化，请重新预览并确认。",
        [
          {
            code: "SEMANTIC_PLAN_DIGEST_MISMATCH",
            message:
              rebuilt.changed.length > 0
                ? `以下目标在预览后已被改动：${rebuilt.changed.join("、")}`
                : "计划内容已变化，请重新预览并确认。"
          }
        ],
        409
      );
    }
    // The confirmation covers an EXACT overwrite set. A changed set invalidates it.
    if (request.overwriteTargets) {
      const confirmed = [...request.overwriteTargets].sort();
      const actual = [...rebuilt.overwriteSet].sort();
      if (confirmed.join("\n") !== actual.join("\n")) {
        await releasePublishLock(projectRoot);
        throw new SemanticAssetValidationError(
          "SEMANTIC_PLAN_DIGEST_MISMATCH",
          "确认的覆盖集合与当前计划不一致，请重新预览并确认。",
          [
            {
              code: "SEMANTIC_PLAN_DIGEST_MISMATCH",
              message: `确认覆盖 ${confirmed.join("、") || "（无）"}，当前计划覆盖 ${actual.join("、") || "（无）"}。`
            }
          ],
          409
        );
      }
    }
    confirmedPlanDigest = rebuilt.planDigest;
  }

  // Overwrite check (defer the gate until we know which files overwrite).
  //
  // ★ L25-11 §7.2 (D14): for a BATCH import the global boolean is NOT the
  // authorization any more — the confirmation is the plan digest, which
  // already covers the exact overwrite set. The boolean path stays for a
  // single-file legacy import that has no batch state.
  const overwriteSet = new Set<string>();
  for (const file of snapshot.files) {
    const oldText = await readExistingTextOrEmpty(projectRoot, file.targetPath);
    if (oldText.length > 0) overwriteSet.add(file.targetPath);
  }
  if (!snapshot.batch && overwriteSet.size > 0 && request.confirmOverwrite !== true) {
    const record: SemanticAssetReleaseRecord = {
      id: releaseId,
      createdAt,
      actor,
      status: "blocked",
      trigger: "webui_publish",
      connectionIds: Array.from(new Set(snapshot.files.map((f) => f.connectionId))),
      files: snapshot.files.map((f) => ({
        targetPath: f.targetPath,
        kind: f.kind,
        sha256: f.sha256,
        overwritten: false
      })),
      changedSources: snapshot.changedSources,
      diff: snapshot.diff,
      validation: { ok: false, results: [] }
    };
    await appendReleaseRecord(projectRoot, record);
    await releasePublishLock(projectRoot);
    await deleteSnapshot(projectRoot, request.validationId);
    throw new SemanticAssetValidationError(
      "VALIDATION_GATE_FAILED",
      "存在已存在的目标文件，需先确认覆盖。",
      [
        {
          code: "VALIDATION_GATE_FAILED",
          message: `需要覆盖：${Array.from(overwriteSet).join(", ")}`
        }
      ],
      409,
      record
    );
  }

  // Re-run the gate (TOCTOU defense; never trust the client-only validation).
  const gate = await runValidateGate(projectRoot, request.validationId, snapshot);
  const issues = collectValidationIssues(gate.results);

  // Spec 162 §8 / SC-24 — the existing TS/Python contract check is the gate.
  // Contract violations block the publish unless a time-boxed, audited
  // exemption covers them. The exemption never disables every check.
  const contractViolations: PublishGateViolation[] = [];
  for (const file of snapshot.files) {
    if (file.kind !== "semanticSource") continue;
    const parsed = readSemanticSourceColumns(file.content);
    contractViolations.push(
      ...checkColumnTypeContract(parsed.columns, file.targetPath).map((violation) => ({
        ...violation,
        connectionId: file.connectionId
      }))
    );
  }
  const exemptionValidation = validatePublishExemption(request.exemption ?? {}, now());
  const exemption = exemptionValidation.ok ? exemptionValidation.exemption : null;
  const gateVerdict = evaluatePublishGate(contractViolations, exemption, now());

  if (!gate.ok || !gateVerdict.allowed) {
    const blockingMessages = [
      ...issues.map((i) => i.message),
      ...gateVerdict.blocking.map((v) => v.message)
    ];
    const record: SemanticAssetReleaseRecord = {
      id: releaseId,
      createdAt,
      actor,
      status: "blocked",
      trigger: "webui_publish",
      connectionIds: Array.from(new Set(snapshot.files.map((f) => f.connectionId))),
      files: snapshot.files.map((f) => ({
        targetPath: f.targetPath,
        kind: f.kind,
        sha256: f.sha256,
        overwritten: false
      })),
      changedSources: snapshot.changedSources,
      diff: snapshot.diff,
      validation: { ok: false, results: gate.results },
      // SC-24 — the exemption that was considered is part of the audit trail,
      // including the reason it was rejected (expired / not applicable).
      contractGate: {
        violations: contractViolations,
        waived: gateVerdict.waived,
        blocking: gateVerdict.blocking,
        rejectedReason: gateVerdict.rejectedReason
          ?? (request.exemption && !exemption ? exemptionValidation.ok ? undefined : exemptionValidation.reason : undefined)
      }
    } as SemanticAssetReleaseRecord;
    await appendReleaseRecord(projectRoot, record);
    await cleanupSemanticPublishStaging(projectRoot, request.validationId);
    await releasePublishLock(projectRoot);
    await deleteSnapshot(projectRoot, request.validationId);
    throw new SemanticAssetValidationError(
      "VALIDATION_GATE_FAILED",
      `validate gate 失败：${blockingMessages.join("; ") || "见 results"}`,
      [
        ...issues.map((i) => ({
          code: "VALIDATION_GATE_FAILED" as const,
          message: i.message,
          filePath: i.filePath,
          line: i.line,
          column: i.column
        })),
        ...gateVerdict.blocking.map((v) => ({
          code: "CONTRACT_VIOLATION" as const,
          message: v.message,
          filePath: v.filePath
        }))
      ],
      422,
      record
    );
  }

  // ── Lucy v0.25 / L25-11 §7.2 (D15): reserve the idempotent intent ────────
  //
  // The intent is persisted BEFORE the journal and before the first write, so
  // a crash between the write and the response still leaves a durable record
  // of which release this idempotency key belongs to.
  if (request.idempotencyKey) {
    try {
      const outcome = await registerSemanticIdempotencyKey(projectRoot, {
        instanceId,
        actor,
        clientKey: request.idempotencyKey,
        planDigest: confirmedPlanDigest ?? `legacy:${request.validationId}`,
        releaseId,
        validationId: request.validationId
      });
      if (outcome.kind === "replay") {
        // Another request already reserved this key: return its release.
        await releasePublishLock(projectRoot);
        const existingRelease = await readSemanticAssetRelease(projectRoot, outcome.record.releaseId);
        if (existingRelease) {
          return { accepted: true, release: existingRelease };
        }
        throw new SemanticAssetValidationError(
          "SEMANTIC_IDEMPOTENCY_CONFLICT",
          "该幂等键已绑定另一个发布批次，请重试。",
          [],
          409
        );
      }
    } catch (error) {
      if (
        error instanceof SemanticIdempotencyConflictError
        || error instanceof SemanticIdempotencyCapacityError
      ) {
        await releasePublishLock(projectRoot);
        throw new SemanticAssetValidationError(
          error instanceof SemanticIdempotencyCapacityError
            ? "SEMANTIC_IDEMPOTENCY_CAPACITY"
            : "SEMANTIC_IDEMPOTENCY_CONFLICT",
          error.message,
          [],
          409
        );
      }
      await releasePublishLock(projectRoot);
      throw error;
    }
  }

  // L25-15 — promoting record, then the pre-write snapshot, then the journal.
  // All three sit inside the publish window already held by this process.
  // A snapshot failure leaves the release promote_failed and writes no target.
  const promotingRecord: SemanticAssetReleaseRecord = {
    id: releaseId,
    createdAt,
    actor,
    status: "promoting",
    trigger: "webui_publish",
    connectionIds: Array.from(new Set(snapshot.files.map((file) => file.connectionId))),
    files: [],
    changedSources: snapshot.changedSources,
    diff: snapshot.diff,
    validation: { ok: true, results: gate.results },
    recoveryRequired: false,
    activationStatus: "unconfirmed",
    attemptId,
    ...(confirmedPlanDigest ? { planDigest: confirmedPlanDigest } : {}),
    ...(snapshot.batch?.batchId ? { batchId: snapshot.batch.batchId } : {}),
    ...(snapshot.batch?.scopeId ? { scopeId: snapshot.batch.scopeId } : {}),
    ...(request.idempotencyKey ? { idempotencyKey: request.idempotencyKey } : {})
  };
  await appendReleaseRecord(projectRoot, promotingRecord);
  try {
    const written = await writeSemanticReleaseSnapshot({
      projectRoot,
      releaseId,
      actor,
      entries: snapshot.files.map((file, order) => ({
        order,
        targetPath: file.targetPath,
        assetKind: file.kind === "schemaManifest" ? "manifest" : "overlay",
        ...(file.connectionId && file.schema && file.sourceName
          ? {
              identity: {
                connectionId: file.connectionId,
                schema: file.schema,
                table: file.sourceName
              }
            }
          : {}),
        expectedNewDigest: file.sha256
      }))
    });
    const linked = await updateReleaseRecord(projectRoot, releaseId, {
      snapshotId: written.snapshotId
    });
    if (!linked?.snapshotId) {
      throw new SemanticReleaseSnapshotError(
        "semantic_snapshot_unavailable",
        "snapshotId 未能写入发布记录。"
      );
    }
  } catch (error) {
    await updateReleaseRecord(projectRoot, releaseId, {
      status: "promote_failed",
      activationStatus: "unconfirmed"
    }).catch(() => undefined);
    await releasePublishLock(projectRoot);
    throw new SemanticAssetValidationError(
      "semantic_snapshot_unavailable",
      error instanceof Error ? error.message : "批次前快照未能落盘，本次没有写入正式文件。",
      [],
      409
    );
  }

  // Promote: write each proposed file atomically. If any step fails we record
  // promote_failed and return. We must NOT trigger reindex.
  //
  // Lucy v0.25 / L25-11 §7.2 (D16/D17): the recovery journal is persisted
  // BEFORE the first target is written. Without it a failure in the middle of
  // the batch would leave the already-written targets in place with no record
  // of what the original content was — a partial publish that nobody can roll
  // back. On failure the journal is restored in reverse order.
  const releaseFiles: SemanticAssetReleaseFile[] = [];
  let promoteFailed = false;
  let recoveryJournalId: string | null = null;
  try {
    const journal = await createRecoveryJournal(projectRoot, {
      releaseId,
      operationId: releaseId,
      actor,
      instanceId,
      targets: snapshot.files.map((file) => ({
        targetPath: file.targetPath,
        newContent: file.content
      }))
    });
    recoveryJournalId = journal.journalId;
    await updateReleaseRecord(projectRoot, releaseId, { recoveryJournalId: journal.journalId });
  } catch (error) {
    // A journal that cannot be persisted means the batch cannot be rolled
    // back: refuse to write anything at all. The promoting record must not
    // stay open, or the next content write is blocked forever.
    await updateReleaseRecord(projectRoot, releaseId, {
      status: "promote_failed",
      activationStatus: "unconfirmed"
    }).catch(() => undefined);
    await releasePublishLock(projectRoot);
    throw new SemanticAssetValidationError(
      "semantic_recovery_required",
      "无法创建恢复日志，本批次未写入任何文件。",
      [],
      409
    );
  }
  for (const [order, file] of snapshot.files.entries()) {
    try {
      // ★ L25-11 §7.2: re-check the target's baseline right before the
      // replace. The plan digest was verified earlier in this same window,
      // but the write itself must not land on a target that moved in between.
      if (snapshot.batch) {
        const expected = snapshot.batch.targetDigests.find(
          (target) => target.path === file.targetPath
        );
        const current = await readExistingTextOrEmpty(projectRoot, file.targetPath);
        const currentDigest = current.length > 0 ? sha256(current) : null;
        if (expected && expected.digest !== currentDigest) {
          throw new SemanticAssetValidationError(
            "SEMANTIC_PLAN_DIGEST_MISMATCH",
            `目标 ${file.targetPath} 在写入前已被改动，本批次已停止。`,
            [
              {
                code: "SEMANTIC_PLAN_DIGEST_MISMATCH",
                message: `目标 ${file.targetPath} 的基线与预览不一致，请重新预览。`
              }
            ],
            409
          );
        }
      }
      const { overwritten } = await promoteFile(projectRoot, file.targetPath, file.content);
      releaseFiles.push({
        targetPath: file.targetPath,
        kind: file.kind,
        sha256: file.sha256,
        overwritten
      });
      if (recoveryJournalId) {
        await markRecoveryEntryApplied(projectRoot, recoveryJournalId, order);
      }
    } catch (error) {
      promoteFailed = true;
      // Rollback first. A failure-record write must not be able to skip it
      // (Spec §7.2). The window stays held until the restore finishes or
      // `recovery_required` is persisted.
      let restoreRequired = false;
      if (recoveryJournalId) {
        try {
          const restore = options.restoreImpl ?? restoreRecoveryJournal;
          const restored = await restore(projectRoot, recoveryJournalId);
          if (!restored || restored.recoveryRequired) {
            restoreRequired = true;
            console.error(
              `[lucy-semantic] recovery restore incomplete for release ${releaseId}; ` +
                "publishing and manual reindex stay closed until it is resolved"
            );
          }
        } catch (restoreError) {
          restoreRequired = true;
          const message = restoreError instanceof Error ? restoreError.message : String(restoreError);
          console.error(
            `[lucy-semantic] release ${releaseId} restore threw during promote failure. ${message}`
          );
          try {
            await markRecoveryJournalBlocked(projectRoot, recoveryJournalId, message);
          } catch (blockError) {
            const blockMessage = blockError instanceof Error ? blockError.message : String(blockError);
            console.error(
              `[lucy-semantic] release ${releaseId} could not persist recovery_required. ${blockMessage}`
            );
          }
        }
      }
      try {
        const failedRecord: SemanticAssetReleaseRecord = {
          id: releaseId,
          createdAt,
          actor,
          status: "promote_failed",
          trigger: "webui_publish",
          connectionIds: Array.from(new Set(snapshot.files.map((f) => f.connectionId))),
          files: releaseFiles,
          changedSources: snapshot.changedSources,
          diff: snapshot.diff,
          validation: { ok: true, results: gate.results },
          recoveryRequired: restoreRequired,
          activationStatus: "unconfirmed",
          attemptId: attemptId,
          ...(confirmedPlanDigest ? { planDigest: confirmedPlanDigest } : {}),
          ...(snapshot.batch?.batchId ? { batchId: snapshot.batch.batchId } : {}),
          ...(snapshot.batch?.scopeId ? { scopeId: snapshot.batch.scopeId } : {}),
          ...(request.idempotencyKey ? { idempotencyKey: request.idempotencyKey } : {})
        };
        await updateReleaseRecord(projectRoot, releaseId, {
          status: "promote_failed",
          files: releaseFiles,
          changedSources: snapshot.changedSources,
          diff: snapshot.diff,
          validation: { ok: true, results: gate.results },
          recoveryRequired: restoreRequired,
          activationStatus: "unconfirmed",
          attemptId
        });
        if (options.recordPromoteFailureImpl) {
          await options.recordPromoteFailureImpl(projectRoot, failedRecord);
        }
      } catch (recordError) {
        const message = recordError instanceof Error ? recordError.message : String(recordError);
        console.error(
          `[lucy-semantic] release ${releaseId} could not persist promote_failed; rollback was not skipped. ${message}`
        );
      }
      await cleanupSemanticPublishStaging(projectRoot, request.validationId).catch(() => undefined);
      try {
        await releasePublishLock(projectRoot);
      } catch (releaseError) {
        const message = releaseError instanceof Error ? releaseError.message : String(releaseError);
        console.error(
          `[lucy-semantic] release ${releaseId} failed to release the publish window after promote rollback. ${message}`
        );
      }
      await deleteSnapshot(projectRoot, request.validationId).catch(() => undefined);
      throw error;
    }
  }

  // ★ L25-11 §7.2 (D16): the files are saved, but the journal is NOT closed.
  // It stays open in the "files saved, activation not yet proven" phase until
  // the mirror, the index, the final digest and the terminal evidence are all
  // durable. Closing it here would declare the batch finished while its
  // activation is still unknown.
  if (recoveryJournalId) {
    await markRecoveryJournalFilesSaved(projectRoot, recoveryJournalId);
  }

  // Promote succeeded — record `reindexing` and return immediately.
  const reindexingRecord = await updateReleaseRecord(projectRoot, releaseId, {
    status: "reindexing",
    files: releaseFiles,
    changedSources: snapshot.changedSources,
    diff: snapshot.diff,
    validation: { ok: true, results: gate.results },
    recoveryRequired: false,
    activationStatus: "unconfirmed",
    attemptId
  });
  if (!reindexingRecord) {
    await releasePublishLock(projectRoot);
    throw new SemanticAssetValidationError(
      "semantic_snapshot_unavailable",
      "promoting 记录在转入重建索引前消失，本次没有继续写入。",
      [],
      409
    );
  }
  await recordConfigChange({
    filePath: "semantic-layer/",
    changeType: "semantic_publish",
    assetKind: "publish",
    actor: actor,
    actorType: "ui_admin",
    source: "publish_workbench_api",
    targetId: releaseId,
    operation: "publish",
    requestId: request.validationId,
    oldSummary: { releaseId, changedSources: snapshot.changedSources.length },
    newSummary: {
      releaseId,
      fileCount: releaseFiles.length,
      connections: reindexingRecord.connectionIds,
      validateOk: gate.ok
    },
    diff: snapshot.diff
  });

  // Snapshot is consumed; clean it up.
  await deleteSnapshot(projectRoot, request.validationId);
  // Staging must be removed once the formal files are in place.
  await cleanupSemanticPublishStaging(projectRoot, request.validationId).catch(() => undefined);

  // Kick off async reindex; do NOT await. The publish lock stays held until
  // the terminal evidence is durable (L25-11 §7.2 / D23). Releasing it when
  // the index command returns would let another writer in before the digest
  // check, the terminal audit, `published` and the journal completion.
  const reindexImpl = options.reindexImpl ?? reindexProject;
  const reloadImpl = options.reloadCatalogImpl ?? reloadCatalog;
  const persistReindexFailure = async (
    reindex: { ok: false; exitCode: number; stdout?: string; stderr?: string }
  ) => {
    if (recoveryJournalId) {
      await markRecoveryJournalActivationPending(projectRoot, recoveryJournalId);
    }
    await updateReleaseRecord(projectRoot, releaseId, {
      status: "reindex_failed",
      reindex,
      recoveryRequired: false,
      activationStatus: "unconfirmed",
      attemptId
    });
    await reloadCatalog(projectRoot).catch(() => undefined);
  };
  const persistTerminalFailure = async (message: string) => {
    console.error(
      `[lucy-semantic] release ${releaseId} failed after the index succeeded; ` +
        `publishing stays closed until the journal is resolved. ${message}`
    );
    if (recoveryJournalId) {
      await markRecoveryJournalBlocked(projectRoot, recoveryJournalId, message);
    }
    await updateReleaseRecord(projectRoot, releaseId, {
      status: "promote_failed",
      recoveryRequired: true,
      activationStatus: "unconfirmed",
      attemptId
    });
    await reloadCatalog(projectRoot).catch(() => undefined);
  };
  const runReindex = async () => {
    let settled = false;
    // Index-command failure leaves the journal activation-pending so the index
    // can be retried. Anything after a successful index (digest I/O, terminal
    // audit, journal completion) closes publishing instead.
    let stage: "index" | "after_index" = "index";
    try {
      await notePublishPhase(projectRoot, "reindexing");
      // Spec §5.3 — capture the content version that is about to be consumed
      // BEFORE the index reads the content root. Reading the disk after the
      // index returns and calling that the consumed version would register
      // whatever happens to be on disk at that moment, including a change
      // that landed during the index and was never consumed.
      const consumption = await beginPublishConsumptionEvidence(projectRoot, attemptId, releaseId);
      let reindexResult;
      try {
        reindexResult = await reindexImpl(projectRoot, { force: false });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // The files stay saved; the activation is NOT confirmed. The journal
        // stays open in the activation-pending phase so the index can be retried
        // without rolling back a write that actually landed.
        await persistReindexFailure({ ok: false, exitCode: 1, stderr: message });
        settled = true;
        return;
      }
      const ok = reindexResult.exitCode === 0;
      if (!ok) {
        await persistReindexFailure({
          ok: false,
          exitCode: reindexResult.exitCode,
          stdout: redactText(reindexResult.stdout),
          stderr: redactText(reindexResult.stderr)
        });
        settled = true;
        return;
      }

      stage = "after_index";
      await notePublishPhase(projectRoot, "verify_digest");
      // The index succeeded — now the remaining evidence must be verified before
      // `published` may be written (L25-11 §7.2). The lock is still held.
      const digestCheck = await verifyFinalTargetDigests(projectRoot, snapshot.files);
      if (!digestCheck.ok) {
        // The formal files or the runtime mirror do not match the plan: stop,
        // restore this batch and do NOT claim a success. A restore that throws
        // before it can mark the journal must still leave `recovery_required`,
        // not an activation-pending journal that the next publish would skip.
        const restore = options.restoreImpl ?? restoreRecoveryJournal;
        if (recoveryJournalId) {
          try {
            const restored = await restore(projectRoot, recoveryJournalId);
            if (!restored || restored.recoveryRequired) {
              console.error(
                `[lucy-semantic] release ${releaseId} failed its final digest check and could not be restored; ` +
                  "publishing and manual reindex stay closed until it is resolved"
              );
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(
              `[lucy-semantic] release ${releaseId} failed its final digest check and the restore threw; ` +
                "the journal stays recovery_required"
            );
            await markRecoveryJournalBlocked(projectRoot, recoveryJournalId, message);
          }
        }
        await updateReleaseRecord(projectRoot, releaseId, {
          status: "promote_failed",
          recoveryRequired: true,
          activationStatus: "unconfirmed",
          attemptId
        });
        await reloadCatalog(projectRoot).catch(() => undefined);
        settled = true;
        return;
      }

      await notePublishPhase(projectRoot, "terminal");
      // Reload the catalog before claiming published. A failed reload leaves
      // the journal activation-pending so the index can be retried; it must
      // not complete the journal or write `published`.
      try {
        await reloadImpl(projectRoot);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await persistReindexFailure({ ok: false, exitCode: 1, stderr: message });
        settled = true;
        return;
      }
      if (options.beforeTerminalAudit) await options.beforeTerminalAudit();

      // The terminal audit / history / status are persisted INSIDE the same
      // critical section, before the journal is completed.
      await recordConfigChange({
        filePath: "semantic-layer/",
        changeType: "semantic_publish_terminal",
        assetKind: "publish",
        actor: actor,
        actorType: "ui_admin",
        source: "publish_workbench_api",
        targetId: releaseId,
        operation: "publish_terminal",
        // L25-15 §8.1 — the terminal audit identity of this attempt. The
        // audit store refuses a duplicate key, so a startup replay cannot
        // append a second success audit.
        idempotencyKey: semanticTerminalAuditKey(releaseId, attemptId),
        requestId: request.validationId,
        oldSummary: { releaseId, attemptId },
        newSummary: {
          releaseId,
          attemptId,
          fileCount: releaseFiles.length,
          activationStatus: "confirmed",
          ...(confirmedPlanDigest ? { planDigest: confirmedPlanDigest } : {})
        },
        diff: snapshot.diff
      });

      await updateReleaseRecord(projectRoot, releaseId, {
        status: "published",
        reindex: {
          ok: true,
          exitCode: reindexResult.exitCode,
          stdout: redactText(reindexResult.stdout),
          stderr: redactText(reindexResult.stderr)
        },
        recoveryRequired: false,
        activationStatus: "confirmed",
        terminalAuditPending: true,
        attemptId
      });
      await updateReleaseRecord(projectRoot, releaseId, { terminalAuditPending: false });

      // Only now is every applicable evidence durable: close the journal.
      if (recoveryJournalId) {
        await completeRecoveryJournal(projectRoot, recoveryJournalId);
      }
      // Spec §5.3 — the baseline advance belongs to the SAME serial window as
      // the terminal verification, the terminal audit and the `published`
      // record. It is a compare-and-swap: if the generation moved while the
      // index ran, the newer evidence wins and this attempt is marked
      // uncertain instead of overwriting it.
      await commitPublishConsumptionEvidence(projectRoot, attemptId, releaseId, consumption);
      settled = true;
    } catch (error) {
      if (!settled) {
        const message = error instanceof Error ? error.message : String(error);
        try {
          if (stage === "index") {
            await persistReindexFailure({ ok: false, exitCode: 1, stderr: message });
          } else {
            await persistTerminalFailure(message);
          }
        } catch (persistError) {
          const persistMessage = persistError instanceof Error ? persistError.message : String(persistError);
          console.error(
            `[lucy-semantic] release ${releaseId} could not persist its terminal state. ${persistMessage}`
          );
        }
      }
    } finally {
      try {
        if (options.beforeLockRelease) await options.beforeLockRelease();
      } finally {
        try {
          await releasePublishLock(projectRoot);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(
            `[lucy-semantic] release ${releaseId} failed to release the publish window; ` +
              `the holder is kept so a later attempt can retry. ${message}`
          );
        }
      }
    }
  };
  const scheduleReindex =
    typeof setImmediate === "function"
      ? setImmediate
      : (fn: () => void) => setTimeout(fn, 0);
  scheduleReindex(() => {
    void runReindex();
  });
  // `promoteFailed` is checked in case the await above threw — unreachable
  // here but keeps the linter quiet.
  void promoteFailed;

  return {
    accepted: true,
    release: reindexingRecord
  };
}

/**
 * Verify that every written target still carries the content the plan
 * committed, in BOTH the formal content root and the runtime mirror.
 *
 * ★ L25-11 §7.2 (D20): `published` requires the formal files and the runtime
 * mirror to agree with the target digest. An index command that exited 0 says
 * nothing about that.
 */
async function verifyFinalTargetDigests(
  projectRoot: string,
  files: ReadonlyArray<{ targetPath: string; sha256: string }>
): Promise<{ ok: boolean; mismatches: string[] }> {
  const mismatches: string[] = [];
  const contentPaths = await resolveContentPaths(projectRoot);
  const legacyLayout = path.resolve(contentPaths.configDir) === path.resolve(projectRoot);

  for (const file of files) {
    const formalAbs = path.resolve(contentPaths.configDir, file.targetPath);
    const formal = await readFile(formalAbs, "utf8").catch(() => null);
    if (formal === null || sha256(formal) !== file.sha256) {
      mismatches.push(file.targetPath);
      continue;
    }
    if (legacyLayout) continue; // No separate mirror in the legacy sibling layout.
    const mirrorAbs = path.resolve(projectRoot, file.targetPath);
    const mirrored = await readFile(mirrorAbs, "utf8").catch(() => null);
    if (mirrored === null || sha256(mirrored) !== file.sha256) {
      mismatches.push(`${file.targetPath}（运行镜像）`);
    }
  }
  return { ok: mismatches.length === 0, mismatches };
}

/**
 * Rebuild the batch plan from the CURRENT disk state and compare it with the
 * digest the operator confirmed (L25-11 §7.2, D14).
 *
 * The digest covers the candidates, the exact target set, each target's
 * expected digest (including the "target did not exist" marker) and the
 * overwrite set. A single changed target invalidates the confirmation.
 */
async function rebuildBatchPlan(
  projectRoot: string,
  snapshot: ValidationSnapshot
): Promise<{ planDigest: string; overwriteSet: string[]; changed: string[] }> {
  const batch = snapshot.batch!;
  const digestInput = computeBatchPlanDigestInput({
    candidates: snapshot.files.map((file) => ({
      targetPath: file.targetPath,
      content: file.content
    })),
    candidateDigest: batch.candidateDigest,
    scopeId: batch.scopeId,
    refs: batch.refs,
    dependencies: batch.dependencies,
    targetDigests: batch.targetDigests,
    overwriteSet: batch.overwriteSet
  });
  const recomputed = await recomputeSemanticPlanDigest(projectRoot, {
    candidate: digestInput.candidate,
    targets: batch.targetDigests.map((target) => ({ path: target.path })),
    confirmedPlanDigest: batch.planDigest,
    expected: batch.targetDigests,
    extra: digestInput.extra
  });

  // The overwrite set is recomputed from the CURRENT disk state: a target that
  // was created after the preview must show up as an overwrite now.
  const overwriteSet: string[] = [];
  for (const target of batch.targetDigests) {
    const current = await readExistingTextOrEmpty(projectRoot, target.path);
    if (current.length > 0) overwriteSet.push(target.path);
  }
  overwriteSet.sort();

  return {
    planDigest: recomputed.planDigest,
    overwriteSet,
    changed: recomputed.changed
  };
}

async function acquirePublishLockReleaseId(projectRoot: string, releaseId: string): Promise<void> {
  // Replace the lock payload to include the release id; the existence check
  // already happened via `acquirePublishLock`.
  if (!publishLockHolder) return;
  await updatePublishCoordinatorLockPayload(projectRoot, publishLockHolder, { releaseId });
}

/**
 * The COMPLETE publish plan for a staged batch (Lucy v0.25 / L25-11 §3.2, D13).
 *
 * The plan covers BOTH:
 *   - this batch's staged candidates, and
 *   - the pending disk changes that already exist and would be indexed too.
 *
 * The index is batch-wide, so the confirmation must show everything the batch
 * would actually activate. A Catalog selection may NOT be presented as a
 * partial activation.
 */
export type SemanticBatchPlanResponse = {
  validationId: string;
  batchId: string;
  scopeId: string;
  planDigest: string;
  candidateDigest: string;
  /** The staged candidates of this batch. */
  candidates: Array<{
    targetPath: string;
    identity: { connectionId: string; schema: string; table: string } | null;
    expectedDigest: string | null;
    overwrite: boolean;
  }>;
  /** The pending disk changes that are NOT part of this batch. */
  unrelatedDiskChanges: Array<{ targetPath: string; expectedDigest: string | null }>;
  /** The exact overwrite set the confirmation covers. */
  overwriteSet: string[];
  /** Everything the batch would write. */
  effectiveTargets: string[];
  dependencies: Array<{ connectionId: string; schema: string; table: string }>;
  /** The read-only dependencies that travel with the batch. */
  readonlyDependencies: Array<{ connectionId: string; schema: string; table: string }>;
};

export async function describeSemanticBatchPlan(
  projectRoot: string,
  validationId: string,
  context: { actor: string; instanceId: string }
): Promise<SemanticBatchPlanResponse> {
  const snapshot = await readSnapshot(projectRoot, validationId);
  if (!snapshot || !snapshot.batch) {
    throw new SemanticAssetValidationError(
      "VALIDATION_SNAPSHOT_NOT_FOUND",
      "validationId 已失效或不存在，请重新导入后再预览。",
      [],
      404
    );
  }
  const batch = snapshot.batch;
  if (batch.actor !== context.actor) {
    throw new SemanticAssetValidationError(
      "VALIDATION_SNAPSHOT_NOT_FOUND",
      "该批次属于其他操作者，不能直接消费。",
      [],
      403
    );
  }
  if (batch.instanceId !== context.instanceId) {
    throw new SemanticAssetValidationError(
      "VALIDATION_SNAPSHOT_NOT_FOUND",
      "该批次属于其他实例，不能直接消费。",
      [],
      403
    );
  }

  const candidatePaths = new Set(snapshot.files.map((file) => file.targetPath));
  const unrelatedDiskChanges: Array<{ targetPath: string; expectedDigest: string | null }> = [];
  for (const changed of await changedFiles(projectRoot)) {
    if (!changed.filePath.startsWith("semantic-layer/")) continue;
    if (candidatePaths.has(changed.filePath)) continue;
    const current = await readExistingTextOrEmpty(projectRoot, changed.filePath);
    unrelatedDiskChanges.push({
      targetPath: changed.filePath,
      expectedDigest: current.length > 0 ? sha256(current) : null
    });
  }
  unrelatedDiskChanges.sort((a, b) => a.targetPath.localeCompare(b.targetPath));

  const rebuilt = await rebuildBatchPlan(projectRoot, snapshot);
  const candidates = snapshot.files.map((file) => {
    const expected = batch.targetDigests.find((target) => target.path === file.targetPath);
    return {
      targetPath: file.targetPath,
      identity: null,
      expectedDigest: expected?.digest ?? null,
      overwrite: (expected?.digest ?? null) !== null
    };
  });

  return {
    validationId,
    batchId: batch.batchId,
    scopeId: batch.scopeId,
    planDigest: rebuilt.planDigest,
    candidateDigest: batch.candidateDigest,
    candidates,
    unrelatedDiskChanges,
    overwriteSet: rebuilt.overwriteSet,
    effectiveTargets: Array.from(
      new Set([
        ...candidates.map((candidate) => candidate.targetPath),
        ...unrelatedDiskChanges.map((change) => change.targetPath)
      ])
    ).sort(),
    dependencies: batch.dependencies,
    readonlyDependencies: batch.dependencies
  };
}

// ─── Internal test re-exports (intentionally not part of the public API) ──
export const __test = {
  classifyYaml,
  buildUnifiedDiff,
  redactText,
  SAFE_SEGMENT_RE,
  QUALIFIED_TABLE_RE,
  parseTableRef,
  readSnapshot,
  writeSnapshot,
  deleteSnapshot,
  appendReleaseRecord,
  updateReleaseRecord,
  readPublishLock,
  recordManualReindex,
  cleanupExpiredSemanticPublishStaging,
  cleanupSemanticPublishStaging,
  stagingDir,
  SNAPSHOTS_DIR_REL,
  STAGING_DIR_REL,
  PUBLISH_LOCK_REL,
  SIDECAR_RELEASES_REL
};

// Re-export ForbiddenPathError so route handlers can identify it from the
// validate path if we ever wrap a richer error class around it.
export { ForbiddenPathError };
