import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Lucy v0.25 — L25-14 R5 行级条件字段可诊断 (§3.5 / §5.5, V20 / V21).
 *
 * Three-way attribution, all fail-closed:
 *  - 字段不存在  → `row_policy_field_unknown`   (only with a reliably loaded catalog)
 *  - 清单不可用  → `row_policy_catalog_unavailable` (+ the failing stage)
 *  - 目录能力未知 → `row_policy_catalog_capability_unknown`
 *
 * The G5 / D-03 boundary is asserted explicitly: on a case-sensitive filesystem a
 * disk file `BIDM.yaml` is NOT reachable as `bidm.yaml`, and the failure must be
 * attributed to 「清单不可用」(operations) — never to 「字段不存在」.
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
        // Case-sensitive filesystem semantics: the EXACT file name must exist.
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

let projectRoot: string;
let previousRoot: string | undefined;
let previousContentRoot: string | undefined;

async function makeProject(options: {
  schemaFileName?: string;
  schemaYaml?: string;
  overlayName?: string;
  overlayYaml?: string;
}): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lucy-row-policy-r5-"));
  await mkdir(path.join(root, "webui", "config"), { recursive: true });
  await mkdir(path.join(root, "semantic-layer", "warehouse", "_schema"), { recursive: true });
  await writeFile(path.join(root, "ktx.yaml"), KTX_YAML, "utf8");
  await writeFile(
    path.join(root, "semantic-layer", "warehouse", "_schema", options.schemaFileName ?? "fin.yaml"),
    options.schemaYaml ?? FIN_SCHEMA_YAML,
    "utf8"
  );
  await writeFile(
    path.join(root, "semantic-layer", "warehouse", options.overlayName ?? "fin_ledger.yaml"),
    options.overlayYaml ?? FIN_LEDGER_OVERLAY_YAML,
    "utf8"
  );
  return root;
}

async function loadRowPolicy() {
  vi.resetModules();
  const rowPolicy = await import("../proxy/row-policy");
  const catalog = await import("../proxy/row-policy-catalog");
  rowPolicy.resetRowPolicyCatalogCacheForTests();
  return { rowPolicy, catalog };
}

beforeEach(() => {
  previousRoot = process.env.KTX_PROJECT_ROOT;
  previousContentRoot = process.env.LUCY_CONTENT_ROOT;
  fsState.caseSensitive = false;
});

afterEach(async () => {
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  if (previousContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = previousContentRoot;
  if (projectRoot) await rm(projectRoot, { recursive: true, force: true });
});

describe("R5 行级条件字段可诊断 — three-way attribution", () => {
  it("字段不存在: a reliably loaded catalog attributes the missing field with the four-tuple", async () => {
    projectRoot = await makeProject({});
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    const { rowPolicy, catalog } = await loadRowPolicy();

    const loaded = await catalog.loadSourceFieldCatalogWithProvenance({
      connectionId: "warehouse",
      schema: "fin",
      sourceName: "fin_ledger"
    });
    expect(loaded.status).toBe("loaded");
    expect(loaded.catalogLoaded).toBe(true);

    const bound = rowPolicy.bindRowPolicyField(
      "not_a_column",
      "fin_ledger",
      loaded.catalog,
      {
        connectionId: "warehouse",
        schema: "fin",
        catalogStatus: loaded.status,
        catalogStage: loaded.status === "manifest_unavailable" ? loaded.stage : undefined
      }
    );
    expect(bound.ok).toBe(false);
    if (bound.ok) return;
    // The machine reason code is unchanged.
    expect(bound.reason).toBe("row_policy_field_unresolved:unknown");
    expect(bound.attribution).toMatchObject({
      code: "row_policy_field_unknown",
      stage: "row_grant",
      connectionId: "warehouse",
      schema: "fin",
      sourceName: "fin_ledger",
      field: "not_a_column"
    });
  });

  it("清单不可用: an unresolvable manifest is attributed to operations with the failing stage", async () => {
    projectRoot = await makeProject({ schemaFileName: "missing.yaml" });
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    const { rowPolicy, catalog } = await loadRowPolicy();

    const result = await catalog.loadSourceFieldCatalogWithProvenance({
      connectionId: "warehouse",
      schema: "fin",
      sourceName: "fin_ledger"
    });
    expect(result.status).toBe("manifest_unavailable");
    if (result.status !== "manifest_unavailable") {
      throw new Error(`expected manifest_unavailable, got ${result.status}`);
    }
    expect(result.catalogLoaded).toBe(false);
    expect(result.stage).toBe("resolve");

    const bound = rowPolicy.bindRowPolicyField("region", "fin_ledger", result.catalog, {
      connectionId: "warehouse",
      schema: "fin",
      catalogStatus: result.status,
      catalogStage: result.stage
    });
    expect(bound.ok).toBe(false);
    if (bound.ok) return;
    expect(bound.attribution).toMatchObject({
      code: "row_policy_catalog_unavailable",
      catalogStage: "resolve",
      connectionId: "warehouse",
      schema: "fin",
      sourceName: "fin_ledger",
      field: "region"
    });
  });

  it("清单不可用: an unparsable manifest is attributed to the parse stage", async () => {
    projectRoot = await makeProject({ schemaYaml: "tables:\n  fin_ledger:\n   - [unbalanced\n" });
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    const { catalog } = await loadRowPolicy();

    const result = await catalog.loadSourceFieldCatalogWithProvenance({
      connectionId: "warehouse",
      schema: "fin",
      sourceName: "fin_ledger"
    });
    expect(result.status).toBe("manifest_unavailable");
    if (result.status !== "manifest_unavailable") {
      throw new Error(`expected manifest_unavailable, got ${result.status}`);
    }
    expect(result.stage).toBe("parse");
  });

  it("目录能力未知: an adapter that cannot prove catalog availability is attributed to the capability boundary", async () => {
    projectRoot = await makeProject({});
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    const { rowPolicy, catalog } = await loadRowPolicy();

    const result = await catalog.loadSourceFieldCatalogWithProvenance(
      { connectionId: "warehouse", schema: "fin", sourceName: "fin_ledger" },
      { schemaManifestCatalogProven: false }
    );
    expect(result.status).toBe("catalog_capability_unknown");
    expect(result.catalogLoaded).toBe(false);

    const bound = rowPolicy.bindRowPolicyField("region", "fin_ledger", result.catalog, {
      connectionId: "warehouse",
      schema: "fin",
      catalogStatus: result.status
    });
    expect(bound.ok).toBe(false);
    if (bound.ok) return;
    expect(bound.attribution).toMatchObject({
      code: "row_policy_catalog_capability_unknown",
      connectionId: "warehouse",
      schema: "fin",
      sourceName: "fin_ledger",
      field: "region"
    });
  });

  it("fails closed: no attribution ever yields a grant", async () => {
    projectRoot = await makeProject({ schemaFileName: "missing.yaml" });
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    const { rowPolicy } = await loadRowPolicy();

    const compiled = await rowPolicy.compileScopedRowGrant(
      { predicates: [{ field: "region", op: "eq", value: "East" }] },
      [{ connectionId: "warehouse", sourceName: "fin_ledger", schema: "fin" }]
    );
    expect(compiled.ok).toBe(false);
    if (compiled.ok) return;
    expect(compiled.attribution?.code).toBe("row_policy_catalog_unavailable");
  });

  it("目录能力未知 fails closed through the compile path as well", async () => {
    projectRoot = await makeProject({});
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    const { rowPolicy } = await loadRowPolicy();

    const compiled = await rowPolicy.compileScopedRowGrant(
      { predicates: [{ field: "region", op: "eq", value: "East" }] },
      [{ connectionId: "warehouse", sourceName: "fin_ledger", schema: "fin" }],
      { adapterCapabilities: { schemaManifestCatalogProven: false } }
    );
    expect(compiled.ok).toBe(false);
    if (compiled.ok) return;
    expect(compiled.reason).toMatch(/^row_policy_field_unresolved:/);
    expect(compiled.attribution?.code).toBe("row_policy_catalog_capability_unknown");
  });
});

describe("R5 — G5 / D-03 attribution boundary (case-sensitive manifest path)", () => {
  it("磁盘 BIDM.yaml + 请求 bidm.yaml → 清单不可用(stage=resolve)，绝不归因为字段不存在", async () => {
    projectRoot = await makeProject({
      schemaFileName: "BIDM.yaml",
      schemaYaml: `tables:
  hs_sy_bu_metric:
    table: BIDM.hs_sy_bu_metric
    columns:
      - name: hs_manage_bu_l2
`,
      overlayName: "hs_sy_bu_metric.yaml",
      overlayYaml: `columns:
  - name: hs_manage_bu_l2
`
    });
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    // A case-sensitive filesystem: `bidm.yaml` does not exist on disk.
    fsState.caseSensitive = true;

    const { rowPolicy, catalog } = await loadRowPolicy();

    const result = await catalog.loadSourceFieldCatalogWithProvenance({
      connectionId: "sql_server",
      schema: "bidm",
      sourceName: "hs_sy_bu_metric"
    });
    expect(result.status).toBe("manifest_unavailable");
    if (result.status !== "manifest_unavailable") {
      throw new Error(`expected manifest_unavailable, got ${result.status}`);
    }
    expect(result.stage).toBe("resolve");
    expect(result.catalogLoaded).toBe(false);

    const bound = rowPolicy.bindRowPolicyField("hs_manage_bu_l2", "hs_sy_bu_metric", result.catalog, {
      connectionId: "sql_server",
      schema: "bidm",
      catalogStatus: result.status,
      catalogStage: result.stage
    });
    expect(bound.ok).toBe(false);
    if (bound.ok) return;
    expect(bound.attribution?.code).toBe("row_policy_catalog_unavailable");
    // The G5 symptom must NOT be attributed to 「字段不存在」.
    expect(bound.attribution?.code).not.toBe("row_policy_field_unknown");
  });

  it("the compile path keeps the four-tuple and never claims 字段不存在 for the G5 miss", async () => {
    projectRoot = await makeProject({
      schemaFileName: "BIDM.yaml",
      schemaYaml: `tables:
  hs_sy_bu_metric:
    table: BIDM.hs_sy_bu_metric
    columns:
      - name: hs_manage_bu_l2
`,
      overlayName: "hs_sy_bu_metric.yaml",
      overlayYaml: `columns:
  - name: hs_manage_bu_l2
`
    });
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    fsState.caseSensitive = true;

    const { rowPolicy } = await loadRowPolicy();
    const compiled = await rowPolicy.compileScopedRowGrant(
      { predicates: [{ field: "hs_manage_bu_l2", op: "eq", value: "CDN产品" }] },
      [{ connectionId: "sql_server", sourceName: "hs_sy_bu_metric", schema: "bidm" }]
    );
    expect(compiled.ok).toBe(false);
    if (compiled.ok) return;
    expect(compiled.attribution).toMatchObject({
      code: "row_policy_catalog_unavailable",
      catalogStage: "resolve",
      connectionId: "sql_server",
      schema: "bidm",
      sourceName: "hs_sy_bu_metric",
      field: "hs_manage_bu_l2"
    });
    const rendered = rowPolicy.formatRowPolicyAttribution(compiled.attribution!);
    expect(rendered).toContain("code=row_policy_catalog_unavailable");
    expect(rendered).toContain("catalog_stage=resolve");
    expect(rendered).not.toContain("row_policy_field_unknown");
  });
});
