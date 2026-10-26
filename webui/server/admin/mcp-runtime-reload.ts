/**
 * Spec 191 §5/§6/§9 — execution runtime reload controller.
 *
 * The WebUI writes ktx.yaml, but `ktx mcp start` parses the configuration once
 * at startup and never re-reads it. This module drives the reload protocol
 * that lets an owner make the execution layer pick up the new configuration
 * WITHOUT restarting the Pod, the container or the WebUI.
 *
 * Three facts are reported separately and never merged:
 *   - reloadStatus       the daemon restart itself (process level fact)
 *   - configVerification the target digest verified with CONNECTION level
 *                        evidence (configuration level fact)
 *   - mcpReachable       the MCP tool surface was reachable (diagnostic only)
 *
 * Protocol invariants (Spec §6.2):
 *   P1  one reload in flight at a time, for ANY digest
 *   P2  the request carries requestId / requestedDigest / requestedAt
 *   P4  the receipt carries the digest actually read from disk
 *   P5  the receipt answers the same requestId
 *   P6  a late receipt never completes a later request
 *   P7  after a timeout the REAL channel state is queried first
 *   P9  after a timeout the next trigger reports already_running while the
 *       channel is still executing
 *
 * The module deliberately does NOT import from ./mcp-runtime.ts: that module
 * registers the routes and imports this one, so the dependency has to point
 * this way.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  clearExecutionRuntimeObservations,
  listExecutionRuntimeObservations,
  readKtxYamlDigest,
  recordExecutionRuntimeObservation
} from "../mcp-runtime-state.js";
import { readProject, resolveProjectRoot } from "../project.js";

/** Protocol version the supervisor publishes in its capability file (Spec §9.1). */
export const KTX_RELOAD_PROTOCOL = "lucy-ktx-reload/1";

/** G-8: 60s upper bound; a KTX cold start measures 2–6s in the field. */
const RELOAD_TIMEOUT_MS = 60_000;
/** G-7: a capability heartbeat older than this means the supervisor is gone. */
const HEARTBEAT_STALE_MS = 30_000;
/** How often the receipt file is polled. */
const RECEIPT_POLL_MS = 100;

/**
 * The wait for the receipt is bounded. The override exists so the timeout
 * path can be exercised without waiting a minute; production keeps the
 * 60s upper bound.
 */
function reloadTimeoutMs(): number {
  const configured = Number(process.env.LUCY_KTX_RELOAD_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : RELOAD_TIMEOUT_MS;
}

export type ExecutionRuntimeActivation = "current" | "reload_required" | "unknown";
export type ExecutionRuntimeReloadState = "idle" | "running" | "succeeded" | "failed";
export type ExecutionRuntimeVerificationState = "unverified" | "verifying" | "verified" | "failed";

export type ExecutionRuntimeReloadStatus = {
  activation: ExecutionRuntimeActivation;
  reload: {
    state: ExecutionRuntimeReloadState;
    requestId?: string;
    digest?: string;
    startedAt?: string;
    finishedAt?: string;
    detail?: string;
  };
  verification: {
    state: ExecutionRuntimeVerificationState;
    digest?: string;
    checkedAt?: string;
    detail?: string;
  };
};

export type McpRuntimeReloadResult = {
  requestId: string;
  reloadStatus: "succeeded" | "failed" | "already_running" | "unsupported";
  configVerification: "verified" | "failed" | "unverified";
  mcpReachable?: "reachable" | "unavailable" | "error";
  requestedDigest: string;
  actualDigest?: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  detail?: string;
};

export type ChannelCapability = {
  protocol: string;
  supervisorPid: number;
  startedAt: string;
  heartbeatAt: string;
  state: string;
  currentRequestId: string;
};

export type ChannelAvailability = {
  available: boolean;
  capability?: ChannelCapability;
  detail?: string;
};

export type ChannelState = {
  busy: boolean;
  requestId?: string;
  capability?: ChannelCapability;
  lastResult?: ReloadReceipt;
};

export type ReloadReceipt = {
  requestId: string;
  actualDigest: string;
  status: "succeeded" | "failed";
  detail?: string;
  finishedAt?: string;
};

type PersistedReloadState = {
  activation: ExecutionRuntimeActivation;
  /** The digest the activation statement refers to (Spec §5.1 digest binding). */
  activationDigest?: string;
  reload: ExecutionRuntimeReloadStatus["reload"];
  verification: ExecutionRuntimeReloadStatus["verification"];
  /** The digest the execution layer was last confirmed to have loaded. */
  verifiedDigest?: string;
};

type VerificationOutcome = {
  state: "verified" | "failed" | "unverified";
  detail?: string;
  loadedConnectionIds?: string[];
  missingConnectionIds?: string[];
  reachable?: "reachable" | "unavailable" | "error";
};

const EMPTY_STATE: PersistedReloadState = {
  activation: "unknown",
  reload: { state: "idle" },
  verification: { state: "unverified" }
};

/**
 * The global single-in-flight gate (Spec §6.3). It is deliberately NOT keyed
 * by digest: two different digests would still race on the same request and
 * receipt files, which is exactly the failure mode P1 forbids.
 */
let inflight: { requestId: string; digest: string; startedAt: string } | null = null;

function channelPaths(projectRoot: string) {
  const dir = path.join(projectRoot, ".ktx-ui");
  return {
    dir,
    capability: path.join(dir, "ktx-reload.capability"),
    request: path.join(dir, "ktx-reload.request"),
    result: path.join(dir, "ktx-reload.result"),
    state: path.join(dir, "ktx-reload.state.json")
  };
}

function valueAsRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJsonFile<T>(file: string): Promise<T | undefined> {
  try {
    const text = await readFile(file, "utf8");
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

async function writeJsonAtomic(file: string, payload: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}`;
  await writeFile(tmp, `${JSON.stringify(payload)}\n`, "utf8");
  await rename(tmp, file);
}

// ── capability handshake (Spec §9.1) ─────────────────────────────────────────

export async function readChannelCapability(
  projectRoot: string
): Promise<ChannelCapability | undefined> {
  const raw = await readJsonFile<Record<string, unknown>>(channelPaths(projectRoot).capability);
  if (!raw) return undefined;
  const protocol = typeof raw.protocol === "string" ? raw.protocol : "";
  const supervisorPid = Number(raw.supervisorPid);
  const startedAt = typeof raw.startedAt === "string" ? raw.startedAt : "";
  const heartbeatAt = typeof raw.heartbeatAt === "string" ? raw.heartbeatAt : "";
  const state = typeof raw.state === "string" ? raw.state : "idle";
  const currentRequestId = typeof raw.currentRequestId === "string" ? raw.currentRequestId : "";
  if (!protocol || !Number.isFinite(supervisorPid) || supervisorPid <= 0) return undefined;
  return { protocol, supervisorPid, startedAt, heartbeatAt, state, currentRequestId };
}

function heartbeatAgeMs(capability: ChannelCapability, now: number): number {
  const parsed = Date.parse(capability.heartbeatAt);
  if (!Number.isFinite(parsed)) return Number.POSITIVE_INFINITY;
  return Math.max(0, now - parsed);
}

function supervisorAlive(pid: number): boolean {
  try {
    // Signal 0 only probes for existence — it never delivers a signal.
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to another user.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * H1–H5: a reload is only supported when a supervisor publishes a matching
 * protocol version, keeps a fresh heartbeat and is still running.
 */
export async function channelAvailable(projectRoot: string): Promise<ChannelAvailability> {
  const capability = await readChannelCapability(projectRoot);
  if (!capability) {
    return { available: false, detail: "未找到执行层重载通道能力文件，当前部署不支持执行层重载" };
  }
  if (capability.protocol !== KTX_RELOAD_PROTOCOL) {
    return {
      available: false,
      capability,
      detail: `执行层重载通道协议版本不匹配（${capability.protocol}），当前部署不支持执行层重载`
    };
  }
  if (!supervisorAlive(capability.supervisorPid)) {
    return { available: false, capability, detail: "执行层重载通道的 supervisor 进程已退出" };
  }
  const age = heartbeatAgeMs(capability, Date.now());
  if (age > HEARTBEAT_STALE_MS) {
    return { available: false, capability, detail: "执行层重载通道心跳已过期" };
  }
  return { available: true, capability };
}

/**
 * P7/P9: read the REAL channel state. The supervisor publishes whether it is
 * currently executing a reload, so a timed-out request can tell "still
 * running" from "actually finished" instead of guessing.
 */
export async function queryChannelState(projectRoot: string): Promise<ChannelState> {
  const paths = channelPaths(projectRoot);
  const capability = await readChannelCapability(projectRoot);
  const lastResult = await readJsonFile<ReloadReceipt>(paths.result);
  const busy = Boolean(
    capability
    && capability.state === "reloading"
    && supervisorAlive(capability.supervisorPid)
  );
  return {
    busy,
    ...(capability?.currentRequestId ? { requestId: capability.currentRequestId } : {}),
    ...(capability ? { capability } : {}),
    ...(lastResult ? { lastResult } : {})
  };
}

// ── persisted state (Spec §5) ───────────────────────────────────────────────

export async function readReloadState(
  projectRoot: string,
  currentDigest?: string
): Promise<ExecutionRuntimeReloadStatus> {
  const paths = channelPaths(projectRoot);
  const stored = await readJsonFile<PersistedReloadState>(paths.state);
  const state: PersistedReloadState = stored
    ? {
        activation: stored.activation ?? "unknown",
        ...(stored.activationDigest ? { activationDigest: stored.activationDigest } : {}),
        reload: stored.reload ?? { state: "idle" },
        verification: stored.verification ?? { state: "unverified" },
        ...(stored.verifiedDigest ? { verifiedDigest: stored.verifiedDigest } : {})
      }
    : { ...EMPTY_STATE };

  const digest = currentDigest ?? await readKtxYamlDigest(projectRoot).catch(() => "");
  const activation = computeActivation(state, digest);
  return {
    activation,
    reload: { ...state.reload },
    verification: { ...state.verification }
  };
}

/**
 * The activation statement is digest-bound: a configuration that changed after
 * it was verified is no longer "current" (Spec §5.1).
 */
function computeActivation(
  state: PersistedReloadState,
  currentDigest: string
): ExecutionRuntimeActivation {
  if (!currentDigest) return state.activation;
  if (state.activation === "current" && state.activationDigest === currentDigest) return "current";
  if (state.activation === "current" && state.activationDigest !== currentDigest) {
    return "reload_required";
  }
  if (state.activation === "reload_required") return "reload_required";
  return "unknown";
}

async function persistReloadState(
  projectRoot: string,
  patch: Partial<PersistedReloadState>
): Promise<PersistedReloadState> {
  const paths = channelPaths(projectRoot);
  const stored = await readJsonFile<PersistedReloadState>(paths.state);
  const next: PersistedReloadState = {
    ...(stored ?? EMPTY_STATE),
    ...patch
  };
  await writeJsonAtomic(paths.state, next);
  return next;
}

/**
 * Step 4 of the plan: the write path records that the configuration on disk is
 * no longer the one the execution layer confirmed.
 *
 * `previousDigest` is the digest from BEFORE the write. When the write did not
 * change the configuration, nothing is pending and the activation statement is
 * left alone.
 */
export async function markExecutionRuntimePending(
  projectRoot: string,
  previousDigest?: string
): Promise<boolean> {
  const digest = await readKtxYamlDigest(projectRoot).catch(() => "");
  if (!digest) return false;
  if (previousDigest && previousDigest === digest) return false;
  await persistReloadState(projectRoot, {
    activation: "reload_required",
    activationDigest: digest
  });
  return true;
}

// ── connection level verification (Spec §5.3) ───────────────────────────────

function upstreamEndpoint(): { url: string } {
  const host = process.env.LUCY_PROXY_UPSTREAM_HOST?.trim() || "127.0.0.1";
  const port = Number(process.env.LUCY_PROXY_UPSTREAM_PORT?.trim() || "7878");
  const urlHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return { url: `http://${urlHost}:${port}/mcp` };
}

function parseEnvelope(text: string): Record<string, unknown> | undefined {
  const candidates = [text.trim()];
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("data:")) candidates.push(line.slice("data:".length).trim());
  }
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Try the next JSON or SSE candidate.
    }
  }
  return undefined;
}

function extractToolPayload(result: unknown): unknown {
  const record = valueAsRecord(result);
  const structured = record.structuredContent;
  if (structured && typeof structured === "object") return structured;
  const content = Array.isArray(record.content) ? record.content : [];
  for (const item of content) {
    const entry = valueAsRecord(item);
    if (typeof entry.text === "string") {
      try {
        return JSON.parse(entry.text) as unknown;
      } catch {
        return entry.text;
      }
    }
  }
  return undefined;
}

function extractConnectionIds(payload: unknown): string[] {
  const record = valueAsRecord(payload);
  const raw = record.connections;
  if (!Array.isArray(raw)) return [];
  const ids = new Set<string>();
  for (const item of raw) {
    if (typeof item === "string") {
      if (item.trim()) ids.add(item.trim());
      continue;
    }
    const entry = valueAsRecord(item);
    const id = entry.id ?? entry.connectionId ?? entry.connection_id ?? entry.name;
    if (typeof id === "string" && id.trim()) ids.add(id.trim());
  }
  return [...ids].sort();
}

type UpstreamToolCall =
  | { ok: true; payload: unknown }
  | { ok: false; kind: "unavailable" | "error"; detail: string };

/**
 * Call one read-only tool on the resident KTX MCP upstream. This talks to the
 * daemon DIRECTLY (not through the Lucy proxy): the proxy answers
 * `connection_list` from Lucy's own policy-filtered view, which would not be
 * evidence about the daemon's in-memory configuration.
 */
async function callUpstreamTool(
  toolName: string,
  args: Record<string, unknown>
): Promise<UpstreamToolCall> {
  const controller = new AbortController();
  const timeoutMs = 10_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream"
    };
    const token = process.env.KTX_INTERNAL_TOKEN?.trim();
    if (token) headers.authorization = `Bearer ${token}`;
    const endpoint = upstreamEndpoint().url;
    const post = (body: unknown, sessionId?: string) => fetch(endpoint, {
      method: "POST",
      headers: sessionId ? { ...headers, "mcp-session-id": sessionId } : headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });

    const initializeResponse = await post({
      jsonrpc: "2.0",
      id: "lucy-reload-verify-initialize",
      method: "initialize",
      params: {
        protocolVersion: process.env.LUCY_PROXY_UPSTREAM_PROTOCOL_VERSION ?? "2024-11-05",
        capabilities: {},
        clientInfo: { name: "lucy-reload-verify", version: "1.0" }
      }
    });
    const initializeEnvelope = parseEnvelope(await initializeResponse.text());
    const sessionId = initializeResponse.headers.get("mcp-session-id")?.trim();
    if (!initializeResponse.ok || !sessionId || !initializeEnvelope || "error" in initializeEnvelope) {
      return {
        ok: false,
        kind: "error",
        detail: initializeResponse.ok
          ? "KTX MCP initialize 返回了无效响应"
          : `KTX MCP initialize 返回 HTTP ${initializeResponse.status}`
      };
    }
    const initializedResponse = await post(
      { jsonrpc: "2.0", method: "notifications/initialized" },
      sessionId
    );
    await initializedResponse.text();
    if (!initializedResponse.ok) {
      return {
        ok: false,
        kind: "error",
        detail: `KTX MCP initialized 返回 HTTP ${initializedResponse.status}`
      };
    }
    const callResponse = await post(
      {
        jsonrpc: "2.0",
        id: "lucy-reload-verify-call",
        method: "tools/call",
        params: { name: toolName, arguments: args }
      },
      sessionId
    );
    const envelope = parseEnvelope(await callResponse.text());
    if (!callResponse.ok) {
      return { ok: false, kind: "error", detail: `KTX MCP tools/call 返回 HTTP ${callResponse.status}` };
    }
    if (!envelope || "error" in envelope) {
      const error = valueAsRecord(envelope?.error);
      return {
        ok: false,
        kind: "error",
        detail: typeof error.message === "string" ? error.message : "KTX MCP tools/call 返回了错误"
      };
    }
    const result = valueAsRecord(envelope.result);
    if (result.isError === true) {
      const content = Array.isArray(result.content) ? result.content : [];
      const first = valueAsRecord(content[0]);
      return {
        ok: false,
        kind: "error",
        detail: typeof first.text === "string" ? first.text : "KTX MCP 工具调用返回了错误"
      };
    }
    return { ok: true, payload: extractToolPayload(result) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      kind: controller.signal.aborted ? "unavailable" : "error",
      detail: controller.signal.aborted ? `KTX MCP 调用超时（${timeoutMs}ms）` : message
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Spec §5.3 — the configuration is verified with CONNECTION level evidence:
 * the connections the daemon knows must include the ones the target
 * configuration declares. Port readiness and tools/list are NOT accepted.
 */
export async function verifyConfigLoaded(
  expectedConnectionIds: string[],
  targetConnectionId?: string
): Promise<VerificationOutcome> {
  const call = await callUpstreamTool("connection_list", {});
  if (!call.ok) {
    return {
      state: "unverified",
      detail: `无法取得连接级证据：${call.detail}`,
      reachable: call.kind
    };
  }
  const loaded = extractConnectionIds(call.payload);
  const expected = [...new Set(expectedConnectionIds)].sort();
  const missing = expected.filter((id) => !loaded.includes(id));
  const targetMissing = targetConnectionId
    ? !loaded.includes(targetConnectionId)
    : false;
  if (missing.length === 0 && !targetMissing) {
    return {
      state: "verified",
      detail: loaded.length > 0
        ? `执行层已加载 ${loaded.length} 个连接`
        : "执行层已加载当前配置声明的连接",
      loadedConnectionIds: loaded,
      reachable: "reachable"
    };
  }
  const missingList = targetConnectionId && targetMissing
    ? [targetConnectionId, ...missing.filter((id) => id !== targetConnectionId)]
    : missing;
  return {
    state: "failed",
    detail: missingList.length > 0
      ? `执行层尚未加载连接：${missingList.join("、")}`
      : "执行层已加载的连接与目标配置不一致",
    loadedConnectionIds: loaded,
    missingConnectionIds: missingList,
    reachable: "reachable"
  };
}

// ── the reload protocol (Spec §6) ───────────────────────────────────────────

async function writeReloadRequest(
  projectRoot: string,
  payload: { requestId: string; requestedDigest: string; requestedAt: string }
): Promise<void> {
  const paths = channelPaths(projectRoot);
  await mkdir(paths.dir, { recursive: true });
  const tmp = `${paths.request}.tmp.${process.pid}`;
  await writeFile(tmp, `${JSON.stringify(payload)}\n`, "utf8");
  await rename(tmp, paths.request);
}

async function waitForReceipt(
  projectRoot: string,
  requestId: string,
  timeoutMs: number
): Promise<{ receipt?: ReloadReceipt; timedOut: boolean }> {
  const paths = channelPaths(projectRoot);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const receipt = await readJsonFile<ReloadReceipt>(paths.result);
    // P6: only a receipt that answers THIS request may complete it.
    if (receipt && receipt.requestId === requestId) {
      return { receipt, timedOut: false };
    }
    await sleep(RECEIPT_POLL_MS);
  }
  return { timedOut: true };
}

export type ReloadExecutionRuntimeInput = {
  connectionId?: string;
  reason?: string;
  projectRoot?: string;
};

/**
 * Spec §6.3 — the reload flow. Everything the caller needs to report the
 * three separate facts is in the result.
 */
export async function reloadExecutionRuntime(
  input: ReloadExecutionRuntimeInput = {}
): Promise<McpRuntimeReloadResult> {
  const projectRoot = input.projectRoot ?? await resolveProjectRoot();
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const finish = (
    result: Omit<McpRuntimeReloadResult, "startedAt" | "durationMs" | "finishedAt">
  ): McpRuntimeReloadResult => ({
    ...result,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAtMs
  });

  // ① global single-in-flight gate — any digest (P1).
  //
  // The slot is RESERVED before the first await, so two concurrent callers can
  // never both issue a request. The slot is only released when the previous
  // request's receipt exists: a request that has been written but not yet
  // consumed by the supervisor still counts as in flight.
  if (inflight) {
    const channelState = await queryChannelState(projectRoot);
    const previousFinished = channelState.lastResult?.requestId === inflight.requestId;
    if (!previousFinished) {
      return finish({
        requestId: inflight.requestId,
        reloadStatus: "already_running",
        configVerification: "unverified",
        requestedDigest: inflight.digest,
        detail: "上一次执行层重载仍在进行中，请等待其结束后再试"
      });
    }
    // The previous run is provably finished — the gate can be released.
    inflight = null;
  }

  const requestId = randomUUID();
  inflight = { requestId, digest: "", startedAt };
  try {
    return await runReload(input, projectRoot, requestId, startedAt, startedAtMs, finish);
  } finally {
    // Only release OUR reservation: a later request may already hold the slot.
    if (inflight?.requestId === requestId) inflight = null;
  }
}

/**
 * The reload itself. The global gate is held by the caller for the whole
 * duration, so this never runs twice at the same time.
 */
async function runReload(
  input: ReloadExecutionRuntimeInput,
  projectRoot: string,
  requestId: string,
  startedAt: string,
  startedAtMs: number,
  finish: (result: Omit<McpRuntimeReloadResult, "startedAt" | "durationMs" | "finishedAt">) => McpRuntimeReloadResult
): Promise<McpRuntimeReloadResult> {
  // ② the channel may still be busy after a WebUI restart (H6).
  const channelState = await queryChannelState(projectRoot);
  if (channelState.busy) {
    return finish({
      requestId: channelState.requestId ?? "",
      reloadStatus: "already_running",
      configVerification: "unverified",
      requestedDigest: "",
      detail: "执行层重载通道仍在执行上一次请求，请等待其结束后再试"
    });
  }

  // ③ capability probe — no valid supervisor ⇒ unsupported, with NO side effect.
  const availability = await channelAvailable(projectRoot);
  if (!availability.available) {
    return finish({
      requestId: "",
      reloadStatus: "unsupported",
      configVerification: "unverified",
      requestedDigest: "",
      detail: availability.detail ?? "当前部署不支持执行层重载"
    });
  }

  // ④ issue the request (P2) and record the running state.
  let requestedDigest = "";
  try {
    requestedDigest = await readKtxYamlDigest(projectRoot);
  } catch {
    return finish({
      requestId: "",
      reloadStatus: "failed",
      configVerification: "unverified",
      requestedDigest: "",
      detail: "无法读取 ktx.yaml，未发起执行层重载"
    });
  }
  const project = await readProject(projectRoot);
  const expectedConnectionIds = project.connections.map((connection) => connection.id).sort();
  if (input.connectionId && !expectedConnectionIds.includes(input.connectionId)) {
    // The target connection does not exist in the configuration on disk, so a
    // connection level verification could never succeed. Say so instead of
    // restarting the daemon for a target that cannot be confirmed.
    return finish({
      requestId: "",
      reloadStatus: "failed",
      configVerification: "unverified",
      requestedDigest,
      detail: `连接 ${input.connectionId} 不在当前 ktx.yaml 中，未发起执行层重载`
    });
  }
  const requestedAt = startedAt;

  await persistReloadState(projectRoot, {
    reload: {
      state: "running",
      requestId,
      digest: requestedDigest,
      startedAt: requestedAt
    },
    verification: {
      state: "verifying",
      digest: requestedDigest,
      checkedAt: requestedAt
    }
  });

  await writeReloadRequest(projectRoot, { requestId, requestedDigest, requestedAt });
  if (inflight?.requestId === requestId) {
    inflight = { requestId, digest: requestedDigest, startedAt: requestedAt };
  }

  {
    const { receipt, timedOut } = await waitForReceipt(projectRoot, requestId, reloadTimeoutMs());

    if (timedOut || !receipt) {
      // P7/P9: ask the channel what really happened before reporting.
      const afterTimeout = await queryChannelState(projectRoot);
      const detail = afterTimeout.busy
        ? "等待执行层重载回执超时；通道仍在执行，可稍后重试"
        : "等待执行层重载回执超时";
      await persistReloadState(projectRoot, {
        reload: {
          state: "failed",
          requestId,
          digest: requestedDigest,
          startedAt: requestedAt,
          finishedAt: new Date().toISOString(),
          detail
        },
        verification: {
          state: "unverified",
          digest: requestedDigest,
          checkedAt: new Date().toISOString(),
          detail
        }
      });
      return finish({
        requestId,
        reloadStatus: "failed",
        configVerification: "unverified",
        requestedDigest,
        detail
      });
    }

    const actualDigest = receipt.actualDigest || requestedDigest;
    const finishedAt = receipt.finishedAt ?? new Date().toISOString();

    if (receipt.status !== "succeeded") {
      // The daemon did not come back. Report it honestly; the configuration is
      // NEVER rolled back (Spec §3.2).
      const detail = receipt.detail ?? "执行层重载失败";
      await persistReloadState(projectRoot, {
        activation: "reload_required",
        activationDigest: actualDigest,
        reload: {
          state: "failed",
          requestId,
          digest: actualDigest,
          startedAt: requestedAt,
          finishedAt,
          detail
        },
        verification: {
          state: "unverified",
          digest: actualDigest,
          checkedAt: finishedAt,
          detail
        }
      });
      return finish({
        requestId,
        reloadStatus: "failed",
        configVerification: "unverified",
        requestedDigest,
        actualDigest,
        detail
      });
    }

    // The daemon restarted. The OLD evidence is now invalid — clear it before
    // writing any new evidence (Spec §5.4).
    clearExecutionRuntimeObservations();

    const verification = await verifyConfigLoaded(expectedConnectionIds, input.connectionId);
    const digestMismatch = actualDigest !== requestedDigest;
    const verificationDetail = [
      verification.detail,
      digestMismatch
        ? `磁盘配置在重载期间发生变化（请求 ${requestedDigest.slice(0, 12)}，实际 ${actualDigest.slice(0, 12)}）`
        : ""
    ].filter(Boolean).join("；");

    if (verification.state === "verified") {
      // Write the NEW evidence against the digest the daemon actually loaded.
      // Recording it against a different digest would fabricate evidence.
      for (const connectionId of expectedConnectionIds) {
        recordExecutionRuntimeObservation({
          connectionId,
          configDigest: actualDigest,
          status: "ok",
          checkedAt: finishedAt,
          detail: "执行层重载后通过连接级证据确认已加载"
        });
      }
    }

    const currentDigest = await readKtxYamlDigest(projectRoot).catch(() => actualDigest);
    const activation: ExecutionRuntimeActivation =
      verification.state === "verified" && actualDigest === currentDigest
        ? "current"
        : "reload_required";

    await persistReloadState(projectRoot, {
      activation,
      activationDigest: currentDigest,
      reload: {
        state: "succeeded",
        requestId,
        digest: actualDigest,
        startedAt: requestedAt,
        finishedAt,
        ...(digestMismatch ? { detail: verificationDetail } : {})
      },
      verification: {
        state: verification.state,
        digest: actualDigest,
        checkedAt: finishedAt,
        detail: verificationDetail
      },
      ...(verification.state === "verified" ? { verifiedDigest: actualDigest } : {})
    });

    return finish({
      requestId,
      reloadStatus: "succeeded",
      configVerification: verification.state,
      ...(verification.reachable ? { mcpReachable: verification.reachable } : {}),
      requestedDigest,
      actualDigest,
      detail: verificationDetail
    });
  }
}

/**
 * Test seam: the gate is module state, so a test that drives two reloads has
 * to be able to release it explicitly.
 */
export function resetReloadControllerForTests(): void {
  inflight = null;
}

/**
 * Does the execution layer have successful evidence for the configuration that
 * is on disk right now? Used by the status surface to avoid reporting a
 * configuration as "current" without evidence.
 */
export function hasCurrentExecutionEvidence(currentDigest: string): boolean {
  return listExecutionRuntimeObservations(currentDigest)
    .some((observation) => observation.status === "ok");
}
