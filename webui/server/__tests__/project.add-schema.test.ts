import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addSchema,
  ConnectionNotFoundError,
  ConnectionTestFailedError,
  KtxYamlParseError,
  SchemaAlreadyExistsError,
  SchemaNameInvalidError,
  SCHEMA_NAME_PATTERN,
  writeKtxYaml
} from "../project";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const exampleYamlPath = path.join(repoRoot, "ktx.yaml.example");

let tempRoot: string | undefined;

async function makeProject(yaml: string): Promise<string> {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-add-schema-"));
  await writeFile(path.join(tempRoot, "ktx.yaml"), yaml, "utf8");
  return tempRoot;
}

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
  vi.restoreAllMocks();
});

describe("addSchema — validation", () => {
  it("rejects schema names that violate the pattern", async () => {
    const root = await makeProject(await readFile(exampleYamlPath, "utf8"));

    for (const bad of ["1abc", "-dash", "with space", "a".repeat(64), "schema!", ""]) {
      await expect(addSchema(root, "mysql-aliyun", bad, true)).rejects.toBeInstanceOf(
        SchemaNameInvalidError
      );
    }
  });

  it("rejects unknown connections with CONNECTION_NOT_FOUND", async () => {
    const root = await makeProject(await readFile(exampleYamlPath, "utf8"));

    await expect(addSchema(root, "does-not-exist", "demo", true)).rejects.toBeInstanceOf(
      ConnectionNotFoundError
    );
  });

  it("rejects duplicate schemas with SCHEMA_ALREADY_EXISTS", async () => {
    const root = await makeProject(await readFile(exampleYamlPath, "utf8"));

    await expect(addSchema(root, "mysql-aliyun", "dataforai", true)).rejects.toBeInstanceOf(
      SchemaAlreadyExistsError
    );
  });

  it("surfaces parse errors as KTX_YAML_PARSE_ERROR", async () => {
    const root = await makeProject("connections: { :: invalid\n");

    await expect(addSchema(root, "mysql-aliyun", "demo", true)).rejects.toBeInstanceOf(
      KtxYamlParseError
    );
  });
});

describe("addSchema — dryRun path", () => {
  it("returns a diff and proposed yaml without touching disk", async () => {
    const original = await readFile(exampleYamlPath, "utf8");
    const root = await makeProject(original);

    const result = await addSchema(root, "mysql-aliyun", "finance_mart", true);

    expect(result.diff).toContain("+      - finance_mart");
    expect(result.proposedYaml).toContain("- finance_mart");
    expect(result.oldSchemas).toEqual(["dataforai"]);
    expect(result.newSchemas).toEqual(["dataforai", "finance_mart"]);
    expect(result.proposedYaml).not.toMatch(/^\s*password:/m);
    expect(result.diff).not.toMatch(/^\s*[ +\-]?\s*password:/m);

    // Disk untouched
    await expect(readFile(path.join(root, "ktx.yaml"), "utf8")).resolves.toBe(original);
  });

  it("creates a `schemas` key when the connection has none yet", async () => {
    const root = await makeProject(`
connections:
  scratch-conn:
    driver: mysql
    host: localhost
    port: 3306
    database: scratch
    username: sc
    password: file:/tmp/x
`);

    const result = await addSchema(root, "scratch-conn", "alpha", true);
    expect(result.newSchemas).toEqual(["alpha"]);
    expect(result.proposedYaml).toContain("schemas:");
    expect(result.proposedYaml).toContain("- alpha");
  });
});

describe("addSchema — write path", () => {
  it("runs the connection test, persists ktx.yaml, and records an audit entry", async () => {
    const original = await readFile(exampleYamlPath, "utf8");
    const root = await makeProject(original);

    const auditCalls: unknown[] = [];
    const fakeTest = vi.fn(async () => ({
      status: "ok" as const,
      latencyMs: 5,
      detail: "ok"
    }));

    const result = await addSchema(root, "mysql-aliyun", "finance_mart", false, {
      testConnectionFn: fakeTest,
      recordConfigChange: async (input) => {
        auditCalls.push(input);
        return 42;
      }
    });

    expect(fakeTest).toHaveBeenCalledWith(root, "mysql-aliyun", execFile);
    if (!("written" in result)) throw new Error("expected AddSchemaResult");
    expect(result.written).toBe(true);
    expect(result.auditId).toBe(42);
    expect(result.oldSchemas).toEqual(["dataforai"]);
    expect(result.newSchemas).toEqual(["dataforai", "finance_mart"]);

    const persisted = await readFile(path.join(root, "ktx.yaml"), "utf8");
    expect(persisted).toContain("- finance_mart");

    expect(auditCalls).toHaveLength(1);
    const entry = auditCalls[0] as Record<string, unknown>;
    expect(entry.filePath).toBe("ktx.yaml");
    expect(entry.changeType).toBe("schema_add");
    expect(entry.targetId).toBe("mysql-aliyun:finance_mart");
  });

  it("fails with CONNECTION_TEST_FAILED before touching ktx.yaml when the test reports error", async () => {
    const original = await readFile(exampleYamlPath, "utf8");
    const root = await makeProject(original);

    const fakeTest = vi.fn(async () => ({
      status: "error" as const,
      reason: "auth failed for user 'sc'"
    }));

    await expect(
      addSchema(root, "mysql-aliyun", "finance_mart", false, {
        testConnectionFn: fakeTest,
        recordConfigChange: async () => 1
      })
    ).rejects.toBeInstanceOf(ConnectionTestFailedError);

    // Disk still untouched
    await expect(readFile(path.join(root, "ktx.yaml"), "utf8")).resolves.toBe(original);
  });
});

describe("writeKtxYaml — ktx.yaml ALLOW_FILES channel", () => {
  it("writes through the safe channel so the on-disk file matches the document", async () => {
    const original = await readFile(exampleYamlPath, "utf8");
    const root = await makeProject(original);

    await writeKtxYaml(root, () => undefined);

    const after = await readFile(path.join(root, "ktx.yaml"), "utf8");
    expect(after).toBe(original);
  });
});

describe("SCHEMA_NAME_PATTERN", () => {
  it("matches valid identifier-shaped strings up to 63 chars", () => {
    const re = new RegExp(SCHEMA_NAME_PATTERN);
    expect(re.test("dataforai")).toBe(true);
    expect(re.test("_internal")).toBe(true);
    expect(re.test("a")).toBe(true);
    expect(re.test("a".repeat(63))).toBe(true);
  });
});
