import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyEnabledTablesMigration,
  planEnabledTablesMigration
} from "../enabled-tables";
import {
  canonicalEnabledTables,
  countEnabledForSchema,
  normalizeEnabledTableNames,
  schemaInferredFromEnabledTable,
  type TableIdentityEntry
} from "../../src/lib/enabled-table-identity";
import { parseQualifiedTable } from "../semantic-identity";

const entries: TableIdentityEntry[] = [
  { logicalName: "BIDM.hs_sy_company_metric", physicalName: "bidm.dbo.hs_sy_company_metric" },
  { logicalName: "BIDM.dm_cpu_asset_cost", physicalName: "dbo.dm_cpu_asset_cost" },
  { logicalName: "dataforai.orders", physicalName: "dataforai.orders" }
];

describe("enabled table identity", () => {
  it("accepts two-part and three-part names and rejects the rest", () => {
    expect(parseQualifiedTable("dataforai.orders")).toEqual({ schema: "dataforai", table: "orders" });
    expect(parseQualifiedTable("bidm.dbo.hs_sy_company_metric")).toEqual({
      schema: "bidm.dbo",
      table: "hs_sy_company_metric"
    });
    expect(parseQualifiedTable("dbo.dm_cpu_asset_cost")).toEqual({
      schema: "dbo",
      table: "dm_cpu_asset_cost"
    });
    expect(parseQualifiedTable("onlytable")).toBeNull();
    expect(parseQualifiedTable("server.database.schema.table")).toBeNull();
    expect(parseQualifiedTable("a..b")).toBeNull();
    expect(parseQualifiedTable("a/b.c")).toBeNull();
  });

  it("does not treat a three-part database segment as a connection schema", () => {
    expect(schemaInferredFromEnabledTable("dataforai.orders")).toBe("dataforai");
    expect(schemaInferredFromEnabledTable("bidm.dbo.orders")).toBeNull();
  });

  it("normalizes logical names and case variants to one physical name on SQL Server", () => {
    const normalized = normalizeEnabledTableNames(
      ["BIDM.hs_sy_company_metric", "BIDM.DBO.HS_SY_COMPANY_METRIC", "bidm.dbo.hs_sy_company_metric"],
      entries,
      true
    );
    expect(normalized.tables).toEqual(["bidm.dbo.hs_sy_company_metric"]);
    expect(normalized.rewritten).toEqual([
      { from: "BIDM.hs_sy_company_metric", to: "bidm.dbo.hs_sy_company_metric" }
    ]);
    expect(normalized.droppedDuplicates).toEqual([
      "BIDM.DBO.HS_SY_COMPANY_METRIC",
      "bidm.dbo.hs_sy_company_metric"
    ]);
  });

  it("maps a logical name onto a two-part physical name and keeps an unmapped alias", () => {
    const normalized = normalizeEnabledTableNames(
      ["BIDM.dm_cpu_asset_cost", "dbo.dm_cpu_asset_cost", "bidm.dbo.dm_cpu_asset_cost"],
      entries,
      true
    );
    expect(normalized.tables).toEqual(["dbo.dm_cpu_asset_cost", "bidm.dbo.dm_cpu_asset_cost"]);
    expect(normalized.unmapped).toEqual(["bidm.dbo.dm_cpu_asset_cost"]);
    expect(normalized.droppedDuplicates).toEqual(["dbo.dm_cpu_asset_cost"]);
  });

  it("keeps MySQL two-part names case-sensitive", () => {
    const mysql = [{ logicalName: "dataforai.orders", physicalName: "dataforai.orders" }];
    expect(canonicalEnabledTables(["dataforai.orders", "Dataforai.Orders"], mysql, false)).toEqual([
      "dataforai.orders",
      "Dataforai.Orders"
    ]);
  });

  it("does not collapse two physical names that only share a case-insensitive key", () => {
    const colliding = [
      { logicalName: "S.a", physicalName: "S.Alpha" },
      { logicalName: "S.b", physicalName: "s.alpha" }
    ];
    const normalized = normalizeEnabledTableNames(["S.Alpha", "s.alpha"], colliding, true);
    expect(normalized.tables).toEqual(["S.Alpha", "s.alpha"]);
    expect(normalized.ambiguous).toEqual(["S.Alpha", "s.alpha"]);
    expect(normalized.rewritten).toEqual([]);
  });

  it("counts one logical table once, and still counts an unscanned schema prefix", () => {
    expect(
      countEnabledForSchema(
        "BIDM",
        ["BIDM.dm_cpu_asset_cost", "dbo.dm_cpu_asset_cost"],
        [{ schema: "BIDM", table: "dm_cpu_asset_cost", qualifiedName: "dbo.dm_cpu_asset_cost" }],
        true
      )
    ).toBe(1);
    expect(
      countEnabledForSchema(
        "demo_finance",
        ["demo_finance.ceo_metric_snapshot", "demo_finance.fct_revenue"],
        [],
        false
      )
    ).toBe(2);
  });
});

describe("enabled_tables migration", () => {
  let projectRoot = "";
  const previousContentRoot = process.env.LUCY_CONTENT_ROOT;

  afterEach(async () => {
    if (previousContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
    else process.env.LUCY_CONTENT_ROOT = previousContentRoot;
    if (projectRoot) await rm(projectRoot, { recursive: true, force: true });
  });

  it("rewrites mapped aliases, keeps unmapped names, and is idempotent", async () => {
    projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-enabled-tables-"));
    process.env.LUCY_CONTENT_ROOT = ".";
    await mkdir(path.join(projectRoot, "semantic-layer", "sql_server", "_schema"), { recursive: true });
    await writeFile(
      path.join(projectRoot, "semantic-layer", "sql_server", "_schema", "BIDM.yaml"),
      `tables:
  hs_sy_company_metric:
    table: bidm.dbo.hs_sy_company_metric
  dm_cpu_asset_cost:
    table: dbo.dm_cpu_asset_cost
`,
      "utf8"
    );
    const original = `connections:
  sql_server:
    driver: sqlserver
    password: keep-me
    enabled_tables:
      - BIDM.hs_sy_company_metric
      - BIDM.DBO.HS_SY_COMPANY_METRIC
      - dbo.dm_cpu_asset_cost
      - bidm.dbo.dm_cpu_asset_cost
  mysql_demo:
    driver: mysql
    enabled_tables:
      - dataforai.orders
`;
    await writeFile(path.join(projectRoot, "ktx.yaml"), original, "utf8");

    const planned = await planEnabledTablesMigration(projectRoot);
    const sqlServer = planned.find((change) => change.connectionId === "sql_server");
    expect(sqlServer?.after).toEqual([
      "bidm.dbo.hs_sy_company_metric",
      "dbo.dm_cpu_asset_cost",
      "bidm.dbo.dm_cpu_asset_cost"
    ]);
    expect(sqlServer?.unmapped).toEqual(["bidm.dbo.dm_cpu_asset_cost"]);
    expect(planned.find((change) => change.connectionId === "mysql_demo")?.after).toEqual([
      "dataforai.orders"
    ]);

    const applied = await applyEnabledTablesMigration(projectRoot);
    expect(applied.written).toBe(true);
    expect(applied.backupPath).toBeTruthy();
    const written = await readFile(path.join(projectRoot, "ktx.yaml"), "utf8");
    expect(written).toContain("password: keep-me");
    expect(written).toContain("bidm.dbo.hs_sy_company_metric");
    expect(written).not.toContain("BIDM.hs_sy_company_metric");
    expect(written).toContain("bidm.dbo.dm_cpu_asset_cost");
    const backup = await readFile(applied.backupPath!, "utf8");
    expect(backup).toContain("BIDM.hs_sy_company_metric");

    const again = await applyEnabledTablesMigration(projectRoot);
    expect(again.written).toBe(false);
    expect(again.backupPath).toBeNull();
    await expect(readFile(path.join(projectRoot, "ktx.yaml"), "utf8")).resolves.toBe(written);
  });
});
