import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listSources, readSource } from "../semantic-layer";

let projectRoot: string;

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "ktx-webui-sl-"));
  await mkdir(path.join(projectRoot, "semantic-layer", "mysql-aliyun", "_schema"), { recursive: true });
  await writeFile(
    path.join(projectRoot, "semantic-layer", "mysql-aliyun", "_schema", "openclaw_db.yaml"),
    `tables:
  customers:
    table: openclaw_db.customers
    x_custom:
      keep: true
    columns:
      - name: customer_id
        type: number
        pk: true
        nullable: false
        descriptions:
          ai: Unique customer identifier.
      - name: customer_name
        type: string
        descriptions:
          human: Customer display name.
    descriptions:
      ai: Customer registry.
    joins:
      - to: orders
        "on": customers.customer_id = orders.customer_id
        relationship: one_to_many
        source: formal
`,
    "utf8"
  );
  await writeFile(
    path.join(projectRoot, "semantic-layer", "mysql-aliyun", "customers.yaml"),
    `name: customers
grain:
  - customer_id
measures:
  - name: customer_count
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
      schema: "openclaw_db",
      table: "customers",
      columnCount: 2,
      hasTableDesc: true,
      hasGrain: true,
      measureCount: 1,
      joinCount: 1,
      completion: "done"
    });
  });

  it("normalizes one table and preserves raw yaml and unknown keys", async () => {
    const result = await readSource(projectRoot, "mysql-aliyun", "openclaw_db", "customers");

    expect(result.model.descriptions.ai).toBe("Customer registry.");
    expect(result.model.columns.map((column) => column.name)).toEqual(["customer_id", "customer_name"]);
    expect(result.model.columns[1].descriptions.human).toBe("Customer display name.");
    expect(result.model.grain).toEqual(["customer_id"]);
    expect(result.model.measures).toEqual([{ name: "customer_count", expr: "count(*)", filter: undefined, description: undefined }]);
    expect(result.model.joins?.[0]).toMatchObject({
      to: "orders",
      on: "customers.customer_id = orders.customer_id",
      relationship: "one_to_many"
    });
    expect(result.model.unknownKeys).toContain("x_custom");
    expect(result.rawYaml).toContain("x_custom");
    expect(result.rawYaml).toContain('"on"');
  });

  it("raises not found for missing tables", async () => {
    await expect(readSource(projectRoot, "mysql-aliyun", "openclaw_db", "missing")).rejects.toMatchObject({
      code: "SOURCE_NOT_FOUND"
    });
  });
});
