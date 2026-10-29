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

const fsState = vi.hoisted(() => ({ caseSensitive: false, unreadable: false }));

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
      if (fsState.unreadable && isSchemaManifest) {
        // The file EXISTS but cannot be read — a READ failure, not a RESOLUTION one.
        const error = new Error(`EACCES: permission denied, open '${asPath}'`) as NodeJS.ErrnoException;
        error.code = "EACCES";
        throw error;
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

/**
 * A SQL Server connection whose Schema Manifest is on disk under an UPPERCASE
 * file name. The customer scenario (D-03 / G5) is a registered connection whose
 * manifest file keeps its original case, so the fixture must register the
 * connection AND put the manifest under that connection's directory.
 */
const SQL_SERVER_KTX_YAML = `connections:
  sql_server:
    driver: sqlserver
    enabled_tables:
      - BIDM.hs_sy_bu_metric
`;

let projectRoot: string;
let previousRoot: string | undefined;
let previousContentRoot: string | undefined;

async function makeProject(options: {
  schemaFileName?: string;
  schemaYaml?: string;
  overlayName?: string;
  overlayYaml?: string;
  /** The connection the semantic layer belongs to. Defaults to `warehouse`. */
  connectionId?: string;
  driver?: string;
}): Promise<string> {
  const connectionId = options.connectionId ?? "warehouse";
  const root = await mkdtemp(path.join(os.tmpdir(), "lucy-row-policy-r5-"));
  await mkdir(path.join(root, "webui", "config"), { recursive: true });
  await mkdir(path.join(root, "semantic-layer", connectionId, "_schema"), { recursive: true });
  await writeFile(
    path.join(root, "ktx.yaml"),
    connectionId === "warehouse"
      ? KTX_YAML
      : `connections:\n  ${connectionId}:\n    driver: ${options.driver ?? "sqlserver"}\n`,
    "utf8"
  );
  await writeFile(
    path.join(root, "semantic-layer", connectionId, "_schema", options.schemaFileName ?? "fin.yaml"),
    options.schemaYaml ?? FIN_SCHEMA_YAML,
    "utf8"
  );
  await writeFile(
    path.join(root, "semantic-layer", connectionId, options.overlayName ?? "fin_ledger.yaml"),
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
  fsState.unreadable = false;
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

  it("清单不可用: a manifest that exists but cannot be read is attributed to the read stage", async () => {
    projectRoot = await makeProject({});
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    // The file is there, but reading it is denied — a READ failure, not a RESOLUTION one.
    fsState.unreadable = true;
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
    // The stage distinguishes 「读不到」from 「找不到」— both are operations-side faults.
    expect(result.stage).toBe("read");
  });

  it("清单不可用: a structurally invalid manifest is attributed to the catalog stage", async () => {
    // Parseable YAML, but the manifest root has no `tables` block — the catalog
    // cannot be built from it, so it must NOT be reported as 「字段不存在」.
    projectRoot = await makeProject({ schemaYaml: "not_tables:\n  fin_ledger: {}\n" });
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
    expect(["catalog", "parse"]).toContain(result.stage);

    const bound = rowPolicy.bindRowPolicyField("region", "fin_ledger", result.catalog, {
      connectionId: "warehouse",
      schema: "fin",
      catalogStatus: result.status,
      catalogStage: result.stage
    });
    expect(bound.ok).toBe(false);
    if (bound.ok) return;
    expect(bound.attribution?.code).toBe("row_policy_catalog_unavailable");
    expect(bound.attribution?.code).not.toBe("row_policy_field_unknown");
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

describe("R5 — G5 / D-03 resolution (case-sensitive manifest path)", () => {
  it("磁盘 BIDM.yaml + 请求 bidm.yaml → 大小写不敏感解析命中，字段正常绑定", async () => {
    projectRoot = await makeProject({
      connectionId: "sql_server",
      driver: "sqlserver",
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
    // A case-sensitive filesystem: `bidm.yaml` does not exist on disk, only `BIDM.yaml`.
    fsState.caseSensitive = true;

    const { rowPolicy, catalog } = await loadRowPolicy();

    const result = await catalog.loadSourceFieldCatalogWithProvenance({
      connectionId: "sql_server",
      schema: "bidm",
      sourceName: "hs_sy_bu_metric"
    });
    // D-03 fixed: the manifest is resolved case-insensitively, so the catalog loads.
    expect(result.status).toBe("loaded");
    if (result.status !== "loaded") {
      throw new Error(`expected loaded, got ${result.status}`);
    }
    expect(result.catalogLoaded).toBe(true);
    // The reported path is the REAL disk file, not the requested lower-cased one.
    expect(result.manifestPath).toBe("sql_server/_schema/BIDM.yaml");

    const bound = rowPolicy.bindRowPolicyField("hs_manage_bu_l2", "hs_sy_bu_metric", result.catalog, {
      connectionId: "sql_server",
      schema: "bidm",
      catalogStatus: result.status
    });
    expect(bound.ok).toBe(true);
  });

  it("the compile path binds the legal column on the upper-case schema table", async () => {
    projectRoot = await makeProject({
      connectionId: "sql_server",
      driver: "sqlserver",
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
    // D-03 fixed: the G5 symptom (a legal column judged 「字段不存在」) is gone.
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.grant.kind).toBe("scoped");
  });
});

describe("L25-14 §14.4.1 — the capability fixture cannot force proven", () => {
  const previous = process.env.LUCY_ROW_POLICY_CATALOG_CAPABILITY;

  afterEach(() => {
    if (previous === undefined) delete process.env.LUCY_ROW_POLICY_CATALOG_CAPABILITY;
    else process.env.LUCY_ROW_POLICY_CATALOG_CAPABILITY = previous;
  });

  it("proven and proven:<id> fall through to the adapter contract", async () => {
    const capability = await import("../proxy/row-policy-capability.js");
    capability.resetRowPolicyCapabilityCacheForTests();
    const deployment = {
      form: "test",
      schemaManifestCatalogSupported: true,
      semanticLayerRoot: ".",
      reason: "test"
    };
    for (const fixture of ["proven", "proven:c1"]) {
      process.env.LUCY_ROW_POLICY_CATALOG_CAPABILITY = fixture;
      const resolved = await capability.resolveSchemaManifestCatalogCapability(
        { id: "c1", driver: "not-a-driver" },
        deployment
      );
      expect(resolved.status).toBe("unknown");
      expect(resolved.reason.startsWith("deployment_fixture:proven")).toBe(false);
    }
  });
});
