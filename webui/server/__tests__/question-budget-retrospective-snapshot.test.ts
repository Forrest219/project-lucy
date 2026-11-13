import { afterEach, describe, expect, it } from "vitest";
import {
  QUESTION_BUDGET_MAX_BUSY_MS,
  QUESTION_BUDGET_MAX_CALLS,
  QUESTION_BUDGET_MAX_WALL_MS,
  QuestionBudget,
  buildBudgetSnapshot,
  classifyExhaustion,
  type BudgetState
} from "../proxy/question-experience.js";

function baseState(overrides: Partial<BudgetState> = {}): BudgetState {
  return {
    startedAt: 1_000,
    originStartedAt: 1_000,
    calls: 0,
    continuations: 0,
    attempts: 0,
    peakConcurrency: 0,
    currentConcurrency: 0,
    windowId: 0,
    round: 0,
    busyMs: 0,
    archivedBusyMsByWindow: {},
    ...overrides
  };
}

describe("classifyExhaustion + buildBudgetSnapshot (REQ-030-035)", () => {
  const prevWall = process.env.LUCY_QUESTION_BUDGET_WALL_MODE;

  afterEach(() => {
    if (prevWall === undefined) delete process.env.LUCY_QUESTION_BUDGET_WALL_MODE;
    else process.env.LUCY_QUESTION_BUDGET_WALL_MODE = prevWall;
  });

  it("returns null when neither dimension is exhausted", () => {
    expect(classifyExhaustion(baseState({ calls: 3, busyMs: 10 }), 2_000)).toBeNull();
  });

  it("settled: calls → exhaustedBy=calls", () => {
    process.env.LUCY_QUESTION_BUDGET_WALL_MODE = "settled";
    const state = baseState({ calls: QUESTION_BUDGET_MAX_CALLS, busyMs: 1_000, attempts: QUESTION_BUDGET_MAX_CALLS });
    expect(classifyExhaustion(state, 2_000)).toBe("calls");
    const snap = buildBudgetSnapshot({ eventKind: "budget_stop", state, now: 2_000 });
    expect(snap.schemaVersion).toBe("lucy-budget-snapshot/v1");
    expect(snap.eventKind).toBe("budget_stop");
    expect(snap.exhaustedBy).toBe("calls");
    expect(snap.calls).toBe(QUESTION_BUDGET_MAX_CALLS);
    expect(snap.maxCalls).toBe(QUESTION_BUDGET_MAX_CALLS);
    expect(snap.maxBusyMs).toBe(QUESTION_BUDGET_MAX_BUSY_MS);
    expect(snap.wallMode).toBe("settled");
    expect(snap.elapsedMs).toBeNull();
    expect(snap).not.toHaveProperty("scopeKey");
    expect(snap).not.toHaveProperty("presentedToken");
    expect(JSON.stringify(snap)).not.toMatch(/presentedToken|pendingToken|scopeKey|identityKey/);
  });

  it("settled: busy → exhaustedBy=busy", () => {
    process.env.LUCY_QUESTION_BUDGET_WALL_MODE = "settled";
    const state = baseState({ calls: 1, busyMs: QUESTION_BUDGET_MAX_BUSY_MS });
    expect(classifyExhaustion(state, 2_000)).toBe("busy");
    expect(buildBudgetSnapshot({ eventKind: "budget_stop", state, now: 2_000 }).exhaustedBy).toBe("busy");
  });

  it("settled: both dimensions → exhaustedBy=both", () => {
    process.env.LUCY_QUESTION_BUDGET_WALL_MODE = "settled";
    const state = baseState({
      calls: QUESTION_BUDGET_MAX_CALLS,
      busyMs: QUESTION_BUDGET_MAX_BUSY_MS
    });
    expect(classifyExhaustion(state, 2_000)).toBe("both");
  });

  it("elapsed: wall → exhaustedBy=wall and elapsedMs readable", () => {
    process.env.LUCY_QUESTION_BUDGET_WALL_MODE = "elapsed";
    const startedAt = 5_000;
    const now = startedAt + QUESTION_BUDGET_MAX_WALL_MS;
    const state = baseState({ startedAt, calls: 2, busyMs: 0 });
    expect(classifyExhaustion(state, now)).toBe("wall");
    const snap = buildBudgetSnapshot({ eventKind: "budget_stop", state, now });
    expect(snap.exhaustedBy).toBe("wall");
    expect(snap.elapsedMs).toBe(QUESTION_BUDGET_MAX_WALL_MS);
    expect(snap.wallMode).toBe("elapsed");
  });

  it("continuation_rollover keeps pre-window readings and archived keys", () => {
    process.env.LUCY_QUESTION_BUDGET_WALL_MODE = "settled";
    const state = baseState({
      calls: QUESTION_BUDGET_MAX_CALLS,
      busyMs: 12_000,
      attempts: QUESTION_BUDGET_MAX_CALLS,
      windowId: 0,
      round: 0,
      continuations: 0,
      archivedBusyMsByWindow: { "0:0": 0 }
    });
    const snap = buildBudgetSnapshot({ eventKind: "continuation_rollover", state, now: 2_000 });
    expect(snap.eventKind).toBe("continuation_rollover");
    expect(snap.calls).toBe(QUESTION_BUDGET_MAX_CALLS);
    expect(snap.busyMs).toBe(12_000);
    expect(snap.windowId).toBe(0);
    expect(snap.archivedBusyMsByWindow).toEqual({ "0:0": 0 });
  });

  it("throws when building snapshot for a non-exhausted state", () => {
    expect(() =>
      buildBudgetSnapshot({ eventKind: "budget_stop", state: baseState({ calls: 1 }), now: 2_000 })
    ).toThrow(/not exhausted/i);
  });

  it("sync consume stop attaches budget_stop snapshot", () => {
    process.env.LUCY_QUESTION_BUDGET_WALL_MODE = "settled";
    const budget = new QuestionBudget();
    for (let i = 0; i < QUESTION_BUDGET_MAX_CALLS; i += 1) {
      expect(budget.consume("turn-snap", 1_000).action).toBe("allow");
    }
    const stopped = budget.consume("turn-snap", 1_000);
    expect(stopped.action).toBe("stop");
    if (stopped.action !== "stop") return;
    expect(stopped.budgetSnapshot?.eventKind).toBe("budget_stop");
    expect(stopped.budgetSnapshot?.exhaustedBy).toBe("calls");
    expect(stopped.budgetSnapshot?.calls).toBe(QUESTION_BUDGET_MAX_CALLS);
    expect(JSON.stringify(stopped)).not.toMatch(/presentedToken|pendingToken/);
  });

  it("sync consume continuation attaches continuation_rollover snapshot with pre-window calls", () => {
    process.env.LUCY_QUESTION_BUDGET_WALL_MODE = "settled";
    const budget = new QuestionBudget();
    for (let i = 0; i < QUESTION_BUDGET_MAX_CALLS; i += 1) {
      expect(budget.consume("turn-roll", 1_000).action).toBe("allow");
    }
    const stopped = budget.consume("turn-roll", 1_000);
    expect(stopped.action).toBe("stop");
    if (stopped.action !== "stop") return;
    const continued = budget.consume("turn-roll", 1_000, stopped.continueToken);
    expect(continued.action).toBe("allow");
    if (continued.action !== "allow") return;
    expect(continued.continued).toBe(true);
    expect(continued.budgetSnapshot?.eventKind).toBe("continuation_rollover");
    expect(continued.budgetSnapshot?.calls).toBe(QUESTION_BUDGET_MAX_CALLS);
    expect(continued.budgetSnapshot?.windowId).toBe(0);
  });
});
