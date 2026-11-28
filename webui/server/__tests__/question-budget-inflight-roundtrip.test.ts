import { describe, expect, it } from "vitest";
import {
  QuestionBudget,
  budgetIdentityKey,
  budgetScopeKey,
  type BudgetPersistence,
  type BudgetState,
} from "../proxy/question-experience.js";

const IDENTITY = budgetIdentityKey("f2-roundtrip", "sha256:f2round001");

/**
 * 模拟生产持久化（audit.ts question_budget_state）：表无 inflight 列，
 * save 返回的回读行丢失进程本地并发计数。F2 修复前，该 round-trip 会让
 * 预算层 inflight 闸门永远读到 0。
 */
function productionLikePersistence(): BudgetPersistence {
  const rows = new Map<string, BudgetState>();
  const keys = new Map<string, Set<string>>();
  return {
    async load(scopeKey) {
      const row = rows.get(scopeKey);
      if (!row) return null;
      return { row: { ...row }, appliedKeys: [...(keys.get(scopeKey) ?? [])] };
    },
    async save(scopeKey, state, idempotencyKey) {
      const known = keys.get(scopeKey) ?? new Set<string>();
      if (idempotencyKey && known.has(idempotencyKey)) {
        return { row: rows.get(scopeKey)!, appliedKeys: [...known] };
      }
      // 持久列照存；inflight／currentConcurrency 不入表 → 回读行丢失。
      const persisted: BudgetState = { ...state } as BudgetState;
      // 模拟持久化表无 inflight 列：回读行不带这两个进程本地字段。
      delete (persisted as Partial<BudgetState>).inflight;
      delete (persisted as Partial<BudgetState>).currentConcurrency;
      rows.set(scopeKey, persisted);
      if (idempotencyKey) known.add(idempotencyKey);
      keys.set(scopeKey, known);
      // 回读行（无 inflight）
      return { row: { ...persisted }, appliedKeys: [...known] };
    },
    async listScopes() {
      return [...rows.keys()];
    }
  };
}

describe("REQ-0122／UAT F2：持久化往返不丢进程本地 inflight", () => {
  it("8 路并发 admit 后第 9 路被预算层拒绝（reason=question_budget_concurrency_exceeded）", async () => {
    const budget = new QuestionBudget();
    budget.setPersistence(productionLikePersistence());
    const scopeArgs = { identityKey: IDENTITY, sessionId: "s-f2", canContinue: true };

    const batch = await Promise.all(Array.from({ length: 8 }, () =>
      budget.consumePersisted(undefined, 1, undefined, undefined, { ...scopeArgs, toolName: "lucy_query" })));
    const allows = batch.filter((r) => r.action === "allow");
    expect(allows.length).toBe(8);

    // 修复点：缓存行在每次 commit 后保留 candidate 的 inflight（=8）。
    const snapshot = budget.snapshotScope(budgetScopeKey(IDENTITY, "s-f2"));
    expect(snapshot?.inflight).toBe(8);

    const ninth = await budget.consumePersisted(undefined, 2, undefined, undefined, { ...scopeArgs, toolName: "lucy_query" });
    expect(ninth.action).toBe("reject");
    if (ninth.action === "reject") {
      expect(ninth.reason).toBe("question_budget_concurrency_exceeded");
      expect(ninth.retryable).toBe(true);
      expect(ninth.nextStep?.max_inflight).toBe(8);
    }
    // 拒绝路径不 consume：calls 保持 8。
    expect(budget.snapshotScope(budgetScopeKey(IDENTITY, "s-f2"))?.calls).toBe(8);
  });

  it("settle 后 inflight 回落，后续 admit 重新可用", async () => {
    const budget = new QuestionBudget();
    budget.setPersistence(productionLikePersistence());
    const scopeArgs = { identityKey: IDENTITY, sessionId: "s-f2b", canContinue: true };
    const admitted = await budget.consumePersisted(undefined, 1, undefined, undefined, { ...scopeArgs, toolName: "lucy_query" });
    if (admitted.action !== "allow" || !admitted.ticket) throw new Error("expected allow with ticket");
    expect(budget.snapshotScope(budgetScopeKey(IDENTITY, "s-f2b"))?.inflight).toBe(1);
    await budget.settle(admitted.ticket, 1500);
    expect(budget.snapshotScope(budgetScopeKey(IDENTITY, "s-f2b"))?.inflight).toBe(0);
    const next = await budget.consumePersisted(undefined, 2, undefined, undefined, { ...scopeArgs, toolName: "lucy_query" });
    expect(next.action).toBe("allow");
  });
});
