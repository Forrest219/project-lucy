import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../index";
import { getAuditDb, resetAuditDbForTests } from "../admin/audit";
import { resetEvalDb } from "../eval/db";

let projectRoot: string;
let previousRoot: string | undefined;
let previousAuditDb: string | undefined;
let previousEvalDb: string | undefined;

const ACCESS_YAML = `roles:
  finance_readonly:
    description: Finance scoped role
    allow:
      connections: [mysql]
      tableSelectors:
        - connection: mysql
          schema: dataforai
          names: [kx_fact_financial_amount]
      tools: [lucy_query]
  broken_role:
    description: Missing tool scope
    allow:
      tableSelectors: []
      tools: []
  wildcard_role:
    description: Legacy wildcard
    allow:
      tables: ["*"]
      tools: ["*"]
users:
  - id: agent-a
    name: Agent A
    enabled: true
    role: finance_readonly
    tokens:
      - hash: sha256:abc123def4560000000000000000000000000000000000000000000000000000
        label: active-token
  - id: agent-b
    name: Agent B
    role: wildcard_role
    tokens:
      - hash: sha256:deadbeef99990000000000000000000000000000000000000000000000000000
        label: stale-token
defaults:
  sensitive_table_prefixes:
    - dataforai.kx_
`;

async function seedProject() {
  await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
  await mkdir(path.join(projectRoot, ".ktx-ui", "eval"), { recursive: true });
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
  await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), ACCESS_YAML, "utf8");
}

async function insertAuditFixture() {
  const db = await getAuditDb();
  const insert = db.prepare(`
    INSERT INTO access_log
      (ts, user_id, token_label, token_hash_prefix, tool, tables, args_summary,
       query_preview, outcome, error_detail, duration_ms, request_id, trace_id,
       role_ids, permission_snapshot_hash, decision_reason)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insert.run(
    "2026-08-03T01:00:00.000Z",
    "agent-a",
    "active-token",
    "abc123def456",
    "lucy_query",
    JSON.stringify(["mysql.dataforai.kx_fact_financial_amount"]),
    "secret raw args should not leave backend",
    "select * from salary",
    "denied",
    "table_forbidden",
    120,
    "req-denied",
    "trace-denied",
    JSON.stringify(["finance_readonly"]),
    "sha256:snapshot",
    "table_forbidden"
  );
  insert.run(
    "2026-08-03T02:00:00.000Z",
    "agent-a",
    "active-token",
    "abc123def456",
    "lucy_catalog",
    JSON.stringify([]),
    null,
    null,
    "ok",
    null,
    20,
    "req-ok",
    "trace-ok",
    JSON.stringify(["finance_readonly"]),
    "sha256:snapshot",
    null
  );
  db.prepare(`
    INSERT INTO access_log_sources
      (access_log_id, ts, user_id, tool, connection_id, schema_name, source_name,
       physical_table, extraction_method, confidence, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    1,
    "2026-08-03T01:00:00.000Z",
    "agent-a",
    "lucy_query",
    "mysql",
    "dataforai",
    "kx_fact_financial_amount",
    "mysql.dataforai.kx_fact_financial_amount",
    "acl",
    "high",
    "2026-08-03T01:00:00.000Z"
  );
  db.prepare(`
    INSERT INTO config_change_log
      (ts, actor, file_path, change_type, target_id, request_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run("2026-08-03T03:00:00.000Z", "local-admin", "webui/config/access.yaml", "update", "finance_readonly", "req-config");
}

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-governance-"));
  previousRoot = process.env.KTX_PROJECT_ROOT;
  previousAuditDb = process.env.LUCY_AUDIT_DB;
  previousEvalDb = process.env.LUCY_EVAL_DB;
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_AUDIT_DB = path.join(projectRoot, ".ktx-ui", "audit.sqlite");
  process.env.LUCY_EVAL_DB = path.join(projectRoot, ".ktx-ui", "eval", "runs.sqlite");
  resetAuditDbForTests();
  resetEvalDb();
  await seedProject();
  await insertAuditFixture();
});

afterEach(async () => {
  resetAuditDbForTests();
  resetEvalDb();
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  if (previousAuditDb === undefined) delete process.env.LUCY_AUDIT_DB;
  else process.env.LUCY_AUDIT_DB = previousAuditDb;
  if (previousEvalDb === undefined) delete process.env.LUCY_EVAL_DB;
  else process.env.LUCY_EVAL_DB = previousEvalDb;
  await rm(projectRoot, { recursive: true, force: true });
});

describe("admin governance observability", () => {
  it("returns redacted overview aggregates without raw SQL or args", async () => {
    const app = buildServer();
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/api/admin/governance/overview?hours=720" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);

    expect(body.data.cards).toMatchObject({
      calls: 2,
      denied: 1,
      deniedRate: 50,
      activeTokenCount: 1,
      brokenRoleCount: 1,
      overBroadRoleCount: 1,
      configChangeCount: 1
    });
    expect(JSON.stringify(body)).not.toContain("select * from salary");
    expect(JSON.stringify(body)).not.toContain("secret raw args");

    await app.close();
  });

  it("surfaces agent, role, token, and denial boundaries", async () => {
    const app = buildServer();
    await app.ready();

    const agents = await app.inject({ method: "GET", url: "/api/admin/governance/agents?hours=720" });
    expect(agents.statusCode).toBe(200);
    expect(JSON.parse(agents.payload).data.agents[0]).toMatchObject({
      id: "agent-a",
      calls: 2,
      denied: 1,
      deniedRate: 50,
      activeTokenCount: 1,
      configuredTokenCount: 1,
      topDeniedReason: "table_forbidden"
    });

    const roles = await app.inject({ method: "GET", url: "/api/admin/governance/roles?hours=720" });
    expect(roles.statusCode).toBe(200);
    const rolesBody = JSON.parse(roles.payload);
    expect(rolesBody.data.roles).toContainEqual(expect.objectContaining({ id: "broken_role", status: "broken" }));
    expect(rolesBody.data.roles).toContainEqual(expect.objectContaining({ id: "wildcard_role", status: "over_broad" }));

    const tokens = await app.inject({ method: "GET", url: "/api/admin/governance/tokens?hours=720" });
    expect(tokens.statusCode).toBe(200);
    const tokensBody = JSON.parse(tokens.payload);
    expect(tokensBody.data.tokens).toContainEqual(expect.objectContaining({
      agentId: "agent-a",
      tokenHashPrefix: "abc123def456",
      stale: false
    }));
    expect(tokensBody.data.tokens).toContainEqual(expect.objectContaining({
      agentId: "agent-b",
      stale: true
    }));

    const denials = await app.inject({ method: "GET", url: "/api/admin/governance/denials?hours=720" });
    expect(denials.statusCode).toBe(200);
    const denialsBody = JSON.parse(denials.payload);
    expect(denialsBody.data.reasonCounts).toContainEqual({ reason: "table_forbidden", count: 1 });
    expect(denialsBody.data.topSources).toContainEqual(expect.objectContaining({
      source: "mysql.dataforai.kx_fact_financial_amount",
      count: 1
    }));

    await app.close();
  });
});
