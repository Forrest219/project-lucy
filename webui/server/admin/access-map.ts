/**
 * Lucy v0.25 P1-3 — 访问关系图 (Access Map) 服务端构图。
 *
 * Authority: `webui/docs/187-access-relation-sankey-spec.md`
 *   §4.2  授权路径 / 访问路径口径（五个互不替代的数）
 *   §4.3  边宽 = 授权路径数（流守恒）+「合并 sources 不可反推角色归因」
 *   §4.5  Token 凭证清单（不承载授权、不参与守恒、只过滤访问层）
 *   §4.8  零授权表的处理（不入图 / 孤儿授权）
 *   §4.9  越权信号的可信度边界（两档信号 + 快照覆盖率披露）
 *   §5.1  授权骨架构建    §5.2 访问层构建    §5.3 边聚合与状态判定
 *   §5.4  折叠（规模预算）§5.5 降级矩阵
 *   §6.2  响应结构        §6.3 URL 参数
 *
 * 这个模块只做**只读展示**：不写审计事件、不改变任何裁决结果、不新增授权模型。
 *
 * 三条不能破的线（本模块存在的全部理由）：
 *
 *  1. **per-role 编译是唯一入口。** 合并后的 `EffectivePermissions.sources` 是各 Role
 *     的并集，并集丢掉「哪张表来自哪个 Role」。所以本模块只调用
 *     `compileRoleForAdmin(roleId, ctx)` 拿**单个 Role 自己的** source 集合，
 *     绝不拿合并结果再拆（§4.3）。
 *  2. **一个调用归属两个 Role 时，全局调用数按稳定调用 ID 去重。** 各 Role 边的
 *     `accessCalls` 相加会把一次调用数两次；全局数字必须走 `globalCallCount`。
 *  3. **快照证据缺失／损坏／身份不符时只保留「需复核」。** 不得升级为「确凿越权」，
 *     低快照覆盖率也不得被读成低越权率（§4.9）。
 *
 * 构图与渲染分离：`buildAccessMap` 产出**全量**图（计数口径的唯一真源），
 * `render` 子集只是给 SVG 用的折叠视图；表格等价视图始终读全量，
 * 所以「折叠只影响渲染、不影响计数」是结构上成立的，而不是靠约定。
 */
import {
  buildAdminPermissionContext,
  capabilityDigest,
  compileRoleForAdmin,
  resolveEffectivePermissionsBatchForAdmin,
  type AdminPermissionContext,
  type EffectiveCapability,
  type PerRoleCompilation
} from "../proxy/acl.js";
import { isTokenExpired } from "../proxy/identity.js";
import { resolveProjectRoot } from "../project.js";
import { getAuditDb } from "./audit.js";
import {
  enabledUserIdsFromRaw,
  readAccessSnapshot,
  type AccessSnapshot
} from "./permission-display.js";
import {
  currentPolicyGeneration,
  snapshotContextOf,
  type SnapshotIdentity,
  type SnapshotProblem,
  type SnapshotState
} from "./snapshot-identity.js";
import {
  accessPathKey,
  assertCountingInvariant,
  countAccessPaths,
  countDistinctAgents,
  countGrantPaths,
  countTables,
  globalCallCount,
  grantPathKey,
  type AccessPathRef,
  type CanonicalSourceRef,
  type GrantPathRef
} from "./counting.js";
import { buildMetricWindow, type MetricWindow } from "./metric-window.js";
import { defaultUsageConditionSql } from "../proxy/usage-classification.js";

/** Spec 189 §4.1 — the single Default Usage condition. */
const DEFAULT_USAGE_CONDITION = defaultUsageConditionSql().sql;

// ─── §6.3 URL 参数 ────────────────────────────────────────────────────────────

export type AccessMapWindow = "24h" | "168h" | "720h";
export type AccessMapLayer = "flat" | "schema";
export type AccessMapTrust = "confirmed" | "include_candidate";
export type AccessMapView = "map" | "table";

/** 统计窗口小时数。默认 168h（与 L25-03「使用概况」同口径）。 */
export const ACCESS_MAP_WINDOW_HOURS: Record<AccessMapWindow, number> = {
  "24h": 24,
  "168h": 168,
  "720h": 720
};
export const ACCESS_MAP_DEFAULT_WINDOW: AccessMapWindow = "168h";

export type AccessMapQuery = {
  agent: string | null;
  role: string | null;
  token: string | null;
  table: string | null;
  connection: string | null;
  window: AccessMapWindow;
  layer: AccessMapLayer;
  trust: AccessMapTrust;
  view: AccessMapView;
  focus: string | null;
};

export type AccessMapQueryError = {
  code: string;
  message: string;
  /** 出错参数名，便于前端定位。 */
  param: string;
};

export type AccessMapQueryParseResult =
  | { ok: true; query: AccessMapQuery }
  | { ok: false; error: AccessMapQueryError };

const WINDOW_VALUES = new Set<string>(["24h", "168h", "720h"]);
const LAYER_VALUES = new Set<string>(["flat", "schema"]);
const TRUST_VALUES = new Set<string>(["confirmed", "include_candidate"]);
const VIEW_VALUES = new Set<string>(["map", "table"]);

function readParam(
  input: URLSearchParams | Record<string, string | undefined>,
  key: string
): string | null {
  const raw = input instanceof URLSearchParams ? input.get(key) : input[key];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * 解析并校验 URL 参数。
 *
 * 非法值一律返回 400（`ok: false`），不做静默纠正 —— 一个被悄悄改写成默认值的
 * 分享链接，会让用户以为「这个 Agent 没有授权路径」，而真相只是拼错了一个参数。
 */
export function parseAccessMapQuery(
  input: URLSearchParams | Record<string, string | undefined>
): AccessMapQueryParseResult {
  const bad = (param: string, message: string): AccessMapQueryParseResult => ({
    ok: false,
    error: { code: "INVALID_ACCESS_MAP_PARAMETER", message, param }
  });

  const windowRaw = readParam(input, "window");
  if (windowRaw !== null && !WINDOW_VALUES.has(windowRaw)) {
    return bad("window", "统计窗口只能是 24h、168h 或 720h");
  }
  const layerRaw = readParam(input, "layer");
  if (layerRaw !== null && !LAYER_VALUES.has(layerRaw)) {
    return bad("layer", "层级参数只能是 flat 或 schema");
  }
  const trustRaw = readParam(input, "trust");
  if (trustRaw !== null && !TRUST_VALUES.has(trustRaw)) {
    return bad("trust", "访问口径参数只能是 confirmed 或 include_candidate");
  }
  const viewRaw = readParam(input, "view");
  if (viewRaw !== null && !VIEW_VALUES.has(viewRaw)) {
    return bad("view", "视图参数只能是 map 或 table");
  }

  const tableRaw = readParam(input, "table");
  if (tableRaw !== null && splitTableParam(tableRaw) === null) {
    return bad("table", "表定位参数必须是 conn::schema::table");
  }

  return {
    ok: true,
    query: {
      agent: readParam(input, "agent"),
      role: readParam(input, "role"),
      token: readParam(input, "token"),
      table: tableRaw,
      connection: readParam(input, "connection"),
      window: (windowRaw as AccessMapWindow | null) ?? ACCESS_MAP_DEFAULT_WINDOW,
      layer: (layerRaw as AccessMapLayer | null) ?? "flat",
      trust: (trustRaw as AccessMapTrust | null) ?? "confirmed",
      view: (viewRaw as AccessMapView | null) ?? "map",
      focus: readParam(input, "focus")
    }
  };
}

/** `conn::schema::table` → 三元组；格式不合法返回 null。 */
export function splitTableParam(
  raw: string
): { connectionId: string; schema: string; sourceName: string } | null {
  const parts = raw.split("::");
  if (parts.length !== 3) return null;
  const [connectionId, schema, sourceName] = parts.map((part) => part.trim());
  if (!connectionId || !schema || !sourceName) return null;
  return { connectionId, schema, sourceName };
}

// ─── §4.7 节点类型 / §4.4 边状态 ─────────────────────────────────────────────

export type AccessMapNodeKind = "agent" | "role" | "connection" | "schema" | "table" | "token";

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
  /** 伪节点（`role:<unresolved>`）：灰显、不可点击。 */
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

export type AccessMapEdgeState = "normal" | "dormant" | "needs_review" | "overflow";

export type AccessMapSnapshotResult = "covered_at_call_time" | "confirmed_unauthorized" | "unknown";

export type AccessMapSnapshotReason =
  | "snapshot_missing"
  | "snapshot_invalid"
  | "snapshot_identity_mismatch";

export type AccessMapSnapshotEvidence = {
  callId: string;
  result: AccessMapSnapshotResult;
  reason: AccessMapSnapshotReason | null;
};

/** 一条访问路径的快照判定结果（§4.9.2 / §5.3 A3）。 */
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
  evidence: AccessMapSnapshotEvidence[];
};

export type AccessMapCoverage = {
  /** 需复核 / 溢出的访问路径数（分母）。 */
  reviewPaths: number;
  /** 可关联且可用的快照数（分子）。 */
  matched: number;
  /** 缺失 / 损坏 / 身份不符的路径数。 */
  missingOrInvalid: number;
  /** matched / reviewPaths；分母为 0 时为 0。 */
  ratio: number;
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

// ─── 内部图（带 Set，折叠时才能正确合并主体数） ──────────────────────────────

type InternalNode = {
  id: string;
  kind: AccessMapNodeKind;
  label: string;
  depth: number;
  parentId?: string;
  meta: AccessMapNodeMeta;
  grantPaths: number;
  grantUsers: Set<string>;
  accessPaths: number;
  accessUsers: Set<string>;
};

type InternalEdge = {
  id: string;
  source: string;
  target: string;
  grantPaths: number;
  grantUsers: Set<string>;
  accessPaths: number;
  accessUsers: Set<string>;
  /** 该边上出现过的调用 ID（去重后即 `accessCalls`）。 */
  accessCallIds: Set<string>;
  state: AccessMapEdgeState;
  confirmedUnauthorized: boolean;
  reviewEvaluations: AccessMapSnapshotEvaluation[];
};

// ─── 输入契约（依赖注入，便于单测覆盖降级与证据分支） ────────────────────────

export type AccessMapTokenRecord = {
  label: string;
  status: "active" | "expired" | "revoked";
  createdAt?: string | null;
  expiresAt?: string | null;
  lastUsedAt?: string | null;
  callCount: number;
  revokedAt?: string | null;
};

export type AccessMapAgentRecord = {
  id: string;
  name?: string;
  enabled: boolean;
  roleIds: string[];
  tokens: AccessMapTokenRecord[];
};

export type AccessMapGrantSource = {
  connectionId: string;
  schema: string;
  sourceName: string;
  physicalTable?: string;
};

/** 一个 `(Agent, Role)` 组合**单独**贡献的 source 集合。 */
export type AccessMapRoleContribution = {
  agentId: string;
  roleId: string;
  sources: AccessMapGrantSource[];
};

export type AccessMapGrantSide = {
  state: SnapshotState;
  problem: SnapshotProblem | null;
  failures: Array<{ subjectId: string; reason: string }>;
  identity: SnapshotIdentity;
  agents: AccessMapAgentRecord[];
  contributions: AccessMapRoleContribution[];
  /** 已授权但连接未启用该表的表数（§4.8）。 */
  orphanGrants: number;
  /** 出现在目录里的连接（用于连接节点的 `status`）。 */
  enabledConnections: string[];
  /** Role 元信息（源范围 / 工具数），只影响展示。 */
  roleMeta?: Record<string, { sourceScope?: string; toolCount?: number }>;
};

export type AccessMapAuditRow = {
  /** 稳定调用 ID（`access_log.id`）：全局调用数按它去重。 */
  callId: string;
  userId: string;
  matchedRoleId: string | null;
  /** `access_log.role_ids` 的 JSON 数组；解析失败即空数组。 */
  roleIds: string[];
  tokenLabel: string | null;
  outcome: string;
  ts: string;
  permissionSnapshotHash: string | null;
  capabilityDigest: string | null;
  connectionId: string;
  schemaName: string;
  sourceName: string;
};

export type AccessMapPermissionSnapshot = {
  hash: string;
  rolesJson: unknown;
  resolvedJson: unknown;
  capabilityDigest: string | null;
};

export type AccessMapAccessSide =
  | {
      state: "ok";
      rows: AccessMapAuditRow[];
      /** 窗口内每个 token label 的调用数（与 token 过滤无关，保证凭证清单稳定）。 */
      tokenCallCounts: Map<string, number>;
      tokenLastUsed: Map<string, string>;
      loadSnapshot: (hash: string) => AccessMapPermissionSnapshot | null;
    }
  | { state: "unavailable"; reason: string };

/**
 * 构图依赖。真实实现由 `createAdminAccessMapProvider` 组装；测试注入假实现，
 * 这样守恒、四口径、快照证据分档、降级都能被确定性地断言。
 */
export type AccessMapProvider = {
  loadGrantSide: () => Promise<AccessMapGrantSide>;
  loadAccessSide: (input: {
    window: MetricWindow;
    trust: AccessMapTrust;
    tokenLabel: string | null;
  }) => Promise<AccessMapAccessSide>;
};

// ─── §4.2 访问路径聚合 ────────────────────────────────────────────────────────

type AccessCall = {
  callId: string;
  permissionSnapshotHash: string | null;
  capabilityDigest: string | null;
};

type AccessPathAggregate = {
  pathKey: string;
  agentId: string;
  roleId: string;
  connectionId: string;
  schema: string;
  sourceName: string;
  calls: AccessCall[];
};

/** 伪节点：审计记录既无 `matched_role_id` 也无 `role_ids`。 */
export const UNRESOLVED_ROLE_ID = "<unresolved>";

export function unresolvedRoleNodeId(): string {
  return `role:${UNRESOLVED_ROLE_ID}`;
}

export function parseRoleIdsJson(raw: string | null | undefined): string[] {
  if (typeof raw !== "string" || raw.trim().length === 0) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  } catch {
    return [];
  }
}

/**
 * 角色归因（§4.2 / §5.2 A3）。
 *
 * `matched_role_id` 单值优先；为空时回退 `role_ids` 逐个展开；都没有则归伪节点。
 * 展开到多个 Role 时，一次调用会在多条 Role 边上各计一次 —— 这是**边上**的语义，
 * 全局调用数必须另按调用 ID 去重。
 */
export function attributeRoles(row: AccessMapAuditRow): string[] {
  const matched = typeof row.matchedRoleId === "string" ? row.matchedRoleId.trim() : "";
  if (matched) return [matched];
  if (row.roleIds.length > 0) return [...new Set(row.roleIds)];
  return [UNRESOLVED_ROLE_ID];
}

export type AccessLayerResult = {
  paths: AccessPathAggregate[];
  /** 被拒绝的访问尝试数（按调用 ID 去重）。 */
  deniedCalls: number;
  /** 进入访问内核的原始调用数（按调用 ID 去重，不做跨 Role 相加）。 */
  rawCalls: number;
  /** 窗口内每个 token label 的调用数（token 过滤之前统计）。 */
  tokenCallCounts: Map<string, number>;
  tokenLastUsed: Map<string, string>;
};

/**
 * 构建访问层（§5.2）。
 *
 * - 只有 `outcome === "allow"` 进入访问路径；`deny` 单独计数（§4.9.3）。
 * - 同一 `(user, role, conn, schema, table)` 去重；`ts` 与 token **不进路径主键**。
 * - 一次调用在同一张表上只算 1 次调用。
 */
export function buildAccessLayer(input: {
  rows: AccessMapAuditRow[];
  tokenLabel: string | null;
}): AccessLayerResult {
  const { rows, tokenLabel } = input;
  const paths = new Map<string, AccessPathAggregate>();
  const deniedCallIds = new Set<string>();
  const tokenCallCounts = new Map<string, number>();
  const tokenLastUsed = new Map<string, string>();

  for (const row of rows) {
    if (row.tokenLabel) {
      tokenCallCounts.set(row.tokenLabel, (tokenCallCounts.get(row.tokenLabel) ?? 0) + 1);
      const previous = tokenLastUsed.get(row.tokenLabel);
      if (!previous || row.ts > previous) tokenLastUsed.set(row.tokenLabel, row.ts);
    }
    // Token 过滤只作用于访问层内核，授权骨架不受影响（§4.5）。
    if (tokenLabel !== null && row.tokenLabel !== tokenLabel) continue;

    if (row.outcome !== "allow") {
      deniedCallIds.add(row.callId);
      continue;
    }

    for (const roleId of attributeRoles(row)) {
      const pathKey = accessPathKey({
        agentId: row.userId,
        roleId,
        connectionId: row.connectionId,
        schema: row.schemaName,
        sourceName: row.sourceName
      });
      let path = paths.get(pathKey);
      if (!path) {
        path = {
          pathKey,
          agentId: row.userId,
          roleId,
          connectionId: row.connectionId,
          schema: row.schemaName,
          sourceName: row.sourceName,
          calls: []
        };
        paths.set(pathKey, path);
      }
      // 同一调用在同一张表上只算一次调用。
      if (path.calls.some((call) => call.callId === row.callId)) continue;
      path.calls.push({
        callId: row.callId,
        permissionSnapshotHash: row.permissionSnapshotHash,
        capabilityDigest: row.capabilityDigest
      });
    }
  }

  // 全局调用数按稳定调用 ID 去重（`globalCallCount`），绝不把各 Role 边的
  // `accessCalls` 相加后冒充全局调用数（§4.2 / §4.9）。
  const rawCalls = globalCallCount(
    [...paths.values()].flatMap((path) =>
      path.calls.map((call) => ({ callId: call.callId, roleId: path.roleId }))
    )
  );

  return {
    paths: [...paths.values()],
    deniedCalls: deniedCallIds.size,
    rawCalls,
    tokenCallCounts,
    tokenLastUsed
  };
}

// ─── §4.9 快照证据 ───────────────────────────────────────────────────────────

type ResolvedSnapshot = {
  sources: Array<{ connectionId: string; schema: string; sourceName: string }>;
};

function parseResolvedSnapshot(raw: unknown): ResolvedSnapshot | null {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  const sources = (value as { sources?: unknown }).sources;
  if (!Array.isArray(sources)) return null;
  return {
    sources: sources.map((entry) => {
      const item = (entry ?? {}) as Record<string, unknown>;
      return {
        connectionId: typeof item.connectionId === "string" ? item.connectionId : "",
        schema: typeof item.schema === "string" ? item.schema : "",
        sourceName: typeof item.sourceName === "string" ? item.sourceName : ""
      };
    })
  };
}

function snapshotRoleIds(rolesJson: unknown): string[] | null {
  let value = rolesJson;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return Object.keys(value as Record<string, unknown>);
}

/**
 * 逐条访问路径判定（§5.3 A3 / §4.9.2）。
 *
 * 关键诚实性约束：
 * - **不得拿边上的一个 hash 代表全部路径**：每条路径按自己贡献的调用逐个判定。
 * - 快照缺失 / 损坏 / 身份不符 → 只保留「需复核」（`unknown`），
 *   **不得**升级为「确凿越权」。
 */
export function evaluateAccessPathSnapshot(input: {
  path: AccessPathAggregate;
  loadSnapshot: (hash: string) => AccessMapPermissionSnapshot | null;
  roleIds?: string[];
}): AccessMapSnapshotEvaluation {
  const { path, loadSnapshot } = input;
  const evidence: AccessMapSnapshotEvidence[] = [];

  for (const call of path.calls) {
    if (!call.permissionSnapshotHash) {
      evidence.push({ callId: call.callId, result: "unknown", reason: "snapshot_missing" });
      continue;
    }
    const snapshot = loadSnapshot(call.permissionSnapshotHash);
    if (!snapshot) {
      evidence.push({ callId: call.callId, result: "unknown", reason: "snapshot_missing" });
      continue;
    }
    const resolved = parseResolvedSnapshot(snapshot.resolvedJson);
    if (!resolved) {
      evidence.push({ callId: call.callId, result: "unknown", reason: "snapshot_invalid" });
      continue;
    }
    // 身份一致性：调用当时的能力摘要必须与快照记录的一致。
    if (
      call.capabilityDigest &&
      snapshot.capabilityDigest &&
      call.capabilityDigest !== snapshot.capabilityDigest
    ) {
      evidence.push({ callId: call.callId, result: "unknown", reason: "snapshot_identity_mismatch" });
      continue;
    }
    // 身份一致性：快照里的角色集合必须覆盖本次调用声明的角色。
    const snapshotRoles = snapshotRoleIds(snapshot.rolesJson);
    if (snapshotRoles && input.roleIds && input.roleIds.length > 0) {
      const covered = input.roleIds.every((roleId) => snapshotRoles.includes(roleId));
      if (!covered) {
        evidence.push({ callId: call.callId, result: "unknown", reason: "snapshot_identity_mismatch" });
        continue;
      }
    }
    const coveredTable = resolved.sources.some(
      (source) =>
        source.connectionId === path.connectionId &&
        source.schema === path.schema &&
        source.sourceName === path.sourceName
    );
    evidence.push({
      callId: call.callId,
      result: coveredTable ? "covered_at_call_time" : "confirmed_unauthorized",
      reason: null
    });
  }

  let result: AccessMapSnapshotResult = "unknown";
  let reason: AccessMapSnapshotReason | null = null;
  if (evidence.some((item) => item.result === "confirmed_unauthorized")) {
    result = "confirmed_unauthorized";
  } else if (evidence.length > 0 && evidence.every((item) => item.result === "covered_at_call_time")) {
    result = "covered_at_call_time";
  } else {
    const firstUnknown = evidence.find((item) => item.result === "unknown");
    reason = firstUnknown?.reason ?? "snapshot_missing";
  }

  return {
    pathKey: path.pathKey,
    agentId: path.agentId,
    roleId: path.roleId,
    connectionId: path.connectionId,
    schema: path.schema,
    sourceName: path.sourceName,
    calls: path.calls.length,
    result,
    reason,
    evidence
  };
}

export function summarizeSnapshotCoverage(
  evaluations: AccessMapSnapshotEvaluation[]
): AccessMapCoverage {
  const reviewPaths = evaluations.length;
  const matched = evaluations.filter((item) => item.result !== "unknown").length;
  const missingOrInvalid = reviewPaths - matched;
  return {
    reviewPaths,
    matched,
    missingOrInvalid,
    ratio: reviewPaths === 0 ? 0 : matched / reviewPaths
  };
}

// ─── §4.3 授权骨架与守恒 ─────────────────────────────────────────────────────

export type GrantLayerResult = {
  nodes: Map<string, InternalNode>;
  edges: Map<string, InternalEdge>;
  /** 全部授权路径引用（用于共享计数口径）。 */
  pathRefs: GrantPathRef[];
  orphanGrants: number;
};

function nodeId(kind: AccessMapNodeKind, key: string): string {
  // Spec §4.7 的节点 id 形态：agent:<userId> / role:<roleId> / conn:<connectionId>
  // / schema:<conn>::<schema> / table:<conn>::<schema>::<table> / token:<userId>::<label>。
  // 注意连接层的前缀是 `conn`，不是节点类型名 `connection`。
  const prefix = kind === "connection" ? "conn" : kind;
  return `${prefix}:${key}`;
}

function upsertNode(
  nodes: Map<string, InternalNode>,
  id: string,
  init: { kind: AccessMapNodeKind; label: string; depth: number; parentId?: string }
): InternalNode {
  const existing = nodes.get(id);
  if (existing) return existing;
  const node: InternalNode = {
    id,
    kind: init.kind,
    label: init.label,
    depth: init.depth,
    parentId: init.parentId,
    meta: {},
    grantPaths: 0,
    grantUsers: new Set(),
    accessPaths: 0,
    accessUsers: new Set()
  };
  nodes.set(id, node);
  return node;
}

function upsertEdge(
  edges: Map<string, InternalEdge>,
  source: string,
  target: string
): InternalEdge {
  const id = `e|${source}|${target}`;
  const existing = edges.get(id);
  if (existing) return existing;
  const edge: InternalEdge = {
    id,
    source,
    target,
    grantPaths: 0,
    grantUsers: new Set(),
    accessPaths: 0,
    accessUsers: new Set(),
    accessCallIds: new Set(),
    state: "normal",
    confirmedUnauthorized: false,
    reviewEvaluations: []
  };
  edges.set(id, edge);
  return edge;
}

/**
 * 构建授权骨架（§5.1）。
 *
 * 每条授权路径在它经过的每一跳上贡献恰好 1 —— 这是流守恒的来源，
 * 也是「边宽 = 授权路径数」得以和访问层直接相减的前提。
 */
export function buildGrantLayer(input: {
  side: AccessMapGrantSide;
  withSchema: boolean;
}): GrantLayerResult {
  const { side, withSchema } = input;
  const nodes = new Map<string, InternalNode>();
  const edges = new Map<string, InternalEdge>();
  const seenPaths = new Set<string>();
  const pathRefs: GrantPathRef[] = [];
  const agentById = new Map(side.agents.map((agent) => [agent.id, agent]));

  for (const contribution of side.contributions) {
    const agent = agentById.get(contribution.agentId);
    if (!agent) continue;
    for (const source of contribution.sources) {
      if (!source.connectionId) continue;
      const pathKey = grantPathKey({
        agentId: contribution.agentId,
        roleId: contribution.roleId,
        connectionId: source.connectionId,
        schema: source.schema,
        sourceName: source.sourceName
      });
      if (seenPaths.has(pathKey)) continue;
      seenPaths.add(pathKey);
      pathRefs.push({
        agentId: contribution.agentId,
        roleId: contribution.roleId,
        connectionId: source.connectionId,
        schema: source.schema,
        sourceName: source.sourceName,
        physicalTable: source.physicalTable
      });

      const agentNodeId = nodeId("agent", contribution.agentId);
      const roleNodeId =
        contribution.roleId === UNRESOLVED_ROLE_ID
          ? unresolvedRoleNodeId()
          : nodeId("role", contribution.roleId);
      const connectionNodeId = nodeId("connection", source.connectionId);
      const schemaNodeId = nodeId("schema", `${source.connectionId}::${source.schema}`);
      const tableNodeId = nodeId(
        "table",
        `${source.connectionId}::${source.schema}::${source.sourceName}`
      );

      upsertNode(nodes, agentNodeId, {
        kind: "agent",
        label: agent.name ?? agent.id,
        depth: 0
      });
      const roleNode = upsertNode(nodes, roleNodeId, {
        kind: "role",
        label: contribution.roleId === UNRESOLVED_ROLE_ID ? "未归因角色" : contribution.roleId,
        depth: 1
      });
      if (contribution.roleId === UNRESOLVED_ROLE_ID) roleNode.meta.unresolved = true;
      const connectionNode = upsertNode(nodes, connectionNodeId, {
        kind: "connection",
        label: source.connectionId,
        depth: 2
      });
      if (!connectionNode.meta.status) {
        connectionNode.meta.status = side.enabledConnections.includes(source.connectionId)
          ? "enabled"
          : "unknown";
      }
      if (withSchema) {
        upsertNode(nodes, schemaNodeId, { kind: "schema", label: source.schema, depth: 3 });
      }
      const tableNode = upsertNode(nodes, tableNodeId, {
        kind: "table",
        label: source.sourceName,
        depth: withSchema ? 4 : 3
      });
      tableNode.meta.physicalTable = source.physicalTable ?? `${source.schema}.${source.sourceName}`;

      const hops: Array<[string, string]> = withSchema
        ? [
            [agentNodeId, roleNodeId],
            [roleNodeId, connectionNodeId],
            [connectionNodeId, schemaNodeId],
            [schemaNodeId, tableNodeId]
          ]
        : [
            [agentNodeId, roleNodeId],
            [roleNodeId, connectionNodeId],
            [connectionNodeId, tableNodeId]
          ];

      for (const [from, to] of hops) {
        const edge = upsertEdge(edges, from, to);
        edge.grantPaths += 1;
        edge.grantUsers.add(contribution.agentId);
      }

      // 节点计数：路径数 + 去重 Agent 数，两者不可互换（§4.2）。
      for (const id of [agentNodeId, roleNodeId, connectionNodeId, tableNodeId]) {
        const node = nodes.get(id);
        if (!node) continue;
        node.grantPaths += 1;
        node.grantUsers.add(contribution.agentId);
      }
      if (withSchema) {
        const schemaNode = nodes.get(schemaNodeId);
        if (schemaNode) {
          schemaNode.grantPaths += 1;
          schemaNode.grantUsers.add(contribution.agentId);
        }
      }
    }
  }

  // Role 元信息（源范围 / 工具数）—— 只影响展示，不参与任何计数。
  for (const [roleId, meta] of Object.entries(side.roleMeta ?? {})) {
    const node = nodes.get(nodeId("role", roleId));
    if (!node) continue;
    if (meta.sourceScope !== undefined) node.meta.sourceScope = meta.sourceScope;
    if (meta.toolCount !== undefined) node.meta.toolCount = meta.toolCount;
  }

  return { nodes, edges, pathRefs, orphanGrants: side.orphanGrants };
}

/**
 * 流守恒自检（§4.3 / §10 SC-02）。
 *
 * Agent 是源点（入流 0、出流 = 路径数），Table 是汇点（入流 = 路径数、出流 0），
 * 中间节点必须入流 == 出流。返回违规描述；空数组即守恒成立。
 */
export function assertFlowConservation(input: {
  nodes: Map<string, InternalNode>;
  edges: Map<string, InternalEdge>;
}): string[] {
  const violations: string[] = [];
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, number>();
  for (const edge of input.edges.values()) {
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + edge.grantPaths);
    outgoing.set(edge.source, (outgoing.get(edge.source) ?? 0) + edge.grantPaths);
  }
  for (const node of input.nodes.values()) {
    if (node.kind === "token") continue;
    const inSum = incoming.get(node.id) ?? 0;
    const outSum = outgoing.get(node.id) ?? 0;
    if (inSum === 0 && outSum === 0) continue;
    if (inSum === 0) {
      // 源点：出流必须等于该节点的路径数。
      if (outSum !== node.grantPaths) {
        violations.push(`${node.id}: 源点出流 ${outSum} != 路径数 ${node.grantPaths}`);
      }
      continue;
    }
    if (outSum === 0) {
      // 汇点：入流必须等于该节点的路径数。
      if (inSum !== node.grantPaths) {
        violations.push(`${node.id}: 汇点入流 ${inSum} != 路径数 ${node.grantPaths}`);
      }
      continue;
    }
    if (inSum !== outSum) {
      violations.push(`${node.id}: 入流 ${inSum} != 出流 ${outSum}`);
    }
  }
  const agentOut = [...input.edges.values()]
    .filter((edge) => edge.source.startsWith("agent:"))
    .reduce((sum, edge) => sum + edge.grantPaths, 0);
  const tableIn = [...input.edges.values()]
    .filter((edge) => edge.target.startsWith("table:"))
    .reduce((sum, edge) => sum + edge.grantPaths, 0);
  if (agentOut !== tableIn) {
    violations.push(`Agent 出流合计 ${agentOut} != Table 入流合计 ${tableIn}`);
  }
  return violations;
}

// ─── §5.3 边聚合与状态判定 ───────────────────────────────────────────────────

export type MergeLayersInput = {
  grant: GrantLayerResult;
  paths: AccessPathAggregate[];
  loadSnapshot: (hash: string) => AccessMapPermissionSnapshot | null;
  /** 必须与授权层同构，否则两侧不可直接相减（§4.1）。 */
  withSchema: boolean;
};

/**
 * 把访问路径投射到与授权侧同构的每一跳，并判定边状态（§4.4）。
 *
 * 状态判定顺序固定：`needs_review` 优先于 `overflow`（§4.4 尾注）。
 */
export function mergeLayers(input: MergeLayersInput): {
  nodes: Map<string, InternalNode>;
  edges: Map<string, InternalEdge>;
} {
  const { grant, paths, loadSnapshot, withSchema } = input;
  const { nodes, edges } = grant;

  const pathByEdge = new Map<string, AccessPathAggregate[]>();

  for (const path of paths) {
    const agentNodeId = nodeId("agent", path.agentId);
    const roleNodeId =
      path.roleId === UNRESOLVED_ROLE_ID ? unresolvedRoleNodeId() : nodeId("role", path.roleId);
    const connectionNodeId = nodeId("connection", path.connectionId);
    const schemaNodeId = nodeId("schema", `${path.connectionId}::${path.schema}`);
    const tableNodeId = nodeId("table", `${path.connectionId}::${path.schema}::${path.sourceName}`);

    upsertNode(nodes, agentNodeId, { kind: "agent", label: path.agentId, depth: 0 });
    const roleNode = upsertNode(nodes, roleNodeId, {
      kind: "role",
      label: path.roleId === UNRESOLVED_ROLE_ID ? "未归因角色" : path.roleId,
      depth: 1
    });
    if (path.roleId === UNRESOLVED_ROLE_ID) roleNode.meta.unresolved = true;
    upsertNode(nodes, connectionNodeId, { kind: "connection", label: path.connectionId, depth: 2 });
    if (withSchema) {
      upsertNode(nodes, schemaNodeId, { kind: "schema", label: path.schema, depth: 3 });
    }
    const tableNode = upsertNode(nodes, tableNodeId, {
      kind: "table",
      label: path.sourceName,
      depth: withSchema ? 4 : 3
    });
    if (!tableNode.meta.physicalTable) {
      tableNode.meta.physicalTable = `${path.schema}.${path.sourceName}`;
    }

    const hops: Array<[string, string]> = withSchema
      ? [
          [agentNodeId, roleNodeId],
          [roleNodeId, connectionNodeId],
          [connectionNodeId, schemaNodeId],
          [schemaNodeId, tableNodeId]
        ]
      : [
          [agentNodeId, roleNodeId],
          [roleNodeId, connectionNodeId],
          [connectionNodeId, tableNodeId]
        ];

    for (const [from, to] of hops) {
      const edge = upsertEdge(edges, from, to);
      edge.accessPaths += 1;
      edge.accessUsers.add(path.agentId);
      for (const call of path.calls) edge.accessCallIds.add(call.callId);
      const bucket = pathByEdge.get(edge.id) ?? [];
      bucket.push(path);
      pathByEdge.set(edge.id, bucket);
    }

    const touched = withSchema
      ? [agentNodeId, roleNodeId, connectionNodeId, schemaNodeId, tableNodeId]
      : [agentNodeId, roleNodeId, connectionNodeId, tableNodeId];
    for (const id of touched) {
      const node = nodes.get(id);
      if (!node) continue;
      node.accessPaths += 1;
      node.accessUsers.add(path.agentId);
    }
  }

  for (const edge of edges.values()) {
    // §4.4 状态判定，顺序固定。
    if (edge.grantPaths === 0 && edge.accessPaths > 0) edge.state = "needs_review";
    else if (edge.accessPaths > edge.grantPaths) edge.state = "overflow";
    else if (edge.accessPaths === 0) edge.state = "dormant";
    else edge.state = "normal";

    // 快照证据只对需复核 / 溢出的边有意义。
    if (edge.state === "needs_review" || edge.state === "overflow") {
      const bucket = pathByEdge.get(edge.id) ?? [];
      edge.reviewEvaluations = bucket.map((path) =>
        evaluateAccessPathSnapshot({ path, loadSnapshot, roleIds: [path.roleId] })
      );
    }
    edge.confirmedUnauthorized = edge.reviewEvaluations.some(
      (item) => item.result === "confirmed_unauthorized"
    );
  }

  return { nodes, edges };
}

// ─── §4.7 凭证清单 ────────────────────────────────────────────────────────────

/**
 * Token 凭证清单（§4.5）。
 *
 * Token **不承载授权**：不进流主干、不参与守恒、不与 Role/Connection 连流带。
 * 它是挂在 Agent 下的虚线附属区，宽度固定不随路径数缩放。
 */
function attachCredentialList(input: {
  nodes: Map<string, InternalNode>;
  agents: AccessMapAgentRecord[];
  tokenCallCounts: Map<string, number>;
  tokenLastUsed: Map<string, string>;
}): void {
  const { nodes, agents, tokenCallCounts, tokenLastUsed } = input;
  for (const agent of agents) {
    const agentNodeId = nodeId("agent", agent.id);
    const agentNode = nodes.get(agentNodeId);
    if (!agentNode) continue;
    agentNode.meta.tokenCount = agent.tokens.length;
    agentNode.meta.roleIds = [...agent.roleIds];
    agentNode.meta.enabled = agent.enabled;
    for (const token of agent.tokens) {
      const tokenNodeId = nodeId("token", `${agent.id}::${token.label}`);
      const tokenNode = upsertNode(nodes, tokenNodeId, {
        kind: "token",
        label: token.label,
        depth: -1,
        parentId: agentNodeId
      });
      tokenNode.meta.label = token.label;
      tokenNode.meta.status = token.status;
      tokenNode.meta.createdAt = token.createdAt ?? null;
      tokenNode.meta.expiresAt = token.expiresAt ?? null;
      tokenNode.meta.lastUsedAt = tokenLastUsed.get(token.label) ?? token.lastUsedAt ?? null;
      tokenNode.meta.callCount = tokenCallCounts.get(token.label) ?? token.callCount ?? 0;
      tokenNode.meta.revokedAt = token.revokedAt ?? null;
    }
  }
}

// ─── §5.4 折叠 ────────────────────────────────────────────────────────────────

export const NODE_BUDGET = 150;
export const EDGE_BUDGET = 400;

export type AccessMapGraph = {
  nodes: InternalNode[];
  edges: InternalEdge[];
};

export type FoldResult = {
  nodes: InternalNode[];
  edges: InternalEdge[];
  folded: { nodes: number; edges: number };
};

function nodeWeight(node: InternalNode): number {
  return node.grantPaths + node.accessPaths;
}

/**
 * 折叠（§5.4）。
 *
 * 折叠**只影响渲染**：被折叠的节点并入同层的「其他（N）」节点，
 * 计数口径一个字都不改；表格等价视图读的是全量图。
 */
export function foldAccessMapGraph(
  graph: AccessMapGraph,
  budgets: { nodeBudget: number; edgeBudget: number } = {
    nodeBudget: NODE_BUDGET,
    edgeBudget: EDGE_BUDGET
  }
): FoldResult {
  const kept = new Map(graph.nodes.map((node) => [node.id, node]));
  const keptEdges = new Map(graph.edges.map((edge) => [edge.id, edge]));

  const countEdges = (): number => {
    let total = 0;
    for (const edge of keptEdges.values()) {
      if (kept.has(edge.source) && kept.has(edge.target)) total += 1;
    }
    return total;
  };

  let foldedNodes = 0;
  let foldedEdges = 0;
  while (kept.size > budgets.nodeBudget || countEdges() > budgets.edgeBudget) {
    // 先删最深的、最轻的节点，保证剩下的主干仍然可读。
    const candidates = [...kept.values()]
      .filter((node) => node.kind !== "token" && node.kind !== "agent")
      .sort(
        (a, b) => b.depth - a.depth || nodeWeight(a) - nodeWeight(b) || b.id.localeCompare(a.id)
      );
    const victim = candidates[0];
    if (!victim) break;
    kept.delete(victim.id);
    foldedNodes += 1;
    for (const [id, edge] of [...keptEdges]) {
      if (edge.source === victim.id || edge.target === victim.id) {
        keptEdges.delete(id);
        foldedEdges += 1;
      }
    }
  }

  if (foldedNodes === 0) {
    return { nodes: graph.nodes, edges: graph.edges, folded: { nodes: 0, edges: 0 } };
  }

  // 把被折叠的节点并入同层的「其他」节点。
  const otherByDepth = new Map<number, InternalNode>();
  const removedIds = new Set(graph.nodes.filter((node) => !kept.has(node.id)).map((node) => node.id));
  const remap = (id: string): string => {
    if (kept.has(id)) return id;
    if (!removedIds.has(id)) return id;
    const victim = graph.nodes.find((item) => item.id === id);
    if (!victim) return id;
    const depth = victim.depth;
    let other = otherByDepth.get(depth);
    if (!other) {
      other = {
        id: `other:${victim.kind === "connection" ? "conn" : victim.kind}:${depth}`,
        kind: victim.kind,
        label: "其他",
        depth,
        meta: {},
        grantPaths: 0,
        grantUsers: new Set(),
        accessPaths: 0,
        accessUsers: new Set()
      };
      otherByDepth.set(depth, other);
    }
    return other.id;
  };

  const mergedEdges = new Map<string, InternalEdge>();
  for (const edge of graph.edges) {
    const source = remap(edge.source);
    const target = remap(edge.target);
    if (source === target) continue;
    const id = `e|${source}|${target}`;
    let merged = mergedEdges.get(id);
    if (!merged) {
      merged = {
        id,
        source,
        target,
        grantPaths: 0,
        grantUsers: new Set(),
        accessPaths: 0,
        accessUsers: new Set(),
        accessCallIds: new Set(),
        state: "normal",
        confirmedUnauthorized: false,
        reviewEvaluations: []
      };
      mergedEdges.set(id, merged);
    }
    merged.grantPaths += edge.grantPaths;
    for (const user of edge.grantUsers) merged.grantUsers.add(user);
    merged.accessPaths += edge.accessPaths;
    for (const user of edge.accessUsers) merged.accessUsers.add(user);
    for (const callId of edge.accessCallIds) merged.accessCallIds.add(callId);
    merged.confirmedUnauthorized = merged.confirmedUnauthorized || edge.confirmedUnauthorized;
    merged.reviewEvaluations = merged.reviewEvaluations.concat(edge.reviewEvaluations);
  }

  for (const edge of mergedEdges.values()) {
    if (edge.grantPaths === 0 && edge.accessPaths > 0) edge.state = "needs_review";
    else if (edge.accessPaths > edge.grantPaths) edge.state = "overflow";
    else if (edge.accessPaths === 0) edge.state = "dormant";
    else edge.state = "normal";
  }

  const mergedNodes = new Map<string, InternalNode>();
  for (const node of graph.nodes) {
    if (kept.has(node.id)) mergedNodes.set(node.id, node);
  }
  for (const [depth, other] of otherByDepth) {
    const members = graph.nodes.filter((node) => removedIds.has(node.id) && node.depth === depth);
    other.label = `其他（${members.length}）`;
    other.grantPaths = members.reduce((sum, node) => sum + node.grantPaths, 0);
    other.accessPaths = members.reduce((sum, node) => sum + node.accessPaths, 0);
    for (const member of members) {
      for (const user of member.grantUsers) other.grantUsers.add(user);
      for (const user of member.accessUsers) other.accessUsers.add(user);
    }
    mergedNodes.set(other.id, other);
  }

  const keptNodeIds = new Set(mergedNodes.keys());
  const finalEdges = [...mergedEdges.values()].filter(
    (edge) => keptNodeIds.has(edge.source) && keptNodeIds.has(edge.target)
  );

  return {
    nodes: [...mergedNodes.values()],
    edges: finalEdges,
    folded: { nodes: foldedNodes, edges: foldedEdges }
  };
}

// ─── 序列化 ──────────────────────────────────────────────────────────────────

function serializeNode(node: InternalNode): AccessMapNode {
  return {
    id: node.id,
    kind: node.kind,
    label: node.label,
    depth: node.depth,
    ...(node.parentId ? { parentId: node.parentId } : {}),
    meta: {
      ...node.meta,
      grantPaths: node.grantPaths,
      grantUsers: node.grantUsers.size,
      accessPaths: node.accessPaths,
      accessUsers: node.accessUsers.size
    }
  };
}

function serializeEdge(edge: InternalEdge): AccessMapEdge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    grantPaths: edge.grantPaths,
    grantUsers: edge.grantUsers.size,
    accessPaths: edge.accessPaths,
    accessUsers: edge.accessUsers.size,
    accessCalls: edge.accessCallIds.size,
    state: edge.state,
    confirmedUnauthorized: edge.confirmedUnauthorized,
    reviewEvaluations: edge.reviewEvaluations,
    snapshotCoverage: summarizeSnapshotCoverage(edge.reviewEvaluations)
  };
}

// ─── 过滤（§6.3） ────────────────────────────────────────────────────────────

function restrictToSubgraph(
  input: { nodes: Map<string, InternalNode>; edges: Map<string, InternalEdge> },
  keep: (node: InternalNode) => boolean
): { nodes: Map<string, InternalNode>; edges: Map<string, InternalEdge> } {
  const nodes = new Map([...input.nodes].filter(([, node]) => keep(node)));
  const edges = new Map(
    [...input.edges].filter(([, edge]) => nodes.has(edge.source) && nodes.has(edge.target))
  );
  return { nodes, edges };
}

function reachableFrom(
  edges: Map<string, InternalEdge>,
  seeds: string[],
  direction: "forward" | "both"
): Set<string> {
  const reached = new Set<string>(seeds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of edges.values()) {
      if (reached.has(edge.source) && !reached.has(edge.target)) {
        reached.add(edge.target);
        changed = true;
      }
      if (direction === "both" && reached.has(edge.target) && !reached.has(edge.source)) {
        reached.add(edge.source);
        changed = true;
      }
    }
  }
  return reached;
}

/**
 * 按 `agent` / `role` / `connection` / `table` 过滤子图。
 *
 * Agent 过滤保留该 Agent 的全链路；Role / Connection / Table 过滤保留该节点的
 * 上下游（它们是「关系」的另一半，只保留下游会丢掉「谁在用」）。
 */
export function applyScopeFilters(input: {
  nodes: Map<string, InternalNode>;
  edges: Map<string, InternalEdge>;
  query: AccessMapQuery;
}): { nodes: Map<string, InternalNode>; edges: Map<string, InternalEdge> } {
  const { query } = input;
  let current: { nodes: Map<string, InternalNode>; edges: Map<string, InternalEdge> } = {
    nodes: input.nodes,
    edges: input.edges
  };

  if (query.agent) {
    const reached = reachableFrom(current.edges, [nodeId("agent", query.agent)], "forward");
    current = restrictToSubgraph(current, (node) => reached.has(node.id));
  }
  if (query.role) {
    const reached = reachableFrom(current.edges, [nodeId("role", query.role)], "both");
    current = restrictToSubgraph(current, (node) => reached.has(node.id));
  }
  if (query.connection) {
    const reached = reachableFrom(current.edges, [nodeId("connection", query.connection)], "both");
    current = restrictToSubgraph(current, (node) => reached.has(node.id));
  }
  if (query.table) {
    const parsed = splitTableParam(query.table);
    if (parsed) {
      const tableId = nodeId(
        "table",
        `${parsed.connectionId}::${parsed.schema}::${parsed.sourceName}`
      );
      const reached = reachableFrom(current.edges, [tableId], "both");
      current = restrictToSubgraph(current, (node) => reached.has(node.id));
    }
  }
  return current;
}

/** 下钻聚焦：只渲染该节点的连通子图（§7.2）。 */
export function focusSubgraph(input: {
  nodes: Map<string, InternalNode>;
  edges: Map<string, InternalEdge>;
  focus: string | null;
}): { nodes: Map<string, InternalNode>; edges: Map<string, InternalEdge> } {
  if (!input.focus) return input;
  // 分享链接里的 focus 可能已经失效（节点被删除 / 筛选变了）。
  // 失效时回到全图，而不是渲染一张空图 —— 空图会被误读成「这个 Agent 没有授权」。
  if (!input.nodes.has(input.focus)) return input;
  const reached = reachableFrom(input.edges, [input.focus], "both");
  return restrictToSubgraph(input, (node) => reached.has(node.id));
}

// ─── 响应 ────────────────────────────────────────────────────────────────────

export type AccessMapMeta = {
  window: { startIso: string; endIso: string; asOf: string };
  grant: {
    state: SnapshotState;
    problem: SnapshotProblem | null;
    accessConfigVersion: string;
    policyVersion: string;
    sourceMapVersion: string;
    capabilityDigest: string;
    failures: Array<{ subjectId: string; reason: string }>;
  };
  access: {
    state: "ok" | "unavailable";
    trust: AccessMapTrust;
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
  /** 共享计数口径的自检提示；非空表示两个数不可互相替代。 */
  countingNotes: string[];
};

export type AccessMapResponse = {
  meta: AccessMapMeta;
  /** 全量图：计数口径的唯一真源，表格等价视图读它。 */
  nodes: AccessMapNode[];
  edges: AccessMapEdge[];
  /** 折叠后的渲染子集：只影响图面，不影响任何计数。 */
  render: {
    nodes: AccessMapNode[];
    edges: AccessMapEdge[];
    folded: { nodes: number; edges: number };
  };
};

/**
 * 组装完整响应。
 *
 * 降级矩阵（§5.5）：
 * - 授权面 unavailable → **不渲染图**（`render.nodes` 为空），返回三态原因。
 * - 授权面 partial → 只画已解析 Agent 的骨架，并披露失败数量。
 * - 访问面 unavailable → 授权骨架照常渲染，访问内核区显示「审计数据不可用」。
 *
 * 降级**不得**用空图或零值图冒充正常结果，所以 `meta.grant.state` 与
 * `meta.access.state` 永远如实发布。
 */
export async function buildAccessMap(
  provider: AccessMapProvider,
  query: AccessMapQuery
): Promise<AccessMapResponse> {
  const window = buildMetricWindow(ACCESS_MAP_WINDOW_HOURS[query.window]);
  const grantSide = await provider.loadGrantSide();

  const identity = grantSide.identity;
  const counts: AccessMapMeta["counts"] = {
    agents: 0,
    roles: 0,
    connections: 0,
    schemas: 0,
    tables: 0,
    tokens: 0,
    edges: 0,
    grantPaths: 0,
    grantUsers: 0,
    accessPaths: 0,
    accessUsers: 0
  };
  const signals: AccessMapMeta["signals"] = {
    dormantEdges: 0,
    needsReviewEdges: 0,
    confirmedUnauthorizedEdges: 0
  };
  let coverage: AccessMapCoverage = { reviewPaths: 0, matched: 0, missingOrInvalid: 0, ratio: 0 };
  let nodes: AccessMapNode[] = [];
  let edges: AccessMapEdge[] = [];
  let renderNodes: AccessMapNode[] = [];
  let renderEdges: AccessMapEdge[] = [];
  let folded = { nodes: 0, edges: 0 };
  let countingNotes: string[] = [];
  let accessState: "ok" | "unavailable" = "unavailable";
  let accessReason = "授权面不可用，未评估访问层";
  let deniedCalls = 0;
  let rawCalls = 0;

  if (grantSide.state !== "unavailable") {
    const grant = buildGrantLayer({ side: grantSide, withSchema: query.layer === "schema" });

    // 守恒自检是实现门禁：不通过就是构图缺陷，必须暴露而不是静默降级（§5.1 G7）。
    const violations = assertFlowConservation(grant);
    if (violations.length > 0) {
      throw new Error(`access_map_flow_conservation_violated:${violations.join(";")}`);
    }

    const access = await provider.loadAccessSide({
      window,
      trust: query.trust,
      tokenLabel: query.token
    });

    let internalNodes = grant.nodes;
    let internalEdges = grant.edges;
    let accessPathRefs: AccessPathRef[] = [];

    if (access.state === "ok") {
      accessState = "ok";
      accessReason = "";
      const layer = buildAccessLayer({ rows: access.rows, tokenLabel: query.token });
      deniedCalls = layer.deniedCalls;
      rawCalls = layer.rawCalls;
      accessPathRefs = layer.paths.map((path) => ({
        agentId: path.agentId,
        roleId: path.roleId,
        connectionId: path.connectionId,
        schema: path.schema,
        sourceName: path.sourceName
      }));
      const merged = mergeLayers({
        grant,
        paths: layer.paths,
        loadSnapshot: access.loadSnapshot,
        withSchema: query.layer === "schema"
      });
      internalNodes = merged.nodes;
      internalEdges = merged.edges;
    }

    attachCredentialList({
      nodes: internalNodes,
      agents: grantSide.agents,
      tokenCallCounts: access.state === "ok" ? access.tokenCallCounts : new Map(),
      tokenLastUsed: access.state === "ok" ? access.tokenLastUsed : new Map()
    });

    const scoped = applyScopeFilters({ nodes: internalNodes, edges: internalEdges, query });
    const focused = focusSubgraph({ nodes: scoped.nodes, edges: scoped.edges, focus: query.focus });

    nodes = [...focused.nodes.values()].map(serializeNode);
    edges = [...focused.edges.values()].map(serializeEdge);

    const foldedGraph = foldAccessMapGraph({
      nodes: [...focused.nodes.values()],
      edges: [...focused.edges.values()]
    });
    folded = foldedGraph.folded;
    renderNodes = foldedGraph.nodes.map(serializeNode);
    renderEdges = foldedGraph.edges.map(serializeEdge);

    counts.agents = nodes.filter((node) => node.kind === "agent").length;
    counts.roles = nodes.filter((node) => node.kind === "role").length;
    counts.connections = nodes.filter((node) => node.kind === "connection").length;
    counts.schemas = nodes.filter((node) => node.kind === "schema").length;
    counts.tokens = nodes.filter((node) => node.kind === "token").length;
    counts.edges = edges.length;

    signals.dormantEdges = edges.filter((edge) => edge.state === "dormant").length;
    signals.needsReviewEdges = edges.filter((edge) => edge.state === "needs_review").length;
    signals.confirmedUnauthorizedEdges = edges.filter((edge) => edge.confirmedUnauthorized).length;

    const allEvaluations = edges.flatMap((edge) => edge.reviewEvaluations);
    const distinct = new Map<string, AccessMapSnapshotEvaluation>();
    for (const evaluation of allEvaluations) distinct.set(evaluation.pathKey, evaluation);
    coverage = summarizeSnapshotCoverage([...distinct.values()]);

    // 计数口径统一走共享词汇（`counting.ts`），不另写一套。
    const keptNodeIds = new Set(focused.nodes.keys());
    const keptGrantRefs = grant.pathRefs.filter((ref) =>
      keptNodeIds.has(nodeId("agent", ref.agentId)) &&
      keptNodeIds.has(nodeId("role", ref.roleId)) &&
      keptNodeIds.has(nodeId("connection", ref.connectionId))
    );
    const keptAccessRefs = accessPathRefs.filter((ref) =>
      keptNodeIds.has(nodeId("agent", ref.agentId)) &&
      keptNodeIds.has(nodeId("role", ref.roleId)) &&
      keptNodeIds.has(nodeId("connection", ref.connectionId))
    );
    const tableRefs: CanonicalSourceRef[] = nodes
      .filter((node) => node.kind === "table")
      .map((node) => ({
        connectionId: node.id.split("::")[0]?.replace(/^table:/, "") ?? "",
        schema: node.id.split("::")[1] ?? "",
        sourceName: node.id.split("::")[2] ?? "",
        physicalTable: node.meta.physicalTable
      }));

    counts.tables = countTables(tableRefs);
    counts.grantPaths = countGrantPaths(keptGrantRefs);
    counts.grantUsers = countDistinctAgents(keptGrantRefs);
    counts.accessPaths = countAccessPaths(keptAccessRefs);
    counts.accessUsers = countDistinctAgents(keptAccessRefs);
    countingNotes = assertCountingInvariant({
      tables: new Set(tableRefs.map((ref) => `${ref.connectionId}|${ref.schema}|${ref.sourceName}`)),
      grantPaths: counts.grantPaths,
      accessPaths: counts.accessPaths
    });
  }

  return {
    meta: {
      window: { startIso: window.startIso, endIso: window.endIso, asOf: window.asOf },
      grant: {
        state: grantSide.state,
        problem: grantSide.problem,
        accessConfigVersion: identity.configVersion,
        policyVersion: identity.policyVersion,
        sourceMapVersion: identity.sourceMapVersion,
        capabilityDigest: identity.capabilityDigest,
        failures: grantSide.failures
      },
      access: {
        state: accessState,
        trust: query.trust,
        deniedCalls,
        rawCalls,
        ...(accessReason ? { reason: accessReason } : {})
      },
      counts,
      signals,
      snapshotCoverage: coverage,
      orphanGrants: grantSide.orphanGrants,
      folded,
      countingNotes
    },
    nodes,
    edges,
    render: { nodes: renderNodes, edges: renderEdges, folded }
  };
}

// ─── 真实 provider ───────────────────────────────────────────────────────────

export type AdminAccessMapProviderOptions = {
  projectRoot?: string;
  /** 注入用：单 Role 编译入口（测试替换它以证明 per-role 归因）。 */
  compileRole?: (roleId: string, context: AdminPermissionContext) => Promise<PerRoleCompilation>;
  /** 注入用：审计库访问。 */
  openAuditDb?: () => Promise<unknown>;
};

type AuditDatabaseLike = {
  prepare: (sql: string) => {
    all: (...params: unknown[]) => unknown[];
    get: (...params: unknown[]) => unknown;
  };
};

function isAuditDatabaseLike(value: unknown): value is AuditDatabaseLike {
  return Boolean(value) && typeof (value as AuditDatabaseLike).prepare === "function";
}

function parseAuditRows(raw: unknown): AccessMapAuditRow[] {
  if (!Array.isArray(raw)) return [];
  const rows: AccessMapAuditRow[] = [];
  for (const item of raw) {
    const row = (item ?? {}) as Record<string, unknown>;
    rows.push({
      callId: String(row.call_id ?? row.id ?? ""),
      userId: String(row.user_id ?? ""),
      matchedRoleId:
        typeof row.matched_role_id === "string" && row.matched_role_id.trim()
          ? row.matched_role_id.trim()
          : null,
      roleIds: parseRoleIdsJson(typeof row.role_ids === "string" ? row.role_ids : null),
      tokenLabel: typeof row.token_label === "string" ? row.token_label : null,
      outcome: String(row.outcome ?? ""),
      ts: String(row.ts ?? ""),
      permissionSnapshotHash:
        typeof row.permission_snapshot_hash === "string" && row.permission_snapshot_hash.trim()
          ? row.permission_snapshot_hash.trim()
          : null,
      capabilityDigest:
        typeof row.capability_digest === "string" && row.capability_digest.trim()
          ? row.capability_digest.trim()
          : null,
      connectionId: String(row.connection_id ?? ""),
      schemaName: String(row.schema_name ?? ""),
      sourceName: String(row.source_name ?? "")
    });
  }
  return rows;
}

/**
 * 与 `acl.ts` 的 `normalizeRef` 同规则（去引号 + 小写）。
 *
 * 这里只用于**配置漂移诊断**（声明的表是否在 `enabled_tables` 里），
 * 不参与任何授权判定；授权判定仍然只有 `acl.ts` 一处。
 */
function normalizeRefLike(value: string): string {
  return value.trim().replace(/[`"']/g, "").toLowerCase();
}

/**
 * 统计「已授权但连接未启用该表」的表数（§4.8）。
 *
 * 编译结果本身已经把未启用的表过滤掉了，所以孤儿授权只能从**声明**与
 * **enabled_tables** 的差集里数——这是配置漂移诊断，不是第二次授权判定。
 */
export function countOrphanGrants(input: {
  roleIds: string[];
  roles: Record<string, { allow?: { source_scope?: string; tableSelectors?: Array<{ connection?: string; schema: string; names?: string[] }> } }>;
  sourceMapEntries: Array<{ connectionId: string; schema: string; sourceName: string; physicalTable: string }>;
  enabledTables: Map<string, Set<string>>;
}): number {
  const orphans = new Set<string>();
  for (const roleId of input.roleIds) {
    const role = input.roles[roleId];
    if (!role?.allow) continue;
    // catalog_bound 的范围就是「这些连接上已启用的表」，不存在未启用的孤儿。
    if (role.allow.source_scope === "catalog_bound") continue;
    for (const selector of role.allow.tableSelectors ?? []) {
      for (const name of selector.names ?? []) {
        const candidates = input.sourceMapEntries.filter(
          (entry) =>
            normalizeRefLike(entry.schema) === normalizeRefLike(selector.schema ?? "") &&
            normalizeRefLike(entry.sourceName) === normalizeRefLike(name) &&
            (!selector.connection ||
              normalizeRefLike(entry.connectionId) === normalizeRefLike(selector.connection))
        );
        for (const entry of candidates) {
          const enabled = input.enabledTables.get(entry.connectionId);
          if (enabled?.has(normalizeRefLike(entry.physicalTable))) continue;
          orphans.add(`${roleId}|${entry.connectionId}|${entry.schema}|${entry.sourceName}`);
        }
      }
    }
  }
  return orphans.size;
}

/**
 * 组装真实 provider：授权面走 `access.yaml` 快照 + per-role 编译，
 * 访问面走审计库。
 *
 * 授权面的 per-Role 归因**只**来自 `compileRoleForAdmin` —— 合并后的
 * `EffectivePermissions.sources` 绝不参与角色归因（§4.3）。
 */
export function createAdminAccessMapProvider(
  options: AdminAccessMapProviderOptions = {}
): AccessMapProvider {
  const compileRole = options.compileRole ?? compileRoleForAdmin;

  return {
    async loadGrantSide(): Promise<AccessMapGrantSide> {
      const projectRoot = options.projectRoot ?? (await resolveProjectRoot());
      const snapshot = await readAccessSnapshot(projectRoot);
      const enabledUserIds = enabledUserIdsFromRaw(snapshot);

      if (!snapshot.runtimeConfig) {
        const snapshotContext = snapshotContextOf({ snapshot });
        return {
          state: "unavailable",
          problem: snapshot.problem ?? "access_unreadable",
          failures: [],
          identity: snapshotContext.identity,
          agents: [],
          contributions: [],
          orphanGrants: 0,
          enabledConnections: []
        };
      }

      const context = await buildAdminPermissionContext(snapshot.runtimeConfig);
      const snapshotContext = snapshotContextOf({
        snapshot,
        generation: currentPolicyGeneration()
      });

      const resolved = await resolveEffectivePermissionsBatchForAdmin(enabledUserIds, context);
      const failures: Array<{ subjectId: string; reason: string }> = [];
      const contributions: AccessMapRoleContribution[] = [];
      const compiledRoles = new Map<string, PerRoleCompilation>();
      const allCapabilities: EffectiveCapability[] = [];
      const failedAgents = new Set<string>();
      const roleMeta: Record<string, { sourceScope?: string; toolCount?: number }> = {};

      for (const userId of enabledUserIds) {
        const result = resolved.get(userId);
        if (!result || !result.ok) {
          failedAgents.add(userId);
          failures.push({
            subjectId: userId,
            reason: result && !result.ok ? result.reason : "role_resolution_failed"
          });
          continue;
        }
        for (const roleId of result.permissions.roleIds) {
          let compiled = compiledRoles.get(roleId);
          if (!compiled) {
            compiled = await compileRole(roleId, context);
            compiledRoles.set(roleId, compiled);
            if (compiled.ok) {
              allCapabilities.push(...(compiled.capabilities ?? []));
              const declared = snapshot.runtimeConfig.roles?.[roleId];
              roleMeta[roleId] = {
                sourceScope: declared?.allow?.source_scope ?? "table_selectors",
                toolCount: (compiled.dataPlaneTools ?? []).length
              };
            }
          }
          if (!compiled.ok) {
            // 单个 Role 失败不阻断该 Agent 的其它 Role，但该 Agent 的授权不完整。
            failedAgents.add(userId);
            failures.push({
              subjectId: userId,
              reason: compiled.reason ?? `role_resolution_failed:${roleId}`
            });
            continue;
          }
          contributions.push({
            agentId: userId,
            roleId,
            sources: (compiled.sources ?? []).map((source) => ({
              connectionId: source.connectionId,
              schema: source.schema,
              sourceName: source.sourceName,
              physicalTable: source.table
            }))
          });
        }
      }

      const agents = (snapshot.runtimeConfig.users ?? [])
        .filter((user) => user && typeof user.id === "string")
        .map((user) => ({
          id: user.id,
          name: typeof user.name === "string" ? user.name : undefined,
          enabled: user.enabled !== false,
          roleIds: resolveRoleIdsOfUser(user),
          tokens: (user.tokens ?? []).map((token) => ({
            label: token.label,
            status: isTokenExpired(token.expires_at) ? ("expired" as const) : ("active" as const),
            createdAt: token.created ?? null,
            expiresAt: token.expires_at ? String(token.expires_at) : null,
            lastUsedAt: null,
            callCount: 0
          }))
        }));

      const roleIds = [...compiledRoles.keys()];
      const sourceMapEntries = [...context.sourceMap.forward.values()].map((entry) => ({
        connectionId: entry.connectionId,
        schema: entry.schema,
        sourceName: entry.sourceName,
        physicalTable: entry.physicalTable
      }));
      const orphanGrants = countOrphanGrants({
        roleIds,
        roles: (snapshot.runtimeConfig.roles ?? {}) as AccessMapProviderRoles,
        sourceMapEntries,
        enabledTables: context.enabledTables
      });

      return {
        state:
          failures.length === 0
            ? "ok"
            : failedAgents.size >= enabledUserIds.length && enabledUserIds.length > 0
              ? "unavailable"
              : "partial",
        problem: null,
        failures,
        identity: {
          ...snapshotContext.identity,
          capabilityDigest: capabilityDigest(allCapabilities)
        },
        agents,
        contributions,
        orphanGrants,
        enabledConnections: [...context.enabledTables.keys()],
        roleMeta
      };
    },

    async loadAccessSide(input): Promise<AccessMapAccessSide> {
      let db: AuditDatabaseLike | null = null;
      try {
        const opened = options.openAuditDb ? await options.openAuditDb() : await getAuditDb();
        if (!isAuditDatabaseLike(opened)) {
          return { state: "unavailable", reason: "审计数据不可用" };
        }
        db = opened;
      } catch {
        return { state: "unavailable", reason: "审计数据不可用" };
      }

      try {
        // 时间条件必须用 metric-window 的半开区间，禁止内联 datetime('now','-7 days')
        // （Spec 128 HR-5）。
        const rows = db
          .prepare(
            `SELECT al.id AS call_id, al.user_id, al.matched_role_id, al.role_ids,
                    al.token_label, al.outcome, al.ts, al.permission_snapshot_hash,
                    al.capability_digest,
                    als.connection_id, als.schema_name, als.source_name
             FROM access_log al
             JOIN access_log_sources als ON als.access_log_id = al.id
             WHERE al.ts >= ? AND al.ts < ?
               AND (? = 'include_candidate' OR al.association_status = 'confirmed')
               AND (? IS NULL OR al.token_label = ?)`
          )
          .all(
            input.window.startIso,
            input.window.endIso,
            input.trust,
            input.tokenLabel,
            input.tokenLabel
          );

        // 凭证清单的调用数与 token 过滤无关（凭证清单是固定参照物）。
        // Spec 189 §6 — the credential inventory's window call count uses the
        // Default Usage layer. The authorization surface, the access-log
        // source rows, the call-id de-duplication and the conservation
        // algorithm are untouched.
        const tokenRows = db
          .prepare(
            `SELECT token_label, COUNT(DISTINCT id) AS calls, MAX(ts) AS last_used
             FROM access_log
             WHERE ts >= ? AND ts < ?
               AND (? = 'include_candidate' OR association_status = 'confirmed')
               AND token_label IS NOT NULL
               AND ${DEFAULT_USAGE_CONDITION}
             GROUP BY token_label`
          )
          .all(input.window.startIso, input.window.endIso, input.trust);

        const tokenCallCounts = new Map<string, number>();
        const tokenLastUsed = new Map<string, string>();
        for (const item of tokenRows as Array<Record<string, unknown>>) {
          const label = typeof item.token_label === "string" ? item.token_label : "";
          if (!label) continue;
          tokenCallCounts.set(label, Number(item.calls ?? 0));
          if (typeof item.last_used === "string") tokenLastUsed.set(label, item.last_used);
        }

        const snapshotCache = new Map<string, AccessMapPermissionSnapshot | null>();
        const loadSnapshot = (hash: string): AccessMapPermissionSnapshot | null => {
          if (snapshotCache.has(hash)) return snapshotCache.get(hash) ?? null;
          const row = db
            ?.prepare(
              `SELECT hash, roles_json, resolved_json, capability_digest
               FROM permission_snapshots WHERE hash = ?`
            )
            .get(hash) as Record<string, unknown> | undefined;
          const snapshot: AccessMapPermissionSnapshot | null = row
            ? {
                hash: String(row.hash ?? hash),
                rolesJson: row.roles_json ?? null,
                resolvedJson: row.resolved_json ?? null,
                capabilityDigest:
                  typeof row.capability_digest === "string" ? row.capability_digest : null
              }
            : null;
          snapshotCache.set(hash, snapshot);
          return snapshot;
        };

        return {
          state: "ok",
          rows: parseAuditRows(rows),
          tokenCallCounts,
          tokenLastUsed,
          loadSnapshot
        };
      } catch {
        return { state: "unavailable", reason: "审计数据不可用" };
      }
    }
  };
}

type AccessMapProviderRoles = Record<
  string,
  {
    allow?: {
      source_scope?: string;
      tableSelectors?: Array<{ connection?: string; schema: string; names?: string[] }>;
    };
  }
>;

/**
 * 用户声明的角色集合。
 *
 * 复用 `resolveRoleIds`（`proxy/acl.ts`）的同一套规则，不另写一份角色归属逻辑。
 */
function resolveRoleIdsOfUser(user: { role?: string; roles?: string[] }): string[] {
  const single = typeof user.role === "string" && user.role.trim() ? user.role.trim() : undefined;
  const list = Array.isArray(user.roles)
    ? user.roles
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : undefined;
  if (list && list.length > 0) return [...new Set(list)];
  return single ? [single] : [];
}
