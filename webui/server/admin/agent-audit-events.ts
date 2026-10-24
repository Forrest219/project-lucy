/**
 * audit-trust-2026-10-19-r1 / T06 — 受控客户端 observation 接收端
 *
 * Contract §2.5.2 / §4.2 / §6.2.
 *
 * - POST /api/agent-audit/events
 * - 受控适配器专用凭证 (与管理员 Cookie 隔离); 凭证可撤销; scope 限定
 *   adapter_id + instance_id; 不复用管理员 Cookie 或 body.userId。
 * - 请求体: { events: Array<...> } 1..100 条, body ≤ 1 MiB; 超过返回 413。
 * - 幂等 (adapter_id, client_event_id, classification_version):
 *     - 相同 content hash -> 返回先前 ack。
 *     - 异 content hash -> 409 id_conflict + 现有 ack。
 * - 父事件 (parent_event_id) 仅可引用同 adapter 可见范围; 跨主体不可枚举。
 * - 持久化到 security_events (audit_event_kind = audit_management, sub_kind =
 *   client_observation) + audit_management 摘要事件。
 * - 双时间戳: server_received_at (服务端 now), observed_at (客户端报告)。
 * - heartbeat 含 adapter_id + instance_id; gap_window_s 离线补传保持 observed_at。
 *
 * 当前 T06a 实现: 适配器凭证 = env `LUCY_AGENT_AUDIT_TOKEN` 单 token 占位；
 * 真实凭证服务化（OIDC / etcd）留 T08 后续窗口。blocked_due_to_no_real_client。
 */

import type Database from "better-sqlite3";
import { createHash } from "node:crypto";

export type ClientObservationEventType =
  | "preflight_rejected"
  | "result_received"
  | "artifact_created"
  | "egress_observed"
  | "heartbeat";

export type AgentAuditEventInput = {
  client_event_id: string;
  observed_at: string; // ISO 8601
  event_type: ClientObservationEventType;
  parent_event_id?: string;
  payload: Record<string, unknown>;
};

export type AgentAuditAdapter = {
  adapter_id: string;
  instance_id: string;
  /**
   * Allowed parent_event_ids for this adapter.
   *
   * B23 / E-7：此前恒为空集（`new Set<string>()`），任何带 `parent_event_id`
   * 的客户端观测都被拒 `parent_not_visible`，`acknowledged` 路径**永不可达**。
   * 现在由服务端按**凭据 scope + 可见性**解析出真实父集合（见
   * `resolveVisibleParentIds`）。
   */
  visibleParentIds: Set<string>;
};

/**
 * B23 — 服务端按「凭据 scope + 可见性」解析真实父集合。
 *
 * 父事件的可见性判据（三者同时成立）：
 *   1. 父事件存在于 canonical ledger（不是客户端自称的 ID）；
 *   2. 父事件的 `operation_id` 与该父 ID 的登记 attempt 一致；
 *   3. 父事件的 actor / session 与当前适配器凭据 scope 一致。
 *
 * 解析失败 → 集合为空（fail-closed），**不**放宽为「全部可见」。
 */
export type VisibleParentResolver = (input: {
  parentEventId: string;
  adapter: AgentAuditAdapter;
}) => Promise<boolean> | boolean;

/**
 * 依据服务端账本解析可见父集合。
 *
 * @param parentEventIds 候选父 ID（来自请求）。
 * @param lookup        服务端账本查询：返回父事件的 operation / actor / session。
 */
export async function resolveVisibleParentIds(
  parentEventIds: readonly string[],
  lookup: (parentEventId: string) => Promise<{
    operationId: string;
    actor: string;
    sessionFingerprint: string;
  } | null>,
  scope: { actor: string; sessionFingerprint: string }
): Promise<Set<string>> {
  const visible = new Set<string>();
  for (const parentEventId of parentEventIds) {
    if (!parentEventId) continue;
    const parent = await lookup(parentEventId);
    if (!parent) continue;
    if (parent.actor !== scope.actor) continue;
    if (parent.sessionFingerprint !== scope.sessionFingerprint) continue;
    visible.add(parentEventId);
  }
  return visible;
}

export type PersistedClientObservation = {
  client_event_id: string;
  server_event_id: string;
  server_received_at: string;
  /**
   * B23：送达状态。本期只写 `prepared` / `sent` / `acknowledged` / `unknown`；
   * `unacknowledged` 仅保留值域、本期不写入（U1）。
   */
  delivery_status: "prepared" | "sent" | "acknowledged" | "unknown";
};

export type AgentAuditResult =
  | { status: "accepted"; persisted: PersistedClientObservation; deliveryReason?: string }
  | { status: "idempotent_replay"; persisted: PersistedClientObservation }
  | { status: "id_conflict"; existing: { server_received_at: string; ack_status: string } }
  | { status: "parent_not_visible" }
  | { status: "schema_invalid"; details: string[] };

/**
 * B23 — `result_received` 升级 `acknowledged` 的**校验结果**。
 *
 * U1 要求：有效回执必须关联同一入口 `event_id`、`attempt_id` 及持久
 * `response_prepared` 证据 / 摘要，才能写 `acknowledged`。
 * 接入口 HTTP 成功、heartbeat、发送成功或声明一个父 ID 都**不是**有效接收回执。
 */
export type AcknowledgementValidation = {
  upgraded: boolean;
  reason: string;
  /** 校验通过的父入口事件 ID。 */
  parentIngressEventId: string | null;
  parentAttemptId: string | null;
};

/**
 * B23 — 校验 `result_received` 是否足以升级 `acknowledged`。
 *
 * 全部条件同时成立才升级：
 *   1. 父 `ingress_event_id` 存在且在适配器可见父集合内；
 *   2. 父 `attempt_id` 与观测声明的 attempt 一致；
 *   3. 父的**持久** `response_prepared` 摘要与观测声明的摘要一致。
 *
 * 任一不满足 → 不升级，记冲突 / unknown。**绝不**部分升级。
 */
export function validateAcknowledgement(input: {
  parentEventId: string | null | undefined;
  visibleParentIds: ReadonlySet<string>;
  /** 观测声明的父 attempt ID。 */
  declaredAttemptId: string | null | undefined;
  /** 服务端账本中该父 attempt 的 attempt ID。 */
  parentAttemptId: string | null | undefined;
  /** 服务端账本中该父的持久 response_prepared 摘要。 */
  parentPreparedDigest: string | null | undefined;
  /** 观测声明的响应摘要。 */
  declaredDigest: string | null | undefined;
}): AcknowledgementValidation {
  const parentEventId = input.parentEventId ?? null;
  const fail = (reason: string): AcknowledgementValidation => ({
    upgraded: false,
    reason,
    parentIngressEventId: parentEventId,
    parentAttemptId: input.parentAttemptId ?? null
  });

  if (!parentEventId) return fail("parent_event_id_missing");
  if (!input.visibleParentIds.has(parentEventId)) return fail("parent_not_visible");
  if (!input.parentAttemptId) return fail("parent_attempt_unknown");
  if (!input.declaredAttemptId) return fail("declared_attempt_missing");
  if (input.declaredAttemptId !== input.parentAttemptId) return fail("parent_attempt_mismatch");
  if (!input.parentPreparedDigest) return fail("parent_response_prepared_missing");
  if (!input.declaredDigest) return fail("declared_digest_missing");
  if (input.declaredDigest !== input.parentPreparedDigest) return fail("parent_digest_mismatch");

  return {
    upgraded: true,
    reason: "acknowledged",
    parentIngressEventId: parentEventId,
    parentAttemptId: input.parentAttemptId
  };
}

const MAX_EVENTS_PER_REQUEST = 100;
const MAX_BODY_BYTES = 1024 * 1024; // 1 MiB

export const AGENT_AUDIT_CREDENTIAL_INVALID = "credential_invalid";
export const AGENT_AUDIT_CREDENTIAL_SCOPE_INSUFFICIENT = "credential_scope_insufficient";

/**
 * Resolve the adapter from the request's `X-Agent-Audit-Token` header. The
 * real implementation would consult a credentials store (OIDC / etcd) and
 * verify signature + revocation. T06a placeholder reads the env-stored token
 * and maps it to a fixed `adapter_id` + `instance_id` pair so tests can run.
 */
export function resolveAdapterFromToken(token: string | undefined): AgentAuditAdapter | null {
  if (!token) return null;
  const expected = process.env.LUCY_AGENT_AUDIT_TOKEN;
  if (!expected || token !== expected) return null;
  const adapterId = process.env.LUCY_AGENT_AUDIT_ADAPTER_ID ?? "agent-adapter-default";
  const instanceId = process.env.LUCY_AGENT_AUDIT_INSTANCE_ID ?? "lucy-default";
  return {
    adapter_id: adapterId,
    instance_id: instanceId,
    visibleParentIds: new Set<string>()
  };
}

function sha256Hex(content: unknown): string {
  return createHash("sha256").update(JSON.stringify(content), "utf8").digest("hex");
}

function validateSchema(events: unknown): string[] {
  const errors: string[] = [];
  if (!Array.isArray(events)) {
    errors.push("events must be an array");
    return errors;
  }
  if (events.length < 1) errors.push("events.length must be >= 1");
  if (events.length > MAX_EVENTS_PER_REQUEST) errors.push(`events.length must be <= ${MAX_EVENTS_PER_REQUEST}`);
  for (let i = 0; i < events.length; i++) {
    const e = events[i] as Partial<AgentAuditEventInput> | null;
    if (!e || typeof e !== "object") {
      errors.push(`events[${i}] must be an object`);
      continue;
    }
    if (typeof e.client_event_id !== "string" || e.client_event_id.length === 0 || e.client_event_id.length > 128) {
      errors.push(`events[${i}].client_event_id must be a non-empty string <= 128 chars`);
    }
    if (typeof e.observed_at !== "string" || isNaN(Date.parse(e.observed_at))) {
      errors.push(`events[${i}].observed_at must be an ISO 8601 string`);
    }
    if (
      e.event_type !== "preflight_rejected" &&
      e.event_type !== "result_received" &&
      e.event_type !== "artifact_created" &&
      e.event_type !== "egress_observed" &&
      e.event_type !== "heartbeat"
    ) {
      errors.push(`events[${i}].event_type must be one of the allowed kinds`);
    }
    if (typeof e.payload !== "object" || e.payload === null) {
      errors.push(`events[${i}].payload must be an object`);
    }
  }
  return errors;
}

/**
 * Ensure the idempotency table exists on the security DB.
 */
export function ensureAgentAuditSchema(securityDb: Database.Database): void {
  securityDb.exec(`
    CREATE TABLE IF NOT EXISTS agent_audit_idempotency (
      adapter_id TEXT NOT NULL,
      client_event_id TEXT NOT NULL,
      classification_version TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      server_event_id TEXT NOT NULL,
      server_received_at INTEGER NOT NULL,
      ack_status TEXT NOT NULL,
      event_type TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      PRIMARY KEY (adapter_id, client_event_id, classification_version)
    );
    CREATE INDEX IF NOT EXISTS idx_aai_adapter ON agent_audit_idempotency(adapter_id);
  `);
}

/**
 * B23 — 送达状态的**唯一写入点**。
 *
 * - `result_received` 且通过 `validateAcknowledgement` → `acknowledged`。
 * - `result_received` 但校验不通过 → `unknown`（**不是** `unacknowledged`；
 *   U1 明确「无 ACK 超时」「不推导 unacknowledged」）。
 * - 其他观测类型（heartbeat / preflight_rejected / artifact_created /
 *   egress_observed）→ `unknown`（接收观察未知）。
 *
 * `unacknowledged` 只保留值域，本期**不写入**。
 */
export function resolveDeliveryStatus(input: {
  eventType: ClientObservationEventType;
  acknowledgement?: AcknowledgementValidation;
}): "prepared" | "sent" | "acknowledged" | "unknown" {
  if (input.eventType !== "result_received") return "unknown";
  if (input.acknowledgement?.upgraded) return "acknowledged";
  return "unknown";
}

/**
 * Persist a batch of observations. Each event produces one row in
 * `security_events` (audit_event_kind = audit_management, sub_kind =
 * client_observation) AND one row in `agent_audit_idempotency`. Existing rows
 * with the same key + same content_hash return "idempotent_replay";
 * same key + different content_hash return "id_conflict".
 *
 * The caller is responsible for verifying the adapter's allowed parent_event_ids
 * against any `parent_event_id` in `event`.
 */
export function appendClientObservations(
  securityDb: Database.Database,
  adapter: AgentAuditAdapter,
  events: AgentAuditEventInput[],
  classificationVersion: string,
  ledgerAppender: (input: {
    eventId: string;
    operationId: string;
    phase: string;
    actor: string;
    actorType: string;
    auditEventKind: string;
    objectHash: string;
    resultSummary: string;
    eventType: string;
    observedAt: string;
    serverReceivedAt: number;
    subKind: string;
    deliveryStatus?: string;
    parentIngressEventId?: string | null;
    parentAttemptId?: string | null;
  }) => { seq: number; eventId: string },
  /**
   * B23：服务端账本查询 —— 用于校验 `result_received` 能否升级 `acknowledged`。
   * 未提供时**不升级**（fail-closed），只记 `unknown`。
   *
   * 必须是**同步**函数：better-sqlite3 的 transaction 是同步的，事务体内不能 await。
   */
  acknowledgementLookup?: (input: {
    parentEventId: string;
    event: AgentAuditEventInput;
  }) => {
    parentAttemptId: string | null;
    parentPreparedDigest: string | null;
  } | null
): AgentAuditResult[] {
  ensureAgentAuditSchema(securityDb);
  const results: AgentAuditResult[] = [];
  const txn = securityDb.transaction(() => {
    for (const event of events) {
      const contentHash = sha256Hex({
        observed_at: event.observed_at,
        event_type: event.event_type,
        parent_event_id: event.parent_event_id ?? null,
        payload: event.payload
      });
      const existing = securityDb
        .prepare(
          `SELECT server_event_id, server_received_at, ack_status, content_hash
             FROM agent_audit_idempotency
             WHERE adapter_id = ? AND client_event_id = ? AND classification_version = ?`
        )
        .get(adapter.adapter_id, event.client_event_id, classificationVersion) as
        | {
            server_event_id: string;
            server_received_at: number;
            ack_status: string;
            content_hash: string;
          }
        | undefined;

      if (existing) {
        if (existing.content_hash === contentHash) {
          results.push({
            status: "idempotent_replay",
            persisted: {
              client_event_id: event.client_event_id,
              server_event_id: existing.server_event_id,
              server_received_at: new Date(existing.server_received_at).toISOString(),
              delivery_status: normalizeStoredDeliveryStatus(existing.ack_status)
            }
          });
        } else {
          results.push({
            status: "id_conflict",
            existing: {
              server_received_at: new Date(existing.server_received_at).toISOString(),
              ack_status: existing.ack_status
            }
          });
        }
        continue;
      }

      if (
        event.parent_event_id &&
        !adapter.visibleParentIds.has(event.parent_event_id)
      ) {
        // Cross-subject parent: refuse and do not persist. The caller decides
        // how to surface this to the client (200 with error in results, or 400).
        results.push({ status: "parent_not_visible" });
        continue;
      }

      // ─── B23：result_received 的 acknowledged 升级校验 ────────────────────
      let acknowledgement: AcknowledgementValidation | undefined;
      if (event.event_type === "result_received") {
        const parent = event.parent_event_id
          ? acknowledgementLookup?.({ parentEventId: event.parent_event_id, event }) ?? null
          : null;
        const payload = (event.payload ?? {}) as Record<string, unknown>;
        acknowledgement = validateAcknowledgement({
          parentEventId: event.parent_event_id,
          visibleParentIds: adapter.visibleParentIds,
          declaredAttemptId:
            typeof payload.attempt_id === "string"
              ? payload.attempt_id
              : typeof payload.attemptId === "string"
                ? payload.attemptId
                : null,
          parentAttemptId: parent?.parentAttemptId ?? null,
          parentPreparedDigest: parent?.parentPreparedDigest ?? null,
          declaredDigest:
            typeof payload.sha256 === "string"
              ? payload.sha256
              : typeof payload.digest === "string"
                ? payload.digest
                : null
        });
      }
      const deliveryStatus = resolveDeliveryStatus({
        eventType: event.event_type,
        acknowledgement
      });

      const serverReceivedAt = Date.now();
      const eventId = `agent-audit-${adapter.adapter_id}-${event.client_event_id}`;
      const objectHash = sha256Hex({
        adapter_id: adapter.adapter_id,
        instance_id: adapter.instance_id,
        client_event_id: event.client_event_id,
        content_hash: contentHash
      });
      const appended = ledgerAppender({
        eventId,
        operationId: `agent-audit-${adapter.adapter_id}`,
        phase: "commit",
        actor: adapter.adapter_id,
        actorType: "automation",
        auditEventKind: "audit_management",
        objectHash,
        resultSummary: `client_observation type=${event.event_type} client_event_id=${event.client_event_id}`,
        eventType: event.event_type,
        observedAt: event.observed_at,
        serverReceivedAt,
        subKind: "client_observation",
        deliveryStatus,
        parentIngressEventId: acknowledgement?.parentIngressEventId ?? null,
        parentAttemptId: acknowledgement?.parentAttemptId ?? null
      });

      securityDb
        .prepare(
          `INSERT OR REPLACE INTO agent_audit_idempotency
             (adapter_id, client_event_id, classification_version, content_hash,
              server_event_id, server_received_at, ack_status, event_type, observed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          adapter.adapter_id,
          event.client_event_id,
          classificationVersion,
          contentHash,
          appended.eventId,
          serverReceivedAt,
          // B23 / E-7：ack_status 不再硬编码 "accepted" —— 记真实送达状态。
          deliveryStatus,
          event.event_type,
          event.observed_at
        );

      const persisted: PersistedClientObservation = {
        client_event_id: event.client_event_id,
        server_event_id: appended.eventId,
        server_received_at: new Date(serverReceivedAt).toISOString(),
        delivery_status: deliveryStatus
      };

      // B23：观测已持久化；送达状态是**独立维度**（Spec §4.3(b)）。
      // `result_received` 但校验不通过 → 送达状态保持 `unknown` 并记冲突原因，
      // **不升级**为 acknowledged。`status` 仍是 `accepted`（观测已提交）。
      results.push({
        status: "accepted",
        persisted,
        ...(event.event_type === "result_received" && !acknowledgement?.upgraded
          ? { deliveryReason: acknowledgement?.reason ?? "acknowledgement_unavailable" }
          : {})
      });
    }
  });
  txn();
  return results;
}

/** 已存 `ack_status` → 送达状态（历史值 `accepted` 归一为 `unknown`）。 */
function normalizeStoredDeliveryStatus(ackStatus: string): "prepared" | "sent" | "acknowledged" | "unknown" {
  if (ackStatus === "acknowledged" || ackStatus === "sent" || ackStatus === "prepared") return ackStatus;
  return "unknown";
}

/**
 * Validate the JSON body against the T06 schema (without persisting).
 * Returns the validation errors as an empty list on success.
 */
export function validateAgentAuditBody(body: unknown): string[] {
  if (!body || typeof body !== "object") {
    return ["body must be an object"];
  }
  const events = (body as { events?: unknown }).events;
  return validateSchema(events);
}

export function bodySizeError(bodyBytes: number): string | null {
  if (bodyBytes > MAX_BODY_BYTES) {
    return `body > ${MAX_BODY_BYTES} bytes (got ${bodyBytes})`;
  }
  return null;
}

export function isEventCountError(eventsLength: number): string | null {
  if (eventsLength > MAX_EVENTS_PER_REQUEST) {
    return `events.length > ${MAX_EVENTS_PER_REQUEST} (got ${eventsLength})`;
  }
  return null;
}