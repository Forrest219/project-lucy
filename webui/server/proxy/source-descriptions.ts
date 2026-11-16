/**
 * Catalog 业务语义暴露（P0-2 / REQ-030-023）
 *
 * 读取器合同见 Spec §6.1：manifest `descriptions.db` ＋ overlay `grain`；
 * overlay 须凭可信绑定依据盖 `boundPhysicalTable`（首选自带 `table`），
 * 禁止仅复读 manifest 表值盖戳。
 */

import { readFile, stat } from "node:fs/promises";
import { glob } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";

/** O3 闭合值：新增 description 字段 UTF-16 code unit 总预算。 */
export const MAX_TOTAL_DESCRIPTION_CHARS = 8192;

export type DescriptionState = "present" | "missing" | "truncated";

export interface CatalogSourceIdentity {
  connectionId: string;
  schema: string;
  sourceName: string;
  table: string;
}

export interface CatalogSourceEntry extends CatalogSourceIdentity {
  description: string | null;
  descriptionState: DescriptionState;
  /** 仅在 overlayBindingsMatch 通过且 grain 合法时写入；否则省略。 */
  grain?: string[];
}

export interface ManifestDescEntry {
  /** 规范化后的物理表（与 acl sourceMap / normalizeRef 一致）。 */
  physicalTable: string;
  /** 原始 descriptions.db（可能含首尾空白）；缺失则为 undefined。 */
  descriptionDb?: unknown;
  /** 索引构建时记录的内容根，供必要时复核。 */
  contentRoot: string;
}

export interface OverlayDescEntry {
  grain?: unknown;
  /**
   * 来自所读 overlay 内容的可信绑定依据（路径 A：顶层 `table`）。
   * 无法证明归属时为 null。
   */
  boundPhysicalTable: string | null;
  contentRoot: string;
}

export interface DescriptionBudget {
  remaining: number;
}

export interface DescriptionLimits {
  maxTotalDescriptionChars: number;
}

export interface DescriptionIndexes {
  manifestIndex: Map<string, ManifestDescEntry>;
  overlayIndex: Map<string, OverlayDescEntry>;
  contentRoot: string;
  /**
   * P0-3／D12：单文件读／解析失败不得吞成「真 missing」。
   * - `failedConnections`：该连接下 schema 索引不可靠（整连接描述健康态 fail-closed）
   * - `failedSourceKeys`：单 overlay 损坏时按 `descriptionIndexKey` 标记
   */
  failedConnections: Set<string>;
  failedSourceKeys: Set<string>;
}

/** 与 `acl.ts` `normalizeRef` 保持字节级一致。 */
export function normalizeCatalogRef(value: string): string {
  return value.trim().replace(/[`"']/g, "").toLowerCase();
}

export function descriptionIndexKey(
  connectionId: string,
  schema: string,
  sourceName: string
): string {
  return [
    normalizeCatalogRef(connectionId),
    normalizeCatalogRef(schema),
    normalizeCatalogRef(sourceName)
  ].join(".");
}

export function bindingsMatch(
  source: CatalogSourceIdentity,
  manifestEntry: ManifestDescEntry | null | undefined
): boolean {
  if (!manifestEntry) return false;
  const assetTable = manifestEntry.physicalTable;
  if (assetTable == null || typeof assetTable !== "string") return false;
  return normalizeCatalogRef(assetTable) === normalizeCatalogRef(source.table);
}

export function overlayBindingsMatch(
  source: CatalogSourceIdentity,
  manifestEntry: ManifestDescEntry | null | undefined,
  overlayEntry: OverlayDescEntry | null | undefined
): boolean {
  if (!overlayEntry) return false;
  if (!bindingsMatch(source, manifestEntry)) return false;
  const stamp = overlayEntry.boundPhysicalTable;
  if (stamp == null || typeof stamp !== "string") return false;
  const manifestTable = manifestEntry!.physicalTable;
  return (
    normalizeCatalogRef(stamp) === normalizeCatalogRef(source.table) &&
    normalizeCatalogRef(stamp) === normalizeCatalogRef(manifestTable)
  );
}

function isValidGrain(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every((item) => typeof item === "string");
}

/**
 * 从 overlay 顶层 `table` 推导可信绑定戳（路径 A）。
 * 缺字段／非字符串／空 → null（无法证明归属）。
 * **禁止**调用方再用后读 manifest.table 盖戳。
 */
export function boundPhysicalTableFromOverlay(overlayContent: {
  table?: unknown;
}): string | null {
  const intrinsic = overlayContent.table;
  if (intrinsic == null || typeof intrinsic !== "string") return null;
  const stamp = normalizeCatalogRef(intrinsic);
  return stamp || null;
}

/** 解析 `schema.table` 形式；裸表名返回 schema=null。 */
export function parseOverlayTableRef(raw: string): { schema: string | null; table: string } {
  const trimmed = raw.trim();
  const dot = trimmed.indexOf(".");
  if (dot <= 0 || dot === trimmed.length - 1) {
    return { schema: null, table: trimmed };
  }
  return {
    schema: trimmed.slice(0, dot),
    table: trimmed.slice(dot + 1)
  };
}

export function assembleSourceEntry(
  source: CatalogSourceIdentity,
  manifestEntry: ManifestDescEntry | null | undefined,
  overlayEntry: OverlayDescEntry | null | undefined,
  budget: DescriptionBudget
): CatalogSourceEntry {
  const entry: CatalogSourceEntry = {
    connectionId: source.connectionId,
    schema: source.schema,
    sourceName: source.sourceName,
    table: source.table,
    description: null,
    descriptionState: "missing"
  };

  if (!bindingsMatch(source, manifestEntry)) {
    return entry;
  }

  const raw = manifestEntry!.descriptionDb;
  if (raw == null || typeof raw !== "string" || raw.trim() === "") {
    entry.description = null;
    entry.descriptionState = "missing";
  } else {
    const text = raw;
    if (budget.remaining <= 0) {
      entry.description = null;
      entry.descriptionState = "truncated";
    } else if (text.length > budget.remaining) {
      entry.description = text.slice(0, budget.remaining);
      entry.descriptionState = "truncated";
      budget.remaining = 0;
    } else {
      entry.description = text;
      entry.descriptionState = "present";
      budget.remaining -= text.length;
    }
  }

  if (overlayBindingsMatch(source, manifestEntry, overlayEntry)) {
    const grain = overlayEntry!.grain;
    if (isValidGrain(grain)) {
      entry.grain = grain;
    }
  }

  return entry;
}

export function assembleCatalogSources(
  visibleSources: CatalogSourceIdentity[],
  manifestIndex: Map<string, ManifestDescEntry>,
  overlayIndex: Map<string, OverlayDescEntry>,
  limits: DescriptionLimits
): CatalogSourceEntry[] {
  const budget: DescriptionBudget = { remaining: limits.maxTotalDescriptionChars };
  const sorted = [...visibleSources].sort((a, b) => a.sourceName.localeCompare(b.sourceName));
  const entries: CatalogSourceEntry[] = [];
  for (const source of sorted) {
    const key = descriptionIndexKey(source.connectionId, source.schema, source.sourceName);
    entries.push(
      assembleSourceEntry(source, manifestIndex.get(key), overlayIndex.get(key), budget)
    );
  }
  return entries;
}

type SchemaYaml = {
  tables?: Record<
    string,
    {
      table?: unknown;
      descriptions?: { db?: unknown; ai?: unknown; human?: unknown };
    }
  >;
};

type OverlayYaml = {
  name?: unknown;
  table?: unknown;
  grain?: unknown;
};

function connectionDir(semanticLayerRoot: string, connectionId: string): string {
  return path.join(semanticLayerRoot, connectionId);
}

/**
 * 在 connectionScope 内扫盘建索引。
 * 索引可含同连接下暂不可见 source 的映射；装配侧只 lookup 最终可见键。
 */
/**
 * 描述索引缓存（P1-37 U1）。
 *
 * 根因（沙箱实测，320 Source）：每次 `initialize`／`lucy_catalog`／门闩都完整解析一遍
 * `_schema/*.yaml` 与 overlay，占握手 ~90%（≈75 ms／次），并发握手在单线程上线性排队。
 *
 * 命中条件＝范围内所有相关文件的（路径、mtimeMs、ctimeMs、size、ino）与上次构建时逐项一致；
 * 因此**任何**写入路径（含绕过写入事件的外部改文件）下一次调用即生效，没有陈旧窗口。
 * 命中时不读文件内容、不解析 YAML；只做目录列举与 stat。指纹计算失败＝不缓存、走原路径。
 * 返回值是浅拷贝，调用方改动不会污染缓存。
 */
const INDEX_CACHE_MAX_ENTRIES = 64;
type IndexCacheEntry = { fingerprint: string; value: DescriptionIndexes };
const indexCache = new Map<string, IndexCacheEntry>();
const indexCacheStats = { hits: 0, misses: 0, uncacheable: 0 };

/** 读取缓存命中／未命中计数（只读；供测试与取证）。 */
export function descriptionIndexCacheStats(): { hits: number; misses: number; uncacheable: number; entries: number } {
  return { ...indexCacheStats, entries: indexCache.size };
}

export function resetDescriptionIndexCacheForTests(): void {
  indexCache.clear();
  indexCacheStats.hits = 0;
  indexCacheStats.misses = 0;
  indexCacheStats.uncacheable = 0;
}

async function descriptionScopeFingerprint(semanticLayerRoot: string, scope: string[]): Promise<string | null> {
  const parts: string[] = [];
  try {
    for (const connectionId of scope) {
      const base = connectionDir(semanticLayerRoot, connectionId);
      const files: string[] = [];
      for await (const entry of glob("**/_schema/*.yaml", { cwd: base })) files.push(path.join(base, entry));
      for await (const entry of glob("*.yaml", { cwd: base })) {
        if (entry.includes("/") || entry.includes("\\")) continue;
        files.push(path.join(base, entry));
      }
      files.sort();
      parts.push(`@${connectionId}`);
      for (const file of files) {
        const info = await stat(file);
        parts.push(`${file}|${info.mtimeMs}|${info.ctimeMs}|${info.size}|${info.ino}`);
      }
    }
  } catch {
    return null;
  }
  return parts.join("\n");
}

const cloneIndexes = (value: DescriptionIndexes): DescriptionIndexes => ({
  manifestIndex: new Map(value.manifestIndex),
  overlayIndex: new Map(value.overlayIndex),
  contentRoot: value.contentRoot,
  failedConnections: new Set(value.failedConnections),
  failedSourceKeys: new Set(value.failedSourceKeys)
});

export async function loadDescriptionIndexes(
  semanticLayerRoot: string,
  connectionScope: string[]
): Promise<DescriptionIndexes> {
  const scope = [...new Set(connectionScope.map(normalizeCatalogRef).filter(Boolean))].sort();
  const fingerprint = await descriptionScopeFingerprint(semanticLayerRoot, scope);
  if (fingerprint === null) {
    indexCacheStats.uncacheable += 1;
    return loadDescriptionIndexesUncached(semanticLayerRoot, connectionScope);
  }
  const key = `${semanticLayerRoot}\u0000${scope.join(",")}`;
  const cached = indexCache.get(key);
  if (cached && cached.fingerprint === fingerprint) {
    indexCacheStats.hits += 1;
    indexCache.delete(key);
    indexCache.set(key, cached);
    return cloneIndexes(cached.value);
  }
  indexCacheStats.misses += 1;
  const value = await loadDescriptionIndexesUncached(semanticLayerRoot, connectionScope);
  // 构建期间文件又变了：不缓存这份结果（下次调用重建），避免把新旧混合的索引当成新指纹下的值。
  const after = await descriptionScopeFingerprint(semanticLayerRoot, scope);
  if (after === fingerprint) {
    indexCache.delete(key);
    indexCache.set(key, { fingerprint, value });
    while (indexCache.size > INDEX_CACHE_MAX_ENTRIES) {
      const oldest = indexCache.keys().next().value;
      if (oldest === undefined) break;
      indexCache.delete(oldest);
    }
    return cloneIndexes(value);
  }
  return value;
}

export async function loadDescriptionIndexesUncached(
  semanticLayerRoot: string,
  connectionScope: string[]
): Promise<DescriptionIndexes> {
  const manifestIndex = new Map<string, ManifestDescEntry>();
  const overlayIndex = new Map<string, OverlayDescEntry>();
  const failedConnections = new Set<string>();
  const failedSourceKeys = new Set<string>();
  const contentRoot = semanticLayerRoot;
  const scope = [...new Set(connectionScope.map(normalizeCatalogRef).filter(Boolean))];

  // 先装 manifest，便于 overlay 在裸 table／无 table 时按 sourceName 挂到已知 schema 键上。
  for (const connectionId of scope) {
    const base = connectionDir(semanticLayerRoot, connectionId);
    let schemaFiles: string[] = [];
    try {
      for await (const entry of glob("**/_schema/*.yaml", { cwd: base })) {
        schemaFiles.push(path.join(base, entry));
      }
    } catch {
      // 连接目录不可列 → 该连接描述索引不可靠（P0-3 fail-closed）
      failedConnections.add(normalizeCatalogRef(connectionId));
      continue;
    }

    for (const schemaFile of schemaFiles) {
      try {
        const content = await readFile(schemaFile, "utf-8");
        const yaml = parse(content) as SchemaYaml;
        if (!yaml?.tables || typeof yaml.tables !== "object") continue;
        const schemaFileName = path.basename(schemaFile, ".yaml");
        const schema = normalizeCatalogRef(schemaFileName);
        for (const [sourceName, tableDef] of Object.entries(yaml.tables)) {
          if (!tableDef || typeof tableDef !== "object") continue;
          if (typeof tableDef.table !== "string" || !tableDef.table.trim()) continue;
          const key = descriptionIndexKey(connectionId, schema, sourceName);
          manifestIndex.set(key, {
            physicalTable: normalizeCatalogRef(tableDef.table),
            descriptionDb: tableDef.descriptions?.db,
            contentRoot
          });
        }
      } catch {
        // 单文件损坏：整连接描述健康态 fail-closed（不得吞成真 missing）
        failedConnections.add(normalizeCatalogRef(connectionId));
      }
    }
  }

  for (const connectionId of scope) {
    const normalizedConnection = normalizeCatalogRef(connectionId);
    if (failedConnections.has(normalizedConnection)) continue;
    const base = connectionDir(semanticLayerRoot, connectionId);
    let overlayFiles: string[] = [];
    try {
      for await (const entry of glob("*.yaml", { cwd: base })) {
        // 只取连接根下的 overlay，不递归进 _schema
        if (entry.includes("/") || entry.includes("\\")) continue;
        overlayFiles.push(path.join(base, entry));
      }
    } catch {
      failedConnections.add(normalizedConnection);
      continue;
    }

    for (const overlayFile of overlayFiles) {
      try {
        const content = await readFile(overlayFile, "utf-8");
        const yaml = parse(content) as OverlayYaml;
        const sourceNameRaw =
          typeof yaml?.name === "string" && yaml.name.trim()
            ? yaml.name
            : path.basename(overlayFile, ".yaml");
        const sourceName = normalizeCatalogRef(sourceNameRaw);
        if (!sourceName) continue;

        const stamp = boundPhysicalTableFromOverlay(yaml);
        const overlayEntry: OverlayDescEntry = {
          grain: yaml.grain,
          boundPhysicalTable: stamp,
          contentRoot
        };

        const schemas = resolveOverlaySchemas(connectionId, sourceName, yaml, manifestIndex);
        for (const schema of schemas) {
          overlayIndex.set(descriptionIndexKey(connectionId, schema, sourceName), overlayEntry);
        }
      } catch {
        // overlay 单文件损坏：按 sourceName 挂到已知 schema 键；尚无 schema 时标连接级失败
        const sourceName = normalizeCatalogRef(path.basename(overlayFile, ".yaml"));
        const schemas = [...manifestIndex.keys()]
          .filter((k) => k.startsWith(`${normalizedConnection}.`) && k.endsWith(`.${sourceName}`))
          .map((k) => k.split(".")[1]!)
          .filter(Boolean);
        if (schemas.length === 0) {
          failedConnections.add(normalizedConnection);
        } else {
          for (const schema of schemas) {
            failedSourceKeys.add(descriptionIndexKey(connectionId, schema, sourceName));
          }
        }
      }
    }
  }

  return { manifestIndex, overlayIndex, contentRoot, failedConnections, failedSourceKeys };
}

/**
 * 决定 overlay 挂到哪些 schema 键下。
 * - overlay.table 为 `schema.table` → 只用该 schema（即使 manifest 尚未落盘，SC-17 中间态仍可索引）
 * - 否则 → 挂到同连接下 manifest 已登记的同名 source 的全部 schema
 */
function resolveOverlaySchemas(
  connectionId: string,
  sourceName: string,
  yaml: OverlayYaml,
  manifestIndex: Map<string, ManifestDescEntry>
): string[] {
  if (typeof yaml.table === "string" && yaml.table.trim()) {
    const parsed = parseOverlayTableRef(yaml.table);
    if (parsed.schema) {
      return [normalizeCatalogRef(parsed.schema)];
    }
  }

  const prefix = `${normalizeCatalogRef(connectionId)}.`;
  const suffix = `.${normalizeCatalogRef(sourceName)}`;
  const schemas: string[] = [];
  for (const key of manifestIndex.keys()) {
    if (!key.startsWith(prefix) || !key.endsWith(suffix)) continue;
    const mid = key.slice(prefix.length, key.length - suffix.length);
    if (mid && !mid.includes(".")) schemas.push(mid);
  }
  return schemas;
}

/**
 * 对 D0 最终 sources 装配描述／grain。
 * 内容根不存在或整根失败 → 空索引，全部按 missing 回退，目录本体仍返回。
 */
export async function enrichCatalogSources(
  finalSources: CatalogSourceIdentity[],
  options: {
    semanticLayerRoot: string;
    connectionScope: string[];
    limits?: DescriptionLimits;
  }
): Promise<CatalogSourceEntry[]> {
  const limits = options.limits ?? { maxTotalDescriptionChars: MAX_TOTAL_DESCRIPTION_CHARS };
  let indexes: DescriptionIndexes;
  try {
    indexes = await loadDescriptionIndexes(options.semanticLayerRoot, options.connectionScope);
  } catch {
    indexes = {
      manifestIndex: new Map(),
      overlayIndex: new Map(),
      contentRoot: options.semanticLayerRoot,
      failedConnections: new Set(),
      failedSourceKeys: new Set()
    };
  }
  return assembleCatalogSources(
    finalSources,
    indexes.manifestIndex,
    indexes.overlayIndex,
    limits
  );
}
