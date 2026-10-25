/**
 * Lucy v0.25 P1-2 — 授权摘要前端共享类型。
 *
 * Authority:
 *   - docs/specs/lucy-20261025-v0p25-access-authorization-summary-spec.md §2.1（summaryContext）、
 *     §3（授权摘要读取模型）、§4.1／§4.2（页面合同）
 *   - docs/plans/2026-10-25-lucy-v0.25-p1-implementation-plan.md §5（B1–B8）
 *
 * 这些类型是服务端 `webui/server/admin/authorization-summary.ts` 的**镜像**，不是
 * 另套模型：浏览器不得自己拼装权限或计数，只能读服务端返回的同一份派生结果。
 * 字段名与语义必须与服务端逐字一致，否则摘要与「访问关系图」就对不上账。
 *
 * 本文件只放类型，不含任何计算逻辑 —— 前端唯一的「计算」是把已算好的数字排版。
 */

export type AuthorizationSummaryState = "ok" | "partial" | "unavailable";
export type AuthorizationSubjectKind = "agent" | "role";
export type AuthorizationSummaryBasis = "committed" | "draft";

/** Spec §2.1 — 同一份摘要的快照身份。 */
export type AuthorizationSummaryContext = {
  subject: { kind: AuthorizationSubjectKind; id: string };
  basis: AuthorizationSummaryBasis;
  configVersion: string;
  policyVersion: string;
  sourceMapVersion: string;
  capabilityDigest: string;
  snapshotHash: string | null;
  state: AuthorizationSummaryState;
  problem: string | null;
  failures: Array<{ subjectId: string; reason: string }>;
  /** 候选草稿摘要；`null` 表示基于已提交配置。 */
  candidateDigest: string | null;
  /** true 时页面必须标「候选预览，尚未生效」。 */
  candidateOnly: boolean;
};

/** 行授予的只读投影（Spec §3 `rowGrant`）。 */
export type AuthorizationRowGrantPreview =
  | { kind: "all" }
  | { kind: "scoped"; digest: string; predicates: unknown[]; orArms: unknown[][] };

export type AuthorizationRowSummary = {
  kind: "all" | "scoped" | "unknown";
  basis: "final_rows" | "effective_row_grant";
  displayShape: "OR-of-AND";
  agentFinalRowsAvailable: boolean;
  agentPersonalLimitsApplied: boolean;
  templateRefs: string[];
  constraintSummary: string;
  orArms: string[];
  digest: string | null;
  error?: string;
};

export type AuthorizationResourceCapability = {
  tool: string;
  rowGrant: AuthorizationRowGrantPreview;
  finalRows?: AuthorizationRowGrantPreview;
};

export type AuthorizationResourceTable = {
  sourceKey: string;
  connectionId: string;
  schema: string;
  sourceName: string;
  physicalTable: string;
  roleIds: string[];
  capabilities: AuthorizationResourceCapability[];
  rowSummary: AuthorizationRowSummary;
  playgroundUrl: string | null;
};

export type AuthorizationResourceSchema = {
  schema: string;
  tables: AuthorizationResourceTable[];
};

export type AuthorizationResourceConnection = {
  connectionId: string;
  schemas: AuthorizationResourceSchema[];
};

export type AuthorizationToolGroups = {
  query: string[];
  semanticRead: string[];
  wikiRead: string[];
  write: string[];
  meta: string[];
};

export type AuthorizationSummaryHeadline = {
  connectionCount: number;
  tableCount: number;
  enabledTableCount: number | null;
  enabledTableDenominatorUnavailableReason: string | null;
  scopedTableCount: number | null;
  scopedTableCountBasis: "final_rows" | "effective_row_grant" | "unknown";
  grantPathCount: number;
  state: AuthorizationSummaryState;
};

export type AuthorizationSummaryActions = {
  /**
   * MCP 调试台深链（Agent 视图）。URL 由服务端拼，前端只渲染。
   * 契约：`/admin/mcp-playground?agentId=<userId>&mode=dry-run&tool=...&args=...`。
   */
  playgroundUrl: string | null;
  /**
   * 访问关系图深链（Agent 视图）。契约：`/admin/access-map?agent=<userId>`。
   */
  accessMapUrl: string | null;
  /**
   * 行权限视图深链。**非 null ⇒ 指向一张确实有行约束的表。**
   *
   * 查询参数名是 `connectionId` / `schema` / `sourceName` —— 必须与
   * `webui/src/pages/admin/RowPolicyView.tsx` 实际读取的参数名逐字一致，
   * 否则单表详情面板永远不会渲染（参数名漂移过一次，见 P0-2）。
   */
  rowPolicyViewUrl: string | null;
  /** 引用了本主体的 Agent ID；每个都有一条自己的授权摘要路由。 */
  referencingAgentIds: string[];
};

export type AuthorizationRoleContribution = {
  roleId: string;
  ok: boolean;
  reason?: string;
  tableCount: number;
};

export type AuthorizationSummary = {
  summaryContext: AuthorizationSummaryContext;
  headline: AuthorizationSummaryHeadline;
  resources: AuthorizationResourceConnection[];
  tools: AuthorizationToolGroups;
  unclassifiedTools: string[];
  actions: AuthorizationSummaryActions;
  roleContributions: AuthorizationRoleContribution[];
  legacyAllow: boolean;
  diagnostics: Array<{ code: string; detail: string }>;
};
