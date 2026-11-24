import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadSourceFieldCatalog, resetRowPolicyCatalogCacheForTests } from "../proxy/row-policy-catalog";

/** P1-75 增量 A：字段目录读缓存；文件变化必须失效。 */
const schemaYaml = (cols: string[]) =>
  `tables:\n  orders:\n    table: db.orders\n    columns:\n${cols.map((c) => `      - name: ${c}\n`).join("")}`;

let root = "";
let prevRoot: string | undefined;
let prevContent: string | undefined;

beforeEach(async () => {
  prevRoot = process.env.KTX_PROJECT_ROOT;
  prevContent = process.env.LUCY_CONTENT_ROOT;
  root = await mkdtemp(path.join(os.tmpdir(), "lucy-catalog-cache-"));
  await mkdir(path.join(root, "semantic-layer", "conn", "_schema"), { recursive: true });
  await writeFile(path.join(root, "ktx.yaml"), "connections: {}\n", "utf8");
  process.env.KTX_PROJECT_ROOT = root;
  process.env.LUCY_CONTENT_ROOT = ".";
  resetRowPolicyCatalogCacheForTests();
});

afterEach(async () => {
  if (prevRoot === undefined) delete process.env.KTX_PROJECT_ROOT; else process.env.KTX_PROJECT_ROOT = prevRoot;
  if (prevContent === undefined) delete process.env.LUCY_CONTENT_ROOT; else process.env.LUCY_CONTENT_ROOT = prevContent;
  await rm(root, { recursive: true, force: true });
  resetRowPolicyCatalogCacheForTests();
});

describe("row-policy field catalog cache", () => {
  it("命中时复用同一结果；Manifest 或 overlay 变化后重建", async () => {
    const manifest = path.join(root, "semantic-layer", "conn", "_schema", "db.yaml");
    await writeFile(manifest, schemaYaml(["a"]), "utf8");

    const first = await loadSourceFieldCatalog("conn", "orders", "db");
    const second = await loadSourceFieldCatalog("conn", "orders", "db");
    expect(second).toBe(first);
    expect([...first!.columns]).toEqual(["a"]);

    await writeFile(manifest, schemaYaml(["a", "b"]), "utf8");
    const future = new Date(Date.now() + 5000);
    await utimes(manifest, future, future);
    const third = await loadSourceFieldCatalog("conn", "orders", "db");
    expect([...third!.columns].sort()).toEqual(["a", "b"]);

    await writeFile(path.join(root, "semantic-layer", "conn", "orders.yaml"), "columns:\n  - name: a\n", "utf8");
    const fourth = await loadSourceFieldCatalog("conn", "orders", "db");
    expect(fourth).not.toBe(third);
  });
});
