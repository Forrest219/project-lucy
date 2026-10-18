import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Identity } from "../proxy/identity";

/**
 * Spec 182 / T7 — ordinary `tableSelectors` and `catalog_bound` both
 * intersect with the connection's `enabled_tables`. Field names are locked by
 * `webui/docs/182-enabled-table-intersection-spec.md`; only the union logic
 * is being added, the spec-177 diagnostic shape is unchanged.
 *
 * Conventions:
 *   - fixtures use `warehouse` connection
 *   - the manifest declares eight sources; only `fin_ledger` and
 *     `fin_budget` are placed in `enabled_tables`
 *   - the per-test ktx.yaml builds a fresh `enabled_tables` list so missing,
 *     empty, and partial-state cases are isolated
 */

// Eight-source manifest. Per-test ktx.yaml decides which are enabled.
const FIN_SCHEMA_FOUR_TABLES = `tables:
  fin_ledger:
    table: fin.fin_ledger
    columns:
      - name: region
  fin_budget:
    table: fin.fin_budget
    columns:
      - name: region
  fin_forecast:
    table: fin.fin_forecast
  fin_audit:
    table: fin.fin_audit
  fin_uid_dirty:
    table: fin.fin_uid_dirty
  fin_hold:
    table: fin.fin_hold
  fin_tax:
    table: fin.fin_tax
  fin_fx:
    table: fin.fin_fx
`;

const ROLE_FOUR_NAMES = `roles:
  four_names_role:
    description: declares four names; manifest has all four
    permission_model_version: 2
    allow:
      connections:
        - warehouse
      tableSelectors:
        - connection: warehouse
          schema: fin
          names:
            - fin_ledger
            - fin_budget
            - fin_forecast
            - fin_audit
          row_access: all
      tools:
        - lucy_query
`;

const ROLE_UID = `roles:
  uid_role:
    description: declares the UID source name explicitly
    permission_model_version: 2
    allow:
      connections:
        - warehouse
      tableSelectors:
        - connection: warehouse
          schema: fin
          names:
            - fin_uid_dirty
          row_access: all
      tools:
        - lucy_query
`;

const ROLE_CATALOG_BOUND = `roles:
  catalog_bound_role:
    description: catalog_bound without selectors
    permission_model_version: 2
    allow:
      connections:
        - warehouse
      source_scope: catalog_bound
      tools:
        - lucy_query
`;

const ROLE_CATALOG_BOUND_SCOPED = `roles:
  catalog_bound_scoped_role:
    description: catalog_bound with a single role_access=scoped would fail row_policy
    permission_model_version: 2
    allow:
      connections:
        - warehouse
      source_scope: catalog_bound
      tools:
        - lucy_query
        - lucy_read_source
`;

function makeAccessYaml(rolesBlock: string, usersBlock: string): string {
  return `${rolesBlock}users:
${usersBlock}
defaults:
  deny_tools: []
`;
}

const adminIdentity = (userId: string): Identity => ({
  userId,
  tokenLabel: "admin-preview",
  tokenHashPrefix: "admin-preview"
});

let projectRoot: string;
let previousRoot: string | undefined;
let previousContentRoot: string | undefined;

beforeEach(async () => {
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
  projectRoot = "";
});

async function makeProject(accessYaml: string, ktxYaml: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "ktx-spec-182-"));
  await mkdir(path.join(root, "webui", "config"), { recursive: true });
  await mkdir(path.join(root, "semantic-layer", "warehouse", "_schema"), { recursive: true });
  await writeFile(path.join(root, "ktx.yaml"), ktxYaml, "utf8");
  await writeFile(path.join(root, "webui", "config", "access.yaml"), accessYaml, "utf8");
  await writeFile(path.join(root, "semantic-layer", "warehouse", "_schema", "fin.yaml"), FIN_SCHEMA_FOUR_TABLES, "utf8");
  return root;
}

async function loadAcl() {
  vi.resetModules();
  return import("../proxy/acl");
}

describe("Spec 182 — enabled-table intersection for plain tableSelectors", () => {
  it("§3 eight-manifest, two-enabled, four-name selector → exactly two valid sources, two unmatchedNames", async () => {
    const accessYaml = makeAccessYaml(
      ROLE_FOUR_NAMES,
      `  - id: four_name_agent
    name: Four Name Agent
    enabled: true
    role: four_names_role
    tokens: []`
    );
    const ktxYaml = `connections:
  warehouse:
    driver: mysql
    enabled_tables:
      - fin.fin_ledger
      - fin.fin_budget
`;
    projectRoot = await makeProject(accessYaml, ktxYaml);
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const acl = await loadAcl();

    const resolved = await acl.effectivePermissions(adminIdentity("four_name_agent"));
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) throw new Error("expected success");

    // §3 — selector named 4 tables, manifest had 4, enabled_tables narrowed to 2.
    expect(resolved.permissions.sources.length).toBe(2);
    const grantedNames = resolved.permissions.sources.map((s) => s.sourceName).sort();
    expect(grantedNames).toEqual(["fin_budget", "fin_ledger"]);
    // The other two are recorded as unmatchedNames on the selector trace.
    const trace = resolved.diagnostic.steps.find(
      (step) => step.status === "compiled" && "selectorIndex" in step
    );
    expect(trace).toBeTruthy();
    expect(trace?.matchCount).toBe(2);
    expect(trace?.unmatchedNames?.slice().sort()).toEqual(["fin_audit", "fin_forecast"]);
  });

  it("§3 selector_zero_match when every named source is filtered by empty enabled_tables", async () => {
    const accessYaml = makeAccessYaml(
      ROLE_FOUR_NAMES,
      `  - id: four_name_zero_agent
    name: Four Name Zero Agent
    enabled: true
    role: four_names_role
    tokens: []`
    );
    // Empty enabled_tables must collapse to "no valid sources", not all sources.
    const ktxYaml = `connections:
  warehouse:
    driver: mysql
    enabled_tables: []
`;
    projectRoot = await makeProject(accessYaml, ktxYaml);
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const acl = await loadAcl();

    const resolved = await acl.effectivePermissions(adminIdentity("four_name_zero_agent"));
    expect(resolved.ok).toBe(false);
    if (resolved.ok) throw new Error("expected failure");
    expect(resolved.reason).toMatch(/^role_resolution_failed:four_names_role/);
    const failed = resolved.diagnostic.steps.find(
      (step) => step.roleId === "four_names_role" && step.status === "failed"
    );
    expect(failed?.code).toBe("selector_zero_match");
    expect(failed?.matchCount).toBe(0);
  });

  it("§2 empty enabled_tables must not yield the whole manifest", async () => {
    const accessYaml = makeAccessYaml(
      ROLE_FOUR_NAMES,
      `  - id: empty_enabled_agent
    name: Empty Enabled Agent
    enabled: true
    role: four_names_role
    tokens: []`
    );
    // empty array → no enabled source on this connection
    const ktxYaml = `connections:
  warehouse:
    driver: mysql
    enabled_tables: []
`;
    projectRoot = await makeProject(accessYaml, ktxYaml);
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const acl = await loadAcl();

    const resolved = await acl.effectivePermissions(adminIdentity("empty_enabled_agent"));
    // §2 — empty enabled_tables is empty set, not "all".
    expect(resolved.ok).toBe(false);
  });

  it("§2 missing enabled_tables (connection absent from ktx.yaml) → selector_zero_match", async () => {
    const accessYaml = makeAccessYaml(
      ROLE_FOUR_NAMES,
      `  - id: missing_enabled_agent
    name: Missing Enabled Agent
    enabled: true
    role: four_names_role
    tokens: []`
    );
    // Connection id not declared in ktx.yaml → empty set, fail-closed.
    const ktxYaml = `connections: {}\n`;
    projectRoot = await makeProject(accessYaml, ktxYaml);
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const acl = await loadAcl();

    const resolved = await acl.effectivePermissions(adminIdentity("missing_enabled_agent"));
    expect(resolved.ok).toBe(false);
    if (resolved.ok) throw new Error("expected failure");
    expect(resolved.reason).toMatch(/^role_resolution_failed:four_names_role/);
    const failed = resolved.diagnostic.steps.find(
      (step) => step.roleId === "four_names_role" && step.status === "failed"
    );
    expect(failed?.code).toBe("selector_zero_match");
  });

  it("§2 declared connections id has no enabled_tables (only other connections configured)", async () => {
    const accessYaml = makeAccessYaml(
      ROLE_FOUR_NAMES,
      `  - id: other_conn_agent
    name: Other Conn Agent
    enabled: true
    role: four_names_role
    tokens: []`
    );
    // `warehouse` is the role's declared connection; ktx.yaml has only an
    // unrelated connection. enabledByConnection.get('warehouse') is undefined.
    const ktxYaml = `connections:
  unrelated:
    driver: mysql
    enabled_tables:
      - somewhere.some_table
`;
    projectRoot = await makeProject(accessYaml, ktxYaml);
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const acl = await loadAcl();

    const resolved = await acl.effectivePermissions(adminIdentity("other_conn_agent"));
    expect(resolved.ok).toBe(false);
    if (resolved.ok) throw new Error("expected failure");
    expect(resolved.reason).toMatch(/^role_resolution_failed:four_names_role/);
  });

  it("§3 UID source absent from enabled_tables is not granted (the connection's other two tables stay)", async () => {
    const accessYaml = makeAccessYaml(
      ROLE_UID,
      `  - id: uid_agent
    name: UID Agent
    enabled: true
    role: uid_role
    tokens: []`
    );
    // Spec 182 — UID tables must not be granted. enabled_tables only has the
    // two legitimate sources, the UID source is not enabled.
    const ktxYaml = `connections:
  warehouse:
    driver: mysql
    enabled_tables:
      - fin.fin_ledger
      - fin.fin_budget
`;
    projectRoot = await makeProject(accessYaml, ktxYaml);
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const acl = await loadAcl();

    const resolved = await acl.effectivePermissions(adminIdentity("uid_agent"));
    expect(resolved.ok).toBe(false);
    if (resolved.ok) throw new Error("expected failure");
    expect(resolved.reason).toMatch(/^role_resolution_failed:uid_role/);
    const failed = resolved.diagnostic.steps.find(
      (step) => step.roleId === "uid_role" && step.status === "failed"
    );
    expect(failed?.code).toBe("selector_zero_match");
    expect(failed?.matchCount).toBe(0);
  });

  it("§4 scoped selector keeps scoped grants on the sources that remain", async () => {
    const accessYaml = makeAccessYaml(
      `roles:
  scoped_role:
    description: two names, one enabled, row grant stays scoped
    permission_model_version: 2
    allow:
      connections:
        - warehouse
      tableSelectors:
        - connection: warehouse
          schema: fin
          names:
            - fin_ledger
            - fin_forecast
          row_access: scoped
          row_policy:
            predicates:
              - field: region
                op: eq
                value: East
      tools:
        - lucy_query
`,
      `  - id: scoped_agent
    name: Scoped Agent
    enabled: true
    role: scoped_role
    tokens: []`
    );
    const ktxYaml = `connections:
  warehouse:
    driver: mysql
    enabled_tables:
      - fin.fin_ledger
`;
    projectRoot = await makeProject(accessYaml, ktxYaml);
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const acl = await loadAcl();

    const resolved = await acl.effectivePermissions(adminIdentity("scoped_agent"));
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) throw new Error("expected success");
    expect(resolved.permissions.sources.map((source) => source.sourceName)).toEqual(["fin_ledger"]);
    expect(resolved.permissions.capabilities.length).toBeGreaterThan(0);
    for (const capability of resolved.permissions.capabilities) {
      expect(capability.rowGrant.kind).toBe("scoped");
    }
  });
});

describe("Spec 182 — enabled-table intersection for catalog_bound", () => {
  it("§2 catalog_bound with empty enabled_tables is not all tables", async () => {
    const accessYaml = makeAccessYaml(
      ROLE_CATALOG_BOUND,
      `  - id: catalog_bound_empty_agent
    name: Catalog Bound Empty Agent
    enabled: true
    role: catalog_bound_role
    tokens: []`
    );
    const ktxYaml = `connections:
  warehouse:
    driver: mysql
    enabled_tables: []
`;
    projectRoot = await makeProject(accessYaml, ktxYaml);
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const acl = await loadAcl();

    const resolved = await acl.effectivePermissions(adminIdentity("catalog_bound_empty_agent"));
    expect(resolved.ok).toBe(false);
    if (resolved.ok) throw new Error("expected failure");
    expect(resolved.reason).toMatch(/^role_resolution_failed:catalog_bound_role/);
    const failed = resolved.diagnostic.steps.find(
      (step) => step.roleId === "catalog_bound_role" && step.status === "failed"
    );
    expect(failed?.code).toBe("selector_zero_match");
  });

  it("§2 catalog_bound with no declared connection (lucy_admin) and empty enabled_tables is not all tables", async () => {
    const accessYaml = makeAccessYaml(
      `roles:
  lucy_admin:
    description: ops catalog-bound admin role
    permission_model_version: 2
    allow:
      connections: ["*"]
      source_scope: catalog_bound
      tools:
        - lucy_query
`,
      `  - id: admin_empty_agent
    name: Admin Empty Agent
    enabled: true
    role: lucy_admin
    tokens: []`
    );
    // lucy_admin follows every configured connection — but the configured
    // connection has an empty enabled_tables list. Empty must remain empty.
    const ktxYaml = `connections:
  warehouse:
    driver: mysql
    enabled_tables: []
`;
    projectRoot = await makeProject(accessYaml, ktxYaml);
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const acl = await loadAcl();

    const resolved = await acl.effectivePermissions(adminIdentity("admin_empty_agent"));
    expect(resolved.ok).toBe(false);
    if (resolved.ok) throw new Error("expected failure");
    expect(resolved.reason).toMatch(/^role_resolution_failed:lucy_admin/);
    const failed = resolved.diagnostic.steps.find(
      (step) => step.roleId === "lucy_admin" && step.status === "failed"
    );
    expect(failed?.code).toBe("selector_zero_match");
  });

  it("§3 catalog_bound with partial enabled_tables narrows to that subset", async () => {
    const accessYaml = makeAccessYaml(
      ROLE_CATALOG_BOUND,
      `  - id: catalog_bound_partial_agent
    name: Catalog Bound Partial Agent
    enabled: true
    role: catalog_bound_role
    tokens: []`
    );
    const ktxYaml = `connections:
  warehouse:
    driver: mysql
    enabled_tables:
      - fin.fin_ledger
      - fin.fin_budget
`;
    projectRoot = await makeProject(accessYaml, ktxYaml);
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const acl = await loadAcl();

    const resolved = await acl.effectivePermissions(adminIdentity("catalog_bound_partial_agent"));
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) throw new Error("expected success");
    const grantedNames = resolved.permissions.sources.map((s) => s.sourceName).sort();
    expect(grantedNames).toEqual(["fin_budget", "fin_ledger"]);
  });

  it("§4 catalog_bound + row_access=all stays all, never a row-policy bypass", async () => {
    // catalog_bound does not honour row_access from tableSelectors (they are
    // forbidden together), so the row grant is `all`. The intersection still
    // applies at source level.
    const accessYaml = makeAccessYaml(
      ROLE_CATALOG_BOUND_SCOPED,
      `  - id: catalog_bound_scoped_agent
    name: Catalog Bound Scoped Agent
    enabled: true
    role: catalog_bound_scoped_role
    tokens: []`
    );
    const ktxYaml = `connections:
  warehouse:
    driver: mysql
    enabled_tables:
      - fin.fin_ledger
      - fin.fin_budget
`;
    projectRoot = await makeProject(accessYaml, ktxYaml);
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const acl = await loadAcl();

    const resolved = await acl.effectivePermissions(adminIdentity("catalog_bound_scoped_agent"));
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) throw new Error("expected success");
    for (const capability of resolved.permissions.capabilities) {
      expect(capability.rowGrant.kind).toBe("all");
    }
  });
});