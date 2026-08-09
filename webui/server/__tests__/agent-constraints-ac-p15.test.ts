import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Identity } from "../proxy/identity";
import {
  MAX_CONSTRAINT_PREDICATES_PER_SOURCE,
  MAX_PREDICATES_PER_DNF_ARM,
  MAX_ROLE_ARMS_PER_SOURCE,
  compileFinalRowsBySource,
  finalRowsDigest,
  isAndGroupUnsatisfiable,
  synthesizeFinalRows,
  type CapabilitySourceRef
} from "../proxy/agent-constraints";
import type { ResolvedRowPolicyPredicate, RowGrant } from "../proxy/row-policy";

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
      - name: department
  fin_budget:
    table: fin.fin_budget
    columns:
      - name: region
      - name: department
`;

const FIN_LEDGER_OVERLAY_YAML = `columns:
  - name: region
  - name: category
  - name: department
measures:
  - name: total_sales
`;

const FIN_BUDGET_OVERLAY_YAML = `columns:
  - name: region
  - name: department
measures:
  - name: budget_amount
`;

const BASE_ROLE_TOOLS = `      tools:
        - lucy_query
        - lucy_read_source
        - lucy_explain_query
        - lucy_freshness
        - entity_details
        - sl_validate`;

function accessYaml(rolesBlock: string, usersBlock: string): string {
  return `roles:
${rolesBlock}
users:
${usersBlock}
defaults:
  deny_tools: []
`;
}

const ALL_LEDGER_ROLE = `  ledger_all:
    permission_model_version: 2
    allow:
      connections: [warehouse]
      tableSelectors:
        - connection: warehouse
          schema: fin
          names: [fin_ledger]
          row_access: all
${BASE_ROLE_TOOLS}`;

let projectRoot: string;
let previousRoot: string | undefined;
let previousProven: string | undefined;

function identity(userId: string): Identity {
  return { userId, tokenLabel: "unit-test", tokenHashPrefix: "unit-test" };
}

async function makeProject(yaml: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ktx-agent-constraints-ac-p15-"));
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

beforeEach(() => {
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

describe("AC-P1.5 Agent Constraints compile (WP-I1)", () => {
  it("SC-P15-03: legal constraints compile; illegal op / measure / unknown source fail", async () => {
    projectRoot = await makeProject(accessYaml(
      ALL_LEDGER_ROLE,
      `  - id: ok_constraints
    role: ledger_all
    enabled: true
    tokens: []
    constraints:
      sources:
        - connection: warehouse
          schema: fin
          names: [fin_ledger]
          predicates:
            - field: region
              op: eq
              value: East
  - id: bad_op
    role: ledger_all
    enabled: true
    tokens: []
    constraints:
      sources:
        - connection: warehouse
          schema: fin
          names: [fin_ledger]
          predicates:
            - field: region
              op: ne
              value: East
  - id: measure_field
    role: ledger_all
    enabled: true
    tokens: []
    constraints:
      sources:
        - connection: warehouse
          schema: fin
          names: [fin_ledger]
          predicates:
            - field: total_sales
              op: eq
              value: 1
  - id: unknown_source
    role: ledger_all
    enabled: true
    tokens: []
    constraints:
      sources:
        - connection: warehouse
          schema: fin
          names: [fin_budget]
          predicates:
            - field: department
              op: eq
              value: Finance`
    ));
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const { effectivePermissions } = await loadAcl();

    const ok = await effectivePermissions(identity("ok_constraints"));
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      const keys = Object.keys(ok.permissions.agentConstraintsBySource ?? {});
      expect(keys.length).toBe(1);
      const preds = Object.values(ok.permissions.agentConstraintsBySource ?? {})[0];
      expect(preds?.[0]?.field).toBe("region");
      expect(preds?.[0]?.value).toBe("East");
    }

    const badOp = await effectivePermissions(identity("bad_op"));
    expect(badOp.ok).toBe(false);
    if (!badOp.ok) expect(badOp.reason).toMatch(/row_policy_op_forbidden|constraints_invalid_shape/);

    const measure = await effectivePermissions(identity("measure_field"));
    expect(measure.ok).toBe(false);
    if (!measure.ok) expect(measure.reason).toMatch(/row_policy_field_unresolved/);

    const unknown = await effectivePermissions(identity("unknown_source"));
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.reason).toBe("constraints_source_not_in_capability");
  });

  it("Spec 100 §4: mixed valid+invalid names fail (no silent drop)", async () => {
    projectRoot = await makeProject(accessYaml(
      ALL_LEDGER_ROLE,
      `  - id: mixed_names
    role: ledger_all
    enabled: true
    tokens: []
    constraints:
      sources:
        - connection: warehouse
          schema: fin
          names: [fin_ledger, typo_or_unauthorized]
          predicates:
            - field: region
              op: eq
              value: East`
    ));
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const { effectivePermissions } = await loadAcl();
    const result = await effectivePermissions(identity("mixed_names"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("constraints_source_not_in_capability");
  });

  it("SC-P15-04: Role constraints still forbidden", async () => {
    projectRoot = await makeProject(accessYaml(
      `  bad_role:
    permission_model_version: 2
    constraints:
      sources: []
    allow:
      connections: [warehouse]
      tableSelectors:
        - connection: warehouse
          schema: fin
          names: [fin_ledger]
          row_access: all
${BASE_ROLE_TOOLS}`,
      `  - id: role_constraints_agent
    role: bad_role
    enabled: true
    tokens: []`
    ));
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const { effectivePermissions } = await loadAcl();
    const result = await effectivePermissions(identity("role_constraints_agent"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("constraints_forbidden_on_role");
  });

  it("SC-P15-09: role-arm overflow without constraints fails (absorbed R)", () => {
    const orArms = Array.from({ length: MAX_ROLE_ARMS_PER_SOURCE + 1 }, (_, i) => [
      { field: "region", sourceName: "fin_ledger", op: "eq" as const, value: `R${i}` }
    ]);
    const source: CapabilitySourceRef = {
      connectionId: "warehouse",
      sourceName: "fin_ledger",
      schema: "fin",
      physicalTable: "fin.fin_ledger",
      rowGrant: {
        kind: "scoped",
        digest: "overflow-arms",
        predicates: orArms.flat(),
        orArms
      }
    };
    const compiled = compileFinalRowsBySource([source], undefined);
    expect(compiled.ok).toBe(false);
    if (!compiled.ok) expect(compiled.reason).toBe("final_rows_limit_exceeded");
  });

  it("SC-P15-09: absorbed R arm > MAX_PREDICATES_PER_DNF_ARM fails", () => {
    const arm = Array.from({ length: MAX_PREDICATES_PER_DNF_ARM + 1 }, (_, i) => ({
      field: `col_${i}`,
      sourceName: "fin_ledger",
      op: "eq" as const,
      value: "x"
    }));
    const source: CapabilitySourceRef = {
      connectionId: "warehouse",
      sourceName: "fin_ledger",
      schema: "fin",
      physicalTable: "fin.fin_ledger",
      rowGrant: {
        kind: "scoped",
        digest: "overflow-arm-leaves",
        predicates: arm,
        orArms: [arm]
      }
    };
    const compiled = compileFinalRowsBySource([source], undefined);
    expect(compiled.ok).toBe(false);
    if (!compiled.ok) expect(compiled.reason).toBe("final_rows_limit_exceeded");
  });

  it("SC-P15-09: constraint predicate overflow compile fails", async () => {
    // Compatible overlapping `in` sets (not unsatisfiable) but count > MAX.
    const preds = Array.from({ length: MAX_CONSTRAINT_PREDICATES_PER_SOURCE + 1 }, () => `            - field: region
              op: in
              values: [East, West, Central]`).join("\n");
    projectRoot = await makeProject(accessYaml(
      ALL_LEDGER_ROLE,
      `  - id: overflow_agent
    role: ledger_all
    enabled: true
    tokens: []
    constraints:
      sources:
        - connection: warehouse
          schema: fin
          names: [fin_ledger]
          predicates:
${preds}`
    ));
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const { effectivePermissions } = await loadAcl();
    const result = await effectivePermissions(identity("overflow_agent"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("final_rows_limit_exceeded");
  });

  it("SC-P15-09 / §5.4: unsatisfiable constraints AND → final_rows_unsatisfiable", async () => {
    projectRoot = await makeProject(accessYaml(
      ALL_LEDGER_ROLE,
      `  - id: unsat_agent
    role: ledger_all
    enabled: true
    tokens: []
    constraints:
      sources:
        - connection: warehouse
          schema: fin
          names: [fin_ledger]
          predicates:
            - field: region
              op: eq
              value: East
            - field: region
              op: eq
              value: West`
    ));
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const { effectivePermissions } = await loadAcl();
    const result = await effectivePermissions(identity("unsat_agent"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("final_rows_unsatisfiable");
  });

  it("no constraints key keeps AC-P1 compile path (Constraints≡TRUE)", async () => {
    projectRoot = await makeProject(accessYaml(
      ALL_LEDGER_ROLE,
      `  - id: plain_agent
    role: ledger_all
    enabled: true
    tokens: []`
    ));
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const { effectivePermissions } = await loadAcl();
    const result = await effectivePermissions(identity("plain_agent"));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.permissions.agentConstraintsBySource).toBeUndefined();
  });
});

describe("isAndGroupUnsatisfiable (Spec 100 §5.4)", () => {
  function pred(
    partial: Partial<ResolvedRowPolicyPredicate> & Pick<ResolvedRowPolicyPredicate, "field" | "op">
  ): ResolvedRowPolicyPredicate {
    return { sourceName: "fin_ledger", ...partial };
  }

  it("detects eq conflict without case-folding values", () => {
    expect(
      isAndGroupUnsatisfiable([
        pred({ field: "region", op: "eq", value: "ABC" }),
        pred({ field: "region", op: "eq", value: "abc" })
      ])
    ).toBe(true);
    expect(
      isAndGroupUnsatisfiable([
        pred({ field: "region", op: "eq", value: "ABC" }),
        pred({ field: "region", op: "in", values: ["ABC", "West"] })
      ])
    ).toBe(false);
  });
});

describe("AC-P1.5 FinalRows AND (WP-I2)", () => {
  function pred(
    partial: Partial<ResolvedRowPolicyPredicate> & Pick<ResolvedRowPolicyPredicate, "field" | "op">
  ): ResolvedRowPolicyPredicate {
    return { sourceName: "fin_ledger", ...partial };
  }

  it("synthesizeFinalRows: TRUE ∧ C → C; prune East∨West ∧ East → East", () => {
    const c = [pred({ field: "region", op: "eq", value: "East" })];
    const fromTrue = synthesizeFinalRows({ kind: "all" }, c);
    expect(fromTrue.ok).toBe(true);
    if (fromTrue.ok) {
      expect(fromTrue.finalRows.kind).toBe("scoped");
      if (fromTrue.finalRows.kind === "scoped") {
        expect(fromTrue.finalRows.orArms).toHaveLength(1);
        expect(fromTrue.finalRows.orArms[0]?.[0]?.value).toBe("East");
      }
    }

    const eastWest: RowGrant = {
      kind: "scoped",
      digest: "x",
      predicates: [],
      orArms: [
        [pred({ field: "region", op: "eq", value: "East" })],
        [pred({ field: "region", op: "eq", value: "West" })]
      ]
    };
    const pruned = synthesizeFinalRows(eastWest, c);
    expect(pruned.ok).toBe(true);
    if (pruned.ok && pruned.finalRows.kind === "scoped") {
      expect(pruned.finalRows.orArms).toHaveLength(1);
      expect(pruned.finalRows.orArms[0]?.map((p) => p.value)).toEqual(["East", "East"]);
    }

    const empty = synthesizeFinalRows(eastWest, [pred({ field: "region", op: "eq", value: "North" })]);
    expect(empty.ok).toBe(false);
  });

  it("finalRowsDigest preserves string case (ABC ≠ abc)", () => {
    const armAbc = [[pred({ field: "department", op: "in", values: ["ABC"] })]];
    const armAbcLower = [[pred({ field: "department", op: "in", values: ["abc"] })]];
    expect(finalRowsDigest(armAbc)).not.toBe(finalRowsDigest(armAbcLower));
  });

  it("SC-P15-01: OR→TRUE + constraints tightens FinalRows; injects on lucy_query", async () => {
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
${BASE_ROLE_TOOLS}
  all_role:
    permission_model_version: 2
    allow:
      connections: [warehouse]
      tableSelectors:
        - connection: warehouse
          schema: fin
          names: [fin_ledger]
          row_access: all
${BASE_ROLE_TOOLS}`,
      `  - id: tighten_agent
    roles: [east_role, all_role]
    enabled: true
    tokens: []
    constraints:
      sources:
        - connection: warehouse
          schema: fin
          names: [fin_ledger]
          predicates:
            - field: region
              op: eq
              value: East`
    ));
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN = "true";
    const { effectivePermissions, authorizeAndRewrite } = await loadAcl();

    const resolved = await effectivePermissions(identity("tighten_agent"));
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      // EffectiveRowGrant stays OR→TRUE (all wins).
      expect(resolved.permissions.capabilities[0]?.rowGrant).toEqual({ kind: "all" });
      const finalRows = Object.values(resolved.permissions.finalRowsBySource ?? {})[0];
      expect(finalRows?.kind).toBe("scoped");
      if (finalRows?.kind === "scoped") {
        expect(finalRows.orArms).toHaveLength(1);
        expect(finalRows.orArms[0]?.[0]?.value).toBe("East");
      }
    }

    const decision = await authorizeAndRewrite(identity("tighten_agent"), "lucy_query", {
      connectionId: "warehouse",
      measures: ["fin_ledger.total_sales"]
    });
    expect(decision.allowed).toBe(true);
    expect(decision.forcedFilters).toEqual({
      or: [{ and: [{ field: "fin_ledger.region", op: "eq", value: "East" }] }]
    });
  });

  it("SC-P15-02: no constraints → FinalRows equals EffectiveRowGrant (P1 regression)", async () => {
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
      `  - id: plain_scoped
    role: scoped_ok
    enabled: true
    tokens: []`
    ));
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const { effectivePermissions } = await loadAcl();
    const resolved = await effectivePermissions(identity("plain_scoped"));
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      const grant = resolved.permissions.capabilities[0]?.rowGrant;
      const finalRows = Object.values(resolved.permissions.finalRowsBySource ?? {})[0];
      expect(grant?.kind).toBe("scoped");
      expect(finalRows?.kind).toBe("scoped");
      if (grant?.kind === "scoped" && finalRows?.kind === "scoped") {
        expect(finalRows.orArms).toHaveLength(grant.orArms.length);
        expect(finalRows.orArms[0]?.[0]?.value).toBe("East");
      }
    }
  });

  it("SC-P15-09: East∨West ∧ Constraints=East prunes at compile (natural tighten)", async () => {
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
${BASE_ROLE_TOOLS}
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
${BASE_ROLE_TOOLS}`,
      `  - id: prune_agent
    roles: [east_role, west_role]
    enabled: true
    tokens: []
    constraints:
      sources:
        - connection: warehouse
          schema: fin
          names: [fin_ledger]
          predicates:
            - field: region
              op: eq
              value: East`
    ));
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const { effectivePermissions } = await loadAcl();
    const resolved = await effectivePermissions(identity("prune_agent"));
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      const grant = resolved.permissions.capabilities[0]?.rowGrant;
      expect(grant?.kind).toBe("scoped");
      if (grant?.kind === "scoped") expect(grant.orArms).toHaveLength(2);
      const finalRows = Object.values(resolved.permissions.finalRowsBySource ?? {})[0];
      expect(finalRows?.kind).toBe("scoped");
      if (finalRows?.kind === "scoped") {
        expect(finalRows.orArms).toHaveLength(1);
      }
    }
  });

  it("SC-P15-09: East∨West ∧ Constraints=North → compile fail", async () => {
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
${BASE_ROLE_TOOLS}
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
${BASE_ROLE_TOOLS}`,
      `  - id: empty_prune_agent
    roles: [east_role, west_role]
    enabled: true
    tokens: []
    constraints:
      sources:
        - connection: warehouse
          schema: fin
          names: [fin_ledger]
          predicates:
            - field: region
              op: eq
              value: North`
    ));
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const { effectivePermissions } = await loadAcl();
    const resolved = await effectivePermissions(identity("empty_prune_agent"));
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) expect(resolved.reason).toBe("final_rows_unsatisfiable");
  });
});

describe("AC-P1.5 gate + forced predicate reuse (WP-I3)", () => {
  /**
   * Spec 100 §7 / O-P15-4: Role row_access:all + Agent Constraints → FinalRows≠TRUE
   * must reuse AC-P1 wrap / proven / forced_filters path (no second injection).
   */
  const ALL_PLUS_DEPT_CONSTRAINTS_AGENT = `  - id: all_constrained
    role: ledger_all
    enabled: true
    tokens: []
    constraints:
      sources:
        - connection: warehouse
          schema: fin
          names: [fin_ledger]
          predicates:
            - field: department
              op: in
              values: [ABC]`;

  const deptForced = {
    or: [{
      and: [{ field: "fin_ledger.department", op: "in", values: ["ABC"] }]
    }]
  };

  async function loadAllConstrained(proven: boolean) {
    projectRoot = await makeProject(accessYaml(ALL_LEDGER_ROLE, ALL_PLUS_DEPT_CONSTRAINTS_AGENT));
    process.env.KTX_PROJECT_ROOT = projectRoot;
    if (proven) process.env.LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN = "true";
    else delete process.env.LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN;
    return loadAcl();
  }

  it("SC-P15-05: FinalRows≠TRUE → unwrapped tools deny; lucy_query+proven injects Constraints", async () => {
    const { effectivePermissions, authorizeAndRewrite } = await loadAllConstrained(true);

    const resolved = await effectivePermissions(identity("all_constrained"));
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.permissions.capabilities[0]?.rowGrant).toEqual({ kind: "all" });
      const finalRows = Object.values(resolved.permissions.finalRowsBySource ?? {})[0];
      expect(finalRows?.kind).toBe("scoped");
      if (finalRows?.kind === "scoped") {
        expect(finalRows.orArms).toHaveLength(1);
        expect(finalRows.orArms[0]?.[0]).toMatchObject({
          field: "department",
          op: "in",
          values: ["ABC"]
        });
      }
    }

    const args = { connectionId: "warehouse", sourceName: "fin_ledger" };
    for (const tool of ["lucy_read_source", "lucy_freshness", "entity_details"] as const) {
      await expect(authorizeAndRewrite(identity("all_constrained"), tool, args)).resolves.toEqual({
        allowed: false,
        reason: "row_policy_requires_wrapped_tool"
      });
    }

    const decision = await authorizeAndRewrite(identity("all_constrained"), "lucy_query", {
      connectionId: "warehouse",
      measures: ["fin_ledger.total_sales"]
    });
    expect(decision).toEqual({ allowed: true, forcedFilters: deptForced });
  });

  it("SC-P15-06: proven≠true → row_policy_upstream_unproven (Constraints do not bypass)", async () => {
    const { authorizeAndRewrite } = await loadAllConstrained(false);

    await expect(authorizeAndRewrite(identity("all_constrained"), "lucy_query", {
      connectionId: "warehouse",
      measures: ["fin_ledger.total_sales"]
    })).resolves.toEqual({ allowed: false, reason: "row_policy_upstream_unproven" });

    // explain stays local-allow without forcedFilters (Spec 100 §7 / Spec 99)
    await expect(authorizeAndRewrite(identity("all_constrained"), "lucy_explain_query", {
      connectionId: "warehouse",
      measures: ["fin_ledger.total_sales"]
    })).resolves.toEqual({ allowed: true });
  });

  it("BY-05 Constraints: applyLucyQueryForcedFilters strips user forged field; Proxy payload wins", async () => {
    vi.resetModules();
    const { applyLucyQueryForcedFilters } = await import("../proxy/row-policy");
    const out = applyLucyQueryForcedFilters({
      connectionId: "warehouse",
      measures: ["fin_ledger.total_sales"],
      forced_filters: { or: [{ and: [{ field: "fin_ledger.department", op: "in", values: ["WEST"] }] }] },
      forcedFilters: { or: [{ and: [{ field: "fin_ledger.region", op: "eq", value: "North" }] }] }
    }, deptForced);
    expect(out.forcedFilters).toBeUndefined();
    expect(out.forced_filters).toEqual(deptForced);
    expect(out.filters).toEqual(["(fin_ledger.department IN ('ABC'))"]);
    expect(out.measures).toEqual(["fin_ledger.total_sales"]);
  });
});
