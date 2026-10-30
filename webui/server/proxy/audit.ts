import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { resolveProjectRoot } from "../project.js";
import { prepareTraceDatabase } from "../trace/evidence.js";
import { resolveSourceRefsForTables } from "./acl.js";
import { scrubArgsSummaryJson } from "./audit-privacy.js";
import {
  classifyAuditEvent,
  CLASSIFICATION_VERSION_V2P5,
  DIGEST_VERSION_V2P5,
  type DigestKind,
  type ExecutionEvidence
} from "./audit-classification.js";
import { DERIVATION_VERSION } from "./audit-derivation.js";
import { resolveLedgerSeq } from "./audit-reconcile.js";
import {
  MCP_HANDSHAKE_METHODS,
  MCP_PROBE_METHODS,
  MCP_SERVER_METHODS,
  classifyUsage,
  defaultUsageConditionSql,
  isMcpProtocolMethod,
  protocolMethodSqlList
} from "./usage-classification.js";
import { resolveClientIdentity } from "./request-client-meta.js";
import {
  CALL_MONITOR_P95_MIN_SAMPLES,
  callMonitorBucketIndex,
  callMonitorWindow,
  parseCallMonitorRange,
  type CallMonitorRange
} from "../../src/lib/callMonitorWindow.js";
import {
  defaultUsageExcluded,
  isEmptyResult,
  isSlowCall,
  SLOW_CALL_MIN_DURATION_MS,
  SLOW_DEFINITION_EFFECTIVE_AT,
  SLOW_TURN_WALL_CLOCK_MS,
  usageGroup,
  usageSlowMark,
  type UsageGroup
} from "./question-experience.js";

/** SC-26 — a denial with no matched role is its own row, never spread over role_ids. */
const UNMATCHED_ROLE_ID = "__unmatched_role__";

export interface AccessLogEntry {
  ts: string;
  userId: string;
  tokenLabel?: string;
  tokenHashPrefix?: string;
  lucySessionId?: string;
  lucyTurnId?: string;
  turnAttributionMode?: "explicit" | "session_bound" | "identity_inferred" | "unassigned";
  turnAttributionConfidence?: "high" | "low" | "none";
  turnAttributionReason?: "turn_attribution_rejected" | "attribution_evidence_conflict";
  /**
   * Spec 173 v0.3 / 2026-10-19 audit-trust:正交于 turn_attribution_mode 的关联质量判定。
   * 由准入路径冻结；不允许在 prepared / delivered 阶段改写。
   * 历史 `session_bound + high` 行降为 `legacy_unverified`（T03 backfill 接管）。
   */
  associationStatus?: "confirmed" | "candidate" | "unassigned" | "conflict" | "legacy_unverified";
  /** 原始关联：准入时刻捕获，事后不改。历史行 NULL。 */
  originalTurnId?: string;
  originalAttributionMode?: "explicit" | "session_bound" | "identity_inferred" | "unassigned";
  originalAssociationStatus?: "confirmed" | "candidate" | "unassigned" | "conflict" | "legacy_unverified";
  originalAttributionConfidence?: "high" | "low" | "none";
  originalReason?: string;
  /** 有效关联：读路径按事件链 + 修订链 idempotent 计算。准入时与 original 一致。 */
  effectiveTurnId?: string;
  effectiveAttributionMode?: "explicit" | "session_bound" | "identity_inferred" | "unassigned";
  effectiveAssociationStatus?: "confirmed" | "candidate" | "unassigned" | "conflict" | "legacy_unverified";
  effectiveAttributionConfidence?: "high" | "low" | "none";
  effectiveReason?: string;
  /** Spec 173 v0.3 / 2026-10-19 audit-trust:重试链。T07 完整实施，T01 仅占位。 */
  attemptId?: string;
  parentAttemptId?: string;
  /** Spec 173 v0.3 / 2026-10-19 audit-trust:启动代次。新事件写入；历史行 NULL。 */
  instanceId?: string;
  instanceStartGeneration?: number;
  /** T04 由分类函数写入；历史行 NULL。 */
  eventType?: "tool_call" | "protocol" | "client_observation" | "audit_management";
  /** Spec 173 v0.3 / 2026-10-19 audit-trust:归因规则版本。 */
  attributionRuleVersion?: string;
  /** T04 由分类函数写入。 */
  classificationVersion?: string;
  /** T02 / T06 增量；T01 占位。 */
  credentialPrincipalId?: string;
  lucyPlatform?: string;
  client?: string;
  clientVersion?: string;
  /** Raw MCP `clientInfo`, kept when `client` was replaced by a known User-Agent product. */
  reportedClient?: string;
  reportedClientVersion?: string;
  clientIp?: string;
  /** Spec 162 §8 / SC-22 — display-only forwarded chain; never used for ACL. */
  clientForwardedFor?: string;
  userAgent?: string;
  deviceName?: string;
  tool: string;
  tables?: string[];
  argsSummary?: Record<string, unknown>;
  queryHash?: string;
  queryLength?: number;
  queryOperation?: string;
  queryPreview?: string;
  queryArtifactRef?: string;
  generatedSql?: string;
  outcome: "ok" | "error" | "denied" | "budget_stop";
  errorDetail?: string;
  compilerReason?: string;
  failureDimension?: string;
  appliedVersion?: string;
  appliedBusinessDate?: string;
  appliedValueKind?: string;
  actorId?: string;
  actorKind?: "person" | "automation";
  /** Spec 162 §7.7 / SC-12 — injected wiki articles: key + wiki version. */
  wikiInjectedKeys?: string[];
  wikiVersions?: string[];
  /** Spec 162 §7.6 — Token's explicit `eval_mark`, mirrored onto the call row. */
  evalMark?: boolean;
  /** Spec 162 §8 / SC-20 — slow mark under the new definition. */
  isSlowCall?: boolean;
  slowBasis?: "call_duration" | "turn_wall_clock";
  /** SC-20 — successful call that returned zero rows. */
  resultEmpty?: boolean;
  /** SC-20 — elapsed wall clock of the question this call belongs to. */
  turnWallClockMs?: number;
  durationMs: number;
  requestId: string | number;
  traceId?: string;
  responseBytes?: number;
  responseRowCount?: number;
  responseColumnCount?: number;
  responseTruncated?: boolean;
  roleIds?: string[];
  permissionSnapshotHash?: string;
  effectiveTablesCount?: number;
  decisionReason?: string;
  skillUri?: string;
  skillVersion?: string;
  skillFileVersion?: string;
  skillAction?: "discover" | "read";
  skillRolesAllowed?: string[];
  matchedRoleId?: string;
  /** Spec 98 §10.3 — EffectivePolicy version at decision time. */
  policyVersion?: string;
  /** Spec 98 §10.3 — capability digest (also stored on permission_snapshots). */
  capabilityDigest?: string;
  permissionSnapshot?: {
    hash: string;
    rolesJson: unknown;
    resolvedJson: unknown;
    capabilityDigest?: string;
    toolClassificationVersion?: string;
  };
  // ─── Lucy v0.25 / L25-09 增量字段（全部 additive；历史行 NULL）────────────
  /**
   * 写路径提供的**可核验执行凭据**。缺省即该事实不成立 → 主状态落 `unknown`。
   * 旧 `outcome=ok` **不**构成执行成功凭据（Spec §4.3(a) 第 9 行）。
   */
  executionEvidence?: ExecutionEvidence;
  /** 入口事件 ID（= 已提交 received 事件的 event_id）。 */
  ingressEventId?: string;
  /** 逻辑入口标识（mcp-http / admin-http / agent-audit-ingest）。 */
  endpointId?: string;
  /** 账本提交序号（as-of S 视图用）。 */
  ledgerSeq?: number;
  /** S03 标识字典。 */
  clientCallId?: string;
  clientEventId?: string;
  upstreamOperationId?: string;
  rpcRequestId?: string;
  /** 业务重试指向原入口事件 ID。 */
  retryOf?: string;
  /** S01(e) 三族分离。 */
  reportedRole?: string;
  observedProtocol?: string;
  observedRoleIds?: string[];
  inferredClient?: string;
  inferenceMethod?: string;
  inferenceConfidence?: "high" | "low" | "none";
  inferenceRuleVersion?: string;
  /** U11 摘要类型与预览版本。 */
  digestKind?: DigestKind;
  digestVersion?: string;
  previewVersion?: string;
  /** 原始输入 UTF-8 字节长度（预览截断披露）。 */
  previewOriginalBytes?: number;
  /** 预览是否被截断。 */
  previewTruncated?: boolean;
}

export type AuthFailureReason =
  | "missing_bearer"
  | "token_unrecognized"
  | "token_revoked"
  | "token_expired";

export interface AuthFailureLogEntry {
  ts: string;
  reason: AuthFailureReason;
  clientIp?: string;
  userAgent?: string;
  tokenHashPrefix?: string;
  userId?: string;
  tokenLabel?: string;
  requestId?: string | number;
}

export interface AccessLogSourceRecord {
  connectionId?: string;
  schemaName?: string;
  sourceName?: string;
  physicalTable: string;
  extractionMethod: string;
  confidence: "high" | "medium" | "low";
}

let db: Database.Database | null = null;

/**
 * audit-trust-2026-10-19-r1 / T03a: audit.sqlite schema version (independent
 * of SQLite's internal `PRAGMA schema_version`, which we never read).
 * Bump together with new audit_meta entries.
 */
export const AUDIT_DB_SCHEMA_VERSION = 4;
/**
 * Lucy v0.25 / L25-09 B26 — the **single** access_log column contract.
 *
 * E-10 之前 `ACCESS_LOG_COLUMNS` 有两份重复常量（`proxy/audit.ts` 与
 * `admin/audit.ts`），新增列须两处同步，否则导出元数据与写入漂移。
 * 现在只有这一份；`admin/audit.ts` 直接 import，不再自带副本。
 *
 * 全部为 additive 列（`ensureColumn` 迁移），历史行保持 NULL；
 * 历史行**不重解释**（Spec §4.6）。
 */
export const ACCESS_LOG_COLUMNS = [
  ["role_ids", "TEXT"],
  ["permission_snapshot_hash", "TEXT"],
  ["effective_tables_count", "INTEGER"],
  ["decision_reason", "TEXT"],
  ["token_label", "TEXT"],
  ["token_hash_prefix", "TEXT"],
  ["lucy_session_id", "TEXT"],
  ["lucy_turn_id", "TEXT"],
  ["turn_attribution_mode", "TEXT"],
  ["turn_attribution_confidence", "TEXT"],
  ["turn_attribution_reason", "TEXT"],
  ["lucy_platform", "TEXT"],
  ["query_hash", "TEXT"],
  ["query_length", "INTEGER"],
  ["query_operation", "TEXT"],
  ["query_preview", "TEXT"],
  ["query_artifact_ref", "TEXT"],
  ["generated_sql", "TEXT"],
  ["response_bytes", "INTEGER"],
  ["response_row_count", "INTEGER"],
  ["response_column_count", "INTEGER"],
  ["response_truncated", "INTEGER"],
  ["trace_id", "TEXT"],
  ["client_ip", "TEXT"],
  ["client_forwarded_for", "TEXT"],
  ["user_agent", "TEXT"],
  ["client_version", "TEXT"],
  ["device_name", "TEXT"],
  ["policy_version", "TEXT"],
  ["capability_digest", "TEXT"],
  ["skill_uri", "TEXT"],
  ["skill_version", "TEXT"],
  ["skill_file_version", "TEXT"],
  ["skill_action", "TEXT"],
  ["skill_roles_allowed", "TEXT"],
  ["matched_role_id", "TEXT"],
  ["compiler_reason", "TEXT"],
  ["failure_dimension", "TEXT"],
  ["applied_version", "TEXT"],
  ["applied_business_date", "TEXT"],
  ["applied_value_kind", "TEXT"],
  ["actor_id", "TEXT"],
  ["actor_kind", "TEXT"],
  ["wiki_injected_keys", "TEXT"],
  ["wiki_versions", "TEXT"],
  ["eval_mark", "INTEGER"],
  ["is_slow_call", "INTEGER"],
  ["slow_basis", "TEXT"],
  ["result_empty", "INTEGER"],
  ["turn_wall_clock_ms", "INTEGER"],
  ["reported_client", "TEXT"],
  ["reported_client_version", "TEXT"],
  // Spec 173 v0.3 / 2026-10-19 audit-trust: association_status + 双视图 + 重试链 + 启动代次。
  // ensureColumn 形式做 additive 迁移；历史行 NULL。T03 接管 association_revisions 表。
  ["association_status", "TEXT"],
  ["original_turn_id", "TEXT"],
  ["original_attribution_mode", "TEXT"],
  ["original_association_status", "TEXT"],
  ["original_attribution_confidence", "TEXT"],
  ["original_reason", "TEXT"],
  ["effective_turn_id", "TEXT"],
  ["effective_attribution_mode", "TEXT"],
  ["effective_association_status", "TEXT"],
  ["effective_attribution_confidence", "TEXT"],
  ["effective_reason", "TEXT"],
  ["attempt_id", "TEXT"],
  ["parent_attempt_id", "TEXT"],
  ["instance_id", "TEXT"],
  ["instance_start_generation", "INTEGER"],
  ["event_type", "TEXT"],
  ["attribution_rule_version", "TEXT"],
  ["classification_version", "TEXT"],
  ["credential_principal_id", "TEXT"],
  // T03a: tracks whether the legacy explicit-turn validation passed (1=confirmed, 0=conflict).
  // Pre-existing rows stay NULL; backfillAssociationStatus() handles the missing-column fallback.
  ["explicit_turn_validated", "INTEGER"],
  // ─── Lucy v0.25 / L25-09 (audit increment) additive columns ────────────────
  // 四轴分类结果（写路径与读路径共用同一分类函数；历史行 NULL）。
  ["transport_sub_type", "TEXT"],
  ["transport_status", "TEXT"],
  ["authorization_status", "TEXT"],
  ["execution_status", "TEXT"],
  ["usability_status", "TEXT"],
  // 汇总主状态八桶（派生视图；derivationVersion=v2p5-1）。
  ["primary_status", "TEXT"],
  ["derivation_version", "TEXT"],
  // 送达状态（prepared / sent / acknowledged / unknown）。
  ["delivery_status", "TEXT"],
  // 空值原因（六值枚举）。
  ["null_reason", "TEXT"],
  // 旧 outcome 原样保留为 legacy_outcome；不作为新执行状态的证据。
  ["legacy_outcome", "TEXT"],
  // 摘要类型与版本（search_text / sql / result；v2p5-1）。
  ["digest_kind", "TEXT"],
  ["digest_version", "TEXT"],
  ["preview_version", "TEXT"],
  // 入口事件 ID（= 已提交 received 事件的 event_id）。
  ["ingress_event_id", "TEXT"],
  ["endpoint_id", "TEXT"],
  // 账本提交序号（as-of S 视图用）。
  ["ledger_seq", "INTEGER"],
  // S03 标识字典补充列。
  ["client_call_id", "TEXT"],
  ["client_event_id", "TEXT"],
  ["upstream_operation_id", "TEXT"],
  ["rpc_request_id", "TEXT"],
  ["retry_of", "TEXT"],
  // S01(e) reported / observed / inferred 三族分离。
  ["reported_role", "TEXT"],
  ["observed_role_ids", "TEXT"],
  ["observed_protocol", "TEXT"],
  ["inferred_client", "TEXT"],
  ["inference_method", "TEXT"],
  ["inference_confidence", "TEXT"],
  ["inference_rule_version", "TEXT"],
  // S07 七分类（与 162 四维并行披露）。
  ["error_category", "TEXT"]
] as const;
export type AccessLogColumnName = (typeof ACCESS_LOG_COLUMNS)[number][0];
const PERMISSION_SNAPSHOT_COLUMNS = [
  ["capability_digest", "TEXT"],
  ["tool_classification_version", "TEXT"]
] as const;

function ensureColumn(database: Database.Database, table: string, column: string, definition: string): void {
  const rows = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (rows.some((row) => row.name === column)) return;
  database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

export function closeAuditDb(): void {
  if (db) {
    try {
      db.close();
    } catch {}
    db = null;
    insertStmt = null;
    sourceInsertStmt = null;
    snapshotStmt = null;
    conversationTurnInsertStmt = null;
  }
  // F-02：重开数据库后基线需重新核对（换一个库文件时基线不在旧库里）。
  asofBaselineResolved = false;
  budgetTableReady = false;
}

// ─── F-02：as-of S 证明的存储侧支撑 ─────────────────────────────────────────
//
// 1) 归属就地改写日志（`access_log_attribution_mutations`）：登记每次归属列
//    就地改写的前像 / 后像与账本序号。没有它，as-of S 视图无法判定「归属有效值」
//    是否可按 S 精确重建（Spec §18.10 F-02）。
// 2) 基线（`access_log_asof_meta`）：归属改写日志生效时的账本序号。`S < 基线`
//    时无法排除「基线之前存在未登记的就地改写」→ 归属维度不可证明。
// 3) 来源行账本序号（`access_log_sources.ledger_seq`）：没有它，晚于 S 写入的
//    来源行会被当前视图读到，成为混入的 >S 事实。

const ASOF_BASELINE_KEY = "attribution_journal_baseline_seq";
let asofBaselineResolved = false;

/**
 * 登记归属改写日志基线（账本序号）。
 *
 * 基线取「归属改写日志开始生效时」的账本已提交上界。账本不可得时**不登记**：
 * 证明会因此判为「归属维度不可证明」→ 正式导出与正式对账读取失败关闭。
 * 宁可失败关闭，也不猜一个基线。
 */
async function ensureAsOfBaseline(database: Database.Database): Promise<void> {
  if (asofBaselineResolved) return;
  try {
    const existing = database
      .prepare(`SELECT value FROM access_log_asof_meta WHERE key = ?`)
      .get(ASOF_BASELINE_KEY) as { value?: string } | undefined;
    if (existing) {
      asofBaselineResolved = true;
      return;
    }
    const seq = await resolveLedgerSeq();
    if (seq === null) return;
    database
      .prepare(`INSERT OR REPLACE INTO access_log_asof_meta (key, value) VALUES (?, ?)`)
      .run(ASOF_BASELINE_KEY, String(seq));
    asofBaselineResolved = true;
  } catch {
    // 基线不可得：as-of 证明保持「不可证明」（失败关闭），不静默放行。
  }
}

type AttributionMutationSnapshot = {
  turnId: string | null;
  mode: string | null;
  confidence: string | null;
  associationStatus: string | null;
};

/**
 * 登记一次归属就地改写。
 *
 * **必须**与改写本身处在同一事务内：登记失败则改写一并回滚，避免出现「改写
 * 了却没有历史」的不可证明状态。日志表不存在（历史库 / 精简测试 schema）时
 * **跳过登记**，改写照常进行 —— 此时 `proveExactAsOfS` 会以「归属改写日志缺失」
 * 判为不可证明（失败关闭），不会静默放行。
 */
function recordAttributionMutation(
  database: Database.Database,
  input: {
    accessLogId: number;
    kind: "handshake_attachment" | "association_status_backfill";
    ledgerSeq: number | null;
    before: AttributionMutationSnapshot;
    after: AttributionMutationSnapshot;
  }
): void {
  database
    .prepare(
      `INSERT INTO access_log_attribution_mutations
         (access_log_id, ledger_seq, kind,
          before_turn_id, after_turn_id,
          before_mode, after_mode,
          before_confidence, after_confidence,
          before_association_status, after_association_status,
          ts)
       VALUES
         (@accessLogId, @ledgerSeq, @kind,
          @beforeTurnId, @afterTurnId,
          @beforeMode, @afterMode,
          @beforeConfidence, @afterConfidence,
          @beforeAssociationStatus, @afterAssociationStatus,
          @ts)`
    )
    .run({
      accessLogId: input.accessLogId,
      ledgerSeq: input.ledgerSeq,
      kind: input.kind,
      beforeTurnId: input.before.turnId,
      afterTurnId: input.after.turnId,
      beforeMode: input.before.mode,
      afterMode: input.after.mode,
      beforeConfidence: input.before.confidence,
      afterConfidence: input.after.confidence,
      beforeAssociationStatus: input.before.associationStatus,
      afterAssociationStatus: input.after.associationStatus,
      ts: new Date().toISOString()
    });
}

/** 归属改写日志表是否可用（历史库 / 精简测试 schema 可能没有）。 */
function hasAttributionMutationTable(database: Database.Database): boolean {
  try {
    const row = database
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'access_log_attribution_mutations'`)
      .get();
    return row !== undefined;
  } catch {
    return false;
  }
}

async function getDb(): Promise<Database.Database> {
  if (db) return db;
  const envDbPath = process.env.LUCY_AUDIT_DB;
  let dbPath: string;
  if (envDbPath && envDbPath.trim().length > 0) {
    dbPath = path.resolve(envDbPath);
    mkdirSync(path.dirname(dbPath), { recursive: true });
  } else {
    const projectRoot = await resolveProjectRoot();
    const dir = path.join(projectRoot, ".ktx-ui");
    mkdirSync(dir, { recursive: true });
    dbPath = path.join(dir, "audit.sqlite");
  }
  db = new Database(dbPath);
  prepareTraceDatabase(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS access_log (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      ts           TEXT    NOT NULL,
      user_id      TEXT    NOT NULL,
      token_label  TEXT,
      token_hash_prefix TEXT,
      lucy_session_id TEXT,
      lucy_turn_id TEXT,
      lucy_platform TEXT,
      client       TEXT,
      tool         TEXT    NOT NULL,
      tables       TEXT,
      args_summary TEXT,
      query_hash   TEXT,
      query_length INTEGER,
      query_operation TEXT,
      query_preview TEXT,
      outcome      TEXT    NOT NULL,
      error_detail TEXT,
      duration_ms  INTEGER NOT NULL,
      response_bytes INTEGER,
      response_row_count INTEGER,
      response_column_count INTEGER,
      response_truncated INTEGER,
      request_id   TEXT    NOT NULL,
      trace_id     TEXT,
      role_ids     TEXT,
      permission_snapshot_hash TEXT,
      effective_tables_count INTEGER,
      decision_reason TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_al_user_ts ON access_log(user_id, ts);
    CREATE INDEX IF NOT EXISTS idx_al_tool_ts ON access_log(tool, ts);
    CREATE TABLE IF NOT EXISTS revoked_tokens (
      token_hash TEXT PRIMARY KEY,
      revoked_at TEXT NOT NULL,
      reason     TEXT
    );
    CREATE TABLE IF NOT EXISTS permission_snapshots (
      hash          TEXT PRIMARY KEY,
      created_at    TEXT NOT NULL,
      roles_json    TEXT NOT NULL,
      resolved_json TEXT NOT NULL,
      capability_digest TEXT,
      tool_classification_version TEXT
    );
    CREATE TABLE IF NOT EXISTS access_log_sources (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      access_log_id     INTEGER NOT NULL,
      ts                TEXT NOT NULL,
      user_id           TEXT NOT NULL,
      tool              TEXT NOT NULL,
      connection_id     TEXT,
      schema_name       TEXT,
      source_name       TEXT,
      physical_table    TEXT NOT NULL,
      extraction_method TEXT NOT NULL,
      confidence        TEXT NOT NULL,
      created_at        TEXT NOT NULL,
      FOREIGN KEY(access_log_id) REFERENCES access_log(id)
    );
    CREATE INDEX IF NOT EXISTS idx_als_log ON access_log_sources(access_log_id);
    CREATE INDEX IF NOT EXISTS idx_als_user_ts ON access_log_sources(user_id, ts);
    CREATE INDEX IF NOT EXISTS idx_als_source ON access_log_sources(connection_id, schema_name, source_name);
    CREATE INDEX IF NOT EXISTS idx_als_table ON access_log_sources(physical_table);
    -- F-02：归属就地改写日志（append-only）。
    --
    -- access_log 的归属列（lucy_turn_id / turn_attribution_mode /
    -- turn_attribution_confidence / association_status）在两处**就地**改写：
    -- 握手 attachment 与一次性历史归一化。就地改写会让「行内容 = 写入时刻的
    -- 事实」这一前提失效，as-of S 视图因此无法只用 ledger_seq <= S 过滤
    -- 还原。本表登记每次就地改写的**前像 / 后像与账本序号**，使归属维度
    -- 可被 proveExactAsOfS 判定为可证明或不可证明。
    CREATE TABLE IF NOT EXISTS access_log_attribution_mutations (
      id                        INTEGER PRIMARY KEY AUTOINCREMENT,
      access_log_id             INTEGER NOT NULL,
      ledger_seq                INTEGER,
      kind                      TEXT NOT NULL,
      before_turn_id            TEXT,
      after_turn_id             TEXT,
      before_mode               TEXT,
      after_mode                TEXT,
      before_confidence         TEXT,
      after_confidence          TEXT,
      before_association_status TEXT,
      after_association_status  TEXT,
      ts                        TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_almut_row ON access_log_attribution_mutations(access_log_id);
    CREATE INDEX IF NOT EXISTS idx_almut_seq ON access_log_attribution_mutations(ledger_seq);
    -- F-02：as-of 证明的元数据（当前只存归属改写日志基线）。
    CREATE TABLE IF NOT EXISTS access_log_asof_meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS conversation_turns (
      turn_id               TEXT PRIMARY KEY,
      session_id            TEXT,
      user_id               TEXT NOT NULL,
      token_hash_prefix     TEXT,
      platform              TEXT,
      client                TEXT,
      question_hash         TEXT,
      question_preview      TEXT,
      question_summary      TEXT,
      question_source       TEXT NOT NULL,
      redaction_version     TEXT,
      created_at            TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ct_user_created ON conversation_turns(user_id, created_at);
    CREATE TABLE IF NOT EXISTS inferred_turns (
      inferred_turn_id     TEXT PRIMARY KEY,
      user_id              TEXT NOT NULL,
      started_at           TEXT NOT NULL,
      ended_at             TEXT NOT NULL,
      call_count           INTEGER NOT NULL,
      business_call_count  INTEGER NOT NULL,
      tool_summary         TEXT NOT NULL,
      source_summary       TEXT NOT NULL,
      question_summary     TEXT,
      confidence           TEXT NOT NULL,
      evidence_json        TEXT NOT NULL,
      created_at           TEXT NOT NULL,
      updated_at           TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS inferred_turn_access_logs (
      inferred_turn_id TEXT NOT NULL,
      access_log_id    INTEGER NOT NULL,
      PRIMARY KEY(inferred_turn_id, access_log_id)
    );
    CREATE INDEX IF NOT EXISTS idx_it_user_time ON inferred_turns(user_id, started_at, ended_at);
    CREATE TABLE IF NOT EXISTS auth_failure_log (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      ts                 TEXT    NOT NULL,
      reason             TEXT    NOT NULL,
      client_ip          TEXT,
      user_agent         TEXT,
      token_hash_prefix  TEXT,
      user_id            TEXT,
      token_label        TEXT,
      request_id         TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_afl_ts ON auth_failure_log(ts);
    CREATE INDEX IF NOT EXISTS idx_afl_reason_ts ON auth_failure_log(reason, ts);
    CREATE TABLE IF NOT EXISTS audit_maintenance_log (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      ts                 TEXT    NOT NULL,
      event_type         TEXT    NOT NULL,
      actor              TEXT    NOT NULL,
      reason             TEXT    NOT NULL,
      request_id         TEXT,
      algorithm_version  TEXT    NOT NULL,
      scanned            INTEGER NOT NULL,
      matched            INTEGER NOT NULL,
      updated            INTEGER NOT NULL,
      before_digest      TEXT    NOT NULL,
      after_digest       TEXT    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_aml_ts ON audit_maintenance_log(ts);
    -- audit-trust-2026-10-19-r1 / T03a: 管理审计版本表 + 关联修订事件表。
    -- audit_meta 只放 schema/classification/digest 版本 + 受认证运行信息 + 受影响行数；
    -- 维护日志本身进入 security_events canonical ledger，不进 audit_meta。
    CREATE TABLE IF NOT EXISTS audit_meta (
      audit_db_schema_version INTEGER PRIMARY KEY,
      classification_version  TEXT,
      digest_version          TEXT,
      last_migration_text     TEXT,
      running_at_iso          TEXT,
      running_actor           TEXT,
      input_sha256            TEXT,
      output_affected_rows    INTEGER
    );
    -- association_revisions: append-only 修订记录表（contract §3.1 / §2.6）。
    -- 由 T03b 的 POST /api/admin/audit/association-revisions 受认证端点写入；
    -- 不在 backfill 内自动写。UNIQUE(original_turn_id, attribution_rule_version)
    -- 保证同一规则版本对同一 turn 只能写一次。
    CREATE TABLE IF NOT EXISTS association_revisions (
      id                              INTEGER PRIMARY KEY AUTOINCREMENT,
      original_turn_id                TEXT NOT NULL,
      effective_turn_id               TEXT,
      original_association_status     TEXT,
      effective_association_status    TEXT NOT NULL,
      reason                          TEXT NOT NULL,
      reference_doc                   TEXT,
      attribution_rule_version         TEXT NOT NULL,
      actor_kind                      TEXT NOT NULL,
      actor_id                        TEXT,
      instance_id                     TEXT,
      instance_start_generation       INTEGER,
      ts                              TEXT NOT NULL,
      classification_version          TEXT NOT NULL,
      expected_revision               TEXT,
      -- B25：as-of S 视图用 —— 该修订在 canonical ledger 的提交序号。
      ledger_seq                      INTEGER,
      UNIQUE(original_turn_id, attribution_rule_version)
    );
    CREATE INDEX IF NOT EXISTS idx_ar_original_turn ON association_revisions(original_turn_id);
    CREATE INDEX IF NOT EXISTS idx_ar_ts ON association_revisions(ts);
  `);
  ensureColumn(db, "association_revisions", "ledger_seq", "INTEGER");
  for (const [column, definition] of ACCESS_LOG_COLUMNS) {
    ensureColumn(db, "access_log", column, definition);
  }
  for (const [column, definition] of PERMISSION_SNAPSHOT_COLUMNS) {
    ensureColumn(db, "permission_snapshots", column, definition);
  }
  // F-02：来源行也要有账本序号，否则「关联事实 as-of S」不可证明 ——
  // 晚于 S 写入的来源行会被当前视图读到，成为混入的 >S 事实。
  ensureColumn(db, "access_log_sources", "ledger_seq", "INTEGER");
  ensureColumn(db, "conversation_turns", "session_id", "TEXT");
  ensureColumn(db, "conversation_turns", "association_status", "TEXT");
  ensureColumn(db, "inferred_turns", "client", "TEXT");
  ensureColumn(db, "inferred_turns", "session_id", "TEXT");
  db.exec(`
    -- 存量库可能没有 session_id 列 —— 索引必须在 ensureColumn 之后建。
    CREATE INDEX IF NOT EXISTS idx_ct_session ON conversation_turns(session_id);
    CREATE INDEX IF NOT EXISTS idx_al_user_token_ts ON access_log(user_id, token_hash_prefix, ts);
    CREATE INDEX IF NOT EXISTS idx_al_session_ts ON access_log(lucy_session_id, ts);
    CREATE INDEX IF NOT EXISTS idx_al_client_ip_ts ON access_log(client_ip, ts);
    CREATE INDEX IF NOT EXISTS idx_al_ts ON access_log(ts);
    CREATE INDEX IF NOT EXISTS idx_al_association_status ON access_log(association_status);
    CREATE INDEX IF NOT EXISTS idx_al_attempt_id ON access_log(attempt_id);
    CREATE INDEX IF NOT EXISTS idx_al_event_type ON access_log(event_type);
    CREATE INDEX IF NOT EXISTS idx_al_instance_id ON access_log(instance_id);
  `);
  // F-02：归属改写日志基线必须在表建好之后登记（表不存在时无法登记）。
  await ensureAsOfBaseline(db);
  return db;
}

// ─── Spec 149 §8：运维问数连接的两张只读视图 ─────────────────────────────────
//
// 视图建在**审计热库**上，只读暴露调用流水。三条硬约束：
// 1. SELECT 列表**不得**含 Token 哈希、client_ip、user_agent、device_name、
//    权限快照、args_summary、eval_mark、问询原文（SC-06）；WHERE 可以引用后两列。
// 2. 默认用量口径复用 `defaultUsageConditionSql(alias).sql`（Spec 189 唯一事实源），
//    不维护第二份协议名单。
// 3. **按事件排除**自身追问：一次调用只要有一行来源属于自身追问，整次事件从
//    两张视图**同时**消失，不留下另一张表的残余行（R09）。
//
// 每次确保都 DROP VIEW 后重建；**不得** DROP 基表。

/**
 * 自身追问的物理表名回退集合。
 *
 * 只在**连接归属缺失**（`connection_id` 为空）时生效：其他连接上真实存在的
 * 同名业务表不会被误删（R09 / SC-22）。
 */
const OPS_EVIDENCE_SELF_PHYSICAL_TABLES = [
  "main.ops_calls",
  "main.ops_call_tables",
  "ops_calls",
  "ops_call_tables"
] as const;

/** 视图 SELECT 列表里**不允许**出现的列（SC-06）。 */
export const OPS_EVIDENCE_FORBIDDEN_SELECT_COLUMNS = [
  "token_hash",
  "token_hash_prefix",
  "client_ip",
  "user_agent",
  "device_name",
  "permission_snapshot_hash",
  "args_summary",
  "eval_mark",
  "query_preview",
  "question_preview"
] as const;

/** 自身追问谓词（两张视图共用同一段 SQL）。 */
function opsEvidenceSelfExclusionSql(alias: string): string {
  const physicalList = OPS_EVIDENCE_SELF_PHYSICAL_TABLES.map((name) => `'${name}'`).join(", ");
  return `NOT EXISTS (
    SELECT 1 FROM access_log_sources AS self
    WHERE self.access_log_id = ${alias}.id
      AND (
        self.connection_id = 'lucy-ops'
        OR (
          COALESCE(self.connection_id, '') = ''
          AND self.physical_table IN (${physicalList})
        )
      )
  )`;
}

/**
 * 重建两张只读视图。幂等：先 DROP VIEW 再 CREATE。
 *
 * 调用方负责打开**审计热库**（本进程的单例连接与 KTX 读的是同一个文件）。
 * 基表 `access_log` / `access_log_sources` 不会被触碰。
 */
export async function recreateOpsEvidenceViews(): Promise<void> {
  const database = await getDb();
  const defaultUsage = defaultUsageConditionSql("access_log").sql;
  const selfExclusion = opsEvidenceSelfExclusionSql("access_log");

  database.exec("DROP VIEW IF EXISTS ops_call_tables; DROP VIEW IF EXISTS ops_calls;");

  database.exec(`
CREATE VIEW ops_calls AS
SELECT
  id AS event_id,
  ts,
  user_id AS agent_id,
  token_label,
  tool,
  outcome,
  duration_ms,
  decision_reason,
  error_detail,
  generated_sql,
  tables AS tables_json,
  request_id
FROM access_log
WHERE ${defaultUsage}
  AND ${selfExclusion};
`);

  database.exec(`
CREATE VIEW ops_call_tables AS
SELECT
  access_log.id AS event_id,
  access_log.ts,
  access_log.user_id AS agent_id,
  access_log.token_label,
  access_log.tool,
  access_log.outcome,
  access_log.duration_ms,
  access_log.decision_reason,
  access_log.error_detail,
  access_log.generated_sql,
  access_log.request_id,
  s.connection_id,
  s.schema_name,
  s.source_name,
  s.physical_table
FROM access_log
JOIN access_log_sources AS s ON s.access_log_id = access_log.id
WHERE ${defaultUsage}
  AND ${selfExclusion};
`);
}

/**
 * 断言两张视图的 SELECT 列表不含禁止列，且基表仍在（SC-06 / §8）。
 *
 * 视图是 SQLite 对象，`PRAGMA table_info(view)` 给出的就是 SELECT 列表。
 */
export function assertOpsEvidenceViewsSafe(database: Database.Database): void {
  for (const viewName of ["ops_calls", "ops_call_tables"]) {
    const columns = database
      .prepare(`PRAGMA table_info(${viewName})`)
      .all() as Array<{ name: string }>;
    if (columns.length === 0) {
      throw new Error(`ops evidence view ${viewName} does not exist`);
    }
    const present = new Set(columns.map((column) => column.name.toLowerCase()));
    for (const forbidden of OPS_EVIDENCE_FORBIDDEN_SELECT_COLUMNS) {
      if (present.has(forbidden.toLowerCase())) {
        throw new Error(
          `ops evidence view ${viewName} exposes a forbidden column: ${forbidden}`
        );
      }
    }
  }
  for (const baseTable of ["access_log", "access_log_sources"]) {
    const row = database
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(baseTable);
    if (row === undefined) {
      throw new Error(`ops evidence base table ${baseTable} is missing`);
    }
  }
}

let insertStmt: Database.Statement | null = null;
let snapshotStmt: Database.Statement | null = null;

// ─── B25：账本提交序号（as-of S 视图）───────────────────────────────────────
//
// `access_log.ledger_seq` / `association_revisions.ledger_seq` 记录该行写入时
// canonical ledger 的**已提交上界**（`MAX(seq)`）。
//
// 口径说明（写入报告的「需要回写 Spec 的偏差清单」）：
//   - 该口径是**保守上界**：行只在其 ledger_seq 之后才可能被后续账本事件改变，
//     因此 as-of S 视图纳入 `ledger_seq <= S` 的行是安全的。
//   - 它**不是**「该行所依赖的全部账本事件序号」：access_log 行在
//     `response_prepared` 提交**之前**写入，因此行的 `delivery_status` 反映
//     写入时刻的观测。精确的 as-of 视图仍需账本历史（Spec N18）。



export function isTokenRevoked(tokenHash: string): Promise<boolean> {
  return getDb().then((database) => {
    const row = database.prepare("SELECT 1 FROM revoked_tokens WHERE token_hash = ?").get(tokenHash);
    return row !== undefined;
  });
}

function truncateErrorDetail(value: string): string {
  if (value.length <= 500) return value;
  const digest = createHash("sha256").update(value).digest("hex").slice(0, 16);
  const marker = ` <truncated sha256:${digest}>`;
  return `${value.slice(0, 500 - marker.length)}${marker}`;
}

export async function writeLog(entry: AccessLogEntry): Promise<number> {
  const slow = usageSlowMark({
    tool: entry.tool,
    durationMs: entry.durationMs,
    lucyTurnId: entry.lucyTurnId
  });
  entry = {
    ...entry,
    turnWallClockMs: slow.turnWallClockMs ?? undefined,
    isSlowCall: slow.isSlowCall,
    slowBasis: slow.slowBasis ?? undefined
  };
  const database = await getDb();
  if (entry.permissionSnapshot) {
    if (!snapshotStmt) {
      snapshotStmt = database.prepare(`
        INSERT OR IGNORE INTO permission_snapshots
          (hash, created_at, roles_json, resolved_json, capability_digest, tool_classification_version)
        VALUES
          (@hash, @createdAt, @rolesJson, @resolvedJson, @capabilityDigest, @toolClassificationVersion)
      `);
    }
    snapshotStmt.run({
      hash: entry.permissionSnapshot.hash,
      createdAt: entry.ts,
      rolesJson: JSON.stringify(entry.permissionSnapshot.rolesJson),
      resolvedJson: JSON.stringify(entry.permissionSnapshot.resolvedJson),
      capabilityDigest: entry.permissionSnapshot.capabilityDigest
        ?? entry.capabilityDigest
        ?? null,
      toolClassificationVersion: entry.permissionSnapshot.toolClassificationVersion ?? null
    });
  }
  if (!insertStmt) {
    // B8: 补写此前「声明了但没写」的列 —— attempt_id / parent_attempt_id /
    // event_type / instance_id / credential_principal_id / classification_version /
    // attribution_rule_version。生产真实行此前这些列全为 NULL。
    // B18: 四轴分类结果与主状态由**同一个**分类函数产出（写路径与读路径共用）。
    insertStmt = database.prepare(`
      INSERT INTO access_log
        (ts, user_id, token_label, token_hash_prefix, lucy_session_id, lucy_turn_id, turn_attribution_mode, turn_attribution_confidence, turn_attribution_reason, association_status, original_turn_id, original_attribution_mode, original_association_status, original_attribution_confidence, original_reason, effective_turn_id, effective_attribution_mode, effective_association_status, effective_attribution_confidence, effective_reason, lucy_platform, client, client_version, client_ip, client_forwarded_for, user_agent, device_name, tool, tables, args_summary, query_hash, query_length, query_operation, query_preview, query_artifact_ref, generated_sql, outcome, error_detail, duration_ms, response_bytes, response_row_count, response_column_count, response_truncated, request_id, trace_id, role_ids, permission_snapshot_hash, effective_tables_count, decision_reason, policy_version, capability_digest, skill_uri, skill_version, skill_file_version, skill_action, skill_roles_allowed, matched_role_id, compiler_reason, failure_dimension, applied_version, applied_business_date, applied_value_kind, actor_id, actor_kind, wiki_injected_keys, wiki_versions, eval_mark, is_slow_call, slow_basis, result_empty, turn_wall_clock_ms, reported_client, reported_client_version, attempt_id, parent_attempt_id, event_type, instance_id, credential_principal_id, classification_version, attribution_rule_version, transport_sub_type, transport_status, authorization_status, execution_status, usability_status, primary_status, derivation_version, delivery_status, null_reason, legacy_outcome, digest_kind, digest_version, preview_version, ingress_event_id, endpoint_id, ledger_seq, client_call_id, client_event_id, upstream_operation_id, rpc_request_id, retry_of, reported_role, observed_role_ids, observed_protocol, inferred_client, inference_method, inference_confidence, inference_rule_version, error_category)
      VALUES
        (@ts, @userId, @tokenLabel, @tokenHashPrefix, @lucySessionId, @lucyTurnId, @turnAttributionMode, @turnAttributionConfidence, @turnAttributionReason, @associationStatus, @originalTurnId, @originalAttributionMode, @originalAssociationStatus, @originalAttributionConfidence, @originalReason, @effectiveTurnId, @effectiveAttributionMode, @effectiveAssociationStatus, @effectiveAttributionConfidence, @effectiveReason, @lucyPlatform, @client, @clientVersion, @clientIp, @clientForwardedFor, @userAgent, @deviceName, @tool, @tables, @argsSummary, @queryHash, @queryLength, @queryOperation, @queryPreview, @queryArtifactRef, @generatedSql, @outcome, @errorDetail, @durationMs, @responseBytes, @responseRowCount, @responseColumnCount, @responseTruncated, @requestId, @traceId, @roleIds, @permissionSnapshotHash, @effectiveTablesCount, @decisionReason, @policyVersion, @capabilityDigest, @skillUri, @skillVersion, @skillFileVersion, @skillAction, @skillRolesAllowed, @matchedRoleId, @compilerReason, @failureDimension, @appliedVersion, @appliedBusinessDate, @appliedValueKind, @actorId, @actorKind, @wikiInjectedKeys, @wikiVersions, @evalMark, @isSlowCall, @slowBasis, @resultEmpty, @turnWallClockMs, @reportedClient, @reportedClientVersion, @attemptId, @parentAttemptId, @eventType, @instanceId, @credentialPrincipalId, @classificationVersion, @attributionRuleVersion, @transportSubType, @transportStatus, @authorizationStatus, @executionStatus, @usabilityStatus, @primaryStatus, @derivationVersion, @deliveryStatus, @nullReason, @legacyOutcome, @digestKind, @digestVersion, @previewVersion, @ingressEventId, @endpointId, @ledgerSeq, @clientCallId, @clientEventId, @upstreamOperationId, @rpcRequestId, @retryOf, @reportedRole, @observedRoleIds, @observedProtocol, @inferredClient, @inferenceMethod, @inferenceConfidence, @inferenceRuleVersion, @errorCategory)
    `);
  }
  // B18: 生产写路径接入 v2p5-1 分类（读路径共用同一函数）。
  const classified = classifyAuditEvent({
    tool: entry.tool,
    outcome: entry.outcome,
    decisionReason: entry.decisionReason,
    failureDimension: entry.failureDimension,
    responseRowCount: entry.responseRowCount,
    responseBytes: entry.responseBytes,
    errorDetail: entry.errorDetail,
    eventTypeHint: entry.eventType,
    authorizationStatusHint: entry.associationStatus === "conflict" ? "unknown" : undefined,
    evidence: entry.executionEvidence
  });
  const result = insertStmt.run({
    ts: entry.ts,
    userId: entry.userId,
    tokenLabel: entry.tokenLabel ?? null,
    tokenHashPrefix: entry.tokenHashPrefix ?? null,
    lucySessionId: entry.lucySessionId ?? null,
    lucyTurnId: entry.lucyTurnId ?? null,
    turnAttributionMode: entry.turnAttributionMode ?? null,
    turnAttributionConfidence: entry.turnAttributionConfidence ?? null,
    turnAttributionReason: entry.turnAttributionReason ?? null,
    associationStatus: entry.associationStatus ?? null,
    originalTurnId: entry.originalTurnId ?? null,
    originalAttributionMode: entry.originalAttributionMode ?? null,
    originalAssociationStatus: entry.originalAssociationStatus ?? null,
    originalAttributionConfidence: entry.originalAttributionConfidence ?? null,
    originalReason: entry.originalReason ?? null,
    effectiveTurnId: entry.effectiveTurnId ?? null,
    effectiveAttributionMode: entry.effectiveAttributionMode ?? null,
    effectiveAssociationStatus: entry.effectiveAssociationStatus ?? null,
    effectiveAttributionConfidence: entry.effectiveAttributionConfidence ?? null,
    effectiveReason: entry.effectiveReason ?? null,
    lucyPlatform: entry.lucyPlatform ?? null,
    client: entry.client ?? null,
    clientVersion: entry.clientVersion ?? null,
    reportedClient: entry.reportedClient ?? null,
    reportedClientVersion: entry.reportedClientVersion ?? null,
    clientIp: entry.clientIp ?? null,
    clientForwardedFor: entry.clientForwardedFor ?? null,
    userAgent: entry.userAgent ?? null,
    deviceName: entry.deviceName ?? null,
    tool: entry.tool,
    tables: entry.tables ? JSON.stringify(entry.tables) : null,
    argsSummary: entry.argsSummary ? JSON.stringify(entry.argsSummary) : null,
    queryHash: entry.queryHash ?? null,
    queryLength: entry.queryLength ?? null,
    queryOperation: entry.queryOperation ?? null,
    queryPreview: entry.queryPreview ?? null,
    queryArtifactRef: entry.queryArtifactRef ?? null,
    generatedSql: entry.generatedSql ?? null,
    outcome: entry.outcome,
    errorDetail: entry.errorDetail ? truncateErrorDetail(entry.errorDetail) : null,
    durationMs: entry.durationMs,
    responseBytes: entry.responseBytes ?? null,
    responseRowCount: entry.responseRowCount ?? null,
    responseColumnCount: entry.responseColumnCount ?? null,
    responseTruncated: entry.responseTruncated === undefined ? null : (entry.responseTruncated ? 1 : 0),
    requestId: String(entry.requestId),
    traceId: entry.traceId ?? null,
    roleIds: entry.roleIds ? JSON.stringify(entry.roleIds) : null,
    permissionSnapshotHash: entry.permissionSnapshotHash ?? entry.permissionSnapshot?.hash ?? null,
    effectiveTablesCount: entry.effectiveTablesCount ?? null,
    decisionReason: entry.decisionReason ?? null,
    policyVersion: entry.policyVersion ?? null,
    capabilityDigest: entry.capabilityDigest
      ?? entry.permissionSnapshot?.capabilityDigest
      ?? null,
    skillUri: entry.skillUri ?? null,
    skillVersion: entry.skillVersion ?? null,
    skillFileVersion: entry.skillFileVersion ?? null,
    skillAction: entry.skillAction ?? null,
    skillRolesAllowed: entry.skillRolesAllowed ? JSON.stringify(entry.skillRolesAllowed) : null,
    matchedRoleId: entry.matchedRoleId ?? null,
    compilerReason: entry.compilerReason ?? null,
    failureDimension: entry.failureDimension ?? null,
    appliedVersion: entry.appliedVersion ?? null,
    appliedBusinessDate: entry.appliedBusinessDate ?? null,
    appliedValueKind: entry.appliedValueKind ?? null,
    actorId: entry.actorId ?? null,
    actorKind: entry.actorKind ?? null,
    wikiInjectedKeys: entry.wikiInjectedKeys ? JSON.stringify(entry.wikiInjectedKeys) : null,
    wikiVersions: entry.wikiVersions ? JSON.stringify(entry.wikiVersions) : null,
    evalMark: entry.evalMark === true ? 1 : 0,
    isSlowCall: entry.isSlowCall === true ? 1 : 0,
    slowBasis: entry.slowBasis ?? null,
    resultEmpty: entry.resultEmpty === true ? 1 : 0,
    turnWallClockMs: entry.turnWallClockMs ?? null,
    // ─── B8：此前声明但未写的列 ───────────────────────────────────────────
    attemptId: entry.attemptId ?? null,
    parentAttemptId: entry.parentAttemptId ?? null,
    eventType: entry.eventType ?? classified.eventType,
    instanceId: entry.instanceId ?? null,
    credentialPrincipalId: entry.credentialPrincipalId ?? null,
    classificationVersion: entry.classificationVersion ?? CLASSIFICATION_VERSION_V2P5,
    attributionRuleVersion: entry.attributionRuleVersion ?? null,
    // ─── B18：分类与派生结果（写 / 读路径同源）────────────────────────────
    transportSubType: classified.transportSubType,
    transportStatus: classified.transportStatus,
    authorizationStatus: classified.authorizationStatus,
    executionStatus: classified.executionStatus,
    usabilityStatus: classified.usabilityStatus,
    primaryStatus: classified.primaryStatus,
    derivationVersion: classified.derivationVersion,
    deliveryStatus: classified.deliveryStatus,
    nullReason: classified.nullReason,
    legacyOutcome: entry.outcome,
    errorCategory: classified.errorCategory ?? null,
    // ─── U11：摘要 / 预览版本 ────────────────────────────────────────────
    digestKind: entry.digestKind ?? null,
    digestVersion: entry.digestVersion ?? (entry.digestKind ? DIGEST_VERSION_V2P5 : null),
    previewVersion: entry.previewVersion ?? null,
    // ─── S02 / S03：入口与标识 ───────────────────────────────────────────
    ingressEventId: entry.ingressEventId ?? null,
    endpointId: entry.endpointId ?? null,
    ledgerSeq: entry.ledgerSeq ?? (await resolveLedgerSeq()),
    clientCallId: entry.clientCallId ?? null,
    clientEventId: entry.clientEventId ?? null,
    upstreamOperationId: entry.upstreamOperationId ?? null,
    rpcRequestId: entry.rpcRequestId ?? null,
    retryOf: entry.retryOf ?? null,
    // ─── S01(e)：三族分离 ────────────────────────────────────────────────
    reportedRole: entry.reportedRole ?? null,
    observedRoleIds: entry.observedRoleIds ? JSON.stringify(entry.observedRoleIds) : null,
    observedProtocol: entry.observedProtocol ?? null,
    inferredClient: entry.inferredClient ?? null,
    inferenceMethod: entry.inferenceMethod ?? null,
    inferenceConfidence: entry.inferenceConfidence ?? null,
    inferenceRuleVersion: entry.inferenceRuleVersion ?? null
  });
  return Number(result.lastInsertRowid);
}

/** Ensures the idempotent access-log migration completed before returning Skill bodies. */
export async function ensureSkillAuditReady(): Promise<void> {
  await getDb();
}

// ─── B16 / B24：预算四维的持久化存储 ────────────────────────────────────────
//
// 预算计数器此前**纯内存**，进程重启即清零（E-8）→ 重启即可绕过预算。
// 现在落库；`question-experience.ts` 的 `BudgetPersistence` 接口消费它。
//
// 四维：业务调用数 / 尝试次数 / 墙钟起点 / 并发占用峰值 + 当前值。
// 重连与省略 `begin_question` **不重置**任何一档（作用域键由调用方决定）。

const BUDGET_STATE_TABLE = `
CREATE TABLE IF NOT EXISTS question_budget_state (
  scope_key         TEXT PRIMARY KEY,
  started_at        INTEGER NOT NULL,
  origin_started_at INTEGER NOT NULL,
  calls             INTEGER NOT NULL DEFAULT 0,
  continuations     INTEGER NOT NULL DEFAULT 0,
  attempts          INTEGER NOT NULL DEFAULT 0,
  peak_concurrency  INTEGER NOT NULL DEFAULT 0,
  current_concurrency INTEGER NOT NULL DEFAULT 0,
  updated_at        INTEGER NOT NULL
);
`;

const BUDGET_STATE_COLUMNS = [
  ["busy_ms", "INTEGER NOT NULL DEFAULT 0"],
  ["round", "INTEGER NOT NULL DEFAULT 0"],
  ["turn_id", "TEXT"],
  ["window_id", "INTEGER NOT NULL DEFAULT 0"],
  ["pending_token", "TEXT"],
  ["presented_token", "TEXT"],
  ["archived_busy_json", "TEXT"]
] as const;

const BUDGET_IDEMPOTENCY_TABLE = `
CREATE TABLE IF NOT EXISTS question_budget_idempotency (
  scope_key TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  PRIMARY KEY (scope_key, idempotency_key)
);
`;

export type PersistedBudgetState = {
  startedAt: number;
  originStartedAt: number;
  calls: number;
  continuations: number;
  attempts: number;
  peakConcurrency: number;
  currentConcurrency: number;
  busyMs?: number;
  round?: number;
  turnId?: string | null;
  windowId?: number;
  pendingToken?: string | null;
  presentedToken?: string | null;
  archivedBusyMsByWindow?: Record<string, number>;
  scopeKey?: string | null;
};

let budgetTableReady = false;

async function ensureBudgetStateTable(database: Database.Database): Promise<void> {
  if (budgetTableReady) return;
  database.exec(BUDGET_STATE_TABLE);
  database.exec(BUDGET_IDEMPOTENCY_TABLE);
  for (const [column, definition] of BUDGET_STATE_COLUMNS) {
    ensureColumn(database, "question_budget_state", column, definition);
  }
  budgetTableReady = true;
}

/** 读取某个作用域的预算状态；不存在返回 null。 */
export async function loadBudgetState(
  scopeKey: string
): Promise<{ row: PersistedBudgetState; appliedKeys: string[] } | null> {
  const database = await getDb();
  await ensureBudgetStateTable(database);
  const row = database
    .prepare(
      `SELECT started_at, origin_started_at, calls, continuations, attempts,
              peak_concurrency, current_concurrency, busy_ms, round, turn_id,
              window_id, pending_token, presented_token, archived_busy_json
         FROM question_budget_state WHERE scope_key = ?`
    )
    .get(scopeKey) as
    | {
        started_at: number;
        origin_started_at: number;
        calls: number;
        continuations: number;
        attempts: number;
        peak_concurrency: number;
        current_concurrency: number;
        busy_ms: number | null;
        round: number | null;
        turn_id: string | null;
        window_id: number | null;
        pending_token: string | null;
        presented_token: string | null;
        archived_busy_json: string | null;
      }
    | undefined;
  if (!row) return null;
  let archived: Record<string, number> = {};
  if (row.archived_busy_json) {
    try {
      const parsed = JSON.parse(row.archived_busy_json) as Record<string, number>;
      if (parsed && typeof parsed === "object") archived = parsed;
    } catch {
      archived = {};
    }
  }
  const keys = database
    .prepare(`SELECT idempotency_key FROM question_budget_idempotency WHERE scope_key = ?`)
    .all(scopeKey) as Array<{ idempotency_key: string }>;
  return {
    row: {
      startedAt: row.started_at,
      originStartedAt: row.origin_started_at,
      calls: row.calls,
      continuations: row.continuations,
      attempts: row.attempts,
      peakConcurrency: row.peak_concurrency,
      currentConcurrency: row.current_concurrency,
      busyMs: row.busy_ms ?? 0,
      round: row.round ?? 0,
      turnId: row.turn_id,
      windowId: row.window_id ?? 0,
      pendingToken: row.pending_token,
      presentedToken: row.presented_token,
      archivedBusyMsByWindow: archived,
      scopeKey
    },
    appliedKeys: keys.map((entry) => entry.idempotency_key)
  };
}

/** 持久化预算状态。重复幂等键返回已提交行，不覆盖磁盘。 */
export async function saveBudgetState(
  scopeKey: string,
  state: PersistedBudgetState,
  idempotencyKey?: string
): Promise<{ row: PersistedBudgetState; appliedKeys: string[] }> {
  const database = await getDb();
  await ensureBudgetStateTable(database);
  const write = database.transaction(() => {
    if (idempotencyKey) {
      const existing = database
        .prepare(
          `SELECT 1 AS hit FROM question_budget_idempotency WHERE scope_key = ? AND idempotency_key = ?`
        )
        .get(scopeKey, idempotencyKey) as { hit: number } | undefined;
      if (existing) return;
    }
    database
      .prepare(
        `INSERT INTO question_budget_state
           (scope_key, started_at, origin_started_at, calls, continuations, attempts,
            peak_concurrency, current_concurrency, updated_at, busy_ms, round, turn_id,
            window_id, pending_token, presented_token, archived_busy_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(scope_key) DO UPDATE SET
           started_at = excluded.started_at,
           origin_started_at = excluded.origin_started_at,
           calls = excluded.calls,
           continuations = excluded.continuations,
           attempts = excluded.attempts,
           peak_concurrency = excluded.peak_concurrency,
           current_concurrency = excluded.current_concurrency,
           updated_at = excluded.updated_at,
           busy_ms = excluded.busy_ms,
           round = excluded.round,
           turn_id = excluded.turn_id,
           window_id = excluded.window_id,
           pending_token = excluded.pending_token,
           presented_token = excluded.presented_token,
           archived_busy_json = excluded.archived_busy_json`
      )
      .run(
        scopeKey,
        state.startedAt,
        state.originStartedAt,
        state.calls,
        state.continuations,
        state.attempts,
        state.peakConcurrency,
        state.currentConcurrency,
        Date.now(),
        state.busyMs ?? 0,
        state.round ?? 0,
        state.turnId ?? null,
        state.windowId ?? 0,
        state.pendingToken ?? null,
        state.presentedToken ?? null,
        JSON.stringify(state.archivedBusyMsByWindow ?? {})
      );
    if (idempotencyKey) {
      database
        .prepare(
          `INSERT INTO question_budget_idempotency (scope_key, idempotency_key) VALUES (?, ?)`
        )
        .run(scopeKey, idempotencyKey);
    }
  });
  write();
  const loaded = await loadBudgetState(scopeKey);
  if (!loaded || !("row" in loaded)) {
    throw new Error("question_budget_state_missing_after_save");
  }
  return loaded;
}

/** 列出所有已知预算作用域键（恢复 / 重建用）。 */
export async function listBudgetScopes(): Promise<string[]> {
  const database = await getDb();
  await ensureBudgetStateTable(database);
  const rows = database
    .prepare(`SELECT scope_key FROM question_budget_state ORDER BY scope_key ASC`)
    .all() as Array<{ scope_key: string }>;
  return rows.map((row) => row.scope_key);
}

export async function writeAuthFailureLog(entry: AuthFailureLogEntry): Promise<number> {
  const database = await getDb();
  const result = database
    .prepare(
      `INSERT INTO auth_failure_log
        (ts, reason, client_ip, user_agent, token_hash_prefix, user_id, token_label, request_id)
       VALUES
        (@ts, @reason, @clientIp, @userAgent, @tokenHashPrefix, @userId, @tokenLabel, @requestId)`
    )
    .run({
      ts: entry.ts,
      reason: entry.reason,
      clientIp: entry.clientIp ?? null,
      userAgent: entry.userAgent ?? null,
      tokenHashPrefix: entry.tokenHashPrefix ?? null,
      userId: entry.userId ?? null,
      tokenLabel: entry.tokenLabel ?? null,
      requestId: entry.requestId === undefined ? null : String(entry.requestId)
    });
  return Number(result.lastInsertRowid);
}

let sourceInsertStmt: Database.Statement | null = null;

export async function writeAccessLogSources(
  accessLogId: number,
  ts: string,
  userId: string,
  tool: string,
  sources: AccessLogSourceRecord[]
): Promise<void> {
  if (sources.length === 0) return;
  const database = await getDb();
  if (!sourceInsertStmt) {
    sourceInsertStmt = database.prepare(`
      INSERT INTO access_log_sources
        (access_log_id, ts, user_id, tool, connection_id, schema_name, source_name, physical_table, extraction_method, confidence, created_at, ledger_seq)
      VALUES
        (@accessLogId, @ts, @userId, @tool, @connectionId, @schemaName, @sourceName, @physicalTable, @extractionMethod, @confidence, @createdAt, @ledgerSeq)
    `);
  }
  // F-02：来源行同样带账本序号 —— 没有它，晚于 S 写入的来源行会被当前视图
  // 读到，成为混入的 >S 事实，关联维度就不可证明。
  const ledgerSeq = await resolveLedgerSeq();
  const createdAt = new Date().toISOString();
  for (const source of sources) {
    sourceInsertStmt.run({
      accessLogId,
      ts,
      userId,
      tool,
      connectionId: source.connectionId ?? null,
      schemaName: source.schemaName ?? null,
      sourceName: source.sourceName ?? null,
      physicalTable: source.physicalTable,
      extractionMethod: source.extractionMethod,
      confidence: source.confidence,
      createdAt,
      ledgerSeq
    });
  }
}

export async function backfillAccessLogSourcesFromTables(
  options: { sinceDays?: number; dryRun?: boolean } = {}
): Promise<{ scanned: number; inserted: number }> {
  const sinceDays = options.sinceDays ?? 7;
  const dryRun = options.dryRun ?? false;
  const database = await getDb();
  const cutoff = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();
  const rows = database.prepare(`
    SELECT al.id, al.ts, al.user_id, al.tool, al.tables
    FROM access_log al
    WHERE al.ts >= ?
      AND al.tables IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM access_log_sources als WHERE als.access_log_id = al.id)
  `).all(cutoff) as Array<{ id: number; ts: string; user_id: string; tool: string; tables: string }>;

  let inserted = 0;
  for (const row of rows) {
    let tables: string[];
    try {
      tables = JSON.parse(row.tables) as string[];
    } catch {
      continue;
    }
    if (!Array.isArray(tables) || tables.length === 0) continue;
    const refs = await resolveSourceRefsForTables(tables, {
      extractionMethod: "source_map_reverse",
      confidence: "medium"
    });
    if (refs.length === 0) continue;
    if (!dryRun) {
      await writeAccessLogSources(row.id, row.ts, row.user_id, row.tool, refs.map((ref) => ({
        connectionId: ref.connectionId,
        schemaName: ref.schema,
        sourceName: ref.sourceName,
        physicalTable: ref.physicalTable,
        extractionMethod: ref.extractionMethod,
        confidence: ref.confidence
      })));
    }
    inserted += refs.length;
  }

  return { scanned: rows.length, inserted };
}

export interface R1AuditObservability {
  window: {
    since: string;
    hours: number;
    slowMs: number;
  };
  traffic: {
    totalRequests: number;
    businessCalls: number;
    okCalls: number;
    errorCalls: number;
    deniedCalls: number;
    successRate: number;
    errorRate: number;
    deniedRate: number;
  };
  latency: {
    p50Ms: number | null;
    p95Ms: number | null;
    slowCalls: number;
    slowDefinition: {
      effectiveAt: string;
      callDurationMs: number;
      turnWallClockMs: number;
    };
    slowQueries: Array<{
      ts: string;
      userId: string;
      tool: string;
      durationMs: number;
      queryOperation?: string;
      queryPreview?: string;
      decisionReason?: string;
      requestId: string;
      slowBasis?: "call_duration" | "turn_wall_clock";
    }>;
    /** SC-20 — successful calls that returned zero rows. */
    emptyResults: number;
  };
  denials: Array<{ reason: string; count: number }>;
  sourceErrors: Array<{
    source: string;
    connectionId?: string;
    schemaName?: string;
    sourceName?: string;
    physicalTable: string;
    outcome: "error" | "denied";
    count: number;
  }>;
  usage: {
    tools: Array<{ tool: string; calls: number; denied: number; errors: number }>;
    roles: Array<{ roleId: string; calls: number; denied: number }>;
    tokens: Array<{ tokenLabel: string; tokenHashPrefix?: string; calls: number; denied: number }>;
    actors: Array<{ group: UsageGroup; calls: number }>;
    /** SC-16 — calls split out of the default view (eval-marked probes). */
    defaultViewExcluded: number;
  };
}

function rate(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index];
}

function parseRoleIds(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export async function readR1AuditObservability(options: { hours?: number; slowMs?: number } = {}): Promise<R1AuditObservability> {
  const hours = Math.min(Math.max(Math.floor(options.hours ?? 24), 1), 24 * 90);
  const slowMs = Math.max(Math.floor(options.slowMs ?? Number(process.env.LUCY_R1_SLOW_QUERY_MS ?? 30_000)), 1);
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const database = await getDb();

  const rows = database.prepare(`
    SELECT ts, user_id, token_label, token_hash_prefix, tool, outcome, duration_ms, request_id,
           role_ids, matched_role_id, decision_reason, query_operation, query_preview, tables,
           actor_id, actor_kind, client, args_summary, eval_mark, turn_wall_clock_ms, response_row_count
    FROM access_log
    WHERE ts >= ?
    ORDER BY ts DESC, id DESC
  `).all(since) as Array<{
    ts: string;
    user_id: string;
    token_label: string | null;
    token_hash_prefix: string | null;
    tool: string;
    outcome: "ok" | "error" | "denied";
    duration_ms: number;
    request_id: string;
    role_ids: string | null;
    matched_role_id: string | null;
    decision_reason: string | null;
    query_operation: string | null;
    query_preview: string | null;
    tables: string | null;
    actor_id: string | null;
    actor_kind: string | null;
    client: string | null;
    args_summary: string | null;
    eval_mark: number | null;
    turn_wall_clock_ms: number | null;
    response_row_count: number | null;
  }>;

  const businessRows = rows.filter((row) => !isMcpProtocolMethod(row.tool));
  // Spec 162 §7.6 / SC-16 — the default view drops protocol traffic and probe
  // calls that are BOTH name-matched and explicitly eval-marked. Raw rows stay
  // in access_log; only this default view is split.
  //
  // Spec 189 §4 — classify first, then split. The previous expression
  // (`defaultUsageExcluded(...) && !protocolTools.has(row.tool)`) re-derived
  // the probe set by subtracting a 3-method protocol list from an 8-method
  // one, so every protocol event outside that 3-method list was counted as
  // an eval probe.
  const usageClass = (row: { tool: string; eval_mark: number | null; args_summary: string | null }) =>
    classifyUsage({
      tool: row.tool,
      evalMark: row.eval_mark === 1,
      args: parseJsonObject(row.args_summary)
    });
  const defaultRows = businessRows.filter((row) => usageClass(row) === "default_usage");
  const evalProbeRows = businessRows.filter((row) => usageClass(row) === "eval_probe");
  const okCalls = defaultRows.filter((row) => row.outcome === "ok").length;
  const errorCalls = defaultRows.filter((row) => row.outcome === "error").length;
  const deniedCalls = defaultRows.filter((row) => row.outcome === "denied").length;
  const durations = defaultRows.map((row) => row.duration_ms).filter((value) => Number.isFinite(value));

  const denials = new Map<string, number>();
  const tools = new Map<string, { tool: string; calls: number; denied: number; errors: number }>();
  const roles = new Map<string, { roleId: string; calls: number; denied: number }>();
  const tokens = new Map<string, { tokenLabel: string; tokenHashPrefix?: string; calls: number; denied: number }>();
  const actors = new Map<UsageGroup, number>();

  for (const row of defaultRows) {
    if (row.outcome === "denied") {
      const reason = row.decision_reason ?? "unknown";
      denials.set(reason, (denials.get(reason) ?? 0) + 1);
    }

    const tool = tools.get(row.tool) ?? { tool: row.tool, calls: 0, denied: 0, errors: 0 };
    tool.calls += 1;
    if (row.outcome === "denied") tool.denied += 1;
    if (row.outcome === "error") tool.errors += 1;
    tools.set(row.tool, tool);

    // Spec 162 / SC-26 — calls still aggregate per role in `role_ids`, but a
    // denial is counted ONCE against `matched_role_id`. Counting it on every
    // role in `role_ids` inflates the dual-track comparison.
    const roleIds = parseRoleIds(row.role_ids);
    for (const roleId of roleIds) {
      const role = roles.get(roleId) ?? { roleId, calls: 0, denied: 0 };
      role.calls += 1;
      roles.set(roleId, role);
    }
    if (row.outcome === "denied") {
      const matchedRoleId = (row.matched_role_id ?? "").trim();
      const denialRoleId = matchedRoleId || UNMATCHED_ROLE_ID;
      const denialRole = roles.get(denialRoleId) ?? { roleId: denialRoleId, calls: 0, denied: 0 };
      denialRole.denied += 1;
      roles.set(denialRoleId, denialRole);
    }

    const tokenLabel = row.token_label ?? "unknown";
    const tokenKey = `${tokenLabel}:${row.token_hash_prefix ?? ""}`;
    const token = tokens.get(tokenKey) ?? { tokenLabel, tokenHashPrefix: row.token_hash_prefix ?? undefined, calls: 0, denied: 0 };
    token.calls += 1;
    if (row.outcome === "denied") token.denied += 1;
    tokens.set(tokenKey, token);

    const actorGroup = usageGroup({
      actorId: row.actor_id,
      actorKind: row.actor_kind,
      userId: row.user_id,
      client: row.client,
    });
    actors.set(actorGroup, (actors.get(actorGroup) ?? 0) + 1);
  }

  const slowQueries = defaultRows
    // Spec 162 §8 / SC-20 — usage slow mark: lucy_query at or above 5 seconds,
    // or any tool once the question wall clock reaches 120 seconds.
    // Spec 143's call monitor keeps its own threshold.
    .filter((row) => isSlowCall({
      tool: row.tool,
      durationMs: row.duration_ms,
      turnWallClockMs: row.turn_wall_clock_ms ?? null
    }).slow)
    .slice(0, 20)
    .map((row) => ({
      ts: row.ts,
      userId: row.user_id,
      tool: row.tool,
      durationMs: row.duration_ms,
      slowBasis: isSlowCall({
        tool: row.tool,
        durationMs: row.duration_ms,
        turnWallClockMs: row.turn_wall_clock_ms ?? null
      }).basis ?? undefined,
      queryOperation: row.query_operation ?? undefined,
      queryPreview: row.query_preview ?? undefined,
      decisionReason: row.decision_reason ?? undefined,
      requestId: row.request_id
    }));

  const sourceErrorRows = database.prepare(`
    SELECT
      COALESCE(als.connection_id, '') AS connection_id,
      COALESCE(als.schema_name, '') AS schema_name,
      COALESCE(als.source_name, '') AS source_name,
      als.physical_table,
      al.outcome,
      COUNT(*) AS count
    FROM access_log al
    JOIN access_log_sources als ON als.access_log_id = al.id
    WHERE al.ts >= ? AND al.outcome IN ('error', 'denied')
    GROUP BY als.connection_id, als.schema_name, als.source_name, als.physical_table, al.outcome
    ORDER BY count DESC
    LIMIT 20
  `).all(since) as Array<{
    connection_id: string;
    schema_name: string;
    source_name: string;
    physical_table: string;
    outcome: "error" | "denied";
    count: number;
  }>;

  return {
    window: { since, hours, slowMs },
    traffic: {
      totalRequests: rows.length,
      businessCalls: businessRows.length,
      okCalls,
      errorCalls,
      deniedCalls,
      successRate: rate(okCalls, defaultRows.length),
      errorRate: rate(errorCalls, defaultRows.length),
      deniedRate: rate(deniedCalls, defaultRows.length)
    },
    latency: {
      p50Ms: percentile(durations, 0.5),
      p95Ms: percentile(durations, 0.95),
      slowCalls: slowQueries.length,
      slowQueries,
      slowDefinition: {
        effectiveAt: SLOW_DEFINITION_EFFECTIVE_AT,
        callDurationMs: SLOW_CALL_MIN_DURATION_MS,
        turnWallClockMs: SLOW_TURN_WALL_CLOCK_MS
      },
      emptyResults: defaultRows.filter((row) => isEmptyResult({
        outcome: row.outcome,
        responseRowCount: row.response_row_count
      })).length
    },
    denials: [...denials.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20),
    sourceErrors: sourceErrorRows.map((row) => ({
      source: [row.connection_id, row.schema_name, row.source_name].filter(Boolean).join(".") || row.physical_table,
      connectionId: row.connection_id || undefined,
      schemaName: row.schema_name || undefined,
      sourceName: row.source_name || undefined,
      physicalTable: row.physical_table,
      outcome: row.outcome,
      count: row.count
    })),
    usage: {
      tools: [...tools.values()].sort((a, b) => b.calls - a.calls).slice(0, 30),
      roles: [...roles.values()].sort((a, b) => b.calls - a.calls).slice(0, 30),
      tokens: [...tokens.values()].sort((a, b) => b.calls - a.calls).slice(0, 30),
      actors: [...actors.entries()].map(([group, calls]) => ({ group, calls })).sort((a, b) => b.calls - a.calls),
      // SC-16 — split out of the default view, raw rows untouched.
      defaultViewExcluded: evalProbeRows.length
    }
  };
}

export type { CallMonitorRange } from "../../src/lib/callMonitorWindow.js";

export type CallMonitorSeriesPoint = {
  start: string;
  businessCalls: number;
  okCalls: number;
  errorCalls: number;
  deniedCalls: number;
  successRate: number | null;
  errorRate: number | null;
  deniedRate: number | null;
  p95Ms: number | null;
  slowCalls: number;
};

export type CallMonitorSnapshot = {
  generatedAt: string;
  window: {
    range: CallMonitorRange;
    timeZone: "Asia/Shanghai";
    bucket: "5m" | "hour" | "day";
    bucketCount: number;
    since: string;
    until: string;
    slowMs: number;
  };
  series: CallMonitorSeriesPoint[];
  traffic: {
    businessCalls: number;
    okCalls: number;
    errorCalls: number;
    deniedCalls: number;
    successRate: number;
    errorRate: number;
    deniedRate: number;
  };
  latency: {
    p50Ms: number | null;
    p95Ms: number | null;
    slowCalls: number;
  };
  slo: {
    thresholds: {
      p95LatencyMs: number;
      maxErrorRate: number;
      maxDeniedRate: number;
    };
    status: "ok" | "warn" | "no_data";
    violations: Array<"latency_p95" | "error_rate" | "denied_rate">;
  };
  topTools: Array<{ tool: string; calls: number; errors: number; denied: number }>;
  recentFailures: Array<{
    id: number;
    ts: string;
    tool: string;
    outcome: "error" | "denied";
    durationMs: number;
    userId: string;
    decisionReason?: string;
    requestId: string;
    traceId?: string;
  }>;
};

/** Spec 143 + Spec 165: MCP-only call monitor aggregate (no Eval / Hermes fields). */
export async function readCallMonitorSnapshot(options: {
  range?: CallMonitorRange;
  slowMs?: number;
  now?: Date;
} = {}): Promise<CallMonitorSnapshot> {
  const range = parseCallMonitorRange(options.range);
  const slowMs = Math.max(
    Math.floor(options.slowMs ?? Number(process.env.LUCY_OBSERVABILITY_SLOW_MS ?? 30_000)),
    1
  );
  const now = options.now ?? new Date();
  const plan = callMonitorWindow(range, now);
  const database = await getDb();

  const rows = database.prepare(`
    SELECT id, ts, user_id, tool, outcome, duration_ms, request_id, trace_id, decision_reason,
           eval_mark, args_summary
    FROM access_log
    WHERE ts >= ? AND ts <= ?
    ORDER BY ts DESC, id DESC
  `).all(plan.since, plan.until) as Array<{
    id: number;
    ts: string;
    user_id: string;
    tool: string;
    outcome: "ok" | "error" | "denied";
    duration_ms: number;
    request_id: string;
    trace_id: string | null;
    decision_reason: string | null;
    eval_mark: number | null;
    args_summary: string | null;
  }>;

  // Spec 189 §5.3 — every KPI, bucket, tool ranking, recent failure and
  // recent denial on this page is computed from the SAME Default Usage set.
  // Protocol events and default-view-excluded eval probes are excluded.
  const businessRows = rows.filter((row) =>
    classifyUsage({
      tool: row.tool,
      evalMark: row.eval_mark === 1,
      args: parseJsonObject(row.args_summary)
    }) === "default_usage"
    && callMonitorBucketIndex(row.ts, plan) >= 0
  );

  const bucketTotals = plan.buckets.map(() => ({
    businessCalls: 0,
    okCalls: 0,
    errorCalls: 0,
    deniedCalls: 0,
    slowCalls: 0,
    durations: [] as number[]
  }));
  const tools = new Map<string, { tool: string; calls: number; denied: number; errors: number }>();
  const durations: number[] = [];
  for (const row of businessRows) {
    const index = callMonitorBucketIndex(row.ts, plan);
    const bucket = bucketTotals[index];
    if (!bucket) continue;
    bucket.businessCalls += 1;
    if (row.outcome === "ok") bucket.okCalls += 1;
    if (row.outcome === "error") bucket.errorCalls += 1;
    if (row.outcome === "denied") bucket.deniedCalls += 1;
    if (row.duration_ms > slowMs) bucket.slowCalls += 1;
    if (Number.isFinite(row.duration_ms)) {
      bucket.durations.push(row.duration_ms);
      durations.push(row.duration_ms);
    }

    const tool = tools.get(row.tool) ?? { tool: row.tool, calls: 0, denied: 0, errors: 0 };
    tool.calls += 1;
    if (row.outcome === "denied") tool.denied += 1;
    if (row.outcome === "error") tool.errors += 1;
    tools.set(row.tool, tool);
  }

  const series = plan.buckets.map((bucket, index) => {
    const totals = bucketTotals[index] ?? {
      businessCalls: 0,
      okCalls: 0,
      errorCalls: 0,
      deniedCalls: 0,
      slowCalls: 0,
      durations: []
    };
    const hasCalls = totals.businessCalls > 0;
    return {
      start: bucket.start,
      businessCalls: totals.businessCalls,
      okCalls: totals.okCalls,
      errorCalls: totals.errorCalls,
      deniedCalls: totals.deniedCalls,
      successRate: hasCalls ? rate(totals.okCalls, totals.businessCalls) : null,
      errorRate: hasCalls ? rate(totals.errorCalls, totals.businessCalls) : null,
      deniedRate: hasCalls ? rate(totals.deniedCalls, totals.businessCalls) : null,
      p95Ms: totals.businessCalls >= CALL_MONITOR_P95_MIN_SAMPLES
        ? percentile(totals.durations, 0.95)
        : null,
      slowCalls: totals.slowCalls
    };
  });

  const okCalls = series.reduce((sum, point) => sum + point.okCalls, 0);
  const errorCalls = series.reduce((sum, point) => sum + point.errorCalls, 0);
  const deniedCalls = series.reduce((sum, point) => sum + point.deniedCalls, 0);
  const businessCalls = series.reduce((sum, point) => sum + point.businessCalls, 0);
  // Spec 143: slow call is strictly greater than slowMs (not capped by preview slice).
  const slowCalls = series.reduce((sum, point) => sum + point.slowCalls, 0);

  const recentFailures = businessRows
    .filter((row): row is typeof row & { outcome: "error" | "denied" } =>
      row.outcome === "error" || row.outcome === "denied")
    .slice(0, 20)
    .map((row) => ({
      id: row.id,
      ts: row.ts,
      tool: row.tool,
      outcome: row.outcome,
      durationMs: row.duration_ms,
      userId: row.user_id,
      decisionReason: row.decision_reason ?? undefined,
      requestId: row.request_id,
      traceId: row.trace_id ?? undefined
    }));

  const thresholds = {
    p95LatencyMs: slowMs,
    maxErrorRate: Number(process.env.LUCY_OBSERVABILITY_MAX_ERROR_RATE ?? 0.02),
    maxDeniedRate: Number(process.env.LUCY_OBSERVABILITY_MAX_DENIED_RATE ?? 0.1)
  };
  const p95Ms = percentile(durations, 0.95);
  const successRate = rate(okCalls, businessCalls);
  const errorRate = rate(errorCalls, businessCalls);
  const deniedRate = rate(deniedCalls, businessCalls);
  const violations: Array<"latency_p95" | "error_rate" | "denied_rate"> = [];
  let status: "ok" | "warn" | "no_data" = "ok";
  if (businessCalls <= 0) {
    status = "no_data";
  } else {
    if ((p95Ms ?? 0) > thresholds.p95LatencyMs) violations.push("latency_p95");
    if (errorRate > thresholds.maxErrorRate) violations.push("error_rate");
    if (deniedRate > thresholds.maxDeniedRate) violations.push("denied_rate");
    if (violations.length > 0) status = "warn";
  }

  return {
    generatedAt: now.toISOString(),
    window: {
      range: plan.range,
      timeZone: plan.timeZone,
      bucket: plan.bucket,
      bucketCount: plan.bucketCount,
      since: plan.since,
      until: plan.until,
      slowMs
    },
    series,
    traffic: {
      businessCalls,
      okCalls,
      errorCalls,
      deniedCalls,
      successRate,
      errorRate,
      deniedRate
    },
    latency: {
      p50Ms: percentile(durations, 0.5),
      p95Ms,
      slowCalls
    },
    slo: { thresholds, status, violations },
    topTools: [...tools.values()].sort((a, b) => b.calls - a.calls).slice(0, 10),
    recentFailures
  };
}

export async function searchAccessLogs(options: {
  hours?: number;
  trace?: string;
  source?: string;
  role?: string;
  outcome?: string;
  limit?: number;
} = {}): Promise<Array<{
  ts: string;
  userId: string;
  tool: string;
  outcome: string;
  durationMs: number;
  requestId: string;
  lucyTurnId?: string;
  lucySessionId?: string;
  roleIds?: string[];
  tables?: string[];
  queryOperation?: string;
  queryPreview?: string;
  decisionReason?: string;
}>> {
  const hours = Math.min(Math.max(Math.floor(options.hours ?? 24), 1), 24 * 90);
  const limit = Math.min(Math.max(Math.floor(options.limit ?? 50), 1), 200);
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const database = await getDb();
  const clauses = ["al.ts >= ?"];
  const params: unknown[] = [since];

  if (options.trace) {
    clauses.push("(al.lucy_turn_id = ? OR al.request_id = ? OR al.lucy_session_id = ?)");
    params.push(options.trace, options.trace, options.trace);
  }
  if (options.outcome) {
    clauses.push("al.outcome = ?");
    params.push(options.outcome);
  }
  if (options.role) {
    clauses.push("al.role_ids LIKE ?");
    params.push(`%${options.role}%`);
  }
  if (options.source) {
    clauses.push(`(
      al.tables LIKE ?
      OR EXISTS (
        SELECT 1 FROM access_log_sources als
        WHERE als.access_log_id = al.id
          AND (als.source_name LIKE ? OR als.physical_table LIKE ?)
      )
    )`);
    params.push(`%${options.source}%`, `%${options.source}%`, `%${options.source}%`);
  }
  params.push(limit);

  const rows = database.prepare(`
    SELECT al.ts, al.user_id, al.tool, al.outcome, al.duration_ms, al.request_id,
           al.lucy_turn_id, al.lucy_session_id, al.role_ids, al.tables,
           al.query_operation, al.query_preview, al.decision_reason
    FROM access_log al
    WHERE ${clauses.join(" AND ")}
    ORDER BY al.ts DESC, al.id DESC
    LIMIT ?
  `).all(...params) as Array<{
    ts: string;
    user_id: string;
    tool: string;
    outcome: string;
    duration_ms: number;
    request_id: string;
    lucy_turn_id: string | null;
    lucy_session_id: string | null;
    role_ids: string | null;
    tables: string | null;
    query_operation: string | null;
    query_preview: string | null;
    decision_reason: string | null;
  }>;

  return rows.map((row) => ({
    ts: row.ts,
    userId: row.user_id,
    tool: row.tool,
    outcome: row.outcome,
    durationMs: row.duration_ms,
    requestId: row.request_id,
    lucyTurnId: row.lucy_turn_id ?? undefined,
    lucySessionId: row.lucy_session_id ?? undefined,
    roleIds: parseRoleIds(row.role_ids),
    tables: parseJsonArray(row.tables),
    queryOperation: row.query_operation ?? undefined,
    queryPreview: row.query_preview ?? undefined,
    decisionReason: row.decision_reason ?? undefined
  }));
}

// ─── Phase 3: conversation_turns (optional reported questions) ──────────────

export interface ConversationTurnRecord {
  turnId: string;
  sessionId?: string;
  userId: string;
  tokenHashPrefix?: string;
  platform?: string;
  client?: string;
  questionHash?: string;
  questionPreview?: string;
  questionSummary?: string;
  questionSource: string;
  redactionVersion?: string;
}

let conversationTurnInsertStmt: Database.Statement | null = null;

export async function writeConversationTurn(record: ConversationTurnRecord): Promise<void> {
  const database = await getDb();
  if (!conversationTurnInsertStmt) {
    conversationTurnInsertStmt = database.prepare(`
      INSERT INTO conversation_turns
        (turn_id, session_id, user_id, token_hash_prefix, platform, client, question_hash, question_preview, question_summary, question_source, redaction_version, created_at)
      VALUES
        (@turnId, @sessionId, @userId, @tokenHashPrefix, @platform, @client, @questionHash, @questionPreview, @questionSummary, @questionSource, @redactionVersion, @createdAt)
    `);
  }
  conversationTurnInsertStmt.run({
    turnId: record.turnId,
    sessionId: record.sessionId ?? null,
    userId: record.userId,
    tokenHashPrefix: record.tokenHashPrefix ?? null,
    platform: record.platform ?? null,
    client: record.client ?? null,
    questionHash: record.questionHash ?? null,
    questionPreview: record.questionPreview ?? null,
    questionSummary: record.questionSummary ?? null,
    questionSource: record.questionSource,
    redactionVersion: record.redactionVersion ?? null,
    createdAt: new Date().toISOString()
  });
}

export async function purgeExpiredConversationTurns(
  options: { retentionDays?: number; dryRun?: boolean } = {}
): Promise<{ scanned: number; purged: number }> {
  const retentionDays = options.retentionDays ?? Number(process.env.LUCY_QUESTION_PREVIEW_RETENTION_DAYS ?? 30);
  const dryRun = options.dryRun ?? false;
  const database = await getDb();
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const rows = database.prepare(`
    SELECT turn_id FROM conversation_turns
    WHERE created_at < ? AND (question_preview IS NOT NULL OR question_summary IS NOT NULL OR question_hash IS NOT NULL)
  `).all(cutoff) as Array<{ turn_id: string }>;

  if (!dryRun && rows.length > 0) {
    const purgeStmt = database.prepare(`
      UPDATE conversation_turns SET question_preview = NULL, question_summary = NULL, question_hash = NULL
      WHERE turn_id = ?
    `);
    const purgeAll = database.transaction((turnIds: string[]) => {
      for (const turnId of turnIds) purgeStmt.run(turnId);
    });
    purgeAll(rows.map((row) => row.turn_id));
  }

  return { scanned: rows.length, purged: dryRun ? 0 : rows.length };
}

/** Spec 137: remove raw `question` from historical access_log.args_summary. */
export async function scrubAccessLogArgsSummaries(
  options: { dryRun?: boolean; actor?: string; reason?: string; requestId?: string } = {}
): Promise<{
  scanned: number;
  matched: number;
  updated: number;
  algorithmVersion: string;
  beforeDigest: string;
  afterDigest: string;
  maintenanceEventId?: number;
}> {
  const dryRun = options.dryRun !== false;
  const algorithmVersion = "audit-args-summary-scrub/v2";
  const database = await getDb();
  const rows = database
    .prepare(`SELECT id, args_summary FROM access_log WHERE args_summary IS NOT NULL ORDER BY id`)
    .all() as Array<{ id: number; args_summary: string }>;

  const updates: Array<{ id: number; before: string; next: string }> = [];
  for (const row of rows) {
    const result = scrubArgsSummaryJson(row.args_summary);
    if (!result.changed || result.nextJson == null) continue;
    updates.push({ id: row.id, before: row.args_summary, next: result.nextJson });
  }
  const digest = (values: Array<{ id: number; value: string }>) => createHash("sha256")
    .update(JSON.stringify(values))
    .digest("hex");
  const beforeDigest = digest(updates.map((item) => ({ id: item.id, value: item.before })));
  const afterDigest = digest(updates.map((item) => ({ id: item.id, value: item.next })));

  let maintenanceEventId: number | undefined;
  if (!dryRun && updates.length > 0) {
    const stmt = database.prepare(`UPDATE access_log SET args_summary = ? WHERE id = ?`);
    const maintenance = database.prepare(`
      INSERT INTO audit_maintenance_log
        (ts, event_type, actor, reason, request_id, algorithm_version, scanned, matched, updated, before_digest, after_digest)
      VALUES
        (@ts, @eventType, @actor, @reason, @requestId, @algorithmVersion, @scanned, @matched, @updated, @beforeDigest, @afterDigest)
    `);
    const apply = database.transaction((items: Array<{ id: number; before: string; next: string }>) => {
      for (const item of items) stmt.run(item.next, item.id);
      return maintenance.run({
        ts: new Date().toISOString(),
        eventType: "access_log_args_summary_scrub",
        actor: options.actor?.trim() || "system",
        reason: options.reason?.trim() || "privacy_hardening",
        requestId: options.requestId?.trim() || null,
        algorithmVersion,
        scanned: rows.length,
        matched: items.length,
        updated: items.length,
        beforeDigest,
        afterDigest
      });
    });
    const result = apply(updates);
    maintenanceEventId = Number(result.lastInsertRowid);
  }

  return {
    scanned: rows.length,
    matched: updates.length,
    updated: dryRun ? 0 : updates.length,
    algorithmVersion,
    beforeDigest,
    afterDigest,
    ...(maintenanceEventId === undefined ? {} : { maintenanceEventId })
  };
}

// ─── Phase 2: inferred_turns (lazy-rebuilt call clustering) ──────────────────

interface SourceSummaryEntry {
  connectionId?: string;
  schema?: string;
  sourceName?: string;
  physicalTable: string;
}

/** Spec 173 v0.2: an inferred inquiry has no reported question. Tables stay on the source rows. */
export const UNREPORTED_QUESTION_SUMMARY = "未上报问询原文";

/** Spec 172: page windows filter display only. Rebuild always covers the longest audit preset. */
export const INFERRED_TURN_REBUILD_LOOKBACK_HOURS = 24 * 30;
/**
 * Spec 173 v0.3 / 2026-10-19 audit-trust: 120 秒近邻回绑已作废。
 * 此常量保留仅为兼容历史 import；`bindPriorSessionCalls` 不再按此窗口回填 `lucy_turn_id`。
 * 新代码不得读取本常量；新建会话归因见 `TurnCorrelationRegistry` 与 admission-time freeze。
 * 历史值 120_000 仅作废声明，不在伪代码中出现。
 *
 * @deprecated since Spec 173 v0.3. 撤销依据见 inbox/audit-trust/.../T00-r2/RESPONSE.md §G0-02。
 */
export const PRIOR_CALL_BIND_MS = 120_000;
export const SESSION_VISIT_SUMMARY_PREFIX = "会话建立：";

/**
 * Spec 173 / WO-202610-24 + Spec 189: these calls stay in the call log and do
 * not form an inquiry by themselves. The lists are **derived** from the shared
 * usage classification module — a local copy would be a second, drift-prone
 * protocol list.
 *
 * The inquiry-probe set is the transport probe set plus the named service
 * protocol methods, so `server/discover` keeps its Spec 172/173 meaning and
 * `prompts/list` joins it (listing prompts must not form an inquiry).
 */
const PROBE_TOOLS = new Set<string>([...MCP_PROBE_METHODS, ...MCP_SERVER_METHODS]);
const HANDSHAKE_TOOLS = MCP_HANDSHAKE_METHODS;
const SERVER_METHODS = new Set<string>(MCP_SERVER_METHODS);

export function sessionVisitSummary(client: string | null | undefined): string {
  const name = client?.trim() || "未知客户端";
  return `${SESSION_VISIT_SUMMARY_PREFIX}${name}`;
}

export function inferredTurnId(userId: string, firstAccessLogId: number): string {
  return `inf_${userId}_${firstAccessLogId}`;
}

type ClusterLogRow = {
  id: number;
  ts: string;
  tool: string;
  tables: string | null;
  args_summary: string | null;
  policy_version: string | null;
  permission_snapshot_hash: string | null;
  lucy_session_id: string | null;
  lucy_turn_id: string | null;
  client: string | null;
  client_version: string | null;
  user_agent: string | null;
};

function sessionKeyOf(row: { lucy_session_id: string | null }): string {
  return row.lucy_session_id?.trim() || "";
}

function clusterBusinessRows(rows: ClusterLogRow[], gapMs: number): ClusterLogRow[][] {
  const clusters: ClusterLogRow[][] = [];
  let current: ClusterLogRow[] = [];
  let lastTs = 0;
  let lastPolicyVersion: string | null | undefined;
  let lastPermissionSnapshot: string | null | undefined;
  for (const row of rows) {
    const t = new Date(row.ts).getTime();
    const policyChanged =
      current.length > 0
      && (
        (row.policy_version ?? null) !== (lastPolicyVersion ?? null)
        || (row.permission_snapshot_hash ?? null) !== (lastPermissionSnapshot ?? null)
      );
    if (current.length > 0 && (t - lastTs > gapMs || policyChanged)) {
      clusters.push(current);
      current = [];
    }
    current.push(row);
    lastTs = t;
    lastPolicyVersion = row.policy_version;
    lastPermissionSnapshot = row.permission_snapshot_hash;
  }
  if (current.length > 0) clusters.push(current);
  return clusters;
}

function firstHandshakeBySession(rows: ClusterLogRow[]): Map<string, ClusterLogRow[]> {
  const picked = new Map<string, Map<string, ClusterLogRow>>();
  for (const row of rows) {
    const sessionId = sessionKeyOf(row);
    if (!sessionId) continue;
    if (row.lucy_turn_id?.trim()) continue;
    if (!HANDSHAKE_TOOLS.includes(row.tool as (typeof HANDSHAKE_TOOLS)[number])) continue;
    let tools = picked.get(sessionId);
    if (!tools) {
      tools = new Map();
      picked.set(sessionId, tools);
    }
    if (!tools.has(row.tool)) tools.set(row.tool, row);
  }
  const result = new Map<string, ClusterLogRow[]>();
  for (const [sessionId, tools] of picked) {
    result.set(sessionId, [...tools.values()].sort((a, b) => a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.id - b.id));
  }
  return result;
}

function displayedClientName(row: ClusterLogRow): string | null {
  return resolveClientIdentity({
    client: row.client,
    clientVersion: row.client_version,
    userAgent: row.user_agent
  }).client ?? null;
}

function clientFromRows(rows: ClusterLogRow[]): string | null {
  const initialize = rows.find((row) => row.tool === "initialize");
  const fromInitialize = initialize ? displayedClientName(initialize) : null;
  if (fromInitialize) return fromInitialize;
  for (const row of rows) {
    const name = displayedClientName(row);
    if (name) return name;
  }
  return null;
}

export async function rebuildInferredTurns(
  userId: string,
  options: { lookbackHours?: number; gapMs?: number; includeCatalogOnly?: boolean } = {}
): Promise<{ turns: number }> {
  const lookbackHours = options.lookbackHours ?? Number(process.env.LUCY_TURN_INFER_LOOKBACK_HOURS ?? INFERRED_TURN_REBUILD_LOOKBACK_HOURS);
  const gapMs = options.gapMs ?? Number(process.env.LUCY_TURN_INFER_GAP_MS ?? 120_000);
  const includeCatalogOnly = options.includeCatalogOnly ?? (process.env.LUCY_TURN_INFER_INCLUDE_CATALOG_ONLY === "true");
  const database = await getDb();
  const cutoff = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();

  const loaded = database.prepare(`
    SELECT id, ts, tool, tables, args_summary, policy_version, permission_snapshot_hash, lucy_session_id, lucy_turn_id, client, client_version, user_agent
    FROM access_log
    WHERE user_id = ? AND ts >= ?
    ORDER BY ts ASC, id ASC
  `).all(userId, cutoff) as ClusterLogRow[];

  const business = loaded.filter((row) =>
    !isMcpProtocolMethod(row.tool)
    && !row.lucy_turn_id?.trim()
  );
  const handshake = firstHandshakeBySession(loaded);
  const bySession = new Map<string, ClusterLogRow[]>();
  for (const row of business) {
    const key = sessionKeyOf(row);
    const group = bySession.get(key);
    if (group) group.push(row);
    else bySession.set(key, [row]);
  }

  type BuiltCluster = {
    business: ClusterLogRow[];
    handshake: ClusterLogRow[];
    sessionId: string | null;
    summaryOverride?: string;
  };
  const built: BuiltCluster[] = [];
  const sessionsWithBusiness = new Set<string>();
  for (const [sessionId, group] of bySession) {
    for (const cluster of clusterBusinessRows(group, gapMs)) {
      const noSessionCatalog = sessionId === "" && cluster.every((row) => row.tool === "kx_catalog");
      if (noSessionCatalog && !includeCatalogOnly) continue;
      if (cluster.every((row) => PROBE_TOOLS.has(row.tool))) continue;
      if (sessionId) sessionsWithBusiness.add(sessionId);
      built.push({
        business: cluster,
        handshake: [],
        sessionId: sessionId || null
      });
    }
  }
  const earliestBySession = new Map<string, BuiltCluster>();
  for (const cluster of built) {
    if (!cluster.sessionId || earliestBySession.has(cluster.sessionId)) continue;
    earliestBySession.set(cluster.sessionId, cluster);
  }
  for (const [sessionId, cluster] of earliestBySession) {
    cluster.handshake = handshake.get(sessionId) ?? [];
  }
  for (const [sessionId, rows] of handshake) {
    if (sessionsWithBusiness.has(sessionId)) continue;
    built.push({
      business: [],
      handshake: rows,
      sessionId,
      summaryOverride: sessionVisitSummary(clientFromRows(rows))
    });
  }

  const deleteAccessLogsStmt = database.prepare(`
    DELETE FROM inferred_turn_access_logs
    WHERE inferred_turn_id IN (SELECT inferred_turn_id FROM inferred_turns WHERE user_id = ? AND started_at >= ?)
  `);
  const deleteTurnsStmt = database.prepare(`DELETE FROM inferred_turns WHERE user_id = ? AND started_at >= ?`);
  const insertTurnStmt = database.prepare(`
    INSERT INTO inferred_turns
      (inferred_turn_id, user_id, started_at, ended_at, call_count, business_call_count, tool_summary, source_summary, question_summary, confidence, evidence_json, client, session_id, created_at, updated_at)
    VALUES
      (@id, @userId, @startedAt, @endedAt, @callCount, @businessCallCount, @toolSummary, @sourceSummary, @questionSummary, @confidence, @evidenceJson, @client, @sessionId, @createdAt, @updatedAt)
  `);
  const insertLinkStmt = database.prepare(`INSERT INTO inferred_turn_access_logs (inferred_turn_id, access_log_id) VALUES (?, ?)`);
  const sourceQueryCache = new Map<string, Array<{ connection_id: string | null; schema_name: string | null; source_name: string | null; physical_table: string }>>();

  function sourcesFor(accessLogIds: number[]): Array<{ connection_id: string | null; schema_name: string | null; source_name: string | null; physical_table: string }> {
    if (accessLogIds.length === 0) return [];
    const key = accessLogIds.join(",");
    const cached = sourceQueryCache.get(key);
    if (cached) return cached;
    const result = database.prepare(`
      SELECT DISTINCT connection_id, schema_name, source_name, physical_table
      FROM access_log_sources
      WHERE access_log_id IN (${accessLogIds.map(() => "?").join(",")})
    `).all(...accessLogIds) as Array<{ connection_id: string | null; schema_name: string | null; source_name: string | null; physical_table: string }>;
    sourceQueryCache.set(key, result);
    return result;
  }

  const rebuild = database.transaction((): number => {
    deleteAccessLogsStmt.run(userId, cutoff);
    deleteTurnsStmt.run(userId, cutoff);

    let written = 0;
    for (const cluster of built) {
      const members = [...cluster.handshake, ...cluster.business].sort((a, b) => a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.id - b.id);
      if (members.length === 0) continue;
      const anchor = cluster.business[0] ?? members[0];
      const accessLogIds = members.map((row) => row.id);
      const businessRows = cluster.business.filter((row) => row.tables !== null);
      const dataBearing = businessRows.length > 0;
      const toolSummary = [...new Set(members.map((row) => row.tool))];
      const sourceRows = sourcesFor(cluster.business.map((row) => row.id));
      const sourceSummary: SourceSummaryEntry[] = sourceRows.map((row) => ({
        connectionId: row.connection_id ?? undefined,
        schema: row.schema_name ?? undefined,
        sourceName: row.source_name ?? undefined,
        physicalTable: row.physical_table
      }));
      const confidence: "medium" | "low" = dataBearing ? "medium" : "low";
      const questionSummary = cluster.summaryOverride ?? UNREPORTED_QUESTION_SUMMARY;
      const now = new Date().toISOString();
      const startedAt = members[0].ts;
      const endedAt = members[members.length - 1].ts;
      const inferredId = inferredTurnId(userId, anchor.id);
      const client = clientFromRows(members);

      insertTurnStmt.run({
        id: inferredId,
        userId,
        startedAt,
        endedAt,
        callCount: members.length,
        businessCallCount: businessRows.length,
        toolSummary: JSON.stringify(toolSummary),
        sourceSummary: JSON.stringify(sourceSummary),
        questionSummary,
        confidence,
        evidenceJson: JSON.stringify({
          accessLogIds,
          toolSummary,
          sourceSummary,
          callCount: members.length,
          businessCallCount: businessRows.length,
          sessionId: cluster.sessionId
        }),
        client,
        sessionId: cluster.sessionId,
        createdAt: now,
        updatedAt: now
      });
      for (const accessLogId of accessLogIds) {
        insertLinkStmt.run(inferredId, accessLogId);
      }
      written += 1;
    }
    return written;
  });

  const turns = rebuild();
  return { turns };
}

/**
 * Spec 173 v0.3 / 2026-10-19 audit-trust: 120 秒近邻回绑已撤销。
 * 本函数仅做会话握手 attachment（`initialize` / `notifications/initialized` / `tools/list`），
 * 不再按任何时间窗回填非协议调用。握手 attachment 不进入 `confirmed` 分母；
 * 标记为 `association_status = candidate` + `turn_attribution_confidence = low`。
 *
 * 返回值 = 受影响行数（仅握手）。`prior` 路径在 v0.3 删除；旧的 `Number(prior.changes)` 已改为常量 0。
 *
 * 撤销依据：inbox/audit-trust/audit-trust-2026-10-19-r1/T00-r2/RESPONSE.md §G0-02 / §G0-04。
 * 验收：EA-02 / EA-03 / EA-04 / EA-07。
 */
export async function bindPriorSessionCalls(input: {
  turnId: string;
  userId: string;
  tokenHashPrefix?: string;
  sessionId?: string;
  at: string;
}): Promise<number> {
  if (!input.sessionId) return 0;
  const database = await getDb();
  const tokenHash = input.tokenHashPrefix ?? "";
  const protocolList = protocolMethodSqlList();

  // F-02：归属就地改写必须留下**前像**与账本序号，否则「归属有效值是否可按
  // S 精确重建」不可证明（Spec §18.10 F-02）。改写与登记在同一事务内：
  // 登记失败则改写一并回滚，不留「改写了却没有历史」的状态。
  const ledgerSeq = await resolveLedgerSeq();
  const journaled = hasAttributionMutationTable(database);

  // Spec 162 §6.5 / SC-33：握手回填在**事务内**重新检查「仍未归属」，
  // 只为**实际被更新**的行记录前像。SELECT 与 UPDATE 带同一谓词且同事务，
  // 因此不会出现「查到的行已被别的轮次绑定，还要再绑一次」。
  const apply = database.transaction(() => {
    // v0.3: 不再按 PRIOR_CALL_BIND_MS 窗口回填非协议调用；保留 handshake attachment 但 candidate/low。
    const handshakeRows = database.prepare(`
      SELECT id, tool FROM access_log
      WHERE user_id = ?
        AND lucy_session_id = ?
        AND IFNULL(token_hash_prefix, '') = ?
        AND tool IN (${protocolList})
        AND (lucy_turn_id IS NULL OR lucy_turn_id = '')
      ORDER BY ts ASC, id ASC
    `).all(input.userId, input.sessionId, tokenHash) as Array<{ id: number; tool: string }>;
    const seen = new Set<string>();
    const handshakeIds: number[] = [];
    for (const row of handshakeRows) {
      if (seen.has(row.tool)) continue;
      seen.add(row.tool);
      handshakeIds.push(row.id);
    }
    if (handshakeIds.length === 0) return 0;
    const placeholders = handshakeIds.map(() => "?").join(",");
    const beforeRows = (
      database
        .prepare(
          `SELECT id, lucy_turn_id, turn_attribution_mode, turn_attribution_confidence, association_status
             FROM access_log WHERE id IN (${placeholders})
               AND (lucy_turn_id IS NULL OR lucy_turn_id = '')`
        )
        .all(...handshakeIds) as Array<{
        id: number;
        lucy_turn_id: string | null;
        turn_attribution_mode: string | null;
        turn_attribution_confidence: string | null;
        association_status: string | null;
      }>
    );
    database
      .prepare(`
        UPDATE access_log
        SET lucy_turn_id = ?,
            turn_attribution_mode = 'session_bound',
            turn_attribution_confidence = 'low'
        WHERE id IN (${placeholders})
          AND (lucy_turn_id IS NULL OR lucy_turn_id = '')
      `)
      .run(input.turnId, ...handshakeIds);
    if (journaled) {
      for (const row of beforeRows) {
        recordAttributionMutation(database, {
          accessLogId: row.id,
          kind: "handshake_attachment",
          ledgerSeq,
          before: {
            turnId: row.lucy_turn_id,
            mode: row.turn_attribution_mode,
            confidence: row.turn_attribution_confidence,
            associationStatus: row.association_status
          },
          after: {
            turnId: input.turnId,
            mode: "session_bound",
            confidence: "low",
            associationStatus: row.association_status
          }
        });
      }
    }
    return beforeRows.length;
  });
  return apply();
}

// ─── T03a: association_status backfill (audit-trust-2026-10-19-r1) ─────────
//
// Contract `inbox/audit-trust/audit-trust-2026-10-19-r1/T00-r2/implementation-contract.md`
// §3.1 迁移执行顺序 step 2 / §2.1 撤销规则 5:历史行不造当前身份.
//
// Mapping (per-row, deterministic, idempotent):
//   - turn_attribution_mode = 'session_bound' AND association_status IS NULL
//       → 'legacy_unverified'      (旧 auto 归因;不允许静默升级 confirmed)
//   - turn_attribution_mode = 'explicit'     AND explicit_turn_validated = 1
//       → 'confirmed'              (历史已校验的显式 turn)
//   - turn_attribution_mode = 'unassigned'  (无论 association_status)
//       → 'unassigned'             (无显式 turn;保持 unassigned;NULL 也合法)
//   - turn_attribution_mode = 'explicit'     AND explicit_turn_validated = 0
//       → 'conflict'               (显式 turn 校验失败)
//
// Note: the column `reference_doc` (NOT `references`) — `references` is a SQLite
// reserved word used in FOREIGN KEY syntax.
//
// Hard constraints (per §3.1 step 2):
//   - 不写 instance_id / instance_start_generation (历史行保持 NULL)
//   - 不默认 event_type='tool_call' / authorization_status='not_evaluated'
//   - 不重写原始 ledger 行;只 UPDATE association_status 列
//   - 输出 affected / failed / skipped 计数 + SHA-256;调用方负责持久化到 audit_meta.
//
// The function is pure: caller opens db (live or temp copy), runs, then either
// commits and writes audit_meta + security_events canonical ledger entry, or
// rolls back by closing the temp DB without persisting.

export type BackfillAssociationStatusResult = {
  schemaVersion: number;
  scanned: number;
  updated: number;
  unchanged: number;
  byMode: Record<string, number>;
  byResult: Record<string, number>;
  affectedRows: number;
};

export async function backfillAssociationStatus(
  database: Database.Database
): Promise<BackfillAssociationStatusResult> {
  const scanned = (database
    .prepare("SELECT COUNT(*) AS n FROM access_log")
    .get() as { n: number }).n;

  const byMode: Record<string, number> = Object.create(null);
  const byResult: Record<string, number> = Object.create(null);
  let updated = 0;
  let unchanged = 0;

  // F-02：归属就地改写必须留下前像与账本序号（与改写同事务）。
  const ledgerSeq = await resolveLedgerSeq();
  const journaled = hasAttributionMutationTable(database);

  const txn = database.transaction(() => {
    // 历史库 / 精简测试 schema 可能缺归属列：按实际可用列取，缺列取 NULL。
    const availableColumns = new Set(
      (
        database.prepare(`PRAGMA table_info(access_log)`).all() as Array<{ name: string }>
      ).map((column) => column.name)
    );
    const pick = (name: string): string => (availableColumns.has(name) ? name : `NULL AS ${name}`);
    const rows = database
      .prepare(
        `SELECT id, ${pick("lucy_turn_id")}, ${pick("turn_attribution_mode")},
                ${pick("turn_attribution_confidence")}, ${pick("association_status")}
           FROM access_log`
      )
      .all() as Array<{
      id: number;
      lucy_turn_id: string | null;
      turn_attribution_mode: string | null;
      turn_attribution_confidence: string | null;
      association_status: string | null;
    }>;

    for (const row of rows) {
      const mode = row.turn_attribution_mode ?? "<null>";
      byMode[mode] = (byMode[mode] ?? 0) + 1;

      let target: string | null;
      // 历史 explicit 已校验: schema 在 access_log 上有 explicit_turn_validated 列;
      // 若不存在则视为 legacy_unverified,避免静默升级 confirmed.
      if (mode === "session_bound") {
        target = "legacy_unverified";
      } else if (mode === "unassigned") {
        target = row.association_status ?? "unassigned";
      } else if (mode === "explicit") {
        const validated = (database
          .prepare(
            `SELECT 1 FROM pragma_table_info('access_log') WHERE name = 'explicit_turn_validated'`
          )
          .get() as { 1: number } | undefined);
        if (!validated) {
          target = "legacy_unverified";
        } else {
          const flag = (database
            .prepare(
              `SELECT explicit_turn_validated AS v FROM access_log WHERE id = ?`
            )
            .get(row.id) as { v: number | null } | undefined);
          // NULL = no validation recorded → legacy_unverified (no silent upgrade).
          // 1 = validated → confirmed. 0 = invalidated → conflict.
          target = flag?.v === 1 ? "confirmed" : flag?.v === 0 ? "conflict" : "legacy_unverified";
        }
      } else {
        // 'identity_inferred' 或 其他;按 contract 视为非显式候选 → unassigned.
        target = "unassigned";
      }

      byResult[target] = (byResult[target] ?? 0) + 1;
      if (row.association_status === target) {
        unchanged += 1;
        continue;
      }
      database
        .prepare(
          `UPDATE access_log SET association_status = ? WHERE id = ?`
        )
        .run(target, row.id);
      if (journaled) {
        recordAttributionMutation(database, {
          accessLogId: row.id,
          kind: "association_status_backfill",
          ledgerSeq,
          // 本次归一化只改 association_status；其余归属列原样登记（前像 = 后像）。
          before: {
            turnId: row.lucy_turn_id ?? null,
            mode: row.turn_attribution_mode ?? null,
            confidence: row.turn_attribution_confidence ?? null,
            associationStatus: row.association_status ?? null
          },
          after: {
            turnId: row.lucy_turn_id ?? null,
            mode: row.turn_attribution_mode ?? null,
            confidence: row.turn_attribution_confidence ?? null,
            associationStatus: target
          }
        });
      }
      updated += 1;
    }

    // conversation_turns: 同样规则基于其 turn_id 上的显式登记 (question_source='reported').
    const ctRows = database
      .prepare(
        `SELECT turn_id, question_source, association_status FROM conversation_turns`
      )
      .all() as Array<{
      turn_id: string;
      question_source: string;
      association_status: string | null;
    }>;
    for (const row of ctRows) {
      const target = row.question_source === "reported" ? "confirmed" : "unassigned";
      if (row.association_status === target) continue;
      database
        .prepare(`UPDATE conversation_turns SET association_status = ? WHERE turn_id = ?`)
        .run(target, row.turn_id);
      updated += 1; // T03a G3: count conversation_turns updates in total affectedRows.
    }
  });
  txn();

  const schemaVersion = AUDIT_DB_SCHEMA_VERSION;

  return {
    schemaVersion,
    scanned,
    updated,
    unchanged,
    byMode,
    byResult,
    affectedRows: updated
  };
}

/**
 * Persist a backfill run into audit_meta + write a security_events canonical
 * ledger entry. Idempotent on `audit_db_schema_version`.
 */
export async function recordBackfillRun(input: {
  database: Database.Database;
  result: BackfillAssociationStatusResult;
  migrationText: string;
  classificationVersion: string;
  digestVersion: string;
  runningActor: string;
  inputSha256: string;
}): Promise<void> {
  input.database.transaction(() => {
    input.database
      .prepare(
        `INSERT OR REPLACE INTO audit_meta
           (audit_db_schema_version, classification_version, digest_version,
            last_migration_text, running_at_iso, running_actor, input_sha256, output_affected_rows)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.result.schemaVersion,
        input.classificationVersion,
        input.digestVersion,
        input.migrationText,
        new Date().toISOString(),
        input.runningActor,
        input.inputSha256,
        input.result.affectedRows
      );
  })();
}
