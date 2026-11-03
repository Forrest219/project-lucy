/**
 * Spec 190 §5 / §8 — continuous discovery storage and reconciler.
 *
 * Four data kinds, never mixed (Spec 190 §5.1):
 *  - **latest successful snapshot** — the full table list of one Schema;
 *  - **physical baseline** — the previous successful snapshot of that Schema;
 *  - **current reconciliation state** — recomputed from the latest snapshot,
 *    the Schema Manifest and `enabled_tables`; it never accumulates;
 *  - **change event history** — append-only audit trail, capped per connection.
 *
 * Everything lands in `<projectRoot>/.ktx-ui/` as runtime state: atomic writes,
 * mode 0600, never in the content root and never in git.
 */
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { readConnections } from "./project";
import { liveTableProbeFailureReason, liveTableProbeKey, liveTableProbeScheduler } from "./live-table-queue";
import type { LiveTableEntry, LiveTableFailureReason } from "./live-tables";

// ─── constants ───────────────────────────────────────────────────────────────

export const DISCOVERY_SIDECAR_DIR = ".ktx-ui";
export const SNAPSHOTS_FILE = "live-table-snapshots.json";
export const DISCOVERY_FILE = "live-table-discovery.json";
export const EVENTS_FILE = "live-table-events.json";

/** Whitelist of polling intervals (Spec 190 §7.7). */
export const DISCOVERY_INTERVAL_WHITELIST = [
  300_000, 900_000, 1_800_000, 3_600_000, 21_600_000, 86_400_000
] as const;

export const DEFAULT_DISCOVERY_INTERVAL_MS = 3_600_000;

/** Consecutive failures before a Schema needs a human (Spec 190 §8.2). */
export const MAX_CONSECUTIVE_FAILURES = 10;

/** Backoff ceiling — 1 hour (Spec 190 §8.2). */
export const MAX_BACKOFF_MS = 3_600_000;

/** Change events kept per connection (Spec 190 §5.2). */
export const MAX_EVENT_RECORDS = 50;

// ─── types ───────────────────────────────────────────────────────────────────

export type LiveTableSnapshot = {
  connectionId: string;
  schema: string;
  generation: number;
  provider: "ktx_sql" | "ktx_scan";
  fetchedAt: string;
  tables: LiveTableEntry[];
  previousFetchedAt?: string;
};

export type LiveTableSnapshotPair = {
  current: LiveTableSnapshot;
  previous?: LiveTableSnapshot;
};

export type DiscoverySchemaState = {
  status: "ok" | "error" | "paused";
  lastAttemptAt: string;
  lastCompletedAt: string | null;
  lastReason: LiveTableFailureReason | null;
  consecutiveFailures: number;
  nextAttemptAt: string | null;
};

export type DiscoveryConfig = {
  connectionId: string;
  enabled: boolean;
  intervalMs: number;
  generation: number;
  schemas: Record<string, DiscoverySchemaState>;
};

export type ChangeEvent = {
  connectionId: string;
  schema: string;
  generation: number;
  at: string;
  kind: "added" | "missing" | "column_count_changed";
  tables: string[];
  provider: "ktx_sql" | "ktx_scan";
};

export type TableListDiff = {
  added: string[];
  missing: string[];
  columnCountChanged: Array<{ table: string; before: number; after: number }>;
};

export type ReconciliationState = {
  discoveredInLibrary: string[];
  missingInManifest: string[];
  missingInEnabled: string[];
  notInLibrary: string[];
};

export type DiscoveryConnectionStatus = "ok" | "partial" | "error" | "paused" | "never_run";

// ─── sidecar io ──────────────────────────────────────────────────────────────

const SIDECAR_NAME = /^[A-Za-z0-9._-]+$/;

function sidecarPath(projectRoot: string, fileName: string): string {
  if (!SIDECAR_NAME.test(fileName) || fileName.includes("..")) {
    throw new Error(`Illegal sidecar file name: ${fileName}`);
  }
  return path.join(projectRoot, DISCOVERY_SIDECAR_DIR, fileName);
}

/** Atomic write with mode 0600: a reader never sees a half-written file. */
export async function writeSidecarAtomic(
  projectRoot: string,
  fileName: string,
  content: string
): Promise<void> {
  const target = sidecarPath(projectRoot, fileName);
  await mkdir(path.dirname(target), { recursive: true });
  const tmp = path.join(path.dirname(target), `.${path.basename(target)}.tmp-${randomUUID()}`);
  try {
    await writeFile(tmp, content, { encoding: "utf8", mode: 0o600 });
    await chmod(tmp, 0o600);
    await rename(tmp, target);
    await chmod(target, 0o600);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}

/**
 * Read a sidecar file. A missing or unreadable file yields `null` (an empty
 * state) instead of an error: these files are runtime state, and a corrupt
 * snapshot must not take the whole server down. The cost is that a corrupt
 * snapshot looks like "no snapshot yet" — the next round then rebuilds the
 * baseline and reports the difference again.
 */
export async function readSidecar(projectRoot: string, fileName: string): Promise<unknown | null> {
  try {
    const text = await readFile(sidecarPath(projectRoot, fileName), "utf8");
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

// ─── snapshots ───────────────────────────────────────────────────────────────

type SnapshotsFile = {
  version: 1;
  entries: Record<string, LiveTableSnapshotPair>;
};

function snapshotKey(connectionId: string, schema: string): string {
  return `${connectionId}\u0000${schema}`;
}

function normalizeSnapshot(value: unknown): LiveTableSnapshot | null {
  const record = asRecord(value);
  const connectionId = typeof record.connectionId === "string" ? record.connectionId : "";
  const schema = typeof record.schema === "string" ? record.schema : "";
  if (!connectionId || !schema) return null;
  const tables = Array.isArray(record.tables)
    ? (record.tables as unknown[]).filter(
        (item): item is LiveTableEntry =>
          Boolean(item) &&
          typeof item === "object" &&
          typeof (item as LiveTableEntry).table === "string" &&
          Number.isFinite((item as LiveTableEntry).columnCount)
      )
    : [];
  return {
    connectionId,
    schema,
    generation: Number.isFinite(Number(record.generation)) ? Number(record.generation) : 0,
    provider: record.provider === "ktx_scan" ? "ktx_scan" : "ktx_sql",
    fetchedAt: typeof record.fetchedAt === "string" ? record.fetchedAt : "",
    tables,
    ...(typeof record.previousFetchedAt === "string"
      ? { previousFetchedAt: record.previousFetchedAt }
      : {})
  };
}

export async function loadSnapshotPairs(
  projectRoot: string
): Promise<Record<string, LiveTableSnapshotPair>> {
  const raw = await readSidecar(projectRoot, SNAPSHOTS_FILE);
  const file = asRecord(raw);
  const entries = asRecord(file.entries);
  const out: Record<string, LiveTableSnapshotPair> = {};
  for (const [key, value] of Object.entries(entries)) {
    const record = asRecord(value);
    const current = normalizeSnapshot(record.current);
    if (!current) continue;
    const previous = normalizeSnapshot(record.previous);
    out[key] = previous ? { current, previous } : { current };
  }
  return out;
}

/**
 * Snapshots of one connection that belong to the given configuration
 * generation. A snapshot produced under an older generation is never served.
 */
export async function loadSnapshotsForConnection(
  projectRoot: string,
  connectionId: string,
  generation: number
): Promise<Record<string, LiveTableSnapshotPair>> {
  const pairs = await loadSnapshotPairs(projectRoot);
  const out: Record<string, LiveTableSnapshotPair> = {};
  for (const [key, pair] of Object.entries(pairs)) {
    if (pair.current.connectionId !== connectionId) continue;
    if (pair.current.generation !== generation) continue;
    out[key] = pair;
  }
  return out;
}

export async function writeSnapshotPair(
  projectRoot: string,
  connectionId: string,
  schema: string,
  snapshot: LiveTableSnapshot
): Promise<void> {
  const pairs = await loadSnapshotPairs(projectRoot);
  const key = snapshotKey(connectionId, schema);
  const previous = pairs[key]?.current;
  const next: LiveTableSnapshotPair = {
    current: {
      ...snapshot,
      ...(previous ? { previousFetchedAt: previous.fetchedAt } : {})
    },
    ...(previous ? { previous } : {})
  };
  const file: SnapshotsFile = { version: 1, entries: pairs };
  file.entries[key] = next;
  await writeSidecarAtomic(projectRoot, SNAPSHOTS_FILE, `${JSON.stringify(file, null, 2)}\n`);
}

/** Drop every snapshot and baseline of one connection (configuration generation changed). */
export async function invalidateSnapshots(
  projectRoot: string,
  connectionId: string
): Promise<void> {
  const pairs = await loadSnapshotPairs(projectRoot);
  let changed = false;
  for (const key of Object.keys(pairs)) {
    if (pairs[key].current.connectionId === connectionId) {
      delete pairs[key];
      changed = true;
    }
  }
  if (!changed) return;
  const file: SnapshotsFile = { version: 1, entries: pairs };
  await writeSidecarAtomic(projectRoot, SNAPSHOTS_FILE, `${JSON.stringify(file, null, 2)}\n`);
}

// ─── discovery config ────────────────────────────────────────────────────────

type DiscoveryFile = {
  version: 1;
  connections: Record<string, DiscoveryConfig>;
};

function normalizeSchemaState(value: unknown): DiscoverySchemaState {
  const record = asRecord(value);
  const status = record.status;
  return {
    status: status === "error" || status === "paused" ? status : "ok",
    lastAttemptAt: typeof record.lastAttemptAt === "string" ? record.lastAttemptAt : "",
    lastCompletedAt:
      typeof record.lastCompletedAt === "string" ? record.lastCompletedAt : null,
    lastReason:
      typeof record.lastReason === "string"
        ? (record.lastReason as LiveTableFailureReason)
        : null,
    consecutiveFailures: Number.isFinite(Number(record.consecutiveFailures))
      ? Math.max(0, Math.floor(Number(record.consecutiveFailures)))
      : 0,
    nextAttemptAt: typeof record.nextAttemptAt === "string" ? record.nextAttemptAt : null
  };
}

function normalizeConfig(value: unknown, connectionId: string): DiscoveryConfig | null {
  const record = asRecord(value);
  if (typeof record.connectionId !== "string" || record.connectionId !== connectionId) return null;
  const schemasRaw = asRecord(record.schemas);
  const schemas: Record<string, DiscoverySchemaState> = {};
  for (const [schema, state] of Object.entries(schemasRaw)) {
    schemas[schema] = normalizeSchemaState(state);
  }
  const intervalRaw = Number(record.intervalMs);
  const intervalMs = (DISCOVERY_INTERVAL_WHITELIST as readonly number[]).includes(intervalRaw)
    ? intervalRaw
    : DEFAULT_DISCOVERY_INTERVAL_MS;
  return {
    connectionId,
    enabled: record.enabled === true,
    intervalMs,
    generation: Number.isFinite(Number(record.generation)) ? Number(record.generation) : 0,
    schemas
  };
}

export async function loadDiscoveryConfigs(
  projectRoot: string
): Promise<Record<string, DiscoveryConfig>> {
  const raw = await readSidecar(projectRoot, DISCOVERY_FILE);
  const file = asRecord(raw);
  const connections = asRecord(file.connections);
  const out: Record<string, DiscoveryConfig> = {};
  for (const [connectionId, value] of Object.entries(connections)) {
    const config = normalizeConfig(value, connectionId);
    if (config) out[connectionId] = config;
  }
  return out;
}

export async function loadDiscoveryConfig(
  projectRoot: string,
  connectionId: string
): Promise<DiscoveryConfig | null> {
  const configs = await loadDiscoveryConfigs(projectRoot);
  return configs[connectionId] ?? null;
}

export async function saveDiscoveryConfig(
  projectRoot: string,
  config: DiscoveryConfig
): Promise<void> {
  const configs = await loadDiscoveryConfigs(projectRoot);
  configs[config.connectionId] = config;
  const file: DiscoveryFile = { version: 1, connections: configs };
  await writeSidecarAtomic(projectRoot, DISCOVERY_FILE, `${JSON.stringify(file, null, 2)}\n`);
}

// ─── change events ───────────────────────────────────────────────────────────

type EventsFile = {
  version: 1;
  events: Record<string, ChangeEvent[]>;
};

export async function loadChangeEvents(
  projectRoot: string
): Promise<Record<string, ChangeEvent[]>> {
  const raw = await readSidecar(projectRoot, EVENTS_FILE);
  const file = asRecord(raw);
  const events = asRecord(file.events);
  const out: Record<string, ChangeEvent[]> = {};
  for (const [connectionId, list] of Object.entries(events)) {
    if (!Array.isArray(list)) continue;
    out[connectionId] = list.filter(
      (item): item is ChangeEvent => Boolean(item) && typeof item === "object"
    );
  }
  return out;
}

export async function appendChangeEvents(
  projectRoot: string,
  connectionId: string,
  events: ChangeEvent[]
): Promise<void> {
  if (events.length === 0) return;
  const all = await loadChangeEvents(projectRoot);
  const current = all[connectionId] ?? [];
  const next = [...current, ...events].slice(-MAX_EVENT_RECORDS);
  all[connectionId] = next;
  const file: EventsFile = { version: 1, events: all };
  await writeSidecarAtomic(projectRoot, EVENTS_FILE, `${JSON.stringify(file, null, 2)}\n`);
}

// ─── diff & reconciliation ───────────────────────────────────────────────────

/** Spec 190 §8.4 — compare two table lists. */
export function diffTableLists(
  schema: string,
  previousTables: LiveTableEntry[],
  currentTables: LiveTableEntry[]
): TableListDiff {
  const previousByName = new Map(previousTables.map((entry) => [entry.table, entry]));
  const currentByName = new Map(currentTables.map((entry) => [entry.table, entry]));
  const added: string[] = [];
  const missing: string[] = [];
  const columnCountChanged: Array<{ table: string; before: number; after: number }> = [];
  for (const [name, entry] of currentByName) {
    const before = previousByName.get(name);
    if (!before) {
      added.push(`${schema}.${name}`);
      continue;
    }
    if (before.columnCount !== entry.columnCount) {
      columnCountChanged.push({
        table: `${schema}.${name}`,
        before: before.columnCount,
        after: entry.columnCount
      });
    }
  }
  for (const name of previousByName.keys()) {
    if (!currentByName.has(name)) missing.push(`${schema}.${name}`);
  }
  added.sort((a, b) => a.localeCompare(b));
  missing.sort((a, b) => a.localeCompare(b));
  columnCountChanged.sort((a, b) => a.table.localeCompare(b.table));
  return { added, missing, columnCountChanged };
}

function difference(a: string[], b: Set<string>): string[] {
  return a.filter((value) => !b.has(value.toLowerCase())).sort((x, y) => x.localeCompare(y));
}

/**
 * Spec 190 §8.3 — recompute the current reconciliation state. Never reads the
 * event history, so a table that recovered disappears from the state again.
 *
 * Both sides are compared case-insensitively (`normalizeRef` in Spec 183 does
 * the same for the import-scope preview), so a Manifest that writes
 * `Fin.Ledger` still matches the library's `fin.ledger`.
 */
export function computeReconciliation(
  schema: string,
  discovered: string[],
  manifestTables: string[],
  enabledTables: string[]
): ReconciliationState {
  const manifestSet = new Set(manifestTables.map((value) => value.toLowerCase()));
  const enabledSet = new Set(enabledTables.map((value) => value.toLowerCase()));
  const discoveredSet = new Set(discovered.map((value) => value.toLowerCase()));
  return {
    discoveredInLibrary: [...discovered].sort((a, b) => a.localeCompare(b)),
    missingInManifest: difference(discovered, manifestSet),
    missingInEnabled: difference(discovered, enabledSet),
    notInLibrary: difference(manifestTables, discoveredSet)
  };
}

// ─── connection status aggregation (Spec 190 §7.6) ───────────────────────────

export function aggregateConnectionStatus(
  schemas: DiscoverySchemaState[]
): DiscoveryConnectionStatus {
  if (schemas.length === 0) return "never_run";
  const attempted = schemas.filter((entry) => entry.lastAttemptAt);
  if (attempted.length === 0) return "never_run";
  const statuses = new Set(schemas.map((entry) => entry.status));
  if (statuses.size === 1) {
    const only = [...statuses][0];
    if (only === "ok") return "ok";
    if (only === "error") return "error";
    if (only === "paused") return "paused";
  }
  return "partial";
}

// ─── reconciler (Spec 190 §8.2) ──────────────────────────────────────────────

export type DiscoveryReconcilerDeps = {
  /** Reads the live table list of one Schema. Defaults to the SQL provider path. */
  readTables?: (input: {
    projectRoot: string;
    connectionId: string;
    schema: string;
    generation: number;
    refresh: boolean;
    purpose: "automatic";
    intervalMs: number;
  }) => Promise<{
    status: "ok" | "error";
    tables: LiveTableEntry[];
    fetchedAt: string;
    reason?: LiveTableFailureReason;
    latencyMs?: number;
    provider?: "ktx_sql" | "ktx_scan";
  }>;
  currentGeneration?: (connectionId: string) => number;
  readConnectionsImpl?: typeof readConnections;
  now?: () => number;
  onAudit?: (event: {
    connectionId: string;
    schema: string;
    action: "list" | "structure_diff" | "reconcile";
    outcome: "ok" | "error";
    reason: LiveTableFailureReason | null;
    latencyMs: number;
    tableCount: number;
    operator: string;
  }) => void | Promise<void>;
};

export function backoffMs(intervalMs: number, consecutiveFailures: number): number {
  const exponent = Math.max(0, consecutiveFailures - 1);
  const raw = intervalMs * 2 ** exponent;
  return Math.min(raw, MAX_BACKOFF_MS);
}

async function defaultReadTables(
  input: {
    projectRoot: string;
    connectionId: string;
    schema: string;
    generation: number;
    refresh: boolean;
    purpose: "automatic";
    intervalMs: number;
  },
  currentGeneration: () => number
): Promise<{
  status: "ok" | "error";
  tables: LiveTableEntry[];
  fetchedAt: string;
  reason?: LiveTableFailureReason;
  latencyMs?: number;
  provider?: "ktx_sql" | "ktx_scan";
}> {
  // Imported lazily so the storage module stays usable without the SQL path.
  const { readLiveTables } = await import("./live-tables");
  // The background poll runs on the dedicated table-query queue, exactly like
  // the manual read: one table query at a time, its own quota, and the same
  // queue-full / queue-deadline / stale-generation reasons (SC-32).
  try {
    const { value } = await liveTableProbeScheduler.submit({
      key: liveTableProbeKey({
        projectRoot: input.projectRoot,
        connectionId: input.connectionId,
        schema: input.schema,
        generation: input.generation,
        purpose: input.purpose
      }),
      generation: input.generation,
      purpose: input.purpose,
      run: () =>
        readLiveTables(
          input.projectRoot,
          input.connectionId,
          input.schema,
          {
            refresh: input.refresh,
            purpose: input.purpose,
            intervalMs: input.intervalMs
          },
          { currentGeneration }
        )
    });
    return {
      status: value.status,
      tables: value.tables,
      fetchedAt: value.fetchedAt,
      ...(value.reason ? { reason: value.reason } : {}),
      ...(value.latencyMs !== undefined ? { latencyMs: value.latencyMs } : {}),
      provider: "ktx_sql"
    };
  } catch (err) {
    const reason = liveTableProbeFailureReason(err);
    // A scheduler failure is a business outcome of this round, not a crash:
    // the Schema is isolated and the next round retries it (Spec 190 §9.2).
    if (!reason) throw err;
    return {
      status: "error",
      tables: [],
      fetchedAt: new Date().toISOString(),
      reason
    };
  }
}

/**
 * One continuous-discovery round for one connection.
 *
 * Failure isolation is per Schema: one Schema failing never stops the others.
 * The physical baseline only advances after the snapshot landed on disk, so a
 * failed write makes the next round report the same difference again.
 */
export async function reconcileConnection(
  projectRoot: string,
  connectionId: string,
  deps: DiscoveryReconcilerDeps = {}
): Promise<DiscoveryConfig | null> {
  const readConnectionsImpl = deps.readConnectionsImpl ?? readConnections;
  const now = deps.now ?? Date.now;

  const config = await loadDiscoveryConfig(projectRoot, connectionId);
  if (!config || !config.enabled) return null;

  // The generation reader is the real one, so a result produced under a
  // configuration that changed mid-flight never enters the cache.
  const generationReader = () => deps.currentGeneration?.(connectionId) ?? config.generation;
  const readTables =
    deps.readTables ??
    ((input: Parameters<typeof defaultReadTables>[0]) => defaultReadTables(input, generationReader));

  const connections = await readConnectionsImpl(projectRoot);
  const connection = connections.find((item) => item.id === connectionId);
  if (!connection) return null;

  const generation = deps.currentGeneration ? deps.currentGeneration(connectionId) : config.generation;

  if (config.generation !== generation) {
    // Configuration changed: the old snapshot and its baseline are void.
    await invalidateSnapshots(projectRoot, connectionId);
    config.generation = generation;
    await saveDiscoveryConfig(projectRoot, config);
  }

  // The snapshot file is read once per round, not once per Schema; the local
  // map is advanced as the round writes its own snapshots.
  const pairs = await loadSnapshotsForConnection(projectRoot, connectionId, generation);

  for (const schema of connection.schemas) {
    const snapshotKeyForSchema = snapshotKey(connectionId, schema);
    const state = config.schemas[schema] ?? {
      status: "ok" as const,
      lastAttemptAt: "",
      lastCompletedAt: null,
      lastReason: null,
      consecutiveFailures: 0,
      nextAttemptAt: null
    };
    config.schemas[schema] = state;
    if (state.status === "paused") continue; // a paused Schema is never retried automatically

    const startedAt = new Date(now()).toISOString();
    state.lastAttemptAt = startedAt;

    const live = await readTables({
      projectRoot,
      connectionId,
      schema,
      generation,
      // Every round re-queries the library: the snapshot must advance even when
      // nothing changed (Spec 190 SC-27). The automatic cache entry never
      // stands in for a poll (Spec 190 §6.4).
      refresh: true,
      purpose: "automatic",
      intervalMs: config.intervalMs
    });

    if (live.status === "error") {
      state.status = "error";
      state.lastReason = live.reason ?? "QUERY_FAILED";
      state.consecutiveFailures = state.consecutiveFailures + 1;
      const nextAt = new Date(now() + backoffMs(config.intervalMs, state.consecutiveFailures)).toISOString();
      state.nextAttemptAt = nextAt;
      if (state.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        state.status = "paused"; // needs a human; automatic retries stop
      }
      await saveDiscoveryConfig(projectRoot, config);
      await deps.onAudit?.({
        connectionId,
        schema,
        action: "list",
        outcome: "error",
        reason: state.lastReason,
        latencyMs: live.latencyMs ?? 0,
        tableCount: 0,
        operator: "system"
      });
      continue;
    }

    state.status = "ok";
    state.lastReason = null;
    state.consecutiveFailures = 0;
    state.lastCompletedAt = new Date(now()).toISOString();
    state.nextAttemptAt = null;

    const previous = pairs[snapshotKeyForSchema]?.current;

    const snapshot: LiveTableSnapshot = {
      connectionId,
      schema,
      generation,
      provider: live.provider ?? "ktx_sql",
      fetchedAt: live.fetchedAt,
      tables: live.tables
    };

    // One audit event per table query (Spec 190 §7.8). A snapshot write failure
    // turns the round into an error round, so it is reported with its own reason.
    let auditReason: LiveTableFailureReason | null = null;
    let wroteSnapshot = false;
    try {
      await writeSnapshotPair(projectRoot, connectionId, schema, snapshot);
      wroteSnapshot = true;
      // Keep the in-memory view in step with the file for the next Schema.
      pairs[snapshotKeyForSchema] = {
        current: snapshot,
        ...(previous ? { previous } : {})
      };
    } catch {
      auditReason = "SNAPSHOT_WRITE_FAILED";
      state.status = "error";
      state.lastReason = "SNAPSHOT_WRITE_FAILED";
    }

    if (wroteSnapshot) {
      const previousTables = previous?.tables ?? [];
      const diff = diffTableLists(schema, previousTables, live.tables);
      const isEmpty =
        diff.added.length === 0 &&
        diff.missing.length === 0 &&
        diff.columnCountChanged.length === 0;

      if (!isEmpty && previous) {
        const at = live.fetchedAt;
        // The event log is auxiliary: a failure there must not break the round
        // for the remaining Schemas.
        await appendChangeEvents(projectRoot, connectionId, [
          ...(diff.added.length > 0
            ? [{ connectionId, schema, generation, at, kind: "added" as const, tables: diff.added, provider: snapshot.provider }]
            : []),
          ...(diff.missing.length > 0
            ? [{ connectionId, schema, generation, at, kind: "missing" as const, tables: diff.missing, provider: snapshot.provider }]
            : []),
          ...(diff.columnCountChanged.length > 0
            ? [
                {
                  connectionId,
                  schema,
                  generation,
                  at,
                  kind: "column_count_changed" as const,
                  tables: diff.columnCountChanged.map((entry) => entry.table),
                  provider: snapshot.provider
                }
              ]
            : [])
        ]).catch((err) => {
          console.error("[live-table-discovery] change event append failed", {
            connectionId,
            schema,
            error: err instanceof Error ? err.message : String(err)
          });
        });
      }
    }

    await saveDiscoveryConfig(projectRoot, config);
    await deps.onAudit?.({
      connectionId,
      schema,
      action: "list",
      outcome: auditReason ? "error" : "ok",
      reason: auditReason,
      latencyMs: live.latencyMs ?? 0,
      tableCount: live.tables.length,
      operator: "system"
    });
  }

  return config;
}
