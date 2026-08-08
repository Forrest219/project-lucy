import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  removeSchema,
  SchemaNameInvalidError,
  SchemaNotFoundError,
  ConnectionNotFoundError,
  KtxYamlParseError,
  SCHEMA_NAME_PATTERN
} from "../project";

let tempRoot: string | undefined;

async function makeProject(yaml: string): Promise<string> {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-remove-schema-"));
  await writeFile(path.join(tempRoot, "ktx.yaml"), yaml, "utf8");
  return tempRoot;
}

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

function baseYaml(): string {
  return `connections:
  mysql-aliyun:
    driver: mysql
    host: localhost
    port: 3306
    database: dataforai
    username: sc
    password: inline-secret
    schemas:
      - dataforai
      - finance_mart
    enabled_tables:
      - dataforai.superstore_orders
      - dataforai.customers
      - finance_mart.sales
`;
}

describe("removeSchema — validation", () => {
  it("rejects schema names that violate the pattern", async () => {
    const root = await makeProject(baseYaml());
    for (const bad of ["1abc", "-dash", "with space", "a".repeat(64), ""]) {
      await expect(removeSchema(root, "mysql-aliyun", bad, true)).rejects.toBeInstanceOf(
        SchemaNameInvalidError
      );
    }
  });

  it("rejects unknown connections with CONNECTION_NOT_FOUND", async () => {
    const root = await makeProject(baseYaml());
    await expect(removeSchema(root, "does-not-exist", "dataforai", true)).rejects.toBeInstanceOf(
      ConnectionNotFoundError
    );
  });

  it("rejects unknown schemas with SCHEMA_NOT_FOUND", async () => {
    const root = await makeProject(baseYaml());
    await expect(removeSchema(root, "mysql-aliyun", "no_such_schema", true)).rejects.toBeInstanceOf(
      SchemaNotFoundError
    );
  });

  it("surfaces parse errors as KTX_YAML_PARSE_ERROR", async () => {
    const root = await makeProject("connections: { :: invalid\n");
    await expect(removeSchema(root, "mysql-aliyun", "dataforai", true)).rejects.toBeInstanceOf(
      KtxYamlParseError
    );
  });
});

describe("removeSchema — dryRun: schema in schemas list", () => {
  it("returns diff/proposedYaml without touching disk", async () => {
    const original = baseYaml();
    const root = await makeProject(original);

    const result = await removeSchema(root, "mysql-aliyun", "finance_mart", true);

    expect(result.diff).toContain("finance_mart");
    expect(result.oldSchemas).toContain("finance_mart");
    expect(result.newSchemas).not.toContain("finance_mart");
    expect(result.removedEnabledTables).toEqual(["finance_mart.sales"]);
    expect(result.proposedYaml).not.toMatch(/^\s*password:/m);
    expect(result.diff).not.toMatch(/^\s*[ +\-]?\s*password:/m);

    // Disk untouched.
    await expect(readFile(path.join(root, "ktx.yaml"), "utf8")).resolves.toBe(original);
  });

  it("removedEnabledTables is empty when no enabled_tables match the schema prefix", async () => {
    const yaml = `connections:
  mysql-aliyun:
    driver: mysql
    host: localhost
    schemas:
      - finance_mart
    enabled_tables:
      - dataforai.orders
`;
    const root = await makeProject(yaml);
    const result = await removeSchema(root, "mysql-aliyun", "finance_mart", true);
    expect(result.removedEnabledTables).toEqual([]);
  });

  it("finds schema in enabled_tables prefix even if not in schemas list", async () => {
    const yaml = `connections:
  mysql-aliyun:
    driver: mysql
    host: localhost
    enabled_tables:
      - orphan_schema.table1
      - orphan_schema.table2
`;
    const root = await makeProject(yaml);
    const result = await removeSchema(root, "mysql-aliyun", "orphan_schema", true);
    expect(result.removedEnabledTables).toEqual(["orphan_schema.table1", "orphan_schema.table2"]);
    expect(result.oldSchemas).toEqual([]);
    expect(result.newSchemas).toEqual([]);
  });
});

describe("removeSchema — write: schemas + enabled_tables cleared", () => {
  it("removes schema from schemas list and prunes matching enabled_tables", async () => {
    const original = baseYaml();
    const root = await makeProject(original);

    const auditCalls: unknown[] = [];
    const result = await removeSchema(root, "mysql-aliyun", "dataforai", false, {
      recordConfigChange: async (input) => {
        auditCalls.push(input);
        return 99;
      }
    });

    if (!("written" in result)) throw new Error("expected RemoveSchemaResult");
    expect(result.written).toBe(true);
    expect(result.auditId).toBe(99);
    expect(result.oldSchemas).toContain("dataforai");
    expect(result.newSchemas).not.toContain("dataforai");
    expect(result.removedEnabledTables).toEqual(["dataforai.superstore_orders", "dataforai.customers"]);
    expect(result.deletedFiles).toEqual([]);

    const persisted = await readFile(path.join(root, "ktx.yaml"), "utf8");
    expect(persisted).not.toContain("- dataforai");
    expect(persisted).not.toContain("dataforai.superstore_orders");
    expect(persisted).not.toContain("dataforai.customers");
    // finance_mart items untouched.
    expect(persisted).toContain("finance_mart");
    expect(persisted).toContain("finance_mart.sales");

    expect(auditCalls).toHaveLength(1);
    const entry = auditCalls[0] as Record<string, unknown>;
    expect(entry.changeType).toBe("schema_remove");
    expect(entry.targetId).toBe("mysql-aliyun:dataforai");
  });

  it("dryRun:false does not touch disk when no options passed", async () => {
    const root = await makeProject(baseYaml());
    await removeSchema(root, "mysql-aliyun", "finance_mart", false);
    const persisted = await readFile(path.join(root, "ktx.yaml"), "utf8");
    expect(persisted).not.toContain("- finance_mart");
    expect(persisted).not.toContain("finance_mart.sales");
  });

  it("deletes manifest file when deleteManifest:true and file exists", async () => {
    const root = await makeProject(baseYaml());
    const manifestDir = path.join(root, "semantic-layer", "mysql-aliyun", "_schema");
    await mkdir(manifestDir, { recursive: true });
    const manifestPath = path.join(manifestDir, "finance_mart.yaml");
    await writeFile(manifestPath, "tables:\n  sales: {}\n", "utf8");

    const result = await removeSchema(root, "mysql-aliyun", "finance_mart", false, {
      deleteManifest: true
    });
    if (!("written" in result)) throw new Error("expected RemoveSchemaResult");
    expect(result.deletedFiles).toContain("semantic-layer/mysql-aliyun/_schema/finance_mart.yaml");

    // File should be gone.
    await expect(readFile(manifestPath, "utf8")).rejects.toThrow();
  });

  it("skips deleteManifest when file does not exist (no error)", async () => {
    const root = await makeProject(baseYaml());
    const result = await removeSchema(root, "mysql-aliyun", "finance_mart", false, {
      deleteManifest: true
    });
    if (!("written" in result)) throw new Error("expected RemoveSchemaResult");
    expect(result.deletedFiles).toEqual([]);
  });

  it("deletes overlay files when deleteOverlays:true", async () => {
    const root = await makeProject(baseYaml());
    const overlayDir = path.join(root, "semantic-layer", "mysql-aliyun");
    await mkdir(overlayDir, { recursive: true });
    await writeFile(path.join(overlayDir, "sales.yaml"), "# overlay\n", "utf8");

    const manifestDir = path.join(overlayDir, "_schema");
    await mkdir(manifestDir, { recursive: true });
    await writeFile(path.join(manifestDir, "finance_mart.yaml"), "tables:\n  sales: {}\n", "utf8");

    const result = await removeSchema(root, "mysql-aliyun", "finance_mart", false, {
      deleteOverlays: true
    });
    if (!("written" in result)) throw new Error("expected RemoveSchemaResult");
    expect(result.deletedFiles).toContain("semantic-layer/mysql-aliyun/sales.yaml");
  });

  it("skips unsafe table path segments so overlay delete cannot traverse to ktx.yaml", async () => {
    const yaml = `
connections:
  mysql-aliyun:
    driver: mysql
    host: localhost
    schemas:
      - finance_mart
    enabled_tables:
      - finance_mart.sales
      - finance_mart.../../ktx
`;
    const root = await makeProject(yaml);
    await writeFile(path.join(root, "ktx.yaml.marker"), "keep\n", "utf8");
    // Place a decoy at project root that traversal would hit if unsanitized.
    const originalKtx = await readFile(path.join(root, "ktx.yaml"), "utf8");

    const manifestDir = path.join(root, "semantic-layer", "mysql-aliyun", "_schema");
    await mkdir(manifestDir, { recursive: true });
    await writeFile(
      path.join(manifestDir, "finance_mart.yaml"),
      'tables:\n  "../../ktx": {}\n  sales: {}\n',
      "utf8"
    );
    await mkdir(path.join(root, "semantic-layer", "mysql-aliyun"), { recursive: true });
    await writeFile(path.join(root, "semantic-layer", "mysql-aliyun", "sales.yaml"), "# ok\n", "utf8");

    const preview = await removeSchema(root, "mysql-aliyun", "finance_mart", true);
    expect(preview.impact.overlayPaths).toEqual(["semantic-layer/mysql-aliyun/sales.yaml"]);
    expect(preview.impact.overlayPaths.every((p) => !p.includes(".."))).toBe(true);

    const result = await removeSchema(root, "mysql-aliyun", "finance_mart", false, {
      deleteOverlays: true
    });
    if (!("written" in result)) throw new Error("expected RemoveSchemaResult");
    expect(result.deletedFiles).toEqual(["semantic-layer/mysql-aliyun/sales.yaml"]);
    // ktx.yaml still present (rewritten by remove, but not deleted as an overlay target).
    await expect(readFile(path.join(root, "ktx.yaml"), "utf8")).resolves.toBeTruthy();
    expect(await readFile(path.join(root, "ktx.yaml"), "utf8")).not.toBe(originalKtx);
  });
});

describe("removeSchema — impact collection", () => {
  it("hasManifest:true when manifest file exists", async () => {
    const root = await makeProject(baseYaml());
    const manifestDir = path.join(root, "semantic-layer", "mysql-aliyun", "_schema");
    await mkdir(manifestDir, { recursive: true });
    await writeFile(path.join(manifestDir, "finance_mart.yaml"), "tables:\n  sales: {}\n", "utf8");

    const result = await removeSchema(root, "mysql-aliyun", "finance_mart", true);
    expect(result.impact.hasManifest).toBe(true);
    expect(result.impact.manifestPath).toBe("semantic-layer/mysql-aliyun/_schema/finance_mart.yaml");
  });

  it("hasManifest:false when manifest file absent", async () => {
    const root = await makeProject(baseYaml());
    const result = await removeSchema(root, "mysql-aliyun", "finance_mart", true);
    expect(result.impact.hasManifest).toBe(false);
    expect(result.impact.manifestPath).toBeNull();
  });

  it("wiki ref count via listWikiFn stub", async () => {
    const root = await makeProject(baseYaml());

    const fakeWiki = async () => [
      { key: "global/page1.md", summary: "", tags: [], slRefs: ["mysql-aliyun/finance_mart/sales_fact"] },
      { key: "global/page2.md", summary: "", tags: [], slRefs: ["mysql-aliyun/finance_mart/users"] },
      { key: "global/page3.md", summary: "", tags: [], slRefs: ["mysql-aliyun/other_schema/some_table"] }
    ];

    const result = await removeSchema(root, "mysql-aliyun", "finance_mart", true, {
      listWikiFn: fakeWiki
    });
    expect(result.impact.wikiRefCount).toBe(2);
    expect(result.impact.wikiSamplePaths).toEqual(["wiki/global/page1.md", "wiki/global/page2.md"]);
  });
});

describe("SCHEMA_NAME_PATTERN reuse", () => {
  it("is the same pattern as addSchema uses", () => {
    const re = new RegExp(SCHEMA_NAME_PATTERN);
    expect(re.test("finance_mart")).toBe(true);
    expect(re.test("_internal")).toBe(true);
    expect(re.test("1bad")).toBe(false);
  });
});
