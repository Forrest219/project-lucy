import { afterEach, describe, expect, it } from "vitest";
import {
  QUESTION_BUDGET_ABS_EXEC_MS,
  QUESTION_BUDGET_MAX_BUSY_MS,
  QUESTION_BUDGET_MAX_CALLS,
  QUESTION_BUDGET_MAX_INFLIGHT,
  QuestionBudget,
  budgetIdentityKey,
  budgetScopeKey,
  type BudgetPersistence,
  type BudgetState,
} from "../proxy/question-experience.js";

const IDENTITY = budgetIdentityKey("liuzongxuan", "sha256:abc");
const SESSION = "db471e45";

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

function scoped(budget: QuestionBudget, now: number, token?: string, canContinue = true, release = true) {
  return budget.consumePersisted(undefined, now, token, undefined, {
    identityKey: IDENTITY,
    sessionId: SESSION,
    canContinue
  }).then(async (decision) => {
    if (release && decision.action === "allow" && decision.ticket) {
      await budget.settle(decision.ticket, decision.ticket.startMonoMs);
    }
    return decision;
  });
}

describe("question budget window", () => {
  const previousWall = process.env.LUCY_QUESTION_BUDGET_WALL_MODE;
  const previousScope = process.env.LUCY_QUESTION_BUDGET_SCOPE;

  afterEach(() => {
    if (previousWall === undefined) delete process.env.LUCY_QUESTION_BUDGET_WALL_MODE;
    else process.env.LUCY_QUESTION_BUDGET_WALL_MODE = previousWall;
    if (previousScope === undefined) delete process.env.LUCY_QUESTION_BUDGET_SCOPE;
    else process.env.LUCY_QUESTION_BUDGET_SCOPE = previousScope;
  });

  it("SC-01 / SC-06 settled mode ignores idle and keeps busy time", async () => {
    process.env.LUCY_QUESTION_BUDGET_WALL_MODE = "settled";
    const budget = new QuestionBudget();
    let mono = 0;
    budget.setMonoClock(() => mono);
    for (let i = 0; i < 12; i += 1) {
      const decision = await scoped(budget, 1_000 + i * 90_000, undefined, true, false);
      expect(decision.action).toBe("allow");
      if (decision.action !== "allow" || !decision.ticket) return;
      mono += 1_000;
      await budget.settle(decision.ticket, mono);
    }
    const state = budget.snapshotScope(budgetScopeKey(IDENTITY, SESSION));
    expect(state?.calls).toBe(12);
    expect(state?.busyMs).toBe(12_000);
  });

  it("SC-08 stops on the 21st call", async () => {
    const budget = new QuestionBudget();
    for (let i = 0; i < QUESTION_BUDGET_MAX_CALLS; i += 1) {
      expect((await scoped(budget, 1_000)).action).toBe("allow");
    }
    const stopped = await scoped(budget, 1_000);
    expect(stopped.action).toBe("stop");
    if (stopped.action !== "stop") return;
    expect(stopped.reason).toBe("question_budget_exhausted");
    expect(stopped.continueToken).not.toContain("bq:");
  });

  it("SC-10 settled allows the incident read and elapsed blocks it", async () => {
    const run = async (mode: "settled" | "elapsed") => {
      process.env.LUCY_QUESTION_BUDGET_WALL_MODE = mode;
      const budget = new QuestionBudget();
      await budget.beginQuestion({ identityKey: IDENTITY, sessionId: SESSION, turnId: "lucy_ed29af56", now: 0 });
      return scoped(budget, 318_000);
    };
    expect((await run("settled")).action).toBe("allow");
    expect((await run("elapsed")).action).toBe("stop");
  });

  it("SC-07 stops once settled busy time reaches 120 seconds", async () => {
    const budget = new QuestionBudget();
    let mono = 0;
    budget.setMonoClock(() => mono);
    const first = await scoped(budget, 1_000, undefined, true, false);
    expect(first.action).toBe("allow");
    if (first.action !== "allow" || !first.ticket) return;
    mono += QUESTION_BUDGET_MAX_BUSY_MS;
    await budget.settle(first.ticket, mono);
    const stopped = await scoped(budget, 2_000);
    expect(stopped.action).toBe("stop");
  });

  it("SC-11 rejects the call that would exceed inflight without charging calls", async () => {
    const budget = new QuestionBudget();
    const allowed = [];
    for (let i = 0; i < QUESTION_BUDGET_MAX_INFLIGHT; i += 1) allowed.push(await scoped(budget, 1_000, undefined, true, false));
    expect(allowed.every((item) => item.action === "allow")).toBe(true);
    const rejected = await scoped(budget, 1_000, undefined, true, false);
    expect(rejected.action).toBe("reject");
    expect(budget.snapshotScope(budgetScopeKey(IDENTITY, SESSION))?.calls).toBe(QUESTION_BUDGET_MAX_INFLIGHT);
  });

  it("SC-15 and SC-16 report continuable from the caller capability", async () => {
    const budget = new QuestionBudget();
    for (let i = 0; i < QUESTION_BUDGET_MAX_CALLS; i += 1) await scoped(budget, 1_000, undefined, true);
    const visible = await scoped(budget, 1_000, undefined, true);
    const hiddenBudget = new QuestionBudget();
    for (let i = 0; i < QUESTION_BUDGET_MAX_CALLS; i += 1) await scoped(hiddenBudget, 1_000, undefined, false);
    const hidden = await scoped(hiddenBudget, 1_000, undefined, false);
    expect(visible.action).toBe("stop");
    expect(hidden.action).toBe("stop");
    if (visible.action !== "stop" || hidden.action !== "stop") return;
    expect(visible.continuable).toBe(true);
    expect(hidden.continuable).toBe(false);
    expect(visible.continueToken).toBeTruthy();
  });

  it("SC-17 through SC-22 and SC-45 continue only with a matching token", async () => {
    process.env.LUCY_QUESTION_BUDGET_WALL_MODE = "settled";
    const budget = new QuestionBudget();
    const scopeKey = budgetScopeKey(IDENTITY, SESSION);
    await budget.beginQuestion({ identityKey: IDENTITY, sessionId: SESSION, turnId: "turn-a", now: 1_000 });
    for (let i = 0; i < QUESTION_BUDGET_MAX_CALLS; i += 1) await scoped(budget, 2_000);
    const stopped = await scoped(budget, 2_000);
    expect(stopped.action).toBe("stop");
    if (stopped.action !== "stop") return;
    expect(await budget.declareContinuation(scopeKey, "wrong")).toMatchObject({ ok: false, reason: "mismatch" });
    expect(await budget.declareContinuation(scopeKey, stopped.continueToken)).toMatchObject({ ok: true, declared: true });
    expect(await budget.declareContinuation(scopeKey, stopped.continueToken)).toMatchObject({ ok: true, idempotent: true });
    expect(await budget.declareContinuation(scopeKey, "other")).toMatchObject({ ok: false, reason: "pending_exists" });
    const continued = await scoped(budget, 3_000);
    expect(continued.action).toBe("allow");
    expect(budget.snapshotScope(scopeKey)?.calls).toBe(1);
    expect(budget.snapshotScope(scopeKey)?.busyMs).toBe(0);
    for (let i = 0; i < QUESTION_BUDGET_MAX_CALLS - 1; i += 1) await scoped(budget, 4_000);
    const secondStop = await scoped(budget, 4_000);
    expect(secondStop.action).toBe("stop");
    expect(await budget.declareContinuation(scopeKey, stopped.continueToken)).toMatchObject({ ok: false, reason: "no_credit" });

    const headerBudget = new QuestionBudget();
    await headerBudget.beginQuestion({ identityKey: IDENTITY, sessionId: SESSION, turnId: "turn-b", now: 1_000 });
    for (let i = 0; i < QUESTION_BUDGET_MAX_CALLS; i += 1) {
      const step = await headerBudget.consumePersisted("turn-b", 2_000, undefined, undefined, {
        identityKey: IDENTITY, sessionId: SESSION, canContinue: true
      });
      if (step.action === "allow" && step.ticket) await headerBudget.settle(step.ticket, step.ticket.startMonoMs);
    }
    const direct = await headerBudget.consumePersisted("turn-b", 2_000, "turn-b", undefined, {
      identityKey: IDENTITY, sessionId: SESSION, canContinue: true
    });
    expect(direct.action).toBe("allow");
  });

  it("SC-03 / SC-23 restore cumulative fields and a pending continuation after restart", async () => {
    const scopeKey = budgetScopeKey(IDENTITY, SESSION);
    const seeded = memoryPersistence();
    const first = new QuestionBudget();
    first.setPersistence(seeded.persistence);
    await first.beginQuestion({ identityKey: IDENTITY, sessionId: SESSION, turnId: "T", now: 50 });
    for (let i = 0; i < 18; i += 1) await scoped(first, 100);
    const restarted = new QuestionBudget();
    restarted.setPersistence(seeded.persistence);
    const next = await scoped(restarted, 200);
    expect(next.action).toBe("allow");
    const restored = restarted.snapshotScope(scopeKey);
    expect(restored?.calls).toBe(19);
    expect(restored?.turnId).toBe("T");
    expect(restored?.inflight).toBe(0);
  });

  it("SC-05 fails closed when the store cannot be read", async () => {
    const seeded = memoryPersistence();
    seeded.failLoad.current = true;
    const budget = new QuestionBudget();
    budget.setPersistence(seeded.persistence);
    const decision = await scoped(budget, 1_000);
    expect(decision.action).toBe("stop");
    if (decision.action !== "stop") return;
    expect(decision.reason).toBe("question_budget_unavailable");
  });

  it("SC-12 archives a late settlement onto the old window", async () => {
    const budget = new QuestionBudget();
    let mono = 0;
    budget.setMonoClock(() => mono);
    const scopeKey = budgetScopeKey(IDENTITY, SESSION);
    await budget.beginQuestion({ identityKey: IDENTITY, sessionId: SESSION, turnId: "turn-old", now: 1 });
    const settled = await scoped(budget, 1, undefined, true, false);
    if (settled.action !== "allow" || !settled.ticket) throw new Error("expected allow");
    mono = 110_000;
    await budget.settle(settled.ticket, mono);
    const late = await scoped(budget, 1, undefined, true, false);
    if (late.action !== "allow" || !late.ticket) throw new Error("expected allow");
    for (let i = 0; i < QUESTION_BUDGET_MAX_CALLS - 2; i += 1) {
      await scoped(budget, 2);
    }
    const stopped = await scoped(budget, 2);
    expect(stopped.action).toBe("stop");
    if (stopped.action !== "stop") return;
    await budget.declareContinuation(scopeKey, stopped.continueToken);
    const continued = await scoped(budget, 3);
    expect(continued.action).toBe("allow");
    mono = 120_000;
    await budget.settle(late.ticket, mono);
    const state = budget.snapshotScope(scopeKey);
    const archived = Object.values(state?.archivedBusyMsByWindow ?? {}).reduce((sum, value) => sum + value, 0);
    expect(archived).toBe(120_000);
    expect(state?.busyMs).toBe(0);
    await budget.settle(late.ticket, mono + 10_000);
    const archivedAgain = Object.values(budget.snapshotScope(scopeKey)?.archivedBusyMsByWindow ?? {}).reduce((sum, value) => sum + value, 0);
    expect(archivedAgain).toBe(120_000);
  });

  it("SC-14 caps a single settlement at the absolute wait", async () => {
    const budget = new QuestionBudget();
    budget.setMonoClock(() => 0);
    const allowed = await scoped(budget, 1, undefined, true, false);
    if (allowed.action !== "allow" || !allowed.ticket) throw new Error("expected allow");
    await budget.settle(allowed.ticket, QUESTION_BUDGET_ABS_EXEC_MS + 50_000, { timeoutUnconfirmed: true });
    expect(budget.snapshotScope(budgetScopeKey(IDENTITY, SESSION))?.busyMs).toBe(QUESTION_BUDGET_ABS_EXEC_MS);
  });

  it("SC-24 and SC-44 a new begin archives prior busy time and drops the old token", async () => {
    const budget = new QuestionBudget();
    let mono = 0;
    budget.setMonoClock(() => mono);
    const scopeKey = budgetScopeKey(IDENTITY, SESSION);
    const opened = await scoped(budget, 10, undefined, true, false);
    if (opened.action !== "allow" || !opened.ticket) throw new Error("expected allow");
    mono = 5_000;
    await budget.settle(opened.ticket, mono);
    const begun = await budget.beginQuestion({ identityKey: IDENTITY, sessionId: SESSION, turnId: "first", now: 20 });
    expect(begun.ok).toBe(true);
    const again = await budget.beginQuestion({ identityKey: IDENTITY, sessionId: SESSION, turnId: "second", now: 30 });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.previousTurnId).toBe("first");
    expect(again.state.calls).toBe(0);
    expect(again.state.presentedToken).toBeNull();
    expect(Object.values(budget.snapshotScope(scopeKey)?.archivedBusyMsByWindow ?? {}).reduce((sum, value) => sum + value, 0)).toBe(5_000);
  });

  it("SC-31 keeps two identities on the same session apart", async () => {
    const budget = new QuestionBudget();
    const other = budgetIdentityKey("other-user", "sha256:def");
    await budget.beginQuestion({ identityKey: IDENTITY, sessionId: "same", turnId: "turn-a", now: 1 });
    await budget.beginQuestion({ identityKey: other, sessionId: "same", turnId: "turn-b", now: 2 });
    expect(budget.snapshotScope(budgetScopeKey(IDENTITY, "same"))?.turnId).toBe("turn-a");
    expect(budget.snapshotScope(budgetScopeKey(other, "same"))?.turnId).toBe("turn-b");
  });

  it("SC-42 does not overwrite a committed stop with another window's candidate", async () => {
    const seeded = memoryPersistence();
    const budget = new QuestionBudget();
    budget.setPersistence(seeded.persistence);
    const scopeKey = budgetScopeKey(IDENTITY, SESSION);
    for (let i = 0; i < QUESTION_BUDGET_MAX_CALLS; i += 1) await scoped(budget, 1);
    const stopped = await scoped(budget, 1);
    expect(stopped.action).toBe("stop");
    const storedCalls = seeded.rows.get(scopeKey)?.calls;
    const again = await scoped(budget, 1);
    expect(again.action).toBe("stop");
    expect(seeded.rows.get(scopeKey)?.calls).toBe(storedCalls);
  });

  it("SC-48 rejects a second write while a commit is unverified, then restores the disk row", async () => {
    const seeded = memoryPersistence();
    const budget = new QuestionBudget();
    budget.setPersistence(seeded.persistence);
    const first = await scoped(budget, 1);
    expect(first.action).toBe("allow");
    seeded.failSave.current = true;
    const failed = await scoped(budget, 2);
    expect(failed.action).toBe("stop");
    if (failed.action !== "stop") return;
    expect(failed.reason).toBe("question_budget_unavailable");
    const blocked = await scoped(budget, 3);
    expect(blocked.action).toBe("stop");
    if (blocked.action !== "stop") return;
    expect(blocked.reason).toBe("question_budget_unavailable");
    seeded.failSave.current = false;
    seeded.failLoad.current = false;
    const recovered = new QuestionBudget();
    recovered.setPersistence(seeded.persistence);
    const after = await scoped(recovered, 4);
    expect(after.action).toBe("allow");
    expect(recovered.snapshotScope(budgetScopeKey(IDENTITY, SESSION))?.calls).toBe(2);
  });
});
