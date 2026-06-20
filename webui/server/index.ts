import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import Fastify, { type FastifyError } from "fastify";
import { parse, stringify } from "yaml";
import { buildProxy } from "./proxy/mcp-proxy.js";
import { changedFiles, type SessionWrittenFile } from "./diff";
import { joinCandidatesPath, readJoinCandidates, writeJoinCandidates, type JoinCandidate } from "./joins-sidecar";
import { validateSource, testConnection, runIngest, type ValidationResult } from "./ktx";
import { readProject, readConnections, resolveProjectRoot } from "./project";
import type { TablePatch } from "./model";
import { listSources, previewSourcePatch, readSource, writeSourcePatch } from "./semantic-layer";
import { listWiki, previewWikiWrite, readWiki, writeWiki, type WikiWriteInput } from "./wiki";
import { registerAgentRoutes } from "./admin/agents.js";
import { registerTokenRoutes } from "./admin/tokens.js";
import { registerAuditRoutes } from "./admin/audit.js";
import { registerMcpToolsRoutes } from "./admin/mcp-tools.js";
import { registerCaseRoutes } from "./eval/cases.js";
import { registerRunnerRoutes } from "./eval/runner.js";
import { registerMonitorRoutes } from "./eval/monitor.js";
import { safeWrite } from "./fs-safe.js";

type ErrorEnvelope = {
  ok: false;
  error: {
    code: string;
    message: string;
    detail?: unknown;
  };
};

export function buildServer() {
  const app = Fastify({ logger: true });
  const writtenFiles: SessionWrittenFile[] = [];
  const changedSources = new Map<string, { conn: string; schema: string; table: string }>();

  app.setErrorHandler((error: FastifyError & { code?: string; statusCode?: number }, _request, reply) => {
    const statusCode = error.statusCode ?? 500;
    const code = error.code ?? (statusCode === 500 ? "INTERNAL" : "BAD_REQUEST");
    const payload: ErrorEnvelope = {
      ok: false,
      error: {
        code,
        message: error.message || "Internal server error"
      }
    };

    reply.status(statusCode).send(payload);
  });

  app.get("/api/health", async () => ({
    ok: true,
    data: { status: "ok" }
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
    Body: { enabledTables: string[] };
  }>("/api/connections/:connId/enabled-tables", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const { connId } = request.params;
    const { enabledTables } = request.body ?? {};
    const yamlPath = path.join(projectRoot, "ktx.yaml");
    const yamlText = await readFile(yamlPath, "utf8");
    const config = parse(yamlText) as Record<string, unknown>;
    const connections = config.connections as Record<string, Record<string, unknown>> | undefined;
    if (!connections || !connections[connId]) {
      const err = new Error(`Connection '${connId}' not found in ktx.yaml`) as Error & { statusCode: number; code: string };
      err.statusCode = 404;
      err.code = "CONNECTION_NOT_FOUND";
      throw err;
    }
    connections[connId].enabled_tables = Array.isArray(enabledTables) ? enabledTables : [];
    await safeWrite(projectRoot, "ktx.yaml", stringify(config));
    return { ok: true };
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
  }>("/api/connections/:connId/ingest", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const { connId } = request.params;
    const result = await runIngest(projectRoot, connId);
    return { ok: true, data: result };
  });

  registerAgentRoutes(app);
  registerTokenRoutes(app);
  registerAuditRoutes(app);
  registerMcpToolsRoutes(app);
  registerCaseRoutes(app);
  registerRunnerRoutes(app);
  registerMonitorRoutes(app);

  return app;
}

async function start() {
  const app = buildServer();
  await app.listen({ host: "127.0.0.1", port: 5174 });

  const { server: proxy, host: proxyHost, port: proxyPort } = buildProxy();
  await new Promise<void>((resolve, reject) => {
    proxy.listen(proxyPort, proxyHost, resolve);
    proxy.on("error", reject);
  });
  console.log(`MCP proxy listening on http://${proxyHost}:${proxyPort}/mcp`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  start().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
