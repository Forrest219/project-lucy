import { afterEach, describe, expect, it } from "vitest";
import {
  QUESTION_BUDGET_ABS_EXEC_MS,
  QUESTION_BUDGET_FAILED_CALL_CAP_MS,
  QuestionBudget,
  budgetIdentityKey,
  budgetScopeKey,
  questionBudgetFailedCallCapMs,
  type BudgetPersistence,
  type BudgetState,
} from "../proxy/question-experience.js";

const IDENTITY = budgetIdentityKey("unit-fail-cap", "sha256:failcap01");
const SESSION = "session-fail-cap";
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

describe("REQ-0122 D4／OQ-4 failedKind busy cap", () => {
  afterEach(() => {
    delete process.env.QUESTION_BUDGET_FAILED_CALL_CAP_MS;
  });

  it("caps timed_out／upstream_disconnect／tool_is_error at 30s while exposing rawDelta", async () => {
    expect(questionBudgetFailedCallCapMs()).toBe(QUESTION_BUDGET_FAILED_CALL_CAP_MS);
    const budget = new QuestionBudget();
    budget.setPersistence(memoryPersistence());
    budget.setMonoClock(() => 0);

    for (const failedKind of ["timed_out", "upstream_disconnect", "tool_is_error"] as const) {
      const admitted = await budget.consumePersisted(undefined, 1, undefined, undefined, {
        identityKey: IDENTITY,
        sessionId: `${SESSION}-${failedKind}`,
        toolName: "lucy_query",
        canContinue: true,
      });
      expect(admitted.action).toBe("allow");
      if (admitted.action !== "allow" || !admitted.ticket) throw new Error("expected ticket");
      const result = await budget.settle(admitted.ticket, 90_000, { failedKind });
      expect(result.settled).toBe(true);
      expect(result.rawDeltaMs).toBe(90_000);
      expect(result.billedBusyMs).toBe(QUESTION_BUDGET_FAILED_CALL_CAP_MS);
      expect(result.failedKind).toBe(failedKind);
      const scope = budgetScopeKey(IDENTITY, `${SESSION}-${failedKind}`);
      expect(budget.snapshotScope(scope)?.busyMs).toBe(QUESTION_BUDGET_FAILED_CALL_CAP_MS);
    }
  });

  it("no_data and success do not take the failure cap", async () => {
    const budget = new QuestionBudget();
    budget.setPersistence(memoryPersistence());
    budget.setMonoClock(() => 0);

    const empty = await budget.consumePersisted(undefined, 1, undefined, undefined, {
      identityKey: IDENTITY,
      sessionId: `${SESSION}-empty`,
      toolName: "lucy_query",
      canContinue: true,
    });
    if (empty.action !== "allow" || !empty.ticket) throw new Error("expected ticket");
    const emptyResult = await budget.settle(empty.ticket, 90_000, { failedKind: "no_data" });
    expect(emptyResult.billedBusyMs).toBe(90_000);
    expect(emptyResult.rawDeltaMs).toBe(90_000);
    expect(budget.snapshotScope(budgetScopeKey(IDENTITY, `${SESSION}-empty`))?.busyMs).toBe(90_000);

    const ok = await budget.consumePersisted(undefined, 1, undefined, undefined, {
      identityKey: IDENTITY,
      sessionId: `${SESSION}-ok`,
      toolName: "lucy_query",
      canContinue: true,
    });
    if (ok.action !== "allow" || !ok.ticket) throw new Error("expected ticket");
    const okResult = await budget.settle(ok.ticket, 45_000);
    expect(okResult.billedBusyMs).toBe(45_000);
    expect(okResult.failedKind).toBeUndefined();
    expect(budget.snapshotScope(budgetScopeKey(IDENTITY, `${SESSION}-ok`))?.busyMs).toBe(45_000);
  });

  it("SC-07: four 90s timed_out failures bill 120s total and still admit a fifth query", async () => {
    const budget = new QuestionBudget();
    budget.setPersistence(memoryPersistence());
    budget.setMonoClock(() => 0);

    for (let i = 0; i < 4; i += 1) {
      const admitted = await budget.consumePersisted(undefined, 1, undefined, undefined, {
        identityKey: IDENTITY,
        sessionId: SESSION,
        toolName: "lucy_query",
        canContinue: true,
      });
      if (admitted.action !== "allow" || !admitted.ticket) throw new Error("expected allow");
      await budget.settle(admitted.ticket, 90_000, { failedKind: "timed_out" });
    }
    expect(budget.snapshotScope(SCOPE_KEY)?.busyMs).toBe(4 * QUESTION_BUDGET_FAILED_CALL_CAP_MS);
    expect(budget.snapshotScope(SCOPE_KEY)?.busyMs).toBeLessThan(900_000);

    const fifth = await budget.consumePersisted(undefined, 1, undefined, undefined, {
      identityKey: IDENTITY,
      sessionId: SESSION,
      toolName: "lucy_query",
      canContinue: true,
    });
    expect(fifth.action).toBe("allow");
  });

  it("still respects ABS_EXEC hard ceiling before the failure cap", async () => {
    const budget = new QuestionBudget();
    budget.setPersistence(memoryPersistence());
    budget.setMonoClock(() => 0);
    const admitted = await budget.consumePersisted(undefined, 1, undefined, undefined, {
      identityKey: IDENTITY,
      sessionId: `${SESSION}-abs`,
      toolName: "lucy_query",
      canContinue: true,
    });
    if (admitted.action !== "allow" || !admitted.ticket) throw new Error("expected ticket");
    const result = await budget.settle(admitted.ticket, QUESTION_BUDGET_ABS_EXEC_MS + 50_000, {
      failedKind: "timed_out",
      timeoutUnconfirmed: true,
    });
    expect(result.rawDeltaMs).toBe(QUESTION_BUDGET_ABS_EXEC_MS);
    expect(result.billedBusyMs).toBe(QUESTION_BUDGET_FAILED_CALL_CAP_MS);
    expect(result.timeoutUnconfirmed).toBe(true);
  });
});
