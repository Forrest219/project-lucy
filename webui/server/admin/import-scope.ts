/**
 * Spec 183 — import-scope preview. Read-only breakdown of discovered physical
 * tables, the Schema Manifest, the connection's `enabled_tables` and every
 * identity's effective source on the target connection. Built from existing
 * ACL compile and the same content-root reads the rest of the Admin UI uses.
 *
 * The preview is consumed by `GET /api/connections/:connectionId/import-scope`
 * and is also exposed as `buildImportScopePreview` for tests / future tooling.
 * The endpoint never connects to a real database; `discovered` is caller input
 * only and is omitted (with `discoveryExecuted=false`) when not provided.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { readConnections, resolveProjectRoot } from "../project.js";
import { loadContentPaths } from "../paths.js";
import {
  buildAdminPermissionContext,
  displayPolicyInputsOf,
  type DisplayPolicyInputs,
  type SourceMapEntry,
  resolveEffectivePermissionsBatchForAdmin
} from "../proxy/acl.js";
import { getAccessConfig } from "../proxy/identity.js";

export type Sensitivity = string; // free-form string from manifest/overlay

export interface ImportScopeManifestTable {
  /** `schema.table` form (e.g. `fin.fin_ledger`). */
  physicalTable: string;
  /** Schema directory name (e.g. `fin`). */
  schema: string;
  /** Logical source name inside the schema (e.g. `fin_ledger`). */
  sourceName: string;
  /** Manifest or overlay `sensitivity` field; "unconfirmed" when not declared. */
  sensitivity: Sensitivity;
}

export interface ImportScopeRoleRow {
  identityId: string;
  /** `schema.table` entries this identity can read on the target connection. */
  sources: string[];
  /** Machine compile reason when compile failed; absent on success. */
  compileError?: string;
}

export interface ImportScopePreview {
  connectionId: string;
  /** Caller-supplied discovery list. Empty when discovery was not executed. */
  discovered: string[];
  /** True when the caller supplied a discovery list (even an empty one). */
  discoveryExecuted: boolean;
  manifest: ImportScopeManifestTable[];
  /** `schema.table` entries from this connection's `enabled_tables`. */
  enabled: string[];
  roles: ImportScopeRoleRow[];
  /** `manifest - enabled`, both in `schema.table` form. */
  manifestNotEnabled: string[];
  /** `enabled - manifest`, both in `schema.table` form. */
  enabledMissingManifest: string[];
  /** `manifest ∩ enabled`; only what Manifest and the enabled range both list. */
  publishSources: string[];
  policyInputs: DisplayPolicyInputs;
}

export interface BuildImportScopePreviewInput {
  projectRoot: string;
  connectionId: string;
  /** Caller-supplied discovery tables. When omitted, `discovered=[]` + `discoveryExecuted=false`. */
  discovered?: string[];
}

/** Normalize an arbitrary caller string into a comparable `schema.table` token. */
function normalizeRef(value: string): string {
  return value.trim().replace(/[`"']/g, "").toLowerCase();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set([...values].map((value) => value.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

/** Empty `sensitivity` literal — the spec requires `unconfirmed`, never guessed from names. */
export const SENSITIVITY_UNCONFIRMED = "unconfirmed";

/** Read manifest tables from `<contentRoot>/semantic-layer/<conn>/_schema/*.yaml`. */
async function readManifestTables(
  projectRoot: string,
  connectionId: string
): Promise<ImportScopeManifestTable[]> {
  const paths = await loadContentPaths();
  const schemaDir = path.join(paths.semanticLayer, connectionId, "_schema");
  const overlayDir = path.join(paths.semanticLayer, connectionId);
  const entries = await readdir(schemaDir, { withFileTypes: true }).catch(() => []);
  const tables: ImportScopeManifestTable[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".yaml")) continue;
    const schemaName = entry.name.replace(/\.yaml$/, "");
    const text = await readFile(path.join(schemaDir, entry.name), "utf8").catch(() => "");
    let parsed: unknown;
    try {
      parsed = parseYaml(text);
    } catch {
      continue;
    }
    const root = asRecord(parsed);
    const tablesBlock = asRecord(root.tables);
    for (const [sourceName, tableDef] of Object.entries(tablesBlock)) {
      const record = asRecord(tableDef);
      const physicalRaw = typeof record.table === "string" ? record.table.trim() : "";
      const physicalTable = physicalRaw || `${schemaName}.${sourceName}`;
      const [resolvedSchema, ...rest] = physicalTable.split(".");
      const resolvedSchemaName = (resolvedSchema ?? schemaName).trim() || schemaName;
      const resolvedSourceName = rest.length > 0 ? rest.join(".").trim() : sourceName;
      // Overlay sits beside _schema at `semantic-layer/<conn>/<table>.yaml`. Read
      // it directly to honour the spec's "Manifest or overlay" wording.
      const overlayText = await readFile(
        path.join(overlayDir, `${sourceName}.yaml`),
        "utf8"
      ).catch(() => "");
      let overlay: Record<string, unknown> = {};
      if (overlayText) {
        try {
          overlay = asRecord(parseYaml(overlayText));
        } catch {
          overlay = {};
        }
      }
      const sensitivityRaw = (() => {
        const fromOverlay = typeof overlay.sensitivity === "string" ? overlay.sensitivity.trim() : "";
        if (fromOverlay) return fromOverlay;
        const fromManifest = typeof record.sensitivity === "string" ? record.sensitivity.trim() : "";
        return fromManifest;
      })();
      tables.push({
        physicalTable,
        schema: resolvedSchemaName,
        sourceName: resolvedSourceName,
        sensitivity: sensitivityRaw || SENSITIVITY_UNCONFIRMED
      });
    }
  }
  return tables.sort((a, b) => a.physicalTable.localeCompare(b.physicalTable));
}

/**
 * Source-map → physicalTable lookup scoped to one connection. Used to translate
 * `effectivePermissions.sources[*].table` (which is the canonical physicalTable)
 * back to a normalized `schema.table` token so caller lists stay comparable.
 */
function effectiveTablesForConnection(
  sources: ReadonlyArray<{ connectionId: string; table: string }>,
  connectionId: string
): string[] {
  const wanted = normalizeRef(connectionId);
  return uniqueSorted(
    sources
      .filter((source) => normalizeRef(source.connectionId) === wanted)
      .map((source) => source.table)
  );
}

async function readEnabledTables(projectRoot: string, connectionId: string): Promise<string[]> {
  const connections = await readConnections(projectRoot);
  const match = connections.find((conn) => conn.id === connectionId);
  if (!match) {
    const err = new Error(`connection_not_found:${connectionId}`) as Error & {
      statusCode: number;
      code: string;
    };
    err.statusCode = 404;
    err.code = "CONNECTION_NOT_FOUND";
    throw err;
  }
  return uniqueSorted(match.enabledTables ?? []);
}

/**
 * Spec 183 — single source of truth for the four list previews plus the two
 * differences and the publish intersection. Does not connect to the database.
 */
export async function buildImportScopePreview(
  input: BuildImportScopePreviewInput
): Promise<ImportScopePreview> {
  const { projectRoot, connectionId } = input;
  const wanted = normalizeRef(connectionId);

  const [manifest, enabled, config] = await Promise.all([
    readManifestTables(projectRoot, connectionId),
    readEnabledTables(projectRoot, connectionId),
    getAccessConfig({ fresh: true })
  ]);

  const context = await buildAdminPermissionContext(config);
  const policyInputs = displayPolicyInputsOf(context);

  // Only compile enabled, non-legacy Agents. Legacy `allow.tools` rows are
  // still compiled by the ACL layer, but the spec asks for "身份" (identity).
  const identityIds = config.users
    .filter((user) => user?.id && user.enabled !== false)
    .map((user) => user.id);
  const batch = await resolveEffectivePermissionsBatchForAdmin(identityIds, context);

  const manifestPhysical = uniqueSorted(manifest.map((entry) => entry.physicalTable));
  const enabledSet = new Set(enabled.map(normalizeRef));
  const manifestSet = new Set(manifestPhysical.map(normalizeRef));

  const manifestNotEnabled: string[] = [];
  const enabledMissingManifest: string[] = [];
  for (const table of manifestPhysical) {
    if (!enabledSet.has(normalizeRef(table))) manifestNotEnabled.push(table);
  }
  for (const table of enabled) {
    if (!manifestSet.has(normalizeRef(table))) enabledMissingManifest.push(table);
  }
  const publishSources = manifestPhysical.filter((table) => enabledSet.has(normalizeRef(table)));

  const roles: ImportScopeRoleRow[] = [];
  for (const identityId of identityIds) {
    const result = batch.get(identityId);
    if (!result) {
      roles.push({ identityId, sources: [], compileError: "identity_unresolved" });
      continue;
    }
    if (!result.ok) {
      roles.push({ identityId, sources: [], compileError: result.reason });
      continue;
    }
    const sources = effectiveTablesForConnection(result.permissions.sources, wanted);
    roles.push({ identityId, sources });
  }
  roles.sort((a, b) => a.identityId.localeCompare(b.identityId));

  const discoveredList = input.discovered;
  const discovered = discoveredList === undefined ? [] : uniqueSorted(discoveredList);

  return {
    connectionId,
    discovered,
    discoveryExecuted: discoveredList !== undefined,
    manifest,
    enabled,
    roles,
    manifestNotEnabled: manifestNotEnabled.sort((a, b) => a.localeCompare(b)),
    enabledMissingManifest: enabledMissingManifest.sort((a, b) => a.localeCompare(b)),
    publishSources: publishSources.sort((a, b) => a.localeCompare(b)),
    policyInputs
  };
}

/** Re-exported so tests and the audit consumer don't reach into the ACL module. */
export type { SourceMapEntry };

/** Parse a comma-separated `discovered` query string into a clean list. */
function parseDiscoveredQuery(raw: unknown): string[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (Array.isArray(raw)) {
    const parts: string[] = [];
    for (const item of raw) {
      if (typeof item !== "string") continue;
      for (const piece of item.split(",")) parts.push(piece);
    }
    return parts;
  }
  if (typeof raw !== "string") return undefined;
  return raw.split(",");
}

export function registerImportScopeRoutes(app: FastifyInstance): void {
  app.get<{
    Params: { connectionId: string };
    Querystring: { discovered?: string | string[] };
  }>("/api/connections/:connectionId/import-scope", async (request, reply) => {
    const projectRoot = await resolveProjectRoot();
    const connectionId = request.params.connectionId;
    const discovered = parseDiscoveredQuery(request.query?.discovered);
    try {
      const preview = await buildImportScopePreview({
        projectRoot,
        connectionId,
        ...(discovered !== undefined ? { discovered } : {})
      });
      return reply.send({ ok: true, data: preview });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      if (error.code === "CONNECTION_NOT_FOUND") {
        reply.status(error.statusCode ?? 404);
        return reply.send({
          ok: false,
          error: {
            code: error.code,
            message: error.message
          }
        });
      }
      throw err;
    }
  });
}
