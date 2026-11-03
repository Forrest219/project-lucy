import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildForcedFiltersPayload,
  compileScopedRowGrant,
  resetRowPolicyCatalogCacheForTests,
  resolveManifestFilePath
} from "../proxy/row-policy";
import { previewRowPolicyDraft } from "../proxy/row-policy-preview";

/**
 * D-03 on the real filesystem.
 *
 * The sibling `row-policy-d03-uppercase.test.ts` mocks `readFile` so macOS and
 * Linux behave the same. This file does not. On a case-insensitive volume the
 * lowercase path still opens, so the case-sensitive assertions wait. Set
 * `LUCY_D03_REQUIRE_CASE_SENSITIVE=1` to fail unless the temp directory can
 * hold `BIDM.yaml` and `bidm.yaml` as two entries.
 *
 * A passing run here is not release evidence and does not fill D-03 `fixedIn`.
 */

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
      tools: [lucy_query]
users: []
defaults:
  deny_tools: []
`;

let projectRoot = "";
let previousRoot: string | undefined;
let previousContentRoot: string | undefined;

async function directoryIsCaseSensitive(dir: string): Promise<boolean> {
  const lower = path.join(dir, "casesense-probe");
  const upper = path.join(dir, "CASESENSE-PROBE");
  await writeFile(lower, "lower", "utf8");
  await writeFile(upper, "upper", "utf8");
  try {
    const names = (await readdir(dir)).filter((name) => name.toLowerCase() === "casesense-probe");
    return names.length === 2;
  } finally {
    await rm(lower, { force: true });
    await rm(upper, { force: true });
  }
}

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
  resetRowPolicyCatalogCacheForTests();
});

describe("D-03 real filesystem", () => {
  it("resolves BIDM.yaml by the on-disk name, and refuses the lowercase path when the volume is case-sensitive", async () => {
    projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-d03-realfs-"));
    const schemaDir = path.join(projectRoot, "semantic-layer", "sql_server", "_schema");
    await mkdir(schemaDir, { recursive: true });
    await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
    await writeFile(path.join(schemaDir, "BIDM.yaml"), BIDM_SCHEMA_YAML, "utf8");
    await writeFile(path.join(projectRoot, "semantic-layer", "sql_server", "hs_sy_bu_metric.yaml"), METRIC_OVERLAY_YAML, "utf8");
    await writeFile(path.join(projectRoot, "ktx.yaml"), KTX_YAML, "utf8");
    await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), ACCESS_YAML, "utf8");
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    resetRowPolicyCatalogCacheForTests();

    const sensitive = await directoryIsCaseSensitive(schemaDir);
    if (process.env.LUCY_D03_REQUIRE_CASE_SENSITIVE === "1") {
      expect(sensitive, "temp directory is not case-sensitive").toBe(true);
    }

    const resolved = await resolveManifestFilePath(schemaDir, "bidm");
    expect(path.basename(resolved)).toBe("BIDM.yaml");

    if (sensitive) {
      await expect(readFile(path.join(schemaDir, "bidm.yaml"), "utf8")).rejects.toThrow();
    }

    const compiled = await compileScopedRowGrant(
      { predicates: [{ field: "hs_manage_bu_l2", op: "eq", value: "CDN产品" }] },
      [{ connectionId: "sql_server", sourceName: "hs_sy_bu_metric", schema: "bidm" }]
    );
    expect(compiled.ok).toBe(true);

    const outcome = await previewRowPolicyDraft({
      roleId: "finbp_cdn",
      tables: [{ connection: "sql_server", schema: "bidm", name: "hs_sy_bu_metric" }]
    });
    const table = outcome.tables[0]!;
    expect(table.catalog.status).toBe("loaded");
    expect(table.preview?.effectiveRowGrant.kind).toBe("scoped");
    if (!compiled.ok || !table.preview) return;
    expect(buildForcedFiltersPayload(table.preview.effectiveRowGrant, "hs_sy_bu_metric")).toEqual(
      buildForcedFiltersPayload(compiled.grant, "hs_sy_bu_metric")
    );
  });
});
