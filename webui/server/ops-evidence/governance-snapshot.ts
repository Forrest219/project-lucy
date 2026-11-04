/**
 * Spec 20261101 D25–D26 — 治理投影快照框架（W1 + W2）。
 *
 * - query_key = 稳定哈希(窗／trust／filtersDigest／配置代际…)
 * - materialization_id = 每次重建新 UUID
 * - pointer[query_key] 原子切换；失败不发布半份（SC-18）
 * - 读者查询开始绑定 materialization_id；TTL 60s；配置变更使 pointer 失效
 *
 * W1：ops_agents／ops_tokens／ops_agent_activity／ops_question_kpi_agents
 * W2：paths／edges／nodes／meta／table_adoption — 复用 buildAccessMap（禁止第二套路径算法）。
 */

import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import type Database from "better-sqlite3";
import {
  buildAccessMap,
  createAdminAccessMapProvider,
  type AccessMapProvider,
  type AccessMapQuery,
  type AccessMapResponse,
  type AccessMapAuditRow
} from "../admin/access-map.js";
import {
  accessPathKey,
  grantPathKey,
  tableCountKey,
  type GrantPathRef
} from "../admin/counting.js";
import {
  calendarDayKey,
  countIntersectingCalendarDays,
  GOVERNANCE_CALENDAR_TZ,
  type MetricWindow
} from "../admin/metric-window.js";
import { ACCESS_YAML_REL } from "../admin/access-config.js";
import {
  accessGradeSql,
  defaultUsageConditionSql,
  isEvalProbeCall,
  protocolConditionSql
} from "../proxy/usage-classification.js";
import {
  OPS_EVIDENCE_GOVERNANCE_SOURCE_NAMES,
  OPS_EVIDENCE_GOVERNANCE_UNREADY
} from "./contract.js";
import type { GovFocus, GovTrust } from "./gov-filters.js";

export const GOVERNANCE_SNAPSHOT_TTL_MS = 60_000;

export type GovernanceQ4Tier =
  | "window_no_record"
  | "window_connect_only"
  | "window_soft_usage"
  | "window_query_without_ask"
  | "window_question_active";

export const GOVERNANCE_Q4_TIER_LABELS: Record<GovernanceQ4Tier, string> = {
  window_no_record: "窗口无记录",
  window_connect_only: "窗口仅连接",
  window_soft_usage: "窗口轻量业务未问",
  window_query_without_ask: "窗口查数未问",
  window_question_active: "窗口问询活跃"
};

export interface GovernanceSnapshotVersions {
  accessConfigVersion: string;
  policyVersion: string;
  sourceMapVersion: string;
  capabilityDigest: string;
}

export interface GovernanceQueryKeyInput {
  startIso: string;
  endIso: string;
  trust: GovTrust;
  filtersDigest: string;
  versions: GovernanceSnapshotVersions;
}

export interface GovernancePointerEntry {
  materializationId: string;
  queryKey: string;
  createdAtMs: number;
  versions: GovernanceSnapshotVersions;
}

export interface GovernanceBindResult {
  queryKey: string;
  materializationId: string;
  reused: boolean;
}

export interface GovernanceRebuildInput {
  window: MetricWindow;
  trust: GovTrust;
  focus: GovFocus;
  filtersDigest: string;
  versions: GovernanceSnapshotVersions;
  projectRoot: string;
  /** Injectable clock. */
  nowMs?: number;
  /** 测试注入：跳过真实 access.yaml／Role 编译。 */
  accessMapProvider?: AccessMapProvider;
  /**
   * 测试注入：表采用日触达行（默认从 provider.loadAccessSide 推导）。
   * deny／评测探针不计（D19／SC-12）。
   */
  adoptionAccessRows?: AccessMapAuditRow[];
}

interface AccessUserRow {
  id: string;
  name?: string;
  enabled?: boolean;
  role?: string;
  tokens?: Array<{ label?: string; expires_at?: string | null }>;
}

/** 自身追问排除（与 audit.ts opsEvidenceSelfExclusionSql 同口径）。 */
function selfExclusionSql(alias: string): string {
  return `NOT EXISTS (
    SELECT 1 FROM access_log_sources AS self
    WHERE self.access_log_id = ${alias}.id
      AND (
        self.connection_id = 'lucy-ops'
        OR (
          COALESCE(self.connection_id, '') = ''
          AND self.physical_table IN ('main.ops_calls','main.ops_call_tables','ops_calls','ops_call_tables',
            'ops_agents','ops_tokens','ops_agent_activity','ops_question_kpi_agents',
            'ops_grant_paths','ops_access_paths','ops_edge_signals','ops_map_nodes','ops_map_meta','ops_table_adoption',
            'main.ops_agents','main.ops_tokens','main.ops_agent_activity','main.ops_question_kpi_agents',
            'main.ops_grant_paths','main.ops_access_paths','main.ops_edge_signals','main.ops_map_nodes','main.ops_map_meta','main.ops_table_adoption')
        )
      )
  )`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(",")}}`;
}

export function digestGovFiltersForKey(input: {
  trust: GovTrust;
  focus: GovFocus;
  rowFilters?: unknown;
}): string {
  return createHash("sha256")
    .update(
      stableStringify({
        trust: input.trust,
        focus: {
          agent: input.focus.agent ?? null,
          role: input.focus.role ?? null,
          table: input.focus.table ?? null,
          tokenLabel: input.focus.tokenLabel ?? null
        },
        rowFilters: input.rowFilters ?? null
      })
    )
    .digest("hex")
    .slice(0, 32);
}

export function computeGovernanceQueryKey(input: GovernanceQueryKeyInput): string {
  return createHash("sha256")
    .update(
      [
        input.startIso,
        input.endIso,
        input.trust,
        input.filtersDigest,
        input.versions.accessConfigVersion,
        input.versions.policyVersion,
        input.versions.sourceMapVersion,
        input.versions.capabilityDigest
      ].join("|")
    )
    .digest("hex");
}

/** Q4 MECE deepest-wins（⑤→④→③→②→①）。 */
export function classifyGovernanceQ4Tier(input: {
  protocolCount: number;
  defaultUsageCount: number;
  queryCount: number;
  realQuestionCount: number;
}): GovernanceQ4Tier {
  if (input.realQuestionCount > 0) return "window_question_active";
  if (input.queryCount > 0) return "window_query_without_ask";
  if (input.defaultUsageCount > 0) return "window_soft_usage";
  if (input.protocolCount > 0) return "window_connect_only";
  return "window_no_record";
}

function isTokenExpired(expiresAt: string | null | undefined, nowMs: number): boolean {
  if (expiresAt === undefined || expiresAt === null || expiresAt === "") return false;
  const ms = Date.parse(expiresAt);
  if (!Number.isFinite(ms)) return false;
  return ms <= nowMs;
}

function availableTokenCount(
  user: AccessUserRow,
  nowMs: number
): number {
  if (user.enabled === false) return 0;
  const tokens = Array.isArray(user.tokens) ? user.tokens : [];
  return tokens.filter((token) => !isTokenExpired(token.expires_at, nowMs)).length;
}

async function readAccessYamlText(projectRoot: string): Promise<string> {
  try {
    return await readFile(path.join(projectRoot, ACCESS_YAML_REL), "utf8");
  } catch {
    return "";
  }
}

async function readConfiguredAgents(projectRoot: string): Promise<AccessUserRow[]> {
  const raw = await readAccessYamlText(projectRoot);
  if (raw === "") return [];
  let parsed: unknown;
  try {
    parsed = parse(raw);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];
  const users = (parsed as { users?: unknown }).users;
  if (!Array.isArray(users)) return [];
  return users.filter(
    (user): user is AccessUserRow =>
      Boolean(user) &&
      typeof user === "object" &&
      typeof (user as AccessUserRow).id === "string" &&
      (user as AccessUserRow).id.trim().length > 0
  );
}

// ─── In-memory pointer map ───────────────────────────────────────────────────

const pointerByQueryKey = new Map<string, GovernancePointerEntry>();
const readerBindings = new Map<string, { materializationId: string; boundAtMs: number }>();

/** 测试／配置变更：清空全部 pointer（立即失效）。 */
export function invalidateGovernanceSnapshotPointers(): void {
  pointerByQueryKey.clear();
}

/** 测试重置。 */
export function resetGovernanceSnapshotStateForTests(): void {
  pointerByQueryKey.clear();
  readerBindings.clear();
}

function versionsMatch(a: GovernanceSnapshotVersions, b: GovernanceSnapshotVersions): boolean {
  return (
    a.accessConfigVersion === b.accessConfigVersion &&
    a.policyVersion === b.policyVersion &&
    a.sourceMapVersion === b.sourceMapVersion &&
    a.capabilityDigest === b.capabilityDigest
  );
}

function pointerFresh(entry: GovernancePointerEntry, nowMs: number, versions: GovernanceSnapshotVersions): boolean {
  if (nowMs - entry.createdAtMs > GOVERNANCE_SNAPSHOT_TTL_MS) return false;
  return versionsMatch(entry.versions, versions);
}

/**
 * 确保 W1／W2 物化表存在（幂等）。旧视图不动。
 */
export function ensureGovernanceSnapshotTables(database: Database.Database): void {
  database.exec(`
CREATE TABLE IF NOT EXISTS ops_agents (
  snapshot_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  agent_name TEXT,
  enabled INTEGER NOT NULL,
  role_id TEXT,
  configured_token_count INTEGER NOT NULL,
  available_token_count INTEGER NOT NULL,
  PRIMARY KEY (snapshot_id, agent_id)
);
CREATE TABLE IF NOT EXISTS ops_tokens (
  snapshot_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  token_label TEXT NOT NULL,
  call_count INTEGER NOT NULL,
  last_used TEXT,
  PRIMARY KEY (snapshot_id, agent_id, token_label)
);
CREATE TABLE IF NOT EXISTS ops_agent_activity (
  snapshot_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  call_day TEXT NOT NULL,
  call_count INTEGER NOT NULL,
  PRIMARY KEY (snapshot_id, agent_id, call_day)
);
CREATE TABLE IF NOT EXISTS ops_question_kpi_agents (
  snapshot_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  tier TEXT NOT NULL,
  tier_label TEXT NOT NULL,
  protocol_count INTEGER NOT NULL,
  default_usage_count INTEGER NOT NULL,
  query_count INTEGER NOT NULL,
  real_question_count INTEGER NOT NULL,
  PRIMARY KEY (snapshot_id, agent_id)
);
CREATE TABLE IF NOT EXISTS ops_grant_paths (
  snapshot_id TEXT NOT NULL,
  path_key TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  schema_name TEXT NOT NULL,
  source_name TEXT NOT NULL,
  physical_table TEXT,
  PRIMARY KEY (snapshot_id, path_key)
);
CREATE TABLE IF NOT EXISTS ops_access_paths (
  snapshot_id TEXT NOT NULL,
  path_key TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  schema_name TEXT NOT NULL,
  source_name TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, path_key)
);
CREATE TABLE IF NOT EXISTS ops_edge_signals (
  snapshot_id TEXT NOT NULL,
  edge_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  state TEXT NOT NULL,
  confirmed_unauthorized INTEGER NOT NULL,
  grant_paths INTEGER NOT NULL,
  access_paths INTEGER NOT NULL,
  access_calls INTEGER NOT NULL,
  PRIMARY KEY (snapshot_id, edge_id)
);
CREATE TABLE IF NOT EXISTS ops_map_nodes (
  snapshot_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  label TEXT,
  depth INTEGER NOT NULL,
  grant_paths INTEGER NOT NULL,
  access_paths INTEGER NOT NULL,
  PRIMARY KEY (snapshot_id, node_id)
);
CREATE TABLE IF NOT EXISTS ops_map_meta (
  snapshot_id TEXT NOT NULL PRIMARY KEY,
  grant_paths INTEGER NOT NULL,
  access_paths INTEGER NOT NULL,
  raw_calls INTEGER NOT NULL,
  denied_calls INTEGER NOT NULL,
  coverage_review_paths INTEGER NOT NULL,
  coverage_matched INTEGER NOT NULL,
  coverage_missing_or_invalid INTEGER NOT NULL,
  coverage_ratio REAL NOT NULL,
  orphan_grants INTEGER NOT NULL,
  access_config_version TEXT,
  policy_version TEXT,
  source_map_version TEXT,
  capability_digest TEXT,
  grant_state TEXT,
  access_state TEXT,
  trust TEXT
);
CREATE TABLE IF NOT EXISTS ops_table_adoption (
  snapshot_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  schema_name TEXT NOT NULL,
  source_name TEXT NOT NULL,
  physical_table TEXT,
  window_unvisited INTEGER NOT NULL,
  active_days INTEGER NOT NULL,
  denom_days INTEGER NOT NULL,
  activity_rate REAL,
  days_online_in_window INTEGER NOT NULL,
  PRIMARY KEY (snapshot_id, connection_id, schema_name, source_name)
);
`);
}

function discardMaterialization(database: Database.Database, mid: string): void {
  for (const table of OPS_EVIDENCE_GOVERNANCE_SOURCE_NAMES) {
    database.prepare(`DELETE FROM ${table} WHERE snapshot_id = ?`).run(mid);
  }
}

function toAccessMapQuery(input: {
  trust: GovTrust;
  focus: GovFocus;
}): AccessMapQuery {
  return {
    agent: input.focus.agent ?? null,
    role: input.focus.role ?? null,
    // SC-08f／SC-23：token focus 只进访问层；不得改授权路径。
    token: input.focus.tokenLabel ?? null,
    table: input.focus.table ?? null,
    connection: null,
    window: "168h",
    layer: "flat",
    trust: input.trust,
    // 治理快照沿用访问关系图缺省问询种类／访问等级。
    inquiryKind: "management",
    accessGrade: "exclude_connect",
    view: "map",
    focus: null
  };
}

export type TableAdoptionRow = {
  connectionId: string;
  schema: string;
  sourceName: string;
  physicalTable: string | null;
  windowUnvisited: boolean;
  activeDays: number;
  denomDays: number;
  activityRate: number | null;
  daysOnlineInWindow: number;
};

/**
 * Q5／Q6：授权面表人口 + 窗内 access（deny／评测探针不计）反连接与活跃率。
 */
export function computeTableAdoption(input: {
  grantRefs: GrantPathRef[];
  accessRows: AccessMapAuditRow[];
  window: MetricWindow;
  tokenLabel?: string | null;
}): TableAdoptionRow[] {
  const denomDays = countIntersectingCalendarDays(
    input.window.startIso,
    input.window.endIso,
    GOVERNANCE_CALENDAR_TZ
  );
  const population = new Map<
    string,
    { connectionId: string; schema: string; sourceName: string; physicalTable: string | null }
  >();
  for (const ref of input.grantRefs) {
    const key = tableCountKey(ref);
    if (population.has(key)) continue;
    population.set(key, {
      connectionId: ref.connectionId,
      schema: ref.schema,
      sourceName: ref.sourceName,
      physicalTable: ref.physicalTable ?? null
    });
  }

  const activeDaysByTable = new Map<string, Set<string>>();
  for (const row of input.accessRows) {
    if (input.tokenLabel != null && row.tokenLabel !== input.tokenLabel) continue;
    // deny 不计；评测探针不计（D19／用户 S3 约束）。
    if (row.outcome !== "allow" && row.outcome !== "ok") continue;
    if (
      isEvalProbeCall({
        evalMark: row.evalMark ?? false,
        connectionName: row.connectionId
      })
    ) {
      continue;
    }
    const key = tableCountKey({
      connectionId: row.connectionId,
      schema: row.schemaName,
      sourceName: row.sourceName
    });
    let days = activeDaysByTable.get(key);
    if (!days) {
      days = new Set();
      activeDaysByTable.set(key, days);
    }
    days.add(calendarDayKey(row.ts, GOVERNANCE_CALENDAR_TZ));
  }

  const rows: TableAdoptionRow[] = [];
  for (const [key, table] of population) {
    const activeDays = activeDaysByTable.get(key)?.size ?? 0;
    const windowUnvisited = activeDays === 0;
    let activityRate: number | null = null;
    if (denomDays >= 1) {
      activityRate = activeDays / denomDays;
      if (activityRate > 1) {
        throw new Error(`activity_rate > 1 for ${key}: ${activeDays}/${denomDays}`);
      }
    }
    rows.push({
      connectionId: table.connectionId,
      schema: table.schema,
      sourceName: table.sourceName,
      physicalTable: table.physicalTable,
      windowUnvisited,
      activeDays,
      denomDays,
      activityRate,
      // D18：上线锚点不在本条；披露全窗分母。
      daysOnlineInWindow: denomDays
    });
  }
  return rows;
}

function materializeW2(
  database: Database.Database,
  mid: string,
  map: AccessMapResponse,
  adoptionRows: TableAdoptionRow[]
): void {
  const insertGrant = database.prepare(`
    INSERT INTO ops_grant_paths (
      snapshot_id, path_key, agent_id, role_id, connection_id, schema_name, source_name, physical_table
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const ref of map.pathRefs.grant) {
    insertGrant.run(
      mid,
      grantPathKey(ref),
      ref.agentId,
      ref.roleId,
      ref.connectionId,
      ref.schema,
      ref.sourceName,
      ref.physicalTable ?? null
    );
  }

  const insertAccess = database.prepare(`
    INSERT INTO ops_access_paths (
      snapshot_id, path_key, agent_id, role_id, connection_id, schema_name, source_name
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const ref of map.pathRefs.access) {
    insertAccess.run(
      mid,
      accessPathKey(ref),
      ref.agentId,
      ref.roleId,
      ref.connectionId,
      ref.schema,
      ref.sourceName
    );
  }

  const insertEdge = database.prepare(`
    INSERT INTO ops_edge_signals (
      snapshot_id, edge_id, source_id, target_id, state, confirmed_unauthorized,
      grant_paths, access_paths, access_calls
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const edge of map.edges) {
    insertEdge.run(
      mid,
      edge.id,
      edge.source,
      edge.target,
      edge.state,
      edge.confirmedUnauthorized ? 1 : 0,
      edge.grantPaths,
      edge.accessPaths,
      edge.accessCalls
    );
  }

  const insertNode = database.prepare(`
    INSERT INTO ops_map_nodes (
      snapshot_id, node_id, kind, label, depth, grant_paths, access_paths
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const node of map.nodes) {
    insertNode.run(
      mid,
      node.id,
      node.kind,
      node.label,
      node.depth,
      Number(node.meta.grantPaths ?? 0),
      Number(node.meta.accessPaths ?? 0)
    );
  }

  const cov = map.meta.snapshotCoverage;
  database
    .prepare(
      `INSERT INTO ops_map_meta (
        snapshot_id, grant_paths, access_paths, raw_calls, denied_calls,
        coverage_review_paths, coverage_matched, coverage_missing_or_invalid, coverage_ratio,
        orphan_grants, access_config_version, policy_version, source_map_version, capability_digest,
        grant_state, access_state, trust
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      mid,
      map.meta.counts.grantPaths,
      map.meta.counts.accessPaths,
      map.meta.access.rawCalls,
      map.meta.access.deniedCalls,
      cov.reviewPaths,
      cov.matched,
      cov.missingOrInvalid,
      cov.ratio,
      map.meta.orphanGrants,
      map.meta.grant.accessConfigVersion,
      map.meta.grant.policyVersion,
      map.meta.grant.sourceMapVersion,
      map.meta.grant.capabilityDigest,
      map.meta.grant.state,
      map.meta.access.state,
      map.meta.access.trust
    );

  const insertAdoption = database.prepare(`
    INSERT INTO ops_table_adoption (
      snapshot_id, connection_id, schema_name, source_name, physical_table,
      window_unvisited, active_days, denom_days, activity_rate, days_online_in_window
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const row of adoptionRows) {
    insertAdoption.run(
      mid,
      row.connectionId,
      row.schema,
      row.sourceName,
      row.physicalTable,
      row.windowUnvisited ? 1 : 0,
      row.activeDays,
      row.denomDays,
      row.activityRate,
      row.daysOnlineInWindow
    );
  }
}

function materializeW1(
  database: Database.Database,
  mid: string,
  agents: AccessUserRow[],
  window: MetricWindow,
  focus: GovFocus,
  nowMs: number
): void {
  const insertAgent = database.prepare(`
    INSERT INTO ops_agents (
      snapshot_id, agent_id, agent_name, enabled, role_id,
      configured_token_count, available_token_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const focusedAgents = focus.agent
    ? agents.filter((user) => user.id === focus.agent)
    : agents;

  for (const user of focusedAgents) {
    if (focus.role && user.role !== focus.role) continue;
    const tokens = Array.isArray(user.tokens) ? user.tokens : [];
    insertAgent.run(
      mid,
      user.id,
      user.name ?? null,
      user.enabled === false ? 0 : 1,
      user.role ?? null,
      tokens.length,
      availableTokenCount(user, nowMs)
    );
  }

  const defaultUsage = defaultUsageConditionSql("access_log").sql;
  const selfExclusion = selfExclusionSql("access_log");
  const protocol = protocolConditionSql("access_log").sql;
  const grade = accessGradeSql("access_log").sql;

  // ops_tokens — D23＝E：GROUP BY (agent_id, token_label)；不改 access-map 图归因。
  let tokenSql = `
    INSERT INTO ops_tokens (snapshot_id, agent_id, token_label, call_count, last_used)
    SELECT
      ? AS snapshot_id,
      access_log.user_id AS agent_id,
      COALESCE(access_log.token_label, '') AS token_label,
      COUNT(*) AS call_count,
      MAX(access_log.ts) AS last_used
    FROM access_log
    WHERE access_log.ts >= ? AND access_log.ts < ?
      AND ${defaultUsage}
      AND ${selfExclusion}
      AND access_log.token_label IS NOT NULL
      AND trim(access_log.token_label) != ''
  `;
  const tokenParams: unknown[] = [mid, window.startIso, window.endIso];
  if (focus.agent) {
    tokenSql += ` AND access_log.user_id = ?`;
    tokenParams.push(focus.agent);
  }
  if (focus.tokenLabel) {
    tokenSql += ` AND access_log.token_label = ?`;
    tokenParams.push(focus.tokenLabel);
  }
  tokenSql += ` GROUP BY access_log.user_id, access_log.token_label`;
  database.prepare(tokenSql).run(...tokenParams);

  // ops_agent_activity — UTC call_day，同一默认用量∧自排除事件集。
  let activitySql = `
    INSERT INTO ops_agent_activity (snapshot_id, agent_id, call_day, call_count)
    SELECT
      ? AS snapshot_id,
      access_log.user_id AS agent_id,
      date(access_log.ts) AS call_day,
      COUNT(*) AS call_count
    FROM access_log
    WHERE access_log.ts >= ? AND access_log.ts < ?
      AND ${defaultUsage}
      AND ${selfExclusion}
  `;
  const activityParams: unknown[] = [mid, window.startIso, window.endIso];
  if (focus.agent) {
    activitySql += ` AND access_log.user_id = ?`;
    activityParams.push(focus.agent);
  }
  activitySql += ` GROUP BY access_log.user_id, date(access_log.ts)`;
  database.prepare(activitySql).run(...activityParams);

  // Per-agent counters for Q4 MECE.
  const countStmt = database.prepare(`
    SELECT
      SUM(CASE WHEN ${protocol} THEN 1 ELSE 0 END) AS protocol_count,
      SUM(CASE WHEN ${defaultUsage} AND ${selfExclusion} THEN 1 ELSE 0 END) AS default_usage_count,
      SUM(CASE WHEN (${grade}) = 'query' AND NOT (${protocol}) THEN 1 ELSE 0 END) AS query_count
    FROM access_log
    WHERE access_log.ts >= ? AND access_log.ts < ?
      AND access_log.user_id = ?
  `);

  const realQuestionStmt = database.prepare(`
    SELECT COUNT(*) AS n
    FROM conversation_turns
    WHERE user_id = ?
      AND created_at >= ? AND created_at < ?
      AND question_source IN ('reported_tool', 'reported')
      AND turn_id IS NOT NULL AND trim(turn_id) != ''
  `);

  const insertKpi = database.prepare(`
    INSERT INTO ops_question_kpi_agents (
      snapshot_id, agent_id, tier, tier_label,
      protocol_count, default_usage_count, query_count, real_question_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const user of focusedAgents) {
    if (focus.role && user.role !== focus.role) continue;
    const counts = countStmt.get(window.startIso, window.endIso, user.id) as {
      protocol_count: number | null;
      default_usage_count: number | null;
      query_count: number | null;
    };
    const real = realQuestionStmt.get(user.id, window.startIso, window.endIso) as { n: number };
    const protocolCount = Number(counts?.protocol_count ?? 0);
    const defaultUsageCount = Number(counts?.default_usage_count ?? 0);
    const queryCount = Number(counts?.query_count ?? 0);
    const realQuestionCount = Number(real?.n ?? 0);
    const tier = classifyGovernanceQ4Tier({
      protocolCount,
      defaultUsageCount,
      queryCount,
      realQuestionCount
    });
    insertKpi.run(
      mid,
      user.id,
      tier,
      GOVERNANCE_Q4_TIER_LABELS[tier],
      protocolCount,
      defaultUsageCount,
      queryCount,
      realQuestionCount
    );
  }
}

/**
 * 原子重建：失败丢弃 staging；成功后切换 pointer（SC-18）。
 */
export async function rebuildGovernanceSnapshotAtomic(
  database: Database.Database,
  input: GovernanceRebuildInput
): Promise<GovernanceBindResult> {
  const nowMs = input.nowMs ?? Date.now();
  const queryKey = computeGovernanceQueryKey({
    startIso: input.window.startIso,
    endIso: input.window.endIso,
    trust: input.trust,
    filtersDigest: input.filtersDigest,
    versions: input.versions
  });

  const existing = pointerByQueryKey.get(queryKey);
  if (existing && pointerFresh(existing, nowMs, input.versions)) {
    return {
      queryKey,
      materializationId: existing.materializationId,
      reused: true
    };
  }

  ensureGovernanceSnapshotTables(database);
  const mid = randomUUID();
  // SC-21：构建开始时钉住 access.yaml。中途字节变化则丢弃，不发布脏快照。
  const accessYamlAtStart = await readAccessYamlText(input.projectRoot);
  const agents = await readConfiguredAgents(input.projectRoot);

  const provider =
    input.accessMapProvider ??
    createAdminAccessMapProvider({
      projectRoot: input.projectRoot,
      openAuditDb: async () => database
    });

  let map: AccessMapResponse;
  let adoptionAccessRows: AccessMapAuditRow[];
  try {
    map = await buildAccessMap(provider, toAccessMapQuery(input), {
      injectedWindow: input.window
    });
    if (input.adoptionAccessRows) {
      adoptionAccessRows = input.adoptionAccessRows;
    } else {
      const accessSide = await provider.loadAccessSide({
        window: input.window,
        trust: input.trust,
        // Token focus 只影响访问层行集（与 builder 一致）；授权面不受影响。
        tokenLabel: null,
        inquiryKind: "management",
        accessGrade: "exclude_connect"
      });
      adoptionAccessRows = accessSide.state === "ok" ? accessSide.rows : [];
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new GovernanceSnapshotUnreadyError(detail);
  }

  const adoptionRows = computeTableAdoption({
    grantRefs: map.pathRefs.grant,
    accessRows: adoptionAccessRows,
    window: input.window,
    tokenLabel: input.focus.tokenLabel ?? null
  });

  if ((await readAccessYamlText(input.projectRoot)) !== accessYamlAtStart) {
    throw new GovernanceSnapshotUnreadyError("access.yaml changed during rebuild");
  }

  try {
    const tx = database.transaction(() => {
      materializeW1(database, mid, agents, input.window, input.focus, nowMs);
      materializeW2(database, mid, map, adoptionRows);
    });
    tx();
  } catch (error) {
    try {
      discardMaterialization(database, mid);
    } catch {
      // ignore cleanup errors
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new GovernanceSnapshotUnreadyError(detail);
  }

  if ((await readAccessYamlText(input.projectRoot)) !== accessYamlAtStart) {
    try {
      discardMaterialization(database, mid);
    } catch {
      // ignore cleanup errors
    }
    throw new GovernanceSnapshotUnreadyError("access.yaml changed during rebuild");
  }

  // 成功后才切换 pointer（半份永不发布）。
  pointerByQueryKey.set(queryKey, {
    materializationId: mid,
    queryKey,
    createdAtMs: nowMs,
    versions: { ...input.versions }
  });

  // GC：无绑定读者且超过 TTL×2 的旧代可删。
  gcStaleMaterializations(database, nowMs);

  return { queryKey, materializationId: mid, reused: false };
}

export class GovernanceSnapshotUnreadyError extends Error {
  readonly code = OPS_EVIDENCE_GOVERNANCE_UNREADY;

  constructor(detail: string) {
    super(`governance snapshot unready: ${detail}`);
    this.name = "GovernanceSnapshotUnreadyError";
  }
}

function gcStaleMaterializations(database: Database.Database, nowMs: number): void {
  const liveMids = new Set<string>();
  for (const entry of pointerByQueryKey.values()) {
    liveMids.add(entry.materializationId);
  }
  for (const bind of readerBindings.values()) {
    liveMids.add(bind.materializationId);
  }

  const cutoff = nowMs - GOVERNANCE_SNAPSHOT_TTL_MS * 2;
  for (const [key, entry] of [...pointerByQueryKey.entries()]) {
    if (entry.createdAtMs >= cutoff) continue;
    // Still referenced by an active pointer younger than cutoff? already skipped.
    // Drop pointer if stale; delete rows if mid not live.
    pointerByQueryKey.delete(key);
    if (!liveMids.has(entry.materializationId)) {
      try {
        discardMaterialization(database, entry.materializationId);
      } catch {
        // ignore
      }
    }
  }
}

/**
 * 查询开始绑定 materialization_id；刷新 pointer 不改写已绑定行集（SC-20b）。
 */
export function bindGovernanceMaterialization(
  bindId: string,
  materializationId: string,
  nowMs: number = Date.now()
): void {
  readerBindings.set(bindId, { materializationId, boundAtMs: nowMs });
}

export function releaseGovernanceMaterializationBind(bindId: string): void {
  readerBindings.delete(bindId);
}

/**
 * 向 lucy_query args 注入 `snapshot_id = mid` 行过滤（不经 gov.*）。
 */
export function injectSnapshotIdFilter(
  args: Record<string, unknown>,
  materializationId: string,
  sourceName: string
): Record<string, unknown> {
  const filter = {
    field: `${sourceName}.snapshot_id`,
    op: "eq",
    value: materializationId
  };
  const existing = args.filters;
  let filters: unknown[];
  if (existing === undefined || existing === null) {
    filters = [filter];
  } else if (Array.isArray(existing)) {
    filters = [...existing, filter];
  } else {
    filters = [existing, filter];
  }
  return { ...args, filters };
}

/** 便于测试：读取 pointer。 */
export function peekGovernancePointer(queryKey: string): GovernancePointerEntry | undefined {
  return pointerByQueryKey.get(queryKey);
}
