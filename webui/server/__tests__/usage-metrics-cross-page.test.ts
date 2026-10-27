/**
 * Spec 189 / WO-202610-28 T6 — cross-page reconciliation.
 *
 * ONE audit fixture, read through every surface that publishes a usage
 * number. The point of this file is not that each module behaves correctly in
 * isolation (its own test covers that) — it is that **the same log rows
 * produce the same number on every surface that claims the same record
 * layer and the same population**.
 *
 * The only legitimate differences are:
 *   - the record layer (Raw Audit / Raw Business / Default Usage / real table
 *     access);
 *   - the population (current configured assets vs. historical log
 *     identities).
 *
 * A same-layer, same-population difference is a defect — it cannot be
 * explained away as "the page defines it differently".
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
  const root = await mkdtemp(path.join(os.tmpdir(), "lucy-usage-cross-page-"));
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
  // Bind the evaluation domain to the fixture Role so the 「现场」panel has a
  // population to report on.
  await writeFile(
    path.join(root, ".ktx-ui", "eval", "monitor-config.json"),
    JSON.stringify({ domains: { finance: { roleIds: [FIXTURE_ROLE_ID] } } }, null, 2),
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

/** The shared 7-day window every surface is compared on. */
const WINDOW_START_ISO = new Date(Date.parse(FIXTURE_NOW_ISO) - 168 * 60 * 60 * 1000).toISOString();
const WINDOW_END_ISO = new Date(Date.parse(FIXTURE_NOW_ISO) - 1).toISOString();

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

describe("Spec 189 — cross-page reconciliation: the Default Usage layer", () => {
  it("publishes one number for the Default Usage layer across every surface (SC-04 / SC-11)", async () => {
    const overview = await get("/api/admin/governance/overview?hours=168");
    const agents = await get("/api/admin/governance/agents?hours=168");
    const callMonitor = await get("/api/ops/call-monitor?range=24h");
    const agentList = await get("/api/admin/agents");

    // Population A — every logged identity.
    const overviewCalls = overview.usageOverview.calls;
    const callMonitorCalls = callMonitor.traffic.businessCalls;
    expect(overviewCalls).toBe(73);
    expect(callMonitorCalls).toBe(overviewCalls);

    // Population B — current configured assets only.
    const agentRankingCalls = agents.agents.reduce((sum: number, a: any) => sum + a.calls, 0);
    const configuredUsage = agentList.agents.reduce(
      (sum: number, a: any) => sum + (a.stats.usageCallsLast7d ?? 0),
      0
    );
    const configuredBusiness = agentList.agents.reduce(
      (sum: number, a: any) => sum + (a.stats.businessCallsLast7d ?? 0),
      0
    );
    expect(agentRankingCalls).toBe(59);
    expect(configuredUsage).toBe(agentRankingCalls);
    // Raw Business = Default Usage + the 2 excluded eval probes.
    expect(configuredBusiness).toBe(configuredUsage + 2);
  });

  it("keeps the Token ranking on the same record set as the Agent ranking", async () => {
    const agents = await get("/api/admin/governance/agents?hours=168");
    const tokens = await get("/api/admin/governance/tokens?hours=168");
    const agentCalls = agents.agents.reduce((sum: number, a: any) => sum + a.calls, 0);
    const tokenCalls = tokens.tokens.reduce((sum: number, t: any) => sum + t.calls, 0);
    expect(tokenCalls).toBe(59);
    expect(tokenCalls).toBe(agentCalls);
  });

  it("keeps the evaluation field panel on the same record set (SC-08)", async () => {
    const field = await get("/api/eval/monitor/field?domain=finance");
    // The field panel is scoped to the domain-bound Role, so the difference to
    // the other surfaces is a *population* difference, not a record-layer one:
    // 55 Default Usage calls carry role_finance, and the 2 eval probes on the
    // same role do not.
    expect(field.rows[0].calls).toBe(55);
  });

  it("keeps the release readiness usage on the Default Usage layer (SC-17)", async () => {
    const pkg = await get("/api/admin/governance/release-readiness-package");
    expect(pkg.denialSummary.totalCalls).toBe(73);
    const perAgent = pkg.inventory.agents.reduce(
      (sum: number, a: any) => sum + (a.callsLastWindow ?? 0),
      0
    );
    expect(perAgent).toBe(59);
  });
});

describe("Spec 189 — cross-page reconciliation: the Raw Business layer", () => {
  it("publishes one number for the Raw Business layer (audit default view)", async () => {
    const audit = await get(
      `/api/admin/audit?since=${encodeURIComponent(WINDOW_START_ISO)}&until=${encodeURIComponent(WINDOW_END_ISO)}`
    );
    const overview = await get("/api/admin/governance/overview?hours=168");
    // The audit default view is the Raw Business layer over every identity.
    expect(audit.total).toBe(75);
    expect(audit.total).toBe(overview.usageOverview.calls + 2);
    // Its own summary must agree with the list it summarizes.
    expect(audit.summary.businessCalls).toBe(75);
    expect(audit.summary.protocolCalls).toBe(12);
  });
});

describe("Spec 189 — cross-page reconciliation: the Raw Audit layer", () => {
  it("keeps the audit default view on Raw Business and the full set behind includeProtocol (SC-05)", async () => {
    const query = `since=${encodeURIComponent(WINDOW_START_ISO)}&until=${encodeURIComponent(WINDOW_END_ISO)}`;
    const defaultView = await get(`/api/admin/audit?${query}`);
    const fullView = await get(`/api/admin/audit?${query}&includeProtocol=true`);
    // Raw Audit (all rows) = Raw Business + protocol events.
    expect(fullView.total).toBe(87);
    expect(defaultView.total).toBe(75);
    expect(fullView.total - defaultView.total).toBe(12);
  });
});

describe("Spec 189 — cross-page reconciliation: population boundaries", () => {
  it("separates the current configured assets from the historical log identities (SC-16)", async () => {
    const agentList = await get("/api/admin/agents");
    const overview = await get("/api/admin/governance/overview?hours=168");
    // The usage overview counts every logged identity (21), the Agent page
    // only the configured assets (20). The rate must therefore go partial
    // instead of exceeding 100%.
    expect(overview.usageOverview.activeAgentCount).toBe(21);
    expect(overview.usageOverview.agentActiveRatePartial).toBe(true);
    expect(overview.usageOverview.agentActiveRate).toBeNull();
    expect(agentList.agents.length).toBe(20);
  });

  it("explains every allowed difference by layer or population only", async () => {
    const query = `since=${encodeURIComponent(WINDOW_START_ISO)}&until=${encodeURIComponent(WINDOW_END_ISO)}`;
    const overview = await get("/api/admin/governance/overview?hours=168");
    const agentList = await get("/api/admin/agents");
    const audit = await get(`/api/admin/audit?${query}`);
    const auditFull = await get(`/api/admin/audit?${query}&includeProtocol=true`);

    const layers = {
      defaultUsageAll: overview.usageOverview.calls,
      rawBusinessAll: audit.total,
      rawAuditAll: auditFull.total,
      defaultUsageConfigured: agentList.agents.reduce(
        (sum: number, a: any) => sum + (a.stats.usageCallsLast7d ?? 0),
        0
      ),
      rawBusinessConfigured: agentList.agents.reduce(
        (sum: number, a: any) => sum + (a.stats.businessCallsLast7d ?? 0),
        0
      )
    };

    // Layer differences are exact: Default Usage + eval probes = Raw Business,
    // Raw Business + protocol events = Raw Audit.
    expect(layers.rawBusinessAll).toBe(layers.defaultUsageAll + 2);
    expect(layers.rawAuditAll).toBe(layers.rawBusinessAll + 12);
    expect(layers.rawBusinessConfigured).toBe(layers.defaultUsageConfigured + 2);
    // Population difference: the 14 rows of historical / unconfigured
    // identities exist in the audit log but are not current assets.
    expect(layers.defaultUsageAll - layers.defaultUsageConfigured).toBe(14);
    // Layer ordering is monotone within each population.
    expect(layers.rawAuditAll).toBeGreaterThanOrEqual(layers.rawBusinessAll);
    expect(layers.rawBusinessAll).toBeGreaterThanOrEqual(layers.defaultUsageAll);
    expect(layers.rawBusinessConfigured).toBeGreaterThanOrEqual(layers.defaultUsageConfigured);
  });
});
