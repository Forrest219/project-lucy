/**
 * L25-16 — 控制面工具接入 MCP 调用链（W-A 第 1 项）。
 *
 * 覆盖：
 * - **控制面工具由代理本地服务**：`lucy_ops_*` 的 `tools/call` 绝不转发给 KTX
 *   （KTX 不认识这些工具），响应来自代理本地信封。
 * - **未登记工具仍 fail-closed**：登记表之外的 `lucy_ops_*`（例如 W-B 的
 *   `lucy_ops_semantic_publish`）在 ACL 阶段就被拒（`tool_unclassified:`），
 *   既不本地执行也不转发上游。
 * - **可见性只由 `allow.ops` 决定**：`tools/list` 只暴露被授权的控制面工具。
 */

import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const OPS_TOKEN = "ops-wiring-token";
const PLAIN_TOKEN = "plain-wiring-token";
const INTERNAL_TOKEN = "ops-wiring-internal-token";

function tokenHash(token: string): string {
  return "sha256:" + createHash("sha256").update(token).digest("hex");
}

const ACCESS_YAML = `roles:
  ops_wiring:
    description: control plane role
    allow:
      ops:
        - tools:
            - lucy_ops_connection_tables
          asset_kinds:
            - governance
          connections:
            - conn_a
  plain_role:
    description: data plane only
    allow:
      tools:
        - lucy_catalog
users:
  - id: ops_agent
    name: Ops Agent
    enabled: true
    roles:
      - ops_wiring
    tokens:
      - hash: "${tokenHash(OPS_TOKEN)}"
        label: ops-wiring-token
        created: 2026-10-29
  - id: plain_agent
    name: Plain Agent
    enabled: true
    roles:
      - plain_role
    tokens:
      - hash: "${tokenHash(PLAIN_TOKEN)}"
        label: plain-wiring-token
        created: 2026-10-29
defaults:
  deny_tools: []
  known_tools:
    - lucy_catalog
  table_touching_tools: []
  sensitive_metadata_tools: []
  sensitive_table_prefixes: []
`;

const KTX_YAML = `connections:
  conn_a:
    driver: duckdb
    schemas:
      - s1
    enabled_tables:
      - s1.orders
`;

let projectRoot: string;
let previousRoot: string | undefined;
let previousContentRoot: string | undefined;
let previousAuditDb: string | undefined;
let previousInternalToken: string | undefined;
let previousUpstreamHost: string | undefined;
let previousUpstreamPort: string | undefined;

beforeEach(async () => {
  vi.resetModules();
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "ktx-ops-wiring-"));
  await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
  await mkdir(path.join(projectRoot, "semantic-layer", "conn_a", "_schema"), { recursive: true });
  await writeFile(path.join(projectRoot, "ktx.yaml"), KTX_YAML, "utf8");
  await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), ACCESS_YAML, "utf8");
  await writeFile(
    path.join(projectRoot, "semantic-layer", "conn_a", "_schema", "s1.yaml"),
    "tables:\n  orders:\n    table: orders\n    columns:\n      - name: id\n        type: integer\n",
    "utf8"
  );
  previousRoot = process.env.KTX_PROJECT_ROOT;
  previousContentRoot = process.env.LUCY_CONTENT_ROOT;
  previousAuditDb = process.env.LUCY_AUDIT_DB;
  previousInternalToken = process.env.KTX_INTERNAL_TOKEN;
  previousUpstreamHost = process.env.LUCY_PROXY_UPSTREAM_HOST;
  previousUpstreamPort = process.env.LUCY_PROXY_UPSTREAM_PORT;
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_CONTENT_ROOT = projectRoot;
  process.env.LUCY_AUDIT_DB = path.join(projectRoot, ".ktx-ui", "audit.sqlite");
  process.env.KTX_INTERNAL_TOKEN = INTERNAL_TOKEN;
});

afterEach(async () => {
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  if (previousContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = previousContentRoot;
  if (previousAuditDb === undefined) delete process.env.LUCY_AUDIT_DB;
  else process.env.LUCY_AUDIT_DB = previousAuditDb;
  if (previousInternalToken === undefined) delete process.env.KTX_INTERNAL_TOKEN;
  else process.env.KTX_INTERNAL_TOKEN = previousInternalToken;
  if (previousUpstreamHost === undefined) delete process.env.LUCY_PROXY_UPSTREAM_HOST;
  else process.env.LUCY_PROXY_UPSTREAM_HOST = previousUpstreamHost;
  if (previousUpstreamPort === undefined) delete process.env.LUCY_PROXY_UPSTREAM_PORT;
  else process.env.LUCY_PROXY_UPSTREAM_PORT = previousUpstreamPort;
  await rm(projectRoot, { recursive: true, force: true });
});

interface Harness {
  proxyUrl: string;
  upstreamBodies: string[];
  close: () => Promise<void>;
}

async function startHarness(): Promise<Harness> {
  const upstreamBodies: string[] = [];
  const upstream = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    upstreamBodies.push(Buffer.concat(chunks).toString("utf8"));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      jsonrpc: "2.0",
      id: "upstream",
      result: { tools: [{ name: "lucy_catalog", description: "upstream catalog" }] }
    }));
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const upstreamPort = (upstream.address() as AddressInfo).port;
  process.env.LUCY_PROXY_UPSTREAM_HOST = "127.0.0.1";
  process.env.LUCY_PROXY_UPSTREAM_PORT = String(upstreamPort);

  const { buildProxy } = await import("../proxy/mcp-proxy");
  const { server, host } = buildProxy();
  await new Promise<void>((resolve) => server.listen(0, host, resolve));
  const proxyPort = (server.address() as AddressInfo).port;

  return {
    proxyUrl: `http://127.0.0.1:${proxyPort}/mcp`,
    upstreamBodies,
    close: async () => {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
      await new Promise<void>((resolve, reject) => upstream.close((err) => (err ? reject(err) : resolve())));
    }
  };
}

async function callTool(
  harness: Harness,
  token: string,
  name: string,
  args: Record<string, unknown>
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(harness.proxyUrl, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `call-${name}`,
      method: "tools/call",
      params: { name, arguments: args }
    })
  });
  const body = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body };
}

describe("L25-16 控制面工具接入 MCP 调用链", () => {
  it("lucy_ops_connection_tables 由代理本地服务，绝不转发给 KTX 上游", async () => {
    const harness = await startHarness();
    try {
      const { status, body } = await callTool(harness, OPS_TOKEN, "lucy_ops_connection_tables", {
        targets: [{ connectionId: "conn_a", enabledTables: ["s1.orders"] }],
        dry_run: true
      });

      expect(status).toBe(200);
      const result = body.result as Record<string, unknown>;
      expect(result.isError).toBeUndefined();
      const data = result.data as Record<string, unknown>;
      // 本地信封：preview 模式 + 计划 id + 确认摘要。
      expect(data.mode).toBe("preview");
      expect(typeof data.plan_id).toBe("string");
      expect(typeof data.confirm_digest).toBe("string");
      // 上游一次都没有被调用。
      expect(harness.upstreamBodies).toHaveLength(0);
    } finally {
      await harness.close();
    }
  });

  it("未登记的 lucy_ops_* 工具 fail-closed：既不本地执行也不转发上游", async () => {
    const harness = await startHarness();
    try {
      const { status, body } = await callTool(harness, OPS_TOKEN, "lucy_ops_semantic_publish", {
        targets: [{ connectionId: "conn_a" }]
      });

      // ACL 拒绝走 JSON-RPC 的 `isError` 通道（HTTP 200 + result.isError）。
      expect(status).toBe(200);
      const result = body.result as Record<string, unknown>;
      expect(result.isError).toBe(true);
      const content = result.content as Array<{ text?: string }>;
      expect(String(content[0]?.text ?? "")).toContain("tool_unclassified:lucy_ops_semantic_publish");
      expect(harness.upstreamBodies).toHaveLength(0);
    } finally {
      await harness.close();
    }
  });

  it("未授予 allow.ops 的调用者调不动控制面工具（fail-closed）", async () => {
    const harness = await startHarness();
    try {
      const { status, body } = await callTool(harness, PLAIN_TOKEN, "lucy_ops_connection_tables", {
        targets: [{ connectionId: "conn_a", enabledTables: ["s1.orders"] }],
        dry_run: true
      });

      expect(status).toBe(200);
      const result = body.result as Record<string, unknown>;
      expect(result.isError).toBe(true);
      const content = result.content as Array<{ text?: string }>;
      expect(String(content[0]?.text ?? "")).toContain("ops_not_granted:lucy_ops_connection_tables");
      expect(harness.upstreamBodies).toHaveLength(0);
    } finally {
      await harness.close();
    }
  });

  it("tools/list 只暴露被 allow.ops 授权的控制面工具", async () => {
    const harness = await startHarness();
    try {
      const listTools = async (token: string): Promise<string[]> => {
        const res = await fetch(harness.proxyUrl, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ jsonrpc: "2.0", id: "list", method: "tools/list", params: {} })
        });
        const body = (await res.json()) as Record<string, unknown>;
        const result = body.result as { tools?: Array<{ name?: string }> };
        return (result.tools ?? []).map((tool) => String(tool.name));
      };

      const opsTools = await listTools(OPS_TOKEN);
      expect(opsTools).toContain("lucy_ops_connection_tables");
      // 未授予的工具不出现。
      expect(opsTools).not.toContain("lucy_ops_source_import");

      const plainTools = await listTools(PLAIN_TOKEN);
      expect(plainTools).not.toContain("lucy_ops_connection_tables");
      expect(plainTools).not.toContain("lucy_ops_source_import");
    } finally {
      await harness.close();
    }
  });
});
