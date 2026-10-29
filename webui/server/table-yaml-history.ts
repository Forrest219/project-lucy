import { createHash } from "node:crypto";
import { access, readFile, rename, rm, mkdir } from "node:fs/promises";
import path from "node:path";
import { previewDiff } from "./diff";
import { assertReadable, ForbiddenPathError, safeRemove, safeWrite } from "./fs-safe";
import { loadContentPaths } from "./paths";

/**
 * Table YAML history must NOT live under `semantic-layer/`.
 * KTX `admin reindex` treats every top-level directory there as a connection id
 * and rejects `.lucy-history` (`Unsafe connection id`).
 */
export const TABLE_YAML_HISTORY_ROOT = ".ktx-ui/table-yaml-history";
const TABLE_YAML_HISTORY_INDEX_PATH = `${TABLE_YAML_HISTORY_ROOT}/table-yaml-index.json`;
const TABLE_YAML_HISTORY_SNAPSHOT_ROOT = `${TABLE_YAML_HISTORY_ROOT}/snapshots`;
/** Legacy path that breaks KTX connection enumeration — migrate/remove on access. */
export const LEGACY_TABLE_YAML_HISTORY_ROOT = "semantic-layer/.lucy-history";
export const TABLE_YAML_VERSION_RETENTION_LIMIT = 5;

async function pathExists(absPath: string): Promise<boolean> {
  try {
    await access(absPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Move leftover `semantic-layer/.lucy-history` to `.ktx-ui/table-yaml-history`
 * (or delete it when the new root already exists). Call before any KTX
 * walk of `semantic-layer/` (validate / reindex).
 */
export async function relocateTableYamlHistoryOutOfSemanticLayer(
  projectRoot: string
): Promise<{ relocated: boolean; removedLegacy: boolean }> {
  const legacyAbs = path.join(projectRoot, ...LEGACY_TABLE_YAML_HISTORY_ROOT.split("/"));
  const nextAbs = path.join(projectRoot, ...TABLE_YAML_HISTORY_ROOT.split("/"));
  if (!(await pathExists(legacyAbs))) {
    return { relocated: false, removedLegacy: false };
  }

  if (!(await pathExists(nextAbs))) {
    await mkdir(path.dirname(nextAbs), { recursive: true });
    await rename(legacyAbs, nextAbs);
    return { relocated: true, removedLegacy: true };
  }

  // New root already present: drop the unsafe legacy tree.
  await rm(legacyAbs, { recursive: true, force: true });
  return { relocated: false, removedLegacy: true };
}

export type TableYamlVersionOperation = "save" | "import" | "restore";

const TABLE_YAML_VERSION_OPERATIONS = new Set<TableYamlVersionOperation>([
  "save",
  "import",
  "restore"
]);

export type TableYamlVersionSummary = {
  versionId: string;
  key: string;
  createdAt: string;
  operation: TableYamlVersionOperation;
  contentHash: string;
  sourceFileName?: string;
  restoredFromVersionId?: string;
  affectedFiles: string[];
};

export type TableYamlVersionDetail = TableYamlVersionSummary & {
  rawYaml: string;
  diffFromCurrent: string;
};

export type TableYamlVersionListResponse = {
  key: string;
  retentionLimit: number;
  versions: TableYamlVersionSummary[];
};

export type TableYamlVersionRestorePreview = {
  key: string;
  versionId: string;
  diff: string;
};

export type TableYamlVersionRestoreResult = {
  key: string;
  restoredFromVersionId: string;
  rawYaml: string;
  diff: string;
};

type TableYamlVersionMetadataEntry = TableYamlVersionSummary & {
  snapshotPath: string;
};

type TableYamlHistoryTable = {
  key: string;
  createdAt: string;
  updatedAt: string;
  currentVersionId?: string;
  versions: TableYamlVersionMetadataEntry[];
};

type TableYamlHistoryIndex = {
  schemaVersion: 1;
  tables: Record<string, TableYamlHistoryTable>;
};

class TableYamlVersionError extends Error {
  code: string;
  statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = "TableYamlVersionError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function assertSafeSegment(value: string, label: string): void {
  if (!value || value.includes("/") || value.includes("\\") || value === "." || value === ".." || value.includes("..")) {
    throw new ForbiddenPathError(`${label} contains an unsafe path segment`);
  }
}

function tableKey(conn: string, schema: string, table: string): string {
  assertSafeSegment(conn, "connection");
  assertSafeSegment(schema, "schema");
  assertSafeSegment(table, "table");
  return `${conn}/${schema}/${table}`;
}

function safeVersionId(value: string): string {
  if (!/^[0-9TZ]+-[a-f0-9]{8,16}$/.test(value)) {
    throw new TableYamlVersionError("TABLE_YAML_VERSION_INVALID", "版本记录格式不合法。");
  }
  return value;
}

function safeOperation(value: string): TableYamlVersionOperation {
  if (!TABLE_YAML_VERSION_OPERATIONS.has(value as TableYamlVersionOperation)) {
    throw new TableYamlVersionError("TABLE_YAML_VERSION_INVALID", "版本记录格式不合法。");
  }
  return value as TableYamlVersionOperation;
}

function tableHash(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

function contentHash(yaml: string): string {
  return `sha256:${createHash("sha256").update(yaml).digest("hex")}`;
}

function versionTimestamp(value: Date = new Date()): string {
  return value.toISOString().replace(/[-:.]/g, "");
}

function createVersionId(yaml: string, operation: TableYamlVersionOperation, at: string): string {
  const shortHash = createHash("sha256")
    .update(`${yaml}\n${operation}\n${at}\n${Math.random()}`)
    .digest("hex")
    .slice(0, 8);
  return `${versionTimestamp(new Date(at))}-${shortHash}`;
}

function snapshotPath(key: string, versionId: string): string {
  return path.posix.join(
    TABLE_YAML_HISTORY_SNAPSHOT_ROOT,
    tableHash(key),
    `${safeVersionId(versionId)}.yaml`
  );
}

async function readIndex(projectRoot: string): Promise<TableYamlHistoryIndex> {
  await relocateTableYamlHistoryOutOfSemanticLayer(projectRoot);
  try {
    const paths = await loadContentPaths();
    const raw = await readFile(await assertReadable(paths, projectRoot, TABLE_YAML_HISTORY_INDEX_PATH), "utf8");
    const parsed = JSON.parse(raw) as Partial<TableYamlHistoryIndex>;
    if (parsed.schemaVersion !== 1 || !parsed.tables || typeof parsed.tables !== "object") {
      throw new TableYamlVersionError("TABLE_YAML_VERSION_INVALID", "版本记录格式不合法。");
    }
    const tables: Record<string, TableYamlHistoryTable> = {};
    for (const [rawKey, rawTable] of Object.entries(parsed.tables)) {
      const parts = rawKey.split("/");
      if (parts.length !== 3 || !rawTable || typeof rawTable !== "object" || !Array.isArray(rawTable.versions)) {
        continue;
      }
      const key = tableKey(parts[0], parts[1], parts[2]);
      const source = rawTable as Partial<TableYamlHistoryTable>;
      const versions = rawTable.versions.flatMap((rawVersion) => {
        if (!rawVersion || typeof rawVersion !== "object") return [];
        const versionSource = rawVersion as Partial<TableYamlVersionMetadataEntry>;
        if (
          typeof versionSource.versionId !== "string" ||
          typeof versionSource.createdAt !== "string" ||
          typeof versionSource.operation !== "string" ||
          typeof versionSource.contentHash !== "string" ||
          !Array.isArray(versionSource.affectedFiles)
        ) {
          return [];
        }
        const versionId = safeVersionId(versionSource.versionId);
        return [{
          versionId,
          key,
          createdAt: versionSource.createdAt,
          operation: safeOperation(versionSource.operation),
          contentHash: versionSource.contentHash,
          sourceFileName: typeof versionSource.sourceFileName === "string" ? versionSource.sourceFileName : undefined,
          restoredFromVersionId: typeof versionSource.restoredFromVersionId === "string"
            ? safeVersionId(versionSource.restoredFromVersionId)
            : undefined,
          affectedFiles: versionSource.affectedFiles.filter((item): item is string => typeof item === "string"),
          snapshotPath: snapshotPath(key, versionId)
        }];
      });
      tables[key] = {
        key,
        createdAt: typeof source.createdAt === "string" ? source.createdAt : new Date(0).toISOString(),
        updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : new Date(0).toISOString(),
        currentVersionId: typeof source.currentVersionId === "string"
          ? safeVersionId(source.currentVersionId)
          : versions.at(-1)?.versionId,
        versions
      };
    }
    return { schemaVersion: 1, tables };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { schemaVersion: 1, tables: {} };
    }
    if (error instanceof TableYamlVersionError) {
      throw error;
    }
    if (error instanceof SyntaxError) {
      throw new TableYamlVersionError("TABLE_YAML_VERSION_INVALID", "版本记录格式不合法。");
    }
    throw error;
  }
}

async function writeIndex(projectRoot: string, index: TableYamlHistoryIndex): Promise<void> {
  const paths = await loadContentPaths();
  const normalized: TableYamlHistoryIndex = { schemaVersion: 1, tables: {} };
  for (const [rawKey, tableSource] of Object.entries(index.tables)) {
    const parts = rawKey.split("/");
    if (parts.length !== 3) continue;
    const key = tableKey(parts[0], parts[1], parts[2]);
    normalized.tables[key] = {
      ...tableSource,
      key,
      versions: [...tableSource.versions]
    };
  }
  await safeWrite(paths, projectRoot, TABLE_YAML_HISTORY_INDEX_PATH, `${JSON.stringify(normalized, null, 2)}\n`);
}

function publicSummary(version: TableYamlVersionMetadataEntry): TableYamlVersionSummary {
  return {
    versionId: version.versionId,
    key: version.key,
    createdAt: version.createdAt,
    operation: version.operation,
    contentHash: version.contentHash,
    sourceFileName: version.sourceFileName,
    restoredFromVersionId: version.restoredFromVersionId,
    affectedFiles: version.affectedFiles
  };
}

async function pruneVersions(
  projectRoot: string,
  index: TableYamlHistoryIndex,
  key: string
): Promise<void> {
  const table = index.tables[key];
  if (!table || table.versions.length <= TABLE_YAML_VERSION_RETENTION_LIMIT) {
    return;
  }
  const toRemove = table.versions.slice(0, table.versions.length - TABLE_YAML_VERSION_RETENTION_LIMIT);
  const paths = await loadContentPaths();
  for (const version of toRemove) {
    await safeRemove(paths, projectRoot, version.snapshotPath);
  }
  table.versions = table.versions.slice(-TABLE_YAML_VERSION_RETENTION_LIMIT);
}

/**
 * L25-16 F5-05 / G27 — **可延后裁剪**的版本快照入口。
 *
 * 既有 `createTableYamlVersionSnapshot` 在写完新快照后**立即**裁剪超限旧版本，
 * 且裁剪先于索引写盘。若组内后续成员失败而组级回滚只恢复索引条目，被裁剪的
 * 快照内容**已不可恢复**。因此组事务必须把裁剪延后到组终结之后。
 *
 * 返回的 `deferredPrune` 是「本次若立即裁剪会被删掉的版本 id」——组终结后调用
 * {@link pruneTableYamlVersions} 执行，组失败时这些快照原封不动。
 */
export async function createTableYamlVersionSnapshotDeferred(
  projectRoot: string,
  conn: string,
  schema: string,
  table: string,
  rawYaml: string,
  metadata: {
    operation: TableYamlVersionOperation;
    affectedFiles?: string[];
    sourceFileName?: string;
    restoredFromVersionId?: string;
  }
): Promise<{ version: TableYamlVersionSummary | null; deferredPrune: string[] }> {
  const key = tableKey(conn, schema, table);
  const index = await readIndex(projectRoot);
  const existing = index.tables[key];
  const hash = contentHash(rawYaml);
  const latest = existing?.versions.at(-1);
  if (latest?.contentHash === hash) {
    return { version: null, deferredPrune: [] };
  }
  const createdAt = new Date().toISOString();
  const versionId = createVersionId(rawYaml, metadata.operation, createdAt);
  const version: TableYamlVersionMetadataEntry = {
    versionId,
    key,
    createdAt,
    operation: metadata.operation,
    contentHash: hash,
    sourceFileName: metadata.sourceFileName,
    restoredFromVersionId: metadata.restoredFromVersionId ? safeVersionId(metadata.restoredFromVersionId) : undefined,
    affectedFiles: metadata.affectedFiles ?? [],
    snapshotPath: snapshotPath(key, versionId)
  };
  await safeWrite((await loadContentPaths()), projectRoot, version.snapshotPath, rawYaml);
  const versions = [...(existing?.versions ?? []), version];
  index.tables[key] = {
    key,
    createdAt: existing?.createdAt ?? createdAt,
    updatedAt: createdAt,
    currentVersionId: versionId,
    versions
  };
  // 裁剪**延后**：这里只记录「将来该裁掉谁」，不删任何文件。
  const overflow = versions.slice(0, Math.max(0, versions.length - TABLE_YAML_VERSION_RETENTION_LIMIT));
  await writeIndex(projectRoot, index);
  return {
    version: publicSummary(version),
    deferredPrune: overflow.map((entry) => entry.versionId)
  };
}

/**
 * 组终结后执行被延后的裁剪（只裁剪该表的超限版本）。
 */
export async function pruneTableYamlVersions(
  projectRoot: string,
  conn: string,
  schema: string,
  table: string
): Promise<string[]> {
  const key = tableKey(conn, schema, table);
  const index = await readIndex(projectRoot);
  const entry = index.tables[key];
  if (!entry) return [];
  const toRemove = entry.versions.slice(0, Math.max(0, entry.versions.length - TABLE_YAML_VERSION_RETENTION_LIMIT));
  if (toRemove.length === 0) return [];
  const paths = await loadContentPaths();
  for (const version of toRemove) {
    await safeRemove(paths, projectRoot, version.snapshotPath);
  }
  entry.versions = entry.versions.slice(-TABLE_YAML_VERSION_RETENTION_LIMIT);
  await writeIndex(projectRoot, index);
  return toRemove.map((version) => version.versionId);
}

/**
 * 组级回滚：**只回滚本组条目**（N04 / G16）。
 *
 * 全局历史索引是共享元数据——撤销必须按条目隔离，不得整份回滚（否则会抹掉
 * 其他组的成功记录）。
 */
export async function removeTableYamlVersionEntries(
  projectRoot: string,
  entries: Array<{ conn: string; schema: string; table: string; versionId: string }>
): Promise<void> {
  if (entries.length === 0) return;
  const index = await readIndex(projectRoot);
  const paths = await loadContentPaths();
  const byKey = new Map<string, typeof entries>();
  for (const entry of entries) {
    const key = tableKey(entry.conn, entry.schema, entry.table);
    const list = byKey.get(key) ?? [];
    list.push(entry);
    byKey.set(key, list);
  }
  for (const [key, list] of byKey) {
    const table = index.tables[key];
    if (!table) continue;
    const removing = new Set(list.map((entry) => entry.versionId));
    for (const version of table.versions) {
      if (!removing.has(version.versionId)) continue;
      await safeRemove(paths, projectRoot, version.snapshotPath);
    }
    table.versions = table.versions.filter((version) => !removing.has(version.versionId));
    if (table.versions.length === 0) {
      delete index.tables[key];
      continue;
    }
    if (table.currentVersionId && removing.has(table.currentVersionId)) {
      table.currentVersionId = table.versions.at(-1)?.versionId;
    }
  }
  await writeIndex(projectRoot, index);
}

export async function createTableYamlVersionSnapshot(
  projectRoot: string,
  conn: string,
  schema: string,
  table: string,
  rawYaml: string,
  metadata: {
    operation: TableYamlVersionOperation;
    affectedFiles?: string[];
    sourceFileName?: string;
    restoredFromVersionId?: string;
  }
): Promise<TableYamlVersionSummary | null> {
  const key = tableKey(conn, schema, table);
  const index = await readIndex(projectRoot);
  const existing = index.tables[key];
  const hash = contentHash(rawYaml);
  const latest = existing?.versions.at(-1);
  if (latest?.contentHash === hash) {
    return null;
  }
  const createdAt = new Date().toISOString();
  const versionId = createVersionId(rawYaml, metadata.operation, createdAt);
  const version: TableYamlVersionMetadataEntry = {
    versionId,
    key,
    createdAt,
    operation: metadata.operation,
    contentHash: hash,
    sourceFileName: metadata.sourceFileName,
    restoredFromVersionId: metadata.restoredFromVersionId ? safeVersionId(metadata.restoredFromVersionId) : undefined,
    affectedFiles: metadata.affectedFiles ?? [],
    snapshotPath: snapshotPath(key, versionId)
  };
  await safeWrite((await loadContentPaths()), projectRoot, version.snapshotPath, rawYaml);
  index.tables[key] = {
    key,
    createdAt: existing?.createdAt ?? createdAt,
    updatedAt: createdAt,
    currentVersionId: versionId,
    versions: [...(existing?.versions ?? []), version]
  };
  await pruneVersions(projectRoot, index, key);
  await writeIndex(projectRoot, index);
  return publicSummary(version);
}

export async function listTableYamlVersions(
  projectRoot: string,
  conn: string,
  schema: string,
  table: string
): Promise<TableYamlVersionListResponse> {
  const key = tableKey(conn, schema, table);
  const index = await readIndex(projectRoot);
  const versions = [...(index.tables[key]?.versions ?? [])]
    .reverse()
    .map(publicSummary);
  return {
    key,
    retentionLimit: TABLE_YAML_VERSION_RETENTION_LIMIT,
    versions
  };
}

async function readVersionEntry(
  projectRoot: string,
  conn: string,
  schema: string,
  table: string,
  versionId: string
): Promise<TableYamlVersionMetadataEntry> {
  const key = tableKey(conn, schema, table);
  const safeId = safeVersionId(versionId);
  const index = await readIndex(projectRoot);
  const version = index.tables[key]?.versions.find((item) => item.versionId === safeId);
  if (!version) {
    throw new TableYamlVersionError("TABLE_YAML_VERSION_NOT_FOUND", "版本记录不存在。", 404);
  }
  return version;
}

export async function readTableYamlVersion(
  projectRoot: string,
  conn: string,
  schema: string,
  table: string,
  versionId: string,
  currentYaml: string
): Promise<TableYamlVersionDetail> {
  const version = await readVersionEntry(projectRoot, conn, schema, table, versionId);
  const paths = await loadContentPaths();
  const rawYaml = await readFile(await assertReadable(paths, projectRoot, version.snapshotPath), "utf8");
  return {
    ...publicSummary(version),
    rawYaml,
    diffFromCurrent: previewDiff(currentYaml, rawYaml, version.snapshotPath)
  };
}

export async function previewTableYamlVersionRestore(
  projectRoot: string,
  conn: string,
  schema: string,
  table: string,
  versionId: string,
  currentYaml: string
): Promise<TableYamlVersionRestorePreview> {
  const detail = await readTableYamlVersion(projectRoot, conn, schema, table, versionId, currentYaml);
  return {
    key: detail.key,
    versionId: detail.versionId,
    diff: detail.diffFromCurrent
  };
}

export async function restoreTableYamlVersionDraft(
  projectRoot: string,
  conn: string,
  schema: string,
  table: string,
  versionId: string,
  currentYaml: string
): Promise<TableYamlVersionRestoreResult> {
  const detail = await readTableYamlVersion(projectRoot, conn, schema, table, versionId, currentYaml);
  return {
    key: detail.key,
    restoredFromVersionId: detail.versionId,
    rawYaml: detail.rawYaml,
    diff: detail.diffFromCurrent
  };
}
