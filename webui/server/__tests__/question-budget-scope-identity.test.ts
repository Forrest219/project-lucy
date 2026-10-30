import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import {
  QuestionBudget,
  budgetIdentityKey,
  budgetScopeKey,
  isBudgetUnavailable,
  questionBudgetEnabled,
  questionBudgetScopeMode,
  type BudgetDecision,
  type BudgetPersistence,
  type BudgetState
} from "../proxy/question-experience.js";

/**
 * Spec 162 修订（问询预算窗口与预算终止可观测性优化）§7.1 / §7.6 / §7.7 的单元级验收：
 *   - SC-02 同一问询空闲 15 分钟后仍属同一作用域（不换桶、不清零）
 *   - SC-03 重启后恢复累计字段与归属，慢标记读稳定作用域的 originStartedAt
 *   - SC-05 持久层不可读 → question_budget_unavailable，且不记为预算终止
 *   - SC-38 LUCY_QUESTION_BUDGET_SCOPE=legacy → 作用域键回到旧语义
 *   - SC-39 LUCY_QUESTION_BUDGET=off → 预算整体关闭
 *   - SC-48 commit 失败未核实 → 第二次全量写入被拒绝，按核实结果恢复
 *
 * 本文件只做**单元级**验收：直接 `new QuestionBudget()` + 内存持久化，
 * 不起真实代理、不连数据库、不等真实时钟。
 * SC-04（真实代理重启后经 MCP 调用）在本文件末尾的集成用例里覆盖。
 */

const IDENTITY = budgetIdentityKey("synthetic-user", "sha256:synthetic");
const SESSION = "session-synthetic";

/** turn 归属注册表的过期窗口（LUCY_REPORTED_TURN_ATTACH_WINDOW_MS 默认 600000）。 */
const TURN_REGISTRY_WINDOW_MS = 600_000;
/** SC-02 的空闲时长：15 分钟 > 注册表 10 分钟窗口。 */
const IDLE_15_MIN_MS = 15 * 60 * 1000;

type MemoryStore = {
  persistence: BudgetPersistence;
  rows: Map<string, BudgetState>;
  keys: Map<string, Set<string>>;
  failLoad: { current: boolean };
  failSave: { current: boolean };
  /** 写入已落地但响应丢失：行与幂等键都已提交，随后才抛出。 */
  applyBeforeThrow: { current: boolean };
  counters: { loads: number; saves: number };
};

/**
 * 内存持久化夹具：与同族文件 `question-budget-window-mode.test.ts` 同写法，
 * 另加「先落盘再抛错」「读写计数」两项，用于 SC-48 的核实分支。
 */
function memoryPersistence(seed?: BudgetState): MemoryStore {
  const rows = new Map<string, BudgetState>();
  const keys = new Map<string, Set<string>>();
  if (seed?.scopeKey) rows.set(seed.scopeKey, seed);
  const failLoad = { current: false };
  const failSave = { current: false };
  const applyBeforeThrow = { current: false };
  const counters = { loads: 0, saves: 0 };
  const persistence: BudgetPersistence = {
    async load(scopeKey) {
      counters.loads += 1;
      if (failLoad.current) throw new Error("unreadable");
      const row = rows.get(scopeKey);
      if (!row) return null;
      return {
        row: { ...row, archivedBusyMsByWindow: { ...(row.archivedBusyMsByWindow ?? {}) } },
        appliedKeys: [...(keys.get(scopeKey) ?? [])]
      };
    },
    async save(scopeKey, state, idempotencyKey) {
      counters.saves += 1;
      if (failSave.current) {
        if (applyBeforeThrow.current) {
          // 行与幂等键都已提交，随后才抛错：模拟「写入已落地但响应丢失」。
          const known = keys.get(scopeKey) ?? new Set<string>();
          const row = { ...state, scopeKey, archivedBusyMsByWindow: { ...(state.archivedBusyMsByWindow ?? {}) } };
          rows.set(scopeKey, row);
          if (idempotencyKey) known.add(idempotencyKey);
          keys.set(scopeKey, known);
        }
        throw new Error("unwritable");
      }
      const known = keys.get(scopeKey) ?? new Set<string>();
      if (idempotencyKey && known.has(idempotencyKey)) {
        return { row: rows.get(scopeKey)!, appliedKeys: [...known] };
      }
      const row = { ...state, scopeKey, archivedBusyMsByWindow: { ...(state.archivedBusyMsByWindow ?? {}) } };
      rows.set(scopeKey, row);
      if (idempotencyKey) known.add(idempotencyKey);
      keys.set(scopeKey, known);
      return { row, appliedKeys: [...known] };
    },
    async listScopes() {
      return [...rows.keys()];
    }
  };
  return { persistence, rows, keys, failLoad, failSave, applyBeforeThrow, counters };
}

type ConsumeOptions = {
  /** 传入的 turn 归属；不传即模拟「注册表已过期、turn 解析不出来」。 */
  turnId?: string;
  /** 无 turn 时的兜底作用域（旧语义用）。 */
  fallbackScope?: string;
  continueToken?: string;
  now: number;
  /** 是否在放行后立刻结算；默认不结算，避免结算写入混进落库计数。 */
  settle?: boolean;
};

async function scoped(budget: QuestionBudget, options: ConsumeOptions): Promise<BudgetDecision> {
  const decision = await budget.consumePersisted(
    options.turnId,
    options.now,
    options.continueToken,
    options.fallbackScope,
    { identityKey: IDENTITY, sessionId: SESSION, canContinue: true }
  );
  if (options.settle && decision.action === "allow" && decision.ticket) {
    await budget.settle(decision.ticket, decision.ticket.startMonoMs);
  }
  return decision;
}

describe("question budget scope identity and recovery", () => {
  const ENV_KEYS = ["LUCY_QUESTION_BUDGET_SCOPE", "LUCY_QUESTION_BUDGET"] as const;
  let savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv = {};
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
    // 每个用例从默认口径起步：stable 作用域 + 预算开启。
    delete process.env.LUCY_QUESTION_BUDGET_SCOPE;
    delete process.env.LUCY_QUESTION_BUDGET;
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = savedEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("SC-02 空闲 15 分钟后仍是同一作用域：不换桶、不换轮次、计数不归零", async () => {
    const budget = new QuestionBudget();
    const scopeKey = budgetScopeKey(IDENTITY, SESSION);

    // 首次开问询，建立轮次。
    const begun = await budget.beginQuestion({
      identityKey: IDENTITY,
      sessionId: SESSION,
      turnId: "turn-idle",
      now: 0
    });
    expect(begun.ok).toBe(true);

    // 第 1 次数据调用：此时 turn 仍能解析出来。
    const first = await scoped(budget, { turnId: "turn-idle", now: 1_000, settle: true });
    expect(first.action).toBe("allow");

    // 空闲 15 分钟（> 注册表 10 分钟窗口）后，turn 注册表已过期：
    // 归属解析不出来，因此这次调用不带 turnId。
    // 稳定作用域键由身份+会话决定（question-experience.ts 的 budgetScopeKey），
    // 与注册表存活期无关。
    expect(IDLE_15_MIN_MS).toBeGreaterThan(TURN_REGISTRY_WINDOW_MS);
    const second = await scoped(budget, { now: 1_000 + IDLE_15_MIN_MS, settle: true });
    expect(second.action).toBe("allow");

    const state = budget.snapshotScope(scopeKey);
    // 作用域键不变。
    expect(state?.scopeKey).toBe(scopeKey);
    // 轮次不变。
    expect(state?.round).toBe(1);
    // 计数连续，没有归零。
    expect(state?.calls).toBe(2);
    // 没有落进旧的 turn: / scope: 桶。
    expect(budget.snapshotScope("turn:turn-idle")).toBeNull();
    expect(budget.snapshotScope("scope:anonymous")).toBeNull();
  });

  it("SC-03 重启后恢复累计字段与归属，慢问询标记读稳定作用域的 originStartedAt", async () => {
    const scopeKey = budgetScopeKey(IDENTITY, SESSION);
    const store = memoryPersistence({
      scopeKey,
      startedAt: 1_000,
      originStartedAt: 1_000,
      calls: 18,
      busyMs: 0,
      continuations: 0,
      windowId: 3,
      round: 2,
      turnId: "T",
      attempts: 18,
      peakConcurrency: 1,
      currentConcurrency: 0,
      // 崩溃前的在途占用：不恢复。
      inflight: 2,
      pendingToken: null,
      presentedToken: null,
      archivedBusyMsByWindow: {},
      loaded: true
    });

    // 模拟进程重启：新的预算实例 + 同一份持久层。
    const restarted = new QuestionBudget();
    restarted.setPersistence(store.persistence);

    // 归属冻结之前先装载作用域：恢复出的归属必须是 T。
    // 生产调用点：mcp-proxy.ts 的 `questionBudget.preload(...)` 早于
    // `reportedTurns.resolve(...)`（归属冻结）。
    const preloaded = await restarted.preload(IDENTITY, SESSION, 2_000);
    expect(preloaded?.turnId).toBe("T");
    expect(preloaded?.calls).toBe(18);
    expect(preloaded?.windowId).toBe(3);
    expect(preloaded?.round).toBe(2);
    // 崩溃前的在途占用不恢复。
    expect(preloaded?.inflight).toBe(0);

    // 慢问询标记：usageSlowMark 走 questionBudget.wallClockMs(turnId, now)，
    // 这里对同一实例断言它读的是稳定作用域上的 originStartedAt。
    expect(restarted.wallClockMs("T", 61_000)).toBe(60_000);

    // 该次数据调用准入。
    const decision = await scoped(restarted, { turnId: "T", now: 2_000 });
    expect(decision.action).toBe("allow");
    if (decision.action !== "allow" || !decision.ticket) return;

    const state = restarted.snapshotScope(scopeKey);
    expect(state?.calls).toBe(19);
    expect(state?.windowId).toBe(3);
    expect(state?.round).toBe(2);
    expect(state?.turnId).toBe("T");
    expect(decision.ticket.round).toBe(2);
    expect(decision.ticket.windowId).toBe(3);
  });

  it("SC-05 持久层不可读时失败关闭：question_budget_unavailable，且不记为预算终止", async () => {
    const store = memoryPersistence();
    store.failLoad.current = true;
    const budget = new QuestionBudget();
    budget.setPersistence(store.persistence);
    const scopeKey = budgetScopeKey(IDENTITY, SESSION);

    const decision = await scoped(budget, { now: 1_000 });
    expect(decision.action).toBe("stop");
    if (decision.action !== "stop") return;
    // 存储故障，不是预算终止。
    // 生产侧对不可用停机走 503 + outcome=error，不落 budget_stop。
    expect(decision.reason).toBe("question_budget_unavailable");
    expect(decision.reason).not.toBe("question_budget_exhausted");
    expect(isBudgetUnavailable(decision)).toBe(true);
    expect(decision.continuable).toBe(false);
    // 没有把这次失败写成任何预算事实。
    expect(store.counters.saves).toBe(0);
    expect(store.rows.size).toBe(0);
    // 作用域被标记为不可用。
    expect(budget.snapshotScope(scopeKey)?.processUnavailable).toBe(true);

    // 后续准入一并拒绝。
    const again = await scoped(budget, { now: 2_000 });
    expect(again.action).toBe("stop");
    if (again.action !== "stop") return;
    expect(again.reason).toBe("question_budget_unavailable");
    expect(store.counters.saves).toBe(0);
  });

  it("SC-38 legacy 模式把作用域键退回 turn:<turnId> / scope:<fallback> 旧语义", async () => {
    process.env.LUCY_QUESTION_BUDGET_SCOPE = "legacy";
    expect(questionBudgetScopeMode()).toBe("legacy");

    const budget = new QuestionBudget();
    // 有 turnId → turn:<turnId>
    const withTurn = await scoped(budget, { turnId: "turn-legacy", now: 1_000 });
    expect(withTurn.action).toBe("allow");
    // 无 turnId → scope:<fallback>
    const withoutTurn = await scoped(budget, { fallbackScope: "fp:session-legacy", now: 1_000 });
    expect(withoutTurn.action).toBe("allow");

    expect(budget.snapshotScope("turn:turn-legacy")?.calls).toBe(1);
    expect(budget.snapshotScope("scope:fp:session-legacy")?.calls).toBe(1);
    // 旧语义下不建稳定作用域桶（仅供新旧口径对照）。
    expect(budget.snapshotScope(budgetScopeKey(IDENTITY, SESSION))).toBeNull();
    // 旧语义下也没有「按稳定作用域恢复」的预载路径。
    expect(await budget.preload(IDENTITY, SESSION, 1_000)).toBeNull();
  });

  it("SC-39 LUCY_QUESTION_BUDGET=off 关闭预算整体，且每次准入现读开关", async () => {
    // 默认开启。
    expect(questionBudgetEnabled()).toBe(true);
    process.env.LUCY_QUESTION_BUDGET = "off";
    // 准入闸读的就是这个谓词：代理侧 tools/call 的数据工具分支与旁路入口分支
    // 都以 `questionBudgetEnabled()` 为闸（mcp-proxy.ts）。
    expect(questionBudgetEnabled()).toBe(false);
    // 开关是每次准入现读的，不是启动时缓存的。
    delete process.env.LUCY_QUESTION_BUDGET;
    expect(questionBudgetEnabled()).toBe(true);
    process.env.LUCY_QUESTION_BUDGET = "off";
    expect(questionBudgetEnabled()).toBe(false);
    // 关预算不动其它既有行为：作用域键语义与墙钟口径两个灰度开关彼此独立。
    expect(questionBudgetScopeMode()).toBe("stable");
  });

  it("SC-48 未核实期间拒绝第二次全量写入，核实后按磁盘行恢复", async () => {
    const store = memoryPersistence();
    const budget = new QuestionBudget();
    budget.setPersistence(store.persistence);
    const scopeKey = budgetScopeKey(IDENTITY, SESSION);

    // 第一次消费正常落库。
    expect((await scoped(budget, { now: 1_000 })).action).toBe("allow");
    expect(store.counters.saves).toBe(1);
    expect(store.rows.get(scopeKey)?.calls).toBe(1);

    // 提交失败，且随后的核实读取也失败 → 作用域停在「未核实」状态。
    // 实现点：question-experience.ts 的 commit 失败分支记 unverifiedKey，
    // recover 读不到磁盘行时保持不可用。
    store.failSave.current = true;
    store.failLoad.current = true;
    const failed = await scoped(budget, { now: 2_000 });
    expect(failed.action).toBe("stop");
    if (failed.action !== "stop") return;
    expect(failed.reason).toBe("question_budget_unavailable");
    expect(store.counters.saves).toBe(2);

    // 未核实期间：第二次全量写入被拒绝，且不再发起新的写入。
    const blocked = await scoped(budget, { now: 3_000 });
    expect(blocked.action).toBe("stop");
    if (blocked.action !== "stop") return;
    expect(blocked.reason).toBe("question_budget_unavailable");
    expect(store.counters.saves).toBe(2);
    // 失败候选态没有被发布：磁盘行与内存行都还是第一次提交的那一行。
    expect(store.rows.get(scopeKey)?.calls).toBe(1);
    expect(budget.snapshotScope(scopeKey)?.calls).toBe(1);
    // 待核实的幂等键被记下，供下一次核实使用。
    expect(budget.snapshotScope(scopeKey)?.commitUnverified).toBe(true);
    expect(budget.snapshotScope(scopeKey)?.unverifiedKey).toMatch(/^admit:/);

    // 核实读取仍失败 → 保持不可用。
    const stillUnavailable = await scoped(budget, { now: 4_000 });
    expect(stillUnavailable.action).toBe("stop");
    if (stillUnavailable.action !== "stop") return;
    expect(stillUnavailable.reason).toBe("question_budget_unavailable");
    expect(store.counters.saves).toBe(2);

    // 存储恢复可读：核实确认该键没有落库 → 回到磁盘旧行，不发布失败候选态。
    store.failLoad.current = false;
    store.failSave.current = false;
    const recovered = await budget.preload(IDENTITY, SESSION, 5_000);
    expect(recovered?.calls).toBe(1);
    expect(recovered?.processUnavailable).toBe(false);
    expect(recovered?.commitUnverified).toBe(false);
    expect(recovered?.unverifiedKey).toBeNull();

    // 恢复后可以继续消费；失败那次没有留下重复计数。
    const next = await scoped(budget, { now: 6_000 });
    expect(next.action).toBe("allow");
    expect(budget.snapshotScope(scopeKey)?.calls).toBe(2);
  });

  it("SC-48 核实读到已提交键后发布磁盘行并恢复", async () => {
    const store = memoryPersistence();
    const budget = new QuestionBudget();
    budget.setPersistence(store.persistence);
    const scopeKey = budgetScopeKey(IDENTITY, SESSION);

    expect((await scoped(budget, { now: 1_000 })).action).toBe("allow");

    // 写入已落地但响应丢失：行与幂等键都已提交，随后才抛错。
    store.failSave.current = true;
    store.applyBeforeThrow.current = true;
    const decided = await scoped(budget, { now: 2_000 });
    expect(decided.action).toBe("allow");
    expect(store.rows.get(scopeKey)?.calls).toBe(2);

    // 发布的是磁盘行（已提交的那一行），作用域恢复可用。
    const state = budget.snapshotScope(scopeKey);
    expect(state?.calls).toBe(2);
    expect(state?.processUnavailable).toBe(false);
    expect(state?.commitUnverified).toBe(false);
    expect(state?.unverifiedKey).toBeNull();
  });
});

/**
 * SC-04 —— **真实代理重启**后经 MCP `tools/call` 发起数据调用。
 *
 * 合同（Spec §7.1 / Plan S2 退出条件）：直接调函数的写法视为不通过。
 * 本用例起两个代理实例（第二个 = 重启后的新进程语义），共用同一个审计库，
 * 断言重启后累计字段从持久层恢复、归属在冻结前恢复为原 turn。
 */
describe("question budget survives a real proxy restart (SC-04)", () => {
  const TOKEN = "budget-restart-token";
  const SESSION = "sess-restart";

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
  - id: restart_agent
    name: Restart Agent
    enabled: true
    tokens:
      - hash: "${tokenHash(TOKEN)}"
        label: restart-token
        created: 2026-10-30
    allow:
      connections:
        - mysql-aliyun
      tables:
        - dataforai.superstore_orders
      tools:
        - lucy_read_source
        - lucy_query
        - lucy_begin_question
        - lucy_continue_question
defaults:
  deny_tools: []
`;

  let projectRoot: string;
  let auditDbPath: string;
  let previousProjectRoot: string | undefined;
  let previousContentRoot: string | undefined;
  let previousAuditDb: string | undefined;
  let previousInternalToken: string | undefined;
  let previousUpstreamHost: string | undefined;
  let previousUpstreamPort: string | undefined;

  beforeEach(async () => {
    vi.resetModules();
    projectRoot = await mkdtemp(path.join(os.tmpdir(), "ktx-budget-restart-"));
    auditDbPath = path.join(projectRoot, "audit.sqlite");
    await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
    await mkdir(path.join(projectRoot, "semantic-layer", "mysql-aliyun", "_schema"), { recursive: true });
    await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
    await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), ACCESS_YAML, "utf8");
    await writeFile(
      path.join(projectRoot, "semantic-layer", "mysql-aliyun", "_schema", "dataforai.yaml"),
      "tables:\n  superstore_orders:\n    table: dataforai.superstore_orders\n",
      "utf8"
    );
    previousProjectRoot = process.env.KTX_PROJECT_ROOT;
    previousContentRoot = process.env.LUCY_CONTENT_ROOT;
    previousAuditDb = process.env.LUCY_AUDIT_DB;
    previousInternalToken = process.env.KTX_INTERNAL_TOKEN;
    previousUpstreamHost = process.env.LUCY_PROXY_UPSTREAM_HOST;
    previousUpstreamPort = process.env.LUCY_PROXY_UPSTREAM_PORT;
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    process.env.LUCY_AUDIT_DB = auditDbPath;
    process.env.KTX_INTERNAL_TOKEN = "internal-budget-restart-token";
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
    await rm(projectRoot, { recursive: true, force: true });
  });

  async function startUpstream(): Promise<{ port: number; close: () => Promise<void> }> {
    const upstream = createServer(async (req, res) => {
      const body = await readRequestBody(req);
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
        result: { content: [{ type: "text", text: JSON.stringify({ rows: [{ id: 1 }] }) }] }
      }));
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    return {
      port: (upstream.address() as AddressInfo).port,
      close: async () => {
        await new Promise<void>((resolve, reject) => upstream.close((err) => err ? reject(err) : resolve()));
      }
    };
  }

  async function startProxy(): Promise<{ port: number; close: () => Promise<void> }> {
    const { buildProxy } = await import("../proxy/mcp-proxy.js");
    const { server, host } = buildProxy();
    await new Promise<void>((resolve) => server.listen(0, host, resolve));
    return {
      port: (server.address() as AddressInfo).port,
      close: async () => {
        await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
      }
    };
  }

  async function callTool(port: number, name: string, args: unknown, id: string): Promise<string> {
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${TOKEN}`,
        "x-lucy-session-id": SESSION
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } })
    });
    return res.text();
  }

  it("SC-04 restores the cumulative state and the attribution after a real proxy restart", async () => {
    const upstream = await startUpstream();
    process.env.LUCY_PROXY_UPSTREAM_PORT = String(upstream.port);

    try {
      // ── 第一次运行：开两轮问询 + 18 次数据调用 ──────────────────────────
      const first = await startProxy();
      await callTool(first.port, "lucy_begin_question", { intentSummary: "第一轮" }, "begin-1");
      await callTool(first.port, "lucy_begin_question", { intentSummary: "第二轮" }, "begin-2");
      for (let i = 0; i < 18; i += 1) {
        await callTool(first.port, "lucy_read_source", {
          connectionId: "mysql-aliyun",
          sourceName: "superstore_orders"
        }, `read-${i}`);
      }
      const beforeRestart = await import("../proxy/question-experience.js");
      const scopeKey = beforeRestart.budgetScopeKey(
        beforeRestart.budgetIdentityKey("restart_agent", tokenHash(TOKEN).slice(0, 19)),
        SESSION
      );
      const stateBefore = beforeRestart.questionBudget.snapshotScope(scopeKey);
      expect(stateBefore?.calls).toBe(18);
      expect(stateBefore?.round).toBe(2);
      const turnBefore = stateBefore?.turnId;
      expect(turnBefore).toBeTruthy();
      await first.close();

      // ── 重启：清模块注册表 + 起新代理（同一审计库）─────────────────────
      vi.resetModules();
      const second = await startProxy();
      try {
        await callTool(second.port, "lucy_read_source", {
          connectionId: "mysql-aliyun",
          sourceName: "superstore_orders"
        }, "read-after-restart");

        const afterRestart = await import("../proxy/question-experience.js");
        const stateAfter = afterRestart.questionBudget.snapshotScope(scopeKey);
        // 累计字段从持久层恢复：次数连续、轮次与窗口不变、归属恢复。
        expect(stateAfter?.calls).toBe(19);
        expect(stateAfter?.round).toBe(2);
        expect(stateAfter?.windowId).toBe(stateBefore?.windowId);
        expect(stateAfter?.turnId).toBe(turnBefore);
        // 在途占用不恢复（崩溃前在途的进程已死）。
        expect(stateAfter?.inflight ?? 0).toBe(0);
      } finally {
        await second.close();
      }
    } finally {
      await upstream.close();
    }
  });
});
