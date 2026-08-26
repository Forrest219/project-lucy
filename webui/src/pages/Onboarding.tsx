import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Activity,
  KeyRound,
  Layers,
  ShieldAlert,
  Upload,
  Users
} from "lucide-react";
import { apiGet } from "../lib/apiClient";
import { queryKeys } from "../lib/queryKeys";
import type { Agent, ChangedFilesResponse, McpEndpointInfo, ProjectInfo, SourcesResponse } from "../lib/types";
import { buildMcpConfig } from "../lib/mcpEndpoint";
import { PageHeader } from "../components/PageHeader";
import {
  availableTokenCount,
  buildActionRequiredItems,
  buildServiceHealth,
  DEEP_LINKS,
  NO_ACTION_REQUIRED_MESSAGE,
  pendingSemanticCount,
  summarizeServiceHealth,
  systemAlertText,
  warningSummaryCta,
  type ActionRequiredItem,
  type Severity,
  type ServiceHealthItem,
  type ServiceHealthSummary,
  severityLabelBySeverity
} from "../lib/opsDashboard";

type AgentsResponse = { agents: Agent[] };
type HealthTone = "ready" | "warning" | "info" | "danger";

function isLegacyAllowAgent(agent: Agent): boolean {
  return !agent.role && Boolean(agent.allow);
}

function mcpAccessReason(agents: Agent[], availableTokenCount: number): string | undefined {
  if (agents.length === 0) return "尚未创建 Agent";
  const enabledAgents = agents.filter((agent) => agent.enabled);
  if (enabledAgents.length === 0) return "所有 Agent 均已禁用";
  if (agents.every(isLegacyAllowAgent)) return "所有 Agent 仍为 legacy allow，需迁移到 role";
  if (availableTokenCount === 0) return "启用的 Agent 暂无可用 token";
  return undefined;
}

function diagnosticStatusClass(tone: HealthTone) {
  if (tone === "ready") return "pl-status-done";
  if (tone === "danger") return "pl-status-validation_failed";
  return "pl-status-partial";
}

function severityBadgeClass(severity: Severity): string {
  if (severity === "critical") return "pl-status-validation_failed";
  if (severity === "warning") return "pl-status-partial";
  if (severity === "ready") return "pl-status-done";
  return "pl-status-not_started";
}

/**
 * Render a Severity as a Chinese-language status badge. The badge colour
 * still tracks the underlying severity bucket for non-colour signals
 * (icon, text label, icon shape), but the user-visible label is always
 * one of `高风险 / 待处理 / 提醒 / 就绪`.
 */
function SeverityBadge({
  severity
}: {
  severity: Severity;
}) {
  return (
    <span
      className={`pl-status-badge ${severityBadgeClass(severity)}`}
      data-severity={severity}
    >
      {severityLabelBySeverity[severity]}
    </span>
  );
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
          <h3 className="pl-panel-title mb-0">{title}</h3>
          <span className={`pl-status-badge ${diagnosticStatusClass(tone)}`} translate="no">
            {statusLabel}
          </span>
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

function fallbackNotice(endpointInfo: McpEndpointInfo | undefined) {
  if (!endpointInfo) return null;
  if (endpointInfo.status === "fallback") {
    return (
      <div className="pl-notice" data-testid="mcp-fallback-notice">
        当前为本地开发 <span className="notranslate" translate="no">fallback</span>，不可用于客户交付。请配置{" "}
        <code className="notranslate" translate="no">LUCY_PUBLIC_MCP_URL</code> 为{" "}
        <span className="notranslate" translate="no">Agent</span> 可达的对外{" "}
        <span className="notranslate" translate="no">MCP</span> <span className="notranslate" translate="no">Endpoint</span>
        （须与宿主发布端口或反向代理 URL 一致）。本地开发仍可复制下方配置，但部署就绪不计完成。
      </div>
    );
  }
  if (endpointInfo.status === "invalid") {
    return (
      <div className="pl-error" data-testid="mcp-invalid-notice">
        Lucy <span className="notranslate" translate="no">MCP</span> <span className="notranslate" translate="no">Endpoint</span> 配置无效：
        {endpointInfo.diagnostics.map((d, i) => (
          <span key={`${d.code}-${i}`} className="notranslate" translate="no">{d.message}</span>
        ))}
      </div>
    );
  }
  return null;
}

/**
 * M41: render the system-status summary line. The view-model is structured
 * (not a plain string) so we can wrap `Lucy MCP` / `KTX Runtime` /
 * `Agent` / numeric counts in `notranslate` spans per terminology standard.
 */
function ServiceHealthSummaryView({ summary }: { summary: ServiceHealthSummary }) {
  const cta = warningSummaryCta(summary);
  return (
    <section
      className="pl-system-health-summary"
      data-testid="ops-service-health-summary"
      data-tone={summary.tone}
    >
      <span className="pl-system-health-summary-dot" aria-hidden="true" />
      <div className="min-w-0">
        <strong>
          <span className="notranslate" translate="no">Lucy MCP</span> 与{" "}
          <span className="notranslate" translate="no">KTX Runtime</span> 运行正常
        </strong>
        <p>核心接入链路可用，交付待办见下方处理事项。</p>
      </div>
      <Link to={cta.href} className="pl-card-cta notranslate" translate="no" data-testid="ops-service-health-summary-cta">
        {cta.text} ↗
      </Link>
    </section>
  );
}

/**
 * Compact Service Health strip. M41 replaces this with `ServiceHealthSummaryView`
 * on `/overview`; the helper is retained here in case other surfaces need
 * the per-component breakdown.
 */
function ServiceHealthStrip({ items }: { items: ServiceHealthItem[] }) {
  return (
    <section
      className="pl-panel pl-service-health-panel"
      data-testid="ops-service-health"
    >
      <div className="pl-service-health-compact" role="status" aria-live="polite">
        <span className="pl-service-health-compact-dot" aria-hidden="true" data-overall={overallTone(items)} />
        <span className="pl-service-health-compact-label">系统状态</span>
        <ul className="pl-service-health-compact-list">
          {items.map((item) => (
            <li
              key={item.key}
              className="pl-service-health-compact-item"
              data-status={item.status}
            >
              <span
                className="notranslate pl-service-health-compact-name"
                translate="no"
              >
                {item.label}
              </span>
              <span
                className="notranslate pl-service-health-compact-detail"
                translate="no"
              >
                {item.detail}
              </span>
            </li>
          ))}
        </ul>
        <Link
          to="/admin/audit"
          className="pl-service-health-compact-log"
          data-testid="ops-service-health-log-link"
        >
          [控制台日志]
        </Link>
      </div>
    </section>
  );
}

function overallTone(items: ServiceHealthItem[]): HealthTone {
  if (items.some((item) => item.status === "danger")) return "danger";
  if (items.some((item) => item.status === "warning")) return "warning";
  if (items.every((item) => item.status === "ready")) return "ready";
  return "info";
}

/**
 * M39 MCP config Drawer. The Drawer is a small modal-style panel that lives
 * inside the Onboarding page; it is only mounted when the user clicks
 * `查看配置`. We deliberately reuse the existing `pl-drawer-*` CSS classes
 * (introduced by ObjectDetailDrawer) so the visual style stays consistent.
 */
function McpConfigDrawer({
  open,
  onClose,
  endpointInfo,
  mcpConfig
}: {
  open: boolean;
  onClose: () => void;
  endpointInfo: McpEndpointInfo | undefined;
  mcpConfig: string;
}) {
  // M39: close on ESC so users get the standard modal behaviour without
  // us having to pull in a dialog library.
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  const endpointUrl = endpointInfo?.url ?? "—";

  return (
    <div
      className="pl-drawer-backdrop notranslate"
      translate="no"
      role="dialog"
      aria-modal="true"
      aria-label="MCP 配置"
      data-testid="mcp-config-drawer"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="pl-drawer-panel" role="document">
        <header className="pl-drawer-header">
          <div className="grid gap-1 min-w-0">
            <span className="pl-eyebrow"><span className="notranslate" translate="no">MCP</span> · 对象详情</span>
            <h2
              className="pl-panel-title mb-0"
              data-testid="mcp-config-drawer-title"
            >
              <span className="notranslate" translate="no">MCP</span> 配置
            </h2>
          </div>
          <button
            type="button"
            className="pl-drawer-close pl-drawer-close--prominent notranslate"
            translate="no"
            onClick={onClose}
            aria-label="关闭 MCP 配置抽屉"
            data-testid="mcp-config-drawer-close"
          >
            关闭
          </button>
        </header>
        <div className="pl-drawer-body">
          <div className="pl-preview-section">
            <div className="grid gap-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted notranslate" translate="no">
                Endpoint
              </span>
              <code className="notranslate break-all text-sm text-fg-default" translate="no">
                {endpointUrl}
              </code>
            </div>
          </div>
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
                JSON
              </span>
            </div>
            <pre className="pl-code-snippet pl-code-snippet--drawer">
              <code className="notranslate" translate="no">{mcpConfig}</code>
            </pre>
            <p className="text-xs text-fg-muted">
              将上方 JSON 写入 <code className="notranslate" translate="no">.mcp.json</code>，
              把 <code className="notranslate" translate="no">&lt;LUCY_AGENT_TOKEN&gt;</code> 替换为新创建的 <span className="notranslate" translate="no">Token</span> 明文（仅显示一次，请妥善保存）。
            </p>
          </div>
        </div>
        <footer className="pl-drawer-footer pl-drawer-footer-border-t">
          <Link
            to="/admin/agents"
            className="pl-btn pl-btn--ghost text-sm notranslate"
            translate="no"
            data-testid="mcp-config-drawer-agent-link"
          >
            查看 <span className="notranslate" translate="no">Agent</span> ↗
          </Link>
        </footer>
      </div>
    </div>
  );
}

function ActionRequiredRow({ item }: { item: ActionRequiredItem }) {
  const testId = `ops-action-${item.id}`;
  return (
    <div
      className="pl-action-required-item"
      data-severity={item.severity}
      data-testid={testId}
    >
      <div className="pl-action-required-item-row">
        <div className="pl-action-required-item-title">
          <SeverityBadge severity={item.severity} />
          <div className="min-w-0">
            <span className="pl-action-required-item-heading">{item.title}</span>
            <p className="pl-action-required-item-description">{item.description}</p>
            <p className="pl-action-required-item-meta text-xs text-fg-muted" data-testid={`${testId}-meta`}>
              影响：{item.impact}
              <span aria-hidden="true"> · </span>
              证据来源：{item.evidence}
            </p>
          </div>
        </div>
        <Link
          className="pl-action-required-item-cta pl-card-cta notranslate"
          translate="no"
          to={item.actionUrl}
          data-testid={`${testId}-link`}
        >
          {item.actionText} ↗
        </Link>
      </div>
    </div>
  );
}

/**
 * Spec 102: shared metric row for 质量快照 / 访问风险.
 * Title top-left, primary value bottom-left, CTA right-center (对齐待处理事项).
 */
function OpsMetricRow({
  icon,
  title,
  value,
  hint,
  extra,
  cta,
  tone = "default",
  testId
}: {
  icon: ReactNode;
  title: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  extra?: ReactNode;
  cta?: { to: string; label: ReactNode; className?: string; translateNo?: boolean };
  tone?: "default" | "warning" | "danger";
  testId?: string;
}) {
  return (
    <div
      className="pl-ops-metric-row pl-metric-card pl-metric-card--with-icon"
      data-tone={tone}
      data-testid={testId}
    >
      <div className="pl-ops-metric-row-body">
        <div className="pl-metric-card-title">
          {icon}
          <span>{title}</span>
        </div>
        <div className="pl-ops-metric-row-value">
          <strong className="pl-ops-metric-row-strong">{value}</strong>
          {extra}
          {hint != null ? <div className="text-xs text-fg-muted">{hint}</div> : null}
        </div>
      </div>
      {cta ? (
        <Link
          to={cta.to}
          className={["pl-ops-metric-row-cta", "pl-card-cta", cta.className].filter(Boolean).join(" ")}
          {...(cta.translateNo ? { translate: "no" as const } : {})}
        >
          {cta.label}
        </Link>
      ) : null}
    </div>
  );
}

/**
 * Metric-first semantic-coverage card. M39 spec 41 §8 requires a standalone
 * percent + progressbar with `role="progressbar"` and aria-valuenow /
 * aria-valuemin / aria-valuemax, plus a text label so screen-reader users
 * do not rely on colour or bar length alone. Spec 102 wraps it in OpsMetricRow.
 */
function SemanticCoverageCard({
  done,
  total
}: {
  done: number;
  total: number;
}) {
  const percentValue = percent(done, total);
  const gap = pendingSemanticCount({ done, total });
  return (
    <OpsMetricRow
      testId="ops-metric-semantic"
      icon={<Layers className="pl-metric-card-icon" size={16} aria-hidden="true" data-testid="ops-metric-icon-semantic" />}
      title="语义覆盖率"
      value={
        <span className="notranslate" translate="no" data-testid="ops-semantic-percent">
          {percentValue}%
        </span>
      }
      extra={
        <div
          className="pl-progress"
          role="progressbar"
          aria-label={`语义覆盖率 ${percentValue}%`}
          aria-valuenow={percentValue}
          aria-valuemin={0}
          aria-valuemax={100}
          data-testid="ops-semantic-progress"
        >
          <span
            className="pl-progress-bar"
            style={{ width: `${percentValue}%` }}
          />
        </div>
      }
      hint={
        <>
          <span className="notranslate" translate="no">{done}</span>/<span className="notranslate" translate="no">{total}</span> 语义完成，
          <span className="notranslate" translate="no">{gap}</span> 张表待补
        </>
      }
      cta={{
        to: DEEP_LINKS.catalogIncomplete,
        label: "查看语义资产 ↗"
      }}
    />
  );
}

export function Onboarding() {
  // M39 polish (SEVERE-4): auto-reset the main copy label after 1.5s so
  // the user sees a brief "已复制" flash before the label reverts.
  const [copiedMain, setCopiedMain] = useState(false);
  // M39: Drawer open state. The main page never shows the raw JSON
  // config; the user must explicitly open the Drawer to inspect it.
  const [mcpDrawerOpen, setMcpDrawerOpen] = useState(false);
  // lastUpdatedAt: timestamp the dashboard was last successfully refreshed.
  // null = the user has not yet seen a successful refresh. The page-level
  // "上次更新" badge next to the refresh button reads from this state so
  // operators can decide at a glance whether to click again. Updated on:
  //   1. first successful load of all five core queries (initial mount), and
  //   2. every successful manual click of the refresh button.
  // Refresh failures leave it untouched, so the displayed timestamp always
  // reflects the freshest confirmed snapshot.
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  // consecutiveFailures: count of manual refresh attempts in a row that did
  // not confirm. Cleared on the next success. Drives the badge escalation
  // (text → danger colour + ! icon once the count crosses a threshold) so
  // the user can decide whether to investigate.
  const [consecutiveFailures, setConsecutiveFailures] = useState(0);
  // announceText: text written into a separate sr-only `<span role="status"
  // aria-live="polite">`. Decoupled from the visual badge so a screen reader
  // only hears status changes (mount, refresh success, threshold crossing)
  // and never the per-second ticker — see UX-OVERVIEW-003.
  const [announceText, setAnnounceText] = useState<string>("");
  // now: ticker that re-renders the relative-time label once per second so
  // "刚刚 / xx 秒前 / xx 分钟前" stays current without forcing the queries
  // to refetch. The interval is paused (via conditional effect below) when
  // we have no timestamp to render — avoids burning a timer for nothing.
  const [now, setNow] = useState<Date>(() => new Date());
  const projectQuery = useQuery({
    queryKey: queryKeys.project,
    queryFn: () => apiGet<ProjectInfo>("/api/project"),
    refetchOnMount: "always"
  });
  const sourcesQuery = useQuery({
    queryKey: queryKeys.sources,
    queryFn: () => apiGet<SourcesResponse>("/api/sources"),
    refetchOnMount: "always"
  });
  const diffQuery = useQuery({
    queryKey: queryKeys.diff,
    queryFn: () => apiGet<ChangedFilesResponse>("/api/diff"),
    refetchOnMount: "always"
  });
  const agentsQuery = useQuery({
    queryKey: ["admin", "agents"],
    queryFn: () => apiGet<AgentsResponse>("/api/admin/agents"),
    refetchOnMount: "always"
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
    staleTime: 60_000,
    refetchOnMount: "always"
  });

  const connections = projectQuery.data?.connections ?? [];
  const enabledTables = connections.reduce((sum, conn) => sum + conn.enabledTables.length, 0);
  const sources = sourcesQuery.data?.tables ?? [];
  // Spec 104: semantic coverage / gap only count Manifest tables that are enabled.
  const enabledSources = sources.filter((source) => source.enabled);
  const doneSources = enabledSources.filter((source) => source.completion === "done").length;
  const coverageTotal = enabledSources.length;
  const changedFiles = diffQuery.data?.files ?? [];
  const agents = agentsQuery.data?.agents ?? [];
  const enabledAgents = agents.filter((agent) => agent.enabled);
  // M41: token count follows new "可用 Token" semantics — excluded are
  // `enabled=false` parents, `revoked=true` tokens, expired tokens
  // (`expires_at <= now`), and tokens with unparseable `expires_at`.
  const availableTokenCountValue = availableTokenCount(agents);
  const mcpNotReadyReason = mcpAccessReason(agents, availableTokenCountValue);
  const endpointInfo = projectQuery.data?.mcpEndpoint;
  const endpoint = endpointInfo?.url ?? null;
  const mcpConfig = useMemo(
    () => (endpoint ? buildMcpConfig(endpoint) : ""),
    [endpoint]
  );
  const canCopyMcp = endpoint !== null;
  const loading = projectQuery.isLoading || sourcesQuery.isLoading || diffQuery.isLoading || agentsQuery.isLoading;
  const error = projectQuery.error ?? sourcesQuery.error ?? diffQuery.error ?? agentsQuery.error;

  // Sync lastUpdatedAt on first successful load. We deliberately wait for
  // ALL five core queries to settle so the timestamp always represents the
  // snapshot the user is looking at. evalLastRunQuery is included so a
  // missing/degraded eval endpoint doesn't leave the badge blank forever.
  // The boolean guard makes this a one-shot: subsequent refetches update
  // lastUpdatedAt via refreshStatus(), not via this effect.
  useEffect(() => {
    if (lastUpdatedAt !== null) return;
    const allLoaded =
      projectQuery.isSuccess &&
      sourcesQuery.isSuccess &&
      diffQuery.isSuccess &&
      agentsQuery.isSuccess &&
      evalLastRunQuery.isSuccess;
    if (!allLoaded) return;
    setLastUpdatedAt(new Date());
    setAnnounceText("系统概览数据已就绪");
    // Intentionally exclude lastUpdatedAt from deps — its current value is
    // the very thing the guard checks. The five query success flags are the
    // real trigger surface.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    projectQuery.isSuccess,
    sourcesQuery.isSuccess,
    diffQuery.isSuccess,
    agentsQuery.isSuccess,
    evalLastRunQuery.isSuccess
  ]);

  // Tick `now` once per second so the relative-time label stays honest. We
  // only run the interval while we have a timestamp to display — no-op
  // otherwise. Cleaned up on unmount.
  useEffect(() => {
    if (lastUpdatedAt === null) return;
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, [lastUpdatedAt]);

  // Render the relative-vs-absolute label. Within 15 minutes we show
  // "刚刚 / xx 秒前 / xx 分钟前" so the operator sees freshness at a glance.
  // Past 15 minutes the absolute HH:MM:SS is more useful for cross-referencing
  // with logs / audit timestamps. "未知" sentinel renders before any query
  // has settled.
  const lastUpdatedLabel = (() => {
    if (!lastUpdatedAt) return "未知";
    const diffMs = now.getTime() - lastUpdatedAt.getTime();
    if (diffMs < 5_000) return "刚刚";
    if (diffMs < 60_000) return `${Math.floor(diffMs / 1000)} 秒前`;
    if (diffMs < 15 * 60_000) return `${Math.floor(diffMs / 60_000)} 分钟前`;
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(lastUpdatedAt.getHours())}:${pad(lastUpdatedAt.getMinutes())}:${pad(lastUpdatedAt.getSeconds())}`;
  })();

  // failureLabel: appended to the badge when the user has tried to refresh
  // and failed at least once since the last confirmed snapshot. Returns "" if
  // there is nothing to say (no failure, or no confirmed snapshot yet).
  // UX-OVERVIEW-005: a failure must NOT change lastUpdatedAt, but the badge
  // has to make the failure visible inline so the operator doesn't have to
  // rely on a transient toast.
  const failureLabel = (() => {
    if (consecutiveFailures <= 0) return "";
    if (consecutiveFailures >= 3) return "刷新失败，连续 3 次以上未更新";
    if (consecutiveFailures === 1) return "刷新失败，重试中";
    return `刷新失败，连续 ${consecutiveFailures} 次未更新`;
  })();
  const badgeState: "ok" | "warning" | "danger" =
    consecutiveFailures >= 3 ? "danger" : consecutiveFailures >= 1 ? "warning" : "ok";
  const badgeClasses =
    badgeState === "danger"
      ? "text-xs text-danger-strong whitespace-nowrap font-medium"
      : badgeState === "warning"
        ? "text-xs text-warning-strong whitespace-nowrap"
        : "text-xs text-fg-muted whitespace-nowrap";
  const connectionReady = connections.length > 0 && projectQuery.data?.ktxAvailable === true;
  const tableScopeReady = enabledTables > 0;
  const semanticReady = coverageTotal > 0 && doneSources > 0;
  const validationReady = changedFiles.length === 0;
  // Only a configured LUCY_PUBLIC_MCP_URL counts as MCP-ready for deployment.
  // Local fallback remains copyable for npm-run-dev, but is not "ready".
  const mcpEndpointReady = endpointInfo?.status === "configured";
  const mcpAccessReady = !mcpNotReadyReason && mcpEndpointReady;
  const semanticPendingCount = coverageTotal - doneSources;
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
        ? "就绪"
        : "需要完善";

  // M36: Ops Dashboard view-model inputs.
  // Spec 104: catalog-pending stays same formula as semantic gap, on enabled set.
  const pendingCatalogItems = Math.max(0, coverageTotal - doneSources);
  const aclDenied7d = agents.reduce(
    (sum, agent) => sum + (agent.stats?.deniedLast7d ?? 0),
    0
  );
  const actionItems = useMemo(
    () =>
      buildActionRequiredItems({
        semanticCoverage: { done: doneSources, total: coverageTotal },
        pendingCatalogItems,
        pendingPublishFiles: changedFiles.length,
        // M39 review follow-up (P2-B): pass `null` while the eval probe is
        // still loading or has errored so the dashboard never fabricates
        // a misleading "近 30 天无评测数据" item against unknown data.
        // Only an explicit `0` from the eval API surfaces the item.
        evalRunsLast30d: evalLastRunQuery.isSuccess
          ? (evalLastRunQuery.data?.runs.length ?? 0)
          : null
      }),
    [
      doneSources,
      coverageTotal,
      pendingCatalogItems,
      changedFiles.length,
      evalLastRunQuery.isSuccess,
      evalLastRunQuery.data
    ]
  );
  const serviceHealth = useMemo(
    () =>
      buildServiceHealth({
        ktxAvailable: projectQuery.data?.ktxAvailable === true,
        mcpReady: mcpAccessReady,
        semanticCoverage: { done: doneSources, total: coverageTotal },
        agentsEnabled: enabledAgents.length,
        agentsTotal: agents.length,
        availableTokenCount: availableTokenCountValue
      }),
    [
      projectQuery.data?.ktxAvailable,
      mcpAccessReady,
      doneSources,
      coverageTotal,
      enabledAgents.length,
      agents.length,
      availableTokenCountValue
    ]
  );
  // M41: structured view model for the one-line "系统状态" summary.
  // Returns null when mcp / ktx is not ready; the page falls back to the
  // high-weight alert in that case.
  const summary = useMemo(
    () =>
      summarizeServiceHealth(
        mcpEndpointReady,
        projectQuery.data?.ktxAvailable === true,
        { done: doneSources, total: coverageTotal },
        { enabled: enabledAgents.length, total: agents.length }
      ),
    [mcpEndpointReady, projectQuery.data?.ktxAvailable, doneSources, coverageTotal, enabledAgents.length, agents.length]
  );
  const ktxAvailable = projectQuery.data?.ktxAvailable === true;
  const semanticPercent = percent(doneSources, coverageTotal);

  /**
   * M39 polish (SEVERE-4): the main page button and the Drawer button
   * each manage their own copy-feedback flag. The two entry points below
   * share only the clipboard write + error path; the "已复制" flash
   * never crosses over.
   */
  async function writeMcpConfigToClipboard(): Promise<boolean> {
    if (!canCopyMcp) {
      toast.error(
        <>
          当前 Lucy <span className="notranslate" translate="no">MCP</span>{" "}
          <span className="notranslate" translate="no">Endpoint</span> 不可用，无法复制配置
        </>
      );
      return false;
    }
    try {
      await navigator.clipboard.writeText(mcpConfig);
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "复制失败");
      return false;
    }
  }

  async function copyConfig() {
    const ok = await writeMcpConfigToClipboard();
    if (!ok) return;
    setCopiedMain(true);
    window.setTimeout(() => setCopiedMain(false), 1500);
    toast.success(
      <>
        <span className="notranslate" translate="no">MCP</span> 配置已复制
      </>
    );
  }

  async function refreshStatus() {
    // M41: toast on success / failure so the user always sees feedback
    // when they tap the manual refresh button. We deliberately resolve
    // all five queries (the four core ones plus the eval-runs probe)
    // so a single failing endpoint doesn't get masked and so the eval
    // item in the action-required queue actually tracks new runs after
    // a click.
    const settled = await Promise.allSettled([
      projectQuery.refetch(),
      sourcesQuery.refetch(),
      diffQuery.refetch(),
      agentsQuery.refetch(),
      evalLastRunQuery.refetch()
    ]);
    const failed = settled.find((result) => result.status === "rejected");
    if (failed) {
      setConsecutiveFailures((count) => count + 1);
      setAnnounceText("系统概览刷新失败");
      toast.error("系统概览刷新失败");
      return;
    }
    const queryErrors = settled.flatMap((result) => {
      if (result.status !== "fulfilled") return [];
      // Each fulfilled entry is a QueryObserverResult; `error` is the only
      // field that signals a query-level failure. We treat any truthy
      // `error` as a refresh failure so a single broken endpoint surfaces
      // immediately rather than silently succeeding.
      const value = result.value as { error?: unknown } | undefined;
      return value?.error ? [value.error] : [];
    });
    if (queryErrors.length > 0) {
      setConsecutiveFailures((count) => count + 1);
      setAnnounceText("系统概览刷新失败");
      toast.error("系统概览刷新失败");
      return;
    }
    setLastUpdatedAt(new Date());
    setNow(new Date());
    setConsecutiveFailures(0);
    setAnnounceText("系统概览已刷新");
    toast.success("系统概览已刷新");
  }

  const coreFetching =
    projectQuery.isFetching ||
    sourcesQuery.isFetching ||
    diffQuery.isFetching ||
    agentsQuery.isFetching ||
    // M39 review follow-up (P2-B): include the eval probe's in-flight
    // window in the refresh button label so the manual refresh that
    // touches `?limit=1` is reflected by the "刷新中..." state.
    evalLastRunQuery.isFetching;

  if (loading) {
    return <p className="pl-notice">正在加载系统概览...</p>;
  }

  // UX-OVERVIEW-005: the legacy "替换整页" 错误分支 must NOT fire after
  // a successful mount. Once we have a confirmed snapshot (lastUpdatedAt),
  // a later refetch failure must keep the dashboard visible and let the
  // badge surface the stale state inline — see `failureLabel` below.
  // The branch still owns the very first load so a deployment with a
  // broken upstream never pretends to render the dashboard.
  if (error && lastUpdatedAt === null) {
    return <p className="pl-error">系统概览加载失败：{error instanceof Error ? error.message : "未知错误"}</p>;
  }

  // M39: a critical-tone service-health panel must remain a high-emphasis
  // Alert. M41: ready / warning now render a single summary line; the
  // legacy compact strip is no longer shown on `/overview`. The danger
  // state is driven by raw endpoint readiness (mcpEndpointReady + ktxAvailable) rather
  // than the legacy `overallTone` aggregation, so an unavailable Lucy MCP
  // surfaces the alert even when KTX is fine.
  const isDanger = !mcpEndpointReady || !ktxAvailable;
  const alertText = systemAlertText(mcpEndpointReady, ktxAvailable);

  return (
    <div className="pl-page-stack">
      <PageHeader
        title="系统概览"
        description={
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span>
              查看 Lucy <span className="notranslate" translate="no">MCP</span>、<span className="notranslate" translate="no">KTX</span> <span className="notranslate" translate="no">Runtime</span>、语义资产与 <span className="notranslate" translate="no">Agent</span> 接入的当前健康状态。
            </span>
            {/*
              A11y announce channel (UX-OVERVIEW-003): writes only when status
              actually changes (mount, refresh success/failure). sr-only so
              the visual layout is unaffected, role=status + aria-live=polite
              so SRs announce on text change.
            */}
            <span
              className="sr-only"
              role="status"
              aria-live="polite"
              data-testid="onboarding-last-updated-announce"
            >
              {announceText}
            </span>
          </div>
        }
        actions={
          <div
            className="flex items-center gap-3"
            data-testid="onboarding-refresh-controls"
          >
            <span
              className={badgeClasses}
              data-testid="onboarding-last-updated"
              data-state={badgeState}
              aria-hidden="true"
            >
              上次更新：{lastUpdatedLabel}
              {failureLabel ? ` · ${failureLabel}` : ""}
            </span>
            <button
              type="button"
              className="pl-btn pl-btn--secondary text-sm"
              onClick={refreshStatus}
              disabled={coreFetching}
              data-testid="onboarding-refresh-button"
            >
              {coreFetching ? "刷新首页数据中..." : "刷新首页数据"}
            </button>
          </div>
        }
      />

      {isDanger ? (
        <section
          className="pl-panel pl-service-health-critical"
          role="alert"
          data-testid="ops-service-health-critical"
        >
          <div className="flex items-center gap-3">
            <span className="pl-service-health-critical-dot" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <strong>系统异常</strong>
              <p className="pl-notice notranslate" translate="no">{alertText}</p>
              <div className="mt-3 flex flex-wrap gap-3" data-testid="ops-service-health-critical-actions">
                {!mcpEndpointReady ? (
                  <>
                    <a href={DEEP_LINKS.overviewMcpAnchor} className="pl-card-cta notranslate" translate="no">
                      检查 MCP 接入 ↗
                    </a>
                    <Link to={DEEP_LINKS.mcpPlayground} className="pl-card-cta notranslate" translate="no">
                      打开 MCP 调试台 ↗
                    </Link>
                  </>
                ) : null}
                {!ktxAvailable ? (
                  <Link to={DEEP_LINKS.connections} className="pl-card-cta">
                    查看连接概览 ↗
                  </Link>
                ) : null}
              </div>
            </div>
          </div>
        </section>
      ) : summary ? (
        <ServiceHealthSummaryView summary={summary} />
      ) : null}

      <section className="pl-panel" data-testid="ops-action-required">
        <div className="pl-section-heading">
          <div>
            <h2 className="pl-panel-title mb-1">待处理事项</h2>
            <p className="pl-notice">聚合语义缺口、待发布变更、评测缺口。点击任一项可直接进入处理页面。ACL 拒绝见下方访问风险。</p>
          </div>
          <span className="pl-notice" data-testid="ops-action-required-count">
            {actionItems.length} 项
          </span>
        </div>
        {actionItems.length === 0 ? (
          <div className="pl-action-required-empty" data-testid="ops-action-required-empty">
            {NO_ACTION_REQUIRED_MESSAGE}
          </div>
        ) : (
          <div className="pl-action-required-list">
            {actionItems.map((item) => (
              <ActionRequiredRow key={item.id} item={item} />
            ))}
          </div>
        )}
      </section>

      <div className="pl-ops-grid">
        <section className="pl-panel" data-testid="ops-quality-snapshot">
          <div className="pl-section-heading">
            <div>
              <h2 className="pl-panel-title mb-1">质量快照</h2>
              <p className="pl-notice">语义覆盖、发布审阅与评测基线，决定发布前的最后一道关。</p>
            </div>
          </div>
          <div className="pl-snapshot-list">
            <SemanticCoverageCard done={doneSources} total={coverageTotal} />
            <OpsMetricRow
              testId="ops-metric-publish"
              icon={<Upload className="pl-metric-card-icon" size={16} aria-hidden="true" data-testid="ops-metric-icon-publish" />}
              title="待发布变更"
              value={<span className="notranslate" translate="no">{changedFiles.length}</span>}
              hint={validationReady ? "当前无未审阅变更" : "需要进入发布工作台审阅"}
              cta={{ to: DEEP_LINKS.publishWorkbench, label: "打开发布工作台 ↗" }}
            />
            <OpsMetricRow
              testId="ops-metric-eval"
              icon={<Activity className="pl-metric-card-icon" size={16} aria-hidden="true" data-testid="ops-metric-icon-eval" />}
              title="评测数据"
              value={
                <span className="notranslate" translate="no">
                  {evalLastRunQuery.isSuccess ? (evalLastRunQuery.data?.runs.length ?? 0) : "—"}
                </span>
              }
              hint={
                evalLastRunQuery.isSuccess
                  ? (evalLastRunQuery.data?.runs.length ?? 0) > 0
                    ? "近 30 天已有评测记录"
                    : "近 30 天无评测数据"
                  : "评测状态待刷新"
              }
              cta={{ to: DEEP_LINKS.evalMonitor, label: "查看趋势监控 ↗" }}
            />
          </div>
        </section>

        <section className="pl-panel" data-testid="ops-access-risk">
          <div className="pl-section-heading">
            <div>
              <h2 className="pl-panel-title mb-1">访问风险</h2>
              <p className="pl-notice"><span className="notranslate" translate="no">Agent</span> / token / ACL 风险摘要，触发条件来自近 7 天访问统计。</p>
            </div>
          </div>
          <div className="pl-risk-list">
            <OpsMetricRow
              testId="ops-metric-agents"
              tone={enabledAgents.length === 0 ? "danger" : "default"}
              icon={<Users className="pl-metric-card-icon" size={16} aria-hidden="true" data-testid="ops-metric-icon-agents" />}
              title={
                <>
                  <span className="notranslate" translate="no">Agent</span> 启用与禁用
                </>
              }
              value={
                <>
                  <span className="notranslate" translate="no">{enabledAgents.length}</span>
                  {" / "}
                  <span className="notranslate" translate="no">{agents.length}</span>
                </>
              }
              hint="启用 / 总数"
              cta={{
                to: DEEP_LINKS.agents,
                label: (
                  <>
                    查看 <span className="notranslate" translate="no">Agent</span> 管理 ↗
                  </>
                ),
                className: "notranslate",
                translateNo: true
              }}
            />
            <OpsMetricRow
              testId="ops-metric-acl"
              tone={aclDenied7d > 0 ? "danger" : "default"}
              icon={<ShieldAlert className="pl-metric-card-icon" size={16} aria-hidden="true" data-testid="ops-metric-icon-acl" />}
              title="近 7 天 ACL 拒绝"
              value={<span className="notranslate" translate="no">{aclDenied7d}</span>}
              hint="次拒绝"
              cta={{ to: DEEP_LINKS.auditDenied, label: "查看访问日志 ↗" }}
            />
            <OpsMetricRow
              testId="ops-metric-tokens"
              tone={availableTokenCountValue === 0 && agents.length > 0 ? "warning" : "default"}
              icon={<KeyRound className="pl-metric-card-icon" size={16} aria-hidden="true" data-testid="ops-metric-icon-token" />}
              title={
                <>
                  可用 <span className="notranslate" translate="no">Token</span>
                </>
              }
              value={<span className="notranslate" translate="no">{availableTokenCountValue}</span>}
              hint={
                <>
                  <span className="notranslate" translate="no">{availableTokenCountValue}</span> 个可用{" "}
                  <span className="notranslate" translate="no">Token</span>
                </>
              }
              cta={{
                to: DEEP_LINKS.agents,
                label: (
                  <>
                    管理 <span className="notranslate" translate="no">Token</span> ↗
                  </>
                ),
                className: "notranslate",
                translateNo: true
              }}
            />
          </div>
        </section>
      </div>

      <section className="pl-panel" id="overview-mcp" data-testid="ops-mcp-access">
        <div className="pl-section-heading">
          <div>
            <h2 className="pl-panel-title mb-1"><span className="notranslate" translate="no">MCP</span> 接入</h2>
          </div>
        </div>

        <div className="pl-mcp-actions">
          <div className="pl-onboarding-facts pl-onboarding-facts--endpoint">
            <span className="notranslate" translate="no">Endpoint</span>
            <span aria-hidden="true">:</span>
            <code className="notranslate break-all" translate="no">{endpoint ?? "—"}</code>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="pl-btn pl-btn--secondary pl-btn--xs notranslate"
              translate="no"
              onClick={copyConfig}
              disabled={!canCopyMcp}
              data-testid="mcp-config-copy-button"
            >
              {copiedMain ? "已复制" : (<>复制 <span className="notranslate" translate="no">MCP</span> 配置</>)}
            </button>
            <button
              type="button"
              className="pl-btn pl-btn--secondary pl-btn--xs"
              onClick={() => setMcpDrawerOpen(true)}
              data-testid="mcp-config-view-button"
            >
              查看配置
            </button>
            <Link
              to={DEEP_LINKS.mcpPlayground}
              className="pl-btn pl-btn--secondary pl-btn--xs notranslate"
              translate="no"
              data-testid="overview-mcp-playground-link"
            >
              打开 MCP 调试台
            </Link>
          </div>
          {endpointInfo?.status === "invalid" || endpointInfo?.status === "fallback"
            ? fallbackNotice(endpointInfo)
            : null}
        </div>
      </section>

      <McpConfigDrawer
        open={mcpDrawerOpen}
        onClose={() => setMcpDrawerOpen(false)}
        endpointInfo={endpointInfo}
        mcpConfig={mcpConfig}
      />
    </div>
  );
}

// Re-export the severity label helper so other surfaces (e.g. the
// Monitor page) can pick it up if they decide to render Chinese labels.
export { severityLabelBySeverity };
