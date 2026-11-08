/**
 * P0-1 问题类型口径绑定 —— Proxy 端到端夹具。
 *
 * 覆盖 Spec v0.9 的 SC-02／SC-03／SC-05／SC-07／SC-08／SC-09／SC-10／SC-12／
 * SC-13／SC-15／SC-15b／SC-17a／SC-17b／SC-21／SC-25／SC-27／SC-28。
 *
 * 关键证据：**偏离请求零上游执行**。测试把 KTX 上游换成一个计数用的本地
 * HTTP 服务，断言被口径绑定拒绝的 `lucy_query` 从未到达上游。
 */
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  writeLogMock: vi.fn(() => Promise.resolve()),
  writeAccessLogSourcesMock: vi.fn(() => Promise.resolve()),
  writeConversationTurnMock: vi.fn(() => Promise.resolve()),
  isTokenRevokedMock: vi.fn(() => false)
}));

vi.mock("../proxy/audit.js", async () => {
  const actual = await vi.importActual<typeof import("../proxy/audit.js")>("../proxy/audit.js");
  return {
    ...actual,
    isTokenRevoked: testState.isTokenRevokedMock,
    writeLog: testState.writeLogMock,
    writeAccessLogSources: testState.writeAccessLogSourcesMock,
    writeConversationTurn: testState.writeConversationTurnMock,
    purgeExpiredConversationTurns: vi.fn(() => Promise.resolve()),
    bindPriorSessionCalls: vi.fn(() => Promise.resolve())
  };
});

const TOKEN = "caliber-proxy-token";
const CONNECTION = "mysql-aliyun";
const SESSION_ID = "caliber-session-1";

function tokenHash(token: string): string {
  return "sha256:" + createHash("sha256").update(token).digest("hex");
}

const ACCESS_YAML = `users:
  - id: asset_agent
    name: Asset Agent
    enabled: true
    tokens:
      - hash: "${tokenHash(TOKEN)}"
        label: caliber-proxy-test
        created: 2026-11-08
    allow:
      tables:
        - dataforai.asset_count
        - dataforai.orders
      tools:
        - lucy_query
        - lucy_explain_query
        - lucy_begin_question
        - lucy_read_source
defaults:
  deny_tools: []
`;

const SCHEMA_YAML = `tables:
  asset_count:
    table: dataforai.asset_count
  orders:
    table: dataforai.orders
`;

const BINDING_YAML = `bindingId: asset_count
title: 资产台数
status: published
triggers:
  - 资产台数
connectionId: ${CONNECTION}
source: asset_count
caliber:
  measures:
    - asset_count.asset_count
  dimensions:
    - asset_count.company_code
  segments: []
  filterFields:
    - asset_count.company_code
  requireMeasures:
    - asset_count.asset_count
`;

let projectRoot: string;
let previousProjectRoot: string | undefined;
let previousContentRoot: string | undefined;
let previousUpstreamPort: string | undefined;
let previousBudget: string | undefined;
let upstream: Server;
let upstreamHits = 0;

async function writeContent(relPath: string, content: string): Promise<void> {
  const abs = path.join(projectRoot, relPath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content, "utf8");
}

beforeEach(async () => {
  upstreamHits = 0;
  upstream = createServer((req, res) => {
    upstreamHits += 1;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: { content: [{ type: "text", text: "upstream-ok" }] }
    }));
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", () => resolve()));

  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-caliber-proxy-"));
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
  await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
  await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), ACCESS_YAML, "utf8");
  await writeContent(`semantic-layer/${CONNECTION}/_schema/dataforai.yaml`, SCHEMA_YAML);

  previousProjectRoot = process.env.KTX_PROJECT_ROOT;
  process.env.KTX_PROJECT_ROOT = projectRoot;
  previousContentRoot = process.env.LUCY_CONTENT_ROOT;
  process.env.LUCY_CONTENT_ROOT = ".";
  previousUpstreamPort = process.env.LUCY_PROXY_UPSTREAM_PORT;
  process.env.LUCY_PROXY_UPSTREAM_PORT = String((upstream.address() as AddressInfo).port);
  previousBudget = process.env.LUCY_QUESTION_BUDGET;
  // 预算关闭：SC-25「预算关闭时四态仍成立」。
  process.env.LUCY_QUESTION_BUDGET = "off";

  testState.writeLogMock.mockClear();
  testState.writeAccessLogSourcesMock.mockClear();
  testState.writeConversationTurnMock.mockReset();
  testState.writeConversationTurnMock.mockImplementation(() => Promise.resolve());
  testState.isTokenRevokedMock.mockReset();
  testState.isTokenRevokedMock.mockReturnValue(false);

  await writeContent("caliber-bindings/asset_count.yaml", BINDING_YAML);
});

afterEach(async () => {
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
  if (previousProjectRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousProjectRoot;
  if (previousContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = previousContentRoot;
  if (previousUpstreamPort === undefined) delete process.env.LUCY_PROXY_UPSTREAM_PORT;
  else process.env.LUCY_PROXY_UPSTREAM_PORT = previousUpstreamPort;
  if (previousBudget === undefined) delete process.env.LUCY_QUESTION_BUDGET;
  else process.env.LUCY_QUESTION_BUDGET = previousBudget;
  await rm(projectRoot, { recursive: true, force: true });
});

/**
 * 重新加载模块图。上游端口在 `mcp-proxy` 模块求值时读取，因此端口必须先设好
 * 再 import；同时口径绑定的注册表与会话存储必须与 Proxy 用**同一份**模块实例。
 */
async function loadModules() {
  vi.resetModules();
  const registry = await import("../proxy/caliber-binding-registry");
  const session = await import("../proxy/caliber-binding-session");
  const acl = await import("../proxy/acl");
  const proxy = await import("../proxy/mcp-proxy");
  registry.resetCaliberBindingRegistryForTests();
  acl.resetEffectivePolicyForTests();
  session.setCaliberBindingStateDir(path.join(projectRoot, ".ktx-ui", "caliber-binding"));
  return { registry, session, acl, proxy };
}

async function publishBindings(registry: Awaited<ReturnType<typeof loadModules>>["registry"]) {
  const candidate = await registry.loadCaliberBindingCandidate();
  if (!candidate.ok) throw new Error(`candidate failed: ${candidate.reason} ${candidate.detail}`);
  const committed = await registry.commitCaliberBindingRegistry(candidate, {
    releaseId: "rel_proxy_test",
    attemptId: "att_proxy_test"
  });
  if (!committed.ok) throw new Error(`commit failed: ${committed.reason}`);
}

async function withProxy(run: (port: number) => Promise<void>) {
  const { proxy, registry } = await loadModules();
  await publishBindings(registry);
  const { server, host } = proxy.buildProxy();
  await new Promise<void>((resolve) => server.listen(0, host, () => resolve()));
  const port = (server.address() as AddressInfo).port;
  try {
    await run(port);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
}

async function callTool(port: number, name: string, args: unknown, id = "req-1") {
  return fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${TOKEN}`,
      "x-lucy-session-id": SESSION_ID
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name, arguments: args }
    })
  });
}

async function callToolText(port: number, name: string, args: unknown, id = "req-1") {
  const res = await callTool(port, name, args, id);
  const body = await res.json() as {
    result?: { isError?: boolean; content?: Array<{ text?: string }>; data?: unknown };
  };
  return {
    status: res.status,
    isError: body.result?.isError === true,
    text: body.result?.content?.[0]?.text ?? "",
    data: body.result?.data as Record<string, unknown> | undefined
  };
}

const COMPLIANT_QUERY = {
  connectionId: CONNECTION,
  measures: ["asset_count.asset_count"],
  dimensions: [{ field: "asset_count.company_code" }]
};

describe("P0-1 Proxy 口径绑定门禁", () => {
  it("SC-02：begin 命中绑定 → 返回 activeBindingId，并写入 committed 会话", async () => {
    await withProxy(async (port) => {
      const begun = await callToolText(port, "lucy_begin_question", {
        intentSummary: "查一下资产台数",
        question: "现在有多少台资产"
      });
      expect(begun.isError).toBe(false);
      expect(begun.text).toContain("asset_count");
    });
  });

  it("SC-10：合规请求不因本条被拒绝（到达上游）", async () => {
    await withProxy(async (port) => {
      await callTool(port, "lucy_begin_question", { intentSummary: "查一下资产台数" });
      const before = upstreamHits;
      const queried = await callToolText(port, "lucy_query", COMPLIANT_QUERY);
      expect(queried.text).not.toContain("caliber_binding_violation");
      expect(upstreamHits).toBe(before + 1);
    });
  });

  it("SC-07：偏离请求零上游执行", async () => {
    await withProxy(async (port) => {
      await callTool(port, "lucy_begin_question", { intentSummary: "查一下资产台数" });
      const before = upstreamHits;
      const denied = await callToolText(port, "lucy_query", {
        connectionId: CONNECTION,
        measures: ["orders.order_count"]
      });
      expect(denied.isError).toBe(true);
      expect(denied.text).toContain("caliber_binding_violation");
      expect(upstreamHits).toBe(before);
    });
  });

  it("SC-08／SC-09／SC-15／SC-15b：各类偏离都零上游执行", async () => {
    await withProxy(async (port) => {
      await callTool(port, "lucy_begin_question", { intentSummary: "查一下资产台数" });
      const cases: Array<[string, Record<string, unknown>]> = [
        ["越出允许集", { connectionId: CONNECTION, measures: ["asset_count.other_measure"] }],
        ["缺 requireMeasures", { connectionId: CONNECTION, dimensions: [{ field: "asset_count.company_code" }] }],
        ["{expr} measure", {
          connectionId: CONNECTION,
          measures: [{ expr: "sum(1)", name: "x" }],
          dimensions: [{ field: "asset_count.company_code" }]
        }],
        ["D12 禁键", { connectionId: CONNECTION, measures: ["asset_count.asset_count"], where: ["asset_count.company_code"] }],
        ["跨源 order_by", { connectionId: CONNECTION, measures: ["asset_count.asset_count"], order_by: [{ field: "orders.order_id" }] }]
      ];
      for (const [label, args] of cases) {
        const before = upstreamHits;
        const denied = await callToolText(port, "lucy_query", args);
        expect(denied.isError, label).toBe(true);
        expect(denied.text, label).toContain("caliber_binding_violation");
        expect(upstreamHits, label).toBe(before);
      }
    });
  });

  it("F-R1／D7②：合规 query 额外带 `sourceName` → 放行（不得 extra_parameter）", async () => {
    await withProxy(async (port) => {
      await callTool(port, "lucy_begin_question", { intentSummary: "查一下资产台数" });
      const before = upstreamHits;
      const queried = await callToolText(port, "lucy_query", {
        ...COMPLIANT_QUERY,
        sourceName: "asset_count"
      });
      expect(queried.isError).toBe(false);
      expect(queried.text).not.toContain("caliber_binding_violation");
      expect(queried.text).not.toContain("extra_parameter");
      expect(upstreamHits).toBe(before + 1);
    });
  });

  it("F-R1 对照：仍带 `where` → 继续 violation 且零上游执行", async () => {
    await withProxy(async (port) => {
      await callTool(port, "lucy_begin_question", { intentSummary: "查一下资产台数" });
      const before = upstreamHits;
      const denied = await callToolText(port, "lucy_query", {
        ...COMPLIANT_QUERY,
        sourceName: "asset_count",
        where: ["asset_count.company_code"]
      });
      expect(denied.isError).toBe(true);
      expect(denied.text).toContain("caliber_binding_violation");
      expect(denied.data?.reason).toBe("caliber_binding_violation");
      expect(denied.data?.dimension).toBe("extra_parameter");
      expect(upstreamHits).toBe(before);
    });
  });

  it("F-R1：来源别名指向别的源 → violation 且零上游执行", async () => {
    await withProxy(async (port) => {
      await callTool(port, "lucy_begin_question", { intentSummary: "查一下资产台数" });
      const before = upstreamHits;
      const denied = await callToolText(port, "lucy_query", {
        ...COMPLIANT_QUERY,
        sourceName: "orders"
      });
      expect(denied.isError).toBe(true);
      expect(denied.text).toContain("caliber_binding_violation");
      expect(denied.data?.dimension).toBe("source");
      expect(upstreamHits).toBe(before);
    });
  });

  it("SC-21：query 与 explain 同码同口径", async () => {
    await withProxy(async (port) => {
      await callTool(port, "lucy_begin_question", { intentSummary: "查一下资产台数" });
      const query = await callToolText(port, "lucy_query", {
        connectionId: CONNECTION,
        measures: ["asset_count.other_measure"]
      });
      const explain = await callToolText(port, "lucy_explain_query", {
        connectionId: CONNECTION,
        measures: ["asset_count.other_measure"]
      });
      expect(query.isError).toBe(true);
      expect(explain.isError).toBe(true);
      expect(query.data?.reason).toBe("caliber_binding_violation");
      expect(explain.data?.reason).toBe("caliber_binding_violation");
      // explain 不得进入本地 explain 成功体。
      expect(explain.text).not.toContain("upstreamTool");
      expect(explain.text).not.toContain("plan_only");
    });
  });

  it("SC-13：拒绝文案中文主称", async () => {
    await withProxy(async (port) => {
      await callTool(port, "lucy_begin_question", { intentSummary: "查一下资产台数" });
      const denied = await callToolText(port, "lucy_query", {
        connectionId: CONNECTION,
        measures: ["asset_count.other_measure"]
      });
      expect(denied.text).toContain("偏离固定口径");
    });
  });

  it("SC-03：显式 id 不存在 → 拒绝，且旧会话不变", async () => {
    await withProxy(async (port) => {
      const denied = await callToolText(port, "lucy_begin_question", {
        intentSummary: "查一下资产台数",
        caliberBindingId: "no_such_binding"
      });
      expect(denied.isError).toBe(true);
      expect(denied.text).toContain("invalid_or_invisible_binding");
      // 未开题 → 查询不受绑定约束。
      const queried = await callToolText(port, "lucy_query", {
        connectionId: CONNECTION,
        measures: ["orders.order_count"]
      });
      expect(queried.text).not.toContain("caliber_binding_violation");
    });
  });

  it("SC-05／SC-03：激活错（显式 id 不存在）→ 旧 Session 不变，旧绑定仍然强制", async () => {
    await withProxy(async (port) => {
      // 第一次开题成功（命中绑定）。
      const begun = await callToolText(port, "lucy_begin_question", { intentSummary: "查一下资产台数" });
      expect(begun.isError).toBe(false);
      // 第二次开题：显式 id 不存在 → 激活错。
      const failed = await callToolText(port, "lucy_begin_question", {
        intentSummary: "查一下资产台数",
        caliberBindingId: "no_such_binding"
      });
      expect(failed.isError).toBe(true);
      expect(failed.text).toContain("invalid_or_invisible_binding");
      // 旧 Session 不变 → 旧绑定仍然强制。
      const before = upstreamHits;
      const denied = await callToolText(port, "lucy_query", {
        connectionId: CONNECTION,
        measures: ["orders.order_count"]
      });
      expect(denied.text).toContain("caliber_binding_violation");
      expect(upstreamHits).toBe(before);
    });
  });

  it("SC-12：未开题 → 不施加绑定", async () => {
    await withProxy(async (port) => {
      const before = upstreamHits;
      const queried = await callToolText(port, "lucy_query", {
        connectionId: CONNECTION,
        measures: ["orders.order_count"]
      });
      // P0-1：未开题不施加口径绑定。
      expect(queried.text).not.toContain("caliber_binding_violation");
      // P0-3：never_begun＋已断言 source → source_ambiguity_gate（context_missing），零上游。
      expect(queried.text).toContain("source_ambiguity_gate");
      expect(upstreamHits).toBe(before);
    });
  });

  it("SC-17a：① 失败 → 仍 never_begun，查询不受绑定约束", async () => {
    testState.writeConversationTurnMock.mockImplementation(() => Promise.reject(new Error("turn write failed")));
    await withProxy(async (port) => {
      const begun = await callToolText(port, "lucy_begin_question", { intentSummary: "查一下资产台数" });
      expect(begun.isError).toBe(true);
      expect(begun.text).toContain("failed to persist");
      const queried = await callToolText(port, "lucy_query", {
        connectionId: CONNECTION,
        measures: ["orders.order_count"]
      });
      // P0-1：仍 never_begun → 无口径绑定约束。
      expect(queried.text).not.toContain("caliber_binding_violation");
      // P0-3：已断言 source 的 never_begun 走表级歧义／context_missing，不放行上游。
      expect(queried.text).toContain("source_ambiguity_gate");
    });
  });

  it("SC-17b：失败 begin → 旧 committed 状态不变（仍受旧绑定约束）", async () => {
    await withProxy(async (port) => {
      // 第一次开题成功（命中绑定）。
      const begun = await callToolText(port, "lucy_begin_question", { intentSummary: "查一下资产台数" });
      expect(begun.isError).toBe(false);
      // 第二次开题在 ① 阶段失败。
      testState.writeConversationTurnMock.mockImplementation(() => Promise.reject(new Error("turn write failed")));
      const failed = await callToolText(port, "lucy_begin_question", { intentSummary: "查一下资产台数" });
      expect(failed.isError).toBe(true);
      // 旧会话不变 → 旧绑定仍然强制。
      testState.writeConversationTurnMock.mockImplementation(() => Promise.resolve());
      const before = upstreamHits;
      const queried = await callToolText(port, "lucy_query", {
        connectionId: CONNECTION,
        measures: ["orders.order_count"]
      });
      expect(queried.text).toContain("caliber_binding_violation");
      expect(upstreamHits).toBe(before);
    });
  });

  it("SC-25／SC-27：预算关闭时绑定仍然强制；同会话后续调用保持同一快照", async () => {
    await withProxy(async (port) => {
      await callTool(port, "lucy_begin_question", { intentSummary: "查一下资产台数" });
      const first = await callToolText(port, "lucy_query", {
        connectionId: CONNECTION,
        measures: ["asset_count.other_measure"]
      });
      const second = await callToolText(port, "lucy_query", {
        connectionId: CONNECTION,
        measures: ["asset_count.other_measure"]
      });
      expect(first.text).toContain("caliber_binding_violation");
      expect(second.text).toContain("caliber_binding_violation");
      expect(second.data?.reason).toBe(first.data?.reason);
    });
  });

  it("SC-28：改盘后在途旅程仍按 begin 快照强制", async () => {
    await withProxy(async (port) => {
      await callTool(port, "lucy_begin_question", { intentSummary: "查一下资产台数" });
      // 直接改盘（未发布）→ 在途旅程仍按 begin 时的快照强制：
      // 盘上的口径已放宽，但 begin 时的快照不允许该度量。
      await writeContent("caliber-bindings/asset_count.yaml", BINDING_YAML.replace(
        "  measures:\n    - asset_count.asset_count",
        "  measures:\n    - asset_count.totally_other"
      ).replace(
        "  requireMeasures:\n    - asset_count.asset_count",
        "  requireMeasures:\n    - asset_count.totally_other"
      ));
      const before = upstreamHits;
      const denied = await callToolText(port, "lucy_query", {
        connectionId: CONNECTION,
        measures: ["asset_count.totally_other"]
      });
      expect(denied.text).toContain("caliber_binding_violation");
      expect(upstreamHits).toBe(before);
    });
  });
});
