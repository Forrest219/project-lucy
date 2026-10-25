import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { parse } from "yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Lucy v0.25 P1 — L25-14 R1: 行策略模板的模型、展开、引用面与写入口.
 *
 * Authority: docs/specs/lucy-20261025-v0p25-row-policy-templates-and-view-spec.md
 *   §3.1 / §3.2 / §4 / §5.1 / §5.2; RTP-01 … RTP-10.
 *
 * What is asserted here is BEHAVIOUR, not the existence of a function:
 *  - a missing template reference fails closed and is never repaired silently;
 *  - a referenced template cannot be deleted or renamed, and the refusal happens
 *    BEFORE any write (zero writes);
 *  - a stale candidate digest cannot be committed;
 *  - the audit carries the actor / operation id / digests / impact and no secret.
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

const KTX_YAML = `connections:
  warehouse:
    driver: mysql
    enabled_tables:
      - fin.fin_ledger
`;

const FIN_SCHEMA_YAML = `tables:
  fin_ledger:
    table: fin.fin_ledger
    columns:
      - name: region
      - name: status
`;

const FIN_LEDGER_OVERLAY_YAML = `columns:
  - name: region
  - name: status
measures:
  - name: total_sales
`;

const TOOLS = `      tools:
        - lucy_query`;

function scopedRole(roleId: string, rowPolicy: string): string {
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
${rowPolicy}
${TOOLS}`;
}

function accessYaml(options: {
  templates?: string;
  roles?: string;
  users?: string;
}): string {
  return `${options.templates ? `row_policy_templates:\n${options.templates}` : ""}roles:
${options.roles ?? ""}users:
${options.users ?? `  - id: agent_a
    name: Agent A
    roles: [east_role]
    enabled: true
    tokens: []
`}defaults:
  deny_tools: []
`;
}

const TEMPLATE_BY_REGION = `  by_region:
    description: 按大区限定行
    predicates:
      - field: region
        op: eq
        value: East
`;

const TEMPLATE_ROLE = scopedRole(
  "east_role",
  `            template: by_region
            predicates:
              - field: status
                op: eq
                value: SETTLED`
);

const INLINE_ROLE = scopedRole(
  "east_role",
  `            predicates:
              - field: region
                op: eq
                value: East
              - field: status
                op: eq
                value: SETTLED`
);

let projectRoot: string;
let previousRoot: string | undefined;
let previousContentRoot: string | undefined;

async function makeProject(accessYamlText: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lucy-p1-row-policy-templates-"));
  await mkdir(path.join(root, "webui", "config"), { recursive: true });
  await mkdir(path.join(root, "semantic-layer", "warehouse", "_schema"), { recursive: true });
  await writeFile(path.join(root, "ktx.yaml"), KTX_YAML, "utf8");
  await writeFile(path.join(root, "webui", "config", "access.yaml"), accessYamlText, "utf8");
  await writeFile(path.join(root, "semantic-layer", "warehouse", "_schema", "fin.yaml"), FIN_SCHEMA_YAML, "utf8");
  await writeFile(path.join(root, "semantic-layer", "warehouse", "fin_ledger.yaml"), FIN_LEDGER_OVERLAY_YAML, "utf8");
  return root;
}

async function loadTemplates() {
  vi.resetModules();
  const rowPolicy = await import("../proxy/row-policy");
  rowPolicy.resetRowPolicyCatalogCacheForTests();
  const templates = await import("../admin/row-policy-templates");
  const acl = await import("../proxy/acl");
  return { ...templates, acl };
}

/**
 * A minimal Admin app.
 *
 * The routes resolve the audit actor from `request.lucyAdmin` — the trusted
 * context the auth guard attaches in the real server. The test app attaches the
 * same context so the write path sees an authenticated Admin.
 */
function buildApp() {
  const app = Fastify();
  app.addHook("onRequest", async (request) => {
    request.lucyAdmin = {
      session: null,
      admin: {
        id: "admin_a",
        account_uid: "uid_admin_a",
        display_name: "Admin A",
        role: "owner",
        enabled: true,
        created_at: "2026-01-01T00:00:00.000Z"
      },
      stateUnavailable: false,
      authMode: "required"
    };
  });
  return app;
}

beforeEach(() => {
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
});

describe("C1 — the template shape is validated before anything is stored", () => {
  it("rejects a template name that does not match the identifier pattern", async () => {
    const { validateRowPolicyTemplateDefinition } = await loadTemplates();
    for (const name of ["1bad", "bad name", "bad.name", ""]) {
      const validated = validateRowPolicyTemplateDefinition(name, { predicates: [{ field: "region", op: "eq", value: "East" }] });
      expect(validated.ok).toBe(false);
      if (validated.ok) continue;
      expect(validated.issues[0].code).toBe("row_policy_template_name_invalid");
    }
  });

  it("rejects empty predicates, an illegal op and a non-scalar value", async () => {
    const { validateRowPolicyTemplateDefinition } = await loadTemplates();
    const empty = validateRowPolicyTemplateDefinition("t", { predicates: [] });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.issues[0].code).toBe("row_policy_predicates_required");

    const badOp = validateRowPolicyTemplateDefinition("t", { predicates: [{ field: "region", op: "like", value: "E" }] });
    expect(badOp.ok).toBe(false);
    if (!badOp.ok) expect(badOp.issues[0].code).toBe("row_policy_op_forbidden");

    const badValue = validateRowPolicyTemplateDefinition("t", { predicates: [{ field: "region", op: "eq", value: { a: 1 } }] });
    expect(badValue.ok).toBe(false);
    if (!badValue.ok) expect(badValue.issues[0].code).toBe("row_policy_value_invalid");
  });

  it("deduplicates `in` values, keeps the type and keeps the order out of the digest", async () => {
    const { validateRowPolicyTemplateDefinition, rowPolicyTemplateDigest } = await loadTemplates();
    const validated = validateRowPolicyTemplateDefinition("t", {
      predicates: [{ field: "region", op: "in", values: ["East", "East", "West", 1, "1"] }]
    });
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    // `1` and `"1"` are two different values — collapsing them would change rows.
    expect(validated.definition.predicates[0].values).toEqual(["East", "West", 1, "1"]);

    const reordered = validateRowPolicyTemplateDefinition("t", {
      predicates: [{ field: "region", op: "in", values: ["West", 1, "East", "1"] }]
    });
    expect(reordered.ok).toBe(true);
    if (!reordered.ok) return;
    expect(rowPolicyTemplateDigest(reordered.definition)).toBe(rowPolicyTemplateDigest(validated.definition));
  });

  it("refuses `row_access: all` with a row policy and a v1 Role that references a template", async () => {
    const { expandRowPolicySelector } = await loadTemplates();
    const templates = {
      by_region: { name: "by_region", predicates: [{ field: "region", op: "eq" as const, value: "East" }] }
    };

    const allWithPolicy = expandRowPolicySelector(
      { row_access: "all", row_policy: { template: "by_region" } },
      templates
    );
    expect(allWithPolicy.ok).toBe(false);
    if (!allWithPolicy.ok) expect(allWithPolicy.issues[0].code).toBe("row_policy_on_all_forbidden");

    const v1 = expandRowPolicySelector(
      { row_access: "scoped", row_policy: { template: "by_region" } },
      templates,
      { roleId: "old_role", permissionModelVersion: 1 }
    );
    expect(v1.ok).toBe(false);
    if (!v1.ok) expect(v1.issues[0].code).toBe("v1_template_reference_forbidden");
  });
});

describe("C2 — the template is expanded BEFORE the existing row-policy compiler", () => {
  it("puts the template predicates first and the inline predicates after", async () => {
    const { expandRowPolicySelector } = await loadTemplates();
    const expanded = expandRowPolicySelector(
      {
        row_access: "scoped",
        row_policy: {
          template: "by_region",
          predicates: [{ field: "status", op: "eq", value: "SETTLED" }]
        }
      },
      { by_region: { name: "by_region", predicates: [{ field: "region", op: "eq", value: "East" }] } }
    );
    expect(expanded.ok).toBe(true);
    if (!expanded.ok) return;
    expect(expanded.rowPolicy?.predicates).toEqual([
      { field: "region", op: "eq", value: "East" },
      { field: "status", op: "eq", value: "SETTLED" }
    ]);
    expect(expanded.templatePredicateCount).toBe(1);
    expect(expanded.inlinePredicateCount).toBe(1);
  });

  it("compiles the expanded template to the SAME grant as the equivalent inline policy", async () => {
    projectRoot = await makeProject(accessYaml({ roles: `${INLINE_ROLE}\n` }));
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const { acl, expandRowPolicyTemplatesInConfig } = await loadTemplates();

    const templateConfig = {
      roles: {
        east_role: {
          permission_model_version: 2,
          allow: {
            connections: ["warehouse"],
            tableSelectors: [
              {
                connection: "warehouse",
                schema: "fin",
                names: ["fin_ledger"],
                row_access: "scoped",
                row_policy: {
                  template: "by_region",
                  predicates: [{ field: "status", op: "eq", value: "SETTLED" }]
                }
              }
            ],
            tools: ["lucy_query"]
          }
        }
      },
      users: [],
      row_policy_templates: {
        by_region: { description: "x", predicates: [{ field: "region", op: "eq", value: "East" }] }
      }
    };
    const inlineConfig = {
      ...templateConfig,
      row_policy_templates: {},
      roles: {
        east_role: {
          ...templateConfig.roles.east_role,
          allow: {
            ...templateConfig.roles.east_role.allow,
            tableSelectors: [
              {
                ...templateConfig.roles.east_role.allow.tableSelectors[0],
                row_policy: {
                  predicates: [
                    { field: "region", op: "eq", value: "East" },
                    { field: "status", op: "eq", value: "SETTLED" }
                  ]
                }
              }
            ]
          }
        }
      }
    };

    const expanded = expandRowPolicyTemplatesInConfig(templateConfig as never);
    expect(expanded.ok).toBe(true);
    const expandedContext = await acl.buildAdminPermissionContext(expanded.config as never);
    const inlineContext = await acl.buildAdminPermissionContext(inlineConfig as never);
    const expandedRole = await acl.compileRoleForAdmin("east_role", expandedContext);
    const inlineRole = await acl.compileRoleForAdmin("east_role", inlineContext);
    expect(expandedRole.ok).toBe(true);
    expect(inlineRole.ok).toBe(true);
    if (!expandedRole.ok || !inlineRole.ok) return;
    const digestOf = (caps: typeof expandedRole.capabilities) =>
      (caps ?? []).map((cap) => `${cap.sourceName}:${cap.rowGrant.kind === "all" ? "all" : cap.rowGrant.digest}`).join(",");
    expect(digestOf(expandedRole.capabilities)).toBe(digestOf(inlineRole.capabilities));
  });

  it("fails closed on a missing template reference instead of dropping the predicates", async () => {
    const { expandRowPolicySelector, expandRowPolicyTemplatesInConfig } = await loadTemplates();
    const missing = expandRowPolicySelector(
      { row_access: "scoped", row_policy: { template: "gone" } },
      {}
    );
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.issues[0].code).toBe("row_policy_template_unresolved");

    const config = {
      roles: {
        east_role: {
          permission_model_version: 2,
          allow: {
            connections: ["warehouse"],
            tableSelectors: [
              {
                connection: "warehouse",
                schema: "fin",
                names: ["fin_ledger"],
                row_access: "scoped",
                row_policy: { template: "gone" }
              }
            ]
          }
        }
      },
      users: []
    };
    const expanded = expandRowPolicyTemplatesInConfig(config as never);
    expect(expanded.ok).toBe(false);
    expect(expanded.issues.some((issue) => issue.code === "row_policy_template_unresolved")).toBe(true);
    // The rewritten selector must be REJECTED by the existing compiler, never widened.
    const selector = (expanded.config.roles?.east_role?.allow?.tableSelectors ?? [])[0] as
      | { row_policy?: { predicates?: unknown[] } }
      | undefined;
    expect(selector?.row_policy?.predicates).toEqual([]);
  });
});

describe("C3 — the reference surface blocks a delete or a rename", () => {
  it("refuses to delete a referenced template and reports the references", async () => {
    const { applyRowPolicyTemplateOperation } = await loadTemplates();
    const config = {
      row_policy_templates: { by_region: { predicates: [{ field: "region", op: "eq", value: "East" }] } },
      roles: {
        east_role: {
          permission_model_version: 2,
          allow: {
            tableSelectors: [
              {
                connection: "warehouse",
                schema: "fin",
                names: ["fin_ledger"],
                row_access: "scoped",
                row_policy: { template: "by_region" }
              }
            ]
          }
        }
      },
      users: []
    };
    const applied = applyRowPolicyTemplateOperation(config as never, { kind: "delete", name: "by_region" });
    expect(applied.ok).toBe(false);
    if (applied.ok) return;
    expect(applied.issues[0].code).toBe("row_policy_template_in_use");
    expect(applied.blockingReferences).toHaveLength(1);
    expect(applied.blockingReferences[0].roleId).toBe("east_role");
    // Zero writes: the configuration object is untouched.
    expect((config.row_policy_templates as Record<string, unknown>).by_region).toBeDefined();
  });

  it("refuses to rename a referenced template (a rename is a delete + a create)", async () => {
    const { applyRowPolicyTemplateOperation } = await loadTemplates();
    const config = {
      row_policy_templates: { by_region: { predicates: [{ field: "region", op: "eq", value: "East" }] } },
      roles: {
        east_role: {
          permission_model_version: 2,
          allow: {
            tableSelectors: [
              {
                connection: "warehouse",
                schema: "fin",
                names: ["fin_ledger"],
                row_access: "scoped",
                row_policy: { template: "by_region" }
              }
            ]
          }
        }
      },
      users: []
    };
    const applied = applyRowPolicyTemplateOperation(config as never, {
      kind: "patch",
      name: "by_region",
      newName: "by_area",
      definition: { predicates: [{ field: "region", op: "eq", value: "West" }] }
    });
    expect(applied.ok).toBe(false);
    if (applied.ok) return;
    expect(applied.issues[0].code).toBe("row_policy_template_in_use");
    expect((config.row_policy_templates as Record<string, unknown>).by_area).toBeUndefined();
  });

  it("allows deleting an unreferenced template", async () => {
    const { applyRowPolicyTemplateOperation } = await loadTemplates();
    const config = {
      row_policy_templates: { unused: { predicates: [{ field: "region", op: "eq", value: "East" }] } },
      roles: {},
      users: []
    };
    const applied = applyRowPolicyTemplateOperation(config as never, { kind: "delete", name: "unused" });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.removed).toEqual(["unused"]);
    expect((applied.config.row_policy_templates as Record<string, unknown>).unused).toBeUndefined();
  });

  it("reports an externally broken reference instead of repairing it", async () => {
    const { unresolvedRowPolicyTemplateReferences, expandRowPolicyTemplatesInConfig } = await loadTemplates();
    const config = {
      row_policy_templates: {},
      roles: {
        east_role: {
          permission_model_version: 2,
          allow: {
            tableSelectors: [
              {
                connection: "warehouse",
                schema: "fin",
                names: ["fin_ledger"],
                row_access: "scoped",
                row_policy: { template: "vanished" }
              }
            ]
          }
        }
      },
      users: []
    };
    const unresolved = unresolvedRowPolicyTemplateReferences(config as never, {});
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0].roleId).toBe("east_role");
    const expanded = expandRowPolicyTemplatesInConfig(config as never);
    expect(expanded.ok).toBe(false);
    // The reference is NOT rewritten into an inline policy.
    const selector = (expanded.config.roles?.east_role?.allow?.tableSelectors ?? [])[0] as
      | { row_policy?: Record<string, unknown> }
      | undefined;
    expect(selector?.row_policy?.template).toBeUndefined();
  });
});

describe("C4 — the template write API goes through the shared coordinator", () => {
  it("dry-run does not touch the disk and returns the impact surface", async () => {
    projectRoot = await makeProject(
      accessYaml({ templates: TEMPLATE_BY_REGION, roles: `${scopedRole("other_role", `            predicates:\n              - field: region\n                op: eq\n                value: West`)}\n` })
    );
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const { registerRowPolicyTemplateRoutes } = await import("../admin/routes/row-policy");
    const app = buildApp();
    registerRowPolicyTemplateRoutes(app);
    await app.ready();

    const before = await readFile(path.join(projectRoot, "webui", "config", "access.yaml"), "utf8");
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/row-policy/templates",
      payload: {
        name: "by_status",
        description: "按状态限定行",
        predicates: [{ field: "status", op: "eq", value: "SETTLED" }]
      }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.data.dryRun).toBe(true);
    expect(body.data.written).toBe(false);
    expect(typeof body.data.candidateDigest).toBe("string");
    expect(body.data.operationId).toBeTruthy();
    const after = await readFile(path.join(projectRoot, "webui", "config", "access.yaml"), "utf8");
    expect(after).toBe(before);
    await app.close();
  });

  it("refuses a stale candidate digest and writes nothing", async () => {
    projectRoot = await makeProject(accessYaml({ templates: TEMPLATE_BY_REGION, roles: `${TEMPLATE_ROLE}\n` }));
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const { registerRowPolicyTemplateRoutes } = await import("../admin/routes/row-policy");
    const app = buildApp();
    registerRowPolicyTemplateRoutes(app);
    await app.ready();

    const before = await readFile(path.join(projectRoot, "webui", "config", "access.yaml"), "utf8");
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/row-policy/templates",
      payload: {
        dryRun: false,
        version: "stale-version",
        candidateDigest: "stale-digest",
        name: "by_status",
        predicates: [{ field: "status", op: "eq", value: "SETTLED" }]
      }
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("VERSION_CONFLICT");
    const after = await readFile(path.join(projectRoot, "webui", "config", "access.yaml"), "utf8");
    expect(after).toBe(before);
    await app.close();
  });

  it("refuses a formal save whose candidate digest does not match the fresh preview", async () => {
    projectRoot = await makeProject(accessYaml({ templates: TEMPLATE_BY_REGION, roles: `${TEMPLATE_ROLE}\n` }));
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const { registerRowPolicyTemplateRoutes } = await import("../admin/routes/row-policy");
    const app = buildApp();
    registerRowPolicyTemplateRoutes(app);
    await app.ready();

    const before = await readFile(path.join(projectRoot, "webui", "config", "access.yaml"), "utf8");
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/row-policy/templates",
      payload: {
        dryRun: false,
        candidateDigest: "not-the-previewed-digest",
        name: "by_status",
        predicates: [{ field: "status", op: "eq", value: "SETTLED" }]
      }
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("NEW_PREVIEW_REQUIRED");
    const after = await readFile(path.join(projectRoot, "webui", "config", "access.yaml"), "utf8");
    expect(after).toBe(before);
    await app.close();
  });

  it("commits a confirmed preview and records an audit without secrets", async () => {
    projectRoot = await makeProject(accessYaml({ templates: TEMPLATE_BY_REGION, roles: `${TEMPLATE_ROLE}\n` }));
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const audit = await import("../admin/audit");
    const { registerRowPolicyTemplateRoutes } = await import("../admin/routes/row-policy");
    const app = buildApp();
    registerRowPolicyTemplateRoutes(app);
    await app.ready();

    const preview = await app.inject({
      method: "POST",
      url: "/api/admin/row-policy/templates",
      payload: {
        name: "by_status",
        description: "按状态限定行",
        predicates: [{ field: "status", op: "eq", value: "SETTLED" }]
      }
    });
    expect(preview.statusCode).toBe(200);
    const previewData = preview.json().data;

    const commit = await app.inject({
      method: "POST",
      url: "/api/admin/row-policy/templates",
      payload: {
        dryRun: false,
        version: previewData.version,
        candidateDigest: previewData.candidateDigest,
        name: "by_status",
        description: "按状态限定行",
        predicates: [{ field: "status", op: "eq", value: "SETTLED" }]
      }
    });
    expect(commit.statusCode).toBe(200);
    const commitData = commit.json().data;
    expect(commitData.written).toBe(true);
    // A formal save is only successful when the runtime confirmed the policy.
    expect(commitData.runtimeAck).toBe(true);

    const raw = await readFile(path.join(projectRoot, "webui", "config", "access.yaml"), "utf8");
    expect(raw).toContain("row_policy_templates");
    expect(raw).toContain("by_status");

    const calls = (audit.recordConfigChange as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const intent = calls[0]?.[0] as Record<string, unknown>;
    expect(intent.changeType).toBe("row_policy_template_create");
    expect(intent.targetId).toBe("by_status");
    expect(intent.requestId).toBe(commitData.operationId);
    const newSummary = intent.newSummary as { templates: Array<{ name: string; digest: string }>; agents: unknown[] };
    expect(newSummary.templates.some((item) => item.name === "by_status")).toBe(true);
    // The audit must not carry a token, a password or the whole access.yaml.
    const serialized = JSON.stringify(intent);
    expect(serialized).not.toContain("sha256:");
    expect(serialized).not.toContain("tokens");
    await app.close();
  });

  it("refuses to delete a referenced template and writes nothing", async () => {
    projectRoot = await makeProject(accessYaml({ templates: TEMPLATE_BY_REGION, roles: `${TEMPLATE_ROLE}\n` }));
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const { registerRowPolicyTemplateRoutes } = await import("../admin/routes/row-policy");
    const app = buildApp();
    registerRowPolicyTemplateRoutes(app);
    await app.ready();

    const before = await readFile(path.join(projectRoot, "webui", "config", "access.yaml"), "utf8");
    const res = await app.inject({
      method: "DELETE",
      url: "/api/admin/row-policy/templates/by_region",
      payload: { dryRun: false }
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("row_policy_template_in_use");
    const after = await readFile(path.join(projectRoot, "webui", "config", "access.yaml"), "utf8");
    expect(after).toBe(before);
    await app.close();
  });

  it("the validate endpoint checks a candidate without writing it", async () => {
    projectRoot = await makeProject(accessYaml({ templates: TEMPLATE_BY_REGION, roles: `${TEMPLATE_ROLE}\n` }));
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const { registerRowPolicyTemplateRoutes } = await import("../admin/routes/row-policy");
    const app = buildApp();
    registerRowPolicyTemplateRoutes(app);
    await app.ready();

    const before = await readFile(path.join(projectRoot, "webui", "config", "access.yaml"), "utf8");
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/row-policy/templates/validate",
      payload: {
        operation: {
          kind: "create",
          name: "by_status",
          definition: { predicates: [{ field: "status", op: "eq", value: "SETTLED" }] }
        }
      }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.dryRun).toBe(true);
    expect(res.json().data.written).toBe(false);
    const after = await readFile(path.join(projectRoot, "webui", "config", "access.yaml"), "utf8");
    expect(after).toBe(before);
    await app.close();
  });

  it("the template list reports the references and the per-table usability", async () => {
    projectRoot = await makeProject(accessYaml({ templates: TEMPLATE_BY_REGION, roles: `${TEMPLATE_ROLE}\n` }));
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const { registerRowPolicyTemplateRoutes } = await import("../admin/routes/row-policy");
    const app = buildApp();
    registerRowPolicyTemplateRoutes(app);
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/api/admin/row-policy/templates" });
    expect(res.statusCode).toBe(200);
    const templates = res.json().data.templates as Array<{
      name: string;
      references: Array<{ roleId: string }>;
      usabilityByTable: Array<{ usability: { status: string } }>;
    }>;
    const byRegion = templates.find((template) => template.name === "by_region");
    expect(byRegion).toBeDefined();
    expect(byRegion?.references.map((reference) => reference.roleId)).toEqual(["east_role"]);
    expect(byRegion?.usabilityByTable[0]?.usability.status).toBe("bindable");
    await app.close();
  });
});

describe("RTP-10 — an existing configuration without templates behaves exactly as before", () => {
  it("the expansion leaves a template-free configuration untouched", async () => {
    const { expandRowPolicyTemplatesInConfig } = await loadTemplates();
    const config = {
      roles: {
        east_role: {
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
            ]
          }
        }
      },
      users: []
    };
    const expanded = expandRowPolicyTemplatesInConfig(config as never);
    expect(expanded.ok).toBe(true);
    expect(expanded.issues).toHaveLength(0);
    const selector = (expanded.config.roles?.east_role?.allow?.tableSelectors ?? [])[0] as
      | { row_policy?: { predicates?: unknown[] } }
      | undefined;
    expect(selector?.row_policy?.predicates).toEqual([{ field: "region", op: "eq", value: "East" }]);
  });
});

// ─── P2-2 ──────────────────────────────────────────────────────────────────────
//
// The catalog and the two write paths must agree: an ILLEGAL template that no
// selector references is a diagnostic, never a reason to refuse an unrelated
// write — and never something a write may silently delete.

/** A template whose STORED shape is illegal: `unexpected_key` is not allowed. */
const ILLEGAL_TEMPLATE = `  broken_tpl:
    description: 形状非法的模板
    predicates:
      - field: region
        op: eq
        value: East
    unexpected_key: true
`;

function accessPathOf(root: string): string {
  return path.join(root, "webui", "config", "access.yaml");
}

/** The Admin app with the ROLE routes — the other write path under test. */
async function buildRoleApp() {
  const { registerRoleRoutes } = await import("../admin/roles");
  const app = buildApp();
  registerRoleRoutes(app);
  await app.ready();
  return app;
}

/** The §4 two-step write contract: dry-run first, then commit that preview. */
async function dryRunThenCommit(
  app: ReturnType<typeof buildApp>,
  method: "POST" | "PATCH" | "DELETE",
  url: string,
  payload: Record<string, unknown>
) {
  const preview = await app.inject({ method, url, payload: { ...payload, dryRun: true } });
  expect(preview.statusCode).toBe(200);
  const previewData = preview.json().data;
  const commit = await app.inject({
    method,
    url,
    payload: {
      ...payload,
      dryRun: false,
      version: previewData.version,
      candidateDigest: previewData.candidateDigest
    }
  });
  return { preview, commit };
}

const NEW_ROLE_PAYLOAD = {
  description: "新建角色",
  permission_model_version: 2,
  allow: {
    connections: ["warehouse"],
    tableSelectors: [
      {
        connection: "warehouse",
        schema: "fin",
        names: ["fin_ledger"],
        row_access: "scoped",
        row_policy: {
          template: "by_region",
          predicates: [{ field: "status", op: "eq", value: "SETTLED" }]
        }
      }
    ],
    tools: ["lucy_query"]
  }
};

describe("P2-2 — the illegal template is a diagnostic, never a silent deletion", () => {
  it("P2-2 — an illegal template nobody references does not block a Role create/patch and survives the write", async () => {
    projectRoot = await makeProject(
      accessYaml({ templates: `${TEMPLATE_BY_REGION}${ILLEGAL_TEMPLATE}`, roles: `${TEMPLATE_ROLE}\n` })
    );
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const app = await buildRoleApp();

    const create = await app.inject({
      method: "POST",
      url: "/api/admin/roles",
      payload: { dryRun: false, roleId: "west_role", role: NEW_ROLE_PAYLOAD }
    });
    expect(create.statusCode).toBe(200);
    expect(create.json().data.written).toBe(true);
    // The catalog issue is REPORTED, not blocking.
    expect(create.json().data.templateWarnings).toEqual([
      expect.objectContaining({ code: "row_policy_template_shape_invalid", templateName: "broken_tpl" })
    ]);

    const patch = await app.inject({
      method: "PATCH",
      url: "/api/admin/roles/west_role",
      payload: { dryRun: false, patch: { description: "改过的说明" } }
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().data.templateWarnings).toEqual([
      expect.objectContaining({ code: "row_policy_template_shape_invalid", templateName: "broken_tpl" })
    ]);

    // The illegal template is STILL in access.yaml — the Role write did not
    // delete a block it was not asked to touch.
    const raw = await readFile(accessPathOf(projectRoot), "utf8");
    expect(raw).toContain("broken_tpl");
    expect(raw).toContain("unexpected_key");
    await app.close();
  });

  it("P2-2 — a Role that references the illegal template is refused with a clear code and zero writes", async () => {
    projectRoot = await makeProject(
      accessYaml({
        templates: `${TEMPLATE_BY_REGION}${ILLEGAL_TEMPLATE}`,
        roles: `${scopedRole("east_role", "            template: broken_tpl")}\n`
      })
    );
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const app = await buildRoleApp();
    const before = await readFile(accessPathOf(projectRoot), "utf8");

    const create = await app.inject({
      method: "POST",
      url: "/api/admin/roles",
      payload: { dryRun: false, roleId: "west_role", role: NEW_ROLE_PAYLOAD }
    });
    expect(create.statusCode).toBe(400);
    // The reference cannot be resolved — the illegal definition is not a
    // resolvable template — so the Role write is refused.
    expect(create.json().error.code).toBe("row_policy_template_unresolved");

    const patch = await app.inject({
      method: "PATCH",
      url: "/api/admin/roles/east_role",
      payload: { dryRun: false, patch: { description: "改过的说明" } }
    });
    expect(patch.statusCode).toBe(400);
    expect(patch.json().error.code).toBe("row_policy_template_unresolved");

    // Zero writes.
    expect(await readFile(accessPathOf(projectRoot), "utf8")).toBe(before);
    await app.close();
  });

  it("P2-2 — a legal template create/patch/delete keeps the illegal template and still takes effect", async () => {
    projectRoot = await makeProject(
      accessYaml({ templates: `${TEMPLATE_BY_REGION}${ILLEGAL_TEMPLATE}`, roles: `${TEMPLATE_ROLE}\n` })
    );
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const { registerRowPolicyTemplateRoutes } = await import("../admin/routes/row-policy");
    const app = buildApp();
    registerRowPolicyTemplateRoutes(app);
    await app.ready();

    const created = await dryRunThenCommit(app, "POST", "/api/admin/row-policy/templates", {
      name: "by_status",
      description: "按状态限定行",
      predicates: [{ field: "status", op: "eq", value: "SETTLED" }]
    });
    expect(created.commit.statusCode).toBe(200);
    expect(created.commit.json().data.runtimeAck).toBe(true);
    // The illegal template is reported as a diagnostic on the candidate.
    expect(created.commit.json().data.issues).toEqual([
      expect.objectContaining({ code: "row_policy_template_shape_invalid", templateName: "broken_tpl" })
    ]);
    let raw = await readFile(accessPathOf(projectRoot), "utf8");
    expect(raw).toContain("by_status");
    expect(raw).toContain("broken_tpl");
    expect(raw).toContain("unexpected_key");

    const patched = await dryRunThenCommit(app, "PATCH", "/api/admin/row-policy/templates/by_status", {
      description: "按状态限定行（改过）",
      predicates: [{ field: "status", op: "eq", value: "SETTLED" }]
    });
    expect(patched.commit.statusCode).toBe(200);
    raw = await readFile(accessPathOf(projectRoot), "utf8");
    expect(raw).toContain("按状态限定行（改过）");
    expect(raw).toContain("unexpected_key");

    const deleted = await dryRunThenCommit(app, "DELETE", "/api/admin/row-policy/templates/by_status", {});
    expect(deleted.commit.statusCode).toBe(200);
    raw = await readFile(accessPathOf(projectRoot), "utf8");
    expect(raw).not.toContain("by_status");
    // The illegal template survived every one of those three writes.
    expect(raw).toContain("broken_tpl");
    expect(raw).toContain("unexpected_key");
    await app.close();
  });

  it("P2-2 — a write that targets the illegal template fails and drops nothing", async () => {
    projectRoot = await makeProject(
      accessYaml({ templates: `${TEMPLATE_BY_REGION}${ILLEGAL_TEMPLATE}`, roles: `${TEMPLATE_ROLE}\n` })
    );
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const { registerRowPolicyTemplateRoutes } = await import("../admin/routes/row-policy");
    const app = buildApp();
    registerRowPolicyTemplateRoutes(app);
    await app.ready();
    const before = await readFile(accessPathOf(projectRoot), "utf8");

    const created = await app.inject({
      method: "POST",
      url: "/api/admin/row-policy/templates",
      payload: { name: "broken_tpl", predicates: [{ field: "region", op: "eq", value: "West" }] }
    });
    expect(created.statusCode).toBe(400);
    expect(created.json().error.code).toBe("row_policy_template_exists");

    const patched = await app.inject({
      method: "PATCH",
      url: "/api/admin/row-policy/templates/broken_tpl",
      payload: { predicates: [{ field: "region", op: "eq", value: "West" }] }
    });
    expect(patched.statusCode).toBe(400);
    // The target exists but is illegal — that is a shape failure, not a
    // 「not found」.
    expect(patched.json().error.code).toBe("row_policy_template_shape_invalid");

    const deleted = await app.inject({
      method: "DELETE",
      url: "/api/admin/row-policy/templates/broken_tpl",
      payload: {}
    });
    expect(deleted.statusCode).toBe(400);
    expect(deleted.json().error.code).toBe("row_policy_template_shape_invalid");

    // Nothing else in the catalog was touched.
    expect(await readFile(accessPathOf(projectRoot), "utf8")).toBe(before);
    await app.close();
  });
});

// ─── RTP — the numbered acceptance matrix of P1-1 (Spec §8) ────────────────────

describe("RTP — the numbered acceptance cases of P1-1 (Spec §8)", () => {
  it("RTP-01 — a template compiles to the same grant as the equivalent inline policy, and the `in` value order does not change the semantic digest", async () => {
    // Spec §8 RTP-01（P0 V01／V02）：展开后编译产物与语义摘要一致；`in` 值顺序不影响摘要
    projectRoot = await makeProject(accessYaml({ roles: `${INLINE_ROLE}\n` }));
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const { acl, expandRowPolicyTemplatesInConfig, rowPolicyTemplateDigest, validateRowPolicyTemplateDefinition } =
      await loadTemplates();

    // `in` 值顺序不影响摘要 — the semantic digest is order-insensitive.
    const ordered = validateRowPolicyTemplateDefinition("by_region", {
      predicates: [{ field: "region", op: "in", values: ["East", "West"] }]
    });
    const reversed = validateRowPolicyTemplateDefinition("by_region", {
      predicates: [{ field: "region", op: "in", values: ["West", "East"] }]
    });
    expect(ordered.ok).toBe(true);
    expect(reversed.ok).toBe(true);
    if (!ordered.ok || !reversed.ok) return;
    expect(rowPolicyTemplateDigest(ordered.definition)).toBe(rowPolicyTemplateDigest(reversed.definition));

    // 展开后编译产物与等价内联条件一致 — the compiled grant is the same.
    const templateConfig = {
      roles: {
        east_role: {
          permission_model_version: 2,
          allow: {
            connections: ["warehouse"],
            tableSelectors: [
              {
                connection: "warehouse",
                schema: "fin",
                names: ["fin_ledger"],
                row_access: "scoped",
                row_policy: {
                  template: "by_region",
                  predicates: [{ field: "status", op: "eq", value: "SETTLED" }]
                }
              }
            ],
            tools: ["lucy_query"]
          }
        }
      },
      users: [],
      row_policy_templates: {
        by_region: { description: "按大区", predicates: [{ field: "region", op: "in", values: ["East", "West"] }] }
      }
    };
    const inlineConfig = {
      ...templateConfig,
      row_policy_templates: {},
      roles: {
        east_role: {
          ...templateConfig.roles.east_role,
          allow: {
            ...templateConfig.roles.east_role.allow,
            tableSelectors: [
              {
                ...templateConfig.roles.east_role.allow.tableSelectors[0],
                row_policy: {
                  predicates: [
                    { field: "region", op: "in", values: ["East", "West"] },
                    { field: "status", op: "eq", value: "SETTLED" }
                  ]
                }
              }
            ]
          }
        }
      }
    };

    const expanded = expandRowPolicyTemplatesInConfig(templateConfig as never);
    expect(expanded.ok).toBe(true);
    const expandedContext = await acl.buildAdminPermissionContext(expanded.config as never);
    const inlineContext = await acl.buildAdminPermissionContext(inlineConfig as never);
    const expandedRole = await acl.compileRoleForAdmin("east_role", expandedContext);
    const inlineRole = await acl.compileRoleForAdmin("east_role", inlineContext);
    expect(expandedRole.ok).toBe(true);
    expect(inlineRole.ok).toBe(true);
    if (!expandedRole.ok || !inlineRole.ok) return;
    const digestOf = (caps: typeof expandedRole.capabilities) =>
      (caps ?? []).map((cap) => `${cap.sourceName}:${cap.rowGrant.kind === "all" ? "all" : cap.rowGrant.digest}`).join(",");
    expect(digestOf(expandedRole.capabilities)).toBe(digestOf(inlineRole.capabilities));
    expect(digestOf(expandedRole.capabilities)).not.toBe("");
  });

  it("RTP-02 — the template ANDs with the inline predicates inside one selector, the Roles OR, and the Agent ANDs on top of the union", async () => {
    // Spec §8 RTP-02（P0 V03、V08–V10）：选择器内 AND、Role 间 OR、Agent AND；DNF 结构保留
    projectRoot = await makeProject(accessYaml({ roles: "" }));
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const { acl, expandRowPolicyTemplatesInConfig } = await loadTemplates();
    const { computeFinalRowsForTable } = await import("../proxy/row-policy-preview");
    const { synthesizeFinalRows } = await import("../proxy/agent-constraints");

    const config = {
      row_policy_templates: {
        by_region: { description: "按大区", predicates: [{ field: "region", op: "eq", value: "East" }] }
      },
      roles: {
        east_role: {
          permission_model_version: 2,
          allow: {
            connections: ["warehouse"],
            tableSelectors: [
              {
                connection: "warehouse",
                schema: "fin",
                names: ["fin_ledger"],
                row_access: "scoped",
                row_policy: {
                  template: "by_region",
                  predicates: [{ field: "status", op: "eq", value: "SETTLED" }]
                }
              }
            ],
            tools: ["lucy_query"]
          }
        },
        west_role: {
          permission_model_version: 2,
          allow: {
            connections: ["warehouse"],
            tableSelectors: [
              {
                connection: "warehouse",
                schema: "fin",
                names: ["fin_ledger"],
                row_access: "scoped",
                row_policy: { predicates: [{ field: "region", op: "eq", value: "West" }] }
              }
            ],
            tools: ["lucy_query"]
          }
        }
      },
      users: []
    };

    const expanded = expandRowPolicyTemplatesInConfig(config as never);
    expect(expanded.ok).toBe(true);
    const context = await acl.buildAdminPermissionContext(expanded.config as never);
    const east = await acl.compileRoleForAdmin("east_role", context);
    const west = await acl.compileRoleForAdmin("west_role", context);
    expect(east.ok).toBe(true);
    expect(west.ok).toBe(true);
    if (!east.ok || !west.ok) return;
    const grantOf = (compiled: typeof east) =>
      compiled.capabilities?.find((cap) => cap.sourceName === "fin_ledger")?.rowGrant;
    const eastGrant = grantOf(east);
    const westGrant = grantOf(west);
    expect(eastGrant?.kind).toBe("scoped");
    expect(westGrant?.kind).toBe("scoped");
    if (eastGrant?.kind !== "scoped" || westGrant?.kind !== "scoped") return;

    // 选择器内 AND — the template predicate and the inline predicate are ONE arm.
    expect(eastGrant.orArms).toHaveLength(1);
    expect(eastGrant.orArms[0].map((p) => `${p.field}=${String(p.value)}`)).toEqual(["region=East", "status=SETTLED"]);

    // Role 间 OR — and the DNF structure is kept (never flattened into one AND).
    const union = computeFinalRowsForTable(
      { connectionId: "warehouse", schema: "fin", sourceName: "fin_ledger" },
      [
        { roleId: "east_role", grant: eastGrant },
        { roleId: "west_role", grant: westGrant }
      ],
      []
    );
    expect(union.ok).toBe(true);
    if (!union.ok) return;
    expect(union.preview.displayShape).toBe("OR-of-AND");
    expect(union.preview.roleIds).toEqual(["east_role", "west_role"]);
    expect(union.preview.effectiveRowGrant.kind).toBe("scoped");
    if (union.preview.effectiveRowGrant.kind !== "scoped") return;
    expect(union.preview.effectiveRowGrant.orArms).toHaveLength(2);

    // Agent AND — the Agent's own row limit intersects EVERY OR arm.
    const synthesized = synthesizeFinalRows(union.preview.effectiveRowGrant, [
      { field: "tier", sourceName: "fin_ledger", op: "eq", value: "GOLD" }
    ]);
    expect(synthesized.ok).toBe(true);
    if (!synthesized.ok || synthesized.finalRows.kind !== "scoped") return;
    expect(synthesized.finalRows.orArms).toHaveLength(2);
    for (const arm of synthesized.finalRows.orArms) {
      expect(arm.map((p) => `${p.field}=${String(p.value)}`)).toContain("tier=GOLD");
    }
  });

  it("RTP-03 — a missing reference, an illegal op and empty predicates all fail closed, and the reason is distinguishable from the catalog state", async () => {
    // Spec §8 RTP-03（P0 V04–V07）：全部失败关闭；原因与目录状态可区分
    projectRoot = await makeProject(accessYaml({ templates: TEMPLATE_BY_REGION, roles: `${TEMPLATE_ROLE}\n` }));
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const { expandRowPolicyTemplatesInConfig, validateRowPolicyTemplateCatalog, rowPolicyTemplateUsabilityForTable } =
      await loadTemplates();

    // 缺失引用 → 失败关闭（never 「全部行」）and the reason names the Role.
    const config = {
      roles: {
        east_role: {
          permission_model_version: 2,
          allow: {
            tableSelectors: [
              {
                connection: "warehouse",
                schema: "fin",
                names: ["fin_ledger"],
                row_access: "scoped",
                row_policy: { template: "vanished" }
              }
            ]
          }
        }
      },
      users: []
    };
    const expanded = expandRowPolicyTemplatesInConfig(config as never);
    expect(expanded.ok).toBe(false);
    const unresolved = expanded.referenceIssues.find((issue) => issue.code === "row_policy_template_unresolved");
    expect(unresolved).toBeDefined();
    expect(unresolved?.roleId).toBe("east_role");
    const selector = (expanded.config.roles?.east_role?.allow?.tableSelectors ?? [])[0] as
      | { row_policy?: { predicates?: unknown[] } }
      | undefined;
    expect(selector?.row_policy?.predicates).toEqual([]);

    // 非法 op / 空谓词 → a CATALOG issue: no role, so it can be told apart from
    // the reference failure above.
    const illegalOp = validateRowPolicyTemplateCatalog({
      broken: { predicates: [{ field: "region", op: "like", value: "E" }] }
    });
    expect(illegalOp.templates).toEqual({});
    expect(illegalOp.issues.map((issue) => issue.code)).toContain("row_policy_op_forbidden");
    expect(illegalOp.issues[0]?.roleId).toBeUndefined();

    const emptyPredicates = validateRowPolicyTemplateCatalog({ broken: { predicates: [] } });
    expect(emptyPredicates.issues.map((issue) => issue.code)).toContain("row_policy_predicates_required");
    expect(emptyPredicates.issues[0]?.roleId).toBeUndefined();

    // 字段不存在 → the CATALOG state (「不可绑定」), a third, distinct outcome.
    const usability = await rowPolicyTemplateUsabilityForTable(
      { name: "by_ghost", predicates: [{ field: "ghost", op: "eq", value: "x" }] },
      { connectionId: "warehouse", schema: "fin", sourceName: "fin_ledger" }
    );
    expect(usability.status).toBe("field_missing");
    expect(usability.status === "field_missing" ? usability.fields : []).toEqual(["ghost"]);
  });

  it("RTP-04 — a referenced template cannot be deleted (zero writes), an unreferenced one saves through the dry-run, and an external missing reference fails closed", async () => {
    // Spec §8 RTP-04（P0 V14）：有引用拒绝且零写入；无引用可经 dry-run 保存；外部缺失引用失败关闭
    projectRoot = await makeProject(accessYaml({ templates: TEMPLATE_BY_REGION, roles: `${TEMPLATE_ROLE}\n` }));
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const { registerRowPolicyTemplateRoutes } = await import("../admin/routes/row-policy");
    const app = buildApp();
    registerRowPolicyTemplateRoutes(app);
    await app.ready();

    // 有引用 → 拒绝且零写入.
    const before = await readFile(accessPathOf(projectRoot), "utf8");
    const refused = await app.inject({
      method: "DELETE",
      url: "/api/admin/row-policy/templates/by_region",
      payload: { dryRun: false }
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe("row_policy_template_in_use");
    expect(await readFile(accessPathOf(projectRoot), "utf8")).toBe(before);

    // 无引用 → 经 dry-run 保存.
    const { preview, commit } = await dryRunThenCommit(app, "POST", "/api/admin/row-policy/templates", {
      name: "by_status",
      description: "按状态限定行",
      predicates: [{ field: "status", op: "eq", value: "SETTLED" }]
    });
    expect(preview.json().data.dryRun).toBe(true);
    expect(preview.json().data.written).toBe(false);
    expect(commit.statusCode).toBe(200);
    expect(await readFile(accessPathOf(projectRoot), "utf8")).toContain("by_status");

    // 外部缺失引用 → 失败关闭：the Role write is refused and the reference is
    // NOT rewritten into an inline policy.
    await writeFile(accessPathOf(projectRoot), accessYaml({ roles: `${TEMPLATE_ROLE}\n` }), "utf8");
    const roleApp = await buildRoleApp();
    const refusedRole = await roleApp.inject({
      method: "PATCH",
      url: "/api/admin/roles/east_role",
      payload: { dryRun: false, patch: { description: "改过的说明" } }
    });
    expect(refusedRole.statusCode).toBe(400);
    expect(refusedRole.json().error.code).toBe("row_policy_template_unresolved");
    const raw = await readFile(accessPathOf(projectRoot), "utf8");
    expect(raw).toContain("template: by_region");
    await roleApp.close();
    await app.close();
  });

  it("RTP-05 — a template change moves the policyVersion, the runtime confirms it without a restart, and the protected-tool gate does not move", async () => {
    // Spec §8 RTP-05（P0 V16／V17）：policyVersion 变化、运行时确认、无需重启；受保护工具闸门不变
    projectRoot = await makeProject(accessYaml({ templates: TEMPLATE_BY_REGION, roles: `${TEMPLATE_ROLE}\n` }));
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const { registerRowPolicyTemplateRoutes } = await import("../admin/routes/row-policy");
    const app = buildApp();
    registerRowPolicyTemplateRoutes(app);
    await app.ready();

    const created = await dryRunThenCommit(app, "POST", "/api/admin/row-policy/templates", {
      name: "by_status",
      description: "按状态限定行",
      predicates: [{ field: "status", op: "eq", value: "SETTLED" }]
    });
    expect(created.commit.statusCode).toBe(200);
    // 运行时确认 — the runtime confirmed this write.
    expect(created.commit.json().data.runtimeAck).toBe(true);
    const versionAfterCreate = created.commit.json().data.policyVersion;
    expect(typeof versionAfterCreate).toBe("string");
    expect(versionAfterCreate.length).toBeGreaterThan(0);

    const deleted = await dryRunThenCommit(app, "DELETE", "/api/admin/row-policy/templates/by_status", {});
    expect(deleted.commit.statusCode).toBe(200);
    expect(deleted.commit.json().data.runtimeAck).toBe(true);
    const versionAfterDelete = deleted.commit.json().data.policyVersion;

    // policyVersion 变化 — the template change moved the policy generation.
    expect(versionAfterDelete).not.toBe(versionAfterCreate);

    // 无需重启 — the runtime serves the new generation right away.
    const after = await app.inject({ method: "GET", url: "/api/admin/row-policy/templates" });
    expect(after.json().data.snapshot.identity.policyVersion).toBe(versionAfterDelete);

    // 受保护工具闸门不变 — the Role's tools and the global deny list did not move.
    const raw = parse(await readFile(accessPathOf(projectRoot), "utf8")) as {
      roles: Record<string, { allow?: { tools?: string[] } }>;
      defaults: { deny_tools: string[] };
    };
    expect(raw.roles.east_role.allow?.tools).toEqual(["lucy_query"]);
    expect(raw.defaults.deny_tools).toEqual([]);
    await app.close();
  });

  it("RTP-06 — a stale preview cannot be committed; a fresh dry-run is required before the save", async () => {
    // Spec §8 RTP-06（P0 V13）：旧预览不可提交；重新 dry-run 后才可保存
    projectRoot = await makeProject(accessYaml({ templates: TEMPLATE_BY_REGION, roles: `${TEMPLATE_ROLE}\n` }));
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const { registerRowPolicyTemplateRoutes } = await import("../admin/routes/row-policy");
    const app = buildApp();
    registerRowPolicyTemplateRoutes(app);
    await app.ready();

    const preview = await app.inject({
      method: "POST",
      url: "/api/admin/row-policy/templates",
      payload: { name: "by_status", predicates: [{ field: "status", op: "eq", value: "SETTLED" }] }
    });
    expect(preview.statusCode).toBe(200);
    const previewData = preview.json().data;

    // The baseline moves under the preview (somebody else wrote access.yaml).
    const external = accessYaml({ templates: TEMPLATE_BY_REGION, roles: `${TEMPLATE_ROLE}\n` }).replace(
      "east_role:",
      "east_role:\n    description: 外部改动"
    );
    await writeFile(accessPathOf(projectRoot), external, "utf8");
    const afterExternal = await readFile(accessPathOf(projectRoot), "utf8");

    // 旧预览不可提交 — the stale preview is refused and nothing is written.
    const stale = await app.inject({
      method: "POST",
      url: "/api/admin/row-policy/templates",
      payload: {
        dryRun: false,
        version: previewData.version,
        candidateDigest: previewData.candidateDigest,
        name: "by_status",
        predicates: [{ field: "status", op: "eq", value: "SETTLED" }]
      }
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("VERSION_CONFLICT");
    expect(await readFile(accessPathOf(projectRoot), "utf8")).toBe(afterExternal);

    // 重新 dry-run 后才可保存.
    const fresh = await dryRunThenCommit(app, "POST", "/api/admin/row-policy/templates", {
      name: "by_status",
      predicates: [{ field: "status", op: "eq", value: "SETTLED" }]
    });
    expect(fresh.commit.statusCode).toBe(200);
    const raw = await readFile(accessPathOf(projectRoot), "utf8");
    expect(raw).toContain("by_status");
    expect(raw).toContain("description: 外部改动");
    await app.close();
  });

  it("RTP-07 — the durable intent is persisted before the configuration write and the terminal after it", async () => {
    // Spec §8 RTP-07（P0 V15）／P1-D3：顺序满足 P1-D3（intent → 写入 → 生效 → terminal）
    projectRoot = await makeProject(accessYaml({ templates: TEMPLATE_BY_REGION, roles: `${TEMPLATE_ROLE}\n` }));
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const audit = await import("../admin/audit");
    const order: string[] = [];
    vi.mocked(audit.recordConfigChange).mockImplementation(async () => {
      order.push(`intent:${await readFile(accessPathOf(projectRoot), "utf8")}`);
      return 1;
    });
    vi.mocked(audit.updateConfigChangeStatus).mockImplementation(async (input) => {
      order.push(`terminal:${input.writeStatus}:${await readFile(accessPathOf(projectRoot), "utf8")}`);
    });

    const { registerRowPolicyTemplateRoutes } = await import("../admin/routes/row-policy");
    const app = buildApp();
    registerRowPolicyTemplateRoutes(app);
    await app.ready();
    const { commit } = await dryRunThenCommit(app, "POST", "/api/admin/row-policy/templates", {
      name: "by_status",
      description: "按状态限定行",
      predicates: [{ field: "status", op: "eq", value: "SETTLED" }]
    });
    expect(commit.statusCode).toBe(200);
    expect(order).toHaveLength(2);
    // The intent was persisted while the OLD bytes were still on disk.
    expect(order[0]?.startsWith("intent:")).toBe(true);
    expect(order[0]).not.toContain("by_status");
    // The terminal was persisted AFTER the new bytes were written.
    expect(order[1]?.startsWith("terminal:committed:")).toBe(true);
    expect(order[1]).toContain("by_status");
    await app.close();
  });

  it("RTP-07 — a runtime that does not confirm the write rolls the configuration back and never reports the write as acked", async () => {
    // Spec §8 RTP-07（P0 V15）：回滚故障 —— the write is reverted, the save is not acked
    projectRoot = await makeProject(accessYaml({ templates: TEMPLATE_BY_REGION, roles: `${TEMPLATE_ROLE}\n` }));
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const before = await readFile(accessPathOf(projectRoot), "utf8");
    const aclActual = await vi.importActual<typeof import("../proxy/acl.js")>("../proxy/acl.js");
    const previousDigest = aclActual.computeAccessConfigDigest(parse(before) as never);

    let commits = 0;
    vi.resetModules();
    vi.doMock("../proxy/acl.js", async () => {
      const actual = await vi.importActual<typeof import("../proxy/acl.js")>("../proxy/acl.js");
      return {
        ...actual,
        commitEffectivePolicy: vi.fn(async () => {
          commits += 1;
          // The runtime confirms ONLY the restored bytes; the just-written bytes
          // are never confirmed, so the write has to be rolled back.
          const current = await readFile(accessPathOf(projectRoot), "utf8").catch(() => "");
          return {
            policyVersion: `policy-${commits}`,
            degradedGlobal: false,
            degradedAgents: [],
            issues: [],
            accessConfigDigest: current === before ? previousDigest : "not-the-written-digest",
            sourceMapVersion: "src-1",
            enabledTablesDigest: "en-1"
          };
        })
      };
    });

    const { registerRowPolicyTemplateRoutes } = await import("../admin/routes/row-policy");
    const app = buildApp();
    registerRowPolicyTemplateRoutes(app);
    await app.ready();
    const { commit } = await dryRunThenCommit(app, "POST", "/api/admin/row-policy/templates", {
      name: "by_status",
      description: "按状态限定行",
      predicates: [{ field: "status", op: "eq", value: "SETTLED" }]
    });
    // The write is not acked — and it is NOT reported as saved (Spec §5.2:
    // 「never report saved」). The route answers with the rollback, not with a
    // 200 that says `written: true` while the disk was restored.
    expect(commit.statusCode).toBe(500);
    expect(commit.json().ok).toBe(false);
    expect(commit.json().error.code).toBe("ROW_POLICY_TEMPLATE_WRITE_ROLLED_BACK");
    expect(commit.json().data).toBeUndefined();
    // The configuration was rolled back — the template is NOT in access.yaml.
    expect(await readFile(accessPathOf(projectRoot), "utf8")).toBe(before);
    await app.close();
    vi.doUnmock("../proxy/acl.js");
    vi.resetModules();
  });

  it("RTP-08 — a template that cannot be bound is visible with its reason before the save", async () => {
    // Spec §8 RTP-08（R5）：不可绑定项可见且禁用；原因在选择时已披露，不等到保存
    const GHOST_TEMPLATE = `  by_ghost:
    description: 引用了不存在的字段
    predicates:
      - field: ghost
        op: eq
        value: x
`;
    projectRoot = await makeProject(
      accessYaml({
        templates: `${TEMPLATE_BY_REGION}${GHOST_TEMPLATE}`,
        roles: `${TEMPLATE_ROLE}\n${scopedRole("ghost_role", "            template: by_ghost")}\n`
      })
    );
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const { registerRowPolicyTemplateRoutes } = await import("../admin/routes/row-policy");
    const app = buildApp();
    registerRowPolicyTemplateRoutes(app);
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/api/admin/row-policy/templates" });
    expect(res.statusCode).toBe(200);
    const templates = res.json().data.templates as Array<{
      name: string;
      usabilityByTable: Array<{ usability: { status: string; fields?: string[] } }>;
    }>;
    const bindable = templates.find((template) => template.name === "by_region");
    const ghost = templates.find((template) => template.name === "by_ghost");
    // The item is VISIBLE — it is not hidden from the list.
    expect(bindable).toBeDefined();
    expect(ghost).toBeDefined();
    // 不可绑定项禁用 — its status says it cannot be bound, with the reason.
    expect(bindable?.usabilityByTable[0]?.usability.status).toBe("bindable");
    expect(ghost?.usabilityByTable[0]?.usability.status).toBe("field_missing");
    expect(ghost?.usabilityByTable[0]?.usability.fields).toEqual(["ghost"]);
    await app.close();
  });

  it("RTP-09 — the template audit carries the actor, the operation id, the before/after digests and the impact surface — and no secret", async () => {
    // Spec §8 RTP-09（R4）：模板增删改、引用／解引用含 actor、operationId、前后摘要与影响面；不含秘密
    projectRoot = await makeProject(accessYaml({ templates: TEMPLATE_BY_REGION, roles: `${TEMPLATE_ROLE}\n` }));
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const audit = await import("../admin/audit");
    vi.mocked(audit.recordConfigChange).mockClear();
    // The runtime state is per module instance: the previous case deliberately
    // stubbed `commitEffectivePolicy`, so this case commits the policy for its
    // own project first — otherwise the write would find no committed policy
    // and its runtime ack would fail for a reason that has nothing to do with
    // the audit.
    const acl = await import("../proxy/acl");
    await acl.commitEffectivePolicy();
    const { registerRowPolicyTemplateRoutes } = await import("../admin/routes/row-policy");
    const app = buildApp();
    registerRowPolicyTemplateRoutes(app);
    await app.ready();

    const created = await dryRunThenCommit(app, "POST", "/api/admin/row-policy/templates", {
      name: "by_status",
      description: "按状态限定行",
      predicates: [{ field: "status", op: "eq", value: "SETTLED" }]
    });
    expect(created.commit.statusCode).toBe(200);
    const calls = (audit.recordConfigChange as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const intent = calls[calls.length - 1]?.[0] as Record<string, unknown>;
    // 模板增删改 — the operation, the actor and the operation id.
    expect(intent.changeType).toBe("row_policy_template_create");
    expect(intent.targetId).toBe("by_status");
    expect(intent.requestId).toBe(created.commit.json().data.operationId);
    expect(intent.actor).toBeTruthy();
    // 前后摘要 — the before summary has no such template, the after summary has
    // it with a digest.
    const oldSummary = intent.oldSummary as { templates: Array<{ name: string; digest: string }> };
    const newSummary = intent.newSummary as {
      templates: Array<{ name: string; digest: string; predicateCount: number }>;
      affectedRoleIds: string[];
      tables: unknown[];
      agents: unknown[];
    };
    expect(oldSummary.templates.some((template) => template.name === "by_status")).toBe(false);
    const audited = newSummary.templates.find((template) => template.name === "by_status");
    expect(audited).toBeDefined();
    expect(audited?.digest).toBeTruthy();
    expect(audited?.predicateCount).toBe(1);
    // 影响面 — the impact surface is recorded.
    expect(Array.isArray(newSummary.tables)).toBe(true);
    expect(Array.isArray(newSummary.agents)).toBe(true);
    expect(Array.isArray(newSummary.affectedRoleIds)).toBe(true);
    // 不含秘密 — the record carries no token and no whole access.yaml.
    const serialized = JSON.stringify(intent);
    expect(serialized).not.toContain("sha256:");
    expect(serialized).not.toContain("tokens");

    // 删除 — the delete is audited the same way.
    const deleted = await dryRunThenCommit(app, "DELETE", "/api/admin/row-policy/templates/by_status", {});
    expect(deleted.commit.statusCode).toBe(200);
    const deleteCalls = (audit.recordConfigChange as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const deleteIntent = deleteCalls[deleteCalls.length - 1]?.[0] as Record<string, unknown>;
    expect(deleteIntent.changeType).toBe("row_policy_template_delete");
    expect(deleteIntent.targetId).toBe("by_status");
    expect(deleteIntent.requestId).toBe(deleted.commit.json().data.operationId);

    // 引用／解引用 — a Role write that references a template records the row
    // policy attribution with the before/after digests and the impact surface.
    const roleApp = await buildRoleApp();
    vi.mocked(audit.recordConfigChange).mockClear();
    const roleWrite = await roleApp.inject({
      method: "PATCH",
      url: "/api/admin/roles/east_role",
      payload: {
        dryRun: false,
        patch: {
          allow: {
            connections: ["warehouse"],
            tableSelectors: [
              {
                connection: "warehouse",
                schema: "fin",
                names: ["fin_ledger"],
                row_access: "scoped",
                row_policy: { template: "by_region", predicates: [{ field: "status", op: "eq", value: "OPEN" }] }
              }
            ],
            tools: ["lucy_query"]
          }
        }
      }
    });
    expect(roleWrite.statusCode).toBe(200);
    const roleCalls = (audit.recordConfigChange as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const roleIntent = roleCalls[roleCalls.length - 1]?.[0] as Record<string, unknown>;
    const roleNewSummary = roleIntent.newSummary as {
      rowPolicy?: { operationId: string; beforeDigest: string; afterDigest: string; affectedAgentCount: number };
    };
    expect(roleNewSummary.rowPolicy?.operationId).toBeTruthy();
    expect(roleNewSummary.rowPolicy?.beforeDigest).toBeTruthy();
    expect(roleNewSummary.rowPolicy?.afterDigest).toBeTruthy();
    expect(roleNewSummary.rowPolicy?.beforeDigest).not.toBe(roleNewSummary.rowPolicy?.afterDigest);
    await roleApp.close();
    await app.close();
  });
});

describe("W8 回归 — a rolled-back write is never reported as saved (Spec §5.2)", () => {
  it("the template write route reports the rollback instead of `written: true`", async () => {
    projectRoot = await makeProject(accessYaml({ templates: TEMPLATE_BY_REGION, roles: `${TEMPLATE_ROLE}\n` }));
    process.env.KTX_PROJECT_ROOT = projectRoot;

    // The ROLLED BACK outcome is unreachable without a runtime that refuses to
    // acknowledge the write, so it is injected — but ONLY for this test: a
    // hoisted module mock would split the module instances (the writer and the
    // route would no longer share one policy cache) and make every other case
    // in this file fail for the wrong reason.
    vi.resetModules();
    vi.doMock("../admin/access-config.js", async () => {
      const actual = await vi.importActual<typeof import("../admin/access-config.js")>(
        "../admin/access-config.js"
      );
      return {
        ...actual,
        writeAccessYaml: vi.fn(async () => ({
          policyVersion: "policy-version-rolled-back",
          policyRuntimeAck: false,
          runtimeAck: false,
          rolledBack: true
        }))
      };
    });

    try {
      const { registerRowPolicyTemplateRoutes } = await import("../admin/routes/row-policy");
      const app = buildApp();
      registerRowPolicyTemplateRoutes(app);
      await app.ready();

      const preview = await app.inject({
        method: "POST",
        url: "/api/admin/row-policy/templates",
        payload: {
          name: "by_status",
          description: "按状态限定行",
          predicates: [{ field: "status", op: "eq", value: "SETTLED" }]
        }
      });
      expect(preview.statusCode).toBe(200);
      const previewData = preview.json().data;

      const before = await readFile(path.join(projectRoot, "webui", "config", "access.yaml"), "utf8");
      const commit = await app.inject({
        method: "POST",
        url: "/api/admin/row-policy/templates",
        payload: {
          dryRun: false,
          version: previewData.version,
          candidateDigest: previewData.candidateDigest,
          name: "by_status",
          description: "按状态限定行",
          predicates: [{ field: "status", op: "eq", value: "SETTLED" }]
        }
      });
      // 回滚不是「已保存」——必须报错，不得回 `written: true`。
      expect(commit.statusCode).toBe(500);
      expect(commit.json().ok).toBe(false);
      expect(commit.json().error.code).toBe("ROW_POLICY_TEMPLATE_WRITE_ROLLED_BACK");
      expect(commit.json().data).toBeUndefined();
      const after = await readFile(path.join(projectRoot, "webui", "config", "access.yaml"), "utf8");
      expect(after).toBe(before);
      await app.close();
    } finally {
      vi.doUnmock("../admin/access-config.js");
      vi.resetModules();
    }
  });
});
