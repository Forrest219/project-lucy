/**
 * Lucy v0.25 P1-1 — RTV-06：与 L25-01／L25-08 对账。
 *
 * Authority:
 *   - `docs/specs/lucy-20261025-v0p25-row-policy-templates-and-view-spec.md` §8
 *       RTV-06 | 与 L25-01／L25-08 对账 | 同快照下表集合一致；授权路径数与去重表数不混用
 *     其中 L25-01 = 授权摘要（P1-2）、L25-08 = 访问关系图（P1-3）。
 *
 * 三个面读**同一份** `access.yaml` 与**同一份** semantic-layer 目录快照：
 *
 *   - 行权限视图（P1-1）：`listRowPolicyTables()`
 *   - 授权摘要（L25-01）：`buildAuthorizationSummary()`
 *   - 访问关系图（L25-08）：`buildAccessMap()`
 *
 * 本文件要证两件事，缺一不可：
 *
 *   ① **表集合一致**：同一快照下，三个面看到的「表集合」是同一个集合。
 *      不是「都非空」，是**逐个相等**。
 *   ② **计数不混用**：授权路径数（去重 `(Agent, Role, Connection, Schema, Table)`）
 *      与去重表数是两个不同的数，三面各自的字段必须各自表达自己的口径，
 *      谁都不许拿另一个的数来冒充。
 *
 * 夹具刻意制造重叠：两个 Role 授权同一张表、同一个 Agent 挂多个 Role ——
 * 没有重叠，「授权路径数」和「去重表数」会恒等，② 就测不出东西。
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { buildAccessMap, createAdminAccessMapProvider } from "../admin/access-map.js";
import { buildAuthorizationSummary } from "../admin/authorization-summary.js";
import { listRowPolicyTables } from "../admin/row-policy-views.js";
import { readAccessSnapshot } from "../admin/permission-display.js";
import { commitEffectivePolicy, resetEffectivePolicyForTests } from "../proxy/acl.js";
import { invalidateAccessConfigCache } from "../proxy/identity.js";
import { invalidateContentPathsCache } from "../paths.js";

const KTX_YAML = `connections:
  warehouse:
    driver: mysql
    enabled_tables:
      - fin.fin_ledger
      - fin.fin_budget
  vault:
    driver: mysql
    enabled_tables:
      - fin.fin_secret
`;

/**
 * 夹具授权矩阵（刻意重叠）：
 *
 *   Role                 表            行口径
 *   ledger_all           fin_ledger    all
 *   ledger_all_scoped    fin_ledger    scoped   ← 与 ledger_all 同表
 *   ledger_budget        fin_budget    all
 *   vault_all            fin_secret    all
 *   vault_all_scoped     fin_secret    scoped   ← 与 vault_all 同表
 *
 *   Agent       Roles                          授权路径数
 *   a_one       ledger_all                     1
 *   a_two       ledger_all, ledger_budget      2
 *   a_overlap   vault_all, vault_all_scoped   2
 *
 * ⇒ 去重表数 = 3（fin_ledger / fin_budget / fin_secret）
 * ⇒ 授权路径数 = 5（1 + 2 + 2）
 */
const ACCESS_YAML = `roles:
  ledger_all:
    permission_model_version: 2
    allow:
      connections: [warehouse]
      tableSelectors:
        - connection: warehouse
          schema: fin
          names: [fin_ledger]
          row_access: all
      tools: [lucy_query]
  ledger_all_scoped:
    permission_model_version: 2
    allow:
      connections: [warehouse]
      tableSelectors:
        - connection: warehouse
          schema: fin
          names: [fin_ledger]
          row_access: scoped
          row_policy:
            predicates:
              - { field: region, op: eq, value: East }
      tools: [lucy_query]
  ledger_budget:
    permission_model_version: 2
    allow:
      connections: [warehouse]
      tableSelectors:
        - connection: warehouse
          schema: fin
          names: [fin_budget]
          row_access: all
      tools: [lucy_query]
  vault_all:
    permission_model_version: 2
    allow:
      connections: [vault]
      tableSelectors:
        - connection: vault
          schema: fin
          names: [fin_secret]
          row_access: all
      tools: [lucy_query]
  vault_all_scoped:
    permission_model_version: 2
    allow:
      connections: [vault]
      tableSelectors:
        - connection: vault
          schema: fin
          names: [fin_secret]
          row_access: scoped
          row_policy:
            predicates:
              - { field: region, op: eq, value: East }
      tools: [lucy_query]
users:
  - { id: a_one, name: A One, enabled: true, roles: [ledger_all], tokens: [] }
  - { id: a_two, name: A Two, enabled: true, roles: [ledger_all, ledger_budget], tokens: [] }
  - { id: a_overlap, name: A Overlap, enabled: true, roles: [vault_all, vault_all_scoped], tokens: [] }
defaults:
  known_tools: [lucy_query, lucy_catalog, wiki_search, wiki_read]
  table_touching_tools: [lucy_query]
`;

const DEFAULT_QUERY = {
  agent: null,
  role: null,
  token: null,
  table: null,
  connection: null,
  window: "168h" as const,
  layer: "flat" as const,
  trust: "confirmed" as const,
  view: "map" as const,
  focus: null
};

const AGENT_IDS = ["a_one", "a_two", "a_overlap"] as const;

function manifest(schema: string, tables: string[]): string {
  return `tables:\n${tables
    .map(
      (table) =>
        `  ${table}:\n    table: ${schema}.${table}\n    columns:\n      - name: id\n        type: number\n      - name: region\n        type: string\n`
    )
    .join("")}`;
}

async function writeProject(root: string): Promise<void> {
  await mkdir(path.join(root, "semantic-layer", "warehouse", "_schema"), { recursive: true });
  await mkdir(path.join(root, "semantic-layer", "vault", "_schema"), { recursive: true });
  await mkdir(path.join(root, "webui", "config"), { recursive: true });
  await writeFile(path.join(root, "ktx.yaml"), KTX_YAML, "utf8");
  await writeFile(
    path.join(root, "semantic-layer", "warehouse", "_schema", "fin.yaml"),
    manifest("fin", ["fin_ledger", "fin_budget"]),
    "utf8"
  );
  await writeFile(
    path.join(root, "semantic-layer", "vault", "_schema", "fin.yaml"),
    manifest("fin", ["fin_secret"]),
    "utf8"
  );
  await writeFile(path.join(root, "webui", "config", "access.yaml"), ACCESS_YAML, "utf8");
}

function openEmptyAuditDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE access_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      user_id TEXT NOT NULL,
      matched_role_id TEXT,
      role_ids TEXT,
      token_label TEXT,
      outcome TEXT NOT NULL,
      permission_snapshot_hash TEXT,
      capability_digest TEXT,
      association_status TEXT
    );
    CREATE TABLE access_log_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      access_log_id INTEGER NOT NULL,
      connection_id TEXT,
      schema_name TEXT,
      source_name TEXT
    );
    CREATE TABLE permission_snapshots (
      hash TEXT PRIMARY KEY,
      roles_json TEXT,
      resolved_json TEXT,
      capability_digest TEXT
    );
  `);
  return db;
}

let projectRoot: string;
const savedEnv = {
  root: process.env.KTX_PROJECT_ROOT,
  content: process.env.LUCY_CONTENT_ROOT,
  access: process.env.LUCY_ACCESS_CONFIG_PATH
};

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-p1-row-policy-reconciliation-"));
  await writeProject(projectRoot);
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_CONTENT_ROOT = ".";
  delete process.env.LUCY_ACCESS_CONFIG_PATH;
  invalidateContentPathsCache();
  invalidateAccessConfigCache();
  resetEffectivePolicyForTests();
  await commitEffectivePolicy();
});

afterEach(async () => {
  for (const [key, value] of [
    ["KTX_PROJECT_ROOT", savedEnv.root],
    ["LUCY_CONTENT_ROOT", savedEnv.content],
    ["LUCY_ACCESS_CONFIG_PATH", savedEnv.access]
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  invalidateContentPathsCache();
  invalidateAccessConfigCache();
  resetEffectivePolicyForTests();
  await rm(projectRoot, { recursive: true, force: true });
});

describe("P1-1 §8 — RTV-06 与 L25-01／L25-08 对账", () => {
  it("RTV-06 — 同快照下三面表集合一致；授权路径数与去重表数分别表达、不混用", async () => {
    const db = openEmptyAuditDb();
    const provider = createAdminAccessMapProvider({ projectRoot, openAuditDb: async () => db });

    // ① 行权限视图（P1-1）：按表反查的清单。
    const rowView = await listRowPolicyTables(projectRoot);
    expect(rowView.status).toBe("ok");
    expect(rowView.state).toBe("ok");
    const rowViewTables = rowView.tables
      .map((table) => `${table.connectionId}::${table.schema}::${table.sourceName}`)
      .sort();

    // ② 授权摘要（L25-01）：每个 Agent 一份，取并集。
    const snapshot = await readAccessSnapshot(projectRoot);
    const summaryTables = new Set<string>();
    let summaryPathTotal = 0;
    for (const agentId of AGENT_IDS) {
      const summary = await buildAuthorizationSummary({
        subject: { kind: "agent", id: agentId },
        basis: "committed",
        snapshot,
        projectRoot
      });
      expect(summary.summaryContext.state).toBe("ok");
      for (const connection of summary.resources) {
        for (const schema of connection.schemas) {
          for (const table of schema.tables) {
            summaryTables.add(`${table.connectionId}::${table.schema}::${table.sourceName}`);
          }
        }
      }
      summaryPathTotal += summary.headline.grantPathCount;
    }

    // ③ 访问关系图（L25-08）：同一份快照的授权骨架。
    const mapResponse = await buildAccessMap(provider, DEFAULT_QUERY);
    expect(mapResponse.meta.grant.state).toBe("ok");
    const mapTables = mapResponse.nodes
      .filter((node) => node.kind === "table")
      .map((node) => node.id.replace(/^table:/, ""))
      .sort();

    // ── ④ 「同快照」本身：三面发布的是同一个配置版本 ──────────────────────
    const summaryForConfig = await buildAuthorizationSummary({
      subject: { kind: "agent", id: "a_one" },
      basis: "committed",
      snapshot,
      projectRoot
    });
    expect(rowView.snapshot.identity.configVersion).toBe(summaryForConfig.summaryContext.configVersion);
    expect(mapResponse.meta.grant.accessConfigVersion).toBe(rowView.snapshot.identity.configVersion);

    // ── ⑤ 表集合一致：逐个相等，不是「都非空」 ───────────────────────────
    expect(rowViewTables).toEqual(["vault::fin::fin_secret", "warehouse::fin::fin_budget", "warehouse::fin::fin_ledger"]);
    expect([...summaryTables].sort()).toEqual(rowViewTables);
    expect(mapTables).toEqual(rowViewTables);

    // ── ⑥ 计数不混用：表数与授权路径数是两个不同的数 ─────────────────────
    const dedupedTableCount = rowView.tables.length;
    const grantPathCount = mapResponse.meta.counts.grantPaths;

    // 去重表数：三面各自用自己的字段表达同一个数。
    expect(dedupedTableCount).toBe(3);
    expect(mapResponse.meta.counts.tables).toBe(dedupedTableCount);

    // 授权路径数：访问关系图与授权摘要表达同一个数（5 = 1 + 2 + 2）。
    expect(grantPathCount).toBe(5);
    expect(summaryPathTotal).toBe(grantPathCount);

    // 两个数**必须不相等**：不相等才说明没有一个面拿另一个的数冒充。
    expect(grantPathCount).not.toBe(dedupedTableCount);

    // 行权限视图自己的计数列也是路径口径，不是表口径。
    const roleCountSum = rowView.tables.reduce((sum, table) => sum + table.roleCount, 0);
    expect(roleCountSum).toBe(grantPathCount);
    expect(roleCountSum).not.toBe(dedupedTableCount);

    // ── ⑦ 逐表归因也不打架：同一张表的 Role 数两面对得上 ─────────────────
    const overlapSummary = await buildAuthorizationSummary({
      subject: { kind: "agent", id: "a_overlap" },
      basis: "committed",
      snapshot,
      projectRoot
    });
    const secretTable = overlapSummary.resources
      .flatMap((connection) => connection.schemas)
      .flatMap((schema) => schema.tables)
      .find((table) => table.sourceName === "fin_secret");
    expect(secretTable?.roleIds.slice().sort()).toEqual(["vault_all", "vault_all_scoped"]);

    const secretEntry = rowView.tables.find((table) => table.sourceName === "fin_secret");
    expect(secretEntry?.roleCount).toBe(2);
    expect(secretEntry?.agentCount).toBe(1);

    // 同一个 Agent 的两张表：授权摘要给的是路径数 2、表数 1。
    const overlapHeadline = overlapSummary.headline;
    expect(overlapHeadline.grantPathCount).toBe(2);
    expect(overlapHeadline.tableCount).toBe(1);
    expect(overlapHeadline.grantPathCount).not.toBe(overlapHeadline.tableCount);

    db.close();
  });
});
