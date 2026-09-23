import { stat } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";
import { readCatalogReloads } from "../catalog-reload.js";
import {
  getExecutionRuntimeObservation,
  listExecutionRuntimeObservations,
  readKtxYamlDigest
} from "../mcp-runtime-state.js";
import { readProject, resolveProjectRoot } from "../project.js";
import { effectivePermissions, getPolicyRuntimeStatus, isPolicyRuntimeHealthy } from "../proxy/acl.js";

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
    const response = await fetch(upstreamEndpoint().url, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: "lucy-runtime-probe", method: "tools/list", params: {} }),
      signal: controller.signal
    });
    const responseText = await response.text();
    const envelope = parseProbeEnvelope(responseText);
    result = response.ok && envelope && !("error" in envelope)
      ? { status: "reachable", checkedAt }
      : {
          status: "error",
          checkedAt,
          error: response.ok
            ? "KTX MCP probe returned an invalid or error response"
            : `KTX MCP probe returned HTTP ${response.status}`
        };
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
    execution: summarizeExecution(probe, connectionIds, digest)
  };
}

function badRequest(reply: FastifyReply, message: string) {
  return reply.code(400).send({
    ok: false,
    error: { code: "bad_request", message }
  });
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
        detail: "请重启或重新加载 KTX MCP Runtime 后，再执行一次只读查询验证。"
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
}
