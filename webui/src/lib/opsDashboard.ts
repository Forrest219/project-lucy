// M36: Data Agent Ops Platform Global UX — pure view-model helpers.
//
// All functions in this file are intentionally framework-agnostic (no React,
// no TanStack Query, no fetch). The Onboarding page wires these helpers to
// live data; tests in `__tests__/ops-dashboard.test.ts` exercise the helpers
// in isolation.
//
// The view model owns the "系统概览" (System Overview) mental model: it
// converts raw counts (semantic coverage, pending files, ACL denies, etc.)
// into the action-required queue and service-health strip the user sees on
// `/overview`.

export type Severity = "critical" | "warning" | "ready" | "info";

export const severityOrder: Record<Severity, number> = {
  critical: 0,
  warning: 1,
  ready: 2,
  info: 3
};

/**
 * M39: User-facing severity label. Never render the raw `Severity` value to
 * end users; the system overview polish spec bans `Critical / Warning /
 * Ready / Info` as visible labels. Mapping is deterministic and lives here
 * so every UI surface stays in sync.
 */
export type SeverityLabel = "高风险" | "待处理" | "提醒" | "就绪";

export const severityLabelBySeverity: Record<Severity, SeverityLabel> = {
  critical: "高风险",
  warning: "待处理",
  info: "提醒",
  ready: "就绪"
};

export type ActionRequiredItem = {
  /** Stable identifier so UI can key React lists without re-rendering. */
  id: string;
  /** User-facing summary, e.g. "12 张表待补语义". */
  label: string;
  /** Internal sort key; never render directly. */
  severity: Severity;
  /** User-facing Chinese severity label. */
  severityLabel: SeverityLabel;
  /** Optional deep-link target. `null` means the item is informational. */
  href: string | null;
  /** Short test-id hook for stable Vitest assertions. */
  testId: string;
  /** M39: impact scope, e.g. "问答召回率". */
  impact: string;
  /** M39: owning team, e.g. "数据治理组". */
  owner: string;
  /** M39: deterministic evidence string, e.g. "语义覆盖 4/66". */
  evidence: string;
  /** M39: user-facing update time, e.g. "今天 10:12" or "更新时间未知". */
  updatedAtLabel: string;
};

export type ServiceHealthKey =
  | "lucyMcp"
  | "ktxRuntime"
  | "semanticLayer"
  | "agentAccess";

export type ServiceHealthItem = {
  key: ServiceHealthKey;
  label: string;
  status: "ready" | "warning" | "danger" | "info";
  detail: string;
};

export type SemanticCoverage = { done: number; total: number };

export type ActionRequiredInput = {
  semanticCoverage: SemanticCoverage;
  pendingCatalogItems: number;
  pendingPublishFiles: number;
  /**
   * Number of eval runs in the last 30 days. Pass `null` when we don't yet
   * know — e.g. the eval endpoint is still loading or has errored — so the
   * dashboard never fabricates a fake "近 30 天无评测数据" item.
   * `0` means "we confirmed zero runs"; `n>0` means "n runs exist".
   */
  evalRunsLast30d: number | null;
  aclDenied7d: number;
  /** Optional dashboard refresh time used to render "今天 HH:mm". */
  dashboardUpdatedAt?: Date;
};

const SEVERITY_BY_COUNT: Array<{ severity: Severity; test: (n: number) => boolean }> = [
  { severity: "critical", test: (n) => n > 0 },
  { severity: "warning", test: (n) => n > 0 },
  { severity: "info", test: () => true }
];

/**
 * Format a Chinese number count with no decimals.
 * Centralised so 0 / 1 / n rendering stays consistent.
 */
export function formatCount(count: number): string {
  if (!Number.isFinite(count) || count < 0) return "0";
  return Math.trunc(count).toLocaleString("zh-CN");
}

/**
 * Pending semantic overlay count. We treat the gap between `done` and `total`
 * as the actionable queue; tables already done are not blockers.
 */
export function pendingSemanticCount(coverage: SemanticCoverage): number {
  if (coverage.total <= 0) return 0;
  return Math.max(0, coverage.total - coverage.done);
}

/**
 * Decide the severity for a semantic-gap item.
 *
 * - `total <= 0`: no item.
 * - gap ratio ≥ 2/3 (`done < total/3`): critical ("高风险").
 * - otherwise: warning ("待处理").
 *
 * The 2/3 threshold matches spec 41 §6.2 "待发布变更、Catalog 待处理、语义
 * 覆盖不足" warning bucket; large gaps surface as `高风险` so users see the
 * governance posture immediately.
 */
function semanticGapSeverity(coverage: SemanticCoverage): Severity | null {
  if (coverage.total <= 0) return null;
  if (coverage.done >= coverage.total) return null;
  return coverage.done * 3 < coverage.total ? "critical" : "warning";
}

/**
 * Format the dashboard refresh time as "今天 HH:mm" when the timestamp
 * matches today in the runtime timezone, falling back to an explicit
 * `更新时间未知` sentinel when no timestamp is provided. We deliberately
 * avoid fabricating a precise wall-clock time the user cannot verify.
 */
export function formatUpdatedAtLabel(date: Date | undefined): string {
  if (!date) return "更新时间未知";
  const today = new Date();
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return sameDay ? `今天 ${hh}:${mm}` : "更新时间未知";
}

/**
 * Build the cross-module "待处理事项" (Action Required) queue shown at the
 * top of `/overview`. The order below is contractual: critical items come
 * first, then warning, then info. Items with count 0 are omitted.
 *
 * M39 additions: every emitted item carries Chinese severity label,
 * `impact`, `owner`, deterministic `evidence` string and an `updatedAtLabel`
 * derived from the optional `dashboardUpdatedAt` input.
 */
export function buildActionRequiredItems(input: ActionRequiredInput): ActionRequiredItem[] {
  // M39 polish (MINOR-1): guard against negative inputs. Production
  // callers always pass non-negative counts, but a buggy upstream
  // payload (e.g. an ETL miscount) used to surface as a phantom
  // "X 张表待补语义" item with a negative number. Clamp here so the
  // helper stays total: a downstream caller can trust the result.
  const safePendingCatalog = Math.max(0, input.pendingCatalogItems);
  const safePendingPublish = Math.max(0, input.pendingPublishFiles);
  // `evalRunsLast30d === null` means we have no data yet — never
  // collapse that to 0, or the helper would fabricate a misleading
  // "近 30 天无评测数据" item against a still-loading / failed query.
  const safeEvalRuns =
    input.evalRunsLast30d === null ? null : Math.max(0, input.evalRunsLast30d);
  const safeAclDenied = Math.max(0, input.aclDenied7d);
  const semanticGap = pendingSemanticCount(input.semanticCoverage);
  const semanticSeverity = semanticGapSeverity(input.semanticCoverage);
  const updatedAtLabel = formatUpdatedAtLabel(input.dashboardUpdatedAt);

  const items: Array<ActionRequiredItem | null> = [
    semanticSeverity
      ? {
          id: "semantic-gap",
          label: `${formatCount(semanticGap)} 张表待补语义`,
          severity: semanticSeverity,
          severityLabel: severityLabelBySeverity[semanticSeverity],
          href: "/?status=partial",
          testId: "ops-action-semantic-gap",
          impact: "问答召回率",
          owner: "数据治理组",
          evidence: `语义覆盖 ${formatCount(input.semanticCoverage.done)}/${formatCount(
            input.semanticCoverage.total
          )}`,
          updatedAtLabel
        }
      : null,
    safePendingCatalog > 0
      ? {
          id: "catalog-pending",
          label: `${formatCount(safePendingCatalog)} 个 Catalog 对象待处理`,
          severity: "warning",
          severityLabel: severityLabelBySeverity.warning,
          href: "/connections",
          testId: "ops-action-catalog-pending",
          impact: "资产同步",
          owner: "架构组",
          evidence: `Catalog 待处理 ${formatCount(safePendingCatalog)} 项`,
          updatedAtLabel
        }
      : null,
    safePendingPublish > 0
      ? {
          id: "publish-pending",
          label: `存在 ${formatCount(safePendingPublish)} 个待发布文件`,
          severity: "warning",
          severityLabel: severityLabelBySeverity.warning,
          href: "/publish/workbench",
          testId: "ops-action-publish-pending",
          impact: "发布一致性",
          owner: "语义发布负责人",
          evidence: `diff files: ${formatCount(safePendingPublish)}`,
          updatedAtLabel
        }
      : null,
    // Only `safeEvalRuns === 0` (confirmed zero runs) surfaces the
    // eval-gap item; both `safeEvalRuns === null` (still loading /
    // errored) and `safeEvalRuns > 0` collapse to `null`.
    safeEvalRuns === 0
      ? {
          id: "eval-gap",
          label: "近 30 天无评测数据",
          severity: "info",
          severityLabel: severityLabelBySeverity.info,
          href: "/eval/monitor",
          testId: "ops-action-eval-gap",
          impact: "质量基线",
          owner: "QA 团队",
          evidence: "近 30 天无评测数据",
          updatedAtLabel
        }
      : null,
    safeAclDenied > 0
      ? {
          id: "acl-deny",
          label: "近 7 天存在 ACL 拒绝",
          severity: "critical",
          severityLabel: severityLabelBySeverity.critical,
          href: "/admin/audit?outcome=denied",
          testId: "ops-action-acl-deny",
          impact: "访问安全",
          owner: "访问治理组",
          evidence: `ACL 拒绝: ${formatCount(safeAclDenied)}`,
          updatedAtLabel
        }
      : null
  ];
  return items
    .filter((item): item is ActionRequiredItem => item !== null)
    .sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
}

export type ServiceHealthInput = {
  ktxAvailable: boolean;
  mcpReady: boolean;
  semanticCoverage: SemanticCoverage;
  agentsEnabled: number;
  agentsTotal: number;
  enabledTokenCount: number;
};

/**
 * Build the 4-up "服务健康" (Service Health) strip. Returns ready / warning /
 * danger / info tones the page header can render with existing CSS tokens.
 */
export function buildServiceHealth(input: ServiceHealthInput): ServiceHealthItem[] {
  const semanticGap = pendingSemanticCount(input.semanticCoverage);
  const semanticStatus: ServiceHealthItem["status"] =
    input.semanticCoverage.total === 0
      ? "info"
      : semanticGap === 0
        ? "ready"
        : "warning";
  const semanticDetail =
    input.semanticCoverage.total === 0
      ? "尚未维护任何表"
      : `${input.semanticCoverage.done} / ${input.semanticCoverage.total} 张已完成`;

  const accessStatus: ServiceHealthItem["status"] =
    input.agentsTotal === 0
      ? "danger"
      : input.agentsEnabled === 0
        ? "warning"
        : input.enabledTokenCount === 0
          ? "warning"
          : "ready";
  const accessDetail =
    input.agentsTotal === 0
      ? "0 个 Agent"
      : `${input.agentsEnabled} 启用 / ${input.agentsTotal} 总数 · ${input.enabledTokenCount} 可用 token`;

  return [
    {
      key: "lucyMcp",
      label: "Lucy MCP",
      status: input.mcpReady ? "ready" : "warning",
      detail: input.mcpReady ? "Endpoint 可用" : "Endpoint 未就绪"
    },
    {
      key: "ktxRuntime",
      label: "KTX Runtime",
      status: input.ktxAvailable ? "ready" : "danger",
      detail: input.ktxAvailable ? "可用" : "不可用"
    },
    {
      key: "semanticLayer",
      label: "语义层覆盖",
      status: semanticStatus,
      detail: semanticDetail
    },
    {
      key: "agentAccess",
      label: "Agent 接入",
      status: accessStatus,
      detail: accessDetail
    }
  ];
}

/**
 * The empty-state message rendered when the action-required queue is empty.
 * Kept here so the Onboarding test can assert against the exact wording.
 */
export const NO_ACTION_REQUIRED_MESSAGE = "暂无高优先级待处理事项";

/**
 * The three primary CTAs the user can take when the eval monitor is empty.
 * The Monitor page references these in its empty state.
 */
export const EVAL_MONITOR_EMPTY_ACTIONS = [
  "触发首次运行",
  "导入评测用例",
  "配置阈值"
] as const;
