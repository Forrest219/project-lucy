/**
 * Lucy v0.25 — P0-4 审计只读对账展示：只读 API（E10 / E11）。
 *
 * Authority:
 *   - docs/specs/lucy-20261024-v0p25-audit-reconciliation-view-spec.md §4.3 / §5
 *
 * 端点：
 *   - GET /api/admin/audit/reconciliation/inquiries/:turnId
 *   - GET /api/admin/audit/reconciliation/usage
 *   - GET /api/admin/audit/reconciliation/export
 *
 * 约束：
 *   - **只读**：不写审计事实源、不改 ACL / 预算 / 数据面；
 *   - 要求管理员审计权限（`requireWebuiAuthHook` 已挂载，本路由再校验 actor 可解析）
 *     与 meta-audit（EA-11：读取敏感审计详情必须留痕；meta-audit 失败时**拒绝**该次读取，
 *     不静默放行）；
 *   - 游标分页并**声明是否完整**，不把当前页完整冒充全部匹配完整；
 *   - 投影未追平时正式模式**失败**（409），或显式标为诊断性不完整（`mode=diagnostic`），
 *     **不静默换用较新数据**。
 *
 * ⚠️ 接线说明：本文件导出 `registerAuditReconciliationRoutes(app)`，
 * 由父会话在 `webui/server/index.ts` 中调用（`server/index.ts` 归父会话所有，
 * 本轮不修改）。
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getAuditDb } from "./audit.js";
import { getSecurityStore } from "../security/instance.js";
import { sha256Hex, stableJson } from "../config-digest.js";
import { trustedActorFromRequest } from "../security/request-actor.js";
import {
  RECONCILIATION_PROJECTION_DEADLINE_MS,
  buildReconciliationTimeRange,
  captureLedgerWatermarkSeq,
  computeReconciliationSnapshotId,
  createReconciliationContext,
  normalizeReconciliationFilter,
  waitUntilProjectionCovers,
  withFrozenAuditSnapshot,
  type AuditCoverage,
  type Completeness,
  type MetricUnit,
  type ReconciliationContext,
  type ReconciliationFilterInput
} from "./reconciliation-context.js";
import {
  buildInquiryReconciliation,

  isProtocolTool,
  paginateByKey,
  probeColumns,
  reconcileTokens,
  type ActiveTokenObservation,
  type ConfiguredTokenIdentity,
  type ConfiguredTokenSnapshot,
  type UnknownIdentityObservation
} from "./reconciliation.js";
import {
  buildReconciliationCsvBundle,
  callAttemptRowsFrom,
  inquirySummaryRowFrom,
  tableListRowsFrom
} from "./reconciliation-csv.js";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 500;

type ReconciliationMode = "complete" | "diagnostic";

function boundedLimit(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_PAGE_SIZE;
  return Math.min(parsed, MAX_PAGE_SIZE);
}

function readMode(raw: string | undefined): ReconciliationMode {
  return raw === "diagnostic" ? "diagnostic" : "complete";
}

/**
 * 权限 + meta-audit 前置检查。
 *
 * - actor 不可解析 → 401（不猜身份）；
 * - 安全账本不可用 → 503（无法记录 meta-audit，拒绝敏感读取，EA-11 闭环）；
 * - meta-audit 写入失败 → 503（**不静默放行**）。
 */
async function requireAdminAuditRead(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<{ ok: true; actor: ReturnType<typeof trustedActorFromRequest> } | { ok: false }> {
  let actor: ReturnType<typeof trustedActorFromRequest>;
  try {
    actor = trustedActorFromRequest(request);
  } catch {
    reply.code(401);
    return { ok: false };
  }

  const security = await getSecurityStore();
  if (!security.ok) {
    reply.code(503);
    return { ok: false };
  }

  const meta = await security.value.appendEvent({
    eventId: `reconciliation-read-${request.id ?? Date.now()}`,
    operationId: `audit-reconciliation-read-${request.id ?? Date.now()}`,
    phase: "result",
    actor: actor.actorId,
    actorType: actor.actorType,
    auditEventKind: "audit_management",
    objectHash: sha256Hex(
      stableJson({ url: request.url, actor: actor.actorId, at: request.id ?? null })
    ),
    resultSummary: "audit-reconciliation read"
  });
  if (!meta.ok) {
    reply.code(503);
    return { ok: false };
  }
  return { ok: true, actor };
}

/**
 * 四子域 completeness 的占位。
 *
 * Spec §3.1 要求「保留旧 complete 与四子域」；四子域的**权威生产者是 P0-1 的 S05
 * summarize**（本页面不重算）。在 S05 接线之前，本页**不宣称完整**：
 * `complete=false` + 明确原因，而不是给出一个看起来已核验的 `true`。
 *
 * ⚠️ 父会话接线点：接入 P0-1 的 S05 summarize 后，用其结果替换本函数。
 */
function emptyCompleteness(reasons: string[]): Completeness {
  const allReasons = [...reasons, "sub_domains_not_evaluated_by_this_view"];
  return {
    complete: false,
    combined_complete: false,
    dataScope: { ok: false, reason: allReasons[0] ?? "not_evaluated" },
    associationQuality: {
      confirmed: 0,
      candidate: 0,
      unassigned: 0,
      conflict: 0,
      legacy_unverified: 0
    },
    clientCoverage: { observed: false, gapWindows: [], unknownReason: "not_evaluated" },
    integrityVerification: { fileHashOk: false, relationCheckOk: false },
    reasons: allReasons
  };
}

function emptyAuditCoverage(): AuditCoverage {
  return {
    version: "not_connected",
    seqUpperBound: 0,
    checks: [],
    allConclusive: false,
    combined: "unknown"
  };
}

export type ReconciliationContextBundle = {
  context: ReconciliationContext;
  coverage: { covered: boolean; reason: string; cursor: number; lag: number };
};

/**
 * 构造统一对账上下文（E2 + E3）。
 *
 * 顺序：捕获账本上界 S → 等待投影追平 S → 冻结快照 → 冻结上下文。
 * 投影未追平时：**正式模式抛错**（由调用方转 409），诊断模式显式标注。
 */
export async function openReconciliationContext(input: {
  filter: ReconciliationFilterInput;
  metricUnit: MetricUnit;
  mode: ReconciliationMode;
  instanceId?: string;
}): Promise<ReconciliationContextBundle> {
  const filter = normalizeReconciliationFilter(input.filter);
  const timeRange = buildReconciliationTimeRange(filter);

  const security = await getSecurityStore();
  if (!security.ok) {
    const error = new Error("security_store_unavailable") as Error & { code?: string };
    error.code = "RECONCILIATION_SECURITY_STORE_UNAVAILABLE";
    throw error;
  }
  const watermark = captureLedgerWatermarkSeq(security.value);
  if (!watermark.ok) {
    const error = new Error(watermark.reason) as Error & { code?: string };
    error.code = "RECONCILIATION_SECURITY_STORE_UNAVAILABLE";
    throw error;
  }

  const database = await getAuditDb();
  const coverage = await waitUntilProjectionCovers({
    store: security.value,
    target: database,
    watermarkSeq: watermark.watermarkSeq,
    deadlineMs: RECONCILIATION_PROJECTION_DEADLINE_MS
  });

  const reasons: string[] = [];
  if (!coverage.covered) reasons.push(`projection_not_covered:${coverage.reason}`);
  if (input.mode === "complete" && !coverage.covered) {
    const error = new Error("projection_not_covered") as Error & { code?: string };
    error.code = "RECONCILIATION_PROJECTION_NOT_COVERED";
    throw error;
  }

  const rowBound = withFrozenAuditSnapshot(database, () => {
    const info = probeColumns(database, "access_log");
    if (!info.has("id")) return 0;
    const row = database.prepare("SELECT IFNULL(MAX(id), 0) AS m FROM access_log").get() as {
      m: number;
    };
    return Number(row.m ?? 0);
  });

  const matchedRowCount = withFrozenAuditSnapshot(database, () => {
    const info = probeColumns(database, "access_log");
    if (!info.has("id")) return 0;
    const row = database.prepare("SELECT COUNT(*) AS c FROM access_log WHERE id <= ?").get(
      rowBound
    ) as { c: number };
    return Number(row.c ?? 0);
  });

  const context = createReconciliationContext({
    instanceId: input.instanceId ?? resolveInstanceId(),
    filter,
    timeRange,
    watermarkSeq: watermark.watermarkSeq,
    snapshotId: computeReconciliationSnapshotId({
      watermarkSeq: watermark.watermarkSeq,
      filter,
      rowBoundAccessLogId: rowBound,
      matchedRowCount
    }),
    rowBoundAccessLogId: rowBound,
    metricUnit: input.metricUnit,
    completeness: emptyCompleteness(reasons),
    auditCoverage: emptyAuditCoverage()
  });

  return {
    context,
    coverage: {
      covered: coverage.covered,
      reason: coverage.reason,
      cursor: coverage.cursor,
      lag: coverage.lag
    }
  };
}

function resolveInstanceId(): string {
  return process.env.LUCY_AGENT_AUDIT_INSTANCE_ID ?? "lucy-default";
}

type UsageRow = {
  unitId: string;
  ts: string;
  tool: string;
  tokenIdentity: string | null;
  tokenIdentityKind: "hash_prefix" | "credential_principal_id" | null;
  protocol: boolean;
};

/**
 * 读取窗口内的调用行并派生 Token 观察。
 *
 * 活跃 Token 只统计**至少一个独立工具调用**的身份；协议事件单独计数，不偷换分母。
 * `credential_principal_id` 缺列或全 NULL 时回落到 `token_hash_prefix`；
 * 前缀存在碰撞风险时以 `identityAmbiguity` 标注（不静默当成确定身份）。
 */
function collectUsageRows(
  database: import("better-sqlite3").Database,
  context: ReconciliationContext
): { rows: UsageRow[]; protocolEventCount: number } {
  const info = probeColumns(database, "access_log");
  // 审计库尚无 access_log 表（新库 / 未初始化）：返回空集合而不是 500。
  if (!info.has("id")) return { rows: [], protocolEventCount: 0 };
  const conditions = ["ts >= @from", "ts < @to", "id <= @rowBound"];
  const params: Record<string, unknown> = {
    from: context.timeRange.from,
    to: context.timeRange.to,
    rowBound: context.rowBoundAccessLogId
  };
  if (context.filter.user) {
    conditions.push("user_id = @user");
    params.user = context.filter.user;
  }
  if (context.filter.tool) {
    conditions.push("tool = @tool");
    params.tool = context.filter.tool;
  }
  if (context.filter.outcome) {
    conditions.push("outcome = @outcome");
    params.outcome = context.filter.outcome;
  }
  if (context.filter.tokenHashPrefix && info.has("token_hash_prefix")) {
    conditions.push("token_hash_prefix = @tokenHashPrefix");
    params.tokenHashPrefix = context.filter.tokenHashPrefix;
  }
  if (context.filter.sessionId && info.has("lucy_session_id")) {
    conditions.push("lucy_session_id = @sessionId");
    params.sessionId = context.filter.sessionId;
  }
  if (context.filter.platform && info.has("lucy_platform")) {
    conditions.push("lucy_platform = @platform");
    params.platform = context.filter.platform;
  }

  const projection = [
    "id",
    "ts",
    "tool",
    "token_hash_prefix",
    "credential_principal_id"
  ]
    .map((column) => (info.has(column) ? column : `NULL AS ${column}`))
    .join(", ");
  const rows = database
    .prepare(
      `SELECT ${projection} FROM access_log WHERE ${conditions.join(" AND ")} ORDER BY ts ASC, id ASC`
    )
    .all(params) as Array<Record<string, unknown>>;

  const usageRows: UsageRow[] = rows.map((row) => {
    const tool = String(row.tool ?? "");
    const principal = (row.credential_principal_id as string | null) ?? null;
    const prefix = (row.token_hash_prefix as string | null) ?? null;
    return {
      unitId: String(row.id),
      ts: String(row.ts ?? ""),
      tool,
      tokenIdentity: principal ?? prefix,
      tokenIdentityKind: principal ? "credential_principal_id" : prefix ? "hash_prefix" : null,
      protocol: isProtocolTool(tool)
    };
  });

  return {
    rows: usageRows,
    protocolEventCount: usageRows.filter((row) => row.protocol).length
  };
}

function buildTokenReconciliationInput(
  usageRows: UsageRow[],
  protocolEventCount: number
): {
  active: ActiveTokenObservation[];
  unknownIdentity: UnknownIdentityObservation[];
} {
  const activeMap = new Map<string, ActiveTokenObservation>();
  const unknownRequests = new Set<string>();
  let unknownCallCount = 0;
  let unknownLastSeen: string | null = null;

  for (const row of usageRows) {
    if (row.protocol) continue; // 协议行不进入业务工具调用分母
    if (!row.tokenIdentity) {
      unknownCallCount += 1;
      unknownRequests.add(row.unitId);
      if (!unknownLastSeen || row.ts > unknownLastSeen) unknownLastSeen = row.ts;
      continue;
    }
    const key = `${row.tokenIdentityKind ?? "hash_prefix"}:${row.tokenIdentity}`;
    const existing = activeMap.get(key);
    if (existing) {
      existing.toolCallCount += 1;
      if (!existing.firstSeenAt || row.ts < existing.firstSeenAt) existing.firstSeenAt = row.ts;
      if (!existing.lastSeenAt || row.ts > existing.lastSeenAt) existing.lastSeenAt = row.ts;
      continue;
    }
    activeMap.set(key, {
      identity: row.tokenIdentity,
      identityKind: row.tokenIdentityKind ?? "hash_prefix",
      toolCallCount: 1,
      firstSeenAt: row.ts,
      lastSeenAt: row.ts
    });
  }

  const active: ActiveTokenObservation[] = [...activeMap.values()].map((observation) => ({
    identity: observation.identity,
    identityKind: observation.identityKind,
    toolCallCount: observation.toolCallCount,
    firstSeenAt: observation.firstSeenAt,
    lastSeenAt: observation.lastSeenAt
  }));

  const unknownIdentity: UnknownIdentityObservation[] =
    unknownCallCount > 0
      ? [
          {
            reason: "missing_persistent_identity",
            callCount: unknownCallCount,
            distinctRequestIds: unknownRequests.size,
            lastSeenAt: unknownLastSeen
          }
        ]
      : [];

  return { active, unknownIdentity };
}

/**
 * 把配置里的 Token 哈希规范成与运行时**完全一致**的形态。
 *
 * 运行时的 `identity.ts` 用 `"sha256:" + sha256(明文)`，写入审计的
 * `token_hash_prefix` 是该哈希的前 19 字符（`sha256:` + 13 位 hex）。
 * 配置里的 `token.hash` 可能是：
 *   - `"sha256:<hex>"`（标准）
 *   - 裸 `<hex>`（无 scheme）
 *   - `{ sha256: "<hex>" }`（对象形态）
 * 三种都要归一到同一个身份，否则对账会把配置 Token 误判为「未活跃」。
 *
 * 口径与 `server/proxy/identity.ts` 的 `configuredTokenHashes()` 保持一致
 * （只做身份归一，不做明文比较）。
 */
export function canonicalConfiguredHash(raw: unknown): string | null {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    return trimmed.toLowerCase().startsWith("sha256:") ? trimmed : `sha256:${trimmed}`;
  }
  if (raw && typeof raw === "object") {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (key.toLowerCase() !== "sha256") continue;
      if (typeof value === "string" || typeof value === "number") {
        return `sha256:${String(value).trim()}`;
      }
    }
  }
  return null;
}

/**
 * 读取当前配置快照（access.yaml）。
 *
 * 配置读不到时**不补造**：返回空快照并把差异集合标为不可观测。
 */
async function readConfiguredTokenSnapshot(): Promise<ConfiguredTokenSnapshot> {
  const capturedAt = new Date().toISOString();
  try {
    const { readAccessYaml } = await import("./access-config.js");
    const { resolveProjectRoot } = await import("../project.js");
    const root = await resolveProjectRoot();
    const file = await readAccessYaml(root);
    const tokens: ConfiguredTokenIdentity[] = [];
    for (const user of file.config.users ?? []) {
      const enabled = user.enabled !== false;
      for (const token of user.tokens ?? []) {
        const canonical = canonicalConfiguredHash(token.hash);
        if (!canonical) continue;
        tokens.push({
          identity: canonical.slice(0, 19),
          identityKind: "hash_prefix",
          userId: user.id,
          label: token.label ?? null,
          enabled,
          expired: isExpired(token.expires_at ?? null),
          createdAt: token.created ?? null
        });
      }
    }
    const prefixes = new Map<string, number>();
    for (const token of tokens) {
      prefixes.set(token.identity, (prefixes.get(token.identity) ?? 0) + 1);
    }
    const identityAmbiguity = [...prefixes.values()].some((count) => count > 1);
    return {
      capturedAt,
      configVersion: file.version,
      tokens,
      identityAmbiguity,
      available: true
    };
  } catch (error) {
    // 配置读不到 ≠ 配置了 0 个 Token。
    // 返回**空**快照并标记不可观测；消费方必须据此把计数显示为「不可观测」，
    // 而不是 0（Spec §2.4／§2.6：空值、0 与未知不得混用）。
    return {
      capturedAt,
      configVersion: null,
      tokens: [],
      identityAmbiguity: false,
      available: false,
      unavailableReason:
        error instanceof Error ? `${error.name}: ${error.message}` : "configuration_unreadable"
    };
  }
}

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  const parsed = Date.parse(expiresAt);
  if (Number.isNaN(parsed)) return false;
  return parsed < Date.now();
}

export function registerAuditReconciliationRoutes(app: FastifyInstance): void {
  // ── ① 问询详情 ────────────────────────────────────────────────────────────
  app.get<{
    Params: { turnId: string };
    Querystring: { mode?: string };
  }>("/api/admin/audit/reconciliation/inquiries/:turnId", async (request, reply) => {
    const guard = await requireAdminAuditRead(request, reply);
    if (!guard.ok) {
      return {
        ok: false,
        error: {
          code: "RECONCILIATION_READ_REFUSED",
          message: "无法确认管理员身份或无法记录 meta-audit，拒绝本次对账读取"
        }
      };
    }

    const turnId = request.params.turnId?.trim();
    if (!turnId) {
      reply.code(400);
      return { ok: false, error: { code: "TURN_ID_REQUIRED" } };
    }

    try {
      const bundle = await openReconciliationContext({
        filter: { turnId },
        metricUnit: "tool_call",
        mode: readMode(request.query.mode)
      });
      const database = await getAuditDb();
      const detail = withFrozenAuditSnapshot(database, () =>
        buildInquiryReconciliation({ db: database, context: bundle.context, turnId })
      );
      return {
        ok: true,
        data: {
          reconciliationContext: bundle.context,
          projectionCoverage: bundle.coverage,
          inquiry: detail
        }
      };
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "RECONCILIATION_PROJECTION_NOT_COVERED") {
        reply.code(409);
        return {
          ok: false,
          error: {
            code,
            message: "投影未追平账本上界 S，正式对账读取失败（不静默换用较新数据）"
          }
        };
      }
      if (code === "RECONCILIATION_SECURITY_STORE_UNAVAILABLE") {
        reply.code(503);
        return { ok: false, error: { code, message: "安全账本不可用，无法确定账本上界" } };
      }
      reply.code(500);
      return { ok: false, error: { code: "RECONCILIATION_READ_FAILED" } };
    }
  });

  // ── ② 使用概况（Token 对账 + 完整表排行 + 差异集合） ─────────────────────
  app.get<{
    Querystring: ReconciliationFilterInput & { mode?: string; limit?: string; cursor?: string };
  }>("/api/admin/audit/reconciliation/usage", async (request, reply) => {
    const guard = await requireAdminAuditRead(request, reply);
    if (!guard.ok) {
      return {
        ok: false,
        error: {
          code: "RECONCILIATION_READ_REFUSED",
          message: "无法确认管理员身份或无法记录 meta-audit，拒绝本次对账读取"
        }
      };
    }

    try {
      const bundle = await openReconciliationContext({
        filter: request.query,
        metricUnit: "tool_call",
        mode: readMode(request.query.mode)
      });
      const database = await getAuditDb();
      const configured = await readConfiguredTokenSnapshot();
      const usage = withFrozenAuditSnapshot(database, () => {
        const rows = collectUsageRows(database, bundle.context);
        const tokenInput = buildTokenReconciliationInput(rows.rows, rows.protocolEventCount);
        const tokenReconciliation = reconcileTokens({
          context: bundle.context,
          configured,
          active: tokenInput.active,
          unknownIdentity: tokenInput.unknownIdentity,
          protocolEventCount: rows.protocolEventCount
        });
        return { tokenReconciliation, usageRows: rows.rows };
      });

      const page = paginateByKey({
        items: usage.usageRows,
        keyOf: (row) => `${row.ts}::${row.unitId}`,
        cursor: request.query.cursor ?? null,
        limit: boundedLimit(request.query.limit)
      });

      return {
        ok: true,
        data: {
          reconciliationContext: bundle.context,
          projectionCoverage: bundle.coverage,
          tokenReconciliation: usage.tokenReconciliation,
          calls: {
            items: page.items,
            nextCursor: page.nextCursor,
            complete: page.complete,
            totalMatched: page.totalMatched,
            returned: page.returned
          }
        }
      };
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "RECONCILIATION_PROJECTION_NOT_COVERED") {
        reply.code(409);
        return {
          ok: false,
          error: {
            code,
            message: "投影未追平账本上界 S，正式对账读取失败（不静默换用较新数据）"
          }
        };
      }
      if (code === "RECONCILIATION_SECURITY_STORE_UNAVAILABLE") {
        reply.code(503);
        return { ok: false, error: { code, message: "安全账本不可用，无法确定账本上界" } };
      }
      reply.code(500);
      return { ok: false, error: { code: "RECONCILIATION_READ_FAILED" } };
    }
  });

  // ── ③ CSV / Manifest 导出 ────────────────────────────────────────────────
  app.get<{
    Querystring: ReconciliationFilterInput & { mode?: string; limit?: string; cursor?: string };
  }>("/api/admin/audit/reconciliation/export", async (request, reply) => {
    const guard = await requireAdminAuditRead(request, reply);
    if (!guard.ok) {
      return {
        ok: false,
        error: {
          code: "RECONCILIATION_READ_REFUSED",
          message: "无法确认管理员身份或无法记录 meta-audit，拒绝本次对账读取"
        }
      };
    }

    try {
      const bundle = await openReconciliationContext({
        filter: request.query,
        metricUnit: "tool_call",
        mode: readMode(request.query.mode)
      });
      const database = await getAuditDb();
      const configured = await readConfiguredTokenSnapshot();

      const built = withFrozenAuditSnapshot(database, () => {
        const usage = collectUsageRows(database, bundle.context);
        const tokenInput = buildTokenReconciliationInput(usage.rows, usage.protocolEventCount);
        const tokenReconciliation = reconcileTokens({
          context: bundle.context,
          configured,
          active: tokenInput.active,
          unknownIdentity: tokenInput.unknownIdentity,
          protocolEventCount: usage.protocolEventCount
        });

        const turnIds = new Set<string>();
        const info = probeColumns(database, "access_log");
        if (info.has("lucy_turn_id")) {
          const turnRows = database
            .prepare(
              `SELECT DISTINCT IFNULL(lucy_turn_id, '') AS t FROM access_log
               WHERE ts >= @from AND ts < @to AND id <= @rowBound`
            )
            .all({
              from: bundle.context.timeRange.from,
              to: bundle.context.timeRange.to,
              rowBound: bundle.context.rowBoundAccessLogId
            }) as Array<{ t: string }>;
          for (const row of turnRows) if (row.t) turnIds.add(row.t);
        }

        const inquiries = [...turnIds].map((turnId) =>
          buildInquiryReconciliation({ db: database, context: bundle.context, turnId })
        );

        const bundleFiles = buildReconciliationCsvBundle({
          context: bundle.context,
          inquirySummary: inquiries.map(inquirySummaryRowFrom),
          tableList: inquiries.flatMap(tableListRowsFrom),
          calls: inquiries.flatMap(callAttemptRowsFrom),
          tokenReconciliation,
          configuredIdentities: configured.tokens.map((token) => ({
            identity: token.identity,
            identityKind: token.identityKind,
            userId: token.userId,
            enabled: token.enabled,
            expired: token.expired,
            createdAt: token.createdAt
          })),
          activeIdentities: tokenInput.active,
          extraDifferences: inquiries.flatMap((inquiry) => inquiry.differences),
          exclusions: inquiries.flatMap((inquiry) => inquiry.exclusions),
          complete: true
        });

        return { bundleFiles, tokenReconciliation };
      });

      reply.header("Cache-Control", "private, no-store");
      return {
        ok: true,
        data: {
          reconciliationContext: bundle.context,
          projectionCoverage: bundle.coverage,
          tokenReconciliation: built.tokenReconciliation,
          files: built.bundleFiles.files.map((file) => ({
            name: file.name,
            rowCount: file.rowCount,
            sha256: file.sha256,
            csv: file.csv
          })),
          manifest: built.bundleFiles.manifest
        }
      };
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "RECONCILIATION_PROJECTION_NOT_COVERED") {
        reply.code(409);
        return {
          ok: false,
          error: {
            code,
            message: "投影未追平账本上界 S，正式对账导出失败（不静默换用较新数据）"
          }
        };
      }
      if (code === "RECONCILIATION_SECURITY_STORE_UNAVAILABLE") {
        reply.code(503);
        return { ok: false, error: { code, message: "安全账本不可用，无法确定账本上界" } };
      }
      reply.code(500);
      return { ok: false, error: { code: "RECONCILIATION_EXPORT_FAILED" } };
    }
  });
}
