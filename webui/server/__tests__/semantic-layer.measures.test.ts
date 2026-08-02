import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseDocument } from "yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyOverlayUpdate, previewOverlayUpdate, serializeOverlay } from "../overlay";
import { applyPatch, previewSourcePatch, serialize } from "../semantic-layer";

let projectRoot: string;

const schemaYaml = `tables:
  superstore_orders:
    table: dataforai.superstore_orders
    columns:
      - name: sales
        type: number
`;

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "ktx-webui-measures-"));
  await mkdir(path.join(projectRoot, "semantic-layer", "mysql-aliyun", "_schema"), { recursive: true });
  await writeFile(path.join(projectRoot, "semantic-layer", "mysql-aliyun", "_schema", "dataforai.yaml"), schemaYaml, "utf8");
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

describe("measures and segments overlay", () => {
  it("spike: yaml Document API adds nested measures and segments", () => {
    const doc = parseDocument("name: superstore_orders\n# keep this comment\ngrain:\n  - order_id\n");
    applyOverlayUpdate(doc, "superstore_orders", {
      measures: [{ name: "total_sales", expr: "sum(sales)", description: "Total sales" }],
      segments: [{ name: "positive_sales", expr: "sales > 0" }]
    });
    const yaml = serializeOverlay(doc);

    expect(yaml).toContain("# keep this comment");
    expect(yaml).toContain("measures:");
    expect(yaml).toContain("expr: sum(sales)");
    expect(yaml).toContain("segments:");
  });

  it("previews measures and segments in overlay, not schema YAML", async () => {
    const preview = await previewSourcePatch(projectRoot, "mysql-aliyun", "dataforai", "superstore_orders", {
      measures: [{ name: "total_sales", expr: "sum(sales)", description: "Total sales" }],
      segments: [{ name: "positive_sales", expr: "sales > 0" }]
    });

    expect(preview.files.map((file) => file.filePath)).toEqual(["semantic-layer/mysql-aliyun/superstore_orders.yaml"]);
    const overlay = preview.files.find((file) => file.filePath === "semantic-layer/mysql-aliyun/superstore_orders.yaml");
    expect(overlay?.proposedYaml).toContain("measures:");
    expect(overlay?.proposedYaml).toContain("segments:");
    await expect(readFile(path.join(projectRoot, "semantic-layer", "mysql-aliyun", "_schema", "dataforai.yaml"), "utf8")).resolves.toBe(schemaYaml);
  });

  it("does not emit overlay preview for formatting-only differences", async () => {
    await writeFile(
      path.join(projectRoot, "semantic-layer", "mysql-aliyun", "superstore_orders.yaml"),
      `name: superstore_orders

grain:
  - sales

measures:
  - name: total_sales
    expr: sum(sales)
    description: Total sales

segments:
  - name: positive_sales
    expr: sales > 0
`,
      "utf8"
    );

    const preview = await previewOverlayUpdate(projectRoot, "mysql-aliyun", "superstore_orders", {
      grain: ["sales"],
      measures: [{ name: "total_sales", expr: "sum(sales)", description: "Total sales" }],
      segments: [{ name: "positive_sales", expr: "sales > 0" }]
    });

    expect(preview).toBeNull();
  });
});

describe("formal join patching", () => {
  it("writes only formal joins and keeps the on key double quoted", () => {
    const doc = parseDocument(schemaYaml);
    applyPatch(doc, "superstore_orders", {
      joins: [
        {
          to: "superstore_people",
          on: "superstore_orders.region = superstore_people.region",
          relationship: "many_to_one",
          source: "formal"
        },
        {
          to: "candidate_only",
          on: "superstore_orders.id = candidate_only.id",
          relationship: "many_to_one",
          source: "candidate"
        }
      ]
    });
    const yaml = serialize(doc);

    expect(yaml).toContain('"on": superstore_orders.region = superstore_people.region');
    expect(yaml).toContain("source: formal");
    expect(yaml).not.toContain("candidate_only");
  });
});
