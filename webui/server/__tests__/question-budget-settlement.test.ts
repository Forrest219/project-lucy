/**
 * Spec 20261029 §6.2 / §7.2 —— 统一结算与窗口票据（S3 阶段）。
 *
 * 合同来源：
 *   - Spec §6.2 统一结算与窗口票据（D1 / R02 / R04）：结算点、票据、归档、并发上限、绝对执行时限。
 *   - Spec §6.1 稳定预算身份与状态模型：MAX_CALLS=20 / MAX_BUSY_MS=120_000 / MAX_INFLIGHT=4 / ABS_EXEC_MS=120_000。
 *   - Spec §7.2 墙钟口径与结算：SC-11 / SC-12 / SC-13 / SC-14。
 *
 * 单元级边界：只驱动 `QuestionBudget`（`new QuestionBudget()` + 内存 persistence），
 * 不起真实代理、不连数据库；单调时钟由 `setMonoClock` 注入，不真实等待 120 秒。
 *
 * 代理层边界（本文件无法直接断言的部分）：
 *   - SC-13 的「触发取消上游 / 取消确认」由代理层负责（`webui/server/proxy/mcp-proxy.ts`），
 *     本文件只断言**结算层不因连接关闭提前少计**这一层语义。
 *   - SC-14 的「Lucy 停止等待」与「审计标记超时且取消未确认」的落盘由代理层负责，
 *     本文件断言结算层的**封顶记账、在途槽释放、超时未确认标记回传**。
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  QUESTION_BUDGET_ABS_EXEC_MS,
  QUESTION_BUDGET_MAX_CALLS,
  QUESTION_BUDGET_MAX_INFLIGHT,
  QuestionBudget,
  budgetIdentityKey,
  budgetScopeKey,
  type BudgetDecision,
  type BudgetPersistence,
  type BudgetState,
} from "../proxy/question-experience.js";

/** 合成身份与会话：不使用任何真实客户标识或凭据。 */
const IDENTITY = budgetIdentityKey("unit-test-user", "sha256:unit0001");
const SESSION = "session-synthetic";
const SCOPE_KEY = budgetScopeKey(IDENTITY, SESSION);

function memoryPersistence(seed?: BudgetState): {
  persistence: BudgetPersistence;
  rows: Map<string, BudgetState>;
  keys: Map<string, Set<string>>;
  failLoad: { current: boolean };
  failSave: { current: boolean };
} {
  const rows = new Map<string, BudgetState>();
  const keys = new Map<string, Set<string>>();
  if (seed?.scopeKey) rows.set(seed.scopeKey, seed);
  const failLoad = { current: false };
  const failSave = { current: false };
  const persistence: BudgetPersistence = {
    async load(scopeKey) {
      if (failLoad.current) throw new Error("unreadable");
      const row = rows.get(scopeKey);
      if (!row) return null;
      return { row: { ...row, archivedBusyMsByWindow: { ...(row.archivedBusyMsByWindow ?? {}) } }, appliedKeys: [...(keys.get(scopeKey) ?? [])] };
    },
    async save(scopeKey, state, idempotencyKey) {
      if (failSave.current) throw new Error("unwritable");
      const known = keys.get(scopeKey) ?? new Set<string>();
      if (idempotencyKey && known.has(idempotencyKey)) {
        const row = rows.get(scopeKey)!;
        return { row, appliedKeys: [...known] };
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
  return { persistence, rows, keys, failLoad, failSave };
}

/** 走持久化路径准入一次数据调用，返回完整判定（不自动结算）。 */
async function admit(budget: QuestionBudget, now: number, turnId?: string): Promise<BudgetDecision> {
  return budget.consumePersisted(turnId, now, undefined, undefined, {
    identityKey: IDENTITY,
    sessionId: SESSION,
    canContinue: true
  });
}

describe("question budget settlement · S3 统一结算与窗口票据", () => {
  const previousWall = process.env.LUCY_QUESTION_BUDGET_WALL_MODE;
  const previousScope = process.env.LUCY_QUESTION_BUDGET_SCOPE;

  afterEach(() => {
    if (previousWall === undefined) delete process.env.LUCY_QUESTION_BUDGET_WALL_MODE;
    else process.env.LUCY_QUESTION_BUDGET_WALL_MODE = previousWall;
    if (previousScope === undefined) delete process.env.LUCY_QUESTION_BUDGET_SCOPE;
    else process.env.LUCY_QUESTION_BUDGET_SCOPE = previousScope;
  });

  it("SC-11 并发超限：前 3 个新请求放行，第 5 个并发请求被拒且不消耗 calls、不累计 busyMs", async () => {
    process.env.LUCY_QUESTION_BUDGET_WALL_MODE = "settled";
    process.env.LUCY_QUESTION_BUDGET_SCOPE = "stable";
    const seeded = memoryPersistence();
    const budget = new QuestionBudget();
    budget.setPersistence(seeded.persistence);
    budget.setMonoClock(() => 0);

    // 初态：busyMs=0，已有 1 个数据调用在途
    const initial = await admit(budget, 1_000);
    expect(initial.action).toBe("allow");
    expect(budget.snapshotScope(SCOPE_KEY)?.inflight).toBe(1);
    expect(budget.snapshotScope(SCOPE_KEY)?.busyMs).toBe(0);

    // 再并发提交 4 个数据调用：前 3 个放行，在途达到 MAX_INFLIGHT
    for (let i = 0; i < QUESTION_BUDGET_MAX_INFLIGHT - 1; i += 1) {
      const decision = await admit(budget, 1_000);
      expect(decision.action).toBe("allow");
    }
    expect(budget.snapshotScope(SCOPE_KEY)?.inflight).toBe(QUESTION_BUDGET_MAX_INFLIGHT);

    // 先取磁盘行快照：并发超限不得写预算状态行
    const beforeReject = { ...(seeded.rows.get(SCOPE_KEY) ?? {}) };

    // 第 4 个新请求（并发序号 5）以「并发超限」拒绝
    const rejected = await admit(budget, 1_000);
    expect(rejected.action).toBe("reject");
    if (rejected.action === "reject") {
      expect(rejected.reason).toBe("question_budget_concurrency_exceeded");
    }

    const state = budget.snapshotScope(SCOPE_KEY);
    // 被拒的那次不消耗 calls（1 次初态在途 + 3 次放行 = 4）
    expect(state?.calls).toBe(QUESTION_BUDGET_MAX_INFLIGHT);
    // 不累计 busyMs
    expect(state?.busyMs).toBe(0);
    // 在途槽没有被这次拒绝额外占用，并发达标
    expect(state?.inflight).toBe(QUESTION_BUDGET_MAX_INFLIGHT);
    expect(state?.peakConcurrency).toBe(QUESTION_BUDGET_MAX_INFLIGHT);
    // 磁盘行未被这次拒绝改动
    expect(seeded.rows.get(SCOPE_KEY)?.calls).toBe(beforeReject.calls);
    expect(seeded.rows.get(SCOPE_KEY)?.busyMs).toBe(0);
  });

  it("SC-12 窗口票据：旧窗口归档 120 秒、新窗口 busyMs 不受影响、重复结算只生效一次", async () => {
    process.env.LUCY_QUESTION_BUDGET_WALL_MODE = "settled";
    process.env.LUCY_QUESTION_BUDGET_SCOPE = "stable";
    const seeded = memoryPersistence();
    const budget = new QuestionBudget();
    budget.setPersistence(seeded.persistence);
    let mono = 0;
    budget.setMonoClock(() => mono);

    await budget.beginQuestion({ identityKey: IDENTITY, sessionId: SESSION, turnId: "turn-old", now: 1 });

    // 旧窗口先结算 110 秒
    const first = await admit(budget, 1);
    if (first.action !== "allow" || !first.ticket) throw new Error("expected allow");
    mono = 110_000;
    await budget.settle(first.ticket, mono);
    expect(budget.snapshotScope(SCOPE_KEY)?.busyMs).toBe(110_000);

    // 请求 A 仍在途（未结算）
    const a = await admit(budget, 1);
    if (a.action !== "allow" || !a.ticket) throw new Error("expected allow");
    expect(a.ticket.settled).toBe(false);
    expect(budget.snapshotScope(SCOPE_KEY)?.inflight).toBe(1);
    // Spec §6.2 archiveKey(round, windowId)
    const archiveKey = `${a.ticket.round}:${a.ticket.windowId}`;

    // A 未完成时把次数打到上限 → 停机 → 声明续查 → B 进入新窗口。
    // 每次准入后立即结算（时长增量为 0），避免把在途槽占满而触发并发超限。
    for (let i = 0; i < QUESTION_BUDGET_MAX_CALLS - 2; i += 1) {
      const filler = await admit(budget, 2);
      if (filler.action !== "allow" || !filler.ticket) throw new Error("expected allow");
      await budget.settle(filler.ticket, filler.ticket.startMonoMs);
    }
    const stopped = await admit(budget, 2);
    expect(stopped.action).toBe("stop");
    if (stopped.action !== "stop") throw new Error("expected stop");
    expect(stopped.reason).toBe("question_budget_exhausted");

    const declared = await budget.declareContinuation(SCOPE_KEY, stopped.continueToken);
    expect(declared.ok).toBe(true);

    const b = await admit(budget, 3);
    if (b.action !== "allow" || !b.ticket) throw new Error("expected allow");
    // B 进入新窗口：窗口版本 +1，已结算时长归零
    expect(b.ticket.windowId).toBe(a.ticket.windowId + 1);
    expect(budget.snapshotScope(SCOPE_KEY)?.busyMs).toBe(0);

    // A 晚到结算 10 秒 → 按票据的旧窗口归档，不进新窗口
    mono = 120_000;
    await budget.settle(a.ticket, mono);
    const afterLate = budget.snapshotScope(SCOPE_KEY);
    expect(afterLate?.archivedBusyMsByWindow?.[archiveKey]).toBe(120_000); // 110 + 10
    expect(afterLate?.busyMs).toBe(0); // 新窗口不受影响
    expect(
      Object.values(afterLate?.archivedBusyMsByWindow ?? {}).reduce((sum, value) => sum + value, 0)
    ).toBe(120_000);
    expect(seeded.rows.get(SCOPE_KEY)?.archivedBusyMsByWindow?.[archiveKey]).toBe(120_000);

    // 重复结算只生效一次
    await budget.settle(a.ticket, mono + 10_000);
    const afterRepeat = budget.snapshotScope(SCOPE_KEY);
    expect(afterRepeat?.archivedBusyMsByWindow?.[archiveKey]).toBe(120_000);
    expect(afterRepeat?.busyMs).toBe(0);
    expect(
      Object.values(afterRepeat?.archivedBusyMsByWindow ?? {}).reduce((sum, value) => sum + value, 0)
    ).toBe(120_000);
  });

  it("SC-13 结算层不因客户端断开而提前少计：断开不结算，取消确认后按已耗时结算", async () => {
    process.env.LUCY_QUESTION_BUDGET_WALL_MODE = "settled";
    process.env.LUCY_QUESTION_BUDGET_SCOPE = "stable";
    const seeded = memoryPersistence();
    const budget = new QuestionBudget();
    budget.setPersistence(seeded.persistence);
    let mono = 0;
    budget.setMonoClock(() => mono);

    const admitted = await admit(budget, 1);
    if (admitted.action !== "allow" || !admitted.ticket) throw new Error("expected allow");
    const ticket = admitted.ticket;

    // 客户端提前断开连接（res.close）：断开本身不是结算点，不触发任何结算
    mono = 5_000;
    expect(ticket.settled).toBe(false);
    expect(budget.snapshotScope(SCOPE_KEY)?.inflight).toBe(1);
    expect(budget.snapshotScope(SCOPE_KEY)?.busyMs).toBe(0);

    // 取消上游得到确认后才结算：记的是「取消确认时」的已耗时，不是断开时刻
    mono = 20_000;
    const result = await budget.settle(ticket, mono);
    expect(result.settled).toBe(true);
    const state = budget.snapshotScope(SCOPE_KEY);
    expect(state?.busyMs).toBe(20_000);
    // 没有被截断到客户端断开的那一刻
    expect(state?.busyMs).toBeGreaterThan(5_000);
    expect(state?.inflight).toBe(0);
    expect(seeded.rows.get(SCOPE_KEY)?.busyMs).toBe(20_000);

    // 对照：增量由结算时点决定 —— 若在断开时刻结算就只会记 5 秒。
    // 说明上面的 20 秒不是「结算层自动补记」，而是结算点选在取消确认之后的结果。
    const control = new QuestionBudget();
    control.setPersistence(memoryPersistence().persistence);
    control.setMonoClock(() => 0);
    const controlDecision = await admit(control, 1);
    if (controlDecision.action !== "allow" || !controlDecision.ticket) throw new Error("expected allow");
    await control.settle(controlDecision.ticket, 5_000);
    expect(control.snapshotScope(SCOPE_KEY)?.busyMs).toBe(5_000);
  });

  it("SC-14 绝对执行时限：增量封顶为 ABS_EXEC_MS、释放在途槽、回传超时且取消未确认", async () => {
    process.env.LUCY_QUESTION_BUDGET_WALL_MODE = "settled";
    process.env.LUCY_QUESTION_BUDGET_SCOPE = "stable";
    const seeded = memoryPersistence();
    const budget = new QuestionBudget();
    budget.setPersistence(seeded.persistence);
    budget.setMonoClock(() => 0);

    const admitted = await admit(budget, 1);
    if (admitted.action !== "allow" || !admitted.ticket) throw new Error("expected allow");
    const ticket = admitted.ticket;

    // 上游持续输出进度、取消没有确认；等待越过 ABS_EXEC_MS 才结算
    const result = await budget.settle(ticket, QUESTION_BUDGET_ABS_EXEC_MS + 50_000, {
      timeoutUnconfirmed: true
    });
    expect(result.settled).toBe(true);
    // 审计标记「超时且取消未确认」的事实由结算结果回传给调用方
    expect(result.timeoutUnconfirmed).toBe(true);

    const state = budget.snapshotScope(SCOPE_KEY);
    // 记账增量封顶为 ABS_EXEC_MS（实际等待越过了时限）
    expect(state?.busyMs).toBe(QUESTION_BUDGET_ABS_EXEC_MS);
    // 在途槽释放
    expect(state?.inflight).toBe(0);
    expect(state?.currentConcurrency).toBe(0);
    expect(seeded.rows.get(SCOPE_KEY)?.busyMs).toBe(QUESTION_BUDGET_ABS_EXEC_MS);

    // 内部查询路径（认证路由 / 报表模板旁路）与数据调用路径共用同一套
    // consumePersisted / settle 结算 API，因此同一个绝对执行时限封顶对它同样生效。
    const internal = new QuestionBudget();
    internal.setPersistence(memoryPersistence().persistence);
    internal.setMonoClock(() => 0);
    const internalDecision = await internal.consumePersisted(
      "turn-internal",
      1,
      undefined,
      undefined,
      {
        identityKey: budgetIdentityKey("unit-test-user", "sha256:unit0002"),
        sessionId: "session-internal",
        canContinue: true
      }
    );
    if (internalDecision.action !== "allow" || !internalDecision.ticket) throw new Error("expected allow");
    const internalResult = await internal.settle(
      internalDecision.ticket,
      QUESTION_BUDGET_ABS_EXEC_MS + 50_000,
      { timeoutUnconfirmed: true }
    );
    expect(internalResult.settled).toBe(true);
    expect(internalResult.timeoutUnconfirmed).toBe(true);
    const internalScope = budgetScopeKey(budgetIdentityKey("unit-test-user", "sha256:unit0002"), "session-internal");
    expect(internal.snapshotScope(internalScope)?.busyMs).toBe(QUESTION_BUDGET_ABS_EXEC_MS);
    expect(internal.snapshotScope(internalScope)?.inflight).toBe(0);
  });
});
