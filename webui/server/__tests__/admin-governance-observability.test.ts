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

function hoursAgoIso(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

async function seedProject() {
  await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
  await mkdir(path.join(projectRoot, ".ktx-ui", "eval"), { recursive: true });
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
  await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), ACCESS_YAML, "utf8");
}

async function insertAuditFixture(options?: { withSources?: boolean; extraTablesOnly?: boolean }) {
  const withSources = options?.withSources !== false;
  const db = await getAuditDb();
  const insert = db.prepare(`
    INSERT INTO access_log
      (ts, user_id, token_label, token_hash_prefix, tool, tables, args_summary,
       query_preview, outcome, error_detail, duration_ms, request_id, trace_id,
       role_ids, permission_snapshot_hash, decision_reason)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const deniedTs = hoursAgoIso(3);
  const okTs = hoursAgoIso(2);
  const deniedTables = options?.extraTablesOnly
    ? []
    : ["mysql.dataforai.kx_fact_financial_amount"];
  const okTables = options?.extraTablesOnly
    ? ["mysql.dataforai.fallback_only_table"]
    : [];
  insert.run(
    deniedTs,
    "agent-a",
    "active-token",
    "sha256:abc123def456",
    "lucy_query",
    JSON.stringify(deniedTables),
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
    okTs,
    "agent-a",
    "active-token",
    "sha256:abc123def456",
    "lucy_catalog",
    JSON.stringify(okTables),
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

  if (withSources) {
    db.prepare(`
      INSERT INTO access_log_sources
        (access_log_id, ts, user_id, tool, connection_id, schema_name, source_name,
         physical_table, extraction_method, confidence, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      1,
      deniedTs,
      "agent-a",
      "lucy_query",
      "mysql",
      "dataforai",
      "kx_fact_financial_amount",
      "mysql.dataforai.kx_fact_financial_amount",
      "acl",
      "high",
      deniedTs
    );
  }

  db.prepare(`
    INSERT INTO config_change_log
      (ts, actor, file_path, change_type, target_id, request_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(hoursAgoIso(1), "local-admin", "webui/config/access.yaml", "update", "finance_readonly", "req-config");
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
  it("returns usageOverview aggregates without raw SQL or args", async () => {
    const app = buildServer();
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/api/admin/governance/overview?hours=168" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);

    expect(body.data.usageOverview).toMatchObject({
      agentCount: 2,
      activeAgentCount: 1,
      agentActiveRate: 50,
      configuredTokenCount: 2,
      activeTokenCount: 1,
      tokenActiveRate: 50,
      configuredTableCount: 1,
      activeTableCount: 1,
      hasOpenEndedTableScope: true,
      calls: 2,
      p95LatencyMs: 120,
      avgLatencyMs: 70
    });
    expect(body.data.tableStatsSource).toBe("access_log_sources");
    expect(body.data.popularTables).toEqual([
      expect.objectContaining({
        table: "mysql.dataforai.kx_fact_financial_amount",
        calls: 1
      })
    ]);
    // Compat cards remain available but are not the primary usage contract.
    // p95 over [20, 120] => index ceil(2*0.95)-1 = 1 => 120 (not avg 70).
    expect(body.data.cards).toMatchObject({
      calls: 2,
      denied: 1,
      deniedRate: 50,
      activeTokenCount: 1,
      p95LatencyMs: 120,
      avgLatencyMs: 70,
      brokenRoleCount: 1,
      overBroadRoleCount: 1,
      configChangeCount: 1
    });
    expect(body.data.cards.p95LatencyMs).not.toBe(body.data.cards.avgLatencyMs);
    expect(JSON.stringify(body)).not.toContain("select * from salary");
    expect(JSON.stringify(body)).not.toContain("secret raw args");
    expect(JSON.stringify(body)).not.toMatch(/sha256:[a-f0-9]{64}/i);

    await app.close();
  });

  it("falls back to access_log.tables when access_log_sources has no rows", async () => {
    resetAuditDbForTests();
    await rm(process.env.LUCY_AUDIT_DB!, { force: true });
    await insertAuditFixture({ withSources: false, extraTablesOnly: true });

    const app = buildServer();
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/api/admin/governance/overview?hours=168" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data.tableStatsSource).toBe("access_log.tables");
    expect(body.data.popularTables).toEqual([
      expect.objectContaining({
        table: "mysql.dataforai.fallback_only_table",
        calls: 1
      })
    ]);
    expect(body.data.popularTables.some((row: { table: string }) => row.table.includes("kx_fact_financial_amount"))).toBe(false);
    // Union still counts the fallback-only table even though it never appears in access_log_sources.
    expect(body.data.usageOverview.activeTableCount).toBe(1);

    await app.close();
  });

  it("counts legacy allow.tables when tableSelectors is an empty array", async () => {
    await writeFile(
      path.join(projectRoot, "webui", "config", "access.yaml"),
      `roles:
  hybrid_legacy:
    description: Empty selectors with legacy tables
    allow:
      tableSelectors: []
      tables: ["dataforai.legacy_orders", "*"]
      tools: [lucy_query]
users:
  - id: agent-a
    name: Agent A
    role: hybrid_legacy
    tokens: []
`,
      "utf8"
    );

    const app = buildServer();
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/admin/governance/overview?hours=168" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data.usageOverview.configuredTableCount).toBe(1);
    expect(body.data.usageOverview.hasOpenEndedTableScope).toBe(true);
    await app.close();
  });

  it("scopes active agent/token/table counts and popular tables to the requested window", async () => {
    resetAuditDbForTests();
    await rm(process.env.LUCY_AUDIT_DB!, { force: true });
    await seedProject();
    const db = await getAuditDb();
    // A distinct agent/table pair whose only activity is 30h ago: inside the
    // 7-day window but outside the 24-hour window.
    db.prepare(`
      INSERT INTO access_log
        (ts, user_id, token_label, token_hash_prefix, tool, tables, args_summary,
         query_preview, outcome, error_detail, duration_ms, request_id, trace_id,
         role_ids, permission_snapshot_hash, decision_reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      hoursAgoIso(30),
      "agent-b",
      "stale-token",
      "sha256:deadbeef9999",
      "lucy_query",
      JSON.stringify(["mysql.dataforai.older_window_table"]),
      null,
      null,
      "ok",
      null,
      15,
      "req-old-window",
      "trace-old-window",
      JSON.stringify(["wildcard_role"]),
      "sha256:snapshot",
      null
    );
    await insertAuditFixture();

    const app = buildServer();
    await app.ready();

    const res24 = await app.inject({ method: "GET", url: "/api/admin/governance/overview?hours=24" });
    const res168 = await app.inject({ method: "GET", url: "/api/admin/governance/overview?hours=168" });
    const body24 = JSON.parse(res24.payload);
    const body168 = JSON.parse(res168.payload);

    // Configured counts must not move with the window.
    expect(body24.data.usageOverview.agentCount).toBe(body168.data.usageOverview.agentCount);
    expect(body24.data.usageOverview.configuredTokenCount).toBe(body168.data.usageOverview.configuredTokenCount);
    expect(body24.data.usageOverview.configuredTableCount).toBe(body168.data.usageOverview.configuredTableCount);

    // Active/usage counts must follow the requested window.
    expect(body24.data.usageOverview.activeAgentCount).toBe(1);
    expect(body168.data.usageOverview.activeAgentCount).toBe(2);
    expect(body24.data.usageOverview.activeTokenCount).toBe(1);
    expect(body168.data.usageOverview.activeTokenCount).toBe(2);
    expect(body24.data.usageOverview.activeTableCount).toBe(1);
    expect(body168.data.usageOverview.activeTableCount).toBe(2);

    await app.close();
  });

  it("surfaces agent usage stats with window-scoped active tokens", async () => {
    const app = buildServer();
    await app.ready();

    const agents = await app.inject({ method: "GET", url: "/api/admin/governance/agents?hours=24" });
    expect(agents.statusCode).toBe(200);
    const agentBody = JSON.parse(agents.payload);
    expect(agentBody.data.agents[0]).toMatchObject({
      id: "agent-a",
      calls: 2,
      avgLatencyMs: 70,
      p95LatencyMs: 120,
      activeTokenCount: 1,
      configuredTokenCount: 1,
      topDeniedReason: "table_forbidden"
    });
    expect(agentBody.data.agents[0].lastSeen).toBeTruthy();
    expect(agentBody.data.agents.map((row: { id: string }) => row.id)).toEqual(["agent-a", "agent-b"]);

    const roles = await app.inject({ method: "GET", url: "/api/admin/governance/roles?hours=168" });
    expect(roles.statusCode).toBe(200);
    const rolesBody = JSON.parse(roles.payload);
    expect(rolesBody.data.compatTruncation).toEqual({ auditRowsLimit: 5000 });
    expect(rolesBody.data.roles).toContainEqual(expect.objectContaining({ id: "broken_role", status: "broken" }));
    expect(rolesBody.data.roles).toContainEqual(expect.objectContaining({ id: "wildcard_role", status: "over_broad" }));

    const tokens = await app.inject({ method: "GET", url: "/api/admin/governance/tokens?hours=168" });
    expect(tokens.statusCode).toBe(200);
    const tokensBody = JSON.parse(tokens.payload);
    expect(tokensBody.data.tokens).toContainEqual(expect.objectContaining({
      agentId: "agent-a",
      tokenHashPrefix: "sha256:abc123def456",
      activeInWindow: true,
      // Deprecated twin must mirror activeInWindow for one release.
      activeInLast7d: true,
      configured: true,
      stale: false,
      calls: expect.any(Number)
    }));
    expect(tokensBody.data.tokens.find((row: { agentId: string }) => row.agentId === "agent-a").calls).toBeGreaterThan(0);
    expect(tokensBody.data.tokens).toContainEqual(expect.objectContaining({
      agentId: "agent-b",
      activeInWindow: false,
      activeInLast7d: false,
      configured: true,
      stale: true,
      calls: 0
    }));
    const tokenCallOrder = tokensBody.data.tokens.map((row: { calls: number }) => row.calls);
    expect(tokenCallOrder).toEqual([...tokenCallOrder].sort((a, b) => b - a));
    expect(JSON.stringify(tokensBody)).not.toMatch(/sha256:[a-f0-9]{64}/i);

    const denials = await app.inject({ method: "GET", url: "/api/admin/governance/denials?hours=168" });
    expect(denials.statusCode).toBe(200);
    const denialsBody = JSON.parse(denials.payload);
    expect(denialsBody.data.reasonCounts).toContainEqual({ reason: "table_forbidden", count: 1 });
    expect(denialsBody.data.topSources).toContainEqual(expect.objectContaining({
      source: "mysql.dataforai.kx_fact_financial_amount",
      count: 1
    }));

    await app.close();
  });

  it("matches token activity for bare-hex historical prefixes", async () => {
    resetAuditDbForTests();
    await rm(process.env.LUCY_AUDIT_DB!, { force: true });
    await seedProject();
    const db = await getAuditDb();
    db.prepare(`
      INSERT INTO access_log
        (ts, user_id, token_label, token_hash_prefix, tool, tables, args_summary,
         query_preview, outcome, error_detail, duration_ms, request_id, trace_id,
         role_ids, permission_snapshot_hash, decision_reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      hoursAgoIso(1),
      "agent-a",
      "active-token",
      "abc123def456",
      "lucy_query",
      JSON.stringify([]),
      null,
      null,
      "ok",
      null,
      30,
      "req-bare-prefix",
      "trace-bare-prefix",
      JSON.stringify(["finance_readonly"]),
      "sha256:snapshot",
      null
    );

    const app = buildServer();
    await app.ready();
    const tokens = await app.inject({ method: "GET", url: "/api/admin/governance/tokens?hours=168" });
    expect(tokens.statusCode).toBe(200);
    const tokensBody = JSON.parse(tokens.payload);
    expect(tokensBody.data.tokens).toContainEqual(expect.objectContaining({
      agentId: "agent-a",
      tokenHashPrefix: "sha256:abc123def456",
      activeInWindow: true,
      lastUsed: expect.any(String)
    }));
    await app.close();
  });
});
