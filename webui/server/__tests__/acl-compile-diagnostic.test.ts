import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Identity } from "../proxy/identity";

/**
 * Spec 177 — structured role-compile diagnostic.
 * Field names below are locked by `webui/docs/177-compile-failure-diagnostic-spec.md`
 * and must not be renamed without re-opening the spec.
 */

const ROLES_YAML = `roles:
  ok_role:
    description: compiles cleanly
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
          row_access: all
      tools:
        - lucy_query
        - wiki_search
  bad_role:
    description: selector matches no source in the manifest
    permission_model_version: 2
    allow:
      connections:
        - warehouse
      tableSelectors:
        - connection: warehouse
          schema: fin
          names:
            - fin_does_not_exist
          row_access: all
      tools:
        - lucy_query
        - wiki_search
  trailing_role:
    description: not reached when bad_role fails
    permission_model_version: 2
    allow:
      connections:
        - warehouse
      tableSelectors:
        - connection: warehouse
          schema: fin
          names:
            - fin_ledger
          row_access: all
      tools:
        - lucy_query
        - wiki_search
`;

// Manifest covers fin_ledger and fin_budget only.
const FIN_SCHEMA_TWO_TABLES = `tables:
  fin_ledger:
    table: fin.fin_ledger
  fin_budget:
    table: fin.fin_budget
`;

let projectRoot: string;
let previousRoot: string | undefined;
let previousContentRoot: string | undefined;

function makeAccessYaml(rolesBlock: string, usersBlock: string): string {
  return `${rolesBlock}users:
${usersBlock}
defaults:
  deny_tools: []
`;
}

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

async function makeProject(accessYaml: string, schemaYaml: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "ktx-spec-177-"));
  await mkdir(path.join(root, "webui", "config"), { recursive: true });
  await mkdir(path.join(root, "semantic-layer", "warehouse", "_schema"), { recursive: true });
  // Spec 182 — selector matches intersect with the connection's enabled_tables.
  // The spec-177 fixtures use `warehouse` and the `fin` schema; both names in
  // the manifest are added so the existing selector cases still compile.
  await writeFile(
    path.join(root, "ktx.yaml"),
    `connections:
  warehouse:
    driver: mysql
    enabled_tables:
      - fin.fin_ledger
      - fin.fin_budget
`,
    "utf8"
  );
  await writeFile(path.join(root, "webui", "config", "access.yaml"), accessYaml, "utf8");
  await writeFile(path.join(root, "semantic-layer", "warehouse", "_schema", "fin.yaml"), schemaYaml, "utf8");
  return root;
}

async function loadAcl() {
  vi.resetModules();
  return import("../proxy/acl");
}

const adminIdentity = (userId: string): Identity => ({
  userId,
  tokenLabel: "admin-preview",
  tokenHashPrefix: "admin-preview"
});

describe("Spec 177 — IdentityCompileDiagnostic", () => {
  it("§4 two-role case: first compiled, second selector_zero_match, identity denied, diagnostic has compiled + failed steps", async () => {
    const accessYaml = makeAccessYaml(
      ROLES_YAML,
      `  - id: two_role_agent
    name: Two Role Agent
    enabled: true
    roles:
      - ok_role
      - bad_role
    tokens: []`
    );
    projectRoot = await makeProject(accessYaml, FIN_SCHEMA_TWO_TABLES);
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const acl = await loadAcl();

    const resolved = await acl.effectivePermissions(adminIdentity("two_role_agent"));
    expect(resolved.ok).toBe(false);
    if (resolved.ok) throw new Error("expected failure");
    expect(resolved.reason).toMatch(/^role_resolution_failed:bad_role/);

    // Spec 177 — diagnostic is always present, success or failure.
    expect(resolved.diagnostic).toBeTruthy();
    expect(resolved.diagnostic.declaredRoleIds).toEqual(["ok_role", "bad_role"]);
    expect(resolved.diagnostic.failedRoleId).toBe("bad_role");

    // Steps: ok_role compiled, bad_role failed.
    const statusByRole = Object.fromEntries(
      resolved.diagnostic.steps.map((step) => [step.roleId, step.status])
    );
    expect(statusByRole.ok_role).toBe("compiled");
    expect(statusByRole.bad_role).toBe("failed");

    const failed = resolved.diagnostic.steps.find((step) => step.roleId === "bad_role" && step.status === "failed");
    expect(failed?.ordinal).toBe(1);
    expect(failed?.code).toBe("selector_zero_match");
    expect(failed?.stage).toBe("selector_match");
    expect(failed?.selectorIndex).toBe(0);
    expect(failed?.matchCount).toBe(0);
    expect(failed?.names).toEqual(["fin_does_not_exist"]);

    // Content root + source map facts are populated from the runtime.
    expect(resolved.diagnostic.contentRoot).toBeTruthy();
    expect(resolved.diagnostic.contentRootSource).toBeTruthy();
    expect(resolved.diagnostic.sourceMapVersion).toMatch(/^[a-f0-9]+$/);
    expect(Array.isArray(resolved.diagnostic.sourceMapConnectionIds)).toBe(true);

    const status = acl.getPolicyRuntimeStatus();
    expect(status.degradedAgents).toContain("two_role_agent");
    const issue = status.issues.find((item) => item.agentId === "two_role_agent");
    expect(issue?.reason).toMatch(/^role_resolution_failed:bad_role/);
    expect(issue?.diagnostic?.failedRoleId).toBe("bad_role");
    expect(issue?.diagnostic?.steps.some((step) => step.status === "failed" && step.code === "selector_zero_match")).toBe(true);
  });

  it("§4 three-role case: trailing role is not_run when earlier role fails", async () => {
    const accessYaml = makeAccessYaml(
      ROLES_YAML,
      `  - id: three_role_agent
    name: Three Role Agent
    enabled: true
    roles:
      - ok_role
      - bad_role
      - trailing_role
    tokens: []`
    );
    projectRoot = await makeProject(accessYaml, FIN_SCHEMA_TWO_TABLES);
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const acl = await loadAcl();

    const resolved = await acl.effectivePermissions(adminIdentity("three_role_agent"));
    expect(resolved.ok).toBe(false);
    if (resolved.ok) throw new Error("expected failure");
    expect(resolved.diagnostic.declaredRoleIds).toEqual(["ok_role", "bad_role", "trailing_role"]);

    const statusByRole = Object.fromEntries(
      resolved.diagnostic.steps
        .filter((step) => step.status !== "compiled" || !("selectorIndex" in step))
        .map((step) => [step.roleId, step.status])
    );
    expect(statusByRole.ok_role).toBe("compiled");
    expect(statusByRole.bad_role).toBe("failed");
    expect(statusByRole.trailing_role).toBe("not_run");
  });

  it("§4 four-name two-match case: compile succeeds, unmatchedNames has the 2 unmatched, granted source count = 2", async () => {
    const accessYaml = makeAccessYaml(
      `roles:
  four_name_role:
    description: declares four names, manifest only has two
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
        - wiki_search
`,
      `  - id: four_name_agent
    name: Four Name Agent
    enabled: true
    role: four_name_role
    tokens: []`
    );
    projectRoot = await makeProject(accessYaml, FIN_SCHEMA_TWO_TABLES);
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const acl = await loadAcl();

    const resolved = await acl.effectivePermissions(adminIdentity("four_name_agent"));
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) throw new Error("expected success");

    // Granted source count = 2 (only the two manifest hits).
    expect(resolved.permissions.sources.length).toBe(2);
    const grantedNames = resolved.permissions.sources.map((s) => s.sourceName).sort();
    expect(grantedNames).toEqual(["fin_budget", "fin_ledger"]);

    // Spec 177 — even on success, the diagnostic carries the unmatched names.
    const selectorTrace = resolved.diagnostic.steps.find(
      (step) => step.status === "compiled" && "selectorIndex" in step
    );
    expect(selectorTrace).toBeTruthy();
    expect(selectorTrace?.roleId).toBe("four_name_role");
    expect(selectorTrace?.matchCount).toBe(2);
    expect(selectorTrace?.names).toEqual(["fin_ledger", "fin_budget", "fin_forecast", "fin_audit"]);
    expect(selectorTrace?.unmatchedNames?.slice().sort()).toEqual(["fin_audit", "fin_forecast"]);

    // Role-level compiled step is the last step for the role.
    const roleLevelCompiled = resolved.diagnostic.steps.find(
      (step) => step.roleId === "four_name_role" && step.status === "compiled" && !("selectorIndex" in step)
    );
    expect(roleLevelCompiled).toBeTruthy();
    expect(roleLevelCompiled?.ordinal).toBe(0);
  });

  it("§2 success diagnostic has declaredRoleIds + contentRoot populated", async () => {
    const accessYaml = makeAccessYaml(
      ROLES_YAML,
      `  - id: happy_agent
    name: Happy Agent
    enabled: true
    role: ok_role
    tokens: []`
    );
    projectRoot = await makeProject(accessYaml, FIN_SCHEMA_TWO_TABLES);
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const acl = await loadAcl();

    const resolved = await acl.effectivePermissions(adminIdentity("happy_agent"));
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) throw new Error("expected success");
    expect(resolved.diagnostic).toBeTruthy();
    expect(resolved.diagnostic.declaredRoleIds).toEqual(["ok_role"]);
    expect(resolved.diagnostic.contentRoot).toBeTruthy();
    expect(resolved.diagnostic.contentRootSource).toBeTruthy();
    expect(resolved.diagnostic.sourceMapVersion).toMatch(/^[a-f0-9]+$/);
  });
});
