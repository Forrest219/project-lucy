/**
 * Spec 162 修订 / Plan S4 —— 事故等价复现与灰度开关回归。
 *
 * 覆盖 SC-10（`settled` 放行 / `elapsed` 拒绝，同一用例内对照）、
 * SC-37（`LUCY_QUESTION_BUDGET_WALL_MODE=elapsed` 只回退时间判定）、
 * SC-38（`LUCY_QUESTION_BUDGET_SCOPE=legacy` 回到旧作用域键）、
 * SC-39（`LUCY_QUESTION_BUDGET=off` 预算整体关闭）。
 *
 * 权威合同：`docs/specs/lucy-20261029-question-budget-window-optimization-spec.md`
 * §6.1 / §6.3 / §7.2 / §7.6。
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  QUESTION_BUDGET_MAX_BUSY_MS,
  QUESTION_BUDGET_MAX_CALLS,
  QUESTION_BUDGET_MAX_INFLIGHT,
  QuestionBudget,
  budgetIdentityKey,
  budgetScopeKey,
  isQuestionDataTool,
  questionBudgetEnabled,
  type BudgetPersistence,
  type BudgetState,
} from "../proxy/question-experience.js";

const IDENTITY = budgetIdentityKey("liuzongxuan", "sha256:abc");
const SESSION = "db471e45";
const INCIDENT_TURN = "lucy_ed29af56";

function memoryPersistence(): {
  persistence: BudgetPersistence;
  rows: Map<string, BudgetState>;
  keys: Map<string, Set<string>>;
} {
  const rows = new Map<string, BudgetState>();
  const keys = new Map<string, Set<string>>();
  const persistence: BudgetPersistence = {
    async load(scopeKey) {
      const row = rows.get(scopeKey);
      if (!row) return null;
      return {
        row: { ...row, archivedBusyMsByWindow: { ...(row.archivedBusyMsByWindow ?? {}) } },
        appliedKeys: [...(keys.get(scopeKey) ?? [])]
      };
    },
    async save(scopeKey, state, idempotencyKey) {
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
  return { persistence, rows, keys };
}

/** 走稳定作用域的一次数据调用；可选立即结算。 */
async function dataCall(
  budget: QuestionBudget,
  now: number,
  options?: { continueToken?: string; settle?: boolean }
): Promise<Awaited<ReturnType<QuestionBudget["consumePersisted"]>>> {
  const decision = await budget.consumePersisted(undefined, now, options?.continueToken, undefined, {
    identityKey: IDENTITY,
    sessionId: SESSION,
    canContinue: true
  });
  if (options?.settle !== false && decision.action === "allow" && decision.ticket) {
    await budget.settle(decision.ticket, decision.ticket.startMonoMs);
  }
  return decision;
}

describe("question budget incident regression and rollout switches", () => {
  const previousWall = process.env.LUCY_QUESTION_BUDGET_WALL_MODE;
  const previousScope = process.env.LUCY_QUESTION_BUDGET_SCOPE;
  const previousBudget = process.env.LUCY_QUESTION_BUDGET;

  afterEach(() => {
    if (previousWall === undefined) delete process.env.LUCY_QUESTION_BUDGET_WALL_MODE;
    else process.env.LUCY_QUESTION_BUDGET_WALL_MODE = previousWall;
    if (previousScope === undefined) delete process.env.LUCY_QUESTION_BUDGET_SCOPE;
    else process.env.LUCY_QUESTION_BUDGET_SCOPE = previousScope;
    if (previousBudget === undefined) delete process.env.LUCY_QUESTION_BUDGET;
    else process.env.LUCY_QUESTION_BUDGET = previousBudget;
  });

  it("SC-10 the incident read is admitted under settled and refused under elapsed", async () => {
    // 事故等价链：同一 turn 先 lucy_catalog → 空闲 318 秒 → 首次读 source。
    // catalog 是不计预算的本地工具，因此这条链只考验「空闲是否计入额度」。
    expect(isQuestionDataTool("lucy_catalog")).toBe(false);
    expect(isQuestionDataTool("lucy_read_source")).toBe(true);

    const run = async (mode: "settled" | "elapsed") => {
      process.env.LUCY_QUESTION_BUDGET_WALL_MODE = mode;
      process.env.LUCY_QUESTION_BUDGET_SCOPE = "stable";
      const budget = new QuestionBudget();
      const begun = await budget.beginQuestion({
        identityKey: IDENTITY,
        sessionId: SESSION,
        turnId: INCIDENT_TURN,
        now: 0
      });
      expect(begun.ok).toBe(true);
      // 318 秒空闲后的第一次数据读取。
      return dataCall(budget, 318_000);
    };

    const settled = await run("settled");
    expect(settled.action).toBe("allow");

    const elapsed = await run("elapsed");
    expect(elapsed.action).toBe("stop");
    if (elapsed.action !== "stop") return;
    expect(elapsed.reason).toBe("question_budget_exhausted");
  });

  it("SC-37 elapsed only rolls back the time judgement, not scope, continuation or concurrency", async () => {
    process.env.LUCY_QUESTION_BUDGET_WALL_MODE = "elapsed";
    process.env.LUCY_QUESTION_BUDGET_SCOPE = "stable";
    const budget = new QuestionBudget();
    const scopeKey = budgetScopeKey(IDENTITY, SESSION);

    // ① 作用域键仍是稳定语义（不随 elapsed 回退）。
    await budget.beginQuestion({ identityKey: IDENTITY, sessionId: SESSION, turnId: "turn-37", now: 0 });
    expect(budget.snapshotScope(scopeKey)).not.toBeNull();

    // ② 并发上限仍然生效。
    const inFlight: Awaited<ReturnType<QuestionBudget["consumePersisted"]>>[] = [];
    for (let i = 0; i < QUESTION_BUDGET_MAX_INFLIGHT; i += 1) {
      inFlight.push(await dataCall(budget, 1, { settle: false }));
    }
    expect(inFlight.every((item) => item.action === "allow")).toBe(true);
    const rejected = await dataCall(budget, 1, { settle: false });
    expect(rejected.action).toBe("reject");

    // ③ 续查两段式仍然生效：声明 → 消费换窗。
    const continued = new QuestionBudget();
    await continued.beginQuestion({ identityKey: IDENTITY, sessionId: SESSION, turnId: "turn-37b", now: 0 });
    for (let i = 0; i < QUESTION_BUDGET_MAX_CALLS; i += 1) {
      await dataCall(continued, QUESTION_BUDGET_MAX_BUSY_MS + 1);
    }
    const stopped = await dataCall(continued, QUESTION_BUDGET_MAX_BUSY_MS + 1);
    expect(stopped.action).toBe("stop");
    if (stopped.action !== "stop") return;
    const declared = await continued.declareContinuation(scopeKey, stopped.continueToken);
    expect(declared.ok).toBe(true);
    const resumed = await dataCall(continued, QUESTION_BUDGET_MAX_BUSY_MS + 2);
    expect(resumed.action).toBe("allow");
    expect(continued.snapshotScope(scopeKey)?.windowId).toBeGreaterThan(0);
  });

  it("SC-38 legacy scope mode falls back to the turn-keyed scope", async () => {
    process.env.LUCY_QUESTION_BUDGET_SCOPE = "legacy";
    const budget = new QuestionBudget();

    const begun = await budget.beginQuestion({
      identityKey: IDENTITY,
      sessionId: SESSION,
      turnId: "legacy-turn",
      now: 0
    });
    expect(begun.ok).toBe(true);
    expect(budget.snapshotScope("turn:legacy-turn")).not.toBeNull();
    expect(budget.snapshotScope(budgetScopeKey(IDENTITY, SESSION))).toBeNull();

    const decision = await budget.consumePersisted("legacy-turn", 1, undefined, undefined, {
      identityKey: IDENTITY,
      sessionId: SESSION,
      canContinue: true
    });
    expect(decision.action).toBe("allow");
    expect(budget.snapshotScope("turn:legacy-turn")?.calls).toBe(1);
  });

  it("SC-39 the budget can be switched off entirely", async () => {
    process.env.LUCY_QUESTION_BUDGET = "off";
    expect(questionBudgetEnabled()).toBe(false);

    // 代理层的行为（旁路入口不受预算约束）在
    // `question-budget-bypass-scope.test.ts` 里断言；这里只守住开关本身。
    delete process.env.LUCY_QUESTION_BUDGET;
    expect(questionBudgetEnabled()).toBe(true);
  });
});
