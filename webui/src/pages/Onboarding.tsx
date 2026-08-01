import { useEffect, useMemo, useRef, useState } from "react";
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
  pendingSemanticCount,
  type ActionRequiredItem,
  type Severity,
  type SeverityLabel,
  type ServiceHealthItem,
  severityLabelBySeverity
} from "../lib/opsDashboard";

const AUTO_REFRESH_INTERVAL_MS = 60_000;

/**
 * M39: derive an environment label from the runtime MCP endpoint host.
 *
 * - `localhost` / `127.0.0.1` -> "Local"
 * - non-loopback configured host -> "Configured"
 * - invalid / null endpoint -> "未配置"
 *
 * We intentionally do NOT hard-code "Dev" because the spec 41 §5 forbids it.
 */
function deriveEnvironmentLabel(endpointInfo: McpEndpointInfo | undefined): string {
  if (!endpointInfo) return "环境: 未配置";
  if (endpointInfo.status === "invalid" || !endpointInfo.url) return "环境: 未配置";
  try {
    const host = new URL(endpointInfo.url).hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
      return "环境: Local";
    }
    return "环境: Configured";
  } catch {
    return "环境: 未配置";
  }
}

function formatTimestamp(date: Date): string {
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

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
  severity,
  severityLabel
}: {
  severity: Severity;
  severityLabel: SeverityLabel;
}) {
  return (
    <span
      className={`pl-status-badge ${severityBadgeClass(severity)}`}
      data-severity={severity}
    >
      {severityLabel}
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
        当前使用本地默认 <span className="notranslate" translate="no">MCP</span> <span className="notranslate" translate="no">Endpoint</span>。客户部署请配置 <code className="notranslate" translate="no">LUCY_PUBLIC_MCP_URL</code>，避免 <span className="notranslate" translate="no">Agent</span> 复制到只能在本机访问的地址。
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
 * Compact Service Health strip. Per M39 spec 41 §6.1, ready state must NOT
 * use a large coloured banner. We render a single neutral row with four
 * mini-items and a `[控制台日志]` affordance.
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
          to="/help"
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
  mcpConfig,
  onCopy,
  copied
}: {
  open: boolean;
  onClose: () => void;
  endpointInfo: McpEndpointInfo | undefined;
  mcpConfig: string;
  onCopy: () => void;
  // M39 polish (SEVERE-4): the Drawer uses its own copy flag so toggling
  // the main page copy state never desyncs the Drawer button label. The
  // `copied` prop is therefore ignored; we manage the local flag below.
  copied: boolean;
}) {
  // M39 polish (SEVERE-4): internal copy-feedback flag for the Drawer
  // button. The parent state (`copiedMain`) drives the main page button,
  // so the Drawer keeps its own state to avoid cross-talk.
  const [drawerCopied, setDrawerCopied] = useState(false);
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
  const hasDiagnostics = endpointInfo?.diagnostics && endpointInfo.diagnostics.length > 0;

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
            className="pl-drawer-close notranslate"
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
            {hasDiagnostics ? (
              <div className="grid gap-1">
                <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
                  诊断信息
                </span>
                <ul className="grid gap-1 text-sm text-fg-body">
                  {endpointInfo?.diagnostics.map((d) => (
                    <li
                      key={d.code}
                      className="notranslate"
                      translate="no"
                    >
                      {d.message}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
                JSON
              </span>
              <button
                type="button"
                className="pl-btn pl-btn--secondary pl-btn--sm notranslate"
                translate="no"
                onClick={async () => {
                  await onCopy();
                  setDrawerCopied(true);
                  window.setTimeout(() => setDrawerCopied(false), 1500);
                }}
                data-testid="mcp-config-drawer-copy"
              >
                {drawerCopied ? "已复制" : (<>复制 <span className="notranslate" translate="no">MCP</span> 配置</>)}
              </button>
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
          <span className="text-xs text-fg-muted">
            配置示例使用 <code className="notranslate" translate="no">LUCY_PUBLIC_MCP_URL</code>
          </span>
          <Link
            to="/admin/agents"
            className="pl-btn pl-btn--ghost text-sm notranslate"
            translate="no"
            data-testid="mcp-config-drawer-agent-link"
          >
            查看 <span className="notranslate" translate="no">Agent</span> 实例 ↗
          </Link>
        </footer>
      </div>
    </div>
  );
}

/**
 * Action Required row. M39 spec 41 §7 requires every queue item to expose
 * severity (中文), impact, owner, update time and evidence, plus a uniform
 * `前往处理 ↗` link. We pack the metadata into a compact grid so a single
 * queue item never exceeds three visual rows.
 */
function ActionRequiredRow({ item }: { item: ActionRequiredItem }) {
  return (
    <div
      className="pl-action-required-item"
      data-severity={item.severity}
      data-testid={item.testId}
    >
      <div className="pl-action-required-item-row">
        <div className="pl-action-required-item-title">
          <SeverityBadge severity={item.severity} severityLabel={item.severityLabel} />
          <span className="text-sm text-fg-default">{item.label}</span>
        </div>
        {item.href ? (
          <Link
            className="pl-btn pl-btn--ghost text-sm notranslate"
            translate="no"
            to={item.href}
            data-testid={`${item.testId}-link`}
          >
            前往处理 ↗
          </Link>
        ) : null}
      </div>
      <dl className="pl-action-required-item-meta">
        <div>
          <dt>影响</dt>
          <dd className="notranslate" translate="no">{item.impact}</dd>
        </div>
        <div>
          <dt>负责人</dt>
          <dd className="notranslate" translate="no">{item.owner}</dd>
        </div>
        <div>
          <dt>更新时间</dt>
          <dd>{item.updatedAtLabel}</dd>
        </div>
        <div>
          <dt>证据</dt>
          <dd className="notranslate" translate="no">{item.evidence}</dd>
        </div>
      </dl>
    </div>
  );
}

/**
 * Metric-first semantic-coverage card. M39 spec 41 §8 requires a standalone
 * percent + progressbar with `role="progressbar"` and aria-valuenow /
 * aria-valuemin / aria-valuemax, plus a text label so screen-reader users
 * do not rely on colour or bar length alone.
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
    <div className="pl-metric-card">
      <span className="pl-snapshot-card-label">语义覆盖率</span>
      <strong
        className="pl-metric-card-value pl-metric-card-value--xl"
        data-testid="ops-semantic-percent"
      >
        {percentValue}%
      </strong>
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
      <small className="text-fg-muted">
        <span className="notranslate" translate="no">{done}</span>/<span className="notranslate" translate="no">{total}</span> 语义完成，<span className="notranslate" translate="no">{gap}</span> 张表待补
      </small>
    </div>
  );
}

export function Onboarding() {
  // M39 polish (SEVERE-4): split the copy-affordance feedback state so the
  // main button and the Drawer copy button don't desync each other. We
  // also auto-reset both flags after 1.5s so the user sees a brief
  // "已复制" flash before the label reverts.
  const [copiedMain, setCopiedMain] = useState(false);
  const [copiedDrawer, setCopiedDrawer] = useState(false);
  // M39: track the last time the dashboard successfully finished a fetch
  // cycle. The header renders this as `上次更新: HH:mm:ss`.
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  // M39: auto-refresh switch (default off). When toggled on we refetch the
  // four core queries every 60s, but pause the timer whenever
  // `document.hidden` is true so background tabs don't pile up work.
  const [autoRefresh, setAutoRefresh] = useState(false);
  // M39: Drawer open state. The main page never shows the raw JSON
  // config; the user must explicitly open the Drawer to inspect it.
  const [mcpDrawerOpen, setMcpDrawerOpen] = useState(false);
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

  // M39: record the wall-clock time when all four core queries settle with
  // data. We only consider a query "settled" once it has produced data at
  // least once — a permanent error does not advance the timestamp.
  const coreSettled =
    projectQuery.isSuccess &&
    sourcesQuery.isSuccess &&
    diffQuery.isSuccess &&
    agentsQuery.isSuccess;
  const previousSettledRef = useRef(coreSettled);
  useEffect(() => {
    if (!previousSettledRef.current && coreSettled) {
      setLastUpdatedAt(new Date());
    }
    previousSettledRef.current = coreSettled;
  }, [coreSettled]);

  // M39: auto-refresh interval. Re-fetches the four core queries every
  // 60s when enabled, and pauses while the tab is hidden. The cleanup
  // function clears the timer so we don't leak handles.
  //
  // M39 polish (MAJOR-4): use Promise.allSettled so a single failing
  // endpoint doesn't mask the others, and aggregate failures into a
  // single low-noise toast instead of failing silently every 60s. The
  // threshold (`AUTO_REFRESH_FAILURE_TOAST_THRESHOLD`) keeps the toast
  // from firing on transient single-endpoint hiccups.
  const AUTO_REFRESH_FAILURE_TOAST_THRESHOLD = 2;
  useEffect(() => {
    if (!autoRefresh) return;
    if (typeof document === "undefined") return;
    let cancelled = false;
    function schedule() {
      if (cancelled || document.hidden) return;
      void Promise.allSettled([
        projectQuery.refetch(),
        sourcesQuery.refetch(),
        diffQuery.refetch(),
        agentsQuery.refetch()
      ]).then((settled) => {
        if (cancelled) return;
        const failedCount = settled.filter(
          (result) => result.status === "rejected" || (result.status === "fulfilled" && (result.value as { error?: unknown })?.error)
        ).length;
        if (failedCount >= AUTO_REFRESH_FAILURE_TOAST_THRESHOLD) {
          toast.error("部分状态刷新失败，可在控制台查看详情");
        }
      });
    }
    const timer = window.setInterval(schedule, AUTO_REFRESH_INTERVAL_MS);
    function onVisibility() {
      // When the tab reappears we immediately refetch so the user sees
      // fresh data without waiting for the next interval tick.
      if (!document.hidden && autoRefresh) schedule();
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // We intentionally exclude the query handles from deps — TanStack
    // Query returns stable refetch functions per query instance and we
    // want the timer to be set up exactly once per toggle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh]);

  const connections = projectQuery.data?.connections ?? [];
  const enabledTables = connections.reduce((sum, conn) => sum + conn.enabledTables.length, 0);
  const sources = sourcesQuery.data?.tables ?? [];
  const doneSources = sources.filter((source) => source.completion === "done").length;
  const changedFiles = diffQuery.data?.files ?? [];
  const agents = agentsQuery.data?.agents ?? [];
  const enabledAgents = agents.filter((agent) => agent.enabled);
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
        ? "就绪"
        : "需要完善";

  // M36: Ops Dashboard view-model inputs.
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
        evalRunsLast30d: evalLastRunQuery.isLoading || evalLastRunQuery.error
          ? 0
          : (evalLastRunQuery.data?.runs.length ?? 0),
        aclDenied7d,
        dashboardUpdatedAt: lastUpdatedAt ?? undefined
      }),
    [
      doneSources,
      sources.length,
      pendingCatalogItems,
      changedFiles.length,
      evalLastRunQuery.isLoading,
      evalLastRunQuery.error,
      evalLastRunQuery.data,
      aclDenied7d,
      lastUpdatedAt
    ]
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
  const semanticPercent = percent(doneSources, sources.length);

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

  async function copyConfigFromDrawer() {
    const ok = await writeMcpConfigToClipboard();
    if (!ok) return;
    // The Drawer's own flag is set inside McpConfigDrawer; the main
    // page's flag stays untouched.
    toast.success(
      <>
        <span className="notranslate" translate="no">MCP</span> 配置已复制
      </>
    );
  }

  async function refreshStatus() {
    // M39: toast on success / failure so the user always sees feedback
    // when they tap the manual refresh button. We deliberately resolve
    // all four queries so a single failing endpoint doesn't get masked.
    const settled = await Promise.allSettled([
      projectQuery.refetch(),
      sourcesQuery.refetch(),
      diffQuery.refetch(),
      agentsQuery.refetch()
    ]);
    const failed = settled.find((result) => result.status === "rejected");
    if (failed) {
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
      toast.error("系统概览刷新失败");
      return;
    }
    setLastUpdatedAt(new Date());
    toast.success("系统概览已刷新");
  }

  const environmentLabel = deriveEnvironmentLabel(endpointInfo);
  const lastUpdatedLabel = lastUpdatedAt
    ? `上次更新: ${formatTimestamp(lastUpdatedAt)}`
    : "上次更新: --";
  const coreFetching =
    projectQuery.isFetching ||
    sourcesQuery.isFetching ||
    diffQuery.isFetching ||
    agentsQuery.isFetching;
  const refreshButtonLabel = coreFetching ? "刷新中..." : "刷新状态";

  if (loading) {
    return <p className="pl-notice">正在加载系统概览...</p>;
  }

  if (error) {
    return <p className="pl-error">系统概览加载失败：{error instanceof Error ? error.message : "未知错误"}</p>;
  }

  // M39: a critical-tone service-health panel must remain a high-emphasis
  // Alert; ready/warning use the compact strip.
  const overall = overallTone(serviceHealth);

  return (
    <div className="pl-page-stack">
      <PageHeader
        title="系统概览"
        breadcrumbs={["系统概览"]}
        description={
          <>
            查看 Lucy <span className="notranslate" translate="no">MCP</span>、<span className="notranslate" translate="no">KTX</span> <span className="notranslate" translate="no">Runtime</span>、语义资产与 <span className="notranslate" translate="no">Agent</span> 接入的当前健康状态。聚合首页待办，判断 data agent 是否处于可交付状态。
          </>
        }
        badges={
          <>
            <span data-testid="onboarding-env-badge">{environmentLabel}</span>
            <span data-testid="onboarding-last-updated">{lastUpdatedLabel}</span>
            <span>
              <span className="notranslate" translate="no">KTX</span> <span className="notranslate" translate="no">{projectQuery.data?.ktxAvailable ? "可用" : "不可用"}</span>
            </span>
            <span>
              <span className="notranslate" translate="no">{doneSources}/{sources.length}</span> 语义完成
            </span>
            <span className="notranslate" translate="no">
              <span className="notranslate" translate="no">{enabledTokenCount}</span> 活跃 Token
            </span>
          </>
        }
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <label
              className="flex items-center gap-2 text-sm text-fg-body"
              data-testid="onboarding-auto-refresh-wrapper"
            >
              <input
                type="checkbox"
                className="pl-checkbox"
                data-testid="onboarding-auto-refresh-toggle"
                checked={autoRefresh}
                onChange={(event) => setAutoRefresh(event.target.checked)}
              />
              <span>自动刷新</span>
            </label>
            <button
              type="button"
              className="pl-btn pl-btn--secondary"
              onClick={refreshStatus}
              disabled={coreFetching}
              data-testid="onboarding-refresh-button"
            >
              {refreshButtonLabel}
            </button>
          </div>
        }
      />

      {overall === "danger" ? (
        <section className="pl-panel pl-service-health-critical" role="alert" data-testid="ops-service-health-critical">
          <div className="flex items-center gap-3">
            <span className="pl-service-health-critical-dot" aria-hidden="true" />
            <div>
              <strong>系统异常</strong>
              <p className="pl-notice">关键组件未就绪，请查看待处理事项。</p>
            </div>
          </div>
        </section>
      ) : null}

      <ServiceHealthStrip items={serviceHealth} />

      <section className="pl-panel" data-testid="ops-action-required">
        <div className="pl-section-heading">
          <div>
            <h2 className="pl-panel-title mb-1">待处理事项</h2>
            <p className="pl-notice">聚合语义缺口、待发布变更、评测缺口、ACL 风险。点击任一项可直接进入处理页面。</p>
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
              <p className="pl-notice">语义资产覆盖度与变更审阅状态，决定发布前的最后一道关。</p>
            </div>
          </div>
          <div className="pl-snapshot-grid">
            <SemanticCoverageCard done={doneSources} total={sources.length} />
            <div className="pl-metric-card">
              <span className="pl-snapshot-card-label">待发布变更</span>
              <strong className="pl-metric-card-value notranslate" translate="no">
                {changedFiles.length}
              </strong>
              <small className="text-fg-muted">
                {validationReady ? "当前无未审阅变更" : "需要进入发布工作台审阅"}
              </small>
              <Link
                to="/publish/workbench"
                className="pl-btn pl-btn--ghost text-sm"
              >
                打开发布工作台 ↗
              </Link>
            </div>
            <div className="pl-metric-card">
              <span className="pl-snapshot-card-label"><span className="notranslate" translate="no">Agent</span> 启用</span>
              <strong className="pl-metric-card-value notranslate" translate="no">
                {enabledAgents.length}/{agents.length}
              </strong>
              <small className="text-fg-muted">
                <span className="notranslate" translate="no">{enabledAgents.length}</span> 个 <span className="notranslate" translate="no">Agent</span> 已启用
              </small>
              <Link to="/admin/agents" className="pl-btn pl-btn--ghost text-sm notranslate" translate="no">
                查看 <span className="notranslate" translate="no">Agent</span> 实例 ↗
              </Link>
            </div>
            <div className="pl-metric-card">
              <span className="pl-snapshot-card-label">ACL 拒绝</span>
              <strong className="pl-metric-card-value notranslate" translate="no">
                {aclDenied7d}
              </strong>
              <small className="text-fg-muted">
                {aclDenied7d === 0 ? "近 7 天无拒绝" : "近 7 天存在 ACL 拒绝"}
              </small>
              <Link
                to="/admin/audit?outcome=denied"
                className="pl-btn pl-btn--ghost text-sm"
              >
                查看访问日志 ↗
              </Link>
            </div>
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
            <div
              className="pl-risk-item"
              data-tone={enabledAgents.length === 0 ? "danger" : "default"}
            >
              <div>
                <strong><span className="notranslate" translate="no">Agent</span> 启用与禁用</strong>
                <div className="text-xs text-fg-muted">
                  <span className="notranslate" translate="no">{enabledAgents.length}</span> 启用 / <span className="notranslate" translate="no">{agents.length}</span> 总数
                </div>
              </div>
              <Link to="/admin/agents" className="pl-btn pl-btn--ghost text-sm notranslate" translate="no">
                查看 <span className="notranslate" translate="no">Agent</span> 管理 ↗
              </Link>
            </div>
            <div
              className="pl-risk-item"
              data-tone={aclDenied7d > 0 ? "danger" : "default"}
            >
              <div>
                <strong>近 7 天 ACL 拒绝</strong>
                <div className="text-xs text-fg-muted">
                  <span className="notranslate" translate="no">{aclDenied7d}</span> 次拒绝
                </div>
              </div>
              <Link
                to="/admin/audit?outcome=denied"
                className="pl-btn pl-btn--ghost text-sm"
              >
                查看访问日志 ↗
              </Link>
            </div>
            <div
              className="pl-risk-item"
              data-tone={enabledTokenCount === 0 && agents.length > 0 ? "warning" : "default"}
            >
              <div>
                <strong>可用 <span className="notranslate" translate="no">Token</span></strong>
                <div className="text-xs text-fg-muted">
                  <span className="notranslate" translate="no">{enabledTokenCount}</span> 个活跃 <span className="notranslate" translate="no">Token</span>
                </div>
              </div>
              <Link to="/admin/agents" className="pl-btn pl-btn--ghost text-sm notranslate" translate="no">
                管理 <span className="notranslate" translate="no">Token</span> ↗
              </Link>
            </div>
          </div>
        </section>
      </div>

      <section className="pl-panel">
        <div className="pl-section-heading">
          <div>
            <h2 className="pl-panel-title mb-1"><span className="notranslate" translate="no">MCP</span> 接入</h2>
            <p className="pl-notice">
              <span className="notranslate" translate="no">Agent</span> 通过 <code className="notranslate" translate="no">LUCY_PUBLIC_MCP_URL</code> 与 Lucy 通讯。请将下面 JSON 写入 <code className="notranslate" translate="no">.mcp.json</code>。
            </p>
          </div>
        </div>

        <div className="pl-mcp-actions">
          <div className="pl-onboarding-facts">
            <span>
              <span className="notranslate" translate="no">Agent</span>: <span className="notranslate" translate="no">{agents.length}</span> 个
            </span>
            <span>
              <span className="notranslate" translate="no">Token</span>: <span className="notranslate" translate="no">{enabledTokenCount}</span> 可用
            </span>
            <span>
              <span className="notranslate" translate="no">Endpoint</span>: <code className="notranslate break-all" translate="no">{endpoint ?? "—"}</code>
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="pl-btn pl-btn--primary notranslate"
              translate="no"
              onClick={copyConfig}
              disabled={!canCopyMcp}
              data-testid="mcp-config-copy-button"
            >
              {copiedMain ? "已复制" : (<>复制 <span className="notranslate" translate="no">MCP</span> 配置</>)}
            </button>
            <button
              type="button"
              className="pl-btn pl-btn--secondary"
              onClick={() => setMcpDrawerOpen(true)}
              data-testid="mcp-config-view-button"
            >
              查看配置
            </button>
          </div>
          {fallbackNotice(endpointInfo)}
          {!mcpReady && mcpNotReadyReason ? (
            <div className="pl-notice">{mcpNotReadyReason}</div>
          ) : null}
        </div>
      </section>

      <McpConfigDrawer
        open={mcpDrawerOpen}
        onClose={() => setMcpDrawerOpen(false)}
        endpointInfo={endpointInfo}
        mcpConfig={mcpConfig}
        onCopy={copyConfigFromDrawer}
        copied={copiedMain}
      />
    </div>
  );
}

// Re-export the severity label helper so other surfaces (e.g. the
// Monitor page) can pick it up if they decide to render Chinese labels.
export { severityLabelBySeverity };