import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectionSecretRelPath } from "../project";
import { safeWriteNewSecretPassword } from "../fs-safe";

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

const ktxMcpReload = vi.hoisted(() => ({
  reloadKtxMcpAfterConfigWrite: vi.fn(async () => ({ status: "reloaded" as const, detail: "ok" }))
}));

vi.mock("../ktx-mcp-reload.js", () => ({
  reloadKtxMcpAfterConfigWrite: ktxMcpReload.reloadKtxMcpAfterConfigWrite,
  reloadKtxMcpExecutionRuntime: ktxMcpReload.reloadKtxMcpAfterConfigWrite
}));

let projectRoot: string;
let auditDbPath: string;
let previousRoot: string | undefined;
let previousContentRoot: string | undefined;
let previousAuditDb: string | undefined;

async function makeProject(withSecond = false) {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-api-endpoint-edit-"));
  await mkdir(path.join(projectRoot, ".ktx", "secrets"), { recursive: true });
  auditDbPath = path.join(projectRoot, ".ktx-ui", "audit.sqlite");
  await mkdir(path.dirname(auditDbPath), { recursive: true });

  const secretRel = connectionSecretRelPath("mysql-aliyun");
  const absSecret = path.join(projectRoot, secretRel);
  await safeWriteNewSecretPassword(projectRoot, secretRel, "old-secret");

  const second = withSecond
    ? `
  other-mysql:
    driver: mysql
    host: db-other.internal
    port: 3306
    database: analytics
    username: lucy_ro
    password: file:/tmp/other-password
    schemas:
      - analytics
`
    : "";

  await writeFile(
    path.join(projectRoot, "ktx.yaml"),
    `connections:
  mysql-aliyun:
    driver: mysql
    host: db-prod.internal
    port: 3306
    database: dataforai
    username: sc
    password: file:${absSecret}
    schemas:
      - dataforai
    enabled_tables:
      - dataforai.superstore_orders
${second}
setup:
  database_connection_ids:
    - mysql-aliyun
`,
    "utf8"
  );
}

async function buildFreshServer() {
  const { buildServer } = await import("../index");
  return buildServer();
}

beforeEach(async () => {
  vi.resetModules();
  previousRoot = process.env.KTX_PROJECT_ROOT;
  previousContentRoot = process.env.LUCY_CONTENT_ROOT;
  previousAuditDb = process.env.LUCY_AUDIT_DB;
  vi.clearAllMocks();
});

afterEach(async () => {
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  if (previousContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = previousContentRoot;
  if (previousAuditDb === undefined) delete process.env.LUCY_AUDIT_DB;
  else process.env.LUCY_AUDIT_DB = previousAuditDb;
  if (projectRoot) await rm(projectRoot, { recursive: true, force: true });
});

describe("POST /api/connections/:connId/endpoint (lucy-20261101)", () => {
  it("SC-15 returns 404 for unknown connection", async () => {
    await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const app = await buildFreshServer();
    await app.ready();
    const response = await request(app.server)
      .post("/api/connections/missing/endpoint")
      .send({ host: "x", port: 3306, username: "u", dryRun: true })
      .expect(404);
    expect(response.body.ok).toBe(false);
    expect(response.body.error.code).toBe("CONNECTION_NOT_FOUND");
    await app.close();
  });

  it("SC-19 returns 400 for empty host and out-of-range port", async () => {
    await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const app = await buildFreshServer();
    await app.ready();

    const emptyHost = await request(app.server)
      .post("/api/connections/mysql-aliyun/endpoint")
      .send({ host: "  ", port: 3306, username: "sc", dryRun: true })
      .expect(400);
    expect(emptyHost.body.error.code).toBe("BAD_REQUEST");

    const badPort = await request(app.server)
      .post("/api/connections/mysql-aliyun/endpoint")
      .send({ host: "db-test.internal", port: 70000, username: "sc", dryRun: true })
      .expect(400);
    expect(badPort.body.error.code).toBe("CONNECTION_ENDPOINT_INVALID_FIELD");
    expect(badPort.body.error.detail).toMatchObject({ field: "port" });

    await app.close();
  });

  it("SC-20 exposes ENDPOINT_EDIT_CONFLICT detail.matches to the client", async () => {
    await makeProject(true);
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const app = await buildFreshServer();
    await app.ready();
    const response = await request(app.server)
      .post("/api/connections/mysql-aliyun/endpoint")
      .send({
        host: "db-other.internal",
        port: 3306,
        username: "sc",
        dryRun: true
      })
      .expect(409);
    expect(response.body.error.code).toBe("ENDPOINT_EDIT_CONFLICT");
    expect(Array.isArray(response.body.error.detail?.matches)).toBe(true);
    expect(response.body.error.detail.matches.some((m: { id: string }) => m.id === "other-mysql")).toBe(
      true
    );
    await app.close();
  });

  it("SC-21 success write + reloaded leaves executionRuntimePending false", async () => {
    await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    process.env.LUCY_AUDIT_DB = auditDbPath;
    ktxMcpReload.reloadKtxMcpAfterConfigWrite.mockResolvedValueOnce({
      status: "reloaded" as const,
      detail: "ok"
    });

    const app = await buildFreshServer();
    await app.ready();
    const response = await request(app.server)
      .post("/api/connections/mysql-aliyun/endpoint")
      .send({
        host: "db-test.internal",
        port: 3306,
        username: "sc",
        dryRun: false
      })
      .expect(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.data.written).toBe(true);
    expect(ktxMcpReload.reloadKtxMcpAfterConfigWrite).toHaveBeenCalledWith(projectRoot, "mysql-aliyun");
    expect(response.body.data.executionRuntimePending).toBe(false);
    const yaml = await readFile(path.join(projectRoot, "ktx.yaml"), "utf8");
    expect(yaml).toContain("host: db-test.internal");
    await app.close();
  });

  it("SC-21 failed reload marks executionRuntimePending true", async () => {
    await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    process.env.LUCY_AUDIT_DB = auditDbPath;
    ktxMcpReload.reloadKtxMcpAfterConfigWrite.mockResolvedValueOnce({
      status: "failed" as const,
      detail: "daemon did not restart"
    });

    const app = await buildFreshServer();
    await app.ready();
    const response = await request(app.server)
      .post("/api/connections/mysql-aliyun/endpoint")
      .send({
        host: "db-test.internal",
        port: 3306,
        username: "sc",
        dryRun: false
      })
      .expect(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.data.written).toBe(true);
    expect(response.body.data.executionRuntimePending).toBe(true);
    await app.close();
  });
});
