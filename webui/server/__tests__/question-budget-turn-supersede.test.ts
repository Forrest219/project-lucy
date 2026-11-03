/**
 * 同会话重开问询的显式取代 —— 预算层验收。
 *
 * 权威合同：
 * - Spec `docs/specs/lucy-20261029-question-budget-window-optimization-spec.md`
 *   §6.1（作用域键 `bq:<identityKey>:<sessionId>`）、§6.5（begin_question 在作用域锁内
 *   建新轮次、归档旧轮次、身份隔离、不回改历史行）、§7.5（SC-31～SC-34）、
 *   §7.7（SC-43、SC-44）。
 * - Plan `docs/plans/2026-10-29-lucy-question-budget-window-optimization-plan.md`
 *   §3.2（本文件）与 §4 的 S7 阶段（身份隔离、同会话串行、握手回绑重检）。
 *
 * 本文件只在**预算层**验证：作用域键的身份隔离、同会话 begin_question 串行化后的
 * 活跃 turn 唯一性与轮次唯一性、被取代轮次的归档计数可见且不被后续轮次改写、
 * begin_question 与在途结算并发时不互相覆盖、首次 begin 即持久化 turnId。
 *
 * 「握手回填不重复绑定同一行」「历史审计行不被改写」落在代理/审计层
 * （`webui/server/proxy/mcp-proxy.ts` 的 `lucy_begin_question` 分支、
 * `webui/server/proxy/audit.ts` 的 `bindPriorSessionCalls`），需要真实 SQLite 与
 * 真实代理，本文件无法直接断言，详见交付报告。
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  QUESTION_BUDGET_MAX_CALLS,
  QuestionBudget,
  budgetIdentityKey,
  budgetScopeKey,
  type BudgetPersistence,
  type BudgetState,
} from "../proxy/question-experience.js";

const IDENTITY = budgetIdentityKey("liuzongxuan", "sha256:abc");
const SESSION = "db471e45";

/** 内存持久层夹具（照抄同族文件 `question-budget-window-mode.test.ts`）。 */
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

/** begin_question 的返回值收窄，避免测试里散落 `if (!x.ok)`。 */
function mustBegin(
  result: Awaited<ReturnType<QuestionBudget["beginQuestion"]>>
): { previousTurnId: string | null; state: BudgetState } {
  if (!result.ok) throw new Error(`begin_question 失败：${result.reason}`);
  return { previousTurnId: result.previousTurnId, state: result.state };
}

/** 在稳定作用域下消费一次数据工具额度。 */
function consume(budget: QuestionBudget, now: number, identityKey = IDENTITY, sessionId: string | undefined = SESSION) {
  return budget.consumePersisted(undefined, now, undefined, undefined, {
    identityKey,
    sessionId,
    canContinue: true
  });
}

/** 消费一次并立即零耗时结算（只用于累加 calls，不产生 busyMs）。 */
async function consumeAndSettle(budget: QuestionBudget, now: number) {
  const decision = await consume(budget, now);
  if (decision.action === "allow" && decision.ticket) {
    await budget.settle(decision.ticket, decision.ticket.startMonoMs);
  }
  return decision;
}

/** 归档总耗时（不含当前窗口 busyMs）。 */
function archivedTotal(state: BudgetState | null | undefined): number {
  return Object.values(state?.archivedBusyMsByWindow ?? {}).reduce((sum, value) => sum + value, 0);
}

describe("question budget turn supersede", () => {
  const previousWall = process.env.LUCY_QUESTION_BUDGET_WALL_MODE;
  const previousScope = process.env.LUCY_QUESTION_BUDGET_SCOPE;

  afterEach(() => {
    if (previousWall === undefined) delete process.env.LUCY_QUESTION_BUDGET_WALL_MODE;
    else process.env.LUCY_QUESTION_BUDGET_WALL_MODE = previousWall;
    if (previousScope === undefined) delete process.env.LUCY_QUESTION_BUDGET_SCOPE;
    else process.env.LUCY_QUESTION_BUDGET_SCOPE = previousScope;
  });

  it("SC-31 相同 session 标识下两个身份互不可见、互不可取代", async () => {
    process.env.LUCY_QUESTION_BUDGET_WALL_MODE = "settled";
    process.env.LUCY_QUESTION_BUDGET_SCOPE = "stable";
    const budget = new QuestionBudget();
    const identityA = budgetIdentityKey("user-a", "sha256:aaa");
    const identityB = budgetIdentityKey("user-b", "sha256:bbb");
    const sharedSession = "shared-session";

    // §6.1：identityKey = `${userId}|${tokenHashPrefix}`，作用域键 = `bq:<identityKey>:<sessionId>`。
    expect(identityA).toBe("user-a|sha256:aaa");
    expect(budgetScopeKey(identityA, sharedSession)).toBe("bq:user-a|sha256:aaa:shared-session");
    expect(budgetScopeKey(identityA, sharedSession)).not.toBe(budgetScopeKey(identityB, sharedSession));

    const begunA = mustBegin(await budget.beginQuestion({ identityKey: identityA, sessionId: sharedSession, turnId: "turn-a", now: 1_000 }));
    expect(begunA.state.turnId).toBe("turn-a");
    expect(begunA.state.round).toBe(1);

    // A 先在同会话花掉一次额度，确保 A 的作用域确实处于活跃状态。
    const callA = await consume(budget, 2_000, identityA, sharedSession);
    expect(callA.action).toBe("allow");

    // B 在**相同** session 标识下重开问询。
    const begunB = mustBegin(await budget.beginQuestion({ identityKey: identityB, sessionId: sharedSession, turnId: "turn-b", now: 3_000 }));
    expect(begunB.state.turnId).toBe("turn-b");
    // 不得跨身份取代：B 没有前任轮次。
    expect(begunB.previousTurnId).toBeNull();

    const stateA = budget.snapshotScope(budgetScopeKey(identityA, sharedSession));
    const stateB = budget.snapshotScope(budgetScopeKey(identityB, sharedSession));

    // A 的作用域不受影响：活跃 turn 仍是 A 的，轮次不推进，计数不清零。
    expect(stateA?.turnId).toBe("turn-a");
    expect(stateA?.round).toBe(1);
    expect(stateA?.calls).toBe(1);
    expect(stateA?.busyMs).toBe(0);
    expect(stateA?.archivedBusyMsByWindow ?? {}).toEqual({});

    // B 落在自己的作用域里，与 A 完全隔离。
    expect(stateB?.turnId).toBe("turn-b");
    expect(stateB?.round).toBe(1);
    expect(stateB?.calls).toBe(0);
  });

  it("SC-32 无会话桶按身份隔离，同身份共享同一个无会话桶", async () => {
    process.env.LUCY_QUESTION_BUDGET_WALL_MODE = "settled";
    process.env.LUCY_QUESTION_BUDGET_SCOPE = "stable";
    const budget = new QuestionBudget();
    const identityA = budgetIdentityKey("user-a", "sha256:aaa");
    const identityB = budgetIdentityKey("user-b", "sha256:bbb");

    // §6.1：无会话时 sessionId 归一为 `-`。
    expect(budgetScopeKey(identityA)).toBe("bq:user-a|sha256:aaa:-");
    expect(budgetScopeKey(identityA, undefined)).toBe(budgetScopeKey(identityA, ""));
    expect(budgetScopeKey(identityA)).not.toBe(budgetScopeKey(identityB));

    const begunA = mustBegin(await budget.beginQuestion({ identityKey: identityA, sessionId: undefined, turnId: "turn-a", now: 1_000 }));
    expect(begunA.state.turnId).toBe("turn-a");
    expect(begunA.state.round).toBe(1);

    // 另一个身份用**空** session 重开问询。
    const begunB = mustBegin(await budget.beginQuestion({ identityKey: identityB, sessionId: "", turnId: "turn-b", now: 2_000 }));
    expect(begunB.previousTurnId).toBeNull();

    const bucketA = budget.snapshotScope(budgetScopeKey(identityA));
    const bucketB = budget.snapshotScope(budgetScopeKey(identityB));

    // 无会话桶归属 A，且不与任何其他身份的桶共享。
    expect(bucketA?.turnId).toBe("turn-a");
    expect(bucketA?.round).toBe(1);
    expect(bucketB?.turnId).toBe("turn-b");
    expect(bucketB?.round).toBe(1);
    expect(bucketA?.scopeKey).not.toBe(bucketB?.scopeKey);
  });

  it("SC-33 同会话并发 begin_question 被串行化：最终只有一个活跃 turn，轮次不重复", async () => {
    process.env.LUCY_QUESTION_BUDGET_WALL_MODE = "settled";
    process.env.LUCY_QUESTION_BUDGET_SCOPE = "stable";
    const budget = new QuestionBudget();
    const scopeKey = budgetScopeKey(IDENTITY, SESSION);

    // 同一身份 + 会话，两个**并发** begin_question。
    const [first, second] = await Promise.all([
      budget.beginQuestion({ identityKey: IDENTITY, sessionId: SESSION, turnId: "turn-concurrent-1", now: 1_000 }),
      budget.beginQuestion({ identityKey: IDENTITY, sessionId: SESSION, turnId: "turn-concurrent-2", now: 1_000 })
    ]);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);

    const state = budget.snapshotScope(scopeKey);
    // 最终只有一个活跃 turn，且是这两次 begin 之一。
    expect(["turn-concurrent-1", "turn-concurrent-2"]).toContain(state?.turnId);
    const activeCount = [first, second].filter((item) => item.ok && item.state.turnId === state?.turnId).length;
    expect(activeCount).toBe(1);
    // 无重复轮次：两次 begin 落在不同轮次上，且最终轮次是较新的那个。
    const rounds = [first, second].map((item) => (item.ok ? item.state.round : null)).sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(rounds).toEqual([1, 2]);
    expect(state?.round).toBe(2);
    // 计数归零、窗口递增、只有一个活跃 turn。
    expect(state?.calls).toBe(0);
    expect(state?.busyMs).toBe(0);
    expect(state?.windowId).toBe(2);
    expect(state?.inflight).toBe(0);

    // 被取代的那一轮以 previousTurnId 的形式被报告，且只被报告一次。
    const supersedes = [first, second].filter((item) => item.ok && item.previousTurnId !== null);
    expect(supersedes).toHaveLength(1);
  });

  it("SC-33 同一 turnId 重复 begin 是幂等的：不推进轮次、不覆盖已提交行", async () => {
    process.env.LUCY_QUESTION_BUDGET_WALL_MODE = "settled";
    process.env.LUCY_QUESTION_BUDGET_SCOPE = "stable";
    const seeded = memoryPersistence();
    const budget = new QuestionBudget();
    budget.setPersistence(seeded.persistence);
    const scopeKey = budgetScopeKey(IDENTITY, SESSION);

    const first = mustBegin(await budget.beginQuestion({ identityKey: IDENTITY, sessionId: SESSION, turnId: "turn-same", now: 1_000 }));
    expect(first.state.round).toBe(1);
    expect(first.state.windowId).toBe(1);

    // 同一 turnId 再次 begin：幂等键 `begin:<turnId>` 命中已提交键，
    // 返回已提交行，不产生第二个轮次，也不覆盖磁盘。
    const again = mustBegin(await budget.beginQuestion({ identityKey: IDENTITY, sessionId: SESSION, turnId: "turn-same", now: 2_000 }));
    expect(again.state.round).toBe(1);
    expect(again.state.windowId).toBe(1);
    expect(again.state.turnId).toBe("turn-same");

    const state = budget.snapshotScope(scopeKey);
    expect(state?.round).toBe(1);
    expect(state?.windowId).toBe(1);
    // 磁盘行未被候选态覆盖（候选态里的归档项没有落库）。
    expect(seeded.rows.get(scopeKey)?.round).toBe(1);
    expect(seeded.rows.get(scopeKey)?.archivedBusyMsByWindow ?? {}).toEqual({});
  });

  it("SC-34 被取代轮次的归档计数可见，且不被后续轮次改写", async () => {
    process.env.LUCY_QUESTION_BUDGET_WALL_MODE = "settled";
    process.env.LUCY_QUESTION_BUDGET_SCOPE = "stable";
    const seeded = memoryPersistence();
    const budget = new QuestionBudget();
    budget.setPersistence(seeded.persistence);
    let mono = 0;
    budget.setMonoClock(() => mono);
    const scopeKey = budgetScopeKey(IDENTITY, SESSION);

    // 第 1 轮：花掉 3000ms 已结算耗时。
    mustBegin(await budget.beginQuestion({ identityKey: IDENTITY, sessionId: SESSION, turnId: "turn-1", now: 1_000 }));
    const firstCall = await consume(budget, 2_000);
    if (firstCall.action !== "allow" || !firstCall.ticket) throw new Error("预期放行");
    mono = 3_000;
    await budget.settle(firstCall.ticket, mono);
    expect(budget.snapshotScope(scopeKey)?.busyMs).toBe(3_000);

    // 第 2 轮：取代第 1 轮，第 1 轮的耗时进入归档。
    mustBegin(await budget.beginQuestion({ identityKey: IDENTITY, sessionId: SESSION, turnId: "turn-2", now: 4_000 }));
    const afterFirstSupersede = budget.snapshotScope(scopeKey);
    expect(afterFirstSupersede?.archivedBusyMsByWindow?.["1:1"]).toBe(3_000);
    expect(afterFirstSupersede?.busyMs).toBe(0);
    expect(afterFirstSupersede?.round).toBe(2);

    // 第 2 轮自己的 2000ms 只能落在当前窗口，不得回写到第 1 轮的归档项。
    const secondCall = await consume(budget, 5_000);
    if (secondCall.action !== "allow" || !secondCall.ticket) throw new Error("预期放行");
    mono = 5_000;
    await budget.settle(secondCall.ticket, mono);
    const duringSecond = budget.snapshotScope(scopeKey);
    expect(duringSecond?.busyMs).toBe(2_000);
    expect(duringSecond?.archivedBusyMsByWindow?.["1:1"]).toBe(3_000);

    // 第 3 轮：取代第 2 轮。
    mustBegin(await budget.beginQuestion({ identityKey: IDENTITY, sessionId: SESSION, turnId: "turn-3", now: 6_000 }));
    const finalState = budget.snapshotScope(scopeKey);
    expect(finalState?.turnId).toBe("turn-3");
    expect(finalState?.round).toBe(3);
    expect(finalState?.busyMs).toBe(0);
    // 被取代轮次的归档计数都还在，且各自数值未被改写。
    expect(finalState?.archivedBusyMsByWindow?.["1:1"]).toBe(3_000);
    expect(finalState?.archivedBusyMsByWindow?.["2:2"]).toBe(2_000);
    // 轮次归档计数可见：两个被取代轮次各占一条归档键。
    expect(Object.keys(finalState?.archivedBusyMsByWindow ?? {})).toEqual(["1:1", "2:2"]);
    expect(archivedTotal(finalState)).toBe(5_000);
    // 落库的归档同样保留（历史记录不被后续轮次改写）。
    expect(seeded.rows.get(scopeKey)?.archivedBusyMsByWindow).toEqual({ "1:1": 3_000, "2:2": 2_000 });
  });

  it("SC-43 begin_question 与在途结算并发：后完成者不覆盖对方的轮次或耗时，在途票据按准入时的 round/window 归档", async () => {
    process.env.LUCY_QUESTION_BUDGET_WALL_MODE = "settled";
    process.env.LUCY_QUESTION_BUDGET_SCOPE = "stable";
    const seeded = memoryPersistence();
    const budget = new QuestionBudget();
    budget.setPersistence(seeded.persistence);
    let mono = 0;
    budget.setMonoClock(() => mono);
    const scopeKey = budgetScopeKey(IDENTITY, SESSION);

    mustBegin(await budget.beginQuestion({ identityKey: IDENTITY, sessionId: SESSION, turnId: "turn-1", now: 1_000 }));

    // 同一作用域已有在途数据调用（不结算）。
    const inflight = await consume(budget, 2_000);
    if (inflight.action !== "allow" || !inflight.ticket) throw new Error("预期放行");
    expect(inflight.ticket.round).toBe(1);
    expect(inflight.ticket.windowId).toBe(1);
    expect(budget.snapshotScope(scopeKey)?.inflight).toBe(1);

    // begin_question 与该调用的结算**并发**。
    mono = 5_000;
    const [begun, settled] = await Promise.all([
      budget.beginQuestion({ identityKey: IDENTITY, sessionId: SESSION, turnId: "turn-2", now: 3_000 }),
      budget.settle(inflight.ticket, mono)
    ]);
    expect(begun.ok).toBe(true);
    expect(settled.settled).toBe(true);

    const state = budget.snapshotScope(scopeKey);
    // 后完成的写入没有覆盖对方已提交的轮次。
    expect(state?.turnId).toBe("turn-2");
    expect(state?.round).toBe(2);
    expect(state?.windowId).toBe(2);
    // 也没有把旧票据的耗时写进新轮次的当前窗口。
    expect(state?.busyMs).toBe(0);
    // 在途票据仍按准入时的 round / windowId 归档。
    expect(state?.archivedBusyMsByWindow?.["1:1"]).toBe(5_000);
    expect(state?.inflight).toBe(0);
    // 落库行同样保持新轮次与归档分离。
    expect(seeded.rows.get(scopeKey)?.round).toBe(2);
    expect(seeded.rows.get(scopeKey)?.busyMs).toBe(0);
    expect(seeded.rows.get(scopeKey)?.archivedBusyMsByWindow?.["1:1"]).toBe(5_000);
  });

  it("SC-43 结算先于 begin 完成时同样不覆盖轮次与耗时", async () => {
    process.env.LUCY_QUESTION_BUDGET_WALL_MODE = "settled";
    process.env.LUCY_QUESTION_BUDGET_SCOPE = "stable";
    const budget = new QuestionBudget();
    let mono = 0;
    budget.setMonoClock(() => mono);
    const scopeKey = budgetScopeKey(IDENTITY, SESSION);

    mustBegin(await budget.beginQuestion({ identityKey: IDENTITY, sessionId: SESSION, turnId: "turn-1", now: 1_000 }));
    const inflight = await consume(budget, 2_000);
    if (inflight.action !== "allow" || !inflight.ticket) throw new Error("预期放行");

    // 结算先落库（耗时进入当前窗口），随后 begin 才提交。
    mono = 4_000;
    await budget.settle(inflight.ticket, mono);
    expect(budget.snapshotScope(scopeKey)?.busyMs).toBe(4_000);

    const begun = mustBegin(await budget.beginQuestion({ identityKey: IDENTITY, sessionId: SESSION, turnId: "turn-2", now: 3_000 }));
    expect(begun.state.round).toBe(2);
    expect(begun.state.busyMs).toBe(0);
    // 后完成的 begin 没有把已结算的耗时丢掉，而是归档到被取代轮次。
    expect(begun.state.archivedBusyMsByWindow?.["1:1"]).toBe(4_000);

    const state = budget.snapshotScope(scopeKey);
    expect(state?.turnId).toBe("turn-2");
    expect(state?.round).toBe(2);
    expect(state?.busyMs).toBe(0);
    expect(state?.archivedBusyMsByWindow?.["1:1"]).toBe(4_000);
  });

  it("SC-44 全新作用域第一次 begin 即持久化 turnId，第二次 begin 轮次 +1 且旧 presentedToken 失效", async () => {
    process.env.LUCY_QUESTION_BUDGET_WALL_MODE = "settled";
    process.env.LUCY_QUESTION_BUDGET_SCOPE = "stable";
    const seeded = memoryPersistence();
    const budget = new QuestionBudget();
    budget.setPersistence(seeded.persistence);
    const scopeKey = budgetScopeKey(IDENTITY, SESSION);

    // 全新作用域：初态 turnId 为空。
    const first = mustBegin(await budget.beginQuestion({ identityKey: IDENTITY, sessionId: SESSION, turnId: "turn-1", now: 1_000 }));
    // 第一次 begin 就持久化 turnId（内存与落库两处）。
    expect(first.state.turnId).toBe("turn-1");
    expect(first.state.round).toBe(1);
    expect(first.state.windowId).toBe(1);
    expect(budget.snapshotScope(scopeKey)?.turnId).toBe("turn-1");
    expect(seeded.rows.get(scopeKey)?.turnId).toBe("turn-1");

    // 第 1 轮耗尽预算，拿到本轮凭证。
    for (let i = 0; i < QUESTION_BUDGET_MAX_CALLS; i += 1) await consumeAndSettle(budget, 2_000);
    const stopped = await consume(budget, 2_000);
    expect(stopped.action).toBe("stop");
    if (stopped.action !== "stop") return;
    const oldToken = stopped.continueToken;
    expect(oldToken).toBe("turn-1");
    expect(budget.snapshotScope(scopeKey)?.presentedToken).toBe("turn-1");

    // 第二次 begin：轮次 +1，旧 presentedToken 失效。
    const second = mustBegin(await budget.beginQuestion({ identityKey: IDENTITY, sessionId: SESSION, turnId: "turn-2", now: 3_000 }));
    expect(second.previousTurnId).toBe("turn-1");
    expect(second.state.round).toBe(2);
    expect(second.state.windowId).toBe(2);
    expect(second.state.calls).toBe(0);
    expect(second.state.busyMs).toBe(0);
    expect(second.state.continuations).toBe(0);
    expect(second.state.pendingToken).toBeNull();
    expect(second.state.presentedToken).toBeNull();
    expect(budget.snapshotScope(scopeKey)?.presentedToken).toBeNull();
    expect(seeded.rows.get(scopeKey)?.presentedToken).toBeNull();

    // 行为层面：旧凭证不再生效（第 2 轮重新耗尽后下发的凭证是新的，旧凭证声明被拒）。
    for (let i = 0; i < QUESTION_BUDGET_MAX_CALLS; i += 1) await consumeAndSettle(budget, 4_000);
    const stoppedAgain = await consume(budget, 4_000);
    expect(stoppedAgain.action).toBe("stop");
    if (stoppedAgain.action !== "stop") return;
    expect(stoppedAgain.continueToken).toBe("turn-2");
    expect(stoppedAgain.continueToken).not.toBe(oldToken);
    expect(await budget.declareContinuation(scopeKey, oldToken)).toMatchObject({ ok: false, reason: "mismatch" });
  });

  it("SC-44 begin 前已有消费时，旧 busyMs 先进入归档再归零", async () => {
    process.env.LUCY_QUESTION_BUDGET_WALL_MODE = "settled";
    process.env.LUCY_QUESTION_BUDGET_SCOPE = "stable";
    const seeded = memoryPersistence();
    const budget = new QuestionBudget();
    budget.setPersistence(seeded.persistence);
    let mono = 0;
    budget.setMonoClock(() => mono);
    const scopeKey = budgetScopeKey(IDENTITY, SESSION);

    // begin 之前先消费并结算，攒出 busyMs（此时作用域 round/window 仍是 0）。
    mono = 1_000;
    const call = await consume(budget, 1_000);
    if (call.action !== "allow" || !call.ticket) throw new Error("预期放行");
    expect(call.ticket.round).toBe(0);
    expect(call.ticket.windowId).toBe(0);
    mono = 6_000;
    await budget.settle(call.ticket, mono);
    expect(budget.snapshotScope(scopeKey)?.busyMs).toBe(5_000);

    // 第一次 begin：时长先进入归档，再归零。
    const begun = mustBegin(await budget.beginQuestion({ identityKey: IDENTITY, sessionId: SESSION, turnId: "turn-late", now: 7_000 }));
    expect(begun.state.round).toBe(1);
    expect(begun.state.busyMs).toBe(0);
    expect(begun.state.archivedBusyMsByWindow?.["0:0"]).toBe(5_000);
    expect(budget.snapshotScope(scopeKey)?.busyMs).toBe(0);
    expect(budget.snapshotScope(scopeKey)?.archivedBusyMsByWindow?.["0:0"]).toBe(5_000);
    expect(seeded.rows.get(scopeKey)?.archivedBusyMsByWindow?.["0:0"]).toBe(5_000);
    expect(seeded.rows.get(scopeKey)?.busyMs).toBe(0);
  });
});
