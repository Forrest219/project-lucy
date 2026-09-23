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
    "LUCY_PROXY_UPSTREAM_PORT"
  ]) previousEnv[key] = process.env[key];
  process.env.KTX_PROJECT_ROOT = projectRoot;
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
        result: { content: [{ type: "text", text: "[]" }] }
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
