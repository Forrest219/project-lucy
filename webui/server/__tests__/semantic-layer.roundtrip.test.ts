import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseDocument } from "yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyPatch, previewSourcePatch, serialize } from "../semantic-layer";

let projectRoot: string;
const schemaRelPath = "semantic-layer/mysql-aliyun/_schema/openclaw_db.yaml";
const longAiDescription =
  "Master registry of all customers, capturing identity, segmentation, regional assignment, and account lifecycle status.";

const schemaYaml = `tables:
  customers:
    table: openclaw_db.customers
    x_custom: keep-me
    columns:
      - name: customer_id
        type: number
        pk: true
        nullable: false
        descriptions:
          ai: Unique numeric identifier.
      - name: customer_name
        type: string
        descriptions:
          ai: Official business name.
    descriptions:
      ai: ${longAiDescription}
    joins:
      - to: orders
        "on": customers.customer_id = orders.customer_id
        relationship: one_to_many
        source: formal
  orders:
    table: openclaw_db.orders
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

    applyPatch(doc, "customers", {
      columns: [{ name: "customer_id", description: "Customer identifier curated by human." }]
    });
    const proposed = serialize(doc);

    expect(proposed).toContain("ai: Unique numeric identifier.");
    expect(proposed).toContain("human: Customer identifier curated by human.");
    expect(proposed).toContain("x_custom: keep-me");
    expect(proposed).toContain('"on": customers.customer_id = orders.customer_id');
    expect(proposed).toContain("  orders:\n    table: openclaw_db.orders");
  });

  it("keeps schema diff focused on one changed description line", async () => {
    const preview = await previewSourcePatch(projectRoot, "mysql-aliyun", "openclaw_db", "customers", {
      columns: [{ name: "customer_id", description: "Customer identifier curated by human." }]
    });

    expect(preview.files).toHaveLength(1);
    expect(preview.diff).toContain("+          human: Customer identifier curated by human.");
    expect(preview.diff).not.toContain("-          ai: Unique numeric identifier.");
    expect(preview.diff).not.toContain("-        \"on\": customers.customer_id = orders.customer_id");
  });

  it("does not reflow long ai descriptions while patching one field", async () => {
    const preview = await previewSourcePatch(projectRoot, "mysql-aliyun", "openclaw_db", "customers", {
      columns: [{ name: "customer_id", description: "人工：客户主键" }]
    });
    const changedBusinessLines = preview.diff
      .split("\n")
      .filter((line) => /^[+-]/.test(line) && !line.startsWith("---") && !line.startsWith("+++"));

    expect(preview.files).toHaveLength(1);
    expect(changedBusinessLines).toEqual(["+          human: 人工：客户主键"]);
    expect(preview.diff).not.toContain("-    descriptions:");
    expect(preview.diff).not.toContain(`-      ai: ${longAiDescription}`);
    expect(preview.files[0].proposedYaml).toContain(`      ai: ${longAiDescription}`);
  });

  it("previews grain in overlay without changing disk files", async () => {
    const schemaPath = path.join(projectRoot, schemaRelPath);
    const before = await stat(schemaPath);
    const preview = await previewSourcePatch(projectRoot, "mysql-aliyun", "openclaw_db", "customers", {
      grain: ["customer_id"]
    });
    const after = await stat(schemaPath);
    const diskText = await readFile(schemaPath, "utf8");

    expect(preview.files.map((file) => file.filePath)).toEqual(["semantic-layer/mysql-aliyun/customers.yaml"]);
    expect(preview.files[0].proposedYaml).toContain("grain:");
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(diskText).toBe(schemaYaml);
  });
});
