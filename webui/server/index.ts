import { createReadStream } from "node:fs";
import { lstat, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyError } from "fastify";
import { parse, parseDocument } from "yaml";
import { buildProxy } from "./proxy/mcp-proxy.js";
import { changedFiles, previewDiff, type SessionWrittenFile } from "./diff";
import { joinCandidatesPath, readJoinCandidates, writeJoinCandidates, type JoinCandidate } from "./joins-sidecar";
import { reindexProject, validateSource, testConnection, type ValidationResult } from "./ktx";
import {
  listLiveSchemas,
  LiveCatalogConnectionNotFoundError
} from "./live-catalog";
import { addSchema, createConnection, readConnections, readProject, resolveProjectRoot, removeSchema } from "./project";
import {
  // Ingest sidecar is M13 legacy. M14 keeps the helpers for the deprecated
  // `/api/connections/:connId/ingest` alias compatibility route.
  readIngestRuns as readLegacyIngestRuns,
  type IngestRunsResponse
} from "./ingest-runs";
import {
  reloadCatalog,
  readCatalogReloads,
  type CatalogReloadsResponse
} from "./catalog-reload";
import {
  CatalogAssetOverwriteRequiredError,
  CatalogAssetReadError,
  CatalogAssetValidationError,
  readCatalogAssetUploads,
  readCatalogSchemaManifest,
  uploadCatalogAsset,
  validateCatalogAsset,
  type CatalogSchemaManifestReadRequest,
  type CatalogAssetUploadRequest,
  type CatalogAssetValidateRequest
} from "./catalog-assets";
import type { TablePatch } from "./model";
import {
  listManifestSchemas,
  listSources,
  previewSourcePatch,
  previewSourceYamlImport,
  readSource,
  writeSourcePatch,
  writeSourceYamlImport
} from "./semantic-layer";
import {
  createTableYamlVersionSnapshot,
  listTableYamlVersions,
  previewTableYamlVersionRestore,
  readTableYamlVersion,
  restoreTableYamlVersionDraft
} from "./table-yaml-history";
import {
  createWikiDirectory,
  commitWikiUpload,
  deleteWiki,
  deleteWikiDirectory,
  listWiki,
  listWikiDirectories,
  listWikiVersions,
  moveWiki,
  previewWikiDirectoryRename,
  previewWikiMove,
  previewWikiUpload,
  previewWikiVersionRestore,
  previewWikiWrite,
  readWiki,
  readWikiVersion,
  renameWikiDirectory,
  restoreWikiVersion,
  writeWiki,
  type WikiDirectoryCreateInput,
  type WikiDirectoryRenameInput,
  type WikiMoveInput,
  type WikiUploadInput,
  type WikiWriteInput
} from "./wiki";
import { readHelpHandbook, searchHelpHandbook } from "./help.js";
import { registerAgentRoutes } from "./admin/agents.js";
import { registerRoleRoutes } from "./admin/roles.js";
import { registerTokenRoutes } from "./admin/tokens.js";
import { registerPolicyRuntimeRoutes } from "./admin/policy-runtime.js";
import { recordConfigChange, registerAuditRoutes } from "./admin/audit.js";
import { auditedWriteFile } from "./admin/config-audit-write.js";
import { registerMcpToolsRoutes } from "./admin/mcp-tools.js";
import { registerMcpPlaygroundRoutes } from "./admin/mcp-playground.js";
import { registerRiskReviewRoutes } from "./admin/risk-review.js";
import { registerReleaseReadinessRoutes } from "./admin/release-readiness-package.js";
import { registerGovernanceObservabilityRoutes } from "./admin/governance-observability.js";
import { registerAuthRoutes, registerAdminAccountRoutes } from "./auth/routes.js";
import { requireWebuiAuthHook } from "./auth/guard.js";
import { registerCaseRoutes } from "./eval/cases.js";
import { registerSecurityCandidateRoutes } from "./eval/security-candidates.js";
import { registerSuiteImportRoutes } from "./eval/suite-import.js";
import { registerRunnerRoutes } from "./eval/runner.js";
import { registerMonitorRoutes } from "./eval/monitor.js";
import { registerR1ObservabilityRoutes } from "./observability.js";
import { safeWrite } from "./fs-safe.js";
import {
  publishSemanticAssets,
  readSemanticAssetRelease,
  readSemanticAssetReleases,
  recordManualReindex,
  SemanticAssetValidationError,
  validateSemanticAssets,
  type SemanticAssetPublishRequest,
  type SemanticAssetReleaseListQuery,
  type SemanticAssetReleaseTrigger,
  type SemanticAssetValidateRequest
} from "./semantic-assets.js";
import { exportSemanticAssetPackage } from "./semantic-asset-export.js";
import {
  buildPublishHistoryCsvRows,
  formatPublishHistoryExportFilenameStamp
} from "../src/lib/publishHistoryLabels.js";

type ErrorEnvelope = {
  ok: false;
  error: {
    code: string;
    message: string;
    detail?: unknown;
  };
};

type SupportedError = FastifyError & {
  code?: string;
  statusCode?: number;
  detail?: unknown;
};

function supportedErrorDetail(error: SupportedError): unknown {
  if (error.code === "SCHEMA_NAME_INVALID") {
    const detail = error.detail;
    if (
      detail &&
      typeof detail === "object" &&
      "pattern" in detail &&
      typeof (detail as { pattern?: unknown }).pattern === "string"
    ) {
      return { pattern: (detail as { pattern: string }).pattern };
    }
  }
  if (error.code === "CONNECTION_ID_INVALID") {
    const detail = error.detail;
    if (
      detail &&
      typeof detail === "object" &&
      "pattern" in detail &&
      typeof (detail as { pattern?: unknown }).pattern === "string"
    ) {
      return { pattern: (detail as { pattern: string }).pattern };
    }
  }
  if (error.code === "CONNECTION_TEST_FAILED") {
    const detail = error.detail;
    if (detail && typeof detail === "object") {
      const source = detail as Record<string, unknown>;
      return Object.fromEntries(
        ["stdout", "stderr", "reason"]
          .filter((key) => typeof source[key] === "string")
          .map((key) => [key, source[key]])
      );
    }
  }
  return undefined;
}

const DEFAULT_WEBUI_PORT = 5174;
const STATIC_MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8"
};

function distDir(): string {
  return process.env.LUCY_WEBUI_DIST_DIR
    ? path.resolve(process.env.LUCY_WEBUI_DIST_DIR)
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
}

function contentType(filePath: string): string {
  return STATIC_MIME_TYPES[path.extname(filePath)] ?? "application/octet-stream";
}

async function staticFilePath(urlPath: string): Promise<string> {
  const root = distDir();
  const pathname = decodeURIComponent(urlPath.split("?")[0] ?? "/");
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const candidate = path.resolve(root, relative);
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (candidate !== root && !candidate.startsWith(rootWithSep)) {
    return path.join(root, "index.html");
  }
  try {
    const info = await stat(candidate);
    if (info.isFile()) return candidate;
  } catch {
    // Fall through to the SPA entry point.
  }
  return path.join(root, "index.html");
}

/**
 * Apply a local patch to a single connection's `enabled_tables` list while
 * preserving every other connection, field, comment and quoting in the file.
 *
 * Previously the endpoint round-tripped through `parse() -> mutate -> stringify()`,
 * which reordered keys and produced a large noisy diff for a 1-table change.
 * This helper validates the structure with the YAML parser, then applies a
 * line-level replacement to the target block so unrelated bytes stay untouched.
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function lineIndent(line: string): number {
  return line.match(/^ */)?.[0].length ?? 0;
}

function isStructuralYamlLine(line: string): boolean {
  const trimmed = line.trim();
  return Boolean(trimmed) && !trimmed.startsWith("#");
}

function findYamlBlockEnd(lines: string[], start: number, parentIndent: number): number {
  for (let i = start; i < lines.length; i += 1) {
    if (!isStructuralYamlLine(lines[i])) continue;
    if (lineIndent(lines[i]) <= parentIndent) return i;
  }
  return lines.length;
}

function enabledTablesBlock(indent: number, enabledTables: string[]): string[] {
  const pad = " ".repeat(indent);
  if (enabledTables.length === 0) {
    return [`${pad}enabled_tables: []`];
  }
  return [`${pad}enabled_tables:`, ...enabledTables.map((table) => `${pad}  - ${table}`)];
}

function patchConnectionEnabledTablesYaml(
  yamlText: string,
  connId: string,
  newEnabledTables: string[]
): { proposedYaml: string } {
  const doc = parseDocument(yamlText, { keepSourceTokens: true });
  const connections = doc.get("connections", true);
  if (!connections || typeof connections !== "object") {
    throw enabledTableError("CONNECTION_NOT_FOUND", `Connection '${connId}' not found in ktx.yaml`);
  }
  const connNode = connections.get(connId, true);
  if (!connNode) {
    throw enabledTableError("CONNECTION_NOT_FOUND", `Connection '${connId}' not found in ktx.yaml`);
  }

  const lines = yamlText.split("\n");
  const connectionsLine = lines.findIndex((line) => /^(\s*)connections:\s*(?:#.*)?$/.test(line));
  if (connectionsLine === -1) {
    throw enabledTableError("CONNECTION_NOT_FOUND", `Connection '${connId}' not found in ktx.yaml`);
  }

  const connectionsIndent = lineIndent(lines[connectionsLine]);
  const connectionsEnd = findYamlBlockEnd(lines, connectionsLine + 1, connectionsIndent);
  const connPattern = new RegExp(`^(\\s*)${escapeRegExp(connId)}:\\s*(?:#.*)?$`);
  let connLine = -1;
  for (let i = connectionsLine + 1; i < connectionsEnd; i += 1) {
    if (connPattern.test(lines[i]) && lineIndent(lines[i]) > connectionsIndent) {
      connLine = i;
      break;
    }
  }
  if (connLine === -1) {
    throw enabledTableError("CONNECTION_NOT_FOUND", `Connection '${connId}' not found in ktx.yaml`);
  }

  const connIndent = lineIndent(lines[connLine]);
  const connEnd = findYamlBlockEnd(lines, connLine + 1, connIndent);
  let enabledTablesLine = -1;
  for (let i = connLine + 1; i < connEnd; i += 1) {
    if (/^\s*enabled_tables:\s*(?:.*)?$/.test(lines[i]) && lineIndent(lines[i]) > connIndent) {
      enabledTablesLine = i;
      break;
    }
  }

  if (enabledTablesLine === -1) {
    const firstFieldLine = lines
      .slice(connLine + 1, connEnd)
      .find((line) => isStructuralYamlLine(line) && lineIndent(line) > connIndent);
    const fieldIndent = firstFieldLine ? lineIndent(firstFieldLine) : connIndent + 2;
    lines.splice(connEnd, 0, ...enabledTablesBlock(fieldIndent, newEnabledTables));
    return { proposedYaml: lines.join("\n") };
  }

  const fieldIndent = lineIndent(lines[enabledTablesLine]);
  const enabledTablesEnd = findYamlBlockEnd(lines, enabledTablesLine + 1, fieldIndent);
  lines.splice(
    enabledTablesLine,
    enabledTablesEnd - enabledTablesLine,
    ...enabledTablesBlock(fieldIndent, newEnabledTables)
  );
  return { proposedYaml: lines.join("\n") };
}

function makeDiff(oldText: string, newText: string): string {
  return previewDiff(oldText, newText, "ktx.yaml");
}

function enabledTableError(code: string, message: string) {
  const err = new Error(message) as Error & { statusCode: number; code: string };
  err.statusCode = code === "CONNECTION_NOT_FOUND" ? 404 : 400;
  err.code = code;
  return err;
}

async function scannedPhysicalTables(projectRoot: string, connId: string): Promise<Set<string>> {
  const schemaDir = path.join(projectRoot, "semantic-layer", connId, "_schema");
  const entries = await readdir(schemaDir, { withFileTypes: true }).catch(() => []);
  const tables = new Set<string>();
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".yaml")) continue;
    const schemaName = entry.name.replace(/\.yaml$/, "");
    const text = await readFile(path.join(schemaDir, entry.name), "utf8").catch(() => "");
    const doc = parse(text) as Record<string, unknown> | null;
    const rawTables = doc && typeof doc === "object" && doc.tables && typeof doc.tables === "object"
      ? doc.tables as Record<string, unknown>
      : {};
    for (const [sourceName, value] of Object.entries(rawTables)) {
      const tableDef = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
      const physical = typeof tableDef.table === "string" && tableDef.table.trim()
        ? tableDef.table.trim()
        : `${schemaName}.${sourceName}`;
      tables.add(physical);
    }
  }
  return tables;
}

type EnabledTableWarning = {
  code: "ENABLED_TABLE_NOT_SCANNED";
  table: string;
  message: string;
};

/**
 * Spec 116: only *newly added* tables must be in the scanned Manifest.
 * Tables already present in oldEnabledTables may be retained (invalid enabled /
 * orphan drift) and are reported via warnings instead of blocking the write.
 */
function validateEnabledTables(
  enabledTables: unknown,
  scanned: Set<string>,
  previouslyEnabled: Set<string>
): { tables: string[]; warnings: EnabledTableWarning[] } {
  if (!Array.isArray(enabledTables)) {
    throw enabledTableError("INVALID_ENABLED_TABLE", "enabledTables must be an array");
  }
  const seen = new Set<string>();
  const valid: string[] = [];
  const warnings: EnabledTableWarning[] = [];
  for (const item of enabledTables) {
    if (typeof item !== "string") {
      throw enabledTableError("INVALID_ENABLED_TABLE", "enabled table must be a string");
    }
    const table = item.trim();
    if (!table || /[\\/\u0000-\u001F]/.test(table) || table.includes("..") || !/^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/.test(table)) {
      throw enabledTableError("INVALID_ENABLED_TABLE", `Invalid enabled table '${item}'`);
    }
    if (seen.has(table)) {
      throw enabledTableError("DUPLICATE_ENABLED_TABLE", `Duplicate enabled table '${table}'`);
    }
    if (!scanned.has(table) && !previouslyEnabled.has(table)) {
      throw enabledTableError("TABLE_NOT_SCANNED", `Table '${table}' is not present in scanned semantic-layer schema`);
    }
    if (!scanned.has(table)) {
      warnings.push({
        code: "ENABLED_TABLE_NOT_SCANNED",
        table,
        message: `Table '${table}' is enabled but not present in scanned semantic-layer schema`
      });
    }
    seen.add(table);
    valid.push(table);
  }
  return { tables: valid, warnings };
}

export function buildServer() {
  const app = Fastify({ logger: true });
  const writtenFiles: SessionWrittenFile[] = [];
  const changedSources = new Map<string, { conn: string; schema: string; table: string }>();

  app.addHook("onRequest", requireWebuiAuthHook);

  app.setErrorHandler((error: SupportedError, _request, reply) => {
    const statusCode = error.statusCode ?? 500;
    const code = error.code ?? (statusCode === 500 ? "INTERNAL" : "BAD_REQUEST");
    const payload: ErrorEnvelope = {
      ok: false,
      error: {
        code,
        message: error.message || "Internal server error"
      }
    };
    const detail = supportedErrorDetail(error);
    if (detail !== undefined) {
      payload.error.detail = detail;
    }

    reply.status(statusCode).send(payload);
  });

  app.get("/api/health", async () => {
    const policy = getPolicyRuntimeStatus();
    const healthy = isPolicyRuntimeHealthy(policy);
    return {
      ok: true,
      data: {
        // Spec 98 §8.4 — align with /api/admin/policy-runtime; empty policyVersion is not healthy.
        status: healthy ? "ok" : "degraded",
        lucyVersion: process.env.npm_package_version ?? "unknown",
        bundledKtxVersion: process.env.LUCY_BUNDLED_KTX_VERSION ?? "unknown",
        policy: {
          policyVersion: policy.policyVersion,
          degradedGlobal: policy.degradedGlobal,
          degradedAgents: policy.degradedAgents,
          healthy
        }
      }
    };
  });

  app.get("/api/project", async () => {
    const projectRoot = await resolveProjectRoot();
    return {
      ok: true,
      data: await readProject(projectRoot)
    };
  });

  app.get("/api/sources", async () => {
    const projectRoot = await resolveProjectRoot();
    const [tables, manifestSchemas] = await Promise.all([
      listSources(projectRoot),
      listManifestSchemas(projectRoot)
    ]);
    return {
      ok: true,
      data: { tables, manifestSchemas }
    };
  });

  app.get<{
    Params: { conn: string; schema: string; table: string };
  }>("/api/sources/:conn/:schema/:table", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const { conn, schema, table } = request.params;
    return {
      ok: true,
      data: await readSource(projectRoot, conn, schema, table)
    };
  });

  app.put<{
    Params: { conn: string; schema: string; table: string };
    Body: { patch?: TablePatch; dryRun?: boolean; restoredFromVersionId?: string };
  }>("/api/sources/:conn/:schema/:table", async (request, reply) => {
    const dryRun = request.body?.dryRun !== false;
    const projectRoot = await resolveProjectRoot();
    const { conn, schema, table } = request.params;
    if (dryRun) {
      const data = await previewSourcePatch(projectRoot, conn, schema, table, request.body?.patch ?? {});
      return reply.send({
        ok: true,
        data
      });
    }

    const preview = await writeSourcePatch(projectRoot, conn, schema, table, request.body?.patch ?? {});
    for (const file of preview.files) {
      writtenFiles.push({ filePath: file.filePath });
    }
    changedSources.set(`${conn}/${schema}/${table}`, { conn, schema, table });
    const validation = await validateSource(projectRoot, conn, schema, table);
    const files = await changedFiles(projectRoot, writtenFiles);
    const nextSource = await readSource(projectRoot, conn, schema, table);
    const version = await createTableYamlVersionSnapshot(
      projectRoot,
      conn,
      schema,
      table,
      nextSource.rawYaml,
      {
        operation: request.body?.restoredFromVersionId ? "restore" : "save",
        restoredFromVersionId: request.body?.restoredFromVersionId,
        affectedFiles: preview.files.map((file) => file.filePath)
      }
    );
    return reply.send({
      ok: true,
      data: {
        written: true,
        validation,
        changedFiles: files,
        version
      }
    });
  });

  app.post<{
    Params: { conn: string; schema: string; table: string };
    Body: { yaml?: string; dryRun?: boolean; sourceFileName?: string; restoredFromVersionId?: string };
  }>("/api/sources/:conn/:schema/:table/import", async (request, reply) => {
    const dryRun = request.body?.dryRun !== false;
    const yaml = request.body?.yaml;
    if (typeof yaml !== "string" || !yaml.trim()) {
      return reply.status(400).send({
        ok: false,
        error: {
          code: "INVALID_IMPORT_YAML",
          message: "Imported YAML must be a non-empty string"
        }
      });
    }
    const projectRoot = await resolveProjectRoot();
    const { conn, schema, table } = request.params;
    if (dryRun) {
      const data = await previewSourceYamlImport(projectRoot, conn, schema, table, yaml);
      return reply.send({
        ok: true,
        data
      });
    }

    const preview = await writeSourceYamlImport(projectRoot, conn, schema, table, yaml);
    for (const file of preview.files) {
      writtenFiles.push({ filePath: file.filePath });
    }
    changedSources.set(`${conn}/${schema}/${table}`, { conn, schema, table });
    const validation = await validateSource(projectRoot, conn, schema, table);
    const files = await changedFiles(projectRoot, writtenFiles);
    const nextSource = await readSource(projectRoot, conn, schema, table);
    const version = await createTableYamlVersionSnapshot(
      projectRoot,
      conn,
      schema,
      table,
      nextSource.rawYaml,
      {
        operation: request.body?.restoredFromVersionId ? "restore" : "import",
        sourceFileName: request.body?.sourceFileName,
        restoredFromVersionId: request.body?.restoredFromVersionId,
        affectedFiles: preview.files.map((file) => file.filePath)
      }
    );
    return reply.send({
      ok: true,
      data: {
        written: true,
        validation,
        changedFiles: files,
        version
      }
    });
  });

  app.get<{
    Params: { conn: string; schema: string; table: string };
  }>("/api/sources/:conn/:schema/:table/versions", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const { conn, schema, table } = request.params;
    return {
      ok: true,
      data: await listTableYamlVersions(projectRoot, conn, schema, table)
    };
  });

  app.get<{
    Params: { conn: string; schema: string; table: string; versionId: string };
  }>("/api/sources/:conn/:schema/:table/versions/:versionId", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const { conn, schema, table, versionId } = request.params;
    const current = await readSource(projectRoot, conn, schema, table);
    return {
      ok: true,
      data: await readTableYamlVersion(projectRoot, conn, schema, table, versionId, current.rawYaml)
    };
  });

  app.post<{
    Params: { conn: string; schema: string; table: string; versionId: string };
  }>("/api/sources/:conn/:schema/:table/versions/:versionId/restore/preview", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const { conn, schema, table, versionId } = request.params;
    const current = await readSource(projectRoot, conn, schema, table);
    return {
      ok: true,
      data: await previewTableYamlVersionRestore(projectRoot, conn, schema, table, versionId, current.rawYaml)
    };
  });

  app.post<{
    Params: { conn: string; schema: string; table: string; versionId: string };
  }>("/api/sources/:conn/:schema/:table/versions/:versionId/restore", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const { conn, schema, table, versionId } = request.params;
    const current = await readSource(projectRoot, conn, schema, table);
    return {
      ok: true,
      data: await restoreTableYamlVersionDraft(projectRoot, conn, schema, table, versionId, current.rawYaml)
    };
  });

  app.post<{
    Params: { conn: string; schema: string; table: string };
  }>("/api/sources/:conn/:schema/:table/validate", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const { conn, schema, table } = request.params;
    return {
      ok: true,
      data: await validateSource(projectRoot, conn, schema, table)
    };
  });

  app.get("/api/diff", async () => {
    const projectRoot = await resolveProjectRoot();
    return {
      ok: true,
      data: { files: await changedFiles(projectRoot, writtenFiles) }
    };
  });

  app.post("/api/validate-changed", async () => {
    const projectRoot = await resolveProjectRoot();
    const results: Array<{ conn: string; schema: string; table: string; validation: ValidationResult }> = [];
    for (const source of changedSources.values()) {
      results.push({
        ...source,
        validation: await validateSource(projectRoot, source.conn, source.schema, source.table)
      });
    }
    return {
      ok: true,
      data: { results }
    };
  });

  app.get("/api/wiki", async () => {
    const projectRoot = await resolveProjectRoot();
    return {
      ok: true,
      data: {
        pages: await listWiki(projectRoot),
        directories: await listWikiDirectories(projectRoot)
      }
    };
  });

  app.post<{
    Body: WikiDirectoryCreateInput;
  }>("/api/wiki/directories", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const result = await createWikiDirectory(projectRoot, request.body);
    writtenFiles.push({ filePath: "wiki/.lucy-directories.json" });
    writtenFiles.push({ filePath: result.filePath });
    return {
      ok: true,
      data: result
    };
  });

  app.post<{
    Body: WikiDirectoryRenameInput;
  }>("/api/wiki/directories/rename/preview", async (request) => {
    const projectRoot = await resolveProjectRoot();
    return {
      ok: true,
      data: await previewWikiDirectoryRename(projectRoot, request.body ?? { sourcePath: "", newName: "" })
    };
  });

  app.post<{
    Body: WikiDirectoryRenameInput;
  }>("/api/wiki/directories/rename", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const result = await renameWikiDirectory(
      projectRoot,
      request.body ?? { sourcePath: "", newName: "" }
    );
    for (const filePath of result.writtenFiles) {
      writtenFiles.push({ filePath });
    }
    return {
      ok: true,
      data: result
    };
  });

  app.delete<{
    Params: { path: string };
  }>("/api/wiki/directories/:path", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const result = await deleteWikiDirectory(projectRoot, request.params.path);
    writtenFiles.push({ filePath: "wiki/.lucy-directories.json" });
    writtenFiles.push({ filePath: result.filePath });
    return {
      ok: true,
      data: result
    };
  });

  app.delete<{
    Params: { key: string };
  }>("/api/wiki/:key", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const result = await deleteWiki(projectRoot, request.params.key);
    writtenFiles.push({ filePath: result.filePath });
    writtenFiles.push({ filePath: "wiki/.lucy-history/index.json" });
    return {
      ok: true,
      data: result
    };
  });

  app.post<{
    Params: { key: string };
    Body: { targetDirectory?: string };
  }>("/api/wiki/:key/move/preview", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const targetDirectory = request.body?.targetDirectory ?? "";
    return {
      ok: true,
      data: await previewWikiMove(projectRoot, request.params.key, targetDirectory)
    };
  });

  app.post<{
    Params: { key: string };
    Body: WikiMoveInput;
  }>("/api/wiki/:key/move", async (request, reply) => {
    const projectRoot = await resolveProjectRoot();
    const targetDirectory = request.body?.targetDirectory ?? "";
    const result = await moveWiki(projectRoot, request.params.key, targetDirectory);
    writtenFiles.push({ filePath: result.filePath });
    writtenFiles.push({ filePath: "wiki/.lucy-history/index.json" });
    writtenFiles.push({ filePath: "wiki/.lucy-directories.json" });
    return reply.send({ ok: true, data: result });
  });

  app.get<{
    Params: { key: string };
  }>("/api/wiki/:key/raw", async (request, reply) => {
    const projectRoot = await resolveProjectRoot();
    const page = await readWiki(projectRoot, request.params.key);
    reply
      .header("Content-Type", "text/markdown; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="${path.posix.basename(page.key)}"`)
      .send(page.rawMarkdown);
  });

  app.post<{
    Body: WikiUploadInput;
  }>("/api/wiki/upload/preview", async (request) => {
    const projectRoot = await resolveProjectRoot();
    return {
      ok: true,
      data: await previewWikiUpload(projectRoot, request.body)
    };
  });

  app.post<{
    Body: WikiUploadInput;
  }>("/api/wiki/upload/commit", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const preview = await commitWikiUpload(projectRoot, request.body);
    writtenFiles.push({ filePath: preview.filePath });
    writtenFiles.push({ filePath: "wiki/.lucy-history/index.json" });
    return {
      ok: true,
      data: preview
    };
  });

  app.get<{
    Params: { key: string };
  }>("/api/wiki/:key/versions", async (request) => {
    const projectRoot = await resolveProjectRoot();
    return {
      ok: true,
      data: await listWikiVersions(projectRoot, request.params.key)
    };
  });

  app.get<{
    Params: { key: string; versionId: string };
  }>("/api/wiki/:key/versions/:versionId", async (request) => {
    const projectRoot = await resolveProjectRoot();
    return {
      ok: true,
      data: await readWikiVersion(projectRoot, request.params.key, request.params.versionId)
    };
  });

  app.post<{
    Params: { key: string; versionId: string };
  }>("/api/wiki/:key/versions/:versionId/restore/preview", async (request) => {
    const projectRoot = await resolveProjectRoot();
    return {
      ok: true,
      data: await previewWikiVersionRestore(projectRoot, request.params.key, request.params.versionId)
    };
  });

  app.post<{
    Params: { key: string; versionId: string };
  }>("/api/wiki/:key/versions/:versionId/restore", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const result = await restoreWikiVersion(projectRoot, request.params.key, request.params.versionId);
    writtenFiles.push({ filePath: result.filePath });
    writtenFiles.push({ filePath: "wiki/.lucy-history/index.json" });
    return {
      ok: true,
      data: result
    };
  });

  app.get<{
    Params: { key: string };
  }>("/api/wiki/:key", async (request) => {
    const projectRoot = await resolveProjectRoot();
    return {
      ok: true,
      data: await readWiki(projectRoot, request.params.key)
    };
  });

  app.put<{
    Params: { key: string };
    Body: { dryRun?: boolean; frontmatter?: WikiWriteInput["frontmatter"]; content?: string };
  }>("/api/wiki/:key", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const writeInput: WikiWriteInput = {
      frontmatter: request.body?.frontmatter,
      content: request.body?.content
    };
    const preview = request.body?.dryRun === false
      ? await writeWiki(projectRoot, request.params.key, writeInput)
      : await previewWikiWrite(projectRoot, request.params.key, writeInput);
    if (request.body?.dryRun === false) {
      writtenFiles.push({ filePath: preview.filePath });
      writtenFiles.push({ filePath: "wiki/.lucy-history/index.json" });
    }
    return {
      ok: true,
      data: preview
    };
  });

  app.get("/api/help/handbook", async () => {
    return {
      ok: true,
      data: await readHelpHandbook()
    };
  });

  app.get<{
    Querystring: { q?: string; limit?: string };
  }>("/api/help/search", async (request) => {
    const rawLimit = request.query.limit;
    const parsedLimit =
      rawLimit === undefined || rawLimit === "" ? undefined : Number.parseInt(rawLimit, 10);
    const limit =
      parsedLimit !== undefined && Number.isFinite(parsedLimit) ? parsedLimit : undefined;
    return {
      ok: true,
      data: await searchHelpHandbook(request.query.q ?? "", { limit })
    };
  });

  app.get("/api/joins/candidates", async () => {
    const projectRoot = await resolveProjectRoot();
    return {
      ok: true,
      data: await readJoinCandidates(projectRoot)
    };
  });

  app.put<{
    Body: { candidates?: JoinCandidate[] };
  }>("/api/joins/candidates", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const data = await writeJoinCandidates(projectRoot, request.body?.candidates ?? []);
    writtenFiles.push({ filePath: joinCandidatesPath() });
    return {
      ok: true,
      data
    };
  });

  // ─── Database connection routes ───────────────────────────────────────────

  app.get("/api/connections", async () => {
    const projectRoot = await resolveProjectRoot();
    const connections = await readConnections(projectRoot);
    return { ok: true, data: { connections } };
  });

  // Spec 124 Phase A: create connection (secret one-shot write + ktx.yaml patch).
  // dryRun defaults to true. No UI in this spike — API + security tests only.
  app.post<{
    Body: {
      id?: string;
      driver?: string;
      engine?: string;
      wireProtocol?: string;
      readonly?: boolean;
      host?: string;
      port?: number;
      database?: string;
      username?: string;
      password?: string;
      schemas?: string[];
      dryRun?: boolean;
    };
  }>("/api/connections", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const body = request.body ?? {};
    const dryRun = body.dryRun !== false;
    if (typeof body.id !== "string") {
      throw enabledTableError("BAD_REQUEST", "id is required");
    }
    if (body.driver !== "mysql" && body.driver !== "postgres") {
      throw enabledTableError("BAD_REQUEST", "driver must be mysql or postgres");
    }
    if (typeof body.host !== "string") {
      throw enabledTableError("BAD_REQUEST", "host is required");
    }
    if (typeof body.port !== "number") {
      throw enabledTableError("BAD_REQUEST", "port is required");
    }
    if (typeof body.database !== "string") {
      throw enabledTableError("BAD_REQUEST", "database is required");
    }
    if (typeof body.username !== "string") {
      throw enabledTableError("BAD_REQUEST", "username is required");
    }
    const result = await createConnection(
      projectRoot,
      {
        id: body.id,
        driver: body.driver,
        ...(typeof body.engine === "string" ? { engine: body.engine } : {}),
        ...(typeof body.wireProtocol === "string" ? { wireProtocol: body.wireProtocol } : {}),
        readonly: body.readonly,
        host: body.host,
        port: body.port,
        database: body.database,
        username: body.username,
        ...(typeof body.password === "string" ? { password: body.password } : {}),
        ...(Array.isArray(body.schemas) ? { schemas: body.schemas } : {})
      },
      dryRun,
      { recordConfigChange }
    );
    if (!dryRun) {
      writtenFiles.push({ filePath: "ktx.yaml" });
      if ("secretRelPath" in result) {
        writtenFiles.push({ filePath: result.secretRelPath });
      }
    }
    return { ok: true, data: result };
  });

  app.get<{
    Params: { connId: string };
  }>("/api/connections/:connId/tables", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const { connId } = request.params;
    const schemaDir = path.join(projectRoot, "semantic-layer", connId, "_schema");
    const entries = await readdir(schemaDir, { withFileTypes: true }).catch(() => []);
    const tables: string[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".yaml")) {
        continue;
      }
      const schemaName = entry.name.replace(/\.yaml$/, "");
      const text = await readFile(path.join(schemaDir, entry.name), "utf8").catch(() => "");
      const doc = parse(text) as Record<string, unknown> | null;
      if (doc && typeof doc === "object" && doc.tables && typeof doc.tables === "object") {
        for (const tableName of Object.keys(doc.tables as Record<string, unknown>)) {
          tables.push(`${schemaName}.${tableName}`);
        }
      }
    }
    return { ok: true, data: { tables: tables.sort() } };
  });

  app.get<{
    Params: { connId: string };
    Querystring: { refresh?: string };
  }>("/api/connections/:connId/live-schemas", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const { connId } = request.params;
    const refresh =
      request.query?.refresh === "1" ||
      request.query?.refresh === "true" ||
      request.query?.refresh === "yes";
    try {
      const data = await listLiveSchemas(projectRoot, connId, { refresh });
      return { ok: true, data };
    } catch (err) {
      if (err instanceof LiveCatalogConnectionNotFoundError) {
        throw enabledTableError(err.code, err.message);
      }
      throw err;
    }
  });

  app.put<{
    Params: { connId: string };
    Body: { enabledTables?: string[]; dryRun?: boolean };
  }>("/api/connections/:connId/enabled-tables", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const { connId } = request.params;
    const { enabledTables } = request.body ?? {};
    const dryRun = request.body?.dryRun !== false;
    const yamlPath = path.join(projectRoot, "ktx.yaml");
    const yamlText = await readFile(yamlPath, "utf8");
    const config = parse(yamlText) as Record<string, unknown>;
    const connections = config.connections as Record<string, Record<string, unknown>> | undefined;
    if (!connections || !connections[connId]) {
      throw enabledTableError("CONNECTION_NOT_FOUND", `Connection '${connId}' not found in ktx.yaml`);
    }
    const scanned = await scannedPhysicalTables(projectRoot, connId);
    const oldEnabledTables = Array.isArray(connections[connId].enabled_tables)
      ? connections[connId].enabled_tables.filter((item): item is string => typeof item === "string")
      : [];
    const { tables: newEnabledTables, warnings } = validateEnabledTables(
      enabledTables,
      scanned,
      new Set(oldEnabledTables)
    );

    // M45: local patch preserves order, comments and unknown
    // fields in unrelated parts of ktx.yaml so the dry-run diff only shows
    // the enabled_tables sequence change.
    const { proposedYaml } = patchConnectionEnabledTablesYaml(yamlText, connId, newEnabledTables);
    const diff = makeDiff(yamlText, proposedYaml);

    if (dryRun) {
      return { ok: true, data: { diff, proposedYaml, oldEnabledTables, newEnabledTables, warnings } };
    }

    const { auditId } = await auditedWriteFile(projectRoot, "ktx.yaml", proposedYaml, {
      enabled: true,
      changeType: "enabled_tables_update",
      assetKind: "governance",
      actorType: "ui_admin",
      source: "connections_enabled_tables_api",
      targetId: connId,
      oldSummary: { count: oldEnabledTables.length, enabledTables: oldEnabledTables },
      newSummary: { count: newEnabledTables.length, enabledTables: newEnabledTables },
      diff,
      requestId: request.id
    });
    return { ok: true, data: { written: true, auditId, oldEnabledTables, newEnabledTables, warnings } };
  });

  app.post<{
    Params: { connId: string };
  }>("/api/connections/:connId/test", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const { connId } = request.params;
    const result = await testConnection(projectRoot, connId);
    return { ok: true, data: result };
  });

  app.post<{
    Params: { connId: string };
    Body: { schema?: string; dryRun?: boolean };
  }>("/api/connections/:connId/schemas", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const { connId } = request.params;
    const body = request.body ?? {};
    const dryRun = body.dryRun !== false;
    if (typeof body.schema !== "string") {
      throw enabledTableError("BAD_REQUEST", "schema is required");
    }
    const result = await addSchema(projectRoot, connId, body.schema, dryRun, {
      recordConfigChange
    });
    if (!dryRun) {
      writtenFiles.push({ filePath: "ktx.yaml" });
    }
    return { ok: true, data: result };
  });

  app.post<{
    Params: { connId: string };
    Body: { schema?: string; dryRun?: boolean; deleteManifest?: boolean; deleteOverlays?: boolean };
  }>("/api/connections/:connId/schemas/remove", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const { connId } = request.params;
    const body = request.body ?? {};
    const dryRun = body.dryRun !== false;
    if (typeof body.schema !== "string") {
      throw enabledTableError("BAD_REQUEST", "schema is required");
    }
    const result = await removeSchema(projectRoot, connId, body.schema, dryRun, {
      recordConfigChange,
      deleteManifest: body.deleteManifest,
      deleteOverlays: body.deleteOverlays
    });
    if (!dryRun) {
      writtenFiles.push({ filePath: "ktx.yaml" });
      if ("deletedFiles" in result) {
        for (const filePath of result.deletedFiles) {
          writtenFiles.push({ filePath });
        }
      }
    }
    return { ok: true, data: result };
  });

  // M14: deprecated alias for `/api/connections/:connId/ingest`. The M13
  // route used to shell out to `ktx ingest <conn>`, which transitively
  // required LLM/embedding/enrichment configuration. We now satisfy the
  // request by reloading the static local catalog and return a `deprecated:
  // true` envelope so legacy clients get a structured 200 response instead
  // of a 404 or an enrichment-misconfiguration crash.
  app.post<{
    Params: { connId: string };
    Body: { schema?: string };
  }>("/api/connections/:connId/ingest", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const { connId } = request.params;
    const body = request.body ?? {};
    const schema = typeof body.schema === "string" && body.schema.trim().length > 0
      ? body.schema.trim()
      : undefined;
    const reload = await reloadCatalog(projectRoot, {
      connectionId: connId,
      ...(schema ? { schema } : {}),
      deprecatedIngestAlias: true
    });
    return {
      ok: true,
      data: {
        deprecated: true,
        replacement: "/api/catalog/reload",
        message: "WebUI no longer executes ktx ingest. Static catalog reload completed.",
        reload
      }
    };
  });

  app.get<{
    Params: { connId?: string };
  }>("/api/connections/ingest-runs", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const data: IngestRunsResponse = await readLegacyIngestRuns(projectRoot);
    if (request.params.connId && data.lastByConnection[request.params.connId] === undefined) {
      // No history for that connection: still return an empty record so the
      // frontend can render "未运行" without falling back to the global view.
      return { ok: true, data: { runs: [], lastByConnection: {} } };
    }
    return { ok: true, data };
  });

  // M14: the new core catalog refresh endpoints. They read only the local
  // filesystem and never shell out to the ktx CLI. They are the replacement
  // for the M13 ingest route (which is preserved as a deprecated alias above).
  app.post<{
    Body: { connectionId?: string; schema?: string };
  }>("/api/catalog/reload", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const body = request.body ?? {};
    const connectionId =
      typeof body.connectionId === "string" && body.connectionId.trim().length > 0
        ? body.connectionId.trim()
        : undefined;
    const schema =
      typeof body.schema === "string" && body.schema.trim().length > 0
        ? body.schema.trim()
        : undefined;
    const run = await reloadCatalog(projectRoot, {
      ...(connectionId ? { connectionId } : {}),
      ...(schema ? { schema } : {})
    });
    return { ok: true, data: run };
  });

  app.get("/api/catalog/reloads", async () => {
    const projectRoot = await resolveProjectRoot();
    const data: CatalogReloadsResponse = await readCatalogReloads(projectRoot);
    return { ok: true, data };
  });

  // ─── M17: Controlled YAML catalog asset upload ───────────────────────────
  // WebUI uses these endpoints to let analysts commit a schema manifest
  // without going through ops. The target path is server-computed, never
  // client-supplied. Symlink chains and arbitrary writes are rejected.

  app.post<{
    Body: Partial<CatalogAssetValidateRequest>;
  }>("/api/catalog/assets/validate", async (request, reply) => {
    const projectRoot = await resolveProjectRoot();
    const body = request.body ?? {};
    const rawAssetKind = (body as { assetKind?: unknown }).assetKind;
    const rawAssetType = (body as { assetType?: unknown }).assetType;
    const validation = await validateCatalogAsset(projectRoot, {
      connectionId: typeof body.connectionId === "string" ? body.connectionId : "",
      schema: typeof body.schema === "string" ? body.schema : "",
      assetKind: rawAssetKind as CatalogAssetValidateRequest["assetKind"],
      assetType: rawAssetType as CatalogAssetValidateRequest["assetType"],
      filename: typeof body.filename === "string" ? body.filename : "",
      content: typeof body.content === "string" ? body.content : ""
    });
    return reply.send({ ok: true, data: validation });
  });

  app.post<{
    Body: Partial<CatalogAssetUploadRequest>;
  }>("/api/catalog/assets/upload", async (request, reply) => {
    const projectRoot = await resolveProjectRoot();
    const body = request.body ?? {};
    const rawAssetKind = (body as { assetKind?: unknown }).assetKind;
    const rawAssetType = (body as { assetType?: unknown }).assetType;
    const upload: CatalogAssetUploadRequest = {
      connectionId: typeof body.connectionId === "string" ? body.connectionId : "",
      schema: typeof body.schema === "string" ? body.schema : "",
      assetKind: rawAssetKind as CatalogAssetUploadRequest["assetKind"],
      assetType: rawAssetType as CatalogAssetUploadRequest["assetType"],
      filename: typeof body.filename === "string" ? body.filename : "",
      content: typeof body.content === "string" ? body.content : "",
      confirmOverwrite: body.confirmOverwrite === true
    };
    try {
      const result = await uploadCatalogAsset(projectRoot, upload);
      return reply.send({ ok: true, data: result });
    } catch (error) {
      if (error instanceof CatalogAssetValidationError) {
        reply.status(error.statusCode);
        return reply.send({
          ok: false,
          error: { code: error.code, message: error.message },
          data: { validation: error.validation }
        });
      }
      if (error instanceof CatalogAssetOverwriteRequiredError) {
        reply.status(409);
        return reply.send({
          ok: false,
          error: { code: error.code, message: error.message },
          data: { validation: error.validation }
        });
      }
      throw error;
    }
  });

  app.get("/api/catalog/assets/uploads", async () => {
    const projectRoot = await resolveProjectRoot();
    return { ok: true, data: await readCatalogAssetUploads(projectRoot) };
  });

  app.get<{
    Querystring: Partial<CatalogSchemaManifestReadRequest>;
  }>("/api/catalog/assets/schema-manifest", async (request, reply) => {
    const projectRoot = await resolveProjectRoot();
    try {
      const data = await readCatalogSchemaManifest(projectRoot, {
        connectionId: typeof request.query.connectionId === "string" ? request.query.connectionId : "",
        schema: typeof request.query.schema === "string" ? request.query.schema : ""
      });
      return reply.send({ ok: true, data });
    } catch (error) {
      if (error instanceof CatalogAssetReadError) {
        reply.status(error.statusCode);
        return reply.send({
          ok: false,
          error: { code: error.code, message: error.message }
        });
      }
      throw error;
    }
  });

  // ─── M19: Semantic Asset Self-Service Publish And Export ────────────────

  app.post<{
    Body: Partial<SemanticAssetValidateRequest>;
  }>("/api/semantic-assets/validate", async (request, reply) => {
    const projectRoot = await resolveProjectRoot();
    const body = request.body ?? {};
    const files = Array.isArray(body.files)
      ? body.files
          .filter(
            (item): item is { filename: string; content: string } =>
              !!item &&
              typeof (item as { filename?: unknown }).filename === "string" &&
              typeof (item as { content?: unknown }).content === "string"
          )
          .map((item) => ({
            filename: item.filename,
            content: item.content
          }))
      : [];
    const packages = Array.isArray(body.packages)
      ? body.packages
          .filter(
            (item): item is { filename: string; contentBase64: string } =>
              !!item &&
              typeof (item as { filename?: unknown }).filename === "string" &&
              typeof (item as { contentBase64?: unknown }).contentBase64 === "string"
          )
          .map((item) => ({
            filename: item.filename,
            contentBase64: item.contentBase64
          }))
      : [];
    const result = await validateSemanticAssets(projectRoot, {
      files,
      packages,
      defaultConnectionId:
        typeof body.defaultConnectionId === "string" ? body.defaultConnectionId : undefined,
      defaultSchema: typeof body.defaultSchema === "string" ? body.defaultSchema : undefined
    });
    return reply.send({ ok: true, data: result });
  });

  app.post<{
    Body: Partial<SemanticAssetPublishRequest>;
  }>("/api/semantic-assets/publish", async (request, reply) => {
    const projectRoot = await resolveProjectRoot();
    const body = request.body ?? {};
    const validationId =
      typeof body.validationId === "string" ? body.validationId : "";
    try {
      const result = await publishSemanticAssets(projectRoot, {
        validationId,
        confirmOverwrite: body.confirmOverwrite === true
      });
      return reply.send({ ok: true, data: result });
    } catch (error) {
      if (error instanceof SemanticAssetValidationError) {
        reply.status(error.statusCode);
        return reply.send({
          ok: false,
          error: { code: error.code, message: error.message },
          data: {
            errors: error.errors,
            ...(error.release ? { release: error.release } : {})
          }
        });
      }
      throw error;
    }
  });

  function parseReleaseListQuery(q: {
    since?: string;
    until?: string;
    trigger?: string;
    reindexStatus?: string;
    actor?: string;
    limit?: string;
    offset?: string;
  }): SemanticAssetReleaseListQuery {
    const trigger =
      q.trigger === "webui_publish" || q.trigger === "webui_manual_reindex"
        ? (q.trigger as SemanticAssetReleaseTrigger)
        : undefined;
    const reindexStatus =
      q.reindexStatus === "success" ||
      q.reindexStatus === "failed" ||
      q.reindexStatus === "running" ||
      q.reindexStatus === "not_run"
        ? q.reindexStatus
        : undefined;
    const limitRaw = q.limit != null && q.limit !== "" ? Number(q.limit) : undefined;
    const offsetRaw = q.offset != null && q.offset !== "" ? Number(q.offset) : undefined;
    return {
      since: q.since || undefined,
      until: q.until || undefined,
      trigger,
      reindexStatus,
      actor: q.actor || undefined,
      limit: limitRaw != null && Number.isFinite(limitRaw) ? limitRaw : undefined,
      offset: offsetRaw != null && Number.isFinite(offsetRaw) ? offsetRaw : undefined
    };
  }

  app.get<{
    Querystring: {
      since?: string;
      until?: string;
      trigger?: string;
      reindexStatus?: string;
      actor?: string;
      limit?: string;
      offset?: string;
    };
  }>("/api/semantic-assets/releases", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const query = parseReleaseListQuery(request.query);
    return { ok: true, data: await readSemanticAssetReleases(projectRoot, query) };
  });

  app.get<{
    Querystring: {
      since?: string;
      until?: string;
      trigger?: string;
      reindexStatus?: string;
      actor?: string;
    };
  }>("/api/semantic-assets/releases/export.csv", async (request, reply) => {
    const projectRoot = await resolveProjectRoot();
    const query = parseReleaseListQuery(request.query);
    // Export ignores pagination — full filtered set.
    delete query.limit;
    delete query.offset;
    const { records } = await readSemanticAssetReleases(projectRoot, query);
    const stamp = formatPublishHistoryExportFilenameStamp();
    const filename = `publish-history-${stamp}.csv`;
    reply.header("Content-Type", "text/csv; charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename="${filename}"`);
    return reply.send(buildPublishHistoryCsvRows(records));
  });

  app.get<{
    Params: { id: string };
  }>("/api/semantic-assets/releases/:id/status", async (request, reply) => {
    const projectRoot = await resolveProjectRoot();
    const record = await readSemanticAssetRelease(projectRoot, request.params.id);
    if (!record) {
      reply.status(404);
      return reply.send({
        ok: false,
        error: {
          code: "RELEASE_NOT_FOUND",
          message: `Release ${request.params.id} was not found`
        }
      });
    }
    return { ok: true, data: { release: record } };
  });

  app.post<{
    Body: { force?: boolean };
  }>("/api/semantic-assets/reindex", async (request, reply) => {
    const projectRoot = await resolveProjectRoot();
    const force = request.body?.force === true;
    const lockPath = path.resolve(projectRoot, ".ktx-ui", "semantic-publish.lock");
    try {
      const lockStat = await lstat(lockPath);
      if (lockStat.isFile()) {
        reply.status(409);
        return reply.send({
          ok: false,
          error: {
            code: "REINDEX_IN_PROGRESS",
            message: "已有发布批次正在重建索引，请等待当前批次完成后再试"
          }
        });
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    const startedAt = new Date().toISOString();
    const reindex = await reindexProject(projectRoot, { force });
    const finishedAt = new Date().toISOString();
    const reindexRecord = {
      ok: reindex.exitCode === 0,
      exitCode: reindex.exitCode,
      stdout: reindex.stdout,
      stderr: reindex.stderr
    };
    // M32: write a lightweight history record so /publish/history can show
    // the reindex result alongside normal publish batches.
    const historyRecord = await recordManualReindex(projectRoot, {
      force,
      startedAt,
      reindex: reindexRecord
    });
    return {
      ok: true,
      data: {
        id: historyRecord.id,
        force,
        startedAt,
        finishedAt,
        reindex: reindexRecord
      }
    };
  });

  app.post<{
    Body: {
      scope?: { connectionId?: string; schema?: string };
      includeWiki?: boolean;
      includeEvals?: boolean;
      includeSkills?: boolean;
      includeSanitizedKtxYaml?: boolean;
    };
  }>("/api/semantic-assets/export", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const body = request.body ?? {};
    const scope =
      body.scope && typeof body.scope === "object" && !Array.isArray(body.scope)
        ? {
            connectionId:
              typeof body.scope.connectionId === "string" ? body.scope.connectionId : undefined,
            schema: typeof body.scope.schema === "string" ? body.scope.schema : undefined
          }
        : undefined;
    const result = await exportSemanticAssetPackage(projectRoot, {
      ...(scope ? { scope } : {}),
      includeWiki: body.includeWiki === true,
      includeEvals: body.includeEvals === true,
      includeSkills: body.includeSkills === true,
      includeSanitizedKtxYaml: body.includeSanitizedKtxYaml !== false
    });
    return { ok: true, data: result };
  });

  app.get<{
    Params: { exportId: string };
  }>("/api/semantic-assets/exports/:exportId/download", async (request, reply) => {
    const projectRoot = await resolveProjectRoot();
    const exportId = request.params.exportId;
    if (!/^exp_\d{8}_\d{6}_\d{3}_[0-9a-f]{8}$/.test(exportId)) {
      reply.status(404);
      return reply.send({
        ok: false,
        error: {
          code: "EXPORT_NOT_FOUND",
          message: `Export ${exportId} 不存在或已过期`
        }
      });
    }
    const exportsDir = path.resolve(projectRoot, ".ktx-ui", "exports");
    const zipPath = path.join(exportsDir, `${exportId}.zip`);
    let exists = false;
    try {
      const info = await lstat(zipPath);
      exists = info.isFile() && !info.isSymbolicLink();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    if (!exists) {
      reply.status(404);
      return reply.send({
        ok: false,
        error: {
          code: "EXPORT_NOT_FOUND",
          message: `Export ${exportId} 不存在或已过期`
        }
      });
    }
    reply.type("application/zip");
    reply.header(
      "Content-Disposition",
      `attachment; filename="lucy-semantic-asset-${exportId}.zip"`
    );
    return reply.send(createReadStream(zipPath));
  });

  registerAuthRoutes(app);
  registerAdminAccountRoutes(app);
  registerAgentRoutes(app);
  registerRoleRoutes(app);
  registerTokenRoutes(app);
  registerPolicyRuntimeRoutes(app);
  registerAuditRoutes(app);
  registerMcpToolsRoutes(app);
  registerMcpPlaygroundRoutes(app);
  registerGovernanceObservabilityRoutes(app);
  registerCaseRoutes(app);
  registerSecurityCandidateRoutes(app);
  registerSuiteImportRoutes(app);
  registerRunnerRoutes(app);
  registerMonitorRoutes(app);
  registerR1ObservabilityRoutes(app);
  registerRiskReviewRoutes(app);
  registerReleaseReadinessRoutes(app);

  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith("/api/")) {
      return reply.status(404).send({
        ok: false,
        error: {
          code: "NOT_FOUND",
          message: `Route ${request.method} ${request.url} not found`
        }
      } satisfies ErrorEnvelope);
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return reply.status(404).send({
        ok: false,
        error: {
          code: "NOT_FOUND",
          message: `Route ${request.method} ${request.url} not found`
        }
      } satisfies ErrorEnvelope);
    }
    const filePath = await staticFilePath(request.url);
    return reply.type(contentType(filePath)).send(createReadStream(filePath));
  });

  return app;
}

async function start() {
  // Spec 98 §8.3 — compile verified EffectivePolicy before accepting traffic.
  // Empty policyVersion must not be the steady-state after a clean start.
  const { commitEffectivePolicy } = await import("./proxy/acl.js");
  await commitEffectivePolicy();

  const app = buildServer();
  const host = process.env.LUCY_WEBUI_HOST ?? "127.0.0.1";
  const port = Number(process.env.LUCY_WEBUI_PORT ?? DEFAULT_WEBUI_PORT);
  await app.listen({ host, port });

  const { server: proxy, host: proxyHost, port: proxyPort } = buildProxy();
  await new Promise<void>((resolve, reject) => {
    proxy.listen(proxyPort, proxyHost, resolve);
    proxy.on("error", reject);
  });
  console.log(`Lucy WebUI listening on http://${host}:${port}`);
  console.log(`MCP proxy listening on http://${proxyHost}:${proxyPort}/mcp`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  start().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
