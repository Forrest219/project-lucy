import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseDocument } from "yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyPatch, previewSourcePatch, serialize } from "../semantic-layer";

let projectRoot: string;
const schemaRelPath = "semantic-layer/mysql-aliyun/_schema/dataforai.yaml";
const longAiDescription =
  "Master registry of all superstore_orders, capturing identity, segmentation, regional assignment, and account lifecycle status.";

const schemaYaml = `tables:
  superstore_orders:
    table: dataforai.superstore_orders
    x_custom: keep-me
    columns:
      - name: order_id
        type: number
        pk: true
        nullable: false
        descriptions:
          ai: Unique numeric identifier.
      - name: order_name
        type: string
        descriptions:
          ai: Official business name.
    descriptions:
      ai: ${longAiDescription}
    joins:
      - to: superstore_returns
        "on": superstore_orders.order_id = superstore_returns.order_id
        relationship: one_to_many
        source: formal
  superstore_returns:
    table: dataforai.superstore_returns
    columns:
      - name: order_id
        type: number
`;

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "ktx-webui-roundtrip-"));
  await mkdir(path.join(projectRoot, "semantic-layer", "mysql-aliyun", "_schema"), { recursive: true });
  await writeFile(path.join(projectRoot, schemaRelPath), schemaYaml, "utf8");
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

describe("semantic-layer round-trip patching", () => {
  it("writes human descriptions without overwriting ai, unknown keys, quoted on, or other tables", () => {
    const doc = parseDocument(schemaYaml);

    applyPatch(doc, "superstore_orders", {
      columns: [{ name: "order_id", description: "Order identifier curated by human." }]
    });
    const proposed = serialize(doc);

    expect(proposed).toContain("ai: Unique numeric identifier.");
    expect(proposed).toContain("human: Order identifier curated by human.");
    expect(proposed).toContain("x_custom: keep-me");
    expect(proposed).toContain('"on": superstore_orders.order_id = superstore_returns.order_id');
    expect(proposed).toContain("  superstore_returns:\n    table: dataforai.superstore_returns");
  });

  it("keeps schema diff focused on one changed description line", async () => {
    const preview = await previewSourcePatch(projectRoot, "mysql-aliyun", "dataforai", "superstore_orders", {
      columns: [{ name: "order_id", description: "Order identifier curated by human." }]
    });

    expect(preview.files).toHaveLength(1);
    expect(preview.diff).toContain("+          human: Order identifier curated by human.");
    expect(preview.diff).not.toContain("-          ai: Unique numeric identifier.");
    expect(preview.diff).not.toContain("-        \"on\": superstore_orders.order_id = superstore_returns.order_id");
  });

  it("does not reflow long ai descriptions while patching one field", async () => {
    const preview = await previewSourcePatch(projectRoot, "mysql-aliyun", "dataforai", "superstore_orders", {
      columns: [{ name: "order_id", description: "人工：订单主键" }]
    });
    const changedBusinessLines = preview.diff
      .split("\n")
      .filter((line) => /^[+-]/.test(line) && !line.startsWith("---") && !line.startsWith("+++"));

    expect(preview.files).toHaveLength(1);
    expect(changedBusinessLines).toEqual(["+          human: 人工：订单主键"]);
    expect(preview.diff).not.toContain("-    descriptions:");
    expect(preview.diff).not.toContain(`-      ai: ${longAiDescription}`);
    expect(preview.files[0].proposedYaml).toContain(`      ai: ${longAiDescription}`);
  });

  it("previews grain in overlay without changing disk files", async () => {
    const schemaPath = path.join(projectRoot, schemaRelPath);
    const before = await stat(schemaPath);
    const preview = await previewSourcePatch(projectRoot, "mysql-aliyun", "dataforai", "superstore_orders", {
      grain: ["order_id"]
    });
    const after = await stat(schemaPath);
    const diskText = await readFile(schemaPath, "utf8");

    expect(preview.files.map((file) => file.filePath)).toEqual(["semantic-layer/mysql-aliyun/superstore_orders.yaml"]);
    expect(preview.files[0].proposedYaml).toContain("grain:");
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(diskText).toBe(schemaYaml);
  });
});
