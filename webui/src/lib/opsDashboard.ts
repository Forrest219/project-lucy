// M36: Data Agent Ops Platform Global UX — pure view-model helpers.
//
// All functions in this file are intentionally framework-agnostic (no React,
// no TanStack Query, no fetch). The Onboarding page wires these helpers to
// live data; tests in `__tests__/ops-dashboard.test.ts` exercise the helpers
// in isolation.
//
// The view model owns the "系统概览" (System Overview) mental model: it
// converts raw counts (semantic coverage, pending files, ACL denies, etc.)
// into the action-required queue and service-health summary the user sees on
// `/overview`.

import type { Agent, TokenSummary } from "./types";

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
  title: string;
  /** Fact-based status text derived from available dashboard counts. */
  description: string;
  /** Internal sort key; never render directly. */
  severity: Exclude<Severity, "ready">;
  /** User-facing action label. */
  actionText: string;
  /** Deep-link target for handling the item. */
  actionUrl: string;
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
function semanticGapSeverity(coverage: SemanticCoverage): Exclude<Severity, "ready"> | null {
  if (coverage.total <= 0) return null;
  if (coverage.done >= coverage.total) return null;
  return coverage.done * 3 < coverage.total ? "critical" : "warning";
}

/**
 * Build the cross-module "待处理事项" (Action Required) queue shown at the
 * top of `/overview`. The order below is contractual: critical items come
 * first, then warning, then info. Items with count 0 are omitted.
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

  const items: Array<ActionRequiredItem | null> = [
    semanticSeverity
      ? {
          id: "semantic-gap",
          title: `${formatCount(semanticGap)} 张表待补语义`,
          description: `当前语义覆盖 ${formatCount(input.semanticCoverage.done)}/${formatCount(
            input.semanticCoverage.total
          )}，仍有 ${formatCount(semanticGap)} 张表缺少可用语义`,
          severity: semanticSeverity,
          actionText: "前往补全",
          actionUrl: "/?status=partial"
        }
      : null,
    safePendingCatalog > 0
      ? {
          id: "catalog-pending",
          title: `${formatCount(safePendingCatalog)} 个 Catalog 对象待处理`,
          description: `Catalog 同步发现 ${formatCount(safePendingCatalog)} 个对象同步不完整（部分字段或元数据缺失）`,
          severity: "warning",
          actionText: "查看连接",
          actionUrl: "/connections"
        }
      : null,
    safePendingPublish > 0
      ? {
          id: "publish-pending",
          title: `存在 ${formatCount(safePendingPublish)} 个待发布文件`,
          description: `当前有 ${formatCount(safePendingPublish)} 个语义变更尚未发布`,
          severity: "warning",
          actionText: "打开发布工作台",
          actionUrl: "/publish/workbench"
        }
      : null,
    // Only `safeEvalRuns === 0` (confirmed zero runs) surfaces the
    // eval-gap item; both `safeEvalRuns === null` (still loading /
    // errored) and `safeEvalRuns > 0` collapse to `null`.
    safeEvalRuns === 0
      ? {
          id: "eval-gap",
          title: "近 30 天无评测数据",
          description: "尚未检测到近 30 天评测运行记录",
          severity: "info",
          actionText: "查看趋势监控",
          actionUrl: "/eval/monitor"
        }
      : null,
    safeAclDenied > 0
      ? {
          id: "acl-deny",
          title: "近 7 天存在 ACL 拒绝",
          description: `访问日志记录到 ${formatCount(safeAclDenied)} 次 ACL 拒绝`,
          severity: "critical",
          actionText: "查看访问日志",
          actionUrl: "/admin/audit?outcome=denied"
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
  availableTokenCount: number;
};

/**
 * M41: A token is considered "可用" (available) when:
 *  - the parent agent is `enabled === true`
 *  - `token.revoked !== true`
 *  - `token.expires_at` is null/empty (永不过期), OR
 *    `expires_at` parses to a valid ISO timestamp strictly in the future
 *
 * Invalid `expires_at` strings (e.g. "not-a-date") are conservatively treated
 * as NOT available — the helper never fabricates availability from
 * unparseable data.
 */
export function isTokenAvailable(token: TokenSummary, now: Date = new Date()): boolean {
  if (token.revoked) return false;
  if (!token.expires_at) return true;
  const expiresAt = new Date(token.expires_at);
  if (Number.isNaN(expiresAt.getTime())) return false;
  return expiresAt.getTime() > now.getTime();
}

/**
 * M41: count tokens that are usable right now across all enabled agents.
 * Replaces the M39 `enabledTokenCount` which only filtered on `!revoked` and
 * therefore mis-counted expired tokens.
 */
export function availableTokenCount(agents: Agent[], now: Date = new Date()): number {
  return agents
    .filter((agent) => agent.enabled)
    .reduce((sum, agent) => sum + agent.tokens.filter((t) => isTokenAvailable(t, now)).length, 0);
}

/**
 * M41: structured view model for the single-line "系统状态" summary.
 *
 * Returns `null` when mcp / ktx is not ready — the page falls back to the
 * high-weight alert and does NOT render this summary in that case. Tone is
 * `warning` whenever there's a semantic gap or agent gap, otherwise `ready`.
 *
 * The React layer is responsible for assembling the final JSX so it can
 * wrap `Lucy MCP` / `KTX Runtime` / `Agent` in `notranslate` spans — the
 * helper intentionally returns structured data, not a plain string.
 */
export type ServiceHealthSummary = {
  tone: "ready" | "warning";
  semantic: { done: number; total: number; gap: number };
  agents: { enabled: number; total: number; gap: number };
};

export function summarizeServiceHealth(
  mcpReady: boolean,
  ktxAvailable: boolean,
  semantic: { done: number; total: number },
  agents: { enabled: number; total: number }
): ServiceHealthSummary | null {
  if (!mcpReady || !ktxAvailable) return null;
  const semanticGap = Math.max(0, semantic.total - semantic.done);
  const agentGap = Math.max(0, agents.total - agents.enabled);
  const tone: ServiceHealthSummary["tone"] =
    semanticGap > 0 || agentGap > 0 ? "warning" : "ready";
  return {
    tone,
    semantic: { done: semantic.done, total: semantic.total, gap: semanticGap },
    agents: { enabled: agents.enabled, total: agents.total, gap: agentGap }
  };
}

/**
 * M41: produce a specific alert headline for the danger state. Splits the
 * "which component failed" decision out of the React layer so the test can
 * cover the four branches deterministically.
 */
export function systemAlertText(mcpReady: boolean, ktxAvailable: boolean): string {
  if (mcpReady && ktxAvailable) return "系统状态正常。";
  if (!mcpReady && !ktxAvailable) {
    return "系统异常：Lucy MCP 与 KTX Runtime 不可用，请检查接入。";
  }
  if (!mcpReady) return "系统异常：Lucy MCP 未就绪，请检查 Endpoint 配置。";
  return "系统异常：KTX Runtime 不可用，请检查运行时配置。";
}

/**
 * M36/M41: Build the legacy 4-up "服务健康" (Service Health) strip. M41
 * removes this strip from `/overview` in favour of the one-line summary;
 * the helper is retained because other surfaces (e.g. tests, future
 * dashboard pages) may still want the per-component breakdown.
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
        : input.availableTokenCount === 0
          ? "warning"
          : "ready";
  const accessDetail =
    input.agentsTotal === 0
      ? "0 个 Agent"
      : `${input.agentsEnabled} 启用 / ${input.agentsTotal} 总数 · ${input.availableTokenCount} 可用 token`;

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
