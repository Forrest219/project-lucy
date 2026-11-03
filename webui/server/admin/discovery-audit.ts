/**
 * Spec 190 §7.8 — discovery audit events.
 *
 * Every live table query leaves one event: the manual reads and the background
 * poll are treated the same way. The event type is separate from the write
 * audit channel on purpose — these probes never change an asset.
 */
import { getAuditDb } from "./audit.js";

export type DiscoveryAuditAction = "list" | "structure_diff" | "reconcile";
export type DiscoveryAuditOutcome = "ok" | "error";

export type DiscoveryAuditInput = {
  actor: string;
  connectionId: string;
  schema: string;
  action: DiscoveryAuditAction;
  outcome: DiscoveryAuditOutcome;
  reason?: string | null;
  latencyMs: number;
  tableCount: number;
  requestId?: string | null;
};

/** Returns the new row id, or undefined when the audit store refused the write. */
export async function recordDiscoveryAudit(input: DiscoveryAuditInput): Promise<number | undefined> {
  try {
    const database = await getAuditDb();
    const result = database
      .prepare(`
        INSERT INTO discovery_audit_log
          (ts, actor, connection_id, schema_name, action, outcome, reason, latency_ms, table_count, request_id)
        VALUES
          (@ts, @actor, @connection_id, @schema_name, @action, @outcome, @reason, @latency_ms, @table_count, @request_id)
      `)
      .run({
        ts: new Date().toISOString(),
        actor: input.actor,
        connection_id: input.connectionId,
        schema_name: input.schema,
        action: input.action,
        outcome: input.outcome,
        reason: input.reason ?? null,
        latency_ms: Math.max(0, Math.floor(input.latencyMs || 0)),
        table_count: Math.max(0, Math.floor(input.tableCount || 0)),
        request_id: input.requestId ?? null
      });
    return typeof result.lastInsertRowid === "number" ? result.lastInsertRowid : undefined;
  } catch {
    // A broken audit store must not break the read-only probe itself.
    return undefined;
  }
}
