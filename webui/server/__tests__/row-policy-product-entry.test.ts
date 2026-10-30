import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordConfigChange } from "../admin/audit.js";
import { buildServer } from "../index";
import { authorizeAndRewrite } from "../proxy/acl";
import type { Identity } from "../proxy/identity";
import { resetRowPolicyCapabilityCacheForTests } from "../proxy/row-policy-capability";
import { buildForcedFiltersPayload, resetRowPolicyCatalogCacheForTests, type RowGrant } from "../proxy/row-policy";

/**
 * L25-14 product-entry evidence for the P0 slice that this machine can run.
 *
 * These tests go through the Admin preview / save routes (and the runtime
 * authorize path for the same candidate). They are repository evidence.
 * They do not mark V01–V22 or C19 as formally accepted.
 *
 * V15 stays out of this file: the full fault-injection matrix is blocked here.
 */

vi.mock("../admin/audit.js", () => ({
  getAuditDb: vi.fn(() => ({
    prepare: vi.fn(() => ({ get: vi.fn(() => undefined), all: vi.fn(() => []), run: vi.fn() })),
    exec: vi.fn(),
    pragma: vi.fn()
  })),
  recordConfigChange: vi.fn(async () => 1),
  updateConfigChangeStatus: vi.fn(async () => {}),
  registerAgentAuditRoutes: vi.fn(),
  registerAuditRoutes: vi.fn()
}));

const FIN_SCHEMA_YAML = `tables:
  fin_ledger:
    table: fin.fin_ledger
    columns:
      - name: region
      - name: category
`;

const FIN_LEDGER_OVERLAY_YAML = `columns:
  - name: region
measures:
  - name: total_sales
`;

const KTX_YAML = `connections:
  warehouse:
    driver: mysql
    enabled_tables:
      - fin.fin_ledger
`;

const TOOLS = `      tools:
        - lucy_query`;

const TABLE = { connection: "warehouse", schema: "fin", name: "fin_ledger" };

function scopedRole(roleId: string, value: string): string {
  return `  ${roleId}:
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
                value: ${value}
${TOOLS}`;
}

function allRowsRole(roleId: string): string {
  return `  ${roleId}:
    permission_model_version: 2
    allow:
      connections: [warehouse]
      tableSelectors:
        - connection: warehouse
          schema: fin
          names: [fin_ledger]
          row_access: all
${TOOLS}`;
}

function accessYaml(rolesBlock: string, usersBlock: string): string {
  return `roles:
${rolesBlock}
users:
${usersBlock}
defaults:
  deny_tools: []
`;
}

const TWO_RESTRICTED = accessYaml(
  `${scopedRole("east_role", "East")}\n${scopedRole("west_role", "West")}`,
  `  - id: or_agent
    roles: [east_role, west_role]
    enabled: true
    tokens: []
  - id: constrained_agent
    role: east_role
    enabled: true
    constraints:
      sources:
        - connection: warehouse
          schema: fin
          names: [fin_ledger]
          predicates:
            - field: region
              op: eq
              value: East
    tokens: []
`
);

const ALL_PLUS_PARTIAL = accessYaml(
  `${scopedRole("east_role", "East")}\n${allRowsRole("all_role")}`,
  `  - id: all_wins_agent
    roles: [east_role, all_role]
    enabled: true
    tokens: []
  - id: east_only_agent
    role: east_role
    enabled: true
    tokens: []
`
);

const UNUSED_SCOPED = `roles:
${scopedRole("spare_role", "East")}
users: []
defaults:
  deny_tools: []
`;

const UNSATISFIABLE = accessYaml(
  scopedRole("east_role", "East"),
  `  - id: constrained_agent
    role: east_role
    enabled: true
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
              value: West
    tokens: []
`
);

function allowFor(value: string, field = "region") {
  return {
    connections: ["warehouse"],
    tableSelectors: [
      {
        connection: "warehouse",
        schema: "fin",
        names: ["fin_ledger"],
        row_access: "scoped",
        row_policy: { predicates: [{ field, op: "eq", value }] }
      }
    ],
    tools: ["lucy_query"]
  };
}

let projectRoot: string;
let previousRoot: string | undefined;
let previousContentRoot: string | undefined;
let previousProven: string | undefined;
let previousCapability: string | undefined;
const openApps: Array<{ close: () => Promise<unknown> }> = [];

async function makeProject(options: {
  access?: string;
  schemaYaml?: string;
  overlayYaml?: string;
  writeSchema?: boolean;
} = {}): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lucy-row-policy-entry-"));
  await mkdir(path.join(root, "webui", "config"), { recursive: true });
  await mkdir(path.join(root, "semantic-layer", "warehouse", "_schema"), { recursive: true });
  await writeFile(path.join(root, "ktx.yaml"), KTX_YAML, "utf8");
  await writeFile(
    path.join(root, "webui", "config", "access.yaml"),
    options.access ?? TWO_RESTRICTED,
    "utf8"
  );
  if (options.writeSchema !== false) {
    await writeFile(
      path.join(root, "semantic-layer", "warehouse", "_schema", "fin.yaml"),
      options.schemaYaml ?? FIN_SCHEMA_YAML,
      "utf8"
    );
  }
  await writeFile(
    path.join(root, "semantic-layer", "warehouse", "fin_ledger.yaml"),
    options.overlayYaml ?? FIN_LEDGER_OVERLAY_YAML,
    "utf8"
  );
  return root;
}

function useProject(root: string): void {
  projectRoot = root;
  process.env.KTX_PROJECT_ROOT = root;
  process.env.LUCY_CONTENT_ROOT = ".";
  resetRowPolicyCatalogCacheForTests();
  resetRowPolicyCapabilityCacheForTests();
}

async function accessText(): Promise<string> {
  return readFile(path.join(projectRoot, "webui", "config", "access.yaml"), "utf8");
}

function intentCalls(): number {
  return vi.mocked(recordConfigChange).mock.calls.length;
}

async function startApp() {
  const app = buildServer();
  await app.ready();
  openApps.push(app);
  return app;
}

beforeEach(() => {
  previousRoot = process.env.KTX_PROJECT_ROOT;
  previousContentRoot = process.env.LUCY_CONTENT_ROOT;
  previousProven = process.env.LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN;
  previousCapability = process.env.LUCY_ROW_POLICY_CATALOG_CAPABILITY;
  delete process.env.LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN;
  delete process.env.LUCY_ROW_POLICY_CATALOG_CAPABILITY;
  vi.mocked(recordConfigChange).mockClear();
});

afterEach(async () => {
  for (const app of openApps.splice(0)) {
    await app.close();
  }
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  if (previousContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = previousContentRoot;
  if (previousProven === undefined) delete process.env.LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN;
  else process.env.LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN = previousProven;
  if (previousCapability === undefined) delete process.env.LUCY_ROW_POLICY_CATALOG_CAPABILITY;
  else process.env.LUCY_ROW_POLICY_CATALOG_CAPABILITY = previousCapability;
  if (projectRoot) await rm(projectRoot, { recursive: true, force: true });
});

describe("V08–V11 — Admin preview keeps the global union apart from each Agent", () => {
  it("V08: two restricted Roles preview as two OR branches, never as 全部行", async () => {
    useProject(await makeProject());
    const app = await startApp();
    const res = await request(app.server)
      .post("/api/admin/roles/preview-row-policy")
      .send({ roleId: "east_role", tables: [TABLE] })
      .expect(200);
    const table = res.body.data.tables[0];
    expect(res.body.data.ok).toBe(true);
    expect(table.preview.effectiveRowGrant.kind).toBe("scoped");
    expect(table.preview.effectiveRowGrant.orArms).toHaveLength(2);
    expect(table.preview.displayShape).toBe("OR-of-AND");
    expect(JSON.stringify(table.preview.effectiveRowGrant)).toContain("East");
    expect(JSON.stringify(table.preview.effectiveRowGrant)).toContain("West");
  });

  it("V09/V10: a global all-rows union does not leak into an Agent that lacks that Role", async () => {
    useProject(await makeProject({ access: ALL_PLUS_PARTIAL }));
    const app = await startApp();
    const res = await request(app.server)
      .post("/api/admin/roles/preview-row-policy")
      .send({ roleId: "east_role", tables: [TABLE] })
      .expect(200);
    const preview = res.body.data.tables[0].preview;
    expect(preview.effectiveRowGrant.kind).toBe("all");
    const allAgent = preview.finalRowsByAgent.find((entry: { agentId: string }) => entry.agentId === "all_wins_agent");
    const eastOnly = preview.finalRowsByAgent.find((entry: { agentId: string }) => entry.agentId === "east_only_agent");
    expect(allAgent.finalRows.kind).toBe("all");
    expect(eastOnly.finalRows.kind).toBe("scoped");
    expect(JSON.stringify(eastOnly.finalRows)).toContain("East");
    expect(JSON.stringify(eastOnly.finalRows)).not.toContain("all_role");
  });

  it("V10: an Agent personal limit narrows that Agent without changing the global union", async () => {
    useProject(await makeProject());
    const app = await startApp();
    const res = await request(app.server)
      .post("/api/admin/roles/preview-row-policy")
      .send({ roleId: "east_role", tables: [TABLE] })
      .expect(200);
    const preview = res.body.data.tables[0].preview;
    expect(preview.effectiveRowGrant.orArms).toHaveLength(2);
    const narrowed = preview.finalRowsByAgent.find(
      (entry: { agentId: string }) => entry.agentId === "constrained_agent"
    );
    const open = preview.finalRowsByAgent.find((entry: { agentId: string }) => entry.agentId === "or_agent");
    expect(JSON.stringify(narrowed.finalRows)).toContain("East");
    expect(JSON.stringify(narrowed.finalRows)).not.toContain("West");
    expect(JSON.stringify(open.finalRows)).toContain("West");
  });

  it("V11: an unsatisfiable personal limit fails the preview closed and a save writes nothing", async () => {
    useProject(await makeProject({ access: UNSATISFIABLE }));
    const before = await accessText();
    const intents = intentCalls();
    const app = await startApp();
    const preview = await request(app.server)
      .post("/api/admin/roles/preview-row-policy")
      .send({ roleId: "east_role", tables: [TABLE] })
      .expect(200);
    expect(preview.body.data.ok).toBe(false);
    expect(preview.body.data.confirmation).toBeUndefined();
    expect(JSON.stringify(preview.body.data.tables)).toContain("final_rows_unsatisfiable");

    const saved = await request(app.server)
      .patch("/api/admin/agents/constrained_agent")
      .send({
        dryRun: false,
        patch: {
          constraints: {
            sources: [
              {
                connection: "warehouse",
                schema: "fin",
                names: ["fin_ledger"],
                predicates: [
                  { field: "region", op: "eq", value: "East" },
                  { field: "region", op: "eq", value: "West" }
                ]
              }
            ]
          }
        }
      })
      .expect(400);
    expect(saved.body.error.code).toBe("final_rows_unsatisfiable");
    expect(await accessText()).toBe(before);
    expect(intentCalls()).toBe(intents);
  });
});

describe("V12 / V16 / V18 — preview, runtime filters, and policy version", () => {
  it("V12: the Agent final rows match runtime forced_filters, and the global union does not", async () => {
    useProject(await makeProject());
    const app = await startApp();
    const preview = await request(app.server)
      .post("/api/admin/roles/preview-row-policy")
      .send({ roleId: "east_role", tables: [TABLE] })
      .expect(200);
    const tablePreview = preview.body.data.tables[0].preview;
    const agent = tablePreview.finalRowsByAgent.find(
      (entry: { agentId: string; finalRows: RowGrant }) => entry.agentId === "constrained_agent"
    );
    const agentPayload = buildForcedFiltersPayload(agent.finalRows, "fin_ledger");
    const globalPayload = buildForcedFiltersPayload(tablePreview.effectiveRowGrant, "fin_ledger");
    expect(agentPayload).toBeDefined();
    expect(globalPayload).not.toEqual(agentPayload);

    process.env.LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN = "1";
    const identity: Identity = { userId: "constrained_agent", tokenLabel: "unit-test", tokenHashPrefix: "unit-test" };
    const runtime = await authorizeAndRewrite(identity, "lucy_query", {
      connectionId: "warehouse",
      measures: ["fin_ledger.total_sales"]
    });
    expect(runtime.allowed).toBe(true);
    if (!runtime.allowed) return;
    expect(runtime.forcedFilters).toEqual(agentPayload);
    expect(preview.body.data.candidateDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(preview.body.data.confirmation.compileInputsDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("V16: a confirmed Role save changes policyVersion in the same process", async () => {
    useProject(await makeProject());
    const app = await startApp();
    const before = await request(app.server)
      .post("/api/admin/roles/preview-row-policy")
      .send({
        roleId: "west_role",
        role: { permission_model_version: 2, allow: allowFor("South") },
        tables: [TABLE]
      })
      .expect(200);
    expect(before.body.data.ok).toBe(true);
    const saved = await request(app.server)
      .patch("/api/admin/roles/west_role")
      .send({
        dryRun: false,
        patch: { allow: allowFor("South") },
        rowPolicyConfirmation: before.body.data.confirmation
      })
      .expect(200);
    expect(saved.body.data.written).toBe(true);
    expect(saved.body.data.status).toBe("committed");
    expect(saved.body.data.policyVersion).toMatch(/^[0-9a-f]{64}$/);
    expect(saved.body.data.policyVersion).not.toBe(before.body.data.basePolicyVersion);

    resetRowPolicyCatalogCacheForTests();
    const after = await request(app.server)
      .post("/api/admin/roles/preview-row-policy")
      .send({ roleId: "west_role", tables: [TABLE] })
      .expect(200);
    expect(after.body.data.basePolicyVersion).toBe(saved.body.data.policyVersion);
    expect(await accessText()).toContain("South");
  });

  it("V18: a successful preview does not relax an unproven upstream predicate", async () => {
    useProject(await makeProject());
    const app = await startApp();
    const preview = await request(app.server)
      .post("/api/admin/roles/preview-row-policy")
      .send({ roleId: "east_role", tables: [TABLE] })
      .expect(200);
    expect(preview.body.data.ok).toBe(true);
    const identity: Identity = { userId: "constrained_agent", tokenLabel: "unit-test", tokenHashPrefix: "unit-test" };
    await expect(
      authorizeAndRewrite(identity, "lucy_query", {
        connectionId: "warehouse",
        measures: ["fin_ledger.total_sales"]
      })
    ).resolves.toEqual({ allowed: false, reason: "row_policy_upstream_unproven" });
  });
});

describe("V13 — save rejections happen before any config write or row-policy intent", () => {
  async function previewSouth() {
    useProject(await makeProject());
    const before = await accessText();
    const intents = intentCalls();
    const app = await startApp();
    const preview = await request(app.server)
      .post("/api/admin/roles/preview-row-policy")
      .send({
        roleId: "west_role",
        role: { permission_model_version: 2, allow: allowFor("South") },
        tables: [TABLE]
      })
      .expect(200);
    expect(preview.body.data.ok).toBe(true);
    expect(preview.body.data.confirmation).toBeTruthy();
    return { app, before, intents, confirmation: preview.body.data.confirmation as Record<string, unknown> };
  }

  it("missing confirmation", async () => {
    const { app, before, intents } = await previewSouth();
    const res = await request(app.server)
      .patch("/api/admin/roles/west_role")
      .send({ dryRun: false, patch: { allow: allowFor("South") } })
      .expect(409);
    expect(res.body.error.code).toBe("ROW_POLICY_PREVIEW_REQUIRED");
    expect(res.body.error.detail.reason).toBe("missing");
    expect(await accessText()).toBe(before);
    expect(intentCalls()).toBe(intents);
  });

  it("preview_failed", async () => {
    const { app, before, intents, confirmation } = await previewSouth();
    const res = await request(app.server)
      .patch("/api/admin/roles/east_role")
      .send({
        dryRun: false,
        patch: { allow: allowFor("North") },
        rowPolicyConfirmation: confirmation
      })
      .expect(409);
    expect(res.body.error.detail.reason).toBe("preview_failed");
    expect(await accessText()).toBe(before);
    expect(intentCalls()).toBe(intents);
  });

  it("candidate_mismatch", async () => {
    const { app, before, intents, confirmation } = await previewSouth();
    const res = await request(app.server)
      .patch("/api/admin/roles/west_role")
      .send({
        dryRun: false,
        patch: { allow: allowFor("South") },
        rowPolicyConfirmation: { ...confirmation, candidateDigest: "f".repeat(64) }
      })
      .expect(409);
    expect(res.body.error.detail.reason).toBe("candidate_mismatch");
    expect(await accessText()).toBe(before);
    expect(intentCalls()).toBe(intents);
  });

  it("baseline_changed", async () => {
    const { app, before, intents, confirmation } = await previewSouth();
    const res = await request(app.server)
      .patch("/api/admin/roles/west_role")
      .send({
        dryRun: false,
        patch: { allow: allowFor("South") },
        rowPolicyConfirmation: { ...confirmation, baseAccessVersion: "stale-baseline" }
      })
      .expect(409);
    expect(res.body.error.detail.reason).toBe("baseline_changed");
    expect(await accessText()).toBe(before);
    expect(intentCalls()).toBe(intents);
  });

  it("compile_inputs_changed", async () => {
    const { app, before, intents, confirmation } = await previewSouth();
    const res = await request(app.server)
      .patch("/api/admin/roles/west_role")
      .send({
        dryRun: false,
        patch: { allow: allowFor("South") },
        rowPolicyConfirmation: { ...confirmation, compileInputsDigest: "e".repeat(64) }
      })
      .expect(409);
    expect(res.body.error.detail.reason).toBe("compile_inputs_changed");
    expect(await accessText()).toBe(before);
    expect(intentCalls()).toBe(intents);
  });

  it("impact_changed", async () => {
    const { app, before, intents, confirmation } = await previewSouth();
    const res = await request(app.server)
      .patch("/api/admin/roles/west_role")
      .send({
        dryRun: false,
        patch: { allow: allowFor("South") },
        rowPolicyConfirmation: { ...confirmation, impactDigest: "d".repeat(64) }
      })
      .expect(409);
    expect(res.body.error.detail.reason).toBe("impact_changed");
    expect(await accessText()).toBe(before);
    expect(intentCalls()).toBe(intents);
  });

  it("delete without confirmation leaves the Role in place", async () => {
    useProject(await makeProject({ access: UNUSED_SCOPED }));
    const before = await accessText();
    const intents = intentCalls();
    const app = await startApp();
    const res = await request(app.server)
      .delete("/api/admin/roles/spare_role")
      .send({ dryRun: false })
      .expect(409);
    expect(res.body.error.code).toBe("ROW_POLICY_PREVIEW_REQUIRED");
    expect(res.body.error.detail.reason).toBe("missing");
    expect(await accessText()).toBe(before);
    expect(intentCalls()).toBe(intents);
  });
});

describe("V20 / V21 — Admin preview attributes catalog failures with the four-tuple", () => {
  async function previewBroken(options: Parameters<typeof makeProject>[0], field = "region") {
    const access = `roles:
${scopedRole("east_role", "East").replace("field: region", `field: ${field}`)}
users: []
defaults:
  deny_tools: []
`;
    useProject(await makeProject({ access, ...options }));
    resetRowPolicyCatalogCacheForTests();
    const app = await startApp();
    return request(app.server)
      .post("/api/admin/roles/preview-row-policy")
      .send({ roleId: "east_role", tables: [TABLE] })
      .expect(200);
  }

  it("missing manifest is resolve, not 字段不存在", async () => {
    const res = await previewBroken({ writeSchema: false });
    const catalog = res.body.data.tables[0].catalog;
    expect(catalog.catalogLoaded).toBe(false);
    expect(catalog.stage).toBe("resolve");
    expect(catalog.reason).toContain("row_policy_catalog_unavailable");
    expect(res.body.data.tables[0].tableKey).toMatchObject({
      connectionId: "warehouse",
      schema: "fin",
      sourceName: "fin_ledger"
    });
    expect(JSON.stringify(res.body.data)).not.toContain("row_policy_field_unknown");
  });

  it("an unreadable manifest is the read stage", async () => {
    useProject(await makeProject());
    const manifest = path.join(projectRoot, "semantic-layer", "warehouse", "_schema", "fin.yaml");
    await chmod(manifest, 0o000);
    try {
      resetRowPolicyCatalogCacheForTests();
      const app = await startApp();
      const res = await request(app.server)
        .post("/api/admin/roles/preview-row-policy")
        .send({ roleId: "east_role", tables: [TABLE] })
        .expect(200);
      expect(res.body.data.tables[0].catalog.stage).toBe("read");
      expect(res.body.data.tables[0].catalog.reason).toContain("row_policy_catalog_unavailable");
    } finally {
      await chmod(manifest, 0o644);
    }
  });

  it("unparsable YAML is parse", async () => {
    const res = await previewBroken({ schemaYaml: "tables:\n  fin_ledger:\n   - [unbalanced\n" });
    expect(res.body.data.tables[0].catalog.stage).toBe("parse");
  });

  it("a parseable manifest with an illegal shape is parse", async () => {
    const res = await previewBroken({ schemaYaml: "not_tables:\n  fin_ledger: {}\n" });
    expect(res.body.data.tables[0].catalog.stage).toBe("parse");
    expect(JSON.stringify(res.body.data)).not.toContain("row_policy_field_unknown");
  });

  it("a duplicate column name is catalog", async () => {
    const res = await previewBroken({
      schemaYaml: `tables:
  fin_ledger:
    table: fin.fin_ledger
    columns:
      - name: region
      - name: Region
`
    });
    expect(res.body.data.tables[0].catalog.stage).toBe("catalog");
    expect(res.body.data.tables[0].catalog.reason).toContain("manifest_duplicate_column");
  });

  it("capability unknown stays capability_unknown and carries the four-tuple", async () => {
    process.env.LUCY_ROW_POLICY_CATALOG_CAPABILITY = "unknown";
    const res = await previewBroken({});
    const catalog = res.body.data.tables[0].catalog;
    expect(catalog.status).toBe("catalog_capability_unknown");
    expect(catalog.catalogLoaded).toBe(false);
    expect(catalog.reason).toContain("row_policy_catalog_capability_unknown");
    const body = JSON.stringify(res.body.data);
    expect(body).toContain("connection=warehouse");
    expect(body).toContain("schema=fin");
    expect(body).toContain("source=fin_ledger");
    expect(body).toContain("field=region");
    expect(body).not.toContain("row_policy_field_unknown");
  });

  it("V21: a legal empty column list attributes a missing field, including the four-tuple", async () => {
    const res = await previewBroken({
      schemaYaml: `tables:
  fin_ledger:
    table: fin.fin_ledger
    columns: []
`,
      overlayYaml: "measures:\n  - name: total_sales\n"
    }, "not_a_column");
    const body = JSON.stringify(res.body.data);
    expect(res.body.data.tables[0].catalog.status).toBe("loaded");
    expect(body).toContain("row_policy_field_unknown");
    expect(body).toContain("connection=warehouse");
    expect(body).toContain("schema=fin");
    expect(body).toContain("source=fin_ledger");
    expect(body).toContain("field=not_a_column");
    expect(body).not.toContain("row_policy_catalog_unavailable");
  });
});
