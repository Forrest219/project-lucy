import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Identity } from "../proxy/identity";

/**
 * Spec 98 §11 / design-upgrade §6.4 — AC-P0 Security Eval suite.
 * Case IDs: AC-SEC-SL / CLS / CAP / KEY / SCOPE
 */

const ACCESS_YAML = `roles:
  finance:
    permission_model_version: 2
    allow:
      connections: [warehouse]
      tableSelectors:
        - connection: warehouse
          schema: fin
          names: [fin_ledger]
          row_access: all
      tools: [lucy_query, lucy_read_source, wiki_search]
  public_reader:
    permission_model_version: 2
    allow:
      connections: [warehouse]
      tableSelectors:
        - connection: warehouse
          schema: fin
          names: [pub_orders]
          row_access: all
      tools: [lucy_read_source, wiki_read]
users:
  - id: multi_role
    name: Multi
    enabled: true
    roles: [finance, public_reader]
    tokens: []
  - id: keyed_a
    name: Keyed A
    enabled: true
    role: finance
    tokens: []
defaults:
  deny_tools: []
`;

const SCHEMA_A = `tables:
  fin_ledger:
    table: fin.fin_ledger
    columns:
      - name: region
      - name: amount
  pub_orders:
    table: pub.pub_orders
`;

const SCHEMA_DUP = `tables:
  fin_ledger:
    table: fin.fin_ledger
`;

let projectRoot: string;
let previousRoot: string | undefined;

function identity(userId: string): Identity {
  return { userId, tokenLabel: "sec-eval", tokenHashPrefix: "sec-eval" };
}

async function loadAcl() {
  vi.resetModules();
  return import("../proxy/acl");
}

beforeEach(async () => {
  previousRoot = process.env.KTX_PROJECT_ROOT;
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "ktx-ac-sec-"));
  await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
  await mkdir(path.join(projectRoot, "semantic-layer", "warehouse", "_schema"), { recursive: true });
  await mkdir(path.join(projectRoot, "semantic-layer", "other", "_schema"), { recursive: true });
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
  await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), ACCESS_YAML, "utf8");
  await writeFile(path.join(projectRoot, "semantic-layer", "warehouse", "_schema", "fin.yaml"), SCHEMA_A, "utf8");
  await writeFile(path.join(projectRoot, "semantic-layer", "other", "_schema", "fin.yaml"), SCHEMA_DUP, "utf8");
  process.env.KTX_PROJECT_ROOT = projectRoot;
});

afterEach(async () => {
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  await rm(projectRoot, { recursive: true, force: true });
});

describe("AC-SEC-SL", () => {
  it("denies native sl_* AbsoluteDeny tools", async () => {
    const { authorizeAndRewrite, commitEffectivePolicy } = await loadAcl();
    await commitEffectivePolicy();
    await expect(authorizeAndRewrite(identity("keyed_a"), "sl_query", {
      connectionId: "warehouse",
      measures: ["fin_ledger.amount"]
    })).resolves.toEqual({ allowed: false, reason: "tool_absolute_deny:sl_query" });
    await expect(authorizeAndRewrite(identity("keyed_a"), "sl_read_source", {
      sourceName: "fin_ledger"
    })).resolves.toEqual({ allowed: false, reason: "tool_absolute_deny:sl_read_source" });
  });
});

describe("AC-SEC-CLS", () => {
  it("denies unclassified tools as AbsoluteDeny", async () => {
    const { authorizeAndRewrite, commitEffectivePolicy } = await loadAcl();
    await commitEffectivePolicy();
    await expect(authorizeAndRewrite(identity("keyed_a"), "totally_unknown_tool_xyz", {}))
      .resolves.toEqual({ allowed: false, reason: "tool_unclassified:totally_unknown_tool_xyz" });
  });
});

describe("AC-SEC-CAP", () => {
  it("does not cartesian-amplify tools across Role Set sources", async () => {
    const { authorizeAndRewrite, commitEffectivePolicy, effectivePermissions } = await loadAcl();
    await commitEffectivePolicy();
    const resolved = await effectivePermissions(identity("multi_role"));
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const caps = resolved.permissions.capabilities;
    // lucy_query only on finance sources; lucy_read_source on both — never lucy_query×pub_orders
    expect(caps.some((c) => c.tool === "lucy_query" && c.sourceName === "pub_orders")).toBe(false);
    expect(caps.some((c) => c.tool === "lucy_query" && c.sourceName === "fin_ledger")).toBe(true);
    expect(caps.some((c) => c.tool === "lucy_read_source" && c.sourceName === "pub_orders")).toBe(true);

    await expect(authorizeAndRewrite(identity("multi_role"), "lucy_query", {
      connectionId: "warehouse",
      measures: ["pub_orders.amount"]
    })).resolves.toMatchObject({
      allowed: false,
      reason: expect.stringMatching(/^capability_forbidden:lucy_query:/)
    });
  });
});

describe("AC-SEC-KEY", () => {
  it("keeps same sourceName on different connections from cross-wiring", async () => {
    const { authorizeAndRewrite, commitEffectivePolicy, getSourceMapDiagnostics } = await loadAcl();
    await commitEffectivePolicy();
    const snap = await getSourceMapDiagnostics({ fresh: true });
    const ledgerEntries = snap.entries.filter((e) => e.sourceName === "fin_ledger");
    expect(ledgerEntries.length).toBeGreaterThanOrEqual(2);
    const connections = new Set(ledgerEntries.map((e) => e.connectionId));
    expect(connections.has("warehouse")).toBe(true);
    expect(connections.has("other")).toBe(true);

    // Authorized connection + same sourceName must allow (control).
    await expect(authorizeAndRewrite(identity("keyed_a"), "lucy_read_source", {
      connectionId: "warehouse",
      sourceName: "fin_ledger"
    })).resolves.toEqual({ allowed: true });

    // Foreign connection with the same sourceName must not inherit warehouse capability.
    await expect(authorizeAndRewrite(identity("keyed_a"), "lucy_read_source", {
      connectionId: "other",
      sourceName: "fin_ledger"
    })).resolves.toEqual({
      allowed: false,
      reason: "unknown_or_forbidden_connection:other"
    });
  });
});

describe("AC-SEC-SCOPE", () => {
  it("does not silently expand authorization when source map grows until commit", async () => {
    const { authorizeAndRewrite, commitEffectivePolicy, lucyCatalog } = await loadAcl();
    await commitEffectivePolicy();
    const before = await lucyCatalog(identity("keyed_a"));
    expect(before.sources.map((s) => s.sourceName)).toEqual(["fin_ledger"]);

    await writeFile(
      path.join(projectRoot, "semantic-layer", "warehouse", "_schema", "fin.yaml"),
      `tables:
  fin_ledger:
    table: fin.fin_ledger
  fin_budget:
    table: fin.fin_budget
  pub_orders:
    table: pub.pub_orders
`,
      "utf8"
    );

    // Hot path pins committed map — new sources not granted.
    await expect(authorizeAndRewrite(identity("keyed_a"), "lucy_read_source", {
      connectionId: "warehouse",
      sourceName: "fin_budget"
    })).resolves.toMatchObject({ allowed: false });

    // Even after commit, v2 names allowlist does not expand to fin_budget.
    await commitEffectivePolicy();
    await expect(authorizeAndRewrite(identity("keyed_a"), "lucy_read_source", {
      connectionId: "warehouse",
      sourceName: "fin_budget"
    })).resolves.toMatchObject({
      allowed: false,
      reason: expect.stringMatching(/capability_forbidden|table_forbidden/)
    });
  });
});

/**
 * AC-SEC-ROW / BYPASS (ADR §5.1 BY-01…19).
 * Full matrix lives in row-policy-ac-p1.test.ts ("AC-SEC-ROW / BYPASS").
 * Smoke here: unproven deny + AbsoluteDeny sl_query still holds with a scoped Role present.
 */
describe("AC-SEC-ROW", () => {
  it("smoke: unproven deny + AbsoluteDeny sl_query with scoped role", async () => {
    const previousProven = process.env.LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN;
    delete process.env.LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN;
    try {
      await writeFile(
        path.join(projectRoot, "webui", "config", "access.yaml"),
        `roles:
  scoped_finance:
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
      tools: [lucy_query, lucy_read_source, wiki_search]
users:
  - id: scoped_smoke
    enabled: true
    role: scoped_finance
    tokens: []
defaults:
  deny_tools: []
`,
        "utf8"
      );
      await writeFile(
        path.join(projectRoot, "semantic-layer", "warehouse", "fin_ledger.yaml"),
        `columns:
  - name: region
measures:
  - name: amount
`,
        "utf8"
      );

      const { authorizeAndRewrite, commitEffectivePolicy, resetEffectivePolicyForTests } = await loadAcl();
      resetEffectivePolicyForTests();
      await commitEffectivePolicy();

      await expect(authorizeAndRewrite(identity("scoped_smoke"), "lucy_query", {
        connectionId: "warehouse",
        measures: ["fin_ledger.amount"]
      })).resolves.toEqual({ allowed: false, reason: "row_policy_upstream_unproven" });

      await expect(authorizeAndRewrite(identity("scoped_smoke"), "sl_query", {
        connectionId: "warehouse",
        measures: ["fin_ledger.amount"]
      })).resolves.toEqual({ allowed: false, reason: "tool_absolute_deny:sl_query" });
    } finally {
      if (previousProven === undefined) delete process.env.LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN;
      else process.env.LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN = previousProven;
    }
  });
});

/**
 * AC-SEC-CONSTRAINT (Spec 100 / design-upgrade §6.4).
 * Full SC-P15 matrix: agent-constraints-ac-p15.test.ts.
 * Smoke here: OR→TRUE + Constraints tighten; cannot widen via user filters; P1 unproven holds.
 */
describe("AC-SEC-CONSTRAINT", () => {
  async function seedConstrainedAllRole(): Promise<void> {
    await writeFile(
      path.join(projectRoot, "webui", "config", "access.yaml"),
      `roles:
  ledger_all:
    permission_model_version: 2
    allow:
      connections: [warehouse]
      tableSelectors:
        - connection: warehouse
          schema: fin
          names: [fin_ledger]
          row_access: all
      tools: [lucy_query, lucy_read_source, wiki_search]
users:
  - id: constrained_smoke
    enabled: true
    role: ledger_all
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
defaults:
  deny_tools: []
`,
      "utf8"
    );
    await writeFile(
      path.join(projectRoot, "semantic-layer", "warehouse", "fin_ledger.yaml"),
      `columns:
  - name: region
measures:
  - name: amount
`,
      "utf8"
    );
  }

  it("OR=TRUE + Constraints → FinalRows≠TRUE; proven injects; user forged filters cannot widen", async () => {
    const previousProven = process.env.LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN;
    process.env.LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN = "true";
    try {
      await seedConstrainedAllRole();
      const {
        authorizeAndRewrite,
        commitEffectivePolicy,
        effectivePermissions,
        resetEffectivePolicyForTests
      } = await loadAcl();
      resetEffectivePolicyForTests();
      await commitEffectivePolicy();

      const resolved = await effectivePermissions(identity("constrained_smoke"));
      expect(resolved.ok).toBe(true);
      if (resolved.ok) {
        expect(resolved.permissions.capabilities[0]?.rowGrant).toEqual({ kind: "all" });
        const finalRows = Object.values(resolved.permissions.finalRowsBySource ?? {})[0];
        expect(finalRows?.kind).toBe("scoped");
      }

      const decision = await authorizeAndRewrite(identity("constrained_smoke"), "lucy_query", {
        connectionId: "warehouse",
        measures: ["fin_ledger.amount"],
        // BY-05 — forged widen attempt must not become the enforced domain.
        forced_filters: {
          or: [{ and: [{ field: "fin_ledger.region", op: "eq", value: "West" }] }]
        }
      });
      expect(decision.allowed).toBe(true);
      if (decision.allowed) {
        expect(decision.forcedFilters).toEqual({
          or: [{ and: [{ field: "fin_ledger.region", op: "eq", value: "East" }] }]
        });
      }

      await expect(
        authorizeAndRewrite(identity("constrained_smoke"), "lucy_read_source", {
          connectionId: "warehouse",
          sourceName: "fin_ledger"
        })
      ).resolves.toEqual({ allowed: false, reason: "row_policy_requires_wrapped_tool" });
    } finally {
      if (previousProven === undefined) delete process.env.LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN;
      else process.env.LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN = previousProven;
    }
  });

  it("Constraints do not bypass unproven gate (P1 regression)", async () => {
    const previousProven = process.env.LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN;
    delete process.env.LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN;
    try {
      await seedConstrainedAllRole();
      const { authorizeAndRewrite, commitEffectivePolicy, resetEffectivePolicyForTests } = await loadAcl();
      resetEffectivePolicyForTests();
      await commitEffectivePolicy();

      await expect(
        authorizeAndRewrite(identity("constrained_smoke"), "lucy_query", {
          connectionId: "warehouse",
          measures: ["fin_ledger.amount"]
        })
      ).resolves.toEqual({ allowed: false, reason: "row_policy_upstream_unproven" });
    } finally {
      if (previousProven === undefined) delete process.env.LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN;
      else process.env.LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN = previousProven;
    }
  });
});
