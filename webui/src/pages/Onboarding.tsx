import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet } from "../lib/apiClient";
import { queryKeys } from "../lib/queryKeys";
import type { Agent, ChangedFilesResponse, ProjectInfo, SourcesResponse } from "../lib/types";
import { PageHeader } from "../components/PageHeader";

type AgentsResponse = { agents: Agent[] };

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

function StepStatus({ ready }: { ready: boolean }) {
  return (
    <span className={`pl-status-badge ${ready ? "pl-status-done" : "pl-status-partial"}`}>
      {ready ? "Ready" : "Needs setup"}
    </span>
  );
}

function OnboardingStep({
  index,
  title,
  description,
  ready,
  action,
  children
}: {
  index: number;
  title: string;
  description: string;
  ready: boolean;
  action: { label: string; to: string };
  children: ReactNode;
}) {
  return (
    <section className="pl-onboarding-step">
      <div className="pl-onboarding-step-index">{index}</div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="pl-panel-title mb-0">{title}</h2>
          <StepStatus ready={ready} />
        </div>
        <p className="pl-notice mt-1">{description}</p>
        <div className="mt-4">{children}</div>
      </div>
      <div className="flex justify-end">
        <Link className="pl-btn pl-btn--secondary" to={action.to}>{action.label}</Link>
      </div>
    </section>
  );
}

function buildMcpConfig(endpoint: string) {
  return JSON.stringify(
    {
      mcpServers: {
        lucy: {
          url: endpoint,
          headers: {
            Authorization: "Bearer <LUCY_AGENT_TOKEN>"
          }
        }
      }
    },
    null,
    2
  );
}

function defaultMcpEndpoint() {
  if (typeof window === "undefined") return "http://127.0.0.1:7879/mcp";
  const host = window.location.hostname || "127.0.0.1";
  const protocol = window.location.protocol === "https:" ? "https:" : "http:";
  return `${protocol}//${host}:7879/mcp`;
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
  const endpoint = useMemo(defaultMcpEndpoint, []);
  const mcpConfig = useMemo(() => buildMcpConfig(endpoint), [endpoint]);
  const loading = projectQuery.isLoading || sourcesQuery.isLoading || diffQuery.isLoading || agentsQuery.isLoading;
  const error = projectQuery.error ?? sourcesQuery.error ?? diffQuery.error ?? agentsQuery.error;
  const connectionReady = connections.length > 0 && projectQuery.data?.ktxAvailable === true;
  const tableScopeReady = enabledTables > 0;
  const semanticReady = sources.length > 0 && doneSources > 0;
  const validationReady = changedFiles.length === 0;
  const mcpReady = !mcpNotReadyReason;

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

  async function copyConfig() {
    try {
      await navigator.clipboard.writeText(mcpConfig);
      setCopied(true);
      toast.success("MCP 配置已复制");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "复制失败");
    }
  }

  if (loading) {
    return <p className="pl-notice">正在加载上线检查...</p>;
  }

  if (error) {
    return <p className="pl-error">上线检查加载失败：{error instanceof Error ? error.message : "未知错误"}</p>;
  }

  return (
    <div className="pl-page-stack">
      <PageHeader
        title="上线检查"
        breadcrumbs={["部署向导", "上线检查"]}
        description="按客户部署主链路检查 Lucy 是否已经可以作为 MCP 服务管理平台交付给 agent 使用。"
        badges={
          projectQuery.data ? (
            <>
              <span>KTX {projectQuery.data.ktxAvailable ? "可用" : "不可用"}</span>
              <span>{doneSources}/{sources.length} 语义完成</span>
            </>
          ) : null
        }
        actions={
          <>
            <Link className="pl-btn pl-btn--secondary" to="/connections">数据库接入</Link>
            <Link className="pl-btn pl-btn--primary" to="/admin/agents">配置 Agent</Link>
          </>
        }
      />

      <section
        className={
          readyCount === 5
            ? "pl-delivery-banner pl-delivery-banner--ready"
            : "pl-delivery-banner"
        }
        data-testid="onboarding-delivery-banner"
      >
        {readyCount === 5 ? (
          <>
            <div>
              <strong>Lucy MCP is ready for Agent delivery</strong>
              <span>Agent can connect through {endpoint}.</span>
            </div>
            <button type="button" className="pl-btn pl-btn--primary" onClick={copyConfig}>
              {copied ? "已复制 .mcp.json" : "复制 .mcp.json 配置"}
            </button>
          </>
        ) : (
          <>
            <div>
              <strong>还差 {5 - readyCount} 项即可交付</strong>
              <span>下一项：{blocker?.reason ?? blocker?.title ?? "继续检查配置"}</span>
            </div>
            {blocker ? (
              <Link className="pl-btn pl-btn--secondary" to={blocker.to}>
                打开阻塞项
              </Link>
            ) : null}
          </>
        )}
      </section>

      <div className="pl-metric-grid">
        <div className="pl-metric-card">
          <span>Deployment readiness</span>
          <strong>{readyCount}/5</strong>
          <small>{readyCount === 5 ? "Ready" : `${5 - readyCount} items remaining`}</small>
          <div className="pl-progress">
            <i style={{ width: `${(readyCount / 5) * 100}%` }} />
          </div>
        </div>
        <div
          className={
            projectQuery.data?.ktxAvailable
              ? "pl-metric-card pl-metric-card--success"
              : "pl-metric-card pl-metric-card--danger"
          }
        >
          <span>KTX Runtime</span>
          <strong>{projectQuery.data?.ktxAvailable ? "Available" : "Unavailable"}</strong>
          <small>{projectQuery.data?.root ?? "项目根未知"}</small>
        </div>
        <div className="pl-metric-card">
          <span>Semantic coverage</span>
          <strong>
            {doneSources}/{sources.length}
          </strong>
          <small>{semanticPercent}% maintained</small>
        </div>
        <div className="pl-metric-card">
          <span>MCP access</span>
          <strong>{enabledTokenCount}</strong>
          <small>
            {agents.length} agents · {tokenCount} tokens
          </small>
        </div>
      </div>

      <div className="pl-onboarding-list">
        <OnboardingStep
          index={1}
          title="接入数据库"
          description="确认 Lucy/KTX 能读取当前项目连接，并且 KTX runtime 在部署环境可用。"
          ready={connectionReady}
          action={{ label: "查看连接", to: "/connections" }}
        >
          <div className="pl-onboarding-facts">
            <span>{connections.length} 个连接</span>
            {connections[0] ? <span>{connections.map((conn) => conn.id).join(", ")}</span> : null}
            <span>{connections.reduce((sum, conn) => sum + conn.schemas.length, 0)} 个 schema</span>
            <span>KTX {projectQuery.data?.ktxAvailable ? "可用" : "不可用"}</span>
          </div>
        </OnboardingStep>

        <OnboardingStep
          index={2}
          title="限定表范围"
          description="维护 enabled_tables，确保只有目标物理表进入语义层和 MCP 暴露范围。"
          ready={tableScopeReady}
          action={{ label: "表白名单", to: "/connections/whitelist" }}
        >
          <div className="pl-onboarding-facts">
            <span>{enabledTables} 张 enabled table</span>
            <span>{sources.length} 张 semantic table</span>
          </div>
        </OnboardingStep>

        <OnboardingStep
          index={3}
          title="配置语义层"
          description="补齐至少一张核心表的业务语义；其余扫描表可作为后续维护队列继续完善。"
          ready={semanticReady}
          action={{ label: "维护语义", to: "/" }}
        >
          <div className="pl-onboarding-facts">
            <span>{doneSources} 张 done</span>
            <span>{sources.length - doneSources} 张待完善</span>
          </div>
        </OnboardingStep>

        <OnboardingStep
          index={4}
          title="校验并审阅变更"
          description="上线前查看 semantic-layer/wiki/config 变更，并对本次保存过的表运行 validate。"
          ready={validationReady}
          action={{ label: "审阅校验", to: "/review" }}
        >
          <div className="pl-onboarding-facts">
            <span>{changedFiles.length} 个待审阅文件</span>
            <span>{validationReady ? "当前无未审阅变更" : "需要运行 Validate changed"}</span>
          </div>
        </OnboardingStep>

        <OnboardingStep
          index={5}
          title="配置 Agent MCP"
          description="创建 Agent 和 token，把 Lucy MCP endpoint 配到目标 agents 平台。"
          ready={mcpReady}
          action={{ label: "Agent 实例", to: "/admin/agents" }}
        >
          <div className="grid gap-3">
            <div className="pl-onboarding-facts">
              <span>{agents.length} 个 Agent</span>
              <span>{enabledTokenCount} 个可用 token</span>
              <span>{endpoint}</span>
            </div>
            {!mcpReady && <div className="pl-notice">{mcpNotReadyReason}</div>}
            <div className="pl-code-snippet">
              <span>MCP config</span>
              <code>{mcpConfig}</code>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="pl-btn pl-btn--secondary" onClick={copyConfig}>
                {copied ? "已复制" : "复制 MCP 配置"}
              </button>
              <Link className="pl-btn pl-btn--ghost" to={agents[0] ? `/admin/agents/${agents[0].id}/tokens/new` : "/admin/agents"}>
                新建 Token
              </Link>
            </div>
          </div>
        </OnboardingStep>
      </div>
    </div>
  );
}
