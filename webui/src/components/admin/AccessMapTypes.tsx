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

export type AccessMapResponse = {
  meta: AccessMapMeta;
  nodes: AccessMapNode[];
  edges: AccessMapEdge[];
  render: {
    nodes: AccessMapNode[];
    edges: AccessMapEdge[];
    folded: { nodes: number; edges: number };
  };
};

/** 节点副行：「N 个 Agent · M 条路径」。路径数绝不能显示成 Agent 数（§4.2）。 */
export function accessMapNodeSubtitle(node: AccessMapNode): string {
  const agents = node.meta.grantUsers ?? 0;
  const paths = node.meta.grantPaths ?? 0;
  return `${agents} 个 Agent · ${paths} 条路径`;
}

export function accessMapEdgeStateLabel(state: AccessMapEdgeState): string {
  switch (state) {
    case "dormant":
      return "僵尸授权";
    case "needs_review":
      return "需复核";
    case "overflow":
      return "访问超出授权";
    default:
      return "正常";
  }
}

export function accessMapTrustLabel(trust: "confirmed" | "include_candidate"): string {
  return trust === "include_candidate" ? "含候选口径" : "已确认口径";
}

/** 快照覆盖率的可读表述；低覆盖率不得被读成低越权率（§4.9 / SC-13）。 */
export function accessMapCoverageText(coverage: AccessMapCoverage): string {
  const percent = Math.round(coverage.ratio * 100);
  return `需复核记录 ${coverage.reviewPaths} 条 · 可关联快照 ${coverage.matched} 条 · 缺失或无效 ${coverage.missingOrInvalid} 条 · 覆盖率 ${percent}%`;
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
