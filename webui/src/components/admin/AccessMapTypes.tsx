/**
 * Lucy v0.25 P1-3 — 访问关系图前端共享类型与文案。
 *
 * Authority: `webui/docs/187-access-relation-sankey-spec.md`
 *   §4.2 口径（节点副行固定「N 个 Agent · M 条路径」）
 *   §4.4 边状态（normal / dormant / needs_review / overflow）
 *   §4.7 节点类型
 *   §4.9 越权信号措辞（第一档禁称「越权」）
 *
 * 文案集中在这里，是为了让「需复核」与「确凿越权」两档措辞只有一个出处 ——
 * SC-10 要求第一档的 UI 文案不含「越权」二字，集中定义比分散在 JSX 里更可核。
 */

export type AccessMapNodeKind = "agent" | "role" | "connection" | "schema" | "table" | "token";

export type AccessMapEdgeState = "normal" | "dormant" | "needs_review" | "overflow";

export type AccessMapSnapshotResult = "covered_at_call_time" | "confirmed_unauthorized" | "unknown";

export type AccessMapSnapshotReason =
  | "snapshot_missing"
  | "snapshot_invalid"
  | "snapshot_identity_mismatch";

export type AccessMapSnapshotEvaluation = {
  pathKey: string;
  agentId: string;
  roleId: string;
  connectionId: string;
  schema: string;
  sourceName: string;
  calls: number;
  result: AccessMapSnapshotResult;
  reason: AccessMapSnapshotReason | null;
  evidence: Array<{ callId: string; result: AccessMapSnapshotResult; reason: AccessMapSnapshotReason | null }>;
};

export type AccessMapCoverage = {
  reviewPaths: number;
  matched: number;
  missingOrInvalid: number;
  ratio: number;
};

export type AccessMapNodeMeta = {
  enabled?: boolean;
  roleIds?: string[];
  tokenCount?: number;
  grantUsers?: number;
  grantPaths?: number;
  accessUsers?: number;
  accessPaths?: number;
  /** 授权路径上出现过的 Agent id。共享下游时用来把别人的问询剔出当前主体。 */
  grantAgentIds?: string[];
  /** 访问路径上出现过的 Agent id。 */
  accessAgentIds?: string[];
  /** 折叠进「其他」的真实节点 id。只出现在渲染节点上。 */
  foldedMemberIds?: string[];
  sourceScope?: string;
  toolCount?: number;
  tableCount?: number;
  agents?: string[];
  status?: string;
  schemaCount?: number;
  physicalTable?: string;
  label?: string;
  createdAt?: string | null;
  expiresAt?: string | null;
  lastUsedAt?: string | null;
  callCount?: number;
  revokedAt?: string | null;
  unresolved?: boolean;
};

export type AccessMapNode = {
  id: string;
  kind: AccessMapNodeKind;
  label: string;
  depth: number;
  parentId?: string;
  meta: AccessMapNodeMeta;
};

export type AccessMapEdge = {
  id: string;
  source: string;
  target: string;
  grantPaths: number;
  grantUsers: number;
  accessPaths: number;
  accessUsers: number;
  accessCalls: number;
  state: AccessMapEdgeState;
  confirmedUnauthorized: boolean;
  reviewEvaluations: AccessMapSnapshotEvaluation[];
  snapshotCoverage: AccessMapCoverage;
};

/** Spec 20261102 D8：结构筛选前进入访问路径构建的允许调用披露。 */
export type AccessMapEchoMeta = {
  enteringAllowCallCount: number;
  enteringAllowCallCountBasis: "pre_structure";
};

export type AccessMapInquiryKindFilter =
  | "management"
  | "real"
  | "unreported_query"
  | "session_visit"
  | "all";

export type AccessMapAccessGradeFilter =
  | "exclude_connect"
  | "all"
  | "connect"
  | "browse"
  | "prepare"
  | "ask"
  | "query"
  | "control"
  | "unclassified";

export type AccessMapMeta = {
  window: { startIso: string; endIso: string; asOf: string };
  grant: {
    state: "ok" | "partial" | "unavailable";
    problem: "access_unreadable" | "access_invalid" | "access_config_path_mismatch" | null;
    accessConfigVersion: string;
    policyVersion: string;
    sourceMapVersion: string;
    capabilityDigest: string;
    failures: Array<{ subjectId: string; reason: string }>;
  };
  access: {
    state: "ok" | "unavailable";
    trust: "confirmed" | "include_candidate";
    deniedCalls: number;
    rawCalls: number;
    reason?: string;
  };
  /** 结构筛选前投影集合 E 披露；缺省参数构图时服务端总会带回。 */
  echo?: AccessMapEchoMeta;
  counts: {
    agents: number;
    roles: number;
    connections: number;
    schemas: number;
    tables: number;
    tokens: number;
    edges: number;
    grantPaths: number;
    grantUsers: number;
    accessPaths: number;
    accessUsers: number;
  };
  signals: {
    dormantEdges: number;
    needsReviewEdges: number;
    confirmedUnauthorizedEdges: number;
  };
  snapshotCoverage: AccessMapCoverage;
  orphanGrants: number;
  folded: { nodes: number; edges: number };
  countingNotes: string[];
};

/** 小时明细行问询种类：InquiryKind 或无关联（null）。不是筛选「全部／管理相关」。 */
export type AccessMapDetailInquiryKind = "real" | "unreported_query" | "session_visit";

export type AccessMapDetailAccessGrade =
  | "connect"
  | "browse"
  | "prepare"
  | "ask"
  | "query"
  | "control"
  | "unclassified";

/** Spec 20261104 §6.1：同投影小时明细行（公共响应不暴露调用 ID 列表）。 */
export type AccessMapHourlyDetailRow = {
  hour: string;
  agentId: string;
  roleId: string;
  connectionId: string;
  schema: string;
  table: string;
  inquiryKind: AccessMapDetailInquiryKind | null;
  accessGrade: AccessMapDetailAccessGrade;
  allowCalls: number;
  denyCalls: number;
};

export type AccessMapHourlyDetail = {
  rows: AccessMapHourlyDetailRow[];
  hasMore: boolean;
  totalRowCount: number;
  limit: number;
  offset: number;
};

export type AccessMapResponse = {
  meta: AccessMapMeta;
  nodes: AccessMapNode[];
  edges: AccessMapEdge[];
  render: {
    nodes: AccessMapNode[];
    edges: AccessMapEdge[];
    folded: { nodes: number; edges: number };
  };
  /** 仅 `view=table` 时由服务端计算；access unavailable 时可为 null。 */
  detail?: AccessMapHourlyDetail | null;
};

/**
 * 节点类型的中文列名（数据表「类型」列与图面列标题共用）。
 *
 * 技术标识 `agent` / `role` / `connection` / `table` / `schema` **不得**原样出现在
 * 数据表「类型」列（呈现修订 Spec「Forbidden terms」），所以这里只保留一处映射。
 */
export function accessMapNodeKindLabel(kind: AccessMapNodeKind): string {
  switch (kind) {
    case "agent":
      return "Agent";
    case "role":
      return "角色";
    case "connection":
      return "连接";
    case "schema":
      return "Schema";
    case "table":
      return "表";
    default:
      return "Token";
  }
}

/**
 * 统计窗口的**可见**文案。URL 里的值仍是 `24h` / `168h` / `720h`（Spec 187 §6.3），
 * 两者不能互相替代：URL 值是可分享的技术参数，可见文案是给人读的。
 */
export function accessMapWindowLabel(value: string): string {
  switch (value) {
    case "24h":
      return "近 24 小时";
    case "720h":
      return "近 30 天";
    default:
      return "近 7 天";
  }
}

/** 节点副行：「N 个 Agent · M 条路径」。路径数绝不能显示成 Agent 数（§4.2）。 */
export function accessMapNodeSubtitle(node: AccessMapNode): string {
  const agents = node.meta.grantUsers ?? 0;
  const paths = node.meta.grantPaths ?? 0;
  return `${agents} 个 Agent · ${paths} 条路径`;
}

export function accessMapEdgeStateLabel(state: AccessMapEdgeState): string {
  switch (state) {
    case "dormant":
      return "闲置授权";
    case "needs_review":
      return "需复核";
    case "overflow":
      return "访问超出授权";
    default:
      return "正常";
  }
}

/**
 * 访问面可用时边悬停结论句（lucy-20261105 §5.2）。
 * 确凿越权括注由 Canvas 拼接，不进入本函数。
 */
export function accessMapEdgeHoverConclusion(state: AccessMapEdgeState): string {
  switch (state) {
    case "dormant":
      return "有授权，窗口内未调用";
    case "needs_review":
      return "窗口内有调用，当前授权对不上（需复核）";
    case "overflow":
      return "窗口内有调用，且超出当前授权";
    default:
      return "有授权，窗口内有调用";
  }
}

/** 访问面不可用时悬停结论（§5.3，逐字）。 */
export const ACCESS_MAP_HOVER_ACCESS_UNAVAILABLE_CONCLUSION = "授权面可读，调用情况暂不可用";

/** 访问面不可用时数字行调用段（§5.3，逐字）；禁止写成「调用 0 次」。 */
export const ACCESS_MAP_HOVER_ACCESS_UNAVAILABLE_CALLS = "调用情况暂不可用";

export const ACCESS_MAP_CONFIRMED_UNAUTHORIZED_HOVER_NOTE =
  "（确凿越权：调用当时授权亦不覆盖）";

export function accessMapTrustLabel(trust: "confirmed" | "include_candidate"): string {
  return trust === "include_candidate" ? "含候选关联" : "已确认关联";
}

/**
 * 问询种类筛选的中文标签（与访问日志问询记录 Tab 下拉一致）。
 * URL 技术值不得原样作为可见文案。
 */
export function accessMapInquiryKindLabel(kind: AccessMapInquiryKindFilter | string): string {
  switch (kind) {
    case "real":
      return "真实问询";
    case "unreported_query":
      return "未上报问询";
    case "session_visit":
      return "会话访问";
    case "all":
      return "全部种类";
    case "management":
    default:
      return "管理相关";
  }
}

/**
 * 访问等级筛选的中文标签（与访问日志调用流水 Tab 下拉一致）。
 */
export function accessMapAccessGradeLabel(grade: AccessMapAccessGradeFilter | string): string {
  switch (grade) {
    case "all":
      return "全部";
    case "connect":
      return "连接";
    case "browse":
      return "浏览";
    case "prepare":
      return "准备";
    case "ask":
      return "问询动作";
    case "query":
      return "查数";
    case "control":
      return "运维操作";
    case "unclassified":
      return "未分级";
    case "exclude_connect":
    default:
      return "排除连接";
  }
}

/** 主工具条「问询种类」下拉选项；value 空串表示缺省 management（不写 URL）。 */
export const ACCESS_MAP_INQUIRY_KIND_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "", label: "管理相关" },
  { value: "real", label: "真实问询" },
  { value: "unreported_query", label: "未上报问询" },
  { value: "session_visit", label: "会话访问" },
  { value: "all", label: "全部种类" }
];

/** 主工具条「访问等级」下拉选项；value 空串表示缺省 exclude_connect（不写 URL）。 */
export const ACCESS_MAP_ACCESS_GRADE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "all", label: "全部" },
  { value: "", label: "排除连接" },
  { value: "connect", label: "连接" },
  { value: "browse", label: "浏览" },
  { value: "prepare", label: "准备" },
  { value: "ask", label: "问询动作" },
  { value: "query", label: "查数" },
  { value: "control", label: "运维操作" },
  { value: "unclassified", label: "未分级" }
];

export const ACCESS_MAP_DEFAULT_INQUIRY_KIND: AccessMapInquiryKindFilter = "management";
export const ACCESS_MAP_DEFAULT_ACCESS_GRADE: AccessMapAccessGradeFilter = "exclude_connect";

/** 弱入口关联口径说明（Spec §5.2）。 */
export const ACCESS_MAP_TRUST_HINT =
  "授权连接始终显示。关联口径只影响访问面：默认只计已确认关联；含候选关联时，候选关联上的允许调用也计入访问。";

/** 快照覆盖率的可读表述；低覆盖率不得被读成低越权率（§4.9 / SC-13）。 */
export function accessMapCoverageText(coverage: AccessMapCoverage): string {
  const percent = Math.round(coverage.ratio * 100);
  return `需复核记录 ${coverage.reviewPaths} 条 · 可关联快照 ${coverage.matched} 条 · 缺失或无效 ${coverage.missingOrInvalid} 条 · 覆盖率 ${percent}%`;
}

/**
 * 常驻行覆盖率压缩句（Spec 20261104 §5.3／术语表）。
 * 低覆盖率不得读成低越权率（SC-18）。
 */
export function accessMapCoverageCompressedText(coverage: AccessMapCoverage): string {
  return `快照：可关联 ${coverage.matched}／需复核 ${coverage.reviewPaths} · 缺失 ${coverage.missingOrInvalid}`;
}

/** 小时明细「问询种类」单元格；null →「无关联」（D13）。 */
export function accessMapDetailInquiryKindLabel(
  kind: AccessMapDetailInquiryKind | string | null
): string {
  if (kind === null) return "无关联";
  return accessMapInquiryKindLabel(kind);
}

/** 小时明细「访问等级」单元格。 */
export function accessMapDetailAccessGradeLabel(
  grade: AccessMapDetailAccessGrade | string
): string {
  return accessMapAccessGradeLabel(grade);
}

/**
 * 第一档（需复核信号）的档位说明（§4.9.2）。
 *
 * **这一串文案里不得出现「越权」二字**：没有调用当时快照证据时，「访问了但当前
 * 无授权路径」首先意味着**需要复核**，不必然等于越权（§4.9.1 / §4.9.3 / SC-10）。
 * 术语标准 §4.8「Needs-review Signal」把「越权」列进禁止文案。
 */
export const ACCESS_MAP_NEEDS_REVIEW_TIER_NOTE =
  "需复核信号：当前授权无对应路径（审计记录显示发生过允许的访问）";

/**
 * 第二档（确凿越权）的**来源标注**（§4.9.2 / SC-10）。
 *
 * 这一档的结论不是来自当前授权，而是来自 `access_log.permission_snapshot_hash`
 * 关联到的**调用当时**的授权快照，所以必须在图上单独标出来源，否则读者会误以为
 * 它与第一档同源、同样只是「当前授权对不上」。
 */
export const ACCESS_MAP_CONFIRMED_TIER_SOURCE =
  "确凿越权判定来源：调用当时授权亦不覆盖（取自调用当时的授权快照）";

/**
 * 闲置授权档的口径说明（呈现修订 Spec §5.2 指标卡 ⓘ 内容）。
 *
 * 这是「有权未用」的判据，**不含任何越权字样**：闲置授权是配置事实，
 * 不是行为指控。
 */
export const ACCESS_MAP_DORMANT_TIER_NOTE =
  "授权路径数大于 0，且窗口内访问路径数为 0";

/**
 * Token 过滤提示句（Spec 187 §4.5「交互诚实性」）。
 *
 * **逐字固定**：读者必须能分清「访问层被过滤」与「授权层被收窄」。
 * 首尾两段拆出来是为了让 Token label 单独包在 `notranslate` 节点里，
 * 而整句的可见文字必须保持「已按 Token {label} 过滤访问层，授权层不受影响。」
 */
export const ACCESS_MAP_TOKEN_FILTER_NOTICE_HEAD = "已按 Token ";
export const ACCESS_MAP_TOKEN_FILTER_NOTICE_TAIL = " 过滤访问层，授权层不受影响。";

/**
 * 降级原因文案（§5.5 / §7.6）。
 *
 * 三态与角色权限页 `CountState` 口径一致；不可用时必须说明「为什么」，
 * 不允许用空图冒充正常结果。
 */
export function accessMapGrantProblemLabel(
  problem: AccessMapMeta["grant"]["problem"]
): string {
  switch (problem) {
    case "access_unreadable":
      return "授权配置不可读：请检查 access.yaml 是否存在且可访问";
    case "access_invalid":
      return "授权配置格式非法：请检查 access.yaml 的结构";
    case "access_config_path_mismatch":
      return "授权配置路径不一致：管理台与运行时读取的 access.yaml 不是同一份";
    default:
      return "授权配置不可用";
  }
}
