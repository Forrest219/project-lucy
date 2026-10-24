import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parse } from "yaml";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeCandidateDigest } from "../config-digest";
import { buildServer } from "../index";

/**
 * Lucy v0.25 — L25-14 R2 最终行约束预览 (§3.2 / §5.2 / §5.3, V08–V13).
 *
 * Under test:
 *  - the union across Roles keeps the DNF shape (OR-of-AND) and is never flattened;
 *  - two restricted Roles preview as TWO OR branches, never as 「行权限：全部行」;
 *  - one 「全部行」 Role makes the union 「全部行」;
 *  - an Agent with personal row limits yields the AND result next to the union;
 *  - the preview never touches the disk;
 *  - the preview is bound to a candidate digest and reports the baseline version.
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

const TWO_RESTRICTED_ROLES = accessYaml(
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

const ONE_ALL_ROWS_ROLE = accessYaml(
  `${scopedRole("east_role", "East")}\n${allRowsRole("all_role")}`,
  `  - id: all_wins_agent
    roles: [east_role, all_role]
    enabled: true
    tokens: []
`
);

let projectRoot: string;
let previousRoot: string | undefined;
let previousContentRoot: string | undefined;

async function makeProject(accessYamlText: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lucy-row-policy-preview-"));
  await mkdir(path.join(root, "webui", "config"), { recursive: true });
  await mkdir(path.join(root, "semantic-layer", "warehouse", "_schema"), { recursive: true });
  await writeFile(path.join(root, "ktx.yaml"), KTX_YAML, "utf8");
  await writeFile(path.join(root, "webui", "config", "access.yaml"), accessYamlText, "utf8");
  await writeFile(
    path.join(root, "semantic-layer", "warehouse", "_schema", "fin.yaml"),
    FIN_SCHEMA_YAML,
    "utf8"
  );
  await writeFile(
    path.join(root, "semantic-layer", "warehouse", "fin_ledger.yaml"),
    FIN_LEDGER_OVERLAY_YAML,
    "utf8"
  );
  return root;
}

async function loadPreview() {
  vi.resetModules();
  const preview = await import("../proxy/row-policy-preview");
  const rowPolicy = await import("../proxy/row-policy");
  rowPolicy.resetRowPolicyCatalogCacheForTests();
  return preview;
}

const TABLE = { connection: "warehouse", schema: "fin", name: "fin_ledger" };

beforeEach(() => {
  previousRoot = process.env.KTX_PROJECT_ROOT;
  previousContentRoot = process.env.LUCY_CONTENT_ROOT;
});

afterEach(async () => {
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  if (previousContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = previousContentRoot;
  if (projectRoot) await rm(projectRoot, { recursive: true, force: true });
});

describe("R2 computeFinalRowsForTable — union keeps the DNF shape", () => {
  it("two restricted Roles preview as TWO OR branches, never as 全部行", async () => {
    const { computeFinalRowsForTable } = await loadPreview();
    const computed = computeFinalRowsForTable(
      { connectionId: "warehouse", schema: "fin", sourceName: "fin_ledger" },
      [
        {
          roleId: "east_role",
          grant: {
            kind: "scoped",
            digest: "east",
            predicates: [{ field: "region", sourceName: "fin_ledger", op: "eq", value: "East" }],
            orArms: [[{ field: "region", sourceName: "fin_ledger", op: "eq", value: "East" }]]
          }
        },
        {
          roleId: "west_role",
          grant: {
            kind: "scoped",
            digest: "west",
            predicates: [{ field: "region", sourceName: "fin_ledger", op: "eq", value: "West" }],
            orArms: [[{ field: "region", sourceName: "fin_ledger", op: "eq", value: "West" }]]
          }
        }
      ],
      []
    );
    expect(computed.ok).toBe(true);
    if (!computed.ok) return;
    expect(computed.preview.effectiveRowGrant.kind).toBe("scoped");
    if (computed.preview.effectiveRowGrant.kind !== "scoped") return;
    // Two OR branches — NOT flattened into one AND, NOT 全部行.
    expect(computed.preview.effectiveRowGrant.orArms).toHaveLength(2);
    expect(computed.preview.roleIds).toEqual(["east_role", "west_role"]);
    expect(computed.preview.displayShape).toBe("OR-of-AND");
  });

  it("one 全部行 Role makes the union 全部行", async () => {
    const { computeFinalRowsForTable } = await loadPreview();
    const computed = computeFinalRowsForTable(
      { connectionId: "warehouse", schema: "fin", sourceName: "fin_ledger" },
      [
        {
          roleId: "east_role",
          grant: {
            kind: "scoped",
            digest: "east",
            predicates: [{ field: "region", sourceName: "fin_ledger", op: "eq", value: "East" }],
            orArms: [[{ field: "region", sourceName: "fin_ledger", op: "eq", value: "East" }]]
          }
        },
        { roleId: "all_role", grant: { kind: "all" } }
      ],
      []
    );
    expect(computed.ok).toBe(true);
    if (!computed.ok) return;
    expect(computed.preview.effectiveRowGrant).toEqual({ kind: "all" });
  });

  it("no applicable grant is NOT 全部行", async () => {
    const { computeFinalRowsForTable } = await loadPreview();
    const computed = computeFinalRowsForTable(
      { connectionId: "warehouse", schema: "fin", sourceName: "fin_ledger" },
      [],
      []
    );
    expect(computed.ok).toBe(false);
    if (computed.ok) return;
    expect(computed.reason).toBe("row_policy_no_applicable_grant");
  });
});

describe("R2 previewRowPolicyDraft — the in-memory candidate", () => {
  it("previews the union across Roles and the AND result of an Agent with personal row limits", async () => {
    projectRoot = await makeProject(TWO_RESTRICTED_ROLES);
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    const { previewRowPolicyDraft } = await loadPreview();

    const outcome = await previewRowPolicyDraft({
      roleId: "east_role",
      role: {
        permission_model_version: 2,
        allow: {
          connections: ["warehouse"],
          tableSelectors: [
            {
              connection: "warehouse",
              schema: "fin",
              names: ["fin_ledger"],
              row_access: "scoped",
              row_policy: { predicates: [{ field: "region", op: "eq", value: "East" }] }
            }
          ],
          tools: ["lucy_query"]
        }
      },
      tables: [TABLE]
    });

    expect(outcome.ok).toBe(true);
    const table = outcome.tables[0]!;
    expect(table.error).toBeUndefined();
    expect(table.preview).toBeDefined();
    if (!table.preview) return;

    // The union across the two restricted Roles keeps two OR branches.
    expect(table.preview.effectiveRowGrant.kind).toBe("scoped");
    if (table.preview.effectiveRowGrant.kind !== "scoped") return;
    expect(table.preview.effectiveRowGrant.orArms).toHaveLength(2);

    // The Agent with personal row limits shows the AND result next to the union.
    const constrained = table.preview.finalRowsByAgent.find((item) => item.agentId === "constrained_agent");
    expect(constrained).toBeDefined();
    if (!constrained) return;
    expect(constrained.finalRows.kind).toBe("scoped");
    if (constrained.finalRows.kind !== "scoped") return;
    // (region=East) ∧ (region=East) OR (region=West) ∧ (region=East) → the second arm is pruned.
    expect(constrained.finalRows.orArms).toHaveLength(1);
    expect(constrained.finalRows.orArms[0]).toHaveLength(2);
  });

  it("one 全部行 Role makes the previewed union 全部行", async () => {
    projectRoot = await makeProject(ONE_ALL_ROWS_ROLE);
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    const { previewRowPolicyDraft } = await loadPreview();

    const outcome = await previewRowPolicyDraft({ roleId: "east_role", tables: [TABLE] });
    expect(outcome.ok).toBe(true);
    const table = outcome.tables[0]!;
    expect(table.preview?.effectiveRowGrant).toEqual({ kind: "all" });
  });

  it("leaves the disk unchanged", async () => {
    projectRoot = await makeProject(TWO_RESTRICTED_ROLES);
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    const { previewRowPolicyDraft } = await loadPreview();

    const accessPath = path.join(projectRoot, "webui", "config", "access.yaml");
    const before = await readFile(accessPath, "utf8");
    const schemaBefore = await readFile(
      path.join(projectRoot, "semantic-layer", "warehouse", "_schema", "fin.yaml"),
      "utf8"
    );

    await previewRowPolicyDraft({
      roleId: "east_role",
      role: {
        permission_model_version: 2,
        allow: {
          connections: ["warehouse"],
          tableSelectors: [
            {
              connection: "warehouse",
              schema: "fin",
              names: ["fin_ledger"],
              row_access: "scoped",
              row_policy: { predicates: [{ field: "region", op: "eq", value: "North" }] }
            }
          ],
          tools: ["lucy_query"]
        }
      },
      tables: [TABLE]
    });

    expect(await readFile(accessPath, "utf8")).toBe(before);
    expect(
      await readFile(path.join(projectRoot, "semantic-layer", "warehouse", "_schema", "fin.yaml"), "utf8")
    ).toBe(schemaBefore);
  });

  it("binds the result to a candidate digest and reports the baseline policy version", async () => {
    projectRoot = await makeProject(TWO_RESTRICTED_ROLES);
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    const { previewRowPolicyDraft } = await loadPreview();

    const raw = await readFile(path.join(projectRoot, "webui", "config", "access.yaml"), "utf8");
    const currentConfig = parse(raw) as Record<string, unknown>;
    const draftRole = {
      permission_model_version: 2,
      allow: {
        connections: ["warehouse"],
        tableSelectors: [
          {
            connection: "warehouse",
            schema: "fin",
            names: ["fin_ledger"],
            row_access: "scoped",
            row_policy: { predicates: [{ field: "region", op: "eq", value: "North" }] }
          }
        ],
        tools: ["lucy_query"]
      }
    };
    const expectedCandidateDigest = computeCandidateDigest({
      ...currentConfig,
      roles: { ...(currentConfig.roles as Record<string, unknown>), east_role: draftRole }
    });

    const outcome = await previewRowPolicyDraft({
      roleId: "east_role",
      role: draftRole,
      tables: [TABLE]
    });

    expect(outcome.candidateDigest).toBe(expectedCandidateDigest);
    expect(outcome.candidateDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(outcome.basePolicyVersion).toMatch(/^[0-9a-f]{64}$/);

    // A different draft ⇒ a different candidate digest ⇒ the previous preview is stale.
    const other = await previewRowPolicyDraft({
      roleId: "east_role",
      role: {
        ...draftRole,
        allow: {
          ...draftRole.allow,
          tableSelectors: [
            {
              ...draftRole.allow.tableSelectors[0]!,
              row_policy: { predicates: [{ field: "region", op: "eq", value: "South" }] }
            }
          ]
        }
      },
      tables: [TABLE]
    });
    expect(other.candidateDigest).not.toBe(outcome.candidateDigest);
  });

  it("reports the catalog provenance for the previewed table", async () => {
    projectRoot = await makeProject(TWO_RESTRICTED_ROLES);
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    const { previewRowPolicyDraft } = await loadPreview();

    const outcome = await previewRowPolicyDraft({ roleId: "east_role", tables: [TABLE] });
    const table = outcome.tables[0]!;
    expect(table.catalog.status).toBe("loaded");
    expect(table.catalog.catalogLoaded).toBe(true);
    expect(table.catalog.manifestPathDigest).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("R2 preview route — POST /api/admin/roles/preview-row-policy", () => {
  it("returns the preview, the candidate digest and the baseline version", async () => {
    projectRoot = await makeProject(TWO_RESTRICTED_ROLES);
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";

    const app = buildServer();
    // `buildServer()` already wires `registerRowPolicyRoutes` (the route is
    // registered in `webui/server/index.ts`); registering it again here would
    // declare the same method+path twice.
    await app.ready();

    const res = await request(app.server)
      .post("/api/admin/roles/preview-row-policy")
      .send({ roleId: "east_role", tables: [TABLE] })
      .expect(200);

    expect(res.body.data.ok).toBe(true);
    expect(res.body.data.candidateDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.data.basePolicyVersion).toMatch(/^[0-9a-f]{64}$/);
    const table = res.body.data.tables[0];
    expect(table.preview.effectiveRowGrant.kind).toBe("scoped");
    expect(table.preview.effectiveRowGrant.orArms).toHaveLength(2);
    expect(table.catalog.status).toBe("loaded");
  });

  it("rejects a malformed request", async () => {
    projectRoot = await makeProject(TWO_RESTRICTED_ROLES);
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";

    const app = buildServer();
    await app.ready();

    await request(app.server)
      .post("/api/admin/roles/preview-row-policy")
      .send({ tables: [TABLE] })
      .expect(400);
    await request(app.server)
      .post("/api/admin/roles/preview-row-policy")
      .send({ roleId: "east_role", tables: [] })
      .expect(400);
  });
});
