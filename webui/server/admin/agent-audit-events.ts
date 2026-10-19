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
  /** Allowed parent_event_ids for this adapter. Empty set = none. */
  visibleParentIds: Set<string>;
};

export type PersistedClientObservation = {
  client_event_id: string;
  server_event_id: string;
  server_received_at: string;
};

export type AgentAuditResult =
  | { status: "accepted"; persisted: PersistedClientObservation }
  | { status: "idempotent_replay"; persisted: PersistedClientObservation }
  | { status: "id_conflict"; existing: { server_received_at: string; ack_status: string } }
  | { status: "parent_not_visible" }
  | { status: "schema_invalid"; details: string[] };

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
  }) => { seq: number; eventId: string }
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
              server_received_at: new Date(existing.server_received_at).toISOString()
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
        subKind: "client_observation"
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
          "accepted",
          event.event_type,
          event.observed_at
        );

      results.push({
        status: "accepted",
        persisted: {
          client_event_id: event.client_event_id,
          server_event_id: appended.eventId,
          server_received_at: new Date(serverReceivedAt).toISOString()
        }
      });
    }
  });
  txn();
  return results;
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