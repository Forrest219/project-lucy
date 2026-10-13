import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  commitEffectivePolicy,
  buildAdminPermissionContext,
  effectivePermissions,
  getPolicyRuntimeStatus,
  resetEffectivePolicyForTests,
  resolveEffectivePermissionsBatchForAdmin,
  resolveEffectivePermissionsForAdmin,
  displayPolicyInputsOf,
  runtimeConsistencyForInputs
} from "../proxy/acl";
import { invalidateAccessConfigCache, parseAccessConfigText } from "../proxy/identity";
import { readEntryPerfCounters, resetEntryPerfCounters } from "../entry-performance-timing";
import {
  ACCESS_PATH_MISMATCH,
  authorizedCountsFromBatch,
  enabledUserIdsFromRaw,
  readAccessSnapshot,
  resolvePermissionBatch
} from "../admin/permission-display";
import { listSourcesWithManifests } from "../semantic-layer";
import { invalidateContentPathsCache } from "../paths";

const TOOLS = `      tools:
        - lucy_query
        - lucy_catalog
        - wiki_search`;

const KTX_YAML = `connections:
  warehouse:
    driver: mysql
    enabled_tables:
      - fin.fin_ledger
      - fin.fin_budget
  lake:
    driver: mysql
    enabled_tables:
      - ops.ops_orders
  empty_conn:
    driver: mysql
    enabled_tables: []
`;

const ACCESS_YAML = `roles:
  lucy_admin:
    permission_model_version: 2
    allow:
      connections: ["*"]
      source_scope: catalog_bound
${TOOLS}
  ledger_all:
    permission_model_version: 2
    allow:
      connections: [warehouse]
      tableSelectors:
        - connection: warehouse
          schema: fin
          names: [fin_ledger]
          row_access: all
${TOOLS}
  lake_catalog:
    permission_model_version: 2
    allow:
      connections: [lake]
      source_scope: catalog_bound
${TOOLS}
  bad_wildcard:
    permission_model_version: 2
    allow:
      connections: ["*"]
      source_scope: catalog_bound
${TOOLS}
  prefix_v1:
    allow:
      connections: [warehouse]
      tableSelectors:
        - connection: warehouse
          schema: fin
          prefix: fin_
${TOOLS}
  wiki_only:
    allow:
      connections: [warehouse]
      tools: [wiki_search, wiki_read]
users:
${[
  "  - { id: a01, name: A01, enabled: true, roles: [lucy_admin], tokens: [] }",
  "  - { id: a02, name: A02, enabled: true, roles: [ledger_all], tokens: [] }",
  "  - { id: a03, name: A03, enabled: true, roles: [ledger_all, lake_catalog], tokens: [] }",
  "  - { id: a04, name: A04, enabled: true, role: prefix_v1, tokens: [] }",
  "  - { id: a05, name: A05, enabled: true, roles: [wiki_only], tokens: [] }",
  "  - { id: a06, name: A06, enabled: true, roles: [bad_wildcard], tokens: [] }",
  "  - { id: a07, name: A07, enabled: true, role: ledger_all, roles: [lake_catalog], tokens: [] }",
  "  - { id: a08, name: A08, enabled: true, allow: { connections: [lake], tables: [ops.ops_orders], tools: [lucy_query] }, tokens: [] }",
  "  - { id: a09, name: A09, enabled: true, roles: [lake_catalog], tokens: [] }",
  "  - { id: a10, name: A10, enabled: true, roles: [missing_role], tokens: [] }",
  "  - { id: a11, name: A11, enabled: true, roles: [ledger_all], constraints: { sources: [{ connection: warehouse, schema: fin, names: [fin_ledger], predicates: [{ field: region, op: eq, value: East }] }] }, tokens: [] }",
  "  - { id: a12, name: A12, enabled: true, roles: [lucy_admin, wiki_only], tokens: [] }",
  "  - { id: a13, name: A13, enabled: false, roles: [ledger_all], tokens: [] }"
].join("\n")}
defaults:
  known_tools: [lucy_query, lucy_catalog, wiki_search, wiki_read]
  table_touching_tools: [lucy_query]
`;

function manifest(schema: string, tables: string[]): string {
  return `tables:\n${tables.map((t) => `  ${t}:\n    table: ${schema}.${t}\n    columns:\n      - name: id\n        type: number\n      - name: region\n        type: string\n`).join("")}`;
}

let projectRoot: string;
const savedEnv = { root: process.env.KTX_PROJECT_ROOT, content: process.env.LUCY_CONTENT_ROOT, access: process.env.LUCY_ACCESS_CONFIG_PATH };

async function writeProject(root: string): Promise<void> {
  await mkdir(path.join(root, "semantic-layer", "warehouse", "_schema"), { recursive: true });
  await mkdir(path.join(root, "semantic-layer", "lake", "_schema"), { recursive: true });
  await mkdir(path.join(root, "webui", "config"), { recursive: true });
  await writeFile(path.join(root, "ktx.yaml"), KTX_YAML, "utf8");
  await writeFile(path.join(root, "semantic-layer", "warehouse", "_schema", "fin.yaml"), manifest("fin", ["fin_ledger", "fin_budget"]), "utf8");
  await writeFile(path.join(root, "semantic-layer", "lake", "_schema", "ops.yaml"), manifest("ops", ["ops_orders"]), "utf8");
  await writeFile(path.join(root, "webui", "config", "access.yaml"), ACCESS_YAML, "utf8");
}

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-perm-batch-"));
  await writeProject(projectRoot);
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_CONTENT_ROOT = ".";
  delete process.env.LUCY_ACCESS_CONFIG_PATH;
  invalidateContentPathsCache();
  invalidateAccessConfigCache();
  resetEffectivePolicyForTests();
});

afterEach(async () => {
  for (const [key, value] of [["KTX_PROJECT_ROOT", savedEnv.root], ["LUCY_CONTENT_ROOT", savedEnv.content], ["LUCY_ACCESS_CONFIG_PATH", savedEnv.access]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  invalidateContentPathsCache();
  invalidateAccessConfigCache();
  resetEffectivePolicyForTests();
  await rm(projectRoot, { recursive: true, force: true });
});

const ids = Array.from({ length: 13 }, (_, i) => `a${String(i + 1).padStart(2, "0")}`);

describe("Spec 174 T1 — admin permission batch (SC-01/16/22/23)", () => {
  it("matches the fresh single-Agent resolver for every Agent with one source map / enabled-tables read", async () => {
    const snapshot = await readAccessSnapshot(projectRoot);
    resetEntryPerfCounters();
    const batch = await resolvePermissionBatch(snapshot, ids);
    const counters = readEntryPerfCounters();
    expect(counters.sourceMapBuilds).toBe(1);
    expect(counters.enabledTableReads).toBe(1);
    expect(counters.accessReads).toBe(0);

    for (const id of ids) {
      const single = await resolveEffectivePermissionsForAdmin(id);
      const batched = batch.results.get(id)!;
      expect(batched.ok, id).toBe(single.ok);
      if (single.ok && batched.ok) {
        expect(batched.permissions.snapshotHash, id).toBe(single.permissions.snapshotHash);
        expect(batched.permissions.capabilityDigest, id).toBe(single.permissions.capabilityDigest);
        expect(batched.permissions.sourceMapVersion, id).toBe(single.permissions.sourceMapVersion);
        expect(batched.permissions.roleIds, id).toEqual(single.permissions.roleIds);
      } else if (!single.ok && !batched.ok) {
        expect(batched.reason, id).toBe(single.reason);
      }
    }
    const denied = (id: string) => {
      const result = batch.results.get(id)!;
      return result.ok ? "" : result.reason;
    };
    expect(denied("a06")).toMatch(/catalog_bound_wildcard_forbidden/);
    expect(denied("a07")).toBe("role_resolution_failed:role_and_roles");
    expect(denied("a10")).toMatch(/role_resolution_failed:missing_role/);
    expect(denied("a13")).toBe("agent_disabled");
  });

  it("lucy_admin follows every configured connection including zero-enabled ones; dual roles union", async () => {
    await writeFile(path.join(projectRoot, "ktx.yaml"), `${KTX_YAML}  added_later:\n    driver: mysql\n    enabled_tables:\n      - crm.crm_accounts\n`, "utf8");
    await mkdir(path.join(projectRoot, "semantic-layer", "added_later", "_schema"), { recursive: true });
    await writeFile(path.join(projectRoot, "semantic-layer", "added_later", "_schema", "crm.yaml"), manifest("crm", ["crm_accounts"]), "utf8");
    const snapshot = await readAccessSnapshot(projectRoot);
    const context = await buildAdminPermissionContext(snapshot.runtimeConfig!);
    expect([...context.enabledTables.keys()]).toContain("empty_conn");
    const results = await resolveEffectivePermissionsBatchForAdmin(["a01", "a03"], context);
    const admin = results.get("a01")!;
    expect(admin.ok).toBe(true);
    if (admin.ok) expect(admin.permissions.sources.map((s) => s.connectionId)).toContain("added_later");
    const dual = results.get("a03")!;
    expect(dual.ok).toBe(true);
    if (dual.ok) {
      expect(dual.permissions.roleIds).toEqual(["ledger_all", "lake_catalog"]);
      expect(dual.permissions.sources.map((s) => `${s.connectionId}:${s.sourceName}`).sort()).toEqual(["lake:ops_orders", "warehouse:fin_ledger"]);
    }
  });

  it("does not mutate the committed runtime policy or its source map", async () => {
    await commitEffectivePolicy();
    const before = getPolicyRuntimeStatus();
    const runtimeBefore = await effectivePermissions({ userId: "a02", tokenLabel: "t", tokenHashPrefix: "t" });
    await writeFile(path.join(projectRoot, "semantic-layer", "warehouse", "_schema", "fin.yaml"), manifest("fin", ["fin_ledger", "fin_budget", "fin_extra"]), "utf8");
    const snapshot = await readAccessSnapshot(projectRoot);
    const batch = await resolvePermissionBatch(snapshot, ids);
    expect(runtimeConsistencyForInputs(batch.policyInputs)).toBe("unconfirmed");
    expect(getPolicyRuntimeStatus()).toEqual(before);
    const runtimeAfter = await effectivePermissions({ userId: "a02", tokenLabel: "t", tokenHashPrefix: "t" });
    expect(runtimeAfter).toEqual(runtimeBefore);
  });

  it("reports matched only when runtime inputs equal the display inputs", async () => {
    await commitEffectivePolicy();
    const snapshot = await readAccessSnapshot(projectRoot);
    const context = await buildAdminPermissionContext(snapshot.runtimeConfig!);
    // Runtime has a10 role failure → degradedAgents present → never "matched".
    expect(getPolicyRuntimeStatus().degradedAgents.length).toBeGreaterThan(0);
    expect(runtimeConsistencyForInputs(displayPolicyInputsOf(context))).toBe("unconfirmed");

    const clean = ACCESS_YAML.split("\n").filter((line) => !/id: a0[67]|id: a10/.test(line)).join("\n");
    await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), clean, "utf8");
    await commitEffectivePolicy();
    const cleanContext = await buildAdminPermissionContext(parseAccessConfigText(clean));
    expect(runtimeConsistencyForInputs(displayPolicyInputsOf(cleanContext))).toBe("matched");
  });

  it("refuses to splice two different access files (LUCY_ACCESS_CONFIG_PATH)", async () => {
    const overridePath = path.join(projectRoot, "override-access.yaml");
    await writeFile(overridePath, ACCESS_YAML.replace("id: a02", "id: z02"), "utf8");
    process.env.LUCY_ACCESS_CONFIG_PATH = overridePath;
    const snapshot = await readAccessSnapshot(projectRoot);
    expect(snapshot.problem).toBe(ACCESS_PATH_MISMATCH);
    const batch = await resolvePermissionBatch(snapshot, ids);
    expect(batch.results.size).toBe(0);
    const { state } = authorizedCountsFromBatch(snapshot, batch, enabledUserIdsFromRaw(snapshot), []);
    expect(state).toBe("unavailable");

    await writeFile(overridePath, ACCESS_YAML, "utf8");
    const same = await readAccessSnapshot(projectRoot);
    expect(same.problem).toBeUndefined();
  });

  it("computes ok / partial / unavailable authorized counts (SC-07/17)", async () => {
    const partial = await listSourcesWithManifests(projectRoot);
    expect(partial.authorizedCountsState).toBe("partial");
    const ledger = partial.tables.find((t) => t.table === "fin_ledger")!;
    // a01,a02,a03,a04,a11,a12 include warehouse.fin_ledger; a13 disabled.
    expect(ledger.authorizedAgentCount).toBe(6);
    expect(partial.manifestSchemas.map((m) => `${m.conn}/${m.schema}:${m.tableCount}`)).toEqual(["lake/ops:1", "warehouse/fin:2"]);

    const okOnly = ACCESS_YAML.split("\n").filter((line) => !/id: a0[67]|id: a10/.test(line)).join("\n");
    await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), okOnly, "utf8");
    expect((await listSourcesWithManifests(projectRoot)).authorizedCountsState).toBe("ok");

    await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), "users:\n  - { id: x, enabled: false, roles: [ledger_all], tokens: [] }\n", "utf8");
    const zero = await listSourcesWithManifests(projectRoot);
    expect(zero.authorizedCountsState).toBe("ok");
    expect(zero.tables.every((t) => t.authorizedAgentCount === 0)).toBe(true);

    await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), "this: is: not: valid: yaml: : :", "utf8");
    const broken = await listSourcesWithManifests(projectRoot);
    expect(broken.authorizedCountsState).toBe("unavailable");
    expect(broken.tables.every((t) => t.authorizedAgentCount === 0)).toBe(true);
  });

  it("parses each Manifest once per listing regardless of Agent count", async () => {
    resetEntryPerfCounters();
    await listSourcesWithManifests(projectRoot);
    const counters = readEntryPerfCounters();
    expect(counters.manifestParses).toBe(2);
    expect(counters.sourceMapBuilds).toBe(1);
    expect(counters.enabledTableReads).toBe(1);
  });
});
