/**
 * Spec 20261101 S1 — 可问治理面 W1 单元测试。
 *
 * SC-24 日历窗；enabled_tables expansion；gov 剥离；
 * SC-10b tokens；(SC-07) Q4 MECE；ensure 不改 access.yaml Role 字节。
 */

import Database from "better-sqlite3";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCalendarDayWindow } from "../admin/metric-window";
import {
  applyStrippedGovFilters,
  assertNoGovFiltersRemain,
  parseAndStripGovFilters
} from "../ops-evidence/gov-filters";
import type { AccessMapProvider } from "../admin/access-map";
import {
  classifyGovernanceQ4Tier,
  ensureGovernanceSnapshotTables,
  rebuildGovernanceSnapshotAtomic,
  resetGovernanceSnapshotStateForTests
} from "../ops-evidence/governance-snapshot";
import { OPS_EVIDENCE_ENABLED_TABLES } from "../ops-evidence/contract";

/** S1 夹具不依赖真实 access-map 编译；W2 空投影即可。 */
function stubEmptyAccessMapProvider(): AccessMapProvider {
  return {
    loadGrantSide: async () => ({
      state: "unavailable",
      problem: "access_unreadable",
      failures: [],
      identity: {
        configVersion: "stub",
        policyVersion: "stub",
        sourceMapVersion: "stub",
        capabilityDigest: "stub"
      },
      agents: [],
      contributions: [],
      orphanGrants: 0,
      enabledConnections: []
    }),
    loadAccessSide: async () => ({ state: "unavailable", reason: "stub" })
  };
}

describe("SC-24 — buildCalendarDayWindow 含今日", () => {
  it("asOf=2026-11-01T12:00:00+08:00 N=30 → [2026-10-03, 2026-11-02)", () => {
    const asOf = new Date("2026-11-01T12:00:00+08:00");
    const win = buildCalendarDayWindow(30, "Asia/Shanghai", asOf);
    expect(Date.parse(win.startIso)).toBe(Date.parse("2026-10-03T00:00:00+08:00"));
    expect(Date.parse(win.endIso)).toBe(Date.parse("2026-11-02T00:00:00+08:00"));
    // 不是「此前 30 个完整日、不含今日」
    expect(Date.parse(win.endIso)).not.toBe(Date.parse("2026-11-01T00:00:00+08:00"));
  });
});

describe("gov.* strip / legacy reject / unknown gov", () => {
  it("剥离已知 gov.* 且上游无残留（SC-22 形状）", () => {
    const parsed = parseAndStripGovFilters(
      [
        { field: "gov.calendar_days", op: "eq", value: 30 },
        { field: "ops_tokens.agent_id", op: "eq", value: "A" }
      ],
      { connectionId: "lucy-ops", sourceName: "ops_tokens" }
    );
    expect("code" in parsed).toBe(false);
    if ("code" in parsed) return;
    expect(parsed.windowKind).toBe("calendar_days");
    expect(parsed.rowFilters).toEqual([{ field: "ops_tokens.agent_id", op: "eq", value: "A" }]);
    const stripped = applyStrippedGovFilters(
      { connectionId: "lucy-ops", sourceName: "ops_tokens", filters: [{ field: "gov.calendar_days", op: "eq", value: 30 }] },
      parsed
    );
    expect(() => assertNoGovFiltersRemain(stripped.filters)).not.toThrow();
    const fields = (Array.isArray(stripped.filters) ? stripped.filters : [stripped.filters]).map(
      (item) => (item as { field?: string }).field
    );
    expect(fields.every((field) => !String(field ?? "").startsWith("gov."))).toBe(true);
  });

  it("旧源 ops_calls 出现 gov.* → invalid_arguments", () => {
    const parsed = parseAndStripGovFilters(
      [{ field: "gov.window_hours", op: "eq", value: 168 }],
      { connectionId: "lucy-ops", sourceName: "ops_calls" }
    );
    expect(parsed).toMatchObject({ code: "invalid_arguments" });
  });

  it("未知 gov.* → invalid_arguments", () => {
    const parsed = parseAndStripGovFilters(
      [{ field: "gov.unknown_knob", op: "eq", value: 1 }],
      { connectionId: "lucy-ops", sourceName: "ops_agents" }
    );
    expect(parsed).toMatchObject({ code: "invalid_arguments" });
    if ("reason" in parsed) {
      expect(parsed.reason).toContain("unknown_gov_filter");
    }
  });

  it("多种窗互斥 → invalid_arguments", () => {
    const parsed = parseAndStripGovFilters(
      [
        { field: "gov.window_hours", op: "eq", value: 24 },
        { field: "gov.calendar_days", op: "eq", value: 7 }
      ],
      { connectionId: "lucy-ops", sourceName: "ops_agents" }
    );
    expect(parsed).toMatchObject({ code: "invalid_arguments" });
  });
});

describe("SC-07 — Q4 MECE deepest-wins", () => {
  it("有真实问询 → ⑤", () => {
    expect(
      classifyGovernanceQ4Tier({
        protocolCount: 1,
        defaultUsageCount: 2,
        queryCount: 1,
        realQuestionCount: 1
      })
    ).toBe("window_question_active");
  });

  it("有查数无问询 → ④", () => {
    expect(
      classifyGovernanceQ4Tier({
        protocolCount: 0,
        defaultUsageCount: 3,
        queryCount: 2,
        realQuestionCount: 0
      })
    ).toBe("window_query_without_ask");
  });

  it("仅失败 begin、无浏览/查数 → ③", () => {
    // failed begin 记入 defaultUsage；query=0；real=0
    expect(
      classifyGovernanceQ4Tier({
        protocolCount: 0,
        defaultUsageCount: 1,
        queryCount: 0,
        realQuestionCount: 0
      })
    ).toBe("window_soft_usage");
  });

  it("仅协议 → ②；全无 → ①", () => {
    expect(
      classifyGovernanceQ4Tier({
        protocolCount: 2,
        defaultUsageCount: 0,
        queryCount: 0,
        realQuestionCount: 0
      })
    ).toBe("window_connect_only");
    expect(
      classifyGovernanceQ4Tier({
        protocolCount: 0,
        defaultUsageCount: 0,
        queryCount: 0,
        realQuestionCount: 0
      })
    ).toBe("window_no_record");
  });
});

describe("SC-10b — ops_tokens (A,label)=1 (B,label)=2", () => {
  let db: Database.Database;
  let root: string;

  beforeEach(async () => {
    resetGovernanceSnapshotStateForTests();
    root = await mkdtemp(path.join(os.tmpdir(), "lucy-ops-gov-tokens-"));
    await mkdir(path.join(root, "webui", "config"), { recursive: true });
    await writeFile(
      path.join(root, "webui", "config", "access.yaml"),
      `roles: {}\nusers:\n  - id: A\n    name: Agent A\n    enabled: true\n    tokens: [{hash: "sha256:aa", label: shared, created: "2026-01-01"}]\n  - id: B\n    name: Agent B\n    enabled: true\n    tokens: [{hash: "sha256:bb", label: shared, created: "2026-01-01"}]\n`,
      "utf8"
    );
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE access_log (
        id INTEGER PRIMARY KEY,
        ts TEXT, user_id TEXT, token_label TEXT, tool TEXT,
        outcome TEXT, duration_ms INTEGER, eval_mark INTEGER,
        args_summary TEXT, tables TEXT, request_id TEXT,
        decision_reason TEXT, error_detail TEXT, generated_sql TEXT
      );
      CREATE TABLE access_log_sources (
        access_log_id INTEGER, ts TEXT, user_id TEXT, tool TEXT,
        connection_id TEXT, schema_name TEXT, source_name TEXT,
        physical_table TEXT, extraction_method TEXT, confidence TEXT, created_at TEXT
      );
      CREATE TABLE conversation_turns (
        turn_id TEXT PRIMARY KEY, session_id TEXT, user_id TEXT NOT NULL,
        question_source TEXT NOT NULL, created_at TEXT NOT NULL
      );
    `);
    ensureGovernanceSnapshotTables(db);
    const insert = db.prepare(
      `INSERT INTO access_log (ts, user_id, token_label, tool, outcome, duration_ms, eval_mark, request_id)
       VALUES (?, ?, ?, 'lucy_query', 'ok', 10, NULL, ?)`
    );
    // A: 1 call with label shared
    insert.run("2026-10-20T10:00:00.000Z", "A", "shared", "req-a1");
    // B: 2 calls with same label
    insert.run("2026-10-20T11:00:00.000Z", "B", "shared", "req-b1");
    insert.run("2026-10-21T11:00:00.000Z", "B", "shared", "req-b2");
  });

  afterEach(async () => {
    db.close();
    resetGovernanceSnapshotStateForTests();
    await rm(root, { recursive: true, force: true });
  });

  it("同 label 跨 Agent 分别计 1 与 2", async () => {
    const bound = await rebuildGovernanceSnapshotAtomic(db, {
      window: {
        startIso: "2026-10-01T00:00:00.000Z",
        endIso: "2026-11-01T00:00:00.000Z",
        asOf: "2026-10-31T00:00:00.000Z"
      },
      trust: "confirmed",
      focus: {},
      filtersDigest: "fixture",
      versions: {
        accessConfigVersion: "v1",
        policyVersion: "v1",
        sourceMapVersion: "v1",
        capabilityDigest: "v1"
      },
      projectRoot: root,
      accessMapProvider: stubEmptyAccessMapProvider()
    });
    const rows = db
      .prepare(
        `SELECT agent_id, token_label, call_count FROM ops_tokens
         WHERE snapshot_id = ? AND token_label = 'shared' ORDER BY agent_id`
      )
      .all(bound.materializationId) as Array<{ agent_id: string; token_label: string; call_count: number }>;
    expect(rows).toEqual([
      { agent_id: "A", token_label: "shared", call_count: 1 },
      { agent_id: "B", token_label: "shared", call_count: 2 }
    ]);
  });
});

describe("SC-07 fixture — failed begin → tier soft_usage", () => {
  let db: Database.Database;
  let root: string;

  beforeEach(async () => {
    resetGovernanceSnapshotStateForTests();
    root = await mkdtemp(path.join(os.tmpdir(), "lucy-ops-gov-kpi-"));
    await mkdir(path.join(root, "webui", "config"), { recursive: true });
    await writeFile(
      path.join(root, "webui", "config", "access.yaml"),
      `roles: {}\nusers:\n  - id: fail_begin\n    name: Fail Begin\n    enabled: true\n    tokens: []\n`,
      "utf8"
    );
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE access_log (
        id INTEGER PRIMARY KEY,
        ts TEXT, user_id TEXT, token_label TEXT, tool TEXT,
        outcome TEXT, duration_ms INTEGER, eval_mark INTEGER,
        args_summary TEXT, tables TEXT, request_id TEXT,
        decision_reason TEXT, error_detail TEXT, generated_sql TEXT
      );
      CREATE TABLE access_log_sources (
        access_log_id INTEGER, connection_id TEXT, physical_table TEXT
      );
      CREATE TABLE conversation_turns (
        turn_id TEXT PRIMARY KEY, session_id TEXT, user_id TEXT NOT NULL,
        question_source TEXT NOT NULL, created_at TEXT NOT NULL
      );
    `);
    ensureGovernanceSnapshotTables(db);
    db.prepare(
      `INSERT INTO access_log (ts, user_id, token_label, tool, outcome, duration_ms, eval_mark, request_id)
       VALUES ('2026-10-15T08:00:00.000Z', 'fail_begin', 't', 'lucy_begin_question', 'error', 5, NULL, 'req-fb')`
    ).run();
  });

  afterEach(async () => {
    db.close();
    resetGovernanceSnapshotStateForTests();
    await rm(root, { recursive: true, force: true });
  });

  it("仅失败 begin → window_soft_usage", async () => {
    const bound = await rebuildGovernanceSnapshotAtomic(db, {
      window: {
        startIso: "2026-10-01T00:00:00.000Z",
        endIso: "2026-11-01T00:00:00.000Z",
        asOf: "2026-10-31T00:00:00.000Z"
      },
      trust: "confirmed",
      focus: {},
      filtersDigest: "kpi",
      versions: {
        accessConfigVersion: "v1",
        policyVersion: "v1",
        sourceMapVersion: "v1",
        capabilityDigest: "v1"
      },
      projectRoot: root,
      accessMapProvider: stubEmptyAccessMapProvider()
    });
    const row = db
      .prepare(`SELECT tier FROM ops_question_kpi_agents WHERE snapshot_id = ? AND agent_id = 'fail_begin'`)
      .get(bound.materializationId) as { tier: string };
    expect(row.tier).toBe("window_soft_usage");
  });
});

describe("D22 — enabled_tables expansion；ensure 不改 access Role 字节", () => {
  let projectRoot: string | undefined;
  let previousRoot: string | undefined;
  let previousContentRoot: string | undefined;
  let previousAuditDb: string | undefined;

  beforeEach(() => {
    previousRoot = process.env.KTX_PROJECT_ROOT;
    previousContentRoot = process.env.LUCY_CONTENT_ROOT;
    previousAuditDb = process.env.LUCY_AUDIT_DB;
  });

  afterEach(async () => {
    const readiness = await import("../ops-evidence/readiness");
    readiness.resetOpsEvidenceEnsureState();
    const audit = await import("../proxy/audit");
    audit.closeAuditDb();
    if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
    else process.env.KTX_PROJECT_ROOT = previousRoot;
    if (previousContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
    else process.env.LUCY_CONTENT_ROOT = previousContentRoot;
    if (previousAuditDb === undefined) delete process.env.LUCY_AUDIT_DB;
    else process.env.LUCY_AUDIT_DB = previousAuditDb;
    if (projectRoot) {
      await rm(projectRoot, { recursive: true, force: true });
      projectRoot = undefined;
    }
    vi.resetModules();
  });

  it("仅有 W0 enabled_tables 时 ensure → expanded，并按 Manifest 交集补齐冻结表", async () => {
    projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-ops-expand-"));
    const auditDbPath = path.join(projectRoot, "audit.sqlite");
    await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
    const accessYaml = `roles:
  lucy_ops_reader:
    description: old role
    allow:
      connections: [lucy-ops]
      tableSelectors:
        - connection: lucy-ops
          schema: main
          names: [ops_calls, ops_call_tables]
          row_access: all
      tools: [lucy_query]
users: []
`;
    await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), accessYaml, "utf8");
    await writeFile(
      path.join(projectRoot, "ktx.yaml"),
      `connections:
  lucy-ops:
    driver: sqlite
    readonly: true
    path: ${auditDbPath}
    schemas: [main]
    enabled_tables:
      - ops_calls
      - ops_call_tables
`,
      "utf8"
    );
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    process.env.LUCY_AUDIT_DB = auditDbPath;

    vi.resetModules();
    const { ensureOpsEvidenceConnectionBlock, readOpsEvidenceBlock } = await import(
      "../ops-evidence/connection-block"
    );
    const beforeAccess = await readFile(path.join(projectRoot, "webui", "config", "access.yaml"));
    const state = await ensureOpsEvidenceConnectionBlock(projectRoot, auditDbPath, {
      manifestPhysicalTables: OPS_EVIDENCE_ENABLED_TABLES
    });
    expect(state.write).toBe("expanded");
    expect(state.addedTables?.length).toBeGreaterThan(0);
    const block = await readOpsEvidenceBlock(projectRoot);
    for (const table of OPS_EVIDENCE_ENABLED_TABLES) {
      expect(block?.enabled_tables, table).toContain(table);
    }
    // SC-17：access.yaml Role 字节不变
    expect(await readFile(path.join(projectRoot, "webui", "config", "access.yaml"))).toEqual(beforeAccess);
  });
});
