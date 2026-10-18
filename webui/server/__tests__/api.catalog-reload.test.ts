import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendCatalogReload,
  readCatalogReloads,
  type CatalogReloadRun
} from "../catalog-reload";

// Ensure the WebUI route does NOT shell out to the ktx CLI. We mock the whole
// ktx module so any accidental call to runIngest would throw and surface in
// the test output.
vi.mock("../ktx", async () => {
  const actual = await vi.importActual<typeof import("../ktx")>("../ktx");
  const failIfCalled = () => {
    throw new Error("M14: WebUI must not call runIngest from /api/catalog/reload");
  };
  return {
    ...actual,
    runIngest: vi.fn(failIfCalled),
    testConnection: vi.fn(failIfCalled),
    validateSource: vi.fn(failIfCalled)
  };
});

let projectRoot: string;
let auditDbPath: string;
let previousRoot: string | undefined;
  let previousContentRoot: string | undefined;
let previousAuditDb: string | undefined;

async function makeProject(
  yaml: string,
  manifestFiles: Record<string, string> = {}
) {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-api-catalog-reload-"));
  await writeFile(path.join(projectRoot, "ktx.yaml"), yaml, "utf8");
  auditDbPath = path.join(projectRoot, ".ktx-ui", "audit.sqlite");
  await mkdir(path.dirname(auditDbPath), { recursive: true });
  const connId = "demo-mysql";
  const dir = path.join(projectRoot, "semantic-layer", connId, "_schema");
  await mkdir(dir, { recursive: true });
  for (const [name, content] of Object.entries(manifestFiles)) {
    await writeFile(path.join(dir, `${name}.yaml`), content, "utf8");
  }
}

beforeEach(async () => {
  vi.resetModules();
  previousRoot = process.env.KTX_PROJECT_ROOT;
  previousContentRoot = process.env.LUCY_CONTENT_ROOT;
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

const DATA_FORAI_MANIFEST = `tables:
  superstore_orders:
    table: dataforai.superstore_orders
  superstore_people:
    table: dataforai.superstore_people
`;

describe("POST /api/catalog/reload", () => {
  it("reads only local YAML, never shells out, and records structured counts + warnings", async () => {
    await makeProject(
      `connections:
  demo-mysql:
    schemas:
      - dataforai
      - openclaw_db
    enabled_tables:
      - dataforai.superstore_orders
      - dataforai.superstore_people
      - openclaw_db.missing_table
`,
      { dataforai: DATA_FORAI_MANIFEST }
    );
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const app = await buildFreshServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/catalog/reload")
      .send({ connectionId: "demo-mysql" })
      .expect(200);

    expect(res.body.ok).toBe(true);
    const run = res.body.data;
    expect(run.source).toBe("static-yaml");
    expect(run.status).toBe("success");
    expect(run.connections).toBe(1);
    expect(run.configuredSchemas).toBe(2);
    expect(run.manifestSchemas).toBe(1);
    expect(run.tables).toBe(2);
    expect(run.enabledTables).toBe(3);
    expect(run.id).toMatch(/^rel_\d{8}_/);
    expect(typeof run.durationMs).toBe("number");
    expect(run.finishedAt).toBeDefined();

    const warningCodes = run.warnings.map((w: { code: string }) => w.code);
    expect(warningCodes).toContain("SCHEMA_MANIFEST_MISSING");
    expect(warningCodes).toContain("ENABLED_TABLE_NOT_SCANNED");

    const missing = run.warnings.find(
      (w: { code: string; schema?: string }) => w.code === "SCHEMA_MANIFEST_MISSING"
    );
    expect(missing.schema).toBe("openclaw_db");
    expect(missing.message).toMatch(/openclaw_db/);

    const notScanned = run.warnings.find(
      (w: { code: string; table?: string }) => w.code === "ENABLED_TABLE_NOT_SCANNED"
    );
    expect(notScanned.table).toBe("openclaw_db.missing_table");

    // Sidecar should have been written.
    const sidecar = JSON.parse(
      await readFile(path.join(projectRoot, ".ktx-ui", "catalog-reloads.json"), "utf8")
    ) as { runs: Array<{ id: string }> };
    expect(sidecar.runs).toHaveLength(1);
    expect(sidecar.runs[0]?.id).toBe(run.id);

    await app.close();
  });

  it("returns MANIFEST_PARSE_FAILED warning when a manifest YAML is invalid", async () => {
    await makeProject(
      `connections:
  demo-mysql:
    schemas:
      - dataforai
    enabled_tables: []
`,
      { dataforai: ":\n: this is not valid yaml : [\n" }
    );
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const app = await buildFreshServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/catalog/reload")
      .send({})
      .expect(200);

    expect(res.body.ok).toBe(true);
    const run = res.body.data;
    expect(run.status).toBe("success"); // non-blocking; manifest failures become warnings
    const warningCodes = run.warnings.map((w: { code: string }) => w.code);
    expect(warningCodes).toContain("MANIFEST_PARSE_FAILED");
    const parseFailed = run.warnings.find(
      (w: { code: string; filePath?: string }) => w.code === "MANIFEST_PARSE_FAILED"
    );
    expect(parseFailed.filePath).toMatch(/dataforai\.yaml$/);

    await app.close();
  });

  it("returns SCHEMA_MANIFEST_EMPTY warning when a manifest has no tables", async () => {
    await makeProject(
      `connections:
  demo-mysql:
    schemas:
      - dataforai
    enabled_tables: []
`,
      { dataforai: "tables: {}\n" }
    );
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const app = await buildFreshServer();
    await app.ready();
    const res = await request(app.server).post("/api/catalog/reload").send({}).expect(200);

    expect(res.body.ok).toBe(true);
    const run = res.body.data;
    const warningCodes = run.warnings.map((w: { code: string }) => w.code);
    expect(warningCodes).toContain("SCHEMA_MANIFEST_EMPTY");
    expect(run.tables).toBe(0);

    await app.close();
  });

  it("never invokes runIngest regardless of which body is sent", async () => {
    await makeProject(
      `connections:
  demo-mysql:
    schemas:
      - dataforai
    enabled_tables: []
`,
      { dataforai: DATA_FORAI_MANIFEST }
    );
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const app = await buildFreshServer();
    await app.ready();
    const ktx = await import("../ktx");
    await request(app.server).post("/api/catalog/reload").send({ connectionId: "demo-mysql" }).expect(200);
    await request(app.server)
      .post("/api/catalog/reload")
      .send({ connectionId: "demo-mysql", schema: "dataforai" })
      .expect(200);
    expect(vi.mocked(ktx.runIngest)).not.toHaveBeenCalled();

    await app.close();
  });

  it("returns 404 when the requested connection is not configured", async () => {
    await makeProject(
      `connections:
  demo-mysql:
    schemas:
      - dataforai
    enabled_tables: []
`,
      { dataforai: DATA_FORAI_MANIFEST }
    );
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const app = await buildFreshServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/catalog/reload")
      .send({ connectionId: "missing-conn" })
      .expect(404);

    expect(res.body.ok).toBe(false);
    expect(res.body.error.code).toBe("CONNECTION_NOT_FOUND");

    await app.close();
  });

  it("scopes counts and warnings to the requested schema", async () => {
    await makeProject(
      `connections:
  demo-mysql:
    schemas:
      - dataforai
      - openclaw_db
    enabled_tables:
      - dataforai.superstore_orders
      - dataforai.superstore_people
      - openclaw_db.orders
`,
      {
        dataforai: DATA_FORAI_MANIFEST,
        openclaw_db: `tables:
  orders:
    table: openclaw_db.orders
`
      }
    );
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const app = await buildFreshServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/catalog/reload")
      .send({ connectionId: "demo-mysql", schema: "openclaw_db" })
      .expect(200);

    expect(res.body.ok).toBe(true);
    const run = res.body.data;
    expect(run.requestedSchema).toBe("openclaw_db");
    expect(run.configuredSchemas).toBe(1);
    expect(run.manifestSchemas).toBe(1);
    expect(run.tables).toBe(1);
    expect(run.enabledTables).toBe(1);
    expect(run.warnings).toEqual([]);

    await app.close();
  });
});

describe("GET /api/catalog/reloads", () => {
  it("returns bounded run history and lastByConnection", async () => {
    await makeProject(
      `connections:
  demo-mysql:
    schemas:
      - dataforai
    enabled_tables: []
`,
      { dataforai: DATA_FORAI_MANIFEST }
    );
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const app = await buildFreshServer();
    await app.ready();
    await request(app.server).post("/api/catalog/reload").send({}).expect(200);
    await request(app.server).post("/api/catalog/reload").send({}).expect(200);

    const res = await request(app.server).get("/api/catalog/reloads").expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.runs).toHaveLength(2);
    expect(res.body.data.last).not.toBeNull();
    expect(res.body.data.last.source).toBe("static-yaml");
    expect(res.body.data.lastByConnection["demo-mysql"]).toBeDefined();
    expect(res.body.data.lastByConnection["demo-mysql"].id).toBe(res.body.data.last.id);

    await app.close();
  });

  it("keeps lastByConnection['invest-db'] intact across 20 reloads of another connection", async () => {
    // Custom two-connection project — `makeProject` only wires up one.
    projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-api-catalog-reload-"));
    const yaml = `connections:
  invest-db:
    schemas:
      - dataforai
    enabled_tables: []
  other-conn:
    schemas:
      - dataforai
    enabled_tables: []
`;
    await writeFile(path.join(projectRoot, "ktx.yaml"), yaml, "utf8");
    auditDbPath = path.join(projectRoot, ".ktx-ui", "audit.sqlite");
    await mkdir(path.dirname(auditDbPath), { recursive: true });
    for (const connId of ["invest-db", "other-conn"]) {
      const dir = path.join(projectRoot, "semantic-layer", connId, "_schema");
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, "dataforai.yaml"), DATA_FORAI_MANIFEST, "utf8");
    }
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const app = await buildFreshServer();
    await app.ready();

    const investRes = await request(app.server)
      .post("/api/catalog/reload")
      .send({ connectionId: "invest-db" })
      .expect(200);
    const investRunId = investRes.body.data.id;

    // 20 reloads of a different connection — enough to evict the invest-db run from `runs`.
    for (let i = 0; i < 20; i += 1) {
      await request(app.server)
        .post("/api/catalog/reload")
        .send({ connectionId: "other-conn" })
        .expect(200);
    }

    const res = await request(app.server).get("/api/catalog/reloads").expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.runs).toHaveLength(20);
    const coveredConnIds = res.body.data.runs.flatMap(
      (run: { connectionIds: string[]; requestedConnectionId?: string }) =>
        run.requestedConnectionId ? [run.requestedConnectionId] : run.connectionIds
    );
    expect(coveredConnIds).not.toContain("invest-db");
    expect(res.body.data.runs.some((run: { id: string }) => run.id === investRunId)).toBe(false);

    expect(res.body.data.lastByConnection["invest-db"]).toBeDefined();
    expect(res.body.data.lastByConnection["invest-db"].id).toBe(investRunId);
    expect(res.body.data.lastByConnection["invest-db"].status).toBe("success");
    expect(res.body.data.lastByConnection["other-conn"]).toBeDefined();

    await app.close();
  });

  it("a later failed run for the same connection replaces the previous success in lastByConnection", async () => {
    await makeProject(
      `connections:
  demo-mysql:
    schemas:
      - dataforai
    enabled_tables: []
`,
      { dataforai: DATA_FORAI_MANIFEST }
    );
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const app = await buildFreshServer();
    await app.ready();
    await request(app.server)
      .post("/api/catalog/reload")
      .send({ connectionId: "demo-mysql" })
      .expect(200);

    const before = await readCatalogReloads(projectRoot);
    expect(before.lastByConnection["demo-mysql"]?.status).toBe("success");

    // Production reloadCatalog always writes `success`; fabricate a newer `failed`
    // run directly via appendCatalogReload to exercise the overlay path.
    const startedAt = new Date(Date.now() + 60_000).toISOString();
    const failedRun: CatalogReloadRun = {
      id: "rel_failed_demo_mysql",
      status: "failed",
      startedAt,
      finishedAt: new Date(Date.now() + 60_500).toISOString(),
      durationMs: 500,
      requestedConnectionId: "demo-mysql",
      connections: 1,
      connectionIds: ["demo-mysql"],
      configuredSchemas: 0,
      manifestSchemas: 0,
      tables: 0,
      enabledTables: 0,
      warnings: [],
      source: "static-yaml"
    };
    const after = await appendCatalogReload(projectRoot, failedRun);
    expect(after.lastByConnection["demo-mysql"]?.id).toBe(failedRun.id);
    expect(after.lastByConnection["demo-mysql"]?.status).toBe("failed");

    // The HTTP GET should also surface the failed run, and runs must contain it.
    const res = await request(app.server).get("/api/catalog/reloads").expect(200);
    expect(res.body.data.lastByConnection["demo-mysql"]?.status).toBe("failed");
    expect(res.body.data.runs.some((run: { id: string }) => run.id === failedRun.id)).toBe(true);

    await app.close();
  });

  it("reconstructs lastByConnection from a legacy sidecar that only has `runs`", async () => {
    projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-api-catalog-reload-"));
    await mkdir(path.join(projectRoot, ".ktx-ui"), { recursive: true });
    const legacyRun = {
      id: "rel_legacy_demo_mysql",
      status: "success",
      startedAt: "2026-10-01T00:00:00.000Z",
      finishedAt: "2026-10-01T00:00:01.000Z",
      durationMs: 1000,
      requestedConnectionId: "demo-mysql",
      connections: 1,
      connectionIds: ["demo-mysql"],
      configuredSchemas: 1,
      manifestSchemas: 1,
      tables: 2,
      enabledTables: 0,
      warnings: [],
      source: "static-yaml"
    };
    // Intentionally omit `lastByConnection` — exercises the legacy-fallback path.
    await writeFile(
      path.join(projectRoot, ".ktx-ui", "catalog-reloads.json"),
      `${JSON.stringify({ version: 1, runs: [legacyRun] }, null, 2)}\n`
    );

    const result = await readCatalogReloads(projectRoot);
    expect(result.runs).toHaveLength(1);
    expect(result.lastByConnection["demo-mysql"]).toBeDefined();
    expect(result.lastByConnection["demo-mysql"].id).toBe("rel_legacy_demo_mysql");
    expect(result.lastByConnection["demo-mysql"].status).toBe("success");
  });
});
