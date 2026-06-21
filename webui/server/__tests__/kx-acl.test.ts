import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Identity } from "../proxy/identity";

const KX_TABLES = [
  "dataforai.kx_dim_company",
  "dataforai.kx_dim_financial_item",
  "dataforai.kx_fact_financial_amount",
  "dataforai.kx_vw_balance_sheet_detail",
  "dataforai.kx_vw_cash_flow_statement_detail",
  "dataforai.kx_vw_income_statement_detail"
];

const ACCESS_YAML = `roles:
  kx_readonly:
    description: KX read only
    allow:
      connections:
        - mysql-aliyun
      tableSelectors:
        - connection: mysql-aliyun
          schema: dataforai
          names:
${KX_TABLES.map((table) => `            - ${table.replace("dataforai.", "")}`).join("\n")}
      tools:
        - kx_catalog
        - sl_query
        - sl_read_source
        - entity_details
  invalid_kx_missing_connections:
    allow:
      tableSelectors:
        - schema: dataforai
          prefix: kx_
      tools:
        - sl_query
  invalid_wildcard_tools:
    allow:
      connections:
        - mysql-aliyun
      tableSelectors:
        - connection: mysql-aliyun
          schema: dataforai
          names:
${KX_TABLES.map((table) => `            - ${table.replace("dataforai.", "")}`).join("\n")}
      tools: ["*"]
  empty_selector:
    allow:
      connections:
        - mysql-aliyun
      tableSelectors:
        - connection: mysql-aliyun
          schema: dataforai
          prefix: nope_
      tools:
        - sl_query
users:
  - id: kx_guard_tester
    name: KX Guard Agent
    enabled: true
    tokens: []
    allow:
      tables:
${KX_TABLES.map((table) => `        - ${table}`).join("\n")}
      tools:
        - sl_query
        - sl_read_source
        - sl_validate
        - entity_details
        - dictionary_search
        - discover_data
  - id: disabled_kx_agent
    name: Disabled KX Agent
    enabled: false
    tokens: []
    allow:
      tables:
        - dataforai.kx_fact_financial_amount
      tools:
        - sl_query
        - sl_read_source
        - sl_validate
        - entity_details
  - id: workhorse
    name: Hermes Workhorse
    enabled: true
    tokens: []
    allow:
      connections:
        - mysql-aliyun
      tables:
${KX_TABLES.map((table) => `        - ${table}`).join("\n")}
      tools:
        - kx_catalog
        - sl_query
        - sl_read_source
        - entity_details
  - id: role_workhorse
    name: Role Workhorse
    enabled: true
    role: kx_readonly
    tokens: []
    allow:
      tables: ["*"]
      tools: ["*"]
  - id: missing_role_agent
    name: Missing Role Agent
    enabled: true
    role: missing_role
    tokens: []
  - id: missing_connections_role_agent
    name: Missing Connections Role Agent
    enabled: true
    role: invalid_kx_missing_connections
    tokens: []
  - id: wildcard_role_agent
    name: Wildcard Role Agent
    enabled: true
    role: invalid_wildcard_tools
    tokens: []
  - id: empty_selector_role_agent
    name: Empty Selector Role Agent
    enabled: true
    role: empty_selector
    tokens: []
  - id: superstore_agent
    name: Superstore Agent
    tokens: []
    allow:
      tables:
        - dataforai.superstore_orders
      tools:
        - sl_query
        - sl_read_source
        - sl_validate
        - entity_details
  - id: no_table_agent
    name: No Table Agent
    tokens: []
    allow:
      tables: []
      tools:
        - sl_query
        - sl_read_source
        - sl_validate
        - entity_details
  - id: missing_tables_agent
    name: Missing Tables Agent
    tokens: []
    allow:
      tools:
        - sl_query
        - sl_read_source
        - entity_details
  - id: missing_tools_agent
    name: Missing Tools Agent
    tokens: []
    allow:
      tables:
        - dataforai.kx_fact_financial_amount
  - id: wildcard_agent
    name: Wildcard Agent
    tokens: []
    allow:
      tables: ["*"]
      tools: ["*"]
  - id: wildcard_with_explicit_kx_agent
    name: Wildcard With Explicit KX Agent
    tokens: []
    allow:
      tables:
        - "*"
        - dataforai.kx_fact_financial_amount
      tools: ["*"]
defaults:
  deny_tools:
    - sql_execution
  known_tools:
    - sl_query
    - sl_read_source
    - sl_validate
    - wiki_search
    - wiki_read
    - entity_details
    - dictionary_search
    - discover_data
    - connection_list
    - kx_catalog
    - sql_execution
    - memory_ingest
    - memory_ingest_status
  table_touching_tools:
    - sl_query
    - sl_read_source
    - sl_validate
    - entity_details
  sensitive_metadata_tools:
    - dictionary_search
    - discover_data
  sensitive_table_prefixes:
    - dataforai.kx_
`;

const SCHEMA_YAML = `tables:
  kx_dim_company:
    table: dataforai.kx_dim_company
  kx_dim_financial_item:
    table: dataforai.kx_dim_financial_item
  kx_fact_financial_amount:
    table: dataforai.kx_fact_financial_amount
  kx_vw_balance_sheet_detail:
    table: dataforai.kx_vw_balance_sheet_detail
  kx_vw_cash_flow_statement_detail:
    table: dataforai.kx_vw_cash_flow_statement_detail
  kx_vw_income_statement_detail:
    table: dataforai.kx_vw_income_statement_detail
  superstore_orders:
    table: dataforai.superstore_orders
  superstore_returns:
    table: dataforai.superstore_returns
  superstore_people:
    table: dataforai.superstore_people
`;

let projectRoot: string;
let previousRoot: string | undefined;

function identity(userId: string): Identity {
  return { userId, tokenLabel: "unit-test" };
}

async function makeProject() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ktx-kx-acl-"));
  await mkdir(path.join(root, "webui", "config"), { recursive: true });
  await mkdir(path.join(root, "semantic-layer", "mysql-aliyun", "_schema"), { recursive: true });
  await writeFile(path.join(root, "ktx.yaml"), "connections: {}\n", "utf8");
  await writeFile(path.join(root, "webui", "config", "access.yaml"), ACCESS_YAML, "utf8");
  await writeFile(path.join(root, "semantic-layer", "mysql-aliyun", "_schema", "dataforai.yaml"), SCHEMA_YAML, "utf8");
  return root;
}

async function loadAcl() {
  vi.resetModules();
  return import("../proxy/acl");
}

beforeEach(async () => {
  previousRoot = process.env.KTX_PROJECT_ROOT;
  projectRoot = await makeProject();
  process.env.KTX_PROJECT_ROOT = projectRoot;
});

afterEach(async () => {
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  await rm(projectRoot, { recursive: true, force: true });
});

describe("KX financial domain ACL guardrails", () => {
  it("maps every KX semantic source to its physical table", async () => {
    const { extractTables } = await loadAcl();

    await expect(extractTables("sl_read_source", { sourceName: "kx_fact_financial_amount" }))
      .resolves.toEqual(["dataforai.kx_fact_financial_amount"]);

    await expect(extractTables("sl_query", {
      measures: ["sum(kx_fact_financial_amount.amount)"],
      dimensions: [
        { field: "kx_dim_company.company_name" },
        { field: "kx_dim_financial_item.item_name" }
      ]
    })).resolves.toEqual([
      "dataforai.kx_fact_financial_amount",
      "dataforai.kx_dim_company",
      "dataforai.kx_dim_financial_item"
    ]);
  });

  it("allows the KX test agent to access only the six KX tables", async () => {
    const { check } = await loadAcl();

    for (const table of [
      "kx_dim_company",
      "kx_dim_financial_item",
      "kx_fact_financial_amount",
      "kx_vw_balance_sheet_detail",
      "kx_vw_cash_flow_statement_detail",
      "kx_vw_income_statement_detail"
    ]) {
      await expect(check(identity("kx_guard_tester"), "sl_read_source", { sourceName: table }))
        .resolves.toEqual({ allowed: true });
    }

    await expect(check(identity("kx_guard_tester"), "sl_query", {
      measures: ["sum(kx_fact_financial_amount.amount)"],
      dimensions: [{ field: "kx_dim_company.company_name" }]
    })).resolves.toEqual({ allowed: true });

    await expect(check(identity("kx_guard_tester"), "entity_details", {
      entities: [{ table: "dataforai.kx_fact_financial_amount" }]
    })).resolves.toEqual({ allowed: true });
  });

  it("denies the KX test agent when it tries to access non-KX tables", async () => {
    const { check } = await loadAcl();

    await expect(check(identity("kx_guard_tester"), "sl_read_source", { sourceName: "superstore_orders" }))
      .resolves.toEqual({ allowed: false, reason: "table_forbidden:dataforai.superstore_orders" });

    await expect(check(identity("kx_guard_tester"), "sl_query", {
      measures: ["sum(superstore_orders.sales)"]
    })).resolves.toEqual({ allowed: false, reason: "table_forbidden:dataforai.superstore_orders" });

    await expect(check(identity("kx_guard_tester"), "entity_details", {
      entities: [{ table: "dataforai.superstore_orders" }]
    })).resolves.toEqual({ allowed: false, reason: "table_forbidden:dataforai.superstore_orders" });
  });

  it("denies non-KX agents when they try to access KX tables", async () => {
    const { check } = await loadAcl();

    await expect(check(identity("superstore_agent"), "sl_read_source", { sourceName: "kx_vw_income_statement_detail" }))
      .resolves.toEqual({ allowed: false, reason: "explicit_table_required:dataforai.kx_vw_income_statement_detail" });

    await expect(check(identity("superstore_agent"), "sl_query", {
      measures: ["sum(kx_fact_financial_amount.amount)"]
    })).resolves.toEqual({ allowed: false, reason: "explicit_table_required:dataforai.kx_fact_financial_amount" });

    await expect(check(identity("no_table_agent"), "entity_details", {
      entities: [{ table: "dataforai.kx_dim_company" }]
    })).resolves.toEqual({ allowed: false, reason: "explicit_table_required:dataforai.kx_dim_company" });
  });

  it("requires explicit KX table grants even for wildcard table agents", async () => {
    const { check } = await loadAcl();

    await expect(check(identity("wildcard_agent"), "sl_read_source", {
      sourceName: "superstore_orders"
    })).resolves.toEqual({ allowed: true });

    await expect(check(identity("wildcard_agent"), "sl_read_source", {
      sourceName: "kx_fact_financial_amount"
    })).resolves.toEqual({ allowed: false, reason: "explicit_table_required:dataforai.kx_fact_financial_amount" });

    await expect(check(identity("wildcard_with_explicit_kx_agent"), "sl_read_source", {
      sourceName: "kx_fact_financial_amount"
    })).resolves.toEqual({ allowed: true });
  });

  it("keeps globally denied tools blocked for the KX test agent", async () => {
    const { check } = await loadAcl();

    await expect(check(identity("kx_guard_tester"), "sql_execution", {
      query: "select * from dataforai.kx_fact_financial_amount limit 1"
    })).resolves.toEqual({ allowed: false, reason: "tool_forbidden_global" });
  });

  it("does not allow wildcard tool grants to call unknown tools", async () => {
    const { check } = await loadAcl();

    await expect(check(identity("wildcard_agent"), "future_table_export", {}))
      .resolves.toEqual({ allowed: false, reason: "tool_forbidden" });

    await expect(check(identity("wildcard_agent"), "wiki_search", { query: "discount policy" }))
      .resolves.toEqual({ allowed: true });
  });

  it("protects KX metadata from broad catalog tools", async () => {
    const { check } = await loadAcl();

    await expect(check(identity("wildcard_agent"), "dictionary_search", { query: "financial amount" }))
      .resolves.toEqual({ allowed: false, reason: "sensitive_metadata_forbidden:kx" });

    await expect(check(identity("wildcard_with_explicit_kx_agent"), "discover_data", {}))
      .resolves.toEqual({ allowed: false, reason: "sensitive_metadata_forbidden:kx" });

    await expect(check(identity("kx_guard_tester"), "dictionary_search", { query: "financial amount" }))
      .resolves.toEqual({ allowed: true });

    await expect(check(identity("kx_guard_tester"), "discover_data", {}))
      .resolves.toEqual({ allowed: true });
  });

  it("classifies sl_validate as table-scoped only when a source is provided", async () => {
    const { check } = await loadAcl();

    await expect(check(identity("superstore_agent"), "sl_validate", { sourceName: "superstore_orders" }))
      .resolves.toEqual({ allowed: true });

    await expect(check(identity("superstore_agent"), "sl_validate", { sourceName: "kx_fact_financial_amount" }))
      .resolves.toEqual({ allowed: false, reason: "explicit_table_required:dataforai.kx_fact_financial_amount" });

    await expect(check(identity("superstore_agent"), "sl_validate", {}))
      .resolves.toEqual({ allowed: false, reason: "sensitive_metadata_forbidden:kx" });
  });

  it("rejects raw query and sql parameters on sl_query before they can bypass table extraction", async () => {
    const { check } = await loadAcl();

    await expect(check(identity("kx_guard_tester"), "sl_query", {
      query: "select * from dataforai.superstore_orders limit 5"
    })).resolves.toEqual({ allowed: false, reason: "raw_query_forbidden" });

    await expect(check(identity("superstore_agent"), "sl_query", {
      sql: "select * from dataforai.kx_fact_financial_amount limit 5"
    })).resolves.toEqual({ allowed: false, reason: "raw_query_forbidden" });
  });

  it("rejects the logged Hermes object-form orders payload before it reaches KTX", async () => {
    const { check, extractTables } = await loadAcl();
    const payload = {
      connectionId: "warehouse",
      measures: [{ $text: "orders.order_count" }, { $text: "orders.revenue" }],
      dimensions: [{ field: "orders.created_at", granularity: "month" }],
      filters: ["orders.created_at >= '2026-01-01'"],
      order_by: [{ field: "orders.created_at", direction: "asc" }],
      include: ["sql"]
    };

    await expect(extractTables("sl_query", payload)).resolves.toEqual(["orders"]);
    await expect(check(identity("workhorse"), "sl_query", payload))
      .resolves.toEqual({ allowed: false, reason: "unknown_or_forbidden_connection:warehouse" });
  });

  it("requires the configured KX connection for workhorse table-touching tools", async () => {
    const { check } = await loadAcl();

    await expect(check(identity("workhorse"), "sl_query", {
      connectionId: "mysql-aliyun",
      measures: [{ $text: "kx_fact_financial_amount.amount" }]
    })).resolves.toEqual({ allowed: true });

    await expect(check(identity("workhorse"), "sl_query", {
      measures: [{ $text: "kx_fact_financial_amount.amount" }]
    })).resolves.toEqual({ allowed: false, reason: "unknown_or_forbidden_connection:<missing>" });

    await expect(check(identity("workhorse"), "sl_read_source", {
      connectionId: "warehouse",
      sourceName: "kx_fact_financial_amount"
    })).resolves.toEqual({ allowed: false, reason: "unknown_or_forbidden_connection:warehouse" });

    await expect(check(identity("workhorse"), "sl_query", {
      connectionId: "mysql-aliyun",
      measures: [{ expr: "count(1)", name: "cnt" }]
    })).resolves.toEqual({ allowed: false, reason: "explicit_table_required:<empty>" });
  });

  it("returns a KX catalog from the current workhorse allowlist", async () => {
    const { check, kxCatalog } = await loadAcl();

    await expect(check(identity("workhorse"), "kx_catalog", {})).resolves.toEqual({ allowed: true });

    const catalog = await kxCatalog(identity("workhorse"));
    expect(catalog.connections).toEqual(["mysql-aliyun"]);
    expect(catalog.sources.map((source) => source.sourceName)).toEqual([
      "kx_dim_company",
      "kx_dim_financial_item",
      "kx_fact_financial_amount",
      "kx_vw_balance_sheet_detail",
      "kx_vw_cash_flow_statement_detail",
      "kx_vw_income_statement_detail"
    ]);
  });

  it("resolves role-based KX permissions and ignores deprecated allow when role is present", async () => {
    const { check, kxCatalog, permissionSnapshot } = await loadAcl();

    await expect(check(identity("role_workhorse"), "sl_query", {
      connectionId: "mysql-aliyun",
      measures: [{ $text: "kx_fact_financial_amount.amount" }]
    })).resolves.toEqual({ allowed: true });

    await expect(check(identity("role_workhorse"), "sl_query", {
      connectionId: "mysql-aliyun",
      measures: [{ $text: "superstore_orders.sales" }]
    })).resolves.toEqual({ allowed: false, reason: "table_forbidden:dataforai.superstore_orders" });

    await expect(check(identity("role_workhorse"), "sl_query", {
      measures: [{ $text: "kx_fact_financial_amount.amount" }]
    })).resolves.toEqual({ allowed: false, reason: "unknown_or_forbidden_connection:<missing>" });

    const catalog = await kxCatalog(identity("role_workhorse"));
    expect(catalog.connections).toEqual(["mysql-aliyun"]);
    expect(catalog.sources.map((source) => source.sourceName)).toContain("kx_fact_financial_amount");

    const snapshot = await permissionSnapshot(identity("role_workhorse"));
    expect(snapshot?.roleIds).toEqual(["kx_readonly"]);
    expect(snapshot?.effectiveTablesCount).toBe(KX_TABLES.length);
    expect(snapshot?.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("fails closed for invalid role references and invalid role definitions", async () => {
    const { check } = await loadAcl();

    await expect(check(identity("missing_role_agent"), "sl_query", {}))
      .resolves.toEqual({ allowed: false, reason: "role_resolution_failed:missing_role" });

    await expect(check(identity("missing_connections_role_agent"), "sl_query", {}))
      .resolves.toEqual({ allowed: false, reason: "role_resolution_failed:invalid_kx_missing_connections" });

    await expect(check(identity("wildcard_role_agent"), "sl_query", {}))
      .resolves.toEqual({ allowed: false, reason: "role_resolution_failed:invalid_wildcard_tools" });

    await expect(check(identity("empty_selector_role_agent"), "sl_query", {}))
      .resolves.toEqual({ allowed: false, reason: "role_resolution_failed:empty_selector" });
  });

  it("extracts unauthorized table references from filters, where, and joins", async () => {
    const { check } = await loadAcl();

    await expect(check(identity("kx_guard_tester"), "sl_query", {
      measures: ["sum(kx_fact_financial_amount.amount)"],
      filters: [{ field: "superstore_orders.sales", op: "gt", value: 0 }]
    })).resolves.toEqual({ allowed: false, reason: "table_forbidden:dataforai.superstore_orders" });

    await expect(check(identity("superstore_agent"), "sl_query", {
      measures: ["sum(superstore_orders.sales)"],
      where: "kx_fact_financial_amount.amount > 0"
    })).resolves.toEqual({ allowed: false, reason: "explicit_table_required:dataforai.kx_fact_financial_amount" });

    await expect(check(identity("kx_guard_tester"), "sl_query", {
      measures: ["sum(kx_fact_financial_amount.amount)"],
      joins: [{ table: "superstore_returns", on: "superstore_returns.order_id = superstore_orders.order_id" }]
    })).resolves.toEqual({ allowed: false, reason: "table_forbidden:dataforai.superstore_returns" });
  });

  it("does not treat unqualified filter fields and values as table names", async () => {
    const { check } = await loadAcl();

    await expect(check(identity("kx_guard_tester"), "sl_query", {
      measures: ["sum(kx_fact_financial_amount.amount)"],
      filters: [{ field: "amount_type", op: "eq", value: "end_balance" }]
    })).resolves.toEqual({ allowed: true });
  });

  it("denies disabled agents even when their table and tool allowlists would otherwise match", async () => {
    const { check } = await loadAcl();

    await expect(check(identity("disabled_kx_agent"), "sl_read_source", {
      sourceName: "kx_fact_financial_amount"
    })).resolves.toEqual({ allowed: false, reason: "agent_disabled" });

    await expect(check(identity("disabled_kx_agent"), "sql_execution", {
      query: "select * from dataforai.kx_fact_financial_amount limit 1"
    })).resolves.toEqual({ allowed: false, reason: "agent_disabled" });
  });

  it("reloads access config for ACL checks without waiting for the cache TTL", async () => {
    const { check } = await loadAcl();

    await expect(check(identity("kx_guard_tester"), "sl_read_source", {
      sourceName: "kx_fact_financial_amount"
    })).resolves.toEqual({ allowed: true });

    const disabledYaml = ACCESS_YAML.replace(
      "  - id: kx_guard_tester\n    name: KX Guard Agent\n    enabled: true",
      "  - id: kx_guard_tester\n    name: KX Guard Agent\n    enabled: false"
    );
    await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), disabledYaml, "utf8");

    await expect(check(identity("kx_guard_tester"), "sl_read_source", {
      sourceName: "kx_fact_financial_amount"
    })).resolves.toEqual({ allowed: false, reason: "agent_disabled" });
  });

  it("reloads the source map for sensitive table checks without waiting for the source-map TTL", async () => {
    const { check } = await loadAcl();

    await expect(check(identity("wildcard_agent"), "sl_read_source", {
      sourceName: "superstore_orders"
    })).resolves.toEqual({ allowed: true });

    const updatedSchema = `${SCHEMA_YAML}
  kx_new_sensitive_view:
    table: dataforai.kx_new_sensitive_view
`;
    await writeFile(path.join(projectRoot, "semantic-layer", "mysql-aliyun", "_schema", "dataforai.yaml"), updatedSchema, "utf8");

    await expect(check(identity("wildcard_agent"), "sl_read_source", {
      sourceName: "kx_new_sensitive_view"
    })).resolves.toEqual({ allowed: false, reason: "explicit_table_required:dataforai.kx_new_sensitive_view" });
  });

  it("fails closed when tools or tables are missing from an allow block", async () => {
    const { check } = await loadAcl();

    await expect(check(identity("missing_tables_agent"), "sl_read_source", {
      sourceName: "kx_fact_financial_amount"
    })).resolves.toEqual({ allowed: false, reason: "explicit_table_required:dataforai.kx_fact_financial_amount" });

    await expect(check(identity("missing_tools_agent"), "sl_read_source", {
      sourceName: "kx_fact_financial_amount"
    })).resolves.toEqual({ allowed: false, reason: "tool_forbidden" });
  });

  it("normalizes entity_details table names before enforcing the allowlist", async () => {
    const { check } = await loadAcl();

    await expect(check(identity("kx_guard_tester"), "entity_details", {
      entities: [{ table: "`KX_FACT_FINANCIAL_AMOUNT`" }]
    })).resolves.toEqual({ allowed: true });

    await expect(check(identity("kx_guard_tester"), "entity_details", {
      entities: [{ table: "`DataForAI.Superstore_Orders`" }]
    })).resolves.toEqual({ allowed: false, reason: "table_forbidden:dataforai.superstore_orders" });
  });

  it("extracts entity_details table references from sourceName and schema/name contracts", async () => {
    const { check } = await loadAcl();

    await expect(check(identity("kx_guard_tester"), "entity_details", {
      sourceName: "kx_fact_financial_amount"
    })).resolves.toEqual({ allowed: true });

    await expect(check(identity("kx_guard_tester"), "entity_details", {
      entities: [{ sourceName: "kx_fact_financial_amount" }]
    })).resolves.toEqual({ allowed: true });

    await expect(check(identity("superstore_agent"), "entity_details", {
      entities: [{ schema: "dataforai", name: "kx_fact_financial_amount" }]
    })).resolves.toEqual({ allowed: false, reason: "explicit_table_required:dataforai.kx_fact_financial_amount" });
  });

  it("fails closed for entity_details string arrays, nested refs, and empty metadata requests", async () => {
    const { check } = await loadAcl();

    await expect(check(identity("superstore_agent"), "entity_details", {
      entities: "kx_fact_financial_amount"
    })).resolves.toEqual({ allowed: false, reason: "explicit_table_required:dataforai.kx_fact_financial_amount" });

    await expect(check(identity("superstore_agent"), "entity_details", {
      entities: ["kx_fact_financial_amount"]
    })).resolves.toEqual({ allowed: false, reason: "explicit_table_required:dataforai.kx_fact_financial_amount" });

    await expect(check(identity("superstore_agent"), "entity_details", {
      entities: [{ entity: { table: "kx_fact_financial_amount" } }]
    })).resolves.toEqual({ allowed: false, reason: "explicit_table_required:dataforai.kx_fact_financial_amount" });

    await expect(check(identity("superstore_agent"), "entity_details", {
      entities: []
    })).resolves.toEqual({ allowed: false, reason: "sensitive_metadata_forbidden:kx" });

    await expect(check(identity("superstore_agent"), "entity_details", 42))
      .resolves.toEqual({ allowed: false, reason: "sensitive_metadata_forbidden:kx" });
  });

  it("uses configured sensitive table prefixes instead of only code constants", async () => {
    const { check } = await loadAcl();
    const updatedAccess = ACCESS_YAML.replace(
      "  sensitive_table_prefixes:\n    - dataforai.kx_\n",
      "  sensitive_table_prefixes:\n    - dataforai.kx_\n    - dataforai.sec_\n"
    );
    const updatedSchema = `${SCHEMA_YAML}
  sec_private_table:
    table: dataforai.sec_private_table
`;
    await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), updatedAccess, "utf8");
    await writeFile(path.join(projectRoot, "semantic-layer", "mysql-aliyun", "_schema", "dataforai.yaml"), updatedSchema, "utf8");

    await expect(check(identity("wildcard_agent"), "sl_read_source", {
      sourceName: "sec_private_table"
    })).resolves.toEqual({ allowed: false, reason: "explicit_table_required:dataforai.sec_private_table" });
  });

  it("keeps built-in deny, tool classification, and KX sensitivity when defaults are empty", async () => {
    const { check } = await loadAcl();
    const weakenedDefaults = ACCESS_YAML.replace(/defaults:[\s\S]*$/, `defaults:
  deny_tools: []
  known_tools: []
  table_touching_tools: []
  sensitive_metadata_tools: []
  sensitive_table_prefixes: []
`);
    await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), weakenedDefaults, "utf8");

    await expect(check(identity("kx_guard_tester"), "sql_execution", {
      query: "select * from dataforai.kx_fact_financial_amount limit 1"
    })).resolves.toEqual({ allowed: false, reason: "tool_forbidden_global" });

    await expect(check(identity("wildcard_agent"), "sl_read_source", {
      sourceName: "kx_fact_financial_amount"
    })).resolves.toEqual({ allowed: false, reason: "explicit_table_required:dataforai.kx_fact_financial_amount" });

    await expect(check(identity("wildcard_agent"), "future_table_export", {}))
      .resolves.toEqual({ allowed: false, reason: "tool_forbidden" });
  });
});
