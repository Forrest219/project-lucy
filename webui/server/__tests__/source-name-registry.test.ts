import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  allocateSourceNames,
  findSourceNameConflicts,
  normalizeSourceRef,
  readConnectionSourceManifests,
  type ConnectionSourceRegistry,
  type SourceManifestEntry
} from "../source-name-registry";

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
});
