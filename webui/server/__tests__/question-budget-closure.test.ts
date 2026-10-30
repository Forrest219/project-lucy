import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bindQuestionBudgetSettlement,
  type BudgetSettleFlags
} from "../proxy/question-budget-lifecycle.js";

/**
 * 收口方案 R1 / R2。
 * SC-13 的时钟差锁在结算绑定上：res.close 不结算、不清绝对时限定时器，
 * 取消确认（上游 close）才按当时的单调时钟记账。
 * 另有一条真实代理 + 假上游的 MCP 调用，证明断开后在途槽会释放。
 * SC-09 走真实 MCP：协议方法、lucy_catalog、lucy_skill_search、ACL 拒绝都不累计。
 */

type SettleCall = { end: number; flags?: BudgetSettleFlags };

function fakeUpstream() {
  const emitter = new EventEmitter() as EventEmitter & {
    destroyed: boolean;
    destroy: (error?: Error) => void;
  };
  emitter.destroyed = false;
  emitter.destroy = () => {
    emitter.destroyed = true;
  };
  return emitter;
}

function fakeResponse() {
  return new EventEmitter() as EventEmitter & Pick<ServerResponse, "once">;
}

describe("SC-13 settlement waits for cancel confirmation", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("SC-13 res.close does not settle or clear the deadline; confirmation 200ms later uses that clock", async () => {
    vi.useFakeTimers();
    let now = 5_000;
    const settles: SettleCall[] = [];
    const upstream = fakeUpstream();
    upstream.destroy = () => {
      upstream.destroyed = true;
      setTimeout(() => upstream.emit("close"), 200);
    };
    const res = fakeResponse();
    bindQuestionBudgetSettlement({
      res,
      getUpstream: () => upstream,
      now: () => now,
      startMonoMs: 0,
      absMs: 120_000,
      settle: (end, flags) => settles.push({ end, flags }),
      onDisconnected: () => undefined,
      onDeadline: () => undefined
    });

    res.emit("close");
    expect(settles).toEqual([]);
    await vi.advanceTimersByTimeAsync(199);
    expect(settles).toEqual([]);
    now = 25_000;
    await vi.advanceTimersByTimeAsync(1);
    expect(settles).toEqual([{ end: 25_000, flags: { clientDisconnected: true } }]);
  });

  it("SC-13 an unconfirmed cancel still settles at the absolute deadline", async () => {
    vi.useFakeTimers();
    const settles: SettleCall[] = [];
    const upstream = fakeUpstream();
    const res = fakeResponse();
    bindQuestionBudgetSettlement({
      res,
      getUpstream: () => upstream,
      now: () => 0,
      startMonoMs: 1_000,
      absMs: 120_000,
      settle: (end, flags) => settles.push({ end, flags }),
      onDisconnected: () => undefined,
      onDeadline: (handle) => handle?.destroy(new Error("absolute_execution_deadline"))
    });

    res.emit("close");
    expect(upstream.destroyed).toBe(true);
    expect(settles).toEqual([]);
    await vi.advanceTimersByTimeAsync(119_000);
    expect(settles).toEqual([]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(settles).toEqual([{ end: 121_000, flags: { timeoutUnconfirmed: true } }]);
  });

  it("SC-13 a normal finish settles once and a later close does not add time", () => {
    const settles: SettleCall[] = [];
    const res = fakeResponse();
    bindQuestionBudgetSettlement({
      res,
      getUpstream: () => null,
      now: () => 4_000,
      startMonoMs: 1_000,
      absMs: 120_000,
      settle: (end, flags) => settles.push({ end, flags }),
      onDisconnected: () => undefined,
      onDeadline: () => undefined
    });
    res.emit("finish");
    res.emit("close");
    expect(settles).toEqual([{ end: 4_000, flags: undefined }]);
  });
});

describe("SC-13 and SC-09 over the proxy", () => {
  const TOKEN = "budget-closure-token";
  const SESSION = "sess-closure";

  function tokenHash(token: string): string {
    return "sha256:" + createHash("sha256").update(token).digest("hex");
  }

  const ACCESS_YAML = `users:
  - id: closure_agent
    name: Closure Agent
    enabled: true
    tokens:
      - hash: "${tokenHash(TOKEN)}"
        label: closure-token
        created: 2026-10-30
    allow:
      connections:
        - mysql-aliyun
      tables:
        - dataforai.superstore_orders
      tools:
        - lucy_read_source
        - lucy_catalog
        - lucy_skill_search
        - resources/list
defaults:
  deny_tools: []
`;

  let projectRoot = "";
  let previousEnv: Record<string, string | undefined> = {};

  afterEach(async () => {
    for (const [key, value] of Object.entries(previousEnv ?? {})) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (projectRoot) await rm(projectRoot, { recursive: true, force: true });
  });

  async function prepare() {
    vi.resetModules();
    projectRoot = await mkdtemp(path.join(os.tmpdir(), "ktx-budget-closure-"));
    await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
    await mkdir(path.join(projectRoot, "semantic-layer", "mysql-aliyun", "_schema"), { recursive: true });
    await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
    await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), ACCESS_YAML, "utf8");
    await writeFile(
      path.join(projectRoot, "semantic-layer", "mysql-aliyun", "_schema", "dataforai.yaml"),
      "tables:\n  superstore_orders:\n    table: dataforai.superstore_orders\n",
      "utf8"
    );
    previousEnv = {
      KTX_PROJECT_ROOT: process.env.KTX_PROJECT_ROOT,
      LUCY_CONTENT_ROOT: process.env.LUCY_CONTENT_ROOT,
      LUCY_AUDIT_DB: process.env.LUCY_AUDIT_DB,
      KTX_INTERNAL_TOKEN: process.env.KTX_INTERNAL_TOKEN,
      LUCY_PROXY_UPSTREAM_HOST: process.env.LUCY_PROXY_UPSTREAM_HOST,
      LUCY_PROXY_UPSTREAM_PORT: process.env.LUCY_PROXY_UPSTREAM_PORT,
      LUCY_QUESTION_BUDGET_WALL_MODE: process.env.LUCY_QUESTION_BUDGET_WALL_MODE,
      LUCY_QUESTION_BUDGET_SCOPE: process.env.LUCY_QUESTION_BUDGET_SCOPE
    };
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    process.env.LUCY_AUDIT_DB = path.join(projectRoot, "audit.sqlite");
    process.env.KTX_INTERNAL_TOKEN = "internal-budget-closure-token";
    process.env.LUCY_PROXY_UPSTREAM_HOST = "127.0.0.1";
    process.env.LUCY_QUESTION_BUDGET_WALL_MODE = "settled";
    process.env.LUCY_QUESTION_BUDGET_SCOPE = "stable";
  }

  function readBody(req: IncomingMessage): Promise<string> {
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

  async function startUpstream(hold: boolean): Promise<{ port: number; received: Promise<void>; body: () => string; close: () => Promise<void> }> {
    let markReceived: () => void = () => undefined;
    let seenBody = "";
    const received = new Promise<void>((resolve) => {
      markReceived = resolve;
    });
    const upstream = createServer(async (req, res) => {
      seenBody = await readBody(req);
      markReceived();
      if (hold) return;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: { content: [{ type: "text", text: "{}" }] }
      }));
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    return {
      port: (upstream.address() as AddressInfo).port,
      received,
      body: () => seenBody,
      close: () => new Promise<void>((resolve) => {
        upstream.closeAllConnections?.();
        upstream.close(() => resolve());
      })
    };
  }

  async function startProxy(): Promise<{ port: number; close: () => Promise<void> }> {
    const { buildProxy } = await import("../proxy/mcp-proxy.js");
    const { server, host } = buildProxy();
    await new Promise<void>((resolve) => server.listen(0, host, resolve));
    return {
      port: (server.address() as AddressInfo).port,
      close: () => new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      })
    };
  }

  function post(port: number, method: string, params?: unknown): Promise<string> {
    return fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${TOKEN}`,
        "x-lucy-session-id": SESSION
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: method, method, params })
    }).then((res) => res.text());
  }

  it("SC-13 aborts an in-flight data call and settles only after the upstream closes", async () => {
    await prepare();
    const upstream = await startUpstream(true);
    process.env.LUCY_PROXY_UPSTREAM_PORT = String(upstream.port);
    const proxy = await startProxy();
    const budget = await import("../proxy/question-experience.js");
    const scopeKey = budget.budgetScopeKey(
      budget.budgetIdentityKey("closure_agent", tokenHash(TOKEN).slice(0, 19)),
      SESSION
    );
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: "read-abort",
      method: "tools/call",
      params: {
        name: "lucy_read_source",
        arguments: { connectionId: "mysql-aliyun", sourceName: "superstore_orders" }
      }
    });
    try {
      const client = httpRequest({
        hostname: "127.0.0.1",
        port: proxy.port,
        path: "/mcp",
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${TOKEN}`,
          "x-lucy-session-id": SESSION,
          "content-length": Buffer.byteLength(body)
        }
      });
      client.on("error", () => undefined);
      client.end(body);
      await Promise.race([
        upstream.received,
        new Promise((_, reject) => setTimeout(() => reject(new Error("upstream did not receive the data call")), 2_000))
      ]);
      const inFlight = budget.questionBudget.snapshotScope(scopeKey);
      expect(inFlight?.calls).toBe(1);
      expect(inFlight?.currentConcurrency).toBe(1);
      expect(inFlight?.busyMs).toBe(0);
      client.destroy();
      await vi.waitFor(() => {
        expect(budget.questionBudget.snapshotScope(scopeKey)?.currentConcurrency).toBe(0);
      }, { timeout: 5_000 });
      const state = budget.questionBudget.snapshotScope(scopeKey);
      expect(state?.calls).toBe(1);
      expect(state?.busyMs).toBeGreaterThanOrEqual(0);
    } finally {
      await proxy.close();
      await upstream.close();
    }
  }, 20_000);

  it("SC-09 protocol, catalog, skill search, and an ACL denial do not charge or reset the window", async () => {
    await prepare();
    const upstream = await startUpstream(false);
    process.env.LUCY_PROXY_UPSTREAM_PORT = String(upstream.port);
    const proxy = await startProxy();
    const budget = await import("../proxy/question-experience.js");
    const scopeKey = budget.budgetScopeKey(
      budget.budgetIdentityKey("closure_agent", tokenHash(TOKEN).slice(0, 19)),
      SESSION
    );
    try {
      await post(proxy.port, "resources/list");
      await post(proxy.port, "tools/call", { name: "lucy_catalog", arguments: {} });
      await post(proxy.port, "tools/call", { name: "lucy_skill_search", arguments: { query: "利润" } });
      const denied = await post(proxy.port, "tools/call", {
        name: "lucy_read_source",
        arguments: { connectionId: "mysql-aliyun", sourceName: "superstore_people" }
      });
      expect(denied).toContain("Access denied");
      expect(budget.questionBudget.snapshotScope(scopeKey)?.calls ?? 0).toBe(0);
      expect(budget.questionBudget.snapshotScope(scopeKey)?.busyMs ?? 0).toBe(0);

      await post(proxy.port, "tools/call", {
        name: "lucy_read_source",
        arguments: { connectionId: "mysql-aliyun", sourceName: "superstore_orders" }
      });
      const opened = budget.questionBudget.snapshotScope(scopeKey);
      expect(opened?.calls).toBe(1);
      const windowId = opened?.windowId;
      const round = opened?.round;

      await post(proxy.port, "tools/call", {
        name: "lucy_read_source",
        arguments: { connectionId: "mysql-aliyun", sourceName: "superstore_orders" }
      });
      await post(proxy.port, "tools/call", {
        name: "lucy_read_source",
        arguments: { connectionId: "mysql-aliyun", sourceName: "superstore_orders" }
      });
      const beforeDeny = budget.questionBudget.snapshotScope(scopeKey);
      expect(beforeDeny?.calls).toBe(3);

      await post(proxy.port, "tools/call", {
        name: "lucy_read_source",
        arguments: { connectionId: "mysql-aliyun", sourceName: "superstore_people" }
      });
      const afterDeny = budget.questionBudget.snapshotScope(scopeKey);
      expect(afterDeny?.calls).toBe(3);
      expect(afterDeny?.windowId).toBe(windowId);
      expect(afterDeny?.round).toBe(round);
      expect(afterDeny?.busyMs).toBe(beforeDeny?.busyMs);
    } finally {
      await proxy.close();
      await upstream.close();
    }
  });
});
