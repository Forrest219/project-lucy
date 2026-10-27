/**
 * Spec 190 §7 — HTTP contract of the live table discovery capability.
 *
 * Four read-only endpoints plus one owner-only configuration endpoint:
 *  - `GET  /api/connections/:connId/live-tables` — Schema-level table list;
 *  - `GET  /api/connections/:connId/table-diff` — current reconciliation state
 *    and change event history;
 *  - `GET  /api/connections/:connId/table-structure-diff` — on-demand
 *    column-level deep check;
 *  - `GET  /api/connections/:connId/discovery` — continuous discovery status;
 *  - `PUT  /api/connections/:connId/discovery` — owner-only configuration.
 *
 * Nothing here writes Schema Manifest, `enabled_tables` or role permissions.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { readConnections, resolveProjectRoot } from "../project.js";
import { displayGenerations } from "../display-generation.js";
import { addTiming, withRequestTiming } from "../entry-performance-timing.js";
import {
  parseProbePurpose,
  type ProbePurpose
} from "../background-probes.js";
import {
  liveTableProbeFailureReason,
  liveTableProbeKey,
  liveTableProbeScheduler
} from "../live-table-queue.js";
import {
  LiveTablesConnectionNotFoundError,
  peekLiveTablesCache,
  readLiveTables,
  type LiveTableFailureReason,
  type LiveTablesResponse
} from "../live-tables.js";
import {
  SchemaStructureError,
  assertSchemaIdent,
  mapColumnType,
  readSchemaColumns
} from "../schema-structure.js";
import {
  DEFAULT_DISCOVERY_INTERVAL_MS,
  DISCOVERY_INTERVAL_WHITELIST,
  aggregateConnectionStatus,
  computeReconciliation,
  diffTableLists,
  loadChangeEvents,
  loadDiscoveryConfig,
  loadSnapshotsForConnection,
  saveDiscoveryConfig,
  type ChangeEvent,
  type DiscoveryConfig,
  type ReconciliationState,
  type TableListDiff
} from "../live-table-discovery.js";
import {
  readEnabledTables,
  readManifestTableDetails,
  type ImportScopeManifestColumn
} from "./import-scope.js";
import { recordDiscoveryAudit } from "./discovery-audit.js";
import { recordConfigChange } from "./audit.js";
import { requireOwner } from "../auth/guard.js";
import { trustedActorFromRequest } from "../security/request-actor.js";

/** At most 20 tables per column-level deep check (Spec 190 §7.4). */
export const MAX_STRUCTURE_DIFF_TABLES = 20;

function apiError(code: string, message: string, statusCode?: number) {
  const err = new Error(message) as Error & { statusCode: number; code: string };
  err.statusCode = statusCode ?? (code === "CONNECTION_NOT_FOUND" ? 404 : 400);
  err.code = code;
  return err;
}

/** Client disconnect aborts this request's probe subscription. */
function clientAbortSignal(reply: FastifyReply): AbortSignal {
  const controller = new AbortController();
  reply.raw.once("close", () => {
    if (!reply.raw.writableFinished) controller.abort();
  });
  return controller.signal;
}

function logProbeTiming(request: FastifyRequest, kind: string, purpose: string, timing: {
  queueMs: number;
  executionMs: number;
  totalMs: number;
  shared: boolean;
}): void {
  addTiming("queue", timing.queueMs);
  request.log.info(
    {
      probe: {
        kind,
        purpose,
        queueMs: Math.round(timing.queueMs),
        executionMs: Math.round(timing.executionMs),
        totalMs: Math.round(timing.totalMs),
        shared: timing.shared
      }
    },
    "connection probe"
  );
}

function truthyFlag(value: unknown): boolean {
  return value === "1" || value === "true" || value === "yes";
}

/**
 * Map a probe scheduler failure onto the closed reason vocabulary
 * (Spec 190 §7.1). `null` means the error is not a scheduler failure.
 *
 * The mapping lives in the queue module because the background poll uses it
 * too — both paths go through the same dedicated queue.
 */
export { liveTableProbeFailureReason };

function errorResponse(
  connectionId: string,
  schema: string,
  reason: LiveTableFailureReason
): LiveTablesResponse {
  return {
    status: "error",
    connectionId,
    schema,
    tables: [],
    fetchedAt: new Date().toISOString(),
    cached: false,
    reason,
    wireProtocol: "unknown"
  };
}

// ─── GET /api/connections/:connId/live-tables ────────────────────────────────

async function handleLiveTables(
  request: FastifyRequest<{
    Params: { connId: string };
    Querystring: { schema?: string; refresh?: string; purpose?: string };
  }>,
  reply: FastifyReply
): Promise<{ ok: true; data: LiveTablesResponse }> {
  const purposeRaw = parseProbePurpose(request.query?.purpose);
  if (!purposeRaw) throw apiError("BAD_REQUEST", "purpose must be automatic or manual");
  const purpose: ProbePurpose = purposeRaw;
  const rawSchema = request.query?.schema;
  if (typeof rawSchema !== "string" || !rawSchema.trim()) {
    throw apiError("BAD_REQUEST", "schema is required");
  }
  let schema: string;
  try {
    schema = assertSchemaIdent(rawSchema);
  } catch {
    throw apiError("BAD_REQUEST", "schema 名只能包含字母、数字和下划线，且不能以数字开头");
  }

  const projectRoot = await resolveProjectRoot();
  const { connId } = request.params;
  const generation = displayGenerations().L;
  const refresh = truthyFlag(request.query?.refresh);

  if (!refresh) {
    const cached = peekLiveTablesCache(projectRoot, connId, schema, generation, purpose);
    if (cached) return { ok: true, data: cached };
  }

  const actor = trustedActorFromRequest(request);
  // The automatic cache entry lives for one polling interval (Spec 190 §6.4),
  // so the automatic reader has to know the configured interval.
  const intervalMs =
    purpose === "automatic"
      ? (await loadDiscoveryConfig(projectRoot, connId))?.intervalMs
      : undefined;
  try {
    const { value, timing } = await liveTableProbeScheduler.submit({
      // `purpose` is part of the key: a manual read and the background poll
      // never share one task (Spec 190 §6.4).
      key: liveTableProbeKey({ projectRoot, connectionId: connId, schema, generation, purpose }),
      generation,
      purpose,
      signal: clientAbortSignal(reply),
      run: () =>
        readLiveTables(
          projectRoot,
          connId,
          schema,
          { refresh: true, purpose, intervalMs },
          { currentGeneration: () => displayGenerations().L }
        )
    });
    logProbeTiming(request, "live-tables", purpose, timing);
    await recordDiscoveryAudit({
      actor: actor.actorId,
      connectionId: connId,
      schema,
      action: "list",
      outcome: value.status === "ok" ? "ok" : "error",
      reason: value.reason ?? null,
      latencyMs: value.latencyMs ?? 0,
      tableCount: value.tables.length,
      requestId: actor.requestId
    });
    return { ok: true, data: value };
  } catch (err) {
    if (err instanceof LiveTablesConnectionNotFoundError) {
      throw apiError(err.code, err.message, 404);
    }
    if (err instanceof SchemaStructureError) {
      throw apiError("BAD_REQUEST", err.message);
    }
    const reason = liveTableProbeFailureReason(err);
    if (reason) {
      await recordDiscoveryAudit({
        actor: actor.actorId,
        connectionId: connId,
        schema,
        action: "list",
        outcome: "error",
        reason,
        latencyMs: 0,
        tableCount: 0,
        requestId: actor.requestId
      });
      return { ok: true, data: errorResponse(connId, schema, reason) };
    }
    throw err;
  }
}

// ─── GET /api/connections/:connId/table-diff ─────────────────────────────────

type TableDiffSchemaRow = {
  schema: string;
  reconciliation: ReconciliationState;
  listDiff: TableListDiff;
  snapshotAt: string | null;
};

async function handleTableDiff(
  request: FastifyRequest<{
    Params: { connId: string };
    Querystring: { schema?: string; includeEvents?: string };
  }>
): Promise<{ ok: true; data: unknown }> {
  const projectRoot = await resolveProjectRoot();
  const { connId } = request.params;
  const generation = displayGenerations().L;
  const schemaFilter = request.query?.schema?.trim();
  const includeEvents = truthyFlag(request.query?.includeEvents);

  // An unknown connection is a 404, not an empty answer — the same contract
  // the import-scope preview has (Spec 183).
  const connections = await readConnections(projectRoot);
  if (!connections.some((item) => item.id === connId)) {
    throw apiError("CONNECTION_NOT_FOUND", `Connection '${connId}' not found in ktx.yaml`, 404);
  }

  const enabled = await readEnabledTables(projectRoot, connId);
  const manifest = await readManifestTableDetails(projectRoot, connId);
  const pairs = await loadSnapshotsForConnection(projectRoot, connId, generation);

  const rows: TableDiffSchemaRow[] = [];
  for (const pair of Object.values(pairs)) {
    const schema = pair.current.schema;
    if (schemaFilter && schema !== schemaFilter) continue;
    const discovered = pair.current.tables.map((entry) => `${schema}.${entry.table}`);
    // The Manifest keeps the Schema spelling of its own file, while the
    // snapshot uses the one of `ktx.yaml`. Both sides are compared case
    // insensitively, like `normalizeRef` does in Spec 183 — otherwise a
    // Manifest written as `Fin` would report every library table as missing.
    const manifestTables = manifest
      .filter((entry) => entry.schema.toLowerCase() === schema.toLowerCase())
      .map((entry) => entry.physicalTable);
    const enabledTables = enabled.filter((entry) =>
      entry.toLowerCase().startsWith(`${schema.toLowerCase()}.`)
    );
    const listDiff = pair.previous
      ? diffTableLists(schema, pair.previous.tables, pair.current.tables)
      : { added: [], missing: [], columnCountChanged: [] };
    rows.push({
      schema,
      reconciliation: computeReconciliation(schema, discovered, manifestTables, enabledTables),
      listDiff,
      snapshotAt: pair.current.fetchedAt || null
    });
  }
  rows.sort((a, b) => a.schema.localeCompare(b.schema));

  const allEvents = (await loadChangeEvents(projectRoot))[connId] ?? [];
  const events: ChangeEvent[] = schemaFilter
    ? allEvents.filter((event) => event.schema === schemaFilter)
    : allEvents;

  return {
    ok: true,
    data: {
      connectionId: connId,
      generation,
      computedAt: new Date().toISOString(),
      schemas: rows,
      ...(includeEvents ? { events } : {}),
      eventCount: events.length
    }
  };
}

// ─── GET /api/connections/:connId/table-structure-diff ───────────────────────

type StructureColumn = {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
};

function manifestColumnKey(column: ImportScopeManifestColumn): string {
  return column.name.toLowerCase();
}

/**
 * The Manifest stores the mapped type vocabulary (`number` / `string` / `time`),
 * the same one `mapColumnType` produces for a live column. `boolean` is the one
 * extra literal the Manifest allows, and the live mapping folds it into
 * `string` — normalising it here keeps the comparison free of false positives.
 */
function normalizeManifestType(type: string): string {
  return type.trim().toLowerCase() === "boolean" ? "string" : type;
}

async function handleTableStructureDiff(
  request: FastifyRequest<{
    Params: { connId: string };
    Querystring: { schema?: string; tables?: string | string[] };
  }>
): Promise<{ ok: true; data: unknown }> {
  const rawSchema = request.query?.schema;
  if (typeof rawSchema !== "string" || !rawSchema.trim()) {
    throw apiError("BAD_REQUEST", "schema is required");
  }
  let schema: string;
  try {
    schema = assertSchemaIdent(rawSchema);
  } catch {
    throw apiError("BAD_REQUEST", "schema 名只能包含字母、数字和下划线，且不能以数字开头");
  }

  const rawTables = request.query?.tables;
  const tableNames = (Array.isArray(rawTables) ? rawTables : [rawTables])
    .filter((value): value is string => typeof value === "string")
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  if (tableNames.length === 0) {
    throw apiError("BAD_REQUEST", "tables is required");
  }
  if (tableNames.length > MAX_STRUCTURE_DIFF_TABLES) {
    throw apiError("BAD_REQUEST", `一次最多比较 ${MAX_STRUCTURE_DIFF_TABLES} 张表`);
  }

  const projectRoot = await resolveProjectRoot();
  const { connId } = request.params;
  const actor = trustedActorFromRequest(request);
  const startedAt = Date.now();

  const manifest = await readManifestTableDetails(projectRoot, connId);
  const manifestByTable = new Map<string, ImportScopeManifestColumn[]>();
  for (const entry of manifest) {
    // The Manifest may spell the Schema differently than the request does; the
    // table name inside the Schema is the identity of the deep check.
    if (entry.schema.toLowerCase() !== schema.toLowerCase()) continue;
    const schemaPrefix = `${entry.schema.toLowerCase()}.`;
    const physicalName = entry.physicalTable.toLowerCase().startsWith(schemaPrefix)
      ? entry.physicalTable.slice(schemaPrefix.length)
      : entry.physicalTable;
    manifestByTable.set(physicalName.toLowerCase(), entry.columns);
  }

  let read: Awaited<ReturnType<typeof readSchemaColumns>>;
  let readFailureReason: LiveTableFailureReason = "QUERY_FAILED";
  try {
    read = await readSchemaColumns(projectRoot, connId, schema);
  } catch (err) {
    if (err instanceof SchemaStructureError) {
      if (err.code === "CONNECTION_NOT_FOUND") throw apiError(err.code, err.message, 404);
      if (err.code === "INVALID_SCHEMA") throw apiError("BAD_REQUEST", err.message);
      // The protocol cannot read column rows (sqlserver / oracle): every
      // requested table reports the same closed reason (Spec 190 §7.4).
      readFailureReason = "TABLE_LIST_UNSUPPORTED";
      read = { status: "error", message: err.message };
    } else {
      throw err;
    }
  }

  const tables = tableNames.map((table) => {
    const physical = `${schema}.${table}`;
    const baseline = manifestByTable.get(table.toLowerCase()) ?? [];
    if (read.status === "too_large") {
      return {
        table: physical,
        status: "error" as const,
        reason: "TABLE_LIST_TOO_LARGE" as LiveTableFailureReason,
        columns: { added: [], removed: [], changed: [] }
      };
    }
    if (read.status === "error") {
      return {
        table: physical,
        status: "error" as const,
        reason: readFailureReason,
        columns: { added: [], removed: [], changed: [] }
      };
    }
    // The library spells the table the way the database spells it; the caller
    // may spell it differently. Both sides are compared case insensitively,
    // like `normalizeRef` does in Spec 183.
    const liveRows = read.columns.filter(
      (column) => column.table.toLowerCase() === table.toLowerCase()
    );
    if (liveRows.length === 0) {
      return {
        table: physical,
        status: "not_in_library" as const,
        columns: { added: [], removed: [], changed: [] }
      };
    }
    const liveByName = new Map(
      liveRows.map((column) => [
        column.column.toLowerCase(),
        {
          name: column.column,
          type: mapColumnType(column.dataType).type,
          nullable: column.nullable,
          primaryKey: column.primaryKey
        }
      ])
    );
    const baselineByName = new Map(
      baseline.map((column) => [
        manifestColumnKey(column),
        {
          name: column.name,
          type: normalizeManifestType(column.type),
          nullable: column.nullable,
          primaryKey: column.primaryKey
        }
      ])
    );
    const added: StructureColumn[] = [];
    const changed: Array<{
      name: string;
      before: { type: string; nullable: boolean; primaryKey: boolean };
      after: { type: string; nullable: boolean; primaryKey: boolean };
    }> = [];
    for (const [key, live] of liveByName) {
      const before = baselineByName.get(key);
      if (!before) {
        added.push(live);
        continue;
      }
      if (
        before.type !== live.type ||
        before.nullable !== live.nullable ||
        before.primaryKey !== live.primaryKey
      ) {
        changed.push({
          name: live.name,
          before: { type: before.type, nullable: before.nullable, primaryKey: before.primaryKey },
          after: { type: live.type, nullable: live.nullable, primaryKey: live.primaryKey }
        });
      }
    }
    const removed: StructureColumn[] = [];
    for (const [key, before] of baselineByName) {
      if (!liveByName.has(key)) removed.push(before);
    }
    added.sort((a, b) => a.name.localeCompare(b.name));
    removed.sort((a, b) => a.name.localeCompare(b.name));
    changed.sort((a, b) => a.name.localeCompare(b.name));
    return { table: physical, status: "ok" as const, columns: { added, removed, changed } };
  });

  await recordDiscoveryAudit({
    actor: actor.actorId,
    connectionId: connId,
    schema,
    action: "structure_diff",
    outcome: tables.some((entry) => entry.status === "error") ? "error" : "ok",
    reason: tables.some((entry) => entry.status === "error") ? "QUERY_FAILED" : null,
    latencyMs: Date.now() - startedAt,
    tableCount: tables.length,
    requestId: actor.requestId
  });

  return {
    ok: true,
    data: { connectionId: connId, schema, tables }
  };
}

// ─── GET /api/connections/:connId/discovery ──────────────────────────────────

async function handleDiscoveryStatus(
  request: FastifyRequest<{ Params: { connId: string } }>
): Promise<{ ok: true; data: unknown }> {
  const projectRoot = await resolveProjectRoot();
  const { connId } = request.params;
  const generation = displayGenerations().L;
  const config = await loadDiscoveryConfig(projectRoot, connId);

  // An unknown connection is a 404, not an empty status (same contract as the
  // import-scope preview, Spec 183).
  const connections = await readConnections(projectRoot);
  if (!connections.some((item) => item.id === connId)) {
    throw apiError("CONNECTION_NOT_FOUND", `Connection '${connId}' not found in ktx.yaml`, 404);
  }

  if (!config) {
    return {
      ok: true,
      data: {
        connectionId: connId,
        enabled: false,
        intervalMs: DEFAULT_DISCOVERY_INTERVAL_MS,
        generation,
        status: "never_run",
        lastAttemptAt: null,
        lastCompletedAt: null,
        schemas: [],
        diffCount: { added: 0, missing: 0, columnCountChanged: 0 }
      }
    };
  }

  const schemas = Object.entries(config.schemas).map(([schema, state]) => ({
    schema,
    status: state.status,
    lastAttemptAt: state.lastAttemptAt,
    lastCompletedAt: state.lastCompletedAt,
    lastReason: state.lastReason,
    consecutiveFailures: state.consecutiveFailures,
    nextAttemptAt: state.nextAttemptAt
  }));
  schemas.sort((a, b) => a.schema.localeCompare(b.schema));

  const pairs = await loadSnapshotsForConnection(projectRoot, connId, generation);
  let added = 0;
  let missing = 0;
  let columnCountChanged = 0;
  for (const pair of Object.values(pairs)) {
    if (!pair.previous) continue;
    const diff = diffTableLists(pair.current.schema, pair.previous.tables, pair.current.tables);
    added += diff.added.length;
    missing += diff.missing.length;
    columnCountChanged += diff.columnCountChanged.length;
  }

  const attempted = schemas.filter((entry) => entry.lastAttemptAt);
  const lastAttemptAt =
    attempted.length > 0
      ? attempted
          .map((entry) => entry.lastAttemptAt)
          .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null
      : null;
  const completed = schemas
    .filter((entry) => entry.lastCompletedAt)
    .map((entry) => entry.lastCompletedAt as string)
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
  // The aggregate status has no reason of its own; the reason of the first
  // Schema that is not `ok` explains it (the UI shows it with the notice).
  const lastReason =
    schemas.find((entry) => entry.status !== "ok" && entry.lastReason)?.lastReason ?? null;

  return {
    ok: true,
    data: {
      connectionId: connId,
      enabled: config.enabled,
      intervalMs: config.intervalMs,
      generation,
      status: aggregateConnectionStatus(Object.values(config.schemas)),
      lastAttemptAt,
      lastCompletedAt: completed,
      lastReason,
      schemas,
      diffCount: { added, missing, columnCountChanged }
    }
  };
}

// ─── PUT /api/connections/:connId/discovery ──────────────────────────────────

async function handleDiscoveryUpdate(
  request: FastifyRequest<{
    Params: { connId: string };
    Body: { enabled?: boolean; intervalMs?: number };
  }>,
  reply: FastifyReply
): Promise<{ ok: true; data: unknown } | undefined> {
  if (!(await requireOwner(request, reply, "仅所有者可调整持续感知配置"))) return;
  const projectRoot = await resolveProjectRoot();
  const { connId } = request.params;
  const body = request.body ?? {};
  // `enabled` must be an explicit boolean: a malformed body must not silently
  // switch continuous discovery off (Spec 190 §7.7).
  if (typeof body.enabled !== "boolean") {
    throw apiError("BAD_REQUEST", "enabled 必须是布尔值");
  }
  const enabled = body.enabled;
  const intervalRaw = body.intervalMs;
  const intervalMs =
    typeof intervalRaw === "number" && (DISCOVERY_INTERVAL_WHITELIST as readonly number[]).includes(intervalRaw)
      ? intervalRaw
      : null;
  if (intervalMs === null) {
    throw apiError("BAD_REQUEST", "intervalMs 必须是 5 分钟、15 分钟、30 分钟、1 小时、6 小时或 24 小时");
  }

  const generation = displayGenerations().L;
  const existing = await loadDiscoveryConfig(projectRoot, connId);
  const config: DiscoveryConfig = existing ?? {
    connectionId: connId,
    enabled: false,
    intervalMs,
    generation,
    schemas: {}
  };

  const previous = {
    enabled: config.enabled,
    intervalMs: config.intervalMs
  };
  config.enabled = enabled;
  config.intervalMs = intervalMs;
  config.generation = generation;
  // A configuration change is the documented way out of a paused state: the
  // failure counters reset and automatic retries resume (Spec 190 §8.2).
  for (const state of Object.values(config.schemas)) {
    state.consecutiveFailures = 0;
    state.nextAttemptAt = null;
    if (state.status === "paused") state.status = "error";
  }

  await saveDiscoveryConfig(projectRoot, config);

  const actor = trustedActorFromRequest(request);
  await recordConfigChange({
    filePath: ".ktx-ui/live-table-discovery.json",
    changeType: "discovery_config_update",
    actor: actor.actorId,
    actorType: actor.actorType,
    actorIp: actor.actorIp ?? undefined,
    source: "discovery_config_api",
    assetKind: "governance",
    targetId: connId,
    oldSummary: previous,
    newSummary: { enabled, intervalMs },
    requestId: actor.requestId ?? undefined,
    sessionId: actor.sessionId
  });

  return {
    ok: true,
    data: {
      connectionId: connId,
      enabled: config.enabled,
      intervalMs: config.intervalMs,
      generation: config.generation,
      status: aggregateConnectionStatus(Object.values(config.schemas))
    }
  };
}

// ─── registration ────────────────────────────────────────────────────────────

export function registerLiveDiscoveryRoutes(app: FastifyInstance): void {
  app.get<{
    Params: { connId: string };
    Querystring: { schema?: string; refresh?: string; purpose?: string };
  }>("/api/connections/:connId/live-tables", async (request, reply) =>
    withRequestTiming(request, () => handleLiveTables(request, reply))
  );

  app.get<{
    Params: { connId: string };
    Querystring: { schema?: string; includeEvents?: string };
  }>("/api/connections/:connId/table-diff", async (request) =>
    withRequestTiming(request, () => handleTableDiff(request))
  );

  app.get<{
    Params: { connId: string };
    Querystring: { schema?: string; tables?: string | string[] };
  }>("/api/connections/:connId/table-structure-diff", async (request) =>
    withRequestTiming(request, () => handleTableStructureDiff(request))
  );

  app.get<{ Params: { connId: string } }>(
    "/api/connections/:connId/discovery",
    async (request) => withRequestTiming(request, () => handleDiscoveryStatus(request))
  );

  app.put<{
    Params: { connId: string };
    Body: { enabled?: boolean; intervalMs?: number };
  }>("/api/connections/:connId/discovery", async (request, reply) =>
    withRequestTiming(request, () => handleDiscoveryUpdate(request, reply))
  );
}
