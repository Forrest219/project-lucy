import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
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

const ACCESS_YAML = `roles:
  legacy_no_version:
    description: v1 shape without permission_model_version or row_access
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
  legacy_v1_prefix:
    description: Explicit v1 keeps prefix selectors and implicit row access
    permission_model_version: 1
    allow:
      connections:
        - warehouse
      tableSelectors:
        - connection: warehouse
          schema: fin
          prefix: fin_
      tools:
        - lucy_query
  v2_prefix:
    description: v2 must not use prefix selectors
    permission_model_version: 2
    allow:
      connections:
        - warehouse
      tableSelectors:
        - connection: warehouse
          schema: fin
          prefix: fin_
          row_access: all
      tools:
        - lucy_query
  v2_scoped:
    description: scoped has no AC-P0 runtime
    permission_model_version: 2
    allow:
      connections:
        - warehouse
      tableSelectors:
        - connection: warehouse
          schema: fin
          names:
            - fin_ledger
          row_access: scoped
      tools:
        - lucy_query
  v2_missing_row_access:
    description: v2 requires explicit row_access on every selector
    permission_model_version: 2
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
  v2_ok:
    description: v2 legal shape
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
  v1_scoped:
    description: scoped is illegal in AC-P0 regardless of generation
    permission_model_version: 1
    allow:
      connections:
        - warehouse
      tableSelectors:
        - connection: warehouse
          schema: fin
          names:
            - fin_ledger
          row_access: scoped
      tools:
        - lucy_query
  bad_version:
    description: unknown generation
    permission_model_version: 3
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
users:
  - id: legacy_no_version_agent
    name: Legacy No Version Agent
    enabled: true
    role: legacy_no_version
    tokens: []
  - id: legacy_v1_prefix_agent
    name: Legacy V1 Prefix Agent
    enabled: true
    role: legacy_v1_prefix
    tokens: []
  - id: v2_prefix_agent
    name: V2 Prefix Agent
    enabled: true
    role: v2_prefix
    tokens: []
  - id: v2_scoped_agent
    name: V2 Scoped Agent
    enabled: true
    role: v2_scoped
    tokens: []
  - id: v2_missing_row_access_agent
    name: V2 Missing Row Access Agent
    enabled: true
    role: v2_missing_row_access
    tokens: []
  - id: v2_ok_agent
    name: V2 Ok Agent
    enabled: true
    role: v2_ok
    tokens: []
  - id: v1_scoped_agent
    name: V1 Scoped Agent
    enabled: true
    role: v1_scoped
    tokens: []
  - id: bad_version_agent
    name: Bad Version Agent
    enabled: true
    role: bad_version
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

let projectRoot: string;
let previousRoot: string | undefined;

function identity(userId: string): Identity {
  return { userId, tokenLabel: "unit-test", tokenHashPrefix: "unit-test" };
}

async function makeProject(accessYaml = ACCESS_YAML) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ktx-permission-model-version-"));
  await mkdir(path.join(root, "webui", "config"), { recursive: true });
  await mkdir(path.join(root, "semantic-layer", "warehouse", "_schema"), { recursive: true });
  await mkdir(path.join(root, ".ktx-ui"), { recursive: true });
  await writeFile(path.join(root, "ktx.yaml"), "connections: {}\n", "utf8");
  await writeFile(path.join(root, "webui", "config", "access.yaml"), accessYaml, "utf8");
  await writeFile(path.join(root, "semantic-layer", "warehouse", "_schema", "fin.yaml"), FIN_SCHEMA_YAML, "utf8");
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

describe("WP-I4 permission_model_version", () => {
  it("normalizePermissionModelVersion reads a missing field as generation 1 and rejects unknown values", async () => {
    const { normalizePermissionModelVersion } = await loadAcl();

    expect(normalizePermissionModelVersion(undefined)).toEqual({ ok: true, version: 1, assumed: true });
    expect(normalizePermissionModelVersion({})).toEqual({ ok: true, version: 1, assumed: true });
    expect(normalizePermissionModelVersion({ permission_model_version: 1 })).toEqual({
      ok: true,
      version: 1,
      assumed: false
    });
    expect(normalizePermissionModelVersion({ permission_model_version: 2 })).toEqual({
      ok: true,
      version: 2,
      assumed: false
    });
    for (const raw of [0, 3, "2", true, {}]) {
      expect(normalizePermissionModelVersion({ permission_model_version: raw })).toEqual({
        ok: false,
        reason: "invalid_permission_model_version"
      });
    }
  });

  it("U-VER-01: a v1 Role without row_access resolves, and a missing version keeps resolving", async () => {
    const { authorizeAndRewrite, effectivePermissions } = await loadAcl();

    for (const userId of ["legacy_no_version_agent", "legacy_v1_prefix_agent"]) {
      await expect(authorizeAndRewrite(identity(userId), "lucy_query", {
        connectionId: "warehouse",
        measures: ["fin_ledger.amount"]
      })).resolves.toEqual({ allowed: true });
    }

    // v1 keeps `prefix` selectors, so both fin_ sources are granted.
    const prefixResolved = await effectivePermissions(identity("legacy_v1_prefix_agent"));
    expect(prefixResolved.ok).toBe(true);
    if (!prefixResolved.ok) return;
    expect(prefixResolved.permissions.sources.map((source) => source.sourceName)).toEqual([
      "fin_budget",
      "fin_ledger"
    ]);
  });

  it("U-VER-02: v2 with a prefix selector fails role compilation", async () => {
    const { authorizeAndRewrite, effectivePermissions } = await loadAcl();

    await expect(effectivePermissions(identity("v2_prefix_agent"))).resolves.toEqual({
      ok: false,
      reason: "role_resolution_failed:v2_prefix:v2_prefix_forbidden"
    });
    await expect(authorizeAndRewrite(identity("v2_prefix_agent"), "lucy_query", {
      connectionId: "warehouse",
      measures: ["fin_ledger.amount"]
    })).resolves.toEqual({ allowed: false, reason: "role_resolution_failed:v2_prefix:v2_prefix_forbidden" });
  });

  it("U-VER-03: row_access scoped fails compilation in AC-P0, and v2 requires the field", async () => {
    const { authorizeAndRewrite, effectivePermissions } = await loadAcl();

    await expect(effectivePermissions(identity("v2_scoped_agent"))).resolves.toEqual({
      ok: false,
      reason: "role_resolution_failed:v2_scoped:row_access_scoped_forbidden"
    });
    // AC-P0 has no row policy runtime, so `scoped` is illegal on v1 Roles too.
    await expect(effectivePermissions(identity("v1_scoped_agent"))).resolves.toEqual({
      ok: false,
      reason: "role_resolution_failed:v1_scoped:row_access_scoped_forbidden"
    });
    await expect(effectivePermissions(identity("v2_missing_row_access_agent"))).resolves.toEqual({
      ok: false,
      reason: "role_resolution_failed:v2_missing_row_access:v2_row_access_required"
    });
    await expect(effectivePermissions(identity("bad_version_agent"))).resolves.toEqual({
      ok: false,
      reason: "role_resolution_failed:bad_version:invalid_permission_model_version"
    });

    await expect(authorizeAndRewrite(identity("v2_scoped_agent"), "lucy_query", {
      connectionId: "warehouse",
      measures: ["fin_ledger.amount"]
    })).resolves.toEqual({ allowed: false, reason: "role_resolution_failed:v2_scoped:row_access_scoped_forbidden" });
  });

  it("U-VER-04: v2 with row_access all and explicit names resolves to the named capability", async () => {
    const { authorizeAndRewrite, effectivePermissions } = await loadAcl();

    await expect(authorizeAndRewrite(identity("v2_ok_agent"), "lucy_query", {
      connectionId: "warehouse",
      measures: ["fin_ledger.amount"]
    })).resolves.toEqual({ allowed: true });

    const resolved = await effectivePermissions(identity("v2_ok_agent"));
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.permissions.capabilities).toEqual([
      {
        tool: "lucy_query",
        connectionId: "warehouse",
        schema: "fin",
        sourceName: "fin_ledger",
        physicalTable: "fin.fin_ledger",
        rowGrant: true
      }
    ]);

    // `row_access: all` grants every row but no extra source.
    await expect(authorizeAndRewrite(identity("v2_ok_agent"), "lucy_query", {
      connectionId: "warehouse",
      measures: ["fin_budget.amount"]
    })).resolves.toEqual({ allowed: false, reason: "table_forbidden:fin.fin_budget" });
  });

  it("expandSelectorSourceNames resolves a prefix selector to concrete source names", async () => {
    const { expandSelectorSourceNames } = await loadAcl();

    await expect(expandSelectorSourceNames({ connection: "warehouse", schema: "fin", prefix: "fin_" }))
      .resolves.toEqual(["fin_budget", "fin_ledger"]);
    await expect(expandSelectorSourceNames({ connection: "warehouse", schema: "fin", prefix: "ghost_" }))
      .resolves.toEqual([]);
  });
});

describe("WP-I4 Admin migration on save", () => {
  async function buildApp() {
    vi.resetModules();
    const { buildServer } = await import("../index");
    const app = buildServer();
    await app.ready();
    return app;
  }

  it("U-VER-04 (Admin): saving a v1 Role upgrades to v2, adds row_access all and expands prefix", async () => {
    const app = await buildApp();

    const dry = await request(app.server)
      .patch("/api/admin/roles/legacy_v1_prefix")
      .send({ dryRun: true, patch: { description: "Migrated by admin" } })
      .expect(200);

    expect(dry.body.data.migration).toMatchObject({
      fromVersion: 1,
      toVersion: 2,
      changed: true,
      expandedPrefixes: [{ prefix: "fin_", names: ["fin_budget", "fin_ledger"] }]
    });
    expect(dry.body.data.proposedYaml).toContain("permission_model_version: 2");
    expect(dry.body.data.diff).toMatch(/\+.*row_access: all/);
    // dryRun must not touch the file
    expect(await readFile(path.join(projectRoot, "webui/config/access.yaml"), "utf8")).toContain("prefix: fin_");

    await request(app.server)
      .patch("/api/admin/roles/legacy_v1_prefix")
      .send({ dryRun: false, patch: { description: "Migrated by admin" } })
      .expect(200);

    const written = await readFile(path.join(projectRoot, "webui/config/access.yaml"), "utf8");
    expect(written).toContain(`  legacy_v1_prefix:
    description: Migrated by admin
    permission_model_version: 2
    allow:
      connections:
        - warehouse
      tableSelectors:
        - connection: warehouse
          schema: fin
          names:
            - fin_budget
            - fin_ledger
          row_access: all
`);

    await app.close();
  });

  it("stamps permission_model_version 2 on a newly created Role that omits the field", async () => {
    const app = await buildApp();

    const res = await request(app.server)
      .post("/api/admin/roles")
      .send({
        dryRun: true,
        roleId: "fresh_role",
        role: {
          description: "New role",
          allow: {
            connections: ["warehouse"],
            tableSelectors: [{ connection: "warehouse", schema: "fin", names: ["fin_ledger"] }],
            tools: ["lucy_query"]
          }
        }
      })
      .expect(200);

    expect(res.body.data.migration).toMatchObject({ fromVersion: 1, toVersion: 2, changed: true });
    expect(res.body.data.proposedYaml).toContain("permission_model_version: 2");
    expect(res.body.data.proposedYaml).toContain("row_access: all");
    await app.close();
  });

  it("fails the save when a prefix selector expands to 0 source", async () => {
    const app = await buildApp();

    const res = await request(app.server)
      .post("/api/admin/roles")
      .send({
        dryRun: true,
        roleId: "ghost_prefix_role",
        role: {
          allow: {
            connections: ["warehouse"],
            tableSelectors: [{ connection: "warehouse", schema: "fin", prefix: "ghost_" }],
            tools: ["lucy_query"]
          }
        }
      })
      .expect(400);

    expect(res.body.error).toMatchObject({ code: "INVALID_ROLE" });
    expect(res.body.error.message).toMatch(/expands to 0 source/);
    await app.close();
  });

  it("rejects a save that asks for row_access scoped", async () => {
    const app = await buildApp();
    const before = await readFile(path.join(projectRoot, "webui", "config", "access.yaml"), "utf8");

    const res = await request(app.server)
      .post("/api/admin/roles")
      .send({
        // U-REL-01: validation/compile failure must not write disk (even dryRun:false).
        dryRun: false,
        roleId: "scoped_role",
        role: {
          permission_model_version: 2,
          allow: {
            connections: ["warehouse"],
            tableSelectors: [
              { connection: "warehouse", schema: "fin", names: ["fin_ledger"], row_access: "scoped" }
            ],
            tools: ["lucy_query"]
          }
        }
      })
      .expect(400);

    expect(res.body.error).toMatchObject({ code: "INVALID_ROLE" });
    expect(res.body.error.message).toMatch(/scoped/);
    const after = await readFile(path.join(projectRoot, "webui", "config", "access.yaml"), "utf8");
    expect(after).toBe(before);
    await app.close();
  });

  it("rejects an unknown permission_model_version on save", async () => {
    const app = await buildApp();

    const res = await request(app.server)
      .post("/api/admin/roles")
      .send({
        dryRun: true,
        roleId: "bad_version_role",
        role: {
          permission_model_version: 3,
          allow: {
            connections: ["warehouse"],
            tableSelectors: [{ connection: "warehouse", schema: "fin", names: ["fin_ledger"] }],
            tools: ["lucy_query"]
          }
        }
      })
      .expect(400);

    expect(res.body.error.message).toMatch(/permission_model_version must be 1 or 2/);
    await app.close();
  });
});
