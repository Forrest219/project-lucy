/**
 * P1-60 / REQ-030-081 — 可信 inactive 下隐藏 begin + 无副作用拒绝（D1–D2）。
 * Wave A TDD：**先红**（实现前），Wave C 实现后转绿。
 *
 * 覆盖（Spec §3 D1–D6；SC-01/02/04/09）：
 *   SC-01  inactive 的 tools/list 无 lucy_begin_question；
 *          initialize 指导无「每题 begin」推荐语。
 *   SC-02  inactive 合法强制 call → isError=true、reason=begin_not_available；
 *          无 turn / BindingSession / registry 副作用。
 *   D4     inactive 下 D2 不推进预算；lucy_continue_question 仍可见（预算开启时）。
 *   SC-09  D2 call 后，后续合规 query 正常到达上游（不因 D2 加门禁）。
 *
 * 实现依赖：Wave C（T3 mcp-proxy 隐藏逻辑）。
 * 禁止：用 LUCY_ENABLE_QUESTION_TOOL=false（联合隐藏 begin＋continue）实现 D1。
 */
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mock 注册（需要 vi.hoisted，与 caliber-binding-proxy.test.ts 保持一致）────

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

// ─── 常量 ────────────────────────────────────────────────────────────────────

const TOKEN = "begin-hide-inactive-token";
const CONNECTION = "mysql-aliyun";
const SESSION_ID = "begin-hide-session-1";
const USER_ID = "begin_hide_agent";

function tokenHash(token: string): string {
  return "sha256:" + createHash("sha256").update(token).digest("hex");
}

/** Access YAML：给 begin＋continue＋query＋explain 全部授权，以便测「有权限但无活跃绑定」。 */
const ACCESS_YAML = `users:
  - id: ${USER_ID}
    name: Begin Hide Agent
    enabled: true
    tokens:
      - hash: "${tokenHash(TOKEN)}"
        label: begin-hide-test
        created: 2026-11-20
    allow:
      tables:
        - ${CONNECTION}.superstore_orders
      tools:
        - lucy_query
        - lucy_explain_query
        - lucy_begin_question
        - lucy_continue_question
        - lucy_read_source
        - lucy_catalog
defaults:
  deny_tools: []
`;

const SCHEMA_YAML = `tables:
  superstore_orders:
    table: ${CONNECTION}.superstore_orders
`;

// ─── 临时目录与环境 ───────────────────────────────────────────────────────────

let projectRoot: string;
let upstream: Server;
let upstreamHits = 0;

let previousProjectRoot: string | undefined;
let previousContentRoot: string | undefined;
let previousUpstreamPort: string | undefined;
let previousBudget: string | undefined;
let previousEnableQuestionTool: string | undefined;

/**
 * 智能上游：区分 initialize / tools/list / tools/call，
 * 以便 proxy 的 filterAndAddAllowedTools 能正确处理 tools/list。
 */
function createSmartUpstream(): Server {
  return createServer((req: IncomingMessage, res) => {
    upstreamHits += 1;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
      } catch {
        // ignore parse error
      }
      const id = parsed.id ?? 1;
      const method = typeof parsed.method === "string" ? parsed.method : "";
      let responseBody: unknown;
      if (method === "initialize") {
        responseBody = {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-11-05",
            serverInfo: { name: "ktx-stub", version: "0.0.1" },
            capabilities: { tools: {} },
            instructions: ""
          }
        };
      } else if (method === "tools/list") {
        responseBody = {
          jsonrpc: "2.0",
          id,
          result: { tools: [] }
        };
      } else {
        // 通用工具调用响应（lucy_query 等）
        responseBody = {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: JSON.stringify({ rows: [], totalRows: 0 }) }]
          }
        };
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(responseBody));
    });
  });
}

async function writeContent(relPath: string, content: string): Promise<void> {
  const abs = path.join(projectRoot, relPath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content, "utf8");
}

beforeEach(async () => {
  upstreamHits = 0;
  upstream = createSmartUpstream();
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", () => resolve()));

  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-begin-hide-"));
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
  await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
  await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), ACCESS_YAML, "utf8");
  await writeContent(`semantic-layer/${CONNECTION}/_schema/${CONNECTION}.yaml`, SCHEMA_YAML);
  // caliber-bindings/ 目录存在但为空 → 可信 inactive（I0：fileCount=0，无提交凭据）
  await mkdir(path.join(projectRoot, "caliber-bindings"), { recursive: true });

  previousProjectRoot = process.env.KTX_PROJECT_ROOT;
  process.env.KTX_PROJECT_ROOT = projectRoot;
  previousContentRoot = process.env.LUCY_CONTENT_ROOT;
  process.env.LUCY_CONTENT_ROOT = ".";
  previousUpstreamPort = process.env.LUCY_PROXY_UPSTREAM_PORT;
  process.env.LUCY_PROXY_UPSTREAM_PORT = String((upstream.address() as AddressInfo).port);
  previousBudget = process.env.LUCY_QUESTION_BUDGET;
  // 预算开启：确保 continue 有机会出现在 list；测 D4 要求其可见。
  process.env.LUCY_QUESTION_BUDGET = "on";
  previousEnableQuestionTool = process.env.LUCY_ENABLE_QUESTION_TOOL;
  // 注意：禁止用 LUCY_ENABLE_QUESTION_TOOL=false 实现隐藏（Spec OQ-4 / Plan T3 约束）。
  // 这里明确 unset，不设该开关，让实现通过参与态分类控制。
  delete process.env.LUCY_ENABLE_QUESTION_TOOL;

  testState.writeLogMock.mockClear();
  testState.writeAccessLogSourcesMock.mockClear();
  testState.writeConversationTurnMock.mockReset();
  testState.writeConversationTurnMock.mockImplementation(() => Promise.resolve());
  testState.isTokenRevokedMock.mockReset();
  testState.isTokenRevokedMock.mockReturnValue(false);
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
  if (previousEnableQuestionTool === undefined) delete process.env.LUCY_ENABLE_QUESTION_TOOL;
  else process.env.LUCY_ENABLE_QUESTION_TOOL = previousEnableQuestionTool;
  await rm(projectRoot, { recursive: true, force: true });
});

// ─── 模块加载（每次重置，确保 registry / session / proxy 用同一份实例）──────────

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

/**
 * 以 inactive 状态启动 proxy（不调用 publishBindings）。
 * 注册表保持 null/generation=0，满足 L0 inactive 条件。
 */
async function withProxyInactive(
  run: (port: number, mods: Awaited<ReturnType<typeof loadModules>>) => Promise<void>
): Promise<void> {
  const mods = await loadModules();
  // 不 publishBindings → state.current=null，无提交凭据 → 可信 inactive。
  const { server, host } = mods.proxy.buildProxy();
  await new Promise<void>((resolve) => server.listen(0, host, () => resolve()));
  const port = (server.address() as AddressInfo).port;
  try {
    await run(port, mods);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  }
}

// ─── 通用请求辅助 ─────────────────────────────────────────────────────────────

function proxyHeaders(): Record<string, string> {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${TOKEN}`,
    "x-lucy-session-id": SESSION_ID
  };
}

async function listTools(port: number): Promise<string[]> {
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: proxyHeaders(),
    body: JSON.stringify({ jsonrpc: "2.0", id: "list-1", method: "tools/list", params: {} })
  });
  const body = (await res.json()) as { result?: { tools?: Array<{ name?: string }> } };
  return (body.result?.tools ?? [])
    .map((t) => t.name ?? "")
    .filter(Boolean);
}

async function getInitializeInstructions(port: number): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "init-1",
      method: "initialize",
      params: { clientInfo: { name: "test-client", version: "1.0" } }
    })
  });
  const body = (await res.json()) as { result?: { instructions?: string } };
  return body.result?.instructions ?? "";
}

async function callBegin(port: number, intentSummary = "查一下数据"): Promise<{
  status: number;
  isError: boolean;
  text: string;
  data: Record<string, unknown> | undefined;
}> {
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: proxyHeaders(),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "begin-1",
      method: "tools/call",
      params: { name: "lucy_begin_question", arguments: { intentSummary } }
    })
  });
  const body = (await res.json()) as {
    result?: { isError?: boolean; content?: Array<{ text?: string }>; data?: unknown };
  };
  return {
    status: res.status,
    isError: body.result?.isError === true,
    text: body.result?.content?.[0]?.text ?? "",
    data: body.result?.data as Record<string, unknown> | undefined
  };
}

async function callQuery(
  port: number,
  args: Record<string, unknown> = { connectionId: CONNECTION, measures: [`${CONNECTION}.superstore_orders.count`] }
): Promise<{ status: number; isError: boolean; upstreamHitsBefore: number; upstreamHitsAfter: number }> {
  const before = upstreamHits;
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: proxyHeaders(),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "query-1",
      method: "tools/call",
      params: { name: "lucy_query", arguments: args }
    })
  });
  const body = (await res.json()) as { result?: { isError?: boolean } };
  return {
    status: res.status,
    isError: body.result?.isError === true,
    upstreamHitsBefore: before,
    upstreamHitsAfter: upstreamHits
  };
}

// ─── SC-01 (D1) — tools/list 无 begin，initialize 指导无 begin 推荐 ───────────

describe("SC-01 (D1) — inactive 下 tools/list 和 initialize 均不曝光 begin", () => {
  /**
   * RED 预期：当前 tools/list 包含 lucy_begin_question（LUCY_ENABLE_QUESTION_TOOL 未禁用且 ACL 授权）。
   * GREEN 预期（Wave C 后）：inactive 状态下 tools/list 不含 lucy_begin_question。
   */
  it("tools/list 无 lucy_begin_question（D1）", async () => {
    await withProxyInactive(async (port) => {
      const tools = await listTools(port);
      expect(tools, "inactive 下 tools/list 不应含 lucy_begin_question").not.toContain(
        "lucy_begin_question"
      );
    });
  });

  /**
   * RED 预期：当前 initialize 指导在 lucy_begin_question 有 ACL 授权时含 begin 推荐语。
   * GREEN 预期（Wave C 后）：inactive 状态下指导不含「每题 begin」推荐。
   * Spec D1：「initialize 与角色指导均不含 begin」。
   */
  it("initialize 指导不含「Recommended ... lucy_begin_question」（D1）", async () => {
    await withProxyInactive(async (port) => {
      const instructions = await getInitializeInstructions(port);
      // 指导必须有基础 QA 内容（代理正常工作）。
      expect(instructions).toContain("Lucy Data QA Runtime Instructions");
      // inactive 下不得出现 begin 推荐语（Spec §4 伪代码）。
      expect(
        instructions,
        "inactive 下 initialize 指导不应推荐 begin"
      ).not.toContain("lucy_begin_question");
    });
  });
});

// ─── SC-02 (D2) — inactive 合法强制 call 返回 begin_not_available ─────────────

describe("SC-02 (D2) — inactive 合法强制 call 返回 begin_not_available", () => {
  /**
   * RED 预期：当前 begin 在 inactive 下走正常流程（命中触发词/unresolved），不返回 begin_not_available。
   * GREEN 预期（Wave C 后）：isError=true，data.reason=begin_not_available。
   * Spec D2：「在生成 ID、校验业务参数、写 turn/预算/BindingSession 或加载注册表之前结束」。
   */
  it("强制 call begin → isError=true，reason=begin_not_available（D2）", async () => {
    await withProxyInactive(async (port) => {
      const result = await callBegin(port);
      expect(result.status).toBe(200);
      expect(result.isError, "isError 须为 true").toBe(true);
      expect(result.data?.reason, "reason 须为 begin_not_available").toBe("begin_not_available");
    });
  });

  /**
   * Spec D2 文案要求：说明当前未启用问询上报，可直接按现有权限查询。
   * 不得回传凭据、服务器路径或不可见绑定对象。
   */
  it("D2 响应文案说明直接查询（不得回传凭据/路径/绑定对象）", async () => {
    await withProxyInactive(async (port) => {
      const result = await callBegin(port);
      expect(result.text).not.toHaveLength(0);
      // 不泄露凭据或服务器路径。
      expect(result.text).not.toMatch(/password|secret|token|\/app\/|\.sqlite/i);
      // 不回传 bindingId 等内部绑定对象。
      expect(result.text).not.toContain("bindingId");
    });
  });

  /**
   * RED 预期（副作用测试）：当前 begin 在无活跃绑定时仍会调用 writeConversationTurn（begun_no_hit）。
   * GREEN 预期（Wave C 后）：D2 在写入前返回，writeConversationTurn 不被调用。
   * Spec D2：「在生成 ID、业务参数、存储、注册表副作用之前」结束。
   */
  it("D2 不调用 writeConversationTurn（无 turn 写入，D2）", async () => {
    await withProxyInactive(async (port) => {
      testState.writeConversationTurnMock.mockClear();
      await callBegin(port);
      expect(
        testState.writeConversationTurnMock.mock.calls.length,
        "D2 返回前不得写入 conversation turn"
      ).toBe(0);
    });
  });

  /**
   * RED 预期：当前 begin 在 inactive 下走正常流程，调用 beginBindingSessionPreparation +
   *           commitBindingSession，BindingSession 变为 begun_no_hit。
   * GREEN 预期（Wave C 后）：D2 在写入前返回，BindingSession 保持 never_begun。
   * Spec D2：「不新增注册表依赖、状态写入」。
   *
   * scope key 计算与 proxy 内部逻辑一致：
   *   tokenHashPrefix = fullHash.slice(0, 19)
   *   identityKey = "${userId}|${tokenHashPrefix}"
   *   scopeKey = bindingScopeKey(identityKey, sessionId)
   */
  it("D2 不创建 BindingSession（BindingSession 须保持 never_begun，D2）", async () => {
    await withProxyInactive(async (port, mods) => {
      const fullHash = tokenHash(TOKEN); // "sha256:hexhash"
      const prefix = fullHash.slice(0, 19);
      const identityKey = `${USER_ID}|${prefix}`;
      const scopeKey = mods.session.bindingScopeKey(identityKey, SESSION_ID);

      await callBegin(port);

      const sessionState = await mods.session.readBindingSession(scopeKey);
      expect(
        sessionState.state,
        "D2 后 BindingSession 须保持 never_begun（不得写入 begun_no_hit）"
      ).toBe("never_begun");
    });
  });
});

// ─── D4 (SC-05) — continue 仍可见，预算不推进 ────────────────────────────────

describe("D4 — inactive 下 lucy_continue_question 仍可见，预算不推进", () => {
  /**
   * Spec D4：「D2 不返回伪造 turnId，不写 conversation turn，不发布新有效归属」；
   *          「continue 工具和预算指导必须保持」。
   * 本测试应在实现前后均通过（D4 保持不变量，不是新增行为）。
   */
  it("tools/list 仍含 lucy_continue_question（D4）", async () => {
    await withProxyInactive(async (port) => {
      const tools = await listTools(port);
      expect(tools, "inactive 下 lucy_continue_question 须仍然可见").toContain(
        "lucy_continue_question"
      );
    });
  });

  /**
   * RED 预期（D4 双断言）：begin 隐藏后 continue 仍在，但 begin 不在。
   * 验证两者可见性已被分离（禁止 LUCY_ENABLE_QUESTION_TOOL=false 联合隐藏）。
   */
  it("tools/list：begin 隐藏且 continue 可见，确认可见性已分离（D4）", async () => {
    await withProxyInactive(async (port) => {
      const tools = await listTools(port);
      expect(tools, "inactive 下 begin 须隐藏").not.toContain("lucy_begin_question");
      expect(tools, "inactive 下 continue 须仍可见").toContain("lucy_continue_question");
    });
  });
});

// ─── SC-09 (D6) — D2 后后续合规 query 不受阻 ─────────────────────────────────

describe("SC-09 (D6) — D2 call 后后续 query 正常到达上游", () => {
  /**
   * Spec D6：「N、强制 call 和后续 query 分别断言；query 成功不能掩盖隐藏失败」；
   *          「D2 不污染后续 query／read_source／explain」。
   * 验证 D2 返回后不为 inactive query 加入额外门禁。
   */
  it("D2 call 后 lucy_query 正常到达上游（SC-09）", async () => {
    await withProxyInactive(async (port) => {
      // 1. 强制 call begin → 获得 D2 响应。
      const beginResult = await callBegin(port);
      expect(beginResult.isError).toBe(true);
      expect(beginResult.data?.reason).toBe("begin_not_available");

      // 2. 后续 lucy_query 不受 D2 新增门禁，到达上游（upstreamHits 增加）。
      const queryResult = await callQuery(port);
      expect(
        queryResult.upstreamHitsAfter,
        "D2 后 query 须到达上游"
      ).toBeGreaterThan(queryResult.upstreamHitsBefore);
    });
  });

  /**
   * 对照：即使在 D2 之前也可以直接 query（N 路径合法），D2 后不退化。
   * Spec SC-01：「未露出 begin 但授 query 者可用」。
   */
  it("N 路径：未 call begin 时 lucy_query 也可直接到达上游（SC-01）", async () => {
    await withProxyInactive(async (port) => {
      const queryResult = await callQuery(port);
      expect(
        queryResult.upstreamHitsAfter,
        "N 路径 query 须到达上游"
      ).toBeGreaterThan(queryResult.upstreamHitsBefore);
    });
  });

  /**
   * D6 完整路径：先 N 路径查询一次，再强制 call D2，再查询一次；
   * 两次查询均到达上游，D2 中间段不阻断任何一次。
   */
  it("N → D2 → N 全程查询均到达上游（D6 完整路径）", async () => {
    await withProxyInactive(async (port) => {
      // 第一次查询（D2 前）。
      const q1 = await callQuery(port);
      expect(q1.upstreamHitsAfter).toBeGreaterThan(q1.upstreamHitsBefore);

      // D2 call。
      const beginResult = await callBegin(port);
      expect(beginResult.isError).toBe(true);
      expect(beginResult.data?.reason).toBe("begin_not_available");

      // 第二次查询（D2 后）。
      const q2 = await callQuery(port);
      expect(q2.upstreamHitsAfter).toBeGreaterThan(q2.upstreamHitsBefore);
    });
  });
});


describe("P1-60 final-review regressions", () => {
  it("R-03 fallback instructions retain continue but remove hidden begin", async () => {
    await writeContent("webui/config/data-qa-instructions.md", "# fallback\n## 可选问询上报（锦上添花）\n\n- call `lucy_begin_question`\n- question and intentSummary\n\n## 预算\n- `lucy_continue_question` remains visible\n");
    await withProxyInactive(async (port, mods) => {
      const spy = vi.spyOn(mods.acl, "lucyCatalog").mockRejectedValue(new Error("catalog-unavailable"));
      try {
        const instructions = await getInitializeInstructions(port);
        expect(instructions).not.toContain("lucy_begin_question");
        expect(instructions).toContain("lucy_continue_question");
      } finally { spy.mockRestore(); }
    });
  });
  it.each(["", "   "])("R-04 inactive missing intent %j returns D2 before business validation", async (intent) => {
    await withProxyInactive(async (port) => {
      const result = await callBegin(port, intent);
      expect(result.isError).toBe(true);
      expect(result.data?.reason).toBe("begin_not_available");
      expect(testState.writeConversationTurnMock).not.toHaveBeenCalled();
      const query = await callQuery(port);
      expect(query.isError).toBe(false);
    });
  });
  it("R-03 classification exceptions keep begin hidden and continue visible", async () => {
    await withProxyInactive(async (port, mods) => {
      const spy = vi.spyOn(mods.registry, "classifyCaliberParticipation").mockRejectedValue(new Error("classification-read-failed"));
      try {
        const tools = await listTools(port);
        expect(tools).not.toContain("lucy_begin_question");
        expect(tools).toContain("lucy_continue_question");
        expect(await getInitializeInstructions(port)).not.toContain("lucy_begin_question");
        const forced = await callBegin(port);
        expect(forced.isError).toBe(true);
        expect(forced.data?.reason).toBe("caliber_binding_unresolved");
        expect(testState.writeConversationTurnMock).not.toHaveBeenCalled();
      } finally { spy.mockRestore(); }
      expect((await callQuery(port)).isError).toBe(false);
    });
  });
});


describe("SC-10 actual registry call counters", () => {
  it("D2 does not load or commit a registry (with positive controls)", async () => {
    await withProxyInactive(async (port, mods) => {
      const load = vi.spyOn(mods.registry, "loadCaliberBindingCandidate");
      const commit = vi.spyOn(mods.registry, "commitCaliberBindingRegistry");
      try {
        const result = await callBegin(port);
        expect(result.data?.reason).toBe("begin_not_available");
        expect(load).toHaveBeenCalledTimes(0);
        expect(commit).toHaveBeenCalledTimes(0);
        const candidate = await mods.registry.loadCaliberBindingCandidate();
        expect(candidate.ok).toBe(true);
        if (!candidate.ok) throw new Error(candidate.reason);
        const committed = await mods.registry.commitCaliberBindingRegistry(candidate, {
          releaseId: "counter-positive-control", attemptId: "counter-positive-control"
        });
        expect(committed.ok).toBe(true);
        expect(load).toHaveBeenCalledTimes(1);
        expect(commit).toHaveBeenCalledTimes(1);
      } finally { load.mockRestore(); commit.mockRestore(); }
    });
  });
});
