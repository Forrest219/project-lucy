/**
 * Spec 189 / WO-202610-28 T4 — the Governance / usage-overview path on the
 * **real** audit database.
 *
 * The overview, the per-Agent ranking, the Token ranking, the denial
 * breakdown and the Role usage counts must all describe the **same** record
 * set: the Default Usage Calls. A protocol-only Agent must not be "active",
 * an eval probe must not appear in any usage number, and a Role's usage
 * count must not be silently truncated at 5000 rows.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../index";
import { getAuditDb, resetAuditDbForTests } from "../admin/audit.js";
import {
  FIXTURE_NOW_ISO,
  FIXTURE_ROLE_ID,
  buildFixtureAccessYaml,
  buildFixtureAgents,
  buildFixtureRows,
  type UsageFixtureRow
} from "./usage-mixed-fixture.js";

let projectRoot: string;
let prevRoot: string | undefined;
let prevAuditDb: string | undefined;
let prevContentRoot: string | undefined;
let rows: UsageFixtureRow[];

async function makeProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lucy-usage-governance-"));
  await mkdir(path.join(root, "webui", "config"), { recursive: true });
  await mkdir(path.join(root, ".ktx-ui", "eval"), { recursive: true });
  await mkdir(path.join(root, "semantic-layer", "mysql-aliyun", "_schema"), { recursive: true });
  await writeFile(
    path.join(root, "ktx.yaml"),
    `connections:
  mysql-aliyun:
    driver: mysql
    enabled_tables:
      - dataforai.superstore_orders
`,
    "utf8"
  );
  await writeFile(
    path.join(root, "webui", "config", "access.yaml"),
    buildFixtureAccessYaml(buildFixtureAgents()),
    "utf8"
  );
  await writeFile(
    path.join(root, "semantic-layer", "mysql-aliyun", "_schema", "dataforai.yaml"),
    "tables:\n  superstore_orders:\n    table: dataforai.superstore_orders\n",
    "utf8"
  );
  return root;
}

async function seed(): Promise<void> {
  const db = await getAuditDb();
  const insert = db.prepare(
    `INSERT INTO access_log
       (ts, user_id, token_hash_prefix, token_label, tool, outcome, duration_ms,
        eval_mark, args_summary, role_ids, user_agent, tables, request_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const r of rows) {
    insert.run(
      r.ts,
      r.user_id,
      r.token_hash_prefix,
      r.token_label,
      r.tool,
      r.outcome,
      r.duration_ms,
      r.eval_mark,
      r.args_summary,
      r.role_ids,
      r.user_agent,
      r.tables,
      r.request_id
    );
  }
}

async function get(pathname: string) {
  const app = buildServer();
  await app.ready();
  try {
    const res = await request(app.server).get(pathname).expect(200);
    return res.body.data as any;
  } finally {
    await app.close();
  }
}

beforeAll(() => {
  rows = buildFixtureRows();
});

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(FIXTURE_NOW_ISO));
  projectRoot = await makeProject();
  prevRoot = process.env.KTX_PROJECT_ROOT;
  prevAuditDb = process.env.LUCY_AUDIT_DB;
  prevContentRoot = process.env.LUCY_CONTENT_ROOT;
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_CONTENT_ROOT = projectRoot;
  process.env.LUCY_AUDIT_DB = path.join(projectRoot, ".ktx-ui", "audit.sqlite");
  await seed();
});

afterEach(async () => {
  resetAuditDbForTests();
  if (prevRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = prevRoot;
  if (prevAuditDb === undefined) delete process.env.LUCY_AUDIT_DB;
  else process.env.LUCY_AUDIT_DB = prevAuditDb;
  if (prevContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = prevContentRoot;
  await rm(projectRoot, { recursive: true, force: true });
  vi.useRealTimers();
});

describe("Spec 189 — /api/admin/governance/overview", () => {
  it("counts only Default Usage Calls (SC-01 / SC-04)", async () => {
    const data = await get("/api/admin/governance/overview?hours=168");
    const usage = data.usageOverview;
    // 3 (business) + 1 (name-only) + 1 + 1 + 1 (content reads) + 1 (mixed)
    // + 51 (high traffic) + 1 (unconfigured identity) + 13 (decommissioned
    // identities) = 73
    expect(usage.calls).toBe(73);
    expect(usage.denied).toBe(1);
    // `errors` is exposed on the compatibility cards payload.
    expect(data.cards.errors).toBe(1);
    // Protocol-only Agents and the probe-only Agent are not active.
    expect(usage.activeAgentCount).toBe(21);
    expect(usage.activeTokenCount).toBe(21);
  });

  it("keeps the population boundary: the rate is partial when the numerator exceeds the configured denominator (SC-16)", async () => {
    const data = await get("/api/admin/governance/overview?hours=168");
    const usage = data.usageOverview;
    // 21 active identities vs. 20 configured assets. The numerator includes
    // historical log identities; the rate must never exceed 100% and must go
    // partial instead of being truncated.
    expect(usage.agentCount).toBe(20);
    expect(usage.activeAgentCount).toBe(21);
    expect(usage.agentActiveRatePartial).toBe(true);
    expect(usage.agentActiveRate).toBeNull();
  });
});

describe("Spec 189 — /api/admin/governance/agents", () => {
  it("gives every Agent the same Default Usage record set (SC-04)", async () => {
    const data = await get("/api/admin/governance/agents?hours=168");
    const byId = new Map<string, any>(data.agents.map((a: any) => [a.agentId ?? a.id, a]));
    const callsOf = (id: string) => {
      const found = data.agents.find((a: any) => (a.agentId ?? a.id) === id);
      return found?.calls ?? 0;
    };
    expect(callsOf("business_agent")).toBe(3);
    expect(callsOf("mixed_agent")).toBe(1);
    expect(callsOf("high_traffic_agent")).toBe(51);
    // Protocol-only and probe-only Agents carry no default usage calls.
    expect(callsOf("eval_probe_agent")).toBe(0);
    expect(callsOf("protocol_ping")).toBe(0);
    expect(byId.size).toBeGreaterThan(0);
  });
});

describe("Spec 189 — /api/admin/governance/tokens", () => {
  it("ranks tokens by Default Usage Calls and excludes probes (SC-03 / SC-08)", async () => {
    const data = await get("/api/admin/governance/tokens?hours=168");
    const byAgent = new Map<string, any>(data.tokens.map((t: any) => [t.agentId, t]));
    expect(byAgent.get("business_agent")?.calls).toBe(3);
    expect(byAgent.get("high_traffic_agent")?.calls).toBe(51);
    // The probe-only Agent's token has no default usage calls.
    expect(byAgent.get("eval_probe_agent")?.calls ?? 0).toBe(0);
    // A probe-only token is not "active in window".
    expect(byAgent.get("eval_probe_agent")?.activeInWindow).toBe(false);
  });
});

describe("Spec 189 — /api/admin/governance/denials", () => {
  it("breaks denials down by Default Usage Calls only (SC-04)", async () => {
    const data = await get("/api/admin/governance/denials?hours=168");
    const total = data.reasonCounts.reduce((sum: number, r: any) => sum + r.count, 0);
    // Exactly one denied default usage call in the fixture.
    expect(total).toBe(1);
    expect(data.topTools.every((t: any) => t.tool === "lucy_query")).toBe(true);
  });
});

describe("Spec 189 — /api/admin/governance/roles", () => {
  it("counts Role usage with a full-window aggregate and no row limit (SC-13)", async () => {
    const data = await get("/api/admin/governance/roles?hours=168");
    const role = data.roles.find((r: any) => r.id === FIXTURE_ROLE_ID);
    expect(role).toBeTruthy();
    // 3 (business) + 1 (name-only match) + 51 (high traffic) = 55.
    // The 2 eval-probe rows carry the same role but must not count.
    expect(role.usageCount).toBe(55);
    // The legacy 5000-row compat truncation no longer applies to this path.
    expect(data.compatTruncation).toEqual({ auditRowsLimit: null });
  });
});
