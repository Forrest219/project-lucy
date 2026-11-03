import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SqlResult } from "../ktx";
import { getAuditDb, resetAuditDbForTests } from "../admin/audit";
import {
  loadChangeEvents,
  reconcileConnection,
  saveDiscoveryConfig,
  writeSnapshotPair
} from "../live-table-discovery";
import type { LiveTableEntry } from "../live-tables";
import { buildServer } from "../index";

/**
 * Spec 190 §7.3 / §7.4 — the reconciliation state, the table-list difference
 * and the on-demand column-level deep check.
 */

const runSqlMock = vi.fn();

vi.mock("../ktx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ktx")>();
  return { ...actual, runSql: (...args: unknown[]) => runSqlMock(...args) };
});

const KTX_YAML = `connections:
  warehouse:
    driver: mysql
    engine: mysql
    wire_protocol: mysql
    schemas:
      - fin
    enabled_tables:
      - fin.ledger
`;

const MANIFEST = `tables:
  ledger:
    table: fin.ledger
    columns:
      - name: id
        type: number
        nullable: false
        pk: true
      - name: amount
        type: number
        nullable: true
  orders:
    table: fin.orders
    columns:
      - name: id
        type: number
        nullable: false
`;

let projectRoot: string;
const previousEnv: Record<string, string | undefined> = {
  KTX_PROJECT_ROOT: process.env.KTX_PROJECT_ROOT,
  LUCY_CONTENT_ROOT: process.env.LUCY_CONTENT_ROOT
};

function table(name: string, columns = 3): LiveTableEntry {
  return { table: name, tableType: "BASE TABLE", columnCount: columns };
}

function okSql(rows: unknown[]): SqlResult {
  return {
    ok: true,
    exitCode: 0,
    stdout: JSON.stringify({ rows }),
    stderr: "",
    latencyMs: 7,
    command: "ktx sql ...",
    args: [],
    json: { rows }
  };
}

beforeEach(async () => {
  runSqlMock.mockReset();
  resetAuditDbForTests();
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "ktx-spec-190-td-"));
  await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
  await mkdir(path.join(projectRoot, "semantic-layer", "warehouse", "_schema"), {
    recursive: true
  });
  await writeFile(path.join(projectRoot, "ktx.yaml"), KTX_YAML, "utf8");
  await writeFile(
    path.join(projectRoot, "semantic-layer", "warehouse", "_schema", "fin.yaml"),
    MANIFEST,
    "utf8"
  );
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_CONTENT_ROOT = ".";
});

afterEach(async () => {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (projectRoot) await rm(projectRoot, { recursive: true, force: true });
  projectRoot = "";
});

async function seedTwoRounds(): Promise<void> {
  await saveDiscoveryConfig(projectRoot, {
    connectionId: "warehouse",
    enabled: true,
    intervalMs: 3_600_000,
    generation: 0,
    schemas: {}
  });
  const connections = [
    {
      id: "warehouse",
      driver: "mysql",
      engine: "mysql",
      wireProtocol: "mysql" as const,
      schemas: ["fin"],
      enabledTables: ["fin.ledger"]
    }
  ];
  await reconcileConnection(projectRoot, "warehouse", {
    readTables: async () => ({
      status: "ok" as const,
      tables: [table("ledger", 3)],
      fetchedAt: "2026-01-01T00:00:00.000Z"
    }),
    readConnectionsImpl: async () => connections,
    currentGeneration: () => 0
  });
  await reconcileConnection(projectRoot, "warehouse", {
    readTables: async () => ({
      status: "ok" as const,
      tables: [table("ledger", 4), table("orders", 2)],
      fetchedAt: "2026-01-02T00:00:00.000Z"
    }),
    readConnectionsImpl: async () => connections,
    currentGeneration: () => 0
  });
}

describe("Spec 190 — GET /api/connections/:connId/table-diff", () => {
  it("returns the reconciliation state and the table-list difference", async () => {
    await seedTwoRounds();
    const app = buildServer();
    await app.ready();
    const res = await request(app.server).get("/api/connections/warehouse/table-diff").expect(200);
    expect(res.body.data.connectionId).toBe("warehouse");
    const row = res.body.data.schemas.find((entry: { schema: string }) => entry.schema === "fin");
    expect(row.snapshotAt).toBe("2026-01-02T00:00:00.000Z");
    expect(row.listDiff.added).toEqual(["fin.orders"]);
    expect(row.listDiff.missing).toEqual([]);
    expect(row.listDiff.columnCountChanged).toEqual([
      { table: "fin.ledger", before: 3, after: 4 }
    ]);
    // The library holds both tables; the Manifest knows both as well, but only
    // `ledger` is inside the enabled range.
    expect(row.reconciliation.discoveredInLibrary).toEqual(["fin.ledger", "fin.orders"]);
    expect(row.reconciliation.missingInManifest).toEqual([]);
    expect(row.reconciliation.missingInEnabled).toEqual(["fin.orders"]);
    expect(row.reconciliation.notInLibrary).toEqual([]);
    expect(res.body.data.eventCount).toBe(2);
    expect(res.body.data.events).toBeUndefined();
    await app.close();
  });

  it("returns the change event history on request", async () => {
    await seedTwoRounds();
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .get("/api/connections/warehouse/table-diff")
      .query({ includeEvents: "1" })
      .expect(200);
    expect(res.body.data.events).toHaveLength(2);
    expect(res.body.data.events.map((event: { kind: string }) => event.kind).sort()).toEqual([
      "added",
      "column_count_changed"
    ]);
    const added = res.body.data.events.find((event: { kind: string }) => event.kind === "added");
    expect(added.tables).toEqual(["fin.orders"]);
    await app.close();
  });

  it("SC-20: a recovered table leaves the current state but stays in the event history", async () => {
    await seedTwoRounds();
    // The library lost `orders` again and then got it back: the current state
    // is recomputed from the latest snapshot, the history keeps the event.
    await writeSnapshotPair(projectRoot, "warehouse", "fin", {
      connectionId: "warehouse",
      schema: "fin",
      generation: 0,
      provider: "ktx_sql",
      fetchedAt: "2026-01-03T00:00:00.000Z",
      tables: [table("ledger", 4)]
    });

    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .get("/api/connections/warehouse/table-diff")
      .query({ includeEvents: "1" })
      .expect(200);
    const row = res.body.data.schemas.find((entry: { schema: string }) => entry.schema === "fin");
    expect(row.reconciliation.discoveredInLibrary).toEqual(["fin.ledger"]);
    expect(row.reconciliation.missingInManifest).toEqual([]);
    expect(row.reconciliation.notInLibrary).toEqual(["fin.orders"]);
    expect(res.body.data.events).toHaveLength(2);
    expect((await loadChangeEvents(projectRoot)).warehouse).toHaveLength(2);
    await app.close();
  });

  it("SC-20: a table the local Manifest does not know is reported as missing in the Manifest", async () => {
    await writeSnapshotPair(projectRoot, "warehouse", "fin", {
      connectionId: "warehouse",
      schema: "fin",
      generation: 0,
      provider: "ktx_sql",
      fetchedAt: "2026-01-02T00:00:00.000Z",
      tables: [table("ledger", 4)]
    });
    const app = buildServer();
    await app.ready();
    const res = await request(app.server).get("/api/connections/warehouse/table-diff").expect(200);
    const row = res.body.data.schemas.find((entry: { schema: string }) => entry.schema === "fin");
    // The Manifest knows `fin.orders`; the library does not have it anymore.
    expect(row.reconciliation.notInLibrary).toEqual(["fin.orders"]);
    expect(row.reconciliation.missingInManifest).toEqual([]);
    await app.close();
  });

  it("compares the Manifest and the library case insensitively", async () => {
    // The Manifest spells the Schema `Fin`, `ktx.yaml` spells it `fin`. They
    // are the same Schema — reporting every library table as missing from the
    // Manifest would be a false alarm.
    await writeFile(
      path.join(projectRoot, "semantic-layer", "warehouse", "_schema", "fin.yaml"),
      MANIFEST.replace(/fin\./g, "Fin."),
      "utf8"
    );
    await writeSnapshotPair(projectRoot, "warehouse", "fin", {
      connectionId: "warehouse",
      schema: "fin",
      generation: 0,
      provider: "ktx_sql",
      fetchedAt: "2026-01-02T00:00:00.000Z",
      tables: [table("ledger", 4)]
    });
    const app = buildServer();
    await app.ready();
    const res = await request(app.server).get("/api/connections/warehouse/table-diff").expect(200);
    const row = res.body.data.schemas.find((entry: { schema: string }) => entry.schema === "fin");
    expect(row.reconciliation.missingInManifest).toEqual([]);
    // `Fin.orders` is in the Manifest but not in the library.
    expect(row.reconciliation.notInLibrary).toEqual(["Fin.orders"]);
    await app.close();
  });
});

describe("Spec 190 — GET /api/connections/:connId/table-structure-diff", () => {
  it("SC-33: compares the library columns with the local Manifest", async () => {
    runSqlMock.mockResolvedValue(
      okSql([
        ["ledger", "id", "int", "NO", "PRI", ""],
        ["ledger", "amount", "decimal", "YES", "", ""],
        ["ledger", "memo", "varchar", "YES", "", ""]
      ])
    );
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .get("/api/connections/warehouse/table-structure-diff")
      .query({ schema: "fin", tables: "ledger,orders" })
      .expect(200);
    const ledger = res.body.data.tables.find(
      (entry: { table: string }) => entry.table === "fin.ledger"
    );
    expect(ledger.status).toBe("ok");
    expect(ledger.columns.added).toEqual([
      { name: "memo", type: "string", nullable: true, primaryKey: false }
    ]);
    expect(ledger.columns.removed).toEqual([]);
    expect(ledger.columns.changed).toEqual([]);

    // A table the library does not have is reported on its own.
    const orders = res.body.data.tables.find(
      (entry: { table: string }) => entry.table === "fin.orders"
    );
    expect(orders.status).toBe("not_in_library");
    await app.close();
  });

  it("SC-33: reports a changed column with the before and after values", async () => {
    runSqlMock.mockResolvedValue(
      okSql([
        ["ledger", "id", "bigint", "NO", "PRI", ""],
        ["ledger", "amount", "decimal", "NO", "", ""]
      ])
    );
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .get("/api/connections/warehouse/table-structure-diff")
      .query({ schema: "fin", tables: "ledger" })
      .expect(200);
    const ledger = res.body.data.tables[0];
    expect(ledger.columns.changed).toEqual([
      {
        name: "amount",
        before: { type: "number", nullable: true, primaryKey: false },
        after: { type: "number", nullable: false, primaryKey: false }
      }
    ]);
    await app.close();
  });

  it("rejects a missing schema, a missing table list and too many tables", async () => {
    const app = buildServer();
    await app.ready();
    await request(app.server)
      .get("/api/connections/warehouse/table-structure-diff")
      .expect(400);
    await request(app.server)
      .get("/api/connections/warehouse/table-structure-diff")
      .query({ schema: "fin" })
      .expect(400);
    const tooMany = Array.from({ length: 21 }, (_unused, index) => `t${index}`).join(",");
    await request(app.server)
      .get("/api/connections/warehouse/table-structure-diff")
      .query({ schema: "fin", tables: tooMany })
      .expect(400);
    await app.close();
  });

  it("SC-33: finds the library table even when the caller spells it differently", async () => {
    // The library spells the table in lower case; the caller asked for
    // `Ledger`. Both are the same table, so the deep check must not report it
    // as missing from the library.
    runSqlMock.mockResolvedValue(
      okSql([
        ["ledger", "id", "int", "NO", "PRI", ""],
        ["ledger", "amount", "decimal", "YES", "", ""]
      ])
    );
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .get("/api/connections/warehouse/table-structure-diff")
      .query({ schema: "fin", tables: "Ledger" })
      .expect(200);
    const row = res.body.data.tables[0];
    expect(row.status).toBe("ok");
    // The Manifest knows `id` and `amount` — the library has the same two.
    expect(row.columns.added).toEqual([]);
    expect(row.columns.removed).toEqual([]);
    expect(row.columns.changed).toEqual([]);
    await app.close();
  });

  it("SC-30: the deep check records its duration in the audit log", async () => {
    runSqlMock.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
      return okSql([["ledger", "id", "int", "NO", "PRI", ""]]);
    });
    const app = buildServer();
    await app.ready();
    await request(app.server)
      .get("/api/connections/warehouse/table-structure-diff")
      .query({ schema: "fin", tables: "ledger" })
      .expect(200);
    const database = await getAuditDb();
    // The newest row is this call: the read took ~60 ms, so the audit must
    // carry that duration and not a hard-coded zero.
    const rows = database
      .prepare(
        "SELECT latency_ms FROM discovery_audit_log WHERE action = 'structure_diff' ORDER BY id DESC LIMIT 1"
      )
      .all() as Array<{ latency_ms: number }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.latency_ms).toBeGreaterThanOrEqual(50);
    await app.close();
  });
});

describe("Spec 190 — unknown connection", () => {
  it("SC-2: answers an unknown connection with 404 instead of an empty result", async () => {
    const app = buildServer();
    await app.ready();
    const diff = await request(app.server).get("/api/connections/ghost/table-diff").expect(404);
    expect(diff.body.error.code).toBe("CONNECTION_NOT_FOUND");
    const discovery = await request(app.server).get("/api/connections/ghost/discovery").expect(404);
    expect(discovery.body.error.code).toBe("CONNECTION_NOT_FOUND");
    await app.close();
  });
});
