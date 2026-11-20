import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TOKEN = "execution-stale-agent-token";
const INTERNAL_TOKEN = "execution-stale-internal-token";

function tokenHash(token: string): string {
  return `sha256:${createHash("sha256").update(token).digest("hex")}`;
}

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

let projectRoot: string;
let auditDbPath: string;
const previousEnv: Record<string, string | undefined> = {};

beforeEach(async () => {
  vi.resetModules();
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-mcp-execution-stale-"));
  auditDbPath = path.join(projectRoot, "audit.sqlite");
  await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
  await mkdir(path.join(projectRoot, "semantic-layer", "zijin", "_schema"), { recursive: true });
  await writeFile(
    path.join(projectRoot, "ktx.yaml"),
    "connections:\n  zijin:\n    schemas: [finance]\n    enabled_tables: [finance.funds]\n",
    "utf8"
  );
  await writeFile(
    path.join(projectRoot, "semantic-layer", "zijin", "_schema", "finance.yaml"),
    "tables:\n  funds:\n    table: finance.funds\n",
    "utf8"
  );
  await writeFile(
    path.join(projectRoot, "webui", "config", "access.yaml"),
    `users:
  - id: finbp_nbcb_funds
    enabled: true
    tokens:
      - hash: "${tokenHash(TOKEN)}"
        label: test-token
        created: 2026-09-08
    allow:
      connections: [zijin]
      tables: [finance.funds]
      tools: [lucy_query]
defaults:
  deny_tools: []
`,
    "utf8"
  );

  for (const key of [
    "KTX_PROJECT_ROOT",
    "LUCY_AUDIT_DB",
    "KTX_INTERNAL_TOKEN",
    "LUCY_PROXY_UPSTREAM_HOST",
    "LUCY_PROXY_UPSTREAM_PORT",
    "LUCY_QUESTION_BUDGET"
  ]) previousEnv[key] = process.env[key];
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_CONTENT_ROOT = ".";
  process.env.LUCY_AUDIT_DB = auditDbPath;
  process.env.KTX_INTERNAL_TOKEN = INTERNAL_TOKEN;
});

afterEach(async () => {
  const audit = await import("../proxy/audit");
  audit.closeAuditDb();
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(projectRoot, { recursive: true, force: true });
});

async function waitForAuditRow(requestId: string): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    const db = new Database(auditDbPath, { readonly: true });
    try {
      const row = db.prepare("SELECT * FROM access_log WHERE request_id = ?").get(requestId) as Record<string, unknown> | undefined;
      if (row) return row;
    } finally {
      db.close();
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`audit row not found: ${requestId}`);
}

describe("MCP execution stale classification", () => {
  it.each(["lucy_query", "lucy_read_source", "lucy_explain_query", "revoke", "term", "disconnect", "term-revalidate", "disconnect-before-dispatch", "term-before-dispatch", "catalog-refresh"])(
    "P1-70 real HTTP retains tool semantics and higher-priority response while waiting (%s)", async (mode) => {
      const accessFile = path.join(projectRoot, "webui/config/access.yaml");
      const { readFile } = await import("node:fs/promises");
      await writeFile(accessFile, (await readFile(accessFile, "utf8"))
        .replace("tools: [lucy_query]", "tools: [lucy_query, lucy_read_source, lucy_explain_query]"));
      if (mode === "catalog-refresh") {
        await writeFile(accessFile, (await readFile(accessFile, "utf8"))
          .replace("tables: [finance.funds]", "tables: [finance.funds, finance.other_funds]"));
        const projectFile = path.join(projectRoot, "ktx.yaml");
        await writeFile(projectFile, (await readFile(projectFile, "utf8"))
          .replace("enabled_tables: [finance.funds]", "enabled_tables: [finance.funds, finance.other_funds]"));
        await writeFile(path.join(projectRoot, "semantic-layer/zijin/_schema/finance.yaml"),
          "tables:\n  funds:\n    table: finance.funds\n    columns: [campaign_id]\n  other_funds:\n    table: finance.other_funds\n");
      }
      let businessCalls = 0;
      const upstream = createServer(async (req, res) => {
        const rpc = JSON.parse(await readRequestBody(req));
        if (rpc.params?.name === "sl_query") businessCalls++;
        const data = rpc.params?.name === "sl_read_source"
          ? "name: funds\ntable: finance.funds\n"
          : JSON.stringify({ headers: ["count", "amount"], rows: [[4, "100"]], totalRows: 1 });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { content: [{ type: "text", text: data }] } }));
      });
      await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
      process.env.LUCY_PROXY_UPSTREAM_HOST = "127.0.0.1";
      process.env.LUCY_PROXY_UPSTREAM_PORT = String((upstream.address() as AddressInfo).port);
      if (mode === "disconnect-before-dispatch") process.env.LUCY_QUESTION_BUDGET = "off";
      const drain = await import("../runtime/process-drain.js");
      const { buildProxy } = await import("../proxy/mcp-proxy.js");
      const coordinator = await import("../publish-coordinator.js");
      const journal = await import("../semantic-recovery-journal.js");
      const guardApi = await import("../proxy/query-guardrails.js");
      if (mode === "catalog-refresh") {
        guardApi.resetAmbiguityCatalogCache();
        const primed = await guardApi.loadPublishedAmbiguityCatalog();
        expect(primed.sources.map((source) => source.sourceName)).toEqual(["funds"]);
      }
      let phaseEnter!: () => void, phaseRelease!: () => void;
      const phaseEntered = new Promise<void>((resolve) => { phaseEnter = resolve; });
      const phaseHeld = new Promise<void>((resolve) => { phaseRelease = resolve; });
      let restorePhase = () => {};
      if (mode === "term-revalidate") {
        const acl = await import("../proxy/acl.js");
        const originalCheck = acl.check;
        let checks = 0;
        const intercepted = vi.spyOn(acl, "check").mockImplementation(async (...args) => {
          const result = await originalCheck(...args);
          if (args[1] === "lucy_query" && ++checks === 2) { phaseEnter(); await phaseHeld; }
          return result;
        });
        restorePhase = () => intercepted.mockRestore();
      }
      if (mode === "disconnect-before-dispatch" || mode === "term-before-dispatch") {
        const hive = await import("../hive/proxy-hook.js");
        const resolveRoute = hive.resolveAndMaybeServeHiveTool;
        const intercepted = vi.spyOn(hive, "resolveAndMaybeServeHiveTool").mockImplementation(async (...args) => {
          const result = await resolveRoute(...args); // A real non-Hive routing/config lookup.
          phaseEnter(); await phaseHeld; return result;
        });
        restorePhase = () => intercepted.mockRestore();
      }
      drain.markProcessServing();
      const { server, host } = buildProxy();
      await new Promise<void>((resolve) => server.listen(0, host, resolve));
      let serverClientClosed!: () => void;
      const actualServerClose = new Promise<void>((resolve) => { serverClientClosed = resolve; });
      server.on("request", (_request, response) => response.once("close", serverClientClosed));
      let enter!: () => void;
      const entered = new Promise<void>((resolve) => { enter = resolve; });
      const spy = vi.spyOn(console, "info").mockImplementation((prefix, raw) => {
        if (prefix === "[lucy-semantic-write]" && JSON.parse(raw).event === "read_wait_begin") enter();
      });
      let release!: () => void;
      const held = new Promise<void>((resolve) => { release = resolve; });
      let ready!: () => void;
      const prepared = new Promise<void>((resolve) => { ready = resolve; });
      const target = "semantic-layer/zijin/_schema/finance.yaml";
      const original = await readFile(path.join(projectRoot, target), "utf8");
      const candidate = mode === "catalog-refresh"
        ? original.replace("    table: finance.other_funds\n", "    table: finance.other_funds\n    columns: [campaign_id]\n")
        : original;
      const writer = coordinator.withPublishCoordinator("manifest_upload", async () => {
        let stage!: ReturnType<typeof coordinator.registerPublishWriteStage>;
        const wal = await journal.createRecoveryJournal(projectRoot, {
          releaseId: "http-live", operationId: "http-live", actor: "admin", instanceId: "synthetic",
          targets: [{ targetPath: target, identity: { connectionId: "zijin", schema: "finance", table: "finance" }, newContent: candidate }],
          onBeforePersist: (value) => {
            stage = coordinator.registerPublishWriteStage(coordinator.currentProcessPublishHolder()!, { projectRoot, journal: value });
          }
        });
        ready(); await held;
        await writeFile(path.join(projectRoot, target), candidate);
        await journal.markRecoveryJournalFilesSaved(projectRoot, wal.journalId);
        stage.filesSaved();
      }, { projectRoot });
      await prepared;
      const tool = mode.startsWith("lucy_") ? mode : "lucy_query";
      const toolArguments = { connectionId: "zijin", sourceName: "funds",
        ...(tool === "lucy_read_source" ? {} : { measures: ["funds.fund_count"] }),
        ...(mode === "catalog-refresh" ? { dimensions: [{ field: "campaign_id" }] } : {}) };
      const id = "write-wait-" + mode;
      const controller = new AbortController();
      const request = fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`, {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}`, "x-lucy-session-id": id },
        signal: controller.signal,
        body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name: tool,
          arguments: toolArguments } })
      }).then(async (response) => ({ status: response.status, body: await response.json() }));
      try {
        await Promise.race([entered, request.then((response) => { throw new Error("response before actual write wait: " + JSON.stringify(response)); })]);
        expect(businessCalls).toBe(0);
        if (mode === "revoke") {
          await (await import("../proxy/authorization-barrier.js")).narrowAuthorization({ kind: "all" });
          const response = await request;
          expect(response.status).toBe(403);
          expect(JSON.stringify(response.body)).toContain("authorization_revoked");
        } else if (mode === "term") {
          const shutdown = drain.beginInstanceShutdown({ drainBudgetMs: 1000 });
          const response = await request;
          expect(response.status).toBe(503);
          expect(response.body).toMatchObject({ error: { code: "SERVICE_DRAINING" } });
          await shutdown;
        } else if (mode === "term-revalidate" || mode === "term-before-dispatch") {
          release(); await writer; await phaseEntered;
          const shutdown = drain.beginInstanceShutdown({ drainBudgetMs: 1000 });
          phaseRelease();
          const response = await request;
          expect(response.status).toBe(503);
          expect(response.body).toMatchObject({ error: { code: "SERVICE_DRAINING" } });
          await shutdown; expect(businessCalls).toBe(0);
        } else if (mode === "disconnect" || mode === "disconnect-before-dispatch") {
          if (mode === "disconnect-before-dispatch") { release(); await writer; await phaseEntered; }
          controller.abort();
          await expect(request).rejects.toThrow();
          await actualServerClose;
          phaseRelease();
          const deadline = Date.now() + 1000;
          while (drain.processDrainInFlightCount() > 0 && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          expect(drain.processDrainInFlightCount()).toBe(0);
          expect(businessCalls).toBe(0);
          expect((await journal.listOpenRecoveryJournals(projectRoot))[0]?.phase)
            .toBe(mode === "disconnect" ? "write_in_progress" : "files_saved");
        } else if (mode === "catalog-refresh") {
          release(); await writer;
          const fresh = await guardApi.loadAmbiguityCatalogFromDir(path.join(projectRoot, "semantic-layer"));
          const stale = await guardApi.loadPublishedAmbiguityCatalog();
          expect(stale.sources.map((source) => source.sourceName)).toEqual(["funds"]);
          expect(new Set(fresh.sources.map((source) => source.sourceName))).toEqual(new Set(["funds", "other_funds"]));
          expect(guardApi.applyLucyCallGuard({ toolName: "lucy_query", args: toolArguments,
            readableSourceNames: new Set(["*"]), catalog: stale }).action).toBe("allow");
          expect(guardApi.applyLucyCallGuard({ toolName: "lucy_query", args: toolArguments,
            readableSourceNames: new Set(["*"]), catalog: fresh })).toMatchObject({ action: "stop", reason: "ambiguous_field" });
          const response = await request;
          expect(response.status).toBe(200);
          expect(response.body.result.isError).toBe(true);
          expect(JSON.parse(response.body.result.content[0].text).code).toBe("ambiguous_field");
          expect(businessCalls).toBe(0);
          const auditRow = await waitForAuditRow(id);
          expect(auditRow.decision_reason).toBe("ambiguous_field");
          const db = new Database(auditDbPath, { readonly: true });
          try {
            expect(db.prepare("SELECT calls,attempts FROM question_budget_state WHERE scope_key LIKE ?").get("%:" + id))
              .toMatchObject({ calls: 1, attempts: 1 });
            expect(db.prepare("SELECT count(*) AS n FROM access_log WHERE request_id=?").get(id)).toMatchObject({ n: 1 });
          } finally { db.close(); }
        } else {
          release(); await writer;
          const response = await request;
          expect(response.status).toBe(200);
          expect(response.body.result.isError).not.toBe(true);
          const text = response.body.result.content[0].text;
          if (mode === "lucy_query") { expect(JSON.parse(text).rows).toEqual([[4, "100"]]); expect(businessCalls).toBe(1); }
          if (mode === "lucy_read_source") { expect(text).toContain("finance.funds"); expect(businessCalls).toBe(0); }
          if (mode === "lucy_explain_query") { expect(JSON.parse(text)).toMatchObject({ executionMode: "plan_only", executed: false }); expect(businessCalls).toBe(0); }
          const auditRow = await waitForAuditRow(id);
          expect(auditRow.outcome).toBe("ok");
          const db = new Database(auditDbPath, { readonly: true });
          try {
            const budget = db.prepare("SELECT calls,attempts FROM question_budget_state WHERE scope_key LIKE ?").get("%:" + id) as { calls: number; attempts: number };
            expect(budget).toMatchObject({ calls: 1, attempts: 1 });
            expect(db.prepare("SELECT count(*) AS n FROM access_log WHERE request_id=?").get(id)).toMatchObject({ n: 1 });
          } finally { db.close(); }
        }
        if (mode === "revoke" || mode === "term") expect(businessCalls).toBe(0);
      } finally {
        phaseRelease(); release(); await writer; await request.catch(() => undefined);
        restorePhase(); spy.mockRestore(); drain.resetProcessDrainForTests();
        server.closeAllConnections(); upstream.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await new Promise<void>((resolve) => upstream.close(() => resolve()));
      }
    }
  );

  it("P1-70 keeps initial WAL persistence failure closed after the real owner was registered", async () => {
    const events: Record<string, unknown>[] = [];
    const spy = vi.spyOn(console, "info").mockImplementation((prefix, raw) => {
      if (prefix === "[lucy-semantic-write]") events.push(JSON.parse(raw));
    });
    vi.doMock("node:fs/promises", async () => {
      const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
      return { ...actual, writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
        if (String(args[0]).includes("/semantic-recovery-journals/.rj_")) throw new Error("actual WAL publication failure");
        return actual.writeFile(...args);
      } };
    });
    try {
      const { uploadCatalogAsset } = await import("../catalog-assets.js");
      const journals = await import("../semantic-recovery-journal.js");
      await expect(uploadCatalogAsset(projectRoot, {
        connectionId: "zijin", schema: "finance", assetKind: "schema_manifest", filename: "finance.yaml",
        content: "tables:\n  funds:\n    table: finance.funds\n    description: new candidate\n", confirmOverwrite: true
      })).rejects.toThrow("WAL publication failure");
      expect(events.map((event) => event.event)).toEqual(["registered", "failed"]);
      expect(events[1]?.journalId).toBe(events[0]?.journalId);
      expect(await journals.listOpenRecoveryJournals(projectRoot)).toEqual([]);
      expect((await journals.semanticRecoveryReadBlock(projectRoot, []))?.code).toBe("semantic_recovery_unreadable");
      const { readFile } = await import("node:fs/promises");
      expect(await readFile(path.join(projectRoot, "semantic-layer/zijin/_schema/finance.yaml"), "utf8"))
        .not.toContain("new candidate");
      journals.resetSemanticRecoveryAdmissionForTests();
    } finally { spy.mockRestore(); vi.doUnmock("node:fs/promises"); }
  });

  it.each([false, true])("keeps a real MCP RPC registered through drain (client disconnect=%s)", async (disconnect) => {
    // Isolate lifecycle from Spec162's separate cancellation-on-close policy:
    // the accepted upstream stays live after the client disappears.
    process.env.LUCY_QUESTION_BUDGET = "off";
    let start!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => { start = resolve; });
    const pending = new Promise<void>((resolve) => { release = resolve; });
    let calls = 0;
    const upstream = createServer(async (req, res) => {
      await readRequestBody(req);
      calls++;
      start();
      await pending;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: "drain-query", result: { content: [{ type: "text", text: "ok" }] } }));
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    process.env.LUCY_PROXY_UPSTREAM_HOST = "127.0.0.1";
    process.env.LUCY_PROXY_UPSTREAM_PORT = String((upstream.address() as AddressInfo).port);
    const drain = await import("../runtime/process-drain.js");
    const { buildProxy } = await import("../proxy/mcp-proxy");
    drain.markProcessServing();
    const { server, host } = buildProxy();
    await new Promise<void>((resolve) => server.listen(0, host, resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
    const controller = new AbortController();
    const request = () => fetch(url, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: "drain-query", method: "tools/call", params: {
        name: "lucy_query", arguments: { connectionId: "zijin", sourceName: "funds", measures: ["funds.fund_count"] }
      } }), signal: controller.signal
    });
    const response = request().then(async (r) => ({ status: r.status, body: await r.json() }), () => null);
    try {
      await started;
      expect(drain.processDrainInFlightCount()).toBe(1);
      if (disconnect) controller.abort();
      let drained = false;
      const shutdown = drain.beginInstanceShutdown({ drainBudgetMs: 2_000 }).then(() => { drained = true; });
      const rejected = await fetch(url, { method: "POST", body: "{}" });
      expect(rejected.status).toBe(503);
      expect(await rejected.json()).toMatchObject({ error: { code: "SERVICE_DRAINING" } });
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(calls).toBe(1);
      expect(drained).toBe(false);
      expect(drain.processDrainInFlightCount()).toBe(1);
      release();
      const result = await response;
      if (!disconnect) expect(result?.status).toBe(200);
      await shutdown;
      expect(drain.processDrainInFlightCount()).toBe(0);
    } finally {
      release();
      await response;
      drain.resetProcessDrainForTests();
      server.closeAllConnections();
      upstream.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });

  it("classifies a resident-runtime missing connection as execution_config_stale", async () => {
    const upstream = createServer(async (req, res) => {
      await readRequestBody(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id: "stale-query",
        result: {
          isError: true,
          content: [{ type: "text", text: "Connection \"zijin\" is not configured in ktx.yaml." }]
        }
      }));
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    process.env.LUCY_PROXY_UPSTREAM_HOST = "127.0.0.1";
    process.env.LUCY_PROXY_UPSTREAM_PORT = String((upstream.address() as AddressInfo).port);

    const { buildProxy } = await import("../proxy/mcp-proxy");
    const { server, host } = buildProxy();
    await new Promise<void>((resolve) => server.listen(0, host, resolve));
    try {
      const proxyPort = (server.address() as AddressInfo).port;
      const response = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${TOKEN}`
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "stale-query",
          method: "tools/call",
          params: {
            name: "lucy_query",
            arguments: {
              connectionId: "zijin",
              sourceName: "funds",
              measures: ["funds.fund_count"],
              dimensions: [{ field: "funds.fund_id" }]
            }
          }
        })
      });
      expect(response.status).toBe(200);
      const row = await waitForAuditRow("stale-query");
      expect(row.outcome).toBe("error");
      expect(row.decision_reason).toBe("execution_config_stale");

      const state = await import("../mcp-runtime-state");
      const observation = state.getExecutionRuntimeObservation(
        "zijin",
        await state.readKtxYamlDigest(projectRoot)
      );
      expect(observation?.status).toBe("stale");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await new Promise<void>((resolve, reject) => upstream.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("keeps upstream_error when the connection is genuinely absent from disk", async () => {
    await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
    const upstream = createServer(async (req, res) => {
      await readRequestBody(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id: "missing-query",
        result: {
          isError: true,
          content: [{ type: "text", text: "Connection \"zijin\" is not configured in ktx.yaml." }]
        }
      }));
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    process.env.LUCY_PROXY_UPSTREAM_HOST = "127.0.0.1";
    process.env.LUCY_PROXY_UPSTREAM_PORT = String((upstream.address() as AddressInfo).port);

    const { buildProxy } = await import("../proxy/mcp-proxy");
    const { server, host } = buildProxy();
    await new Promise<void>((resolve) => server.listen(0, host, resolve));
    try {
      const proxyPort = (server.address() as AddressInfo).port;
      await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${TOKEN}`
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "missing-query",
          method: "tools/call",
          params: {
            name: "lucy_query",
            arguments: {
              connectionId: "zijin",
              sourceName: "funds",
              measures: ["funds.fund_count"],
              dimensions: [{ field: "funds.fund_id" }]
            }
          }
        })
      });
      const row = await waitForAuditRow("missing-query");
      expect(row.outcome).toBe("error");
      expect(row.decision_reason).toBe("upstream_error");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await new Promise<void>((resolve, reject) => upstream.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("records successful lucy_query evidence for the current config digest", async () => {
    const upstream = createServer(async (req, res) => {
      await readRequestBody(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id: "successful-query",
        result: { content: [{ type: "text", text: JSON.stringify({ rows: [] }) }] }
      }));
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    process.env.LUCY_PROXY_UPSTREAM_HOST = "127.0.0.1";
    process.env.LUCY_PROXY_UPSTREAM_PORT = String((upstream.address() as AddressInfo).port);

    const { buildProxy } = await import("../proxy/mcp-proxy");
    const { server, host } = buildProxy();
    await new Promise<void>((resolve) => server.listen(0, host, resolve));
    try {
      const proxyPort = (server.address() as AddressInfo).port;
      await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${TOKEN}`
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "successful-query",
          method: "tools/call",
          params: {
            name: "lucy_query",
            arguments: {
              connectionId: "zijin",
              sourceName: "funds",
              measures: ["funds.fund_count"],
              dimensions: [{ field: "funds.fund_id" }]
            }
          }
        })
      });
      const row = await waitForAuditRow("successful-query");
      expect(row.outcome).toBe("ok");
      const state = await import("../mcp-runtime-state");
      const observation = state.getExecutionRuntimeObservation(
        "zijin",
        await state.readKtxYamlDigest(projectRoot)
      );
      expect(observation?.status).toBe("ok");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await new Promise<void>((resolve, reject) => upstream.close((error) => error ? reject(error) : resolve()));
    }
  });
});
