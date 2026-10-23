import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PageHeader } from "../../components/PageHeader";
import { apiGet, apiPost } from "../../lib/apiClient";
import type { Agent, EffectivePermissionsPreview, McpRuntimeCanaryResult, McpRuntimeStatus } from "../../lib/types";
import { queryKeys } from "../../lib/queryKeys";
import { adminAgentsQueryOptions } from "../../lib/displayQueryOptions";

type AgentsResponse = { agents: Agent[] };
type Task = "connect" | "table" | "";

type AclPreviewData = {
  allowed: boolean;
  decisionReason: string;
  decisionReasonLabel: string;
  decisionReasonDetail?: string;
  roleIds: string[];
  remediation: {
    primary: { label: string; href: string };
    secondary: Array<{ label: string; href: string }>;
  };
};

type LiveSmokeData = {
  httpStatus: number;
  decisionReason: string;
  decisionReasonLabel: string;
  result: unknown;
  auditHref?: string;
};

function firstString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function readArgsPrefill(raw: string | null): { connectionId: string; sourceName: string } {
  if (!raw) return { connectionId: "", sourceName: "" };
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { connectionId: "", sourceName: "" };
    }
    const record = value as Record<string, unknown>;
    return {
      connectionId: firstString(record, ["connectionId", "connection_id", "connection", "database"]),
      sourceName: firstString(record, ["sourceName", "source_name", "source", "table"])
    };
  } catch {
    return { connectionId: "", sourceName: "" };
  }
}

function initialTask(mode: string | null): Task {
  if (mode === "live-smoke") return "connect";
  if (mode === "dry-run") return "table";
  return "";
}

function tokenProblem(value: string): string | null {
  if (value.includes("{") || value.includes("mcpServers")) return "只粘贴 Token 那一串";
  return null;
}

function stripBearer(value: string): string {
  return value.replace(/^Bearer\s+/i, "").trim();
}

function recheckConnectionId(status: McpRuntimeStatus | undefined): string {
  return status?.execution.missingConnections?.[0] || "";
}

function connectReady(
  execution: McpRuntimeStatus["execution"] | undefined,
  canary: McpRuntimeCanaryResult | undefined
): boolean {
  if (!execution) return false;
  if (canary?.status === "blocked") return true;
  if (canary?.status === "fail") return false;
  return execution.status === "ok" || execution.status === "unknown";
}

export function McpPlayground() {
  const [searchParams, setSearchParams] = useSearchParams();
  const prefill = useMemo(() => readArgsPrefill(searchParams.get("args")), [searchParams]);
  const [agentId, setAgentId] = useState(() => searchParams.get("agentId") ?? "");
  const [task, setTask] = useState<Task>(() => initialTask(searchParams.get("mode")));
  const [connectionId, setConnectionId] = useState(prefill.connectionId);
  const [sourceName, setSourceName] = useState(prefill.sourceName);
  const [bearerToken, setBearerToken] = useState("");
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [confirmLive, setConfirmLive] = useState(false);

  const agentsQuery = useQuery({
    ...adminAgentsQueryOptions<AgentsResponse>()
  });
  const runtimeQuery = useQuery({
    queryKey: queryKeys.mcpRuntime,
    queryFn: () => apiGet<McpRuntimeStatus>("/api/admin/mcp-runtime/status")
  });
  const permissionsQuery = useQuery({
    queryKey: ["admin", "agent-effective-permissions", agentId],
    queryFn: () => apiGet<EffectivePermissionsPreview>(`/api/admin/agents/${encodeURIComponent(agentId)}/effective-permissions`),
    enabled: Boolean(agentId) && task === "table"
  });
  const runtimeCanaryMutation = useMutation({
    mutationFn: (connection: string) =>
      apiPost<McpRuntimeCanaryResult>("/api/admin/mcp-runtime/canary", {
        connectionId: connection,
        ...(agentId ? { agentId } : {}),
        mode: "connection"
      }),
    onSuccess: () => {
      void runtimeQuery.refetch();
    }
  });

  const previewMutation = useMutation({
    mutationFn: (body: { agentId: string; tool: string; arguments: unknown }) =>
      apiPost<AclPreviewData>("/api/admin/mcp-playground/acl-preview", body)
  });

  const liveMutation = useMutation({
    mutationFn: (body: { agentId: string; tool: string; bearerToken: string }) =>
      apiPost<LiveSmokeData>("/api/admin/mcp-playground/live-smoke", body)
  });

  useEffect(() => {
    const params = new URLSearchParams(searchParams);
    if (!params.has("tool") && !params.has("args")) return;
    params.delete("tool");
    params.delete("args");
    setSearchParams(params, { replace: true });
  }, [searchParams, setSearchParams]);

  function syncQuery(next: { agentId?: string; mode?: string }) {
    const params = new URLSearchParams(searchParams);
    params.delete("tool");
    params.delete("args");
    if (next.agentId !== undefined) {
      if (next.agentId) params.set("agentId", next.agentId);
      else params.delete("agentId");
    }
    if (next.mode !== undefined) {
      if (next.mode) params.set("mode", next.mode);
      else params.delete("mode");
    }
    setSearchParams(params, { replace: true });
  }

  const enabledAgents = (agentsQuery.data?.agents ?? []).filter((agent) => agent.enabled);
  const selectedAgent = enabledAgents.find((agent) => agent.id === agentId);
  const permissions = permissionsQuery.data;
  const connections = useMemo(
    () => [...(permissions?.connections ?? [])].sort((a, b) => a.localeCompare(b)),
    [permissions]
  );
  const sources = useMemo(() => {
    const seen = new Set<string>();
    return (permissions?.sources ?? [])
      .filter((source) => source.connectionId === connectionId && source.sourceName)
      .filter((source) => {
        if (seen.has(source.sourceName)) return false;
        seen.add(source.sourceName);
        return true;
      })
      .sort((a, b) => a.sourceName.localeCompare(b.sourceName));
  }, [permissions, connectionId]);
  const roleId = selectedAgent?.role || permissions?.roleIds?.[0] || "";
  const roleHref = roleId
    ? `/admin/roles/${encodeURIComponent(roleId)}?tab=permissions`
    : `/admin/agents/${encodeURIComponent(agentId)}`;
  const execution = runtimeQuery.data?.execution;
  const canaryResult = runtimeCanaryMutation.data;
  const executionReady = connectReady(execution, canaryResult);
  const policyDegraded = runtimeQuery.isSuccess && runtimeQuery.data.policy.healthy === false;
  const tableChoicesReady = !runtimeQuery.isPending && !policyDegraded;
  const canaryConnection = recheckConnectionId(runtimeQuery.data);
  const preview = task === "table" ? previewMutation.data : undefined;
  const live = task === "connect" ? liveMutation.data : undefined;

  useEffect(() => {
    if (!permissions) return;
    if (connectionId && !permissions.connections.includes(connectionId)) {
      setConnectionId("");
      setSourceName("");
    }
  }, [permissions, connectionId]);

  useEffect(() => {
    if (!connectionId || !sourceName || !permissions) return;
    const visible = permissions.sources.some(
      (source) => source.connectionId === connectionId && source.sourceName === sourceName
    );
    if (!visible) setSourceName("");
  }, [permissions, connectionId, sourceName]);

  function chooseAgent(nextAgentId: string) {
    setAgentId(nextAgentId);
    setConnectionId("");
    setSourceName("");
    setBearerToken("");
    setTokenError(null);
    setConfirmLive(false);
    previewMutation.reset();
    liveMutation.reset();
    runtimeCanaryMutation.reset();
    syncQuery({ agentId: nextAgentId, mode: task === "connect" ? "live-smoke" : task === "table" ? "dry-run" : "" });
  }

  function chooseTask(next: Task) {
    setTask(next);
    setConfirmLive(false);
    previewMutation.reset();
    liveMutation.reset();
    runtimeCanaryMutation.reset();
    syncQuery({ agentId, mode: next === "connect" ? "live-smoke" : "dry-run" });
  }

  function onTokenChange(value: string) {
    const problem = tokenProblem(value);
    setTokenError(problem);
    setBearerToken(problem ? value : stripBearer(value));
  }

  async function runTableCheck() {
    if (!agentId || !connectionId || !sourceName || policyDegraded) return;
    syncQuery({ agentId, mode: "dry-run" });
    await previewMutation.mutateAsync({
      agentId,
      tool: "lucy_query",
      arguments: { connectionId, sourceName }
    });
  }

  async function runLive() {
    const token = stripBearer(bearerToken);
    if (!agentId || !token || tokenProblem(bearerToken) || !executionReady) return;
    setConfirmLive(false);
    syncQuery({ agentId, mode: "live-smoke" });
    await liveMutation.mutateAsync({
      agentId,
      tool: "tools/list",
      bearerToken: token
    });
  }

  const runtimeError = runtimeQuery.error instanceof Error
    ? runtimeQuery.error.message
    : runtimeCanaryMutation.error instanceof Error
      ? runtimeCanaryMutation.error.message
      : undefined;
  const runtimeCard = task === "connect" && execution && runtimeQuery.isSuccess
    ? runtimeVerdict({
        execution,
        executionReady,
        canary: canaryResult,
        liveSettled: Boolean(live)
      })
    : null;
  const previewTone = preview?.allowed ? "success" : "danger";
  const liveConnected = Boolean(live && live.decisionReason === "allowed" && live.httpStatus < 400);

  return (
    <div className="pl-page-stack" data-testid="mcp-playground-page">
      <PageHeader
        title={<span className="notranslate" translate="no">MCP 调试台</span>}
        description={
          <>
            检查这个 <span className="notranslate" translate="no">Agent</span> 能不能连上，或者能不能查某张表。
          </>
        }
      />

      <section className="pl-panel">
        <label className="grid max-w-md gap-1.5 text-sm">
          <span className="notranslate" translate="no">Agent</span>
          <select
            className="pl-input notranslate"
            translate="no"
            value={selectedAgent ? agentId : ""}
            data-testid="mcp-playground-agent"
            onChange={(event) => chooseAgent(event.target.value)}
          >
            <option value="" className="notranslate" translate="no">
              选择 Agent
            </option>
            {enabledAgents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name || agent.id} ({agent.id})
              </option>
            ))}
          </select>
        </label>

        {selectedAgent ? (
          <div className="mt-4 grid gap-4">
            <p className="text-sm">
              <span className="notranslate" translate="no">Role</span>
              <span className="ml-2 notranslate" translate="no" data-testid="mcp-playground-role">
                {selectedAgent.role || selectedAgent.roles?.join(", ") || "—"}
              </span>
            </p>

            <fieldset className="grid gap-2">
              <legend className="text-sm">检查什么</legend>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="mcp-playground-task"
                  checked={task === "connect"}
                  data-testid="mcp-playground-task-connect"
                  onChange={() => chooseTask("connect")}
                />
                检查能不能连上
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="mcp-playground-task"
                  checked={task === "table"}
                  data-testid="mcp-playground-task-table"
                  onChange={() => chooseTask("table")}
                />
                检查能不能查某张表
              </label>
            </fieldset>

            {task === "connect" ? (
              <div className="grid gap-4" data-testid="mcp-playground-connect">
                {runtimeCard ? (
                  <section className="pl-panel" data-testid="mcp-playground-execution-block" data-tone={runtimeCard.tone}>
                    <VerdictCard
                      tone={runtimeCard.tone}
                      headline={runtimeCard.headline}
                      detail={runtimeCard.detail}
                      recheck={runtimeCard.recheck && canaryConnection ? {
                        pending: runtimeCanaryMutation.isPending,
                        disabled: runtimeCanaryMutation.isPending,
                        connectionId: canaryConnection,
                        onClick: () => runtimeCanaryMutation.mutate(canaryConnection)
                      } : undefined}
                    />
                  </section>
                ) : null}
                {runtimeError ? <p className="pl-error text-sm">{runtimeError}</p> : null}
                {executionReady ? (
                  <>
                    <label className="grid max-w-md gap-1.5 text-sm">
                      <span className="notranslate" translate="no">Token</span>
                      <input
                        type="password"
                        className="pl-input notranslate"
                        translate="no"
                        value={bearerToken}
                        onChange={(event) => onTokenChange(event.target.value)}
                        placeholder="粘贴这个 Agent 的 Token"
                        data-testid="mcp-playground-token"
                      />
                    </label>
                    {tokenError ? (
                      <p className="pl-error text-sm" data-testid="mcp-playground-token-error">{tokenError}</p>
                    ) : null}
                    <div>
                      <button
                        type="button"
                        className="pl-btn pl-btn--primary text-sm"
                        disabled={!stripBearer(bearerToken) || Boolean(tokenError) || liveMutation.isPending}
                        onClick={() => {
                          if (!stripBearer(bearerToken) || tokenError) return;
                          setConfirmLive(true);
                        }}
                        data-testid="mcp-playground-run-live"
                      >
                        检查接入
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}

            {task === "table" ? (
              <div className="grid gap-4" data-testid="mcp-playground-table">
                {policyDegraded ? (
                  <div className="grid gap-3" data-testid="mcp-playground-policy-block">
                    <p className="pl-notice text-sm">策略运行时降级，现在不能判断这张表能不能查。</p>
                    <Link to="/admin/config-audit" className="pl-card-cta" data-testid="mcp-playground-policy-link">
                      查看配置审计 ↗
                    </Link>
                  </div>
                ) : null}
                {permissionsQuery.isError ? (
                  <p className="pl-error text-sm" data-testid="mcp-playground-preview-error">
                    {(permissionsQuery.error as Error).message}
                  </p>
                ) : null}
                {tableChoicesReady && permissionsQuery.isSuccess && connections.length === 0 ? (
                  <Link to={roleHref} className="pl-card-cta" data-testid="mcp-playground-role-link">
                    去授权连接 ↗
                  </Link>
                ) : null}
                {tableChoicesReady && connections.length > 0 ? (
                  <label className="grid max-w-md gap-1.5 text-sm">
                    <span>连接</span>
                    <select
                      className="pl-input notranslate"
                      translate="no"
                      value={connectionId}
                      data-testid="mcp-playground-connection"
                      onChange={(event) => {
                        setConnectionId(event.target.value);
                        setSourceName("");
                        previewMutation.reset();
                      }}
                    >
                      <option value="">选择连接</option>
                      {connections.map((id) => (
                        <option key={id} value={id}>{id}</option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {tableChoicesReady && connectionId && permissionsQuery.isSuccess && sources.length === 0 ? (
                  <Link to={roleHref} className="pl-card-cta" data-testid="mcp-playground-role-link">
                    去编辑表范围 ↗
                  </Link>
                ) : null}
                {tableChoicesReady && sources.length > 0 ? (
                  <>
                    <label className="grid max-w-md gap-1.5 text-sm">
                      <span>表</span>
                      <select
                        className="pl-input notranslate"
                        translate="no"
                        value={sourceName}
                        data-testid="mcp-playground-source"
                        onChange={(event) => {
                          setSourceName(event.target.value);
                          previewMutation.reset();
                        }}
                      >
                        <option value="">选择表</option>
                        {sources.map((source) => (
                          <option key={source.sourceName} value={source.sourceName}>{source.sourceName}</option>
                        ))}
                      </select>
                    </label>
                    <div>
                      <button
                        type="button"
                        className="pl-btn pl-btn--primary text-sm"
                        disabled={!sourceName || previewMutation.isPending}
                        onClick={() => void runTableCheck()}
                        data-testid="mcp-playground-run-table"
                      >
                        {previewMutation.isPending ? "检查中..." : "检查权限"}
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      {task === "table" && previewMutation.isError ? (
        <p className="pl-error" data-testid="mcp-playground-preview-error">
          {(previewMutation.error as Error).message}
        </p>
      ) : null}
      {task === "connect" && liveMutation.isError ? (
        <p className="pl-error" data-testid="mcp-playground-live-error">
          {(liveMutation.error as Error).message}
        </p>
      ) : null}

      {preview && selectedAgent ? (
        <section className="pl-panel" data-testid="mcp-playground-preview-result" data-tone={previewTone}>
          <VerdictCard
            tone={previewTone}
            headline={preview.allowed
              ? <><AgentName agent={selectedAgent} />可以查 <Identifier>{sourceName}</Identifier></>
              : <><AgentName agent={selectedAgent} />不能查 <Identifier>{sourceName}</Identifier></>}
            detail={preview.allowed
              ? <>连接 <Identifier>{connectionId}</Identifier>。这是权限预览，没有真正查数。</>
              : denyDetail(preview)}
            code={preview.decisionReason === "allowed" ? undefined : preview.decisionReason}
            action={preview.allowed ? undefined : preview.remediation.primary}
          />
        </section>
      ) : null}

      {live && selectedAgent ? (
        <section className="pl-panel" data-testid="mcp-playground-live-result" data-tone={liveConnected ? "success" : "danger"}>
          <VerdictCard
            tone={liveConnected ? "success" : "danger"}
            headline={liveConnected
              ? <><AgentName agent={selectedAgent} />能连上</>
              : <><AgentName agent={selectedAgent} />不能连上</>}
            detail={liveConnected
              ? <>已向本机 <span className="notranslate" translate="no">MCP</span> 拉取工具列表，并写入访问日志。</>
              : live.decisionReason === "allowed"
                ? `HTTP ${live.httpStatus}`
                : live.decisionReasonLabel}
            action={live.auditHref ? { label: "查看访问日志", href: live.auditHref } : undefined}
          />
        </section>
      ) : null}

      {confirmLive ? (
        <div className="pl-modal-backdrop" role="dialog" aria-modal="true" data-testid="mcp-playground-live-confirm">
          <div className="pl-panel max-w-md">
            <h3 className="pl-panel-title">确认检查接入</h3>
            <p className="pl-notice mt-2">
              将向本机 Lucy <span className="notranslate" translate="no">MCP</span> 发送一次工具列表请求，并写入访问日志。
              <span className="notranslate" translate="no">Token</span> 只留在本次会话。
            </p>
            <div className="mt-4 flex gap-2 justify-end">
              <button type="button" className="pl-btn pl-btn--ghost text-sm" onClick={() => setConfirmLive(false)}>
                取消
              </button>
              <button
                type="button"
                className="pl-btn pl-btn--primary text-sm"
                disabled={liveMutation.isPending}
                onClick={() => void runLive()}
                data-testid="mcp-playground-confirm-live"
              >
                {liveMutation.isPending ? "检查中..." : "确认运行"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Identifier({ children }: { children: string }) {
  return <span className="notranslate" translate="no">{children}</span>;
}

function IdList({ ids }: { ids: string[] }) {
  return (
    <>
      {ids.map((id, index) => (
        <span key={id}>
          {index > 0 ? "、" : null}
          <Identifier>{id}</Identifier>
        </span>
      ))}
    </>
  );
}

function AgentName({ agent }: { agent: Agent }) {
  const name = agent.name?.trim() || agent.id;
  if (name === agent.id) return <Identifier>{agent.id}</Identifier>;
  return (
    <>
      <Identifier>{name}</Identifier>
      （<Identifier>{agent.id}</Identifier>）
    </>
  );
}

function denyDetail(preview: AclPreviewData): string {
  if (!preview.decisionReasonDetail) return preview.decisionReasonLabel;
  return `${preview.decisionReasonLabel}（${preview.decisionReasonDetail}）`;
}

function GateDetail({ execution }: { execution: McpRuntimeStatus["execution"] }) {
  const missing = execution.missingConnections ?? [];
  const unknown = execution.unknownConnections ?? [];
  if (execution.status === "stale") {
    return missing.length > 0
      ? <>问数进程还没加载 <IdList ids={missing} />。</>
      : <>问数进程还没加载最新配置。</>;
  }
  if (execution.status === "unknown") {
    const names = unknown.length > 0 ? unknown : missing;
    return names.length > 0
      ? <>还没有 <IdList ids={names} /> 的加载记录。</>
      : <>还没有当前连接的加载记录。</>;
  }
  const error = execution.lastError?.trim();
  return error ? <>问数进程不可用。{error}</> : <>问数进程不可用。</>;
}

function canaryFailureDetail(canary: McpRuntimeCanaryResult): ReactNode {
  const id = <Identifier>{canary.connectionId}</Identifier>;
  if (canary.decisionReason === "config_missing") return <>配置里没有 {id}。</>;
  if (canary.decisionReason === "policy_missing_connection") return <>这个 Agent 的生效权限不包含 {id}。</>;
  if (canary.decisionReason === "execution_runtime_unavailable" || canary.decisionReason === "upstream_error") {
    return <>问数进程不可用。</>;
  }
  return <>问数进程还没加载 {id}。</>;
}

type RuntimeVerdict = {
  tone: "success" | "danger" | "warning";
  headline: ReactNode;
  detail?: ReactNode;
  recheck: boolean;
};

function runtimeVerdict(input: {
  execution: McpRuntimeStatus["execution"];
  executionReady: boolean;
  canary?: McpRuntimeCanaryResult;
  liveSettled: boolean;
}): RuntimeVerdict | null {
  const { execution, executionReady, canary, liveSettled } = input;
  if (liveSettled || executionReady) return null;
  if (canary?.status === "fail") {
    return {
      tone: "danger",
      headline: "不能连上",
      detail: canaryFailureDetail(canary),
      recheck: canary.decisionReason === "execution_config_stale"
    };
  }
  return {
    tone: "danger",
    headline: "不能连上",
    detail: <GateDetail execution={execution} />,
    recheck: execution.status === "stale"
  };
}

function VerdictCard({
  tone,
  headline,
  detail,
  code,
  action,
  recheck
}: {
  tone: "success" | "danger" | "warning";
  headline: ReactNode;
  detail?: ReactNode;
  code?: string;
  action?: { label: string; href: string };
  recheck?: { pending: boolean; disabled: boolean; connectionId: string; onClick: () => void };
}) {
  const banner = tone === "success"
    ? "pl-diagnostic-banner pl-diagnostic-banner--success"
    : tone === "danger"
      ? "pl-diagnostic-banner pl-diagnostic-banner--danger"
      : "pl-diagnostic-banner pl-diagnostic-banner--warning";
  return (
    <>
      <div className={banner} role="status" aria-live="polite">
        <strong data-testid="mcp-playground-result-headline">{headline}</strong>
      </div>
      {detail ? <p className="mt-3 text-sm" data-testid="mcp-playground-result-detail">{detail}</p> : null}
      {code ? (
        <details className="mt-3 text-sm" data-testid="mcp-playground-technical">
          <summary>技术详情</summary>
          <p className="mt-2 font-mono text-xs text-fg-muted notranslate" translate="no" data-testid="decision-reason-code">
            {code}
          </p>
        </details>
      ) : null}
      {action ? (
        <Link to={action.href} className="pl-card-cta mt-4 inline-block notranslate" translate="no" data-testid="mcp-playground-result-action">
          {action.label} ↗
        </Link>
      ) : null}
      {recheck ? (
        <div className="mt-4">
          <button
            type="button"
            className="pl-btn pl-btn--secondary text-sm"
            disabled={recheck.disabled}
            onClick={recheck.onClick}
            data-testid="mcp-playground-recheck"
          >
            {recheck.pending ? "检测中..." : <>检测 <Identifier>{recheck.connectionId}</Identifier></>}
          </button>
        </div>
      ) : null}
    </>
  );
}
