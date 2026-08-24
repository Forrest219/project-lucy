import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Identity } from "../proxy/identity";

const ACCESS_YAML = `roles:
  finance_query:
    description: Finance query only
    allow:
      connections:
        - warehouse
      tableSelectors:
        - connection: warehouse
          schema: fin
          names:
            - fin_ledger
      tools:
        - lucy_query
  public_read:
    description: Public read_source only
    allow:
      connections:
        - warehouse
      tableSelectors:
        - connection: warehouse
          schema: pub
          names:
            - pub_orders
      tools:
        - lucy_read_source
  public_query:
    description: Public query on orders
    allow:
      connections:
        - warehouse
      tableSelectors:
        - connection: warehouse
          schema: pub
          names:
            - pub_orders
      tools:
        - lucy_query
  compat_role:
    description: Single role equivalent of the legacy allow block
    allow:
      connections:
        - warehouse
      tableSelectors:
        - connection: warehouse
          schema: fin
          names:
            - fin_ledger
      tools:
        - lucy_query
        - lucy_read_source
  undeclared_connection:
    description: Selector reaches a source on a connection that is not declared
    allow:
      connections:
        - warehouse
      tableSelectors:
        - schema: ext
          names:
            - ext_data
      tools:
        - lucy_query
  meta_only:
    description: Pure Meta role without tableSelectors
    allow:
      connections:
        - warehouse
      tools:
        - wiki_search
        - lucy_catalog
users:
  - id: multi_role_agent
    name: Multi Role Agent
    enabled: true
    roles:
      - finance_query
      - public_read
    tokens: []
  - id: join_agent
    name: Join Agent
    enabled: true
    roles:
      - finance_query
      - public_query
    tokens: []
  - id: undeclared_connection_agent
    name: Undeclared Connection Agent
    enabled: true
    role: undeclared_connection
    tokens: []
  - id: compat_role_agent
    name: Compat Role Agent
    enabled: true
    role: compat_role
    tokens: []
  - id: compat_roles_array_agent
    name: Compat Roles Array Agent
    enabled: true
    roles:
      - compat_role
    tokens: []
  - id: compat_legacy_agent
    name: Compat Legacy Agent
    enabled: true
    tokens: []
    allow:
      connections:
        - warehouse
      tables:
        - fin.fin_ledger
      tools:
        - lucy_query
        - lucy_read_source
  - id: dual_declaration_agent
    name: Dual Declaration Agent
    enabled: true
    role: compat_role
    roles:
      - public_read
    tokens: []
  - id: meta_only_agent
    name: Meta Only Agent
    enabled: true
    role: meta_only
    tokens: []
defaults:
  deny_tools: []
`;

const FIN_SCHEMA_YAML = `tables:
  fin_ledger:
    table: fin.fin_ledger
  fin_budget:
    table: fin.fin_budget
`;

const PUB_SCHEMA_YAML = `tables:
  pub_orders:
    table: pub.pub_orders
  pub_customers:
    table: pub.pub_customers
`;

const EXT_SCHEMA_YAML = `tables:
  ext_data:
    table: ext.ext_data
`;

let projectRoot: string;
let previousRoot: string | undefined;

function identity(userId: string): Identity {
  return { userId, tokenLabel: "unit-test", tokenHashPrefix: "unit-test" };
}

async function makeProject() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ktx-acl-capability-"));
  await mkdir(path.join(root, "webui", "config"), { recursive: true });
  await mkdir(path.join(root, "semantic-layer", "warehouse", "_schema"), { recursive: true });
  await mkdir(path.join(root, "semantic-layer", "otherdb", "_schema"), { recursive: true });
  await writeFile(path.join(root, "ktx.yaml"), "connections: {}\n", "utf8");
  await writeFile(path.join(root, "webui", "config", "access.yaml"), ACCESS_YAML, "utf8");
  await writeFile(path.join(root, "semantic-layer", "warehouse", "_schema", "fin.yaml"), FIN_SCHEMA_YAML, "utf8");
  await writeFile(path.join(root, "semantic-layer", "warehouse", "_schema", "pub.yaml"), PUB_SCHEMA_YAML, "utf8");
  await writeFile(path.join(root, "semantic-layer", "otherdb", "_schema", "ext.yaml"), EXT_SCHEMA_YAML, "utf8");
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

describe("WP-I3 Capability synthesis and authorize gate", () => {
  it("U-CAP-01: multi-role capabilities are a union of tuples, not a cartesian of unions", async () => {
    const { authorizeAndRewrite, effectivePermissions } = await loadAcl();

    // Role A grants lucy_query × fin_ledger, Role B grants lucy_read_source × pub_orders.
    await expect(authorizeAndRewrite(identity("multi_role_agent"), "lucy_query", {
      connectionId: "warehouse",
      measures: ["fin_ledger.amount"]
    })).resolves.toEqual({ allowed: true });

    await expect(authorizeAndRewrite(identity("multi_role_agent"), "lucy_read_source", {
      connectionId: "warehouse",
      sourceName: "pub_orders"
    })).resolves.toEqual({ allowed: true });

    // The forbidden cross product must not exist in either direction.
    await expect(authorizeAndRewrite(identity("multi_role_agent"), "lucy_read_source", {
      connectionId: "warehouse",
      sourceName: "fin_ledger"
    })).resolves.toEqual({
      allowed: false,
      reason: "capability_forbidden:lucy_read_source:warehouse|fin|fin_ledger|fin.fin_ledger"
    });

    await expect(authorizeAndRewrite(identity("multi_role_agent"), "lucy_query", {
      connectionId: "warehouse",
      measures: ["pub_orders.amount"]
    })).resolves.toEqual({
      allowed: false,
      reason: "capability_forbidden:lucy_query:warehouse|pub|pub_orders|pub.pub_orders"
    });

    const resolved = await effectivePermissions(identity("multi_role_agent"));
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.permissions.roleIds).toEqual(["finance_query", "public_read"]);
    expect(resolved.permissions.capabilities.map((capability) => `${capability.tool}:${capability.sourceName}`)).toEqual([
      "lucy_query:fin_ledger",
      "lucy_read_source:pub_orders"
    ]);
    // tools/tables/sources stay available for compatibility but never imply the cartesian.
    expect(resolved.permissions.tools).toEqual(["lucy_query", "lucy_read_source"]);
    expect(resolved.permissions.tables).toEqual(["fin.fin_ledger", "pub.pub_orders"]);
  });

  it("U-CAP-02: a multi-source request needs the capability for every resolved source", async () => {
    const { authorizeAndRewrite } = await loadAcl();

    // join_agent holds lucy_query on both fin_ledger and pub_orders.
    await expect(authorizeAndRewrite(identity("join_agent"), "lucy_query", {
      connectionId: "warehouse",
      measures: ["fin_ledger.amount"],
      joins: [{ table: "pub_orders", on: "pub_orders.id = fin_ledger.order_id" }]
    })).resolves.toEqual({ allowed: true });

    // pub_customers has no capability for any tool → the join is rejected on that source.
    await expect(authorizeAndRewrite(identity("join_agent"), "lucy_query", {
      connectionId: "warehouse",
      measures: ["pub_orders.amount"],
      dimensions: [{ field: "pub_customers.name" }]
    })).resolves.toEqual({ allowed: false, reason: "table_forbidden:pub.pub_customers" });

    // Same shape for multi_role_agent, where the missing piece is the tool rather than the source.
    await expect(authorizeAndRewrite(identity("multi_role_agent"), "lucy_query", {
      connectionId: "warehouse",
      measures: ["fin_ledger.amount"],
      joins: [{ table: "pub_orders", on: "pub_orders.id = fin_ledger.order_id" }]
    })).resolves.toEqual({
      allowed: false,
      reason: "capability_forbidden:lucy_query:warehouse|pub|pub_orders|pub.pub_orders"
    });
  });

  it("U-CAP-04: a capability source on an undeclared connection fails role compilation", async () => {
    const { authorizeAndRewrite, effectivePermissions, lucyCatalog } = await loadAcl();

    await expect(authorizeAndRewrite(identity("undeclared_connection_agent"), "lucy_query", {
      connectionId: "otherdb",
      measures: ["ext_data.amount"]
    })).resolves.toEqual({ allowed: false, reason: "role_resolution_failed:undeclared_connection" });

    await expect(effectivePermissions(identity("undeclared_connection_agent"))).resolves.toEqual({
      ok: false,
      reason: "role_resolution_failed:undeclared_connection"
    });

    await expect(lucyCatalog(identity("undeclared_connection_agent"))).resolves.toEqual({
      connections: [],
      sources: [],
      examples: []
    });
  });

  it("U-COMPAT-01: a single-role agent decides exactly like the equivalent legacy allow block", async () => {
    const { allowedToolNames, authorizeAndRewrite } = await loadAcl();

    const matrix: Array<[string, Record<string, unknown>]> = [
      ["lucy_query", { connectionId: "warehouse", measures: ["fin_ledger.amount"] }],
      ["lucy_query", { connectionId: "warehouse", measures: ["pub_orders.amount"] }],
      ["lucy_read_source", { connectionId: "warehouse", sourceName: "fin_ledger" }],
      ["lucy_read_source", { connectionId: "warehouse", sourceName: "pub_customers" }],
      ["lucy_query", { measures: ["fin_ledger.amount"] }]
    ];

    for (const [tool, args] of matrix) {
      const legacy = await authorizeAndRewrite(identity("compat_legacy_agent"), tool, args);
      const roleBased = await authorizeAndRewrite(identity("compat_role_agent"), tool, args);
      expect(roleBased).toEqual(legacy);
    }

    await expect(authorizeAndRewrite(identity("compat_role_agent"), "lucy_query", {
      connectionId: "warehouse",
      measures: ["fin_ledger.amount"]
    })).resolves.toEqual({ allowed: true });

    await expect(authorizeAndRewrite(identity("compat_role_agent"), "lucy_read_source", {
      connectionId: "warehouse",
      sourceName: "pub_customers"
    })).resolves.toEqual({ allowed: false, reason: "table_forbidden:pub.pub_customers" });

    expect(await allowedToolNames(identity("compat_role_agent")))
      .toEqual(await allowedToolNames(identity("compat_legacy_agent")));
  });

  it("parses roles[] as a Role Set and fails closed when role and roles are both declared", async () => {
    const { authorizeAndRewrite, effectivePermissions } = await loadAcl();

    const single = await effectivePermissions(identity("compat_role_agent"));
    const asArray = await effectivePermissions(identity("compat_roles_array_agent"));
    expect(asArray.ok).toBe(true);
    if (!single.ok || !asArray.ok) return;
    expect(asArray.permissions.roleIds).toEqual(["compat_role"]);
    expect(asArray.permissions.capabilities).toEqual(single.permissions.capabilities);
    expect(asArray.permissions.capabilityDigest).toBe(single.permissions.capabilityDigest);

    await expect(authorizeAndRewrite(identity("dual_declaration_agent"), "lucy_query", {
      connectionId: "warehouse",
      measures: ["fin_ledger.amount"]
    })).resolves.toEqual({ allowed: false, reason: "role_resolution_failed:role_and_roles" });
  });

  it("filters Meta output and tool visibility by Effective Data Capabilities", async () => {
    const { allowedToolNames, lucyCatalog } = await loadAcl();

    const multiRoleCatalog = await lucyCatalog(identity("multi_role_agent"));
    expect(multiRoleCatalog.sources.map((source) => source.sourceName)).toEqual(["fin_ledger", "pub_orders"]);
    expect(multiRoleCatalog.connections).toEqual(["warehouse"]);

    // Pure Meta role: no DataPlane capability → empty catalog sources, declared connections only.
    const metaCatalog = await lucyCatalog(identity("meta_only_agent"));
    expect(metaCatalog.sources).toEqual([]);
    expect(metaCatalog.connections).toEqual(["warehouse"]);

    const metaTools = await allowedToolNames(identity("meta_only_agent"));
    expect(metaTools).toEqual(["wiki_search"]);

    // A DataPlane tool is visible only when at least one capability names that tool.
    expect(await allowedToolNames(identity("multi_role_agent"))).toEqual(["lucy_query", "lucy_read_source"]);
  });

  it("denies lucy_read_source alias args that would bypass empty-source capability loop", async () => {
    const { authorizeAndRewrite } = await loadAcl();
    // finance source is granted for lucy_query only — aliases must still resolve and deny for lucy_read_source.
    for (const args of [
      { connectionId: "warehouse", source_name: "fin_ledger" },
      { connectionId: "warehouse", source: "fin_ledger" },
      { connectionId: "warehouse", table: "fin_ledger" }
    ]) {
      await expect(authorizeAndRewrite(identity("multi_role_agent"), "lucy_read_source", args))
        .resolves.toMatchObject({ allowed: false, reason: expect.stringMatching(/^capability_forbidden:lucy_read_source:/) });
    }
  });
});
