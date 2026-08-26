/**
 * Spec 128 — Enterprise KPI Contract
 *
 * Locked decisions encoded here:
 * D1: Config-class KPIs read from authoritative API; no frontend re-aggregation.
 * D2: passRate denominator = PASS / (PASS+FAIL+SKIP). Trend uses same formula.
 * D3: partial state → main value MUST render as "—", never a numeric estimate.
 * D4: Token prefix ambiguity → state=partial, value=null; never claim exact global distinct.
 */

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

/** Spec 128 §3.1 */
export type MetricState =
  | "ok"           // value is valid and complete
  | "no_data"      // window had no records; value may be 0 (not an error)
  | "unavailable"  // data source failed; value must be null
  | "partial";     // data is ambiguous or incomplete; value must be null (D3, D4)

/** Spec 128 §3.2 */
export interface MetricResult {
  metricId: string;
  state: MetricState;
  value: number | null;
  /** ISO 8601 — moment the query ran */
  asOf: string;
  /** ISO 8601 — inclusive window start */
  windowStart?: string;
  /** ISO 8601 — exclusive window end */
  windowEnd?: string;
  unavailableReason?: string;
}

/** Spec 128 §3.3 */
export type MetricKind =
  | "list_kpi"  // List page top KPI grid (Spec 103)
  | "ops"       // /overview snapshot ops row (Spec 102)
  | "summary";  // Permission/config summary card — not aggregated as List KPI

/** Spec 128 §3.3 */
export interface MetricContract {
  id: string;
  kind: MetricKind;
  /** Chinese display label */
  label: string;
  /** ⓘ tooltip copy — metric definition */
  help: string;
  /** Route paths where this metric appears */
  pages: string[];
  /** True if the metric depends on a time-windowed audit query */
  windowed: boolean;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/** All known List KPI and Overview Ops metrics. */
export const KPI_REGISTRY: MetricContract[] = [
  // ── AgentList ────────────────────────────────────────────────────────────
  {
    id: "agent-count",
    kind: "list_kpi",
    label: "Agent 总数",
    help: "统计 access 配置中已声明的全部 Agent 实例，含未启用。",
    pages: ["/admin/agents", "/admin/governance/overview"],
    windowed: false  // D1: config-class, single authoritative response
  },
  {
    id: "active-agent-count",
    kind: "list_kpi",
    label: "活跃 Agent",
    help: "当前时间窗内访问日志出现过的去重 Agent 数。",
    pages: ["/admin/agents", "/admin/governance/overview"],
    windowed: true
  },
  {
    id: "configured-token-count",
    kind: "list_kpi",
    label: "配置 Token",
    help: "已下发给 Agent 的凭证数量，含未启用 Agent 的 Token。",
    pages: ["/admin/agents", "/admin/governance/overview"],
    windowed: false  // D1: config-class
  },
  {
    id: "active-token-count",
    kind: "list_kpi",
    label: "活跃 Token",
    // D4: prefix→token mapping may not be unique; partial if ambiguous
    help: "当前时间窗内访问日志出现过的去重 token_hash_prefix 数。若 prefix 映射不唯一则显示 —（Spec 128 D4）。",
    pages: ["/admin/agents", "/admin/governance/overview"],
    windowed: true
  },
  {
    id: "calls-7d",
    kind: "list_kpi",
    label: "近 7 天调用量",
    help: "近 7 天经 MCP Proxy 记录的调用次数合计。",
    pages: ["/admin/agents"],
    windowed: true
  },
  // ── GovernanceOverview ───────────────────────────────────────────────────
  {
    id: "configured-table-count",
    kind: "list_kpi",
    label: "授权表",
    help: "角色权限中已明确授权的表数量；前缀授权会扩大可达范围。",
    pages: ["/admin/governance/overview"],
    windowed: false  // D1: config-class
  },
  {
    id: "active-table-count",
    kind: "list_kpi",
    // Task 6: partial when prefix/wildcard scope; rate only valid for explicit scope.
    label: "活跃表",
    help: "当前时间窗内被访问的去重表数。活跃率 = 活跃授权表 / 已解析授权表（仅显式授权时可计算；含前缀/通配符授权时显示 partial）。",
    pages: ["/admin/governance/overview"],
    windowed: true
  },
  {
    id: "calls",
    kind: "list_kpi",
    label: "调用量",
    help: "当前时间窗内经 MCP Proxy 记录的所有调用次数（含成功、拒绝、错误）。",
    pages: ["/admin/governance/overview"],
    windowed: true
  },
  {
    id: "acl-denied",
    kind: "list_kpi",
    // Task 7: query audit DB directly; explicitly exclude auth_error outcomes.
    label: "ACL 拒绝次数",
    help: "当前时间窗内访问日志中 outcome='denied' 的记录数，直接查询审计库，不含认证失败（auth_error）。",
    pages: ["/admin/governance/overview"],
    windowed: true
  },
  {
    id: "p95-latency",
    kind: "list_kpi",
    // Task 7: P95 over non-null duration_ms rows in same call population.
    label: "多数请求耗时",
    help: "当前时间窗内 95% 的请求完成耗时上限（P95），基于所有有 duration_ms 记录的调用行计算。",
    pages: ["/admin/governance/overview"],
    windowed: true
  },
  // ── Eval ─────────────────────────────────────────────────────────────────
  {
    id: "eval-runs-30d",
    kind: "list_kpi",
    // Task 4: 30-day bounded summary of succeeded runs only.
    label: "近 30 天评测运行",
    help: "近 30 天内 status='succeeded' 的评测运行次数；window=[started_at ≥ windowStart AND started_at < windowEnd]。",
    pages: ["/overview"],
    windowed: true
  },
  {
    id: "total-cases",
    kind: "list_kpi",
    label: "Case 总数",
    help: "Eval 套件中的总用例数（PASS + FAIL + SKIP）。",
    pages: ["/eval/cases"],
    windowed: false  // D1: config-class
  },
  {
    id: "latest-pass-rate",
    kind: "list_kpi",
    // D2: denominator = PASS / total_cases (PASS+FAIL+SKIP), SKIP included; latest SUCCEEDED run.
    label: "最近完成 Run 通过率",
    help: "最近一次已完成（succeeded）评测运行的通过率 = PASS / total_cases（PASS+FAIL+SKIP 均计入分母，D2）。",
    pages: ["/eval/cases"],
    windowed: false
  },
  {
    id: "latest-fail-count",
    kind: "list_kpi",
    label: "最近完成 Run 失败数",
    help: "最近一次已完成（succeeded）评测运行中 FAIL 的用例数。",
    pages: ["/eval/cases"],
    windowed: false
  },
  {
    id: "pass-rate",
    kind: "list_kpi",
    // D2: denominator = PASS / (PASS+FAIL+SKIP), SKIP included
    label: "通过率",
    help: "通过率 = PASS / 总用例数（PASS+FAIL+SKIP 均计入分母，D2）。",
    pages: ["/eval/runs"],
    windowed: false
  },
  {
    id: "top-failures",
    kind: "list_kpi",
    // Task 5: only succeeded runs in denominator.
    label: "Top 失败用例数",
    help: "指定窗口内失败次数最多的用例，仅统计 status='succeeded' 的运行（Task 5）；结果数量由配置 limit 决定。",
    pages: ["/eval/monitor"],
    windowed: true
  },
  // ── Summary (permission cards) ───────────────────────────────────────────
  {
    id: "role-source-count",
    kind: "summary",
    label: "数据源数",
    help: "该 Role 授权的数据源（source）数量。",
    pages: ["/admin/roles"],
    windowed: false
  }
];

/** Look up a contract by id. Returns undefined when not found. */
export function getContract(id: string): MetricContract | undefined {
  return KPI_REGISTRY.find((c) => c.id === id);
}

/** Convenience: all List KPI contracts. */
export const LIST_KPI_CONTRACTS: MetricContract[] = KPI_REGISTRY.filter(
  (c) => c.kind === "list_kpi"
);
