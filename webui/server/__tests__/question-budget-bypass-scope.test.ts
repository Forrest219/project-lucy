/**
 * Spec 162 修订 / Plan S6 —— 旁路入口（认证路由 / 报表模板）的预算纳管。
 *
 * 覆盖 SC-35（预算用尽时旁路被拦下、不执行真实查询、不增加次数）、
 * SC-36（一次外部调用记 1 次额度；内部源查询只计时长不重复记次数）、
 * SC-46（源授权失败时不执行查询、不增加次数），
 * 以及 SC-39 的代理层形态（`LUCY_QUESTION_BUDGET=off` 时旁路不受预算约束）。
 *
 * 权威合同：`docs/specs/lucy-20261029-question-budget-window-optimization-spec.md`
 * §6.6（旁路入口的统一记账）与 §7.5。
 */
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TOKEN = "budget-bypass-token";
const SESSION = "sess-bypass";
const ROUTE_ID = "cdn_pnl_weekly";

function tokenHash(token: string): string {
  return "sha256:" + createHash("sha256").update(token).digest("hex");
}

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

const ACCESS_YAML = `users:
  - id: route_agent
    name: Route Agent
    enabled: true
    tokens:
      - hash: "${tokenHash(TOKEN)}"
        label: route-token
        created: 2026-10-30
    allow:
      connections:
        - mysql-aliyun
      tables:
        - dataforai.superstore_orders
      tools:
        - lucy_certified_route
        - lucy_report_template
        - lucy_query
        - lucy_read_source
        - lucy_begin_question
        - lucy_continue_question
defaults:
  deny_tools: []
`;

const SCHEMA_YAML = `tables:
  superstore_orders:
    table: dataforai.superstore_orders
`;

let projectRoot: string;
let previousProjectRoot: string | undefined;
let previousContentRoot: string | undefined;
let previousAuditDb: string | undefined;
let previousInternalToken: string | undefined;
let previousUpstreamHost: string | undefined;
let previousUpstreamPort: string | undefined;
let previousBudget: string | undefined;

async function makeProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "ktx-budget-bypass-"));
  await mkdir(path.join(root, "webui", "config"), { recursive: true });
  await mkdir(path.join(root, "semantic-layer", "mysql-aliyun", "_schema"), { recursive: true });
  await writeFile(path.join(root, "ktx.yaml"), "connections: {}\n", "utf8");
  await writeFile(path.join(root, "webui", "config", "access.yaml"), ACCESS_YAML, "utf8");
  await writeFile(path.join(root, "semantic-layer", "mysql-aliyun", "_schema", "dataforai.yaml"), SCHEMA_YAML, "utf8");
  return root;
}

beforeEach(async () => {
  vi.resetModules();
  projectRoot = await makeProject();
  previousProjectRoot = process.env.KTX_PROJECT_ROOT;
  previousContentRoot = process.env.LUCY_CONTENT_ROOT;
  previousAuditDb = process.env.LUCY_AUDIT_DB;
  previousInternalToken = process.env.KTX_INTERNAL_TOKEN;
  previousUpstreamHost = process.env.LUCY_PROXY_UPSTREAM_HOST;
  previousUpstreamPort = process.env.LUCY_PROXY_UPSTREAM_PORT;
  previousBudget = process.env.LUCY_QUESTION_BUDGET;
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_CONTENT_ROOT = ".";
  process.env.LUCY_AUDIT_DB = path.join(projectRoot, "audit.sqlite");
  process.env.KTX_INTERNAL_TOKEN = "internal-budget-bypass-token";
  process.env.LUCY_PROXY_UPSTREAM_HOST = "127.0.0.1";
});

afterEach(async () => {
  if (previousProjectRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousProjectRoot;
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
  if (previousBudget === undefined) delete process.env.LUCY_QUESTION_BUDGET;
  else process.env.LUCY_QUESTION_BUDGET = previousBudget;
  await rm(projectRoot, { recursive: true, force: true });
});

type Harness = {
  proxyPort: number;
  upstreamCalls: Array<{ body: string }>;
  close: () => Promise<void>;
  callRoute: (routeId: string) => Promise<{ status: number; body: Record<string, unknown> }>;
  scopeKey: string;
  budgetCalls: () => number;
  budgetBusyMs: () => number;
};

async function withHarness(run: (harness: Harness) => Promise<void>): Promise<void> {
  const upstreamCalls: Array<{ body: string }> = [];
  const upstream = createServer(async (req, res) => {
    const body = await readRequestBody(req);
    upstreamCalls.push({ body });
    const parsed = JSON.parse(body || "{}") as { id?: string | number; method?: string };
    if (parsed.method === "initialize") {
      res.writeHead(200, { "content-type": "application/json", "mcp-session-id": "upstream-session" });
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id: parsed.id,
        result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "ktx-fake", version: "0.0.0" } }
      }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      jsonrpc: "2.0",
      id: parsed.id,
      result: { content: [{ type: "text", text: JSON.stringify({ rows: [{ revenue: 1 }] }) }] }
    }));
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  process.env.LUCY_PROXY_UPSTREAM_PORT = String((upstream.address() as AddressInfo).port);

  const { registerCertifiedRoute } = await import("../proxy/certified-route.js");
  registerCertifiedRoute({
    routeId: ROUTE_ID,
    source: "superstore_orders",
    query: {
      connectionId: "mysql-aliyun",
      measures: ["superstore_orders.revenue"],
      dimensions: [{ field: "superstore_orders.month" }]
    },
    version: "2026Q3"
  });

  const { buildProxy } = await import("../proxy/mcp-proxy.js");
  const { questionBudget, budgetIdentityKey, budgetScopeKey } = await import("../proxy/question-experience.js");
  const { server, host } = buildProxy();
  await new Promise<void>((resolve) => server.listen(0, host, resolve));
  const proxyPort = (server.address() as AddressInfo).port;
  const scopeKey = budgetScopeKey(budgetIdentityKey("route_agent", tokenHash(TOKEN).slice(0, 19)), SESSION);

  const callRoute = async (routeId: string) => {
    const res = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${TOKEN}`,
        "x-lucy-session-id": SESSION
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: `bypass-${routeId}-${upstreamCalls.length}`,
        method: "tools/call",
        params: { name: "lucy_certified_route", arguments: { routeId, connectionId: "mysql-aliyun" } }
      })
    });
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  };

  try {
    await run({
      proxyPort,
      upstreamCalls,
      scopeKey,
      close: async () => {
        await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
        await new Promise<void>((resolve, reject) => upstream.close((err) => err ? reject(err) : resolve()));
      },
      callRoute,
      budgetCalls: () => questionBudget.snapshotScope(scopeKey)?.calls ?? 0,
      budgetBusyMs: () => questionBudget.snapshotScope(scopeKey)?.busyMs ?? 0
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    await new Promise<void>((resolve, reject) => upstream.close((err) => err ? reject(err) : resolve()));
  }
}

/** 把该作用域的额度用尽（20 次数据调用上限）。 */
async function exhaustBudget(scopeKey: string): Promise<void> {
  const { questionBudget, budgetIdentityKey } = await import("../proxy/question-experience.js");
  const identityKey = budgetIdentityKey("route_agent", tokenHash(TOKEN).slice(0, 19));
  for (let i = 0; i < 20; i += 1) {
    const decision = await questionBudget.consumePersisted(undefined, Date.now(), undefined, undefined, {
      identityKey,
      sessionId: SESSION,
      canContinue: true
    });
    expect(decision.action).toBe("allow");
    if (decision.action === "allow" && decision.ticket) {
      await questionBudget.settle(decision.ticket, decision.ticket.startMonoMs);
    }
  }
  expect(questionBudget.snapshotScope(scopeKey)?.calls).toBe(20);
}

describe("question budget bypass scope", () => {
  it("SC-36 charges one unit for a certified route and counts the internal query time only once", async () => {
    await withHarness(async (harness) => {
      const result = await harness.callRoute(ROUTE_ID);
      expect(result.status).toBe(200);
      expect(JSON.stringify(result.body)).toContain(ROUTE_ID);
      // 一次外部调用 = 1 次额度；内部源查询不重复记次数。
      expect(harness.budgetCalls()).toBe(1);
      // 内部查询的时长计入 busyMs（封顶 120 秒）。
      expect(harness.budgetBusyMs()).toBeGreaterThanOrEqual(0);
      expect(harness.budgetBusyMs()).toBeLessThan(120_000);
      expect(harness.upstreamCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("SC-35 blocks the certified route once the budget is spent without running the query", async () => {
    await withHarness(async (harness) => {
      await exhaustBudget(harness.scopeKey);
      const upstreamBefore = harness.upstreamCalls.length;
      const result = await harness.callRoute(ROUTE_ID);
      expect(result.status).toBe(200);
      expect(JSON.stringify(result.body)).toContain("question_budget_exhausted");
      // 没有执行真实查询，也没有增加次数。
      expect(harness.upstreamCalls.length).toBe(upstreamBefore);
      expect(harness.budgetCalls()).toBe(20);
    });
  });

  it("SC-46 refuses a route whose source the role cannot read without charging the budget", async () => {
    await withHarness(async (harness) => {
      const { registerCertifiedRoute } = await import("../proxy/certified-route.js");
      registerCertifiedRoute({
        routeId: "forbidden_route",
        source: "kx_fact_financial_amount",
        query: {
          connectionId: "mysql-aliyun",
          measures: ["kx_fact_financial_amount.amount"]
        }
      });
      const upstreamBefore = harness.upstreamCalls.length;
      const result = await harness.callRoute("forbidden_route");
      expect(result.status).toBe(200);
      expect(JSON.stringify(result.body)).toContain("explicit_table_required");
      expect(harness.upstreamCalls.length).toBe(upstreamBefore);
      expect(harness.budgetCalls()).toBe(0);
    });
  });

  it("SC-39 keeps the bypass entry working when the budget is switched off", async () => {
    process.env.LUCY_QUESTION_BUDGET = "off";
    await withHarness(async (harness) => {
      const result = await harness.callRoute(ROUTE_ID);
      expect(result.status).toBe(200);
      expect(JSON.stringify(result.body)).toContain(ROUTE_ID);
      // 预算关闭：既不记次数，也不产生预算状态行。
      expect(harness.budgetCalls()).toBe(0);
      expect(harness.upstreamCalls.length).toBeGreaterThanOrEqual(1);
    });
  });
});
