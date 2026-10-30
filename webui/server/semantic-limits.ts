/**
 * Lucy v0.25 — shared capacity limits for semantic asset batch maintenance.
 *
 * Authority: docs/specs/lucy-20261020-v2p5-semantic-batch-operations-spec.md
 * §5 (round-trip limits), §6 (validation concurrency), §11 D1/D2/D6.
 *
 * Why this module exists:
 * Before v0.25 the export path and the import path each declared their own
 * constants — `semantic-asset-export.ts` allowed 200 files / 16 MiB while
 * `semantic-assets.ts` allowed 50 YAML / 3 MiB. A package produced by the
 * exporter could therefore be rejected by the importer, and neither side
 * matched the Spec. Spec §5 requires ONE shared definition used by both
 * directions, so this module is that definition and nothing else computes a
 * limit locally.
 *
 * Failure-closed rule: every limit is a hard refusal. Nothing in this module
 * truncates, samples or silently drops entries — Spec §5 says "无静默截断"
 * (no silent truncation) and §6 says an over-limit dependency set must be
 * split into explicit tasks by the caller, never auto-trimmed.
 */

/** The single source of truth for every v0.25 P0-3 capacity / timing limit. */
export const SEMANTIC_BATCH_LIMITS = {
  /** Max YAML entries in one package (editable overlays + read-only context). */
  maxYamlEntries: 200,
  /** Max size of one YAML file inside a package. */
  maxSingleYamlBytes: 8 * 1024 * 1024,
  /** Max size of the `package.json` metadata document. */
  maxMetadataBytes: 256 * 1024,
  /** Max total uncompressed content of one package. */
  maxUnpackedBytes: 16 * 1024 * 1024,
  /** Max size of the uploaded ZIP container. */
  maxZipBytes: 20 * 1024 * 1024,
  /** Max size of an HTTP JSON request body (covers Base64 overhead). */
  maxHttpBodyBytes: 32 * 1024 * 1024,
  /** Max number of read-only dependency YAML entries. */
  maxDependencyEntries: 200,
  /** Max number of tables a single batch validation may cover. */
  maxSelectedTables: 200,
  /** Fixed number of parallel checks (Spec §6, D1). */
  checkConcurrency: 4,
  /** Per-table check timeout (Spec §6, D1). */
  perTableTimeoutMs: 30_000,
  /** Whole-task timeout (Spec §6, D1). */
  taskTimeoutMs: 10 * 60_000,
  /** Preview / validation snapshot TTL (Spec §4.5, D2). */
  scopeTtlMs: 30 * 60_000,
  /** Maintenance package export baseline TTL (Spec §5, D2). */
  exportBaselineTtlMs: 7 * 24 * 60 * 60_000,
  /** Server-side idempotency record retention (Spec §7.2, D15). */
  idempotencyRetentionMs: 24 * 60 * 60_000
} as const;

export type SemanticBatchLimits = typeof SEMANTIC_BATCH_LIMITS;

export type SemanticLimitCode =
  | "YAML_ENTRY_LIMIT"
  | "YAML_SIZE_LIMIT"
  | "METADATA_SIZE_LIMIT"
  | "UNPACKED_SIZE_LIMIT"
  | "ZIP_SIZE_LIMIT"
  | "HTTP_BODY_LIMIT"
  | "DEPENDENCY_LIMIT"
  | "SELECTED_TABLE_LIMIT";

export class SemanticLimitError extends Error {
  readonly code: SemanticLimitCode;
  readonly statusCode = 413;

  constructor(code: SemanticLimitCode, message: string) {
    super(message);
    this.name = "SemanticLimitError";
    this.code = code;
  }
}

function mb(bytes: number): string {
  return `${bytes / 1024 / 1024} MiB`;
}

function kb(bytes: number): string {
  return `${bytes / 1024} KiB`;
}

/** Assert the number of YAML entries in one package. */
export function assertYamlEntryLimit(count: number): void {
  if (count > SEMANTIC_BATCH_LIMITS.maxYamlEntries) {
    throw new SemanticLimitError(
      "YAML_ENTRY_LIMIT",
      `YAML 条目数 ${count} 超过上限 ${SEMANTIC_BATCH_LIMITS.maxYamlEntries}；请拆分为多个显式任务，系统不会自动截断。`
    );
  }
}

/** Assert the size of one YAML file. */
export function assertSingleYamlLimit(byteLength: number, label: string): void {
  if (byteLength > SEMANTIC_BATCH_LIMITS.maxSingleYamlBytes) {
    throw new SemanticLimitError(
      "YAML_SIZE_LIMIT",
      `${label} 大小 ${byteLength} 字节超过单文件上限 ${kb(SEMANTIC_BATCH_LIMITS.maxSingleYamlBytes)}`
    );
  }
}

/** Assert the size of the package metadata document. */
export function assertMetadataLimit(byteLength: number): void {
  if (byteLength > SEMANTIC_BATCH_LIMITS.maxMetadataBytes) {
    throw new SemanticLimitError(
      "METADATA_SIZE_LIMIT",
      `package.json 元数据大小 ${byteLength} 字节超过上限 ${kb(SEMANTIC_BATCH_LIMITS.maxMetadataBytes)}`
    );
  }
}

/** Assert the total uncompressed size of one package. */
export function assertUnpackedLimit(byteLength: number): void {
  if (byteLength > SEMANTIC_BATCH_LIMITS.maxUnpackedBytes) {
    throw new SemanticLimitError(
      "UNPACKED_SIZE_LIMIT",
      `解压内容总计 ${byteLength} 字节超过上限 ${mb(SEMANTIC_BATCH_LIMITS.maxUnpackedBytes)}`
    );
  }
}

/** Assert the size of the uploaded ZIP container. */
export function assertZipLimit(byteLength: number): void {
  if (byteLength > SEMANTIC_BATCH_LIMITS.maxZipBytes) {
    throw new SemanticLimitError(
      "ZIP_SIZE_LIMIT",
      `包大小 ${byteLength} 字节超过上限 ${mb(SEMANTIC_BATCH_LIMITS.maxZipBytes)}`
    );
  }
}

/** Assert the size of an HTTP JSON request body. */
export function assertHttpBodyLimit(byteLength: number): void {
  if (byteLength > SEMANTIC_BATCH_LIMITS.maxHttpBodyBytes) {
    throw new SemanticLimitError(
      "HTTP_BODY_LIMIT",
      `请求体 ${byteLength} 字节超过上限 ${mb(SEMANTIC_BATCH_LIMITS.maxHttpBodyBytes)}`
    );
  }
}

/** Assert the size of the read-only dependency set. */
export function assertDependencyLimit(count: number): void {
  if (count > SEMANTIC_BATCH_LIMITS.maxDependencyEntries) {
    throw new SemanticLimitError(
      "DEPENDENCY_LIMIT",
      `只读依赖 ${count} 个超过上限 ${SEMANTIC_BATCH_LIMITS.maxDependencyEntries}；请拆分为多个显式任务，系统不会自动截断。`
    );
  }
}

/** Assert the size of the selected table set. */
export function assertSelectedTableLimit(count: number): void {
  if (count > SEMANTIC_BATCH_LIMITS.maxSelectedTables) {
    throw new SemanticLimitError(
      "SELECTED_TABLE_LIMIT",
      `本次校验选择了 ${count} 张表，超过上限 ${SEMANTIC_BATCH_LIMITS.maxSelectedTables} 张；请拆分为多个显式任务。`
    );
  }
}

/**
 * Self-check a candidate package against the import rules.
 *
 * Spec §5: "导出先按导入规则自检，再生成包" — the exporter runs the SAME
 * rules the importer will run, so a package that was produced locally can
 * always be re-imported. Any violation is a hard failure with no partial
 * package.
 */
export function assertPackageWithinImportLimits(input: {
  yamlEntryCount: number;
  metadataBytes: number;
  unpackedBytes: number;
  zipBytes?: number;
}): void {
  assertYamlEntryLimit(input.yamlEntryCount);
  assertMetadataLimit(input.metadataBytes);
  assertUnpackedLimit(input.unpackedBytes);
  if (typeof input.zipBytes === "number") assertZipLimit(input.zipBytes);
}

/** Human-readable limit summary — used by diagnostics and by the report header. */
export function describeSemanticBatchLimits(): Record<string, number> {
  return { ...SEMANTIC_BATCH_LIMITS };
}
