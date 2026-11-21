import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SqlResult } from "../ktx.js";
import type { ConnectionInfo } from "../model.js";

const state = vi.hoisted(() => ({
  events: [] as Array<Record<string, unknown>>,
  runSql: vi.fn()
}));

type StepCall = {
  op: string;
  opId: string;
  step: string;
  body: () => Promise<unknown>;
  classifyReturn?: (value: any) => { ok: true } | { ok: false; reasonCode: string };
};

const runStep = vi.hoisted(() => vi.fn());

vi.mock("../runtime/ops-step-journal.js", () => ({
  createOpsStepId: () => "ops_0123456789abcdef0123456789abcdef",
  getOpsStepJournal: () => ({ runStep, writeStep: vi.fn() }),
  opsStepReasonFromError: () => "unreadable"
}));
vi.mock("../ktx.js", async () => {
  const actual = await vi.importActual<typeof import("../ktx.js")>("../ktx.js");
  return { ...actual, runSql: state.runSql };
});

runStep.mockImplementation(async (call: StepCall) => {
  state.events.push({ op: call.op, opId: call.opId, step: call.step, phase: "enter" });
  try {
    const value = await call.body();
    const outcome = call.classifyReturn?.(value) ?? { ok: true };
    state.events.push({
      op: call.op,
      opId: call.opId,
      step: call.step,
      phase: outcome.ok ? "leave" : "fail",
      ...("reasonCode" in outcome ? { reasonCode: outcome.reasonCode } : {})
    });
    return value;
  } catch (error) {
    state.events.push({ op: call.op, opId: call.opId, step: call.step, phase: "fail", reasonCode: "unreadable" });
    throw error;
  }
});

import { buildServer } from "../index.js";
import { previewSchemaStructure, readSchemaColumns } from "../schema-structure.js";

const mysqlConn: ConnectionInfo = {
  id: "demo",
  driver: "mysql",
  engine: "mysql",
  wireProtocol: "mysql",
  schemas: ["dataforai"],
  enabledTables: []
};

function sqlResult(overrides: Partial<SqlResult> = {}): SqlResult {
  return {
    ok: true,
    exitCode: 0,
    stdout: "",
    stderr: "",
    latencyMs: 1,
    command: "ktx sql",
    args: [],
    json: { rows: [] },
    ...overrides
  };
}

function deps(runSqlImpl: typeof state.runSql, tables?: string[]) {
  return {
    readConnectionsImpl: async () => [mysqlConn],
    runSqlImpl,
    opsStepId: "ops_0123456789abcdef0123456789abcdef",
    ...(tables ? { tables } : {})
  };
}

function terminal() {
  return state.events.at(-1);
}

beforeEach(() => {
  state.events.length = 0;
  state.runSql.mockReset();
});

describe("schema_structure_read return classification", () => {
  it("uses list_tables for name-only reads", async () => {
    const runSqlImpl = vi.fn(async () => sqlResult({ json: { rows: [["orders"]] } }));
    const result = await readSchemaColumns("/project", "demo", "dataforai", deps(runSqlImpl));
    expect(result).toMatchObject({ status: "ok", tables: ["orders"] });
    expect(state.events.map((event) => `${String(event.step)}:${String(event.phase)}`)).toEqual([
      "list_tables:enter",
      "list_tables:leave"
    ]);
  });

  it("classifies returned status=error without inferring from driver text", async () => {
    const runSqlImpl = vi.fn(async () => sqlResult({
      ok: false,
      exitCode: 1,
      stderr: "permission denied but there is no structured permission classification",
      json: null
    }));
    await expect(previewSchemaStructure("/project", "demo", "dataforai", deps(runSqlImpl))).rejects.toMatchObject({
      message: "读取表结构失败：无法列出 Schema「dataforai」下的表。",
      detail: { opsStepId: "ops_0123456789abcdef0123456789abcdef" }
    });
    expect(terminal()).toMatchObject({ step: "list_tables", phase: "fail", reasonCode: "unreadable" });
    expect(JSON.stringify(state.events)).not.toContain("permission denied");
  });

  it("classifies status=too_large", async () => {
    const rows = Array.from({ length: 10_000 }, (_, index) => [`table_${index}`]);
    const runSqlImpl = vi.fn(async () => sqlResult({ json: { rows } }));
    const result = await readSchemaColumns("/project", "demo", "dataforai", deps(runSqlImpl));
    expect(result.status).toBe("too_large");
    expect(terminal()).toMatchObject({ step: "list_tables", phase: "fail", reasonCode: "too_large" });
  });

  it("preserves exact missing and adds opsStepId beside tableRejection", async () => {
    const runSqlImpl = vi.fn(async () => sqlResult({ json: { rows: [] } }));
    await expect(previewSchemaStructure(
      "/project",
      "demo",
      "dataforai",
      deps(runSqlImpl, ["missing_table"])
    )).rejects.toMatchObject({
      message: "表「missing_table」没有读到字段。",
      detail: {
        opsStepId: "ops_0123456789abcdef0123456789abcdef",
        tableRejection: expect.objectContaining({ reason: "missing" })
      }
    });
    expect(terminal()).toMatchObject({ step: "read_columns", phase: "fail", reasonCode: "missing" });
  });

  it("uses the first rejection in request-table order for mixed failures", async () => {
    const runSqlImpl = vi.fn(async (_root: string, _id: string, sql: string) => {
      if (sql.includes("LOWER(table_name) = 'first'")) {
        return sqlResult({ ok: false, exitCode: 1, stderr: "access denied", json: null });
      }
      if (sql.includes("LOWER(table_name) = 'second'")) {
        return sqlResult({ json: { rows: [] } });
      }
      return sqlResult({ ok: false, exitCode: 1, stderr: "unexpected query", json: null });
    });
    const result = await readSchemaColumns(
      "/project",
      "demo",
      "dataforai",
      deps(runSqlImpl, ["first", "second"])
    );
    expect(result).toMatchObject({
      status: "ok",
      rejections: [{ table: "first", reason: "permission" }, { table: "second", reason: "missing" }]
    });
    expect(terminal()).toMatchObject({ step: "read_columns", phase: "fail", reasonCode: "permission" });
  });

  it("classifies deferred without rejection as timeout", async () => {
    const runSqlImpl = vi.fn(async (_root: string, _id: string, sql: string) => {
      if (sql.includes("LOWER(table_name) = 'first'")) return sqlResult({ json: { rows: [["first"]] } });
      if (sql.includes("FROM information_schema.columns") && sql.includes("table_name = 'first'")) {
        return sqlResult({ json: { rows: [["id", "int", "NO", "PRI", ""]] } });
      }
      return sqlResult({ ok: false, exitCode: 1, stderr: "unexpected query", json: null });
    });
    const result = await readSchemaColumns("/project", "demo", "dataforai", {
      ...deps(runSqlImpl, ["first", "second"]),
      callBudgetMs: 0,
      now: () => 100
    });
    expect(result).toMatchObject({ status: "ok", deferred: ["second"] });
    expect(terminal()).toMatchObject({ step: "read_columns", phase: "fail", reasonCode: "timeout" });
  });
});

describe("schema-structure HTTP opsStepId", () => {
  let projectRoot: string;
  let previousRoot: string | undefined;
  let previousContentRoot: string | undefined;
  let previousLegacy: string | undefined;

  beforeEach(async () => {
    previousRoot = process.env.KTX_PROJECT_ROOT;
    previousContentRoot = process.env.LUCY_CONTENT_ROOT;
    previousLegacy = process.env.LUCY_SCHEMA_READ_LEGACY;
    projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-ops-step-schema-"));
    await writeFile(
      path.join(projectRoot, "ktx.yaml"),
      `connections:\n  demo:\n    driver: mysql\n    database: dataforai\n    schemas: [dataforai]\n    enabled_tables: []\n`,
      "utf8"
    );
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    process.env.LUCY_SCHEMA_READ_LEGACY = "1";
    state.runSql.mockImplementation(async (_root: string, _id: string, sql: string) => {
      if (sql.includes("LOWER(table_name) = 'orders'")) return sqlResult({ json: { rows: [["orders"]] } });
      if (sql.includes("FROM information_schema.columns") && sql.includes("table_name = 'orders'")) {
        return sqlResult({ json: { rows: [["id", "int", "NO", "PRI", ""]] } });
      }
      if (sql.includes("LOWER(table_name) = 'missing'")) return sqlResult({ json: { rows: [] } });
      return sqlResult({ ok: false, exitCode: 1, stderr: "unexpected query", json: null });
    });
  });

  afterEach(async () => {
    if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
    else process.env.KTX_PROJECT_ROOT = previousRoot;
    if (previousContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
    else process.env.LUCY_CONTENT_ROOT = previousContentRoot;
    if (previousLegacy === undefined) delete process.env.LUCY_SCHEMA_READ_LEGACY;
    else process.env.LUCY_SCHEMA_READ_LEGACY = previousLegacy;
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("returns data.opsStepId on HTTP 200 partial failure and detail.opsStepId on single-table failure", async () => {
    const app = buildServer();
    await app.ready();
    try {
      const partial = await request(app.server)
        .post("/api/connections/demo/schema-structure")
        .send({ schema: "dataforai", tables: ["orders", "missing"] })
        .expect(200);
      expect(partial.body.data.opsStepId).toBe("ops_0123456789abcdef0123456789abcdef");
      expect(partial.body.data.rejections).toEqual([
        expect.objectContaining({ table: "missing", reason: "missing", message: "表「missing」没有读到字段。" })
      ]);

      const failed = await request(app.server)
        .post("/api/connections/demo/schema-structure")
        .send({ schema: "dataforai", tables: ["missing"] })
        .expect(400);
      expect(failed.body.error.message).toBe("表「missing」没有读到字段。");
      expect(failed.body.error.detail).toMatchObject({
        opsStepId: "ops_0123456789abcdef0123456789abcdef",
        tableRejection: { reason: "missing" }
      });
    } finally {
      await app.close();
    }
  });
});
