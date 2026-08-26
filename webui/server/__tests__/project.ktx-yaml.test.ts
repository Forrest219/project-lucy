import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { ktxYamlWithBlockConnections, writeKtxYaml } from "../project";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const exampleYamlPath = path.join(repoRoot, "ktx.yaml.example");

let tempRoot: string | undefined;

async function makeTempProject(yaml: string): Promise<string> {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-ktx-yaml-"));
  await writeFile(path.join(tempRoot, "ktx.yaml"), yaml, "utf8");
  return tempRoot;
}

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

describe("writeKtxYaml round-trip", () => {
  it("serializes the unmodified example back to byte-identical text", async () => {
    const original = await readFile(exampleYamlPath, "utf8");
    const root = await makeTempProject(original);

    const result = await writeKtxYaml(root, () => undefined, { dryRun: true });

    expect(result.serialized).toBe(original);
    expect(result.oldText).toBe(original);
    // dryRun must not touch disk
    await expect(readFile(path.join(root, "ktx.yaml"), "utf8")).resolves.toBe(original);
  });

  it("appends a schema and leaves the rest of the document structurally intact", async () => {
    const original = await readFile(exampleYamlPath, "utf8");
    const root = await makeTempProject(original);

    const before = await writeKtxYaml(root, () => undefined, { dryRun: true });

    const after = await writeKtxYaml(root, (doc) => {
      const conns = doc.get("connections", true);
      if (!conns || !("items" in conns)) return;
      const mysql = conns.get("mysql-aliyun", true);
      if (!mysql || !("items" in mysql)) return;
      const schemas = mysql.get("schemas", true);
      if (!schemas || !("items" in schemas)) return;
      schemas.items.push("finance_mart");
    }, { dryRun: true });

    // Only `connections.mysql-aliyun.schemas` changes; every other fragment
    // observed via doc.get(...) must serialize identically.
    const watchedPaths = [
      ["llm"],
      ["storage"],
      ["scan"],
      ["ingest"],
      ["agent"],
      ["setup"],
      ["connections", "mysql-aliyun", "host"],
      ["connections", "mysql-aliyun", "port"],
      ["connections", "mysql-aliyun", "database"],
      ["connections", "mysql-aliyun", "username"],
      ["connections", "mysql-aliyun", "password"],
      ["connections", "mysql-aliyun", "driver"],
      ["connections", "mysql-aliyun", "wire_protocol"],
      ["connections", "mysql-aliyun", "readonly"],
      ["connections", "mysql-aliyun", "r1_target"],
      ["connections", "mysql-aliyun", "enabled_tables"],
      ["connections", "doris-r1"],
      ["connections", "starrocks-r1"]
    ] as const;

    for (const pathParts of watchedPaths) {
      expect(JSON.stringify(after.doc.getIn([...pathParts], false))).toBe(
        JSON.stringify(before.doc.getIn([...pathParts], false))
      );
    }

    // The serialized output must contain the new schema line and grow by exactly one bullet.
    expect(after.serialized).toContain("- finance_mart");
    expect(after.serialized.split("\n").length - before.serialized.split("\n").length).toBe(1);
  });

  it("only writes to disk when dryRun is omitted (i.e. false)", async () => {
    const original = await readFile(exampleYamlPath, "utf8");
    const root = await makeTempProject(original);

    await writeKtxYaml(root, (doc) => {
      const conns = doc.get("connections", true);
      if (!conns || !("items" in conns)) return;
      const mysql = conns.get("mysql-aliyun", true);
      if (!mysql || !("items" in mysql)) return;
      const schemas = mysql.get("schemas", true);
      if (!schemas || !("items" in schemas)) return;
      schemas.items.push("schema_onboard_test");
    });

    const after = await readFile(path.join(root, "ktx.yaml"), "utf8");
    expect(after).toContain("- schema_onboard_test");
    expect(after).not.toBe(original);
  });

  it("refuses to parse a malformed ktx.yaml", async () => {
    const root = await makeTempProject("connections: { :: invalid\n");

    await expect(
      writeKtxYaml(root, () => undefined, { dryRun: true })
    ).rejects.toMatchObject({ code: "KTX_YAML_PARSE_ERROR" });
  });

  it("rewrites flow connection mappings to block style", () => {
    const flow = `connections:
  {
    demo-mysql:
      {
        driver: mysql,
        enabled_tables: []
      }
  }
`;
    const rewritten = ktxYamlWithBlockConnections(flow);
    expect(rewritten).toContain("  demo-mysql:\n    driver: mysql");
    expect(rewritten).not.toMatch(/connections:\s*\n\s*\{/);
    expect(rewritten).toContain("enabled_tables: []");
  });

  it("keeps already-block ktx.yaml byte-identical", async () => {
    const original = await readFile(exampleYamlPath, "utf8");
    expect(ktxYamlWithBlockConnections(original)).toBe(original);
  });
});