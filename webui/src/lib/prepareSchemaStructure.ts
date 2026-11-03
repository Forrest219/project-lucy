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
  mapped: { number: number; string: number; time: number };
  downgraded: Array<{ table: string; column: string; rawType: string }>;
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
  schema: string
): Promise<SchemaStructurePreview> {
  return apiPost<SchemaStructurePreview>(
    `/api/connections/${encodeURIComponent(connectionId)}/schema-structure`,
    { schema }
  );
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
