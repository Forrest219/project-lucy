/**
 * 续查通道单元验收（S5 / Spec §6.3、§6.4、§6.7、§7.3、§7.4、§7.7）。
 *
 * 覆盖 SC-15…SC-24、SC-29、SC-30、SC-42、SC-45。
 *
 * 约定：
 * - 只用内存持久层夹具（`memoryPersistence`），不起真实代理、不连数据库。
 * - 不用 `questionBudget` 单例，每个用例自建 `new QuestionBudget()`。
 * - 并发用 `Promise.all` 表达同一作用域的并发；时钟用 `setMonoClock` 可控。
 * - 夹具全部为合成数据，不含任何真实客户标识或凭据。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import {
  QUESTION_BUDGET_MAX_BUSY_MS,
  QUESTION_BUDGET_MAX_CALLS,
  QuestionBudget,
  budgetIdentityKey,
  budgetScopeKey,
  type BudgetAllow,
  type BudgetDecision,
  type BudgetPersistence,
  type BudgetState
} from "../proxy/question-experience.js";

// 合成身份与会话（不得使用真实客户数据）。
const IDENTITY = budgetIdentityKey("synthetic-user", "sha256:synthetic");
const SESSION = "synthetic-session";
const OTHER_IDENTITY = budgetIdentityKey("synthetic-user-b", "sha256:syntheticb");
const OTHER_SESSION = "synthetic-session-b";
const TURN = "turn-synthetic";

type MemorySave = { scopeKey: string; idempotencyKey?: string; state: BudgetState };

/**
 * 内存持久层夹具。与同族文件 `question-budget-window-mode.test.ts` 同源，
 * 额外记录每次 `save` 的落库内容，供「同批落库」类断言使用。
 */
function memoryPersistence(seed?: BudgetState): {
  persistence: BudgetPersistence;
  rows: Map<string, BudgetState>;
  keys: Map<string, Set<string>>;
  saves: MemorySave[];
  failLoad: { current: boolean };
  failSave: { current: boolean };
} {
  const rows = new Map<string, BudgetState>();
  const keys = new Map<string, Set<string>>();
  const saves: MemorySave[] = [];
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
      const row = {
        ...state,
        scopeKey,
        archivedBusyMsByWindow: { ...(state.archivedBusyMsByWindow ?? {}) }
      };
      rows.set(scopeKey, row);
      if (idempotencyKey) known.add(idempotencyKey);
      keys.set(scopeKey, known);
      saves.push({ scopeKey, idempotencyKey, state: row });
      return { row, appliedKeys: [...known] };
    },
    async listScopes() {
      return [...rows.keys()];
    }
  };
  return { persistence, rows, keys, saves, failLoad, failSave };
}

type ConsumeOptions = {
  /** 本次调用解析出的 turnId。无 turn 的作用域传 undefined。 */
  turnId?: string;
  /** HTTP 头 `x-lucy-question-continue` 回传的凭证。 */
  header?: string;
  /** 该调用者是否可见并已授权 `lucy_continue_question`。 */
  canContinue?: boolean;
  /** 使用的身份 + 会话，默认当前合成身份。 */
  identity?: { key: string; session: string };
};

/** 发起一次数据工具调用并立即结算（增量 0），返回准入判定。 */
async function admit(budget: QuestionBudget, now: number, options: ConsumeOptions = {}): Promise<BudgetDecision> {
  const decision = await open(budget, now, options);
  if (decision.action === "allow" && decision.ticket) {
    await budget.settle(decision.ticket, decision.ticket.startMonoMs);
  }
  return decision;
}

/** 发起一次数据工具调用但不结算（用于构造已结算时长与并发场景）。 */
async function open(budget: QuestionBudget, now: number, options: ConsumeOptions = {}): Promise<BudgetDecision> {
  return budget.consumePersisted(options.turnId, now, options.header, undefined, {
    identityKey: options.identity?.key ?? IDENTITY,
    sessionId: options.identity?.session ?? SESSION,
    canContinue: options.canContinue ?? true
  });
}

/**
 * 用次数维度把预算用尽，返回停机判定。
 *
 * 以「第一次返回 stop」为终止条件：续查换窗后窗口内已用次数不为 0，
 * 固定次数的写法会把「窗口内第 N 次」误当成「全局第 N 次」。
 */
async function exhaustByCalls(budget: QuestionBudget, now: number): Promise<BudgetDecision> {
  for (let i = 0; i <= QUESTION_BUDGET_MAX_CALLS; i += 1) {
    const decision = await admit(budget, now);
    if (decision.action === "stop") return decision;
    expect(decision.action).toBe("allow");
  }
  throw new Error("预算未在预期次数内用尽");
}

/**
 * 断言放行，并返回窄化后的 allow 判定。
 *
 * `BudgetDecision` 是联合类型；只有 allow 分支带 `continued` 与 `ticket`。
 */
function expectAllow(decision: BudgetDecision): BudgetAllow {
  expect(decision.action).toBe("allow");
  if (decision.action !== "allow") throw new Error(`expected allow, got ${decision.action}`);
  return decision;
}

/** 开启 settled + stable 两个开关（D7）。 */
function enableSettledStable(): void {
  process.env.LUCY_QUESTION_BUDGET_WALL_MODE = "settled";
  process.env.LUCY_QUESTION_BUDGET_SCOPE = "stable";
}

describe("question budget continuation", () => {
  const previousWall = process.env.LUCY_QUESTION_BUDGET_WALL_MODE;
  const previousScope = process.env.LUCY_QUESTION_BUDGET_SCOPE;

  afterEach(() => {
    if (previousWall === undefined) delete process.env.LUCY_QUESTION_BUDGET_WALL_MODE;
    else process.env.LUCY_QUESTION_BUDGET_WALL_MODE = previousWall;
    if (previousScope === undefined) delete process.env.LUCY_QUESTION_BUDGET_SCOPE;
    else process.env.LUCY_QUESTION_BUDGET_SCOPE = previousScope;
  });

  it("SC-15 首次停机对可见并已授权的调用者给出 continuable=true 与 presentedToken 凭证", async () => {
    enableSettledStable();
    const scopeKey = budgetScopeKey(IDENTITY, SESSION);
    const budget = new QuestionBudget();
    await budget.beginQuestion({ identityKey: IDENTITY, sessionId: SESSION, turnId: TURN, now: 0 });

    const stopped = await exhaustByCalls(budget, 1_000);
    expect(stopped.action).toBe("stop");
    if (stopped.action !== "stop") return;
    expect(stopped.reason).toBe("question_budget_exhausted");
    expect(stopped.partial).toBe(true);
    // 该调用者可见且已授权续查工具 ⇒ 可继续
    expect(stopped.continuable).toBe(true);
    expect(stopped.canContinueByCapability).toBe(true);
    expect(stopped.continuationCreditLeft).toBe(true);
    // 凭证等于 presentedToken；有 turn 时等于 turnId
    const state = budget.snapshotScope(scopeKey);
    expect(stopped.continueToken).toBe(state?.presentedToken);
    expect(stopped.continueToken).toBe(TURN);
    // 凭证不得包含 scopeKey 或 identityKey
    expect(stopped.continueToken).not.toContain("bq:");
    expect(stopped.continueToken).not.toContain(IDENTITY);
    expect(stopped.continueToken).not.toContain("synthetic-user");

    // 无 turn 的作用域：凭证是不透明随机值，不得等于作用域键或身份键
    const noTurn = new QuestionBudget();
    for (let i = 0; i < QUESTION_BUDGET_MAX_CALLS; i += 1) await admit(noTurn, 1_000);
    const noTurnStop = await admit(noTurn, 1_000);
    expect(noTurnStop.action).toBe("stop");
    if (noTurnStop.action !== "stop") return;
    expect(noTurnStop.continueToken).toBeTruthy();
    expect(noTurnStop.continueToken).not.toContain("bq:");
    expect(noTurnStop.continueToken).not.toContain(IDENTITY);
    expect(noTurnStop.continueToken).not.toBe(budgetScopeKey(IDENTITY, SESSION));
    expect(noTurnStop.continueToken).not.toBe(stopped.continueToken);
  });

  it("SC-16 调用者不可见续查工具时 continuable=false，不得宣称存在可达通道", async () => {
    enableSettledStable();
    const budget = new QuestionBudget();
    await budget.beginQuestion({ identityKey: IDENTITY, sessionId: SESSION, turnId: TURN, now: 0 });
    for (let i = 0; i < QUESTION_BUDGET_MAX_CALLS; i += 1) await admit(budget, 1_000, { canContinue: false });

    const stopped = await admit(budget, 1_000, { canContinue: false });
    expect(stopped.action).toBe("stop");
    if (stopped.action !== "stop") return;
    expect(stopped.reason).toBe("question_budget_exhausted");
    // 不可见 ⇒ 不得引导重试不可达路径
    expect(stopped.continuable).toBe(false);
    expect(stopped.canContinueByCapability).toBe(false);
    // 额度仍在，但通道不可达 —— 两者是不同的事实
    expect(stopped.continuationCreditLeft).toBe(true);
  });

  it("SC-17 声明被接受后该次数据调用获得归零后的新窗口，续查生效与放行同批落库", async () => {
    enableSettledStable();
    const scopeKey = budgetScopeKey(IDENTITY, SESSION);
    const seeded = memoryPersistence();
    const budget = new QuestionBudget();
    budget.setPersistence(seeded.persistence);
    let mono = 0;
    budget.setMonoClock(() => mono);
    await budget.beginQuestion({ identityKey: IDENTITY, sessionId: SESSION, turnId: TURN, now: 0 });

    // 一次 120 秒的数据调用把「已结算处理时长」打满
    const opening = await open(budget, 1_000);
    expect(opening.action).toBe("allow");
    if (opening.action !== "allow" || !opening.ticket) return;
    mono = QUESTION_BUDGET_MAX_BUSY_MS;
    await budget.settle(opening.ticket, mono);
    expect(budget.snapshotScope(scopeKey)?.busyMs).toBe(QUESTION_BUDGET_MAX_BUSY_MS);

    const stopped = await admit(budget, 2_000);
    expect(stopped.action).toBe("stop");
    if (stopped.action !== "stop") return;

    // 声明被接受
    const declared = await budget.declareContinuation(scopeKey, stopped.continueToken, 3_000);
    expect(declared).toMatchObject({ ok: true, declared: true });

    const writesBefore = seeded.saves.length;
    const continued = expectAllow(await open(budget, 4_000));
    expect(continued.continued).toBe(true);

    // 准入后：calls=1、busyMs=0、windowId +1
    const state = budget.snapshotScope(scopeKey);
    expect(state?.calls).toBe(1);
    expect(state?.busyMs).toBe(0);
    expect(state?.windowId).toBe(2);
    expect(state?.continuations).toBe(1);
    expect(state?.pendingToken).toBeNull();
    expect(state?.presentedToken).toBeNull();
    // 旧窗口的已结算时长进入归档而不是凭空消失
    expect(Object.values(state?.archivedBusyMsByWindow ?? {})).toContain(QUESTION_BUDGET_MAX_BUSY_MS);

    // 续查生效事实与该次放行同批落库：只有一次写入，且该写入同时含「生效」与「放行」
    const writes = seeded.saves.slice(writesBefore);
    expect(writes.length).toBe(1);
    expect(writes[0].idempotencyKey).toMatch(/^admit:/);
    expect(writes[0].state.continuations).toBe(1);
    expect(writes[0].state.calls).toBe(1);
  });

  it("SC-18 续查额度用尽后再声明被拒 no_credit，且不得重置窗口", async () => {
    enableSettledStable();
    const scopeKey = budgetScopeKey(IDENTITY, SESSION);
    const budget = new QuestionBudget();
    await budget.beginQuestion({ identityKey: IDENTITY, sessionId: SESSION, turnId: TURN, now: 0 });
    const stopped = await exhaustByCalls(budget, 1_000);
    expect(stopped.action).toBe("stop");
    if (stopped.action !== "stop") return;

    expect(await budget.declareContinuation(scopeKey, stopped.continueToken, 2_000)).toMatchObject({ ok: true, declared: true });
    const continued = expectAllow(await admit(budget, 3_000));
    expect(continued.continued).toBe(true);
    const before = budget.snapshotScope(scopeKey);
    expect(before?.continuations).toBe(1);

    // 额度已用尽 ⇒ 拒绝
    const again = await budget.declareContinuation(scopeKey, stopped.continueToken, 4_000);
    expect(again).toEqual({ ok: false, reason: "no_credit" });

    // 不得重置窗口
    const after = budget.snapshotScope(scopeKey);
    expect(after?.continuations).toBe(1);
    expect(after?.windowId).toBe(before?.windowId);
    expect(after?.calls).toBe(before?.calls);
    expect(after?.busyMs).toBe(before?.busyMs);
  });

  it("SC-19 已有 pendingToken 时以不同 token 声明被拒 pending_exists，原 pending 保持有效", async () => {
    enableSettledStable();
    const scopeKey = budgetScopeKey(IDENTITY, SESSION);
    const budget = new QuestionBudget();
    await budget.beginQuestion({ identityKey: IDENTITY, sessionId: SESSION, turnId: TURN, now: 0 });
    const stopped = await exhaustByCalls(budget, 1_000);
    expect(stopped.action).toBe("stop");
    if (stopped.action !== "stop") return;

    expect(await budget.declareContinuation(scopeKey, stopped.continueToken, 2_000)).toMatchObject({ ok: true, declared: true });
    expect(await budget.declareContinuation(scopeKey, "another-token", 2_100)).toEqual({ ok: false, reason: "pending_exists" });
    // 原 pending 保持有效
    expect(budget.snapshotScope(scopeKey)?.pendingToken).toBe(stopped.continueToken);

    const continued = expectAllow(await admit(budget, 3_000));
    expect(continued.continued).toBe(true);
    expect(budget.snapshotScope(scopeKey)?.continuations).toBe(1);
  });

  it("SC-20 以相同 token 重复声明幂等成功，且不得产生第二条 pending", async () => {
    enableSettledStable();
    const scopeKey = budgetScopeKey(IDENTITY, SESSION);
    const seeded = memoryPersistence();
    const budget = new QuestionBudget();
    budget.setPersistence(seeded.persistence);
    await budget.beginQuestion({ identityKey: IDENTITY, sessionId: SESSION, turnId: TURN, now: 0 });
    const stopped = await exhaustByCalls(budget, 1_000);
    expect(stopped.action).toBe("stop");
    if (stopped.action !== "stop") return;

    expect(await budget.declareContinuation(scopeKey, stopped.continueToken, 2_000)).toMatchObject({ ok: true, declared: true });
    const writesBefore = seeded.saves.length;
    const again = await budget.declareContinuation(scopeKey, stopped.continueToken, 2_100);
    expect(again).toMatchObject({ ok: true, idempotent: true });
    // 幂等分支不得再落库
    expect(seeded.saves.length).toBe(writesBefore);
    // 不得产生第二条 pending
    expect(budget.snapshotScope(scopeKey)?.pendingToken).toBe(stopped.continueToken);

    // 消费后额度只加一次、窗口只换一次
    const continued = expectAllow(await admit(budget, 3_000));
    expect(continued.continued).toBe(true);
    const state = budget.snapshotScope(scopeKey);
    expect(state?.continuations).toBe(1);
    expect(state?.windowId).toBe(2);
    expect(state?.pendingToken).toBeNull();
  });

  it("SC-21 头部路径与工具路径并发提交续查时额度只加一次、窗口只换一次", async () => {
    enableSettledStable();
    const scopeKey = budgetScopeKey(IDENTITY, SESSION);

    // 场景一：工具路径声明已落地，头部路径与工具路径并发消费
    {
      const budget = new QuestionBudget();
      await budget.beginQuestion({ identityKey: IDENTITY, sessionId: SESSION, turnId: TURN, now: 0 });
      const stopped = await exhaustByCalls(budget, 1_000);
      expect(stopped.action).toBe("stop");
      if (stopped.action !== "stop") return;
      const windowBefore = budget.snapshotScope(scopeKey)?.windowId ?? 0;
      expect(await budget.declareContinuation(scopeKey, stopped.continueToken, 2_000)).toMatchObject({ ok: true, declared: true });

      const [headerDecision, toolDecision] = await Promise.all([
        open(budget, 2_000, { turnId: TURN, header: TURN }),
        open(budget, 2_000, { turnId: TURN })
      ]);
      expect(headerDecision.action).toBe("allow");
      expect(toolDecision.action).toBe("allow");
      // 续查只兑现一次
      const continuedCount = [headerDecision, toolDecision].filter(
        (item) => item.action === "allow" && item.continued === true
      ).length;
      expect(continuedCount).toBe(1);
      const state = budget.snapshotScope(scopeKey);
      expect(state?.continuations).toBe(1);
      expect(state?.windowId).toBe(windowBefore + 1);
    }

    // 场景二：头部路径消费与工具路径声明并发
    {
      const budget = new QuestionBudget();
      await budget.beginQuestion({ identityKey: IDENTITY, sessionId: SESSION, turnId: TURN, now: 0 });
      const stopped = await exhaustByCalls(budget, 1_000);
      expect(stopped.action).toBe("stop");
      if (stopped.action !== "stop") return;
      const windowBefore = budget.snapshotScope(scopeKey)?.windowId ?? 0;

      const [headerDecision, declared] = await Promise.all([
        open(budget, 2_000, { turnId: TURN, header: TURN }),
        budget.declareContinuation(scopeKey, stopped.continueToken, 2_000)
      ]);
      expect(expectAllow(headerDecision).continued).toBe(true);
      // 声明要么先落地，要么被额度闸拒绝；不得出现第二条 pending
      if (declared.ok) expect(declared.declared).toBe(true);
      else expect(declared.reason).toBe("no_credit");
      const state = budget.snapshotScope(scopeKey);
      expect(state?.continuations).toBe(1);
      expect(state?.windowId).toBe(windowBefore + 1);
      expect(state?.pendingToken).toBeNull();

      // 工具路径随后再消费一次，不得再加额度、不得再换窗
      const toolDecision = await open(budget, 3_000, { turnId: TURN });
      expect(expectAllow(toolDecision).continued).toBe(false);
      const after = budget.snapshotScope(scopeKey);
      expect(after?.continuations).toBe(1);
      expect(after?.windowId).toBe(windowBefore + 1);
    }
  });

  it("SC-22 无效或错配的凭证声明与头部回传都被拒绝，不得重置窗口，匹配事实记为 false", async () => {
    enableSettledStable();
    const scopeKey = budgetScopeKey(IDENTITY, SESSION);
    const budget = new QuestionBudget();
    await budget.beginQuestion({ identityKey: IDENTITY, sessionId: SESSION, turnId: TURN, now: 0 });
    const stopped = await exhaustByCalls(budget, 1_000);
    expect(stopped.action).toBe("stop");
    if (stopped.action !== "stop") return;
    const windowBefore = budget.snapshotScope(scopeKey)?.windowId ?? 0;

    // 错配 token 的声明被拒绝
    expect(await budget.declareContinuation(scopeKey, "mismatched-token", 2_000)).toEqual({ ok: false, reason: "mismatch" });
    expect(budget.snapshotScope(scopeKey)?.pendingToken).toBeNull();

    // 无效头部回传被拒绝：仍然停机，且不得重置窗口
    const invalidHeader = await admit(budget, 2_000, { turnId: TURN, header: "not-the-credential" });
    expect(invalidHeader.action).toBe("stop");
    if (invalidHeader.action !== "stop") return;
    expect(invalidHeader.reason).toBe("question_budget_exhausted");
    // 调用者提交过凭证但未匹配 ⇒ 呈现为 true、匹配为 false
    expect(invalidHeader.continuationPresented).toBe(true);
    expect(invalidHeader.continuationMatched).toBe(false);

    const state = budget.snapshotScope(scopeKey);
    expect(state?.windowId).toBe(windowBefore);
    expect(state?.continuations).toBe(0);
    expect(state?.calls).toBe(QUESTION_BUDGET_MAX_CALLS);
    expect(state?.pendingToken).toBeNull();
  });

  it("SC-22 用头部回传非活跃 turn 时不得被当作可信凭证换窗", async () => {
    enableSettledStable();
    const otherScopeKey = budgetScopeKey(OTHER_IDENTITY, OTHER_SESSION);
    const identity = { key: OTHER_IDENTITY, session: OTHER_SESSION };
    const budget = new QuestionBudget();
    await budget.beginQuestion({ identityKey: OTHER_IDENTITY, sessionId: OTHER_SESSION, turnId: "turn-active", now: 0 });
    for (let i = 0; i < QUESTION_BUDGET_MAX_CALLS; i += 1) {
      const allowed = await admit(budget, 1_000, { turnId: "turn-active", identity });
      expect(allowed.action).toBe("allow");
    }
    const before = budget.snapshotScope(otherScopeKey);
    expect(before?.presentedToken).toBeNull();
    expect(before?.turnId).toBe("turn-active");

    // 头部回传一个**非活跃 turn**：按 Spec §6.3，只有等于 presentedToken 或作用域活跃
    // turnId 的头部才可信 ⇒ 必须被拒绝，不得重置窗口，匹配事实记为 false
    const decision = await admit(budget, 2_000, { turnId: "turn-stale", header: "turn-stale", identity });
    expect(decision.action).toBe("stop");
    if (decision.action !== "stop") return;
    expect(decision.continuationMatched).toBe(false);
    const after = budget.snapshotScope(otherScopeKey);
    expect(after?.windowId).toBe(before?.windowId);
    expect(after?.continuations).toBe(0);
    expect(after?.calls).toBe(QUESTION_BUDGET_MAX_CALLS);
  });

  it("SC-23 声明续查后进程重启，pendingToken 从持久层恢复并被消费", async () => {
    enableSettledStable();
    const scopeKey = budgetScopeKey(IDENTITY, SESSION);
    const seeded = memoryPersistence();
    const first = new QuestionBudget();
    first.setPersistence(seeded.persistence);
    await first.beginQuestion({ identityKey: IDENTITY, sessionId: SESSION, turnId: TURN, now: 0 });
    const stopped = await exhaustByCalls(first, 1_000);
    expect(stopped.action).toBe("stop");
    if (stopped.action !== "stop") return;
    expect(await first.declareContinuation(scopeKey, stopped.continueToken, 2_000)).toMatchObject({ ok: true, declared: true });
    // pendingToken 必须已落库
    expect(seeded.rows.get(scopeKey)?.pendingToken).toBe(stopped.continueToken);

    // 进程重启：新的预算实例，同一持久层
    const restarted = new QuestionBudget();
    restarted.setPersistence(seeded.persistence);
    const continued = expectAllow(await admit(restarted, 3_000));
    expect(continued.continued).toBe(true);
    const state = restarted.snapshotScope(scopeKey);
    expect(state?.continuations).toBe(1);
    expect(state?.windowId).toBe(2);
    expect(state?.calls).toBe(1);
    expect(state?.pendingToken).toBeNull();
    expect(state?.turnId).toBe(TURN);
  });

  it("SC-24 声明续查不跨轮次生效，换问询后按新预算判定", async () => {
    enableSettledStable();
    const scopeKey = budgetScopeKey(IDENTITY, SESSION);
    const budget = new QuestionBudget();
    await budget.beginQuestion({ identityKey: IDENTITY, sessionId: SESSION, turnId: "turn-first", now: 0 });
    const stopped = await exhaustByCalls(budget, 1_000);
    expect(stopped.action).toBe("stop");
    if (stopped.action !== "stop") return;
    expect(await budget.declareContinuation(scopeKey, stopped.continueToken, 2_000)).toMatchObject({ ok: true, declared: true });
    expect(budget.snapshotScope(scopeKey)?.pendingToken).toBe(stopped.continueToken);

    // 换问询：旧 pending 不得跨轮次生效
    const begun = await budget.beginQuestion({ identityKey: IDENTITY, sessionId: SESSION, turnId: "turn-second", now: 3_000 });
    expect(begun.ok).toBe(true);
    expect(budget.snapshotScope(scopeKey)?.pendingToken).toBeNull();
    expect(budget.snapshotScope(scopeKey)?.presentedToken).toBeNull();

    // 新轮次按新预算判定：正常放行，且不是续查
    const decision = expectAllow(await admit(budget, 4_000, { turnId: "turn-second" }));
    expect(decision.continued).toBe(false);
    const state = budget.snapshotScope(scopeKey);
    expect(state?.continuations).toBe(0);
    expect(state?.calls).toBe(1);
    expect(state?.round).toBe(2);
  });

  it("SC-29 预算终止行记录续查呈现的四项事实", async () => {
    enableSettledStable();
    const scopeKey = budgetScopeKey(IDENTITY, SESSION);
    const budget = new QuestionBudget();
    await budget.beginQuestion({ identityKey: IDENTITY, sessionId: SESSION, turnId: TURN, now: 0 });

    // 第一次停机：额度还在、通道可达，但调用者没有提交过任何续查凭证
    const first = await exhaustByCalls(budget, 1_000);
    expect(first.action).toBe("stop");
    if (first.action !== "stop") return;
    expect(typeof first.continuationPresented).toBe("boolean");
    expect(typeof first.continuationMatched).toBe("boolean");
    expect(typeof first.continuationCreditLeft).toBe("boolean");
    expect(typeof first.canContinueByCapability).toBe("boolean");
    expect(first.continuationPresented).toBe(false);
    expect(first.continuationMatched).toBe(false);
    expect(first.continuationCreditLeft).toBe(true);
    expect(first.canContinueByCapability).toBe(true);

    // 用掉唯一的续查额度
    expect(await budget.declareContinuation(scopeKey, first.continueToken, 2_000)).toMatchObject({ ok: true, declared: true });
    const continued = expectAllow(await admit(budget, 3_000));
    expect(continued.continued).toBe(true);

    // 第二次停机：调用者回传了有效凭证但额度已用尽 ⇒ 呈现为 true、匹配为 true、额度为 false
    for (let i = 0; i < QUESTION_BUDGET_MAX_CALLS; i += 1) await admit(budget, 4_000);
    const second = await admit(budget, 4_000, { turnId: TURN, header: TURN });
    expect(second.action).toBe("stop");
    if (second.action !== "stop") return;
    expect(second.continuationPresented).toBe(true);
    expect(second.continuationMatched).toBe(true);
    expect(second.continuationCreditLeft).toBe(false);
    expect(second.canContinueByCapability).toBe(true);
    expect(second.continuable).toBe(false);
  });

  it("SC-30 续查声明与续查生效是两条可区分事实，且生效可关联到对应数据调用", async () => {
    enableSettledStable();
    const scopeKey = budgetScopeKey(IDENTITY, SESSION);
    const seeded = memoryPersistence();
    const budget = new QuestionBudget();
    budget.setPersistence(seeded.persistence);
    await budget.beginQuestion({ identityKey: IDENTITY, sessionId: SESSION, turnId: TURN, now: 0 });
    const stopped = await exhaustByCalls(budget, 1_000);
    expect(stopped.action).toBe("stop");
    if (stopped.action !== "stop") return;

    // 事实一：声明（只声明，未生效）
    const declared = await budget.declareContinuation(scopeKey, stopped.continueToken, 2_000);
    expect(declared).toMatchObject({ ok: true, declared: true });
    expect(budget.snapshotScope(scopeKey)?.continuations).toBe(0);
    expect(budget.snapshotScope(scopeKey)?.pendingToken).toBe(stopped.continueToken);

    // 事实二：生效（由一次数据调用兑现）
    const writesBefore = seeded.saves.length;
    const continued = expectAllow(await open(budget, 3_000));
    expect(continued.continued).toBe(true);

    // 两条事实可区分：声明事实不带「生效」标记，生效事实带「已换窗」的窗口票据
    expect(continued.ticket?.windowId).toBe(2);
    expect(continued.ticket?.requestId).toBeTruthy();
    // 生效事实与对应数据调用可关联：票据的 requestId 就是这次放行的落库幂等键
    const writes = seeded.saves.slice(writesBefore);
    expect(writes.length).toBe(1);
    expect(writes[0].idempotencyKey).toBe(`admit:${continued.ticket?.requestId}`);
    expect(writes[0].state.continuations).toBe(1);
    expect(writes[0].state.calls).toBe(1);
  });

  it("SC-42 续查换窗后再次停机发布的是该窗口已落库的行", async () => {
    enableSettledStable();
    const scopeKey = budgetScopeKey(IDENTITY, SESSION);
    const seeded = memoryPersistence();
    const budget = new QuestionBudget();
    budget.setPersistence(seeded.persistence);
    await budget.beginQuestion({ identityKey: IDENTITY, sessionId: SESSION, turnId: TURN, now: 0 });

    // 第一次停机（窗口 1）
    const stop1 = await exhaustByCalls(budget, 1_000);
    expect(stop1.action).toBe("stop");
    expect(seeded.rows.get(scopeKey)?.windowId).toBe(1);

    // 续查换窗（头部路径）
    const continued = expectAllow(await admit(budget, 2_000, { turnId: TURN, header: TURN }));
    expect(continued.continued).toBe(true);
    expect(seeded.rows.get(scopeKey)?.windowId).toBe(2);

    // 第二次停机（窗口 2），凭证字符串与第一次相同
    const stop2 = await exhaustByCalls(budget, 3_000);
    expect(stop2.action).toBe("stop");
    if (stop2.action !== "stop" || stop1.action !== "stop") return;
    expect(stop2.continueToken).toBe(stop1.continueToken);

    // 发布的是该窗口已落库的行，不得被另一窗口重算的候选态覆盖
    const rowAfterStop2 = seeded.rows.get(scopeKey);
    expect(rowAfterStop2?.windowId).toBe(2);
    expect(rowAfterStop2?.calls).toBe(QUESTION_BUDGET_MAX_CALLS);
    expect(rowAfterStop2?.continuations).toBe(1);
    expect(budget.snapshotScope(scopeKey)).toMatchObject({
      windowId: 2,
      calls: QUESTION_BUDGET_MAX_CALLS,
      continuations: 1
    });

    // 两次停机的幂等键含轮次与窗口，因此是不同的提交
    const keys = [...(seeded.keys.get(scopeKey) ?? [])];
    expect(keys.some((key) => key.startsWith("stop:1:1:"))).toBe(true);
    expect(keys.some((key) => key.startsWith("stop:1:2:"))).toBe(true);

    // 同一窗口内重复停机不得覆盖已落库行
    const callsBefore = seeded.rows.get(scopeKey)?.calls;
    const stop3 = await admit(budget, 3_000);
    expect(stop3.action).toBe("stop");
    expect(seeded.rows.get(scopeKey)?.calls).toBe(callsBefore);
  });

  it("SC-45 预算用尽时预先带上等于活跃 turnId 的续查头，直接进入新窗口并放行", async () => {
    enableSettledStable();
    const scopeKey = budgetScopeKey(IDENTITY, SESSION);
    const budget = new QuestionBudget();
    await budget.beginQuestion({ identityKey: IDENTITY, sessionId: SESSION, turnId: TURN, now: 0 });

    // 用尽额度，但不下发停机响应：调用者从未拿到过凭证
    for (let i = 0; i < QUESTION_BUDGET_MAX_CALLS; i += 1) await admit(budget, 1_000);
    const before = budget.snapshotScope(scopeKey);
    expect(before?.calls).toBe(QUESTION_BUDGET_MAX_CALLS);
    expect(before?.presentedToken).toBeNull();
    expect(before?.continuations).toBe(0);

    // 预先带上等于活跃 turnId 的续查头 ⇒ 直接进入新窗口并放行
    const decision = expectAllow(await admit(budget, 2_000, { turnId: TURN, header: TURN }));
    expect(decision.continued).toBe(true);
    const state = budget.snapshotScope(scopeKey);
    expect(state?.continuations).toBe(1);
    expect(state?.windowId).toBe(2);
    expect(state?.calls).toBe(1);
    expect(state?.busyMs).toBe(0);

    // 预算尚未用尽时，带续查头的调用不得提前换窗（否则续查头会变成无限额度旁路）
    const other = new QuestionBudget();
    await other.beginQuestion({ identityKey: OTHER_IDENTITY, sessionId: OTHER_SESSION, turnId: TURN, now: 0 });
    for (let i = 0; i < QUESTION_BUDGET_MAX_CALLS - 1; i += 1) {
      await admit(other, 1_000, { identity: { key: OTHER_IDENTITY, session: OTHER_SESSION } });
    }
    const last = await admit(other, 2_000, {
      turnId: TURN,
      header: TURN,
      identity: { key: OTHER_IDENTITY, session: OTHER_SESSION }
    });
    expect(expectAllow(last).continued).toBe(false);
    const otherState = other.snapshotScope(budgetScopeKey(OTHER_IDENTITY, OTHER_SESSION));
    expect(otherState?.calls).toBe(QUESTION_BUDGET_MAX_CALLS);
    expect(otherState?.continuations).toBe(0);
    expect(otherState?.windowId).toBe(1);
  });
});

/**
 * SC-47 —— 经**真实 MCP `tools/call`** 调用 `lucy_continue_question`。
 *
 * 合同要点（Spec §7.7 / Plan S5 第 4 条）：
 * - 工具 schema 只有 token，**参数闸不得要求 connection**；
 * - 仅 Wiki 角色若未获该工具，调用不可达，且 `continuable=false`。
 */
describe("lucy_continue_question over a real MCP call (SC-47)", () => {
  const TOKEN = "budget-continue-token";
  const WIKI_TOKEN = "budget-continue-wiki-token";
  const SESSION = "sess-continue";

  function tokenHash(token: string): string {
    return "sha256:" + createHash("sha256").update(token).digest("hex");
  }

  const ACCESS_YAML = `users:
  - id: continue_agent
    name: Continue Agent
    enabled: true
    tokens:
      - hash: "${tokenHash(TOKEN)}"
        label: continue-token
        created: 2026-10-30
    allow:
      connections:
        - mysql-aliyun
      tables:
        - dataforai.superstore_orders
      tools:
        - lucy_query
        - lucy_read_source
        - lucy_begin_question
        - lucy_continue_question
  - id: wiki_only_agent
    name: Wiki Only Agent
    enabled: true
    tokens:
      - hash: "${tokenHash(WIKI_TOKEN)}"
        label: wiki-only-token
        created: 2026-10-30
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
    projectRoot = await mkdtemp(path.join(os.tmpdir(), "ktx-budget-continue-"));
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
    process.env.KTX_INTERNAL_TOKEN = "internal-budget-continue-token";
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

  async function withProxy(run: (call: (token: string, args: unknown) => Promise<{ status: number; body: string }>) => Promise<void>): Promise<void> {
    const { buildProxy } = await import("../proxy/mcp-proxy.js");
    const { server, host } = buildProxy();
    await new Promise<void>((resolve) => server.listen(0, host, resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      await run(async (token, args) => {
        const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
            "x-lucy-session-id": SESSION
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: "continue-call",
            method: "tools/call",
            params: { name: "lucy_continue_question", arguments: args }
          })
        });
        return { status: res.status, body: await res.text() };
      });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    }
  }

  it("SC-47 accepts the continue tool without a connection argument and records the declaration", async () => {
    const { questionBudget, budgetIdentityKey, budgetScopeKey } = await import("../proxy/question-experience.js");
    const identityKey = budgetIdentityKey("continue_agent", tokenHash(TOKEN).slice(0, 19));
    const scopeKey = budgetScopeKey(identityKey, SESSION);

    // 把该作用域的额度用尽，并让停机凭证落到状态行里。
    for (let i = 0; i < QUESTION_BUDGET_MAX_CALLS; i += 1) {
      const decision = await questionBudget.consumePersisted(undefined, Date.now(), undefined, undefined, {
        identityKey,
        sessionId: SESSION,
        canContinue: true
      });
      expect(decision.action).toBe("allow");
      if (decision.action === "allow" && decision.ticket) {
        await questionBudget.settle(decision.ticket, decision.ticket.startMonoMs);
      }
    }
    const stopped = await questionBudget.consumePersisted(undefined, Date.now(), undefined, undefined, {
      identityKey,
      sessionId: SESSION,
      canContinue: true
    });
    expect(stopped.action).toBe("stop");
    if (stopped.action !== "stop") return;
    const presentedToken = questionBudget.snapshotScope(scopeKey)?.presentedToken;
    expect(presentedToken).toBeTruthy();

    await withProxy(async (call) => {
      // 只有 token，没有 connection —— 参数闸不得拦。
      const result = await call(TOKEN, { token: presentedToken });
      expect(result.status).toBe(200);
      expect(result.body).not.toContain("connection_required");
      expect(result.body).not.toContain("invalid_arguments");
      const envelope = JSON.parse(result.body) as {
        result?: { content?: Array<{ text?: string }> };
      };
      const payload = JSON.parse(envelope.result?.content?.[0]?.text ?? "{}") as {
        ok?: boolean;
        declared?: boolean;
      };
      expect(payload.ok).toBe(true);
      expect(payload.declared).toBe(true);
      // 声明落在预算状态行里（持久化待兑现）。
      expect(questionBudget.snapshotScope(scopeKey)?.pendingToken).toBe(presentedToken);
    });
  });

  it("SC-47 a role without the continue tool cannot reach it", async () => {
    await withProxy(async (call) => {
      const result = await call(WIKI_TOKEN, { token: "whatever" });
      expect(result.status).toBe(200);
      // 该角色没有这个工具 → 调用不可达（不得声明成功）。
      expect(result.body).toContain("Access denied");
      expect(result.body).not.toContain("\"declared\":true");
    });
  });
});
