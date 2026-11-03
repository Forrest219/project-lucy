import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Lucy v0.25 P1 — L25-14 R3: 按表反查（行权限视图）.
 *
 * Authority: docs/specs/lucy-20261025-v0p25-row-policy-templates-and-view-spec.md
 *   §3.3, §5.3, §6.2; RTV-01 … RTV-08; P1-D5 / P1-D6 / P1-D7.
 *
 * What is asserted here is BEHAVIOUR:
 *  - two restricted Roles never become 「行权限：全部行」, and only a real `all`
 *    branch does;
 *  - 「无授权」, 「不可满足」, 「编译失败」 and 「空筛选」are four DIFFERENT
 *    states, never one shared empty state;
 *  - a partial failure is `partial` and names the failed set; a total failure
 *    is `unavailable` and never shows a zero grant;
 *  - the same-named table of another connection / Schema never merges.
 */

vi.mock("../admin/audit.js", () => ({
  getAuditDb: vi.fn(() => ({
    prepare: vi.fn(() => ({ get: vi.fn(() => undefined), all: vi.fn(() => []), run: vi.fn() })),
    exec: vi.fn(),
    pragma: vi.fn()
  })),
  recordConfigChange: vi.fn(async () => 1),
  updateConfigChangeStatus: vi.fn(async () => {}),
  registerAgentAuditRoutes: vi.fn(),
  registerAuditRoutes: vi.fn()
}));

const KTX_YAML = `connections:
  warehouse:
    driver: mysql
    enabled_tables:
      - fin.fin_ledger
  warehouse_b:
    driver: mysql
    enabled_tables:
      - finb.fin_ledger
`;

function schemaYaml(schema: string, table: string): string {
  return `tables:
  ${table}:
    table: ${schema}.${table}
    columns:
      - name: region
      - name: status
`;
}

function overlayYaml(): string {
  return `columns:
  - name: region
  - name: status
measures:
  - name: total_sales
`;
}

const TOOLS = `      tools:
        - lucy_query`;

function scopedRole(roleId: string, value: string): string {
  return `  ${roleId}:
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
              - field: region
                op: eq
                value: ${value}
${TOOLS}`;
}

function allRowsRole(roleId: string): string {
  return `  ${roleId}:
    permission_model_version: 2
    allow:
      connections: [warehouse]
      tableSelectors:
        - connection: warehouse
          schema: fin
          names: [fin_ledger]
          row_access: all
${TOOLS}`;
}

function brokenRole(roleId: string): string {
  return `  ${roleId}:
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
              - field: region
                op: like
                value: ${roleId}
${TOOLS}`;
}

function otherConnectionRole(roleId: string): string {
  return `  ${roleId}:
    permission_model_version: 2
    allow:
      connections: [warehouse_b]
      tableSelectors:
        - connection: warehouse_b
          schema: finb
          names: [fin_ledger]
          row_access: scoped
          row_policy:
            predicates:
              - field: region
                op: eq
                value: East
${TOOLS}`;
}

function accessYaml(roles: string, users: string): string {
  return `roles:
${roles}users:
${users}defaults:
  deny_tools: []
`;
}

function agent(id: string, roleIds: string[], constraints?: string): string {
  return `  - id: ${id}
    name: ${id}
    roles: [${roleIds.join(", ")}]
    enabled: true
${constraints ? `    constraints:\n${constraints}` : ""}    tokens: []
`;
}

const UNSATISFIABLE_CONSTRAINTS = `      sources:
        - connection: warehouse
          schema: fin
          names: [fin_ledger]
          predicates:
            - field: region
              op: eq
              value: West
`;

let projectRoot: string;
let previousRoot: string | undefined;
let previousContentRoot: string | undefined;

async function makeProject(accessYamlText: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lucy-p1-row-policy-views-"));
  await mkdir(path.join(root, "webui", "config"), { recursive: true });
  await mkdir(path.join(root, "semantic-layer", "warehouse", "_schema"), { recursive: true });
  await mkdir(path.join(root, "semantic-layer", "warehouse_b", "_schema"), { recursive: true });
  await writeFile(path.join(root, "ktx.yaml"), KTX_YAML, "utf8");
  await writeFile(path.join(root, "webui", "config", "access.yaml"), accessYamlText, "utf8");
  await writeFile(path.join(root, "semantic-layer", "warehouse", "_schema", "fin.yaml"), schemaYaml("fin", "fin_ledger"), "utf8");
  await writeFile(path.join(root, "semantic-layer", "warehouse", "fin_ledger.yaml"), overlayYaml(), "utf8");
  await writeFile(path.join(root, "semantic-layer", "warehouse_b", "_schema", "finb.yaml"), schemaYaml("finb", "fin_ledger"), "utf8");
  await writeFile(path.join(root, "semantic-layer", "warehouse_b", "fin_ledger.yaml"), overlayYaml(), "utf8");
  return root;
}

async function loadViews() {
  vi.resetModules();
  const rowPolicy = await import("../proxy/row-policy");
  rowPolicy.resetRowPolicyCatalogCacheForTests();
  const acl = await import("../proxy/acl");
  // The snapshot identity is only trustworthy when the runtime has committed a
  // policy; without one the shared base reports `unavailable`.
  await acl.commitEffectivePolicy();
  const views = await import("../admin/row-policy-views");
  return views;
}

function buildApp() {
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
  return app;
}

const TABLE = { connectionId: "warehouse", schema: "fin", sourceName: "fin_ledger" };

beforeEach(() => {
  previousRoot = process.env.KTX_PROJECT_ROOT;
  previousContentRoot = process.env.LUCY_CONTENT_ROOT;
  process.env.LUCY_CONTENT_ROOT = ".";
});

afterEach(async () => {
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  if (previousContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = previousContentRoot;
  if (projectRoot) await rm(projectRoot, { recursive: true, force: true });
});

describe("RTV-01 / RTV-02 — the union keeps its shape", () => {
  it("two restricted Roles stay two OR branches and never become 全部行", async () => {
    projectRoot = await makeProject(
      accessYaml(
        `${scopedRole("east_role", "East")}\n${scopedRole("west_role", "West")}\n`,
        agent("agent_a", ["east_role", "west_role"])
      )
    );
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const { readRowPolicyTableView } = await loadViews();
    const view = await readRowPolicyTableView(projectRoot, TABLE);
    expect(view.status).toBe("ok");
    expect(view.effectiveRowGrant?.kind).toBe("scoped");
    if (view.effectiveRowGrant?.kind !== "scoped") return;
    expect(view.effectiveRowGrant.orArms).toHaveLength(2);
    expect(view.roles.filter((branch) => branch.rowAccess === "scoped")).toHaveLength(2);
  });

  it("only a real `all` branch makes the union 全部行", async () => {
    projectRoot = await makeProject(
      accessYaml(
        `${scopedRole("east_role", "East")}\n${allRowsRole("all_role")}\n`,
        agent("agent_a", ["east_role", "all_role"])
      )
    );
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const { readRowPolicyTableView } = await loadViews();
    const view = await readRowPolicyTableView(projectRoot, TABLE);
    expect(view.effectiveRowGrant?.kind).toBe("all");
  });
});

describe("RTV-03 — the four states never share one empty state", () => {
  it("无授权: no Role grants the table", async () => {
    projectRoot = await makeProject(
      accessYaml(`${otherConnectionRole("other_role")}\n`, agent("agent_a", ["other_role"]))
    );
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const { readRowPolicyTableView } = await loadViews();
    const view = await readRowPolicyTableView(projectRoot, TABLE);
    expect(view.status).toBe("no_applicable_grant");
    expect(view.effectiveRowGrant).toBeNull();
    // 「没有授权」must never be dressed up as 「全部行」.
    expect(view.effectiveRowGrant?.kind).not.toBe("all");
  });

  it("不可满足: the Agent's own row limits prune every branch", async () => {
    projectRoot = await makeProject(
      accessYaml(
        `${scopedRole("east_role", "East")}\n`,
        agent("agent_a", ["east_role"], UNSATISFIABLE_CONSTRAINTS)
      )
    );
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const { readRowPolicyTableView } = await loadViews();
    const view = await readRowPolicyTableView(projectRoot, TABLE);
    expect(view.status).toBe("final_rows_unsatisfiable");
    expect(view.reason).toContain("final_rows_unsatisfiable");
    // The diagnosis does not become a third RowGrant.
    expect(view.effectiveRowGrant?.kind).toBe("scoped");
    expect(view.agents[0]?.finalRows).toBeNull();
  });

  it("编译失败: the Role that covers the table cannot be compiled", async () => {
    projectRoot = await makeProject(
      accessYaml(`${brokenRole("broken_role")}\n`, agent("agent_a", ["broken_role"]))
    );
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const { readRowPolicyTableView } = await loadViews();
    const view = await readRowPolicyTableView(projectRoot, TABLE);
    expect(view.status).toBe("compile_failed");
    expect(view.state).toBe("unavailable");
    expect(view.failures.length).toBeGreaterThan(0);
    // A total failure must not show a zero grant.
    expect(view.effectiveRowGrant).toBeNull();
  });

  it("空筛选: a filter that matches no table", async () => {
    projectRoot = await makeProject(
      accessYaml(`${scopedRole("east_role", "East")}\n`, agent("agent_a", ["east_role"]))
    );
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const { listRowPolicyTables } = await loadViews();
    const list = await listRowPolicyTables(projectRoot, { sourceName: "no_such_table" });
    expect(list.status).toBe("no_match");
    expect(list.tables).toHaveLength(0);
  });
});

describe("RTV-05 — a partial failure names the failed set", () => {
  it("one broken Role plus one healthy Role is `partial`, not `unavailable`", async () => {
    projectRoot = await makeProject(
      accessYaml(
        `${brokenRole("broken_role")}\n${scopedRole("east_role", "East")}\n`,
        agent("agent_a", ["east_role"])
      )
    );
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const { readRowPolicyTableView } = await loadViews();
    const view = await readRowPolicyTableView(projectRoot, TABLE);
    expect(view.status).toBe("ok");
    expect(view.state).toBe("partial");
    expect(view.failures.map((failure) => failure.subjectId)).toContain("broken_role");
    expect(view.effectiveRowGrant?.kind).toBe("scoped");
  });
});

describe("RTV-04 — the full table identity is kept", () => {
  it("the same-named table of another connection never merges", async () => {
    projectRoot = await makeProject(
      accessYaml(
        `${scopedRole("east_role", "East")}\n${otherConnectionRole("other_role")}\n`,
        agent("agent_a", ["east_role", "other_role"])
      )
    );
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const { listRowPolicyTables } = await loadViews();
    const list = await listRowPolicyTables(projectRoot);
    expect(list.tables).toHaveLength(2);
    const identities = list.tables.map((table) => `${table.connectionId}/${table.schema}/${table.sourceName}`).sort();
    expect(identities).toEqual(["warehouse/fin/fin_ledger", "warehouse_b/finb/fin_ledger"]);
  });

  it("the view is read-only: it never changes the configuration", async () => {
    projectRoot = await makeProject(
      accessYaml(`${scopedRole("east_role", "East")}\n`, agent("agent_a", ["east_role"]))
    );
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const accessPath = path.join(projectRoot, "webui", "config", "access.yaml");
    const before = await readFile(accessPath, "utf8");
    const { registerRowPolicyTemplateRoutes } = await import("../admin/routes/row-policy");
    const app = buildApp();
    registerRowPolicyTemplateRoutes(app);
    await app.ready();

    const res = await app.inject({
      method: "GET",
      url: "/api/admin/row-policy/views/table?connectionId=warehouse&schema=fin&sourceName=fin_ledger"
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("ok");
    const after = await readFile(accessPath, "utf8");
    expect(after).toBe(before);
    await app.close();
  });
});

/**
 * 呈现修订 D8 / SC-08：清单的「有效行授予」列由并集结果派生。
 *
 * 四态是四句话：「行权限：全部行」「受限行授予」「无授权」「编译失败」。
 * 「无授权」与「编译失败」不得合成同一个 null——那正是清单再次出现「—」的原因。
 */
describe("SC-08 — 清单授予列的 grantStatus", () => {
  it("四态从并集结果派生，不逐表读目录", async () => {
    const { rowPolicyGrantStatusOf } = await import("../admin/row-policy-views");
    expect(
      rowPolicyGrantStatusOf({ ok: true, preview: { effectiveRowGrant: { kind: "all" } } })
    ).toEqual({ grantStatus: "all" });
    expect(
      rowPolicyGrantStatusOf({
        ok: true,
        preview: {
          effectiveRowGrant: {
            kind: "scoped",
            digest: "d1",
            predicates: [],
            orArms: [[]]
          }
        }
      })
    ).toEqual({ grantStatus: "scoped" });
    expect(rowPolicyGrantStatusOf({ ok: false, reason: "row_policy_no_applicable_grant" })).toEqual({
      grantStatus: "no_applicable_grant",
      grantStatusReason: "row_policy_no_applicable_grant"
    });
    expect(rowPolicyGrantStatusOf({ ok: false, reason: "role_resolution_failed:broken_role" })).toEqual({
      grantStatus: "compile_failed",
      grantStatusReason: "role_resolution_failed:broken_role"
    });
  });

  it("受限并集是 scoped，真实 all 并集是 all", async () => {
    projectRoot = await makeProject(
      accessYaml(`${scopedRole("east_role", "East")}\n`, agent("agent_a", ["east_role"]))
    );
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const { listRowPolicyTables } = await loadViews();
    const list = await listRowPolicyTables(projectRoot);
    expect(list.tables).toHaveLength(1);
    expect(list.tables[0].grantStatus).toBe("scoped");
    expect(list.tables[0].grantStatusReason).toBeUndefined();
    expect(list.tables[0].effectiveRowGrant?.kind).toBe("scoped");
  });

  it("真实 all 并集才是 all，受限分支不冒充", async () => {
    projectRoot = await makeProject(
      accessYaml(
        `${scopedRole("east_role", "East")}\n${allRowsRole("all_role")}\n`,
        agent("agent_a", ["east_role", "all_role"])
      )
    );
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const { listRowPolicyTables } = await loadViews();
    const list = await listRowPolicyTables(projectRoot);
    expect(list.tables[0].grantStatus).toBe("all");
    expect(list.tables[0].effectiveRowGrant?.kind).toBe("all");
  });
});

describe("RTV-08 — one response never mixes two generations", () => {
  it("the response publishes the four snapshot identity fields", async () => {
    projectRoot = await makeProject(
      accessYaml(`${scopedRole("east_role", "East")}\n`, agent("agent_a", ["east_role"]))
    );
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const { readRowPolicyTableView } = await loadViews();
    const view = await readRowPolicyTableView(projectRoot, TABLE);
    expect(typeof view.snapshot.identity.configVersion).toBe("string");
    expect(typeof view.snapshot.identity.policyVersion).toBe("string");
    expect(typeof view.snapshot.identity.sourceMapVersion).toBe("string");
    expect(typeof view.snapshot.identity.capabilityDigest).toBe("string");
    expect(view.snapshot.identity.configVersion.length).toBeGreaterThan(0);
  });
});

/**
 * Two connections whose (connection, schema, sourceName) triples CONCATENATE to
 * the same string:
 *   "wh" + "c"  + "orders" === "w" + "hc" + "orders" === "whcorders".
 *
 * The hand-rolled key had no separator, so these two DIFFERENT tables collapsed
 * into one entry: their Role sets unioned and their grants merged — an `all`
 * grant would absorb a `scoped` one.
 */
const COLLISION_KTX_YAML = `connections:
  wh:
    driver: mysql
    enabled_tables:
      - c.orders
  w:
    driver: mysql
    enabled_tables:
      - hc.orders
`;

function collisionRole(roleId: string, connection: string, schema: string): string {
  return `  ${roleId}:
    permission_model_version: 2
    allow:
      connections: [${connection}]
      tableSelectors:
        - connection: ${connection}
          schema: ${schema}
          names: [orders]
          row_access: scoped
          row_policy:
            predicates:
              - field: region
                op: eq
                value: ${roleId}
${TOOLS}`;
}

async function makeCollisionProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lucy-p1-key-collision-"));
  await mkdir(path.join(root, "webui", "config"), { recursive: true });
  await mkdir(path.join(root, "semantic-layer", "wh", "_schema"), { recursive: true });
  await mkdir(path.join(root, "semantic-layer", "w", "_schema"), { recursive: true });
  await writeFile(path.join(root, "ktx.yaml"), COLLISION_KTX_YAML, "utf8");
  await writeFile(
    path.join(root, "webui", "config", "access.yaml"),
    accessYaml(
      `${collisionRole("east_role", "wh", "c")}\n${collisionRole("west_role", "w", "hc")}\n`,
      agent("agent_a", ["east_role", "west_role"])
    ),
    "utf8"
  );
  await writeFile(path.join(root, "semantic-layer", "wh", "_schema", "c.yaml"), schemaYaml("c", "orders"), "utf8");
  await writeFile(path.join(root, "semantic-layer", "wh", "orders.yaml"), overlayYaml(), "utf8");
  await writeFile(path.join(root, "semantic-layer", "w", "_schema", "hc.yaml"), schemaYaml("hc", "orders"), "utf8");
  await writeFile(path.join(root, "semantic-layer", "w", "orders.yaml"), overlayYaml(), "utf8");
  return root;
}

describe("W8 回归 — RTV-04 表身份键、RTV-05 降级口径", () => {
  it("RTV-04 — two tables whose concatenated keys collide stay two tables", async () => {
    projectRoot = await makeCollisionProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const { listRowPolicyTables } = await loadViews();
    const list = await listRowPolicyTables(projectRoot);
    // 两张不同的表：键相同不代表表相同（P1-D7 同源不等于同数）。
    expect(list.tables).toHaveLength(2);
    const identities = list.tables
      .map((table) => `${table.connectionId}/${table.schema}/${table.sourceName}`)
      .sort();
    expect(identities).toEqual(["w/hc/orders", "wh/c/orders"]);
    // 合并会让 roleCount 变成 2；正确分表时每张表只由一个 Role 授予。
    expect(list.tables.map((table) => table.roleCount).sort()).toEqual([1, 1]);
    for (const table of list.tables) {
      expect(table.effectiveRowGrant?.kind).toBe("scoped");
    }
  });

  it("RTV-05 — a total compile failure is `unavailable`, never 「0 张表」", async () => {
    projectRoot = await makeProject(
      accessYaml(`${brokenRole("broken_role")}\n`, agent("agent_a", ["broken_role"]))
    );
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const { listRowPolicyTables } = await loadViews();
    const list = await listRowPolicyTables(projectRoot);
    // 全部 Role 编译失败 ⇒ unavailable。「0 张表」不能冒充「读不到」。
    expect(list.state).toBe("unavailable");
    expect(list.status).toBe("unavailable");
    expect(list.tables).toHaveLength(0);
    // 失败集合必须可见。
    expect(list.failures.map((failure) => failure.subjectId)).toContain("broken_role");
  });

  it("RTV-04 — another Schema's grant is never shown for the requested table", async () => {
    projectRoot = await makeProject(
      accessYaml(`${scopedRole("east_role", "East")}\n`, agent("agent_a", ["east_role"]))
    );
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const { readRowPolicyTableView } = await loadViews();
    // 同一连接、同名表、不同 Schema —— 不得显示另一张表的行授予。
    const view = await readRowPolicyTableView(projectRoot, {
      connectionId: "warehouse",
      schema: "other_schema",
      sourceName: "fin_ledger"
    });
    expect(view.status).toBe("no_applicable_grant");
    expect(view.effectiveRowGrant).toBeNull();
    expect(view.roles.every((branch) => branch.rowGrant === null)).toBe(true);
  });
});
