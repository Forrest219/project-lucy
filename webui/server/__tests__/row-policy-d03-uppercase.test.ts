import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Lucy v0.25 — D-03 / G5 集成回归 (V19 / V22).
 *
 * The customer symptom (2026-10-22 diagnostic report): a role with a `scoped`
 * row condition on an UPPER-CASE schema table (`sql_server / BIDM /
 * hs_sy_bu_metric`) was rejected with
 * `role_resolution_failed:finbp_cdn:row_policy_field_unresolved:unknown` —
 * a legal column judged 「字段不存在」 — because the Schema Manifest keeps its
 * original case on disk (`BIDM.yaml`) while the source map lower-cases the
 * schema name.
 *
 * V19 — on a case-sensitive filesystem the legal column binds normally.
 * V22 — the management preview and the runtime `forced_filters` are equivalent
 *        on that same upper-case schema table.
 *
 * The filesystem mock makes the `_schema` directory case-sensitive, so this
 * test means the same thing on macOS / APFS (case-insensitive by default) and
 * on Linux (case-sensitive). That is exactly what spec §1.5 / §5.5 require;
 * without it the defect is invisible in development.
 */

const fsState = vi.hoisted(() => ({ caseSensitive: false }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: async (file: unknown, options?: unknown) => {
      const asPath = typeof file === "string" ? file : file instanceof URL ? file.pathname : "";
      const isSchemaManifest = asPath.includes(`${path.sep}_schema${path.sep}`) && asPath.endsWith(".yaml");
      if (fsState.caseSensitive && isSchemaManifest) {
        const dir = path.dirname(asPath);
        const base = path.basename(asPath);
        const entries = await actual.readdir(dir);
        if (!entries.includes(base)) {
          const error = new Error(`ENOENT: no such file or directory, open '${asPath}'`) as NodeJS.ErrnoException;
          error.code = "ENOENT";
          throw error;
        }
      }
      return actual.readFile(file as never, options as never);
    }
  };
});

vi.mock("../admin/audit.js", () => ({
  getAuditDb: vi.fn(() => ({
    prepare: vi.fn(() => ({ get: vi.fn(() => undefined), all: vi.fn(() => []), run: vi.fn() })),
    exec: vi.fn(),
    pragma: vi.fn(() => ({ all: vi.fn(() => []) }))
  })),
  recordConfigChange: vi.fn(async () => 1),
  updateConfigChangeStatus: vi.fn(async () => {}),
  registerAgentAuditRoutes: vi.fn(),
  registerAuditRoutes: vi.fn()
}));

const BIDM_SCHEMA_YAML = `tables:
  hs_sy_bu_metric:
    table: BIDM.hs_sy_bu_metric
    columns:
      - name: hs_manage_bu_l2
`;

const METRIC_OVERLAY_YAML = `columns:
  - name: hs_manage_bu_l2
`;

const KTX_YAML = `connections:
  sql_server:
    driver: sqlserver
    enabled_tables:
      - BIDM.hs_sy_bu_metric
`;

const ACCESS_YAML = `roles:
  finbp_cdn:
    permission_model_version: 2
    allow:
      connections: [sql_server]
      tableSelectors:
        - connection: sql_server
          schema: bidm
          names: [hs_sy_bu_metric]
          row_access: scoped
          row_policy:
            predicates:
              - field: hs_manage_bu_l2
                op: eq
                value: CDN产品
      tools:
        - lucy_query
users:
  - id: cdn_agent
    role: finbp_cdn
    enabled: true
    tokens: []
defaults:
  deny_tools: []
`;

let projectRoot: string;
let previousRoot: string | undefined;
let previousContentRoot: string | undefined;

async function makeProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lucy-d03-uppercase-"));
  await mkdir(path.join(root, "webui", "config"), { recursive: true });
  await mkdir(path.join(root, "semantic-layer", "sql_server", "_schema"), { recursive: true });
  await writeFile(path.join(root, "ktx.yaml"), KTX_YAML, "utf8");
  await writeFile(path.join(root, "webui", "config", "access.yaml"), ACCESS_YAML, "utf8");
  // The manifest keeps its ORIGINAL case on disk.
  await writeFile(
    path.join(root, "semantic-layer", "sql_server", "_schema", "BIDM.yaml"),
    BIDM_SCHEMA_YAML,
    "utf8"
  );
  await writeFile(
    path.join(root, "semantic-layer", "sql_server", "hs_sy_bu_metric.yaml"),
    METRIC_OVERLAY_YAML,
    "utf8"
  );
  return root;
}

beforeEach(() => {
  previousRoot = process.env.KTX_PROJECT_ROOT;
  previousContentRoot = process.env.LUCY_CONTENT_ROOT;
  fsState.caseSensitive = true;
});

afterEach(async () => {
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  if (previousContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = previousContentRoot;
  if (projectRoot) await rm(projectRoot, { recursive: true, force: true });
});

describe("D-03 / G5 — upper-case schema manifest (V19 / V22)", () => {
  it("V19: the legal column binds on the upper-case schema table", async () => {
    projectRoot = await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";

    vi.resetModules();
    const rowPolicy = await import("../proxy/row-policy");
    rowPolicy.resetRowPolicyCatalogCacheForTests();

    const compiled = await rowPolicy.compileScopedRowGrant(
      { predicates: [{ field: "hs_manage_bu_l2", op: "eq", value: "CDN产品" }] },
      [{ connectionId: "sql_server", sourceName: "hs_sy_bu_metric", schema: "bidm" }]
    );
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.grant.kind).toBe("scoped");
    expect(compiled.grant.orArms).toHaveLength(1);
  });

  it("V22: the management preview and the runtime forced_filters are equivalent on the upper-case table", async () => {
    projectRoot = await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";

    vi.resetModules();
    const rowPolicy = await import("../proxy/row-policy");
    const preview = await import("../proxy/row-policy-preview");
    rowPolicy.resetRowPolicyCatalogCacheForTests();

    // 1) The management preview on the upper-case table.
    const outcome = await preview.previewRowPolicyDraft({
      roleId: "finbp_cdn",
      tables: [{ connection: "sql_server", schema: "bidm", name: "hs_sy_bu_metric" }]
    });
    const table = outcome.tables[0]!;
    // The catalog must load — the manifest is found despite the case difference.
    expect(table.catalog.status).toBe("loaded");
    expect(table.preview.effectiveRowGrant.kind).toBe("scoped");

    // 2) The runtime product for the same table — the source the runtime injects.
    const runtime = await rowPolicy.compileScopedRowGrant(
      { predicates: [{ field: "hs_manage_bu_l2", op: "eq", value: "CDN产品" }] },
      [{ connectionId: "sql_server", sourceName: "hs_sy_bu_metric", schema: "bidm" }]
    );
    expect(runtime.ok).toBe(true);
    if (!runtime.ok) return;

    // 3) Both sides must yield the SAME forced_filters payload.
    const previewPayload = rowPolicy.buildForcedFiltersPayload(
      table.preview.effectiveRowGrant,
      "hs_sy_bu_metric"
    );
    const runtimePayload = rowPolicy.buildForcedFiltersPayload(runtime.grant, "hs_sy_bu_metric");
    expect(previewPayload).toBeDefined();
    expect(runtimePayload).toBeDefined();
    expect(previewPayload).toEqual(runtimePayload);
  });
});
