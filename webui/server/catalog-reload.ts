import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { safeWrite } from "./fs-safe";

// Mirrors webui/src/lib/types.ts CatalogReloadRun. Keeping a local copy avoids a
// server→src cycle just for the JSON shape. Fields must stay in lock-step.
export type CatalogReloadStatus = "success" | "failed";

export type CatalogReloadWarning = {
  code:
    | "SCHEMA_MANIFEST_MISSING"
    | "SCHEMA_MANIFEST_EMPTY"
    | "ENABLED_TABLE_NOT_SCANNED"
    | "MANIFEST_PARSE_FAILED";
  connectionId: string;
  schema?: string;
  table?: string;
  filePath?: string;
  message: string;
};

export type CatalogReloadRun = {
  id: string;
  status: CatalogReloadStatus;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  requestedConnectionId?: string;
  requestedSchema?: string;
  connections: number;
  // Concrete list of connections the run inspected. Required for accurate
  // `lastByConnection` mapping on global reloads, where the run covers every
  // connection but `requestedConnectionId` is undefined.
  connectionIds: string[];
  configuredSchemas: number;
  manifestSchemas: number;
  tables: number;
  enabledTables: number;
  warnings: CatalogReloadWarning[];
  source: "static-yaml";
  deprecatedIngestAlias?: boolean;
};

export type CatalogReloadsResponse = {
  runs: CatalogReloadRun[];
  last: CatalogReloadRun | null;
  lastByConnection: Record<string, CatalogReloadRun>;
};

export type ReloadCatalogInput = {
  connectionId?: string;
  schema?: string;
  deprecatedIngestAlias?: boolean;
};

export class CatalogReloadConnectionNotFoundError extends Error {
  code = "CONNECTION_NOT_FOUND";
  statusCode = 404;

  constructor(connectionId: string) {
    super(`Connection '${connectionId}' not found in ktx.yaml`);
    this.name = "CatalogReloadConnectionNotFoundError";
  }
}

const REL_PATH = ".ktx-ui/catalog-reloads.json";
const MAX_RUNS = 20;

function emptyFile(): { version: 1; runs: CatalogReloadRun[] } {
  return { version: 1, runs: [] };
}

function emptyResponse(): CatalogReloadsResponse {
  return { runs: [], last: null, lastByConnection: {} };
}

function normalize(value: unknown): { version: 1; runs: CatalogReloadRun[] } {
  if (!value || typeof value !== "object") return emptyFile();
  const record = value as { version?: unknown; runs?: unknown };
  const runs = Array.isArray(record.runs) ? (record.runs as CatalogReloadRun[]) : [];
  const cleaned: CatalogReloadRun[] = runs
    .filter((item): item is CatalogReloadRun => Boolean(item) && typeof item === "object")
    .map((item) => ({ ...item }));
  return { version: 1, runs: cleaned };
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

function buildLastByConnection(runs: CatalogReloadRun[]): Record<string, CatalogReloadRun> {
  const out: Record<string, CatalogReloadRun> = {};
  // Runs are stored oldest-first; iterate in reverse so the most recent run
  // for a connection wins. For connection-targeted runs we use
  // `requestedConnectionId`; for global runs we use the `connectionIds` list
  // captured when the run was recorded.
  for (let i = runs.length - 1; i >= 0; i -= 1) {
    const run = runs[i];
    if (!run) continue;
    const coveredConnIds = run.requestedConnectionId
      ? [run.requestedConnectionId]
      : run.connectionIds;
    for (const connId of coveredConnIds) {
      if (!out[connId]) {
        out[connId] = run;
      }
    }
  }
  return out;
}

function buildResponse(runs: CatalogReloadRun[]): CatalogReloadsResponse {
  return {
    runs,
    last: runs.length > 0 ? runs[runs.length - 1] ?? null : null,
    lastByConnection: buildLastByConnection(runs)
  };
}

export async function readCatalogReloads(projectRoot: string): Promise<CatalogReloadsResponse> {
  try {
    const text = await readFile(path.join(projectRoot, REL_PATH), "utf8");
    const file = normalize(JSON.parse(text) as unknown);
    return buildResponse(file.runs);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return emptyResponse();
    }
    throw error;
  }
}

export async function appendCatalogReload(
  projectRoot: string,
  run: CatalogReloadRun
): Promise<CatalogReloadsResponse> {
  const current = await readCatalogReloads(projectRoot);
  const next: CatalogReloadRun[] = [...current.runs, run].slice(-MAX_RUNS);
  const file = { version: 1 as const, runs: next };
  await safeWrite(projectRoot, REL_PATH, `${JSON.stringify(file, null, 2)}\n`);
  return buildResponse(next);
}

type ProjectConfig = {
  connections: Record<string, {
    schemas: string[];
    enabled_tables: string[];
  }>;
};

type ManifestEntry = {
  schema: string;
  filePath: string;
  tables: string[];
  parseFailed: boolean;
};

async function readProjectConfig(projectRoot: string): Promise<ProjectConfig> {
  const text = await readFile(path.join(projectRoot, "ktx.yaml"), "utf8");
  const doc = parseYaml(text) as unknown;
  if (!doc || typeof doc !== "object") {
    return { connections: {} };
  }
  const root = doc as { connections?: unknown };
  const conns = (root.connections && typeof root.connections === "object"
    ? root.connections
    : {}) as Record<string, unknown>;

  const out: ProjectConfig["connections"] = {};
  for (const [id, raw] of Object.entries(conns)) {
    const rec = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const schemas = Array.isArray(rec.schemas)
      ? rec.schemas.filter((value): value is string => typeof value === "string")
      : [];
    const enabled_tables = Array.isArray(rec.enabled_tables)
      ? rec.enabled_tables.filter((value): value is string => typeof value === "string")
      : [];
    out[id] = { schemas, enabled_tables };
  }
  return { connections: out };
}

async function listManifests(projectRoot: string, connId: string): Promise<ManifestEntry[]> {
  const dir = path.join(projectRoot, "semantic-layer", connId, "_schema");
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const manifests: ManifestEntry[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".yaml")) continue;
    const schema = entry.name.replace(/\.yaml$/, "");
    const absPath = path.join(dir, entry.name);
    const relPath = path.posix.join("semantic-layer", connId, "_schema", entry.name);
    const text = await readFile(absPath, "utf8").catch(() => "");
    if (!text) {
      manifests.push({ schema, filePath: relPath, tables: [], parseFailed: true });
      continue;
    }
    let parsed: unknown;
    try {
      parsed = parseYaml(text);
    } catch {
      manifests.push({ schema, filePath: relPath, tables: [], parseFailed: true });
      continue;
    }
    const doc = (parsed && typeof parsed === "object" ? parsed : {}) as { tables?: unknown };
    const tables = doc.tables && typeof doc.tables === "object" ? (doc.tables as Record<string, unknown>) : {};
    const physical: string[] = [];
    for (const [sourceName, value] of Object.entries(tables)) {
      if (!value || typeof value !== "object") continue;
      const tableDef = value as Record<string, unknown>;
      if (typeof tableDef.table === "string" && tableDef.table.trim()) {
        physical.push(tableDef.table.trim());
      } else {
        physical.push(`${schema}.${sourceName}`);
      }
    }
    manifests.push({ schema, filePath: relPath, tables: physical, parseFailed: false });
  }
  // Stable, predictable order so test assertions are deterministic.
  manifests.sort((a, b) => a.schema.localeCompare(b.schema));
  return manifests;
}

export async function reloadCatalog(
  projectRoot: string,
  input: ReloadCatalogInput = {}
): Promise<CatalogReloadRun> {
  const startedAt = new Date();
  const warnings: CatalogReloadWarning[] = [];

  const config = await readProjectConfig(projectRoot);
  const configConnIds = Object.keys(config.connections);
  if (input.connectionId && !config.connections[input.connectionId]) {
    throw new CatalogReloadConnectionNotFoundError(input.connectionId);
  }
  const targetConnIds = input.connectionId ? [input.connectionId] : configConnIds;
  const scopeSchemas = input.schema ? new Set([input.schema]) : null;

  // Per-connection stats: manifest entries and physical table set.
  const tableSetByConn: Record<string, Set<string>> = {};
  const manifestSchemaSetByConn: Record<string, Set<string>> = {};

  for (const connId of targetConnIds) {
    const manifests = await listManifests(projectRoot, connId);
    const scopedManifests = scopeSchemas
      ? manifests.filter((manifest) => scopeSchemas.has(manifest.schema))
      : manifests;
    const set = new Set<string>();
    const schemaSet = new Set<string>();
    for (const m of scopedManifests) {
      schemaSet.add(m.schema);
      for (const table of m.tables) set.add(table);
      if (m.parseFailed) {
        warnings.push({
          code: "MANIFEST_PARSE_FAILED",
          connectionId: connId,
          schema: m.schema,
          filePath: m.filePath,
          message: `无法解析 ${m.filePath}，已跳过该 schema 的表清单。`
        });
      } else if (m.tables.length === 0) {
        warnings.push({
          code: "SCHEMA_MANIFEST_EMPTY",
          connectionId: connId,
          schema: m.schema,
          filePath: m.filePath,
          message: `${m.schema} 的 manifest 存在但未声明任何表。`
        });
      }
    }
    tableSetByConn[connId] = set;
    manifestSchemaSetByConn[connId] = schemaSet;
  }

  // Counters: prefer the connection filter when present, otherwise aggregate.
  let configuredSchemas = 0;
  let manifestSchemas = 0;
  let tables = 0;
  let enabledTables = 0;
  for (const connId of targetConnIds) {
    const cfg = config.connections[connId];
    if (!cfg) continue;
    const enabledSet = new Set(cfg.enabled_tables);
    const derivedFromEnabled = enabledSet.size > 0 ? new Set<string>() : null;
    if (derivedFromEnabled) {
      for (const et of enabledSet) {
        const [schema] = et.split(".");
        if (schema) derivedFromEnabled!.add(schema);
      }
    }
    const explicitSchemas = new Set(cfg.schemas);
    const combined = derivedFromEnabled
      ? new Set<string>([...explicitSchemas, ...derivedFromEnabled])
      : explicitSchemas;
    const scopedConfiguredSchemas = scopeSchemas
      ? new Set([...combined].filter((schema) => scopeSchemas.has(schema)))
      : combined;
    const scopedEnabledTables = scopeSchemas
      ? [...enabledSet].filter((table) => {
          const [schema] = table.split(".");
          return Boolean(schema && scopeSchemas.has(schema));
        })
      : [...enabledSet];
    configuredSchemas += scopedConfiguredSchemas.size;
    manifestSchemas += manifestSchemaSetByConn[connId]?.size ?? 0;
    tables += tableSetByConn[connId]?.size ?? 0;
    enabledTables += scopedEnabledTables.length;

    const tableSet = tableSetByConn[connId] ?? new Set<string>();

    // SCHEMA_MANIFEST_MISSING: configured schema has no local manifest file.
    for (const schema of scopedConfiguredSchemas) {
      const hasManifest = (manifestSchemaSetByConn[connId] ?? new Set()).has(schema);
      if (!hasManifest) {
        warnings.push({
          code: "SCHEMA_MANIFEST_MISSING",
          connectionId: connId,
          schema,
          filePath: `semantic-layer/${connId}/_schema/${schema}.yaml`,
          message: `${schema} 已在连接配置中启用，但本地 semantic-layer/${connId}/_schema/${schema}.yaml 不存在。`
        });
      }
    }

    // ENABLED_TABLE_NOT_SCANNED: enabled_tables points to tables not in any
    // local manifest.
    for (const table of scopedEnabledTables) {
      if (!tableSet.has(table)) {
        warnings.push({
          code: "ENABLED_TABLE_NOT_SCANNED",
          connectionId: connId,
          table,
          message: `enabled_tables 中的 ${table} 未出现在本地 manifest 中。`
        });
      }
    }
  }

  const finishedAt = new Date();
  const status: CatalogReloadStatus = "success";
  const run: CatalogReloadRun = {
    id: `rel_${formatTimestamp(startedAt)}`,
    status,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    requestedConnectionId: input.connectionId,
    requestedSchema: input.schema,
    connections: targetConnIds.length,
    connectionIds: targetConnIds,
    configuredSchemas,
    manifestSchemas,
    tables,
    enabledTables,
    warnings,
    source: "static-yaml",
    ...(input.deprecatedIngestAlias ? { deprecatedIngestAlias: true } : {})
  };

  await appendCatalogReload(projectRoot, run);
  return run;
}

// Re-export so routes can import the YAML serializer without pulling yaml
// directly. Not part of the public surface.
export { stringifyYaml as _stringifyYaml };

// Sanity check helper used by tests: returns the project root's mtime for the
// ktx.yaml file, or null if missing. This is a pure FS probe and is never
// called from the production reload path.
export async function _probeKtxYamlMtime(projectRoot: string): Promise<Date | null> {
  try {
    const info = await stat(path.join(projectRoot, "ktx.yaml"));
    return info.mtime;
  } catch {
    return null;
  }
}
