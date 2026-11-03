import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  aggregateConnectionStatus,
  backoffMs,
  computeReconciliation,
  diffTableLists,
  DISCOVERY_FILE,
  EVENTS_FILE,
  loadChangeEvents,
  loadDiscoveryConfig,
  loadSnapshotPairs,
  MAX_CONSECUTIVE_FAILURES,
  reconcileConnection,
  saveDiscoveryConfig,
  SNAPSHOTS_FILE,
  writeSidecarAtomic,
  type DiscoveryConfig
} from "../live-table-discovery";
import type { LiveTableEntry, LiveTableFailureReason } from "../live-tables";
import { ProbeScheduler } from "../background-probes";
import { liveTableProbeScheduler } from "../live-table-queue";
import { recordDiscoveryAudit } from "../admin/discovery-audit";
import { isConnectionDue } from "../live-table-worker";
import { resetAuditDbForTests } from "../admin/audit";
import { resetAdminsCache } from "../auth/admins-store";
import { buildServer } from "../index";

/**
 * Spec 190 §8 — continuous discovery: the physical baseline, the current
 * reconciliation state and the change event history are three separate facts
 * and never stand in for each other.
 */

const KTX_YAML = `connections:
  warehouse:
    driver: mysql
    engine: mysql
    wire_protocol: mysql
    schemas:
      - fin
      - ops
      - crm
    enabled_tables:
      - fin.ledger
`;

let projectRoot: string;
const previousEnv: Record<string, string | undefined> = {
  KTX_PROJECT_ROOT: process.env.KTX_PROJECT_ROOT,
  LUCY_CONTENT_ROOT: process.env.LUCY_CONTENT_ROOT,
  LUCY_WEBUI_AUTH: process.env.LUCY_WEBUI_AUTH
};

type FakeTables = Record<string, LiveTableEntry[]>;

function table(name: string, columns = 3): LiveTableEntry {
  return { table: name, tableType: "BASE TABLE", columnCount: columns };
}

function readTablesFrom(tables: FakeTables) {
  return vi.fn(async (input: { schema: string }) => {
    const list = tables[input.schema];
    if (!list) {
      return {
        status: "error" as const,
        tables: [] as LiveTableEntry[],
        fetchedAt: new Date().toISOString(),
        reason: "SCHEMA_NOT_VISIBLE" as LiveTableFailureReason
      };
    }
    return {
      status: "ok" as const,
      tables: list,
      fetchedAt: new Date().toISOString(),
      latencyMs: 4,
      provider: "ktx_sql" as const
    };
  });
}

const connections = [
  {
    id: "warehouse",
    driver: "mysql",
    engine: "mysql",
    wireProtocol: "mysql" as const,
    schemas: ["fin", "ops", "crm"],
    enabledTables: ["fin.ledger"]
  }
];

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "ktx-spec-190-cd-"));
  await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
  await writeFile(path.join(projectRoot, "ktx.yaml"), KTX_YAML, "utf8");
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_CONTENT_ROOT = ".";
  resetAuditDbForTests();
});

afterEach(async () => {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetAuditDbForTests();
  resetAdminsCache();
  liveTableProbeScheduler.resetForTests();
  if (projectRoot) await rm(projectRoot, { recursive: true, force: true });
  projectRoot = "";
});

async function enableDiscovery(options: { intervalMs?: number } = {}): Promise<void> {
  await saveDiscoveryConfig(projectRoot, {
    connectionId: "warehouse",
    enabled: true,
    intervalMs: options.intervalMs ?? 3_600_000,
    generation: 0,
    schemas: {}
  });
}

describe("Spec 190 — reconciler", () => {
  it("SC-18: the first round establishes the baseline and produces no change event", async () => {
    await enableDiscovery();
    const readTables = readTablesFrom({ fin: [table("ledger", 6)], ops: [table("jobs", 2)] });
    const config = await reconcileConnection(projectRoot, "warehouse", {
      readTables,
      readConnectionsImpl: async () => connections,
      currentGeneration: () => 0
    });
    expect(config?.schemas.fin?.status).toBe("ok");
    expect(config?.schemas.fin?.consecutiveFailures).toBe(0);

    const events = await loadChangeEvents(projectRoot);
    expect(events.warehouse ?? []).toEqual([]);

    const pairs = await loadSnapshotPairs(projectRoot);
    const pair = pairs[`warehouse\u0000fin`];
    expect(pair?.current.tables).toEqual([table("ledger", 6)]);
    expect(pair?.previous).toBeUndefined();
  });

  it("SC-15/SC-16/SC-17: reports added, missing and column-count changes", async () => {
    await enableDiscovery();
    const readTables = readTablesFrom({ fin: [table("ledger", 6)] });
    await reconcileConnection(projectRoot, "warehouse", {
      readTables,
      readConnectionsImpl: async () => connections,
      currentGeneration: () => 0
    });

    const changed = readTablesFrom({
      fin: [table("ledger", 7), table("orders", 4)]
    });
    await reconcileConnection(projectRoot, "warehouse", {
      readTables: changed,
      readConnectionsImpl: async () => connections,
      currentGeneration: () => 0
    });

    const pairs = await loadSnapshotPairs(projectRoot);
    const pair = pairs[`warehouse\u0000fin`];
    const diff = diffTableLists("fin", pair!.previous!.tables, pair!.current.tables);
    expect(diff.added).toEqual(["fin.orders"]);
    expect(diff.missing).toEqual([]);
    expect(diff.columnCountChanged).toEqual([{ table: "fin.ledger", before: 6, after: 7 }]);

    const events = (await loadChangeEvents(projectRoot)).warehouse ?? [];
    expect(events.map((event) => event.kind).sort()).toEqual(["added", "column_count_changed"]);
  });

  it("SC-16: a table that disappeared is reported but never removed locally", async () => {
    await enableDiscovery();
    await reconcileConnection(projectRoot, "warehouse", {
      readTables: readTablesFrom({ fin: [table("ledger", 6), table("orders", 4)] }),
      readConnectionsImpl: async () => connections,
      currentGeneration: () => 0
    });
    await reconcileConnection(projectRoot, "warehouse", {
      readTables: readTablesFrom({ fin: [table("ledger", 6)] }),
      readConnectionsImpl: async () => connections,
      currentGeneration: () => 0
    });

    const pairs = await loadSnapshotPairs(projectRoot);
    const pair = pairs[`warehouse\u0000fin`];
    const diff = diffTableLists("fin", pair!.previous!.tables, pair!.current.tables);
    expect(diff.missing).toEqual(["fin.orders"]);

    // The local assets are untouched: this capability never writes them.
    const ktxYaml = await readFile(path.join(projectRoot, "ktx.yaml"), "utf8");
    expect(ktxYaml).toContain("- fin.ledger");
    expect(ktxYaml).not.toContain("fin.orders");
  });

  it("SC-11: one failing Schema does not stop the others", async () => {
    await enableDiscovery();
    const readTables = readTablesFrom({ fin: [table("ledger", 6)], crm: [table("leads", 2)] });
    const config = await reconcileConnection(projectRoot, "warehouse", {
      readTables,
      readConnectionsImpl: async () => connections,
      currentGeneration: () => 0
    });
    expect(config?.schemas.fin?.status).toBe("ok");
    expect(config?.schemas.crm?.status).toBe("ok");
    // `ops` has no fixture entry — the fake provider reports a visibility error.
    expect(config?.schemas.ops?.status).toBe("error");
    expect(config?.schemas.ops?.lastReason).toBe("SCHEMA_NOT_VISIBLE");
    expect(config?.schemas.fin?.lastCompletedAt).not.toBeNull();
  });

  it("SC-12: repeated failures back off and finally pause the Schema", async () => {
    await enableDiscovery({ intervalMs: 300_000 });
    const readTables = vi.fn(async () => ({
      status: "error" as const,
      tables: [] as LiveTableEntry[],
      fetchedAt: new Date().toISOString(),
      reason: "CONNECTION_FAILED" as LiveTableFailureReason
    }));
    let config = null;
    for (let round = 0; round < MAX_CONSECUTIVE_FAILURES; round += 1) {
      config = await reconcileConnection(projectRoot, "warehouse", {
        readTables,
        readConnectionsImpl: async () => connections,
        currentGeneration: () => 0
      });
    }
    expect(config?.schemas.fin?.consecutiveFailures).toBe(MAX_CONSECUTIVE_FAILURES);
    expect(config?.schemas.fin?.status).toBe("paused");

    // A paused Schema is never retried automatically.
    const callsBefore = readTables.mock.calls.length;
    await reconcileConnection(projectRoot, "warehouse", {
      readTables,
      readConnectionsImpl: async () => connections,
      currentGeneration: () => 0
    });
    expect(readTables.mock.calls.length).toBe(callsBefore);
  });

  it("SC-13: one success clears the failure counter and leaves the backoff", async () => {
    await enableDiscovery({ intervalMs: 300_000 });
    const failing = vi.fn(async () => ({
      status: "error" as const,
      tables: [] as LiveTableEntry[],
      fetchedAt: new Date().toISOString(),
      reason: "CONNECTION_FAILED" as LiveTableFailureReason
    }));
    await reconcileConnection(projectRoot, "warehouse", {
      readTables: failing,
      readConnectionsImpl: async () => connections,
      currentGeneration: () => 0
    });
    const failed = await loadDiscoveryConfig(projectRoot, "warehouse");
    expect(failed?.schemas.fin?.consecutiveFailures).toBe(1);
    expect(failed?.schemas.fin?.nextAttemptAt).not.toBeNull();

    const config = await reconcileConnection(projectRoot, "warehouse", {
      readTables: readTablesFrom({ fin: [table("ledger", 6)] }),
      readConnectionsImpl: async () => connections,
      currentGeneration: () => 0
    });
    expect(config?.schemas.fin?.consecutiveFailures).toBe(0);
    expect(config?.schemas.fin?.nextAttemptAt).toBeNull();
    expect(config?.schemas.fin?.lastCompletedAt).not.toBeNull();
  });

  it("SC-19: a failed snapshot write leaves the baseline untouched and repeats the difference", async () => {
    await enableDiscovery();
    await reconcileConnection(projectRoot, "warehouse", {
      readTables: readTablesFrom({ fin: [table("ledger", 6)] }),
      readConnectionsImpl: async () => connections,
      currentGeneration: () => 0
    });
    const baseline = (await loadSnapshotPairs(projectRoot))[`warehouse\u0000fin`];

    // A directory in place of the snapshot file makes every snapshot write fail
    // while the other sidecars keep working. The original file is parked, so the
    // baseline is still there after the repair.
    const snapshotPath = path.join(projectRoot, ".ktx-ui", SNAPSHOTS_FILE);
    const parkedPath = path.join(projectRoot, ".ktx-ui", "snapshots.parked.json");
    await rename(snapshotPath, parkedPath);
    await mkdir(snapshotPath, { recursive: true });

    const broken = await reconcileConnection(projectRoot, "warehouse", {
      readTables: readTablesFrom({ fin: [table("ledger", 6), table("orders", 4)] }),
      readConnectionsImpl: async () => connections,
      currentGeneration: () => 0
    });
    expect(broken?.schemas.fin?.lastReason).toBe("SNAPSHOT_WRITE_FAILED");

    // The baseline never advanced and no event was written.
    const events = (await loadChangeEvents(projectRoot)).warehouse ?? [];
    expect(events).toEqual([]);

    // Repair the file: the next round reports the same difference again.
    await rm(snapshotPath, { recursive: true, force: true });
    await rename(parkedPath, snapshotPath);
    await reconcileConnection(projectRoot, "warehouse", {
      readTables: readTablesFrom({ fin: [table("ledger", 6), table("orders", 4)] }),
      readConnectionsImpl: async () => connections,
      currentGeneration: () => 0
    });
    const repaired = (await loadChangeEvents(projectRoot)).warehouse ?? [];
    expect(repaired.map((event) => event.kind)).toContain("added");
    expect(baseline?.current.tables).toEqual([table("ledger", 6)]);
  });

  it("SC-27: a round without a difference still advances the snapshot", async () => {
    await enableDiscovery();
    await reconcileConnection(projectRoot, "warehouse", {
      readTables: readTablesFrom({ fin: [table("ledger", 6)] }),
      readConnectionsImpl: async () => connections,
      currentGeneration: () => 0
    });
    const first = (await loadSnapshotPairs(projectRoot))[`warehouse\u0000fin`];

    await new Promise((resolve) => setTimeout(resolve, 5));
    await reconcileConnection(projectRoot, "warehouse", {
      readTables: readTablesFrom({ fin: [table("ledger", 6)] }),
      readConnectionsImpl: async () => connections,
      currentGeneration: () => 0
    });
    const second = (await loadSnapshotPairs(projectRoot))[`warehouse\u0000fin`];
    expect(second?.current.fetchedAt).not.toBe(first?.current.fetchedAt);
    expect(second?.previous?.fetchedAt).toBe(first?.current.fetchedAt);
    expect((await loadChangeEvents(projectRoot)).warehouse ?? []).toEqual([]);
  });

  it("SC-22: a connection without the switch never queries the library", async () => {
    const readTables = readTablesFrom({ fin: [table("ledger", 6)] });
    const result = await reconcileConnection(projectRoot, "warehouse", {
      readTables,
      readConnectionsImpl: async () => connections,
      currentGeneration: () => 0
    });
    expect(result).toBeNull();
    expect(readTables).not.toHaveBeenCalled();
  });

  it("SC-9: a changed configuration generation voids the snapshot and the baseline", async () => {
    await enableDiscovery();
    await reconcileConnection(projectRoot, "warehouse", {
      readTables: readTablesFrom({ fin: [table("ledger", 6)] }),
      readConnectionsImpl: async () => connections,
      currentGeneration: () => 0
    });
    expect((await loadSnapshotPairs(projectRoot))[`warehouse\u0000fin`]).toBeDefined();

    await reconcileConnection(projectRoot, "warehouse", {
      readTables: readTablesFrom({ fin: [table("ledger", 6)] }),
      readConnectionsImpl: async () => connections,
      currentGeneration: () => 7
    });
    const pairs = await loadSnapshotPairs(projectRoot);
    const pair = pairs[`warehouse\u0000fin`];
    // The old snapshot was voided and the new generation re-established the baseline.
    expect(pair?.current.generation).toBe(7);
    expect(pair?.previous).toBeUndefined();
  });

  it("SC-21: the change event history is capped and never feeds the current state", async () => {
    await enableDiscovery();
    for (let round = 0; round < 60; round += 1) {
      await reconcileConnection(projectRoot, "warehouse", {
        readTables: readTablesFrom({ fin: [table(`t${round}`, 2)] }),
        readConnectionsImpl: async () => connections,
        currentGeneration: () => 0
      });
    }
    const events = (await loadChangeEvents(projectRoot)).warehouse ?? [];
    expect(events.length).toBe(50);

    // The current state is recomputed from the snapshot, not from the events.
    const pairs = await loadSnapshotPairs(projectRoot);
    const pair = pairs[`warehouse\u0000fin`];
    const reconciliation = computeReconciliation(
      "fin",
      pair!.current.tables.map((entry) => `fin.${entry.table}`),
      ["fin.ledger"],
      ["fin.ledger"]
    );
    expect(reconciliation.discoveredInLibrary).toEqual(["fin.t59"]);
    expect(reconciliation.notInLibrary).toEqual(["fin.ledger"]);
  });

  it("SC-29: the snapshot, events, config and failure state survive a restart", async () => {
    await enableDiscovery();
    await reconcileConnection(projectRoot, "warehouse", {
      readTables: readTablesFrom({ fin: [table("ledger", 6)] }),
      readConnectionsImpl: async () => connections,
      currentGeneration: () => 0
    });
    await reconcileConnection(projectRoot, "warehouse", {
      readTables: readTablesFrom({ fin: [table("ledger", 6), table("orders", 4)] }),
      readConnectionsImpl: async () => connections,
      currentGeneration: () => 0
    });

    // "Restart": read everything back from the sidecar files.
    const pairs = await loadSnapshotPairs(projectRoot);
    const events = await loadChangeEvents(projectRoot);
    const config = await loadDiscoveryConfig(projectRoot, "warehouse");
    expect(pairs[`warehouse\u0000fin`]?.current.tables).toHaveLength(2);
    expect(events.warehouse).toHaveLength(1);
    expect(config?.enabled).toBe(true);
    expect(config?.schemas.fin?.status).toBe("ok");
    expect(config?.schemas.fin?.consecutiveFailures).toBe(0);
  });

  it("SC-30: every table query leaves one audit event", async () => {
    await enableDiscovery();
    const events: Array<{ action: string; outcome: string }> = [];
    await reconcileConnection(projectRoot, "warehouse", {
      readTables: readTablesFrom({ fin: [table("ledger", 6)], ops: [table("jobs", 2)] }),
      readConnectionsImpl: async () => connections,
      currentGeneration: () => 0,
      onAudit: (event) => {
        events.push({ action: event.action, outcome: event.outcome });
      }
    });
    expect(events).toHaveLength(3);
    expect(events.filter((event) => event.outcome === "ok")).toHaveLength(2);
    expect(events.filter((event) => event.outcome === "error")).toHaveLength(1);

    const id = await recordDiscoveryAudit({
      actor: "admin-1",
      connectionId: "warehouse",
      schema: "fin",
      action: "list",
      outcome: "ok",
      latencyMs: 12,
      tableCount: 4
    });
    expect(id).toBeGreaterThan(0);
  });

  it("SC-31: the sidecar is written atomically with mode 0600 and holds no column values", async () => {
    await enableDiscovery();
    await reconcileConnection(projectRoot, "warehouse", {
      readTables: readTablesFrom({ fin: [table("ledger", 6)] }),
      readConnectionsImpl: async () => connections,
      currentGeneration: () => 0
    });

    const snapshotPath = path.join(projectRoot, ".ktx-ui", SNAPSHOTS_FILE);
    const mode = (await stat(snapshotPath)).mode & 0o777;
    expect(mode).toBe(0o600);

    const raw = await readFile(snapshotPath, "utf8");
    const parsed = JSON.parse(raw) as {
      entries: Record<string, { current: { tables: Array<Record<string, unknown>> } }>;
    };
    const tables = Object.values(parsed.entries)[0].current.tables;
    expect(Object.keys(tables[0]).sort()).toEqual(["columnCount", "table", "tableType"]);
    expect(raw).not.toContain("value");
  });

  it("SC-32: the table query runs on its own queue quota", async () => {
    expect(liveTableProbeScheduler.stats()).toEqual({
      running: 0,
      queued: 0,
      peakRunning: 0,
      peakQueued: 0
    });

    // Fill the dedicated queue.
    const blockers = Array.from({ length: 16 }, (_unused, index) =>
      liveTableProbeScheduler.submit({
        key: `blocker-${index}`,
        generation: 0,
        purpose: "automatic",
        run: () => new Promise(() => undefined)
      })
    );
    blockers.forEach((promise) => promise.catch(() => undefined));
    await new Promise((resolve) => setTimeout(resolve, 5));

    // A separate scheduler (the shared `test` / `live-schemas` queue) is unaffected.
    const shared = new ProbeScheduler({ concurrency: 2, maxQueued: 64 });
    await expect(
      shared.submit({ key: "shared", generation: 0, purpose: "automatic", run: async () => "ok" })
    ).resolves.toMatchObject({ value: "ok" });
    shared.resetForTests();
    liveTableProbeScheduler.resetForTests();
  });

  it("SC-32: the background poll runs on the same dedicated queue as the manual read", async () => {
    await enableDiscovery();
    // Fill the dedicated table-query queue. The reconciler below does not get a
    // fake provider: it uses the real read path, which has to go through the
    // same queue as the manual read.
    const blockers = Array.from({ length: 20 }, (_unused, index) =>
      liveTableProbeScheduler.submit({
        key: `blocker-${index}`,
        generation: 0,
        purpose: "automatic",
        run: () => new Promise(() => undefined)
      })
    );
    blockers.forEach((promise) => promise.catch(() => undefined));
    await new Promise((resolve) => setTimeout(resolve, 5));

    const config = await reconcileConnection(projectRoot, "warehouse", {
      readConnectionsImpl: async () => connections,
      currentGeneration: () => 0
    });
    // The queue refused the poll, so the Schema is isolated with the queue
    // reason instead of hitting the library outside the quota.
    expect(config?.schemas.fin?.status).toBe("error");
    expect(config?.schemas.fin?.lastReason).toBe("PROBE_QUEUE_FULL");
    expect(config?.schemas.fin?.consecutiveFailures).toBe(1);
    liveTableProbeScheduler.resetForTests();
  });
});

describe("Spec 190 — worker scheduling", () => {
  const baseState = {
    status: "ok" as const,
    lastAttemptAt: "2026-01-01T00:00:00.000Z",
    lastCompletedAt: "2026-01-01T00:00:00.000Z",
    lastReason: null,
    consecutiveFailures: 0,
    nextAttemptAt: null
  };

  it("picks a connection up on the first round even without a persisted Schema state", () => {
    const config: DiscoveryConfig = {
      connectionId: "warehouse",
      enabled: true,
      intervalMs: 3_600_000,
      generation: 0,
      schemas: {}
    };
    // The Schema list of `ktx.yaml` decides the schedule; without it the
    // connection would never be polled at all.
    expect(isConnectionDue(config, Date.now(), ["fin"])).toBe(true);
    expect(isConnectionDue(config, Date.now(), [])).toBe(false);
  });

  it("waits for the polling interval and honours the backoff window", () => {
    const config: DiscoveryConfig = {
      connectionId: "warehouse",
      enabled: true,
      intervalMs: 3_600_000,
      generation: 0,
      schemas: { fin: baseState }
    };
    const now = Date.parse("2026-01-01T00:10:00.000Z");
    expect(isConnectionDue(config, now, ["fin"])).toBe(false);
    expect(isConnectionDue(config, Date.parse("2026-01-01T02:00:00.000Z"), ["fin"])).toBe(true);

    const backingOff: DiscoveryConfig = {
      ...config,
      schemas: {
        fin: {
          ...baseState,
          status: "error",
          consecutiveFailures: 2,
          nextAttemptAt: "2026-01-01T00:30:00.000Z"
        }
      }
    };
    expect(isConnectionDue(backingOff, now, ["fin"])).toBe(false);
    expect(
      isConnectionDue(backingOff, Date.parse("2026-01-01T00:31:00.000Z"), ["fin"])
    ).toBe(true);
  });

  it("never schedules a paused Schema again", () => {
    const config: DiscoveryConfig = {
      connectionId: "warehouse",
      enabled: true,
      intervalMs: 3_600_000,
      generation: 0,
      schemas: {
        fin: {
          ...baseState,
          status: "paused",
          lastReason: "AUTH_FAILED",
          consecutiveFailures: 10
        }
      }
    };
    expect(isConnectionDue(config, Date.parse("2026-02-01T00:00:00.000Z"), ["fin"])).toBe(false);
  });
});

describe("Spec 190 — connection status aggregation", () => {  it("SC-14: aggregates ok / partial / error / paused / never_run", () => {
    const ok = { status: "ok" as const, lastAttemptAt: "t", lastCompletedAt: null, lastReason: null, consecutiveFailures: 0, nextAttemptAt: null };
    const error = { ...ok, status: "error" as const, lastReason: "QUERY_FAILED" as LiveTableFailureReason };
    const paused = { ...ok, status: "paused" as const, lastReason: "AUTH_FAILED" as LiveTableFailureReason };
    const never = { ...ok, lastAttemptAt: "" };

    expect(aggregateConnectionStatus([])).toBe("never_run");
    expect(aggregateConnectionStatus([never])).toBe("never_run");
    expect(aggregateConnectionStatus([ok, ok])).toBe("ok");
    expect(aggregateConnectionStatus([ok, error])).toBe("partial");
    expect(aggregateConnectionStatus([error, error])).toBe("error");
    expect(aggregateConnectionStatus([paused, paused])).toBe("paused");
    expect(aggregateConnectionStatus([ok, paused])).toBe("partial");
  });

  it("computes an exponential backoff that is capped at one hour", () => {
    expect(backoffMs(300_000, 1)).toBe(300_000);
    expect(backoffMs(300_000, 2)).toBe(600_000);
    expect(backoffMs(300_000, 3)).toBe(1_200_000);
    expect(backoffMs(3_600_000, 5)).toBe(3_600_000);
  });
});

describe("Spec 190 — GET / PUT /api/connections/:connId/discovery", () => {
  function cookieOf(response: { headers: Record<string, unknown> }): string {
    const raw = response.headers["set-cookie"];
    const first = Array.isArray(raw) ? raw[0] : raw;
    return String(first ?? "").split(";")[0];
  }

  /** Boot the real server with a real owner and a real operator. */
  async function bootAuthenticatedApp() {
    process.env.LUCY_WEBUI_AUTH = "required";
    resetAdminsCache();
    const app = buildServer();
    await app.ready();
    const boot = await app.inject({
      method: "POST",
      url: "/api/auth/bootstrap",
      payload: { adminId: "owner-1", displayName: "Owner", password: "owner-password-1" }
    });
    const ownerCookie = cookieOf(boot);
    const created = await app.inject({
      method: "POST",
      url: "/api/admin/admins",
      headers: { cookie: ownerCookie },
      payload: {
        adminId: "op-1",
        displayName: "Op",
        password: "operator-password-1",
        role: "operator"
      }
    });
    expect(created.statusCode).toBe(200);
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { adminId: "op-1", password: "operator-password-1" }
    });
    const operatorCookie = cookieOf(login);
    return { app, ownerCookie, operatorCookie };
  }

  it("reports the status of a connection without a configuration", async () => {
    const { app, ownerCookie } = await bootAuthenticatedApp();
    const res = await request(app.server)
      .get("/api/connections/warehouse/discovery")
      .set("cookie", ownerCookie)
      .expect(200);
    expect(res.body.data.enabled).toBe(false);
    expect(res.body.data.status).toBe("never_run");
    expect(res.body.data.diffCount).toEqual({ added: 0, missing: 0, columnCountChanged: 0 });
    await app.close();
  });

  it("SC-23: refuses an interval outside the whitelist and keeps the configuration", async () => {
    const { app, ownerCookie } = await bootAuthenticatedApp();
    const res = await request(app.server)
      .put("/api/connections/warehouse/discovery")
      .set("cookie", ownerCookie)
      .send({ enabled: true, intervalMs: 60_000 })
      .expect(400);
    expect(res.body.error.code).toBe("BAD_REQUEST");
    const stored = await loadDiscoveryConfig(projectRoot, "warehouse");
    expect(stored).toBeNull();
    await app.close();
  });

  it("SC-23: refuses a body without an explicit boolean `enabled` and keeps the configuration", async () => {
    const { app, ownerCookie } = await bootAuthenticatedApp();
    // A malformed body must not silently switch continuous discovery off.
    const res = await request(app.server)
      .put("/api/connections/warehouse/discovery")
      .set("cookie", ownerCookie)
      .send({ intervalMs: 3_600_000 })
      .expect(400);
    expect(res.body.error.code).toBe("BAD_REQUEST");
    const stored = await loadDiscoveryConfig(projectRoot, "warehouse");
    expect(stored).toBeNull();
    await app.close();
  });

  it("SC-24: refuses a non-owner and keeps the configuration", async () => {
    const { app, operatorCookie } = await bootAuthenticatedApp();
    const res = await request(app.server)
      .put("/api/connections/warehouse/discovery")
      .set("cookie", operatorCookie)
      .send({ enabled: true, intervalMs: 3_600_000 })
      .expect(403);
    expect(res.body.error.code).toBe("OWNER_REQUIRED");
    const stored = await loadDiscoveryConfig(projectRoot, "warehouse");
    expect(stored).toBeNull();
    await app.close();
  });

  it("accepts a whitelisted interval and resets the failure counters", async () => {
    const { app, ownerCookie } = await bootAuthenticatedApp();
    await saveDiscoveryConfig(projectRoot, {
      connectionId: "warehouse",
      enabled: true,
      intervalMs: 300_000,
      generation: 0,
      schemas: {
        fin: {
          status: "paused",
          lastAttemptAt: "2026-01-01T00:00:00.000Z",
          lastCompletedAt: null,
          lastReason: "AUTH_FAILED",
          consecutiveFailures: 10,
          nextAttemptAt: "2026-01-01T01:00:00.000Z"
        }
      }
    });

    const res = await request(app.server)
      .put("/api/connections/warehouse/discovery")
      .set("cookie", ownerCookie)
      .send({ enabled: true, intervalMs: 900_000 })
      .expect(200);
    expect(res.body.data.intervalMs).toBe(900_000);

    const stored = await loadDiscoveryConfig(projectRoot, "warehouse");
    expect(stored?.intervalMs).toBe(900_000);
    expect(stored?.schemas.fin?.consecutiveFailures).toBe(0);
    expect(stored?.schemas.fin?.status).not.toBe("paused");
    await app.close();
  });
});
