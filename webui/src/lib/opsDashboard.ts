// M36: Data Agent Ops Platform Global UX — pure view-model helpers.
//
// All functions in this file are intentionally framework-agnostic (no React,
// no TanStack Query, no fetch). The Onboarding page wires these helpers to
// live data; tests in `__tests__/ops-dashboard.test.ts` exercise the helpers
// in isolation.
//
// The view model owns the "运维驾驶舱" (Ops Dashboard) mental model: it
// converts raw counts (semantic coverage, pending files, ACL denies, etc.)
// into the action-required queue and service-health strip the user sees on
// `/onboarding`.

export type Severity = "critical" | "warning" | "ready" | "info";

export const severityOrder: Record<Severity, number> = {
  critical: 0,
  warning: 1,
  ready: 2,
  info: 3
};

export type ActionRequiredItem = {
  /** Stable identifier so UI can key React lists without re-rendering. */
  id: string;
  /** User-facing summary, e.g. "12 张表待补语义". */
  label: string;
  /** Severity drives the colour and sort order. */
  severity: Severity;
  /** Optional deep-link target. `null` means the item is informational. */
  href: string | null;
  /** Short test-id hook for stable Vitest assertions. */
  testId: string;
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
  evalRunsLast30d: number;
  aclDenied7d: number;
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
 * Build the cross-module "待处理事项" (Action Required) queue shown at the
 * top of `/onboarding`. The order below is contractual: critical items come
 * first, then warning, then info. Items with count 0 are omitted.
 */
export function buildActionRequiredItems(input: ActionRequiredInput): ActionRequiredItem[] {
  const items: Array<ActionRequiredItem | null> = [
    pendingSemanticCount(input.semanticCoverage) > 0
      ? {
          id: "semantic-gap",
          label: `${formatCount(pendingSemanticCount(input.semanticCoverage))} 张表待补语义`,
          severity: "warning",
          href: "/?status=partial",
          testId: "ops-action-semantic-gap"
        }
      : null,
    input.pendingCatalogItems > 0
      ? {
          id: "catalog-pending",
          label: `${formatCount(input.pendingCatalogItems)} 个 Catalog 对象待处理`,
          severity: "warning",
          href: "/connections",
          testId: "ops-action-catalog-pending"
        }
      : null,
    input.pendingPublishFiles > 0
      ? {
          id: "publish-pending",
          label: `存在 ${formatCount(input.pendingPublishFiles)} 个待发布文件`,
          severity: "warning",
          href: "/publish/workbench",
          testId: "ops-action-publish-pending"
        }
      : null,
    input.evalRunsLast30d === 0
      ? {
          id: "eval-gap",
          label: "近 30 天无评测数据",
          severity: "warning",
          href: "/eval/monitor",
          testId: "ops-action-eval-gap"
        }
      : null,
    input.aclDenied7d > 0
      ? {
          id: "acl-deny",
          label: "近 7 天存在 ACL deny",
          severity: "critical",
          href: "/admin/audit?outcome=denied",
          testId: "ops-action-acl-deny"
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
  "触发首次 Run",
  "导入评测用例",
  "配置阈值"
] as const;
