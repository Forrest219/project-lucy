/**
 * Lucy v0.25 P1-3 — 访问关系图的跨模块契约与零回归用例（SC-11 / SC-12 / SC-14）。
 *
 * Authority:
 *   - webui/docs/187-access-relation-sankey-spec.md §10（验收映射）：
 *       SC-11 `npm run lint:terminology` 通过；术语标准 §4.8「访问权限升级」
 *              已含附录 A 的 6 个新词
 *       SC-12 现有测试全量；现有 Agent / 角色 / 审计页快照无变化
 *       SC-14 同快照下摘要表集合等于授权路径表集合并集；多角色、重复访问时
 *              四种计数不混用
 *   - docs/specs/lucy-20261025-v0p25-access-authorization-summary-spec.md §2.2、§6
 *
 * 这三条都跨文件 / 跨进程，因此单独成文件，自带一个真实的磁盘工程
 * （access.yaml + ktx.yaml + semantic-layer 清单），让授权摘要（L25-01）与
 * 访问关系图（L25-08）读**同一份**配置／目录快照。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import Fastify from "fastify";
import { registerAccessMapRoutes } from "../admin/routes/access-map.js";
import {
  buildAccessMap,
  createAdminAccessMapProvider,
  parseAccessMapQuery
} from "../admin/access-map.js";
import {
  accessMapUrlForAgent,
  accessMapUrlForRole,
  buildAuthorizationSummary
} from "../admin/authorization-summary.js";
import { readAccessSnapshot } from "../admin/permission-display.js";
import {
  buildAdminPermissionContext,
  commitEffectivePolicy,
  resetEffectivePolicyForTests,
  resolveEffectivePermissionsBatchForAdmin
} from "../proxy/acl.js";
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

/** 定位 webui 根目录（不依赖 cwd 恰好是 webui/）。 */
function resolveWebuiRoot(): string {
  let dir = process.cwd();
  for (let index = 0; index < 8; index += 1) {
    if (existsSync(path.join(dir, "scripts", "lint-terminology.mjs"))) return dir;
    const nested = path.join(dir, "webui");
    if (existsSync(path.join(nested, "scripts", "lint-terminology.mjs"))) return nested;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("webui_root_not_found");
}

/** 一个最小审计库：两条已确认的 allow 调用，落在同一条访问路径上。 */
function openAuditDb(): Database.Database {
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
  const ts = new Date(Date.now() - 3_600_000).toISOString();
  const insertLog = db.prepare(
    `INSERT INTO access_log (ts, user_id, matched_role_id, role_ids, token_label, outcome,
      permission_snapshot_hash, capability_digest, association_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertSource = db.prepare(
    `INSERT INTO access_log_sources (access_log_id, connection_id, schema_name, source_name)
     VALUES (?, ?, ?, ?)`
  );
  // 同一条路径（a_overlap / vault_all / vault::fin::fin_secret）被访问两次。
  insertLog.run(ts, "a_overlap", "vault_all", null, "p0-demo", "allow", null, null, "confirmed");
  insertSource.run(1, "vault", "fin", "fin_secret");
  insertLog.run(ts, "a_overlap", "vault_all", null, "p0-demo", "allow", null, null, "confirmed");
  insertSource.run(2, "vault", "fin", "fin_secret");
  return db;
}

let projectRoot: string;
const savedEnv = {
  root: process.env.KTX_PROJECT_ROOT,
  content: process.env.LUCY_CONTENT_ROOT,
  access: process.env.LUCY_ACCESS_CONFIG_PATH
};

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-access-map-contract-"));
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

describe("P1-3 §10 — SC-11 术语 lint 与新术语登记", () => {
  it("SC-11 — 术语 lint 真实通过，且术语标准 §4.8「访问权限升级」已登记 6 个新词", () => {
    const webuiRoot = resolveWebuiRoot();

    // ① 附录 A 的 6 个新词已在术语标准 §4.8 登记。
    const standard = readFileSync(
      path.join(webuiRoot, "docs", "00-product-terminology-standard.md"),
      "utf8"
    );
    const heading = standard.indexOf("### 4.8 访问权限升级");
    expect(heading).toBeGreaterThan(-1);
    const section = standard.slice(heading);
    for (const term of [
      "Access Map",
      "Grant Path",
      "Access Path",
      "Dormant Grant",
      "Needs-review Signal",
      "Credential List"
    ]) {
      expect(section).toContain(term);
    }

    // ② lint 脚本真实跑一遍（文档 lint 不能代替功能验收，但这条验收方式
    //    写的就是 lint，所以它必须真的绿）。
    const output = execFileSync(
      process.execPath,
      [path.join(webuiRoot, "scripts", "lint-terminology.mjs")],
      { cwd: webuiRoot, encoding: "utf8", timeout: 120_000 }
    );
    expect(output).toContain("Terminology lint passed");
  });
});

describe("P1-3 §10 — SC-06 详情页深链与过滤预置", () => {
  it("SC-06 — Agent／Role 详情页深链携带过滤参数，跳转后独立页的过滤已正确预置", async () => {
    const db = openAuditDb();
    const provider = createAdminAccessMapProvider({ projectRoot, openAuditDb: async () => db });

    // ① Agent 详情页的深链：携带 agent=<userId>。
    const agentUrl = accessMapUrlForAgent("a_two");
    expect(agentUrl.startsWith("/admin/access-map?")).toBe(true);
    const agentParams = new URL(agentUrl, "http://local").searchParams;
    expect(agentParams.get("agent")).toBe("a_two");

    // ② Role 详情页的深链：携带 role=<roleId>（Role 摘要自己就产出这个链接）。
    const snapshot = await readAccessSnapshot(projectRoot);
    const roleSummary = await buildAuthorizationSummary({
      subject: { kind: "role", id: "ledger_all" },
      basis: "committed",
      snapshot,
      projectRoot
    });
    expect(roleSummary.actions.accessMapUrl).not.toBeNull();
    const roleUrl = roleSummary.actions.accessMapUrl!;
    expect(roleUrl).toBe(accessMapUrlForRole("ledger_all"));
    const roleParams = new URL(roleUrl, "http://local").searchParams;
    expect(roleParams.get("role")).toBe("ledger_all");

    // ③ 跳转后独立页解析出的过滤与链接一致（预置正确，不被静默纠正成默认值）。
    const parsedAgent = parseAccessMapQuery({ agent: agentParams.get("agent") ?? undefined });
    expect(parsedAgent.ok).toBe(true);
    if (!parsedAgent.ok) return;
    expect(parsedAgent.query.agent).toBe("a_two");
    expect(parsedAgent.query.role).toBeNull();

    const parsedRole = parseAccessMapQuery({ role: roleParams.get("role") ?? undefined });
    expect(parsedRole.ok).toBe(true);
    if (!parsedRole.ok) return;
    expect(parsedRole.query.role).toBe("ledger_all");

    // ④ 预置真的生效：按 Agent 过滤后图里只剩该 Agent 的授权骨架。
    const agentScoped = await buildAccessMap(provider, parsedAgent.query);
    expect(agentScoped.nodes.filter((node) => node.kind === "agent").map((node) => node.id)).toEqual([
      "agent:a_two"
    ]);
    expect(agentScoped.nodes.some((node) => node.id === "role:ledger_all")).toBe(true);

    // 按 Role 过滤保留该 Role 及其上下游（谁在用 + 它授权了什么）。
    const roleScoped = await buildAccessMap(provider, parsedRole.query);
    expect(roleScoped.nodes.some((node) => node.id === "role:ledger_all")).toBe(true);
    expect(roleScoped.nodes.some((node) => node.kind === "agent")).toBe(true);
    expect(roleScoped.nodes.some((node) => node.id === "table:warehouse::fin::fin_ledger")).toBe(true);

    db.close();
  });
});

describe("P1-3 §10 — SC-12 零回归", () => {  it("SC-12 — 访问关系图是只读旁路：不改配置、不改运行时授权、不新增写入口", async () => {
    const accessPath = path.join(projectRoot, "webui", "config", "access.yaml");
    const before = await readFile(accessPath, "utf8");

    // 运行时授权产物：Agent 页 / 角色权限页 / MCP 调试台读的是同一份。
    const snapshot = await readAccessSnapshot(projectRoot);
    const context = await buildAdminPermissionContext(snapshot.runtimeConfig!);
    const beforeBatch = await resolveEffectivePermissionsBatchForAdmin(["a_two"], context);
    const beforeResolved = beforeBatch.get("a_two");
    expect(beforeResolved?.ok).toBe(true);
    const beforeHash =
      beforeResolved && beforeResolved.ok ? beforeResolved.permissions.snapshotHash : null;
    expect(beforeHash).not.toBeNull();

    // 跑一次真实的访问关系图构建（真实 provider + 真实审计库）。
    const db = openAuditDb();
    const provider = createAdminAccessMapProvider({ projectRoot, openAuditDb: async () => db });
    const response = await buildAccessMap(provider, DEFAULT_QUERY);
    expect(response.meta.grant.state).toBe("ok");
    expect(response.nodes.length).toBeGreaterThan(0);

    // ① 已提交配置一个字节都没变。
    expect(await readFile(accessPath, "utf8")).toBe(before);

    // ② 运行时授权产物没变（快照 hash 一致）→ 既有页面读到的权限没变。
    const afterBatch = await resolveEffectivePermissionsBatchForAdmin(["a_two"], context);
    const afterResolved = afterBatch.get("a_two");
    expect(afterResolved?.ok).toBe(true);
    const afterHash =
      afterResolved && afterResolved.ok ? afterResolved.permissions.snapshotHash : null;
    expect(afterHash).toBe(beforeHash);

    // ③ 没有新增写入口：这个端点只有 GET。
    const app = Fastify();
    registerAccessMapRoutes(app, provider);
    for (const method of ["POST", "PUT", "DELETE"] as const) {
      const res = await app.inject({ method, url: "/api/admin/access-map" });
      expect(res.statusCode).toBe(404);
    }
    await app.close();
    db.close();
  });
});

describe("P1-3 §10 — SC-14 与 L25-01 同源对账", () => {
  it("SC-14 — 同一快照下摘要表集合 = 授权路径表集合并集；四种计数分别表达", async () => {
    const db = openAuditDb();
    const provider = createAdminAccessMapProvider({ projectRoot, openAuditDb: async () => db });

    // ① 授权摘要（L25-01）读同一份 access.yaml 快照。
    const snapshot = await readAccessSnapshot(projectRoot);
    const summary = await buildAuthorizationSummary({
      subject: { kind: "agent", id: "a_two" },
      basis: "committed",
      snapshot,
      projectRoot
    });
    expect(summary.summaryContext.state).toBe("ok");
    const summaryTables = summary.resources
      .flatMap((connection) => connection.schemas)
      .flatMap((schema) => schema.tables)
      .map((table) => `${table.connectionId}::${table.schema}::${table.sourceName}`)
      .sort();

    // ② 访问关系图（L25-08）读同一份快照，限定到同一个 Agent。
    const mapResponse = await buildAccessMap(provider, { ...DEFAULT_QUERY, agent: "a_two" });
    expect(mapResponse.meta.grant.state).toBe("ok");
    const mapTables = mapResponse.nodes
      .filter((node) => node.kind === "table")
      .map((node) => node.id.replace(/^table:/, ""))
      .sort();

    // ③ 对账断言：摘要表集合 == 授权路径的表集合**并集**（不是「表数 == 路径数」）。
    expect(summaryTables).toEqual(["warehouse::fin::fin_budget", "warehouse::fin::fin_ledger"]);
    expect(mapTables).toEqual(summaryTables);

    // ④ 多角色重复授权同表：授权路径数 2、去重表数 1 —— 两个数分别表达。
    const overlapSummary = await buildAuthorizationSummary({
      subject: { kind: "agent", id: "a_overlap" },
      basis: "committed",
      snapshot,
      projectRoot
    });
    const overlapMap = await buildAccessMap(provider, { ...DEFAULT_QUERY, agent: "a_overlap" });
    expect(overlapSummary.headline.grantPathCount).toBe(2);
    expect(overlapSummary.headline.tableCount).toBe(1);
    expect(overlapMap.meta.counts.grantPaths).toBe(2);
    expect(overlapMap.meta.counts.tables).toBe(1);

    // ⑤ 重复访问：同一条路径访问 2 次 → 访问路径数 1、调用次数 2。
    expect(overlapMap.meta.counts.accessPaths).toBe(1);
    expect(overlapMap.meta.access.rawCalls).toBe(2);
    const ledgerEdge = overlapMap.edges.find(
      (edge) => edge.target === "table:vault::fin::fin_secret"
    );
    expect(ledgerEdge?.accessPaths).toBe(1);
    expect(ledgerEdge?.accessCalls).toBe(2);

    // ④ 与 ⑤ 合起来：授权路径数、去重表数、访问路径数、调用数是四个不同的数。
    expect(overlapMap.meta.counts.grantPaths).not.toBe(overlapMap.meta.counts.tables);
    expect(overlapMap.meta.counts.accessPaths).not.toBe(overlapMap.meta.access.rawCalls);

    db.close();
  });
});
