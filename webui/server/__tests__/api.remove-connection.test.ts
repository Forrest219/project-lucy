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
  let previousContentRoot: string | undefined;
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

describe("POST /api/connections/:connId/remove", () => {
  it("defaults dryRun:true and never modifies ktx.yaml", async () => {
    await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
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
    process.env.LUCY_CONTENT_ROOT = ".";
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
    process.env.LUCY_CONTENT_ROOT = ".";
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
    process.env.LUCY_CONTENT_ROOT = ".";
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
    process.env.LUCY_CONTENT_ROOT = ".";
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

  it("preview reports blocked+blockers when a role selector references the connection", async () => {
    await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    process.env.LUCY_AUDIT_DB = auditDbPath;

    // Spec 179 §4: role selector pointing at the connection should surface
    // even though the semantic-layer directory is intentionally empty.
    await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
    await writeFile(
      path.join(projectRoot, "webui", "config", "access.yaml"),
      `roles:
  finance_readonly:
    allow:
      tableSelectors:
        - connection: mysql-aliyun
          schema: dataforai
          names: [superstore_orders]
users:
  - id: demo_agent
    name: Demo Agent
    enabled: true
    tokens: []
    role: finance_readonly
`,
      "utf8"
    );

    const app = await buildFreshServer();
    await app.ready();

    const response = await request(app.server)
      .post("/api/connections/mysql-aliyun/remove")
      .send({ dryRun: true })
      .expect(200);

    expect(response.body.ok).toBe(true);
    expect(response.body.data.blocked).toBe(true);
    expect(response.body.data.impact.blocked).toBe(true);
    expect(response.body.data.impact.blockers).toEqual([
      { kind: "role_selector", id: "finance_readonly" },
      { kind: "identity", id: "demo_agent" }
    ]);

    const yaml = await readFile(path.join(projectRoot, "ktx.yaml"), "utf8");
    expect(yaml).toContain("mysql-aliyun:");

    await app.close();
  });

  it("returns 409 connection_references_remain and never writes ktx.yaml", async () => {
    await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    process.env.LUCY_AUDIT_DB = auditDbPath;

    await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
    await writeFile(
      path.join(projectRoot, "webui", "config", "access.yaml"),
      `roles:
  finance_readonly:
    allow:
      connections:
        - mysql-aliyun
`,
      "utf8"
    );

    const app = await buildFreshServer();
    await app.ready();

    const originalYaml = await readFile(path.join(projectRoot, "ktx.yaml"), "utf8");
    const response = await request(app.server)
      .post("/api/connections/mysql-aliyun/remove")
      // Send every plausible confirmation-shaped field — none should bypass.
      .send({ dryRun: false, confirm: true, force: true, acknowledged: true, deleteAssets: true })
      .expect(409);

    expect(response.body.ok).toBe(false);
    expect(response.body.error.code).toBe("connection_references_remain");
    expect(response.body.error.detail).toBeDefined();
    expect(response.body.error.detail.blockers).toEqual([
      { kind: "role_connection", id: "finance_readonly" }
    ]);

    // Spec 179 §1 / §3: a rejected confirmation writes nothing — no ktx.yaml
    // mutation, no secret/semantic-asset delete, and no audit row.
    expect(await readFile(path.join(projectRoot, "ktx.yaml"), "utf8")).toBe(originalYaml);

    // Either no audit file (because nothing was written) or a file with zero
    // matching rows — both prove the blocked path skipped the committed audit.
    let auditRowCount = 0;
    try {
      const db = new Database(auditDbPath, { readonly: true });
      const row = db
        .prepare(
          "SELECT COUNT(*) AS c FROM config_change_log WHERE change_type = 'connection_delete' AND target_id = 'mysql-aliyun' AND write_status = 'committed'"
        )
        .get() as { c: number };
      db.close();
      auditRowCount = row.c;
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !String(error.message).includes("unable to open database file")
      ) {
        throw error;
      }
    }
    expect(auditRowCount).toBe(0);

    await app.close();
  });

  it("deleteAssets:true alone does not override role references", async () => {
    await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    process.env.LUCY_AUDIT_DB = auditDbPath;

    await mkdir(path.join(projectRoot, "semantic-layer", "mysql-aliyun", "_schema"), { recursive: true });
    await writeFile(
      path.join(projectRoot, "semantic-layer", "mysql-aliyun", "_schema", "dataforai.yaml"),
      "tables: {}\n",
      "utf8"
    );
    await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
    await writeFile(
      path.join(projectRoot, "webui", "config", "access.yaml"),
      `roles:
  finance_readonly:
    allow:
      connections:
        - mysql-aliyun
`,
      "utf8"
    );

    const app = await buildFreshServer();
    await app.ready();

    const response = await request(app.server)
      .post("/api/connections/mysql-aliyun/remove")
      .send({ dryRun: false, deleteAssets: true })
      .expect(409);

    expect(response.body.error.code).toBe("connection_references_remain");
    // semantic_asset remains visible even though deleteAssets:true unblocks it.
    expect(response.body.error.detail.blockers).toEqual(
      expect.arrayContaining([
        { kind: "role_connection", id: "finance_readonly" },
        {
          kind: "semantic_asset",
          id: "semantic-layer/mysql-aliyun/_schema/dataforai.yaml"
        }
      ])
    );

    const manifest = path.join(projectRoot, "semantic-layer", "mysql-aliyun", "_schema", "dataforai.yaml");
    // Spec 179 §3: blocking path must not touch assets either.
    await expect(readFile(manifest, "utf8")).resolves.toBe("tables: {}\n");

    await app.close();
  });

  it("deleteAssets:true allows the delete when no role / identity / wiki references remain", async () => {
    const yaml = `connections:
  mysql-aliyun:
    driver: mysql
    host: localhost
    port: 3306
    database: dataforai
    username: sc
    password: inline-secret
    schemas: []
    enabled_tables: []
setup:
  database_connection_ids:
    - mysql-aliyun
`;
    await makeProject(yaml);
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    process.env.LUCY_AUDIT_DB = auditDbPath;

    await mkdir(path.join(projectRoot, "semantic-layer", "mysql-aliyun", "_schema"), { recursive: true });
    const manifest = path.join(projectRoot, "semantic-layer", "mysql-aliyun", "_schema", "dataforai.yaml");
    await writeFile(manifest, "tables: {}\n", "utf8");

    const app = await buildFreshServer();
    await app.ready();

    // Spec 179 §4 — happy path: semantic_asset is the only blocker and
    // deleteAssets clears it; the call goes through and updates ktx.yaml.
    const response = await request(app.server)
      .post("/api/connections/mysql-aliyun/remove")
      .send({ dryRun: false, deleteAssets: true })
      .expect(200);

    expect(response.body.ok).toBe(true);
    expect(response.body.data.written).toBe(true);
    expect(response.body.data.deletedFiles).toContain(
      "semantic-layer/mysql-aliyun/_schema/dataforai.yaml"
    );

    const storedYaml = await readFile(path.join(projectRoot, "ktx.yaml"), "utf8");
    expect(storedYaml).not.toContain("mysql-aliyun:");
    await expect(readFile(manifest, "utf8")).rejects.toMatchObject({ code: "ENOENT" });

    await app.close();
  });
});
