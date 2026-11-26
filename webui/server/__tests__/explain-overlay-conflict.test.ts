import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { invalidateContentPathsCache } from "../paths";
import { detectStandaloneOverlayConflicts } from "../semantic-overlay-lifecycle";

let projectRoot: string;
let prevRoot: string | undefined;
let prevContentRoot: string | undefined;

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-explain-overlay-conflict-"));
  await mkdir(path.join(projectRoot, "semantic-layer", "sql_server", "_schema"), { recursive: true });
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections:\n  sql_server:\n    driver: mssql\n", "utf8");
  prevRoot = process.env.KTX_PROJECT_ROOT;
  prevContentRoot = process.env.LUCY_CONTENT_ROOT;
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_CONTENT_ROOT = ".";
  invalidateContentPathsCache();
});

afterEach(async () => {
  invalidateContentPathsCache();
  if (prevRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = prevRoot;
  if (prevContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = prevContentRoot;
  await rm(projectRoot, { recursive: true, force: true });
});

describe("detectStandaloneOverlayConflicts (OQ-3)", () => {
  it("detects standalone per-table overlay shadowing Schema Manifest with physicalTableMismatch", async () => {
    await writeFile(
      path.join(projectRoot, "semantic-layer", "sql_server", "dw_procurement_pr_detail.yaml"),
      [
        "name: dw_procurement_pr_detail",
        "source_type: table",
        "table: BIDW.dw_procurement_pr_detail",
        "grain: [pr_detail_id]"
      ].join("\n") + "\n",
      "utf8"
    );

    const conflicts = await detectStandaloneOverlayConflicts([
      {
        connectionId: "sql_server",
        sourceName: "dw_procurement_pr_detail",
        physicalTable: "bidw.dbo.dw_procurement_pr_detail"
      }
    ]);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      connectionId: "sql_server",
      sourceName: "dw_procurement_pr_detail",
      overlayFilePath: "semantic-layer/sql_server/dw_procurement_pr_detail.yaml",
      overlayKind: "standalone",
      manifestPhysicalTable: "bidw.dbo.dw_procurement_pr_detail",
      overlayPhysicalTable: "BIDW.dw_procurement_pr_detail",
      physicalTableMismatch: true
    });
    expect(conflicts[0].warning).toContain("DELETE /api/semantic-assets/overlay/sql_server/dw_procurement_pr_detail");
  });

  it("ignores safe merge_overlay files that do not define table or sql", async () => {
    await writeFile(
      path.join(projectRoot, "semantic-layer", "sql_server", "dw_procurement_pr_detail.yaml"),
      ["name: dw_procurement_pr_detail", "grain: [pr_detail_id]"].join("\n") + "\n",
      "utf8"
    );

    const conflicts = await detectStandaloneOverlayConflicts([
      {
        connectionId: "sql_server",
        sourceName: "dw_procurement_pr_detail",
        physicalTable: "bidw.dbo.dw_procurement_pr_detail"
      }
    ]);

    expect(conflicts).toEqual([]);
  });

  it("returns empty when no per-table file exists and deduplicates repeated sources", async () => {
    await writeFile(
      path.join(projectRoot, "semantic-layer", "sql_server", "v_token_income_unified.yaml"),
      ["name: v_token_income_unified", "sql: SELECT 1"].join("\n") + "\n",
      "utf8"
    );

    const conflicts = await detectStandaloneOverlayConflicts([
      {
        connectionId: "sql_server",
        sourceName: "missing_table",
        physicalTable: "bidw.dbo.missing_table"
      },
      {
        connectionId: "sql_server",
        sourceName: "v_token_income_unified",
        physicalTable: "bidw.dbo.v_token_income_unified"
      },
      {
        connectionId: "sql_server",
        sourceName: "v_token_income_unified",
        physicalTable: "bidw.dbo.v_token_income_unified"
      }
    ]);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      sourceName: "v_token_income_unified",
      overlayKind: "standalone",
      overlayPhysicalTable: null,
      physicalTableMismatch: false
    });
  });

  it("skips unsafe path segments without throwing", async () => {
    const conflicts = await detectStandaloneOverlayConflicts([
      {
        connectionId: "../etc",
        sourceName: "passwd",
        physicalTable: "etc.passwd"
      }
    ]);
    expect(conflicts).toEqual([]);
  });
});
