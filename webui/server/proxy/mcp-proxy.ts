import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { identifyRequest, setSessionClient } from "./identity.js";
import { writeLog } from "./audit.js";
import { check as aclCheck, extractTables, kxCatalog } from "./acl.js";

const KTX_HOST = process.env.LUCY_PROXY_UPSTREAM_HOST ?? "127.0.0.1";
const KTX_PORT = Number(process.env.LUCY_PROXY_UPSTREAM_PORT ?? 7878);
const MAX_BODY_BYTES = Number(process.env.LUCY_PROXY_MAX_BODY_BYTES ?? 1_048_576);
const UPSTREAM_TIMEOUT_MS = Number(process.env.LUCY_PROXY_UPSTREAM_TIMEOUT_MS ?? 30_000);
const SENSITIVE_ARG_KEY_RE = /(?:sql|query|password|passwd|pwd|token|secret|api[-_]?key|authorization|credential)/i;

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
      if (lower === "authorization" || lower === "host") continue;
      headers[k] = v;
    }
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

function recordAudit(entry: Parameters<typeof writeLog>[0]): void {
  writeLog(entry).catch((err) => {
    console.error("[lucy-proxy] failed to write audit log", err);
  });
}

function summarizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(args)
      .filter(([k]) => !SENSITIVE_ARG_KEY_RE.test(k))
      .slice(0, 8)
  );
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

function addCatalogTool(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return payload;
  const record = payload as Record<string, unknown>;
  const result = record.result as Record<string, unknown> | undefined;
  if (!result || !Array.isArray(result.tools)) return payload;
  if (result.tools.some((tool) => tool && typeof tool === "object" && (tool as Record<string, unknown>).name === "kx_catalog")) {
    return payload;
  }
  return {
    ...record,
    result: {
      ...result,
      tools: [...result.tools, kxCatalogTool()]
    }
  };
}

async function writeToolsListResponse(upstream: IncomingMessage, res: ServerResponse): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of upstream as AsyncIterable<Buffer>) {
    chunks.push(chunk);
  }

  const originalBody = Buffer.concat(chunks).toString();
  const contentType = String(upstream.headers["content-type"] ?? "");
  let body = originalBody;
  try {
    if (contentType.includes("text/event-stream")) {
      const payload = decodeSseMessage(originalBody);
      if (payload) body = encodeSseMessage(addCatalogTool(payload));
    } else if (contentType.includes("application/json")) {
      body = JSON.stringify(addCatalogTool(JSON.parse(originalBody)));
    }
  } catch {
    body = originalBody;
  }

  const headers: Record<string, string | string[] | number> = {};
  for (const [k, v] of Object.entries(upstream.headers)) {
    if (v !== undefined && k.toLowerCase() !== "content-length") headers[k] = v;
  }
  headers["content-length"] = Buffer.byteLength(body);
  res.writeHead(upstream.statusCode ?? 200, headers);
  res.end(body);
}

async function handlePost(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const sessionId = normalizeHeader(req.headers["mcp-session-id"]);
  const identity = await identifyRequest(req.headers.authorization, sessionId);
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
    }
  } catch {
    // non-JSON body; proxy as-is
  }

  // ACL check for tool calls
  if (rpcMethod === "tools/call" && toolName) {
    const decision = await aclCheck(identity, toolName, toolArgs);
    if (!decision.allowed) {
      const errorMsg = decision.reason ?? "denied";
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id: requestId,
        result: {
          isError: true,
          content: [{ type: "text", text: `Access denied: ${errorMsg}` }]
        }
      }));
      recordAudit({
        ts: new Date().toISOString(),
        userId: identity.userId,
        client: identity.client,
        tool: toolName,
        argsSummary,
        outcome: "denied",
        errorDetail: errorMsg,
        durationMs: Date.now() - start,
        requestId,
      });
      return;
    }
    if (toolName === "kx_catalog") {
      const data = await kxCatalog(identity);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id: requestId,
        result: {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }]
        }
      }));
      recordAudit({
        ts: new Date().toISOString(),
        userId: identity.userId,
        client: identity.client,
        tool: toolName,
        argsSummary,
        outcome: "ok",
        durationMs: Date.now() - start,
        requestId,
      });
      return;
    }
  }

  const upstream = await forwardToKtx(req.method ?? "POST", req.url ?? "/mcp", req.headers, body);

  if (rpcMethod === "tools/list") {
    await writeToolsListResponse(upstream, res);
    recordAudit({
      ts: new Date().toISOString(),
      userId: identity.userId,
      client: identity.client,
      tool: rpcMethod,
      outcome: "ok",
      durationMs: Date.now() - start,
      requestId,
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

    let outcome: "ok" | "error" = "ok";
    let errorDetail: string | undefined;
    let tables: string[] | undefined;
    try {
      const contentType = upstream.headers["content-type"] ?? "";
      if (contentType.includes("application/json")) {
        const parsed = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
        if (parsed.error || (parsed.result as Record<string, unknown> | undefined)?.isError) {
          outcome = "error";
          errorDetail = JSON.stringify(parsed.error ?? (parsed.result as Record<string, unknown>)?.content);
        }
      }
    } catch {
      // best-effort sniff; don't fail the request
    }

    // Extract tables for logging (best-effort)
    if (toolName) {
      try {
        const extracted = await extractTables(toolName, toolArgs);
        if (extracted.length > 0) tables = extracted;
      } catch {
        // don't fail the request
      }
    }

    recordAudit({
      ts: new Date().toISOString(),
      userId: identity.userId,
      client: identity.client,
      tool: toolName ?? "tools/call",
      tables,
      argsSummary,
      outcome,
      errorDetail,
      durationMs: Date.now() - start,
      requestId,
    });
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
