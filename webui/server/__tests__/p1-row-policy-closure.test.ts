/**
 * Lucy v0.25 P1-1（L25-14 R3）—— 行权限视图的收口补证。
 *
 * Authority:
 *   - `docs/specs/lucy-20261025-v0p25-row-policy-templates-and-view-spec.md` §8
 *       RTV-06 | 与 L25-01／L25-08 对账 | 同快照下表集合一致；授权路径数与去重表数不混用
 *       RTV-07 | 只读与可达性     | 页面无写 API；键盘、表格、焦点和翻译防御满足设计规范
 *       RTV-08 | 快照切换         | 同次响应不混用配置、目录或策略世代；刷新后明确更新快照身份
 *   - 同文 §3.3（按表读取模型）、§4（管理 API 与写入合同）、P1-D7（同源不等于同数）
 *
 * 本文件补的是 2026-10-30 收口记录**没有覆盖到**的三处：
 *
 *   ① **RTV-06 的单表详情面**。既有对账（`p1-row-policy-reconciliation.test.ts`）比的是
 *      **清单面**；用户真正逐表读的是**详情面**，它此前没有任何跨面断言。
 *   ② **RTV-08 的两条判据**。既有用例只断言四个身份字段是**非空字符串**——
 *      「同一次响应不混用世代」与「刷新后明确更新身份」这两句**没有被断言**。
 *   ③ **RTV-07 的服务端一半**：「页面无写 API」的前端一半在
 *      `webui/src/__tests__/row-policy-view-readonly-a11y.test.tsx`，服务端要证明
 *      **反查视图的两个端点上根本没有写路由**。
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAuthorizationSummary } from "../admin/authorization-summary.js";
import { readAccessSnapshot } from "../admin/permission-display.js";
import { listRowPolicyTables, readRowPolicyTableView } from "../admin/row-policy-views.js";
import { registerRowPolicyTemplateRoutes } from "../admin/routes/row-policy.js";
import { contentVersionOf } from "../admin/snapshot-identity.js";
import { commitEffectivePolicy, getPolicyRuntimeStatus, resetEffectivePolicyForTests } from "../proxy/acl.js";
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

const LEDGER = { connectionId: "warehouse", schema: "fin", sourceName: "fin_ledger" };

function manifest(schema: string, tables: string[]): string {
  return `tables:\n${tables
    .map(
      (table) =>
        `  ${table}:\n    table: ${schema}.${table}\n    columns:\n      - name: id\n        type: number\n      - name: region\n        type: string\n`
    )
    .join("")}`;
}

async function writeProject(root: string, accessYaml: string): Promise<void> {
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
  await writeFile(path.join(root, "webui", "config", "access.yaml"), accessYaml, "utf8");
}

let projectRoot: string;
const savedEnv = {
  root: process.env.KTX_PROJECT_ROOT,
  content: process.env.LUCY_CONTENT_ROOT,
  access: process.env.LUCY_ACCESS_CONFIG_PATH
};

async function commitCurrentPolicy(): Promise<void> {
  invalidateContentPathsCache();
  invalidateAccessConfigCache();
  resetEffectivePolicyForTests();
  await commitEffectivePolicy();
}

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-p1-row-policy-closure-"));
  await writeProject(projectRoot, ACCESS_YAML);
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_CONTENT_ROOT = ".";
  delete process.env.LUCY_ACCESS_CONFIG_PATH;
  await commitCurrentPolicy();
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

describe("RTV-06 —— 单表详情面与清单面同源", () => {
  it("RTV-06 — 详情面的角色数与 Agent 数等于清单面的同一张表；详情面不串别的表的角色", async () => {
    const list = await listRowPolicyTables(projectRoot);
    expect(list.status).toBe("ok");
    const listEntry = list.tables.find(
      (table) =>
        table.connectionId === LEDGER.connectionId &&
        table.schema === LEDGER.schema &&
        table.sourceName === LEDGER.sourceName
    );
    expect(listEntry).toBeDefined();

    const detail = await readRowPolicyTableView(projectRoot, LEDGER);
    expect(detail.status).toBe("ok");

    // ① 详情面与清单面是**同一份快照**——四个身份字段逐个相等。
    expect(detail.snapshot.identity.configVersion).toBe(list.snapshot.identity.configVersion);
    expect(detail.snapshot.identity.policyVersion).toBe(list.snapshot.identity.policyVersion);
    expect(detail.snapshot.identity.sourceMapVersion).toBe(list.snapshot.identity.sourceMapVersion);
    expect(detail.snapshot.identity.capabilityDigest).toBe(list.snapshot.identity.capabilityDigest);

    // ② 详情面真正授予这张表的角色数 == 清单面的角色策略数。
    const grantingRoles = detail.roles.filter((role) => role.rowGrant !== null);
    expect(grantingRoles.map((role) => role.roleId).sort()).toEqual(["ledger_all", "ledger_all_scoped"]);
    expect(grantingRoles.length).toBe(listEntry!.roleCount);

    // ③ 详情面到达这张表的 Agent 数 == 清单面的涉及 Agent 数。
    expect(detail.agents.map((agent) => agent.agentId).sort()).toEqual(["a_one", "a_two"]);
    expect(detail.agents.length).toBe(listEntry!.agentCount);

    // ④ 不授予这张表的角色**仍然出现在详情面**，但不能带行授予——
    //    否则别的表的角色会串进这张表（RTV-04 / P1-D7）。
    const otherRoles = detail.roles.filter((role) => role.rowGrant === null);
    expect(otherRoles.map((role) => role.roleId).sort()).toEqual([
      "ledger_budget",
      "vault_all",
      "vault_all_scoped"
    ]);
    for (const role of otherRoles) {
      expect(role.rowAccess).toBeNull();
      expect(role.error).toBeUndefined();
    }

    // ⑤ 与授权摘要（L25-01）对账：摘要里这个 Agent 的角色集合必须落在详情面的
    //    授予角色集合里（摘要是**该 Agent** 的视角，详情面是**全配置**的视角）。
    const snapshot = await readAccessSnapshot(projectRoot);
    const summary = await buildAuthorizationSummary({
      subject: { kind: "agent", id: "a_one" },
      basis: "committed",
      snapshot,
      projectRoot
    });
    expect(summary.summaryContext.state).toBe("ok");
    expect(summary.summaryContext.configVersion).toBe(detail.snapshot.identity.configVersion);
    const summaryTable = summary.resources
      .flatMap((connection) => connection.schemas)
      .flatMap((schema) => schema.tables)
      .find((table) => table.sourceName === LEDGER.sourceName);
    expect(summaryTable?.roleIds.slice().sort()).toEqual(["ledger_all"]);
    for (const roleId of summaryTable?.roleIds ?? []) {
      expect(grantingRoles.map((role) => role.roleId)).toContain(roleId);
    }
  });
});

describe("RTV-08 —— 同一次响应不混用世代，刷新后身份明确更新", () => {
  it("RTV-08 — 一个响应的四个身份字段来自同一份配置与同一代策略；清单面与详情面逐个相等", async () => {
    const raw = await readFile(path.join(projectRoot, "webui", "config", "access.yaml"), "utf8");
    const list = await listRowPolicyTables(projectRoot);
    const detail = await readRowPolicyTableView(projectRoot, LEDGER);
    const runtime = getPolicyRuntimeStatus();

    // ① 配置世代：响应里发布的 configVersion 就是**这份配置的内容摘要**。
    expect(list.snapshot.identity.configVersion).toBe(contentVersionOf(raw));
    expect(detail.snapshot.identity.configVersion).toBe(contentVersionOf(raw));

    // ② 策略世代：同一响应里的 policyVersion／sourceMapVersion 就是运行时的当前代。
    expect(list.snapshot.identity.policyVersion).toBe(runtime.policyVersion);
    expect(list.snapshot.identity.sourceMapVersion).toBe(runtime.sourceMapVersion);
    expect(list.snapshot.identity.policyVersion).not.toBe("");
    expect(list.snapshot.identity.sourceMapVersion).not.toBe("");

    // ③ 目录能力摘要非空——它摘要的是**这个响应实际展示的能力集**。
    expect(detail.snapshot.identity.capabilityDigest).not.toBe("");

    // ④ 同一次响应的四个字段不混用：清单面与详情面逐个相等。
    expect(detail.snapshot.identity).toEqual(list.snapshot.identity);
  });

  it("RTV-08 — 刷新后快照身份明确更新：配置改了，旧身份不再被复用", async () => {
    const before = await listRowPolicyTables(projectRoot);
    const beforeRaw = await readFile(path.join(projectRoot, "webui", "config", "access.yaml"), "utf8");

    // 改配置：给同一张表再加一个受限角色。
    const changed = ACCESS_YAML.replace(
      "  ledger_budget:",
      `  ledger_ledger_extra:
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
              - { field: region, op: eq, value: North }
      tools: [lucy_query]
  ledger_budget:`
    );
    expect(changed).not.toBe(ACCESS_YAML);
    await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), changed, "utf8");
    await commitCurrentPolicy();

    const after = await listRowPolicyTables(projectRoot);
    const afterRaw = await readFile(path.join(projectRoot, "webui", "config", "access.yaml"), "utf8");

    // ① 刷新后身份明确更新：configVersion 变了，而且就是**新内容**的摘要。
    expect(after.snapshot.identity.configVersion).not.toBe(before.snapshot.identity.configVersion);
    expect(after.snapshot.identity.configVersion).toBe(contentVersionOf(afterRaw));
    expect(before.snapshot.identity.configVersion).toBe(contentVersionOf(beforeRaw));

    // ② 更新后的身份与更新后的内容**成对**：旧身份没有混进新响应。
    expect(after.snapshot.identity.configVersion).not.toBe(contentVersionOf(beforeRaw));

    // ③ 新的角色数也跟着变——身份更新与内容更新是同一次。
    const ledger = after.tables.find((table) => table.sourceName === LEDGER.sourceName);
    expect(ledger?.roleCount).toBe(3);
  });
});

describe("RTV-07 —— 反查视图没有写 API", () => {
  it("RTV-07 — 反查视图的两个端点只有 GET；写方法一律 404", async () => {
    const app = Fastify();
    app.addHook("onRequest", async (request) => {
      request.lucyAdmin = {
        session: null,
        admin: {
          id: "admin_a",
          account_uid: "uid_admin_a",
          display_name: "Admin A",
          role: "owner",
          enabled: true,
          created_at: "2026-01-01T00:00:00.000Z"
        },
        stateUnavailable: false,
        authMode: "required"
      };
    });
    registerRowPolicyTemplateRoutes(app);
    await app.ready();

    // ① 只读端点读得到东西。
    const listResponse = await app.inject({ method: "GET", url: "/api/admin/row-policy/views/tables" });
    expect(listResponse.statusCode).toBe(200);
    const detailResponse = await app.inject({
      method: "GET",
      url: "/api/admin/row-policy/views/table?connectionId=warehouse&schema=fin&sourceName=fin_ledger"
    });
    expect(detailResponse.statusCode).toBe(200);

    // ② 写方法在反查视图的端点上**根本没有路由**——不是「拒绝」，是「不存在」。
    for (const url of [
      "/api/admin/row-policy/views/tables",
      "/api/admin/row-policy/views/table?connectionId=warehouse&schema=fin&sourceName=fin_ledger"
    ]) {
      for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
        const response = await app.inject({ method, url, payload: { row_policy: { predicates: [] } } });
        expect(response.statusCode).toBe(404);
      }
    }

    // ③ 模板管理的写路由**不在**反查视图的路径下——两条路是分开的。
    expect(app.hasRoute({ method: "POST", url: "/api/admin/row-policy/templates" })).toBe(true);
    expect(app.hasRoute({ method: "POST", url: "/api/admin/row-policy/views/tables" })).toBe(false);
    expect(app.hasRoute({ method: "PATCH", url: "/api/admin/row-policy/views/table" })).toBe(false);
    expect(app.hasRoute({ method: "DELETE", url: "/api/admin/row-policy/views/tables" })).toBe(false);

    await app.close();
  });
});
