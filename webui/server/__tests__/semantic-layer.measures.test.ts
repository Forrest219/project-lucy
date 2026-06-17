import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseDocument } from "yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyOverlayUpdate, serializeOverlay } from "../overlay";
import { applyPatch, previewSourcePatch, serialize } from "../semantic-layer";

let projectRoot: string;

const schemaYaml = `tables:
  accrual_demo:
    table: yihe_poc_demo.accrual_demo
    columns:
      - name: amount
        type: number
`;

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "ktx-webui-measures-"));
  await mkdir(path.join(projectRoot, "semantic-layer", "mysql-aliyun", "_schema"), { recursive: true });
  await writeFile(path.join(projectRoot, "semantic-layer", "mysql-aliyun", "_schema", "yihe_poc_demo.yaml"), schemaYaml, "utf8");
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

describe("measures and segments overlay", () => {
  it("spike: yaml Document API adds nested measures and segments", () => {
    const doc = parseDocument("name: accrual_demo\n# keep this comment\ngrain:\n  - amount\n");
    applyOverlayUpdate(doc, "accrual_demo", {
      measures: [{ name: "total_amount", expr: "sum(amount)", description: "Total amount" }],
      segments: [{ name: "positive_amount", expr: "amount > 0" }]
    });
    const yaml = serializeOverlay(doc);

    expect(yaml).toContain("# keep this comment");
    expect(yaml).toContain("measures:");
    expect(yaml).toContain("expr: sum(amount)");
    expect(yaml).toContain("segments:");
  });

  it("previews measures and segments in overlay, not schema YAML", async () => {
    const preview = await previewSourcePatch(projectRoot, "mysql-aliyun", "yihe_poc_demo", "accrual_demo", {
      measures: [{ name: "total_amount", expr: "sum(amount)", description: "Total amount" }],
      segments: [{ name: "positive_amount", expr: "amount > 0" }]
    });

    expect(preview.files.map((file) => file.filePath)).toEqual(["semantic-layer/mysql-aliyun/accrual_demo.yaml"]);
    const overlay = preview.files.find((file) => file.filePath === "semantic-layer/mysql-aliyun/accrual_demo.yaml");
    expect(overlay?.proposedYaml).toContain("measures:");
    expect(overlay?.proposedYaml).toContain("segments:");
    await expect(readFile(path.join(projectRoot, "semantic-layer", "mysql-aliyun", "_schema", "yihe_poc_demo.yaml"), "utf8")).resolves.toBe(schemaYaml);
  });
});

describe("formal join patching", () => {
  it("writes only formal joins and keeps the on key double quoted", () => {
    const doc = parseDocument(schemaYaml);
    applyPatch(doc, "accrual_demo", {
      joins: [
        {
          to: "dim_date",
          on: "accrual_demo.date = dim_date.date",
          relationship: "many_to_one",
          source: "formal"
        },
        {
          to: "candidate_only",
          on: "accrual_demo.id = candidate_only.id",
          relationship: "many_to_one",
          source: "candidate"
        }
      ]
    });
    const yaml = serialize(doc);

    expect(yaml).toContain('"on": accrual_demo.date = dim_date.date');
    expect(yaml).toContain("source: formal");
    expect(yaml).not.toContain("candidate_only");
  });
});
