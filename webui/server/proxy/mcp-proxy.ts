import { createHash } from "node:crypto";
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { identifyRequest, setSessionClient } from "./identity.js";
import { writeLog, writeAccessLogSources, type AccessLogSourceRecord } from "./audit.js";
import { allowedToolNames, check as aclCheck, extractTables, extractSourceRefs, resolveSourceRefsForTables, kxCatalog, permissionSnapshot, type SourceRef } from "./acl.js";

const KTX_HOST = process.env.LUCY_PROXY_UPSTREAM_HOST ?? "127.0.0.1";
const KTX_PORT = Number(process.env.LUCY_PROXY_UPSTREAM_PORT ?? 7878);
const MAX_BODY_BYTES = Number(process.env.LUCY_PROXY_MAX_BODY_BYTES ?? 1_048_576);
const UPSTREAM_TIMEOUT_MS = Number(process.env.LUCY_PROXY_UPSTREAM_TIMEOUT_MS ?? 30_000);
const SENSITIVE_ARG_KEY_RE = /(?:sql|query|password|passwd|pwd|token|secret|api[-_]?key|authorization|credential)/i;
const QUERY_KEY_RE = /^(?:sql|query)$/i;
const QUERY_TABLE_RE = /\b(?:from|join|into|update|table)\s+[`"]?([a-zA-Z_][\w]*(?:\.[a-zA-Z_][\w]*){0,2})[`"]?/gi;

function getInternalToken(): string {
  return process.env.KTX_INTERNAL_TOKEN ?? "";
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
      { hostname: KTX_HOST, port: KTX_PORT, path: url, method, headers },
      resolve
    );
    upstream.setTimeout(UPSTREAM_TIMEOUT_MS, () => {
      upstream.destroy(new Error(`KTX upstream timeout after ${UPSTREAM_TIMEOUT_MS}ms`));
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

async function auditMeta(identity: Awaited<ReturnType<typeof identifyRequest>>, decisionReason: string): Promise<Partial<Parameters<typeof writeLog>[0]>> {
  if (!identity) return { decisionReason };
  const snapshot = await permissionSnapshot(identity).catch(() => undefined);
  const tokenMeta = {
    tokenLabel: identity.tokenLabel,
    tokenHashPrefix: identity.tokenHashPrefix,
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
    description: "List the KX financial sources available to this agent. Use this before KX/company operation questions. For workhorse, use connectionId=mysql-aliyun and kx_* sources only.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  };
}

function encodeSseMessage(payload: unknown): string {
  return `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
}

function decodeSseMessage(body: string): unknown | undefined {
  const line = body.split(/\r?\n/).find((item) => item.startsWith("data: "));
  if (!line) return undefined;
  return JSON.parse(line.slice("data: ".length));
}

function filterAndAddAllowedTools(payload: unknown, visibleTools: Set<string>): unknown {
  if (!payload || typeof payload !== "object") return payload;
  const record = payload as Record<string, unknown>;
  const result = record.result as Record<string, unknown> | undefined;
  if (!result || !Array.isArray(result.tools)) return payload;
  const filteredTools = result.tools.filter((tool) => {
    if (!tool || typeof tool !== "object") return false;
    const name = (tool as Record<string, unknown>).name;
    return typeof name === "string" && visibleTools.has(name);
  });
  const hasCatalog = filteredTools.some((tool) => (tool as Record<string, unknown>).name === "kx_catalog");
  const tools = visibleTools.has("kx_catalog") && !hasCatalog
    ? [...filteredTools, kxCatalogTool()]
    : filteredTools;
  return {
    ...record,
    result: {
      ...result,
      tools
    }
  };
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
      const payload = decodeSseMessage(originalBody);
      if (!payload) throw new Error("missing SSE data frame");
      if (payload) body = encodeSseMessage(filterAndAddAllowedTools(payload, visibleTools));
    } else if (contentType.includes("application/json")) {
      body = JSON.stringify(filterAndAddAllowedTools(JSON.parse(originalBody), visibleTools));
    } else {
      throw new Error(`unsupported content-type:${contentType || "<missing>"}`);
    }
  } catch (err) {
    filterFailed = true;
    errorDetail = `tools_list_filter_failed:${err instanceof Error ? err.message : String(err)}`;
    body = JSON.stringify(toolsListErrorResponse(requestId, errorDetail));
    forceJson = true;
  }

  const headers: Record<string, string | string[] | number> = {};
  for (const [k, v] of Object.entries(upstream.headers)) {
    const lower = k.toLowerCase();
    if (v !== undefined && lower !== "content-length" && lower !== "transfer-encoding" && lower !== "content-type") headers[k] = v;
  }
  headers["content-type"] = forceJson ? "application/json" : (upstream.headers["content-type"] ?? "application/json");
  const responseBytes = Buffer.byteLength(body);
  headers["content-length"] = responseBytes;
  res.writeHead(upstream.statusCode ?? 200, headers);
  res.end(body);
  return { filterFailed, errorDetail, responseBytes };
}

async function handlePost(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const sessionId = normalizeHeader(req.headers["mcp-session-id"]);
  const identity = await identifyRequest(req.headers.authorization, sessionId);
  const requestMeta = correlationMeta(req.headers);
  if (!identity) {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null }));
    return;
  }

  const body = await readBody(req);
  const start = Date.now();

  let rpcMethod: string | undefined;
  let toolName: string | undefined;
  let toolArgs: unknown;
  let requestId: string | number = "";
  let argsSummary: Record<string, unknown> | undefined;
  let queryMeta: Partial<Parameters<typeof writeLog>[0]> = {};
  let queryTables: string[] = [];

  try {
    const parsed = JSON.parse(body.toString()) as Record<string, unknown>;
    rpcMethod = parsed.method as string | undefined;
    requestId = (parsed.id as string | number | undefined) ?? "";

    if (rpcMethod === "initialize") {
      const clientInfo = (parsed.params as Record<string, unknown> | undefined)?.clientInfo as Record<string, unknown> | undefined;
      if (clientInfo?.name && sessionId) {
        setSessionClient(sessionId, identity.userId, identity.tokenLabel, String(clientInfo.name));
      }
    }

    if (rpcMethod === "tools/call") {
      const params = parsed.params as Record<string, unknown> | undefined;
      toolName = params?.name as string | undefined;
      toolArgs = params?.arguments;
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
      recordAudit({
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
      return;
    }
    if (toolName === "kx_catalog") {
      const data = await kxCatalog(identity);
      const responseBody = JSON.stringify({
        jsonrpc: "2.0",
        id: requestId,
        result: {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }]
        }
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(responseBody);
      recordAudit({
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
      return;
    }
  }

  const upstream = await forwardToKtx(req.method ?? "POST", req.url ?? "/mcp", req.headers, body);

  if (rpcMethod === "tools/list") {
    const toolsList = await writeToolsListResponse(identity, upstream, res, requestId);
    recordAudit({
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

  // For tool calls: sniff the response to detect errors; for others: pipe directly
  if (rpcMethod === "tools/call") {
    const responseHeaders: Record<string, string | string[] | number> = {};
    for (const [k, v] of Object.entries(upstream.headers)) {
      if (v !== undefined) responseHeaders[k] = v;
    }
    res.writeHead(upstream.statusCode ?? 200, responseHeaders);

    const chunks: Buffer[] = [];
    for await (const chunk of upstream as AsyncIterable<Buffer>) {
      chunks.push(chunk);
      res.write(chunk);
    }
    res.end();
    const responseBody = Buffer.concat(chunks);

    let outcome: "ok" | "error" = "ok";
    let errorDetail: string | undefined;
    let tables: string[] | undefined;
    try {
      const contentType = upstream.headers["content-type"] ?? "";
      if (contentType.includes("application/json")) {
        const parsed = JSON.parse(responseBody.toString()) as Record<string, unknown>;
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

    recordAudit({
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
      ...responseAuditMeta(responseBody, upstream.headers["content-type"]),
      requestId,
      ...requestMeta,
      ...(await auditMeta(identity, outcome === "ok" ? "allowed" : "upstream_error")),
    }, outcome === "ok" ? sourceRefs : undefined);
  } else {
    pipeResponse(upstream, res);
    if (rpcMethod) {
      recordAudit({
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
  const identity = await identifyRequest(req.headers.authorization, sessionId);
  if (!identity) {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }
  const upstream = await forwardToKtx(req.method ?? "GET", req.url ?? "/mcp", req.headers);
  pipeResponse(upstream, res);
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
      if (req.method === "POST") {
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
