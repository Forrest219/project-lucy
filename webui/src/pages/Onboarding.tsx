import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet } from "../lib/apiClient";
import { queryKeys } from "../lib/queryKeys";
import type { Agent, ChangedFilesResponse, McpEndpointInfo, ProjectInfo, SourcesResponse } from "../lib/types";
import { buildMcpConfig } from "../lib/mcpEndpoint";
import { PageHeader } from "../components/PageHeader";
import {
  buildActionRequiredItems,
  buildServiceHealth,
  NO_ACTION_REQUIRED_MESSAGE,
  pendingSemanticCount
} from "../lib/opsDashboard";

type AgentsResponse = { agents: Agent[] };
type HealthTone = "ready" | "warning" | "info" | "danger";

function isLegacyAllowAgent(agent: Agent): boolean {
  return !agent.role && Boolean(agent.allow);
}

function mcpAccessReason(agents: Agent[], enabledTokenCount: number): string | undefined {
  if (agents.length === 0) return "尚未创建 Agent";
  const enabledAgents = agents.filter((agent) => agent.enabled);
  if (enabledAgents.length === 0) return "所有 Agent 均已禁用";
  if (agents.every(isLegacyAllowAgent)) return "所有 Agent 仍为 legacy allow，需迁移到 role";
  if (enabledTokenCount === 0) return "启用的 Agent 暂无可用 token";
  return undefined;
}

function diagnosticStatusClass(tone: HealthTone) {
  if (tone === "ready") return "pl-status-done";
  if (tone === "danger") return "pl-status-validation_failed";
  return "pl-status-partial";
}

function HealthDiagnosticItem({
  title,
  description,
  tone,
  statusLabel,
  children
}: {
  title: string;
  description: string;
  tone: HealthTone;
  statusLabel: string;
  children?: ReactNode;
}) {
  return (
    <section className="pl-health-item" data-tone={tone}>
      <div className="pl-health-item-status" aria-hidden="true" />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="pl-panel-title mb-0">{title}</h2>
          <span className={`pl-status-badge ${diagnosticStatusClass(tone)}`}>{statusLabel}</span>
        </div>
        <p className="pl-notice mt-1">{description}</p>
        {children ? <div className="mt-4">{children}</div> : null}
      </div>
    </section>
  );
}

function percent(done: number, total: number) {
  if (total <= 0) return 0;
  return Math.round((done / total) * 100);
}

type ChecklistStep = {
  title: string;
  ready: boolean;
  to: string;
  reason?: string;
};

function firstBlockingStep(steps: ChecklistStep[]) {
  return steps.find((step) => !step.ready);
}

function fallbackNotice(endpointInfo: McpEndpointInfo | undefined) {
  if (!endpointInfo) return null;
  if (endpointInfo.status === "fallback") {
    return (
      <div className="pl-notice" data-testid="mcp-fallback-notice">
        当前使用本地默认 MCP endpoint。客户部署请配置 LUCY_PUBLIC_MCP_URL，避免 Agent 复制到只能在本机访问的地址。
      </div>
    );
  }
  if (endpointInfo.status === "invalid") {
    return (
      <div className="pl-error" data-testid="mcp-invalid-notice">
        Lucy MCP endpoint 配置无效：
        {endpointInfo.diagnostics.map((d, i) => (
          <span key={`${d.code}-${i}`}>{d.message}</span>
        ))}
      </div>
    );
  }
  return null;
}

function SeverityBadge({ severity }: { severity: "critical" | "warning" | "ready" | "info" }) {
  const className =
    severity === "critical"
      ? "pl-status-validation_failed"
      : severity === "warning"
        ? "pl-status-partial"
        : severity === "ready"
          ? "pl-status-done"
          : "pl-status-not_started";
  const label =
    severity === "critical"
      ? "Critical"
      : severity === "warning"
        ? "Warning"
        : severity === "ready"
          ? "Ready"
          : "Info";
  return (
    <span className={`pl-status-badge ${className}`} data-severity={severity}>
      {label}
    </span>
  );
}

export function Onboarding() {
  const [copied, setCopied] = useState(false);
  const projectQuery = useQuery({
    queryKey: queryKeys.project,
    queryFn: () => apiGet<ProjectInfo>("/api/project")
  });
  const sourcesQuery = useQuery({
    queryKey: queryKeys.sources,
    queryFn: () => apiGet<SourcesResponse>("/api/sources")
  });
  const diffQuery = useQuery({
    queryKey: queryKeys.diff,
    queryFn: () => apiGet<ChangedFilesResponse>("/api/diff")
  });
  const agentsQuery = useQuery({
    queryKey: ["admin", "agents"],
    queryFn: () => apiGet<AgentsResponse>("/api/admin/agents")
  });
  // M36 review follow-up: query the latest eval run so the "近 30 天无评测数据"
  // item is honest. We only fetch the head of the list (limit=1); the API
  // already supports this filter. If the call fails (older deployments,
  // missing endpoint) we silently fall back to 0 so the dashboard never
  // fabricates a critical alert.
  const evalLastRunQuery = useQuery({
    queryKey: ["eval", "runs", "last"],
    queryFn: () => apiGet<{ total: number; runs: unknown[] }>("/api/eval/runs?limit=1"),
    retry: false,
    staleTime: 60_000
  });

  const connections = projectQuery.data?.connections ?? [];
  const enabledTables = connections.reduce((sum, conn) => sum + conn.enabledTables.length, 0);
  const sources = sourcesQuery.data?.tables ?? [];
  const doneSources = sources.filter((source) => source.completion === "done").length;
  const changedFiles = diffQuery.data?.files ?? [];
  const agents = agentsQuery.data?.agents ?? [];
  const enabledAgents = agents.filter((agent) => agent.enabled);
  const tokenCount = agents.reduce((sum, agent) => sum + agent.tokens.filter((token) => !token.revoked).length, 0);
  const enabledTokenCount = enabledAgents.reduce((sum, agent) => sum + agent.tokens.filter((token) => !token.revoked).length, 0);
  const mcpNotReadyReason = mcpAccessReason(agents, enabledTokenCount);
  const endpointInfo = projectQuery.data?.mcpEndpoint;
  const endpoint = endpointInfo?.url ?? null;
  const mcpConfig = useMemo(
    () => (endpoint ? buildMcpConfig(endpoint) : ""),
    [endpoint]
  );
  const canCopyMcp = endpoint !== null;
  const loading = projectQuery.isLoading || sourcesQuery.isLoading || diffQuery.isLoading || agentsQuery.isLoading;
  const error = projectQuery.error ?? sourcesQuery.error ?? diffQuery.error ?? agentsQuery.error;
  const connectionReady = connections.length > 0 && projectQuery.data?.ktxAvailable === true;
  const tableScopeReady = enabledTables > 0;
  const semanticReady = sources.length > 0 && doneSources > 0;
  const validationReady = changedFiles.length === 0;
  const mcpReady = !mcpNotReadyReason && endpointInfo?.status !== "invalid";
  const semanticPendingCount = sources.length - doneSources;
  const semanticTone: HealthTone =
    semanticReady && tableScopeReady
      ? semanticPendingCount > 0
        ? "warning"
        : "ready"
      : "warning";
  const semanticStatusLabel =
    semanticPendingCount > 0
      ? `${semanticPendingCount} 待完善`
      : semanticReady && tableScopeReady
        ? "Ready"
        : "Needs setup";

  const checklistSteps: ChecklistStep[] = [
    { title: "接入数据库", ready: connectionReady, to: "/connections" },
    { title: "限定表范围", ready: tableScopeReady, to: "/connections/whitelist" },
    { title: "配置语义层", ready: semanticReady, to: "/" },
    { title: "校验并审阅变更", ready: validationReady, to: "/review" },
    { title: "配置 Agent MCP", ready: mcpReady, reason: mcpNotReadyReason, to: "/admin/agents" }
  ];
  const readyCount = checklistSteps.filter((step) => step.ready).length;
  const blocker = firstBlockingStep(checklistSteps);
  const semanticPercent = percent(doneSources, sources.length);
  const deliveryBannerReady = readyCount === 5 && canCopyMcp;

  // M36: Ops Dashboard view-model inputs.
  // `pendingCatalogItems` and `aclDenied7d` are not exposed by a single
  // dedicated endpoint today; we derive them from existing surfaces so the
  // queue stays honest without inventing new backend work. The page-level
  // acceptance criteria in the spec call out that the "待处理事项" must
  // include the catalog / access risk items whenever their counts are > 0.
  const pendingCatalogItems = Math.max(0, sources.length - doneSources);
  const aclDenied7d = agents.reduce(
    (sum, agent) => sum + (agent.stats?.deniedLast7d ?? 0),
    0
  );
  const actionItems = useMemo(
    () =>
      buildActionRequiredItems({
        semanticCoverage: { done: doneSources, total: sources.length },
        pendingCatalogItems,
        pendingPublishFiles: changedFiles.length,
        // M36 review follow-up: derive from `/api/eval/runs?limit=1` so the
        // "近 30 天无评测数据" item disappears once eval has run. We do not
        // try to filter by date on the client; the server is the source of
        // truth and we only need the boolean "has any run at all". If the
        // query is still loading or errored we conservatively report 0 so
        // the dashboard does not flash a false positive.
        evalRunsLast30d: evalLastRunQuery.isLoading || evalLastRunQuery.error
          ? 0
          : (evalLastRunQuery.data?.runs.length ?? 0),
        aclDenied7d
      }),
    [doneSources, sources.length, pendingCatalogItems, changedFiles.length, evalLastRunQuery.isLoading, evalLastRunQuery.error, evalLastRunQuery.data, aclDenied7d]
  );
  const serviceHealth = useMemo(
    () =>
      buildServiceHealth({
        ktxAvailable: projectQuery.data?.ktxAvailable === true,
        mcpReady,
        semanticCoverage: { done: doneSources, total: sources.length },
        agentsEnabled: enabledAgents.length,
        agentsTotal: agents.length,
        enabledTokenCount
      }),
    [projectQuery.data?.ktxAvailable, mcpReady, doneSources, sources.length, enabledAgents.length, agents.length, enabledTokenCount]
  );
  const semanticGap = pendingSemanticCount({ done: doneSources, total: sources.length });

  async function copyConfig() {
    if (!canCopyMcp) {
      toast.error("当前 Lucy MCP endpoint 不可用，无法复制配置");
      return;
    }
    try {
      await navigator.clipboard.writeText(mcpConfig);
      setCopied(true);
      toast.success("MCP 配置已复制");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "复制失败");
    }
  }

  function refreshStatus() {
    void Promise.all([
      projectQuery.refetch(),
      sourcesQuery.refetch(),
      diffQuery.refetch(),
      agentsQuery.refetch()
    ]);
  }

  if (loading) {
    return <p className="pl-notice">正在加载系统概览...</p>;
  }

  if (error) {
    return <p className="pl-error">系统概览加载失败：{error instanceof Error ? error.message : "未知错误"}</p>;
  }

  return (
    <div className="pl-page-stack">
      <PageHeader
        title="运维驾驶舱"
        breadcrumbs={["系统概览"]}
        description="查看 Lucy MCP、KTX runtime、语义资产与 Agent 接入的当前健康状态。聚合首页待办，判断 data agent 是否处于可交付状态。"
        badges={
          <>
            <span>KTX {projectQuery.data?.ktxAvailable ? "可用" : "不可用"}</span>
            <span>{doneSources}/{sources.length} 语义完成</span>
            <span>{enabledTokenCount} 活跃 Token</span>
          </>
        }
        actions={
          <button type="button" className="pl-btn pl-btn--secondary" onClick={refreshStatus}>
            刷新状态
          </button>
        }
      />

      <section
        className={
          deliveryBannerReady
            ? "pl-delivery-banner pl-delivery-banner--ready"
            : "pl-delivery-banner"
        }
        data-testid="onboarding-delivery-banner"
      >
        {deliveryBannerReady ? (
          <>
            <div>
              <strong>Lucy MCP 服务运行正常</strong>
              <span>服务节点已就绪，当前可正常接受 Agent 连接：{endpoint}</span>
            </div>
            <button type="button" className="pl-btn pl-btn--primary" onClick={copyConfig}>
              {copied ? "已复制 .mcp.json" : "复制 .mcp.json 配置"}
            </button>
          </>
        ) : (
          <>
            <div>
              <strong>Lucy MCP 服务异常</strong>
              <span>阻塞原因：{blocker?.reason ?? blocker?.title ?? "继续检查配置"}</span>
            </div>
            {blocker ? (
              <Link className="pl-btn pl-btn--secondary" to={blocker.to}>
                打开阻塞项
              </Link>
            ) : null}
          </>
        )}
      </section>

      <section className="pl-panel" data-testid="ops-service-health">
        <div className="pl-section-heading">
          <div>
            <h2 className="pl-panel-title mb-1">服务健康</h2>
            <p className="pl-notice">Lucy MCP、KTX runtime、语义层、Agent 接入四个核心组件的当前状态。</p>
          </div>
        </div>
        <div className="pl-service-health-strip">
          {serviceHealth.map((item) => (
            <div key={item.key} className="pl-service-health-item" data-status={item.status}>
              <span className="pl-service-health-status" aria-hidden="true" />
              <div>
                <div className="pl-service-health-label">{item.label}</div>
                <div className="pl-service-health-detail">{item.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="pl-panel" data-testid="ops-action-required">
        <div className="pl-section-heading">
          <div>
            <h2 className="pl-panel-title mb-1">待处理事项</h2>
            <p className="pl-notice">聚合语义缺口、待发布变更、评测缺口、ACL 风险。点击任一项可直接进入处理页面。</p>
          </div>
          <span className="pl-notice" data-testid="ops-action-required-count">{actionItems.length} 项</span>
        </div>
        {actionItems.length === 0 ? (
          <div className="pl-action-required-empty" data-testid="ops-action-required-empty">
            {NO_ACTION_REQUIRED_MESSAGE}
          </div>
        ) : (
          <div className="pl-action-required-list">
            {actionItems.map((item) => (
              <div
                key={item.id}
                className="pl-action-required-item"
                data-severity={item.severity}
                data-testid={item.testId}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityBadge severity={item.severity} />
                  <span className="text-sm text-fg-default">{item.label}</span>
                </div>
                {item.href ? (
                  <Link
                    className="pl-btn pl-btn--ghost text-sm notranslate"
                    translate="no"
                    to={item.href}
                    data-testid={`${item.testId}-link`}
                  >
                    前往处理 →
                  </Link>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="pl-ops-grid">
        <section className="pl-panel" data-testid="ops-quality-snapshot">
          <div className="pl-section-heading">
            <div>
              <h2 className="pl-panel-title mb-1">质量快照</h2>
              <p className="pl-notice">语义资产覆盖度与变更审阅状态，决定发布前的最后一道关。</p>
            </div>
          </div>
          <div className="pl-snapshot-grid">
            <div className="pl-snapshot-card">
              <span className="pl-snapshot-card-label">语义资产覆盖度</span>
              <strong className="pl-snapshot-card-value">
                {doneSources}/{sources.length} ({semanticPercent}%)
              </strong>
              <small className="text-fg-muted">{semanticGap} 张表待补</small>
            </div>
            <div className="pl-snapshot-card">
              <span className="pl-snapshot-card-label">待发布变更</span>
              <strong className="pl-snapshot-card-value">{changedFiles.length} 个文件</strong>
              <small className="text-fg-muted">
                {validationReady ? "当前无未审阅变更" : "需要进入发布工作台审阅"}
              </small>
            </div>
            <div className="pl-snapshot-card">
              <span className="pl-snapshot-card-label">最近一次发布</span>
              <strong className="pl-snapshot-card-value">—</strong>
              <small className="text-fg-muted">
                前往 <Link to="/publish/history" className="text-accent underline">发布记录</Link> 查看历史
              </small>
            </div>
            <div className="pl-snapshot-card">
              <span className="pl-snapshot-card-label">趋势监控</span>
              <strong className="pl-snapshot-card-value">0 次 Run</strong>
              <small className="text-fg-muted">
                <Link to="/eval/monitor" className="text-accent underline">触发首次 Run</Link> 以建立质量基线
              </small>
            </div>
          </div>
        </section>

        <section className="pl-panel" data-testid="ops-access-risk">
          <div className="pl-section-heading">
            <div>
              <h2 className="pl-panel-title mb-1">访问风险</h2>
              <p className="pl-notice">Agent / token / ACL 风险摘要，触发条件来自近 7 天访问统计。</p>
            </div>
          </div>
          <div className="pl-risk-list">
            <div className="pl-risk-item" data-tone={enabledAgents.length === 0 ? "danger" : "default"}>
              <div>
                <strong>Agent 启用与禁用</strong>
                <div className="text-xs text-fg-muted">
                  {enabledAgents.length} 启用 / {agents.length} 总数
                </div>
              </div>
              <Link to="/admin/agents" className="pl-btn pl-btn--ghost text-sm notranslate" translate="no">
                查看 Agent 管理 →
              </Link>
            </div>
            <div className="pl-risk-item" data-tone={aclDenied7d > 0 ? "danger" : "default"}>
              <div>
                <strong>近 7 天 ACL deny</strong>
                <div className="text-xs text-fg-muted">
                  {aclDenied7d} 次拒绝
                </div>
              </div>
              <Link
                to="/admin/audit?outcome=denied"
                className="pl-btn pl-btn--ghost text-sm notranslate"
                translate="no"
              >
                查看访问日志 →
              </Link>
            </div>
            <div className="pl-risk-item" data-tone={enabledTokenCount === 0 && agents.length > 0 ? "warning" : "default"}>
              <div>
                <strong>可用 token</strong>
                <div className="text-xs text-fg-muted">
                  {enabledTokenCount} 个活跃 token
                </div>
              </div>
              <Link to="/admin/agents" className="pl-btn pl-btn--ghost text-sm notranslate" translate="no">
                管理 token →
              </Link>
            </div>
          </div>
        </section>
      </div>

      <section className="pl-panel">
        <div className="pl-section-heading">
          <div>
            <h2 className="pl-panel-title mb-1">实时状态与诊断</h2>
            <p className="pl-notice">持续观察运行中的数据源、语义资产、审阅风险和 Agent 接入状态。</p>
          </div>
        </div>

        <div className="pl-health-list">
          <HealthDiagnosticItem
            title="数据源连接"
            description="确认 Lucy/KTX 能读取当前项目连接，并且 KTX runtime 在运行环境可用。"
            tone={connectionReady ? "ready" : "danger"}
            statusLabel={connectionReady ? "Ready" : "Needs setup"}
          >
            <div className="pl-onboarding-facts">
              <span>{connections.length} 个连接</span>
              {connections[0] ? <span>{connections.map((conn) => conn.id).join(", ")}</span> : null}
              <span className="notranslate" translate="no">{connections.reduce((sum, conn) => sum + conn.schemas.length, 0)} 个 Schema</span>
              <span>KTX {projectQuery.data?.ktxAvailable ? "可用" : "不可用"}</span>
            </div>
          </HealthDiagnosticItem>

          <HealthDiagnosticItem
            title="语义层状态"
            description="观察 enabled tables 与语义资产覆盖度，识别仍待补齐业务口径的表。"
            tone={semanticTone}
            statusLabel={semanticStatusLabel}
          >
            <div className="pl-onboarding-facts">
              <span>{doneSources} 张 done</span>
              <span>{semanticPendingCount} 张待完善</span>
              <span>{enabledTables} 张 enabled table</span>
              <span>{sources.length} 张 semantic table</span>
            </div>
          </HealthDiagnosticItem>

          <HealthDiagnosticItem
            title="变更审阅"
            description="监控 semantic-layer、wiki 与 config 是否存在待审阅变更，避免未确认内容进入交付态。"
            tone={validationReady ? "ready" : "warning"}
            statusLabel={validationReady ? "Ready" : `${changedFiles.length} 待审阅`}
          >
            <div className="pl-onboarding-facts">
              <span>{changedFiles.length} 个待审阅文件</span>
              <span>{validationReady ? "当前无未审阅变更" : "需要审阅未发布变更"}</span>
            </div>
          </HealthDiagnosticItem>

          <HealthDiagnosticItem
            title="Agent 接入点"
            description="查看 Lucy MCP endpoint、Agent 与 token 状态，并复制目标 agents 平台所需配置。"
            tone={mcpReady ? "ready" : "warning"}
            statusLabel={mcpReady ? "Ready" : "Needs setup"}
          >
            <div className="grid gap-3">
              <div className="pl-onboarding-facts">
                <span>{agents.length} 个 Agent</span>
                <span>{enabledTokenCount} 个可用 token</span>
                <span>{endpoint ?? "—"}</span>
              </div>
              {!mcpReady && <div className="pl-notice">{mcpNotReadyReason}</div>}
              {fallbackNotice(endpointInfo)}
              {canCopyMcp ? (
                <>
                  <div className="pl-code-snippet">
                    <span>MCP config</span>
                    <code>{mcpConfig}</code>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" className="pl-btn pl-btn--primary" onClick={copyConfig}>
                      {copied ? "已复制" : "复制 MCP 配置"}
                    </button>
                    <Link className="pl-btn pl-btn--ghost" to="/admin/agents">
                      查看 Agent 管理 -&gt;
                    </Link>
                  </div>
                </>
              ) : null}
            </div>
          </HealthDiagnosticItem>
        </div>
      </section>
    </div>
  );
}
