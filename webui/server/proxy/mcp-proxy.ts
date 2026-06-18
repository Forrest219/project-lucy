import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { identifyRequest, setSessionClient } from "./identity.js";
import { writeLog } from "./audit.js";

const KTX_HOST = "127.0.0.1";
const KTX_PORT = 7878;

function getInternalToken(): string {
  return process.env.KTX_INTERNAL_TOKEN ?? "";
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
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
    upstream.on("error", reject);
    if (body) upstream.end(body);
    else upstream.end();
  });
}

function pipeResponse(upstream: IncomingMessage, res: ServerResponse): void {
  const headers: Record<string, string | string[] | number> = {};
  for (const [k, v] of Object.entries(upstream.headers)) {
    if (v !== undefined) headers[k] = v;
  }
  res.writeHead(upstream.statusCode ?? 200, headers);
  upstream.pipe(res);
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
  let requestId: string | number = "";
  let argsSummary: Record<string, unknown> | undefined;

  try {
    const parsed = JSON.parse(body.toString()) as Record<string, unknown>;
    rpcMethod = parsed.method as string | undefined;
    requestId = (parsed.id as string | number | undefined) ?? "";

    if (rpcMethod === "initialize") {
      const clientInfo = (parsed.params as Record<string, unknown> | undefined)?.clientInfo as Record<string, unknown> | undefined;
      if (clientInfo?.name && sessionId) {
        setSessionClient(sessionId, String(clientInfo.name));
      }
    }

    if (rpcMethod === "tools/call") {
      const params = parsed.params as Record<string, unknown> | undefined;
      toolName = params?.name as string | undefined;
      const args = params?.arguments as Record<string, unknown> | undefined;
      if (args) {
        // Keep only a safe subset of args for logging
        argsSummary = Object.fromEntries(
          Object.entries(args)
            .filter(([k]) => !["sql", "query"].includes(k))
            .slice(0, 8)
        );
      }
    }
  } catch {
    // non-JSON body; proxy as-is
  }

  const upstream = await forwardToKtx(req.method ?? "POST", req.url ?? "/mcp", req.headers, body);

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

    writeLog({
      ts: new Date().toISOString(),
      userId: identity.userId,
      client: identity.client,
      tool: toolName ?? "tools/call",
      argsSummary,
      outcome,
      errorDetail,
      durationMs: Date.now() - start,
      requestId,
    }).catch(() => undefined);
  } else {
    pipeResponse(upstream, res);
    if (rpcMethod) {
      writeLog({
        ts: new Date().toISOString(),
        userId: identity.userId,
        client: identity.client,
        tool: rpcMethod,
        outcome: "ok",
        durationMs: Date.now() - start,
        requestId,
      }).catch(() => undefined);
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

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      if (req.method === "POST") {
        await handlePost(req, res);
      } else {
        await handlePassthrough(req, res);
      }
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(502, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Proxy error", detail: String(err) }));
      }
    }
  });

  return { server, port };
}
