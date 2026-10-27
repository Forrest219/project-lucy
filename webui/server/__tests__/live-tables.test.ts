import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SqlResult } from "../ktx";
import {
  classifyLiveTableFailure,
  clearLiveTablesCache,
  createSqlLiveTableProvider,
  liveTablesTtlMs,
  peekLiveTablesCache,
  readLiveTables,
  TABLE_LIST_MAX_ROWS
} from "../live-tables";
import { liveTableProbeFailureReason } from "../admin/live-discovery";
import { liveTableProbeScheduler } from "../live-table-queue";
import {
  ProbeGenerationInvalidatedError,
  ProbeQueueFullError,
  ProbeQueueTimeoutError
} from "../background-probes";
import { buildServer } from "../index";

/**
 * Spec 190 §7.1 / SC-1 ~ SC-10, SC-27, SC-28 — the Schema-level live table
 * list. The database boundary is the KTX CLI, so the suite mocks `runSql` and
 * drives a real temporary project root.
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

let projectRoot: string;
const previousEnv: Record<string, string | undefined> = {
  KTX_PROJECT_ROOT: process.env.KTX_PROJECT_ROOT,
  LUCY_CONTENT_ROOT: process.env.LUCY_CONTENT_ROOT
};

function okSql(rows: unknown[]): SqlResult {
  return {
    ok: true,
    exitCode: 0,
    stdout: JSON.stringify({ rows }),
    stderr: "",
    latencyMs: 9,
    command: "ktx sql ...",
    args: [],
    json: { rows }
  };
}

function failSql(stderr: string, exitCode = 1): SqlResult {
  return {
    ok: false,
    exitCode,
    stdout: "",
    stderr,
    latencyMs: 5,
    command: "ktx sql ...",
    args: [],
    json: null
  };
}

beforeEach(async () => {
  runSqlMock.mockReset();
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "ktx-spec-190-lt-"));
  await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
  await writeFile(path.join(projectRoot, "ktx.yaml"), KTX_YAML, "utf8");
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_CONTENT_ROOT = ".";
  clearLiveTablesCache();
  liveTableProbeScheduler.resetForTests();
});

afterEach(async () => {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  clearLiveTablesCache();
  liveTableProbeScheduler.resetForTests();
  if (projectRoot) await rm(projectRoot, { recursive: true, force: true });
  projectRoot = "";
});

describe("Spec 190 — live table provider", () => {
  it("SC-3/SC-4: reports an unusable protocol instead of guessing", async () => {
    const unknown = await createSqlLiveTableProvider({
      readConnectionsImpl: async () => [
        { id: "c1", driver: "unknown", schemas: [], enabledTables: [] }
      ]
    }).listTables({ projectRoot, connectionId: "c1", schema: "fin", generation: 0 });
    expect(unknown.status).toBe("error");
    expect(unknown.reason).toBe("PROTOCOL_UNSUPPORTED");

    const sqlserver = await createSqlLiveTableProvider({
      readConnectionsImpl: async () => [
        { id: "c1", driver: "sqlserver", wireProtocol: "sqlserver", schemas: [], enabledTables: [] }
      ]
    }).listTables({ projectRoot, connectionId: "c1", schema: "fin", generation: 0 });
    expect(sqlserver.status).toBe("error");
    expect(sqlserver.reason).toBe("TABLE_LIST_UNSUPPORTED");
    expect(runSqlMock).not.toHaveBeenCalled();
  });

  it("aggregates to table granularity and keeps the column count", async () => {
    runSqlMock.mockResolvedValue(
      okSql([
        ["ledger", "BASE TABLE", "总账", 6],
        ["orders", "BASE TABLE", "", 3]
      ])
    );
    const provider = createSqlLiveTableProvider();
    const result = await provider.listTables({
      projectRoot,
      connectionId: "warehouse",
      schema: "fin",
      generation: 0
    });
    expect(result.status).toBe("ok");
    expect(result.tables).toEqual([
      { table: "ledger", tableType: "BASE TABLE", columnCount: 6, tableComment: "总账" },
      { table: "orders", tableType: "BASE TABLE", columnCount: 3 }
    ]);
    const sql = String(runSqlMock.mock.calls[0]?.[2] ?? "");
    expect(sql).toContain("information_schema.tables");
    expect(sql).toContain("GROUP BY");
    expect(sql).toContain("'fin'");
  });

  it("SC-5: a full page fails instead of returning a truncated list", async () => {
    const rows = Array.from({ length: TABLE_LIST_MAX_ROWS }, (_unused, index) => [
      `t${index}`,
      "BASE TABLE",
      "",
      1
    ]);
    runSqlMock.mockResolvedValue(okSql(rows));
    const result = await createSqlLiveTableProvider().listTables({
      projectRoot,
      connectionId: "warehouse",
      schema: "fin",
      generation: 0
    });
    expect(result.status).toBe("error");
    expect(result.reason).toBe("TABLE_LIST_TOO_LARGE");
    expect(result.tables).toEqual([]);
  });

  it("SC-5: a full page with a malformed row still fails", async () => {
    // The page is complete — the answer may be truncated — but one of its rows
    // is malformed and therefore dropped while parsing. The ceiling is measured
    // on the raw row count, so the truncated page must not slip through as a
    // short but "complete" list.
    const rows = Array.from({ length: TABLE_LIST_MAX_ROWS }, (_unused, index) => [
      `t${index}`,
      "BASE TABLE",
      "",
      1
    ]);
    rows[0] = ["", "BASE TABLE", "", 1];
    runSqlMock.mockResolvedValue(okSql(rows));
    const result = await createSqlLiveTableProvider().listTables({
      projectRoot,
      connectionId: "warehouse",
      schema: "fin",
      generation: 0
    });
    expect(result.status).toBe("error");
    expect(result.reason).toBe("TABLE_LIST_TOO_LARGE");
    expect(result.tables).toEqual([]);
  });
});

describe("Spec 190 — failure classification", () => {
  const cases: Array<[string, string]> = [
    ["ERROR 1045 (28000): Access denied for user 'u'@'h' (using password: YES)", "AUTH_FAILED"],
    ["FATAL: password authentication failed for user \"u\"", "AUTH_FAILED"],
    ["ERROR 2003 (HY000): Can't connect to MySQL server on 'h' (111)", "CONNECTION_FAILED"],
    ["ERROR 1049 (42000): Unknown database 'fin'", "SCHEMA_NOT_FOUND"],
    ['ERROR: schema "fin" does not exist', "SCHEMA_NOT_FOUND"],
    ["ERROR: permission denied for schema fin", "SCHEMA_NOT_VISIBLE"],
    ["ERROR: must be owner of schema fin", "SCHEMA_NOT_VISIBLE"],
    ["ktx CLI was not found in PATH", "PROVIDER_UNAVAILABLE"],
    ["syntax error near 'SELECT'", "QUERY_FAILED"]
  ];

  it.each(cases)("classifies %s", (stderr, expected) => {
    expect(classifyLiveTableFailure({ exitCode: 1, stdout: "", stderr })).toBe(expected);
  });

  it("SC-10: keeps an undecidable error conservative instead of claiming a deletion", () => {
    // The database does not say the Schema is missing — it must not be reported
    // as `SCHEMA_NOT_FOUND`.
    expect(
      classifyLiveTableFailure({
        exitCode: 1,
        stdout: "",
        stderr: "ERROR: something went wrong"
      })
    ).toBe("QUERY_FAILED");
  });

  it("separates a credential failure from a privilege failure on one database", () => {
    // MySQL 1045: the credentials are wrong.
    expect(
      classifyLiveTableFailure({
        exitCode: 1,
        stdout: "",
        stderr: "ERROR 1045 (28000): Access denied for user 'u'@'h' (using password: YES)"
      })
    ).toBe("AUTH_FAILED");
    // MySQL 1044: the credentials work, the account may not see this database.
    expect(
      classifyLiveTableFailure({
        exitCode: 1,
        stdout: "",
        stderr: "ERROR 1044 (42000): Access denied for user 'u'@'h' to database 'fin'"
      })
    ).toBe("SCHEMA_NOT_VISIBLE");
  });
});

describe("Spec 190 — cache and generation", () => {
  it("SC-8: a repeated manual read of the same generation is served from the cache", async () => {
    runSqlMock.mockResolvedValue(okSql([["ledger", "BASE TABLE", "", 6]]));
    const first = await readLiveTables(projectRoot, "warehouse", "fin", { purpose: "manual" });
    expect(first.cached).toBe(false);
    expect(runSqlMock).toHaveBeenCalledTimes(1);

    const second = await readLiveTables(projectRoot, "warehouse", "fin", { purpose: "manual" });
    expect(second.cached).toBe(true);
    expect(runSqlMock).toHaveBeenCalledTimes(1);
  });

  it("SC-28: the automatic purpose never rides on the manual cache", async () => {
    runSqlMock.mockResolvedValue(okSql([["ledger", "BASE TABLE", "", 6]]));
    await readLiveTables(projectRoot, "warehouse", "fin", { purpose: "manual" });
    expect(runSqlMock).toHaveBeenCalledTimes(1);

    const automatic = await readLiveTables(projectRoot, "warehouse", "fin", {
      purpose: "automatic",
      intervalMs: 300_000
    });
    expect(automatic.cached).toBe(false);
    expect(runSqlMock).toHaveBeenCalledTimes(2);
  });

  it("SC-9: a result of an older generation is neither returned nor cached", async () => {
    runSqlMock.mockResolvedValue(okSql([["ledger", "BASE TABLE", "", 6]]));
    let generation = 3;
    const stale = await readLiveTables(
      projectRoot,
      "warehouse",
      "fin",
      { refresh: true, purpose: "manual" },
      { currentGeneration: () => generation }
    );
    expect(stale.status).toBe("ok");

    generation = 4;
    expect(peekLiveTablesCache(projectRoot, "warehouse", "fin", 4, "manual")).toBeNull();
    const fresh = await readLiveTables(
      projectRoot,
      "warehouse",
      "fin",
      { purpose: "manual" },
      { currentGeneration: () => generation }
    );
    expect(fresh.cached).toBe(false);
    expect(runSqlMock).toHaveBeenCalledTimes(2);
  });

  it("keeps the automatic TTL at the polling interval", () => {
    expect(liveTablesTtlMs("automatic", 300_000)).toBe(300_000);
    expect(liveTablesTtlMs("manual")).toBe(10 * 60 * 1000);
  });
});

describe("Spec 190 — GET /api/connections/:connId/live-tables", () => {
  it("SC-1: rejects a missing or illegal schema before touching the database", async () => {
    const app = buildServer();
    await app.ready();
    const missing = await request(app.server)
      .get("/api/connections/warehouse/live-tables")
      .expect(400);
    expect(missing.body.error.code).toBe("BAD_REQUEST");

    const illegal = await request(app.server)
      .get("/api/connections/warehouse/live-tables")
      .query({ schema: "fin; DROP TABLE x" })
      .expect(400);
    expect(illegal.body.error.code).toBe("BAD_REQUEST");
    expect(runSqlMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("SC-2: answers 404 for an unknown connection", async () => {
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .get("/api/connections/ghost/live-tables")
      .query({ schema: "fin" })
      .expect(404);
    expect(res.body.error.code).toBe("CONNECTION_NOT_FOUND");
    await app.close();
  });

  it("returns the table list and reuses the cache on the second read", async () => {
    runSqlMock.mockResolvedValue(okSql([["ledger", "BASE TABLE", "", 6]]));
    const app = buildServer();
    await app.ready();
    const first = await request(app.server)
      .get("/api/connections/warehouse/live-tables")
      .query({ schema: "fin" })
      .expect(200);
    expect(first.body.data.status).toBe("ok");
    expect(first.body.data.tables).toHaveLength(1);
    expect(first.body.data.cached).toBe(false);

    const second = await request(app.server)
      .get("/api/connections/warehouse/live-tables")
      .query({ schema: "fin" })
      .expect(200);
    expect(second.body.data.cached).toBe(true);
    expect(runSqlMock).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it("SC-6: a full probe queue answers with a reason instead of a 500", async () => {
    const app = buildServer();
    await app.ready();
    // Fill the dedicated queue so the next submission is refused.
    const blockers = Array.from({ length: 32 }, (_unused, index) =>
      liveTableProbeScheduler.submit({
        key: `blocker-${index}`,
        generation: 0,
        purpose: "automatic",
        run: () => new Promise(() => undefined)
      })
    );
    blockers.forEach((promise) => promise.catch(() => undefined));
    await new Promise((resolve) => setTimeout(resolve, 5));

    const res = await request(app.server)
      .get("/api/connections/warehouse/live-tables")
      .query({ schema: "fin" })
      .expect(200);
    expect(res.body.data.status).toBe("error");
    expect(res.body.data.reason).toBe("PROBE_QUEUE_FULL");
    await app.close();
  });
});

describe("Spec 190 — probe failure mapping", () => {
  it("SC-7: maps every scheduler failure onto its own reason", () => {
    expect(liveTableProbeFailureReason(new ProbeQueueFullError())).toBe("PROBE_QUEUE_FULL");
    expect(liveTableProbeFailureReason(new ProbeQueueTimeoutError())).toBe("PROBE_QUEUE_TIMEOUT");
    expect(liveTableProbeFailureReason(new ProbeGenerationInvalidatedError())).toBe(
      "GENERATION_INVALIDATED"
    );
    expect(liveTableProbeFailureReason(new Error("other"))).toBeNull();
  });

  it("reports a queue deadline as PROBE_QUEUE_TIMEOUT, not as a full queue", async () => {
    const { createLiveTableProbeScheduler } = await import("../live-table-queue");
    const scheduler = createLiveTableProbeScheduler({
      concurrency: 1,
      maxQueued: 4,
      queueTimeoutMs: 20
    });
    const blocker = scheduler.submit({
      key: "blocker",
      generation: 0,
      purpose: "automatic",
      run: () => new Promise(() => undefined)
    });
    blocker.catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 5));

    await expect(
      scheduler.submit({
        key: "waiting",
        generation: 0,
        purpose: "automatic",
        run: async () => "x"
      })
    ).rejects.toBeInstanceOf(ProbeQueueTimeoutError);
    scheduler.resetForTests();
  });
});
