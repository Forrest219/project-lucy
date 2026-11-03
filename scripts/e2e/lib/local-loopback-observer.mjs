// Real loopback transparent forwarding observer (Spec §6.2, §8.1; A4/C1 binding).
//
// This is the ACTUAL observer implementation, not a callback-only contract.
// It runs a local HTTP(S) proxy that:
//
//   1. accepts MCP / KTX traffic on a dedicated loopback port (`listenHost:listenPort`);
//   2. forwards every accepted request to the registered upstream URL (`upstreamUrl`)
//      using `node:http`/`node:https`;
//   3. streams the upstream response back to the caller byte-for-byte — no rewriting,
//      no shortcut, no synthesized answer;
//   4. records each completed forward (request line, headers, sanitized body, response
//      status, response headers, response body) into an in-memory record set, bound to
//      the run / instance / agent / token fingerprint / correlation id / window;
//   5. exposes `observeUpstream({ since, until, agentId, tokenFingerprint })` which
//      returns the count of completed upstream forwards in that window that match the
//      given agent/token.
//
// The control plane (binding, port selection, lifecycle) is owned by the runner. The
// observer client never sees the upstream URL or the privileged credentials; the Lucy
// instance connects only to the loopback port. The `src/origin` header (an added
// correlation id) and `x-lucy-observer-runid` / `x-lucy-observer-instanceid` headers
// (forwarded untouched to the upstream) bind the recording to the parent run.
//
// This module is intentionally NOT mocked. The integration test under
// `__tests__/local-loopback-observer.test.mjs` spins up a real loopback HTTP upstream
// and a real listener on a random port and exercises the real forwarding path. A
// malformed request, an unexpected upstream reply and a denied request are all
// observed and counted; the agent / token fingerprint filter does not count
// cross-identity traffic.

import { createHash, randomUUID } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";

const DEFAULT_BODY_LIMIT_BYTES = 16 * 1024 * 1024; // 16 MiB cap; payloads larger than this are recorded as a refusal, never truncated silently.

/** Strip a header value of any control characters and bound the length so a forged upstream reply cannot poison the record set. */
function sanitizeHeader(value, max = 512) {
  if (typeof value !== "string") return null;
  const stripped = value.replace(/[\u0000-\u001f\u007f]/g, "");
  return stripped.length > max ? stripped.slice(0, max) : stripped;
}

/** SHA-256 of the canonical UTF-8 JSON representation. `undefined` -> null. */
function hashHex(value) {
  if (value === undefined || value === null) return null;
  return createHash("sha256").update(String(value)).digest("hex");
}

/** Hash the body bytes the same way the durable audit ledger would; null when no body was sent. */
function hashBody(body) {
  if (body === undefined || body === null || body === "") return null;
  if (Buffer.isBuffer(body)) return createHash("sha256").update(body).digest("hex");
  if (typeof body === "string") return createHash("sha256").update(body, "utf8").digest("hex");
  return null;
}

/**
 * The upstream tool names that constitute a DATA-PLANE upstream call: a call that
 * actually reaches the upstream's data layer. Everything else on the MCP wire
 * (`initialize`, `tools/list`, notifications) is protocol chatter: counting it as an
 * "execution" would let a session setup masquerade as an unauthorized upstream
 * execution, and would make every zero-assertion fail for the wrong reason.
 *
 * Both name families are recognised because the observer can sit on either side of
 * the Lucy wrapper: `lucy_*` is what a client asks Lucy for, `sl_*` is what Lucy
 * asks the KTX upstream for (see `webui/server/proxy/mcp-proxy.ts` → `upstreamTool`).
 */
export const DATA_PLANE_QUERY_TOOLS = new Set(["sl_query", "lucy_query"]);
export const DATA_PLANE_SOURCE_TOOLS = new Set(["sl_read_source", "lucy_read_source"]);

/**
 * Classify one forwarded upstream request by what it actually asked for.
 *
 * The classification looks ONLY at the JSON-RPC envelope (method + tool name). It
 * never inspects the tool arguments and never records them, so it cannot leak query
 * content into the record set.
 *
 * @param {Buffer|undefined|null} bodyBytes the raw forwarded body.
 * @returns {{kind: "query"|"source_read"|"other_tool"|"control"|"unknown", toolName: string|null, method: string|null}}
 */
export function classifyUpstreamCall(bodyBytes) {
  if (!bodyBytes || bodyBytes.length === 0) return { kind: "control", toolName: null, method: null };
  let parsed;
  try {
    parsed = JSON.parse(bodyBytes.toString("utf8"));
  } catch {
    return { kind: "unknown", toolName: null, method: null };
  }
  const messages = Array.isArray(parsed) ? parsed : [parsed];
  let firstMethod = null;
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const method = typeof message.method === "string" ? message.method : null;
    if (method && !firstMethod) firstMethod = method;
    if (method !== "tools/call") continue;
    const name = typeof message.params?.name === "string" ? message.params.name : null;
    if (name && DATA_PLANE_QUERY_TOOLS.has(name)) return { kind: "query", toolName: name, method };
    if (name && DATA_PLANE_SOURCE_TOOLS.has(name)) return { kind: "source_read", toolName: name, method };
    return { kind: "other_tool", toolName: name, method };
  }
  return { kind: "control", toolName: null, method: firstMethod };
}

/** Parse a Content-Length header. Returns 0 when absent or unparseable. */
function parseContentLength(headers) {
  const raw = headers?.["content-length"];
  if (Array.isArray(raw)) return Number(raw[0]) || 0;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * Drain a stream into a Buffer. The stream is closed with an error if it exceeds
 * `bodyLimitBytes` so an upstream that streams forever cannot exhaust the recorder's
 * memory. The returned promise never resolves with a partial body: either the whole
 * body arrives within the limit, or the promise rejects with `code: "BODY_TOO_LARGE"`.
 */
function drainBody(stream, contentLength, bodyLimitBytes) {
  return new Promise((resolve, reject) => {
    const declared = parseContentLength({ "content-length": contentLength });
    if (declared > bodyLimitBytes) {
      stream.destroy(new Error("declared Content-Length exceeds observer body limit"));
      reject(Object.assign(new Error("BODY_TOO_LARGE"), { code: "BODY_TOO_LARGE" }));
      return;
    }
    const chunks = [];
    let received = 0;
    let aborted = false;
    stream.on("data", (chunk) => {
      received += chunk.length;
      if (received > bodyLimitBytes) {
        aborted = true;
        stream.destroy(new Error("BODY_TOO_LARGE"));
        reject(Object.assign(new Error("BODY_TOO_LARGE"), { code: "BODY_TOO_LARGE" }));
        return;
      }
      chunks.push(chunk);
    });
    stream.on("end", () => {
      if (!aborted) resolve(Buffer.concat(chunks));
    });
    stream.on("error", (err) => {
      if (!aborted) reject(err);
    });
  });
}

/**
 * Active observer. The `observeUpstream` closure returned to the runner filters the
 * completed record set by the agent/token fingerprint identity and returns the raw
 * upstream execution count for the window.
 */
export class LocalLoopbackObserver {
  /**
   * @param {Object} args
   * @param {string} args.runId
   * @param {string|null} args.instanceId
   * @param {string} args.upstreamUrl       the registered upstream the Lucy instance talks to (loopback or remote)
   * @param {string} [args.listenHost]      defaults to 127.0.0.1
   * @param {number} [args.listenPort]      defaults to 0 (random port)
   * @param {Object} [args.upstreamHeaders] static headers added to every forwarded request (privileged credentials)
   * @param {number} [args.bodyLimitBytes]  cap on the recorded request / response body
   * @param {number} [args.timeoutMs]       timeout for the upstream forwarded request
   */
  constructor({ runId, instanceId, upstreamUrl, listenHost = "127.0.0.1", listenPort = 0, upstreamHeaders = {}, bodyLimitBytes = DEFAULT_BODY_LIMIT_BYTES, timeoutMs = 30_000 }) {
    if (!runId) throw new Error("LocalLoopbackObserver: runId is required");
    if (!upstreamUrl) throw new Error("LocalLoopbackObserver: upstreamUrl is required");
    let parsed;
    try { parsed = new URL(upstreamUrl); } catch { throw new Error(`LocalLoopbackObserver: upstreamUrl must be a valid URL (got ${JSON.stringify(upstreamUrl)})`); }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error(`LocalLoopbackObserver: upstreamUrl protocol must be http(s) (got ${parsed.protocol})`);
    this._runId = runId;
    this._instanceId = instanceId ?? null;
    this._upstreamUrl = parsed;
    this._listenHost = listenHost;
    this._listenPort = listenPort;
    this._upstreamHeaders = { ...upstreamHeaders };
    this._bodyLimitBytes = bodyLimitBytes;
    this._timeoutMs = timeoutMs;
    this._records = [];
    this._server = null;
    this._started = false;
    this._closed = false;
  }

  /** Start the loopback listener. Resolves with the actual bound port. */
  async start() {
    if (this._started) throw new Error("LocalLoopbackObserver: already started");
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => this._handle(req, res).catch((error) => {
        // The handler always replies; if it throws, close the connection so a buggy
        // forward does not hang the runner.
        try { res.statusCode = 502; res.end(`observer handler error: ${error?.message ?? error}`); } catch { /* ignore */ }
      }));
      server.once("error", reject);
      server.listen(this._listenPort, this._listenHost, () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          reject(new Error("LocalLoopbackObserver: failed to read listener address"));
          return;
        }
        this._server = server;
        this._started = true;
        resolve({ host: address.address, port: address.port });
      });
    });
  }

  /** The loopback URL the upstream proxy is reachable at. Throws if the observer is not started. */
  baseUrl() {
    if (!this._started || !this._server) throw new Error("LocalLoopbackObserver: not started");
    const address = this._server.address();
    return `http://${address.address}:${address.port}`;
  }

  /** Return a snapshot of all completed records. For tests + A7 collector handoff. */
  records() {
    return [...this._records];
  }

  /**
   * The runner-facing observer closure. The returned function takes
   * `{ since, until, agentId, tokenFingerprint }` and yields the number of upstream
   * forwards completed inside that window matching the identity filter, plus the
   * record set itself (the verifier hashes the record set to prove the source
   * actually executed the queries).
   */
  observeUpstream({ since, until, agentId, tokenFingerprint, identity = "lucy-e2e-observer" } = {}) {
    const problems = [];
    const start = since ? Date.parse(since) : NaN;
    const end = until ? Date.parse(until) : NaN;
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      problems.push("pass-through observer received an invalid time window");
      return { count: "unknown", source: "loopback-observer", recordSet: [], problems };
    }
    if (!agentId) problems.push("agentId is required");
    if (!tokenFingerprint) problems.push("tokenFingerprint is required");
    // A missing identity input is a REFUSED measurement, not a measured zero: an
    // empty record set here would be indistinguishable from "the upstream really
    // executed nothing".
    if (problems.length > 0) {
      return { count: "unknown", source: "loopback-observer", recordSet: [], problems };
    }
    const inWindow = this._records.filter((r) => {
      const at = Date.parse(r.completedAt);
      if (!Number.isFinite(at) || at < start || at > end) return false;
      return true;
    });
    // The identity filter is only MEANINGFUL when the upstream actually carries an
    // identity. The product deliberately strips the client credential before the
    // upstream boundary, so a real Lucy → KTX path records NO agent identity at all.
    // Filtering by an identity that no record carries would silently produce a
    // vacuous zero — the exact "friendly default" this harness must never emit. So:
    //   - when some records DO carry an identity → filter by it (cross-identity
    //     traffic is excluded, as before);
    //   - when NO record carries one → count instance-wide and say so, via
    //     `attribution: "instance-wide"`. The caller decides whether an
    //     instance-wide measurement is acceptable for its claim.
    const identityBearing = inWindow.filter((r) => r.identity?.agentId || r.identity?.tokenFingerprint);
    const identityFilterApplied = identityBearing.length > 0;
    const records = identityFilterApplied
      ? inWindow.filter((r) => {
          // A missing agent / token header on the recorded forward is NEVER a match
          // when the caller asked for a specific identity. This is what stops a
          // `tools/list` self-probe from inflating the count for a real agent.
          if (agentId) {
            if (!r.identity?.agentId) return false;
            if (r.identity.agentId !== agentId) return false;
          }
          if (tokenFingerprint) {
            if (!r.identity?.tokenFingerprint) return false;
            if (r.identity.tokenFingerprint !== tokenFingerprint) return false;
          }
          return true;
        })
      : inWindow;
    // An "upstream execution" is a TOOL CALL that reached the upstream. `initialize`
    // / `tools/list` / notifications are protocol chatter and are excluded — counting
    // them would let a session setup masquerade as an unauthorized upstream execution.
    // Every forwarded `tools/call` counts, whatever tool it is: the claim the security
    // leg makes is about upstream CALLS, not about a specific tool.
    const dataPlane = records.filter((r) => r.kind === "query" || r.kind === "source_read" || r.kind === "other_tool");
    const count = dataPlane.length;
    return {
      count,
      source: "loopback-observer",
      attribution: identityFilterApplied ? "identity-filtered" : "instance-wide",
      identityFilterApplied,
      upstreamCallCount: records.length,
      controlCallCount: records.filter((r) => r.kind === "control").length,
      queryCount: records.filter((r) => r.kind === "query").length,
      sourceReadCount: records.filter((r) => r.kind === "source_read").length,
      // What the upstream actually received, in order. This is what makes the measured
      // baseline auditable: the evidence shows the real tool calls, not just a number.
      recordToolNames: dataPlane.map((r) => ({ kind: r.kind, toolName: r.toolName, status: r.response.status })),
      recordSet: dataPlane.map((r) => ({
        recordId: r.recordId,
        completedAt: r.completedAt,
        request: { method: r.request.method, path: r.request.path, headers: r.request.headers, bodyHash: r.request.bodyHash, bodyBytes: r.request.bodyBytes },
        response: { status: r.response.status, headers: r.response.headers, bodyHash: r.response.bodyHash, bodyBytes: r.response.bodyBytes },
        identity: r.identity,
        kind: r.kind,
        toolName: r.toolName,
        upstreamSessionId: r.upstreamSessionId,
        identityFilter: { agentId, tokenFingerprint }
      })),
      hashes: {
        queryHash: hashHex(JSON.stringify({ agentId, tokenFingerprint, since, until, identity })),
        resultSetHash: hashHex(JSON.stringify(dataPlane.map((r) => r.recordId).sort())),
        sourceHash: hashHex(`loopback-observer|${this._runId}|${this._instanceId ?? ""}|${identity}`),
        filterHash: hashHex(`${agentId}|${tokenFingerprint}|${since}|${until}`)
      },
      problems
    };
  }

  /** Stop the listener and release the port. Idempotent. */
  async stop() {
    if (this._closed || !this._server) return;
    this._closed = true;
    return new Promise((resolve) => {
      this._server.close(() => resolve());
      // Force-close any keep-alive sockets after a short grace period.
      setTimeout(() => {
        try { this._server?.closeAllConnections?.(); } catch { /* ignore */ }
        resolve();
      }, 250).unref?.();
    });
  }

  /** Handle one inbound HTTP request. Forwards to the upstream URL and records the result. */
  async _handle(req, res) {
    const correlationId = sanitizeHeader(req.headers["x-lucy-observer-correlation-id"]) ?? randomUUID();
    const startedAt = new Date();
    const upstreamMethod = req.method ?? "GET";
    const upstreamPath = req.url ?? "/";
    const inboundHeaders = {};
    for (const [name, value] of Object.entries(req.headers)) {
      if (name.startsWith("x-lucy-observer-")) continue;
      const sanitized = sanitizeHeader(value);
      if (sanitized !== null) inboundHeaders[name] = sanitized;
    }
    // The recorded identity is taken from headers the privileged upstream (or the Lucy
    // MCP gateway) forwards, NOT from client self-claims. The observer trusts the
    // parent binding context (run/instance) — see `x-lucy-observer-runid` / `x-lucy-observer-instanceid`.
    const identity = {
      agentId: sanitizeHeader(req.headers["x-lucy-observer-agentid"]) ?? null,
      tokenFingerprint: sanitizeHeader(req.headers["x-lucy-observer-tokenfingerprint"]) ?? null,
      sessionId: sanitizeHeader(req.headers["x-lucy-observer-sessionid"]) ?? null,
      correlationId
    };
    let requestBodyBytes;
    try {
      requestBodyBytes = await drainBody(req, req.headers["content-length"], this._bodyLimitBytes);
    } catch (error) {
      res.statusCode = 413;
      res.setHeader("content-type", "text/plain");
      res.end(`observer refused request body: ${error.message}`);
      this._recordRefusal({ startedAt, correlationId, upstreamMethod, upstreamPath, inboundHeaders, identity, reason: error.message });
      return;
    }
    const forwardedHeaders = { ...inboundHeaders, ...this._upstreamHeaders, "x-lucy-observer-correlation-id": correlationId };
    // What the forwarded call actually asked for: the tool name only, never the
    // arguments, so the record set cannot carry query content.
    const classification = classifyUpstreamCall(requestBodyBytes);
    // The upstream MCP session the call rode on. The product assigns one upstream
    // session per (Agent, Token) identity and strips the client credential before
    // forwarding, so this is the only per-caller signal that survives the upstream
    // boundary.
    const upstreamSessionId = sanitizeHeader(req.headers["mcp-session-id"]);
    const upstreamReqHeaders = { ...forwardedHeaders, host: this._upstreamUrl.host };
    let upstreamRes;
    try {
      const requester = this._upstreamUrl.protocol === "https:" ? httpsRequest : httpRequest;
      // Concatenate the upstream URL's pathname (the registered prefix) with the
      // inbound path (the caller-issued path). Avoid `//` artefacts when either side
      // is `/` by normalising both sides before joining.
      const basePath = this._upstreamUrl.pathname && this._upstreamUrl.pathname !== "/" ? this._upstreamUrl.pathname.replace(/\/+$/, "") : "";
      const inboundPath = upstreamPath.startsWith("/") ? upstreamPath : `/${upstreamPath}`;
      const forwardPath = basePath ? `${basePath}${inboundPath}` : inboundPath;
      upstreamRes = await new Promise((resolve, reject) => {
        const r = requester({
          method: upstreamMethod,
          protocol: this._upstreamUrl.protocol,
          hostname: this._upstreamUrl.hostname,
          port: this._upstreamUrl.port || (this._upstreamUrl.protocol === "https:" ? 443 : 80),
          path: forwardPath,
          headers: upstreamReqHeaders,
          timeout: this._timeoutMs
        }, (response) => resolve(response));
        r.on("error", reject);
        r.on("timeout", () => r.destroy(new Error(`upstream timeout after ${this._timeoutMs}ms`)));
        if (requestBodyBytes && requestBodyBytes.length > 0) r.write(requestBodyBytes);
        r.end();
      });
    } catch (error) {
      res.statusCode = 502;
      res.setHeader("content-type", "text/plain");
      res.end(`observer failed to reach upstream: ${error.message}`);
      this._recordRefusal({ startedAt, correlationId, upstreamMethod, upstreamPath, inboundHeaders, identity, reason: error.message });
      return;
    }
    let responseBodyBytes;
    try {
      responseBodyBytes = await drainBody(upstreamRes, upstreamRes.headers["content-length"], this._bodyLimitBytes);
    } catch (error) {
      // Close the client connection with a 502 so we never silently drop the upstream reply.
      try { res.statusCode = 502; res.end(`observer failed to drain upstream response: ${error.message}`); } catch { /* ignore */ }
      this._recordRefusal({ startedAt, correlationId, upstreamMethod, upstreamPath, inboundHeaders, identity, reason: error.message });
      return;
    }
    const responseHeaders = {};
    for (const [name, value] of Object.entries(upstreamRes.headers ?? {})) {
      const sanitized = sanitizeHeader(value);
      if (sanitized !== null) responseHeaders[name] = sanitized;
    }
    res.statusCode = upstreamRes.statusCode ?? 502;
    for (const [name, value] of Object.entries(responseHeaders)) {
      try { res.setHeader(name, value); } catch { /* hop-by-hop; ignore */ }
    }
    if (responseBodyBytes && responseBodyBytes.length > 0) {
      // Pipe from the upstream bytes we already buffered. Using Readable.from(...) ensures we
      // emit the SAME bytes we hashed into the record set — no double-read or rewrite.
      Readable.from(responseBodyBytes).pipe(res);
    } else {
      res.end();
    }
    const completedAt = new Date();
    const recordId = randomUUID();
    const record = {
      recordId,
      completedAt: completedAt.toISOString(),
      startedAt: startedAt.toISOString(),
      request: { method: upstreamMethod, path: upstreamPath, headers: inboundHeaders, bodyHash: hashBody(requestBodyBytes), bodyBytes: requestBodyBytes?.length ?? 0 },
      response: { status: upstreamRes.statusCode ?? 0, headers: responseHeaders, bodyHash: hashBody(responseBodyBytes), bodyBytes: responseBodyBytes?.length ?? 0 },
      identity,
      kind: classification.kind,
      toolName: classification.toolName,
      upstreamSessionId
    };
    this._records.push(record);
  }

  _recordRefusal({ startedAt, correlationId, upstreamMethod, upstreamPath, inboundHeaders, identity, reason }) {
    const completedAt = new Date();
    this._records.push({
      recordId: randomUUID(),
      completedAt: completedAt.toISOString(),
      startedAt: startedAt.toISOString(),
      kind: "refusal",
      refusalReason: reason,
      request: { method: upstreamMethod, path: upstreamPath, headers: inboundHeaders, bodyHash: null, bodyBytes: 0 },
      response: { status: 0, headers: {}, bodyHash: null, bodyBytes: 0 },
      identity,
      correlationId
    });
  }
}

/**
 * Default observer factory used by the run-security CLI when the caller does not
 * supply one. ALWAYS returns a function (the previous implementation returned
 * `null` for external runs, which made the runner crash on `typeof factory ===
 * "function"` checks and dropped the source proof from the entry artefact). The
 * returned factory inspects the registered run / instance and constructs the
 * appropriate passive observer:
 *
 *   - local loopback runs (LucyProcess): the Lucy instance is already speaking to
 *     a loopback upstream port; the factory builds a `LocalLoopbackObserver` that
 *     records everything between the two;
 *   - external runs (`startedBy: "external"`): there is no in-process transparent
 *     recording available, so the closure returns `{ count: "unknown" }` and the
 *     runner reports `unknown` (NOT a fabricated zero). The runner must not claim
 *     a measurement was made.
 *
 * Tests may inject their own factory; this is the production default.
 */
export function createDefaultObserverFactory({ run }) {
  if (!run) return () => makeObserver({ kind: "no-run", count: "unknown", source: "no-run", problems: ["no run context provided to the default observer factory"] });
  if (run.instance?.startedBy === "external") {
    return function createObserverForExternal() {
      return makeObserver({
        kind: "external-no-observer",
        count: "unknown",
        source: "external-no-in-process-recording",
        problems: ["external run: there is no in-process transparent recording; an independent source (e.g. kubectl exec against the registered POD) must be wired through the observerFactory parameter"]
      });
    };
  }
  // The local LucyProcess case: the upstream the runner will point the LucyProcess at
  // is the LOCAL loopback observer's listener. The factory returns a closure that
  // creates a per-run LocalLoopbackObserver lazily (the runner owns its lifecycle
  // explicitly via start/stop on the result).
  //
  // The started instance is SHARED by every closure this factory hands out. It used
  // to live inside the returned closure, so each call produced a fresh, never-started
  // observer: the runner started one instance, the SecurityContext asked the factory
  // for another, and every observation came back "loopback-observer-not-started".
  // Sharing the instance is what makes "the runner started it" mean "the observer
  // everybody sees is running".
  const shared = { instance: null, starting: null };
  return function createObserver({ agentId, identity, runId, instanceId } = {}) {
    // The observer MUST be callable: `observeExecutions` invokes the provider as a
    // function (`observe({ runId, instanceId, agentId, tokenFingerprint, since, until })`).
    // The previous implementation returned a plain object, so the SecurityContext's
    // provider was "not a function" and every observation degraded to
    // `source: "no-observer"` — a silent "no measurement" that looked like a wiring
    // detail but was the reason the whole channel never worked.
    const observe = async ({ since: from, until: to, agentId: aid, tokenFingerprint } = {}) => {
      if (!shared.instance) {
        return { count: "unknown", source: "loopback-observer-not-started", recordSet: [], problems: ["loopback observer was not started before the runner invoked observeUpstream; the runner must call ensureStarted() with the upstream URL before the first case"] };
      }
      return shared.instance.observeUpstream({ since: from, until: to, agentId: aid, tokenFingerprint, identity: identity ?? "lucy-e2e-observer" });
    };
    const observer = observe;
    observer.kind = "loopback-observer";
    observer.ensureStarted = async (upstreamUrl) => {
        if (shared.instance) return shared.instance;
        if (!shared.starting) {
          shared.starting = (async () => {
            const obs = new LocalLoopbackObserver({ runId: runId ?? run.runId, instanceId: instanceId ?? run.instanceId ?? null, upstreamUrl });
            await obs.start();
            shared.instance = obs;
            return obs;
          })();
        }
        return shared.starting;
      };
    observer.stop = async () => {
      const instance = shared.instance;
      shared.instance = null;
      shared.starting = null;
      if (instance) await instance.stop();
    };
    observer.observeUpstream = async ({ since, until, agentId: aid, tokenFingerprint, identity: idn = identity ?? "lucy-e2e-observer" }) => {
      if (!shared.instance) {
        return { count: "unknown", source: "loopback-observer-not-started", recordSet: [], problems: ["loopback observer was not started before the runner invoked observeUpstream; the runner must call ensureStarted() with the upstream URL before the first case"] };
      }
      return shared.instance.observeUpstream({ since, until, agentId: aid, tokenFingerprint, identity: idn });
    };
    return observer;
  };
}

/**
 * A passive observer provider: a CALLABLE that answers an observation request with
 * `{ count, source, recordSet, ... }` — the shape `observeExecutions` consumes — and
 * that also carries the lifecycle hooks the runner drives.
 */
function makeObserver({ kind, count, source, problems }) {
  const observe = async () => ({ count, source, recordSet: [], problems });
  observe.kind = kind;
  observe.ensureStarted = async () => null;
  observe.stop = async () => {};
  observe.observeUpstream = async () => ({ count, source, recordSet: [], problems });
  return observe;
}