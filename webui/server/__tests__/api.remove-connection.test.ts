import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

function baseYaml(): string {
  return `connections:
  mysql-aliyun:
    driver: mysql
    host: localhost
    port: 3306
    database: dataforai
    username: sc
    password: inline-password-value
    schemas:
      - dataforai
    enabled_tables:
      - dataforai.superstore_orders
  keep-me:
    driver: mysql
    host: localhost
    port: 3306
    database: other
    username: sc
    password: inline-other
    schemas: []
    enabled_tables: []
setup:
  database_connection_ids:
    - mysql-aliyun
    - keep-me
`;
}

async function makeProject(yaml = baseYaml()) {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-api-remove-connection-"));
  await writeFile(path.join(projectRoot, "ktx.yaml"), yaml, "utf8");
  auditDbPath = path.join(projectRoot, ".ktx-ui", "audit.sqlite");
  await mkdir(path.dirname(auditDbPath), { recursive: true });
}

async function buildFreshServer() {
  const { buildServer } = await import("../index");
  return buildServer();
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

describe("POST /api/connections/:connId/remove", () => {
  it("defaults dryRun:true and never modifies ktx.yaml", async () => {
    await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const app = await buildFreshServer();
    await app.ready();

    const response = await request(app.server)
      .post("/api/connections/mysql-aliyun/remove")
      .send({})
      .expect(200);

    expect(response.body.ok).toBe(true);
    expect(response.body.data.connectionId).toBe("mysql-aliyun");
    expect(response.body.data.schemas).toEqual(["dataforai"]);
    expect(response.body.data.enabledTables).toEqual(["dataforai.superstore_orders"]);
    expect(response.body.data.proposedYaml).not.toContain("mysql-aliyun:");
    expect(JSON.stringify(response.body)).not.toContain("inline-password-value");

    const yaml = await readFile(path.join(projectRoot, "ktx.yaml"), "utf8");
    expect(yaml).toContain("mysql-aliyun:");

    await app.close();
  });

  it("dryRun:false removes the connection from ktx.yaml", async () => {
    await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const app = await buildFreshServer();
    await app.ready();

    const response = await request(app.server)
      .post("/api/connections/mysql-aliyun/remove")
      .send({ dryRun: false })
      .expect(200);

    expect(response.body.ok).toBe(true);
    expect(response.body.data.written).toBe(true);
    expect(response.body.data.connectionId).toBe("mysql-aliyun");

    const yaml = await readFile(path.join(projectRoot, "ktx.yaml"), "utf8");
    expect(yaml).not.toContain("mysql-aliyun:");
    expect(yaml).toContain("keep-me:");

    await app.close();
  });

  it("returns 404 CONNECTION_NOT_FOUND for unknown ids", async () => {
    await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const app = await buildFreshServer();
    await app.ready();

    const response = await request(app.server)
      .post("/api/connections/does-not-exist/remove")
      .send({ dryRun: true })
      .expect(404);

    expect(response.body.ok).toBe(false);
    expect(response.body.error.code).toBe("CONNECTION_NOT_FOUND");

    await app.close();
  });

  it("returns 400 CONNECTION_DELETE_SECRET_NOT_ELIGIBLE for inline passwords", async () => {
    await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const app = await buildFreshServer();
    await app.ready();

    const response = await request(app.server)
      .post("/api/connections/mysql-aliyun/remove")
      .send({ dryRun: false, deleteSecret: true })
      .expect(400);

    expect(response.body.error.code).toBe("CONNECTION_DELETE_SECRET_NOT_ELIGIBLE");
    const yaml = await readFile(path.join(projectRoot, "ktx.yaml"), "utf8");
    expect(yaml).toContain("mysql-aliyun:");

    await app.close();
  });

  it("writes a connection_delete audit row", async () => {
    await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const app = await buildFreshServer();
    await app.ready();

    await request(app.server)
      .post("/api/connections/mysql-aliyun/remove")
      .send({ dryRun: false })
      .expect(200);

    const db = new Database(auditDbPath, { readonly: true });
    const row = db
      .prepare("SELECT change_type, target_id FROM config_change_log ORDER BY id DESC LIMIT 1")
      .get() as { change_type: string; target_id: string } | undefined;
    db.close();
    expect(row?.change_type).toBe("connection_delete");
    expect(row?.target_id).toBe("mysql-aliyun");

    await app.close();
  });
});
