import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  agentStatsTestExports,
  type YamlUser
} from "../admin/agents.js";
import { getAuditDb, resetAuditDbForTests } from "../admin/audit.js";
import {
  build7dWindow,
  buildAgentStatsWindow,
  type MetricWindow
} from "../admin/metric-window.js";
import {
  classifyUsage,
  isMcpProtocolMethod
} from "../proxy/usage-classification.js";

const FIXED_NOW = new Date("2026-08-02T12:00:00.000Z");

type SeedRow = {
  user_id: string;
  token_hash_prefix: string | null;
  ts: string;
  tool: string;
  outcome: string;
  tables?: string | null;
  eval_mark?: number | null;
  args_summary?: string | null;
};

const GOLD_USERS: YamlUser[] = [
  {
    id: "agent-alpha",
    name: "Alpha",
    enabled: true,
    tokens: [{ hash: "sha256:alpha00000000001", label: "a1", created: "2026-01-01" }],
    allow: { tables: ["*"], tools: ["*"] }
  },
  {
    id: "agent-beta",
    name: "Beta",
    enabled: true,
    tokens: [
      { hash: "sha256:beta000000000001", label: "b1", created: "2026-01-01" },
      { hash: "sha256:beta000000000002", label: "b2", created: "2026-01-01" }
    ],
    allow: { tables: ["*"], tools: ["*"] }
  },
  {
    id: "agent-gamma",
    name: "Gamma",
    enabled: true,
    tokens: [{ hash: "sha256:gamma00000000001", label: "g1", created: "2026-01-01" }],
    allow: { tables: ["*"], tools: ["*"] }
  }
];

/** Independent oracle — does not call getStatsMap. */
function oracleAgentStats(
  rows: Array<SeedRow & { id: number }>,
  userId: string,
  win: MetricWindow,
  ceilingId: number
) {
  const inSnapshot = rows.filter((row) => row.user_id === userId && row.id <= ceilingId);
  const inWindow = inSnapshot.filter((row) => row.ts >= win.startIso && row.ts < win.endIso);
  let calls = 0;
  let business = 0;
  let protocol = 0;
  let usage = 0;
  let evalProbe = 0;
  let denied = 0;
  const tokens = new Set<string>();
  const tableCounts = new Map<string, number>();

  for (const row of inWindow) {
    calls += 1;
    const usageClass = classifyUsage({
      tool: row.tool,
      evalMark: row.eval_mark === 1,
      args: row.args_summary ? safeJson(row.args_summary) : null
    });
    const isProtocol = usageClass === "protocol" || isMcpProtocolMethod(row.tool);
    if (isProtocol) protocol += 1;
    else business += 1;
    if (usageClass === "default_usage") usage += 1;
    if (usageClass === "eval_probe") evalProbe += 1;
    if (usageClass === "default_usage" && row.outcome === "denied") denied += 1;
    if (row.token_hash_prefix) tokens.add(row.token_hash_prefix);
    if (!isProtocol && row.tables) {
      try {
        const parsed = JSON.parse(row.tables) as string[];
        for (const table of parsed) {
          tableCounts.set(table, (tableCounts.get(table) ?? 0) + 1);
        }
      } catch {
        // skip
      }
    }
  }

  const lastSeen = inSnapshot.map((row) => row.ts).sort().at(-1);
  const lastBusinessSeen = inSnapshot
    .filter((row) => classifyUsage({ tool: row.tool, evalMark: row.eval_mark === 1 }) === "default_usage")
    .map((row) => row.ts)
    .sort()
    .at(-1);

  const topTables = [...tableCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([table, count]) => ({ table, calls: count }));

  return {
    callsLast7d: calls,
    businessCallsLast7d: business,
    protocolCallsLast7d: protocol,
    usageCallsLast7d: usage,
    evalProbeCallsLast7d: evalProbe,
    deniedLast7d: denied,
    activeTokensLast7d: tokens.size,
    lastSeen,
    lastBusinessSeen,
    topTables
  };
}

function safeJson(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isoOffsetHours(base: Date, hours: number): string {
  return new Date(base.getTime() + hours * 60 * 60 * 1000).toISOString();
}

function buildGoldSeedRows(): SeedRow[] {
  const inside = (hours: number, patch: Partial<SeedRow>): SeedRow => ({
    user_id: "agent-alpha",
    token_hash_prefix: "sha256:alpha0000",
    ts: isoOffsetHours(FIXED_NOW, hours),
    tool: "lucy_query",
    outcome: "ok",
    tables: JSON.stringify(["dataforai.superstore_orders"]),
    ...patch
  });

  return [
    inside(-12, { user_id: "agent-alpha" }),
    inside(-36, { user_id: "agent-alpha", outcome: "denied" }),
    inside(-60, { user_id: "agent-alpha", tool: "initialize" }),
    inside(-80, { user_id: "agent-beta", token_hash_prefix: "sha256:beta00000", tool: "lucy_query" }),
    inside(-100, { user_id: "agent-beta", token_hash_prefix: "sha256:beta00001", tool: "ping" }),
    inside(-120, { user_id: "agent-beta", token_hash_prefix: "sha256:beta00001", tool: "lucy_query", tables: JSON.stringify(["dataforai.orders"]) }),
    inside(-200, { user_id: "agent-gamma", token_hash_prefix: "sha256:gamma0000", tool: "lucy_query" }),
    {
      user_id: "agent-alpha",
      token_hash_prefix: "sha256:alpha0000",
      ts: isoOffsetHours(FIXED_NOW, -400),
      tool: "lucy_query",
      outcome: "ok",
      tables: JSON.stringify(["dataforai.legacy_outside_window"])
    },
    {
      user_id: "agent-beta",
      token_hash_prefix: "sha256:beta00000",
      ts: isoOffsetHours(FIXED_NOW, -2),
      tool: "lucy_query",
      outcome: "ok",
      tables: null
    },
    {
      user_id: "agent-beta",
      token_hash_prefix: "sha256:beta00001",
      ts: isoOffsetHours(FIXED_NOW, -2.001),
      tool: "lucy_query",
      outcome: "ok",
      tables: null
    }
  ];
}

function insertSeedRows(db: Awaited<ReturnType<typeof getAuditDb>>, rows: SeedRow[]) {
  const insert = db.prepare(
    `INSERT INTO access_log (
      ts, user_id, token_hash_prefix, tool, tables, outcome, duration_ms, request_id, eval_mark, args_summary
    ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
  );
  const tx = db.transaction((batch: SeedRow[]) => {
    for (const row of batch) {
      insert.run(
        row.ts,
        row.user_id,
        row.token_hash_prefix,
        row.tool,
        row.tables ?? null,
        row.outcome,
        `req-${row.user_id}-${row.ts}`,
        row.eval_mark ?? null,
        row.args_summary ?? null
      );
    }
  });
  tx(rows);
}

function loadRows(db: Awaited<ReturnType<typeof getAuditDb>>) {
  return db
    .prepare(
      `SELECT id, user_id, token_hash_prefix, ts, tool, outcome, tables, eval_mark, args_summary
       FROM access_log ORDER BY id`
    )
    .all() as Array<SeedRow & { id: number }>;
}

function padOutsideHistory(db: Awaited<ReturnType<typeof getAuditDb>>, multiplier: number) {
  const base = buildGoldSeedRows();
  const padding: SeedRow[] = [];
  for (let i = 0; i < base.length * multiplier; i += 1) {
    padding.push({
      user_id: "agent-gamma",
      token_hash_prefix: "sha256:gamma0000",
      ts: isoOffsetHours(FIXED_NOW, -2000 - i),
      tool: "lucy_query",
      outcome: "ok"
    });
  }
  insertSeedRows(db, padding);
}

let auditDir: string;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
  resetAuditDbForTests();
  auditDir = mkdtempSync(path.join(os.tmpdir(), "lucy-stats-equiv-"));
  mkdirSync(auditDir, { recursive: true });
  process.env.LUCY_AUDIT_DB = path.join(auditDir, "audit.sqlite");
});

afterEach(() => {
  resetAuditDbForTests();
  rmSync(auditDir, { recursive: true, force: true });
  delete process.env.LUCY_AUDIT_DB;
  vi.useRealTimers();
});

describe("P1-58 admin agent stats equivalence (SC-01/02)", () => {
  it("matches independent oracle for 7d / 14d / 30d windows", async () => {
    const db = await getAuditDb();
    insertSeedRows(db, buildGoldSeedRows());
    const rows = loadRows(db);
    const ceilingId = agentStatsTestExports.captureAgentAuditReadSnapshot(db).ceilingId;

    for (const range of ["7d", "14d", "30d"] as const) {
      const win = buildAgentStatsWindow(range, FIXED_NOW);
      const map = await agentStatsTestExports.getStatsMap(GOLD_USERS, win);
      for (const user of GOLD_USERS) {
        const expected = oracleAgentStats(rows, user.id, win, ceilingId);
        const actual = map.get(user.id);
        expect(actual, `${user.id} ${range}`).toBeDefined();
        expect(actual?.callsLast7d).toBe(expected.callsLast7d);
        expect(actual?.businessCallsLast7d).toBe(expected.businessCallsLast7d);
        expect(actual?.protocolCallsLast7d).toBe(expected.protocolCallsLast7d);
        expect(actual?.usageCallsLast7d).toBe(expected.usageCallsLast7d);
        expect(actual?.evalProbeCallsLast7d).toBe(expected.evalProbeCallsLast7d);
        expect(actual?.deniedLast7d).toBe(expected.deniedLast7d);
        expect(actual?.activeTokensLast7d).toBe(expected.activeTokensLast7d);
        expect(actual?.lastSeen).toBe(expected.lastSeen);
        expect(actual?.lastBusinessSeen).toBe(expected.lastBusinessSeen);
        const normTop = (rows: Array<{ table: string; calls: number }>) =>
          [...rows].sort((a, b) => b.calls - a.calls || a.table.localeCompare(b.table));
        expect(normTop(actual?.topTables ?? [])).toEqual(normTop(expected.topTables));
      }
    }
  });

  it("keeps window counts stable when outside history grows 5× (SC-01 sensitivity)", async () => {
    const db = await getAuditDb();
    insertSeedRows(db, buildGoldSeedRows());
    const win = build7dWindow(FIXED_NOW);
    const before = await agentStatsTestExports.getStatsMap(GOLD_USERS, win);
    padOutsideHistory(db, 5);
    const after = await agentStatsTestExports.getStatsMap(GOLD_USERS, win);
    for (const user of GOLD_USERS) {
      expect(after.get(user.id)?.callsLast7d).toBe(before.get(user.id)?.callsLast7d);
      expect(after.get(user.id)?.lastSeen).toBe(before.get(user.id)?.lastSeen);
    }
    const padded = (db.prepare(`SELECT COUNT(*) AS n FROM access_log WHERE ts < ?`).get(win.startIso) as { n: number }).n;
    expect(padded).toBeGreaterThan(buildGoldSeedRows().length);
  });

  it("uses WHERE push-down on the window aggregate (EXPLAIN plan)", async () => {
    const db = await getAuditDb();
    insertSeedRows(db, buildGoldSeedRows());
    padOutsideHistory(db, 5);
    const win = build7dWindow(FIXED_NOW);
    const plan = db
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT user_id, COUNT(*) AS calls7
         FROM access_log
         WHERE user_id IN ('agent-alpha') AND ts >= ? AND ts < ?
         GROUP BY user_id`
      )
      .all(win.startIso, win.endIso) as Array<{ detail: string }>;
    const detail = plan.map((row) => row.detail).join("\n");
    expect(detail.toLowerCase()).toMatch(/ts|user_id|search/);
  });
});