import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listManifestSchemas, listSources, readSource } from "../semantic-layer";

let projectRoot: string;

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "ktx-webui-sl-"));
  await mkdir(path.join(projectRoot, "semantic-layer", "mysql-aliyun", "_schema"), { recursive: true });
  await writeFile(
    path.join(projectRoot, "semantic-layer", "mysql-aliyun", "_schema", "dataforai.yaml"),
    `tables:
  superstore_orders:
    table: dataforai.superstore_orders
    x_custom:
      keep: true
    columns:
      - name: order_id
        type: number
        pk: true
        nullable: false
        descriptions:
          db: 订单 ID
          ai: Unique order identifier.
      - name: order_name
        type: string
        descriptions:
          human: Order display name.
    descriptions:
      ai: Order registry.
    joins:
      - to: superstore_returns
        "on": superstore_orders.order_id = superstore_returns.order_id
        relationship: one_to_many
        source: formal
`,
    "utf8"
  );
  await writeFile(
    path.join(projectRoot, "semantic-layer", "mysql-aliyun", "superstore_orders.yaml"),
    `name: superstore_orders
grain:
  - order_id
measures:
  - name: order_count
    expr: count(*)
`,
    "utf8"
  );
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

describe("semantic-layer read", () => {
  it("lists tables with summaries and completion", async () => {
    const summaries = await listSources(projectRoot);

    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      conn: "mysql-aliyun",
      schema: "dataforai",
      table: "superstore_orders",
      qualifiedName: "dataforai.superstore_orders",
      columnCount: 2,
      hasTableDesc: true,
      hasGrain: true,
      measureCount: 1,
      joinCount: 1,
      completion: "done"
    });
  });

  it("lists local Schema Manifest files as first-hand catalog facts", async () => {
    const manifests = await listManifestSchemas(projectRoot);

    expect(manifests).toEqual([
      {
        conn: "mysql-aliyun",
        schema: "dataforai",
        filePath: "semantic-layer/mysql-aliyun/_schema/dataforai.yaml",
        tableCount: 1,
        mtime: expect.any(String)
      }
    ]);
  });

  it("normalizes one table and preserves raw yaml and unknown keys", async () => {
    const result = await readSource(projectRoot, "mysql-aliyun", "dataforai", "superstore_orders");

    expect(result.model.descriptions.ai).toBe("Order registry.");
    expect(result.model.columns.map((column) => column.name)).toEqual(["order_id", "order_name"]);
    expect(result.model.columns[0].descriptions.db).toBe("订单 ID");
    expect(result.model.columns[1].descriptions.human).toBe("Order display name.");
    expect(result.model.grain).toEqual(["order_id"]);
    expect(result.model.measures).toEqual([{ name: "order_count", expr: "count(*)", filter: undefined, description: undefined }]);
    expect(result.model.joins?.[0]).toMatchObject({
      to: "superstore_returns",
      on: "superstore_orders.order_id = superstore_returns.order_id",
      relationship: "one_to_many"
    });
    expect(result.model.unknownKeys).toContain("x_custom");
    expect(result.rawYaml).toContain("x_custom");
    expect(result.rawYaml).toContain("on:");
  });

  it("raises not found for missing tables", async () => {
    await expect(readSource(projectRoot, "mysql-aliyun", "dataforai", "missing")).rejects.toMatchObject({
      code: "SOURCE_NOT_FOUND"
    });
  });
});
