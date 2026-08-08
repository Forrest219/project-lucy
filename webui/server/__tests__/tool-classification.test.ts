import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Identity } from "../proxy/identity";

const ACCESS_YAML = `users:
  - id: full_agent
    name: Full Agent
    enabled: true
    tokens: []
    allow:
      tables:
        - dataforai.superstore_orders
      tools:
        - lucy_query
        - lucy_read_source
        - lucy_explain_query
        - lucy_freshness
        - entity_details
        - sl_validate
        - wiki_search
        - wiki_read
        - dictionary_search
        - discover_data
        - connection_list
        - lucy_catalog
        - kx_catalog
        - lucy_begin_question
        - sl_query
        - sl_read_source
  - id: wildcard_agent
    name: Wildcard
    tokens: []
    allow:
      tables: ["*"]
      tools: ["*"]
defaults:
  deny_tools: []
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
    - lucy_read_source
    - lucy_query
    - lucy_explain_query
    - lucy_freshness
    - lucy_begin_question
    - kx_catalog
    - sql_execution
    - sql_dialect_notes
    - memory_ingest
    - memory_ingest_status
  table_touching_tools:
    - lucy_query
    - lucy_read_source
    - lucy_explain_query
    - lucy_freshness
    - sl_validate
    - entity_details
  sensitive_metadata_tools:
    - dictionary_search
    - discover_data
  sensitive_table_prefixes:
    - dataforai.kx_
`;

const SCHEMA_YAML = `tables:
  superstore_orders:
    table: dataforai.superstore_orders
  kx_fact_financial_amount:
    table: dataforai.kx_fact_financial_amount
`;

let projectRoot: string;
let previousRoot: string | undefined;

function identity(userId: string): Identity {
  return { userId, tokenLabel: "unit-test", tokenHashPrefix: "unit-test" };
}

async function makeProject() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ktx-tool-class-"));
  await mkdir(path.join(root, "webui", "config"), { recursive: true });
  await mkdir(path.join(root, "semantic-layer", "mysql-aliyun", "_schema"), { recursive: true });
  await writeFile(path.join(root, "ktx.yaml"), "connections: {}\n", "utf8");
  await writeFile(path.join(root, "webui", "config", "access.yaml"), ACCESS_YAML, "utf8");
  await writeFile(
    path.join(root, "semantic-layer", "mysql-aliyun", "_schema", "dataforai.yaml"),
    SCHEMA_YAML,
    "utf8"
  );
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

describe("WP-I2 Tool Class + AbsoluteDeny", () => {
  it("U-CLS-01: classification table covers DEFAULT_KNOWN_TOOLS / Spec 98 §4.2", async () => {
    const {
      ABSOLUTE_DENY_TOOLS,
      DATA_PLANE_TOOLS,
      META_TOOLS,
      classifyTool,
      TOOL_CLASSIFICATION_VERSION
    } = await loadAcl();

    expect(TOOL_CLASSIFICATION_VERSION).toBeTruthy();
    const all = new Set<string>([...ABSOLUTE_DENY_TOOLS, ...DATA_PLANE_TOOLS, ...META_TOOLS]);
    for (const tool of all) {
      expect(classifyTool(tool)).toMatch(/^(AbsoluteDeny|DataPlane|Meta)$/);
    }
    expect(classifyTool("sl_query")).toBe("AbsoluteDeny");
    expect(classifyTool("lucy_query")).toBe("DataPlane");
    expect(classifyTool("wiki_search")).toBe("Meta");
    expect(classifyTool("brand_new_upstream_tool")).toBe("AbsoluteDeny");
  });

  it("U-CLS-02: unclassified tool denied on call and hidden from tools/list", async () => {
    const { check, allowedToolNames } = await loadAcl();

    await expect(check(identity("wildcard_agent"), "future_table_export", {}))
      .resolves.toEqual({ allowed: false, reason: "tool_unclassified:future_table_export" });

    const visible = await allowedToolNames(identity("wildcard_agent"));
    expect(visible).not.toContain("future_table_export");
    expect(visible).not.toContain("sl_query");
  });

  it("U-CLS-03: entity_details / sl_validate / lucy_freshness still enforce source checks", async () => {
    const { check } = await loadAcl();

    await expect(
      check(identity("full_agent"), "entity_details", {
        entities: [{ table: "dataforai.superstore_orders" }]
      })
    ).resolves.toEqual({ allowed: true });

    await expect(
      check(identity("full_agent"), "entity_details", {
        entities: [{ table: "dataforai.kx_fact_financial_amount" }]
      })
    ).resolves.toEqual({
      allowed: false,
      reason: "explicit_table_required:dataforai.kx_fact_financial_amount"
    });

    await expect(
      check(identity("full_agent"), "sl_validate", { sourceName: "superstore_orders" })
    ).resolves.toEqual({ allowed: true });

    await expect(
      check(identity("full_agent"), "lucy_freshness", {
        connectionId: "mysql-aliyun",
        sourceName: "kx_fact_financial_amount"
      })
    ).resolves.toEqual({
      allowed: false,
      reason: "explicit_table_required:dataforai.kx_fact_financial_amount"
    });
  });

  it("U-DENY-01: sl_* denied even when YAML deny_tools is empty", async () => {
    const { check, allowedToolNames } = await loadAcl();

    await expect(check(identity("full_agent"), "sl_query", {
      measures: ["superstore_orders.sales"]
    })).resolves.toEqual({ allowed: false, reason: "tool_absolute_deny:sl_query" });

    await expect(check(identity("full_agent"), "sl_read_source", {
      sourceName: "superstore_orders"
    })).resolves.toEqual({ allowed: false, reason: "tool_absolute_deny:sl_read_source" });

    await expect(check(identity("wildcard_agent"), "sql_execution", { query: "select 1" }))
      .resolves.toEqual({ allowed: false, reason: "tool_absolute_deny:sql_execution" });

    const visible = await allowedToolNames(identity("full_agent"));
    expect(visible).not.toContain("sl_query");
    expect(visible).not.toContain("sl_read_source");
    expect(visible).toContain("lucy_query");
  });

  it("does not fail-open sensitive tables via bogus connectionId on canonical lookup", async () => {
    const { check } = await loadAcl();

    await expect(
      check(identity("wildcard_agent"), "lucy_read_source", {
        connectionId: "bogus",
        sourceName: "kx_fact_financial_amount"
      })
    ).resolves.toEqual({
      allowed: false,
      reason: "explicit_table_required:dataforai.kx_fact_financial_amount"
    });
  });
});
