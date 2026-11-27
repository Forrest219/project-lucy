/**
 * P1-74 / REQ-030-095 —— 问询预算主路径逃生（Spec v1.1 §6 / §7 SC-E1–E10、E9b）。
 *
 * 覆盖：
 * - inactive 多档续查（默认 5 档，第 6 次声明 no_credit 且数据调用硬停）——SC-E2/E3
 * - 硬停机载荷：continuable=false、next_step 结构化、非 ACL ——SC-E4
 * - mode=new_question：声明→下一计费工具兑现（同事务）、旧 turn 归属解除 ——SC-E9
 * - 持久化／恢复／幂等：policy 推导、generation、pendingReopen 跨实例恢复 ——SC-E9b
 * - active 生命周期回归：续查默认 3 档（REQ-0122 D6）、硬停走 begin、new_question 被拒 ——SC-E7
 *
 * 约定与 question-budget-continuation.test.ts 同源：内存持久层夹具、合成身份、
 * 每个用例自建 QuestionBudget 实例。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import {
  QUESTION_BUDGET_MAX_CALLS,
  QuestionBudget,
  budgetIdentityKey,
  budgetScopeKey,
  type BudgetAllow,
  type BudgetDecision,
  type BudgetPersistence,
  type BudgetState
} from "../proxy/question-experience.js";

const IDENTITY = budgetIdentityKey("escape-user", "sha256:escape");
const SESSION = "escape-session";
const TURN = "turn-escape";

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
      return {
        row: { ...row, archivedBusyMsByWindow: { ...(row.archivedBusyMsByWindow ?? {}) } },
        appliedKeys: [...(keys.get(scopeKey) ?? [])]
      };
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

type ConsumeOptions = {
  turnId?: string;
  header?: string;
  canContinue?: boolean;
  canBegin?: boolean;
  identity?: { key: string; session: string };
};

async function admit(budget: QuestionBudget, now: number, options: ConsumeOptions = {}): Promise<BudgetDecision> {
  const decision = await open(budget, now, options);
  if (decision.action === "allow" && decision.ticket) {
    await budget.settle(decision.ticket, decision.ticket.startMonoMs);
  }
  return decision;
}

async function open(budget: QuestionBudget, now: number, options: ConsumeOptions = {}): Promise<BudgetDecision> {
  return budget.consumePersisted(options.turnId, now, options.header, undefined, {
    identityKey: options.identity?.key ?? IDENTITY,
    sessionId: options.identity?.session ?? SESSION,
    canContinue: options.canContinue ?? true,
    canBegin: options.canBegin ?? false
  });
}

/** 用次数维度把当前窗口用尽，返回停机判定。 */
async function exhaustByCalls(budget: QuestionBudget, now: number, options: ConsumeOptions = {}): Promise<BudgetDecision> {
  for (let i = 0; i <= QUESTION_BUDGET_MAX_CALLS; i += 1) {
    const decision = await admit(budget, now, options);
    if (decision.action === "stop") return decision;
    expect(decision.action).toBe("allow");
  }
  throw new Error("预算未在预期次数内用尽");
}

function expectAllow(decision: BudgetDecision): BudgetAllow {
  expect(decision.action).toBe("allow");
  if (decision.action !== "allow") throw new Error(`expected allow, got ${decision.action}`);
  return decision;
}

/** 停机判定取凭证：非 stop 直接抛错（TS 窄化辅助）。 */
function stopCredential(decision: BudgetDecision): string {
  if (decision.action !== "stop") throw new Error(`expected stop, got ${decision.action}`);
  return decision.continueToken;
}

function enableSettledStable(): void {
  process.env.LUCY_QUESTION_BUDGET_WALL_MODE = "settled";
  process.env.LUCY_QUESTION_BUDGET_SCOPE = "stable";
}

describe("question budget main-path escape (P1-74)", () => {
  const previousWall = process.env.LUCY_QUESTION_BUDGET_WALL_MODE;
  const previousScope = process.env.LUCY_QUESTION_BUDGET_SCOPE;
  const previousMaxContinuations = process.env.QUESTION_BUDGET_MAX_CONTINUATIONS_WHEN_BEGIN_INACTIVE;

  afterEach(() => {
    if (previousWall === undefined) delete process.env.LUCY_QUESTION_BUDGET_WALL_MODE;
    else process.env.LUCY_QUESTION_BUDGET_WALL_MODE = previousWall;
    if (previousScope === undefined) delete process.env.LUCY_QUESTION_BUDGET_SCOPE;
    else process.env.LUCY_QUESTION_BUDGET_SCOPE = previousScope;
    if (previousMaxContinuations === undefined) delete process.env.QUESTION_BUDGET_MAX_CONTINUATIONS_WHEN_BEGIN_INACTIVE;
    else process.env.QUESTION_BUDGET_MAX_CONTINUATIONS_WHEN_BEGIN_INACTIVE = previousMaxContinuations;
  });

  it("SC-E2 inactive 首次触顶可声明续查，下一数据工具换窗放行（两段式）", async () => {
    enableSettledStable();
    const scopeKey = budgetScopeKey(IDENTITY, SESSION);
    const budget = new QuestionBudget();
    // 无 begin ⇒ inactive 生命周期（续查档数默认 5）。
    const stopped = await exhaustByCalls(budget, 1_000);
    expect(stopped.action).toBe("stop");
    if (stopped.action !== "stop") return;
    expect(stopped.reason).toBe("question_budget_exhausted");
    expect(stopped.continuable).toBe(true);
    expect(stopped.continuationCreditLeft).toBe(true);
    expect(stopped.nextStep).toEqual({ action: "lucy_continue_question", mode: "continue", then: "retry_data_tool" });
    const hardStopToken = stopped.continueToken;

    // 声明只写 pending，不换窗（无 begin 的首窗 windowId=0）
    const declared = await budget.declareContinuation(scopeKey, stopped.continueToken, 2_000);
    expect(declared).toMatchObject({ ok: true, declared: true });
    if (declared.ok) expect(declared.reopen).toBeFalsy();
    expect(budget.snapshotScope(scopeKey)?.windowId).toBe(0);

    const continued = expectAllow(await admit(budget, 3_000));
    expect(continued.continued).toBe(true);
    expect(continued.reopened).toBeFalsy();
    const state = budget.snapshotScope(scopeKey);
    expect(state?.windowId).toBe(1);
    expect(state?.continuations).toBe(1);
    expect(state?.calls).toBe(1);
    expect(state?.pendingToken).toBeNull();
    // 每窗轮换 presentedToken：旧凭证不得跨窗兑现
    expect(state?.presentedToken).toBeTruthy();
    expect(state?.presentedToken).not.toBe(hardStopToken);
  });

  it("SC-E3 inactive 完成 5 次换窗成交，第 6 次声明 no_credit，数据调用硬停并指向 new_question", async () => {
    enableSettledStable();
    const scopeKey = budgetScopeKey(IDENTITY, SESSION);
    const budget = new QuestionBudget();

    let stopped = await exhaustByCalls(budget, 1_000);
    expect(stopped.action).toBe("stop");
    if (stopped.action !== "stop") return;
    expect(stopped.continuable).toBe(true);

    for (let continuation = 1; continuation <= 5; continuation += 1) {
      const declared = await budget.declareContinuation(scopeKey, stopped.continueToken, 2_000 + continuation);
      expect(declared).toMatchObject({ ok: true, declared: true });
      const allowed = expectAllow(await admit(budget, 3_000 + continuation));
      expect(allowed.continued).toBe(true);
      const state = budget.snapshotScope(scopeKey);
      expect(state?.continuations).toBe(continuation);
      // 无 begin 首窗 windowId=0，每次换窗 +1
      expect(state?.windowId).toBe(continuation);
      expect(state?.calls).toBe(1);
      if (continuation < 5) {
        for (let i = 0; i < QUESTION_BUDGET_MAX_CALLS - 1; i += 1) await admit(budget, 4_000);
        stopped = await admit(budget, 4_000);
        expect(stopped.action).toBe("stop");
        if (stopped.action !== "stop") return;
        expect(stopped.continuable).toBe(true);
      }
    }

    // 第 6 次声明：明确拒绝，不得换窗
    const sixth = await budget.declareContinuation(scopeKey, stopped.continueToken, 9_000);
    expect(sixth).toEqual({ ok: false, reason: "no_credit" });
    expect(budget.snapshotScope(scopeKey)?.continuations).toBe(5);

    // 先把第 6 窗推满至触顶，再验硬停载荷
    for (let i = 0; i < QUESTION_BUDGET_MAX_CALLS - 1; i += 1) await admit(budget, 9_200);
    const windowStop = await admit(budget, 9_300);
    expect(windowStop.action).toBe("stop");
    if (windowStop.action !== "stop") return;
    expect(windowStop.continuable).toBe(false);
    expect(windowStop.nextStep).toEqual({ action: "lucy_continue_question", mode: "new_question", then: "retry_data_tool" });

    // 不声明直接发数据工具：硬停，continuable=false，next_step 指向 mode=new_question
    const hardStop = await admit(budget, 9_500);
    expect(hardStop.action).toBe("stop");
    if (hardStop.action !== "stop") return;
    expect(hardStop.reason).toBe("question_budget_exhausted");
    expect(hardStop.continuable).toBe(false);
    expect(hardStop.continuationCreditLeft).toBe(false);
    expect(hardStop.nextStep).toEqual({ action: "lucy_continue_question", mode: "new_question", then: "retry_data_tool" });
    expect(hardStop.continueToken).toBeTruthy();
  });

  it("SC-E4 硬停机载荷非 ACL：主归因为预算终止，无权限拒绝措辞", async () => {
    enableSettledStable();
    const scopeKey = budgetScopeKey(IDENTITY, SESSION);
    const budget = new QuestionBudget();
    let stopped = await exhaustByCalls(budget, 1_000);
    if (stopped.action !== "stop") throw new Error("expected stop");
    for (let i = 0; i < 5; i += 1) {
      await budget.declareContinuation(scopeKey, stopCredential(stopped), 2_000 + i);
      await admit(budget, 3_000 + i);
      for (let j = 0; j < QUESTION_BUDGET_MAX_CALLS; j += 1) await admit(budget, 4_000 + i);
      stopped = await admit(budget, 4_000 + i);
    }
    expect(stopped.action).toBe("stop");
    if (stopped.action !== "stop") return;
    expect(stopped.reason).toBe("question_budget_exhausted");
    expect(stopped.reason).not.toContain("forbidden");
    expect(stopped.reason).not.toContain("denied");
    expect(stopped.nextStep).toEqual({ action: "lucy_continue_question", mode: "new_question", then: "retry_data_tool" });
    // classifyFailure：预算终止不属于「权限拒绝」维度
    const { classifyFailure } = await import("../proxy/question-experience.js");
    expect(classifyFailure({ decisionReason: stopped.reason })).toBe("");
    // 声明拒绝原因也是用法维度，不是权限拒绝
    expect(classifyFailure({ decisionReason: "no_credit" })).toBe("用法与语义");
    expect(classifyFailure({ decisionReason: "not_hard_stopped" })).toBe("用法与语义");
  });

  it("SC-E9 硬停后 mode=new_question 声明→下一数据工具兑现：新窗成交、旧 turn 归属解除", async () => {
    enableSettledStable();
    const scopeKey = budgetScopeKey(IDENTITY, SESSION);
    const budget = new QuestionBudget();
    // 构造有 turn 的 inactive 旧行（不经 begin，直接带 turnId 消费）——
    // 模拟历史上报后 begin 隐藏的实况：预算行带 turnId，policy 推导为 inactive？不 ——
    // 有持久 turnId 的旧行推导为 active。因此本用例走纯无 turn 的 inactive 实况。
    let stopped = await exhaustByCalls(budget, 1_000);
    if (stopped.action !== "stop") throw new Error("expected stop");
    for (let i = 0; i < 5; i += 1) {
      await budget.declareContinuation(scopeKey, stopCredential(stopped), 2_000 + i);
      await admit(budget, 3_000 + i);
      for (let j = 0; j < QUESTION_BUDGET_MAX_CALLS; j += 1) await admit(budget, 4_000 + i);
      stopped = await admit(budget, 4_000 + i);
    }
    expect(stopped.action).toBe("stop");
    if (stopped.action !== "stop") return;
    const stateBefore = budget.snapshotScope(scopeKey);
    const roundBefore = stateBefore?.round ?? 0;
    const windowBefore = stateBefore?.windowId ?? 0;
    const generationBefore = stateBefore?.generation ?? 0;
    const reopenToken = stopped.continueToken;

    // 声明重开：不换窗
    const declared = await budget.declareContinuation(scopeKey, reopenToken, 9_000, "new_question");
    expect(declared).toMatchObject({ ok: true, declared: true, reopen: true });
    expect(budget.snapshotScope(scopeKey)?.windowId).toBe(windowBefore);

    // 下一计费工具兑现：换窗与准入同一事务
    const reopened = expectAllow(await admit(budget, 9_500));
    expect(reopened.reopened).toBe(true);
    expect(reopened.continued).toBe(false);
    const state = budget.snapshotScope(scopeKey);
    expect(state?.windowId).toBe(windowBefore + 1);
    expect(state?.round).toBe(roundBefore + 1);
    expect(state?.generation).toBe(generationBefore + 1);
    expect(state?.calls).toBe(1);
    expect(state?.busyMs).toBe(0);
    expect(state?.continuations).toBe(0);
    expect(state?.turnId).toBeNull();
    expect(state?.continuationPolicy).toBe("inactive");
    expect(state?.pendingReopen).toBeNull();
    expect(state?.presentedToken).toBeTruthy();
    expect(state?.presentedToken).not.toBe(reopenToken);

    // 新生命周期可继续正常消费
    const second = expectAllow(await admit(budget, 10_000));
    expect(second.continued).toBe(false);
    expect(second.reopened).toBe(false);
    expect(budget.snapshotScope(scopeKey)?.calls).toBe(2);
  });

  it("SC-E9 new_question 前置校验：active 走 begin、未硬停拒、错凭证拒、非法 mode 拒", async () => {
    enableSettledStable();
    const scopeKey = budgetScopeKey(IDENTITY, SESSION);
    const budget = new QuestionBudget();
    await budget.beginQuestion({ identityKey: IDENTITY, sessionId: SESSION, turnId: TURN, now: 0 });
    const stopped = await exhaustByCalls(budget, 1_000);
    if (stopped.action !== "stop") throw new Error("expected stop");

    // active 生命周期：new_question 必须走 begin
    expect(await budget.declareContinuation(scopeKey, stopped.continueToken, 2_000, "new_question"))
      .toEqual({ ok: false, reason: "use_begin_question" });

    // inactive 未硬停（还有续查额度）不得新开
    const inactiveBudget = new QuestionBudget();
    const inactiveScope = budgetScopeKey(IDENTITY, SESSION);
    const firstStop = await exhaustByCalls(inactiveBudget, 1_000);
    if (firstStop.action !== "stop") throw new Error("expected stop");
    expect(await inactiveBudget.declareContinuation(inactiveScope, firstStop.continueToken, 2_000, "new_question"))
      .toEqual({ ok: false, reason: "not_hard_stopped" });

    // 零续查档（常量可配置）⇒ 首次触顶即硬停：错凭证拒、非法 mode 拒、正确凭证声明成功
    process.env.QUESTION_BUDGET_MAX_CONTINUATIONS_WHEN_BEGIN_INACTIVE = "0";
    const zeroIdentity = { key: "escape-zero|sha256:z", session: "sz" };
    const zeroScope = budgetScopeKey(zeroIdentity.key, zeroIdentity.session);
    const zeroBudget = new QuestionBudget();
    const zeroStop = await exhaustByCalls(zeroBudget, 1_000, { identity: zeroIdentity });
    if (zeroStop.action !== "stop") throw new Error("expected stop");
    expect(zeroStop.continuable).toBe(false);
    expect(zeroStop.nextStep).toEqual({ action: "lucy_continue_question", mode: "new_question", then: "retry_data_tool" });
    expect(await zeroBudget.declareContinuation(zeroScope, "wrong-token", 2_000, "new_question"))
      .toEqual({ ok: false, reason: "mismatch" });
    const invalid = await zeroBudget.declareContinuation(zeroScope, zeroStop.continueToken, 2_100, "sideways" as never);
    expect(invalid).toEqual({ ok: false, reason: "invalid_arguments" });
    expect(await zeroBudget.declareContinuation(zeroScope, zeroStop.continueToken, 2_200, "new_question"))
      .toMatchObject({ ok: true, declared: true, reopen: true });
  });

  it("SC-E7 active 回归：续查默认 3 档（REQ-0122 D6），第 4 次硬停 next_step 指向 begin", async () => {
    enableSettledStable();
    const scopeKey = budgetScopeKey(IDENTITY, SESSION);
    const budget = new QuestionBudget();
    await budget.beginQuestion({ identityKey: IDENTITY, sessionId: SESSION, turnId: TURN, now: 0 });
    let stopped = await exhaustByCalls(budget, 1_000);
    if (stopped.action !== "stop") throw new Error("expected stop");
    expect(stopped.continuable).toBe(true);

    // active 默认 3 档续查均可成交
    for (let c = 0; c < 3; c += 1) {
      await budget.declareContinuation(scopeKey, stopCredential(stopped), 2_000 + c);
      expectAllow(await admit(budget, 3_000 + c, { turnId: TURN }));
      for (let i = 0; i < QUESTION_BUDGET_MAX_CALLS; i += 1) await admit(budget, 4_000 + c, { turnId: TURN });
      stopped = await admit(budget, 4_000 + c, { turnId: TURN, canBegin: true });
      if (stopped.action !== "stop") throw new Error("expected stop");
      if (c < 2) expect(stopped.continuable).toBe(true);
    }

    // 第 4 次：no_credit；active 硬停 next_step 指向 begin
    expect(stopped.continuable).toBe(false);
    expect(stopped.continuationCreditLeft).toBe(false);
    expect(stopped.nextStep).toEqual({ action: "lucy_begin_question", then: "retry_data_tool" });
    expect(await budget.declareContinuation(scopeKey, stopped.continueToken, 9_000))
      .toEqual({ ok: false, reason: "no_credit" });
  });

  it("SC-E9b 声明后重启：pendingReopen 跨实例恢复并由下一数据工具兑现", async () => {
    enableSettledStable();
    const scopeKey = budgetScopeKey(IDENTITY, SESSION);
    const seeded = memoryPersistence();
    const first = new QuestionBudget();
    first.setPersistence(seeded.persistence);
    let stopped = await exhaustByCalls(first, 1_000);
    if (stopped.action !== "stop") throw new Error("expected stop");
    for (let i = 0; i < 5; i += 1) {
      await first.declareContinuation(scopeKey, stopCredential(stopped), 2_000 + i);
      await admit(first, 3_000 + i);
      for (let j = 0; j < QUESTION_BUDGET_MAX_CALLS; j += 1) await admit(first, 4_000 + i);
      stopped = await admit(first, 4_000 + i);
    }
    if (stopped.action !== "stop") throw new Error("expected stop");

    expect(await first.declareContinuation(scopeKey, stopped.continueToken, 9_000, "new_question"))
      .toMatchObject({ ok: true, declared: true, reopen: true });
    expect(seeded.rows.get(scopeKey)?.pendingReopen?.token).toBe(stopped.continueToken);
    expect(seeded.rows.get(scopeKey)?.continuationPolicy).toBe("inactive");
    expect(seeded.rows.get(scopeKey)?.generation).toBeGreaterThan(0);

    // 代理重启：新实例、同一持久层 —— 声明仍由下一数据工具兑现
    const restarted = new QuestionBudget();
    restarted.setPersistence(seeded.persistence);
    const reopened = expectAllow(await admit(restarted, 10_000));
    expect(reopened.reopened).toBe(true);
    const state = restarted.snapshotScope(scopeKey);
    expect(state?.continuations).toBe(0);
    expect(state?.calls).toBe(1);
    expect(state?.pendingReopen).toBeNull();
    expect(state?.turnId).toBeNull();
  });

  it("SC-E9b 旧行缺 policy 仅按持久 turnId 推导一次：有 turn=active（默认 3 档），无 turn=inactive（5 档）", async () => {
    enableSettledStable();
    // 旧行：无 continuationPolicy / generation / pendingReopen 字段
    const legacyActive: BudgetState = {
      scopeKey: budgetScopeKey(IDENTITY, SESSION),
      startedAt: 0, originStartedAt: 0, calls: 0, continuations: 0, attempts: 0,
      peakConcurrency: 0, currentConcurrency: 0,
      round: 1, turnId: TURN, windowId: 1, busyMs: 0, inflight: 0,
      pendingToken: null, presentedToken: null, archivedBusyMsByWindow: {}
    } as BudgetState;
    const seededActive = memoryPersistence(legacyActive);
    const activeBudget = new QuestionBudget();
    activeBudget.setPersistence(seededActive.persistence);
    let stopped = await exhaustByCalls(activeBudget, 1_000);
    if (stopped.action !== "stop") throw new Error("expected stop");
    // active 默认 3 档：用满后第 4 次声明 no_credit；推导值已落库
    for (let c = 0; c < 3; c += 1) {
      await activeBudget.declareContinuation(budgetScopeKey(IDENTITY, SESSION), stopCredential(stopped), 2_000 + c);
      expectAllow(await admit(activeBudget, 3_000 + c, { turnId: TURN }));
      for (let i = 0; i < QUESTION_BUDGET_MAX_CALLS; i += 1) await admit(activeBudget, 4_000 + c, { turnId: TURN });
      stopped = await admit(activeBudget, 4_000 + c, { turnId: TURN, canBegin: true });
      if (stopped.action !== "stop") throw new Error("expected stop");
    }
    expect(await activeBudget.declareContinuation(budgetScopeKey(IDENTITY, SESSION), stopped.continueToken, 9_000))
      .toEqual({ ok: false, reason: "no_credit" });
    expect(seededActive.rows.get(budgetScopeKey(IDENTITY, SESSION))?.continuationPolicy).toBe("active");

    // 旧行无 turn ⇒ inactive ⇒ 5 档
    const otherIdentity = { key: "escape-user-2|sha256:x", session: "s2" };
    const otherScope = budgetScopeKey(otherIdentity.key, otherIdentity.session);
    const legacyInactive: BudgetState = {
      scopeKey: otherScope,
      startedAt: 0, originStartedAt: 0, calls: 0, continuations: 0, attempts: 0,
      peakConcurrency: 0, currentConcurrency: 0,
      round: 1, turnId: null, windowId: 1, busyMs: 0, inflight: 0,
      pendingToken: null, presentedToken: null, archivedBusyMsByWindow: {}
    } as BudgetState;
    const seededInactive = memoryPersistence(legacyInactive);
    const inactiveBudget = new QuestionBudget();
    inactiveBudget.setPersistence(seededInactive.persistence);
    let stop = await exhaustByCalls(inactiveBudget, 1_000, { identity: otherIdentity });
    if (stop.action !== "stop") throw new Error("expected stop");
    for (let i = 0; i < 5; i += 1) {
      const declared = await inactiveBudget.declareContinuation(otherScope, stop.continueToken, 2_000 + i);
      expect(declared).toMatchObject({ ok: true, declared: true });
      expectAllow(await admit(inactiveBudget, 3_000 + i, { identity: otherIdentity }));
      if (i < 4) {
        for (let j = 0; j < QUESTION_BUDGET_MAX_CALLS; j += 1) await admit(inactiveBudget, 4_000 + i, { identity: otherIdentity });
        stop = await admit(inactiveBudget, 4_000 + i, { identity: otherIdentity });
        if (stop.action !== "stop") throw new Error("expected stop");
      }
    }
    expect(seededInactive.rows.get(otherScope)?.continuationPolicy).toBe("inactive");
  });

  it("SC-E9b 幂等：同 token 同代重试幂等成功；不同 pending 拒绝；旧窗凭证跨代拒", async () => {
    enableSettledStable();
    const scopeKey = budgetScopeKey(IDENTITY, SESSION);
    const budget = new QuestionBudget();
    const stopped = await exhaustByCalls(budget, 1_000);
    if (stopped.action !== "stop") throw new Error("expected stop");

    // 同 token 重试声明幂等
    expect(await budget.declareContinuation(scopeKey, stopped.continueToken, 2_000)).toMatchObject({ ok: true, declared: true });
    expect(await budget.declareContinuation(scopeKey, stopped.continueToken, 2_100)).toMatchObject({ ok: true, idempotent: true });
    // 不同 pending 拒绝
    expect(await budget.declareContinuation(scopeKey, "other-token", 2_200)).toEqual({ ok: false, reason: "pending_exists" });
    // 消费后旧窗凭证不得跨代兑现：新窗再次触顶后，旧窗凭证被判 mismatch
    expectAllow(await admit(budget, 3_000));
    for (let i = 0; i < QUESTION_BUDGET_MAX_CALLS - 1; i += 1) await admit(budget, 4_000);
    const stopAgain = await admit(budget, 4_000);
    expect(stopAgain.action).toBe("stop");
    expect(await budget.declareContinuation(scopeKey, stopped.continueToken, 5_000)).toEqual({ ok: false, reason: "mismatch" });
  });

  it("逃生工具不可达（无计费问数能力）时 next_step 为 hard_budget_stop", async () => {
    enableSettledStable();
    const scopeKey = budgetScopeKey(IDENTITY, SESSION);
    const budget = new QuestionBudget();
    let stopped = await exhaustByCalls(budget, 1_000);
    if (stopped.action !== "stop") throw new Error("expected stop");
    // 先烧掉 5 档续查（canContinue=false 只影响停机载荷，不影响额度）
    for (let i = 0; i < 5; i += 1) {
      await budget.declareContinuation(scopeKey, stopCredential(stopped), 2_000 + i);
      await admit(budget, 3_000 + i, { canContinue: false });
      for (let j = 0; j < QUESTION_BUDGET_MAX_CALLS; j += 1) await admit(budget, 4_000 + i, { canContinue: false });
      stopped = await admit(budget, 4_000 + i, { canContinue: false });
    }
    if (stopped.action !== "stop") throw new Error("expected stop");
    expect(stopped.continuable).toBe(false);
    expect(stopped.canContinueByCapability).toBe(false);
    expect(stopped.nextStep).toEqual({ action: "hard_budget_stop", hints: ["ops_clear_scope"] });
  });
});

/**
 * D7 / SC-E9 —— 经**真实 MCP** 的逃生可达性：
 * - 数据问数身份未显式授予 continue 时，tools/list 仍可见、tools/call 可达（不新增数据权限）；
 * - wiki-only 身份仍不可达（SC-47 合同不变）；
 * - 停机载荷携带结构化 next_step（软信封，非 isError 强制）。
 */
describe("budget escape reachability over a real MCP call (D7)", () => {
  const TOKEN = "budget-escape-token";
  const WIKI_TOKEN = "budget-escape-wiki-token";
  const SESSION = "sess-escape";

  function tokenHash(token: string): string {
    return "sha256:" + createHash("sha256").update(token).digest("hex");
  }

  const ACCESS_YAML = `users:
  - id: escape_agent
    name: Escape Agent
    enabled: true
    tokens:
      - hash: "${tokenHash(TOKEN)}"
        label: escape-token
        created: 2026-11-22
    allow:
      connections:
        - mysql-aliyun
      tables:
        - dataforai.superstore_orders
      tools:
        - lucy_query
        - lucy_read_source
        - lucy_begin_question
  - id: escape_wiki_only
    name: Escape Wiki Only
    enabled: true
    tokens:
      - hash: "${tokenHash(WIKI_TOKEN)}"
        label: escape-wiki-token
        created: 2026-11-22
    allow:
      tools:
        - wiki_search
        - wiki_read
defaults:
  deny_tools: []
`;

  let projectRoot: string;
  let previousProjectRoot: string | undefined;
  let previousContentRoot: string | undefined;
  let previousAuditDb: string | undefined;
  let previousInternalToken: string | undefined;

  beforeEach(async () => {
    vi.resetModules();
    projectRoot = await mkdtemp(path.join(os.tmpdir(), "ktx-budget-escape-"));
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
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    process.env.LUCY_AUDIT_DB = path.join(projectRoot, "audit.sqlite");
    process.env.KTX_INTERNAL_TOKEN = "internal-budget-escape-token";
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
    await rm(projectRoot, { recursive: true, force: true });
  });

  async function withProxy(
    run: (call: (
      token: string,
      method: string,
      params: unknown
    ) => Promise<{ status: number; body: string }>) => Promise<void>
  ): Promise<void> {
    const { buildProxy } = await import("../proxy/mcp-proxy.js");
    const { server, host } = buildProxy();
    await new Promise<void>((resolve) => server.listen(0, host, resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      await run(async (token, method, params) => {
        const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
            "x-lucy-session-id": SESSION
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: "escape-call", method, params })
        });
        return { status: res.status, body: await res.text() };
      });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    }
  }

  it("D7 data identity without an explicit continue grant sees and reaches the escape tool", async () => {
    await withProxy(async (call) => {
      const list = await call(TOKEN, "tools/list", {});
      expect(list.status).toBe(200);
      const listEnvelope = JSON.parse(list.body) as { result?: { tools?: Array<{ name?: string }> } };
      const names = (listEnvelope.result?.tools ?? []).map((tool) => tool.name ?? "");
      expect(names).toContain("lucy_query");
      expect(names).toContain("lucy_continue_question");

      // 调用可达（不新增数据权限）：无 begin 生命周期，未触顶 ⇒ not_exhausted
      const result = await call(TOKEN, "tools/call", {
        name: "lucy_continue_question",
        arguments: { token: "whatever" }
      });
      expect(result.status).toBe(200);
      expect(result.body).not.toContain("Access denied");
      const envelope = JSON.parse(result.body) as { result?: { content?: Array<{ text?: string }>; isError?: boolean } };
      const payload = JSON.parse(envelope.result?.content?.[0]?.text ?? "{}") as { ok?: boolean; reason?: string };
      expect(payload.ok).toBe(false);
      expect(payload.reason).toBe("not_exhausted");
    });
  });

  it("D7 wiki-only identity still cannot reach the escape tool (SC-47 unchanged)", async () => {
    await withProxy(async (call) => {
      const result = await call(WIKI_TOKEN, "tools/call", {
        name: "lucy_continue_question",
        arguments: { token: "whatever" }
      });
      expect(result.status).toBe(200);
      expect(result.body).toContain("Access denied");
    });
  });

  it("D8 exhaustion stop over a real MCP call is a soft envelope with structured next_step", async () => {
    const { questionBudget, budgetIdentityKey, budgetScopeKey } = await import("../proxy/question-experience.js");
    const identityKey = budgetIdentityKey("escape_agent", tokenHash(TOKEN).slice(0, 19));
    const scopeKey = budgetScopeKey(identityKey, SESSION);
    // 预耗尽该作用域（inactive，无 begin 生命周期）。
    for (let i = 0; i < QUESTION_BUDGET_MAX_CALLS; i += 1) {
      const decision = await questionBudget.consumePersisted(undefined, Date.now(), undefined, undefined, {
        identityKey, sessionId: SESSION, canContinue: true
      });
      expect(decision.action).toBe("allow");
      if (decision.action === "allow" && decision.ticket) {
        await questionBudget.settle(decision.ticket, decision.ticket.startMonoMs);
      }
    }
    await withProxy(async (call) => {
      const result = await call(TOKEN, "tools/call", {
        name: "lucy_query",
        arguments: { connectionId: "mysql-aliyun", sourceName: "superstore_orders", measures: ["superstore_orders.order_count"] }
      });
      expect(result.status).toBe(200);
      const envelope = JSON.parse(result.body) as {
        result?: { isError?: boolean; content?: Array<{ text?: string }> };
      };
      // 软信封：不强制 isError=true
      expect(envelope.result?.isError).not.toBe(true);
      const payload = JSON.parse(envelope.result?.content?.[0]?.text ?? "{}") as {
        reason?: string;
        continuable?: boolean;
        next_step?: { action?: string; mode?: string };
      };
      expect(payload.reason).toBe("question_budget_exhausted");
      expect(payload.continuable).toBe(true);
      expect(payload.next_step).toEqual({ action: "lucy_continue_question", mode: "continue", then: "retry_data_tool" });
    });
    expect(questionBudget.snapshotScope(scopeKey)?.presentedToken).toBeTruthy();
  });
});
