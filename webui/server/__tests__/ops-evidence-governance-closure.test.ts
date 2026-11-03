/**
 * 可问治理面收口证据。
 *
 * 人口／沉默／自追问不等价、禁列、Skill／Wiki 路由、§4.1 四则 JSON、
 * 构建中途 access.yaml 变化不发布。部署 runbook 与客户环境不在本文件。
 */

import Database from "better-sqlite3";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ACCESS_YAML_REL } from "../admin/access-config";
import type { AccessMapProvider } from "../admin/access-map";
import {
  applyStrippedGovFilters,
  assertNoGovFiltersRemain,
  parseAndStripGovFilters
} from "../ops-evidence/gov-filters";
import {
  computeGovernanceQueryKey,
  ensureGovernanceSnapshotTables,
  GovernanceSnapshotUnreadyError,
  peekGovernancePointer,
  rebuildGovernanceSnapshotAtomic,
  resetGovernanceSnapshotStateForTests
} from "../ops-evidence/governance-snapshot";
import {
  assertOpsEvidenceViewsSafe,
  OPS_EVIDENCE_FORBIDDEN_SELECT_COLUMNS
} from "../proxy/audit";

const WINDOW = {
  startIso: "2026-10-01T00:00:00.000Z",
  endIso: "2026-11-01T00:00:00.000Z",
  asOf: "2026-10-31T00:00:00.000Z"
};

const VERSIONS = {
  accessConfigVersion: "v1",
  policyVersion: "v1",
  sourceMapVersion: "v1",
  capabilityDigest: "v1"
};

const ACCESS_YAML = `roles: {}
users:
  - id: on
    name: On
    enabled: true
    tokens:
      - { label: shared, hash: "sha256:aa" }
      - { label: shared, hash: "sha256:bb" }
      - { label: old, hash: "sha256:cc", expires_at: "2020-01-01T00:00:00.000Z" }
  - id: off
    name: Off
    enabled: false
    tokens:
      - { label: shared, hash: "sha256:dd" }
  - id: silent
    name: Silent
    enabled: true
    tokens: []
  - id: proto
    name: Proto
    enabled: true
    tokens: []
`;

function emptyMap(): AccessMapProvider {
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

describe("SC-03／04／05／05b／06 — 人口、事件集、沉默", () => {
  let db: Database.Database;
  let root: string;

  beforeEach(async () => {
    resetGovernanceSnapshotStateForTests();
    root = await mkdtemp(path.join(os.tmpdir(), "lucy-ops-gov-close-"));
    await mkdir(path.join(root, "webui", "config"), { recursive: true });
    await writeFile(path.join(root, ACCESS_YAML_REL), ACCESS_YAML, "utf8");
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE access_log (
        id INTEGER PRIMARY KEY,
        ts TEXT, user_id TEXT, token_label TEXT, tool TEXT,
        outcome TEXT, duration_ms INTEGER, eval_mark INTEGER,
        args_summary TEXT, request_id TEXT
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
    const insert = db.prepare(
      `INSERT INTO access_log (id, ts, user_id, token_label, tool, outcome, duration_ms, eval_mark, request_id)
       VALUES (?, ?, ?, ?, ?, 'ok', 10, NULL, ?)`
    );
    insert.run(1, "2026-10-20T10:00:00.000Z", "on", "shared", "lucy_query", "biz");
    insert.run(2, "2026-10-20T11:00:00.000Z", "on", "shared", "lucy_query", "self");
    insert.run(3, "2026-10-20T12:00:00.000Z", "proto", null, "initialize", "hs");
    db.prepare(
      `INSERT INTO access_log_sources (access_log_id, connection_id, physical_table) VALUES (2, 'lucy-ops', 'ops_calls')`
    ).run();
  });

  afterEach(async () => {
    db.close();
    resetGovernanceSnapshotStateForTests();
    await rm(root, { recursive: true, force: true });
  });

  it("配置人口含未启用与从未入流水；可用 Token 按枚计，不按 label 去重", async () => {
    const bound = await rebuildGovernanceSnapshotAtomic(db, {
      window: WINDOW,
      trust: "confirmed",
      focus: {},
      filtersDigest: "pop",
      versions: VERSIONS,
      projectRoot: root,
      accessMapProvider: emptyMap()
    });
    const agents = db
      .prepare(
        `SELECT agent_id, available_token_count FROM ops_agents WHERE snapshot_id = ? ORDER BY agent_id`
      )
      .all(bound.materializationId) as Array<{ agent_id: string; available_token_count: number }>;
    expect(agents.map((row) => row.agent_id)).toEqual(["off", "on", "proto", "silent"]);
    const on = agents.find((row) => row.agent_id === "on");
    expect(on?.available_token_count).toBe(2);
    expect(agents.find((row) => row.agent_id === "off")?.available_token_count).toBe(0);
    const distinctLabels = (
      db
        .prepare(
          `SELECT COUNT(DISTINCT token_label) AS n FROM ops_tokens WHERE snapshot_id = ?`
        )
        .get(bound.materializationId) as { n: number }
    ).n;
    expect(distinctLabels).not.toBe(
      agents.reduce((sum, row) => sum + row.available_token_count, 0)
    );
  });

  it("自追问与协议不进窗口活跃；沉默 Agent 仍在配置人口", async () => {
    const bound = await rebuildGovernanceSnapshotAtomic(db, {
      window: WINDOW,
      trust: "confirmed",
      focus: {},
      filtersDigest: "act",
      versions: VERSIONS,
      projectRoot: root,
      accessMapProvider: emptyMap()
    });
    const activity = db
      .prepare(
        `SELECT agent_id, call_count FROM ops_agent_activity WHERE snapshot_id = ? ORDER BY agent_id`
      )
      .all(bound.materializationId) as Array<{ agent_id: string; call_count: number }>;
    expect(activity).toEqual([{ agent_id: "on", call_count: 1 }]);
    const population = db
      .prepare(`SELECT agent_id FROM ops_agents WHERE snapshot_id = ?`)
      .all(bound.materializationId) as Array<{ agent_id: string }>;
    expect(population.map((row) => row.agent_id)).toContain("silent");
    expect(activity.map((row) => row.agent_id)).not.toContain("silent");
    expect(activity.map((row) => row.agent_id)).not.toContain("proto");
  });
});

describe("SC-16 — 治理源列不含禁列", () => {
  it("物化表与旧视图的列都不含禁列", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE access_log (id INTEGER PRIMARY KEY);
      CREATE TABLE access_log_sources (access_log_id INTEGER);
      CREATE VIEW ops_calls AS SELECT id AS event_id FROM access_log;
      CREATE VIEW ops_call_tables AS SELECT access_log_id AS event_id FROM access_log_sources;
    `);
    ensureGovernanceSnapshotTables(db);
    expect(() => assertOpsEvidenceViewsSafe(db)).not.toThrow();
    for (const source of [
      "ops_agents",
      "ops_tokens",
      "ops_agent_activity",
      "ops_question_kpi_agents",
      "ops_grant_paths",
      "ops_access_paths",
      "ops_edge_signals",
      "ops_map_nodes",
      "ops_map_meta",
      "ops_table_adoption"
    ]) {
      const names = (
        db.prepare(`PRAGMA table_info(${source})`).all() as Array<{ name: string }>
      ).map((column) => column.name.toLowerCase());
      for (const forbidden of OPS_EVIDENCE_FORBIDDEN_SELECT_COLUMNS) {
        expect(names, source).not.toContain(forbidden);
      }
    }
    db.close();
  });
});

describe("SC-13／14／15／08h／10c — Skill 与 Wiki 路由", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../config/ops-evidence");

  it("Skill 路由 Q1–Q6，禁止从未连接，Q5 要求改述", async () => {
    const skill = await readFile(path.join(root, "skills/lucy-ops/ops-questioning.md"), "utf8");
    expect(skill).toContain("配置 Agent 人口");
    expect(skill).toContain("可用 Token 人口");
    expect(skill).toContain("count(distinct token_label)");
    expect(skill).toContain("沉默 Agent");
    expect(skill).toContain("窗口轻量业务未问");
    expect(skill).toContain("近窗未访问");
    expect(skill).toContain("必须先改述");
    expect(skill).toContain("activity_rate");
    expect(skill).toContain("禁止输出「从未连接」");
    expect(skill).toContain("不对账");
    expect(skill).toContain("lucy_ops_reader");
  });

  it("Wiki 披露图≠论述、五档、旧 Role 显式扩权", async () => {
    const wiki = await readFile(path.join(root, "wiki/lucy-ops/ops-questioning.md"), "utf8");
    expect(wiki).toContain("不要求");
    expect(wiki).toContain("页面折叠");
    expect(wiki).toContain("故意不对齐");
    expect(wiki).toContain("禁止「从未连接」");
    expect(wiki).toContain("近窗未访问表");
    expect(wiki).toContain("上线以来从未访问");
    expect(wiki).toContain("永不写 access.yaml");
    expect(wiki).toContain("allowed_roles: [lucy_ops_reader]");
  });
});

describe("SC-22／23／08g — 四则 JSON 与行滤不进子图键", () => {
  const cases = [
    {
      name: "Q1 ops_agents",
      sourceName: "ops_agents",
      filters: [{ field: "gov.calendar_days", op: "eq", value: 30 }]
    },
    {
      name: "Q2 ops_agent_activity",
      sourceName: "ops_agent_activity",
      filters: [
        { field: "gov.window_hours", op: "eq", value: 168 },
        { field: "ops_agent_activity.call_day", op: "in", values: ["2026-10-20"] }
      ]
    },
    {
      name: "ops_map_meta",
      sourceName: "ops_map_meta",
      filters: [{ field: "gov.window_hours", op: "eq", value: 168 }]
    },
    {
      name: "ops_tokens row filter",
      sourceName: "ops_tokens",
      filters: [
        { field: "gov.window_hours", op: "eq", value: 168 },
        { field: "ops_tokens.agent_id", op: "eq", value: "A" }
      ]
    }
  ];

  it.each(cases)("$name 剥光 gov.*", ({ sourceName, filters }) => {
    const parsed = parseAndStripGovFilters(filters, { connectionId: "lucy-ops", sourceName });
    expect("code" in parsed).toBe(false);
    if ("code" in parsed) return;
    expect(parsed.focus.agent).toBeUndefined();
    const stripped = applyStrippedGovFilters(
      { connectionId: "lucy-ops", sourceName, filters },
      parsed
    );
    expect(() => assertNoGovFiltersRemain(stripped.filters)).not.toThrow();
  });

  it("不同 trust 得到不同 query_key", () => {
    const base = {
      startIso: WINDOW.startIso,
      endIso: WINDOW.endIso,
      filtersDigest: "x",
      versions: VERSIONS
    };
    expect(computeGovernanceQueryKey({ ...base, trust: "confirmed" })).not.toBe(
      computeGovernanceQueryKey({ ...base, trust: "include_candidate" })
    );
  });
});

describe("SC-21 — 构建中途改 access.yaml 不发布", () => {
  let db: Database.Database;
  let root: string;

  beforeEach(async () => {
    resetGovernanceSnapshotStateForTests();
    root = await mkdtemp(path.join(os.tmpdir(), "lucy-ops-gov-dirty-"));
    await mkdir(path.join(root, "webui", "config"), { recursive: true });
    await writeFile(path.join(root, ACCESS_YAML_REL), ACCESS_YAML, "utf8");
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE access_log (id INTEGER PRIMARY KEY, ts TEXT, user_id TEXT, token_label TEXT, tool TEXT, outcome TEXT, duration_ms INTEGER, eval_mark INTEGER, args_summary TEXT, request_id TEXT);
      CREATE TABLE access_log_sources (access_log_id INTEGER, connection_id TEXT, physical_table TEXT);
      CREATE TABLE conversation_turns (turn_id TEXT PRIMARY KEY, session_id TEXT, user_id TEXT NOT NULL, question_source TEXT NOT NULL, created_at TEXT NOT NULL);
    `);
  });

  afterEach(async () => {
    db.close();
    resetGovernanceSnapshotStateForTests();
    await rm(root, { recursive: true, force: true });
  });

  it("loadGrantSide 改写 access.yaml 后抛 unready，pointer 为空", async () => {
    const provider: AccessMapProvider = {
      loadGrantSide: async () => {
        await writeFile(path.join(root, ACCESS_YAML_REL), `${ACCESS_YAML}\n# mid-build\n`, "utf8");
        return {
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
        };
      },
      loadAccessSide: async () => ({ state: "unavailable", reason: "stub" })
    };
    await expect(
      rebuildGovernanceSnapshotAtomic(db, {
        window: WINDOW,
        trust: "confirmed",
        focus: {},
        filtersDigest: "dirty",
        versions: VERSIONS,
        projectRoot: root,
        accessMapProvider: provider
      })
    ).rejects.toBeInstanceOf(GovernanceSnapshotUnreadyError);
    const queryKey = computeGovernanceQueryKey({
      startIso: WINDOW.startIso,
      endIso: WINDOW.endIso,
      trust: "confirmed",
      filtersDigest: "dirty",
      versions: VERSIONS
    });
    expect(peekGovernancePointer(queryKey)).toBeUndefined();
    const rows = db.prepare(`SELECT COUNT(*) AS n FROM ops_agents`).get() as { n: number };
    expect(rows.n).toBe(0);
  });
});
