/**
 * audit-trust-2026-10-19-r1 / T04a — shared audit event classification.
 *
 * Single source of truth for the four-axis status (transport / authorization /
 * execution / usability) plus event_type + transport_sub_type. API, UI, CSV,
 * and v2 manifest all read from this function (contract §2.3 / §4.1).
 *
 * Pre-existing 4-axis failure dimensions from `webui/server/proxy/question-experience.ts`
 * remain intact — we add new dimensions, never replace them.
 */

export const CLASSIFICATION_VERSION = "audit-trust-2026-10-19-r1.v1";
export const DIGEST_VERSION = "audit-trust-2026-10-19-r1.v1";

export type EventType = "tool_call" | "protocol" | "client_observation" | "audit_management";
export type TransportSubType = "handshake" | "probe" | "unknown_method" | "other";
export type TransportStatus = "succeeded" | "failed" | "unknown";
export type AuthorizationStatus = "allowed" | "denied" | "not_evaluated" | "unknown";
export type ExecutionStatus = "succeeded" | "failed" | "not_executed" | "interrupted" | "unknown";
export type UsabilityStatus = "usable" | "empty" | "partial" | "metadata_missing" | "not_applicable" | "unknown";

export type ClassifiedEvent = {
  classificationVersion: string;
  eventType: EventType;
  transportSubType: TransportSubType;
  transportStatus: TransportStatus;
  authorizationStatus: AuthorizationStatus;
  executionStatus: ExecutionStatus;
  usabilityStatus: UsabilityStatus;
};

import {
  MCP_PROTOCOL_METHODS,
  isMcpProtocolMethod
} from "./mcp-request-classification";

const HANDSHAKE_METHODS = new Set<string>([
  MCP_PROTOCOL_METHODS[0], // "tools/list"
  MCP_PROTOCOL_METHODS[1], // "initialize"
  MCP_PROTOCOL_METHODS[2]  // "notifications/initialized"
]);

const PROBE_METHODS = new Set<string>([
  "ping",
  "resources/list",
  "resources/templates/list",
  "notifications/cancelled"
]);

/**
 * Classify one access_log-style event into the four-axis status. Outcome
 * strings mirror the legacy `outcome ∈ {ok, error, denied, budget_stop}` set
 * (kept for v1 back-compat).
 */
export function classifyAccessLogEvent(input: {
  tool: string | null;
  outcome?: string | null;
  decisionReason?: string | null;
  failureDimension?: string | null;
  responseRowCount?: number | null;
  responseBytes?: number | null;
  // Optional new-field hints (T04 contract §2.3): when set, override the
  // inferred value so audit write-back matches what the proxy computed.
  eventTypeHint?: EventType | null;
  authorizationStatusHint?: AuthorizationStatus | null;
}): ClassifiedEvent {
  const tool = input.tool ?? "";
  const outcome = input.outcome ?? null;
  const reason = input.decisionReason ?? null;
  const dim = input.failureDimension ?? null;

  // event_type: tool_call vs protocol. The sub-type always infers from the
  // tool name; only the broad event_type accepts an explicit hint (e.g. a
  // future write-back may pre-classify audit_management rows).
  let eventType: EventType = input.eventTypeHint ?? "tool_call";
  let transportSubType: TransportSubType = "other";
  if (HANDSHAKE_METHODS.has(tool)) {
    transportSubType = "handshake";
    if (!input.eventTypeHint) eventType = "protocol";
  } else if (PROBE_METHODS.has(tool)) {
    transportSubType = "probe";
    if (!input.eventTypeHint) eventType = "protocol";
  } else if (tool === "server/discover" || (tool && tool.startsWith("server/"))) {
    transportSubType = "unknown_method";
    if (!input.eventTypeHint) eventType = "protocol";
  }

  // transport_status: succeeded when outcome=ok; failed when outcome=error/denied;
  // unknown otherwise. Does NOT prove the user received the response — that is
  // a separate axis per contract §2.3.
  let transportStatus: TransportStatus = "unknown";
  if (outcome === "ok" || outcome === "succeeded") transportStatus = "succeeded";
  else if (outcome === "error" || outcome === "denied" || outcome === "budget_stop") transportStatus = "failed";

  // authorization_status: explicit hint wins; otherwise based on outcome/decision_reason.
  let authorizationStatus: AuthorizationStatus = input.authorizationStatusHint ?? "not_evaluated";
  if (!input.authorizationStatusHint) {
    if (outcome === "denied" || reason === "permission_denied" || dim === "权限拒绝") authorizationStatus = "denied";
    else if (outcome === "ok" || outcome === "succeeded") authorizationStatus = "allowed";
    else authorizationStatus = "not_evaluated";
  }

  // execution_status: succeeded only when the server actually executed (outcome=ok
  // AND authorization=allowed AND not interrupted). Otherwise categorized by outcome.
  let executionStatus: ExecutionStatus = "unknown";
  if (outcome === "ok" || outcome === "succeeded") executionStatus = "succeeded";
  else if (outcome === "denied") executionStatus = "not_executed";
  else if (outcome === "budget_stop" || reason === "interrupted") executionStatus = "interrupted";
  else if (outcome === "error") executionStatus = "failed";

  // usability_status: derived from response row count when known. Field ambiguity
  // (scan_missing / scan_failed) is NOT mapped to authorizationStatus=denied;
  // that would over-claim a permission attack (G0-03 caveat).
  let usabilityStatus: UsabilityStatus = "unknown";
  if (reason === "scan_missing" || reason === "scan_failed" || reason === "field_ambiguous") {
    usabilityStatus = "metadata_missing";
  } else if (input.responseRowCount === 0) {
    usabilityStatus = "empty";
  } else if (input.responseRowCount === null || input.responseRowCount === undefined) {
    usabilityStatus = "not_applicable";
  } else if (input.responseRowCount > 0) {
    usabilityStatus = "usable";
  }

  return {
    classificationVersion: CLASSIFICATION_VERSION,
    eventType,
    transportSubType,
    transportStatus,
    authorizationStatus,
    executionStatus,
    usabilityStatus
  };
}

/**
 * Same classification as classifyAccessLogEvent, but for a whole batch — the
 * function is deterministic, so this is just a thin array map; included for
 * reader ergonomics when populating CSV rows from a query.
 */
export function classifyAccessLogBatch<T extends Parameters<typeof classifyAccessLogEvent>[0]>(
  rows: readonly T[]
): ClassifiedEvent[] {
  return rows.map((row) => classifyAccessLogEvent(row));
}