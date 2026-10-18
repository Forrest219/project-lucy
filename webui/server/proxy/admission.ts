import type { IncomingMessage, ServerResponse } from "node:http";
import { resolveAdmissionSubject, type AdmissionSubject } from "./acl.js";
import { writeAuthFailureLog, type writeLog } from "./audit.js";
import { identifyRequestDetailed, type Identity } from "./identity.js";
import { extractRequestClientMeta } from "./request-client-meta.js";
/**
 * T04-1 / Spec §3.3 — the single MCP admission gate.
 *
 * Every request that reaches the proxy is shaped, origin-checked and
 * authenticated here before any handler reads content or forwards upstream:
 * path/method allowlist → Origin → Bearer (revoked / expired) → Agent enabled →
 * role resolution → single JSON-RPC envelope.
 * Spec 175 removes the deployment-license step.
 * A request that fails any step is answered here and is never forwarded, so
 * the internal upstream Token cannot be attached to an unvetted request.
 *
 * Session ownership (T04-2) and the revocation send barrier (T04-3) are out of
 * scope; `sessionId` is only used for client-name attribution, never as auth.
 */

export const MCP_UPSTREAM_PATH = "/mcp";
const MCP_PATH = "/mcp";
const SKILLS_PATH = "/mcp/skills";
const MCP_METHODS: ReadonlySet<string> = new Set(["POST", "GET", "DELETE"]);
const ALLOW_HEADER = "POST, GET, DELETE";

/** JSON-RPC methods the gateway knows how to authorize or hand to the upstream. */
const ALLOWED_RPC_METHODS: ReadonlySet<string> = new Set([
  "initialize",
  "ping",
  "notifications/initialized",
  "notifications/cancelled",
  "tools/list",
  "tools/call",
  "resources/list",
  "resources/templates/list",
  "resources/read",
  "prompts/list",
  "prompts/get"
]);

export type McpRoute = "mcp" | "skills";

export type AdmissionAuditEntry = Parameters<typeof writeLog>[0];

/** Audit hooks owned by the proxy; injected so admission does not import it. */
export interface AdmissionAudit {
  record(entry: AdmissionAuditEntry): void;
  meta(identity: Identity, decisionReason: string): Promise<Partial<AdmissionAuditEntry>>;
  correlation(headers: IncomingMessage["headers"]): Partial<AdmissionAuditEntry>;
}

export type AdmittedRequest = {
  ok: true;
  route: McpRoute;
  identity: Identity;
  /** Role Set and legacy direct-allow facts for T05's context gate. */
  subject: AdmissionSubject;
  /** Raw request body (empty for GET/DELETE). */
  body: Buffer;
};

export type AdmissionOutcome = AdmittedRequest | { ok: false };

export type AdmissionOptions = {
  skillsPassthroughEnabled: boolean;
  readBody: (req: IncomingMessage) => Promise<Buffer>;
};

function headerValue(value: string | string[] | undefined): string | undefined {
  if (!value) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

function classifyRoute(req: IncomingMessage): { route: McpRoute | null; pathKnown: boolean } {
  const pathname = (req.url ?? "").split("?")[0];
  if (pathname === MCP_PATH || pathname === `${MCP_PATH}/`) return { route: "mcp", pathKnown: true };
  if (pathname === SKILLS_PATH || pathname === `${SKILLS_PATH}/`) return { route: "skills", pathKnown: true };
  return { route: null, pathKnown: false };
}

function writeJson(res: ServerResponse, status: number, payload: unknown, extra: Record<string, string> = {}): number {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body), ...extra });
  res.end(body);
  return Buffer.byteLength(body);
}

function rpcError(id: string | number | null, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function originAllowed(req: IncomingMessage): boolean {
  const raw = req.headers.origin;
  if (raw === undefined) return true; // native MCP clients send no Origin; they still authenticate
  if (Array.isArray(raw)) return false;
  const origin = raw.trim();
  if (!origin || origin === "null") return false;
  const configured = (process.env.LUCY_MCP_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (configured.includes(origin.toLowerCase())) return true;
  const host = headerValue(req.headers.host)?.trim().toLowerCase();
  if (!host) return false;
  try {
    return new URL(origin).host.toLowerCase() === host;
  } catch {
    return false;
  }
}

function recordAuthFailure(req: IncomingMessage, result: Awaited<ReturnType<typeof identifyRequestDetailed>>): void {
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

type Peeked = { rpcId: string | number | null; method?: string; toolName?: string };

/** Best-effort id/method for denial responses and audit; never used for authorization. */
function peekEnvelope(body: Buffer): Peeked {
  const peeked: Peeked = { rpcId: null };
  if (body.byteLength === 0) return peeked;
  try {
    const parsed = JSON.parse(body.toString()) as { id?: unknown; method?: unknown; params?: { name?: unknown } };
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return peeked;
    if (typeof parsed.id === "string" || typeof parsed.id === "number") peeked.rpcId = parsed.id;
    if (typeof parsed.method === "string") {
      peeked.method = parsed.method;
      if (parsed.method === "tools/call" && typeof parsed.params?.name === "string") peeked.toolName = parsed.params.name;
    }
  } catch {
    // malformed JSON is reported by validateEnvelope after the identity checks
  }
  return peeked;
}

type EnvelopeCheck =
  | { ok: true; method: string }
  | { ok: false; status: number; code: number; message: string; detail: string };

/** Exactly one JSON-RPC object carrying an allowlisted method; no batch, no bare scalars. */
function validateEnvelope(body: Buffer): EnvelopeCheck {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString());
  } catch {
    return { ok: false, status: 400, code: -32700, message: "Parse error", detail: "envelope_parse_error" };
  }
  if (Array.isArray(parsed)) {
    return { ok: false, status: 400, code: -32600, message: "Invalid Request: batch is not supported", detail: "envelope_batch_rejected" };
  }
  if (!parsed || typeof parsed !== "object") {
    return { ok: false, status: 400, code: -32600, message: "Invalid Request", detail: "envelope_not_object" };
  }
  const envelope = parsed as { jsonrpc?: unknown; id?: unknown; method?: unknown };
  const idOk = envelope.id === undefined || envelope.id === null
    || typeof envelope.id === "string" || typeof envelope.id === "number";
  if (envelope.jsonrpc !== "2.0" || typeof envelope.method !== "string" || !idOk) {
    return { ok: false, status: 400, code: -32600, message: "Invalid Request", detail: "envelope_invalid" };
  }
  if (!ALLOWED_RPC_METHODS.has(envelope.method)) {
    return { ok: false, status: 404, code: -32601, message: "Method not found", detail: "envelope_method_unknown" };
  }
  return { ok: true, method: envelope.method };
}

async function denyAdmitted(
  audit: AdmissionAudit,
  req: IncomingMessage,
  res: ServerResponse,
  identity: Identity,
  denial: { status: number; code: number; message: string; detail: string },
  peeked: Peeked
): Promise<void> {
  const responseBytes = writeJson(res, denial.status, rpcError(peeked.rpcId, denial.code, denial.message));
  const network = extractRequestClientMeta(req);
  audit.record({
    ts: new Date().toISOString(),
    userId: identity.userId,
    client: identity.client,
    tool: peeked.toolName ?? peeked.method ?? req.method ?? "unknown",
    outcome: "denied",
    errorDetail: denial.detail,
    durationMs: 0,
    responseBytes,
    requestId: peeked.rpcId ?? "",
    ...audit.correlation(req.headers),
    clientIp: network.clientIp,
    clientForwardedFor: network.clientForwardedFor,
    userAgent: network.userAgent,
    ...(network.deviceName ? { deviceName: network.deviceName } : {}),
    ...(await audit.meta(identity, denial.detail))
  });
}

function accessDenied(detail: string, message = detail) {
  return { status: 403, code: -32003, message: `Access denied: ${message}`, detail };
}

export async function admitMcpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  audit: AdmissionAudit,
  options: AdmissionOptions
): Promise<AdmissionOutcome> {
  const { route } = classifyRoute(req);
  if (!route || (route === "skills" && !options.skillsPassthroughEnabled)) {
    writeJson(res, 404, { error: "Not found" });
    return { ok: false };
  }
  const httpMethod = (req.method ?? "").toUpperCase();
  if (!MCP_METHODS.has(httpMethod)) {
    writeJson(res, 405, { error: "Method not allowed" }, { allow: ALLOW_HEADER });
    return { ok: false };
  }
  if (!originAllowed(req)) {
    writeJson(res, 403, rpcError(null, -32003, "Access denied: origin_not_allowed"));
    return { ok: false };
  }

  const sessionId = headerValue(req.headers["mcp-session-id"]);
  const identify = await identifyRequestDetailed(req.headers.authorization, sessionId);
  if (!identify.ok) {
    recordAuthFailure(req, identify);
    writeJson(res, 401, rpcError(null, -32001, "Unauthorized"));
    return { ok: false };
  }
  const identity = identify.identity;

  const body = httpMethod === "POST" ? await options.readBody(req) : Buffer.alloc(0);
  const peeked = peekEnvelope(body);

  const resolved = await resolveAdmissionSubject(identity.userId);
  if (!resolved.ok) {
    const outward = resolved.reason.startsWith("role_resolution_failed") ? "role_resolution_failed" : resolved.reason;
    await denyAdmitted(audit, req, res, identity, { ...accessDenied(resolved.reason, outward) }, peeked);
    return { ok: false };
  }

  if (httpMethod === "POST") {
    const envelope = validateEnvelope(body);
    if (!envelope.ok) {
      await denyAdmitted(audit, req, res, identity, envelope, peeked);
      return { ok: false };
    }
  }

  return { ok: true, route, identity, subject: resolved.subject, body };
}
