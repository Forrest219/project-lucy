import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { parse } from "yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * P1-64／REQ-030-085 Task 4 — Source Map compile failure must force
 * policyRuntimeAck/runtimeAck=false on both ktx.yaml write paths, without
 * changing HTTP/written compatibility or evaluateRuntimeAck (Access writes).
 */

const ktxMcpReload = vi.hoisted(() => ({
  reloadKtxMcpAfterConfigWrite: vi.fn(
    async (): Promise<{ status: "reloaded" | "started" | "skipped" | "failed"; detail: string }> => ({
      status: "reloaded",
      detail: "ok"
    })
  )
}));

const mcpRuntimeCanary = vi.hoisted(() => ({
  runMcpRuntimeCanary: vi.fn(async () => ({
    executionRuntimeAck: true,
    decisionReason: "ok",
    checks: [
      {
        name: "execution_query" as const,
        status: "pass" as "pass" | "fail" | "blocked",
        detail: "connection loaded"
      }
    ]
  }))
}));

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

vi.mock("../ktx-mcp-reload.js", () => ({
  reloadKtxMcpAfterConfigWrite: ktxMcpReload.reloadKtxMcpAfterConfigWrite,
  reloadKtxMcpExecutionRuntime: ktxMcpReload.reloadKtxMcpAfterConfigWrite
}));

vi.mock("../admin/mcp-runtime.js", async () => {
  const actual = await vi.importActual<typeof import("../admin/mcp-runtime.js")>("../admin/mcp-runtime.js");
  return {
    ...actual,
    runMcpRuntimeCanary: mcpRuntimeCanary.runMcpRuntimeCanary
  };
});

const ACCESS_YAML = `roles:
  analyst:
    description: Clean Role
    permission_model_version: 2
    allow:
      connections:
        - mysql-aliyun
      tableSelectors:
        - connection: mysql-aliyun
          schema: weather
          names:
            - city
          row_access: all
      tools:
        - lucy_query
users:
  - id: analyst_agent
    name: Analyst
    enabled: true
    role: analyst
    tokens: []
defaults:
  deny_tools: []
`;

const WEATHER_CITY = `tables:
  city:
    table: weather.city
    columns:
      - name: id
        type: number
`;

const ODS_CITY_CONFLICT = `tables:
  city:
    table: ods.city
    columns:
      - name: id
        type: number
`;

const ODS_CITY_UNIQUE = `tables:
  ods_city:
    table: ods.city
    columns:
      - name: id
        type: number
`;

let projectRoot: string;
let auditDbPath: string;
let previousRoot: string | undefined;
let previousContentRoot: string | undefined;
let previousAuditDb: string | undefined;

async function writeConflictManifests(connId = "mysql-aliyun") {
  const schemaDir = path.join(projectRoot, "semantic-layer", connId, "_schema");
  await mkdir(schemaDir, { recursive: true });
  await writeFile(path.join(schemaDir, "weather.yaml"), WEATHER_CITY, "utf8");
  await writeFile(path.join(schemaDir, "ods.yaml"), ODS_CITY_CONFLICT, "utf8");
}

async function resolveConflictManifests(connId = "mysql-aliyun") {
  await writeFile(
    path.join(projectRoot, "semantic-layer", connId, "_schema", "ods.yaml"),
    ODS_CITY_UNIQUE,
    "utf8"
  );
}

async function writeAccessYaml(content = ACCESS_YAML) {
  await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
  await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), content, "utf8");
}

async function makeEnabledTablesProject() {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-snc-ack-et-"));
  auditDbPath = path.join(projectRoot, ".ktx-ui", "audit.sqlite");
  await mkdir(path.dirname(auditDbPath), { recursive: true });
  await writeFile(
    path.join(projectRoot, "ktx.yaml"),
    `connections:
  mysql-aliyun:
    driver: mysql
    host: localhost
    port: 3306
    database: analytics
    username: lucy
    password: inline
    schemas:
      - weather
      - ods
    enabled_tables:
      - weather.city
`,
    "utf8"
  );
  await writeConflictManifests("mysql-aliyun");
  await writeAccessYaml();
}

async function makeCreateConnectionProject() {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-snc-ack-cc-"));
  auditDbPath = path.join(projectRoot, ".ktx-ui", "audit.sqlite");
  await mkdir(path.join(projectRoot, ".ktx", "secrets"), { recursive: true });
  await mkdir(path.dirname(auditDbPath), { recursive: true });
  await writeFile(
    path.join(projectRoot, "ktx.yaml"),
    `connections:
  mysql-aliyun:
    driver: mysql
    host: localhost
    port: 3306
    database: dataforai
    username: sc
    password: inline
    schemas:
      - dataforai
    enabled_tables: []

setup:
  database_connection_ids:
    - mysql-aliyun
`,
    "utf8"
  );
  // Conflict under the connection being created so commitEffectivePolicy sees it.
  await writeConflictManifests("demo-mysql");
  await writeAccessYaml(
    ACCESS_YAML.replaceAll("mysql-aliyun", "demo-mysql").replaceAll("weather", "weather")
  );
}

function envForProject() {
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_CONTENT_ROOT = ".";
  process.env.LUCY_AUDIT_DB = auditDbPath;
}

async function buildFreshServer() {
  const { buildServer } = await import("../index");
  return buildServer();
}

function expectSourceMapIssue(issues: unknown) {
  expect(Array.isArray(issues)).toBe(true);
  const reasons = (issues as Array<{ reason?: string }>).map((i) => i.reason ?? "");
  expect(reasons.some((r) => r.startsWith("source_map_compile_failed:"))).toBe(true);
  expect(
    reasons.some((r) => r.includes("duplicate_source_name") || r.includes("source_map_compile_failed:"))
  ).toBe(true);
}

beforeEach(() => {
  previousRoot = process.env.KTX_PROJECT_ROOT;
  previousContentRoot = process.env.LUCY_CONTENT_ROOT;
  previousAuditDb = process.env.LUCY_AUDIT_DB;
  vi.resetModules();
  vi.clearAllMocks();
  ktxMcpReload.reloadKtxMcpAfterConfigWrite.mockResolvedValue({ status: "reloaded", detail: "ok" });
  mcpRuntimeCanary.runMcpRuntimeCanary.mockResolvedValue({
    executionRuntimeAck: true,
    decisionReason: "ok",
    checks: [{ name: "execution_query", status: "pass" as const, detail: "connection loaded" }]
  });
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

describe("P1-64 enabled-tables Source Map ack (SC-06/07)", () => {
  it("keeps written/HTTP 200 but forces policy/runtime ack false with source_map_compile_failed issues", async () => {
    await makeEnabledTablesProject();
    envForProject();
    const app = await buildFreshServer();
    await app.ready();

    const response = await request(app.server)
      .put("/api/connections/mysql-aliyun/enabled-tables")
      .send({ dryRun: false, enabledTables: ["weather.city", "ods.city"] })
      .expect(200);

    expect(response.body.ok).toBe(true);
    expect(response.body.data.written).toBe(true);
    expect(response.body.data.policyRuntimeAck).toBe(false);
    expect(response.body.data.runtimeAck).toBe(false);
    expect(response.body.data.runtimeAck).toBe(response.body.data.policyRuntimeAck);
    expectSourceMapIssue(response.body.data.policyRuntimeIssues);
    expect(typeof response.body.data.catalogRuntimeAck).toBe("boolean");
    expect(typeof response.body.data.executionRuntimeAck).toBe("boolean");

    const yaml = await readFile(path.join(projectRoot, "ktx.yaml"), "utf8");
    expect(yaml).toContain("ods.city");
    await app.close();
  });

  it("restores both acks after conflict is removed; catalog/execution acks stay independent", async () => {
    await makeEnabledTablesProject();
    envForProject();
    const app = await buildFreshServer();
    await app.ready();

    const failed = await request(app.server)
      .put("/api/connections/mysql-aliyun/enabled-tables")
      .send({ dryRun: false, enabledTables: ["weather.city", "ods.city"] })
      .expect(200);
    expect(failed.body.data.runtimeAck).toBe(false);

    await resolveConflictManifests("mysql-aliyun");

    mcpRuntimeCanary.runMcpRuntimeCanary.mockResolvedValueOnce({
      executionRuntimeAck: false,
      decisionReason: "execution_runtime_unavailable",
      checks: [
        {
          name: "execution_query",
          status: "fail" as "pass" | "fail" | "blocked",
          detail: "no upstream"
        }
      ]
    });

    const recovered = await request(app.server)
      .put("/api/connections/mysql-aliyun/enabled-tables")
      .send({ dryRun: false, enabledTables: ["weather.city", "ods.city"] })
      .expect(200);

    expect(recovered.body.data.written).toBe(true);
    expect(recovered.body.data.policyRuntimeAck).toBe(true);
    expect(recovered.body.data.runtimeAck).toBe(true);
    expect(
      (recovered.body.data.policyRuntimeIssues as Array<{ reason?: string }> | undefined)?.some((i) =>
        (i.reason ?? "").startsWith("source_map_compile_failed:")
      ) ?? false
    ).toBe(false);
    // Independent of policy ack: canary false must not flip policy ack back to false.
    expect(recovered.body.data.executionRuntimeAck).toBe(false);
    expect(typeof recovered.body.data.catalogRuntimeAck).toBe("boolean");
    await app.close();
  });
});

describe("P1-64 connection-create Source Map ack (SC-06/07)", () => {
  it("keeps written/HTTP 200 but forces policy/runtime ack false with source_map_compile_failed issues", async () => {
    await makeCreateConnectionProject();
    envForProject();
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
        schemas: ["weather", "ods"],
        dryRun: false
      })
      .expect(200);

    expect(response.body.ok).toBe(true);
    expect(response.body.data.written).toBe(true);
    expect(response.body.data.policyRuntimeAck).toBe(false);
    expect(response.body.data.runtimeAck).toBe(false);
    expectSourceMapIssue(response.body.data.policyRuntimeIssues);
    expect(typeof response.body.data.catalogRuntimeAck).toBe("boolean");
    expect(typeof response.body.data.executionRuntimeAck).toBe("boolean");
    await app.close();
  });

  it("restores both acks after conflict is removed", async () => {
    await makeCreateConnectionProject();
    envForProject();

    // First create with conflict under demo-mysql manifests.
    {
      const app = await buildFreshServer();
      await app.ready();
      const failed = await request(app.server)
        .post("/api/connections")
        .send({
          id: "demo-mysql",
          driver: "mysql",
          host: "db.internal",
          port: 3306,
          database: "analytics",
          username: "lucy_ro",
          password: "plain-secret-value",
          schemas: ["weather", "ods"],
          dryRun: false
        })
        .expect(200);
      expect(failed.body.data.runtimeAck).toBe(false);
      await app.close();
    }

    // Remove conflict, then re-save enabled-tables on the created connection (same ktx write ack path).
    await resolveConflictManifests("demo-mysql");
    vi.resetModules();
    const app = await buildFreshServer();
    await app.ready();
    const recovered = await request(app.server)
      .put("/api/connections/demo-mysql/enabled-tables")
      .send({ dryRun: false, enabledTables: ["weather.city", "ods.city"] })
      .expect(200);
    expect(recovered.body.data.policyRuntimeAck).toBe(true);
    expect(recovered.body.data.runtimeAck).toBe(true);
    await app.close();
  });
});

describe("P1-64 Access write role_resolution_failed semantics unchanged (D10)", () => {
  it("evaluateRuntimeAck still acks Access writes with per-agent role_resolution_failed", async () => {
    projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-snc-ack-access-"));
    await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
    await mkdir(path.join(projectRoot, "semantic-layer", "warehouse", "_schema"), { recursive: true });
    await writeFile(
      path.join(projectRoot, "ktx.yaml"),
      `connections:
  warehouse:
    driver: mysql
    enabled_tables:
      - fin.fin_ledger
`,
      "utf8"
    );
    await writeFile(
      path.join(projectRoot, "semantic-layer", "warehouse", "_schema", "fin.yaml"),
      `tables:
  fin_ledger:
    table: fin.fin_ledger
`,
      "utf8"
    );
    const accessWithBadRole = `roles:
  ok_role:
    description: Compiles
    permission_model_version: 2
    allow:
      connections:
        - warehouse
      tableSelectors:
        - connection: warehouse
          schema: fin
          names:
            - fin_ledger
          row_access: all
      tools:
        - lucy_query
  bad_role:
    description: v2 prefix — compile failure
    permission_model_version: 2
    allow:
      connections:
        - warehouse
      tableSelectors:
        - connection: warehouse
          schema: fin
          prefix: fin_
          row_access: all
      tools:
        - lucy_query
users:
  - id: ok_agent
    name: OK
    enabled: true
    role: ok_role
    tokens: []
  - id: bad_agent
    name: Bad
    enabled: true
    role: bad_role
    tokens: []
defaults:
  deny_tools: []
`;
    await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), accessWithBadRole, "utf8");
    envForProject();

    const { writeAccessYaml } = await import("../admin/access-config");
    const acl = await import("../proxy/acl");
    const raw = await readFile(path.join(projectRoot, "webui", "config", "access.yaml"), "utf8");
    const config = parse(raw) as Parameters<typeof writeAccessYaml>[1];
    if (config.users[0]) config.users[0].name = "OK Renamed";

    const result = await writeAccessYaml(projectRoot, config, {
      enabled: false,
      changeType: "test_source_shortname_ack"
    });

    expect(result.written).toBe(true);
    expect(result.runtimeAck).toBe(true);
    expect(result.policyRuntimeAck).toBe(true);

    const status = acl.getPolicyRuntimeStatus();
    expect(status.degradedGlobal).toBe(false);
    expect(status.degradedAgents).toContain("bad_agent");
    expect(status.issues.some((i) => (i.reason ?? "").startsWith("role_resolution_failed"))).toBe(true);
    // prove evaluateRuntimeAck itself was not tightened to reject per-agent issues
    expect(acl.evaluateRuntimeAck(status, status.accessConfigDigest)).toBe(true);
  });
});
