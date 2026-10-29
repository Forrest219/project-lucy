/**
 * L25-16 — 独立业务幂等存储（Spec §4.2，R08 / R09 / R10，G14）。
 *
 * ⚠️ **与配置审计表分层（Normative）**：
 *
 * | 键 | 构造 | 用途 |
 * |---|---|---|
 * | `operation_key` | `hash(idempotency_key, toolName)` | 标识一次逻辑操作 |
 * | `target_key` | `hash(idempotency_key, toolName, target_id)` | 标识一次逻辑操作中的单个目标 |
 * | `audit_key` | `hash(<业务键>, attempt)` | 配置审计行的唯一性 |
 *
 * 业务幂等记录**不写** `config_change_log`；配置审计行的 `idempotency_key` 列填
 * **含 attempt 的审计事件键**——否则重放时第二条审计行会被
 * `ON CONFLICT(idempotency_key) DO NOTHING` 静默丢弃，失败痕迹之后无法追加成功记录。
 *
 * 本存储与 `audit.sqlite` **同库**（Spec G34）：本 attempt 的 operation 认领、operation
 * 审计、target 认领与 target 审计必须落在**同一次** `db.transaction()` 里。
 */

import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { getAuditDb } from "../admin/audit.js";
import { OPS_PERSISTENT_STATES, type OpsPersistentState } from "./ops-outcome.js";

/** 效果阶段（N07）：`none` = 未发生；`written` = 文件已写；`activated` = 已确认生效。 */
export type OpsEffectPhase = "none" | "written" | "activated";

export const OPS_EFFECT_PHASES: readonly OpsEffectPhase[] = ["none", "written", "activated"];

// ─── 键分层 ──────────────────────────────────────────────────────────────────

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** 业务幂等键 `operation_key` —— 跨重放稳定。 */
export function operationKey(idempotencyKey: string, toolName: string): string {
  return sha256Hex(`lucy.ops.operation\u0000${idempotencyKey}\u0000${toolName}`);
}

/** 业务幂等键 `target_key` —— 跨重放稳定。 */
export function targetKey(idempotencyKey: string, toolName: string, targetId: string): string {
  return sha256Hex(`lucy.ops.target\u0000${idempotencyKey}\u0000${toolName}\u0000${targetId}`);
}

/** 审计事件键 `audit_key` —— **每次尝试唯一**（含 attempt）。 */
export function auditKey(businessKey: string, attempt: number): string {
  return sha256Hex(`lucy.ops.audit\u0000${businessKey}\u0000${attempt}`);
}

/**
 * 组执行身份 `execution_id` —— `operation_key` + attempt + group id。
 *
 * 用途：把适配器的组级暂存状态（前像 / 写后摘要）绑定到**具体的一次 attempt**。
 * - 不同 operation / 不同 attempt 互不覆盖（否则撤销会拿到别人的前像）；
 * - 跨进程可复现：恢复流程用同一公式就能找回原执行留下的暂存。
 *
 * 放在本模块而不是 `ops-batch.ts`：恢复模块要 import 它，而 `ops-batch.ts` 反向
 * import 恢复模块——放这里可以避免运行时循环依赖。
 */
export function opsExecutionId(operationKeyValue: string, attempt: number, groupId: string): string {
  return `${operationKeyValue}:${attempt}:${groupId}`;
}

/**
 * 规范化载荷序列化：对象键按字典序排序，`undefined` 字段视为不存在。
 * preview 与 commit **共用**本函数计算摘要（N01）。
 */
export function stableStringify(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "null";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  if (typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const parts: string[] = [];
    for (const key of Object.keys(record).sort()) {
      const item = record[key];
      if (item === undefined) continue;
      parts.push(`${JSON.stringify(key)}:${stableStringify(item)}`);
    }
    return `{${parts.join(",")}}`;
  }
  return "null";
}

/**
 * 计划摘要。
 *
 * ⚠️ 只对**规范化载荷**计算：调用方必须先剥掉运行时字段（`state` / `attempt` /
 * `result` / `auditId` / `targetKey`），否则 commit 阶段加载计划后会算出不同摘要。
 */
export function planDigestOf(canonicalPayload: unknown): string {
  return sha256Hex(`lucy.ops.plan\u0000${stableStringify(canonicalPayload)}`);
}

// ─── 记录模型 ────────────────────────────────────────────────────────────────

export interface OpsOperationRecord {
  operationKey: string;
  toolName: string;
  actor: string;
  delegatedFrom: string | null;
  planId: string;
  planDigest: string;
  status: OpsPersistentState;
  attempt: number;
  execSet: string[];
  groupIds: string[];
  result: unknown;
  plan: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface OpsTargetRecord {
  targetKey: string;
  operationKey: string;
  targetId: string;
  groupId: string | null;
  status: OpsPersistentState;
  attempt: number | null;
  auditId: number | null;
  result: unknown;
  before: unknown;
  after: unknown;
  effectPhase: OpsEffectPhase;
  releaseId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OpsPlanRecord {
  planId: string;
  toolName: string;
  actor: string;
  delegatedFrom: string | null;
  planDigest: string;
  plan: Record<string, unknown>;
  createdAt: string;
  expiresAt: string;
}

// ─── 表结构 ──────────────────────────────────────────────────────────────────

let schemaEnsured = false;

export function ensureOpsIdempotencySchema(database: Database.Database): void {
  if (schemaEnsured) return;
  database.exec(`
    CREATE TABLE IF NOT EXISTS ops_operations (
      operation_key  TEXT PRIMARY KEY,
      tool_name      TEXT NOT NULL,
      actor          TEXT NOT NULL,
      delegated_from TEXT,
      plan_id        TEXT NOT NULL,
      plan_digest    TEXT NOT NULL,
      status         TEXT NOT NULL,
      attempt        INTEGER NOT NULL DEFAULT 0,
      exec_set       TEXT NOT NULL DEFAULT '[]',
      group_ids      TEXT NOT NULL DEFAULT '[]',
      result         TEXT,
      plan           TEXT NOT NULL,
      created_at     TEXT NOT NULL,
      updated_at     TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ops_targets (
      target_key    TEXT PRIMARY KEY,
      operation_key TEXT NOT NULL,
      target_id     TEXT NOT NULL,
      group_id      TEXT,
      status        TEXT NOT NULL,
      attempt       INTEGER,
      audit_id      INTEGER,
      result        TEXT,
      before_state  TEXT,
      after_state   TEXT,
      effect_phase  TEXT NOT NULL DEFAULT 'none',
      release_id    TEXT,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ops_plans (
      plan_id        TEXT PRIMARY KEY,
      tool_name      TEXT NOT NULL,
      actor          TEXT NOT NULL,
      delegated_from TEXT,
      plan_digest    TEXT NOT NULL,
      plan           TEXT NOT NULL,
      created_at     TEXT NOT NULL,
      expires_at     TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ops_targets_operation ON ops_targets(operation_key);
    CREATE INDEX IF NOT EXISTS idx_ops_operations_status ON ops_operations(status);
  `);
  schemaEnsured = true;
}

export async function getOpsDatabase(): Promise<Database.Database> {
  const database = await getAuditDb();
  ensureOpsIdempotencySchema(database);
  return database;
}

// ─── 读 ──────────────────────────────────────────────────────────────────────

function parseJson<T>(text: string | null | undefined, fallback: T): T {
  if (text === null || text === undefined || text === "") return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export function isOpsPersistentState(value: unknown): value is OpsPersistentState {
  return typeof value === "string" && (OPS_PERSISTENT_STATES as readonly string[]).includes(value);
}

function rowToOperation(row: Record<string, unknown> | undefined): OpsOperationRecord | undefined {
  if (!row) return undefined;
  return {
    operationKey: String(row.operation_key),
    toolName: String(row.tool_name),
    actor: String(row.actor),
    delegatedFrom: (row.delegated_from as string | null) ?? null,
    planId: String(row.plan_id),
    planDigest: String(row.plan_digest),
    status: row.status as OpsPersistentState,
    attempt: Number(row.attempt ?? 0),
    execSet: parseJson<string[]>(row.exec_set as string, []),
    groupIds: parseJson<string[]>(row.group_ids as string, []),
    result: parseJson<unknown>(row.result as string | null, null),
    plan: parseJson<Record<string, unknown>>(row.plan as string, {}),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function rowToTarget(row: Record<string, unknown> | undefined): OpsTargetRecord | undefined {
  if (!row) return undefined;
  return {
    targetKey: String(row.target_key),
    operationKey: String(row.operation_key),
    targetId: String(row.target_id),
    groupId: (row.group_id as string | null) ?? null,
    status: row.status as OpsPersistentState,
    attempt: row.attempt === null || row.attempt === undefined ? null : Number(row.attempt),
    auditId: row.audit_id === null || row.audit_id === undefined ? null : Number(row.audit_id),
    result: parseJson<unknown>(row.result as string | null, null),
    before: parseJson<unknown>(row.before_state as string | null, null),
    after: parseJson<unknown>(row.after_state as string | null, null),
    effectPhase: (row.effect_phase as OpsEffectPhase) ?? "none",
    releaseId: (row.release_id as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export function loadOperationRow(database: Database.Database, opKey: string): OpsOperationRecord | undefined {
  const row = database.prepare("SELECT * FROM ops_operations WHERE operation_key = ?").get(opKey) as
    | Record<string, unknown>
    | undefined;
  return rowToOperation(row);
}

export function loadTargetRow(database: Database.Database, key: string): OpsTargetRecord | undefined {
  const row = database.prepare("SELECT * FROM ops_targets WHERE target_key = ?").get(key) as
    | Record<string, unknown>
    | undefined;
  return rowToTarget(row);
}

/** operation 的成员全集（按目标记录）。 */
export function loadOperationMembers(
  database: Database.Database,
  operationKeyValue: string
): OpsTargetRecord[] {
  const rows = database
    .prepare("SELECT * FROM ops_targets WHERE operation_key = ? ORDER BY created_at ASC, target_id ASC")
    .all(operationKeyValue) as Array<Record<string, unknown>>;
  return rows.map((row) => rowToTarget(row)!).filter(Boolean);
}

/**
 * 按持久态扫描目标行（收敛入口用它取 `pending_activation` 的目标）。
 *
 * ⚠️ 必须走 `rowToTarget` 映射——**不能**把原始行直接当 `OpsTargetRecord` 用：
 * 原始行的列名是 `target_key` / `operation_key` / `audit_id`，与结构体字段名不同，
 * 直接强转会让这些字段全是 `undefined`，收敛入口因此**什么都不做**。
 */
export function loadTargetRowsByStatus(
  database: Database.Database,
  status: OpsPersistentState
): OpsTargetRecord[] {
  const rows = database
    .prepare("SELECT * FROM ops_targets WHERE status = ? ORDER BY created_at ASC, target_id ASC")
    .all(status) as Array<Record<string, unknown>>;
  return rows.map((row) => rowToTarget(row)!).filter(Boolean);
}

/** 扫描非终态 operation（Spec §6.2 收敛入口 ①）。 */
export function scanNonTerminalOperations(database: Database.Database): OpsOperationRecord[] {
  const rows = database
    .prepare(
      "SELECT * FROM ops_operations WHERE status NOT IN ('succeeded','failed') ORDER BY updated_at ASC"
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map((row) => rowToOperation(row)!).filter(Boolean);
}

// ─── 写 ──────────────────────────────────────────────────────────────────────

export function savePlanRow(
  database: Database.Database,
  record: {
    planId: string;
    toolName: string;
    actor: string;
    delegatedFrom: string | null;
    planDigest: string;
    plan: Record<string, unknown>;
    createdAt: string;
    expiresAt: string;
  }
): void {
  database
    .prepare(
      `INSERT INTO ops_plans (plan_id, tool_name, actor, delegated_from, plan_digest, plan, created_at, expires_at)
       VALUES (@plan_id, @tool_name, @actor, @delegated_from, @plan_digest, @plan, @created_at, @expires_at)
       ON CONFLICT(plan_id) DO UPDATE SET
         plan_digest = excluded.plan_digest,
         plan = excluded.plan,
         expires_at = excluded.expires_at`
    )
    .run({
      plan_id: record.planId,
      tool_name: record.toolName,
      actor: record.actor,
      delegated_from: record.delegatedFrom,
      plan_digest: record.planDigest,
      plan: JSON.stringify(record.plan),
      created_at: record.createdAt,
      expires_at: record.expiresAt
    });
}

export function loadPlanRow(database: Database.Database, planId: string): OpsPlanRecord | undefined {
  const row = database.prepare("SELECT * FROM ops_plans WHERE plan_id = ?").get(planId) as
    | Record<string, unknown>
    | undefined;
  if (!row) return undefined;
  return {
    planId: String(row.plan_id),
    toolName: String(row.tool_name),
    actor: String(row.actor),
    delegatedFrom: (row.delegated_from as string | null) ?? null,
    planDigest: String(row.plan_digest),
    plan: parseJson<Record<string, unknown>>(row.plan as string, {}),
    createdAt: String(row.created_at),
    expiresAt: String(row.expires_at)
  };
}

export function upsertOperationRow(
  database: Database.Database,
  record: {
    operationKey: string;
    toolName: string;
    actor: string;
    delegatedFrom: string | null;
    planId: string;
    planDigest: string;
    status: OpsPersistentState;
    attempt: number;
    execSet: string[];
    groupIds: string[];
    result: unknown;
    plan: Record<string, unknown>;
  }
): void {
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO ops_operations
         (operation_key, tool_name, actor, delegated_from, plan_id, plan_digest, status, attempt,
          exec_set, group_ids, result, plan, created_at, updated_at)
       VALUES
         (@operation_key, @tool_name, @actor, @delegated_from, @plan_id, @plan_digest, @status, @attempt,
          @exec_set, @group_ids, @result, @plan, @created_at, @updated_at)
       ON CONFLICT(operation_key) DO UPDATE SET
         status = excluded.status,
         attempt = excluded.attempt,
         exec_set = excluded.exec_set,
         group_ids = excluded.group_ids,
         result = excluded.result,
         plan = excluded.plan,
         updated_at = excluded.updated_at`
    )
    .run({
      operation_key: record.operationKey,
      tool_name: record.toolName,
      actor: record.actor,
      delegated_from: record.delegatedFrom,
      plan_id: record.planId,
      plan_digest: record.planDigest,
      status: record.status,
      attempt: record.attempt,
      exec_set: JSON.stringify(record.execSet),
      group_ids: JSON.stringify(record.groupIds),
      result: record.result === undefined || record.result === null ? null : JSON.stringify(record.result),
      plan: JSON.stringify(record.plan),
      created_at: now,
      updated_at: now
    });
}

export function upsertTargetRow(
  database: Database.Database,
  record: {
    targetKey: string;
    operationKey: string;
    targetId: string;
    groupId: string | null;
    status: OpsPersistentState;
    attempt: number | null;
    auditId: number | null;
    result: unknown;
    before?: unknown;
    after?: unknown;
    effectPhase: OpsEffectPhase;
    releaseId?: string | null;
  }
): void {
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO ops_targets
         (target_key, operation_key, target_id, group_id, status, attempt, audit_id, result,
          before_state, after_state, effect_phase, release_id, created_at, updated_at)
       VALUES
         (@target_key, @operation_key, @target_id, @group_id, @status, @attempt, @audit_id, @result,
          @before_state, @after_state, @effect_phase, @release_id, @created_at, @updated_at)
       ON CONFLICT(target_key) DO UPDATE SET
         group_id = excluded.group_id,
         status = excluded.status,
         attempt = excluded.attempt,
         audit_id = COALESCE(excluded.audit_id, ops_targets.audit_id),
         result = excluded.result,
         before_state = COALESCE(excluded.before_state, ops_targets.before_state),
         after_state = COALESCE(excluded.after_state, ops_targets.after_state),
         effect_phase = excluded.effect_phase,
         release_id = COALESCE(excluded.release_id, ops_targets.release_id),
         updated_at = excluded.updated_at`
    )
    .run({
      target_key: record.targetKey,
      operation_key: record.operationKey,
      target_id: record.targetId,
      group_id: record.groupId,
      status: record.status,
      attempt: record.attempt,
      audit_id: record.auditId,
      result: record.result === undefined || record.result === null ? null : JSON.stringify(record.result),
      before_state:
        record.before === undefined || record.before === null ? null : JSON.stringify(record.before),
      after_state:
        record.after === undefined || record.after === null ? null : JSON.stringify(record.after),
      effect_phase: record.effectPhase,
      release_id: record.releaseId ?? null,
      created_at: now,
      updated_at: now
    });
}

/** 终结目标（终态写入）。 */
export function finalizeTargetRow(
  database: Database.Database,
  key: string,
  status: OpsPersistentState,
  result: unknown
): void {
  database
    .prepare(
      `UPDATE ops_targets SET status = @status, result = @result, updated_at = @updated_at WHERE target_key = @key`
    )
    .run({
      key,
      status,
      result: result === undefined || result === null ? null : JSON.stringify(result),
      updated_at: new Date().toISOString()
    });
}

/** 终结 operation（全集终态时）。 */
export function finalizeOperationRow(
  database: Database.Database,
  opKey: string,
  status: OpsPersistentState,
  result: unknown
): void {
  database
    .prepare(
      `UPDATE ops_operations SET status = @status, result = @result, updated_at = @updated_at WHERE operation_key = @op_key`
    )
    .run({
      op_key: opKey,
      status,
      result: result === undefined || result === null ? null : JSON.stringify(result),
      updated_at: new Date().toISOString()
    });
}

export function newPlanId(): string {
  return `plan_${randomUUID()}`;
}
