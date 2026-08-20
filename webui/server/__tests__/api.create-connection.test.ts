import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../ktx", async () => {
  const actual = await vi.importActual<typeof import("../ktx")>("../ktx");
  return {
    ...actual,
    testConnection: vi.fn(async (_root: string, connId: string) => ({
      status: "ok" as const,
      latencyMs: 5,
      detail: "ok",
      command: `ktx connection test ${connId}`,
      args: ["connection", "test", connId],
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

setup:
  database_connection_ids:
    - mysql-aliyun
`;
}

async function makeProject(yaml = baseYaml()) {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-api-create-connection-"));
  await writeFile(path.join(projectRoot, "ktx.yaml"), yaml, "utf8");
  await mkdir(path.join(projectRoot, ".ktx", "secrets"), { recursive: true });
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

describe("POST /api/connections (Spec 124 Phase A)", () => {
  it("defaults to dryRun and never writes secret or yaml", async () => {
    await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const app = await buildFreshServer();
    await app.ready();

    const response = await request(app.server)
      .post("/api/connections")
      .send({
        id: "demo-mysql",
        driver: "mysql",
        host: "db.internal",
        port: 3306,
        database: "analytics",
        username: "lucy_ro",
        password: "plain-secret-should-not-persist"
      })
      .expect(200);

    expect(response.body.ok).toBe(true);
    expect(response.body.data.secretRelPath).toBe(".ktx/secrets/demo-mysql-password");
    expect(response.body.data.proposedYaml).toContain("demo-mysql:");
    expect(JSON.stringify(response.body)).not.toContain("plain-secret-should-not-persist");
    expect(JSON.stringify(response.body)).not.toContain("inline-password-value");

    await expect(
      access(path.join(projectRoot, ".ktx", "secrets", "demo-mysql-password"))
    ).rejects.toMatchObject({ code: "ENOENT" });
    const yaml = await readFile(path.join(projectRoot, "ktx.yaml"), "utf8");
    expect(yaml).not.toContain("demo-mysql:");
  });

  it("commits secret + yaml when dryRun=false and test succeeds", async () => {
    await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const app = await buildFreshServer();
    await app.ready();

    const response = await request(app.server)
      .post("/api/connections")
      .send({
        id: "demo-mysql",
        driver: "mysql",
        host: "db.internal",
        port: 3306,
        database: "analytics",
        username: "lucy_ro",
        password: "plain-secret-value",
        schemas: ["analytics"],
        dryRun: false
      })
      .expect(200);

    expect(response.body.ok).toBe(true);
    expect(response.body.data.written).toBe(true);
    expect(response.body.data.test.status).toBe("ok");
    expect(JSON.stringify(response.body)).not.toContain("plain-secret-value");

    await expect(
      readFile(path.join(projectRoot, ".ktx", "secrets", "demo-mysql-password"), "utf8")
    ).resolves.toBe("plain-secret-value");

    const yaml = await readFile(path.join(projectRoot, "ktx.yaml"), "utf8");
    expect(yaml).toContain("demo-mysql:");
    expect(yaml).not.toContain("plain-secret-value");
    expect(yaml).toMatch(/password:\s*file:/);
  });

  it("rolls back when connection test fails", async () => {
    await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const ktx = await import("../ktx");
    vi.mocked(ktx.testConnection).mockResolvedValueOnce({
      status: "error",
      latencyMs: 3,
      reason: "Access denied for user",
      command: "ktx connection test bad-mysql",
      args: ["connection", "test", "bad-mysql"],
      exitCode: 1,
      stdout: "",
      stderr: "Access denied for user"
    });

    const app = await buildFreshServer();
    await app.ready();
    const before = await readFile(path.join(projectRoot, "ktx.yaml"), "utf8");

    const response = await request(app.server)
      .post("/api/connections")
      .send({
        id: "bad-mysql",
        driver: "mysql",
        host: "db.internal",
        port: 3306,
        database: "analytics",
        username: "lucy_ro",
        password: "wrong-password",
        dryRun: false
      })
      .expect(400);

    expect(response.body.ok).toBe(false);
    expect(response.body.error.code).toBe("CONNECTION_TEST_FAILED");
    expect(JSON.stringify(response.body)).not.toContain("wrong-password");

    await expect(readFile(path.join(projectRoot, "ktx.yaml"), "utf8")).resolves.toBe(before);
    await expect(
      access(path.join(projectRoot, ".ktx", "secrets", "bad-mysql-password"))
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("returns 409 when connection id already exists", async () => {
    await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const app = await buildFreshServer();
    await app.ready();

    const response = await request(app.server)
      .post("/api/connections")
      .send({
        id: "mysql-aliyun",
        driver: "mysql",
        host: "db.internal",
        port: 3306,
        database: "analytics",
        username: "lucy_ro",
        password: "x",
        dryRun: false
      })
      .expect(409);

    expect(response.body.error.code).toBe("CONNECTION_ALREADY_EXISTS");
  });

  it("returns 400 CONNECTION_ID_INVALID for illegal ids", async () => {
    await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const app = await buildFreshServer();
    await app.ready();

    const response = await request(app.server)
      .post("/api/connections")
      .send({
        id: "BadId",
        driver: "mysql",
        host: "db.internal",
        port: 3306,
        database: "analytics",
        username: "lucy_ro"
      })
      .expect(400);

    expect(response.body.error.code).toBe("CONNECTION_ID_INVALID");
    expect(response.body.error.detail.pattern).toMatch(/a-z/);
  });
});
