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
import { ForbiddenPathError } from "./fs-safe";
import { reindexProject, validateSource, type Issue, type ValidationResult } from "./ktx";
import { reloadCatalog } from "./catalog-reload";
import { recordConfigChange } from "./admin/audit.js";
import { isSemanticLayerJunkName } from "./semantic-layer-junk";

// ─── Public types (mirror of `webui/src/lib/types.ts`) ─────────────────────

export type SemanticAssetKind = "schemaManifest" | "semanticSource" | "wiki" | "eval";

export type SemanticAssetWarningCode =
  | "TARGET_EXISTS"
  | "EMPTY_MANIFEST"
  | "TABLE_SCHEMA_MISMATCH"
  | "UNKNOWN_MANIFEST_SHAPE"
  | "PUBLISH_LOCKED";

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
  | "PUBLISH_IN_PROGRESS"
  | "REINDEX_IN_PROGRESS";

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

export type SemanticAssetReleaseTrigger = "webui_publish" | "webui_manual_reindex";

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
};

export type SemanticAssetReleaseStatusResponse = {
  release: SemanticAssetReleaseRecord;
};

export type SemanticAssetPublishRequest = {
  validationId: string;
  confirmOverwrite?: boolean;
};

export type SemanticAssetPublishResponse = {
  accepted: boolean;
  release: SemanticAssetReleaseRecord;
};

// ─── Internal helpers ──────────────────────────────────────────────────────

const MAX_FILE_BYTES = 512 * 1024;
const MAX_PACKAGE_BYTES = 3 * 1024 * 1024;
const MAX_PACKAGE_DEPTH = 6;
const MAX_RELEASE_RECORDS = 100;
const MAX_SNAPSHOTS = 50;
const SIDECAR_RELEASES_REL = ".ktx-ui/semantic-asset-releases.json";
const SNAPSHOTS_DIR_REL = ".ktx-ui/semantic-asset-snapshots";
const STAGING_DIR_REL = ".ktx-ui/staging/semantic-publish";
const PUBLISH_LOCK_REL = ".ktx-ui/semantic-publish.lock";
const DEFAULT_STAGING_TTL_MS = 60 * 60 * 1000;
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
    const data =
      method === 0 ? compressed : method === 8 ? inflateRawSync(compressed) : null;
    if (!data) {
      throw new Error(`${filename} 包内文件使用了不支持的压缩方法：${rawName}`);
    }
    if (data.length > MAX_FILE_BYTES) {
      throw new Error(`${filename} 包内文件解压后超过 ${MAX_FILE_BYTES / 1024} KB：${rawName}`);
    }
    files.push({ filename: entryName, content: data.toString("utf8") });
  }
  return files;
}

function extractTarGzYamlFiles(
  filename: string,
  buffer: Buffer
): Array<{ filename: string; content: string }> {
  const tar = gunzipSync(buffer);
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

async function writeSidecar(projectRoot: string, sidecar: SidecarFile): Promise<void> {
  const abs = path.resolve(projectRoot, SIDECAR_RELEASES_REL);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, `${JSON.stringify(sidecar, null, 2)}\n`, "utf8");
}

async function appendReleaseRecord(
  projectRoot: string,
  record: SemanticAssetReleaseRecord
): Promise<void> {
  const current = await readSidecar(projectRoot);
  const next: SidecarFile = {
    version: 1,
    records: [...current.records, record].slice(-MAX_RELEASE_RECORDS)
  };
  await writeSidecar(projectRoot, next);
}

async function updateReleaseRecord(
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

function matchesReleaseQuery(
  record: SemanticAssetReleaseRecord,
  query: SemanticAssetReleaseListQuery | undefined
): boolean {
  if (!query) return true;
  if (query.since && record.createdAt < query.since) return false;
  if (query.until && record.createdAt > query.until) return false;
  if (query.trigger) {
    const trigger =
      record.trigger === "webui_manual_reindex" || record.trigger === "webui_publish"
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

export async function readSemanticAssetReleases(
  projectRoot: string,
  query?: SemanticAssetReleaseListQuery
): Promise<SemanticAssetReleasesResponse> {
  const sidecar = await readSidecar(projectRoot);
  const records = sidecar.records.slice(-MAX_RELEASE_RECORDS);
  records.sort(sortRecordsByCreatedAtDesc);
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
};

export async function recordManualReindex(
  projectRoot: string,
  input: ManualReindexInput
): Promise<SemanticAssetReleaseRecord> {
  const createdAt = input.startedAt ?? new Date().toISOString();
  const ok = input.reindex.ok;
  const record: SemanticAssetReleaseRecord = {
    id: newManualReindexId(),
    createdAt,
    actor: input.actor ?? "local-admin",
    status: ok ? "published" : "reindex_failed",
    trigger: "webui_manual_reindex",
    connectionIds: [],
    files: [],
    changedSources: [],
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

// ─── Publish lock (single-process MVP) ────────────────────────────────────

type LockHandle = {
  validationId: string;
  releaseId: string;
};

async function acquirePublishLock(
  projectRoot: string,
  payload: LockHandle
): Promise<boolean> {
  const abs = path.resolve(projectRoot, PUBLISH_LOCK_REL);
  await mkdir(path.dirname(abs), { recursive: true });
  try {
    const fd = await writeFile(
      abs,
      JSON.stringify({ ...payload, acquiredAt: new Date().toISOString() }),
      { encoding: "utf8", flag: "wx" }
    ).then((res) => res);
    // `wx` would have thrown if the file already exists. Touching the FD here
    // is a no-op; we only need the lock file to exist.
    void fd;
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw err;
  }
}

async function releasePublishLock(projectRoot: string): Promise<void> {
  const abs = path.resolve(projectRoot, PUBLISH_LOCK_REL);
  await rm(abs, { force: true });
}

async function readPublishLock(projectRoot: string): Promise<LockHandle | null> {
  try {
    const text = await readFile(path.resolve(projectRoot, PUBLISH_LOCK_REL), "utf8");
    return JSON.parse(text) as LockHandle;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
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
  for (const source of snapshot.changedSources) {
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
  if (inputFiles.length > 50) {
    errors.push({
      code: "PACKAGE_PARSE_FAILED",
      message: `一次最多提交 50 个 YAML 文件，当前为 ${inputFiles.length} 个`
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
        kind: "semanticSource",
        targetPath,
        exists: oldText.length > 0,
        sizeBytes,
        sha256: sha256(content),
        connectionId: conn.id,
        sourceName: classification.sourceName,
        physicalTable: classification.physicalTable,
        warnings: fileWarnings
      };
      filePreviews.push(preview);
      diffParts.push(buildUnifiedDiff(targetPath, oldText, content));
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
        content: inputFiles[index]?.content ?? "",
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
  } = {}
): Promise<SemanticAssetPublishResponse> {
  const actor = options.actor ?? "local-admin";
  const snapshot = await readSnapshot(projectRoot, request.validationId);
  if (!snapshot) {
    throw new SemanticAssetValidationError(
      "VALIDATION_SNAPSHOT_NOT_FOUND",
      "validationId 已失效或不存在，请重新校验后再发布",
      [],
      404
    );
  }

  const acquired = await acquirePublishLock(projectRoot, {
    validationId: request.validationId,
    releaseId: "pending"
  });
  if (!acquired) {
    throw new SemanticAssetValidationError(
      "PUBLISH_IN_PROGRESS",
      "已有发布批次正在执行，请等待当前批次完成后再试",
      [],
      409
    );
  }

  const now = options.now ?? (() => new Date());
  const releaseId = newReleaseId();
  await acquirePublishLockReleaseId(projectRoot, releaseId);
  const createdAt = now().toISOString();

  // Overwrite check (defer the gate until we know which files overwrite).
  const overwriteSet = new Set<string>();
  for (const file of snapshot.files) {
    const oldText = await readExistingTextOrEmpty(projectRoot, file.targetPath);
    if (oldText.length > 0) overwriteSet.add(file.targetPath);
  }
  if (overwriteSet.size > 0 && request.confirmOverwrite !== true) {
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
  if (!gate.ok) {
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
      validation: { ok: false, results: gate.results }
    };
    await appendReleaseRecord(projectRoot, record);
    await cleanupSemanticPublishStaging(projectRoot, request.validationId);
    await releasePublishLock(projectRoot);
    await deleteSnapshot(projectRoot, request.validationId);
    throw new SemanticAssetValidationError(
      "VALIDATION_GATE_FAILED",
      `validate gate 失败：${issues.map((i) => i.message).join("; ") || "见 results"}`,
      issues.map((i) => ({
        code: "VALIDATION_GATE_FAILED" as const,
        message: i.message,
        filePath: i.filePath,
        line: i.line,
        column: i.column
      })),
      422,
      record
    );
  }

  // Promote: write each proposed file atomically. If any step fails we record
  // promote_failed and return. We must NOT trigger reindex.
  const releaseFiles: SemanticAssetReleaseFile[] = [];
  let promoteFailed = false;
  for (const file of snapshot.files) {
    try {
      const { overwritten } = await promoteFile(projectRoot, file.targetPath, file.content);
      releaseFiles.push({
        targetPath: file.targetPath,
        kind: file.kind,
        sha256: file.sha256,
        overwritten
      });
    } catch (error) {
      promoteFailed = true;
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
        validation: { ok: true, results: gate.results }
      };
      await appendReleaseRecord(projectRoot, failedRecord);
      await cleanupSemanticPublishStaging(projectRoot, request.validationId);
      await releasePublishLock(projectRoot);
      await deleteSnapshot(projectRoot, request.validationId);
      throw error;
    }
  }

  // Promote succeeded — record `reindexing` and return immediately.
  const reindexingRecord: SemanticAssetReleaseRecord = {
    id: releaseId,
    createdAt,
    actor,
    status: "reindexing",
    trigger: "webui_publish",
    connectionIds: Array.from(new Set(snapshot.files.map((f) => f.connectionId))),
    files: releaseFiles,
    changedSources: snapshot.changedSources,
    diff: snapshot.diff,
    validation: { ok: true, results: gate.results }
  };
  await appendReleaseRecord(projectRoot, reindexingRecord);
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

  // Kick off async reindex; do NOT await. Keep the publish lock until reindex
  // reaches a terminal state so no second publish can promote files while the
  // Agent index is being rebuilt.
  const reindexImpl = options.reindexImpl ?? reindexProject;
  const runReindex = async () => {
    let reindexResult;
    try {
      reindexResult = await reindexImpl(projectRoot, { force: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await updateReleaseRecord(projectRoot, releaseId, {
        status: "reindex_failed",
        reindex: { ok: false, exitCode: 1, stderr: message }
      });
      await reloadCatalog(projectRoot).catch(() => undefined);
      return;
    } finally {
      await releasePublishLock(projectRoot).catch(() => undefined);
    }
    const ok = reindexResult.exitCode === 0;
    await updateReleaseRecord(projectRoot, releaseId, {
      status: ok ? "published" : "reindex_failed",
      reindex: {
        ok,
        exitCode: reindexResult.exitCode,
        stdout: redactText(reindexResult.stdout),
        stderr: redactText(reindexResult.stderr)
      }
    });
    await reloadCatalog(projectRoot).catch(() => undefined);
  };
  const scheduleReindex =
    typeof setImmediate === "function"
      ? setImmediate
      : (fn: () => void) => setTimeout(fn, 0);
  scheduleReindex(() => {
    void runReindex().catch(async () => {
      await releasePublishLock(projectRoot).catch(() => undefined);
    });
  });
  // `promoteFailed` is checked in case the await above threw — unreachable
  // here but keeps the linter quiet.
  void promoteFailed;

  return {
    accepted: true,
    release: reindexingRecord
  };
}

async function acquirePublishLockReleaseId(projectRoot: string, releaseId: string): Promise<void> {
  // Replace the lock payload to include the release id; the existence check
  // already happened via `acquirePublishLock`.
  const abs = path.resolve(projectRoot, PUBLISH_LOCK_REL);
  await writeFile(
    abs,
    JSON.stringify({ validationId: "in-progress", releaseId, acquiredAt: new Date().toISOString() }),
    "utf8"
  );
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
