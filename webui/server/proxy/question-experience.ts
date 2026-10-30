/**
 * Spec 162 — question budget, failure dimensions, filter-pushdown guard,
 * published version metadata, and usage actor grouping.
 * KTX is not modified. These functions fail closed inside the Lucy proxy.
 */

import { randomUUID } from "node:crypto";

export const QUESTION_BUDGET_MAX_CALLS = 20;
export const QUESTION_BUDGET_MAX_WALL_MS = 120_000;
export const QUESTION_BUDGET_MAX_BUSY_MS = 120_000;
export const QUESTION_BUDGET_MAX_INFLIGHT = 4;
export const QUESTION_BUDGET_ABS_EXEC_MS = 120_000;

/** D7：默认 settled。elapsed 只把时间判定退回流逝时间。 */
export function questionBudgetWallMode(): "settled" | "elapsed" {
  return process.env.LUCY_QUESTION_BUDGET_WALL_MODE === "elapsed" ? "elapsed" : "settled";
}

/** D7：默认 stable。legacy 回到 `turn:` / `scope:` 键。 */
export function questionBudgetScopeMode(): "stable" | "legacy" {
  return process.env.LUCY_QUESTION_BUDGET_SCOPE === "legacy" ? "legacy" : "stable";
}

/** D9：默认纳管认证路由与报表模板。off 时这两条入口不消耗预算。 */
export function questionBudgetBypassEnabled(): boolean {
  return process.env.LUCY_QUESTION_BUDGET_BYPASS !== "off";
}

/** 与 Spec §6.1 一致：`userId|tokenHashPrefix`。字段同 turn 归属身份，分隔符用 `|` 以便从作用域键还原。 */
export function budgetIdentityKey(userId: string, tokenHashPrefix: string): string {
  return `${userId}|${tokenHashPrefix}`;
}

export function budgetScopeKey(identityKey: string, sessionId?: string | null): string {
  const session = sessionId && sessionId.length > 0 ? sessionId : "-";
  return `bq:${identityKey}:${session}`;
}

const DATA_TOOLS = new Set([
  "lucy_query",
  "lucy_read_source",
  "lucy_freshness",
  "lucy_explain_query",
  "wiki_search",
  "wiki_read",
]);

const ACL_REASONS = new Set([
  "sensitive_metadata_forbidden",
  "wiki_forbidden",
  "raw_query_forbidden",
  "agent_disabled",
]);


export type FailureDimension = "" | "引擎超时与并发" | "过滤条件下推" | "用法与语义" | "权限拒绝";
export type UsageGroup = "使用人" | "Agent" | "自动化调用";
export type ActorKind = "person" | "automation";

export type PublishedVersion = {
  version: string;
  businessDate: string;
  valueKind: "实际" | "预测";
};

export type BudgetStop = {
  action: "stop";
  reason: "question_budget_exhausted" | "question_budget_unavailable";
  partial: true;
  continueToken: string;
  continuable: boolean;
  continuationPresented?: boolean;
  continuationMatched?: boolean;
  continuationCreditLeft?: boolean;
  canContinueByCapability?: boolean;
};

export type BudgetConcurrencyReject = {
  action: "reject";
  reason: "question_budget_concurrency_exceeded";
};

export type BudgetTicket = {
  scopeKey: string;
  windowId: number;
  round: number;
  requestId: string;
  startMonoMs: number;
  settled: boolean;
};

export type BudgetAllow = {
  action: "allow";
  ticket?: BudgetTicket;
  continued?: boolean;
};

export type BudgetDecision = BudgetAllow | BudgetStop | BudgetConcurrencyReject;

export type ContinuationDeclaration =
  | { ok: true; idempotent?: boolean; declared?: boolean; windowId?: number; round?: number }
  | { ok: false; reason: "question_budget_unavailable" | "pending_exists" | "no_credit" | "not_exhausted" | "mismatch" };

/**
 * A budget stop caused by the durable store being unreadable/unwritable, not by
 * the budget being spent. It must never be recorded as a budget-termination
 * credential: doing so would let a storage fault masquerade as a legitimate
 * `budget_stopped` fact in the audit trail.
 */
export function isBudgetUnavailable(stop: BudgetStop): boolean {
  return stop.reason === "question_budget_unavailable";
}

export type BudgetState = {
  /** Budget window. A continuation resets this. */
  startedAt: number;
  /** Question age for the slow mark. A continuation does not reset this. */
  originStartedAt: number;
  calls: number;
  continuations: number;
  /**
   * Lucy v0.25 / L25-09 B16 —— 预算四维：
   *   1. 业务调用数（data tool 调用）
   *   2. 尝试次数（execution attempts，含被拒与重试）
   *   3. 墙钟（originStartedAt 起算，续跑不重置）
   *   4. 并发占用（peakConcurrency）
   *
   * **重连与省略 `begin_question` 不重置任何一档**（Spec §10.3）。
   */
  attempts: number;
  peakConcurrency: number;
  currentConcurrency: number;
  /**
   * 兜底作用域键（无 turnId 时使用）。按凭证 / 会话级上限兜底，
   * 不再直接放行（Spec §10.3 / B24）。
   *
   * 可选：持久化实现不需要重复存它（键就是主键）。
   */
  scopeKey?: string | null;
  round?: number;
  turnId?: string | null;
  windowId?: number;
  busyMs?: number;
  inflight?: number;
  pendingToken?: string | null;
  presentedToken?: string | null;
  archivedBusyMsByWindow?: Record<string, number>;
  /** 内存标志：已从持久层装载。不是「内存里已有键」。 */
  loaded?: boolean;
  /** 只存在于本进程内存，不写入预算表。 */
  processUnavailable?: boolean;
  commitUnverified?: boolean;
  unverifiedKey?: string | null;
};

export type BudgetLoadResult = BudgetState | { row: BudgetState; appliedKeys?: string[] } | null;

/**
 * B16 / B24 —— 预算持久化接口。
 *
 * `save` 在支持幂等键的实现里返回权威行。返回 void 的旧实现仍可用：
 * 调用方把候选态当作已发布行。重复键不得覆盖已提交行。
 */
export interface BudgetPersistence {
  load(scopeKey: string): Promise<BudgetLoadResult>;
  save(
    scopeKey: string,
    state: BudgetState,
    idempotencyKey?: string
  ): Promise<void | { row: BudgetState; appliedKeys: string[] }>;
  listScopes(): Promise<string[]>;
}
/**
 * Spec 162 §7.2 之外的兜底上限（无显式 turnId 时按凭证 / 会话级兜底）。
 * 取值与显式问询的默认上限同量级，避免「省略 begin_question 即可无限调用」。
 */
export const SCOPE_BUDGET_MAX_CALLS = QUESTION_BUDGET_MAX_CALLS;
export const SCOPE_BUDGET_MAX_WALL_MS = QUESTION_BUDGET_MAX_WALL_MS;

export function questionBudgetEnabled(): boolean {
  return process.env.LUCY_QUESTION_BUDGET !== "off";
}

export function filterPushdownGuardEnabled(): boolean {
  return process.env.LUCY_FILTER_PUSHDOWN_GUARD !== "off";
}

export function isQuestionDataTool(tool: string | undefined): boolean {
  return Boolean(tool && DATA_TOOLS.has(tool));
}

export class QuestionBudget {
  private readonly turns = new Map<string, BudgetState>();
  private persistence: BudgetPersistence | null = null;

  /**
   * D-24：同一作用域的「加载持久态 → 判定 → 落库」必须**串行**。
   *
   * 缺陷：首次消费某个作用域时，状态要从持久层 `await load()`。两个并发请求
   * 会同时看到「内存里没有这个作用域」，各自 load 到同一份旧计数（如 calls=19），
   * 各自 +1 后都判定为放行 —— 于是**实际执行了 21 次**，而落库只有 20 次，
   * 硬上限被并发在途请求穿透。
   *
   * 修法：按作用域串行化这一段。**不引入多副本锁** —— Lucy 是单实例／单副本
   * 边界，进程内串行即已封住这个窗口。
   */
  private readonly scopeQueues = new Map<string, Promise<void>>();

  /** D-24：把 fn 排进 scopeKey 的串行队列（前一环失败不影响后一环）。 */
  private async withScopeSerialization<T>(scopeKey: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.scopeQueues.get(scopeKey) ?? Promise.resolve();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => gate);
    this.scopeQueues.set(scopeKey, tail);
    await previous;
    try {
      return await fn();
    } finally {
      release();
      // 只有仍是队尾时才清掉，避免把后来者的等待句柄删掉。
      if (this.scopeQueues.get(scopeKey) === tail) this.scopeQueues.delete(scopeKey);
    }
  }

  /** B16：注入持久化实现（生产由调用方在启动时装配）。 */
  setPersistence(persistence: BudgetPersistence | null): void {
    this.persistence = persistence;
  }

  /**
   * B16 / B24 —— 预算作用域键。
   *
   * 有 turnId → `turn:<turnId>`。
   * 无 turnId → `scope:<credential/session>`（兜底作用域）。
   * 两者都**不**因重连或省略 `begin_question` 而重置。
   */
  private scopeKeyFor(turnId: string | undefined, fallbackScope?: string): string {
    if (turnId) return `turn:${turnId}`;
    return `scope:${fallbackScope ?? "anonymous"}`;
  }

  /**
   * 消费预算（同步路径）。
   *
   * - 有 turnId → 问询级上限。
   * - 无 turnId → 按**凭证 / 会话级上限兜底**（B24），不再直接放行。
   *
   * 生产代理使用 `consumePersisted`（异步、落库）；本同步方法保留给
   * 纯内存场景与既有测试。
   */
  private readonly memoryKeys = new Map<string, Set<string>>();
  private monoClock: () => number = () => performance.now();

  /** 测试注入单调时钟。生产用 `performance.now()`。 */
  setMonoClock(clock: () => number): void {
    this.monoClock = clock;
  }

  monoNow(): number {
    return this.monoClock();
  }

  consume(
    turnId: string | undefined,
    now: number,
    continueToken?: string,
    fallbackScope?: string
  ): { action: "allow" } | BudgetStop {
    const scopeKey = this.scopeKeyFor(turnId, fallbackScope);
    let state = this.turns.get(scopeKey);
    if (!state) {
      state = this.freshState(scopeKey, now);
      state.loaded = true;
      this.turns.set(scopeKey, state);
    }
    const decision = this.applyConsume(scopeKey, state, now, continueToken, turnId, true);
    return decision.action === "reject"
      ? {
          action: "stop",
          reason: "question_budget_exhausted",
          partial: true,
          continueToken: state.presentedToken ?? turnId ?? "",
          continuable: false
        }
      : decision;
  }

  /**
   * 消费预算（持久化路径）。
   *
   * 有 `identityKey` 且作用域模式为 stable 时，键是 `bq:<identity>:<session>`。
   * 未传身份时保持 `turn:` / `scope:`，供既有并发测试使用。
   * 持久化不可用时失败关闭，原因是 `question_budget_unavailable`。
   */
  async consumePersisted(
    turnId: string | undefined,
    now: number,
    continueToken?: string,
    fallbackScope?: string,
    options?: {
      identityKey?: string;
      sessionId?: string | null;
      canContinue?: boolean;
    }
  ): Promise<BudgetDecision> {
    const scopeKey = this.resolveScopeKey(turnId, fallbackScope, options);
    return this.withScopeSerialization(scopeKey, async () => {
      const state = await this.loadState(scopeKey, now);
      if (state.processUnavailable) return this.unavailableStop(state);
      if ((state.inflight ?? 0) >= QUESTION_BUDGET_MAX_INFLIGHT) {
        return { action: "reject", reason: "question_budget_concurrency_exceeded" };
      }
      const canContinue = options?.canContinue ?? true;
      const decision = this.decideConsume(state, now, continueToken, turnId, canContinue);
      if (decision.kind === "reject") {
        return { action: "reject", reason: "question_budget_concurrency_exceeded" };
      }
      const committed = await this.commit(scopeKey, decision.candidate, decision.idempotencyKey, now);
      if (!committed) return this.unavailableStop(state);
      if (decision.kind === "stop") {
        return this.stopFrom(committed, canContinue, decision.presented, decision.matched);
      }
      const ticket: BudgetTicket = {
        scopeKey,
        windowId: committed.windowId ?? 0,
        round: committed.round ?? 0,
        requestId: decision.requestId,
        startMonoMs: this.monoNow(),
        settled: false
      };
      return { action: "allow", ticket, continued: decision.continued };
    });
  }

  /** 装载作用域，供归属冻结之前恢复 turnId。 */
  async preload(identityKey: string, sessionId: string | null | undefined, now = Date.now()): Promise<BudgetState | null> {
    if (questionBudgetScopeMode() !== "stable") return null;
    const scopeKey = budgetScopeKey(identityKey, sessionId);
    return this.withScopeSerialization(scopeKey, () => this.loadState(scopeKey, now));
  }

  async declareContinuation(scopeKey: string, token: string, now = Date.now()): Promise<ContinuationDeclaration> {
    return this.withScopeSerialization(scopeKey, async () => {
      const state = await this.loadState(scopeKey, now);
      if (state.processUnavailable) return { ok: false, reason: "question_budget_unavailable" };
      if (state.pendingToken === token) return { ok: true, idempotent: true };
      if (state.pendingToken) return { ok: false, reason: "pending_exists" };
      if ((state.continuations ?? 0) >= 1) return { ok: false, reason: "no_credit" };
      if (!this.isExhausted(state, now)) return { ok: false, reason: "not_exhausted" };
      if (token !== state.presentedToken) return { ok: false, reason: "mismatch" };
      const candidate = this.cloneState(state);
      candidate.pendingToken = token;
      const published = await this.commit(scopeKey, candidate, `declare:${candidate.round}:${token}`, now);
      if (!published) return { ok: false, reason: "question_budget_unavailable" };
      return { ok: true, declared: true, windowId: published.windowId, round: published.round };
    });
  }

  async beginQuestion(input: {
    identityKey: string;
    sessionId?: string | null;
    turnId: string;
    now?: number;
  }): Promise<{ ok: true; previousTurnId: string | null; state: BudgetState } | { ok: false; reason: "question_budget_unavailable" }> {
    const now = input.now ?? Date.now();
    const scopeKey = questionBudgetScopeMode() === "legacy"
      ? this.scopeKeyFor(input.turnId)
      : budgetScopeKey(input.identityKey, input.sessionId);
    return this.withScopeSerialization(scopeKey, async () => {
      const state = await this.loadState(scopeKey, now);
      if (state.processUnavailable || state.commitUnverified) {
        return { ok: false, reason: "question_budget_unavailable" };
      }
      const candidate = this.cloneState(state);
      // Spec 162 §6.5：`state.turnId != null` 判空（空串也是「有旧轮次」），
      // 与伪代码一致，避免空串 turnId 让轮次不推进。
      if (state.turnId != null || (state.calls ?? 0) > 0 || (state.busyMs ?? 0) > 0) {
        this.addArchived(candidate, state.round ?? 0, state.windowId ?? 0, state.busyMs ?? 0);
      }
      if (state.turnId != null) candidate.round = (state.round ?? 0) + 1;
      else candidate.round = Math.max(1, state.round ?? 0);
      const previousTurnId = state.turnId ?? null;
      candidate.turnId = input.turnId;
      candidate.calls = 0;
      candidate.busyMs = 0;
      candidate.windowId = (state.windowId ?? 0) + 1;
      candidate.continuations = 0;
      candidate.pendingToken = null;
      candidate.presentedToken = null;
      candidate.originStartedAt = now;
      candidate.startedAt = now;
      const published = await this.commit(scopeKey, candidate, `begin:${input.turnId}`, now);
      if (!published) return { ok: false, reason: "question_budget_unavailable" };
      return { ok: true, previousTurnId, state: published };
    });
  }

  async settle(
    ticket: BudgetTicket,
    endMonoMs: number,
    flags?: { timeoutUnconfirmed?: boolean; clientDisconnected?: boolean }
  ): Promise<{ settled: boolean; timeoutUnconfirmed?: boolean; clientDisconnected?: boolean }> {
    if (ticket.settled) return { settled: true };
    return this.withScopeSerialization(ticket.scopeKey, async () => {
      if (ticket.settled) return { settled: true };
      const state = await this.loadState(ticket.scopeKey, Date.now());
      if (state.commitUnverified || state.processUnavailable) return { settled: false };
      const delta = Math.min(
        QUESTION_BUDGET_ABS_EXEC_MS,
        Math.max(0, endMonoMs - ticket.startMonoMs)
      );
      const candidate = this.cloneState(state);
      if ((state.round ?? 0) === ticket.round && (state.windowId ?? 0) === ticket.windowId) {
        candidate.busyMs = (candidate.busyMs ?? 0) + delta;
      } else {
        this.addArchived(candidate, ticket.round, ticket.windowId, delta);
      }
      candidate.inflight = Math.max(0, (candidate.inflight ?? 0) - 1);
      candidate.currentConcurrency = Math.max(0, (candidate.currentConcurrency ?? 0) - 1);
      const committed = await this.commit(ticket.scopeKey, candidate, `settle:${ticket.requestId}`, Date.now());
      if (!committed) {
        return { settled: false, timeoutUnconfirmed: flags?.timeoutUnconfirmed, clientDisconnected: flags?.clientDisconnected };
      }
      ticket.settled = true;
      return { settled: true, timeoutUnconfirmed: flags?.timeoutUnconfirmed, clientDisconnected: flags?.clientDisconnected };
    });
  }

  private applyConsume(
    scopeKey: string,
    state: BudgetState,
    now: number,
    continueToken: string | undefined,
    turnId: string | undefined,
    canContinue: boolean
  ): BudgetDecision {
    const decided = this.decideConsume(state, now, continueToken, turnId, canContinue);
    if (decided.kind === "reject") {
      return { action: "reject", reason: "question_budget_concurrency_exceeded" };
    }
    Object.assign(state, decided.candidate);
    this.turns.set(scopeKey, state);
    if (decided.kind === "stop") return this.stopFrom(state, canContinue, decided.presented, decided.matched);
    return { action: "allow" };
  }

  /** 释放一次并发占用。稳定作用域下优先按票据结算，这里只服务旧的 `turn:` 键。 */
  async release(turnId: string | undefined, fallbackScope?: string): Promise<void> {
    const scopeKey = this.scopeKeyFor(turnId, fallbackScope);
    const state = this.turns.get(scopeKey);
    if (!state) return;
    state.currentConcurrency = Math.max(0, (state.currentConcurrency ?? 0) - 1);
    state.inflight = Math.max(0, (state.inflight ?? 0) - 1);
    if (this.persistence) await this.persistence.save(scopeKey, state);
  }

  ensureTurn(turnId: string | undefined, now: number): void {
    if (!turnId || questionBudgetScopeMode() === "stable") return;
    const scopeKey = this.scopeKeyFor(turnId);
    if (this.turns.has(scopeKey)) return;
    const state = this.freshState(scopeKey, now);
    state.loaded = false;
    this.turns.set(scopeKey, state);
  }

  /** 问询年龄。稳定作用域读该 turn 所在行的 originStartedAt，不再读 `turn:<id>` 桶。 */
  wallClockMs(turnId: string | undefined, now: number): number | null {
    if (!turnId) return null;
    for (const state of this.turns.values()) {
      if (state.turnId === turnId) return Math.max(0, now - state.originStartedAt);
    }
    const legacy = this.turns.get(this.scopeKeyFor(turnId));
    if (!legacy) return null;
    return Math.max(0, now - legacy.originStartedAt);
  }

  snapshot(turnId: string | undefined, fallbackScope?: string): BudgetState | null {
    return this.turns.get(this.scopeKeyFor(turnId, fallbackScope)) ?? null;
  }

  snapshotScope(scopeKey: string): BudgetState | null {
    return this.turns.get(scopeKey) ?? null;
  }

  resetForTests(): void {
    this.turns.clear();
    this.memoryKeys.clear();
  }

  private resolveScopeKey(
    turnId: string | undefined,
    fallbackScope: string | undefined,
    options?: { identityKey?: string; sessionId?: string | null }
  ): string {
    if (questionBudgetScopeMode() === "stable" && options?.identityKey) {
      return budgetScopeKey(options.identityKey, options.sessionId);
    }
    return this.scopeKeyFor(turnId, fallbackScope);
  }

  private freshState(scopeKey: string, now: number): BudgetState {
    return {
      scopeKey,
      round: 0,
      turnId: null,
      windowId: 0,
      calls: 0,
      busyMs: 0,
      inflight: 0,
      attempts: 0,
      peakConcurrency: 0,
      currentConcurrency: 0,
      continuations: 0,
      pendingToken: null,
      presentedToken: null,
      archivedBusyMsByWindow: {},
      startedAt: now,
      originStartedAt: now,
      loaded: false,
      processUnavailable: false,
      commitUnverified: false,
      unverifiedKey: null
    };
  }

  private cloneState(state: BudgetState): BudgetState {
    return {
      ...state,
      archivedBusyMsByWindow: { ...(state.archivedBusyMsByWindow ?? {}) }
    };
  }

  private addArchived(state: BudgetState, round: number, windowId: number, delta: number): void {
    const key = `${round}:${windowId}`;
    const archived = { ...(state.archivedBusyMsByWindow ?? {}) };
    archived[key] = (archived[key] ?? 0) + delta;
    state.archivedBusyMsByWindow = archived;
  }

  private isExhausted(state: BudgetState, now: number): boolean {
    const callsExhausted = (state.calls ?? 0) >= QUESTION_BUDGET_MAX_CALLS;
    const timeExhausted = questionBudgetWallMode() === "elapsed"
      ? now - state.startedAt >= QUESTION_BUDGET_MAX_WALL_MS
      : (state.busyMs ?? 0) >= QUESTION_BUDGET_MAX_BUSY_MS;
    return callsExhausted || timeExhausted;
  }

  private presentToken(state: BudgetState, turnId: string | undefined): string {
    if (state.presentedToken) return state.presentedToken;
    if (turnId) return turnId;
    return randomUUID();
  }

  private decideConsume(
    state: BudgetState,
    now: number,
    continueToken: string | undefined,
    turnId: string | undefined,
    canContinue: boolean
  ): 
    | { kind: "reject" }
    | {
        kind: "stop" | "allow";
        candidate: BudgetState;
        idempotencyKey: string;
        requestId: string;
        continued: boolean;
        presented: boolean;
        matched: boolean;
      } {
    const headerPresented = typeof continueToken === "string" && continueToken.length > 0;
    // Spec 162 §6.3：可信头部**只有**两种 —— 已下发的 `presentedToken`，
    // 或作用域行上已落库的**活跃 turnId**。请求解析出的 turnId 不作数：
    // 它可能指向已失效或陈旧的轮次，用它换窗等于多出一条不核对凭证的续查入口。
    const headerTrusted = headerPresented && (
      continueToken === state.presentedToken
      || (state.turnId != null && continueToken === state.turnId)
    );
    const toolTrusted = state.pendingToken != null;
    const exhausted = this.isExhausted(state, now);
    const useContinuation = exhausted && (state.continuations ?? 0) < 1 && (toolTrusted || headerTrusted);
    const candidate = this.cloneState(state);
    if (useContinuation) {
      this.addArchived(candidate, candidate.round ?? 0, candidate.windowId ?? 0, candidate.busyMs ?? 0);
      candidate.calls = 0;
      candidate.busyMs = 0;
      candidate.startedAt = now;
      candidate.windowId = (candidate.windowId ?? 0) + 1;
      candidate.continuations = (candidate.continuations ?? 0) + 1;
      candidate.pendingToken = null;
      candidate.presentedToken = null;
    }
    const presented = headerPresented || toolTrusted;
    const matched = Boolean(useContinuation);
    if (this.isExhausted(candidate, now)) {
      if (!candidate.presentedToken) candidate.presentedToken = this.presentToken(candidate, turnId ?? state.turnId ?? undefined);
      const token = candidate.presentedToken;
      return {
        kind: "stop",
        candidate,
        idempotencyKey: `stop:${candidate.round ?? 0}:${candidate.windowId ?? 0}:${token}`,
        requestId: "",
        continued: false,
        presented,
        matched: headerPresented ? Boolean(headerTrusted) : false
      };
    }
    const requestId = randomUUID();
    candidate.calls = (candidate.calls ?? 0) + 1;
    candidate.attempts = (candidate.attempts ?? 0) + 1;
    candidate.inflight = (candidate.inflight ?? 0) + 1;
    candidate.currentConcurrency = (candidate.currentConcurrency ?? 0) + 1;
    candidate.peakConcurrency = Math.max(candidate.peakConcurrency ?? 0, candidate.currentConcurrency);
    void canContinue;
    return {
      kind: "allow",
      candidate,
      idempotencyKey: `admit:${requestId}`,
      requestId,
      continued: useContinuation,
      presented,
      matched
    };
  }

  private stopFrom(state: BudgetState, canContinue: boolean, presented: boolean, matched: boolean): BudgetStop {
    const token = state.presentedToken ?? "";
    return {
      action: "stop",
      reason: "question_budget_exhausted",
      partial: true,
      continueToken: token,
      continuable: canContinue && (state.continuations ?? 0) < 1,
      continuationPresented: presented,
      continuationMatched: matched,
      continuationCreditLeft: (state.continuations ?? 0) < 1,
      canContinueByCapability: canContinue
    };
  }

  private unavailableStop(state: BudgetState): BudgetStop {
    return {
      action: "stop",
      reason: "question_budget_unavailable",
      partial: true,
      continueToken: state.presentedToken ?? state.turnId ?? "",
      continuable: false,
      canContinueByCapability: false
    };
  }

  private async loadState(scopeKey: string, now: number): Promise<BudgetState> {
    let state = this.turns.get(scopeKey);
    if (!state) {
      state = this.freshState(scopeKey, now);
      this.turns.set(scopeKey, state);
    }
    if (this.persistence && !state.loaded) {
      let loaded: BudgetLoadResult;
      try {
        loaded = await this.persistence.load(scopeKey);
      } catch {
        state.processUnavailable = true;
        return state;
      }
      const normalized = this.normalizeLoad(loaded);
      if (normalized.row) {
        state = this.cloneState({ ...this.freshState(scopeKey, now), ...normalized.row, scopeKey });
        state.inflight = 0;
        state.currentConcurrency = 0;
        this.turns.set(scopeKey, state);
        const keys = this.memoryKeys.get(scopeKey) ?? new Set<string>();
        for (const key of normalized.appliedKeys) keys.add(key);
        this.memoryKeys.set(scopeKey, keys);
      }
      state.loaded = true;
      state.processUnavailable = false;
      state.commitUnverified = false;
      state.unverifiedKey = null;
    }
    if (state.commitUnverified) {
      const recovered = await this.recover(state);
      if (!recovered) return state;
      state = recovered.row;
    }
    return state;
  }

  private normalizeLoad(raw: BudgetLoadResult): { row: BudgetState | null; appliedKeys: string[] } {
    if (!raw) return { row: null, appliedKeys: [] };
    if ("row" in raw && raw.row && typeof raw.row === "object" && "calls" in raw.row) {
      return { row: raw.row, appliedKeys: raw.appliedKeys ?? [] };
    }
    if ("calls" in raw && "startedAt" in raw) return { row: raw, appliedKeys: [] };
    return { row: null, appliedKeys: [] };
  }

  private async recover(current: BudgetState): Promise<{ row: BudgetState; keyApplied: boolean } | null> {
    if (!current.commitUnverified) return { row: current, keyApplied: false };
    if (!this.persistence) return null;
    let loaded: BudgetLoadResult;
    try {
      loaded = await this.persistence.load(current.scopeKey ?? "");
    } catch {
      current.processUnavailable = true;
      return null;
    }
    const normalized = this.normalizeLoad(loaded);
    const row = normalized.row
      ? this.cloneState({ ...this.freshState(current.scopeKey ?? "", current.startedAt), ...normalized.row })
      : this.freshState(current.scopeKey ?? "", current.startedAt);
    row.loaded = true;
    row.processUnavailable = false;
    row.commitUnverified = false;
    row.unverifiedKey = null;
    row.inflight = 0;
    row.currentConcurrency = 0;
    this.turns.set(row.scopeKey ?? current.scopeKey ?? "", row);
    const keyApplied = normalized.appliedKeys.includes(current.unverifiedKey ?? "");
    return { row, keyApplied };
  }

  private publish(row: BudgetState): void {
    const published = this.cloneState(row);
    published.loaded = true;
    published.processUnavailable = false;
    published.commitUnverified = false;
    published.unverifiedKey = null;
    if (published.scopeKey) this.turns.set(published.scopeKey, published);
  }

  private async commit(scopeKey: string, candidate: BudgetState, idempotencyKey: string, now: number): Promise<BudgetState | null> {
    const current = await this.loadState(scopeKey, now);
    if (current.processUnavailable || current.commitUnverified) return null;
    const known = this.memoryKeys.get(scopeKey);
    if (known?.has(idempotencyKey)) return this.turns.get(scopeKey) ?? current;
    candidate.scopeKey = scopeKey;
    if (!this.persistence) {
      this.publish(candidate);
      const keys = known ?? new Set<string>();
      keys.add(idempotencyKey);
      this.memoryKeys.set(scopeKey, keys);
      return this.turns.get(scopeKey) ?? candidate;
    }
    try {
      const saved = await this.persistence.save(scopeKey, candidate, idempotencyKey);
      const row = saved && typeof saved === "object" && "row" in saved ? saved.row : candidate;
      row.scopeKey = scopeKey;
      if (saved && typeof saved === "object" && "appliedKeys" in saved) {
        this.memoryKeys.set(scopeKey, new Set(saved.appliedKeys));
      } else {
        const keys = known ?? new Set<string>();
        keys.add(idempotencyKey);
        this.memoryKeys.set(scopeKey, keys);
      }
      this.publish(row);
      return this.turns.get(scopeKey) ?? row;
    } catch {
      current.commitUnverified = true;
      current.processUnavailable = true;
      current.unverifiedKey = idempotencyKey;
      this.turns.set(scopeKey, current);
      const recovered = await this.recover(current);
      if (!recovered) return null;
      if (recovered.keyApplied) return recovered.row;
      return null;
    }
  }
}

export const questionBudget = new QuestionBudget();

/**
 * B16 —— 装配**生产**预算持久化（`proxy/audit.ts` 的 `question_budget_state` 表）。
 *
 * 由代理在启动时调用一次；不装配时预算仍是内存态（测试 / 嵌入式场景）。
 */
/**
 * 装配持久化预算。
 *
 * 传 `null` 表示**持久层未装配** → 预算降级为进程内计数（仍然生效）。
 * 持久层已装配但读写失败 → 失败关闭（见 `consumePersisted`）。
 */
export function installBudgetPersistence(persistence: BudgetPersistence | null): void {
  questionBudget.setPersistence(persistence);
}

/** "AS field" together with "AS op" or "STRUCT(", plus the truncated `...RUCT(` engine fragment. */
export function isFilterPushdownText(text: string): boolean {
  if (/\.\.\.RUCT\s*\(/i.test(text)) return true;
  const hasAsField = /\bAS\s+field\b/i.test(text);
  const hasAsOp = /\bAS\s+op\b/i.test(text);
  const hasStruct = /STRUCT\s*\(/i.test(text);
  return hasAsField && (hasAsOp || hasStruct);
}

export function classifyFailure(input: {
  outcome?: string;
  decisionReason?: string;
  errorDetail?: string;
}): FailureDimension {
  const reason = input.decisionReason ?? "";
  const text = input.errorDetail ?? "";
  if (input.outcome === "budget_stop" || reason === "question_budget_exhausted") return "";
  if (reason === "wiki_not_found" || reason === "explicit_table_required:<empty>") return "用法与语义";
  if (reason.startsWith("explicit_table_required:") && reason !== "explicit_table_required:<empty>") return "权限拒绝";
  if (
    ACL_REASONS.has(reason)
    // acl.ts emits `sensitive_metadata_forbidden:kx`; the dimension is the
    // same permission denial regardless of the suffix.
    || reason.startsWith("sensitive_metadata_forbidden")
    || reason.startsWith("table_forbidden:")
    || reason.startsWith("unknown_or_forbidden_connection:")
    || reason.startsWith("tool_unclassified:")
    || reason.startsWith("wiki_forbidden")
  ) {
    return "权限拒绝";
  }
  if (reason === "timeout" || reason === "query_concurrency_exceeded" || text.includes("Timeout")) {
    return "引擎超时与并发";
  }
  // Spec 162 §6.2：并发超限是并发问题，不是用法问题（与 audit-classification 同口径）。
  if (reason === "question_budget_concurrency_exceeded") {
    return "引擎超时与并发";
  }
  // Spec 162 §6.3：续查声明被拒是调用者用错了续查通道。
  if (reason === "pending_exists" || reason === "no_credit" || reason === "not_exhausted" || reason === "mismatch") {
    return "用法与语义";
  }
  if (isFilterPushdownText(text) || reason === "filter_pushdown") return "过滤条件下推";
  if (input.outcome && input.outcome !== "ok") return "用法与语义";
  return "";
}

const FILTER_HINT = "这次过滤条件无法下推。请改成等值、包含或枚举条件后再查。";
const MEASURE_HINT = "请改用当前角色已授权的 source-qualified 指标名。";

export function repairHint(
  input: { failureDimension: string; suggestedSources?: string[] },
  allowedSources: ReadonlySet<string>,
): string | null {
  const suggested = input.suggestedSources ?? [];
  const safe = suggested.filter((name) => name.length > 0 && allowedSources.has(name));
  const leaked = suggested.filter((name) => name.length > 0 && !allowedSources.has(name));
  if (input.failureDimension === "过滤条件下推") {
    const text = safe.length > 0 ? `${FILTER_HINT}可用来源：${safe.join("、")}。` : FILTER_HINT;
    return leaked.some((name) => text.includes(name)) ? FILTER_HINT : text;
  }
  if (input.failureDimension === "用法与语义" || input.failureDimension === "权限拒绝") {
    if (safe.length === 0) return input.failureDimension === "权限拒绝" ? null : MEASURE_HINT;
    const text = `请改用当前角色已授权的来源：${safe.join("、")}。`;
    return leaked.some((name) => text.includes(name)) ? MEASURE_HINT : text;
  }
  return null;
}

const publications = new Map<string, PublishedVersion>();

export function registerPublishedVersion(sourceName: string, publication: PublishedVersion | null): void {
  if (!publication?.version) {
    publications.delete(sourceName);
    return;
  }
  publications.set(sourceName, publication);
}

export function lookupPublishedVersion(sourceName: string | undefined): PublishedVersion | null {
  if (!sourceName) return null;
  return publications.get(sourceName) ?? null;
}

export function publishedSourceName(args: Record<string, unknown>, fallback?: string): string | undefined {
  for (const key of ["sourceName", "source_name", "source", "table"]) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  const measures = args.measures;
  if (Array.isArray(measures)) {
    const qualified = measures.find((item) => typeof item === "string" && item.includes("."));
    if (typeof qualified === "string") return qualified.slice(0, qualified.lastIndexOf("."));
  }
  return fallback;
}

export function resolveAppliedVersion(
  args: { version?: string },
  publication: PublishedVersion | null | undefined,
): PublishedVersion | null {
  if (!publication?.version || !publication.businessDate || !publication.valueKind) return null;
  if (typeof args.version === "string" && args.version.trim()) return null;
  return {
    version: publication.version,
    businessDate: publication.businessDate,
    valueKind: publication.valueKind,
  };
}

export function actorFromToken(token: {
  label?: string;
  actor_id?: string | null;
  actor_kind?: string | null;
}): { actorId?: string; actorKind?: ActorKind } {
  const actorId = typeof token.actor_id === "string" ? token.actor_id.trim() : "";
  const actorKind = token.actor_kind === "person" || token.actor_kind === "automation" ? token.actor_kind : undefined;
  if (!actorId || !actorKind) return {};
  return { actorId, actorKind };
}

/**
 * Spec 162 / WO-13 T6 — 评测标记. Optional explicit Token field `eval_mark`.
 * Absent or `false` means unmarked. Never inferred from User-Agent,
 * `token_label`, connection name, or `actor_kind`.
 */
export function evalMarkFromToken(token: { eval_mark?: unknown } | null | undefined): boolean {
  return token?.eval_mark === true;
}


/**
 * Spec 162 §8 / WO-14 T1 / SC-20 — the new 慢调用 definition.
 *
 * A call is slow when `lucy_query` takes at least 5 seconds, or when the
 * question's wall clock reaches 120 seconds. A 1.6s successful query is not
 * slow, and other tools (`wiki_read`, `discover_data`, …) are not marked by
 * this definition at all — Spec 143's own call-monitor threshold and the
 * question drill-down's `isSlowCall` (above window P95) are separate metrics
 * and are not replaced here.
 */
export const SLOW_CALL_MIN_DURATION_MS = 5_000;
export const SLOW_TURN_WALL_CLOCK_MS = 120_000;
/** Usage-signal slow mark. Distinct from the P95 「慢于多数请求」 card. */
export const SLOW_DEFINITION_EFFECTIVE_AT = "2026-10-12T00:00:00.000Z";

/** The only tool whose single-call duration counts as slow under SC-20. */
export const SLOW_CALL_TOOLS = new Set(["lucy_query"]);

export function slowCallThresholdMs(): number {
  const configured = Number(process.env.LUCY_SLOW_CALL_MIN_MS ?? SLOW_CALL_MIN_DURATION_MS);
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : SLOW_CALL_MIN_DURATION_MS;
}

export function slowTurnWallClockMs(): number {
  const configured = Number(process.env.LUCY_SLOW_TURN_WALL_CLOCK_MS ?? SLOW_TURN_WALL_CLOCK_MS);
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : SLOW_TURN_WALL_CLOCK_MS;
}

export type SlowCallVerdict = { slow: boolean; basis: "call_duration" | "turn_wall_clock" | null };

/**
 * SC-20 — one predicate for the new slow mark. `turnWallClockMs` only counts
 * when the row belongs to a question; a business call outside any question
 * cannot inherit a turn's wall clock.
 */
export function isSlowCall(input: {
  tool?: string | null;
  durationMs?: number | null;
  turnWallClockMs?: number | null;
  minDurationMs?: number;
  turnThresholdMs?: number;
}): SlowCallVerdict {
  const callThreshold = input.minDurationMs ?? slowCallThresholdMs();
  const turnThreshold = input.turnThresholdMs ?? slowTurnWallClockMs();
  if (typeof input.turnWallClockMs === "number" && input.turnWallClockMs >= turnThreshold) {
    return { slow: true, basis: "turn_wall_clock" };
  }
  if (!input.tool || !SLOW_CALL_TOOLS.has(input.tool)) {
    // Other tools are not marked slow by this definition, even at 60 seconds.
    return { slow: false, basis: null };
  }
  if (typeof input.durationMs === "number" && input.durationMs >= callThreshold) {
    return { slow: true, basis: "call_duration" };
  }
  return { slow: false, basis: null };
}

/**
 * SC-20 — the mark stored on an access-log row. Wall clock comes from the
 * question's original start, which `writeLog` fills into `turn_wall_clock_ms`.
 */
export function usageSlowMark(entry: {
  tool?: string | null;
  durationMs?: number | null;
  lucyTurnId?: string | null;
  now?: number;
}): { turnWallClockMs: number | null; isSlowCall: boolean; slowBasis: SlowCallVerdict["basis"] } {
  const now = entry.now ?? Date.now();
  const turnWallClockMs = entry.lucyTurnId ? questionBudget.wallClockMs(entry.lucyTurnId, now) : null;
  const verdict = isSlowCall({
    tool: entry.tool,
    durationMs: entry.durationMs,
    turnWallClockMs
  });
  return { turnWallClockMs, isSlowCall: verdict.slow, slowBasis: verdict.basis };
}

/** SC-20 — a successful call that returned zero rows. */
export function isEmptyResult(input: {
  outcome?: string | null;
  responseRowCount?: number | null;
}): boolean {
  if (input.outcome !== "ok") return false;
  return input.responseRowCount === 0;
}

/**
 * Spec 189 — the authoritative implementation now lives in the shared usage
 * classification module. This file keeps the historical export so existing
 * callers (and Spec 162 tests) keep working.
 */
export { hasProbeName, isEvalProbeCall, defaultUsageExcluded, PROBE_NAME_MARKERS } from "./usage-classification.js";

/**
 * Spec 162 §7.6 — a probe call leaves the default usage view only when BOTH
 * hold: the args or connection name looks like a probe, and the Token carries
 * an explicit `eval_mark`. Name-only matches stay in the default view.
 */


/**
 * Spec 162 §7.3 — the single allow-list function shared by every permission
 * denial payload. Names outside the caller's ACL must never appear (SC-14).
 */
export function denialAllowList(
  permissions: { connections?: readonly string[]; sources?: ReadonlyArray<{ sourceName?: string; table?: string }> },
): { connections: string[]; sources: string[] } {
  const connections = [...new Set((permissions.connections ?? []).filter(Boolean))].sort();
  const sources = [...new Set(
    (permissions.sources ?? [])
      .map((source) => source.sourceName || source.table || "")
      .filter(Boolean)
  )].sort();
  return { connections, sources };
}

export const TRUNCATION_REPAIR_HINT = "结果已截断，改为聚合后再取明细。";

/**
 * Spec 162 §7.5 / SC-10 — `lucy_query` success rows always carry
 * `response_truncated` as 0 or 1. Hitting the row cap forces 1 and adds the
 * aggregate repair hint. `lucy_freshness` / `lucy_explain_query` keep their
 * own existing 0.
 */
export function resolveResponseTruncated(input: {
  upstreamTruncated?: boolean;
  rowCount?: number | null;
  rowCap?: number | null;
}): { responseTruncated: 0 | 1; repair?: string } {
  const hitRowCap = typeof input.rowCount === "number"
    && typeof input.rowCap === "number"
    && input.rowCap > 0
    && input.rowCount >= input.rowCap;
  if (input.upstreamTruncated === true || hitRowCap) {
    return { responseTruncated: 1, repair: TRUNCATION_REPAIR_HINT };
  }
  return { responseTruncated: 0 };
}

/** Spec 162 §7.8 / T4 — `count(*)` or `count(1)` with no source. */
export const ROW_COUNT_MEASURE_HINT = "row_count(source)";

const COUNT_WITHOUT_SOURCE = /^(?:count\s*\(\s*(?:\*|1)\s*\)|count\s+\*)$/i;
const AGGREGATE_WRAPPER = /^(sum|avg|min|max|count)\s*\(\s*(.+?)\s*\)$/i;

export type BuiltinMeasureDecision =
  | { action: "compile"; measure: string }
  | { action: "repair"; reason: string; repair: string }
  | { action: "reject"; reason: string; message: string };

/**
 * Spec 162 §7.8 / SC-15 — built-in measure guardrails.
 * - `count(*)` / `count(1)` without a source → repair hint to `row_count(source)`.
 * - `sum()` over an already aggregated published measure → never `sum(sum())`.
 * - completeness without a declared denominator → refuse to compile.
 */
export function compileBuiltinMeasure(input: {
  measure: string;
  source?: string | null;
  aggregatedMeasures?: readonly string[];
  completenessDenominator?: string | null;
}): BuiltinMeasureDecision {
  const raw = input.measure.trim();
  if (!raw) return { action: "repair", reason: "measure_missing", repair: ROW_COUNT_MEASURE_HINT };

  const source = typeof input.source === "string" && input.source.trim() ? input.source.trim() : null;
  const aggregated = new Set(
    (input.aggregatedMeasures ?? []).map((name) => name.trim().toLowerCase()).filter(Boolean)
  );
  const unqualified = source && raw.toLowerCase().startsWith(`${source.toLowerCase()}.`)
    ? raw.slice(source.length + 1)
    : raw;

  if (/completeness|完整度/i.test(unqualified)) {
    const denominator = input.completenessDenominator?.trim();
    if (!denominator) {
      return {
        action: "reject",
        reason: "completeness_denominator_required",
        message: "完整度度量必须声明分子与分母 grain，缺少分母时拒绝编译。"
      };
    }
    return { action: "compile", measure: raw };
  }

  if (!source && COUNT_WITHOUT_SOURCE.test(raw)) {
    return { action: "repair", reason: "count_without_source", repair: ROW_COUNT_MEASURE_HINT };
  }

  const wrapper = AGGREGATE_WRAPPER.exec(raw);
  if (wrapper) {
    const inner = wrapper[2].trim();
    const sourcePrefix = source ? `${source.toLowerCase()}.` : "";
    // Compare the inner name in every shape it can legitimately arrive in:
    // as written, stripped of the source prefix, and re-qualified.
    const candidates = new Set([inner.toLowerCase()]);
    if (sourcePrefix && inner.toLowerCase().startsWith(sourcePrefix)) {
      candidates.add(inner.toLowerCase().slice(sourcePrefix.length));
    }
    if (source) candidates.add(`${sourcePrefix}${inner.toLowerCase()}`);
    const wrapsAggregate = [...candidates].some((candidate) => aggregated.has(candidate));
    const nestedAggregate = AGGREGATE_WRAPPER.test(inner.trim());
    if (wrapsAggregate || nestedAggregate) {
      return {
        action: "repair",
        reason: "aggregate_of_aggregate",
        repair: `请直接使用已发布的度量名 ${inner}，不要对它再套 ${wrapper[1].toLowerCase()}。`
      };
    }
  }

  return { action: "compile", measure: raw };
}

export function usageGroup(row: {
  actorId?: string | null;
  actorKind?: string | null;
  userId: string;
  client?: string | null;
}): UsageGroup {
  if (row.actorKind === "automation" && row.actorId) return "自动化调用";
  if (row.actorKind === "person" && row.actorId) return "使用人";
  return "Agent";
}

// ─── B15：repairHint 可用性闭环（Spec §10.3 / A12）──────────────────────────
//
// 旧实现的 repairHint 只做一件事：把「建议来源」与「允许来源」取交集后
// 拼一句话。它**没有验证**被建议的目标是否真的可用，于是会推荐一个
// 不存在、不可见或不可编译的对象。
//
// 本闭环要求每条建议在给出之前通过五项检查：
//   1. 真实 Schema：对象确实存在（无证据 = 不可判定，不得放行）；
//   2. 主体可见性：当前主体对该对象有权限；
//   3. 编译能力：该来源的语义模型已完成（completion=done）；
//   4. 参数形态：本次调用的参数形态对该目标合法；
//   5. 可调用性：调用入口本身可用（工具在允许列表内）。
//
// **不得发真实数据查询**：本闭环只读取 Schema / 权限 / 发布元数据，
// 绝不触发取数。

export type RepairRejectReason =
  /** 无真实 Schema 证据（不可判定）。 */
  | "schema_evidence_unavailable"
  /** 真实 Schema 中不存在该对象。 */
  | "object_not_found"
  /** 当前主体不可见。 */
  | "not_visible_to_principal"
  /** 语义模型未完成 / 校验失败，不可编译。 */
  | "not_compiled"
  /** 参数形态对该目标不合法。 */
  | "invalid_parameter_shape"
  /** 调用入口不可用（工具不在允许列表）。 */
  | "not_callable";

export type RepairTargetEvidence = {
  /** 建议目标（来源名）。 */
  target: string;
  /** 真实 Schema 中是否存在；`null` = 无 Schema 证据（不可判定）。 */
  schemaExists: boolean | null;
  /** 主体可见性。 */
  visibleToPrincipal: boolean;
  /** 编译能力（语义模型已完成）。 */
  compiled: boolean;
  /** 参数形态合法性。 */
  parameterShapeValid: boolean;
  /** 调用入口可用性。 */
  callable: boolean;
};

export type RepairRejection = { target: string; reason: RepairRejectReason };

export type RepairClosure = {
  /** 通过全部检查、可以推荐的目标。 */
  usableTargets: string[];
  /** 被拒目标与**事实性**原因。 */
  rejected: RepairRejection[];
  /** 无合法目标时的事实性错误说明；有合法目标时为 null。 */
  factualError: string | null;
  /** 可直接呈现给调用方的提示文本。 */
  text: string;
};

/**
 * 逐项判定单个目标是否可用。
 *
 * 检查顺序固定，保证同一输入永远得到同一原因（便于断言与审计留痕）。
 */
export function evaluateRepairTarget(
  evidence: RepairTargetEvidence
): { ok: true } | { ok: false; reason: RepairRejectReason } {
  if (evidence.schemaExists === null) return { ok: false, reason: "schema_evidence_unavailable" };
  if (evidence.schemaExists === false) return { ok: false, reason: "object_not_found" };
  if (!evidence.visibleToPrincipal) return { ok: false, reason: "not_visible_to_principal" };
  if (!evidence.compiled) return { ok: false, reason: "not_compiled" };
  if (!evidence.parameterShapeValid) return { ok: false, reason: "invalid_parameter_shape" };
  if (!evidence.callable) return { ok: false, reason: "not_callable" };
  return { ok: true };
}

const REPAIR_REASON_TEXT: Record<RepairRejectReason, string> = {
  schema_evidence_unavailable: "缺少真实 Schema 证据，无法判定",
  object_not_found: "Schema 中不存在该对象",
  not_visible_to_principal: "当前主体不可见",
  not_compiled: "语义模型未完成或校验失败，无法编译",
  invalid_parameter_shape: "本次参数形态对该目标不合法",
  not_callable: "调用入口不可用"
};

/**
 * 构造 repairHint 的可用性闭环结果。
 *
 * 有合法目标 → 只推荐通过全部检查的目标。
 * 无合法目标 → 给**事实性错误**（逐条原因）+ **可用候选**
 * （`availableCandidates`，通常是主体可见但未通过其他检查的目标）。
 */
export function buildRepairClosure(input: {
  failureDimension: string;
  candidates: readonly RepairTargetEvidence[];
  /** 主体可见但未通过其他检查的候选（用于「可用候选」提示）。 */
  availableCandidates?: readonly string[];
}): RepairClosure {
  const usableTargets: string[] = [];
  const rejected: RepairRejection[] = [];
  for (const candidate of input.candidates) {
    const verdict = evaluateRepairTarget(candidate);
    if (verdict.ok) usableTargets.push(candidate.target);
    else rejected.push({ target: candidate.target, reason: verdict.reason });
  }

  if (usableTargets.length > 0) {
    return {
      usableTargets,
      rejected,
      factualError: null,
      text: `可用来源：${usableTargets.join("、")}。`
    };
  }

  const details = rejected
    .map((entry) => `${entry.target}（${REPAIR_REASON_TEXT[entry.reason]}）`)
    .join("；");
  const available = (input.availableCandidates ?? []).filter((name) => name.length > 0);
  const availableText = available.length > 0 ? `可用候选：${available.join("、")}。` : "";
  const factualError =
    rejected.length > 0
      ? `当前没有可用的合法目标：${details}。`
      : "当前没有可用的合法目标：未找到通过可用性检查的来源。";
  return {
    usableTargets,
    rejected,
    factualError,
    text: `${factualError}${availableText}`
  };
}
