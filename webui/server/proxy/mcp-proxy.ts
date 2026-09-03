import { createHash, randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { identifyRequestDetailed, setSessionClient, type Identity } from "./identity.js";
import { extractRequestClientMeta } from "./request-client-meta.js";
import { writeLog, writeAccessLogSources, writeConversationTurn, purgeExpiredConversationTurns, writeAuthFailureLog, type AccessLogSourceRecord } from "./audit.js";
import { allowedToolNames, check as aclCheck, effectivePermissions, extractTables, extractSourceRefs, resolveSourceRefsForTables, kxCatalog, lucyCatalog, permissionSnapshot, type SourceRef } from "./acl.js";
import { canAccessWikiKey, canonicalWikiKey, searchAccessibleWikiPages } from "./wiki-acl.js";
import { loadAllSkills, getSkillByUri, getSkillByName } from "../skills/loader.js";
import { canAccessSkill, filterAccessibleSkills } from "./skill-acl.js";
import { resolveProjectRoot } from "../project.js";
import {
  recordMcpToolsCall,
  purgeTraceEvidence,
  TRACE_RETENTION_DAYS,
  type PolicyDecisionMetadata,
  type LucySpanStatus
} from "../trace/evidence.js";
import { getAuditDb as getAdminAuditDb } from "../admin/audit.js";
import { extractSqlFromToolResult, mergeIncludeSql } from "../audit/query-artifact-capture.js";
import { assertLicenseAllowsMcp, loadLicenseSnapshot } from "../license/entitlement.js";
import { canonicalizeLucyQueryArgs } from "./lucy-query-normalization.js";

const KTX_HOST = process.env.LUCY_PROXY_UPSTREAM_HOST ?? "127.0.0.1";
const KTX_PORT = Number(process.env.LUCY_PROXY_UPSTREAM_PORT ?? 7878);
// V5 multi-upstream: lucy-skills is a parallel MCP server (skills catalog + SKILL.md content).
// Routed under `/mcp/skills` to keep the existing `/mcp` KTX path unchanged.
const LUCY_SKILLS_HOST = process.env.LUCY_PROXY_LUCY_SKILLS_HOST ?? "127.0.0.1";
const LUCY_SKILLS_PORT = Number(process.env.LUCY_PROXY_LUCY_SKILLS_PORT ?? 7881);
const LUCY_SKILLS_PATH_PREFIX = "/mcp/skills";
const MAX_BODY_BYTES = Number(process.env.LUCY_PROXY_MAX_BODY_BYTES ?? 1_048_576);
const UPSTREAM_TIMEOUT_MS = Number(process.env.LUCY_PROXY_UPSTREAM_TIMEOUT_MS ?? 30_000);
const SENSITIVE_ARG_KEY_RE = /(?:sql|query|password|passwd|pwd|token|secret|api[-_]?key|authorization|credential)/i;
const QUERY_KEY_RE = /^(?:sql|query)$/i;
const QUERY_TABLE_RE = /\b(?:from|join|into|update|table)\s+[`"]?([a-zA-Z_][\w]*(?:\.[a-zA-Z_][\w]*){0,2})[`"]?/gi;
const LUCY_QUERY_DEFAULT_LIMIT = Number(process.env.LUCY_QUERY_DEFAULT_LIMIT ?? 100);
const LUCY_QUERY_MAX_LIMIT = Number(process.env.LUCY_QUERY_MAX_LIMIT ?? 1000);
const LUCY_QUERY_MAX_INFLIGHT = Number(process.env.LUCY_QUERY_MAX_INFLIGHT ?? 4);

function getInternalToken(): string {
  return process.env.KTX_INTERNAL_TOKEN ?? "";
}

// ─── Phase 3: near-neighbor correlation for lucy_begin_question (spec §8.2) ──
// In-memory only (not persisted) — mirrors identity.ts's sessionClients pattern.
const reportedTurns = new Map<string, { turnId: string; createdAt: number }>();
const lucyQueryInflight = new Map<string, number>();

function reportedTurnKey(identity: Identity): string {
  return `${identity.userId}:${identity.tokenHashPrefix}`;
}

function reportedTurnWindowMs(): number {
  return Number(process.env.LUCY_REPORTED_TURN_ATTACH_WINDOW_MS ?? 600_000);
}

function purgeExpiredReportedTurns(now = Date.now()): void {
  const windowMs = reportedTurnWindowMs();
  for (const [key, value] of reportedTurns.entries()) {
    if (now - value.createdAt > windowMs) reportedTurns.delete(key);
  }
}

function recordReportedTurn(identity: Identity, turnId: string): void {
  const now = Date.now();
  purgeExpiredReportedTurns(now);
  reportedTurns.set(reportedTurnKey(identity), { turnId, createdAt: now });
}

function queryConcurrencyKey(identity: Identity): string {
  return `${identity.userId}:${identity.tokenHashPrefix}`;
}

function queryConcurrencyLimit(): number {
  if (!Number.isFinite(LUCY_QUERY_MAX_INFLIGHT)) return 4;
  return Math.max(1, Math.floor(LUCY_QUERY_MAX_INFLIGHT));
}

function acquireLucyQuerySlot(identity: Identity): { allowed: true; release: () => void; active: number; max: number } | { allowed: false; active: number; max: number } {
  const key = queryConcurrencyKey(identity);
  const active = lucyQueryInflight.get(key) ?? 0;
  const max = queryConcurrencyLimit();
  if (active >= max) return { allowed: false, active, max };
  lucyQueryInflight.set(key, active + 1);
  let released = false;
  return {
    allowed: true,
    active: active + 1,
    max,
    release: () => {
      if (released) return;
      released = true;
      const current = lucyQueryInflight.get(key) ?? 0;
      if (current <= 1) lucyQueryInflight.delete(key);
      else lucyQueryInflight.set(key, current - 1);
    }
  };
}

function releaseOnResponseEnd(res: ServerResponse, release: () => void): void {
  let released = false;
  const once = () => {
    if (released) return;
    released = true;
    release();
  };
  res.once("finish", once);
  res.once("close", once);
}

function matchReportedTurn(identity: Identity): string | undefined {
  const now = Date.now();
  purgeExpiredReportedTurns(now);
  return reportedTurns.get(reportedTurnKey(identity))?.turnId;
}

class BodyTooLargeError extends Error {
  statusCode = 413;
  constructor() {
    super("Request body too large");
  }
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let rejected = false;
    req.on("data", (chunk: Buffer) => {
      if (rejected) return;
      total += chunk.byteLength;
      if (total > MAX_BODY_BYTES) {
        rejected = true;
        reject(new BodyTooLargeError());
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!rejected) resolve(Buffer.concat(chunks));
    });
    req.on("error", reject);
  });
}

function forwardToKtx(
  method: string,
  url: string,
  incomingHeaders: IncomingMessage["headers"],
  body?: Buffer
): Promise<IncomingMessage> {
  return forwardToUpstream({ host: KTX_HOST, port: KTX_PORT }, method, url, incomingHeaders, body, "KTX");
}

function forwardToUpstream(
  target: { host: string; port: number },
  method: string,
  url: string,
  incomingHeaders: IncomingMessage["headers"],
  body: Buffer | undefined,
  label: string
): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string | string[]> = {};
    for (const [k, v] of Object.entries(incomingHeaders)) {
      if (v === undefined) continue;
      const lower = k.toLowerCase();
      if (!["content-type", "mcp-session-id", "mcp-protocol-version"].includes(lower)) continue;
      headers[k] = v;
    }
    headers["accept"] = "application/json, text/event-stream";
    const internalToken = getInternalToken();
    if (internalToken) headers["authorization"] = `Bearer ${internalToken}`;
    if (body) headers["content-length"] = String(body.byteLength);

    const upstream = httpRequest(
      { hostname: target.host, port: target.port, path: url, method, headers },
      resolve
    );
    upstream.setTimeout(UPSTREAM_TIMEOUT_MS, () => {
      upstream.destroy(new Error(`${label} upstream timeout after ${UPSTREAM_TIMEOUT_MS}ms`));
    });
    upstream.on("error", reject);
    if (body) upstream.end(body);
    else upstream.end();
  });
}

function toSourceRecords(refs: SourceRef[]): AccessLogSourceRecord[] {
  return refs.map((ref) => ({
    connectionId: ref.connectionId,
    schemaName: ref.schema,
    sourceName: ref.sourceName,
    physicalTable: ref.physicalTable,
    extractionMethod: ref.extractionMethod,
    confidence: ref.confidence
  }));
}

function recordAudit(entry: Parameters<typeof writeLog>[0], sources?: SourceRef[]): void {
  writeLog(entry)
    .then((accessLogId) => {
      if (sources && sources.length > 0) {
        return writeAccessLogSources(accessLogId, entry.ts, entry.userId, entry.tool, toSourceRecords(sources));
      }
    })
    .catch((err) => {
      console.error("[lucy-proxy] failed to write audit log", err);
    });
}

/**
 * 202608-01 Trace / Evidence Kernel — best-effort write of `mcp_tools_call`
 * + `policy_decision` events. Errors are swallowed so the MCP request keeps
 * flowing; the verifier counts dropped writes separately. We do NOT touch
 * sensitive metadata: only the snapshot hash, the tool name, and a redacted
 * summary are stored.
 */
function recordMcpTrace(input: {
  traceId: string;
  spanId: string;
  identity: Identity;
  toolName: string;
  status: LucySpanStatus;
  startedAt: string;
  endedAt: string;
  policyDecision: PolicyDecisionMetadata;
  turnId?: string | null;
  sessionId?: string | null;
  requestId?: string | null;
  argsSummary?: Record<string, unknown>;
  resultSnapshot?: {
    rowCount?: number | null;
    columnCount?: number | null;
    responseBytes?: number | null;
    truncated?: boolean | null;
  } | null;
  sourceRefs?: SourceRef[] | null;
}): void {
  getAdminAuditDb()
    .then((db) => {
      try {
        recordMcpToolsCall(db, {
          traceId: input.traceId,
          spanId: input.spanId,
          actorId: input.identity.userId,
          toolName: input.toolName,
          startedAt: input.startedAt,
          endedAt: input.endedAt,
          status: input.status,
          sessionId: input.sessionId ?? null,
          turnId: input.turnId ?? null,
          requestId: input.requestId ?? null,
          policyDecision: input.policyDecision,
          metadata: input.argsSummary,
          resultSnapshot: input.resultSnapshot ?? null,
          sourceRefs: input.sourceRefs ?? null
        });
        // Spec 62 P0 Closure: sampled lazy purge — never blocks the MCP response.
        const sampleRate = Number(process.env.LUCY_TRACE_PURGE_SAMPLE_RATE ?? 0.01);
        if (Math.random() < sampleRate) {
          try {
            purgeTraceEvidence(db, { retentionDays: TRACE_RETENTION_DAYS });
          } catch (purgeErr) {
            console.error("[lucy-proxy] lazy trace purge failed", purgeErr);
          }
        }
      } catch (err) {
        console.error("[lucy-proxy] recordMcpToolsCall threw", err);
      }
    })
    .catch((err) => {
      console.error("[lucy-proxy] failed to write trace event", err);
    });
}

async function buildTracePolicyDecision(
  identity: Identity,
  toolName: string,
  allowed: boolean,
  reason: string | undefined,
  matchedRule: string | undefined
): Promise<PolicyDecisionMetadata> {
  const snapshot = await permissionSnapshot(identity).catch(() => undefined);
  return {
    allowed,
    reason,
    toolName,
    matchedRule,
    source: "access_policy",
    permissionSnapshotHash: snapshot?.hash
  };
}

function normalizedTraceRequestId(requestId: string | number): string | null {
  return requestId === "" ? null : String(requestId);
}

function toolTraceSpanId(toolName: string, traceId: string): string {
  return `mcp_tools_call:${toolName}:${traceId}`;
}

function resultSnapshotFromAuditMeta(
  meta: Partial<Parameters<typeof writeLog>[0]> | undefined
): {
  rowCount?: number | null;
  columnCount?: number | null;
  responseBytes?: number | null;
  truncated?: boolean | null;
} | null {
  if (!meta) return null;
  const rowCount = typeof meta.responseRowCount === "number" ? meta.responseRowCount : null;
  const columnCount = typeof meta.responseColumnCount === "number" ? meta.responseColumnCount : null;
  if (rowCount === null && columnCount === null) return null;
  return {
    rowCount,
    columnCount,
    responseBytes: typeof meta.responseBytes === "number" ? meta.responseBytes : null,
    truncated: meta.responseTruncated === true
  };
}

function recordMcpTraceForTool(input: {
  traceId: string;
  identity: Identity;
  toolName: string;
  status: LucySpanStatus;
  startedAt: string;
  endedAt?: string;
  turnId?: string | null;
  sessionId?: string | null;
  requestId: string | number;
  argsSummary?: Record<string, unknown>;
  allowed: boolean;
  reason?: string;
  matchedRule?: string;
  policySource?: PolicyDecisionMetadata["source"];
  resultSnapshot?: {
    rowCount?: number | null;
    columnCount?: number | null;
    responseBytes?: number | null;
    truncated?: boolean | null;
  } | null;
  sourceRefs?: SourceRef[] | null;
}): void {
  buildTracePolicyDecision(input.identity, input.toolName, input.allowed, input.reason, input.matchedRule)
    .then((policyDecision) => {
      recordMcpTrace({
        traceId: input.traceId,
        spanId: toolTraceSpanId(input.toolName, input.traceId),
        identity: input.identity,
        toolName: input.toolName,
        status: input.status,
        startedAt: input.startedAt,
        endedAt: input.endedAt ?? new Date().toISOString(),
        turnId: input.turnId ?? null,
        sessionId: input.sessionId ?? null,
        requestId: normalizedTraceRequestId(input.requestId),
        argsSummary: input.argsSummary,
        resultSnapshot: input.resultSnapshot ?? null,
        sourceRefs: input.sourceRefs ?? null,
        policyDecision: {
          ...policyDecision,
          source: input.policySource ?? policyDecision.source
        }
      });
    })
    .catch((err) => {
      console.error("[lucy-proxy] failed to build trace policy decision", err);
    });
}

async function auditMeta(identity: Identity | null | undefined, decisionReason: string): Promise<Partial<Parameters<typeof writeLog>[0]>> {
  if (!identity) return { decisionReason };
  const snapshot = await permissionSnapshot(identity).catch(() => undefined);
  const tokenMeta = {
    tokenLabel: identity.tokenLabel,
    tokenHashPrefix: identity.tokenHashPrefix,
    clientVersion: identity.clientVersion,
    decisionReason
  };
  if (!snapshot) return tokenMeta;
  return {
    ...tokenMeta,
    roleIds: snapshot.roleIds,
    permissionSnapshotHash: snapshot.hash,
    effectiveTablesCount: snapshot.effectiveTablesCount,
    permissionSnapshot: {
      hash: snapshot.hash,
      rolesJson: snapshot.rolesJson,
      resolvedJson: snapshot.resolvedJson
    }
  };
}

function summarizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(args)
      .filter(([k]) => !SENSITIVE_ARG_KEY_RE.test(k))
      .slice(0, 8)
  );
}

function correlationMeta(headers: IncomingMessage["headers"]): Partial<Parameters<typeof writeLog>[0]> {
  return {
    lucySessionId: normalizeHeader(headers["x-lucy-session-id"]),
    lucyTurnId: normalizeHeader(headers["x-lucy-turn-id"]),
    lucyPlatform: normalizeHeader(headers["x-lucy-platform"])
  };
}

function recordAuthFailure(
  req: IncomingMessage,
  result: Awaited<ReturnType<typeof identifyRequestDetailed>>
): void {
  if (result.ok) return;
  const network = extractRequestClientMeta(req);
  void writeAuthFailureLog({
    ts: new Date().toISOString(),
    reason: result.reason,
    clientIp: network.clientIp,
    userAgent: network.userAgent,
    tokenHashPrefix: result.tokenHashPrefix,
    userId: result.userId,
    tokenLabel: result.tokenLabel
  }).catch((error) => {
    console.error("[lucy-proxy] failed to write auth_failure_log", error);
  });
}

function findRawQuery(value: unknown, depth = 0): string | undefined {
  if (!value || depth > 4) return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findRawQuery(item, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  if (typeof value !== "object") return undefined;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (QUERY_KEY_RE.test(key) && typeof nested === "string") return nested;
    const found = findRawQuery(nested, depth + 1);
    if (found) return found;
  }
  return undefined;
}

function redactQueryPreview(query: string): string {
  return query
    .replace(/'([^']|'')*'/g, "'?'")
    .replace(/"([^"]|"")*"/g, '"?"')
    .replace(/\b(password|passwd|pwd|token|secret|api[-_]?key|authorization|credential)\b\s*[:=]\s*([^,\s;]+)/gi, "$1=[REDACTED]")
    .replace(/\b\d+(?:\.\d+)?\b/g, "?")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

const QUESTION_SENSITIVE_PAIR_RE = /\b(password|passwd|pwd|token|secret|api[-_]?key|authorization|credential)\b\s*[:=]\s*([^,\s;]+)/gi;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const CN_ID_CARD_RE = /\b\d{17}[\dXx]\b/g;
const CN_MOBILE_RE = /\b1[3-9]\d{9}\b/g;

// Free-text redaction for lucy_begin_question's optional `question` field (spec §10).
// Distinct from redactQueryPreview (SQL-oriented) and admin/audit.ts's redactSensitive
// (JSON-key-oriented) — natural language needs pattern-based redaction instead.
function redactQuestionText(text: string): string {
  return text
    .replace(QUESTION_SENSITIVE_PAIR_RE, "$1=[REDACTED]")
    .replace(EMAIL_RE, "[REDACTED]")
    .replace(CN_ID_CARD_RE, "[REDACTED]")
    .replace(CN_MOBILE_RE, "[REDACTED]");
}

function queryOperation(query: string): string {
  const match = query.trim().match(/^([a-z]+)/i);
  const op = match?.[1]?.toLowerCase();
  if (!op) return "unknown";
  if (["select", "show", "describe", "with"].includes(op)) return op;
  return "unknown";
}

function extractQueryTables(query: string): string[] {
  const tables = new Set<string>();
  for (const match of query.matchAll(QUERY_TABLE_RE)) {
    if (match[1]) tables.add(match[1]);
  }
  return [...tables];
}

function queryAuditMeta(toolArgs: unknown): Partial<Parameters<typeof writeLog>[0]> & { queryTables?: string[] } {
  const rawQuery = findRawQuery(toolArgs);
  if (!rawQuery) return {};
  return {
    queryHash: createHash("sha256").update(rawQuery).digest("hex"),
    queryLength: rawQuery.length,
    queryOperation: queryOperation(rawQuery),
    queryPreview: redactQueryPreview(rawQuery),
    queryTables: extractQueryTables(rawQuery)
  };
}

function findBooleanFlag(value: unknown, keyName: string, depth = 0): boolean | undefined {
  if (!value || depth > 5) return undefined;
  if (typeof value === "string" && value.trim().startsWith("{")) {
    try {
      return findBooleanFlag(JSON.parse(value), keyName, depth + 1);
    } catch {
      return undefined;
    }
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findBooleanFlag(item, keyName, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (typeof value !== "object") return undefined;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (key === keyName && typeof nested === "boolean") return nested;
    const found = findBooleanFlag(nested, keyName, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

function inspectRowsAndColumns(value: unknown, depth = 0): { rows?: number; columns?: number } {
  if (!value || depth > 5) return {};
  if (Array.isArray(value)) {
    const nested = value.map((item) => inspectRowsAndColumns(item, depth + 1));
    return nested.reduce((best, item) => ({
      rows: best.rows ?? item.rows,
      columns: best.columns ?? item.columns
    }), {} as { rows?: number; columns?: number });
  }
  if (typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  const rows = Array.isArray(record.rows) ? record.rows.length : typeof record.totalRows === "number" ? record.totalRows : undefined;
  const columns = Array.isArray(record.columns) ? record.columns.length : Array.isArray(record.headers) ? record.headers.length : undefined;
  if (rows !== undefined || columns !== undefined) return { rows, columns };
  for (const nested of Object.values(record)) {
    if (typeof nested === "string" && nested.trim().startsWith("{")) {
      try {
        const inspected = inspectRowsAndColumns(JSON.parse(nested), depth + 1);
        if (inspected.rows !== undefined || inspected.columns !== undefined) return inspected;
      } catch {
        // best-effort only
      }
    }
    const inspected = inspectRowsAndColumns(nested, depth + 1);
    if (inspected.rows !== undefined || inspected.columns !== undefined) return inspected;
  }
  return {};
}

function responseAuditMeta(body: Buffer, contentType: string | string[] | undefined): Partial<Parameters<typeof writeLog>[0]> {
  const meta: Partial<Parameters<typeof writeLog>[0]> = { responseBytes: body.byteLength };
  const type = Array.isArray(contentType) ? contentType.join(",") : String(contentType ?? "");
  if (!type.includes("application/json")) return meta;
  try {
    const parsed = JSON.parse(body.toString());
    const inspected = inspectRowsAndColumns(parsed);
    meta.responseRowCount = inspected.rows;
    meta.responseColumnCount = inspected.columns;
    meta.responseTruncated = findBooleanFlag(parsed, "truncated");
  } catch {
    // byte size is still useful even when JSON parsing fails.
  }
  return meta;
}

function pipeResponse(upstream: IncomingMessage, res: ServerResponse): void {
  const headers: Record<string, string | string[] | number> = {};
  for (const [k, v] of Object.entries(upstream.headers)) {
    if (v !== undefined) headers[k] = v;
  }
  res.writeHead(upstream.statusCode ?? 200, headers);
  upstream.pipe(res);
}

function kxCatalogTool() {
  return {
    name: "kx_catalog",
    description: "Compatibility catalog. Lists only the sources available to this agent. Prefer lucy_catalog for new clients.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  };
}

function lucyCatalogTool() {
  return {
    name: "lucy_catalog",
    description: "List only the connections and semantic sources available to this agent, with safe query examples for the visible domain. Call this before choosing a database or source.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  };
}

function lucyReadSourceTool() {
  return {
    name: "lucy_read_source",
    description: "Read one authorized semantic source through Lucy. This is the stable Lucy wrapper for sl_read_source and is filtered by role/source policy.",
    inputSchema: {
      type: "object",
      properties: {
        connectionId: { type: "string" },
        sourceName: { type: "string" }
      },
      required: ["connectionId", "sourceName"],
      additionalProperties: true
    }
  };
}

function semanticQueryInputProperties() {
  const semanticFieldRef = {
    type: "object",
    properties: {
      field: { type: "string", minLength: 1 },
      granularity: { type: "string" },
      name: { type: "string" }
    },
    required: ["field"],
    additionalProperties: true
  };
  const orderByRef = {
    type: "object",
    properties: {
      field: { type: "string", minLength: 1 },
      direction: { type: "string", enum: ["asc", "desc"] }
    },
    required: ["field"],
    additionalProperties: true
  };
  const measureRef = {
    anyOf: [
      { type: "string", minLength: 1 },
      {
        type: "object",
        properties: {
          expr: { type: "string", minLength: 1 },
          name: { type: "string", minLength: 1 }
        },
        required: ["expr"],
        additionalProperties: true
      }
    ]
  };
  const filterRef = {
    anyOf: [
      { type: "string", minLength: 1 },
      {
        type: "object",
        properties: {
          field: { type: "string", minLength: 1 },
          op: { type: "string" },
          value: {},
          values: { type: "array" }
        },
        required: ["field"],
        additionalProperties: true
      }
    ]
  };

  return {
    connectionId: { type: "string" },
    measures: { type: "array", items: measureRef },
    dimensions: { type: "array", items: semanticFieldRef },
    filters: { anyOf: [filterRef, { type: "array", items: filterRef }] },
    segments: { type: "array", items: { type: "string", minLength: 1 } },
    order_by: { type: "array", items: orderByRef },
    orderBy: { type: "array", items: orderByRef },
    limit: { type: "number", minimum: 1, maximum: LUCY_QUERY_MAX_LIMIT }
  };
}

function lucyQueryTool() {
  return {
    name: "lucy_query",
    description: "Run an authorized semantic query through Lucy guardrails. This is the primary tool for factual data retrieval. Use source-qualified measures, dimensions, filters, segments, and order fields. dimensions/order_by must be arrays of objects, never strings.",
    inputSchema: {
      type: "object",
      properties: semanticQueryInputProperties(),
      required: ["connectionId"],
      additionalProperties: true
    }
  };
}

function lucyExplainQueryTool() {
  return {
    name: "lucy_explain_query",
    description: "Diagnostic tool: explain how Lucy would authorize and guardrail a semantic query without executing it. Use after a query is denied or when debugging permissions/guardrails; do not use as a routine dry-run before simple factual queries. dimensions/order_by must be arrays of objects, never strings.",
    inputSchema: {
      type: "object",
      properties: semanticQueryInputProperties(),
      required: ["connectionId"],
      additionalProperties: true
    }
  };
}

function lucyFreshnessTool() {
  return {
    name: "lucy_freshness",
    description: "Return freshness metadata for one authorized source. R1 reports semantic-layer metadata freshness and leaves physical data freshness explicit when unavailable.",
    inputSchema: {
      type: "object",
      properties: {
        connectionId: { type: "string" },
        sourceName: { type: "string" }
      },
      required: ["connectionId", "sourceName"],
      additionalProperties: false
    }
  };
}

function lucyBeginQuestionTool() {
  return {
    name: "lucy_begin_question",
    description:
      "Optional but recommended. Call once at the start of each new user business question to help Lucy audit. Prefer passing the user's original wording in `question` when available; always provide `intentSummary`. Skipping this tool never blocks catalog or query tools. Do not call for protocol checks or tool discovery only.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", maxLength: 2000 },
        intentSummary: { type: "string", maxLength: 500 },
        entities: {
          type: "array",
          items: { type: "string" },
          maxItems: 20
        }
      },
      required: ["intentSummary"],
      additionalProperties: false
    }
  };
}

function connectionListTool() {
  return {
    name: "connection_list",
    description: "List only the database connections available to this agent. This proxy-local response is already filtered by effective permissions.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  };
}

function wikiSearchTool() {
  return {
    name: "wiki_search",
    description: "Search only wiki pages this agent is authorized to read. Returned keys are canonical and can be passed directly to wiki_read.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        q: { type: "string" },
        connectionId: { type: "string" },
        limit: { type: "number", minimum: 1, maximum: 20 }
      },
      additionalProperties: true
    }
  };
}

function wikiReadTool() {
  return {
    name: "wiki_read",
    description: "Read an authorized wiki page by canonical key. Unauthorized pages return a generic access denied response.",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string" }
      },
      required: ["key"],
      additionalProperties: true
    }
  };
}

function lucySkillSearchTool() {
  return {
    name: "lucy_skill_search",
    description: "Search available governed Lucy domain skills and SOPs by keyword or business intent.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search keyword or business question" },
        domain: { type: "string", description: "Optional domain filter (e.g. superstore, kx_financial)" }
      },
      required: ["query"],
      additionalProperties: true
    }
  };
}

function lucySkillReadTool() {
  return {
    name: "lucy_skill_read",
    description: "Read the full execution SOP and guidelines of a governed Lucy domain skill.",
    inputSchema: {
      type: "object",
      properties: {
        skill_name: { type: "string", description: "The name or URI of the skill to read (e.g. superstore-profit-breakdown)" }
      },
      required: ["skill_name"],
      additionalProperties: true
    }
  };
}

// Local tools the proxy serves itself (never forwarded to KTX). Each is only injected
// into tools/list when visibleTools allows it — same explicit allow-list gate as any
// other tool (spec 08 §15 decision 2: no derived/bypass condition).
function localToolBuilders(): Array<{ name: string; build: () => Record<string, unknown> }> {
  const builders: Array<{ name: string; build: () => Record<string, unknown> }> = [
    { name: "connection_list", build: connectionListTool },
    { name: "lucy_catalog", build: lucyCatalogTool },
    { name: "lucy_read_source", build: lucyReadSourceTool },
    { name: "lucy_query", build: lucyQueryTool },
    { name: "lucy_explain_query", build: lucyExplainQueryTool },
    { name: "lucy_freshness", build: lucyFreshnessTool },
    { name: "kx_catalog", build: kxCatalogTool },
    { name: "wiki_search", build: wikiSearchTool },
    { name: "wiki_read", build: wikiReadTool },
    { name: "lucy_skill_search", build: lucySkillSearchTool },
    { name: "lucy_skill_read", build: lucySkillReadTool }
  ];
  if (process.env.LUCY_ENABLE_QUESTION_TOOL !== "false") {
    builders.push({ name: "lucy_begin_question", build: lucyBeginQuestionTool });
  }
  return builders;
}

function numericLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return LUCY_QUERY_DEFAULT_LIMIT;
  return Math.min(LUCY_QUERY_MAX_LIMIT, Math.max(1, Math.floor(value)));
}

function rewriteToolCall(parsed: Record<string, unknown>, upstreamTool: string, args: Record<string, unknown>): Buffer {
  const params = parsed.params && typeof parsed.params === "object" && !Array.isArray(parsed.params)
    ? { ...(parsed.params as Record<string, unknown>) }
    : {};
  return Buffer.from(JSON.stringify({
    ...parsed,
    params: {
      ...params,
      name: upstreamTool,
      arguments: args
    }
  }));
}

function lucyReadSourceUpstreamArgs(args: unknown): Record<string, unknown> {
  const record = args && typeof args === "object" && !Array.isArray(args) ? args as Record<string, unknown> : {};
  return {
    ...record,
    connectionId: record.connectionId ?? record.connection_id ?? record.connection,
    sourceName: record.sourceName ?? record.source_name ?? record.source ?? record.table
  };
}

function isSafeSemanticFieldRef(value: unknown): value is string {
  if (!hasNonEmptyStringValue(value)) return false;
  return !/[^\p{L}\p{N}_.$]/u.test(String(value).trim());
}

function sqlLiteral(value: unknown): string {
  if (value === null) return "NULL";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return `'${String(value).replaceAll("'", "''")}'`;
}

type LucyFilterOp = "=" | "!=" | ">" | ">=" | "<" | "<=" | "in" | "contains" | "like" | "starts_with" | "ends_with";

function normalizeLucyFilterOp(op: unknown): LucyFilterOp | undefined {
  const raw = op === undefined ? "=" : String(op).trim().toLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
  switch (raw) {
    case "=":
    case "==":
    case "eq":
    case "equals":
    case "equal":
    case "is":
      return "=";
    case "!=":
    case "<>":
    case "ne":
    case "neq":
    case "not_equal":
    case "not_equals":
    case "is_not":
      return "!=";
    case ">":
    case "gt":
      return ">";
    case ">=":
    case "gte":
    case "ge":
      return ">=";
    case "<":
    case "lt":
      return "<";
    case "<=":
    case "lte":
    case "le":
      return "<=";
    case "in":
      return "in";
    case "contains":
    case "include":
    case "includes":
    case "match":
    case "matches":
      return "contains";
    case "like":
      return "like";
    case "starts_with":
    case "startswith":
    case "prefix":
      return "starts_with";
    case "ends_with":
    case "endswith":
    case "suffix":
      return "ends_with";
    default:
      return undefined;
  }
}

function sqlLikeLiteral(value: unknown, mode: "contains" | "like" | "starts_with" | "ends_with"): string {
  const text = String(value).replaceAll("'", "''");
  if (mode === "contains") return `'%${text}%'`;
  if (mode === "starts_with") return `'${text}%'`;
  if (mode === "ends_with") return `'%${text}'`;
  return `'${text}'`;
}

function normalizeLucyFilterForUpstream(item: unknown): unknown {
  if (hasNonEmptyStringValue(item)) return item;
  if (!isPlainRecord(item) || !isSafeSemanticFieldRef(item.field)) return item;

  const field = String(item.field).trim();
  const op = normalizeLucyFilterOp(item.op);
  if (!op) return item;
  if (op === "in") {
    const rawValues = Array.isArray(item.values) ? item.values : Array.isArray(item.value) ? item.value : [];
    return `${field} IN (${rawValues.map(sqlLiteral).join(", ")})`;
  }
  if (op === "contains" || op === "like" || op === "starts_with" || op === "ends_with") {
    const value = Object.prototype.hasOwnProperty.call(item, "value") ? item.value : Array.isArray(item.values) ? item.values[0] : "";
    return `${field} LIKE ${sqlLikeLiteral(value, op)}`;
  }
  const value = Object.prototype.hasOwnProperty.call(item, "value") ? item.value : Array.isArray(item.values) ? item.values[0] : "";
  return `${field} ${op} ${sqlLiteral(value)}`;
}

function normalizeLucyFiltersForUpstream(value: unknown): unknown {
  if (value === undefined) return undefined;
  const items = Array.isArray(value) ? value : [value];
  return items.map(normalizeLucyFilterForUpstream);
}

function lucyQueryUpstreamArgs(args: unknown): Record<string, unknown> {
  const record = args && typeof args === "object" && !Array.isArray(args) ? args as Record<string, unknown> : {};
  const normalized = {
    ...record,
    filters: normalizeLucyFiltersForUpstream(record.filters),
    limit: numericLimit(record.limit)
  };
  // Spec 125: always ask upstream for compiled SQL so hot store can persist generated_sql.
  return mergeIncludeSql(normalized);
}

function generatedSqlAuditFields(
  toolName: string,
  toolResultBody: unknown
): Partial<Parameters<typeof writeLog>[0]> {
  if (toolName !== "lucy_query") return {};
  const sql = extractSqlFromToolResult(toolResultBody);
  if (!sql?.trim()) return {};
  return {
    generatedSql: sql,
    queryHash: createHash("sha256").update(sql).digest("hex"),
    queryLength: sql.length,
    queryOperation: queryOperation(sql)
  };
}

function hasNonEmptyStringField(record: Record<string, unknown>, fields: string[]): boolean {
  return fields.some((field) => typeof record[field] === "string" && String(record[field]).trim().length > 0);
}

function hasNonEmptyArrayField(record: Record<string, unknown>, fields: string[]): boolean {
  return fields.some((field) => Array.isArray(record[field]) && (record[field] as unknown[]).length > 0);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasNonEmptyStringValue(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function invalidObjectArrayFieldReason(toolName: string, record: Record<string, unknown>, field: string, reasonField = field): string | undefined {
  const value = record[field];
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return `invalid_arguments:${toolName}:${reasonField}_must_be_array`;
  for (const item of value) {
    if (!isPlainRecord(item)) return `invalid_arguments:${toolName}:${reasonField}_items_must_be_objects`;
    if (!hasNonEmptyStringValue(item.field)) return `invalid_arguments:${toolName}:${reasonField}_field_required`;
  }
  return undefined;
}

function invalidOrderByFieldReason(
  toolName: string,
  record: Record<string, unknown>,
  field: "order_by" | "orderBy"
): string | undefined {
  const invalidShape = invalidObjectArrayFieldReason(toolName, record, field, "order_by");
  if (invalidShape) return invalidShape;

  const value = record[field];
  if (value === undefined) return undefined;
  for (const item of value as Array<Record<string, unknown>>) {
    if (!isSafeSemanticFieldRef(item.field)) {
      return `invalid_arguments:${toolName}:order_by_field_unsafe`;
    }
    if (
      item.direction !== undefined
      && (typeof item.direction !== "string" || !["asc", "desc"].includes(item.direction))
    ) {
      return `invalid_arguments:${toolName}:order_by_direction_unsupported`;
    }
  }
  return undefined;
}

function invalidStringArrayFieldReason(toolName: string, record: Record<string, unknown>, field: string): string | undefined {
  const value = record[field];
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return `invalid_arguments:${toolName}:${field}_must_be_array`;
  if (value.some((item) => !hasNonEmptyStringValue(item))) {
    return `invalid_arguments:${toolName}:${field}_items_must_be_non_empty_strings`;
  }
  return undefined;
}

function invalidFilterFieldReason(toolName: string, record: Record<string, unknown>): string | undefined {
  const value = record.filters;
  if (value === undefined) return undefined;
  const items = Array.isArray(value) ? value : [value];
  for (const item of items) {
    if (hasNonEmptyStringValue(item)) continue;
    if (isPlainRecord(item)) {
      if (!hasNonEmptyStringValue(item.field)) return `invalid_arguments:${toolName}:filters_field_required`;
      if (!isSafeSemanticFieldRef(item.field)) return `invalid_arguments:${toolName}:filters_field_unsafe`;
      const op = normalizeLucyFilterOp(item.op);
      if (!op) {
        return `invalid_arguments:${toolName}:filters_op_unsupported`;
      }
      if (op === "in") {
        const inValues = Array.isArray(item.values) ? item.values : Array.isArray(item.value) ? item.value : [];
        if (inValues.length === 0) return `invalid_arguments:${toolName}:filters_values_required`;
      }
      if (op !== "in" && !Object.prototype.hasOwnProperty.call(item, "value") && !Object.prototype.hasOwnProperty.call(item, "values")) {
        return `invalid_arguments:${toolName}:filters_value_required`;
      }
      continue;
    }
    return `invalid_arguments:${toolName}:filters_items_must_be_strings_or_objects`;
  }
  return undefined;
}

function invalidMeasuresFieldReason(toolName: string, record: Record<string, unknown>): string | undefined {
  const value = record.measures;
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return `invalid_arguments:${toolName}:measures_must_be_array`;
  for (const item of value) {
    if (hasNonEmptyStringValue(item)) continue;
    if (isPlainRecord(item) && hasNonEmptyStringValue(item.expr)) continue;
    return `invalid_arguments:${toolName}:measures_items_must_be_strings_or_objects`;
  }
  return undefined;
}

function invalidLucyQueryShapeReason(toolName: string, record: Record<string, unknown>): string | undefined {
  return invalidMeasuresFieldReason(toolName, record)
    ?? invalidObjectArrayFieldReason(toolName, record, "dimensions")
    ?? invalidFilterFieldReason(toolName, record)
    ?? invalidStringArrayFieldReason(toolName, record, "segments")
    ?? invalidOrderByFieldReason(toolName, record, "order_by")
    ?? invalidOrderByFieldReason(toolName, record, "orderBy");
}

function validateLucyToolArgs(toolName: string, args: unknown): string | undefined {
  if (
    !toolName.startsWith("lucy_") ||
    toolName === "lucy_catalog" ||
    toolName === "lucy_begin_question" ||
    toolName === "lucy_skill_search" ||
    toolName === "lucy_skill_read"
  ) {
    return undefined;
  }
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return `invalid_arguments:${toolName}:arguments_object_required`;
  }
  const record = args as Record<string, unknown>;
  if (!hasNonEmptyStringField(record, ["connectionId", "connection_id", "connection"])) {
    return `invalid_arguments:${toolName}:connection_required`;
  }

  if (toolName === "lucy_read_source" || toolName === "lucy_freshness") {
    if (!hasNonEmptyStringField(record, ["sourceName", "source_name", "source", "table"])) {
      return `invalid_arguments:${toolName}:source_required`;
    }
  }

  if (toolName === "lucy_query" || toolName === "lucy_explain_query") {
    const hasQueryShape = hasNonEmptyArrayField(record, [
      "measures",
      "dimensions",
      "filters",
      "segments",
      "order_by",
      "orderBy"
    ]) || hasNonEmptyStringField(record, [
      "sourceName",
      "source_name",
      "source",
      "table",
      "query",
      "sql"
    ]);
    if (!hasQueryShape) {
      return `invalid_arguments:${toolName}:query_shape_required`;
    }
    const invalidShape = invalidLucyQueryShapeReason(toolName, record);
    if (invalidShape) return invalidShape;
  }

  return undefined;
}

async function lucyExplainQuery(identity: Identity, args: unknown): Promise<Record<string, unknown>> {
  const sourceRefs = await extractSourceRefs("lucy_explain_query", args, { fresh: true });
  const permissions = await effectivePermissions(identity);
  const requestedLimit = args && typeof args === "object" && !Array.isArray(args)
    ? (args as Record<string, unknown>).limit
    : undefined;
  return {
    allowed: true,
    upstreamTool: "sl_query",
    requestedSources: sourceRefs,
    guardrails: {
      rawSqlAllowed: false,
      writeOperationsAllowed: false,
      defaultLimit: LUCY_QUERY_DEFAULT_LIMIT,
      maxLimit: LUCY_QUERY_MAX_LIMIT,
      maxConcurrentQueries: queryConcurrencyLimit(),
      effectiveLimit: numericLimit(requestedLimit),
      resultTruncation: "responses are audited with row/column counts and truncation flags when upstream exposes them"
    },
    policy: permissions.ok
      ? {
          roleIds: permissions.permissions.roleIds,
          connections: permissions.permissions.connections,
          sourceMapVersion: permissions.permissions.sourceMapVersion,
          permissionSnapshotHash: permissions.permissions.snapshotHash
        }
      : { error: permissions.reason },
    provenance: {
      decision: "allowed",
      explanation: "This explain response is generated by Lucy without executing the query. The same args must still pass Policy Runtime and Query Guardrail when executed through lucy_query."
    }
  };
}

async function lucyFreshness(identity: Identity, args: unknown): Promise<Record<string, unknown>> {
  const record = args && typeof args === "object" && !Array.isArray(args) ? args as Record<string, unknown> : {};
  const connectionId = String(record.connectionId ?? record.connection_id ?? record.connection ?? "").trim().toLowerCase();
  const sourceName = String(record.sourceName ?? record.source_name ?? record.source ?? record.table ?? "").trim().toLowerCase();
  const catalog = await lucyCatalog(identity);
  const source = catalog.sources.find((item) => (
    item.connectionId === connectionId && item.sourceName === sourceName
  ));
  if (!source) {
    return {
      sourceName,
      connectionId,
      status: "forbidden_or_unknown",
      freshness: null
    };
  }

  const projectRoot = await resolveProjectRoot();
  const overlayPath = path.join(projectRoot, "semantic-layer", source.connectionId, `${source.sourceName}.yaml`);
  const schemaPath = path.join(projectRoot, "semantic-layer", source.connectionId, "_schema", `${source.schema}.yaml`);
  const mtimes: string[] = [];
  for (const filePath of [overlayPath, schemaPath]) {
    try {
      mtimes.push((await stat(filePath)).mtime.toISOString());
    } catch {
      // Some sources are manifest-only or overlay-only; missing metadata files are not fatal.
    }
  }
  const semanticLayerUpdatedAt = mtimes.sort().at(-1);
  return {
    connectionId: source.connectionId,
    schema: source.schema,
    sourceName: source.sourceName,
    table: source.table,
    freshness: {
      mode: "metadata_only",
      semanticLayerUpdatedAt: semanticLayerUpdatedAt ?? null,
      physicalDataUpdatedAt: null,
      note: "Physical data freshness is not available from the current source contract; Lucy reports this explicitly instead of inventing a timestamp."
    }
  };
}

async function connectionList(identity: Identity): Promise<{
  connections: string[];
  items: Array<{ id: string; connectionId: string }>;
  filteredBy: "effective_permissions";
}> {
  const resolved = await effectivePermissions(identity);
  const connections = resolved.ok ? resolved.permissions.connections : [];
  return {
    connections,
    items: connections.map((connectionId) => ({ id: connectionId, connectionId })),
    filteredBy: "effective_permissions"
  };
}

// ─── InitializeResult.instructions injection (wo-proxy-instructions-injection Task A) ───
//
// Lucy MCP Proxy rewrites upstream `initialize` responses to inject
// `result.instructions` from `webui/config/data-qa-instructions.md`. This is the
// single source of truth for the data-QA guidance that used to live in
// `CLAUDE.md` — it travels with the MCP session so all clients (Codex, Cursor,
// remote Claude Code) see the same instructions, not just Claude Code local
// agents that auto-load CLAUDE.md.
//
// Failure semantics deliberately differ from `writeToolsListResponse`:
// tools/list filter failures return JSON-RPC -32003 (fail-closed — wrong tool
// visibility is a security boundary). instructions injection failures fall
// back to pass-through of the original upstream body (fail-open) — instructions
// are guidance, not a security boundary, and a buggy rewriter must not block
// MCP session establishment for every client.
//
// The loader is one-shot at module init; if the file is missing or unreadable
// we treat it as "injection unavailable" and silently pass-through rather than
// crash the proxy.
let cachedDataQaInstructions: string | undefined;
let cachedDataQaInstructionsLoaded = false;
async function loadDataQaInstructions(): Promise<string | undefined> {
  if (cachedDataQaInstructionsLoaded) return cachedDataQaInstructions;
  cachedDataQaInstructionsLoaded = true;
  try {
    const projectRoot = await resolveProjectRoot();
    const filePath = path.join(projectRoot, "webui", "config", "data-qa-instructions.md");
    cachedDataQaInstructions = (await readFile(filePath, "utf-8")).trim();
  } catch (err) {
    console.error("[lucy-proxy] failed to load data-qa-instructions.md; initialize will pass through", err);
    cachedDataQaInstructions = undefined;
  }
  return cachedDataQaInstructions;
}

async function buildRoleAwareInstructions(identity: Identity): Promise<string | undefined> {
  const fallback = await loadDataQaInstructions();
  try {
    const catalog = await lucyCatalog(identity);
    let accessibleSkills: Awaited<ReturnType<typeof filterAccessibleSkills>> = [];
    try {
      const allSkills = await loadAllSkills();
      accessibleSkills = await filterAccessibleSkills(identity, allSkills);
    } catch {
      // Best-effort loading of skills for instructions
    }

    if (catalog.connections.length === 0 && catalog.sources.length === 0 && accessibleSkills.length === 0) return fallback;
    const visibleTools = new Set(await allowedToolNames(identity));
    const catalogTool = visibleTools.has("lucy_catalog")
      ? "`lucy_catalog`"
      : visibleTools.has("kx_catalog")
        ? "`kx_catalog`"
        : "the visible catalog tool";
    const sourceLines = catalog.sources.map((source) => (
      `- ${source.connectionId}.${source.schema}.${source.sourceName} -> ${source.table}`
    ));
    const exampleLines = catalog.examples.map((example) => `- ${example}`);
    const skillLines = accessibleSkills.map((skill) => (
      `- [${skill.name}] (${skill.uri}): ${skill.title} - ${skill.description}`
    ));
    const skillSection = skillLines.length > 0
      ? [
          "",
          "## Governed Domain Skills (SOPs)",
          "",
          "When analyzing specific business domains, prefer fetching governed SOPs via MCP Resources (`lucy-skill://<domain>/<name>`) or `lucy_skill_read`:",
          ...skillLines
        ]
      : [];
    const questionReportingLines = visibleTools.has("lucy_begin_question")
      ? [
          "- Optional but recommended: at the start of each new user business question, call `lucy_begin_question` once. Prefer the user's original wording in `question` when available; always provide `intentSummary`. Skipping this call never blocks catalog or query tools. Do not call it for protocol checks or tool discovery only.",
          ""
        ]
      : [];
    return [
      "# Lucy Data QA Runtime Instructions",
      "",
      "- Use the Lucy MCP Proxy tool surface only; do not invent data when a data tool fails.",
      `- Call ${catalogTool} before choosing a connection or source unless the route is already explicit in the user request.`,
      "- Only use connections and sources listed in this session's visible scope.",
      "- If a query needs data, call `lucy_query` or `lucy_read_source`; do not answer from wiki-only context when data retrieval failed.",
      "- For simple factual questions, use the shortest verified path: catalog/source confirmation -> `lucy_query` -> answer. Do not call `entity_details` or `lucy_explain_query` before `lucy_query` unless the user asks for entity metadata or permission/guardrail diagnostics.",
      ...questionReportingLines,
      "- Answer simple numeric questions directly first, usually as a compact table, then add brief caveats/provenance. Do not turn ordinary fact lookups into long audit reports.",
      "- Distinguish no fact row, NULL/blank source field, and values inferred from cumulative deltas. Do not collapse all three states into `—`.",
      "- If a key data tool call fails, the final answer must say whether a retry succeeded, whether the failure affects the conclusion, and which values remain uncertain. Do not give numeric conclusions when no successful fact data was returned.",
      "- When rows are missing, fields are NULL, a tool failed, or a value is inferred, qualify the answer with phrases such as 基于当前可查询数据 or 按累计差额推算; do not claim the data is complete or fully reconciled.",
      "- For `lucy_query`, use source-qualified semantic keys such as `source.measure`, `source.dimension`, and `source.segment`. Do not shorten them after an error; unqualified keys may be rejected by ACL before reaching the semantic layer.",
      "- In `lucy_query.measures`, use string semantic measure keys when the measure exists. Use `{expr,name}` objects only for ad hoc aggregate expressions.",
      "- In `lucy_query.dimensions` and `lucy_query.order_by`, use object entries such as `{field:\"source.field\"}`; do not use bare string arrays.",
      "- `lucy_query.filters` supports string filters and structured filters such as `{field:\"source.field\",op:\"contains\",value:\"<entity keyword>\"}`. Prefer semantic segments such as `source.segment` for common filters when available.",
      "- Interpret POC `DATE` / `DATETIME` values as Asia/Shanghai business dates when the visible source documentation says so.",
      `- Visible Scope below is captured at MCP initialize; call ${catalogTool} before routing if sources may have changed since this session started.`,
      ...skillSection,
      "",
      "## Visible Scope",
      "",
      `Connections: ${catalog.connections.join(", ") || "(none)"}`,
      "",
      "Sources:",
      ...(sourceLines.length > 0 ? sourceLines : ["- (none)"]),
      "",
      "## Query Examples",
      "",
      ...(exampleLines.length > 0 ? exampleLines : ["- Use the visible catalog and `lucy_read_source` to inspect the source before querying."])
    ].join("\n");
  } catch {
    return fallback;
  }
}

function instructionsInjectionEnabled(): boolean {
  return process.env.LUCY_ENABLE_INSTRUCTIONS_INJECTION !== "false";
}

function decodeSseMessages(body: string): unknown[] {
  const messages: unknown[] = [];
  for (const line of body.split(/\r?\n/)) {
    if (!line.startsWith("data: ")) continue;
    try {
      messages.push(JSON.parse(line.slice("data: ".length)));
    } catch {
      // skip malformed SSE data lines
    }
  }
  return messages;
}

/**
 * Pick the JSON-RPC *response* frame from a buffered SSE body.
 * Cursor / Claude Code Streamable HTTP clients often send progressToken;
 * KTX may emit notifications/progress before the id-matched result. Taking the
 * first `data:` line rewrites progress as the final response and clients wait
 * forever for an id-matched frame → MCP -32001 Request timed out.
 */
function decodeSseJsonRpcResponse(body: string, requestId?: string | number): unknown | undefined {
  const messages = decodeSseMessages(body);
  const responses = messages.filter((msg) => {
    if (!msg || typeof msg !== "object" || Array.isArray(msg)) return false;
    const record = msg as Record<string, unknown>;
    return "id" in record && ("result" in record || "error" in record);
  });
  if (requestId !== undefined) {
    const matched = responses.find((msg) => (msg as Record<string, unknown>).id === requestId);
    if (matched) return matched;
  }
  return responses.length > 0 ? responses[responses.length - 1] : undefined;
}

function decodeSseMessage(body: string, requestId?: string | number): unknown | undefined {
  return decodeSseJsonRpcResponse(body, requestId) ?? decodeSseMessages(body).at(-1);
}

/** Headers for a fully-buffered application/json MCP response.
 * Do not inherit KTX SSE framing headers — Streamable HTTP clients may hang
 * on finite SSE bodies. Keep mcp-session-id / protocol version for session affinity. */
function bufferedJsonHeaders(upstream: IncomingMessage): Record<string, string | string[] | number> {
  const headers: Record<string, string | string[] | number> = {
    "content-type": "application/json",
    "cache-control": "no-store"
  };
  const sessionId = upstream.headers["mcp-session-id"];
  const protocolVersion = upstream.headers["mcp-protocol-version"];
  if (sessionId !== undefined) headers["mcp-session-id"] = sessionId;
  if (protocolVersion !== undefined) headers["mcp-protocol-version"] = protocolVersion;
  return headers;
}

function passthroughBodyHeaders(upstream: IncomingMessage): Record<string, string | string[] | number> {
  const headers: Record<string, string | string[] | number> = {};
  for (const [k, v] of Object.entries(upstream.headers)) {
    const lower = k.toLowerCase();
    if (v !== undefined && lower !== "content-length" && lower !== "transfer-encoding" && lower !== "content-type") headers[k] = v;
  }
  headers["content-type"] = upstream.headers["content-type"] ?? "application/json";
  return headers;
}

function jsonRpcToolResult(requestId: string | number, text: string, options: { isError?: boolean } = {}): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: requestId,
    result: {
      ...(options.isError ? { isError: true } : {}),
      content: [{ type: "text", text }]
    }
  });
}

function firstStringValue(record: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function wikiKeyFromArgs(args: unknown): string | undefined {
  if (!args || typeof args !== "object" || Array.isArray(args)) return undefined;
  return firstStringValue(args as Record<string, unknown>, ["key", "path", "page", "slug", "uri", "id"]);
}

function wikiQueryFromArgs(args: unknown): { query?: string; limit: number } {
  if (!args || typeof args !== "object" || Array.isArray(args)) return { limit: 10 };
  const record = args as Record<string, unknown>;
  const query = firstStringValue(record, ["query", "q", "text", "keyword"]);
  const rawLimit = record.limit;
  const limit = typeof rawLimit === "number" && Number.isFinite(rawLimit)
    ? Math.min(20, Math.max(1, Math.floor(rawLimit)))
    : 10;
  return { query, limit };
}

function wikiKeyFromResult(item: Record<string, unknown>): string | undefined {
  return firstStringValue(item, ["path", "filePath", "file", "uri", "key", "page", "slug", "id"]);
}

async function filterWikiResultArray(identity: Identity, items: unknown[]): Promise<{ items: unknown[]; filtered: number; sawWikiKeys: boolean }> {
  const output: unknown[] = [];
  let filtered = 0;
  let sawWikiKeys = false;
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      output.push(item);
      continue;
    }
    const record = item as Record<string, unknown>;
    const rawKey = wikiKeyFromResult(record);
    if (!rawKey) {
      output.push(item);
      continue;
    }
    sawWikiKeys = true;
    const { decision, page } = await canAccessWikiKey(identity, rawKey);
    if (!decision.allowed || !page) {
      filtered += 1;
      continue;
    }
    output.push({ ...record, key: page.key, displayPath: page.key });
  }
  return { items: output, filtered, sawWikiKeys };
}

async function filterWikiSearchObject(identity: Identity, value: unknown): Promise<{ value: unknown; filtered: number; sawWikiKeys: boolean }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { value, filtered: 0, sawWikiKeys: false };
  const record = value as Record<string, unknown>;
  const rewritten: Record<string, unknown> = { ...record };
  let filtered = 0;
  let sawWikiKeys = false;
  for (const key of ["results", "items", "pages", "matches", "hits"]) {
    const nested = record[key];
    if (!Array.isArray(nested)) continue;
    const result = await filterWikiResultArray(identity, nested);
    rewritten[key] = result.items;
    filtered += result.filtered;
    sawWikiKeys = sawWikiKeys || result.sawWikiKeys;
  }
  return { value: rewritten, filtered, sawWikiKeys };
}

async function filterWikiSearchPayload(identity: Identity, payload: unknown): Promise<{ payload: unknown; filtered: number; failed?: string }> {
  if (!payload || typeof payload !== "object") return { payload, filtered: 0, failed: "wiki_search_filter_failed:non_object_payload" };
  const record = payload as Record<string, unknown>;
  const result = record.result as Record<string, unknown> | undefined;
  if (!result || typeof result !== "object") return { payload, filtered: 0, failed: "wiki_search_filter_failed:missing_result" };

  const rewrittenResult: Record<string, unknown> = { ...result };
  let filtered = 0;
  let sawWikiKeys = false;

  for (const key of ["results", "items", "pages", "matches", "hits"]) {
    const nested = result[key];
    if (!Array.isArray(nested)) continue;
    const arrayResult = await filterWikiResultArray(identity, nested);
    rewrittenResult[key] = arrayResult.items;
    filtered += arrayResult.filtered;
    sawWikiKeys = sawWikiKeys || arrayResult.sawWikiKeys;
  }

  if (Array.isArray(result.content)) {
    const content: unknown[] = [];
    for (const item of result.content) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        content.push(item);
        continue;
      }
      const contentRecord = item as Record<string, unknown>;
      if (typeof contentRecord.text !== "string" || !contentRecord.text.trim()) {
        content.push(item);
        continue;
      }
      try {
        const parsedText = JSON.parse(contentRecord.text) as unknown;
        const textResult = Array.isArray(parsedText)
          ? await filterWikiResultArray(identity, parsedText).then((value) => ({ value: value.items, filtered: value.filtered, sawWikiKeys: value.sawWikiKeys }))
          : await filterWikiSearchObject(identity, parsedText);
        filtered += textResult.filtered;
        sawWikiKeys = sawWikiKeys || textResult.sawWikiKeys;
        content.push({ ...contentRecord, text: JSON.stringify(textResult.value, null, 2) });
      } catch {
        return { payload, filtered, failed: "wiki_search_filter_failed:unparseable_text" };
      }
    }
    rewrittenResult.content = content;
  }

  if (result.structuredContent && typeof result.structuredContent === "object" && !Array.isArray(result.structuredContent)) {
    const structured = await filterWikiSearchObject(identity, result.structuredContent);
    rewrittenResult.structuredContent = structured.value;
    filtered += structured.filtered;
    sawWikiKeys = sawWikiKeys || structured.sawWikiKeys;
  }

  if (!sawWikiKeys && filtered === 0) return { payload: { ...record, result: rewrittenResult }, filtered };
  return { payload: { ...record, result: rewrittenResult }, filtered };
}

function rpcErrorResponse(requestId: string | number, message: string, reason: string): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id: requestId,
    error: {
      code: -32003,
      message,
      data: { reason }
    }
  };
}

function upstreamFailureReason(error: unknown): "source_timeout" | "upstream_unavailable" {
  const message = error instanceof Error ? error.message : String(error);
  return /timeout/i.test(message) ? "source_timeout" : "upstream_unavailable";
}

function ensureJsonRpcEnvelope(payload: unknown, requestId: string | number): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const record = payload as Record<string, unknown>;
  if (!("result" in record) && !("error" in record)) return payload;
  return {
    ...record,
    jsonrpc: typeof record.jsonrpc === "string" ? record.jsonrpc : "2.0",
    id: record.id ?? requestId
  };
}

function firstStringField(record: Record<string, unknown>, fields: string[]): string | undefined {
  for (const field of fields) {
    const value = record[field];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function firstFieldValue(record: Record<string, unknown>, fields: string[]): unknown {
  for (const field of fields) {
    if (record[field] !== undefined) return record[field];
  }
  return undefined;
}

function boundedProvenanceValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value.length > 500 ? `${value.slice(0, 500)}...` : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= 4) return "[omitted]";
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => boundedProvenanceValue(item, depth + 1));
  if (typeof value !== "object") return String(value);
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 30)) {
    output[key] = boundedProvenanceValue(item, depth + 1);
  }
  return output;
}

function withLucyResultMeta(
  payload: unknown,
  requestId: string | number,
  toolName: string,
  args: unknown,
  sourceRefs: SourceRef[]
): unknown {
  const enveloped = ensureJsonRpcEnvelope(payload, requestId);
  if (!enveloped || typeof enveloped !== "object" || Array.isArray(enveloped)) return enveloped;
  const record = enveloped as Record<string, unknown>;
  const result = record.result;
  if (!result || typeof result !== "object" || Array.isArray(result)) return enveloped;
  const resultRecord = result as Record<string, unknown>;
  const existingMeta = resultRecord._meta && typeof resultRecord._meta === "object" && !Array.isArray(resultRecord._meta)
    ? resultRecord._meta as Record<string, unknown>
    : {};
  const argsRecord = args && typeof args === "object" && !Array.isArray(args) ? args as Record<string, unknown> : {};
  const filters = firstFieldValue(argsRecord, ["filters", "filter", "where"]);
  const segments = firstFieldValue(argsRecord, ["segments"]);
  const orderBy = firstFieldValue(argsRecord, ["orderBy", "order_by"]);
  const inspectedResult = inspectRowsAndColumns(resultRecord);
  const responseTruncated = findBooleanFlag(resultRecord, "truncated");
  return {
    ...record,
    result: {
      ...resultRecord,
      _meta: {
        ...existingMeta,
        lucy: {
          contract: "lucy-r1-controlled-data-service",
          tool: toolName,
          upstreamTool: toolName === "lucy_query" ? "sl_query" : "sl_read_source",
          sources: sourceRefs,
          guardrails: {
            rawSqlAllowed: false,
            writeOperationsAllowed: false,
            defaultLimit: LUCY_QUERY_DEFAULT_LIMIT,
            maxLimit: LUCY_QUERY_MAX_LIMIT,
            maxConcurrentQueries: queryConcurrencyLimit(),
            effectiveLimit: toolName === "lucy_query" ? numericLimit(argsRecord.limit) : undefined
          },
          result: {
            rowCount: inspectedResult.rows ?? null,
            columnCount: inspectedResult.columns ?? null,
            truncated: responseTruncated ?? null
          },
          provenance: {
            connectionId: firstStringField(argsRecord, ["connectionId", "connection_id", "connection"]) ?? null,
            sourceName: firstStringField(argsRecord, ["sourceName", "source_name", "source", "table"]) ?? sourceRefs[0]?.sourceName ?? null,
            measures: boundedProvenanceValue(firstFieldValue(argsRecord, ["measures"])) ?? null,
            dimensions: boundedProvenanceValue(firstFieldValue(argsRecord, ["dimensions"])) ?? null,
            filters: boundedProvenanceValue(filters) ?? null,
            segments: boundedProvenanceValue(segments) ?? null,
            orderBy: boundedProvenanceValue(orderBy) ?? null,
            sourceResolution: sourceRefs.length > 0 ? "acl_source_map" : "none",
            freshness: {
              status: "not_checked",
              tool: "lucy_freshness",
              note: "Call lucy_freshness for metadata freshness before presenting freshness-sensitive answers."
            },
            truncation: responseTruncated === undefined
              ? "unknown; upstream did not expose a truncated flag"
              : "reported from upstream response"
          }
        }
      }
    }
  };
}

function filterAndAddAllowedTools(payload: unknown, visibleTools: Set<string>, requestId: string | number): unknown {
  if (!payload || typeof payload !== "object") return payload;
  const record = payload as Record<string, unknown>;
  const result = record.result as Record<string, unknown> | undefined;
  if (!result || !Array.isArray(result.tools)) return payload;
  const localTools = localToolBuilders()
    .filter((local) => visibleTools.has(local.name))
    .map((local) => ({ name: local.name, tool: local.build() }));
  const localToolByName = new Map(localTools.map((entry) => [entry.name, entry.tool]));
  const seenNames = new Set<string>();
  const filteredTools = result.tools.flatMap((tool) => {
    if (!tool || typeof tool !== "object") return [];
    const name = (tool as Record<string, unknown>).name;
    if (typeof name !== "string" || !visibleTools.has(name)) return [];
    const localTool = localToolByName.get(name);
    seenNames.add(name);
    return [localTool ?? tool];
  });
  const injected = localTools
    .filter((entry) => !seenNames.has(entry.name))
    .map((entry) => entry.tool);
  const tools = [...filteredTools, ...injected];
  return {
    ...record,
    jsonrpc: typeof record.jsonrpc === "string" ? record.jsonrpc : "2.0",
    id: record.id ?? requestId,
    result: {
      ...result,
      tools
    }
  };
}

async function writeLucySemanticResponse(
  identity: Identity,
  upstream: IncomingMessage,
  res: ServerResponse,
  requestId: string | number,
  toolName: string,
  toolArgs: unknown,
  start: number,
  requestMeta: Partial<Parameters<typeof writeLog>[0]>,
  argsSummary: Record<string, unknown> | undefined,
  queryMeta: Partial<Parameters<typeof writeLog>[0]>,
  queryTables: string[],
  traceId: string
): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of upstream as AsyncIterable<Buffer>) {
    chunks.push(chunk);
  }

  const originalBody = Buffer.concat(chunks).toString();
  const contentType = String(upstream.headers["content-type"] ?? "");
  const sourceRefs = await extractSourceRefs(toolName, toolArgs).catch(() => []);
  let body = originalBody;
  let metaFailed: string | undefined;
  // Buffered tools/call responses are always normalized to application/json when
  // rewrite succeeds. Re-emitting a finite SSE frame with Content-Length +
  // keep-alive causes Streamable HTTP clients (Cursor / Claude Code) to wait for
  // stream end and surface MCP -32001 Request timed out even though KTX finished.
  let forceJson = false;

  try {
    if (contentType.includes("text/event-stream")) {
      const payload = decodeSseMessage(originalBody, requestId);
      if (!payload) throw new Error("missing SSE data frame");
      body = JSON.stringify(withLucyResultMeta(payload, requestId, toolName, toolArgs, sourceRefs));
      forceJson = true;
    } else if (contentType.includes("application/json")) {
      body = JSON.stringify(withLucyResultMeta(JSON.parse(originalBody), requestId, toolName, toolArgs, sourceRefs));
      forceJson = true;
    } else {
      throw new Error(`unsupported content-type:${contentType || "<missing>"}`);
    }
  } catch (err) {
    metaFailed = `lucy_result_meta_failed:${err instanceof Error ? err.message : String(err)}`;
    body = originalBody;
  }

  const headers = forceJson ? bufferedJsonHeaders(upstream) : passthroughBodyHeaders(upstream);
  const responseBytes = Buffer.byteLength(body);
  headers["content-length"] = responseBytes;
  res.writeHead(upstream.statusCode ?? 200, headers);
  res.end(body);

  let outcome: "ok" | "error" = "ok";
  let errorDetail = metaFailed;
  let parsedBody: Record<string, unknown> | undefined;
  try {
    const parsed = (!metaFailed || contentType.includes("application/json"))
      ? JSON.parse(body) as Record<string, unknown>
      : decodeSseMessage(body) as Record<string, unknown> | undefined;
    parsedBody = parsed;
    const parsedError = parsed?.error;
    const parsedResult = parsed?.result as Record<string, unknown> | undefined;
    if (parsedError || parsedResult?.isError) {
      outcome = "error";
      errorDetail = errorDetail ?? JSON.stringify(parsedError ?? parsedResult?.content);
    }
  } catch {
    // audit remains best-effort
  }

  const structuredTables = sourceRefs.map((ref) => ref.physicalTable);
  const tables = [...new Set([...structuredTables, ...queryTables])];
  const responseMeta = responseAuditMeta(Buffer.from(body), headers["content-type"]);
  const baseEntry: Parameters<typeof writeLog>[0] = {
    ts: new Date().toISOString(),
    userId: identity.userId,
    client: identity.client,
    tool: toolName,
    tables: tables.length > 0 ? tables : undefined,
    argsSummary,
    ...queryMeta,
    ...generatedSqlAuditFields(toolName, parsedBody),
    outcome,
    errorDetail,
    durationMs: Date.now() - start,
    ...responseMeta,
    requestId,
    traceId,
    ...requestMeta,
    ...(await auditMeta(identity, outcome === "ok" ? (metaFailed ? "lucy_result_meta_failed" : "allowed") : "upstream_error")),
  };
  recordAudit(baseEntry, outcome === "ok" ? sourceRefs : undefined);
  recordMcpTraceForTool({
    traceId,
    identity,
    toolName,
    status: outcome,
    startedAt: new Date(start).toISOString(),
    turnId: requestMeta.lucyTurnId ?? null,
    sessionId: requestMeta.lucySessionId ?? null,
    requestId,
    argsSummary,
    allowed: true,
    reason: outcome === "ok" ? (metaFailed ? "lucy_result_meta_failed" : "allowed") : "upstream_error",
    resultSnapshot: resultSnapshotFromAuditMeta(responseMeta),
    sourceRefs: sourceRefs.length > 0 ? sourceRefs : null
  });
}

function toolsListErrorResponse(requestId: string | number, detail: string): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id: requestId,
    error: {
      code: -32003,
      message: "tools/list filtering failed",
      data: { reason: detail }
    }
  };
}

function localInitializePayload(requestId: string | number, instructions: string | undefined): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id: requestId,
    result: {
      protocolVersion: "2024-11-05",
      capabilities: {
        tools: { listChanged: false }
      },
      serverInfo: {
        name: "lucy-mcp-proxy",
        version: "local-fallback"
      },
      instructions: instructions ?? "Lucy MCP Proxy is available, but role-aware instructions could not be loaded."
    }
  };
}

async function localToolsListPayload(identity: Identity, requestId: string | number): Promise<Record<string, unknown>> {
  const visibleTools = new Set(await allowedToolNames(identity));
  const tools = localToolBuilders()
    .filter((local) => visibleTools.has(local.name))
    .map((local) => local.build());
  return {
    jsonrpc: "2.0",
    id: requestId,
    result: { tools }
  };
}

async function writeToolsListResponse(
  identity: NonNullable<Awaited<ReturnType<typeof identifyRequest>>>,
  upstream: IncomingMessage,
  res: ServerResponse,
  requestId: string | number
): Promise<{ filterFailed: boolean; errorDetail?: string; responseBytes: number }> {
  const chunks: Buffer[] = [];
  for await (const chunk of upstream as AsyncIterable<Buffer>) {
    chunks.push(chunk);
  }

  const originalBody = Buffer.concat(chunks).toString();
  const contentType = String(upstream.headers["content-type"] ?? "");
  const visibleTools = new Set(await allowedToolNames(identity));
  let body = originalBody;
  let filterFailed = false;
  let errorDetail: string | undefined;
  let forceJson = false;
  try {
    if (contentType.includes("text/event-stream")) {
      const payload = decodeSseMessage(originalBody, requestId);
      if (!payload) throw new Error("missing SSE data frame");
      body = JSON.stringify(filterAndAddAllowedTools(payload, visibleTools, requestId));
      forceJson = true;
    } else if (contentType.includes("application/json")) {
      body = JSON.stringify(filterAndAddAllowedTools(JSON.parse(originalBody), visibleTools, requestId));
      forceJson = true;
    } else {
      throw new Error(`unsupported content-type:${contentType || "<missing>"}`);
    }
  } catch (err) {
    filterFailed = true;
    errorDetail = `tools_list_filter_failed:${err instanceof Error ? err.message : String(err)}`;
    body = JSON.stringify(toolsListErrorResponse(requestId, errorDetail));
    forceJson = true;
  }

  const headers = forceJson ? bufferedJsonHeaders(upstream) : passthroughBodyHeaders(upstream);
  const responseBytes = Buffer.byteLength(body);
  headers["content-length"] = responseBytes;
  res.writeHead(upstream.statusCode ?? 200, headers);
  res.end(body);
  return { filterFailed, errorDetail, responseBytes };
}

// Rewrites the upstream `initialize` response so `result.instructions` is the
// proxy's data-QA guidance text. On ANY failure (parse error, missing result,
// unsupported content-type, instructions text not loaded) we pass the original
// upstream body through unchanged. This is deliberately fail-open: a buggy
// rewriter must not block MCP session establishment for every client.
async function writeInitializeResponse(
  identity: Identity,
  upstream: IncomingMessage,
  res: ServerResponse,
  requestId: string | number
): Promise<{ injectionFailed: boolean; errorDetail?: string; responseBytes: number }> {
  const chunks: Buffer[] = [];
  for await (const chunk of upstream as AsyncIterable<Buffer>) {
    chunks.push(chunk);
  }

  const originalBody = Buffer.concat(chunks).toString();
  const contentType = String(upstream.headers["content-type"] ?? "");
  const instructions = await buildRoleAwareInstructions(identity);
  const isSse = contentType.includes("text/event-stream");

  let body = originalBody;
  let injectionFailed = false;
  let errorDetail: string | undefined;
  let forceJson = false;

  if (!instructions) {
    injectionFailed = true;
    errorDetail = "instructions_text_unavailable";
  } else {
    try {
      if (isSse) {
        const payload = decodeSseMessage(originalBody, requestId);
        if (!payload) throw new Error("missing SSE data frame");
        const record = payload as Record<string, unknown>;
        const result = record.result as Record<string, unknown> | undefined;
        if (!result || typeof result !== "object") throw new Error("missing result object");
        const rewritten = ensureJsonRpcEnvelope({ ...record, result: { ...result, instructions } }, requestId);
        body = JSON.stringify(rewritten);
        forceJson = true;
      } else if (contentType.includes("application/json")) {
        const parsed = JSON.parse(originalBody) as Record<string, unknown>;
        const result = parsed.result as Record<string, unknown> | undefined;
        if (!result || typeof result !== "object") throw new Error("missing result object");
        const rewritten = ensureJsonRpcEnvelope({ ...parsed, result: { ...result, instructions } }, requestId);
        body = JSON.stringify(rewritten);
        forceJson = true;
      } else {
        throw new Error(`unsupported content-type:${contentType || "<missing>"}`);
      }
    } catch (err) {
      injectionFailed = true;
      errorDetail = `instructions_injection_failed:${err instanceof Error ? err.message : String(err)}`;
      body = originalBody;
    }
  }

  const headers = forceJson ? bufferedJsonHeaders(upstream) : passthroughBodyHeaders(upstream);
  const responseBytes = Buffer.byteLength(body);
  headers["content-length"] = responseBytes;
  res.writeHead(upstream.statusCode ?? 200, headers);
  res.end(body);
  return { injectionFailed, errorDetail, responseBytes };
}

async function handlePost(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const sessionId = normalizeHeader(req.headers["mcp-session-id"]);
  const identify = await identifyRequestDetailed(req.headers.authorization, sessionId);
  const networkMeta = extractRequestClientMeta(req);
  const requestMeta: Partial<Parameters<typeof writeLog>[0]> = {
    ...correlationMeta(req.headers),
    clientIp: networkMeta.clientIp,
    userAgent: networkMeta.userAgent,
    // Runtime device name only — never fall back to YAML remark.
    ...(networkMeta.deviceName ? { deviceName: networkMeta.deviceName } : {})
  };
  if (!identify.ok) {
    recordAuthFailure(req, identify);
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null }));
    return;
  }
  const identity = identify.identity;

  const body = await readBody(req);
  const start = Date.now();
  const traceId = `trace_${randomUUID()}`;

  let rpcMethod: string | undefined;
  let toolName: string | undefined;
  let toolArgs: unknown;
  let requestId: string | number = "";
  let argsSummary: Record<string, unknown> | undefined;
  let queryMeta: Partial<Parameters<typeof writeLog>[0]> = {};
  let queryTables: string[] = [];
  let parsedRpc: Record<string, unknown> | undefined;
  let queryNormalizationReason: string | undefined;

  try {
    const parsed = JSON.parse(body.toString()) as Record<string, unknown>;
    parsedRpc = parsed;
    rpcMethod = parsed.method as string | undefined;
    requestId = (parsed.id as string | number | undefined) ?? "";

    if (rpcMethod === "initialize") {
      const clientInfo = (parsed.params as Record<string, unknown> | undefined)?.clientInfo as Record<string, unknown> | undefined;
      if (clientInfo?.name && sessionId) {
        const version = clientInfo.version != null ? String(clientInfo.version) : undefined;
        setSessionClient(sessionId, identity.userId, identity.tokenLabel, String(clientInfo.name), version);
        identity.client = String(clientInfo.name);
        identity.clientVersion = version;
      }
    }

    if (rpcMethod === "tools/call") {
      const params = parsed.params as Record<string, unknown> | undefined;
      toolName = params?.name as string | undefined;
      if (toolName === "lucy_query" || toolName === "lucy_explain_query") {
        const normalized = canonicalizeLucyQueryArgs(params?.arguments, toolName);
        if (normalized.ok) {
          toolArgs = normalized.args;
        } else {
          toolArgs = params?.arguments;
          queryNormalizationReason = normalized.reason;
        }
      } else {
        toolArgs = params?.arguments;
      }
      if (toolArgs !== params?.arguments && params) {
        params.arguments = toolArgs;
      }
      const args = params?.arguments as Record<string, unknown> | undefined;
      if (args) {
        // Keep only a safe subset of args for logging
        argsSummary = summarizeArgs(args);
      }
      const rawQueryAudit = queryAuditMeta(toolArgs);
      const { queryTables: extractedQueryTables, ...safeQueryMeta } = rawQueryAudit;
      queryMeta = safeQueryMeta;
      queryTables = extractedQueryTables ?? [];
    }
  } catch {
    // non-JSON body; proxy as-is
  }

  const recordRequestAudit = (
    entry: Parameters<typeof writeLog>[0],
    sources?: SourceRef[]
  ) => {
    const withTrace = rpcMethod === "tools/call" ? { ...entry, traceId } : entry;
    recordAudit(withTrace, sources);
  };

  // Near-neighbor turn correlation (spec §8.2): if the client didn't send an explicit
  // x-lucy-turn-id header, fall back to the most recent lucy_begin_question report for
  // this identity within the attach window. lucy_begin_question itself is the start of a
  // turn, not a follow-up call, so it doesn't consume a match.
  if (rpcMethod === "tools/call" && toolName && toolName !== "lucy_begin_question" && !requestMeta.lucyTurnId) {
    const matched = matchReportedTurn(identity);
    if (matched) requestMeta.lucyTurnId = matched;
  }

  const invalidArgumentsReason = queryNormalizationReason ?? (
    rpcMethod === "tools/call" && toolName
      ? validateLucyToolArgs(toolName, toolArgs)
      : undefined
  );
  if (invalidArgumentsReason) {
    const responseBody = jsonRpcToolResult(requestId, `Invalid arguments: ${invalidArgumentsReason}`, { isError: true });
    res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(responseBody) });
    res.end(responseBody);
    recordRequestAudit({
      ts: new Date().toISOString(),
      userId: identity.userId,
      client: identity.client,
      tool: toolName ?? "tools/call",
      tables: queryTables.length > 0 ? queryTables : undefined,
      argsSummary,
      ...queryMeta,
      outcome: "error",
      errorDetail: invalidArgumentsReason,
      durationMs: Date.now() - start,
      responseBytes: Buffer.byteLength(responseBody),
      requestId,
      ...requestMeta,
      ...(await auditMeta(identity, invalidArgumentsReason)),
    });
    recordMcpTraceForTool({
      traceId,
      identity,
      toolName: toolName ?? "tools/call",
      status: "error",
      startedAt: new Date(start).toISOString(),
      turnId: requestMeta.lucyTurnId ?? null,
      sessionId: requestMeta.lucySessionId ?? null,
      requestId,
      argsSummary,
      allowed: false,
      reason: invalidArgumentsReason,
      policySource: "other"
    });
    return;
  }

  // Deployment license check for tool calls (before data ACL)
  if (rpcMethod === "tools/call" && toolName) {
    const licenseSnapshot = await loadLicenseSnapshot();
    const licenseDecision = assertLicenseAllowsMcp(licenseSnapshot);
    if (!licenseDecision.allowed) {
      const errorMsg = licenseDecision.decisionReason ?? licenseDecision.code.toLowerCase();
      const meta = await auditMeta(identity, errorMsg);
      const responseBody = JSON.stringify({
        jsonrpc: "2.0",
        id: requestId,
        result: {
          isError: true,
          content: [{ type: "text", text: `Access denied: ${errorMsg}` }]
        }
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(responseBody);
      recordRequestAudit({
        ts: new Date().toISOString(),
        userId: identity.userId,
        client: identity.client,
        tool: toolName,
        tables: queryTables.length > 0 ? queryTables : undefined,
        argsSummary,
        ...queryMeta,
        outcome: "denied",
        errorDetail: errorMsg,
        durationMs: Date.now() - start,
        responseBytes: Buffer.byteLength(responseBody),
        requestId,
        ...requestMeta,
        ...meta
      });
      recordMcpTraceForTool({
        traceId,
        identity,
        toolName,
        status: "denied",
        startedAt: new Date(start).toISOString(),
        turnId: requestMeta.lucyTurnId ?? null,
        sessionId: requestMeta.lucySessionId ?? null,
        requestId,
        argsSummary,
        allowed: false,
        reason: errorMsg,
        matchedRule: errorMsg
      });
      return;
    }
  }

  // ACL check for tool calls
  if (rpcMethod === "tools/call" && toolName) {
    const decision = await aclCheck(identity, toolName, toolArgs);
    if (!decision.allowed) {
      const errorMsg = decision.reason ?? "denied";
      const meta = await auditMeta(identity, errorMsg);
      const responseBody = JSON.stringify({
        jsonrpc: "2.0",
        id: requestId,
        result: {
          isError: true,
          content: [{ type: "text", text: `Access denied: ${errorMsg}` }]
        }
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(responseBody);
      recordRequestAudit({
        ts: new Date().toISOString(),
        userId: identity.userId,
        client: identity.client,
        tool: toolName,
        tables: queryTables.length > 0 ? queryTables : undefined,
        argsSummary,
        ...queryMeta,
        outcome: "denied",
        errorDetail: errorMsg,
        durationMs: Date.now() - start,
        responseBytes: Buffer.byteLength(responseBody),
        requestId,
        ...requestMeta,
        ...meta,
      });
      recordMcpTraceForTool({
        traceId,
        identity,
        toolName,
        status: "denied",
        startedAt: new Date(start).toISOString(),
        turnId: requestMeta.lucyTurnId ?? null,
        sessionId: requestMeta.lucySessionId ?? null,
        requestId,
        argsSummary,
        allowed: false,
        reason: errorMsg,
        matchedRule: decision.reason
      });
      return;
    }
    if (toolName === "connection_list" || toolName === "lucy_catalog" || toolName === "kx_catalog") {
      const data = toolName === "connection_list"
        ? await connectionList(identity)
        : toolName === "lucy_catalog"
          ? await lucyCatalog(identity)
          : await kxCatalog(identity);
      const responseBody = JSON.stringify({
        jsonrpc: "2.0",
        id: requestId,
        result: {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }]
        }
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(responseBody);
      recordRequestAudit({
        ts: new Date().toISOString(),
        userId: identity.userId,
        client: identity.client,
        tool: toolName,
        argsSummary,
        ...queryMeta,
        outcome: "ok",
        durationMs: Date.now() - start,
        responseBytes: Buffer.byteLength(responseBody),
        requestId,
        ...requestMeta,
        ...(await auditMeta(identity, "allowed")),
      });
      recordMcpTraceForTool({
        traceId,
        identity,
        toolName,
        status: "ok",
        startedAt: new Date(start).toISOString(),
        turnId: requestMeta.lucyTurnId ?? null,
        sessionId: requestMeta.lucySessionId ?? null,
        requestId,
        argsSummary,
        allowed: true,
        reason: "allowed",
        matchedRule: decision.reason
      });
      return;
    }
    if (toolName === "lucy_explain_query" || toolName === "lucy_freshness") {
      const data = toolName === "lucy_explain_query"
        ? await lucyExplainQuery(identity, toolArgs)
        : await lucyFreshness(identity, toolArgs);
      const responseBody = jsonRpcToolResult(requestId, JSON.stringify(data, null, 2));
      const sourceRefs = await extractSourceRefs(toolName, toolArgs).catch(() => []);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(responseBody);
      recordRequestAudit({
        ts: new Date().toISOString(),
        userId: identity.userId,
        client: identity.client,
        tool: toolName,
        tables: sourceRefs.length > 0 ? sourceRefs.map((ref) => ref.physicalTable) : undefined,
        argsSummary,
        ...queryMeta,
        outcome: "ok",
        durationMs: Date.now() - start,
        responseBytes: Buffer.byteLength(responseBody),
        responseRowCount: 0,
        responseColumnCount: 0,
        responseTruncated: false,
        requestId,
        ...requestMeta,
        ...(await auditMeta(identity, "allowed")),
      }, sourceRefs);
      recordMcpTraceForTool({
        traceId,
        identity,
        toolName,
        status: "ok",
        startedAt: new Date(start).toISOString(),
        turnId: requestMeta.lucyTurnId ?? null,
        sessionId: requestMeta.lucySessionId ?? null,
        requestId,
        argsSummary,
        allowed: true,
        reason: "allowed",
        resultSnapshot: {
          rowCount: 0,
          columnCount: 0,
          responseBytes: Buffer.byteLength(responseBody),
          truncated: false
        },
        sourceRefs: sourceRefs.length > 0 ? sourceRefs : null
      });
      return;
    }
    if (toolName === "wiki_read") {
      const rawKey = wikiKeyFromArgs(toolArgs);
      const { page, decision } = rawKey
        ? await canAccessWikiKey(identity, rawKey)
        : { decision: { allowed: false, reason: "wiki_key_missing" } };
      const allowed = Boolean(decision.allowed && page);
      const responseBody = allowed && page
        ? jsonRpcToolResult(requestId, JSON.stringify({ key: page.key, title: page.title, content: page.body }, null, 2))
        : jsonRpcToolResult(requestId, `Access denied: ${decision.reason ?? "wiki_forbidden"}`, { isError: true });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(responseBody);
      recordRequestAudit({
        ts: new Date().toISOString(),
        userId: identity.userId,
        client: identity.client,
        tool: toolName,
        argsSummary: rawKey ? { key: canonicalWikiKey(rawKey) ?? "<invalid>" } : argsSummary,
        ...queryMeta,
        outcome: allowed ? "ok" : "denied",
        errorDetail: allowed ? undefined : (decision.reason ?? "wiki_forbidden"),
        durationMs: Date.now() - start,
        responseBytes: Buffer.byteLength(responseBody),
        requestId,
        ...requestMeta,
        ...(await auditMeta(identity, allowed ? "allowed" : (decision.reason ?? "wiki_forbidden"))),
      });
      recordMcpTraceForTool({
        traceId,
        identity,
        toolName,
        status: allowed ? "ok" : "denied",
        startedAt: new Date(start).toISOString(),
        turnId: requestMeta.lucyTurnId ?? null,
        sessionId: requestMeta.lucySessionId ?? null,
        requestId,
        argsSummary: rawKey ? { key: canonicalWikiKey(rawKey) ?? "<invalid>" } : argsSummary,
        allowed,
        reason: allowed ? "allowed" : (decision.reason ?? "wiki_forbidden"),
        policySource: "wiki_acl"
      });
      return;
    }
    if (toolName === "lucy_begin_question") {
      const args = (toolArgs as Record<string, unknown> | undefined) ?? {};
      const intentSummary = typeof args.intentSummary === "string" ? args.intentSummary.trim() : "";
      if (!intentSummary) {
        const responseBody = JSON.stringify({
          jsonrpc: "2.0",
          id: requestId,
          result: { isError: true, content: [{ type: "text", text: "lucy_begin_question requires intentSummary" }] }
        });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(responseBody);
        recordRequestAudit({
          ts: new Date().toISOString(),
          userId: identity.userId,
          client: identity.client,
          tool: toolName,
          argsSummary,
          outcome: "error",
          errorDetail: "missing_intent_summary",
          durationMs: Date.now() - start,
          responseBytes: Buffer.byteLength(responseBody),
          requestId,
          ...requestMeta,
          ...(await auditMeta(identity, "allowed")),
        });
        recordMcpTraceForTool({
          traceId,
          identity,
          toolName,
          status: "error",
          startedAt: new Date(start).toISOString(),
          turnId: requestMeta.lucyTurnId ?? null,
          sessionId: requestMeta.lucySessionId ?? null,
          requestId,
          argsSummary,
          allowed: false,
          reason: "missing_intent_summary",
          policySource: "other"
        });
        return;
      }

      const turnId = `lucy_${randomUUID()}`;
      const storePreview = process.env.LUCY_STORE_QUESTION_PREVIEW !== "false";
      const rawQuestion = typeof args.question === "string" ? args.question : undefined;
      const maxChars = Number(process.env.LUCY_QUESTION_PREVIEW_MAX_CHARS ?? 500);
      const questionPreview = storePreview && rawQuestion ? redactQuestionText(rawQuestion).slice(0, maxChars) : undefined;
      const questionHash = storePreview && rawQuestion ? createHash("sha256").update(rawQuestion).digest("hex") : undefined;

      try {
        await writeConversationTurn({
          turnId,
          userId: identity.userId,
          tokenHashPrefix: identity.tokenHashPrefix,
          platform: requestMeta.lucyPlatform,
          client: identity.client,
          questionHash,
          questionPreview,
          questionSummary: intentSummary,
          questionSource: "reported_tool",
          redactionVersion: "v1"
        });
      } catch (err) {
        console.error("[lucy-proxy] failed to write conversation turn", err);
        const responseBody = JSON.stringify({
          jsonrpc: "2.0",
          id: requestId,
          result: { isError: true, content: [{ type: "text", text: "lucy_begin_question failed to persist; the turn was not recorded" }] }
        });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(responseBody);
        recordRequestAudit({
          ts: new Date().toISOString(),
          userId: identity.userId,
          client: identity.client,
          tool: toolName,
          argsSummary,
          outcome: "error",
          errorDetail: "conversation_turn_write_failed",
          durationMs: Date.now() - start,
          responseBytes: Buffer.byteLength(responseBody),
          requestId,
          ...requestMeta,
          ...(await auditMeta(identity, "allowed")),
        });
        recordMcpTraceForTool({
          traceId,
          identity,
          toolName,
          status: "error",
          startedAt: new Date(start).toISOString(),
          turnId: requestMeta.lucyTurnId ?? null,
          sessionId: requestMeta.lucySessionId ?? null,
          requestId,
          argsSummary,
          allowed: false,
          reason: "conversation_turn_write_failed",
          policySource: "other"
        });
        return;
      }
      recordReportedTurn(identity, turnId);
      // spec §8.4: lazy, sampled purge trigger on the (low-frequency) report path — no background worker.
      if (Math.random() < Number(process.env.LUCY_QUESTION_PREVIEW_PURGE_SAMPLE_RATE ?? 0.01)) {
        purgeExpiredConversationTurns().catch((err) => {
          console.error("[lucy-proxy] lazy conversation-turn purge failed", err);
        });
      }

      const responseBody = JSON.stringify({
        jsonrpc: "2.0",
        id: requestId,
        result: {
          content: [{
            type: "text",
            text: JSON.stringify({
              turnId,
              note: "Subsequent tool calls within the attach window will be associated with this turn automatically; no need to pass extra params."
            })
          }]
        }
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(responseBody);
      recordRequestAudit({
        ts: new Date().toISOString(),
        userId: identity.userId,
        client: identity.client,
        tool: toolName,
        argsSummary,
        outcome: "ok",
        durationMs: Date.now() - start,
        responseBytes: Buffer.byteLength(responseBody),
        requestId,
        ...requestMeta,
        lucyTurnId: turnId,
        ...(await auditMeta(identity, "allowed")),
      });
      recordMcpTraceForTool({
        traceId,
        identity,
        toolName,
        status: "ok",
        startedAt: new Date(start).toISOString(),
        turnId,
        sessionId: requestMeta.lucySessionId ?? null,
        requestId,
        argsSummary,
        allowed: true,
        reason: "allowed"
      });
      return;
    }
  }

  // ─── Spec 131: Governed Skills MCP Protocol Interceptions ───
  if (rpcMethod === "resources/list") {
    let resources: Array<{ uri: string; name: string; description: string; mimeType: string }> = [];
    try {
      const allSkills = await loadAllSkills();
      const accessible = await filterAccessibleSkills(identity, allSkills);
      resources = accessible.map((s) => ({
        uri: s.uri,
        name: s.name,
        description: s.description,
        mimeType: "text/markdown"
      }));
    } catch (err) {
      console.error("[lucy-proxy] failed to load resources/list", err);
    }

    const responsePayload = {
      jsonrpc: "2.0",
      id: requestId,
      result: { resources }
    };
    const responseBody = JSON.stringify(responsePayload);
    res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(responseBody) });
    res.end(responseBody);
    recordRequestAudit({
      ts: new Date().toISOString(),
      userId: identity.userId,
      client: identity.client,
      tool: rpcMethod,
      outcome: "ok",
      durationMs: Date.now() - start,
      responseBytes: Buffer.byteLength(responseBody),
      requestId,
      ...requestMeta,
      ...(await auditMeta(identity, "allowed")),
    });
    return;
  }

  if (rpcMethod === "resources/read") {
    const params = parsedRpc?.params as Record<string, unknown> | undefined;
    const uri = typeof params?.uri === "string" ? params.uri.trim() : "";
    const skill = uri ? await getSkillByUri(uri) : null;
    if (!skill) {
      const errPayload = {
        jsonrpc: "2.0",
        id: requestId,
        error: { code: -32002, message: `Resource not found: ${uri}` }
      };
      const responseBody = JSON.stringify(errPayload);
      res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(responseBody) });
      res.end(responseBody);
      recordRequestAudit({
        ts: new Date().toISOString(),
        userId: identity.userId,
        client: identity.client,
        tool: rpcMethod,
        outcome: "error",
        errorDetail: `resource_not_found:${uri}`,
        durationMs: Date.now() - start,
        responseBytes: Buffer.byteLength(responseBody),
        requestId,
        ...requestMeta,
        ...(await auditMeta(identity, "resource_not_found")),
      });
      return;
    }

    const decision = await canAccessSkill(identity, skill);
    if (!decision.allowed) {
      const errPayload = {
        jsonrpc: "2.0",
        id: requestId,
        error: { code: -32003, message: `Access denied: ${decision.reason ?? "denied_skill_acl"}` }
      };
      const responseBody = JSON.stringify(errPayload);
      res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(responseBody) });
      res.end(responseBody);
      recordRequestAudit({
        ts: new Date().toISOString(),
        userId: identity.userId,
        client: identity.client,
        tool: rpcMethod,
        outcome: "denied",
        errorDetail: decision.reason,
        durationMs: Date.now() - start,
        responseBytes: Buffer.byteLength(responseBody),
        requestId,
        ...requestMeta,
        ...(await auditMeta(identity, decision.reason ?? "denied_skill_acl")),
      });
      return;
    }

    const responsePayload = {
      jsonrpc: "2.0",
      id: requestId,
      result: {
        contents: [
          {
            uri: skill.uri,
            mimeType: "text/markdown",
            text: skill.raw || skill.content
          }
        ]
      }
    };
    const responseBody = JSON.stringify(responsePayload);
    res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(responseBody) });
    res.end(responseBody);
    recordRequestAudit({
      ts: new Date().toISOString(),
      userId: identity.userId,
      client: identity.client,
      tool: rpcMethod,
      outcome: "ok",
      durationMs: Date.now() - start,
      responseBytes: Buffer.byteLength(responseBody),
      requestId,
      ...requestMeta,
      ...(await auditMeta(identity, "allowed")),
    });
    return;
  }

  if (rpcMethod === "prompts/list") {
    let prompts: Array<{ name: string; description: string; arguments?: Array<{ name: string; description: string; required: boolean }> }> = [];
    try {
      const allSkills = await loadAllSkills();
      const accessible = await filterAccessibleSkills(identity, allSkills);
      prompts = accessible.map((s) => ({
        name: s.name,
        description: s.description,
        arguments: [
          {
            name: "context",
            description: "Optional business context or focus dimension",
            required: false
          }
        ]
      }));
    } catch (err) {
      console.error("[lucy-proxy] failed to load prompts/list", err);
    }

    const responsePayload = {
      jsonrpc: "2.0",
      id: requestId,
      result: { prompts }
    };
    const responseBody = JSON.stringify(responsePayload);
    res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(responseBody) });
    res.end(responseBody);
    recordRequestAudit({
      ts: new Date().toISOString(),
      userId: identity.userId,
      client: identity.client,
      tool: rpcMethod,
      outcome: "ok",
      durationMs: Date.now() - start,
      responseBytes: Buffer.byteLength(responseBody),
      requestId,
      ...requestMeta,
      ...(await auditMeta(identity, "allowed")),
    });
    return;
  }

  if (rpcMethod === "prompts/get") {
    const params = parsedRpc?.params as Record<string, unknown> | undefined;
    const promptName = typeof params?.name === "string" ? params.name.trim() : "";
    const skill = promptName ? await getSkillByName(promptName) : null;
    if (!skill) {
      const errPayload = {
        jsonrpc: "2.0",
        id: requestId,
        error: { code: -32602, message: `Prompt not found: ${promptName}` }
      };
      const responseBody = JSON.stringify(errPayload);
      res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(responseBody) });
      res.end(responseBody);
      recordRequestAudit({
        ts: new Date().toISOString(),
        userId: identity.userId,
        client: identity.client,
        tool: rpcMethod,
        outcome: "error",
        errorDetail: `prompt_not_found:${promptName}`,
        durationMs: Date.now() - start,
        responseBytes: Buffer.byteLength(responseBody),
        requestId,
        ...requestMeta,
        ...(await auditMeta(identity, "prompt_not_found")),
      });
      return;
    }

    const decision = await canAccessSkill(identity, skill);
    if (!decision.allowed) {
      const errPayload = {
        jsonrpc: "2.0",
        id: requestId,
        error: { code: -32003, message: `Access denied: ${decision.reason ?? "denied_skill_acl"}` }
      };
      const responseBody = JSON.stringify(errPayload);
      res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(responseBody) });
      res.end(responseBody);
      recordRequestAudit({
        ts: new Date().toISOString(),
        userId: identity.userId,
        client: identity.client,
        tool: rpcMethod,
        outcome: "denied",
        errorDetail: decision.reason,
        durationMs: Date.now() - start,
        responseBytes: Buffer.byteLength(responseBody),
        requestId,
        ...requestMeta,
        ...(await auditMeta(identity, decision.reason ?? "denied_skill_acl")),
      });
      return;
    }

    const responsePayload = {
      jsonrpc: "2.0",
      id: requestId,
      result: {
        description: skill.description,
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `## Active Governed Skill: ${skill.title}\n\n${skill.content}`
            }
          }
        ]
      }
    };
    const responseBody = JSON.stringify(responsePayload);
    res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(responseBody) });
    res.end(responseBody);
    recordRequestAudit({
      ts: new Date().toISOString(),
      userId: identity.userId,
      client: identity.client,
      tool: rpcMethod,
      outcome: "ok",
      durationMs: Date.now() - start,
      responseBytes: Buffer.byteLength(responseBody),
      requestId,
      ...requestMeta,
      ...(await auditMeta(identity, "allowed")),
    });
    return;
  }

  if (rpcMethod === "tools/call" && toolName === "lucy_skill_search") {
    const rawArgs = toolArgs as Record<string, unknown> | undefined;
    const query = typeof rawArgs?.query === "string" ? rawArgs.query.trim().toLowerCase() : (typeof rawArgs?.q === "string" ? rawArgs.q.trim().toLowerCase() : "");
    const domainFilter = typeof rawArgs?.domain === "string" ? rawArgs.domain.trim().toLowerCase() : "";

    const allSkills = await loadAllSkills();
    const accessible = await filterAccessibleSkills(identity, allSkills);

    const matches = accessible.filter((s) => {
      if (domainFilter && s.domain.toLowerCase() !== domainFilter) return false;
      if (!query) return true;
      const matchName = s.name.toLowerCase().includes(query);
      const matchTitle = s.title.toLowerCase().includes(query);
      const matchTriggers = s.triggers.some((t) => t.toLowerCase().includes(query));
      const matchDesc = s.description.toLowerCase().includes(query);
      return matchName || matchTitle || matchTriggers || matchDesc;
    });

    const result = {
      query: (rawArgs?.query ?? rawArgs?.q ?? "") as string,
      count: matches.length,
      skills: matches.map((s) => ({
        name: s.name,
        title: s.title,
        domain: s.domain,
        uri: s.uri,
        version: s.version,
        triggers: s.triggers,
        description: s.description
      }))
    };

    const responseBody = jsonRpcToolResult(requestId, JSON.stringify(result, null, 2));
    res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(responseBody) });
    res.end(responseBody);
    recordRequestAudit({
      ts: new Date().toISOString(),
      userId: identity.userId,
      client: identity.client,
      tool: toolName,
      argsSummary,
      outcome: "ok",
      durationMs: Date.now() - start,
      responseBytes: Buffer.byteLength(responseBody),
      requestId,
      ...requestMeta,
      ...(await auditMeta(identity, "allowed")),
    });
    recordMcpTraceForTool({
      traceId,
      identity,
      toolName,
      status: "ok",
      startedAt: new Date(start).toISOString(),
      turnId: requestMeta.lucyTurnId ?? null,
      sessionId: requestMeta.lucySessionId ?? null,
      requestId,
      argsSummary,
      allowed: true,
      reason: "allowed",
      policySource: "skill_acl"
    });
    return;
  }

  if (rpcMethod === "tools/call" && toolName === "lucy_skill_read") {
    const rawArgs = toolArgs as Record<string, unknown> | undefined;
    const target = typeof rawArgs?.skill_name === "string" ? rawArgs.skill_name.trim() : (typeof rawArgs?.name === "string" ? rawArgs.name.trim() : "");
    const skill = target.startsWith("lucy-skill://") ? await getSkillByUri(target) : await getSkillByName(target);

    if (!skill) {
      const responseBody = jsonRpcToolResult(requestId, `Error: Skill "${target}" not found`, { isError: true });
      res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(responseBody) });
      res.end(responseBody);
      recordRequestAudit({
        ts: new Date().toISOString(),
        userId: identity.userId,
        client: identity.client,
        tool: toolName,
        argsSummary,
        outcome: "error",
        errorDetail: `skill_not_found:${target}`,
        durationMs: Date.now() - start,
        responseBytes: Buffer.byteLength(responseBody),
        requestId,
        ...requestMeta,
        ...(await auditMeta(identity, "skill_not_found")),
      });
      return;
    }

    const decision = await canAccessSkill(identity, skill);
    if (!decision.allowed) {
      const responseBody = jsonRpcToolResult(requestId, `Access denied: ${decision.reason ?? "denied_skill_acl"}`, { isError: true });
      res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(responseBody) });
      res.end(responseBody);
      recordRequestAudit({
        ts: new Date().toISOString(),
        userId: identity.userId,
        client: identity.client,
        tool: toolName,
        argsSummary,
        outcome: "denied",
        errorDetail: decision.reason,
        durationMs: Date.now() - start,
        responseBytes: Buffer.byteLength(responseBody),
        requestId,
        ...requestMeta,
        ...(await auditMeta(identity, decision.reason ?? "denied_skill_acl")),
      });
      return;
    }

    const responseBody = jsonRpcToolResult(requestId, skill.raw || skill.content);
    res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(responseBody) });
    res.end(responseBody);
    recordRequestAudit({
      ts: new Date().toISOString(),
      userId: identity.userId,
      client: identity.client,
      tool: toolName,
      argsSummary,
      outcome: "ok",
      durationMs: Date.now() - start,
      responseBytes: Buffer.byteLength(responseBody),
      requestId,
      ...requestMeta,
      ...(await auditMeta(identity, "allowed")),
    });
    recordMcpTraceForTool({
      traceId,
      identity,
      toolName,
      status: "ok",
      startedAt: new Date(start).toISOString(),
      turnId: requestMeta.lucyTurnId ?? null,
      sessionId: requestMeta.lucySessionId ?? null,
      requestId,
      argsSummary,
      allowed: true,
      reason: "allowed",
      policySource: "skill_acl"
    });
    return;
  }

  if (rpcMethod === "tools/call" && toolName === "lucy_query") {
    const slot = acquireLucyQuerySlot(identity);
    if (!slot.allowed) {
      const reason = "query_concurrency_exceeded";
      const responseBody = JSON.stringify({
        jsonrpc: "2.0",
        id: requestId,
        result: {
          isError: true,
          content: [{
            type: "text",
            text: `Access denied: ${reason}; active=${slot.active}; max=${slot.max}`
          }]
        }
      });
      res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(responseBody) });
      res.end(responseBody);
      let sourceRefs: SourceRef[] = [];
      try {
        sourceRefs = await extractSourceRefs(toolName, toolArgs);
      } catch {
        // source attribution is best-effort for guardrail denials.
      }
      const structuredTables = sourceRefs.map((ref) => ref.physicalTable);
      const tables = [...new Set([...structuredTables, ...queryTables])];
      recordRequestAudit({
        ts: new Date().toISOString(),
        userId: identity.userId,
        client: identity.client,
        tool: toolName,
        tables: tables.length > 0 ? tables : undefined,
        argsSummary,
        ...queryMeta,
        outcome: "denied",
        errorDetail: `${reason}:active=${slot.active};max=${slot.max}`,
        durationMs: Date.now() - start,
        responseBytes: Buffer.byteLength(responseBody),
        requestId,
        ...requestMeta,
        ...(await auditMeta(identity, reason)),
      }, sourceRefs);
      recordMcpTraceForTool({
        traceId,
        identity,
        toolName,
        status: "denied",
        startedAt: new Date(start).toISOString(),
        turnId: requestMeta.lucyTurnId ?? null,
        sessionId: requestMeta.lucySessionId ?? null,
        requestId,
        argsSummary,
        allowed: false,
        reason,
        policySource: "rate_limit"
      });
      return;
    }
    releaseOnResponseEnd(res, slot.release);
  }

  let outboundBody = body;
  if (rpcMethod === "tools/call" && parsedRpc && toolName === "lucy_read_source") {
    outboundBody = rewriteToolCall(parsedRpc, "sl_read_source", lucyReadSourceUpstreamArgs(toolArgs));
  }
  if (rpcMethod === "tools/call" && parsedRpc && toolName === "lucy_query") {
    outboundBody = rewriteToolCall(parsedRpc, "sl_query", lucyQueryUpstreamArgs(toolArgs));
  }

  let upstream: IncomingMessage;
  try {
    upstream = await forwardToKtx(req.method ?? "POST", req.url ?? "/mcp", req.headers, outboundBody);
  } catch (err) {
    if (rpcMethod === "initialize") {
      const instructions = instructionsInjectionEnabled() ? await buildRoleAwareInstructions(identity) : undefined;
      const payload = localInitializePayload(requestId, instructions);
      const responseBody = JSON.stringify(payload);
      res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(responseBody) });
      res.end(responseBody);
      recordRequestAudit({
        ts: new Date().toISOString(),
        userId: identity.userId,
        client: identity.client,
        tool: rpcMethod,
        outcome: "ok",
        errorDetail: `upstream_unavailable:${err instanceof Error ? err.message : String(err)}`,
        durationMs: Date.now() - start,
        responseBytes: Buffer.byteLength(responseBody),
        requestId,
        ...requestMeta,
        ...(await auditMeta(identity, "local_initialize_fallback")),
      });
      return;
    }
    if (rpcMethod === "tools/list") {
      const payload = await localToolsListPayload(identity, requestId);
      const responseBody = JSON.stringify(payload);
      res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(responseBody) });
      res.end(responseBody);
      recordRequestAudit({
        ts: new Date().toISOString(),
        userId: identity.userId,
        client: identity.client,
        tool: rpcMethod,
        outcome: "ok",
        errorDetail: `upstream_unavailable:${err instanceof Error ? err.message : String(err)}`,
        durationMs: Date.now() - start,
        responseBytes: Buffer.byteLength(responseBody),
        requestId,
        ...requestMeta,
        ...(await auditMeta(identity, "local_tools_list_fallback")),
      });
      return;
    }
    if (rpcMethod === "tools/call" && toolName === "wiki_search") {
      const { query, limit } = wikiQueryFromArgs(toolArgs);
      const results = query ? await searchAccessibleWikiPages(identity, query, limit) : [];
      const responseBody = jsonRpcToolResult(requestId, JSON.stringify({
        query: query ?? "",
        results,
        filteredBy: "wiki_acl",
        upstreamFallback: true
      }, null, 2), { isError: !query });
      res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(responseBody) });
      res.end(responseBody);
      recordRequestAudit({
        ts: new Date().toISOString(),
        userId: identity.userId,
        client: identity.client,
        tool: toolName,
        argsSummary: query ? { query, limit } : argsSummary,
        ...queryMeta,
        outcome: query ? "ok" : "error",
        errorDetail: query ? `upstream_unavailable:${err instanceof Error ? err.message : String(err)}` : "wiki_query_missing",
        durationMs: Date.now() - start,
        responseBytes: Buffer.byteLength(responseBody),
        requestId,
        ...requestMeta,
        ...(await auditMeta(identity, query ? "local_wiki_search_fallback" : "wiki_query_missing")),
      });
      recordMcpTraceForTool({
        traceId,
        identity,
        toolName,
        status: query ? "ok" : "error",
        startedAt: new Date(start).toISOString(),
        turnId: requestMeta.lucyTurnId ?? null,
        sessionId: requestMeta.lucySessionId ?? null,
        requestId,
        argsSummary: query ? { query, limit } : argsSummary,
        allowed: Boolean(query),
        reason: query ? "local_wiki_search_fallback" : "wiki_query_missing",
        policySource: "wiki_acl"
      });
      return;
    }
    if (rpcMethod === "tools/call") {
      const reason = upstreamFailureReason(err);
      const responseBody = JSON.stringify(rpcErrorResponse(requestId, "KTX upstream unavailable", reason));
      res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(responseBody) });
      res.end(responseBody);

      let sourceRefs: SourceRef[] = [];
      try {
        sourceRefs = toolName ? await extractSourceRefs(toolName, toolArgs) : [];
      } catch {
        // Source attribution is best-effort on upstream failure.
      }
      const structuredTables = sourceRefs.map((ref) => ref.physicalTable);
      const tables = [...new Set([...structuredTables, ...queryTables])];
      recordRequestAudit({
        ts: new Date().toISOString(),
        userId: identity.userId,
        client: identity.client,
        tool: toolName ?? "tools/call",
        tables: tables.length > 0 ? tables : undefined,
        argsSummary,
        ...queryMeta,
        outcome: "error",
        errorDetail: `${reason}:${err instanceof Error ? err.message : String(err)}`,
        durationMs: Date.now() - start,
        responseBytes: Buffer.byteLength(responseBody),
        requestId,
        ...requestMeta,
        ...(await auditMeta(identity, reason)),
      }, sourceRefs);
      recordMcpTraceForTool({
        traceId,
        identity,
        toolName: toolName ?? "tools/call",
        status: "error",
        startedAt: new Date(start).toISOString(),
        turnId: requestMeta.lucyTurnId ?? null,
        sessionId: requestMeta.lucySessionId ?? null,
        requestId,
        argsSummary,
        allowed: true,
        reason,
        policySource: "other"
      });
      return;
    }
    throw err;
  }

  if (rpcMethod === "initialize" && instructionsInjectionEnabled()) {
    const initResult = await writeInitializeResponse(identity, upstream, res, requestId);
    recordRequestAudit({
      ts: new Date().toISOString(),
      userId: identity.userId,
      client: identity.client,
      tool: rpcMethod,
      outcome: "ok",
      errorDetail: initResult.injectionFailed ? initResult.errorDetail : undefined,
      durationMs: Date.now() - start,
      responseBytes: initResult.responseBytes,
      requestId,
      ...requestMeta,
      ...(await auditMeta(identity, initResult.injectionFailed ? "instructions_injection_failed" : "allowed")),
    });
    return;
  }

  if (rpcMethod === "tools/list") {
    const toolsList = await writeToolsListResponse(identity, upstream, res, requestId);
    recordRequestAudit({
      ts: new Date().toISOString(),
      userId: identity.userId,
      client: identity.client,
      tool: rpcMethod,
      outcome: "ok",
      errorDetail: toolsList.errorDetail,
      durationMs: Date.now() - start,
      responseBytes: toolsList.responseBytes,
      requestId,
      ...requestMeta,
      ...(await auditMeta(identity, toolsList.filterFailed ? "tools_list_filter_failed" : "allowed")),
    });
    return;
  }

  if (rpcMethod === "tools/call" && toolName === "wiki_search") {
    const chunks: Buffer[] = [];
    for await (const chunk of upstream as AsyncIterable<Buffer>) {
      chunks.push(chunk);
    }
    const originalBody = Buffer.concat(chunks).toString();
    const contentType = String(upstream.headers["content-type"] ?? "");
    let body = originalBody;
    let filterFailed: string | undefined;
    let filteredCount = 0;
    let forceJson = false;

    try {
      if (contentType.includes("text/event-stream")) {
        const payload = decodeSseMessage(originalBody, requestId);
        if (!payload) throw new Error("missing SSE data frame");
        const filtered = await filterWikiSearchPayload(identity, payload);
        if (filtered.failed) {
          filterFailed = filtered.failed;
          body = JSON.stringify(rpcErrorResponse(requestId, "wiki_search filtering failed", filtered.failed));
        } else {
          filteredCount = filtered.filtered;
          body = JSON.stringify(ensureJsonRpcEnvelope(filtered.payload, requestId));
        }
        forceJson = true;
      } else if (contentType.includes("application/json")) {
        const filtered = await filterWikiSearchPayload(identity, JSON.parse(originalBody));
        if (filtered.failed) {
          filterFailed = filtered.failed;
          body = JSON.stringify(rpcErrorResponse(requestId, "wiki_search filtering failed", filtered.failed));
          forceJson = true;
        } else {
          filteredCount = filtered.filtered;
          body = JSON.stringify(ensureJsonRpcEnvelope(filtered.payload, requestId));
          forceJson = true;
        }
      } else {
        filterFailed = `wiki_search_filter_failed:unsupported_content_type:${contentType || "<missing>"}`;
        body = JSON.stringify(rpcErrorResponse(requestId, "wiki_search filtering failed", filterFailed));
        forceJson = true;
      }
    } catch (err) {
      filterFailed = `wiki_search_filter_failed:${err instanceof Error ? err.message : String(err)}`;
      body = JSON.stringify(rpcErrorResponse(requestId, "wiki_search filtering failed", filterFailed));
      forceJson = true;
    }

    const headers = forceJson ? bufferedJsonHeaders(upstream) : passthroughBodyHeaders(upstream);
    const responseBytes = Buffer.byteLength(body);
    headers["content-length"] = responseBytes;
    res.writeHead(upstream.statusCode ?? 200, headers);
    res.end(body);
    recordRequestAudit({
      ts: new Date().toISOString(),
      userId: identity.userId,
      client: identity.client,
      tool: toolName,
      argsSummary,
      ...queryMeta,
      outcome: filterFailed ? "error" : "ok",
      errorDetail: filterFailed,
      durationMs: Date.now() - start,
      responseBytes,
      requestId,
      ...requestMeta,
      ...(await auditMeta(identity, filterFailed ? "wiki_search_filter_failed" : filteredCount > 0 ? `wiki_filtered:${filteredCount}` : "allowed")),
    });
    recordMcpTraceForTool({
      traceId,
      identity,
      toolName,
      status: filterFailed ? "error" : "ok",
      startedAt: new Date(start).toISOString(),
      turnId: requestMeta.lucyTurnId ?? null,
      sessionId: requestMeta.lucySessionId ?? null,
      requestId,
      argsSummary,
      allowed: !filterFailed,
      reason: filterFailed ?? (filteredCount > 0 ? `wiki_filtered:${filteredCount}` : "allowed"),
      policySource: "wiki_acl"
    });
    return;
  }

  if (rpcMethod === "tools/call" && (toolName === "lucy_query" || toolName === "lucy_read_source")) {
    await writeLucySemanticResponse(identity, upstream, res, requestId, toolName, toolArgs, start, requestMeta, argsSummary, queryMeta, queryTables, traceId);
    return;
  }

  // For tool calls: buffer then normalize finite SSE to JSON (Streamable HTTP
  // clients such as Cursor / Claude Code hang on Content-Length + keep-alive SSE).
  // Non-SSE JSON still passes through with original headers.
  if (rpcMethod === "tools/call") {
    const chunks: Buffer[] = [];
    for await (const chunk of upstream as AsyncIterable<Buffer>) {
      chunks.push(chunk);
    }
    const responseBody = Buffer.concat(chunks);
    const contentType = String(upstream.headers["content-type"] ?? "");

    let outBody = responseBody;
    let headers: Record<string, string | string[] | number>;
    let forceJson = false;

    if (contentType.includes("text/event-stream")) {
      try {
        const payload = decodeSseMessage(responseBody.toString(), requestId);
        if (!payload) throw new Error("missing SSE data frame");
        outBody = Buffer.from(JSON.stringify(ensureJsonRpcEnvelope(payload, requestId)));
        forceJson = true;
      } catch {
        // Keep original body if we cannot decode; still prefer JSON headers when
        // we successfully rewrite below. On decode failure, pass through as-is.
        forceJson = false;
      }
    }

    if (forceJson) {
      headers = bufferedJsonHeaders(upstream);
    } else {
      headers = {};
      for (const [k, v] of Object.entries(upstream.headers)) {
        if (v !== undefined) headers[k] = v;
      }
    }
    // Full body is buffered; never emit Content-Length together with chunked TE.
    delete headers["transfer-encoding"];
    if (forceJson) delete headers["connection"];
    headers["content-length"] = outBody.byteLength;
    res.writeHead(upstream.statusCode ?? 200, headers);
    res.end(outBody);

    let outcome: "ok" | "error" = "ok";
    let errorDetail: string | undefined;
    let tables: string[] | undefined;
    try {
      const sniffType = forceJson ? "application/json" : contentType;
      if (sniffType.includes("application/json")) {
        const parsed = JSON.parse(outBody.toString()) as Record<string, unknown>;
        if (parsed.error || (parsed.result as Record<string, unknown> | undefined)?.isError) {
          outcome = "error";
          errorDetail = JSON.stringify(parsed.error ?? (parsed.result as Record<string, unknown>)?.content);
        }
      }
    } catch {
      // best-effort sniff; don't fail the request
    }

    // Extract tables for logging (best-effort)
    let sourceRefs: SourceRef[] = [];
    if (toolName) {
      try {
        const extracted = await extractTables(toolName, toolArgs);
        const merged = new Set([...extracted, ...queryTables]);
        if (merged.size > 0) tables = [...merged];
      } catch {
        // don't fail the request
      }
      if (!tables && queryTables.length > 0) tables = queryTables;

      // Structured source normalization for access_log_sources (best-effort, never blocks the response).
      // kx_catalog is handled by its own local-response branch above and never reaches here.
      try {
        const structuredRefs = await extractSourceRefs(toolName, toolArgs);
        const coveredTables = new Set(structuredRefs.map((ref) => ref.physicalTable));
        const fallbackTables = queryTables.filter((table) => !coveredTables.has(table));
        const fallbackRefs = fallbackTables.length > 0 ? await resolveSourceRefsForTables(fallbackTables) : [];
        sourceRefs = [...structuredRefs, ...fallbackRefs];
      } catch {
        // source normalization is best-effort; never block the response
      }
    }

    const responseMeta = responseAuditMeta(responseBody, upstream.headers["content-type"]);
    recordRequestAudit({
      ts: new Date().toISOString(),
      userId: identity.userId,
      client: identity.client,
      tool: toolName ?? "tools/call",
      tables,
      argsSummary,
      ...queryMeta,
      outcome,
      errorDetail,
      durationMs: Date.now() - start,
      ...responseMeta,
      requestId,
      ...requestMeta,
      ...(await auditMeta(identity, outcome === "ok" ? "allowed" : "upstream_error")),
    }, outcome === "ok" ? sourceRefs : undefined);
    recordMcpTraceForTool({
      traceId,
      identity,
      toolName: toolName ?? "tools/call",
      status: outcome,
      startedAt: new Date(start).toISOString(),
      turnId: requestMeta.lucyTurnId ?? null,
      sessionId: requestMeta.lucySessionId ?? null,
      requestId,
      argsSummary,
      allowed: true,
      reason: outcome === "ok" ? "allowed" : "upstream_error",
      resultSnapshot: resultSnapshotFromAuditMeta(responseMeta),
      sourceRefs: sourceRefs.length > 0 ? sourceRefs : null
    });
  } else {
    pipeResponse(upstream, res);
    if (rpcMethod) {
      recordRequestAudit({
        ts: new Date().toISOString(),
        userId: identity.userId,
        client: identity.client,
        tool: rpcMethod,
        outcome: "ok",
        durationMs: Date.now() - start,
        requestId,
        ...requestMeta,
        ...(await auditMeta(identity, "allowed")),
      });
    }
  }
}

async function handlePassthrough(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const sessionId = normalizeHeader(req.headers["mcp-session-id"]);
  const identify = await identifyRequestDetailed(req.headers.authorization, sessionId);
  if (!identify.ok) {
    recordAuthFailure(req, identify);
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }
  const upstream = await forwardToKtx(req.method ?? "GET", req.url ?? "/mcp", req.headers);
  pipeResponse(upstream, res);
}

/**
 * V5 — lucy-skills passthrough.
 * Routes requests hitting `/mcp/skills*` to the lucy-skills upstream
 * (default 127.0.0.1:7881). Strips the `/mcp/skills` prefix so the upstream
 * sees a normal `/mcp` path. No KTX-specific post-processing (no
 * instructions injection, no ACL, no audit/trace write — those are
 * KTX-shaped and would produce noise for a read-only resources server).
 *
 * To be revisited: if skills need trace evidence or ACL, fold them in here.
 */
async function handleSkillsPassthrough(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const sessionId = normalizeHeader(req.headers["mcp-session-id"]);
  const identify = await identifyRequestDetailed(req.headers.authorization, sessionId);
  if (!identify.ok) {
    recordAuthFailure(req, identify);
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }
  // Read body so we can forward POST content (MCP JSON-RPC envelope).
  // GET / DELETE have no body; readBody returns empty Buffer either way.
  const body = await readBody(req);
  // /mcp/skills → /mcp, /mcp/skills/ → /mcp/, /mcp/skills/v1/foo → /mcp/v1/foo
  const originalUrl = req.url ?? "/mcp/skills";
  const upstreamUrl = originalUrl.replace(/^\/mcp\/skills(?=\/|$)/, "/mcp") || "/mcp";
  const upstream = await forwardToUpstream(
    { host: LUCY_SKILLS_HOST, port: LUCY_SKILLS_PORT },
    req.method ?? "GET",
    upstreamUrl,
    req.headers,
    body.byteLength > 0 ? body : undefined,
    "lucy-skills"
  );
  pipeResponse(upstream, res);
}

function isSkillsPath(url: string | undefined): boolean {
  if (!url) return false;
  // Strip query string for the match
  const path = url.split("?")[0];
  return path === LUCY_SKILLS_PATH_PREFIX || path.startsWith(`${LUCY_SKILLS_PATH_PREFIX}/`);
}

function normalizeHeader(v: string | string[] | undefined): string | undefined {
  if (!v) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

export function buildProxy() {
  const port = Number(process.env.LUCY_PROXY_PORT ?? 7879);
  const host = process.env.LUCY_PROXY_HOST ?? "127.0.0.1";

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      if (isSkillsPath(req.url)) {
        await handleSkillsPassthrough(req, res);
      } else if (req.method === "POST") {
        await handlePost(req, res);
      } else {
        await handlePassthrough(req, res);
      }
    } catch (err) {
      if (!res.headersSent) {
        const statusCode = err instanceof BodyTooLargeError ? err.statusCode : 502;
        const detail = err instanceof BodyTooLargeError ? err.message : "Upstream unavailable";
        res.writeHead(statusCode, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Proxy error", detail }));
      }
    }
  });

  return { server, host, port };
}
