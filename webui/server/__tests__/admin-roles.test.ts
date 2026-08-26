import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../index";
import { LUCY_R1_EXACT_TOOLS, ROLE_TEMPLATES } from "../admin/role-templates";

vi.mock("../admin/audit.js", () => ({
  getAuditDb: vi.fn(() => ({
    prepare: vi.fn(() => ({
      get: vi.fn(() => undefined),
      all: vi.fn(() => []),
      run: vi.fn(() => ({ lastInsertRowid: 1 }))
    })),
    exec: vi.fn(),
    pragma: vi.fn(),
    transaction: vi.fn((fn: (...args: unknown[]) => unknown) => fn)
  })),
  recordConfigChange: vi.fn(async () => 1),
  updateConfigChangeStatus: vi.fn(async () => undefined),
  registerAuditRoutes: vi.fn()
}));

const ALL_TEMPLATE_SOURCES = [
  "kx_dim_company",
  "kx_dim_financial_item",
  "kx_fact_financial_amount",
  "kx_vw_balance_sheet_detail",
  "kx_vw_cash_flow_statement_detail",
  "kx_vw_income_statement_detail",
  "superstore_orders",
  "superstore_people",
  "superstore_returns"
];
const POC_R1_TEMPLATE_SOURCES = [
  "poc_metric_catalog",
  "poc_app_active_daily",
  "poc_ad_revenue_daily",
  "poc_ad_revenue_by_type_daily",
  "poc_ceo_metric_snapshot"
];

const EMPTY_ACCESS_YAML = `roles: {}
users: []
defaults:
  deny_tools:
    - sql_execution
    - sql_dialect_notes
`;

const ANALYST_ACCESS_YAML = `roles:
  analyst:
    description: Analyst role
    allow:
      connections:
        - mysql-aliyun
      tableSelectors:
        - connection: mysql-aliyun
          schema: dataforai
          names:
            - superstore_orders
      tools:
        - lucy_query
        - wiki_search
users:
  - id: zhangsan
    name: 张三
    enabled: true
    role: analyst
    tokens: []
defaults:
  deny_tools:
    - sql_execution
    - sql_dialect_notes
`;

const IN_USE_ACCESS_YAML = `roles:
  analyst:
    description: Analyst role
    allow:
      connections:
        - mysql-aliyun
      tableSelectors:
        - connection: mysql-aliyun
          schema: dataforai
          names:
            - superstore_orders
      tools:
        - lucy_query
users:
  - id: zhangsan
    name: 张三
    enabled: true
    role: analyst
    tokens: []
  - id: lisi
    name: 李四
    enabled: true
    role: analyst
    tokens: []
defaults:
  deny_tools:
    - sql_execution
    - sql_dialect_notes
`;

const CUSTOM_KX_ACCESS_YAML = `roles:
  kx_readonly:
    description: Custom yaml KX role
    allow:
      connections:
        - mysql-aliyun
      tableSelectors:
        - connection: mysql-aliyun
          schema: dataforai
          names:
            - superstore_orders
      tools:
        - lucy_query
users: []
defaults:
  deny_tools:
    - sql_execution
    - sql_dialect_notes
`;

let projectRoot: string;
let prevRoot: string | undefined;

async function makeProject(yamlContent = EMPTY_ACCESS_YAML) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ktx-admin-roles-"));
  await mkdir(path.join(root, "webui", "config"), { recursive: true });
  await mkdir(path.join(root, "semantic-layer", "mysql-aliyun", "_schema"), { recursive: true });
  await mkdir(path.join(root, "semantic-layer", "poc-mysql-aliyun", "_schema"), { recursive: true });
  await mkdir(path.join(root, ".ktx-ui"), { recursive: true });
  await writeFile(path.join(root, "ktx.yaml"), "connections: {}\n", "utf8");
  await writeFile(path.join(root, "webui", "config", "access.yaml"), yamlContent, "utf8");
  await writeFile(
    path.join(root, "semantic-layer", "mysql-aliyun", "_schema", "dataforai.yaml"),
    `tables:
${ALL_TEMPLATE_SOURCES.map((source) => `  ${source}:\n    table: dataforai.${source}`).join("\n")}
`,
    "utf8"
  );
  await writeFile(
    path.join(root, "semantic-layer", "poc-mysql-aliyun", "_schema", "data_agent_poc.yaml"),
    `tables:
${POC_R1_TEMPLATE_SOURCES.map((source) => `  ${source}:\n    table: data_agent_poc.${source}`).join("\n")}
`,
    "utf8"
  );
  return root;
}

beforeEach(async () => {
  projectRoot = await makeProject();
  prevRoot = process.env.KTX_PROJECT_ROOT;
  process.env.KTX_PROJECT_ROOT = projectRoot;
});

afterEach(async () => {
  if (prevRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = prevRoot;
  await rm(projectRoot, { recursive: true, force: true });
});

describe("GET /api/admin/roles", () => {
  it("returns the six role templates when yaml has no roles", async () => {
    const app = buildServer();
    await app.ready();
    const res = await request(app.server).get("/api/admin/roles").expect(200);

    expect(res.body.data.roles).toHaveLength(6);
    expect(res.body.data.roles.map((role: { id: string }) => role.id).sort()).toEqual([
      "dev_superstore",
      "guard_test",
      "kx_readonly",
      "lucy_r1_exact_readonly",
      "superstore_readonly",
      "wiki_only"
    ]);
    expect(res.body.data.roles.find((role: { id: string }) => role.id === "lucy_r1_exact_readonly")).toMatchObject({
      source: "template",
      invalid: false,
      sourceCount: 5
    });
    expect(ROLE_TEMPLATES.lucy_r1_exact_readonly.allow?.tools).toEqual(LUCY_R1_EXACT_TOOLS);
    expect(res.body.data.roles.every((role: { source: string; invalid: boolean }) => role.source === "template" && !role.invalid)).toBe(true);
    await app.close();
  });

  it("keeps yaml roles authoritative when a template id collides", async () => {
    await rm(projectRoot, { recursive: true, force: true });
    projectRoot = await makeProject(CUSTOM_KX_ACCESS_YAML);
    process.env.KTX_PROJECT_ROOT = projectRoot;

    const app = buildServer();
    await app.ready();
    const res = await request(app.server).get("/api/admin/roles").expect(200);

    expect(res.body.data.roles).toHaveLength(6);
    expect(res.body.data.roles.find((role: { id: string }) => role.id === "kx_readonly")).toMatchObject({
      source: "yaml",
      description: "Custom yaml KX role",
      sourceCount: 1
    });
    await app.close();
  });

  it("includes usageCount and users list for yaml roles", async () => {
    await rm(projectRoot, { recursive: true, force: true });
    projectRoot = await makeProject(IN_USE_ACCESS_YAML);
    process.env.KTX_PROJECT_ROOT = projectRoot;

    const app = buildServer();
    await app.ready();
    const res = await request(app.server).get("/api/admin/roles").expect(200);
    const analyst = res.body.data.roles.find((role: { id: string }) => role.id === "analyst");
    expect(analyst).toMatchObject({
      source: "yaml",
      usageCount: 2
    });
    expect(analyst.users).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "zhangsan", name: "张三", enabled: true, tokenCount: 0 }),
        expect.objectContaining({ id: "lisi", name: "李四", enabled: true, tokenCount: 0 })
      ])
    );
    await app.close();
  });

  it("attaches configUpdatedAt from access.yaml mtime only on yaml roles", async () => {
    await rm(projectRoot, { recursive: true, force: true });
    projectRoot = await makeProject(IN_USE_ACCESS_YAML);
    process.env.KTX_PROJECT_ROOT = projectRoot;

    const app = buildServer();
    await app.ready();
    const res = await request(app.server).get("/api/admin/roles").expect(200);
    const roles = res.body.data.roles as Array<{
      id: string;
      source: string;
      configUpdatedAt: string | null;
    }>;
    const yamlRoles = roles.filter((role) => role.source === "yaml");
    const templateRoles = roles.filter((role) => role.source === "template");
    expect(yamlRoles.length).toBeGreaterThan(0);
    expect(templateRoles.length).toBeGreaterThan(0);
    for (const role of yamlRoles) {
      expect(typeof role.configUpdatedAt).toBe("string");
      expect(role.configUpdatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
    const shared = yamlRoles[0].configUpdatedAt;
    expect(yamlRoles.every((role) => role.configUpdatedAt === shared)).toBe(true);
    expect(templateRoles.every((role) => role.configUpdatedAt == null)).toBe(true);
    await app.close();
  });

  it("always returns sourceNames array on list summaries", async () => {
    const app = buildServer();
    await app.ready();
    const res = await request(app.server).get("/api/admin/roles").expect(200);
    const roles = res.body.data.roles as Array<{ sourceNames: unknown }>;
    expect(roles.length).toBeGreaterThan(0);
    for (const role of roles) {
      expect(Array.isArray(role.sourceNames)).toBe(true);
    }
    await app.close();
  });

  it("hides templates when includeTemplates=false", async () => {
    const app = buildServer();
    await app.ready();
    const res = await request(app.server).get("/api/admin/roles?includeTemplates=false").expect(200);
    expect(res.body.data.roles).toEqual([]);
    await app.close();
  });
});

describe("GET /api/admin/roles/:roleId", () => {
  it("returns yaml role detail with allow body and effective permissions", async () => {
    await rm(projectRoot, { recursive: true, force: true });
    projectRoot = await makeProject(ANALYST_ACCESS_YAML);
    process.env.KTX_PROJECT_ROOT = projectRoot;

    const app = buildServer();
    await app.ready();
    const res = await request(app.server).get("/api/admin/roles/analyst").expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data).toMatchObject({
      id: "analyst",
      source: "yaml",
      description: "Analyst role",
      usageCount: 1
    });
    expect(res.body.data.role.allow.tableSelectors).toEqual([
      { connection: "mysql-aliyun", schema: "dataforai", names: ["superstore_orders"] }
    ]);
    expect(res.body.data.effectivePermissions.sources).toHaveLength(1);
    expect(res.body.data.effectivePermissions.tools).toEqual(expect.arrayContaining(["lucy_query", "wiki_search"]));
    await app.close();
  });

  it("returns template role detail when the id is a built-in template", async () => {
    const app = buildServer();
    await app.ready();
    const res = await request(app.server).get("/api/admin/roles/wiki_only").expect(200);
    expect(res.body.data.source).toBe("template");
    expect(res.body.data.role.allow.tools).toEqual(expect.arrayContaining(["wiki_search", "wiki_read"]));
    expect(res.body.data.usageCount).toBe(0);
    await app.close();
  });

  it("returns 404 ROLE_NOT_FOUND when the role does not exist", async () => {
    const app = buildServer();
    await app.ready();
    const res = await request(app.server).get("/api/admin/roles/does_not_exist").expect(404);
    expect(res.body.error.code).toBe("ROLE_NOT_FOUND");
    await app.close();
  });
});

describe("POST /api/admin/roles/_preview", () => {
  it("returns effective permissions without writing yaml", async () => {
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/admin/roles/_preview")
      .send({
        roleId: "preview_only",
        role: {
          description: "preview only",
          allow: {
            connections: ["mysql-aliyun"],
            tableSelectors: [
              { connection: "mysql-aliyun", schema: "dataforai", names: ["superstore_orders"] }
            ],
            tools: ["lucy_query"]
          }
        }
      })
      .expect(200);
    expect(res.body.data.effectivePermissions.sources).toHaveLength(1);
    expect(res.body.data.effectivePermissions.tools).toContain("lucy_query");
    const yaml = await readFile(path.join(projectRoot, "webui/config/access.yaml"), "utf8");
    expect(yaml).not.toContain("preview_only");
    await app.close();
  });

  it("rejects an invalid role with 400 INVALID_ROLE", async () => {
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/admin/roles/_preview")
      .send({
        roleId: "bad_role",
        role: {
          allow: {
            connections: [],
            tableSelectors: [
              { connection: "mysql-aliyun", schema: "dataforai", names: ["superstore_orders"] }
            ],
            tools: ["lucy_query"]
          }
        }
      })
      .expect(400);
    expect(res.body.error.code).toBe("INVALID_ROLE");
    await app.close();
  });
});

describe("POST /api/admin/roles", () => {
  it("returns diff on dryRun and does not write file", async () => {
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/admin/roles")
      .send({
        dryRun: true,
        roleId: "new_role",
        role: {
          description: "New role",
          allow: {
            connections: ["mysql-aliyun"],
            tableSelectors: [
              { connection: "mysql-aliyun", schema: "dataforai", names: ["superstore_orders"] }
            ],
            tools: ["lucy_query"]
          }
        }
      })
      .expect(200);
    expect(res.body.data.diff).toMatch(/\+.*new_role/);
    expect(res.body.data.proposedYaml).toContain("new_role");
    const yaml = await readFile(path.join(projectRoot, "webui/config/access.yaml"), "utf8");
    expect(yaml).not.toContain("new_role");
    await app.close();
  });

  it("SC-P15-04 / Spec 100 §3.3: Role Admin rejects constraints key", async () => {
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/admin/roles")
      .send({
        dryRun: true,
        roleId: "role_with_constraints",
        role: {
          description: "illegal",
          constraints: { sources: [] },
          allow: {
            connections: ["mysql-aliyun"],
            tableSelectors: [
              { connection: "mysql-aliyun", schema: "dataforai", names: ["superstore_orders"] }
            ],
            tools: ["lucy_query"]
          }
        }
      })
      .expect(400);
    expect(res.body.ok).toBe(false);
    expect(String(res.body.error?.message ?? "")).toMatch(/constraints/);
    await app.close();
  });

  it("writes role on dryRun:false", async () => {
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/admin/roles")
      .send({
        dryRun: false,
        roleId: "new_role",
        role: {
          description: "New role",
          allow: {
            connections: ["mysql-aliyun"],
            tableSelectors: [
              { connection: "mysql-aliyun", schema: "dataforai", names: ["superstore_orders"] }
            ],
            tools: ["lucy_query"]
          }
        }
      })
      .expect(200);
    expect(res.body.data.written).toBe(true);
    expect(res.body.data.role).toMatchObject({
      id: "new_role",
      source: "yaml",
      description: "New role"
    });
    const yaml = await readFile(path.join(projectRoot, "webui/config/access.yaml"), "utf8");
    expect(yaml).toContain("new_role");
    expect(yaml).toContain("lucy_query");
    await app.close();
  });

  it("rejects duplicate role id with 409 ROLE_ID_TAKEN", async () => {
    const app = buildServer();
    await app.ready();
    await request(app.server)
      .post("/api/admin/roles")
      .send({
        dryRun: false,
        roleId: "new_role",
        role: {
          allow: {
            connections: ["mysql-aliyun"],
            tableSelectors: [
              { connection: "mysql-aliyun", schema: "dataforai", names: ["superstore_orders"] }
            ],
            tools: ["lucy_query"]
          }
        }
      })
      .expect(200);
    const dup = await request(app.server)
      .post("/api/admin/roles")
      .send({
        dryRun: false,
        roleId: "new_role",
        role: {
          allow: {
            connections: ["mysql-aliyun"],
            tableSelectors: [
              { connection: "mysql-aliyun", schema: "dataforai", names: ["superstore_orders"] }
            ],
            tools: ["lucy_query"]
          }
        }
      })
      .expect(409);
    expect(dup.body.error.code).toBe("ROLE_ID_TAKEN");
    await app.close();
  });

  it("rejects role id that collides with a built-in template", async () => {
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/admin/roles")
      .send({
        dryRun: false,
        roleId: "wiki_only",
        role: {
          allow: { tools: ["wiki_search"] }
        }
      })
      .expect(409);
    expect(res.body.error.code).toBe("ROLE_ID_TAKEN");
    await app.close();
  });

  it("rejects wildcard tools with 400 INVALID_ROLE", async () => {
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/admin/roles")
      .send({
        dryRun: false,
        roleId: "wildcard_role",
        role: {
          allow: {
            connections: ["mysql-aliyun"],
            tools: ["*"]
          }
        }
      })
      .expect(400);
    expect(res.body.error.code).toBe("INVALID_ROLE");
    await app.close();
  });

  it("rejects table-touching role with empty connections", async () => {
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/admin/roles")
      .send({
        dryRun: false,
        roleId: "no_conn_role",
        role: {
          allow: {
            connections: [],
            tableSelectors: [
              { connection: "mysql-aliyun", schema: "dataforai", names: ["superstore_orders"] }
            ],
            tools: ["lucy_query"]
          }
        }
      })
      .expect(400);
    expect(res.body.error.code).toBe("INVALID_ROLE");
    await app.close();
  });

  it("rejects role with empty selector", async () => {
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/admin/roles")
      .send({
        dryRun: false,
        roleId: "no_source_role",
        role: {
          allow: {
            connections: ["mysql-aliyun"],
            tableSelectors: [
              { connection: "mysql-aliyun", schema: "dataforai", names: [] }
            ],
            tools: ["lucy_query"]
          }
        }
      })
      .expect(400);
    expect(res.body.error.code).toBe("INVALID_ROLE");
    await app.close();
  });

  it("rejects role whose selectors do not resolve to any source", async () => {
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/admin/roles")
      .send({
        dryRun: false,
        roleId: "ghost_role",
        role: {
          allow: {
            connections: ["mysql-aliyun"],
            tableSelectors: [
              { connection: "mysql-aliyun", schema: "dataforai", names: ["ghost_table"] }
            ],
            tools: ["lucy_query"]
          }
        }
      })
      .expect(400);
    expect(res.body.error.code).toBe("INVALID_ROLE");
    await app.close();
  });

  it("rejects bad role id with 400", async () => {
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/admin/roles")
      .send({
        dryRun: false,
        roleId: "bad id with spaces",
        role: {
          allow: { tools: ["wiki_search"] }
        }
      })
      .expect(400);
    expect(["BAD_REQUEST", "INVALID_ROLE_ID"]).toContain(res.body.error.code);
    await app.close();
  });
});

describe("PATCH /api/admin/roles/:roleId", () => {
  it("updates description and allow on dryRun:false", async () => {
    const app = buildServer();
    await app.ready();
    const created = await request(app.server)
      .post("/api/admin/roles")
      .send({
        dryRun: false,
        roleId: "patch_target",
        role: {
          description: "Original",
          allow: {
            connections: ["mysql-aliyun"],
            tableSelectors: [
              { connection: "mysql-aliyun", schema: "dataforai", names: ["superstore_orders"] }
            ],
            tools: ["lucy_query"]
          }
        }
      })
      .expect(200);
    const version = created.body.data.version;
    const res = await request(app.server)
      .patch("/api/admin/roles/patch_target")
      .send({
        dryRun: false,
        version,
        patch: {
          description: "Patched",
          allow: {
            connections: ["mysql-aliyun"],
            tableSelectors: [
              { connection: "mysql-aliyun", schema: "dataforai", names: ["superstore_returns"] }
            ],
            tools: ["lucy_query"]
          }
        }
      })
      .expect(200);
    expect(res.body.data.written).toBe(true);
    const yaml = await readFile(path.join(projectRoot, "webui/config/access.yaml"), "utf8");
    expect(yaml).toContain("Patched");
    expect(yaml).toContain("superstore_returns");
    expect(yaml).not.toContain("superstore_orders");
    await app.close();
  });

  it("returns 400 TEMPLATE_ROLE_READONLY when patching a template", async () => {
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .patch("/api/admin/roles/wiki_only")
      .send({ dryRun: false, patch: { description: "no" } })
      .expect(400);
    expect(res.body.error.code).toBe("TEMPLATE_ROLE_READONLY");
    await app.close();
  });

  it("returns 409 VERSION_CONFLICT on stale version", async () => {
    const app = buildServer();
    await app.ready();
    await request(app.server)
      .post("/api/admin/roles")
      .send({
        dryRun: false,
        roleId: "stale_role",
        role: {
          allow: {
            connections: ["mysql-aliyun"],
            tableSelectors: [
              { connection: "mysql-aliyun", schema: "dataforai", names: ["superstore_orders"] }
            ],
            tools: ["lucy_query"]
          }
        }
      })
      .expect(200);
    const res = await request(app.server)
      .patch("/api/admin/roles/stale_role")
      .send({ dryRun: false, version: "0000000000000-stale", patch: { description: "x" } })
      .expect(409);
    expect(res.body.error.code).toBe("VERSION_CONFLICT");
    await app.close();
  });

  it("allows editing a yaml role that shadows a built-in template id", async () => {
    await rm(projectRoot, { recursive: true, force: true });
    projectRoot = await makeProject(CUSTOM_KX_ACCESS_YAML);
    process.env.KTX_PROJECT_ROOT = projectRoot;

    const app = buildServer();
    await app.ready();
    const detail = await request(app.server).get("/api/admin/roles/kx_readonly").expect(200);
    expect(detail.body.data.source).toBe("yaml");

    const res = await request(app.server)
      .patch("/api/admin/roles/kx_readonly")
      .send({
        dryRun: false,
        version: detail.body.data.version,
        patch: {
          description: "Patched yaml override",
          allow: {
            connections: ["mysql-aliyun"],
            tableSelectors: [
              { connection: "mysql-aliyun", schema: "dataforai", names: ["superstore_returns"] }
            ],
            tools: ["lucy_query"]
          }
        }
      })
      .expect(200);
    expect(res.body.data.written).toBe(true);
    const yaml = await readFile(path.join(projectRoot, "webui/config/access.yaml"), "utf8");
    expect(yaml).toContain("Patched yaml override");
    expect(yaml).toContain("superstore_returns");
    await app.close();
  });
});

describe("DELETE /api/admin/roles/:roleId", () => {
  it("blocks delete of in-use role with 409 ROLE_IN_USE", async () => {
    await rm(projectRoot, { recursive: true, force: true });
    projectRoot = await makeProject(IN_USE_ACCESS_YAML);
    process.env.KTX_PROJECT_ROOT = projectRoot;

    const app = buildServer();
    await app.ready();
    const res = await request(app.server).delete("/api/admin/roles/analyst").expect(409);
    expect(res.body.error.code).toBe("ROLE_IN_USE");
    expect(res.body.error.detail).toBeDefined();
    expect(res.body.error.detail.users).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "zhangsan" }),
        expect.objectContaining({ id: "lisi" })
      ])
    );
    const yaml = await readFile(path.join(projectRoot, "webui/config/access.yaml"), "utf8");
    expect(yaml).toContain("analyst");
    await app.close();
  });

  it("removes an unused yaml role", async () => {
    const app = buildServer();
    await app.ready();
    await request(app.server)
      .post("/api/admin/roles")
      .send({
        dryRun: false,
        roleId: "delete_me",
        role: {
          allow: {
            connections: ["mysql-aliyun"],
            tableSelectors: [
              { connection: "mysql-aliyun", schema: "dataforai", names: ["superstore_orders"] }
            ],
            tools: ["lucy_query"]
          }
        }
      })
      .expect(200);
    const res = await request(app.server)
      .delete("/api/admin/roles/delete_me")
      .send({ dryRun: false })
      .expect(200);
    expect(res.body.data.written).toBe(true);
    const yaml = await readFile(path.join(projectRoot, "webui/config/access.yaml"), "utf8");
    expect(yaml).not.toContain("delete_me");
    await app.close();
  });

  it("returns 400 TEMPLATE_ROLE_READONLY when deleting a template", async () => {
    const app = buildServer();
    await app.ready();
    const res = await request(app.server).delete("/api/admin/roles/wiki_only").expect(400);
    expect(res.body.error.code).toBe("TEMPLATE_ROLE_READONLY");
    await app.close();
  });
});

describe("POST /api/admin/roles/:roleId/copy", () => {
  it("expands a template into a normal yaml role without template pointer fields", async () => {
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/admin/roles/wiki_only/copy")
      .send({ dryRun: false, newRoleId: "wiki_clone" })
      .expect(200);
    expect(res.body.data.written).toBe(true);
    expect(res.body.data.role.id).toBe("wiki_clone");
    expect(res.body.data.role.source).toBe("yaml");
    const yaml = await readFile(path.join(projectRoot, "webui/config/access.yaml"), "utf8");
    expect(yaml).toContain("wiki_clone:");
    expect(yaml).toContain("wiki_search");
    expect(yaml).not.toMatch(/role-template|templateId|templateRef|_template/);
    await app.close();
  });

  it("rejects copy onto an existing role id", async () => {
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/admin/roles/wiki_only/copy")
      .send({ dryRun: false, newRoleId: "wiki_only" })
      .expect(409);
    expect(res.body.error.code).toBe("ROLE_ID_TAKEN");
    await app.close();
  });

  it("returns 404 for unknown source role", async () => {
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/admin/roles/missing_template/copy")
      .send({ dryRun: false, newRoleId: "anything" })
      .expect(404);
    expect(res.body.error.code).toBe("ROLE_NOT_FOUND");
    await app.close();
  });
});

describe("GET /api/admin/mcp-tools", () => {
  it("includes the Lucy R1 controlled data service tools", async () => {
    const app = buildServer();
    await app.ready();
    const res = await request(app.server).get("/api/admin/mcp-tools").expect(200);
    const toolNames = res.body.data.tools.map((tool: { name: string }) => tool.name);

    expect(toolNames).toEqual(expect.arrayContaining([
      "lucy_catalog",
      "lucy_read_source",
      "lucy_query",
      "lucy_explain_query",
      "lucy_freshness",
      "lucy_begin_question",
      "sql_dialect_notes"
    ]));
    const dialectNotes = res.body.data.tools.find((tool: { name: string }) => tool.name === "sql_dialect_notes");
    expect(dialectNotes).toMatchObject({ globalDenied: true });
    await app.close();
  });
});

describe("POST /api/admin/agents with role templates", () => {
  it("rejects template assignment per Spec 129 (must copy to formal Role first)", async () => {
    const app = buildServer();
    await app.ready();
    const before = await readFile(path.join(projectRoot, "webui/config/access.yaml"), "utf8");

    const preview = await request(app.server)
      .post("/api/admin/agents")
      .send({ dryRun: true, agent: { id: "wangwu", name: "王五", role: "dev_superstore" } })
      .expect(400);

    expect(preview.body.ok).toBe(false);
    expect(preview.body.error.code).toBe("REFERENCE_TEMPLATE_NOT_ASSIGNABLE");

    const write = await request(app.server)
      .post("/api/admin/agents")
      .send({ dryRun: false, agent: { id: "wangwu", name: "王五", role: "dev_superstore" } })
      .expect(400);
    expect(write.body.error.code).toBe("REFERENCE_TEMPLATE_NOT_ASSIGNABLE");

    const after = await readFile(path.join(projectRoot, "webui/config/access.yaml"), "utf8");
    expect(after).toBe(before);
    await app.close();
  });
});

describe("Access Governance Gate — Role endpoints", () => {
  it("POST dryRun includes gate decision for a non-sensitive Role", async () => {
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/admin/roles")
      .send({
        dryRun: true,
        roleId: "scratch_role",
        role: {
          description: "scratch",
          allow: {
            connections: ["mysql-aliyun"],
            tableSelectors: [{ connection: "mysql-aliyun", schema: "dataforai", names: ["superstore_orders"] }],
            tools: ["lucy_query"]
          }
        }
      })
      .expect(200);
    expect(res.body.data.gate).toBeDefined();
    expect(res.body.data.gate.targetKind).toBe("role");
    expect(res.body.data.gate.tierSummary.P0.count).toBe(0);
    await app.close();
  });

  it("PATCH into KX source triggers P0 override_required", async () => {
    // Add the KX table to the schema so the resolver can find it.
    const schemaPath = path.join(projectRoot, "semantic-layer/mysql-aliyun/_schema/dataforai.yaml");
    await writeFile(
      schemaPath,
      `tables:\n  kx_fact_financial_amount:\n    table: dataforai.kx_fact_financial_amount\n  superstore_orders:\n    table: dataforai.superstore_orders\n`,
      "utf8"
    );

    // Create a non-sensitive role first.
    const app = buildServer();
    await app.ready();
    const create = await request(app.server)
      .post("/api/admin/roles")
      .send({
        dryRun: false,
        roleId: "promote_target",
        role: {
          description: "starter",
          allow: {
            connections: ["mysql-aliyun"],
            tableSelectors: [{ connection: "mysql-aliyun", schema: "dataforai", names: ["superstore_orders"] }],
            tools: ["lucy_query"]
          }
        }
      })
      .expect(200);

    // DryRun PATCH that adds a KX source.
    const dryRun = await request(app.server)
      .patch(`/api/admin/roles/promote_target`)
      .send({
        dryRun: true,
        version: create.body.data.version,
        patch: {
          description: "patched",
          allow: {
            connections: ["mysql-aliyun"],
            tableSelectors: [
              { connection: "mysql-aliyun", schema: "dataforai", names: ["superstore_orders"] },
              { connection: "mysql-aliyun", schema: "dataforai", names: ["kx_fact_financial_amount"] }
            ],
            tools: ["lucy_query"]
          }
        }
      })
      .expect(200);
    expect(dryRun.body.data.gate.decision).toBe("override_required");
    expect(dryRun.body.data.gate.tierSummary.P0.reasons[0]).toMatch(/kx_fact_financial_amount/);
    await app.close();
  });

  it("PATCH with valid two-approver override succeeds", async () => {
    const schemaPath = path.join(projectRoot, "semantic-layer/mysql-aliyun/_schema/dataforai.yaml");
    await writeFile(
      schemaPath,
      `tables:\n  kx_fact_financial_amount:\n    table: dataforai.kx_fact_financial_amount\n  superstore_orders:\n    table: dataforai.superstore_orders\n`,
      "utf8"
    );
    const app = buildServer();
    await app.ready();
    const create = await request(app.server)
      .post("/api/admin/roles")
      .send({
        dryRun: false,
        roleId: "promote_target_2",
        role: {
          description: "starter",
          allow: {
            connections: ["mysql-aliyun"],
            tableSelectors: [{ connection: "mysql-aliyun", schema: "dataforai", names: ["superstore_orders"] }],
            tools: ["lucy_query"]
          }
        }
      })
      .expect(200);

    const res = await request(app.server)
      .patch(`/api/admin/roles/promote_target_2`)
      .send({
        dryRun: false,
        version: create.body.data.version,
        override: {
          reason: "rollback plan documented",
          approvers: [
            { actorKind: "admin", actorId: "local-admin-1", identityProvider: "deployment-local" },
            { actorKind: "admin", actorId: "local-admin-2", identityProvider: "deployment-local" }
          ],
          expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
          rollbackPlan: "Revert via git"
        },
        patch: {
          description: "patched",
          allow: {
            connections: ["mysql-aliyun"],
            tableSelectors: [
              { connection: "mysql-aliyun", schema: "dataforai", names: ["superstore_orders"] },
              { connection: "mysql-aliyun", schema: "dataforai", names: ["kx_fact_financial_amount"] }
            ],
            tools: ["lucy_query"]
          }
        }
      })
      .expect(200);
    expect(res.body.data.written).toBe(true);
    expect(res.body.data.gate.decision).toBe("override_required");
    await app.close();
  });
});
