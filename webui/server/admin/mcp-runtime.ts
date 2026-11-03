import { stat } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { readCatalogReloads } from "../catalog-reload.js";
import {
  getExecutionRuntimeObservation,
  listExecutionRuntimeObservations,
  readKtxYamlDigest
} from "../mcp-runtime-state.js";
import { readProject, resolveProjectRoot } from "../project.js";
import { effectivePermissions, getPolicyRuntimeStatus, isPolicyRuntimeHealthy } from "../proxy/acl.js";
import { recordConfigChange, type ConfigAuditActorType } from "./audit.js";
import {
  readReloadState,
  reloadExecutionRuntime,
  type McpRuntimeReloadResult
} from "./mcp-runtime-reload.js";
import { requireOwner } from "../auth/guard.js";
import { resolveAuthMode } from "../auth/admins-store.js";
import { auditActorFields, trustedActorFromRequest } from "../security/request-actor.js";

export type ExecutionRuntimeStatus = "unknown" | "ok" | "stale" | "unavailable" | "error";
export type CanaryCheckStatus = "pass" | "fail" | "blocked";

export type ExecutionProbeResult = {
  status: "reachable" | "unavailable" | "error";
  checkedAt: string;
  error?: string;
};

type CanaryMode = "connection" | "tools_list" | "catalog" | "query";

export type McpRuntimeCanaryInput = {
  connectionId: string;
  agentId?: string;
  sourceName?: string;
  mode?: CanaryMode;
};

type CanaryCheck = {
  name: "config" | "catalog" | "policy" | "execution_tools_list" | "execution_catalog" | "execution_query";
  status: CanaryCheckStatus;
  detail: string;
  durationMs?: number;
};

export type McpRuntimeDependencies = {
  probeExecutionRuntime?: (options?: { force?: boolean }) => Promise<ExecutionProbeResult>;
  /** Test seam: the reload controller talks to the supervisor channel. */
  reloadExecutionRuntime?: typeof import("./mcp-runtime-reload.js").reloadExecutionRuntime;
};

let cachedProbe: { expiresAt: number; result: ExecutionProbeResult } | undefined;

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function upstreamEndpoint(): { host: string; port: number; url: string } {
  const host = process.env.LUCY_PROXY_UPSTREAM_HOST?.trim() || "127.0.0.1";
  const port = positiveInteger(process.env.LUCY_PROXY_UPSTREAM_PORT, 7878);
  const urlHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return { host, port, url: `http://${urlHost}:${port}/mcp` };
}

function parseProbeEnvelope(text: string): Record<string, unknown> | undefined {
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

export async function probeExecutionRuntime(
  options: { force?: boolean } = {}
): Promise<ExecutionProbeResult> {
  const now = Date.now();
  if (!options.force && cachedProbe && cachedProbe.expiresAt > now) {
    return cachedProbe.result;
  }

  const checkedAt = new Date(now).toISOString();
  const controller = new AbortController();
  const timeoutMs = positiveInteger(process.env.LUCY_MCP_RUNTIME_PROBE_TIMEOUT_MS, 1_500);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let result: ExecutionProbeResult;
  try {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream"
    };
    const token = process.env.KTX_INTERNAL_TOKEN?.trim();
    if (token) headers.authorization = `Bearer ${token}`;
    const endpoint = upstreamEndpoint().url;
    const probePost = (body: unknown, sessionId?: string) => fetch(endpoint, {
      method: "POST",
      headers: sessionId ? { ...headers, "mcp-session-id": sessionId } : headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const initializeResponse = await probePost({
      jsonrpc: "2.0",
      id: "lucy-runtime-probe-initialize",
      method: "initialize",
      params: {
        protocolVersion: process.env.LUCY_PROXY_UPSTREAM_PROTOCOL_VERSION ?? "2024-11-05",
        capabilities: {},
        clientInfo: { name: "lucy-runtime-probe", version: "1.0" }
      }
    });
    const initializeEnvelope = parseProbeEnvelope(await initializeResponse.text());
    const sessionId = initializeResponse.headers.get("mcp-session-id")?.trim();
    if (!initializeResponse.ok || !sessionId || !initializeEnvelope || "error" in initializeEnvelope) {
      result = {
        status: "error",
        checkedAt,
        error: initializeResponse.ok
          ? "KTX MCP probe returned an invalid or error response"
          : `KTX MCP probe returned HTTP ${initializeResponse.status}`
      };
    } else {
      const initializedResponse = await probePost(
        { jsonrpc: "2.0", method: "notifications/initialized" },
        sessionId
      );
      await initializedResponse.text();
      if (!initializedResponse.ok) {
        result = {
          status: "error",
          checkedAt,
          error: `KTX MCP probe returned HTTP ${initializedResponse.status}`
        };
      } else {
        const response = await probePost(
          { jsonrpc: "2.0", id: "lucy-runtime-probe", method: "tools/list", params: {} },
          sessionId
        );
        const envelope = parseProbeEnvelope(await response.text());
        result = response.ok && envelope && !("error" in envelope)
          ? { status: "reachable", checkedAt }
          : {
              status: "error",
              checkedAt,
              error: response.ok
                ? "KTX MCP probe returned an invalid or error response"
                : `KTX MCP probe returned HTTP ${response.status}`
            };
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result = {
      status: "unavailable",
      checkedAt,
      error: controller.signal.aborted ? `KTX MCP probe timed out after ${timeoutMs}ms` : message
    };
  } finally {
    clearTimeout(timer);
  }

  cachedProbe = {
    expiresAt: now + positiveInteger(process.env.LUCY_MCP_RUNTIME_PROBE_TTL_MS, 5_000),
    result
  };
  return result;
}

export function resetExecutionRuntimeProbeForTests(): void {
  cachedProbe = undefined;
}

function summarizeExecution(
  probe: ExecutionProbeResult,
  connectionIds: string[],
  configDigest: string
) {
  if (probe.status === "unavailable") {
    return {
      status: "unavailable" as const,
      lastCheckedAt: probe.checkedAt,
      lastError: probe.error
    };
  }
  if (probe.status === "error") {
    return {
      status: "error" as const,
      lastCheckedAt: probe.checkedAt,
      lastError: probe.error
    };
  }

  const configured = new Set(connectionIds);
  const observations = listExecutionRuntimeObservations(configDigest)
    .filter((observation) => configured.has(observation.connectionId));
  const loadedConnectionIds = observations
    .filter((observation) => observation.status === "ok")
    .map((observation) => observation.connectionId)
    .sort();
  const missingConnections = observations
    .filter((observation) => observation.status === "stale")
    .map((observation) => observation.connectionId)
    .sort();
  const evidenced = new Set([...loadedConnectionIds, ...missingConnections]);
  const unknownConnections = connectionIds.filter((id) => !evidenced.has(id)).sort();
  const status: ExecutionRuntimeStatus = missingConnections.length > 0
    ? "stale"
    : connectionIds.length > 0 && unknownConnections.length === 0
      ? "ok"
      : "unknown";
  const staleDetail = observations.find((observation) => observation.status === "stale")?.detail;

  return {
    status,
    lastCheckedAt: probe.checkedAt,
    ...(loadedConnectionIds.length > 0 ? { loadedConnectionIds } : {}),
    ...(missingConnections.length > 0 ? { missingConnections } : {}),
    ...(unknownConnections.length > 0 ? { unknownConnections } : {}),
    ...(staleDetail ? { lastError: staleDetail } : {})
  };
}

export async function readMcpRuntimeStatus(
  probeFn?: McpRuntimeDependencies["probeExecutionRuntime"]
) {
  const projectRoot = await resolveProjectRoot();
  const [project, digest, fileStatus, catalog, probe] = await Promise.all([
    readProject(projectRoot),
    readKtxYamlDigest(projectRoot),
    stat(path.join(projectRoot, "ktx.yaml")),
    readCatalogReloads(projectRoot).catch(() => undefined),
    (probeFn ?? probeExecutionRuntime)()
  ]);
  // Spec 191 §11.2 — the execution surface carries three orthogonal facts:
  // whether the configuration is activated, whether the last reload operation
  // succeeded, and whether the target digest was verified with connection
  // level evidence.
  const reloadState = await readReloadState(projectRoot, digest);
  const connectionIds = project.connections.map((connection) => connection.id).sort();
  const policy = getPolicyRuntimeStatus();
  const endpoint = upstreamEndpoint();
  const catalogConnectionIds = catalog ? Object.keys(catalog.lastByConnection).sort() : [];

  return {
    endpoint: {
      ...(project.mcpEndpoint.url ? { publicUrl: project.mcpEndpoint.url } : {}),
      upstreamHost: endpoint.host,
      upstreamPort: endpoint.port
    },
    config: {
      projectRoot,
      ktxYamlDigest: digest,
      connectionIds,
      updatedAt: fileStatus.mtime.toISOString()
    },
    catalog: {
      ...(catalog?.last?.id ? { lastReloadId: catalog.last.id } : {}),
      ...(catalog?.last?.finishedAt ? { lastReloadAt: catalog.last.finishedAt } : {}),
      connectionIds: catalogConnectionIds,
      lastByConnection: Object.fromEntries(
        Object.entries(catalog?.lastByConnection ?? {}).map(([connectionId, run]) => [
          connectionId,
          { id: run.id, status: run.status, finishedAt: run.finishedAt }
        ])
      )
    },
    policy: {
      ...policy,
      healthy: isPolicyRuntimeHealthy(policy)
    },
    execution: {
      ...summarizeExecution(probe, connectionIds, digest),
      activation: reloadState.activation,
      reload: reloadState.reload,
      verification: reloadState.verification
    }
  };
}

function badRequest(reply: FastifyReply, message: string) {
  return reply.code(400).send({
    ok: false,
    error: { code: "bad_request", message }
  });
}

type ReloadAuditOutcome =
  | "succeeded"
  | "failed"
  | "already_running"
  | "unsupported"
  | "denied";

/**
 * The actor for a reload audit row.
 *
 * `trustedActorFromRequest` THROWS when the request carries no resolved
 * administrator (an unauthenticated attempt, or the bootstrap mode where no
 * owner exists yet). The refusal paths must still be audited, so the attempt
 * is recorded as `anonymous` — the same convention the OIDC routes use for a
 * login failure. The actor id is never taken from the request body or the
 * user agent.
 */
function reloadAuditActor(request: FastifyRequest): {
  actor: string;
  actorType: ConfigAuditActorType;
  actorIp?: string;
  requestId?: string;
  sessionId?: string | null;
} {
  try {
    return auditActorFields(trustedActorFromRequest(request));
  } catch {
    return {
      actor: "anonymous",
      actorType: "anonymous",
      ...(request.id ? { requestId: String(request.id) } : {})
    };
  }
}

/**
 * Spec 191 §12.1 — every path writes an audit record: success, failure, the
 * refusals and the timeout. The audit must never break the request, so a
 * failing audit write is logged instead of thrown.
 */
async function recordReloadAudit(
  request: FastifyRequest,
  input: {
    outcome: ReloadAuditOutcome;
    result?: McpRuntimeReloadResult;
    detail?: string;
    /** The activation statement BEFORE the reload, so the row shows the change. */
    previousActivation?: string;
  }
): Promise<void> {
  const result = input.result;
  const detail = input.detail ?? result?.detail;
  try {
    await recordConfigChange({
      filePath: "ktx.yaml",
      changeType: "execution_runtime_reload",
      assetKind: "governance",
      operation: input.outcome,
      writeStatus: input.outcome === "failed" ? "failed" : "committed",
      ...(input.outcome === "failed" ? { errorReason: detail ?? "执行层重载失败" } : {}),
      ...(result?.requestId ? { targetId: result.requestId } : {}),
      oldSummary: { activation: input.previousActivation ?? "unknown" },
      newSummary: {
        outcome: input.outcome,
        reloadStatus: result?.reloadStatus,
        configVerification: result?.configVerification,
        requestedDigest: result?.requestedDigest,
        actualDigest: result?.actualDigest,
        ...(detail ? { detail } : {})
      },
      ...reloadAuditActor(request),
      source: "mcp_runtime_reload_api"
    });
  } catch (error) {
    console.error("[mcp-runtime-reload] audit write failed", error);
  }
}

export async function runMcpRuntimeCanary(
  input: McpRuntimeCanaryInput,
  probeFn?: McpRuntimeDependencies["probeExecutionRuntime"]
) {
  const startedAt = Date.now();
  const projectRoot = await resolveProjectRoot();
  const project = await readProject(projectRoot);
  const configDigest = await readKtxYamlDigest(projectRoot);
  const checks: CanaryCheck[] = [];
  const connection = project.connections.find((item) => item.id === input.connectionId);
  if (!connection) {
    checks.push({ name: "config", status: "fail", detail: "连接不在当前 ktx.yaml 中" });
    return {
      connectionId: input.connectionId,
      ...(input.agentId ? { agentId: input.agentId } : {}),
      status: "fail" as const,
      checks,
      executionRuntimeAck: false,
      decisionReason: "config_missing"
    };
  }
  checks.push({ name: "config", status: "pass", detail: "连接存在于当前 ktx.yaml" });

  const catalog = await readCatalogReloads(projectRoot).catch(() => undefined);
  const reload = catalog?.lastByConnection[input.connectionId];
  if (!reload) {
    checks.push({ name: "catalog", status: "blocked", detail: "尚无该连接的 Catalog reload 记录" });
  } else if (reload.status === "success") {
    checks.push({ name: "catalog", status: "pass", detail: `最近 Catalog reload：${reload.id}` });
  } else {
    checks.push({ name: "catalog", status: "fail", detail: `最近 Catalog reload 失败：${reload.id}` });
  }

  if (input.agentId) {
    const permissions = await effectivePermissions({
      userId: input.agentId,
      tokenLabel: "mcp-runtime-canary",
      tokenHashPrefix: "mcp-runtime-canary"
    });
    const allowed = permissions.ok && permissions.permissions.connections.includes(input.connectionId);
    checks.push({
      name: "policy",
      status: allowed ? "pass" : "fail",
      detail: allowed ? "Agent 的生效权限包含该连接" : "Agent 的生效权限不包含该连接"
    });
    if (!allowed) {
      return {
        connectionId: input.connectionId,
        agentId: input.agentId,
        status: "fail" as const,
        checks,
        executionRuntimeAck: false,
        decisionReason: "policy_missing_connection"
      };
    }
  }

  const probeStartedAt = Date.now();
  const probe = await (probeFn ?? probeExecutionRuntime)({ force: true });
  if (probe.status !== "reachable") {
    checks.push({
      name: "execution_tools_list",
      status: "fail",
      detail: probe.error ?? "KTX MCP Runtime 不可用",
      durationMs: Date.now() - probeStartedAt
    });
    return {
      connectionId: input.connectionId,
      ...(input.agentId ? { agentId: input.agentId } : {}),
      status: "fail" as const,
      checks,
      executionRuntimeAck: false,
      decisionReason: probe.status === "unavailable" ? "execution_runtime_unavailable" : "upstream_error"
    };
  }
  checks.push({
    name: "execution_tools_list",
    status: "pass",
    detail: "KTX MCP Runtime 可达；此检查不证明连接已加载",
    durationMs: Date.now() - probeStartedAt
  });

  const observation = getExecutionRuntimeObservation(input.connectionId, configDigest);
  if (observation?.status === "stale") {
    checks.push({
      name: "execution_query",
      status: "fail",
      detail: observation.detail ?? "执行层未加载磁盘中已存在的连接"
    });
    return {
      connectionId: input.connectionId,
      ...(input.agentId ? { agentId: input.agentId } : {}),
      status: "fail" as const,
      checks,
      executionRuntimeAck: false,
      decisionReason: "execution_config_stale",
      remediation: {
        label: "重新检测执行层",
        detail: "配置已写入，执行层尚未加载。请在 MCP 调试台点「重载执行层」使其生效后，再执行一次只读查询验证。"
      }
    };
  }
  if (observation?.status === "ok") {
    checks.push({
      name: "execution_query",
      status: "pass",
      detail: `当前配置摘要已有成功只读查询证据（${observation.checkedAt}）`
    });
    return {
      connectionId: input.connectionId,
      ...(input.agentId ? { agentId: input.agentId } : {}),
      status: "pass" as const,
      checks,
      executionRuntimeAck: true,
      decisionReason: "allowed"
    };
  }

  checks.push({
    name: "execution_query",
    status: "blocked",
    detail: "当前 KTX 版本无连接加载自省，且当前配置摘要尚无成功查询证据"
  });
  return {
    connectionId: input.connectionId,
    ...(input.agentId ? { agentId: input.agentId } : {}),
    status: "blocked" as const,
    checks,
    executionRuntimeAck: false,
    decisionReason: "execution_canary_blocked",
    remediation: {
      label: "重新检测执行层",
      detail: "执行一次受控的只读查询，或升级到支持运行时配置自省的 KTX 版本。"
    },
    durationMs: Date.now() - startedAt
  };
}

export function registerMcpRuntimeRoutes(
  app: FastifyInstance,
  dependencies: McpRuntimeDependencies = {}
): void {
  app.get("/api/admin/mcp-runtime/status", async () => ({
    ok: true,
    data: await readMcpRuntimeStatus(dependencies.probeExecutionRuntime)
  }));

  app.post<{ Body: Partial<McpRuntimeCanaryInput> }>(
    "/api/admin/mcp-runtime/canary",
    async (request, reply) => {
      const connectionId = typeof request.body?.connectionId === "string"
        ? request.body.connectionId.trim()
        : "";
      if (!connectionId) return badRequest(reply, "缺少 connectionId");
      const mode = request.body?.mode ?? "connection";
      if (!["connection", "tools_list", "catalog", "query"].includes(mode)) {
        return badRequest(reply, "mode 无效");
      }
      const data = await runMcpRuntimeCanary({
        connectionId,
        mode,
        ...(typeof request.body?.agentId === "string" && request.body.agentId.trim()
          ? { agentId: request.body.agentId.trim() }
          : {}),
        ...(typeof request.body?.sourceName === "string" && request.body.sourceName.trim()
          ? { sourceName: request.body.sourceName.trim() }
          : {})
      }, dependencies.probeExecutionRuntime);
      return { ok: true, data };
    }
  );

  /**
   * Spec 191 §8/§12 — trigger an execution runtime reload.
   *
   * `/api/admin/*` does NOT imply owner-only: the global auth hook only
   * guarantees "an authenticated administrator". The owner check is explicit
   * and the auth mode is checked FIRST, because `requireOwner` reads
   * `request.lucyAdmin?.admin` and would answer 401 in open mode where there
   * is no owner account at all. The existing owner routes use the same
   * `resolveAuthMode() !== "required"` → 400 AUTH_NOT_CONFIGURED pattern.
   */
  app.post<{ Body: { connectionId?: string; reason?: string } }>(
    "/api/admin/mcp-runtime/reload",
    async (request, reply) => {
      if ((await resolveAuthMode()) !== "required") {
        await recordReloadAudit(request, {
          outcome: "denied",
          detail: "尚未配置所有者账户，无法重载执行层"
        });
        return reply.status(400).send({
          ok: false,
          error: { code: "AUTH_NOT_CONFIGURED", message: "请先完成管理员引导" }
        });
      }
      if (!(await requireOwner(request, reply, "仅所有者可重载执行层"))) {
        await recordReloadAudit(request, {
          outcome: "denied",
          detail: "仅所有者可重载执行层"
        });
        return;
      }

      const connectionId = typeof request.body?.connectionId === "string"
        ? request.body.connectionId.trim()
        : "";
      // The activation statement BEFORE the reload, so the audit row shows the
      // transition instead of a placeholder.
      const previousActivation = await resolveProjectRoot()
        .then((root) => readReloadState(root).then((state) => state.activation))
        .catch(() => undefined);
      const reloadFn = dependencies.reloadExecutionRuntime ?? reloadExecutionRuntime;
      const result = await reloadFn({
        ...(connectionId ? { connectionId } : {}),
        ...(typeof request.body?.reason === "string" ? { reason: request.body.reason } : {})
      });
      await recordReloadAudit(request, {
        outcome: result.reloadStatus,
        result,
        ...(previousActivation ? { previousActivation } : {})
      });
      return { ok: true, data: result };
    }
  );
}
