import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the ktx CLI wrapper so the test does not shell out.
vi.mock("../ktx", async () => {
  const actual = await vi.importActual<typeof import("../ktx")>("../ktx");
  return {
    ...actual,
    testConnection: vi.fn(async () => ({
      status: "ok" as const,
      latencyMs: 5,
      detail: "ok"
    })),
    runIngest: vi.fn(async () => ({ exitCode: 0, stdout: "scanned 3 tables", stderr: "" })),
    validateSource: vi.fn(async () => ({
      ok: true,
      exitCode: 0,
      stdout: "valid",
      stderr: "",
      issues: []
    }))
  };
});

let projectRoot: string;
let auditDbPath: string;
let previousRoot: string | undefined;
let previousAuditDb: string | undefined;

async function makeProject(yaml: string, schemaFiles: Record<string, string> = {}) {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-api-ingest-"));
  await writeFile(path.join(projectRoot, "ktx.yaml"), yaml, "utf8");
  auditDbPath = path.join(projectRoot, ".ktx-ui", "audit.sqlite");
  await mkdir(path.dirname(auditDbPath), { recursive: true });
  const connId = "demo-mysql";
  for (const [schemaName, content] of Object.entries(schemaFiles)) {
    const dir = path.join(projectRoot, "semantic-layer", connId, "_schema");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${schemaName}.yaml`), content, "utf8");
  }
}

beforeEach(async () => {
  // The server caches module-scope state (project root resolution, sidecar IO).
  // Resetting modules between tests forces a fresh import so each test gets its
  // own KTX_PROJECT_ROOT and isolated .ktx-ui sidecar directory.
  vi.resetModules();
  previousRoot = process.env.KTX_PROJECT_ROOT;
  previousAuditDb = process.env.LUCY_AUDIT_DB;
  vi.clearAllMocks();
});

afterEach(async () => {
  if (previousRoot === undefined) {
    delete process.env.KTX_PROJECT_ROOT;
  } else {
    process.env.KTX_PROJECT_ROOT = previousRoot;
  }
  if (previousAuditDb === undefined) {
    delete process.env.LUCY_AUDIT_DB;
  } else {
    process.env.LUCY_AUDIT_DB = previousAuditDb;
  }
  if (projectRoot) {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

async function buildFreshServer() {
  const { buildServer } = await import("../index");
  return buildServer();
}

const SCHEMA_FILES = {
  dataforai: `tables:
  superstore_orders:
    table: dataforai.superstore_orders
  superstore_people:
    table: dataforai.superstore_people
  superstore_returns:
    table: dataforai.superstore_returns
`
};

describe("POST /api/connections/:connId/ingest", () => {
  it("records a successful connection-scoped run and appends to sidecar", async () => {
    await makeProject(
      `connections:\n  demo-mysql:\n    schemas: [dataforai]\n    enabled_tables: [dataforai.superstore_orders]\n`,
      SCHEMA_FILES
    );
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const app = await buildFreshServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/connections/demo-mysql/ingest")
      .send({})
      .expect(200);

    expect(res.body.ok).toBe(true);
    const run = res.body.data;
    expect(run.connectionId).toBe("demo-mysql");
    expect(run.requestedScope).toBe("connection");
    expect(run.executedScope).toBe("connection");
    expect(run.schemaScopedSupported).toBe(false);
    expect(run.status).toBe("success");
    expect(run.exitCode).toBe(0);
    expect(run.command).toEqual(["ktx", "ingest", "demo-mysql"]);
    expect(run.scannedTableCount).toBe(3);
    expect(run.scannedSchemas).toEqual(["dataforai"]);
    expect(run.finishedAt).toBeDefined();
    expect(run.durationMs).toBeGreaterThanOrEqual(0);

    // Sidecar file should now exist.
    const sidecarText = await readFile(
      path.join(projectRoot, ".ktx-ui", "ingest-runs.json"),
      "utf8"
    );
    const sidecar = JSON.parse(sidecarText) as { runs: Array<{ id: string }> };
    expect(sidecar.runs).toHaveLength(1);
    expect(sidecar.runs[0]?.id).toBe(run.id);

    await app.close();
  });

  it("preserves requestedScope=schema but executes connection scope when KTX does not support schema", async () => {
    await makeProject(
      `connections:\n  demo-mysql:\n    schemas: [dataforai]\n    enabled_tables: [dataforai.superstore_orders]\n`,
      SCHEMA_FILES
    );
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const app = await buildFreshServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/connections/demo-mysql/ingest")
      .send({ schema: "openclaw_db" })
      .expect(200);

    expect(res.body.ok).toBe(true);
    const run = res.body.data;
    expect(run.schema).toBe("openclaw_db");
    expect(run.requestedScope).toBe("schema");
    expect(run.executedScope).toBe("connection");
    expect(run.schemaScopedSupported).toBe(false);

    // The CLI command must not include a fake --schema flag.
    expect(run.command).toEqual(["ktx", "ingest", "demo-mysql"]);

    await app.close();
  });

  it("returns structured failure data (still ok:true) with exitCode, stderr, stdout, hint", async () => {
    await makeProject(
      `connections:\n  demo-mysql:\n    schemas: [dataforai]\n    enabled_tables: [dataforai.superstore_orders]\n`,
      SCHEMA_FILES
    );
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const ktx = await import("../ktx");
    vi.mocked(ktx.runIngest).mockResolvedValueOnce({
      exitCode: 1,
      stdout: "",
      stderr: "Unknown database 'openclaw_db'"
    });

    const app = await buildFreshServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/connections/demo-mysql/ingest")
      .send({ schema: "openclaw_db" })
      .expect(200);

    expect(res.body.ok).toBe(true);
    const run = res.body.data;
    expect(run.status).toBe("failed");
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain("Unknown database");
    expect(run.stdout).toBe("");
    expect(run.hint).toMatch(/物理库|schema/);
    expect(run.requestedScope).toBe("schema");

    await app.close();
  });

  it("redacts and bounds the persisted logs so secrets never leak and the file stays small", async () => {
    await makeProject(
      `connections:\n  demo-mysql:\n    schemas: [dataforai]\n    enabled_tables: [dataforai.superstore_orders]\n`,
      SCHEMA_FILES
    );
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const huge = "x".repeat(40_000);
    const ktx = await import("../ktx");
    vi.mocked(ktx.runIngest).mockResolvedValueOnce({
      exitCode: 0,
      stdout: `loaded password=secret123 ${huge}`,
      stderr: ""
    });

    const app = await buildFreshServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/connections/demo-mysql/ingest")
      .send({})
      .expect(200);

    expect(res.body.ok).toBe(true);
    const run = res.body.data;
    expect(run.stdout).not.toContain("secret123");
    expect(run.stdout).toContain("password=[REDACTED]");
    expect(run.stdout?.length).toBe(16 * 1024);

    await app.close();
  });
});

describe("GET /api/connections/ingest-runs", () => {
  it("returns the recorded run history and per-connection last run", async () => {
    await makeProject(
      `connections:\n  demo-mysql:\n    schemas: [dataforai]\n    enabled_tables: [dataforai.superstore_orders]\n`,
      SCHEMA_FILES
    );
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const app = await buildFreshServer();
    await app.ready();
    await request(app.server)
      .post("/api/connections/demo-mysql/ingest")
      .send({})
      .expect(200);
    await request(app.server)
      .post("/api/connections/demo-mysql/ingest")
      .send({ schema: "dataforai" })
      .expect(200);

    const res = await request(app.server).get("/api/connections/ingest-runs").expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.runs).toHaveLength(2);
    expect(res.body.data.lastByConnection["demo-mysql"]).toBeDefined();
    expect(res.body.data.lastByConnection["demo-mysql"].connectionId).toBe("demo-mysql");

    await app.close();
  });
});
