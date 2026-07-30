// M17: Controlled YAML catalog asset upload.
//
// WebUI is allowed to write only one kind of artifact:
// `semantic-layer/<connection>/_schema/<schema>.yaml`. The target path is
// computed on the server, never accepted from the client. Symlinks in the
// target chain are rejected: MVP can't reason about what they point at, so
// the safe default is to refuse the write.
//
// The audit sidecar (`.ktx-ui/catalog-asset-uploads.json`) only stores metadata
// + hashes. YAML content is never persisted to the sidecar.
//
// No ktx subprocess is invoked from this module. The only side effect after
// writing the manifest is the static `reloadCatalog(...)` call so the UI
// immediately sees the new asset.

import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, writeFile, lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { realpath } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { reloadCatalog, type CatalogReloadRun } from "./catalog-reload";
import { readProject } from "./project";

const MAX_BYTES = 512 * 1024;
const MAX_RECORDS = 50;
const SIDECAR_REL = ".ktx-ui/catalog-asset-uploads.json";

// ─── M17 types (mirror of `webui/src/lib/types.ts`) ──────────────────────
// Server-side definition of the public shape. Frontend type definitions
// must stay in lock-step. Only export names that route handlers re-use.

export type CatalogAssetType = "schemaManifest";

export type CatalogAssetErrorCode =
  | "UNKNOWN_CONNECTION"
  | "SCHEMA_NOT_CONFIGURED"
  | "INVALID_ASSET_TYPE"
  | "INVALID_FILENAME"
  | "FILE_TOO_LARGE"
  | "YAML_PARSE_FAILED"
  | "INVALID_MANIFEST"
  | "PATH_NOT_ALLOWED";

export type CatalogAssetError = {
  code: CatalogAssetErrorCode;
  message: string;
};

export type CatalogAssetWarningCode =
  | "EMPTY_MANIFEST"
  | "TARGET_EXISTS"
  | "TABLE_SCHEMA_MISMATCH"
  | "UNKNOWN_MANIFEST_SHAPE";

export type CatalogAssetWarning = {
  code: CatalogAssetWarningCode;
  message: string;
  table?: string;
};

export type CatalogAssetValidateRequest = {
  connectionId: string;
  schema: string;
  assetType: CatalogAssetType;
  filename: string;
  content: string;
};

export type CatalogAssetValidateResponse = {
  valid: boolean;
  connectionId: string;
  schema: string;
  assetType: CatalogAssetType;
  targetPath: string;
  exists: boolean;
  originalFilename: string;
  sizeBytes: number;
  sha256: string;
  tables: number;
  tableNames: string[];
  warnings: CatalogAssetWarning[];
  errors: CatalogAssetError[];
};

export type CatalogAssetUploadRequest = CatalogAssetValidateRequest & {
  confirmOverwrite?: boolean;
};

export type CatalogAssetUploadRecord = {
  id: string;
  createdAt: string;
  connectionId: string;
  schema: string;
  assetType: CatalogAssetType;
  targetPath: string;
  originalFilename: string;
  sizeBytes: number;
  sha256: string;
  tables: number;
  overwritten: boolean;
  warnings: CatalogAssetWarning[];
  reloadRunId?: string;
};

export type CatalogAssetUploadsResponse = {
  records: CatalogAssetUploadRecord[];
  lastBySchema: Record<string, CatalogAssetUploadRecord>;
};

export class CatalogAssetValidationError extends Error {
  code: CatalogAssetErrorCode;
  statusCode: 400 | 403;
  validation: CatalogAssetValidateResponse;
  field?: string;

  constructor(
    code: CatalogAssetErrorCode,
    message: string,
    validation: CatalogAssetValidateResponse,
    statusCode: 400 | 403 = 400,
    field?: string
  ) {
    super(message);
    this.name = "CatalogAssetValidationError";
    this.code = code;
    this.statusCode = statusCode;
    this.validation = validation;
    this.field = field;
  }
}

export class CatalogAssetOverwriteRequiredError extends Error {
  code = "TARGET_EXISTS";
  statusCode = 409;
  validation: CatalogAssetValidateResponse;

  constructor(validation: CatalogAssetValidateResponse) {
    super("目标 YAML 已存在，请确认覆盖后重试。");
    this.name = "CatalogAssetOverwriteRequiredError";
    this.validation = validation;
  }
}

function buildTargetRel(connectionId: string, schema: string): string {
  return path.posix.join("semantic-layer", connectionId, "_schema", `${schema}.yaml`);
}

function isSafePathSegment(segment: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(segment);
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

function sanitizeFilename(raw: string): string {
  // Strip any path components the client might try to inject.
  const base = path.basename(raw);
  return base;
}

function hasYamlExtension(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith(".yaml") || lower.endsWith(".yml");
}

type SchemaNameValidation =
  | { ok: true }
  | { ok: false; code: "SCHEMA_NOT_CONFIGURED" | "UNKNOWN_CONNECTION"; message: string };

async function validateSchemaAgainstConfig(
  projectRoot: string,
  connectionId: string,
  schema: string
): Promise<SchemaNameValidation> {
  const project = await readProject(projectRoot);
  if (!project) {
    return {
      ok: false,
      code: "UNKNOWN_CONNECTION",
      message: "readProject returned undefined"
    };
  }
  const conn = project.connections.find((c) => c.id === connectionId);
  if (!conn) {
    return {
      ok: false,
      code: "UNKNOWN_CONNECTION",
      message: `未在 ktx.yaml 中找到 connection '${connectionId}'`
    };
  }
  if (!conn.schemas.includes(schema)) {
    return {
      ok: false,
      code: "SCHEMA_NOT_CONFIGURED",
      message: `Schema '${schema}' 未在 connection '${connectionId}' 中声明`
    };
  }
  return { ok: true };
}

/**
 * Resolve the real, symlink-free path of the target. We intentionally allow
 * the project root itself to be a symlink, because developers often open a
 * project through a convenient workspace link. Starting at `semantic-layer`,
 * though, every existing path component in the target chain must be a real
 * directory, not a symlink. Validation never creates directories; upload may
 * create the missing tail and then re-run this check.
 */
export async function assertSafeTarget(
  projectRoot: string,
  targetRel: string,
  errors: CatalogAssetError[],
  options: { createParent?: boolean } = {}
): Promise<{ safeParentAbs: string; targetAbs: string; exists: boolean } | null> {
  const targetAbs = path.resolve(projectRoot, targetRel);
  const targetParentAbs = path.dirname(targetAbs);
  const semanticLayerRel = "semantic-layer";
  const semanticLayerAbs = path.resolve(projectRoot, semanticLayerRel);

  const semanticLstat = await lstat(semanticLayerAbs).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!semanticLstat) {
    errors.push({
      code: "PATH_NOT_ALLOWED",
      message: "项目缺少 semantic-layer 目录，无法写入 schema manifest"
    });
    return null;
  }
  if (semanticLstat.isSymbolicLink()) {
    errors.push({
      code: "PATH_NOT_ALLOWED",
      message: "semantic-layer 目录是符号链接，拒绝写入"
    });
    return null;
  }

  let realSemantic: string;
  try {
    realSemantic = await realpath(semanticLayerAbs);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      errors.push({
        code: "PATH_NOT_ALLOWED",
        message: "项目缺少 semantic-layer 目录，无法写入 schema manifest"
      });
      return null;
    }
    throw error;
  }

  const parentRelToSemantic = path.relative(semanticLayerAbs, targetParentAbs);
  if (parentRelToSemantic.startsWith("..") || path.isAbsolute(parentRelToSemantic)) {
    errors.push({
      code: "PATH_NOT_ALLOWED",
      message: "目标路径不在 semantic-layer 之内"
    });
    return null;
  }

  const parentSegments = parentRelToSemantic
    .split(path.sep)
    .filter((segment) => segment.length > 0);
  let currentAbs = semanticLayerAbs;
  let deepestExistingAbs = semanticLayerAbs;
  for (const segment of parentSegments) {
    currentAbs = path.join(currentAbs, segment);
    const info = await lstat(currentAbs).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!info) break;
    if (info.isSymbolicLink()) {
      errors.push({
        code: "PATH_NOT_ALLOWED",
        message: "目标目录链路包含符号链接，拒绝写入"
      });
      return null;
    }
    if (!info.isDirectory()) {
      errors.push({
        code: "PATH_NOT_ALLOWED",
        message: "目标父路径中存在非目录节点"
      });
      return null;
    }
    deepestExistingAbs = currentAbs;
  }

  const relative = path.relative(realSemantic, await realpath(deepestExistingAbs));
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    errors.push({
      code: "PATH_NOT_ALLOWED",
      message: "解析后的目标路径不在 semantic-layer 之内"
    });
    return null;
  }

  // Existing target file: must not be a symlink.
  let exists = false;
  try {
    const targetLstat = await lstat(targetAbs);
    exists = true;
    if (targetLstat.isSymbolicLink()) {
      errors.push({
        code: "PATH_NOT_ALLOWED",
        message: "目标 YAML 是符号链接，拒绝覆盖"
      });
      return null;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  if (options.createParent) {
    await mkdir(targetParentAbs, { recursive: true });
    const parentAfterCreate = await lstat(targetParentAbs);
    if (parentAfterCreate.isSymbolicLink() || !parentAfterCreate.isDirectory()) {
      errors.push({
        code: "PATH_NOT_ALLOWED",
        message: "目标父目录创建后不是安全目录"
      });
      return null;
    }
  }

  let safeParentAbs: string;
  try {
    safeParentAbs = await realpath(targetParentAbs);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      safeParentAbs = targetParentAbs;
    } else {
      throw error;
    }
  }

  return { safeParentAbs, targetAbs, exists };
}

type ManifestParseResult =
  | {
      ok: true;
      tables: string[];
      warnings: CatalogAssetWarning[];
    }
  | {
      ok: false;
      code: CatalogAssetErrorCode;
      message: string;
    };

function parseManifest(
  raw: string
): ManifestParseResult {
  let doc: unknown;
  try {
    doc = parseYaml(raw);
  } catch (error) {
    return {
      ok: false,
      code: "YAML_PARSE_FAILED",
      message: error instanceof Error ? error.message : "YAML 解析失败"
    };
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    return {
      ok: false,
      code: "INVALID_MANIFEST",
      message: "manifest 顶层必须是 mapping，目前不是合法对象"
    };
  }
  const root = doc as Record<string, unknown>;
  const tablesNode = root.tables;
  if (tablesNode === undefined) {
    return {
      ok: false,
      code: "INVALID_MANIFEST",
      message: "manifest 缺少 `tables` 字段"
    };
  }
  if (tablesNode === null || typeof tablesNode !== "object" || Array.isArray(tablesNode)) {
    return {
      ok: false,
      code: "INVALID_MANIFEST",
      message: "`tables` 必须是 mapping"
    };
  }
  const tables = Object.keys(tablesNode as Record<string, unknown>).filter(
    (name) => typeof name === "string" && name.length > 0
  );
  if (tables.length === 0) {
    return {
      ok: true,
      tables: [],
      warnings: [
        {
          code: "EMPTY_MANIFEST",
          message: "manifest 解析成功但未声明任何表，确认后仍可上传"
        }
      ]
    };
  }
  return { ok: true, tables, warnings: [] };
}

function buildBaseValidation(
  request: CatalogAssetValidateRequest,
  projectRoot: string,
  errors: CatalogAssetError[],
  warnings: CatalogAssetWarning[],
  targetRel: string
): Pick<
  CatalogAssetValidateResponse,
  | "valid"
  | "connectionId"
  | "schema"
  | "assetType"
  | "targetPath"
  | "originalFilename"
  | "sizeBytes"
  | "sha256"
  | "errors"
  | "warnings"
  | "tableNames"
  | "tables"
> {
  const sanitized = sanitizeFilename(request.filename);
  if (!sanitized || !hasYamlExtension(sanitized)) {
    errors.push({
      code: "INVALID_FILENAME",
      message: "文件名必须是 .yaml 或 .yml 扩展名"
    });
  }

  const sizeBytes = Buffer.byteLength(request.content, "utf8");
  if (sizeBytes > MAX_BYTES) {
    errors.push({
      code: "FILE_TOO_LARGE",
      message: `文件超过 ${MAX_BYTES / 1024} KB 上限`
    });
  }

  return {
    valid: errors.length === 0,
    connectionId: request.connectionId,
    schema: request.schema,
    assetType: request.assetType,
    targetPath: targetRel,
    originalFilename: sanitized,
    sizeBytes,
    sha256: sha256(request.content),
    errors,
    warnings,
    tableNames: [],
    tables: 0
  };
}

export async function validateCatalogAsset(
  projectRoot: string,
  request: CatalogAssetValidateRequest
): Promise<CatalogAssetValidateResponse> {
  const errors: CatalogAssetError[] = [];
  const warnings: CatalogAssetWarning[] = [];

  const safeSegments =
    isSafePathSegment(request.connectionId) && isSafePathSegment(request.schema);
  if (!safeSegments) {
    errors.push({
      code: "PATH_NOT_ALLOWED",
      message: "connectionId 与 schema 只能作为安全路径段使用"
    });
  }

  if (request.assetType !== "schemaManifest") {
    errors.push({
      code: "INVALID_ASSET_TYPE",
      message: `不支持的 assetType: ${String(request.assetType)}`
    });
  }

  const targetRel = safeSegments
    ? buildTargetRel(request.connectionId, request.schema)
    : "semantic-layer/_invalid/_schema/_invalid.yaml";
  const base = buildBaseValidation(request, projectRoot, errors, warnings, targetRel);

  // Configuration checks (connection + schema in ktx.yaml).
  if (errors.length === 0) {
    const configCheck = await validateSchemaAgainstConfig(
      projectRoot,
      request.connectionId,
      request.schema
    );
    if (!configCheck.ok) {
      errors.push({ code: configCheck.code, message: configCheck.message });
    }
  }

  // File / size / extension checks (these short-circuit the manifest parse).
  if (errors.length > 0) {
    return {
      ...base,
      valid: false,
      exists: false,
      tables: 0,
      tableNames: []
    };
  }

  // Manifest parse.
  const parsed = parseManifest(request.content);
  if (!parsed.ok) {
    errors.push({ code: parsed.code, message: parsed.message });
    return {
      ...base,
      valid: false,
      exists: false,
      tables: 0,
      tableNames: []
    };
  }

  // Path safety check: compute realpaths, reject symlinks.
  const safety = await assertSafeTarget(projectRoot, targetRel, errors);
  if (!safety) {
    return {
      ...base,
      valid: false,
      exists: false,
      tables: 0,
      tableNames: []
    };
  }

  if (safety.exists) {
    warnings.push({
      code: "TARGET_EXISTS",
      message: `目标文件已存在：${targetRel}`
    });
  }

  return {
    ...base,
    valid: errors.length === 0,
    exists: safety.exists,
    tables: parsed.tables.length,
    tableNames: parsed.tables,
    warnings: [...warnings, ...parsed.warnings]
  };
}

// ─── Audit sidecar helpers ────────────────────────────────────────────────

type SidecarFile = {
  version: 1;
  records: CatalogAssetUploadRecord[];
};

function emptySidecar(): SidecarFile {
  return { version: 1, records: [] };
}

function normalizeSidecar(raw: unknown): SidecarFile {
  if (!raw || typeof raw !== "object") return emptySidecar();
  const obj = raw as { version?: unknown; records?: unknown };
  if (!Array.isArray(obj.records)) return emptySidecar();
  const records: CatalogAssetUploadRecord[] = [];
  for (const item of obj.records) {
    if (item && typeof item === "object") {
      records.push(item as CatalogAssetUploadRecord);
    }
  }
  return { version: 1, records };
}

async function readSidecar(projectRoot: string): Promise<SidecarFile> {
  try {
    const text = await readFile(path.resolve(projectRoot, SIDECAR_REL), "utf8");
    return normalizeSidecar(JSON.parse(text) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return emptySidecar();
    }
    throw error;
  }
}

async function appendRecord(
  projectRoot: string,
  record: CatalogAssetUploadRecord
): Promise<SidecarFile> {
  const current = await readSidecar(projectRoot);
  const next: SidecarFile = {
    version: 1,
    records: [...current.records, record].slice(-MAX_RECORDS)
  };
  const abs = path.resolve(projectRoot, SIDECAR_REL);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

function buildLastBySchema(
  records: CatalogAssetUploadRecord[]
): Record<string, CatalogAssetUploadRecord> {
  const out: Record<string, CatalogAssetUploadRecord> = {};
  // records are stored oldest-first; iterate in reverse so the most recent
  // record for each (connection.schema) key wins.
  for (let i = records.length - 1; i >= 0; i -= 1) {
    const record = records[i];
    if (!record) continue;
    const key = `${record.connectionId}.${record.schema}`;
    if (!out[key]) out[key] = record;
  }
  return out;
}

export async function readCatalogAssetUploads(
  projectRoot: string
): Promise<CatalogAssetUploadsResponse> {
  const file = await readSidecar(projectRoot);
  const records = file.records.slice(-MAX_RECORDS);
  return {
    records,
    lastBySchema: buildLastBySchema(records)
  };
}

// ─── Upload path ──────────────────────────────────────────────────────────

export type UploadCatalogAssetResult = {
  uploaded: true;
  record: CatalogAssetUploadRecord;
  validation: CatalogAssetValidateResponse;
  reload: CatalogReloadRun;
};

export async function uploadCatalogAsset(
  projectRoot: string,
  request: CatalogAssetUploadRequest
): Promise<UploadCatalogAssetResult> {
  const validation = await validateCatalogAsset(projectRoot, request);
  if (!validation.valid) {
    const first = validation.errors[0];
    throw new CatalogAssetValidationError(
      first?.code ?? "INVALID_MANIFEST",
      first?.message ?? "Catalog asset validation failed",
      validation,
      first?.code === "PATH_NOT_ALLOWED" ? 403 : 400
    );
  }
  if (validation.exists && request.confirmOverwrite !== true) {
    throw new CatalogAssetOverwriteRequiredError(validation);
  }

  // Recompute the safe target abs path (validate already did this, but we
  // re-resolve in case of a TOCTOU race with another writer).
  const targetRel = validation.targetPath;
  const errors: CatalogAssetError[] = [];
  const safety = await assertSafeTarget(projectRoot, targetRel, errors, { createParent: true });
  if (!safety) {
    throw new CatalogAssetValidationError(
      "PATH_NOT_ALLOWED",
      "目标路径在写入前被检测为不安全",
      validation,
      403
    );
  }

  // Atomic write: temp file in the same directory, then rename.
  const tempName = `.${randomUUID()}.upload.tmp`;
  const tempAbs = path.join(safety.safeParentAbs, tempName);
  await writeFile(tempAbs, request.content, "utf8");
  // Ensure the temp file is not a symlink that snuck in.
  try {
    const tempLstat = await lstat(tempAbs);
    if (tempLstat.isSymbolicLink()) {
      throw new CatalogAssetValidationError(
        "PATH_NOT_ALLOWED",
        "临时文件被替换为符号链接",
        validation,
        403
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      // already moved
    } else {
      throw error;
    }
  }
  await rename(tempAbs, safety.targetAbs);

  // Audit record (no YAML content).
  const createdAt = new Date();
  const id = `up_${formatTimestamp(createdAt)}`;
  const record: CatalogAssetUploadRecord = {
    id,
    createdAt: createdAt.toISOString(),
    connectionId: validation.connectionId,
    schema: validation.schema,
    assetType: validation.assetType,
    targetPath: targetRel,
    originalFilename: validation.originalFilename,
    sizeBytes: validation.sizeBytes,
    sha256: validation.sha256,
    tables: validation.tables,
    overwritten: validation.exists,
    warnings: validation.warnings
  };

  // Static catalog reload so the rest of the UI sees the new manifest.
  const reload = await reloadCatalog(projectRoot, {
    connectionId: validation.connectionId,
    schema: validation.schema
  });
  const finalRecord: CatalogAssetUploadRecord = {
    ...record,
    reloadRunId: reload.id
  };
  await appendRecord(projectRoot, finalRecord);
  return {
    uploaded: true,
    record: finalRecord,
    validation,
    reload
  };
}

// Surface internal helpers for tests; do not export from any user-facing
// module path. Kept exported from this file because vitest tests are colocated
// under server/__tests__ and can import them directly.
export const __test = {
  buildTargetRel,
  sha256,
  formatTimestamp,
  MAX_BYTES,
  MAX_RECORDS,
  SIDECAR_REL
};
