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
import { buildMetricWindow } from "../admin/metric-window.js";
import {
  defaultUsageConditionSql,
  evalProbeConditionSql,
  protocolConditionSql,
  rawBusinessConditionSql
} from "../proxy/usage-classification.js";
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
    // Question KPI is a separate unit. It must not change the call-volume identity.
    expect(data.realQuestions).toMatchObject({ state: "ok", value: 0 });
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

/**
 * Spec 194 — 访问分级与日真实问询 KPI。
 *
 * 本 Spec 只**新增**问询口径，不改 Spec 189 的分层与调用量口径。SC-17 与
 * SC-20 是这条正交性的可打假检查：同一份夹具上，两个聚合同时跑完，Spec 189
 * 的恒等式仍然成立，活跃 Agent 也没有被换成新指标。
 */
describe("Spec 194 — 问询 KPI 与 Spec 189 的分层正交", () => {
  it("SC-17 — 混合夹具上 Spec 189 的分层恒等式仍成立，问询 KPI 不改变 usageCalls", async () => {
    const db = await getAuditDb();
    // 让本 Spec 的指标也是非平凡值：一条原文问询。
    db.prepare(
      `INSERT INTO conversation_turns (turn_id, session_id, user_id, question_source, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run("sc17-turn-1", "sc17-session-1", "business_agent", "reported_tool", "2026-10-27T07:30:00.000Z");

    const data = await get("/api/admin/governance/overview?hours=168");
    const win = buildMetricWindow(168);
    const count = (where: string): number => {
      const row = db
        .prepare(`SELECT COUNT(*) AS n FROM access_log WHERE ts >= ? AND ts < ? AND ${where}`)
        .get(win.startIso, win.endIso) as { n: number };
      return row.n;
    };
    const rawAudit = count("1 = 1");
    const protocol = count(protocolConditionSql().sql);
    const rawBusiness = count(rawBusinessConditionSql().sql);
    const defaultUsage = count(defaultUsageConditionSql().sql);
    const evalProbe = count(evalProbeConditionSql().sql);

    // 夹具必须同时含协议、默认用量与探针三层，否则下面的恒等式是空转。
    expect(protocol).toBeGreaterThan(0);
    expect(defaultUsage).toBeGreaterThan(0);
    expect(evalProbe).toBeGreaterThan(0);

    // Spec 189 §4 的分层恒等式：原始审计 = 原始业务 + 协议；原始业务 = 默认用量 + 评测探针。
    expect(rawAudit).toBe(rawBusiness + protocol);
    expect(rawBusiness).toBe(defaultUsage + evalProbe);

    // 本 Spec 的问询 KPI 与调用量口径互不影响：usageCalls 仍是默认用量口径，
    // 真实问询另列，且这次确实算出了非平凡值。
    expect(data.usageOverview.calls).toBe(defaultUsage);
    expect(data.realQuestions).toMatchObject({ state: "ok", value: 1 });
  });

  describe("只有握手与一条原文问询", () => {
    beforeEach(async () => {
      const db = await getAuditDb();
      db.exec("DELETE FROM access_log");
      db.exec("DELETE FROM conversation_turns");
      const mixed = buildFixtureAgents().find((a) => a.id === "mixed_agent");
      if (!mixed) throw new Error("fixture agent missing: mixed_agent");
      // 一次握手（协议级），没有任何默认用量业务调用。
      db.prepare(
        `INSERT INTO access_log
           (ts, user_id, token_hash_prefix, token_label, tool, outcome, duration_ms,
            eval_mark, args_summary, role_ids, user_agent, tables, request_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        "2026-10-27T07:00:00.000Z",
        "mixed_agent",
        mixed.token_hashes[0].slice(0, 19),
        "mixed-agent-token",
        "initialize",
        "ok",
        5,
        null,
        null,
        null,
        "fixture-client/1.0",
        null,
        "sc20-req-0001"
      );
      // 一条原文问询。
      db.prepare(
        `INSERT INTO conversation_turns (turn_id, session_id, user_id, question_source, created_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run("sc20-turn-1", "sc20-session-1", "mixed_agent", "reported_tool", "2026-10-27T07:30:00.000Z");
    });

    it("SC-20 — activeAgentCount 仍按 Spec 189 的默认用量计算，真实问询单独给出", async () => {
      const data = await get("/api/admin/governance/overview?hours=168");
      // 握手是协议事件，不是默认用量业务调用 → 该 Agent 不是近 N 活跃 Agent。
      expect(data.usageOverview.calls).toBe(0);
      expect(data.usageOverview.activeAgentCount).toBe(0);
      // 真实问询是独立单位：原文问询照常计入，与活跃 Agent 的口径无关。
      expect(data.realQuestions).toMatchObject({ state: "ok", value: 1 });
      // 新指标「问询活跃 Agent」不替换 Spec 189 的「近 N 活跃 Agent」。
      expect(data.questionActiveAgents).toMatchObject({ state: "ok", value: 1 });
    });
  });
});
