import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the ktx CLI wrapper so the test does not shell out.
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
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-api-add-schema-"));
  await writeFile(path.join(projectRoot, "ktx.yaml"), yaml, "utf8");
  auditDbPath = path.join(projectRoot, ".ktx-ui", "audit.sqlite");
  await mkdir(path.dirname(auditDbPath), { recursive: true });
}

beforeEach(async () => {
  // Audit module caches the SQLite handle at module scope. Resetting modules
  // between tests forces a fresh handle so each test gets its own audit DB
  // (driven by the env vars we set in the test body).
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
    enabled_tables:
      - dataforai.superstore_orders
`;
}

async function buildFreshServer() {
  const { buildServer } = await import("../index");
  return buildServer();
}

describe("POST /api/connections/:connId/schemas", () => {
  it("keeps dryRun as default and never modifies ktx.yaml", async () => {
    await makeProject(baseYaml());
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const app = await buildFreshServer();
    await app.ready();
    const beforeStat = await stat(path.join(projectRoot, "ktx.yaml"));

    // Wait a few ms so any accidental write would have a measurably newer mtime.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const response = await request(app.server)
      .post("/api/connections/mysql-aliyun/schemas")
      .send({ schema: "finance_mart" })
      .expect(200);

    expect(response.body.ok).toBe(true);
    expect(response.body.data.diff).toMatch(/finance_mart/);
    expect(response.body.data.proposedYaml).toContain("- finance_mart");
    expect(response.body.data.oldSchemas).toEqual(["dataforai"]);
    expect(response.body.data.newSchemas).toEqual(["dataforai", "finance_mart"]);
    const previewBody = JSON.stringify(response.body);
    expect(previewBody).not.toContain("inline-password-value");
    expect(previewBody).not.toContain("nested-credential-value");
    expect(response.body.data.proposedYaml).not.toMatch(/^\s*(password|credentials):/m);
    expect(response.body.data.diff).not.toMatch(/^\s*[ +\-]?\s*(password|credentials):/m);

    // Disk unchanged
    const afterStat = await stat(path.join(projectRoot, "ktx.yaml"));
    expect(afterStat.mtimeMs).toBe(beforeStat.mtimeMs);
    const persisted = await readFile(path.join(projectRoot, "ktx.yaml"), "utf8");
    expect(persisted).not.toContain("finance_mart");

    await app.close();
  });

  it("writes exactly one new line when dryRun:false", async () => {
    await makeProject(baseYaml());
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const app = await buildFreshServer();
    await app.ready();

    const before = await readFile(path.join(projectRoot, "ktx.yaml"), "utf8");
    const beforeLines = before.split("\n").length;

    const response = await request(app.server)
      .post("/api/connections/mysql-aliyun/schemas")
      .send({ schema: "finance_mart", dryRun: false })
      .expect(200);

    expect(response.body.data.written).toBe(true);
    expect(response.body.data.auditId).toBeTruthy();
    expect(response.body.data.oldSchemas).toEqual(["dataforai"]);
    expect(response.body.data.newSchemas).toEqual(["dataforai", "finance_mart"]);

    const after = await readFile(path.join(projectRoot, "ktx.yaml"), "utf8");
    const afterLines = after.split("\n").length;
    expect(afterLines - beforeLines).toBe(1);
    expect(after).toContain("- finance_mart");

    await app.close();
  });

  it("never leaks the password field via /api/project or /api/connections", async () => {
    await makeProject(baseYaml());
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const app = await buildFreshServer();
    await app.ready();

    await request(app.server)
      .post("/api/connections/mysql-aliyun/schemas")
      .send({ schema: "finance_mart", dryRun: false })
      .expect(200);

    const projectResponse = await request(app.server).get("/api/project").expect(200);
    const connectionsResponse = await request(app.server).get("/api/connections").expect(200);

    const serialized = JSON.stringify({ ...projectResponse.body, ...connectionsResponse.body });
    expect(serialized).not.toContain("inline-password-value");
    expect(serialized).not.toContain("nested-credential-value");
    expect(serialized).not.toMatch(/password\s*[:=]\s*["']?inline-/);

    await app.close();
  });

  it("returns SCHEMA_ALREADY_EXISTS (409) when the schema is already declared", async () => {
    await makeProject(baseYaml());
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const app = await buildFreshServer();
    await app.ready();
    const response = await request(app.server)
      .post("/api/connections/mysql-aliyun/schemas")
      .send({ schema: "dataforai", dryRun: true })
      .expect(409);

    expect(response.body).toMatchObject({
      ok: false,
      error: { code: "SCHEMA_ALREADY_EXISTS" }
    });
    await app.close();
  });

  it("returns SCHEMA_NAME_INVALID (400) for names that violate the pattern", async () => {
    await makeProject(baseYaml());
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const app = await buildFreshServer();
    await app.ready();

    for (const bad of ["1abc", "-dash", "with space", "a".repeat(64)]) {
      const response = await request(app.server)
        .post("/api/connections/mysql-aliyun/schemas")
        .send({ schema: bad, dryRun: true })
        .expect(400);
      expect(response.body.error.code).toBe("SCHEMA_NAME_INVALID");
      expect(response.body.error.detail).toEqual({
        pattern: "^[a-zA-Z_][a-zA-Z0-9_]{0,62}$"
      });
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
      .post("/api/connections/does-not-exist/schemas")
      .send({ schema: "demo", dryRun: true })
      .expect(404);

    expect(response.body.error.code).toBe("CONNECTION_NOT_FOUND");
    await app.close();
  });

  it("returns whitelisted connection-test stdout/stderr detail without writing", async () => {
    await makeProject(baseYaml());
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_AUDIT_DB = auditDbPath;
    const ktx = await import("../ktx");
    vi.mocked(ktx.testConnection).mockResolvedValueOnce({
      status: "error",
      reason: "authentication failed",
      command: "ktx connection test mysql-aliyun",
      args: ["connection", "test", "mysql-aliyun"],
      exitCode: 1,
      stdout: "connection output",
      stderr: "authentication failed"
    });

    const app = await buildFreshServer();
    await app.ready();
    const response = await request(app.server)
      .post("/api/connections/mysql-aliyun/schemas")
      .send({ schema: "finance_mart", dryRun: false })
      .expect(400);

    expect(response.body).toMatchObject({
      ok: false,
      error: {
        code: "CONNECTION_TEST_FAILED",
        detail: {
          stdout: "connection output",
          stderr: "authentication failed",
          reason: "authentication failed"
        }
      }
    });
    const persisted = await readFile(path.join(projectRoot, "ktx.yaml"), "utf8");
    expect(persisted).not.toContain("finance_mart");
    await app.close();
  });

  it("writes a schema_add audit row with target_id '<connId>:<schema>'", async () => {
    await makeProject(baseYaml());
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const app = await buildFreshServer();
    await app.ready();

    const writeResponse = await request(app.server)
      .post("/api/connections/mysql-aliyun/schemas")
      .send({ schema: "finance_mart", dryRun: false })
      .expect(200);

    expect(writeResponse.body.data.auditId).toBeTruthy();
    const auditId = writeResponse.body.data.auditId as number;

    // Inspect the SQLite audit log directly (auditId is the row's primary key).
    // The audit module keeps the writable connection cached in WAL mode, so we
    // open a non-readonly handle here to be compatible with that.
    const db = new Database(auditDbPath);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as Array<{ name: string }>;
    expect(tables.map((t) => t.name)).toContain("config_change_log");
    const row = db
      .prepare(
        "SELECT change_type, target_id, old_summary, new_summary, file_path, diff FROM config_change_log WHERE id = ?"
      )
      .get(auditId) as
      | {
          change_type: string;
          target_id: string;
          old_summary: string;
          new_summary: string;
          file_path: string;
          diff: string;
        }
      | undefined;

    expect(row).toBeDefined();
    expect(row?.change_type).toBe("schema_add");
    expect(row?.target_id).toBe("mysql-aliyun:finance_mart");
    expect(row?.file_path).toBe("ktx.yaml");
    expect(JSON.parse(row!.old_summary)).toEqual(["dataforai"]);
    expect(JSON.parse(row!.new_summary)).toEqual(["dataforai", "finance_mart"]);
    expect(row?.diff).not.toContain("inline-password-value");
    expect(row?.diff).not.toContain("nested-credential-value");
    db.close();

    await app.close();
  });
});
