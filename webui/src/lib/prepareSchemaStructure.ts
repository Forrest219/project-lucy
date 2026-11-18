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
  tables?: string[],
  options: { batchRead?: boolean } = {}
): Promise<SchemaStructurePreview> {
  return apiPost<SchemaStructurePreview>(
    `/api/connections/${encodeURIComponent(connectionId)}/schema-structure`,
    tables?.length ? { schema, tables, ...(options.batchRead ? { batchRead: true } : {}) } : { schema }
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
  too_large: "字段数超过一次可读取的上限"
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
 * Read columns for the checked tables in batches of 50. Tables the server leaves unread
 * (`deferred`) are asked for again; failures are collected and reported together after
 * every other table has been read. Entries accumulate in one map, so the YAML is parsed
 * once per batch and written once.
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
  let batchSize = TABLES_PER_REQUEST;
  while (pending.length > 0) {
    const batch = pending.slice(0, batchSize);
    onProgress?.(done, tables.length, batch[0]);
    const part = await fetchSchemaStructure(connectionId, schema, batch, { batchRead: true });
    if (part.namesOnly) {
      throw new ApiError({ code: "READ_FAILED", message: `读取表「${batch[0]}」的字段失败。` });
    }
    const deferred = part.deferred ?? [];
    const rejections = part.rejections ?? [];
    const unread = new Set([...deferred, ...rejections.map((item) => item.table)]);
    if (unread.size >= batch.length && rejections.length === 0) {
      // A broad metadata query can spend its budget before a truncated result can
      // be split. Retry smaller batches, never the same no-progress request.
      if (batch.length > 1) {
        batchSize = Math.max(1, Math.floor(batch.length / 2));
        continue;
      }
      throw new ApiError({ code: "READ_FAILED", message: "读取表结构没有进展，请稍后重试。" });
    }
    const readTables = tablesMapping(part.yaml);
    for (const name of batch) {
      if (!unread.has(name) && Object.prototype.hasOwnProperty.call(readTables, name)) entries[name] = readTables[name];
    }
    failures.push(...rejections);
    downgraded.push(...part.downgraded);
    mapped.number += part.mapped.number;
    mapped.string += part.mapped.string;
    mapped.time += part.mapped.time;
    columnCount += part.columnCount;
    done += batch.length - deferred.length;
    pending = [...deferred, ...pending.slice(batch.length)];
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
