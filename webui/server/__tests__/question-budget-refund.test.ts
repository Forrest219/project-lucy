import { afterEach, describe, expect, it } from "vitest";
import {
  QuestionBudget,
  budgetIdentityKey,
  budgetScopeKey,
  type BudgetPersistence,
  type BudgetState,
} from "../proxy/question-experience.js";

const IDENTITY = budgetIdentityKey("unit-refund", "sha256:refund001");
const SESSION = "session-refund";
const SCOPE_KEY = budgetScopeKey(IDENTITY, SESSION);

function memoryPersistence(): BudgetPersistence {
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
      const row = { ...state, scopeKey };
      rows.set(scopeKey, row);
      if (idempotencyKey) known.add(idempotencyKey);
      keys.set(scopeKey, known);
      return { row, appliedKeys: [...known] };
    },
    async listScopes() {
      return [...rows.keys()];
    }
  };
}

describe("REQ-0122／UAT F1：容量拒绝对称退账", () => {
  afterEach(() => {
    delete process.env.QUESTION_BUDGET_MAX_INFLIGHT;
  });

  it("query admit → refund 后 calls/inflight/attempts 归零，且已退 ticket 不可二次退账", async () => {
    const budget = new QuestionBudget();
    budget.setPersistence(memoryPersistence());
    budget.setMonoClock(() => 0);

    const admitted = await budget.consumePersisted(undefined, 1, undefined, undefined, {
      identityKey: IDENTITY,
      sessionId: SESSION,
      toolName: "lucy_query",
      canContinue: true
    });
    if (admitted.action !== "allow" || !admitted.ticket) throw new Error("expected allow with ticket");
    expect(budget.snapshotScope(SCOPE_KEY)?.calls).toBe(1);
    expect(budget.snapshotScope(SCOPE_KEY)?.inflight).toBe(1);

    const refund = await budget.refundQueryAdmission(admitted.ticket);
    expect(refund.refunded).toBe(true);
    expect(budget.snapshotScope(SCOPE_KEY)?.calls).toBe(0);
    expect(budget.snapshotScope(SCOPE_KEY)?.inflight).toBe(0);
    expect(budget.snapshotScope(SCOPE_KEY)?.attempts).toBe(0);

    // 已退账 ticket（settled 守卫）不可二次退账。
    const again = await budget.refundQueryAdmission(admitted.ticket);
    expect(again.refunded).toBe(false);
    expect(budget.snapshotScope(SCOPE_KEY)?.calls).toBe(0);
  });

  it("窗口已滚动（round/windowId 不匹配）时不退账", async () => {
    const budget = new QuestionBudget();
    budget.setPersistence(memoryPersistence());
    budget.setMonoClock(() => 0);
    const admitted = await budget.consumePersisted(undefined, 1, undefined, undefined, {
      identityKey: IDENTITY,
      sessionId: `${SESSION}-roll`,
      toolName: "lucy_query",
      canContinue: true
    });
    if (admitted.action !== "allow" || !admitted.ticket) throw new Error("expected allow with ticket");
    const stale = { ...admitted.ticket, windowId: admitted.ticket.windowId + 7 };
    const refund = await budget.refundQueryAdmission(stale);
    expect(refund.refunded).toBe(false);
    expect(budget.snapshotScope(budgetScopeKey(IDENTITY, `${SESSION}-roll`))?.calls).toBe(1);
  });

  it("meta admit → refund 后 metaCalls/attempts 回落；空桶退账 no-op", async () => {
    const budget = new QuestionBudget();
    budget.setPersistence(memoryPersistence());
    budget.setMonoClock(() => 0);
    const metaScope = budgetScopeKey(IDENTITY, `${SESSION}-meta`);

    const admitted = await budget.consumePersisted(undefined, 1, undefined, undefined, {
      identityKey: IDENTITY,
      sessionId: `${SESSION}-meta`,
      toolName: "lucy_read_source",
      canContinue: true
    });
    if (admitted.action !== "allow") throw new Error("expected allow");
    expect(admitted.ticket).toBeUndefined(); // allow-meta 无 ticket
    expect(budget.snapshotScope(metaScope)?.metaCalls).toBe(1);

    const refund = await budget.refundMetaAdmission(metaScope);
    expect(refund.refunded).toBe(true);
    expect(budget.snapshotScope(metaScope)?.metaCalls).toBe(0);
    expect(budget.snapshotScope(metaScope)?.attempts).toBe(0);

    const noop = await budget.refundMetaAdmission(budgetScopeKey(IDENTITY, `${SESSION}-meta-empty`));
    expect(noop.refunded).toBe(false);
  });
});
