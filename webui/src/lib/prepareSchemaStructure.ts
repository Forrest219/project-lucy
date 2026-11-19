import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { ApiError, apiPost } from "./apiClient";
import { fetchCatalogSchemaManifest, uploadCatalogAsset, validateCatalogAsset } from "./catalog-assets";
import type {
  CatalogAssetValidateRequest,
  CatalogAssetValidateResponse,
  CatalogReloadRun,
  SourcesResponse
} from "./types";

export type SchemaStructurePreview = {
  schema: string;
  readable: boolean;
  yaml: string;
  tableCount: number;
  columnCount: number;
  namesOnly?: boolean;
  mapped: { number: number; string: number; time: number };
  downgraded: Array<{ table: string; column: string; rawType: string }>;
  /** Batch reads only; see `server/schema-structure.ts`. */
  rejections?: Array<{ table: string; reason: string; message: string }>;
  deferred?: string[];
};

export type WriteManifestResult =
  | { status: "invalid"; message: string; validation: CatalogAssetValidateResponse }
  | { status: "exists" }
  | { status: "written"; tables: number; reloadStatus: string | undefined };

export function countReadyTables(
  sources: SourcesResponse | undefined,
  connectionId: string,
  schema: string
): number {
  if (!schema) return 0;
  return (sources?.tables ?? []).filter(
    (table) => table.conn === connectionId && table.schema === schema
  ).length;
}

export function manifestKnown(
  sources: SourcesResponse | undefined,
  connectionId: string,
  schema: string
): boolean {
  if (!schema) return false;
  const listed = (sources?.manifestSchemas ?? []).some(
    (item) => item.conn === connectionId && item.schema === schema
  );
  return listed || countReadyTables(sources, connectionId, schema) > 0;
}

export async function fetchSchemaStructure(
  connectionId: string,
  schema: string,
  tables?: string[]
): Promise<SchemaStructurePreview> {
  return apiPost<SchemaStructurePreview>(
    `/api/connections/${encodeURIComponent(connectionId)}/schema-structure`,
    tables?.length ? { schema, tables } : { schema }
  );
}

/** Same as `MAX_TABLES_PER_CALL` in `server/schema-structure-batch.ts`. */
const TABLES_PER_REQUEST = 50;
const REJECTION_LISTED_LIMIT = 10;

const REJECTION_REASON_TEXT: Record<string, string> = {
  ambiguous: "对应多张表",
  permission: "没有读取权限",
  timeout: "读取超时",
  too_wide: "字段数超过一次可读取的上限",
  too_large: "字段数超过一次可读取的上限",
  // P1-34 §11 C6: single-table consecutive deferral
  deferred: "这次没有读完，请稍后重试。"
};

type TableRejection = { table: string; reason: string; message?: string };

function readFailureMessage(failures: TableRejection[]): string {
  const listed = failures
    .slice(0, REJECTION_LISTED_LIMIT)
    .map((item) => `表「${item.table}」${REJECTION_REASON_TEXT[item.reason] ?? "没有读到字段"}`)
    .join("；");
  const rest = failures.length - REJECTION_LISTED_LIMIT;
  return `有 ${failures.length} 张表没有读到字段：${listed}${rest > 0 ? `；另有 ${rest} 张未列出` : ""}。`;
}

/**
 * Read columns for the checked tables in batches of up to 50 (P1-34 §11 C2–C6).
 * - C2: all-deferred with no rejections → halve batch size (min 1), not "no progress" error.
 * - C5: each table in a batch must appear in yaml OR rejections OR deferred; missing → error naming it.
 * - C6: single table deferred twice consecutively → record as failure "这次没有读完", continue rest.
 */
export async function readCheckedTableColumns(
  connectionId: string,
  schema: string,
  tables: string[],
  onProgress?: (done: number, total: number, table: string) => void
): Promise<SchemaStructurePreview> {
  if (tables.length === 0) {
    throw new ApiError({ code: "BAD_REQUEST", message: "请至少选择一张表。" });
  }
  const entries: Record<string, unknown> = Object.create(null);
  const downgraded: SchemaStructurePreview["downgraded"] = [];
  const mapped = { number: 0, string: 0, time: 0 };
  const failures: TableRejection[] = [];
  let columnCount = 0;
  let done = 0;
  let pending = [...tables];
  // C2: adaptive batch size (halved on all-deferred, min 1).
  let batchSize = TABLES_PER_REQUEST;
  // C6: strikes map for single-table consecutive deferred.
  const strikes = new Map<string, number>();
  let requestCount = 0;
  while (pending.length > 0) {
    const batch = pending.slice(0, batchSize);
    onProgress?.(done, tables.length, batch[0]!);
    const part = await fetchSchemaStructure(connectionId, schema, batch);
    requestCount++;
    if (part.namesOnly) {
      throw new ApiError({ code: "READ_FAILED", message: `读取表「${batch[0]}」的字段失败。` });
    }
    const deferred = part.deferred ?? [];
    const rejections = part.rejections ?? [];
    const readTables = tablesMapping(part.yaml);
    // C5: verify each batch table is accounted for.
    for (const name of batch) {
      const inYaml = Object.prototype.hasOwnProperty.call(readTables, name);
      const inRejections = rejections.some((r) => r.table === name);
      const inDeferred = deferred.includes(name);
      if (!inYaml && !inRejections && !inDeferred) {
        throw new ApiError({
          code: "READ_FAILED",
          message: `服务端没有返回表「${name}」的读取结果，读取终止。`
        });
      }
    }
    // C6: handle consecutive deferral for single-table batches.
    const deferredSet = new Set(deferred);
    const dropped: string[] = [];
    for (const t of deferred) {
      if (batch.length === 1) {
        // Single-table: increment strike counter.
        const count = (strikes.get(t) ?? 0) + 1;
        strikes.set(t, count);
        if (count >= 2) {
          // C6: two consecutive deferred → record as failure, stop retrying this table.
          failures.push({ table: t, reason: "deferred", message: `表「${t}」这次没有读完，请稍后重试。` });
          dropped.push(t);
          deferredSet.delete(t);
        }
      } else {
        strikes.delete(t); // reset strike on non-singleton batch
      }
    }
    // C2: if all-deferred with no rejections, halve batch size.
    const allDeferred = deferredSet.size > 0 && rejections.length === 0 &&
      batch.every((t) => deferredSet.has(t) || dropped.includes(t));
    if (allDeferred && deferredSet.size > 0) {
      batchSize = Math.max(1, Math.ceil(batchSize / 2));
    } else if (rejections.length > 0 || deferredSet.size < batch.length) {
      // Some progress made: allow batch size to stabilize (don't grow back automatically)
    }
    // Guard against infinite retry (LS-19 upper bound).
    if (requestCount > 100) {
      throw new ApiError({ code: "READ_FAILED", message: "读取表结构请求次数超过上限，请稍后重试。" });
    }
    // Accumulate results for tables that were actually read.
    for (const name of batch) {
      if (!deferredSet.has(name) && !rejections.some((r) => r.table === name) && !dropped.includes(name)) {
        if (Object.prototype.hasOwnProperty.call(readTables, name)) entries[name] = readTables[name];
      }
    }
    failures.push(...rejections);
    downgraded.push(...part.downgraded);
    mapped.number += part.mapped.number;
    mapped.string += part.mapped.string;
    mapped.time += part.mapped.time;
    columnCount += part.columnCount;
    done += batch.length - deferredSet.size - dropped.length;
    // Next pending: deferred (minus dropped) first, then remaining unread tables.
    pending = [...deferredSet, ...pending.slice(batch.length)];
  }
  if (failures.length > 0) {
    throw new ApiError({ code: "READ_FAILED", message: readFailureMessage(failures) });
  }
  return {
    schema,
    readable: downgraded.length === 0,
    yaml: stringifyYaml({ tables: entries }),
    tableCount: tables.length,
    columnCount,
    namesOnly: false,
    mapped,
    downgraded
  };
}

export async function fetchExistingSchemaManifest(
  connectionId: string,
  schema: string
): Promise<string> {
  const asset = await fetchCatalogSchemaManifest(connectionId, schema);
  return asset.content;
}

function tablesMapping(yaml: string): Record<string, unknown> {
  const doc = parseYaml(yaml);
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return {};
  const tables = (doc as Record<string, unknown>).tables;
  if (!tables || typeof tables !== "object" || Array.isArray(tables)) return {};
  return tables as Record<string, unknown>;
}

export function manifestTableNames(yaml: string): string[] {
  return Object.keys(tablesMapping(yaml)).sort();
}

export function newTablesFromGenerated(existingYaml: string, generatedYaml: string): string[] {
  const existing = new Set(manifestTableNames(existingYaml));
  return manifestTableNames(generatedYaml).filter((name) => !existing.has(name));
}

/** Keep every existing table entry; append only selected tables from the database scan. */
export function mergeManifestTables(
  existingYaml: string,
  generatedYaml: string,
  addTables: string[]
): string {
  const existingDoc = parseYaml(existingYaml);
  const root =
    existingDoc && typeof existingDoc === "object" && !Array.isArray(existingDoc)
      ? { ...(existingDoc as Record<string, unknown>) }
      : {};
  const existingTables = tablesMapping(existingYaml);
  const generatedTables = tablesMapping(generatedYaml);
  const nextTables = { ...existingTables };
  for (const name of addTables) {
    if (!Object.prototype.hasOwnProperty.call(generatedTables, name)) continue;
    if (Object.prototype.hasOwnProperty.call(existingTables, name)) continue;
    nextTables[name] = generatedTables[name];
  }
  root.tables = nextTables;
  return stringifyYaml(root);
}

function manifestRequest(connectionId: string, schema: string, yaml: string): CatalogAssetValidateRequest {
  return {
    connectionId,
    schema,
    assetKind: "schema_manifest",
    filename: `${schema}.yaml`,
    content: yaml
  };
}

export async function writeMinimalManifest(
  connectionId: string,
  schema: string,
  yaml: string,
  options: { confirmOverwrite?: boolean } = {}
): Promise<WriteManifestResult> {
  const request = manifestRequest(connectionId, schema, yaml);
  const checked = await validateCatalogAsset(request);
  if (!checked.valid) {
    return {
      status: "invalid",
      message: checked.errors[0]?.message || "生成结果未通过校验。",
      validation: checked
    };
  }
  if (checked.exists && options.confirmOverwrite !== true) return { status: "exists" };
  try {
    const uploaded = await uploadCatalogAsset({
      ...request,
      ...(options.confirmOverwrite === true ? { confirmOverwrite: true } : {})
    });
    return {
      status: "written",
      tables: uploaded.validation.tables,
      reloadStatus: uploaded.reload?.status
    };
  } catch (err) {
    if (err instanceof ApiError && err.code === "TARGET_EXISTS") return { status: "exists" };
    throw err;
  }
}

export async function reloadPreparedCatalog(
  connectionId: string,
  schema: string
): Promise<CatalogReloadRun> {
  return apiPost<CatalogReloadRun>("/api/catalog/reload", { connectionId, schema });
}
