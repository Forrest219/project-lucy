import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Identity } from "../proxy/identity";

vi.mock("../admin/audit.js", () => ({
  getAuditDb: vi.fn(() => ({
    prepare: vi.fn(() => ({ get: vi.fn(() => undefined), all: vi.fn(() => []), run: vi.fn() })),
    exec: vi.fn(),
    pragma: vi.fn()
  })),
  recordConfigChange: vi.fn(async () => 1),
  updateConfigChangeStatus: vi.fn(async () => {}),
  registerAuditRoutes: vi.fn()
}));

const FIN_SCHEMA_YAML = `tables:
  fin_ledger:
    table: fin.fin_ledger
    columns:
      - name: region
      - name: category
      - name: order_date
  fin_budget:
    table: fin.fin_budget
    columns:
      - name: region
      - name: department
`;

const FIN_LEDGER_OVERLAY_YAML = `columns:
  - name: region
  - name: order_year
    expr: year(fin_ledger.order_date)
  - name: total_by_region
    expr: sum(fin_ledger.category)
  - name: region_rank
    expr: rank() over (partition by fin_ledger.region)
  - name: other_region
    expr: fin_budget.region
measures:
  - name: total_sales
  - name: profit_margin
`;

const FIN_BUDGET_OVERLAY_YAML = `columns:
  - name: region
  - name: department
measures:
  - name: budget_amount
`;

function accessYaml(rolesBlock: string, usersBlock: string): string {
  return `roles:
${rolesBlock}
users:
${usersBlock}
defaults:
  deny_tools: []
`;
}

const BASE_ROLE_TOOLS = `      tools:
        - lucy_query
        - lucy_read_source
        - lucy_explain_query
        - lucy_freshness
        - entity_details
        - sl_validate`;

const SCOPED_EAST_ROLE = `  scoped_ok:
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
                value: East
${BASE_ROLE_TOOLS}`;

const SCOPED_EAST_AGENT = `  - id: scoped_agent
    role: scoped_ok
    enabled: true
    tokens: []`;

let projectRoot: string;
let previousRoot: string | undefined;
let previousProven: string | undefined;

function identity(userId: string): Identity {
  return { userId, tokenLabel: "unit-test", tokenHashPrefix: "unit-test" };
}

async function makeProject(yaml: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ktx-row-policy-ac-p1-"));
  await mkdir(path.join(root, "webui", "config"), { recursive: true });
  await mkdir(path.join(root, "semantic-layer", "warehouse", "_schema"), { recursive: true });
  await mkdir(path.join(root, ".ktx-ui"), { recursive: true });
  await writeFile(path.join(root, "ktx.yaml"), "connections: {}\n", "utf8");
  await writeFile(path.join(root, "webui", "config", "access.yaml"), yaml, "utf8");
  await writeFile(path.join(root, "semantic-layer", "warehouse", "_schema", "fin.yaml"), FIN_SCHEMA_YAML, "utf8");
  await writeFile(path.join(root, "semantic-layer", "warehouse", "fin_ledger.yaml"), FIN_LEDGER_OVERLAY_YAML, "utf8");
  await writeFile(path.join(root, "semantic-layer", "warehouse", "fin_budget.yaml"), FIN_BUDGET_OVERLAY_YAML, "utf8");
  return root;
}

async function loadAcl() {
  vi.resetModules();
  const acl = await import("../proxy/acl");
  const rowPolicy = await import("../proxy/row-policy");
  rowPolicy.resetRowPolicyCatalogCacheForTests();
  acl.resetEffectivePolicyForTests();
  return acl;
}

beforeEach(async () => {
  previousRoot = process.env.KTX_PROJECT_ROOT;
  previousProven = process.env.LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN;
  delete process.env.LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN;
});

afterEach(async () => {
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  if (previousProven === undefined) delete process.env.LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN;
  else process.env.LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN = previousProven;
  if (projectRoot) await rm(projectRoot, { recursive: true, force: true });
});

describe("AC-P1 row policy (WP-I1–I4)", () => {
  it("SC-P1-02: scoped + legal row_policy compiles; illegal op / missing policy fail", async () => {
    projectRoot = await makeProject(accessYaml(
      `  scoped_ok:
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
                value: East
${BASE_ROLE_TOOLS}
  scoped_bad_op:
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
                op: ne
                value: East
${BASE_ROLE_TOOLS}
  scoped_missing:
    permission_model_version: 2
    allow:
      connections: [warehouse]
      tableSelectors:
        - connection: warehouse
          schema: fin
          names: [fin_ledger]
          row_access: scoped
${BASE_ROLE_TOOLS}`,
      `  - id: ok_agent
    role: scoped_ok
    enabled: true
    tokens: []
  - id: bad_op_agent
    role: scoped_bad_op
    enabled: true
    tokens: []
  - id: missing_agent
    role: scoped_missing
    enabled: true
    tokens: []`
    ));
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const { effectivePermissions } = await loadAcl();

    const ok = await effectivePermissions(identity("ok_agent"));
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.permissions.capabilities[0]?.rowGrant.kind).toBe("scoped");

    const badOp = await effectivePermissions(identity("bad_op_agent"));
    expect(badOp.ok).toBe(false);
    if (!badOp.ok) expect(badOp.reason).toMatch(/row_policy_op_forbidden/);

    const missing = await effectivePermissions(identity("missing_agent"));
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.reason).toMatch(/row_policy_/);
  });

  it("BY-19: measure field in row_policy fails compilation", async () => {
    projectRoot = await makeProject(accessYaml(
      `  measure_field:
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
              - field: total_sales
                op: eq
                value: 1
${BASE_ROLE_TOOLS}`,
      `  - id: measure_agent
    role: measure_field
    enabled: true
    tokens: []`
    ));
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const { effectivePermissions } = await loadAcl();

    const resolved = await effectivePermissions(identity("measure_agent"));
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) expect(resolved.reason).toMatch(/row_policy_field_unresolved:measure/);
  });

  it("SC-P1-03: unwrapped tools deny on protected source", async () => {
    projectRoot = await makeProject(accessYaml(
      `  scoped_ok:
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
                value: East
${BASE_ROLE_TOOLS}`,
      `  - id: scoped_agent
    role: scoped_ok
    enabled: true
    tokens: []`
    ));
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const { authorizeAndRewrite } = await loadAcl();
    const args = { connectionId: "warehouse", sourceName: "fin_ledger" };

    for (const tool of ["lucy_read_source", "lucy_freshness", "entity_details", "sl_validate"] as const) {
      await expect(authorizeAndRewrite(identity("scoped_agent"), tool, args)).resolves.toEqual({
        allowed: false,
        reason: "row_policy_requires_wrapped_tool"
      });
    }
  });

  it("SC-P1-04: unproven lucy_query denies on protected source", async () => {
    projectRoot = await makeProject(accessYaml(
      `  scoped_ok:
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
                value: East
${BASE_ROLE_TOOLS}`,
      `  - id: scoped_agent
    role: scoped_ok
    enabled: true
    tokens: []`
    ));
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const { authorizeAndRewrite } = await loadAcl();

    await expect(authorizeAndRewrite(identity("scoped_agent"), "lucy_query", {
      connectionId: "warehouse",
      measures: ["fin_ledger.total_sales"]
    })).resolves.toEqual({ allowed: false, reason: "row_policy_upstream_unproven" });

    // explain stays local-allow without forcedFilters
    await expect(authorizeAndRewrite(identity("scoped_agent"), "lucy_explain_query", {
      connectionId: "warehouse",
      measures: ["fin_ledger.total_sales"]
    })).resolves.toEqual({ allowed: true });
  });

  it("SC-P1-01: OR grants across two roles yield merged scoped grant (or all)", async () => {
    projectRoot = await makeProject(accessYaml(
      `  east_role:
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
                value: East
      tools:
        - lucy_query
  west_role:
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
                value: West
      tools:
        - lucy_query
  all_role:
    permission_model_version: 2
    allow:
      connections: [warehouse]
      tableSelectors:
        - connection: warehouse
          schema: fin
          names: [fin_ledger]
          row_access: all
      tools:
        - lucy_query`,
      `  - id: or_agent
    roles: [east_role, west_role]
    enabled: true
    tokens: []
  - id: all_wins_agent
    roles: [east_role, all_role]
    enabled: true
    tokens: []`
    ));
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const { effectivePermissions } = await loadAcl();

    const orResolved = await effectivePermissions(identity("or_agent"));
    expect(orResolved.ok).toBe(true);
    if (orResolved.ok) {
      const grant = orResolved.permissions.capabilities[0]?.rowGrant;
      expect(grant?.kind).toBe("scoped");
      if (grant?.kind === "scoped") {
        expect(grant.orArms).toHaveLength(2);
      }
    }

    const allWins = await effectivePermissions(identity("all_wins_agent"));
    expect(allWins.ok).toBe(true);
    if (allWins.ok) {
      expect(allWins.permissions.capabilities[0]?.rowGrant).toEqual({ kind: "all" });
    }
  });

  it("proven=true injects forcedFilters on authorizeAndRewrite for lucy_query", async () => {
    projectRoot = await makeProject(accessYaml(
      `  scoped_ok:
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
                value: East
      tools:
        - lucy_query`,
      `  - id: scoped_agent
    role: scoped_ok
    enabled: true
    tokens: []`
    ));
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN = "true";
    const { authorizeAndRewrite } = await loadAcl();

    const decision = await authorizeAndRewrite(identity("scoped_agent"), "lucy_query", {
      connectionId: "warehouse",
      measures: ["fin_ledger.total_sales"]
    });
    expect(decision.allowed).toBe(true);
    expect(decision.forcedFilters).toEqual({
      or: [{
        and: [{ field: "fin_ledger.region", op: "eq", value: "East", values: undefined }]
      }]
    });
  });
});

describe("AC-SEC-ROW / BYPASS", () => {
  /**
   * Full matrix BY-01…19 at ACL decision layer.
   * Mock-KTX row ⊆ domain (BY-01) + explain E1–E5 (BY-18) live in
   * mcp-proxy-row-policy-by01-by18.test.ts. Real KTX 行集抽检 remains UAT / Gate C.
   */
  const eastForced = {
    or: [{
      and: [{ field: "fin_ledger.region", op: "eq", value: "East", values: undefined }]
    }]
  };

  async function loadScopedProven() {
    projectRoot = await makeProject(accessYaml(SCOPED_EAST_ROLE, SCOPED_EAST_AGENT));
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN = "true";
    return loadAcl();
  }

  it("BY-01: proven + no user filter → allowed + forcedFilters present", async () => {
    const { authorizeAndRewrite } = await loadScopedProven();
    const decision = await authorizeAndRewrite(identity("scoped_agent"), "lucy_query", {
      connectionId: "warehouse",
      measures: ["fin_ledger.total_sales"]
    });
    expect(decision).toEqual({ allowed: true, forcedFilters: eastForced });
  });

  it("BY-02/13: filter boolean tree {or:[...]} → row_policy_query_shape_forbidden", async () => {
    const { authorizeAndRewrite } = await loadScopedProven();
    await expect(authorizeAndRewrite(identity("scoped_agent"), "lucy_query", {
      connectionId: "warehouse",
      measures: ["fin_ledger.total_sales"],
      filters: [{ or: [{ field: "fin_ledger.region", op: "eq", value: "West" }] }]
    })).resolves.toEqual({ allowed: false, reason: "row_policy_query_shape_forbidden" });
  });

  it("BY-03: string filters deny on scoped", async () => {
    const { authorizeAndRewrite } = await loadScopedProven();
    await expect(authorizeAndRewrite(identity("scoped_agent"), "lucy_query", {
      connectionId: "warehouse",
      measures: ["fin_ledger.total_sales"],
      filters: ["region = 'West'"]
    })).resolves.toEqual({
      allowed: false,
      reason: "invalid_arguments:lucy_query:filters_string_forbidden_on_scoped"
    });
  });

  it("BY-04: measures with expr deny on scoped", async () => {
    const { authorizeAndRewrite } = await loadScopedProven();
    // Keep a source-qualified measure so extractTables reaches FinalRows scoped gate.
    await expect(authorizeAndRewrite(identity("scoped_agent"), "lucy_query", {
      connectionId: "warehouse",
      measures: ["fin_ledger.total_sales", { expr: "sum(x)", name: "hack" }]
    })).resolves.toEqual({
      allowed: false,
      reason: "invalid_arguments:lucy_query:measures_expr_forbidden_on_scoped"
    });
  });

  it("BY-05: applyLucyQueryForcedFilters strips user forged field and applies Proxy payload", async () => {
    vi.resetModules();
    const { applyLucyQueryForcedFilters } = await import("../proxy/row-policy");
    const payload = {
      or: [{ and: [{ field: "fin_ledger.region", op: "eq" as const, value: "East" }] }]
    };
    const out = applyLucyQueryForcedFilters({
      connectionId: "warehouse",
      measures: ["fin_ledger.total_sales"],
      forced_filters: { or: [{ and: [{ field: "fin_ledger.region", op: "eq", value: "West" }] }] },
      forcedFilters: { or: [{ and: [{ field: "fin_ledger.region", op: "eq", value: "North" }] }] }
    }, payload);
    expect(out.forcedFilters).toBeUndefined();
    expect(out.forced_filters).toEqual(payload);
    expect(out.filters).toEqual(["(fin_ledger.region = 'East')"]);
    expect(out.measures).toEqual(["fin_ledger.total_sales"]);
  });

  it("compileForcedFiltersToUpstreamFilterExprs rejects unsafe field fragments", async () => {
    const { compileForcedFiltersToUpstreamFilterExprs } = await import("../proxy/row-policy");
    expect(() => compileForcedFiltersToUpstreamFilterExprs({
      or: [{ and: [{ field: "fin_ledger.region) OR 1=1 --", op: "eq", value: "East" }] }]
    })).toThrow(/unsafe/);
  });

  it("BY-06/07/17: unwrapped tools deny on protected source", async () => {
    projectRoot = await makeProject(accessYaml(SCOPED_EAST_ROLE, SCOPED_EAST_AGENT));
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const { authorizeAndRewrite } = await loadAcl();
    const args = { connectionId: "warehouse", sourceName: "fin_ledger" };
    for (const tool of ["lucy_read_source", "entity_details", "sl_validate", "lucy_freshness"] as const) {
      await expect(authorizeAndRewrite(identity("scoped_agent"), tool, args)).resolves.toEqual({
        allowed: false,
        reason: "row_policy_requires_wrapped_tool"
      });
    }
  });

  it("BY-08: sl_query → tool_absolute_deny", async () => {
    projectRoot = await makeProject(accessYaml(SCOPED_EAST_ROLE, SCOPED_EAST_AGENT));
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const { authorizeAndRewrite } = await loadAcl();
    await expect(authorizeAndRewrite(identity("scoped_agent"), "sl_query", {
      connectionId: "warehouse",
      measures: ["fin_ledger.total_sales"]
    })).resolves.toEqual({ allowed: false, reason: "tool_absolute_deny:sl_query" });
  });

  it("BY-09: unproven lucy_query denies on protected source", async () => {
    projectRoot = await makeProject(accessYaml(SCOPED_EAST_ROLE, SCOPED_EAST_AGENT));
    process.env.KTX_PROJECT_ROOT = projectRoot;
    delete process.env.LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN;
    const { authorizeAndRewrite } = await loadAcl();
    await expect(authorizeAndRewrite(identity("scoped_agent"), "lucy_query", {
      connectionId: "warehouse",
      measures: ["fin_ledger.total_sales"]
    })).resolves.toEqual({ allowed: false, reason: "row_policy_upstream_unproven" });
  });

  it("BY-10: OR arms across two roles yield merged scoped grant", async () => {
    projectRoot = await makeProject(accessYaml(
      `  east_role:
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
                value: East
      tools:
        - lucy_query
  west_role:
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
                value: West
      tools:
        - lucy_query`,
      `  - id: or_agent
    roles: [east_role, west_role]
    enabled: true
    tokens: []`
    ));
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN = "true";
    const { authorizeAndRewrite, effectivePermissions } = await loadAcl();

    const resolved = await effectivePermissions(identity("or_agent"));
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      const grant = resolved.permissions.capabilities[0]?.rowGrant;
      expect(grant?.kind).toBe("scoped");
      if (grant?.kind === "scoped") expect(grant.orArms).toHaveLength(2);
    }

    const decision = await authorizeAndRewrite(identity("or_agent"), "lucy_query", {
      connectionId: "warehouse",
      measures: ["fin_ledger.total_sales"]
    });
    expect(decision.allowed).toBe(true);
    expect(decision.forcedFilters?.or).toHaveLength(2);
  });

  it("BY-11: one scoped + one all injects; two scoped sources deny", async () => {
    projectRoot = await makeProject(accessYaml(
      `  mixed_role:
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
                value: East
        - connection: warehouse
          schema: fin
          names: [fin_budget]
          row_access: all
      tools:
        - lucy_query
  dual_scoped:
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
                value: East
        - connection: warehouse
          schema: fin
          names: [fin_budget]
          row_access: scoped
          row_policy:
            predicates:
              - field: region
                op: eq
                value: East
      tools:
        - lucy_query`,
      `  - id: mixed_agent
    role: mixed_role
    enabled: true
    tokens: []
  - id: dual_agent
    role: dual_scoped
    enabled: true
    tokens: []`
    ));
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN = "true";
    const { authorizeAndRewrite } = await loadAcl();

    // Ledger only → inject
    await expect(authorizeAndRewrite(identity("mixed_agent"), "lucy_query", {
      connectionId: "warehouse",
      measures: ["fin_ledger.total_sales"]
    })).resolves.toEqual({ allowed: true, forcedFilters: eastForced });

    // Both sources, one scoped → allow + inject (scopedSources.length === 1)
    await expect(authorizeAndRewrite(identity("mixed_agent"), "lucy_query", {
      connectionId: "warehouse",
      measures: ["fin_ledger.total_sales", "fin_budget.budget_amount"]
    })).resolves.toEqual({ allowed: true, forcedFilters: eastForced });

    // Two scoped sources in one query → shape forbidden
    await expect(authorizeAndRewrite(identity("dual_agent"), "lucy_query", {
      connectionId: "warehouse",
      measures: ["fin_ledger.total_sales", "fin_budget.budget_amount"]
    })).resolves.toEqual({ allowed: false, reason: "row_policy_query_shape_forbidden" });
  });

  it("BY-12/14/15/16: joins / subquery / having → shape forbidden", async () => {
    const { authorizeAndRewrite } = await loadScopedProven();
    const base = {
      connectionId: "warehouse",
      measures: ["fin_ledger.total_sales"]
    };
    // Shapes must not introduce unauthorized tables before the scoped shape gate.
    for (const shape of [
      { joins: [{}] },
      { join: {} },
      { leftJoin: [{}] },
      { left_join: [{}] },
      { subquery: "select 1" },
      { subqueries: [{}] },
      { having: "count(*) > 1" },
      { from: "fin_ledger" }
    ]) {
      await expect(authorizeAndRewrite(identity("scoped_agent"), "lucy_query", {
        ...base,
        ...shape
      })).resolves.toEqual({ allowed: false, reason: "row_policy_query_shape_forbidden" });
    }
  });

  it("BY-18: lucy_explain_query allowed on scoped without forcedFilters (ACL); E1–E5 in mcp-proxy suite", async () => {
    projectRoot = await makeProject(accessYaml(SCOPED_EAST_ROLE, SCOPED_EAST_AGENT));
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const { authorizeAndRewrite } = await loadAcl();
    const {
      buildExplainForcedPredicateDiagnostics,
      buildForcedFiltersPayload
    } = await import("../proxy/row-policy");

    await expect(authorizeAndRewrite(identity("scoped_agent"), "lucy_explain_query", {
      connectionId: "warehouse",
      measures: ["fin_ledger.total_sales"]
    })).resolves.toEqual({ allowed: true });

    const { effectivePermissions } = await loadAcl();
    const resolved = await effectivePermissions(identity("scoped_agent"));
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const diagnostics = buildExplainForcedPredicateDiagnostics({
      capabilities: resolved.permissions.capabilities,
      requestedSources: [{ connectionId: "warehouse", sourceName: "fin_ledger" }]
    });
    expect(diagnostics.semantics).toBe("permission_forced_predicate_diagnostic");
    expect(diagnostics.upstreamForwarded).toBe(false);
    expect(diagnostics.containsResultRows).toBe(false);
    expect(diagnostics.finalRowsNonTrue).toBe(true);
    expect(diagnostics.forcedPredicateAst?.digests.length).toBeGreaterThan(0);
    expect(diagnostics.forcedPredicateAst?.forcedFilters).toEqual(
      buildForcedFiltersPayload(
        resolved.permissions.capabilities.find((c) => c.rowGrant.kind === "scoped")!.rowGrant,
        "fin_ledger"
      )
    );
    expect(diagnostics.executionPath.wouldDeny).toBe(true);
    expect(diagnostics.executionPath.denyReason).toBe("row_policy_upstream_unproven");
  });

  it("BY-19: measure field in row_policy fails compilation", async () => {
    projectRoot = await makeProject(accessYaml(
      `  measure_field:
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
              - field: total_sales
                op: eq
                value: 1
${BASE_ROLE_TOOLS}`,
      `  - id: measure_agent
    role: measure_field
    enabled: true
    tokens: []`
    ));
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const { effectivePermissions } = await loadAcl();
    const resolved = await effectivePermissions(identity("measure_agent"));
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) expect(resolved.reason).toMatch(/row_policy_field_unresolved:measure/);
  });

  it("§3.2 catalog: _schema physical + proven row-level computed bind; agg/window/cross-source do not", async () => {
    projectRoot = await makeProject(accessYaml(
      `  physical_ok:
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
                value: East
${BASE_ROLE_TOOLS}
  computed_ok:
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
              - field: order_year
                op: eq
                value: 2024
${BASE_ROLE_TOOLS}
  agg_bad:
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
              - field: total_by_region
                op: eq
                value: 1
${BASE_ROLE_TOOLS}
  window_bad:
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
              - field: region_rank
                op: eq
                value: 1
${BASE_ROLE_TOOLS}
  cross_bad:
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
              - field: other_region
                op: eq
                value: East
${BASE_ROLE_TOOLS}`,
      `  - id: physical_agent
    role: physical_ok
    enabled: true
    tokens: []
  - id: computed_agent
    role: computed_ok
    enabled: true
    tokens: []
  - id: agg_agent
    role: agg_bad
    enabled: true
    tokens: []
  - id: window_agent
    role: window_bad
    enabled: true
    tokens: []
  - id: cross_agent
    role: cross_bad
    enabled: true
    tokens: []`
    ));
    // Overlay-only name with no expr must not become bindable when absent from _schema.
    await writeFile(
      path.join(projectRoot, "semantic-layer", "warehouse", "fin_ledger.yaml"),
      `columns:
  - name: region
  - name: overlay_only_ghost
  - name: order_year
    expr: year(fin_ledger.order_date)
  - name: total_by_region
    expr: sum(fin_ledger.category)
  - name: region_rank
    expr: rank() over (partition by fin_ledger.region)
  - name: other_region
    expr: fin_budget.region
measures:
  - name: total_sales
  - name: profit_margin
`,
      "utf8"
    );
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const { effectivePermissions } = await loadAcl();
    const {
      loadSourceFieldCatalog,
      isProvenRowLevelExpr,
      resetRowPolicyCatalogCacheForTests
    } = await import("../proxy/row-policy");
    resetRowPolicyCatalogCacheForTests();

    const catalog = await loadSourceFieldCatalog("warehouse", "fin_ledger", "fin");
    expect(catalog).not.toBeNull();
    expect(catalog!.columns.has("region")).toBe(true);
    expect(catalog!.columns.has("order_year")).toBe(true);
    expect(catalog!.columns.has("total_by_region")).toBe(false);
    expect(catalog!.columns.has("region_rank")).toBe(false);
    expect(catalog!.columns.has("other_region")).toBe(false);
    expect(catalog!.columns.has("overlay_only_ghost")).toBe(false);

    const physical = new Set(["region", "order_date", "category"]);
    expect(isProvenRowLevelExpr("year(fin_ledger.order_date)", "fin_ledger", physical)).toBe(true);
    expect(isProvenRowLevelExpr("sum(fin_ledger.category)", "fin_ledger", physical)).toBe(false);
    expect(isProvenRowLevelExpr("rank() over (partition by fin_ledger.region)", "fin_ledger", physical)).toBe(
      false
    );
    expect(isProvenRowLevelExpr("fin_budget.region", "fin_ledger", physical)).toBe(false);

    const physicalOk = await effectivePermissions(identity("physical_agent"));
    expect(physicalOk.ok).toBe(true);
    const computedOk = await effectivePermissions(identity("computed_agent"));
    expect(computedOk.ok).toBe(true);
    for (const userId of ["agg_agent", "window_agent", "cross_agent"] as const) {
      const resolved = await effectivePermissions(identity(userId));
      expect(resolved.ok).toBe(false);
      if (!resolved.ok) expect(resolved.reason).toMatch(/row_policy_field_unresolved/);
    }
  });

  it("Spec 99 §7: v1 + scoped fails with v1_scoped_forbidden", async () => {
    projectRoot = await makeProject(accessYaml(
      `  v1_scoped:
    permission_model_version: 1
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
                value: East
${BASE_ROLE_TOOLS}`,
      `  - id: v1_scoped_agent
    role: v1_scoped
    enabled: true
    tokens: []`
    ));
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const { effectivePermissions } = await loadAcl();
    await expect(effectivePermissions(identity("v1_scoped_agent"))).resolves.toEqual({
      ok: false,
      reason: "role_resolution_failed:v1_scoped:v1_scoped_forbidden"
    });
  });
});
