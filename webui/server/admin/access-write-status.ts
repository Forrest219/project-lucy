import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getAuditDb, type ConfigAuditWriteStatus } from "./audit.js";
import { trustedActorFromRequest, type TrustedActor } from "../security/request-actor.js";

/**
 * P1-59 RACS — read-only access-configuration write status by client operationId.
 *
 * Maps `operationId` → existing `config_change_log.idempotency_key` and
 * `new_summary.racsReceipt`; does not read live access.yaml to infer outcomes.
 */

export const RACS_RECEIPT_SCHEMA_VERSION = "racs-v1-receipt-1";
export const RACS_IDEMPOTENCY_PREFIX = "racs-v1:";

const CLIENT_OPERATION_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type RacsObjectKind = "role" | "agent";

export type RacsReceipt = Readonly<{
  schemaVersion: typeof RACS_RECEIPT_SCHEMA_VERSION;
  submitterAccountUid: string | null;
  submitterActorId: string;
  objectKind: RacsObjectKind;
  objectId: string;
  /** SHA-256 hex of the canonical request payload for this save attempt. */
  requestDigest: string;
  /** Serialized base object version at preview time. */
  baseObjectVersion: string;
  committedObjectVersion?: string;
  /** Whole-configuration candidate digest at commit time (hex). */
  candidateConfigDigest: string;
  terminal?: Readonly<{
    runtimeAck: boolean;
    effectiveDigest?: string;
    writeStatus: ConfigAuditWriteStatus;
  }>;
}>;

export type AccessWriteStatusOutcome = "committed" | "not_committed" | "unknown";

export type AccessWriteStatusQueryResult = Readonly<{
  operationId: string;
  outcome: AccessWriteStatusOutcome;
  objectKind?: RacsObjectKind;
  objectId?: string;
  committedObjectVersion?: string;
  committedConfigDigest?: string;
  requestDigest?: string;
  auditId?: number;
  trustedRequestId?: string | null;
  disclosure?: string;
}>;

export type RacsIdempotencyRejectCode =
  | "operation_id_invalid"
  | "idempotency_payload_mismatch"
  | "idempotency_actor_mismatch"
  | "idempotency_receipt_missing";

export type RacsIdempotencyClaimResult =
  | { kind: "fresh"; idempotencyKey: string }
  | { kind: "replay"; auditId: number; writeStatus: ConfigAuditWriteStatus }
  | { kind: "reject"; code: RacsIdempotencyRejectCode };

type ConfigAuditRow = {
  id: number;
  actor: string;
  request_id: string | null;
  new_summary: string | null;
  write_status: ConfigAuditWriteStatus;
  error_reason: string | null;
};

export function isValidClientOperationId(operationId: string): boolean {
  return CLIENT_OPERATION_ID_RE.test(operationId.trim());
}

export function racsIdempotencyKey(operationId: string): string {
  const digest = createHash("sha256").update(operationId.trim()).digest("hex");
  return `${RACS_IDEMPOTENCY_PREFIX}${digest}`;
}

export function buildRacsReceipt(input: {
  submitterAccountUid: string | null;
  submitterActorId: string;
  objectKind: RacsObjectKind;
  objectId: string;
  requestDigest: string;
  baseObjectVersion: string;
  committedObjectVersion?: string;
  candidateConfigDigest: string;
  terminal?: RacsReceipt["terminal"];
}): RacsReceipt {
  return {
    schemaVersion: RACS_RECEIPT_SCHEMA_VERSION,
    submitterAccountUid: input.submitterAccountUid,
    submitterActorId: input.submitterActorId,
    objectKind: input.objectKind,
    objectId: input.objectId,
    requestDigest: input.requestDigest,
    baseObjectVersion: input.baseObjectVersion,
    ...(input.committedObjectVersion ? { committedObjectVersion: input.committedObjectVersion } : {}),
    candidateConfigDigest: input.candidateConfigDigest,
    ...(input.terminal ? { terminal: input.terminal } : {})
  };
}

/** Attach the durable receipt without disturbing unrelated summary fields. */
export function embedRacsReceiptInSummary(
  summary: Record<string, unknown> | undefined,
  receipt: RacsReceipt
): Record<string, unknown> {
  return { ...(summary ?? {}), racsReceipt: receipt };
}

export function mergeTerminalIntoRacsReceipt(
  receipt: RacsReceipt,
  terminal: NonNullable<RacsReceipt["terminal"]>
): RacsReceipt {
  return { ...receipt, terminal };
}

export function parseRacsReceiptFromSummary(summary: unknown): RacsReceipt | null {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return null;
  const raw = (summary as Record<string, unknown>).racsReceipt;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const schemaVersion = record.schemaVersion;
  const submitterActorId = record.submitterActorId;
  const objectKind = record.objectKind;
  const objectId = record.objectId;
  const requestDigest = record.requestDigest;
  const baseObjectVersion = record.baseObjectVersion;
  const candidateConfigDigest = record.candidateConfigDigest;
  if (
    schemaVersion !== RACS_RECEIPT_SCHEMA_VERSION ||
    typeof submitterActorId !== "string" ||
    (objectKind !== "role" && objectKind !== "agent") ||
    typeof objectId !== "string" ||
    typeof requestDigest !== "string" ||
    typeof baseObjectVersion !== "string" ||
    typeof candidateConfigDigest !== "string"
  ) {
    return null;
  }
  const submitterAccountUid =
    record.submitterAccountUid === null || record.submitterAccountUid === undefined
      ? null
      : typeof record.submitterAccountUid === "string"
        ? record.submitterAccountUid
        : null;
  let terminal: RacsReceipt["terminal"];
  const terminalRaw = record.terminal;
  if (terminalRaw && typeof terminalRaw === "object" && !Array.isArray(terminalRaw)) {
    const t = terminalRaw as Record<string, unknown>;
    const writeStatus = t.writeStatus;
    if (
      (writeStatus === "pending" ||
        writeStatus === "committed" ||
        writeStatus === "failed" ||
        writeStatus === "rolled_back") &&
      typeof t.runtimeAck === "boolean"
    ) {
      terminal = {
        runtimeAck: t.runtimeAck,
        writeStatus,
        ...(typeof t.effectiveDigest === "string" ? { effectiveDigest: t.effectiveDigest } : {})
      };
    }
  }
  return {
    schemaVersion: RACS_RECEIPT_SCHEMA_VERSION,
    submitterAccountUid,
    submitterActorId,
    objectKind,
    objectId,
    requestDigest,
    baseObjectVersion,
    ...(typeof record.committedObjectVersion === "string" ? { committedObjectVersion: record.committedObjectVersion } : {}),
    candidateConfigDigest,
    ...(terminal ? { terminal } : {})
  };
}

function parseStoredSummary(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function receiptIsCompleteForQuery(receipt: RacsReceipt): boolean {
  return (
    receipt.requestDigest.length > 0 &&
    receipt.baseObjectVersion.length > 0 &&
    receipt.candidateConfigDigest.length > 0 &&
    receipt.objectId.length > 0
  );
}

function mapRowToOutcome(row: ConfigAuditRow, receipt: RacsReceipt | null): AccessWriteStatusQueryResult {
  const base: AccessWriteStatusQueryResult = {
    operationId: "",
    outcome: "unknown",
    trustedRequestId: row.request_id,
    auditId: row.id
  };
  if (!receipt || !receiptIsCompleteForQuery(receipt)) {
    return {
      ...base,
      disclosure: "audit_receipt_incomplete"
    };
  }
  const common = {
    objectKind: receipt.objectKind,
    objectId: receipt.objectId,
    requestDigest: receipt.requestDigest,
    committedObjectVersion: receipt.committedObjectVersion,
    committedConfigDigest: receipt.candidateConfigDigest
  };
  if (row.write_status === "pending") {
    return {
      ...base,
      ...common,
      disclosure: "terminal_pending"
    };
  }
  if (row.write_status === "committed") {
    const terminal = receipt.terminal;
    if (!terminal || terminal.writeStatus !== "committed" || !terminal.runtimeAck || !receipt.committedObjectVersion) {
      return {
        ...base,
        ...common,
        disclosure: "committed_terminal_evidence_missing"
      };
    }
    return {
      ...base,
      outcome: "committed",
      ...common
    };
  }
  if (row.write_status === "failed" || row.write_status === "rolled_back") {
    const terminal = receipt.terminal;
    const recoveryConfirmed =
      terminal &&
      (terminal.writeStatus === "failed" || terminal.writeStatus === "rolled_back");
    if (!recoveryConfirmed) {
      return {
        ...base,
        ...common,
        disclosure: "failure_without_confirmed_terminal"
      };
    }
    return {
      ...base,
      outcome: "not_committed",
      ...common,
      disclosure:
        row.write_status === "rolled_back" ? "rolled_back_confirmed" : "failed_confirmed"
    };
  }
  return {
    ...base,
    ...common,
    disclosure: "unrecognized_terminal"
  };
}

export function canViewAccessWriteStatus(
  viewer: TrustedActor,
  receipt: RacsReceipt | null,
  rowActorId: string
): boolean {
  if (viewer.role === "owner") return true;
  if (receipt) {
    if (
      receipt.submitterAccountUid &&
      viewer.accountUid &&
      receipt.submitterAccountUid === viewer.accountUid
    ) {
      return true;
    }
    if (
      receipt.submitterAccountUid === null &&
      viewer.accountUid === null &&
      receipt.submitterActorId === viewer.actorId
    ) {
      return true;
    }
    return false;
  }
  // Without an immutable submitting identity, a reused display id proves nothing.
  return false;
}

export function evaluateRacsIdempotencyClaim(
  database: Database.Database,
  input: { operationId: string; receipt: RacsReceipt }
): RacsIdempotencyClaimResult {
  if (!isValidClientOperationId(input.operationId)) {
    return { kind: "reject", code: "operation_id_invalid" };
  }
  const idempotencyKey = racsIdempotencyKey(input.operationId);
  const row = database
    .prepare(
      `SELECT id, actor, new_summary, write_status
         FROM config_change_log
        WHERE idempotency_key = ?
        LIMIT 1`
    )
    .get(idempotencyKey) as ConfigAuditRow | undefined;
  if (!row) return { kind: "fresh", idempotencyKey };
  const receipt = parseRacsReceiptFromSummary(parseStoredSummary(row.new_summary));
  if (!receipt) return { kind: "reject", code: "idempotency_receipt_missing" };
  if (receipt.requestDigest !== input.receipt.requestDigest) {
    return { kind: "reject", code: "idempotency_payload_mismatch" };
  }
  if (receipt.submitterAccountUid !== input.receipt.submitterAccountUid) {
    return { kind: "reject", code: "idempotency_actor_mismatch" };
  }
  if (receipt.submitterActorId !== input.receipt.submitterActorId) {
    return { kind: "reject", code: "idempotency_actor_mismatch" };
  }
  return { kind: "replay", auditId: row.id, writeStatus: row.write_status };
}

export async function queryAccessWriteStatus(operationId: string): Promise<AccessWriteStatusQueryResult> {
  if (!isValidClientOperationId(operationId)) {
    return {
      operationId,
      outcome: "unknown",
      disclosure: "operation_id_invalid"
    };
  }
  let database: Database.Database;
  try {
    database = await getAuditDb();
  } catch {
    return {
      operationId,
      outcome: "unknown",
      disclosure: "audit_unreachable"
    };
  }
  const idempotencyKey = racsIdempotencyKey(operationId);
  const row = database
    .prepare(
      `SELECT id, actor, request_id, new_summary, write_status, error_reason
         FROM config_change_log
        WHERE idempotency_key = ?
        LIMIT 1`
    )
    .get(idempotencyKey) as ConfigAuditRow | undefined;
  if (!row) {
    return {
      operationId,
      outcome: "unknown",
      disclosure: "no_durable_record"
    };
  }
  const receipt = parseRacsReceiptFromSummary(parseStoredSummary(row.new_summary));
  const mapped = mapRowToOutcome(row, receipt);
  return { ...mapped, operationId };
}

export function registerAccessWriteStatusRoutes(app: FastifyInstance): void {
  app.get<{ Params: { operationId: string } }>(
    "/api/admin/access-write-status/:operationId",
    async (request: FastifyRequest<{ Params: { operationId: string } }>, reply: FastifyReply) => {
      let actor: TrustedActor;
      try {
        actor = trustedActorFromRequest(request);
      } catch {
        return reply.status(401).send({
          ok: false,
          error: { code: "AUTH_REQUIRED", message: "需要登录" }
        });
      }
      const operationId = request.params.operationId;
      if (!isValidClientOperationId(operationId)) {
        return reply.status(400).send({
          ok: false,
          error: {
            code: "INVALID_OPERATION_ID",
            message: "operationId 必须是客户端 UUID。"
          }
        });
      }
      const idempotencyKey = racsIdempotencyKey(operationId);
      let database: Database.Database;
      try {
        database = await getAuditDb();
      } catch {
        const body = await queryAccessWriteStatus(operationId);
        return reply.send({ ok: true, data: body });
      }
      const row = database
        .prepare(
          `SELECT id, actor, request_id, new_summary, write_status, error_reason
             FROM config_change_log
            WHERE idempotency_key = ?
            LIMIT 1`
        )
        .get(idempotencyKey) as ConfigAuditRow | undefined;
      if (row) {
        const receipt = parseRacsReceiptFromSummary(parseStoredSummary(row.new_summary));
        if (!canViewAccessWriteStatus(actor, receipt, row.actor)) {
          return reply.status(403).send({
            ok: false,
            error: {
              code: "ACCESS_WRITE_STATUS_FORBIDDEN",
              message: "仅原提交账号或所有者可核对本次保存结果。"
            }
          });
        }
      }
      const data = await queryAccessWriteStatus(operationId);
      return reply.send({ ok: true, data });
    }
  );
}
