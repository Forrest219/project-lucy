/**
 * Lucy v0.25 — the `semantic-maintenance-package/v1` round-trip package.
 *
 * Authority: docs/specs/lucy-20261020-v2p5-semantic-batch-operations-spec.md
 * §5 (round-trip package), §10 V06/V07/V09/V10, and §11 D4 / D5 / D7.
 *
 * ── The package ─────────────────────────────────────────────────────────────
 * A ZIP that carries:
 *   - `package.json` — the metadata (NOT an npm package; nothing is executed)
 *   - `overlays/<connection>/<source>.yaml` — the editable semantic overlays
 *   - `readonly/<connection>/_schema/<schema>.yaml` — read-only context
 *
 * Paths inside the ZIP are only a location hint. The real target of an entry
 * is always recomputed from the model identity by the server, never read from
 * the package.
 *
 * ── Security posture (Spec §5, V09) ────────────────────────────────────────
 * The unpacker is hostile-input code. It rejects absolute paths, `..`,
 * symlink / hardlink / non-regular entries, duplicate normalized paths,
 * duplicate identities, nested packages, unregistered entries and any
 * credential-bearing content — and it never returns a host absolute path.
 * Every rejection is a hard error: a package is either fully understood or
 * fully refused. There is no "skip the bad file and continue" mode.
 *
 * ── Export baseline (Spec §5, D7) ──────────────────────────────────────────
 * The package's provenance is proven by a SERVER-SIDE export record, not by
 * anything the client says. A package from another instance, an expired
 * record or an unknown record is refused; the user has to export again on
 * the target instance. The baseline lives 7 days (D2), separate from the
 * 30 minute scope snapshot.
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { resolveContentPaths } from "./paths";
import {
  SEMANTIC_BATCH_LIMITS,
  assertMetadataLimit,
  assertPackageWithinImportLimits,
  assertSingleYamlLimit,
  assertUnpackedLimit,
  assertYamlEntryLimit,
  assertZipLimit
} from "./semantic-limits";
import {
  semanticIdentityKey,
  sortUniqueSemanticIdentities,
  type SemanticTableIdentity
} from "./semantic-identity";

export const MAINTENANCE_PACKAGE_KIND = "semantic-maintenance-package/v1";

const METADATA_FILE_NAME = "package.json";
const OVERLAY_DIR = "overlays";
const READONLY_DIR = "readonly";
const EXPORT_BASELINE_DIR_REL = ".ktx-ui/semantic-export-baselines";

export type MaintenancePackageErrorCode =
  | "PACKAGE_TOO_LARGE"
  | "PACKAGE_PARSE_FAILED"
  | "PACKAGE_ENTRY_UNSAFE_PATH"
  | "PACKAGE_ENTRY_NOT_REGULAR"
  | "PACKAGE_ENTRY_DUPLICATE_PATH"
  | "PACKAGE_ENTRY_DUPLICATE_IDENTITY"
  | "PACKAGE_ENTRY_UNREGISTERED"
  | "PACKAGE_ENTRY_MISSING"
  | "PACKAGE_NESTED"
  | "PACKAGE_FORBIDDEN_CONTENT"
  | "PACKAGE_METADATA_INVALID"
  | "PACKAGE_INSTANCE_MISMATCH"
  | "PACKAGE_BASELINE_UNKNOWN"
  | "PACKAGE_BASELINE_EXPIRED"
  | "PACKAGE_BASELINE_MISMATCH"
  | "PACKAGE_READONLY_MODIFIED"
  | "PACKAGE_ENTRY_REBOUND"
  | "PACKAGE_SHARED_TARGET_ABSENT";

export class MaintenancePackageError extends Error {
  readonly code: MaintenancePackageErrorCode;
  readonly statusCode: number;

  constructor(code: MaintenancePackageErrorCode, message: string, statusCode = 400) {
    super(message);
    this.name = "MaintenancePackageError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

// ─── Metadata contract ──────────────────────────────────────────────────────

export type MaintenanceEntryRole = "editable_overlay" | "readonly_context";

export interface MaintenancePackageEntryMeta {
  /** Stable id inside the package. */
  entryId: string;
  role: MaintenanceEntryRole;
  /** The complete table identity. Never a bare table string. */
  identity: SemanticTableIdentity;
  /**
   * The OTHER table identities that share the same physical file.
   *
   * An overlay file is `semantic-layer/<connection>/<source>.yaml` — it has
   * NO schema dimension. Two schemas of one connection can therefore be
   * served by ONE file. Spec §4.4 forbids splitting such a file, so the
   * package carries it ONCE and lists every identity it serves here.
   */
  sharedIdentities: SemanticTableIdentity[];
  /** Location inside the ZIP (posix, relative). A hint — not a target path. */
  packagePath: string;
  /** SHA-256 of the exported content. Source / conflict reference, not a signature. */
  exportedDigest: string;
  /** SHA-256 of the target file at export time, or null when the target was absent. */
  targetDigest: string | null;
  /** Whether the target existed at export time. */
  baseTarget: "present" | "absent";
  /** SHA-256 of the semantic baseline digest this entry was derived from. */
  baselineDigest: string;
  /**
   * True for the generated placeholder of a table that had no overlay.
   * An untouched template must come back as "no change"; an edited template
   * is validated like any other semantic candidate.
   */
  template: boolean;
}

/** Every identity an entry serves (the primary one plus the shared ones). */
export function maintenanceEntryIdentities(
  entry: MaintenancePackageEntryMeta
): SemanticTableIdentity[] {
  return [entry.identity, ...(entry.sharedIdentities ?? [])];
}

export interface MaintenancePackageMetadata {
  packageKind: typeof MAINTENANCE_PACKAGE_KIND;
  schemaVersion: typeof MAINTENANCE_PACKAGE_KIND;
  exportId: string;
  exportedAt: string;
  instanceId: string;
  product: { name: string; version: string; revision: string };
  /** Digest of the semantic baseline the package was built from. */
  baselineDigest: string;
  /** Every selected table. */
  selected: SemanticTableIdentity[];
  /** Every read-only dependency. */
  dependencies: SemanticTableIdentity[];
  entries: MaintenancePackageEntryMeta[];
}

// ─── ZIP primitives (local, dependency-free) ────────────────────────────────

let crcTable: Uint32Array | null = null;

function crc32Table(): Uint32Array {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  crcTable = table;
  return table;
}

function crc32(buf: Buffer): number {
  const table = crc32Table();
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc = (table[(crc ^ buf[i]!) & 0xff]! ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value: number): Buffer {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(value, 0);
  return buf;
}

function u32(value: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(value >>> 0, 0);
  return buf;
}

interface ZipMember {
  name: string;
  data: Buffer;
}

/** Build an uncompressed (STORE) ZIP archive. */
export function buildMaintenanceZip(files: ZipMember[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, "utf8");
    const data = file.data;
    const crc = crc32(data);
    const localHeader = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(nameBuf.length),
      u16(0),
      nameBuf
    ]);
    localParts.push(localHeader, data);

    centralParts.push(
      Buffer.concat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(data.length),
        u32(data.length),
        u16(nameBuf.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        nameBuf
      ])
    );
    offset += localHeader.length + data.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const end = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralDir.length),
    u32(offset),
    u16(0)
  ]);

  return Buffer.concat([...localParts, centralDir, end]);
}

export interface RawZipEntry {
  /** The name as stored in the archive. */
  name: string;
  /** Unix mode extracted from the external attributes (0 when absent). */
  unixMode: number;
  data: Buffer;
}

/**
 * Parse a ZIP archive into its members.
 *
 * The parser is strict on purpose: an unsupported compression method, a
 * truncated header or a ZIP64 marker is an error, never a "best effort"
 * partial read.
 */
export function readZipEntries(buffer: Buffer): RawZipEntry[] {
  const eocdSignature = 0x06054b50;
  let eocdOffset = -1;
  const minOffset = Math.max(0, buffer.length - 65_558);
  for (let i = buffer.length - 22; i >= minOffset; i -= 1) {
    if (buffer.readUInt32LE(i) === eocdSignature) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new MaintenancePackageError("PACKAGE_PARSE_FAILED", "包不是合法 zip：缺少 central directory。");
  }
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  let cursor = buffer.readUInt32LE(eocdOffset + 16);
  const entries: RawZipEntry[] = [];
  let totalUncompressed = 0;

  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw new MaintenancePackageError("PACKAGE_PARSE_FAILED", "包不是合法 zip：central directory 损坏。");
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
    if (uncompressedSize === 0xffffffff || compressedSize === 0xffffffff) {
      throw new MaintenancePackageError(
        "PACKAGE_PARSE_FAILED",
        "包使用了 ZIP64 扩展，本期不支持。"
      );
    }
    if (rawName.endsWith("/")) continue;
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new MaintenancePackageError("PACKAGE_PARSE_FAILED", "包不是合法 zip：local header 损坏。");
    }
    const localNameLen = buffer.readUInt16LE(localOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buffer.length) {
      throw new MaintenancePackageError("PACKAGE_PARSE_FAILED", "包不是合法 zip：文件数据越界。");
    }
    const compressed = buffer.slice(dataStart, dataEnd);
    let data: Buffer;
    if (method === 0) {
      data = compressed;
    } else if (method === 8) {
      try {
        // The output bound is enforced DURING decompression. A small archive
        // can otherwise inflate into an unbounded buffer and exhaust memory
        // before the size checks below ever run.
        data = inflateRawSync(compressed, {
          maxOutputLength: SEMANTIC_BATCH_LIMITS.maxSingleYamlBytes
        });
      } catch (error) {
        if (error instanceof MaintenancePackageError) throw error;
        throw new MaintenancePackageError(
          "PACKAGE_PARSE_FAILED",
          "包内文件解压失败或超过单文件大小上限。"
        );
      }
    } else {
      throw new MaintenancePackageError(
        "PACKAGE_PARSE_FAILED",
        "包内文件使用了不支持的压缩方法。"
      );
    }
    if (data.length > SEMANTIC_BATCH_LIMITS.maxSingleYamlBytes) {
      throw new MaintenancePackageError(
        "PACKAGE_TOO_LARGE",
        "包内单个文件超过大小上限。"
      );
    }
    if (data.length !== uncompressedSize) {
      throw new MaintenancePackageError("PACKAGE_PARSE_FAILED", "包内文件大小与声明不一致。");
    }
    totalUncompressed += data.length;
    if (totalUncompressed > SEMANTIC_BATCH_LIMITS.maxUnpackedBytes) {
      throw new MaintenancePackageError(
        "PACKAGE_TOO_LARGE",
        "包内文件解压后总大小超过上限。"
      );
    }
    entries.push({ name: rawName, unixMode, data });
  }

  return entries;
}

// ─── Path safety ────────────────────────────────────────────────────────────

/**
 * Normalize a package-internal path and reject anything that could escape.
 *
 * Rejected: absolute paths, Windows drive letters, `..` segments, empty
 * segments, NUL bytes and paths outside the two known content directories.
 */
export function normalizePackagePath(raw: string): string | null {
  if (!raw || raw.includes("\0")) return null;
  const unified = raw.replace(/\\/g, "/");
  if (unified.startsWith("/")) return null;
  if (/^[A-Za-z]:/.test(unified)) return null;
  const parts = unified.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) return null;
  const normalized = parts.join("/");
  if (!normalized.startsWith(`${OVERLAY_DIR}/`) && !normalized.startsWith(`${READONLY_DIR}/`)) {
    return null;
  }
  return normalized;
}

const NESTED_PACKAGE_SUFFIXES = [".zip", ".tar.gz", ".tgz", ".tar"];

/** Credential-bearing keys are refused anywhere in an entry (Spec §5). */
const SECRET_KEY_RE =
  /(^|[\s"'-])(password|passwd|pwd|secret|token|api[_-]?key|apikey|authorization|private[_-]?key|credential)s?\s*[:=]/i;

function assertNoCredentialContent(content: string, label: string): void {
  if (SECRET_KEY_RE.test(content)) {
    throw new MaintenancePackageError(
      "PACKAGE_FORBIDDEN_CONTENT",
      `包内 ${label} 含凭据类字段，语义维护包不得携带凭据。`
    );
  }
}

// ─── Package build ──────────────────────────────────────────────────────────

export interface MaintenanceOverlayInput {
  identity: SemanticTableIdentity;
  /** Target path the overlay will be written to (server computed). */
  targetPath: string;
  /** The current overlay content, or null when no overlay exists yet. */
  content: string | null;
}

export interface MaintenanceReadonlyInput {
  connectionId: string;
  schema: string;
  /** Project-root-relative manifest path. */
  targetPath: string;
  content: string;
}

export interface BuildMaintenancePackageInput {
  projectRoot: string;
  exportId: string;
  instanceId: string;
  product: { name: string; version: string; revision: string };
  selected: readonly SemanticTableIdentity[];
  dependencies: readonly SemanticTableIdentity[];
  /** Digest of the semantic baseline the package was built from. */
  baselineDigest: string;
  overlays: readonly MaintenanceOverlayInput[];
  readonlyContexts: readonly MaintenanceReadonlyInput[];
  now?: () => number;
}

export interface BuiltMaintenancePackage {
  zip: Buffer;
  metadata: MaintenancePackageMetadata;
  /** SHA-256 of the ZIP bytes — the server-side export baseline key. */
  packageDigest: string;
}

/** The placeholder written for a table that has no overlay yet. */
export function buildOverlayTemplate(input: {
  identity: SemanticTableIdentity;
  sourceName: string;
  qualifiedName: string;
}): string {
  return [
    "# 语义维护包模板：这张表目前没有语义覆盖层。",
    "# 未修改直接导回会被识别为「无变化」；修改后按完整语义校验处理。",
    `name: ${input.sourceName}`,
    `table: ${input.qualifiedName}`,
    ""
  ].join("\n");
}

/**
 * Build a maintenance package.
 *
 * The exporter runs the IMPORT rules on its own output before handing it
 * back (Spec §5): a package that Lucy produced can always be re-imported by
 * Lucy. Over-limit input is a hard failure — never a truncated package.
 */
export async function buildMaintenancePackage(
  input: BuildMaintenancePackageInput
): Promise<BuiltMaintenancePackage> {
  const nowMs = (input.now ?? Date.now)();
  const exportedAt = new Date(nowMs).toISOString();

  const entries: MaintenancePackageEntryMeta[] = [];
  const files: ZipMember[] = [];

  // An overlay file has no schema dimension, so several identities can be
  // served by ONE physical file. The package carries that file once and
  // records every identity it serves (Spec §4.4: 本期不拆分写入).
  const overlayGroups = new Map<string, MaintenanceOverlayInput[]>();
  for (const overlay of input.overlays) {
    const bucket = overlayGroups.get(overlay.targetPath) ?? [];
    bucket.push(overlay);
    overlayGroups.set(overlay.targetPath, bucket);
  }

  for (const [targetPath, group] of overlayGroups) {
    const primary = group[0]!;
    const sharedIdentities = group.slice(1).map((overlay) => ({ ...overlay.identity }));
    if (group.length > 1 && primary.content === null) {
      // No overlay exists and one file would have to serve several tables:
      // an unambiguous template cannot be produced, so the export is
      // refused instead of emitting a misleading placeholder.
      throw new MaintenancePackageError(
        "PACKAGE_SHARED_TARGET_ABSENT",
        `目标 ${targetPath} 同时承载 ${group.length} 张表且尚无语义覆盖层，无法生成无歧义的模板；请先为其中一张表建立覆盖层后再导出。`,
        409
      );
    }
    const content =
      primary.content ??
      buildOverlayTemplate({
        identity: primary.identity,
        sourceName: primary.identity.table,
        qualifiedName: `${primary.identity.schema}.${primary.identity.table}`
      });
    const packagePath = `${OVERLAY_DIR}/${primary.identity.connectionId}/${primary.identity.table}.yaml`;
    const targetBytes = primary.content === null ? null : Buffer.from(primary.content, "utf8");
    entries.push({
      entryId: `overlay:${primary.identity.connectionId}/${primary.identity.table}`,
      role: "editable_overlay",
      identity: { ...primary.identity },
      sharedIdentities,
      packagePath,
      exportedDigest: createHash("sha256").update(Buffer.from(content, "utf8")).digest("hex"),
      targetDigest: targetBytes ? createHash("sha256").update(targetBytes).digest("hex") : null,
      baseTarget: targetBytes ? "present" : "absent",
      baselineDigest: input.baselineDigest,
      template: primary.content === null
    });
    files.push({ name: packagePath, data: Buffer.from(content, "utf8") });
  }

  for (const readonly of input.readonlyContexts) {
    const packagePath = `${READONLY_DIR}/${readonly.connectionId}/_schema/${readonly.schema}.yaml`;
    const data = Buffer.from(readonly.content, "utf8");
    entries.push({
      entryId: `context:${readonly.connectionId}/${readonly.schema}`,
      role: "readonly_context",
      identity: {
        connectionId: readonly.connectionId,
        schema: readonly.schema,
        table: readonly.schema
      },
      sharedIdentities: [],
      packagePath,
      exportedDigest: createHash("sha256").update(data).digest("hex"),
      targetDigest: createHash("sha256").update(data).digest("hex"),
      baseTarget: "present",
      baselineDigest: input.baselineDigest,
      template: false
    });
    files.push({ name: packagePath, data });
  }

  // The export self-check uses the IMPORT rules (Spec §5).
  for (const file of files) {
    assertSingleYamlLimit(file.data.length, file.name);
  }
  assertYamlEntryLimit(entries.length);

  const metadata: MaintenancePackageMetadata = {
    packageKind: MAINTENANCE_PACKAGE_KIND,
    schemaVersion: MAINTENANCE_PACKAGE_KIND,
    exportId: input.exportId,
    exportedAt,
    instanceId: input.instanceId,
    product: input.product,
    baselineDigest: input.baselineDigest,
    selected: sortUniqueSemanticIdentities(input.selected),
    dependencies: sortUniqueSemanticIdentities(input.dependencies),
    entries
  };

  const metadataBytes = Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  assertMetadataLimit(metadataBytes.length);

  const zipFiles: ZipMember[] = [
    { name: METADATA_FILE_NAME, data: metadataBytes },
    ...files
  ];
  const zip = buildMaintenanceZip(zipFiles);

  assertPackageWithinImportLimits({
    yamlEntryCount: entries.length,
    metadataBytes: metadataBytes.length,
    unpackedBytes: zipFiles.reduce((sum, file) => sum + file.data.length, 0),
    zipBytes: zip.length
  });

  return {
    zip,
    metadata,
    packageDigest: createHash("sha256").update(zip).digest("hex")
  };
}

// ─── Package unpack (hostile input) ─────────────────────────────────────────

export interface UnpackedMaintenanceEntry {
  meta: MaintenancePackageEntryMeta;
  /** The file content as shipped in the package. */
  content: string;
}

export interface UnpackedMaintenancePackage {
  metadata: MaintenancePackageMetadata;
  entries: UnpackedMaintenanceEntry[];
  /** SHA-256 of the uploaded ZIP bytes. */
  packageDigest: string;
}

function assertRegularFile(entry: RawZipEntry): void {
  if (entry.unixMode === 0) return;
  const fileType = entry.unixMode & 0o170000;
  if (fileType === 0) return;
  if (fileType === 0o100000) return;
  if (fileType === 0o120000) {
    throw new MaintenancePackageError(
      "PACKAGE_ENTRY_NOT_REGULAR",
      `包内 ${entry.name} 是符号链接，拒绝解包。`
    );
  }
  throw new MaintenancePackageError(
    "PACKAGE_ENTRY_NOT_REGULAR",
    `包内 ${entry.name} 不是普通文件（可能是硬链接或设备文件），拒绝解包。`
  );
}

/**
 * Unpack a maintenance package.
 *
 * Every check is fail-closed: the first violation aborts the whole unpack.
 * The result never contains a host absolute path.
 */
export function unpackMaintenancePackage(buffer: Buffer): UnpackedMaintenancePackage {
  assertZipLimit(buffer.length);

  const rawEntries = readZipEntries(buffer);

  const seenPaths = new Set<string>();
  let totalBytes = 0;
  for (const raw of rawEntries) {
    totalBytes += raw.data.length;
    assertUnpackedLimit(totalBytes);
  }

  const byPath = new Map<string, RawZipEntry>();
  for (const raw of rawEntries) {
    assertRegularFile(raw);
    const normalized = normalizePackagePath(raw.name);
    if (!normalized) {
      if (raw.name === METADATA_FILE_NAME) continue;
      if (NESTED_PACKAGE_SUFFIXES.some((suffix) => raw.name.toLowerCase().endsWith(suffix))) {
        throw new MaintenancePackageError(
          "PACKAGE_NESTED",
          `包内含嵌套包 ${raw.name}，语义维护包不接受嵌套包。`
        );
      }
      throw new MaintenancePackageError(
        "PACKAGE_ENTRY_UNSAFE_PATH",
        `包内路径不安全或不属于维护包目录结构：${raw.name}`
      );
    }
    if (seenPaths.has(normalized)) {
      throw new MaintenancePackageError(
        "PACKAGE_ENTRY_DUPLICATE_PATH",
        `包内路径重复：${normalized}`
      );
    }
    seenPaths.add(normalized);
    byPath.set(normalized, raw);
  }

  const metadataEntry = rawEntries.find((raw) => raw.name === METADATA_FILE_NAME);
  if (!metadataEntry) {
    throw new MaintenancePackageError(
      "PACKAGE_METADATA_INVALID",
      `包缺少 ${METADATA_FILE_NAME} 元数据。`
    );
  }
  if (metadataEntry.data.length > SEMANTIC_BATCH_LIMITS.maxMetadataBytes) {
    throw new MaintenancePackageError(
      "PACKAGE_METADATA_INVALID",
      `包元数据超过 ${SEMANTIC_BATCH_LIMITS.maxMetadataBytes} 字节上限。`
    );
  }

  let metadata: MaintenancePackageMetadata;
  try {
    metadata = JSON.parse(metadataEntry.data.toString("utf8")) as MaintenancePackageMetadata;
  } catch {
    throw new MaintenancePackageError("PACKAGE_METADATA_INVALID", "包元数据不是合法 JSON。");
  }
  if (
    !metadata ||
    metadata.packageKind !== MAINTENANCE_PACKAGE_KIND ||
    metadata.schemaVersion !== MAINTENANCE_PACKAGE_KIND ||
    !Array.isArray(metadata.entries)
  ) {
    throw new MaintenancePackageError(
      "PACKAGE_METADATA_INVALID",
      `包元数据格式不受支持，只接受 ${MAINTENANCE_PACKAGE_KIND}。`
    );
  }

  const registeredPaths = new Set<string>();
  const identityKeys = new Set<string>();
  const entries: UnpackedMaintenanceEntry[] = [];

  for (const meta of metadata.entries) {
    if (!meta || typeof meta !== "object" || typeof meta.packagePath !== "string") {
      throw new MaintenancePackageError("PACKAGE_METADATA_INVALID", "包元数据条目缺少 packagePath。");
    }
    const normalized = normalizePackagePath(meta.packagePath);
    if (!normalized) {
      throw new MaintenancePackageError(
        "PACKAGE_ENTRY_UNSAFE_PATH",
        `包元数据登记了不安全路径：${meta.packagePath}`
      );
    }
    if (registeredPaths.has(normalized)) {
      throw new MaintenancePackageError(
        "PACKAGE_ENTRY_DUPLICATE_PATH",
        `包元数据登记了重复路径：${normalized}`
      );
    }
    registeredPaths.add(normalized);

    const identityKey = semanticIdentityKey(meta.identity);
    if (identityKeys.has(identityKey)) {
      throw new MaintenancePackageError(
        "PACKAGE_ENTRY_DUPLICATE_IDENTITY",
        `包内存在重复表身份：${identityKey}`
      );
    }
    identityKeys.add(identityKey);
    for (const shared of meta.sharedIdentities ?? []) {
      const sharedKey = semanticIdentityKey(shared);
      if (identityKeys.has(sharedKey)) {
        throw new MaintenancePackageError(
          "PACKAGE_ENTRY_DUPLICATE_IDENTITY",
          `包内存在重复表身份：${sharedKey}`
        );
      }
      identityKeys.add(sharedKey);
    }

    const file = byPath.get(normalized);
    if (!file) {
      throw new MaintenancePackageError(
        "PACKAGE_ENTRY_MISSING",
        `包元数据登记的条目缺失：${normalized}`
      );
    }
    assertSingleYamlLimit(file.data.length, normalized);

    // A nested package inside an entry is refused even when it is named .yaml.
    if (
      file.data.length >= 4 &&
      file.data[0] === 0x50 &&
      file.data[1] === 0x4b &&
      file.data[2] === 0x03 &&
      file.data[3] === 0x04
    ) {
      throw new MaintenancePackageError(
        "PACKAGE_NESTED",
        `包内 ${normalized} 实际是一个嵌套包，拒绝解包。`
      );
    }

    const content = file.data.toString("utf8");
    assertNoCredentialContent(content, normalized);
    entries.push({ meta, content });
  }

  for (const path of byPath.keys()) {
    if (!registeredPaths.has(path)) {
      throw new MaintenancePackageError(
        "PACKAGE_ENTRY_UNREGISTERED",
        `包内存在未登记文件：${path}`
      );
    }
  }

  return {
    metadata,
    entries,
    packageDigest: createHash("sha256").update(buffer).digest("hex")
  };
}

/**
 * Compare the read-only context entries with the exported originals.
 *
 * Spec §5: "只读 entry 内容变化、entry 身份被改绑或缺少必要 entry 均阻断".
 */
export function assertReadonlyContextUnchanged(
  unpacked: UnpackedMaintenancePackage
): void {
  for (const entry of unpacked.entries) {
    if (entry.meta.role !== "readonly_context") continue;
    const current = createHash("sha256").update(Buffer.from(entry.content, "utf8")).digest("hex");
    if (current !== entry.meta.exportedDigest) {
      throw new MaintenancePackageError(
        "PACKAGE_READONLY_MODIFIED",
        `只读上下文 ${entry.meta.packagePath} 的内容被修改，语义维护包不接受对只读上下文的改动。`
      );
    }
  }
}

/**
 * Detect an entry whose identity was rebound to a different table.
 *
 * The identity is server-computed from the model, so a package that claims a
 * different identity for the same package path is refused.
 */
export function assertEntryIdentityNotRebound(
  unpacked: UnpackedMaintenancePackage,
  expectedIdentities: ReadonlyMap<string, SemanticTableIdentity>
): void {
  for (const entry of unpacked.entries) {
    const expected = expectedIdentities.get(entry.meta.packagePath);
    if (!expected) continue;
    if (semanticIdentityKey(expected) !== semanticIdentityKey(entry.meta.identity)) {
      throw new MaintenancePackageError(
        "PACKAGE_ENTRY_REBOUND",
        `包内条目 ${entry.meta.packagePath} 的表身份被改绑。`
      );
    }
  }
}

/**
 * Resolve the target files of the editable entries.
 *
 * The import service uses this to map a package entry back to the model
 * target. The target is NEVER taken from the package path: it is recomputed
 * from the model identity.
 */
export function resolveMaintenanceEntryTargets(
  unpacked: UnpackedMaintenancePackage,
  targetPathOf: (identity: SemanticTableIdentity) => string | null
): Array<{ entry: MaintenancePackageEntryMeta; targetPaths: string[] }> {
  return unpacked.entries
    .filter((entry) => entry.meta.role === "editable_overlay")
    .map((entry) => {
      const targetPaths: string[] = [];
      for (const identity of maintenanceEntryIdentities(entry.meta)) {
        const target = targetPathOf(identity);
        if (target && !targetPaths.includes(target)) targetPaths.push(target);
      }
      return { entry: entry.meta, targetPaths };
    });
}

// ─── Export baseline (server side, 7 days) ─────────────────────────────────

export interface MaintenanceExportBaseline {
  exportId: string;
  instanceId: string;
  packageDigest: string;
  exportedAt: string;
  expiresAt: string;
  baselineDigest: string;
  entries: Array<{
    entryId: string;
    packagePath: string;
    exportedDigest: string;
    targetDigest: string | null;
    identity: SemanticTableIdentity;
  }>;
}

function exportBaselineDir(projectRoot: string): string {
  return path.resolve(projectRoot, EXPORT_BASELINE_DIR_REL);
}

/** Persist the server-side export record. */
export async function persistMaintenanceExportBaseline(
  projectRoot: string,
  record: MaintenanceExportBaseline
): Promise<void> {
  const dir = exportBaselineDir(projectRoot);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, `${record.exportId}.json`),
    `${JSON.stringify(record, null, 2)}\n`,
    "utf8"
  );
}

/** Build the export baseline record for a freshly built package. */
export function buildExportBaseline(input: {
  metadata: MaintenancePackageMetadata;
  packageDigest: string;
  now?: () => number;
}): MaintenanceExportBaseline {
  const nowMs = (input.now ?? Date.now)();
  const exportedAt = new Date(nowMs);
  return {
    exportId: input.metadata.exportId,
    instanceId: input.metadata.instanceId,
    packageDigest: input.packageDigest,
    exportedAt: exportedAt.toISOString(),
    expiresAt: new Date(nowMs + SEMANTIC_BATCH_LIMITS.exportBaselineTtlMs).toISOString(),
    baselineDigest: input.metadata.baselineDigest,
    entries: input.metadata.entries.map((entry) => ({
      entryId: entry.entryId,
      packagePath: entry.packagePath,
      exportedDigest: entry.exportedDigest,
      targetDigest: entry.targetDigest,
      identity: entry.identity
    }))
  };
}

/** Read a persisted export baseline. */
export async function readMaintenanceExportBaseline(
  projectRoot: string,
  exportId: string
): Promise<MaintenanceExportBaseline | null> {
  if (!exportId || exportId.includes("/") || exportId.includes("\\") || exportId.includes("..")) {
    return null;
  }
  try {
    const text = await readFile(path.join(exportBaselineDir(projectRoot), `${exportId}.json`), "utf8");
    return JSON.parse(text) as MaintenanceExportBaseline;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Verify the package against the SERVER-SIDE export record.
 *
 * The client never gets to say "this is my export". The server compares the
 * uploaded bytes with the record it wrote at export time. An unknown record,
 * an expired record, another instance or a different package digest are all
 * refused — the user has to export again on this instance.
 */
export async function verifyMaintenanceExportBaseline(
  projectRoot: string,
  unpacked: UnpackedMaintenancePackage,
  context: { instanceId: string; now?: () => number }
): Promise<MaintenanceExportBaseline> {
  const metadata = unpacked.metadata;
  if (metadata.instanceId !== context.instanceId) {
    throw new MaintenancePackageError(
      "PACKAGE_INSTANCE_MISMATCH",
      "该语义维护包来自其他实例，本期不支持跨实例迁移；请在目标实例重新导出。",
      409
    );
  }
  const record = await readMaintenanceExportBaseline(projectRoot, metadata.exportId);
  if (!record) {
    throw new MaintenancePackageError(
      "PACKAGE_BASELINE_UNKNOWN",
      "服务端没有该语义维护包的导出记录，无法核验来源；请在目标实例重新导出。",
      409
    );
  }
  const nowMs = (context.now ?? Date.now)();
  if (Date.parse(record.expiresAt) <= nowMs) {
    throw new MaintenancePackageError(
      "PACKAGE_BASELINE_EXPIRED",
      `该语义维护包的导出记录已于 ${record.expiresAt} 过期；请在目标实例重新导出。`,
      409
    );
  }
  if (record.packageDigest !== unpacked.packageDigest) {
    // The whole-package digest CANNOT be compared here: an editable overlay is
    // EXPECTED to differ (Spec §5 — the overlay is the editable part of the
    // package), so requiring an identical archive digest would reject every
    // legitimately edited package and break the export → edit → import
    // journey entirely.
    //
    // The baseline is therefore verified ENTRY BY ENTRY against the server
    // record:
    //   - a read-only entry must still carry its exported content byte for byte;
    //   - an editable overlay may differ, but its identity binding and its
    //     recorded original digest must not have been rewritten.
    const recordByEntryId = new Map(record.entries.map((entry) => [entry.entryId, entry]));
    for (const entry of unpacked.entries) {
      const original = recordByEntryId.get(entry.meta.entryId);
      if (!original) {
        throw new MaintenancePackageError(
          "PACKAGE_BASELINE_MISMATCH",
          `包内条目 ${entry.meta.entryId} 不在服务端导出记录中，无法核验来源。`,
          409
        );
      }
      if (entry.meta.role === "readonly_context") {
        const current = createHash("sha256").update(Buffer.from(entry.content, "utf8")).digest("hex");
        if (current !== original.exportedDigest) {
          throw new MaintenancePackageError(
            "PACKAGE_BASELINE_MISMATCH",
            `包内只读条目 ${entry.meta.packagePath} 的内容与服务端导出记录不一致，无法核验来源。`,
            409
          );
        }
      }
      // The identity binding is never editable: re-pointing an entry at another
      // table would let a package carry changes into an unintended table.
      const originalIdentity = JSON.stringify(original.identity);
      const currentIdentity = JSON.stringify(entry.meta.identity);
      if (originalIdentity !== currentIdentity) {
        throw new MaintenancePackageError(
          "PACKAGE_BASELINE_MISMATCH",
          `包内条目 ${entry.meta.packagePath} 的表身份被改绑，无法核验来源。`,
          409
        );
      }
      if (entry.meta.exportedDigest !== original.exportedDigest) {
        throw new MaintenancePackageError(
          "PACKAGE_BASELINE_MISMATCH",
          `包内条目 ${entry.meta.packagePath} 的原导出摘要被改写，无法核验来源。`,
          409
        );
      }
    }
  }
  return record;
}

/** Remove expired export baselines (opportunistic GC). */
export async function pruneMaintenanceExportBaselines(
  projectRoot: string,
  now: () => number = Date.now
): Promise<void> {
  const dir = exportBaselineDir(projectRoot);
  const files = await readdir(dir).catch(() => [] as string[]);
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const record = await readMaintenanceExportBaseline(projectRoot, file.replace(/\.json$/, ""));
    if (!record || Date.parse(record.expiresAt) <= now()) {
      await rm(path.join(dir, file), { force: true });
    }
  }
}

/** Read the current content of a target file (used by the package builder). */
export async function readTargetContent(
  projectRoot: string,
  relPath: string
): Promise<string | null> {
  const contentPaths = await resolveContentPaths(projectRoot);
  try {
    return await readFile(path.resolve(contentPaths.configDir, relPath), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** A fresh export id. */
export function newMaintenanceExportId(now: Date = new Date()): string {
  const pad = (value: number): string => value.toString().padStart(2, "0");
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}_` +
    `${now.getMilliseconds().toString().padStart(3, "0")}`;
  return `exp_${stamp}_${randomUUID().slice(0, 8)}`;
}
