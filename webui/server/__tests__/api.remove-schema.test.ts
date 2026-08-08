import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../ktx", async () => {
  const actual = await vi.importActual<typeof import("../ktx")>("../ktx");
  return {
    ...actual,
    testConnection: vi.fn(async () => ({
      status: "ok" as const,
      latencyMs: 5,
      detail: "ok",
      command: "ktx connection test mysql-aliyun",
      args: ["connection", "test", "mysql-aliyun"],
      exitCode: 0,
      stdout: "ok",
      stderr: ""
    })),
    runIngest: vi.fn(async () => ({ exitCode: 0, stdout: "ok", stderr: "" })),
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

async function makeProject(yaml: string) {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-api-remove-schema-"));
  await writeFile(path.join(projectRoot, "ktx.yaml"), yaml, "utf8");
  auditDbPath = path.join(projectRoot, ".ktx-ui", "audit.sqlite");
  await mkdir(path.dirname(auditDbPath), { recursive: true });
}

beforeEach(async () => {
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

function baseYaml(): string {
  return `connections:
  mysql-aliyun:
    driver: mysql
    host: localhost
    port: 3306
    database: dataforai
    username: sc
    password: inline-password-value
    credentials:
      client_secret: nested-credential-value
    schemas:
      - dataforai
      - finance_mart
    enabled_tables:
      - dataforai.superstore_orders
      - finance_mart.sales
`;
}

async function buildFreshServer() {
  const { buildServer } = await import("../index");
  return buildServer();
}

describe("POST /api/connections/:connId/schemas/remove", () => {
  it("defaults dryRun:true and never modifies ktx.yaml", async () => {
    await makeProject(baseYaml());
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const app = await buildFreshServer();
    await app.ready();
    const beforeStat = await stat(path.join(projectRoot, "ktx.yaml"));

    await new Promise((resolve) => setTimeout(resolve, 50));

    const response = await request(app.server)
      .post("/api/connections/mysql-aliyun/schemas/remove")
      .send({ schema: "finance_mart" })
      .expect(200);

    expect(response.body.ok).toBe(true);
    expect(response.body.data.diff).toContain("finance_mart");
    expect(response.body.data.oldSchemas).toContain("finance_mart");
    expect(response.body.data.newSchemas).not.toContain("finance_mart");
    expect(response.body.data.removedEnabledTables).toEqual(["finance_mart.sales"]);

    // Credentials must be redacted.
    const bodyStr = JSON.stringify(response.body);
    expect(bodyStr).not.toContain("inline-password-value");
    expect(bodyStr).not.toContain("nested-credential-value");

    // Disk unchanged.
    const afterStat = await stat(path.join(projectRoot, "ktx.yaml"));
    expect(afterStat.mtimeMs).toBe(beforeStat.mtimeMs);

    await app.close();
  });

  it("dryRun:false removes schema and enabled_tables from ktx.yaml", async () => {
    await makeProject(baseYaml());
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const app = await buildFreshServer();
    await app.ready();

    const response = await request(app.server)
      .post("/api/connections/mysql-aliyun/schemas/remove")
      .send({ schema: "finance_mart", dryRun: false })
      .expect(200);

    expect(response.body.data.written).toBe(true);
    expect(response.body.data.auditId).toBeTruthy();
    expect(response.body.data.oldSchemas).toContain("finance_mart");
    expect(response.body.data.newSchemas).not.toContain("finance_mart");
    expect(response.body.data.removedEnabledTables).toEqual(["finance_mart.sales"]);
    expect(response.body.data.deletedFiles).toEqual([]);

    const persisted = await readFile(path.join(projectRoot, "ktx.yaml"), "utf8");
    expect(persisted).not.toContain("- finance_mart");
    expect(persisted).not.toContain("finance_mart.sales");
    // Other items intact.
    expect(persisted).toContain("dataforai");
    expect(persisted).toContain("dataforai.superstore_orders");

    await app.close();
  });

  it("returns SCHEMA_NOT_FOUND (404) when schema is absent", async () => {
    await makeProject(baseYaml());
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const app = await buildFreshServer();
    await app.ready();
    const response = await request(app.server)
      .post("/api/connections/mysql-aliyun/schemas/remove")
      .send({ schema: "no_such_schema", dryRun: true })
      .expect(404);

    expect(response.body).toMatchObject({
      ok: false,
      error: { code: "SCHEMA_NOT_FOUND" }
    });
    await app.close();
  });

  it("returns SCHEMA_NAME_INVALID (400) for names that violate the pattern", async () => {
    await makeProject(baseYaml());
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const app = await buildFreshServer();
    await app.ready();

    for (const bad of ["1abc", "-dash", "with space"]) {
      const response = await request(app.server)
        .post("/api/connections/mysql-aliyun/schemas/remove")
        .send({ schema: bad, dryRun: true })
        .expect(400);
      expect(response.body.error.code).toBe("SCHEMA_NAME_INVALID");
    }

    await app.close();
  });

  it("returns CONNECTION_NOT_FOUND (404) when connId is unknown", async () => {
    await makeProject(baseYaml());
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const app = await buildFreshServer();
    await app.ready();
    const response = await request(app.server)
      .post("/api/connections/does-not-exist/schemas/remove")
      .send({ schema: "dataforai", dryRun: true })
      .expect(404);

    expect(response.body.error.code).toBe("CONNECTION_NOT_FOUND");
    await app.close();
  });

  it("writes a schema_remove audit row with target_id '<connId>:<schema>'", async () => {
    await makeProject(baseYaml());
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const app = await buildFreshServer();
    await app.ready();

    const writeResponse = await request(app.server)
      .post("/api/connections/mysql-aliyun/schemas/remove")
      .send({ schema: "finance_mart", dryRun: false })
      .expect(200);

    expect(writeResponse.body.data.auditId).toBeTruthy();
    const auditId = writeResponse.body.data.auditId as number;

    const db = new Database(auditDbPath);
    const row = db
      .prepare(
        "SELECT change_type, target_id, file_path, diff FROM config_change_log WHERE id = ?"
      )
      .get(auditId) as { change_type: string; target_id: string; file_path: string; diff: string } | undefined;

    expect(row).toBeDefined();
    expect(row?.change_type).toBe("schema_remove");
    expect(row?.target_id).toBe("mysql-aliyun:finance_mart");
    expect(row?.file_path).toBe("ktx.yaml");
    expect(row?.diff).not.toContain("inline-password-value");
    db.close();

    await app.close();
  });

  it("deletes manifest when deleteManifest:true and dryRun:false", async () => {
    await makeProject(baseYaml());
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const manifestDir = path.join(projectRoot, "semantic-layer", "mysql-aliyun", "_schema");
    await mkdir(manifestDir, { recursive: true });
    await writeFile(path.join(manifestDir, "finance_mart.yaml"), "tables:\n  sales: {}\n", "utf8");

    const app = await buildFreshServer();
    await app.ready();

    const response = await request(app.server)
      .post("/api/connections/mysql-aliyun/schemas/remove")
      .send({ schema: "finance_mart", dryRun: false, deleteManifest: true })
      .expect(200);

    expect(response.body.data.deletedFiles).toContain("semantic-layer/mysql-aliyun/_schema/finance_mart.yaml");
    await expect(readFile(path.join(manifestDir, "finance_mart.yaml"), "utf8")).rejects.toThrow();

    await app.close();
  });

  it("does not run connection test (no ktx CLI invocation)", async () => {
    await makeProject(baseYaml());
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const app = await buildFreshServer();
    await app.ready();

    const ktx = await import("../ktx");
    await request(app.server)
      .post("/api/connections/mysql-aliyun/schemas/remove")
      .send({ schema: "finance_mart", dryRun: false })
      .expect(200);

    expect(vi.mocked(ktx.testConnection)).not.toHaveBeenCalled();

    await app.close();
  });
});
