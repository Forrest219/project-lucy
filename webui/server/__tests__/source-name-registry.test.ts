import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import {
  allocateSourceNames,
  findSourceNameConflicts,
  normalizeSourceRef,
  readConnectionSourceManifests,
  type ConnectionSourceRegistry,
  type SourceManifestEntry
} from "../source-name-registry";

vi.mock("yaml", async () => {
  const actual = await vi.importActual<typeof import("yaml")>("yaml");
  return { ...actual, parse: vi.fn(actual.parse) };
});

function emptyRegistry(connectionId = "hive-1"): ConnectionSourceRegistry {
  return { connectionId, manifests: [] };
}

function registryWith(
  connectionId: string,
  files: Array<{ schema: string; tables: Record<string, string> }>
): ConnectionSourceRegistry {
  return {
    connectionId,
    manifests: files.map((file) => ({
      schema: file.schema,
      targetPath: `${connectionId}/_schema/${file.schema}.yaml`,
      tables: Object.fromEntries(
        Object.entries(file.tables).map(([sourceName, physicalTable]) => [
          sourceName,
          { table: physicalTable }
        ])
      )
    }))
  };
}

describe("normalizeSourceRef", () => {
  it("matches ACL normalize: trim, strip quotes/backticks, lower", () => {
    expect(normalizeSourceRef("City")).toBe("city");
    expect(normalizeSourceRef("  city  ")).toBe("city");
    expect(normalizeSourceRef("`city`")).toBe("city");
    expect(normalizeSourceRef('"city"')).toBe("city");
    expect(normalizeSourceRef("'city'")).toBe("city");
  });
});

describe("allocateSourceNames", () => {
  it("keeps bare city when free; uses ods_city then ods_city_2 when reserved", () => {
    const free = allocateSourceNames("weather", ["city"], emptyRegistry());
    expect(free.get("city")).toBe("city");

    const reservedCity = allocateSourceNames(
      "ods",
      ["city"],
      registryWith("hive-1", [{ schema: "weather", tables: { city: "weather.city" } }])
    );
    expect(reservedCity.get("city")).toBe("ods_city");

    const reservedPrefixed = allocateSourceNames(
      "ods",
      ["city"],
      registryWith("hive-1", [
        { schema: "weather", tables: { city: "weather.city" } },
        { schema: "other", tables: { ods_city: "other.ods_city" } }
      ])
    );
    expect(reservedPrefixed.get("city")).toBe("ods_city_2");
  });

  it("treats City / `city` / \"city\" as the same reserved short name", () => {
    const reserved = allocateSourceNames(
      "ods",
      ["city"],
      registryWith("hive-1", [
        { schema: "weather", tables: { City: "weather.City" } },
        { schema: "aux", tables: { "`city`": "aux.city" } }
      ])
    );
    // City and `city` both normalize to city → bare taken; need schema prefix.
    expect(reserved.get("city")).toBe("ods_city");
  });

  it("does not reserve another Connection's city", () => {
    const result = allocateSourceNames(
      "ods",
      ["city"],
      registryWith("hive-1", [{ schema: "weather", tables: { city: "weather.city" } }])
    );
    // Same connection reserves — control that hive-2 does not:
    const otherConn = allocateSourceNames(
      "ods",
      ["city"],
      // Registry is scoped to the connection being scanned; foreign connection
      // manifests are never present in this registry.
      emptyRegistry("hive-2")
    );
    expect(result.get("city")).toBe("ods_city");
    expect(otherConn.get("city")).toBe("city");
  });

  it("rescan keeps target ods.city→ods_city even if bare city is freed", () => {
    const registry = registryWith("hive-1", [
      {
        schema: "ods",
        tables: { ods_city: "ods.city" }
      }
      // weather.city removed — bare city free again
    ]);
    const result = allocateSourceNames("ods", ["city"], registry);
    expect(result.get("city")).toBe("ods_city");
  });

  it("does not keep an invalid old mapping that conflicts with reserved", () => {
    const registry = registryWith("hive-1", [
      { schema: "weather", tables: { city: "weather.city" } },
      // Target still has bare city — conflicts with weather; must re-allocate.
      { schema: "ods", tables: { city: "ods.city" } }
    ]);
    const result = allocateSourceNames("ods", ["city"], registry);
    expect(result.get("city")).toBe("ods_city");
    expect(result.get("city")).not.toBe("city");
  });

  it("shuffled physical table input yields the same assignment", () => {
    const registry = registryWith("hive-1", [
      { schema: "weather", tables: { city: "weather.city", people: "weather.people" } }
    ]);
    const a = allocateSourceNames("ods", ["zebra", "city", "alpha"], registry);
    const b = allocateSourceNames("ods", ["alpha", "zebra", "city"], registry);
    expect(Object.fromEntries(a)).toEqual(Object.fromEntries(b));
    expect(a.get("city")).toBe("ods_city");
    expect(a.get("alpha")).toBe("alpha");
    expect(a.get("zebra")).toBe("zebra");
  });

  it("R1: reserves every valid old alias before allocating names for newly scanned tables", () => {
    const registry = registryWith("hive-1", [
      { schema: "weather", tables: { zebra: "weather.zebra" } },
      { schema: "ods", tables: { ods_zebra: "ods.zebra" } }
    ]);
    for (const input of [["zebra", "ods_zebra"], ["ods_zebra", "zebra"]]) {
      const result = allocateSourceNames("ods", input, registry);
      expect(result.get("zebra")).toBe("ods_zebra");
      expect(result.get("ods_zebra")).toBe("ods_ods_zebra");
    }
  });

  it("R2: preserves physical identifier case while comparing only source names case-insensitively", () => {
    const registry = registryWith("hive-1", [
      { schema: "weather", tables: { city: "weather.city" } },
      { schema: "ods", tables: { legacy_city: "ods.City" } }
    ]);
    const result = allocateSourceNames("ods", ["City", "city"], registry);
    expect(result.size).toBe(2);
    expect(result.get("City")).toBe("legacy_city");
    expect(result.get("city")).toBe("ods_city");
  });
});

describe("findSourceNameConflicts", () => {
  it("groups duplicate normalized source names across entries", () => {
    const entries: SourceManifestEntry[] = [
      {
        targetPath: "hive-1/_schema/weather.yaml",
        schema: "weather",
        physicalTable: "weather.city",
        sourceName: "city"
      },
      {
        targetPath: "hive-1/_schema/ods.yaml",
        schema: "ods",
        physicalTable: "ods.city",
        sourceName: "City"
      },
      {
        targetPath: "hive-1/_schema/ods.yaml",
        schema: "ods",
        physicalTable: "ods.people",
        sourceName: "people"
      }
    ];
    const conflicts = findSourceNameConflicts(entries);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.sourceName).toBe("city");
    expect(conflicts[0]?.entries).toHaveLength(2);
  });
});

describe("readConnectionSourceManifests", () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = undefined;
    vi.clearAllMocks();
  });

  async function projectWithManifests(
    connectionId: string,
    files: Array<{ schema: string; yaml: string }>
  ): Promise<string> {
    root = await mkdtemp(path.join(os.tmpdir(), "lucy-snr-"));
    const schemaDir = path.join(root, "config", "semantic-layer", connectionId, "_schema");
    await mkdir(schemaDir, { recursive: true });
    for (const file of files) {
      await writeFile(path.join(schemaDir, `${file.schema}.yaml`), file.yaml, "utf8");
    }
    return root;
  }

  it("loads connection-scoped manifests and supports candidate replace", async () => {
    const projectRoot = await projectWithManifests("hive-1", [
      {
        schema: "weather",
        yaml: "tables:\n  city:\n    table: weather.city\n"
      },
      {
        schema: "ods",
        yaml: "tables:\n  city:\n    table: ods.city\n"
      }
    ]);
    const registry = await readConnectionSourceManifests(projectRoot, "hive-1");
    expect(registry.manifests).toHaveLength(2);
    const weather = registry.manifests.find((m) => m.schema === "weather");
    expect(weather?.tables.city?.table).toBe("weather.city");

    const replaced = await readConnectionSourceManifests(projectRoot, "hive-1", {
      schema: "ods",
      content: "tables:\n  ods_city:\n    table: ods.city\n"
    });
    const ods = replaced.manifests.find((m) => m.schema === "ods");
    expect(ods?.tables.ods_city?.table).toBe("ods.city");
    expect(ods?.tables.city).toBeUndefined();
  });

  it("fails closed when an existing manifest cannot be parsed", async () => {
    const projectRoot = await projectWithManifests("hive-1", [
      { schema: "weather", yaml: "tables:\n  city:\n    table: weather.city\n" },
      { schema: "broken", yaml: "tables: [\n  not: valid yaml:::" }
    ]);
    await expect(readConnectionSourceManifests(projectRoot, "hive-1")).rejects.toThrow(
      /broken|parse|YAML|Manifest/i
    );
  });

  it("reuses an unchanged 1883-table parse while returning independently mutable snapshots", async () => {
    const tables = Object.fromEntries(Array.from({ length: 1883 }, (_, index) => [
      `reuse_${index}`, { table: `uat.physical_${index}`, columns: [{ name: "id", type: "number" }] }
    ]));
    const content = JSON.stringify({ tables, testMarker: "CA-05 unchanged 1883" });
    const projectRoot = await projectWithManifests("hive-1", [{ schema: "uat", yaml: content }]);
    const first = await readConnectionSourceManifests(projectRoot, "hive-1");
    first.manifests[0]!.tables.reuse_0!.table = "mutated.by.caller";
    delete first.manifests[0]!.tables.reuse_1;
    const second = await readConnectionSourceManifests(projectRoot, "hive-1");
    expect(second.manifests[0]!.tables.reuse_0!.table).toBe("uat.physical_0");
    expect(second.manifests[0]!.tables.reuse_1!.table).toBe("uat.physical_1");
    expect(Object.keys(second.manifests[0]!.tables)).toHaveLength(1883);
    expect(vi.mocked(parse).mock.calls.filter(([text]) => text === content)).toHaveLength(1);
  });

  it("keeps connection and target paths separate when exact contents match", async () => {
    const content = "# CA-05 cross-path\ntables:\n  shared:\n    table: uat.shared\n";
    const projectRoot = await projectWithManifests("hive-1", [{ schema: "first", yaml: content }]);
    const otherDir = path.join(projectRoot, "config/semantic-layer/hive-2/_schema");
    await mkdir(otherDir, { recursive: true });
    await writeFile(path.join(otherDir, "second.yaml"), content);
    const first = await readConnectionSourceManifests(projectRoot, "hive-1");
    const second = await readConnectionSourceManifests(projectRoot, "hive-2");
    expect(first.connectionId).toBe("hive-1");
    expect(first.manifests[0]!.targetPath).toBe("hive-1/_schema/first.yaml");
    expect(second.connectionId).toBe("hive-2");
    expect(second.manifests[0]!.targetPath).toBe("hive-2/_schema/second.yaml");
    expect(vi.mocked(parse).mock.calls.filter(([text]) => text === content)).toHaveLength(1);
  });

  it("rereads same-size content changes even when filesystem timestamps are restored", async () => {
    const oldContent = "# CA-05 same-size\ntables:\n  name:\n    table: uat.old\n";
    const newContent = oldContent.replace("uat.old", "uat.new");
    const projectRoot = await projectWithManifests("hive-1", [{ schema: "uat", yaml: oldContent }]);
    const file = path.join(projectRoot, "config/semantic-layer/hive-1/_schema/uat.yaml");
    const metadata = await stat(file);
    await readConnectionSourceManifests(projectRoot, "hive-1");
    await writeFile(file, newContent);
    await utimes(file, metadata.atime, metadata.mtime);
    const current = await readConnectionSourceManifests(projectRoot, "hive-1");
    expect(current.manifests[0]!.tables.name!.table).toBe("uat.new");
    expect(vi.mocked(parse).mock.calls.filter(([text]) => text === newContent)).toHaveLength(1);
  });

  it("does not let a previous successful parse hide a subsequent read failure", async () => {
    const content = "# CA-05 read failure\ntables:\n  source:\n    table: uat.source\n";
    const projectRoot = await projectWithManifests("hive-1", [{ schema: "uat", yaml: content }]);
    const file = path.join(projectRoot, "config/semantic-layer/hive-1/_schema/uat.yaml");
    await readConnectionSourceManifests(projectRoot, "hive-1");
    await rm(file);
    await mkdir(file);
    await expect(readConnectionSourceManifests(projectRoot, "hive-1")).rejects.toThrow(/读取|Manifest/);
  });

  it("rejects changed invalid contents and recovers only after valid bytes return", async () => {
    const content = "# CA-05 changed invalid\ntables:\n  source:\n    table: uat.source\n";
    const projectRoot = await projectWithManifests("hive-1", [{ schema: "uat", yaml: content }]);
    const file = path.join(projectRoot, "config/semantic-layer/hive-1/_schema/uat.yaml");
    await readConnectionSourceManifests(projectRoot, "hive-1");
    await writeFile(file, "tables: [ invalid yaml");
    await expect(readConnectionSourceManifests(projectRoot, "hive-1")).rejects.toThrow(/uat|解析|Manifest/);
    await writeFile(file, content);
    expect((await readConnectionSourceManifests(projectRoot, "hive-1")).manifests[0]!.tables.source!.table).toBe("uat.source");
  });

  it("evicts older parse results rather than retaining every distinct manifest", async () => {
    const first = "# CA-05 eviction first\ntables:\n  source:\n    table: uat.source\n";
    const projectRoot = await projectWithManifests("hive-1", [{ schema: "uat", yaml: first }]);
    const file = path.join(projectRoot, "config/semantic-layer/hive-1/_schema/uat.yaml");
    await readConnectionSourceManifests(projectRoot, "hive-1");
    for (let index = 0; index < 8; index += 1) {
      await writeFile(file, `# CA-05 eviction ${index}\ntables:\n  source:\n    table: uat.source_${index}\n`);
      await readConnectionSourceManifests(projectRoot, "hive-1");
    }
    await writeFile(file, first);
    expect((await readConnectionSourceManifests(projectRoot, "hive-1")).manifests[0]!.tables.source!.table).toBe("uat.source");
    expect(vi.mocked(parse).mock.calls.filter(([text]) => text === first)).toHaveLength(2);
  });

  it("accepts oversized valid manifests without retaining their parse results", async () => {
    const content = `# ${"x".repeat(1024 * 1024)}\ntables:\n  source:\n    table: uat.source\n`;
    const projectRoot = await projectWithManifests("hive-1", [{ schema: "uat", yaml: content }]);
    for (let index = 0; index < 2; index += 1) {
      expect((await readConnectionSourceManifests(projectRoot, "hive-1")).manifests[0]!.tables.source!.table).toBe("uat.source");
    }
    expect(vi.mocked(parse).mock.calls.filter(([text]) => text === content)).toHaveLength(2);
  });
});
