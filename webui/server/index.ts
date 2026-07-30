import { createReadStream } from "node:fs";
import { lstat, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyError } from "fastify";
import { parse, stringify } from "yaml";
import { buildProxy } from "./proxy/mcp-proxy.js";
import { changedFiles, type SessionWrittenFile } from "./diff";
import { joinCandidatesPath, readJoinCandidates, writeJoinCandidates, type JoinCandidate } from "./joins-sidecar";
import { validateSource, testConnection, type ValidationResult } from "./ktx";
import { addSchema, readConnections, readProject, resolveProjectRoot } from "./project";
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
  CatalogAssetValidationError,
  readCatalogAssetUploads,
  uploadCatalogAsset,
  validateCatalogAsset,
  type CatalogAssetUploadRequest,
  type CatalogAssetValidateRequest
} from "./catalog-assets";
import type { TablePatch } from "./model";
import { listSources, previewSourcePatch, readSource, writeSourcePatch } from "./semantic-layer";
import { listWiki, previewWikiWrite, readWiki, writeWiki, type WikiWriteInput } from "./wiki";
import { readHelpHandbook } from "./help.js";
import { registerAgentRoutes } from "./admin/agents.js";
import { registerRoleRoutes } from "./admin/roles.js";
import { registerTokenRoutes } from "./admin/tokens.js";
import { recordConfigChange, registerAuditRoutes } from "./admin/audit.js";
import { registerMcpToolsRoutes } from "./admin/mcp-tools.js";
import { registerCaseRoutes } from "./eval/cases.js";
import { registerRunnerRoutes } from "./eval/runner.js";
import { registerMonitorRoutes } from "./eval/monitor.js";
import { registerR1ObservabilityRoutes } from "./observability.js";
import { safeWrite } from "./fs-safe.js";
import {
  publishSemanticAssets,
  readSemanticAssetRelease,
  readSemanticAssetReleases,
  SemanticAssetValidationError,
  validateSemanticAssets,
  type SemanticAssetPublishRequest,
  type SemanticAssetValidateRequest
} from "./semantic-assets.js";
import { exportSemanticAssetPackage } from "./semantic-asset-export.js";

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

function makeDiff(oldText: string, newText: string): string {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const lines: string[] = [];
  const maxLen = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < maxLen; i += 1) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];
    if (oldLine === undefined) lines.push(`+${newLine}`);
    else if (newLine === undefined) lines.push(`-${oldLine}`);
    else if (oldLine !== newLine) {
      lines.push(`-${oldLine}`);
      lines.push(`+${newLine}`);
    } else {
      lines.push(` ${oldLine}`);
    }
  }
  return lines.join("\n");
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

function validateEnabledTables(enabledTables: unknown, scanned: Set<string>): string[] {
  if (!Array.isArray(enabledTables)) {
    throw enabledTableError("INVALID_ENABLED_TABLE", "enabledTables must be an array");
  }
  const seen = new Set<string>();
  const valid: string[] = [];
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
    if (!scanned.has(table)) {
      throw enabledTableError("TABLE_NOT_SCANNED", `Table '${table}' is not present in scanned semantic-layer schema`);
    }
    seen.add(table);
    valid.push(table);
  }
  return valid;
}

export function buildServer() {
  const app = Fastify({ logger: true });
  const writtenFiles: SessionWrittenFile[] = [];
  const changedSources = new Map<string, { conn: string; schema: string; table: string }>();

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

  app.get("/api/health", async () => ({
    ok: true,
    data: {
      status: "ok",
      lucyVersion: process.env.npm_package_version ?? "unknown",
      bundledKtxVersion: process.env.LUCY_BUNDLED_KTX_VERSION ?? "unknown"
    }
  }));

  app.get("/api/project", async () => {
    const projectRoot = await resolveProjectRoot();
    return {
      ok: true,
      data: await readProject(projectRoot)
    };
  });

  app.get("/api/sources", async () => {
    const projectRoot = await resolveProjectRoot();
    return {
      ok: true,
      data: { tables: await listSources(projectRoot) }
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
    Body: { patch?: TablePatch; dryRun?: boolean };
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
    return reply.send({
      ok: true,
      data: {
        written: true,
        validation,
        changedFiles: files
      }
    });
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
      data: { pages: await listWiki(projectRoot) }
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
    const newEnabledTables = validateEnabledTables(enabledTables, scanned);
    const oldEnabledTables = Array.isArray(connections[connId].enabled_tables)
      ? connections[connId].enabled_tables.filter((item): item is string => typeof item === "string")
      : [];
    connections[connId].enabled_tables = newEnabledTables;
    const proposedYaml = stringify(config, { lineWidth: 0 });
    const diff = makeDiff(yamlText, proposedYaml);

    if (dryRun) {
      return { ok: true, data: { diff, proposedYaml, oldEnabledTables, newEnabledTables } };
    }

    const auditId = await recordConfigChange({
      filePath: "ktx.yaml",
      changeType: "enabled_tables_update",
      targetId: connId,
      oldSummary: { count: oldEnabledTables.length, enabledTables: oldEnabledTables },
      newSummary: { count: newEnabledTables.length, enabledTables: newEnabledTables },
      diff
    });
    await safeWrite(projectRoot, "ktx.yaml", proposedYaml);
    return { ok: true, data: { written: true, auditId, oldEnabledTables, newEnabledTables } };
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
    const rawAssetType = (body as { assetType?: unknown }).assetType;
    const validation = await validateCatalogAsset(projectRoot, {
      connectionId: typeof body.connectionId === "string" ? body.connectionId : "",
      schema: typeof body.schema === "string" ? body.schema : "",
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
    const rawAssetType = (body as { assetType?: unknown }).assetType;
    const upload: CatalogAssetUploadRequest = {
      connectionId: typeof body.connectionId === "string" ? body.connectionId : "",
      schema: typeof body.schema === "string" ? body.schema : "",
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

  app.get("/api/semantic-assets/releases", async () => {
    const projectRoot = await resolveProjectRoot();
    return { ok: true, data: await readSemanticAssetReleases(projectRoot) };
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

  registerAgentRoutes(app);
  registerRoleRoutes(app);
  registerTokenRoutes(app);
  registerAuditRoutes(app);
  registerMcpToolsRoutes(app);
  registerCaseRoutes(app);
  registerRunnerRoutes(app);
  registerMonitorRoutes(app);
  registerR1ObservabilityRoutes(app);

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
