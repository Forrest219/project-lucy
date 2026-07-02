import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../index";
import { LUCY_R1_EXACT_TOOLS, ROLE_TEMPLATES } from "../admin/role-templates";

vi.mock("../admin/audit.js", () => ({
  getAuditDb: vi.fn(() => ({
    prepare: vi.fn(() => ({ get: vi.fn(() => undefined), all: vi.fn(() => []), run: vi.fn() })),
    exec: vi.fn(),
    pragma: vi.fn()
  })),
  recordConfigChange: vi.fn(async () => 1),
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
        - sl_query
users: []
defaults:
  deny_tools:
    - sql_execution
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
    expect(ROLE_TEMPLATES.lucy_r1_exact_readonly.allow.tools).toEqual(LUCY_R1_EXACT_TOOLS);
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
      "lucy_begin_question"
    ]));
    await app.close();
  });
});

describe("POST /api/admin/agents with role templates", () => {
  it("expands a template into access.yaml without writing template pointer fields", async () => {
    const app = buildServer();
    await app.ready();
    const preview = await request(app.server)
      .post("/api/admin/agents")
      .send({ dryRun: true, agent: { id: "wangwu", name: "王五", role: "dev_superstore" } })
      .expect(200);

    expect(preview.body.data.proposedYaml).toContain("dev_superstore:");
    expect(preview.body.data.proposedYaml).toContain("role: dev_superstore");
    expect(preview.body.data.proposedYaml).not.toMatch(/role-template|templateId|templateRef|_template/);
    let yaml = await readFile(path.join(projectRoot, "webui/config/access.yaml"), "utf8");
    expect(yaml).not.toContain("wangwu");

    await request(app.server)
      .post("/api/admin/agents")
      .send({ dryRun: false, agent: { id: "wangwu", name: "王五", role: "dev_superstore" } })
      .expect(200);

    yaml = await readFile(path.join(projectRoot, "webui/config/access.yaml"), "utf8");
    expect(yaml).toContain("dev_superstore:");
    expect(yaml).toContain("superstore_orders");
    expect(yaml).toContain("role: dev_superstore");
    expect(yaml).not.toMatch(/role-template|templateId|templateRef|_template/);
    await app.close();
  });
});
