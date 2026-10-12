import { ApiError, apiPost } from "./apiClient";
import { uploadCatalogAsset, validateCatalogAsset } from "./catalog-assets";
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
  yaml: string
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
  if (checked.exists) return { status: "exists" };
  try {
    const uploaded = await uploadCatalogAsset(request);
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
