/**
 * Lucy v0.25 / L25-09 S02 — 入口登记（Endpoint Registry）.
 *
 * 权威来源：Spec §5.3（入口登记数据契约）、§12.1（onIngress 伪代码）、
 * §6.3 / U12（回传信封）。
 *
 * 硬规则：
 *   1. `received` 是 canonical ledger 事件；`ingress_event_id` **就是** received
 *      事件的 `event_id`（格式 `${operationId}:received`）。
 *   2. `attempt_id` 在入口时点与 `operation_id` / `ingress_event_id` **同时分配**；
 *      被拒绝的请求也有 `attempt_id`，但 `execution=not_executed`。
 *   3. 业务重试产生新 attempt + `parent_attempt_id` + `retry_of`。
 *   4. 57881（MCP）与 55176（管理）分别登记；**端口并存是合法部署形态**，
 *      不是缺陷。
 *   5. 只有 received 已提交后才允许回传审计关联头。
 */

import { randomUUID } from "node:crypto";
import { getSecurityStore } from "../security/instance.js";
import type { SecurityStore } from "../security/store.js";

export const ENDPOINT_IDS = ["mcp-http", "admin-http", "agent-audit-ingest"] as const;
export type EndpointId = (typeof ENDPOINT_IDS)[number];

export const ENDPOINT_TRANSPORTS = ["streamable-http", "stdio", "http-admin"] as const;
export type EndpointTransport = (typeof ENDPOINT_TRANSPORTS)[number];

export type EndpointRegistration = {
  endpointId: EndpointId;
  transport: EndpointTransport;
  /** 监听登记（地址 + 用途）。端口是登记属性，不是 endpoint 身份。 */
  listen: { address: string; port: number; purpose: string };
  /** 可观察路由组件：入口 → 准入 → 账本 → 投影。 */
  observableRoute: string[];
  /** 本入口是否纳入业务覆盖声明（健康 / 恢复路由须事先声明，不冒称业务覆盖）。 */
  coversBusinessTraffic: boolean;
};

/**
 * 入口登记表。
 *
 * 57881 = MCP；55176 = 管理控制台。两者端口并存是**合法部署形态**。
 */
export const ENDPOINT_REGISTRY: Record<EndpointId, EndpointRegistration> = {
  "mcp-http": {
    endpointId: "mcp-http",
    transport: "streamable-http",
    listen: { address: "0.0.0.0", port: 57881, purpose: "MCP 数据问答入口" },
    observableRoute: ["ingress", "admission", "ledger", "projection"],
    coversBusinessTraffic: true
  },
  "admin-http": {
    endpointId: "admin-http",
    transport: "http-admin",
    listen: { address: "0.0.0.0", port: 55176, purpose: "管理控制台入口" },
    observableRoute: ["ingress", "admin_auth", "admin_audit"],
    coversBusinessTraffic: false
  },
  "agent-audit-ingest": {
    endpointId: "agent-audit-ingest",
    transport: "streamable-http",
    listen: { address: "0.0.0.0", port: 55176, purpose: "受控客户端观测接入" },
    observableRoute: ["ingress", "adapter_auth", "ledger", "projection"],
    coversBusinessTraffic: false
  }
};

export function isEndpointId(value: unknown): value is EndpointId {
  return typeof value === "string" && (ENDPOINT_IDS as readonly string[]).includes(value);
}

export function resolveEndpoint(endpointId: EndpointId): EndpointRegistration {
  const registration = ENDPOINT_REGISTRY[endpointId];
  if (!registration) throw new Error(`unknown_endpoint:${String(endpointId)}`);
  return registration;
}

// ─── 入口身份分配（Spec §12.1 / D3）────────────────────────────────────────

export type IngressIdentity = {
  endpointId: EndpointId;
  /** Lucy 内部操作过程 ID（不得充当上游 ID）。 */
  operationId: string;
  /** 一次执行尝试 ID；被拒绝的请求同样分配。 */
  attemptId: string;
  /** 已提交 received 的账本事件 ID（`${operationId}:received`）。 */
  ingressEventId: string;
  /** received 事件 ID 的组成成分：账本 event_id / operation_id / attempt_id。 */
  receivedEventId: string;
  /** 父 attempt ID（重试时指向原 attempt）。 */
  parentAttemptId: string | null;
  /** 重试时指向原入口事件 ID。 */
  retryOf: string | null;
};

export type AllocateIngressOptions = {
  endpointId: EndpointId;
  /** 前缀（默认 `mcp`）。 */
  operationPrefix?: string;
  /** 父 attempt ID（业务重试）。 */
  parentAttemptId?: string | null;
  /** 原入口事件 ID（业务重试 → `retry_of`）。 */
  retryOf?: string | null;
  /** 注入的 ID 生成器（测试用）。 */
  idFactory?: () => string;
};

/**
 * 分配入口身份。
 *
 * `attempt_id` 与 `operation_id` / `ingress_event_id` 同时分配（D3）。
 * 重连本身**不**新增 attempt；实际重新执行才分配新 attempt 并带
 * `parent_attempt_id` + `retry_of`。
 */
export function allocateIngressIdentity(options: AllocateIngressOptions): IngressIdentity {
  const idFactory = options.idFactory ?? randomUUID;
  const prefix = options.operationPrefix ?? "mcp";
  const operationId = `${prefix}_${idFactory()}`;
  const attemptId = `attempt_${idFactory()}`;
  const receivedEventId = `${operationId}:received`;
  return {
    endpointId: options.endpointId,
    operationId,
    attemptId,
    ingressEventId: receivedEventId,
    receivedEventId,
    parentAttemptId: options.parentAttemptId ?? null,
    retryOf: options.retryOf ?? null
  };
}

// ─── 回传信封（Spec §6.3 / U12）─────────────────────────────────────────────

export const CORRELATION_HEADERS_VERSION = "v2p5-1";

/** 三项审计关联头。`x-lucy-event-id` 固定指向已提交 received 的 ingress_event_id。 */
export const CORRELATION_HEADER_NAMES = {
  eventId: "x-lucy-event-id",
  operationId: "x-lucy-operation-id",
  attemptId: "x-lucy-attempt-id"
} as const;

/**
 * 生成回传头。
 *
 * **只在 received 已提交后调用**；received 未提交（含提交结果未能确认）时
 * 不得回传任何审计凭据头，不编 ID 或「已接收」。
 */
export function buildCorrelationHeaders(identity: IngressIdentity): Record<string, string> {
  return {
    [CORRELATION_HEADER_NAMES.eventId]: identity.ingressEventId,
    [CORRELATION_HEADER_NAMES.operationId]: identity.operationId,
    [CORRELATION_HEADER_NAMES.attemptId]: identity.attemptId
  };
}

/**
 * 入口时点定义（Spec §5.3 / §12.1）。
 * `received_at` 是账本 UTC 时间，是 T1 / T2 结算的唯一起算点。
 */
export type IngressTiming = {
  /** received 写入成功的 UTC 毫秒时间戳。 */
  receivedAt: number;
  /** 准入时点（无 admitted 时为 null）。 */
  admittedAt: number | null;
  /** 响应准备时点（无 prepared 时为 null）。 */
  preparedAt: number | null;
};

/** T1 / T2 / T3 结算窗口（U6 冻结值，不得在实现中另立数值）。 */
export const AUDIT_WINDOWS = {
  /** T1 = 24h，自持久 received_at 起算（覆盖无 admitted 的请求）。 */
  t1SettlementHours: 24,
  /** T2 = 72h，自同一 received_at 起算；不是 ACK 超时。 */
  t2ObservationGraceHours: 72,
  /** T3 = 60s，自导出捕获账本上界 S 起算。 */
  t3ExportCatchupSeconds: 60
} as const;

/**
 * 计算某请求的 T1 / T2 截止时间。
 *
 * 期限**不因**重启、晚到事件或重试自动延长；重开须人工或追加修订事件。
 */
export function settlementDeadlines(receivedAt: number): {
  t1Deadline: number;
  t2Deadline: number;
} {
  return {
    t1Deadline: receivedAt + AUDIT_WINDOWS.t1SettlementHours * 3_600_000,
    t2Deadline: receivedAt + AUDIT_WINDOWS.t2ObservationGraceHours * 3_600_000
  };
}

// ─── 入口账本追加（Spec §12.1 durableAppend(received, …)）───────────────────

export type IngressReceivedResult =
  | { ok: true; eventId: string; seq: number }
  | { ok: false; reason: string };

export type AppendIngressReceivedInput = {
  operationId: string;
  attemptId: string;
  endpointId: EndpointId;
  actor: string;
  actorType: string;
  networkInfo?: string;
  sessionFingerprint?: string;
  method: string;
  sessionId?: string;
  /** 注入的账本追加器（生产走 security store；测试可注入）。 */
  appender: (input: {
    eventId: string;
    operationId: string;
    phase: "received";
    actor: string;
    actorType: string;
    networkInfo?: string;
    sessionFingerprint?: string;
    endpointId: string;
    verdict: string;
    resultSummary: string;
  }) => { ok: true; seq: number } | { ok: false; reason: string };
};

/**
 * 追加 `received` 事件到 canonical ledger。
 *
 * 失败即**失败关闭**：调用方必须回答 503 `AUDIT_UNAVAILABLE` 且**不分派**
 * （U3：本期无缓冲）。
 *
 * 事件 ID 格式 `${operationId}:received` —— 这就是回传给客户端的
 * `ingress_event_id`（D1 / U12）。
 */
export function appendIngressReceived(
  input: AppendIngressReceivedInput
): IngressReceivedResult {
  const eventId = `${input.operationId}:received`;
  try {
    const appended = input.appender({
      eventId,
      operationId: input.operationId,
      phase: "received",
      actor: input.actor,
      actorType: input.actorType,
      networkInfo: input.networkInfo,
      sessionFingerprint: input.sessionFingerprint,
      endpointId: input.endpointId,
      verdict: "received",
      resultSummary: JSON.stringify({
        endpoint_id: input.endpointId,
        attempt_id: input.attemptId,
        method: input.method,
        session_id: input.sessionId ?? null
      })
    });
    if (!appended.ok) return appended;
    return { ok: true, eventId, seq: appended.seq };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "received_append_failed" };
  }
}

// ─── 恢复扫描（B7 / Spec §12.2 / A01）────────────────────────────────────────
//
// 硬规则（Spec §12.2 + §5.4）：
//   1. 未闭合操作**从 canonical ledger 派生**，不从投影派生、也不从
//      `interrupted` 列表派生 —— 投影只保留最新状态，扫描必须看账本。
//   2. 恢复标记**幂等追加**：同一 operation 的标记事件 ID 固定，
//      重复扫描被 `duplicate_event` 吸收。
//   3. **不重放业务**：恢复扫描只补审计闭包，绝不重新分派请求。
//
// `recoverInterruptedOperations`（security/ledger.ts）以 `request_admitted`
// 为起点，覆盖「已准入未闭合」。本扫描以 `received` 为起点，补上
// 「已接收但从未准入」的缺口（收到即崩溃 → 执行事实 = not_executed）。

/** 终态阶段：出现任一即视为该操作在账本上已闭合。 */
export const LEDGER_TERMINAL_PHASES = [
  "response_delivered",
  "response_failed",
  "interrupted"
] as const;

/** 账本事件轨迹的最小形状（纯函数只依赖这些字段，便于测试注入）。 */
export type LedgerTrailEvent = {
  eventId: string;
  operationId: string;
  phase: string;
  seq: number;
  createdAt: number;
};

export type UnclosedReceivedOperation = {
  operationId: string;
  /** 已提交 received 的事件 ID（即回传给客户端的 ingress_event_id）。 */
  ingressEventId: string;
  receivedSeq: number;
  receivedAt: number;
  /** 该操作在账本里已出现的阶段（按 seq 升序）。 */
  phases: string[];
  /** 是否已分派（出现过 `request_admitted`）。 */
  dispatched: boolean;
};

/**
 * 从账本轨迹派生**未闭合**的 received 操作。
 *
 * 判定：
 *   - 必须有 `received`；
 *   - 不得出现任何终态阶段（`response_delivered` / `response_failed` /
 *     `interrupted`）—— 出现即已闭合，不再重复标记；
 *   - 是否已分派由 `request_admitted` 判定（只报告，不在此处过滤）。
 *
 * 本函数**不接受也不使用任何时间戳**做裁决：闭合与否只看账本里出现过
 * 哪些阶段，避免「按时间回绑」。
 */
export function deriveUnclosedReceivedOperations(
  trails: ReadonlyArray<ReadonlyArray<LedgerTrailEvent>>
): UnclosedReceivedOperation[] {
  const out: UnclosedReceivedOperation[] = [];
  for (const trail of trails) {
    if (trail.length === 0) continue;
    const ordered = [...trail].sort((a, b) => a.seq - b.seq);
    const received = ordered.find((event) => event.phase === "received");
    if (!received) continue;
    const phases = ordered.map((event) => event.phase);
    if (phases.some((phase) => (LEDGER_TERMINAL_PHASES as readonly string[]).includes(phase))) continue;
    out.push({
      operationId: received.operationId,
      ingressEventId: received.eventId,
      receivedSeq: received.seq,
      receivedAt: received.createdAt,
      phases,
      dispatched: phases.includes("request_admitted")
    });
  }
  out.sort((a, b) => a.receivedSeq - b.receivedSeq);
  return out;
}

export type RecoveryScanReport = {
  /** 本次追加了恢复标记的操作。 */
  closed: string[];
  /** 幂等吸收：恢复标记此前已存在（duplicate_event）。 */
  alreadyClosed: string[];
  /** 已有 `request_admitted` → 由既有 admitted 扫描负责，本扫描不重复标记。 */
  skippedDispatched: string[];
};

/**
 * 扫描并幂等关闭「已接收但未闭合」的操作。
 *
 * 失败关闭：账本不可用时返回 `{ ok: false }`，调用方**不得**据此认为扫描通过。
 * 不重放业务：这里只追加审计闭包事件。
 */
export async function recoverUnclosedReceivedOperations(
  store: SecurityStore
): Promise<{ ok: true; value: RecoveryScanReport } | { ok: false; reason: string }> {
  const report: RecoveryScanReport = { closed: [], alreadyClosed: [], skippedDispatched: [] };
  const open = store.listUnterminatedOperations("received", LEDGER_TERMINAL_PHASES, 500);
  if (!open.ok) return { ok: false, reason: `list_unterminated_failed:${open.reason}` };
  if (open.value.length === 0) return { ok: true, value: report };

  const trails: LedgerTrailEvent[][] = [];
  for (const received of open.value) {
    const trail = store.listEventsByOperation(received.operationId);
    if (!trail.ok) return { ok: false, reason: `list_operation_failed:${trail.reason}` };
    trails.push(
      trail.value.map((event) => ({
        eventId: event.eventId,
        operationId: event.operationId,
        phase: event.phase,
        seq: event.seq,
        createdAt: event.createdAt
      }))
    );
  }

  const unclosed = deriveUnclosedReceivedOperations(trails);
  for (const operation of unclosed) {
    if (operation.dispatched) {
      // 已有 admitted 凭据 → 归既有 `recoverInterruptedOperations` 负责。
      report.skippedDispatched.push(operation.operationId);
      continue;
    }
    const eventId = `${operation.operationId}:interrupted`;
    const appended = store.appendEvent({
      eventId,
      operationId: operation.operationId,
      phase: "interrupted",
      actor: "lucy-recovery",
      actorType: "system",
      verdict: "received_only",
      resultSummary: JSON.stringify({
        reason: "process_restart",
        stage: "received_only",
        prepared: false,
        ingress_event_id: operation.ingressEventId,
        received_seq: operation.receivedSeq
      })
    });
    if (!appended.ok) {
      // 幂等：并发/重复扫描已写入同一 event_id → 吸收，不算失败。
      if (appended.reason === "duplicate_event") {
        report.alreadyClosed.push(operation.operationId);
        continue;
      }
      return { ok: false, reason: `append_recovery_failed:${appended.reason}` };
    }
    report.closed.push(operation.operationId);
  }
  return { ok: true, value: report };
}

/**
 * 进程启动时的恢复扫描入口（供 `buildProxy` 调用）。
 *
 * 失败**不阻断**代理启动 —— 既有 `recoverInterruptedOperations` 也是同样的
 * 「记录并保持更严格状态」语义；请求侧仍按 U3 逐请求失败关闭。
 */
export async function runStartupRecoveryScan(): Promise<RecoveryScanReport | null> {
  const store = await getSecurityStore();
  if (!store.ok) {
    console.error(`[lucy-audit] received-operation recovery skipped: ${store.code}/${store.reason}`);
    return null;
  }
  const scanned = await recoverUnclosedReceivedOperations(store.value);
  if (!scanned.ok) {
    console.error(`[lucy-audit] received-operation recovery failed: ${scanned.reason}`);
    return null;
  }
  const { closed, alreadyClosed, skippedDispatched } = scanned.value;
  if (closed.length > 0 || alreadyClosed.length > 0) {
    console.warn(
      `[lucy-audit] closed ${closed.length} received-only operation(s) as interrupted ` +
        `(${alreadyClosed.length} already closed, ${skippedDispatched.length} dispatched)`
    );
  }
  return scanned.value;
}
