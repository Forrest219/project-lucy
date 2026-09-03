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

const POC_TABLES = [
  "data_agent_poc.poc_metric_catalog",
  "data_agent_poc.poc_app_active_daily",
  "data_agent_poc.poc_ad_revenue_daily",
  "data_agent_poc.poc_ad_revenue_by_type_daily",
  "data_agent_poc.poc_ceo_metric_snapshot"
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
        - lucy_begin_question
        - lucy_query
        - lucy_read_source
        - entity_details
        - wiki_search
        - wiki_read
  poc_readonly:
    description: POC read only
    allow:
      connections:
        - poc-mysql-aliyun
      tableSelectors:
        - connection: poc-mysql-aliyun
          schema: data_agent_poc
          names:
            - poc_metric_catalog
            - poc_app_active_daily
            - poc_ad_revenue_daily
            - poc_ad_revenue_by_type_daily
            - poc_ceo_metric_snapshot
      tools:
        - lucy_catalog
        - connection_list
        - lucy_query
        - lucy_read_source
        - wiki_search
        - wiki_read
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
        - lucy_query
        - lucy_read_source
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
        - lucy_query
        - lucy_read_source
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
        - lucy_query
        - lucy_read_source
        - entity_details
  - id: role_workhorse
    name: Role Workhorse
    enabled: true
    role: kx_readonly
    tokens: []
    allow:
      tables: ["*"]
      tools: ["*"]
  - id: poc_demo
    name: POC Demo
    enabled: true
    role: poc_readonly
    tokens: []
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
        - lucy_query
        - lucy_read_source
        - sl_validate
        - entity_details
  - id: no_table_agent
    name: No Table Agent
    tokens: []
    allow:
      tables: []
      tools:
        - lucy_query
        - lucy_read_source
        - sl_validate
        - entity_details
        - lucy_begin_question
  - id: missing_tables_agent
    name: Missing Tables Agent
    tokens: []
    allow:
      tools:
        - lucy_query
        - lucy_read_source
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
    - sql_dialect_notes
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
    - lucy_catalog
    - kx_catalog
    - sql_execution
    - sql_dialect_notes
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

const POC_SCHEMA_YAML = `tables:
  poc_metric_catalog:
    table: data_agent_poc.poc_metric_catalog
  poc_app_active_daily:
    table: data_agent_poc.poc_app_active_daily
  poc_ad_revenue_daily:
    table: data_agent_poc.poc_ad_revenue_daily
  poc_ad_revenue_by_type_daily:
    table: data_agent_poc.poc_ad_revenue_by_type_daily
  poc_ceo_metric_snapshot:
    table: data_agent_poc.poc_ceo_metric_snapshot
  forbidden_finance:
    table: data_agent_poc.forbidden_finance
`;

let projectRoot: string;
let previousRoot: string | undefined;

function identity(userId: string): Identity {
  return { userId, tokenLabel: "unit-test", tokenHashPrefix: "unit-test" };
}

async function makeProject() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ktx-kx-acl-"));
  await mkdir(path.join(root, "webui", "config"), { recursive: true });
  await mkdir(path.join(root, "semantic-layer", "mysql-aliyun", "_schema"), { recursive: true });
  await mkdir(path.join(root, "semantic-layer", "poc-mysql-aliyun", "_schema"), { recursive: true });
  await writeFile(path.join(root, "ktx.yaml"), "connections: {}\n", "utf8");
  await writeFile(path.join(root, "webui", "config", "access.yaml"), ACCESS_YAML, "utf8");
  await writeFile(path.join(root, "semantic-layer", "mysql-aliyun", "_schema", "dataforai.yaml"), SCHEMA_YAML, "utf8");
  await writeFile(path.join(root, "semantic-layer", "poc-mysql-aliyun", "_schema", "data_agent_poc.yaml"), POC_SCHEMA_YAML, "utf8");
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

    await expect(extractTables("lucy_read_source", { sourceName: "kx_fact_financial_amount" }))
      .resolves.toEqual(["dataforai.kx_fact_financial_amount"]);

    await expect(extractTables("lucy_query", {
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

  it("extractSourceRefs resolves sl_read_source to a single high-confidence args_source_name record", async () => {
    const { extractSourceRefs } = await loadAcl();

    await expect(extractSourceRefs("lucy_read_source", { sourceName: "kx_fact_financial_amount" }))
      .resolves.toEqual([{
        connectionId: "mysql-aliyun",
        schema: "dataforai",
        sourceName: "kx_fact_financial_amount",
        physicalTable: "dataforai.kx_fact_financial_amount",
        extractionMethod: "args_source_name",
        confidence: "high"
      }]);
  });

  it("extractSourceRefs resolves sl_query measures/dimensions to multiple high-confidence field_ref records", async () => {
    const { extractSourceRefs } = await loadAcl();

    const refs = await extractSourceRefs("lucy_query", {
      measures: ["sum(kx_fact_financial_amount.amount)"],
      dimensions: [
        { field: "kx_dim_company.company_name" },
        { field: "kx_dim_financial_item.item_name" }
      ]
    });

    expect(refs).toHaveLength(3);
    expect(refs).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceName: "kx_fact_financial_amount", physicalTable: "dataforai.kx_fact_financial_amount", extractionMethod: "field_ref", confidence: "high" }),
      expect.objectContaining({ sourceName: "kx_dim_company", physicalTable: "dataforai.kx_dim_company", extractionMethod: "field_ref", confidence: "high" }),
      expect.objectContaining({ sourceName: "kx_dim_financial_item", physicalTable: "dataforai.kx_dim_financial_item", extractionMethod: "field_ref", confidence: "high" })
    ]));
  });

  it("resolveSourceRefsForTables falls back to medium-confidence source_map_reverse for tables outside the source map", async () => {
    const { resolveSourceRefsForTables } = await loadAcl();

    await expect(resolveSourceRefsForTables(["dataforai.totally_unknown_table"]))
      .resolves.toEqual([{
        physicalTable: "dataforai.totally_unknown_table",
        extractionMethod: "source_map_reverse",
        confidence: "medium"
      }]);

    await expect(resolveSourceRefsForTables(["dataforai.superstore_orders"]))
      .resolves.toEqual([{
        connectionId: "mysql-aliyun",
        schema: "dataforai",
        sourceName: "superstore_orders",
        physicalTable: "dataforai.superstore_orders",
        extractionMethod: "query_ref",
        confidence: "low"
      }]);
  });

  it("lucy_begin_question follows the same explicit allow-list + sources>0 visibility gate as kx_catalog", async () => {
    const { allowedToolNames, check } = await loadAcl();

    // role_workhorse uses the kx_readonly role, which now lists lucy_begin_question
    // alongside kx_catalog and resolves to 6 KX sources -> visible.
    const visibleForRoleWorkhorse = await allowedToolNames(identity("role_workhorse"));
    expect(visibleForRoleWorkhorse).toContain("lucy_begin_question");
    expect(visibleForRoleWorkhorse).toContain("kx_catalog");
    expect(visibleForRoleWorkhorse).not.toContain("sql_dialect_notes");
    await expect(check(identity("role_workhorse"), "lucy_begin_question", { intentSummary: "test" }))
      .resolves.toEqual({ allowed: true });

    await expect(check(identity("wildcard_agent"), "sql_dialect_notes", {
      connectionId: "mysql-aliyun"
    })).resolves.toEqual({ allowed: false, reason: "tool_absolute_deny:sql_dialect_notes" });

    // no_table_agent explicitly lists lucy_begin_question but resolves to zero tables/sources
    // -> still listed in allow.tools, but filtered out of tools/list by the sources>0 gate.
    const visibleForNoTableAgent = await allowedToolNames(identity("no_table_agent"));
    expect(visibleForNoTableAgent).not.toContain("lucy_begin_question");

    // superstore_agent never lists lucy_begin_question at all -> check() rejects it outright,
    // same as calling any other tool that isn't in allow.tools.
    await expect(check(identity("superstore_agent"), "lucy_begin_question", { intentSummary: "test" }))
      .resolves.toEqual({ allowed: false, reason: "tool_forbidden" });
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
      await expect(check(identity("kx_guard_tester"), "lucy_read_source", { sourceName: table }))
        .resolves.toEqual({ allowed: true });
    }

    await expect(check(identity("kx_guard_tester"), "lucy_query", {
      measures: ["sum(kx_fact_financial_amount.amount)"],
      dimensions: [{ field: "kx_dim_company.company_name" }]
    })).resolves.toEqual({ allowed: true });

    await expect(check(identity("kx_guard_tester"), "entity_details", {
      entities: [{ table: "dataforai.kx_fact_financial_amount" }]
    })).resolves.toEqual({ allowed: true });
  });

  it("denies the KX test agent when it tries to access non-KX tables", async () => {
    const { check } = await loadAcl();

    await expect(check(identity("kx_guard_tester"), "lucy_read_source", { sourceName: "superstore_orders" }))
      .resolves.toEqual({ allowed: false, reason: "table_forbidden:dataforai.superstore_orders" });

    await expect(check(identity("kx_guard_tester"), "lucy_query", {
      measures: ["sum(superstore_orders.sales)"]
    })).resolves.toEqual({ allowed: false, reason: "table_forbidden:dataforai.superstore_orders" });

    await expect(check(identity("kx_guard_tester"), "entity_details", {
      entities: [{ table: "dataforai.superstore_orders" }]
    })).resolves.toEqual({ allowed: false, reason: "table_forbidden:dataforai.superstore_orders" });
  });

  it("denies non-KX agents when they try to access KX tables", async () => {
    const { check } = await loadAcl();

    await expect(check(identity("superstore_agent"), "lucy_read_source", { sourceName: "kx_vw_income_statement_detail" }))
      .resolves.toEqual({ allowed: false, reason: "explicit_table_required:dataforai.kx_vw_income_statement_detail" });

    await expect(check(identity("superstore_agent"), "lucy_query", {
      measures: ["sum(kx_fact_financial_amount.amount)"]
    })).resolves.toEqual({ allowed: false, reason: "explicit_table_required:dataforai.kx_fact_financial_amount" });

    await expect(check(identity("no_table_agent"), "entity_details", {
      entities: [{ table: "dataforai.kx_dim_company" }]
    })).resolves.toEqual({ allowed: false, reason: "explicit_table_required:dataforai.kx_dim_company" });
  });

  it("requires explicit KX table grants even for wildcard table agents", async () => {
    const { check } = await loadAcl();

    await expect(check(identity("wildcard_agent"), "lucy_read_source", {
      sourceName: "superstore_orders"
    })).resolves.toEqual({ allowed: true });

    await expect(check(identity("wildcard_agent"), "lucy_read_source", {
      sourceName: "kx_fact_financial_amount"
    })).resolves.toEqual({ allowed: false, reason: "explicit_table_required:dataforai.kx_fact_financial_amount" });

    await expect(check(identity("wildcard_with_explicit_kx_agent"), "lucy_read_source", {
      sourceName: "kx_fact_financial_amount"
    })).resolves.toEqual({ allowed: true });
  });

  it("keeps globally denied tools blocked for the KX test agent", async () => {
    const { check } = await loadAcl();

    await expect(check(identity("kx_guard_tester"), "sql_execution", {
      query: "select * from dataforai.kx_fact_financial_amount limit 1"
    })).resolves.toEqual({ allowed: false, reason: "tool_absolute_deny:sql_execution" });
  });

  it("does not allow wildcard tool grants to call unknown tools", async () => {
    const { check } = await loadAcl();

    await expect(check(identity("wildcard_agent"), "future_table_export", {}))
      .resolves.toEqual({ allowed: false, reason: "tool_unclassified:future_table_export" });

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

    await expect(check(identity("kx_guard_tester"), "lucy_query", {
      query: "select * from dataforai.superstore_orders limit 5"
    })).resolves.toEqual({ allowed: false, reason: "raw_query_forbidden" });

    await expect(check(identity("superstore_agent"), "lucy_query", {
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

    await expect(extractTables("lucy_query", payload)).resolves.toEqual(["orders"]);
    await expect(check(identity("workhorse"), "lucy_query", payload))
      .resolves.toEqual({ allowed: false, reason: "unknown_or_forbidden_connection:warehouse" });
  });

  it("requires the configured KX connection for workhorse table-touching tools", async () => {
    const { check } = await loadAcl();

    await expect(check(identity("workhorse"), "lucy_query", {
      connectionId: "mysql-aliyun",
      measures: [{ $text: "kx_fact_financial_amount.amount" }]
    })).resolves.toEqual({ allowed: true });

    await expect(check(identity("workhorse"), "lucy_query", {
      measures: [{ $text: "kx_fact_financial_amount.amount" }]
    })).resolves.toEqual({ allowed: false, reason: "unknown_or_forbidden_connection:<missing>" });

    await expect(check(identity("workhorse"), "lucy_read_source", {
      connectionId: "warehouse",
      sourceName: "kx_fact_financial_amount"
    })).resolves.toEqual({ allowed: false, reason: "unknown_or_forbidden_connection:warehouse" });

    await expect(check(identity("workhorse"), "lucy_query", {
      connectionId: "mysql-aliyun",
      sourceName: "kx_vw_income_statement_detail",
      measures: [{ expr: "count(1)", name: "cnt" }]
    })).resolves.toEqual({ allowed: true });

    await expect(check(identity("workhorse"), "lucy_query", {
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

  it("returns a role-aware Lucy catalog for poc_demo without production metadata", async () => {
    const { allowedToolNames, check, lucyCatalog, permissionSnapshot } = await loadAcl();

    await expect(check(identity("poc_demo"), "lucy_catalog", {})).resolves.toEqual({ allowed: true });
    await expect(check(identity("poc_demo"), "connection_list", {})).resolves.toEqual({ allowed: true });
    const visibleTools = await allowedToolNames(identity("poc_demo"));
    expect(visibleTools).toContain("lucy_catalog");

    const catalog = await lucyCatalog(identity("poc_demo"));
    expect(catalog.connections).toEqual(["poc-mysql-aliyun"]);
    expect(catalog.sources.map((source) => source.sourceName)).toEqual([
      "poc_ad_revenue_by_type_daily",
      "poc_ad_revenue_daily",
      "poc_app_active_daily",
      "poc_ceo_metric_snapshot",
      "poc_metric_catalog"
    ]);
    expect(catalog.sources.map((source) => source.table).sort()).toEqual([...POC_TABLES].sort());
    expect(catalog.sources.map((source) => source.table)).not.toContain("data_agent_poc.forbidden_finance");
    expect(JSON.stringify(catalog)).not.toContain("dataforai");
    expect(JSON.stringify(catalog)).not.toContain("kx_");
    expect(JSON.stringify(catalog)).not.toContain("superstore");
    const exampleText = catalog.examples.join("\n");
    expect(exampleText).toContain("\"measures\":[\"poc_ad_revenue_daily.ad_revenue\"]");
    expect(exampleText).toContain("\"segments\":[\"poc_ad_revenue_daily.domestic\"]");
    expect(exampleText).toContain("Do not rewrite semantic keys to short names");

    const snapshot = await permissionSnapshot(identity("poc_demo"));
    expect(snapshot?.effectiveTablesCount).toBe(POC_TABLES.length);
  });

  it("resolves role-based KX permissions and ignores deprecated allow when role is present", async () => {
    const { check, kxCatalog, permissionSnapshot } = await loadAcl();

    await expect(check(identity("role_workhorse"), "lucy_query", {
      connectionId: "mysql-aliyun",
      measures: [{ $text: "kx_fact_financial_amount.amount" }]
    })).resolves.toEqual({ allowed: true });

    await expect(check(identity("role_workhorse"), "lucy_query", {
      connectionId: "mysql-aliyun",
      measures: [{ $text: "superstore_orders.sales" }]
    })).resolves.toEqual({ allowed: false, reason: "table_forbidden:dataforai.superstore_orders" });

    await expect(check(identity("role_workhorse"), "lucy_query", {
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

    await expect(check(identity("missing_role_agent"), "lucy_query", {}))
      .resolves.toEqual({ allowed: false, reason: "role_resolution_failed:missing_role" });

    await expect(check(identity("missing_connections_role_agent"), "lucy_query", {}))
      .resolves.toEqual({
        allowed: false,
        reason: "role_resolution_failed:invalid_kx_missing_connections:tool_absolute_deny:sl_query"
      });

    await expect(check(identity("wildcard_role_agent"), "lucy_query", {}))
      .resolves.toEqual({ allowed: false, reason: "role_resolution_failed:invalid_wildcard_tools" });

    await expect(check(identity("empty_selector_role_agent"), "lucy_query", {}))
      .resolves.toEqual({
        allowed: false,
        reason: "role_resolution_failed:empty_selector:tool_absolute_deny:sl_query"
      });
  });

  it("extracts unauthorized table references from filters, where, and joins", async () => {
    const { check } = await loadAcl();

    await expect(check(identity("kx_guard_tester"), "lucy_query", {
      measures: ["sum(kx_fact_financial_amount.amount)"],
      filters: [{ field: "superstore_orders.sales", op: "gt", value: 0 }]
    })).resolves.toEqual({ allowed: false, reason: "table_forbidden:dataforai.superstore_orders" });

    await expect(check(identity("superstore_agent"), "lucy_query", {
      measures: ["sum(superstore_orders.sales)"],
      where: "kx_fact_financial_amount.amount > 0"
    })).resolves.toEqual({ allowed: false, reason: "explicit_table_required:dataforai.kx_fact_financial_amount" });

    await expect(check(identity("kx_guard_tester"), "lucy_query", {
      measures: ["sum(kx_fact_financial_amount.amount)"],
      joins: [{ table: "superstore_returns", on: "superstore_returns.order_id = superstore_orders.order_id" }]
    })).resolves.toEqual({ allowed: false, reason: "table_forbidden:dataforai.superstore_returns" });
  });

  it("does not treat unqualified filter fields and values as table names", async () => {
    const { check } = await loadAcl();

    await expect(check(identity("kx_guard_tester"), "lucy_query", {
      measures: ["sum(kx_fact_financial_amount.amount)"],
      filters: [{ field: "amount_type", op: "eq", value: "end_balance" }]
    })).resolves.toEqual({ allowed: true });
  });

  it("denies disabled agents even when their table and tool allowlists would otherwise match", async () => {
    const { check, kxCatalog, permissionSnapshot } = await loadAcl();

    await expect(check(identity("disabled_kx_agent"), "lucy_read_source", {
      sourceName: "kx_fact_financial_amount"
    })).resolves.toEqual({ allowed: false, reason: "agent_disabled" });

    await expect(check(identity("disabled_kx_agent"), "sql_execution", {
      query: "select * from dataforai.kx_fact_financial_amount limit 1"
    })).resolves.toEqual({ allowed: false, reason: "agent_disabled" });

    await expect(permissionSnapshot(identity("disabled_kx_agent"))).resolves.toBeUndefined();
    await expect(kxCatalog(identity("disabled_kx_agent"))).resolves.toMatchObject({
      connections: [],
      sources: [],
      examples: []
    });
  });

  it("applies access.yaml disable only after EffectivePolicy commit (Spec 98 §8.2)", async () => {
    const acl = await loadAcl();
    const { check, commitEffectivePolicy } = acl;

    await expect(check(identity("kx_guard_tester"), "lucy_read_source", {
      sourceName: "kx_fact_financial_amount"
    })).resolves.toEqual({ allowed: true });

    const disabledYaml = ACCESS_YAML.replace(
      "  - id: kx_guard_tester\n    name: KX Guard Agent\n    enabled: true",
      "  - id: kx_guard_tester\n    name: KX Guard Agent\n    enabled: false"
    );
    await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), disabledYaml, "utf8");

    // Hot path must not parse YAML — disable is invisible until commit.
    await expect(check(identity("kx_guard_tester"), "lucy_read_source", {
      sourceName: "kx_fact_financial_amount"
    })).resolves.toEqual({ allowed: true });

    await commitEffectivePolicy();
    await expect(check(identity("kx_guard_tester"), "lucy_read_source", {
      sourceName: "kx_fact_financial_amount"
    })).resolves.toEqual({ allowed: false, reason: "agent_disabled" });
  });

  it("applies source-map sensitive tables only after EffectivePolicy commit (Spec 98 §8.2)", async () => {
    const acl = await loadAcl();
    const { check, commitEffectivePolicy } = acl;

    await expect(check(identity("wildcard_agent"), "lucy_read_source", {
      sourceName: "superstore_orders"
    })).resolves.toEqual({ allowed: true });

    const updatedSchema = `${SCHEMA_YAML}
  kx_new_sensitive_view:
    table: dataforai.kx_new_sensitive_view
`;
    await writeFile(path.join(projectRoot, "semantic-layer", "mysql-aliyun", "_schema", "dataforai.yaml"), updatedSchema, "utf8");

    // Hot path pins committed source map — unknown bare name is not yet classified as kx_* sensitive.
    await expect(check(identity("wildcard_agent"), "lucy_read_source", {
      sourceName: "kx_new_sensitive_view"
    })).resolves.toEqual({ allowed: true });

    await commitEffectivePolicy();
    await expect(check(identity("wildcard_agent"), "lucy_read_source", {
      sourceName: "kx_new_sensitive_view"
    })).resolves.toEqual({ allowed: false, reason: "explicit_table_required:dataforai.kx_new_sensitive_view" });
  });

  it("fails closed when tools or tables are missing from an allow block", async () => {
    const { check } = await loadAcl();

    await expect(check(identity("missing_tables_agent"), "lucy_read_source", {
      sourceName: "kx_fact_financial_amount"
    })).resolves.toEqual({ allowed: false, reason: "explicit_table_required:dataforai.kx_fact_financial_amount" });

    await expect(check(identity("missing_tools_agent"), "lucy_read_source", {
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

    await expect(check(identity("superstore_agent"), "entity_details", {
      entities: [{ type: "source", name: "kx_fact_financial_amount" }]
    })).resolves.toEqual({ allowed: false, reason: "explicit_table_required:dataforai.kx_fact_financial_amount" });

    await expect(check(identity("superstore_agent"), "entity_details", {
      entities: [{ type: "table", name: "superstore_orders" }]
    })).resolves.toEqual({ allowed: true });

    await expect(check(identity("superstore_agent"), "entity_details", {
      entities: [{ kind: "physical_table", id: "dataforai.kx_fact_financial_amount" }]
    })).resolves.toEqual({ allowed: false, reason: "explicit_table_required:dataforai.kx_fact_financial_amount" });

    await expect(check(identity("superstore_agent"), "entity_details", {
      entities: [{ kind: "semantic_source", id: "superstore_orders" }]
    })).resolves.toEqual({ allowed: true });

    await expect(check(identity("superstore_agent"), "entity_details", {
      entities: [{ qualifiedName: "dataforai.kx_fact_financial_amount" }]
    })).resolves.toEqual({ allowed: false, reason: "explicit_table_required:dataforai.kx_fact_financial_amount" });

    await expect(check(identity("superstore_agent"), "entity_details", {
      entities: [{ qualifiedName: "dataforai.superstore_orders" }]
    })).resolves.toEqual({ allowed: true });

    await expect(check(identity("kx_guard_tester"), "entity_details", {
      entities: [{ qualifiedName: "dataforai.superstore_orders" }]
    })).resolves.toEqual({ allowed: false, reason: "table_forbidden:dataforai.superstore_orders" });
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

    await expect(check(identity("wildcard_agent"), "lucy_read_source", {
      sourceName: "sec_private_table"
    })).resolves.toEqual({ allowed: false, reason: "explicit_table_required:dataforai.sec_private_table" });
  });

  it("rejects YAML-only promotion of unclassified tools (AC-P0 AbsoluteDeny closed set)", async () => {
    const { check } = await loadAcl();
    const updatedAccess = ACCESS_YAML
      .replace(
        "  known_tools:\n    - sl_query\n    - sl_read_source\n    - sl_validate\n    - wiki_search\n    - wiki_read\n    - entity_details\n    - dictionary_search\n    - discover_data\n    - connection_list\n    - lucy_catalog\n    - kx_catalog\n    - sql_execution\n    - sql_dialect_notes\n    - memory_ingest\n    - memory_ingest_status\n",
        "  known_tools:\n    - sl_query\n    - sl_read_source\n    - sl_validate\n    - wiki_search\n    - wiki_read\n    - entity_details\n    - dictionary_search\n    - discover_data\n    - connection_list\n    - lucy_catalog\n    - kx_catalog\n    - sql_execution\n    - sql_dialect_notes\n    - memory_ingest\n    - memory_ingest_status\n    - future_table_export\n    - future_data_catalog\n"
      )
      .replace(
        "  table_touching_tools:\n    - sl_query\n    - sl_read_source\n    - sl_validate\n    - entity_details\n",
        "  table_touching_tools:\n    - sl_query\n    - sl_read_source\n    - sl_validate\n    - entity_details\n    - future_table_export\n"
      )
      .replace(
        "  sensitive_metadata_tools:\n    - dictionary_search\n    - discover_data\n",
        "  sensitive_metadata_tools:\n    - dictionary_search\n    - discover_data\n    - future_data_catalog\n"
      );
    await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), updatedAccess, "utf8");

    // Adding tools to YAML known_tools / table_touching_tools cannot bypass AbsoluteDeny closed set.
    await expect(check(identity("wildcard_agent"), "future_table_export", {
      sourceName: "superstore_orders"
    })).resolves.toEqual({ allowed: false, reason: "tool_unclassified:future_table_export" });

    await expect(check(identity("wildcard_agent"), "future_data_catalog", {}))
      .resolves.toEqual({ allowed: false, reason: "tool_unclassified:future_data_catalog" });
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
    })).resolves.toEqual({ allowed: false, reason: "tool_absolute_deny:sql_execution" });

    await expect(check(identity("wildcard_agent"), "lucy_read_source", {
      sourceName: "kx_fact_financial_amount"
    })).resolves.toEqual({ allowed: false, reason: "explicit_table_required:dataforai.kx_fact_financial_amount" });

    await expect(check(identity("wildcard_agent"), "future_table_export", {}))
      .resolves.toEqual({ allowed: false, reason: "tool_unclassified:future_table_export" });
  });
});

describe("catalog_bound lucy_admin scope (Spec 131)", () => {
  async function seedCatalogBoundAccess(options: {
    connections: string[];
    withSelectors?: boolean;
    tools?: string[];
  }) {
    const tools = (options.tools ?? [
      "lucy_catalog",
      "lucy_query",
      "lucy_read_source",
      "connection_list"
    ]).map((tool) => `        - ${tool}`).join("\n");
    const selectors = options.withSelectors
      ? `      tableSelectors:
        - connection: mysql-aliyun
          schema: dataforai
          names:
            - superstore_orders
          row_access: all
`
      : "";
    const yaml = `roles:
  lucy_admin:
    description: ops data plane
    permission_model_version: 2
    allow:
      connections:
${options.connections.map((id) => `        - ${id}`).join("\n")}
      source_scope: catalog_bound
${selectors}      tools:
${tools}
users:
  - id: ops_agent
    name: Ops
    enabled: true
    role: lucy_admin
    tokens: []
defaults:
  deny_tools:
    - sql_execution
    - sl_query
    - sl_read_source
  known_tools:
    - lucy_query
    - lucy_read_source
    - lucy_catalog
    - connection_list
    - sql_execution
    - sl_query
    - sl_read_source
  table_touching_tools:
    - lucy_query
    - lucy_read_source
  sensitive_metadata_tools: []
  sensitive_table_prefixes: []
`;
    await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), yaml, "utf8");
    await writeFile(
      path.join(projectRoot, "ktx.yaml"),
      `connections:
  mysql-aliyun:
    driver: mysql
    enabled_tables:
      - dataforai.superstore_orders
      - dataforai.superstore_returns
  poc-mysql-aliyun:
    driver: mysql
    enabled_tables:
      - data_agent_poc.poc_metric_catalog
`,
      "utf8"
    );
  }

  it("grants all enabled sources on declared connections", async () => {
    await seedCatalogBoundAccess({ connections: ["mysql-aliyun"] });
    const { check, resolveEffectivePermissionsForAdmin, resetEffectivePolicyForTests, commitEffectivePolicy } = await loadAcl();
    resetEffectivePolicyForTests();
    await commitEffectivePolicy();

    const resolved = await resolveEffectivePermissionsForAdmin("ops_agent");
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.permissions.tables.sort()).toEqual([
      "dataforai.superstore_orders",
      "dataforai.superstore_returns"
    ]);

    await expect(check(identity("ops_agent"), "lucy_read_source", {
      sourceName: "superstore_orders",
      connectionId: "mysql-aliyun"
    })).resolves.toEqual({ allowed: true });

    await expect(check(identity("ops_agent"), "lucy_read_source", {
      sourceName: "superstore_people",
      connectionId: "mysql-aliyun"
    })).resolves.toMatchObject({ allowed: false });
  });

  it("does not auto-include undeclared connections", async () => {
    await seedCatalogBoundAccess({ connections: ["mysql-aliyun"] });
    const { check, resetEffectivePolicyForTests, commitEffectivePolicy } = await loadAcl();
    resetEffectivePolicyForTests();
    await commitEffectivePolicy();

    await expect(check(identity("ops_agent"), "lucy_read_source", {
      sourceName: "poc_metric_catalog",
      connectionId: "poc-mysql-aliyun"
    })).resolves.toMatchObject({ allowed: false });
  });

  it("rejects catalog_bound with tableSelectors", async () => {
    await seedCatalogBoundAccess({ connections: ["mysql-aliyun"], withSelectors: true });
    const { check, resetEffectivePolicyForTests, commitEffectivePolicy } = await loadAcl();
    resetEffectivePolicyForTests();
    await commitEffectivePolicy();

    await expect(check(identity("ops_agent"), "lucy_query", {}))
      .resolves.toEqual({
        allowed: false,
        reason: "role_resolution_failed:lucy_admin:catalog_bound_selectors_forbidden"
      });
  });

  it("rejects wildcard tools on catalog_bound roles", async () => {
    await seedCatalogBoundAccess({ connections: ["mysql-aliyun"], tools: ['"*"'] });
    const { check, resetEffectivePolicyForTests, commitEffectivePolicy } = await loadAcl();
    resetEffectivePolicyForTests();
    await commitEffectivePolicy();

    await expect(check(identity("ops_agent"), "lucy_query", {}))
      .resolves.toEqual({ allowed: false, reason: "role_resolution_failed:lucy_admin" });
  });

  it("emits policy_scope_expanded when enabled tables grow", async () => {
    await seedCatalogBoundAccess({ connections: ["mysql-aliyun"] });
    const acl = await loadAcl();
    const audit = await import("../admin/audit.js");
    const recordSpy = vi.spyOn(audit, "recordConfigChange").mockResolvedValue(1);
    acl.resetEffectivePolicyForTests();
    await acl.commitEffectivePolicy();
    recordSpy.mockClear();

    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await writeFile(
      path.join(projectRoot, "ktx.yaml"),
      `connections:
  mysql-aliyun:
    driver: mysql
    enabled_tables:
      - dataforai.superstore_orders
      - dataforai.superstore_returns
      - dataforai.superstore_people
  poc-mysql-aliyun:
    driver: mysql
    enabled_tables:
      - data_agent_poc.poc_metric_catalog
`,
      "utf8"
    );
    await acl.commitEffectivePolicy();
    expect(warn.mock.calls.some((args) => String(args[0]).includes("policy_scope_expanded"))).toBe(true);
    expect(recordSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        changeType: "policy_scope_expanded",
        targetId: "lucy_admin"
      })
    );
    warn.mockRestore();
    recordSpy.mockRestore();

    await expect(acl.check(identity("ops_agent"), "lucy_read_source", {
      sourceName: "superstore_people",
      connectionId: "mysql-aliyun"
    })).resolves.toEqual({ allowed: true });
  });

  it("detects policy_scope_expanded on same-count source key replacement", async () => {
    await seedCatalogBoundAccess({ connections: ["mysql-aliyun"] });
    const acl = await loadAcl();
    const audit = await import("../admin/audit.js");
    const recordSpy = vi.spyOn(audit, "recordConfigChange").mockResolvedValue(1);
    acl.resetEffectivePolicyForTests();
    await acl.commitEffectivePolicy();
    recordSpy.mockClear();

    // Replace returns with people — same count (2), different key set.
    await writeFile(
      path.join(projectRoot, "ktx.yaml"),
      `connections:
  mysql-aliyun:
    driver: mysql
    enabled_tables:
      - dataforai.superstore_orders
      - dataforai.superstore_people
  poc-mysql-aliyun:
    driver: mysql
    enabled_tables:
      - data_agent_poc.poc_metric_catalog
`,
      "utf8"
    );
    await acl.commitEffectivePolicy();
    expect(recordSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        changeType: "policy_scope_expanded",
        targetId: "lucy_admin"
      })
    );
    recordSpy.mockRestore();
  });

  it("rejects AbsoluteDeny tools at compile time", async () => {
    await seedCatalogBoundAccess({
      connections: ["mysql-aliyun"],
      tools: ["lucy_query", "sl_query"]
    });
    const { check, resetEffectivePolicyForTests, commitEffectivePolicy } = await loadAcl();
    resetEffectivePolicyForTests();
    await commitEffectivePolicy();

    await expect(check(identity("ops_agent"), "lucy_query", {}))
      .resolves.toMatchObject({
        allowed: false,
        reason: expect.stringMatching(/^role_resolution_failed:lucy_admin:/)
      });
  });
});
