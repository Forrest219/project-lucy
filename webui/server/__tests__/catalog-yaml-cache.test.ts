import { mkdtemp, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readCatalogYaml } from "../catalog-yaml-cache.js";
import { readEntryPerfCounters, resetEntryPerfCounters } from "../entry-performance-timing.js";

let root: string;
let file: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "lucy-catalog-yaml-"));
  file = path.join(root, "catalog.yaml");
  resetEntryPerfCounters();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("catalog file revision cache", () => {
  it("coalesces parallel readers and shares deeply frozen facts for the same revision", async () => {
    await writeFile(file, "tables:\n  orders:\n    columns: [{ name: id }]\n");
    const copies = await Promise.all(Array.from({ length: 20 }, () => readCatalogYaml(file)));
    const first = copies[0] as { tables: { orders: { columns: Array<{ name: string }> } } };
    expect(copies.every((value) => value === first)).toBe(true);
    expect(Object.isFrozen(first.tables.orders.columns[0])).toBe(true);
    expect(() => { first.tables.orders.columns[0].name = "wrong"; }).toThrow(TypeError);
    expect(await readCatalogYaml(file)).toBe(first);
    expect(readEntryPerfCounters().catalogYamlParses).toBe(1);
  });

  it("refreshes same-size replacements even with the same mtime and exposes errors until recovery", async () => {
    await writeFile(file, "table: old\n");
    const original = await stat(file);
    expect(await readCatalogYaml(file)).toEqual({ table: "old" });
    const replacement = path.join(root, "replacement.yaml");
    await writeFile(replacement, "table: new\n");
    await utimes(replacement, original.atime, original.mtime);
    await rename(replacement, file);
    expect(await readCatalogYaml(file)).toEqual({ table: "new" });
    await writeFile(file, "table: [");
    await expect(readCatalogYaml(file)).rejects.toThrow();
    await rm(file);
    await expect(readCatalogYaml(file)).rejects.toMatchObject({ code: "ENOENT" });
    await writeFile(file, "table: recovered\n");
    expect(await readCatalogYaml(file)).toEqual({ table: "recovered" });
  });

  it("retains YAML 1.1 value types with independent mutable values", async () => {
    await writeFile(file, "%YAML 1.1\n---\nstamp: 2026-11-23\n");
    const [left, right] = await Promise.all([readCatalogYaml(file), readCatalogYaml(file)]) as [{ stamp: Date }, { stamp: Date }];
    expect(left.stamp).toBeInstanceOf(Date);
    left.stamp.setUTCFullYear(1990);
    expect(right.stamp.getUTCFullYear()).toBe(2026);
    expect(await readCatalogYaml(file, { json: true })).toEqual({ stamp: "2026-11-23T00:00:00.000Z" });
  });
});
