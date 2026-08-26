import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ConnectionDeleteSecretNotEligibleError,
  ConnectionIdInvalidError,
  ConnectionNotFoundError,
  KtxYamlParseError,
  removeConnection
} from "../project";

let tempRoot: string | undefined;

async function makeProject(yaml: string): Promise<string> {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-remove-connection-"));
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
    enabled_tables:
      - dataforai.superstore_orders
  keep-me:
    driver: mysql
    host: localhost
    port: 3306
    database: other
    username: sc
    password: inline-other
    schemas:
      - other
    enabled_tables: []
setup:
  database_connection_ids:
    - mysql-aliyun
    - keep-me
`;
}

describe("removeConnection — validation", () => {
  it("rejects illegal connection ids", async () => {
    const root = await makeProject(baseYaml());
    await expect(removeConnection(root, "Bad Id", true)).rejects.toBeInstanceOf(
      ConnectionIdInvalidError
    );
  });

  it("rejects unknown connections with CONNECTION_NOT_FOUND", async () => {
    const root = await makeProject(baseYaml());
    await expect(removeConnection(root, "does-not-exist", true)).rejects.toBeInstanceOf(
      ConnectionNotFoundError
    );
  });

  it("surfaces parse errors as KTX_YAML_PARSE_ERROR", async () => {
    const root = await makeProject("connections: { :: invalid\n");
    await expect(removeConnection(root, "mysql-aliyun", true)).rejects.toBeInstanceOf(
      KtxYamlParseError
    );
  });
});

describe("removeConnection — dryRun", () => {
  it("previews removing the connection key and setup id without writing", async () => {
    const root = await makeProject(baseYaml());
    const result = await removeConnection(root, "mysql-aliyun", true);
    expect(result.connectionId).toBe("mysql-aliyun");
    expect(result.schemas).toEqual(["dataforai"]);
    expect(result.enabledTables).toEqual(["dataforai.superstore_orders"]);
    expect(result.proposedYaml).not.toContain("mysql-aliyun:");
    expect(result.proposedYaml).toContain("keep-me:");
    expect(result.diff).toContain("mysql-aliyun");
    expect(result.impact.canDeleteSecret).toBe(false);
    expect(result.impact.secretRelPath).toBeNull();

    const yaml = await readFile(path.join(root, "ktx.yaml"), "utf8");
    expect(yaml).toContain("mysql-aliyun:");
    expect(yaml).toContain("- mysql-aliyun");
  });

  it("lists conventional secret, yaml assets, roles, and wiki refs", async () => {
    const root = await makeProject(`connections:
  mysql-aliyun:
    driver: mysql
    host: localhost
    port: 3306
    database: dataforai
    username: sc
    password: file:${path.join("/tmp", "will-be-replaced")}
    schemas:
      - dataforai
    enabled_tables:
      - dataforai.superstore_orders
`);
    const secretRel = ".ktx/secrets/mysql-aliyun-password";
    const secretAbs = path.join(root, secretRel);
    const patched = (await readFile(path.join(root, "ktx.yaml"), "utf8")).replace(
      /password: file:.*/,
      `password: file:${secretAbs}`
    );
    await writeFile(path.join(root, "ktx.yaml"), patched, "utf8");
    await mkdir(path.dirname(secretAbs), { recursive: true });
    await writeFile(secretAbs, "secret\n", "utf8");
    await mkdir(path.join(root, "semantic-layer", "mysql-aliyun", "_schema"), { recursive: true });
    await writeFile(
      path.join(root, "semantic-layer", "mysql-aliyun", "_schema", "dataforai.yaml"),
      "tables: {}\n",
      "utf8"
    );
    await writeFile(
      path.join(root, "semantic-layer", "mysql-aliyun", "superstore_orders.yaml"),
      "grain: []\n",
      "utf8"
    );
    await mkdir(path.join(root, "webui", "config"), { recursive: true });
    await writeFile(
      path.join(root, "webui", "config", "access.yaml"),
      `roles:
  finance_readonly:
    allow:
      connections:
        - mysql-aliyun
      tableSelectors:
        - connection: mysql-aliyun
          schema: dataforai
          names: [superstore_orders]
  unrelated:
    allow:
      connections:
        - keep-me
`,
      "utf8"
    );

    const result = await removeConnection(root, "mysql-aliyun", true, {
      listWikiFn: async () => [
        { key: "global/playbook.md", summary: "", tags: [], slRefs: ["mysql-aliyun/dataforai/superstore_orders"] },
        { key: "global/other.md", summary: "", tags: [], slRefs: ["keep-me/other/t"] }
      ]
    });

    expect(result.impact.canDeleteSecret).toBe(true);
    expect(result.impact.secretRelPath).toBe(secretRel);
    expect(result.impact.yamlAssetPaths).toEqual(
      expect.arrayContaining([
        "semantic-layer/mysql-aliyun/_schema/dataforai.yaml",
        "semantic-layer/mysql-aliyun/superstore_orders.yaml"
      ])
    );
    expect(result.impact.aclRoleIds).toEqual(["finance_readonly"]);
    expect(result.impact.wikiRefCount).toBe(1);
    expect(result.impact.wikiSamplePaths).toEqual(["wiki/global/playbook.md"]);
  });
});

describe("removeConnection — write", () => {
  it("removes the connection and setup id, leaving other connections", async () => {
    const root = await makeProject(baseYaml());
    const result = await removeConnection(root, "mysql-aliyun", false, {
      recordConfigChange: async (entry) => {
        expect(entry.changeType).toBe("connection_delete");
        expect(entry.targetId).toBe("mysql-aliyun");
        return 42;
      }
    });
    expect(result.written).toBe(true);
    expect(result.auditId).toBe(42);
    expect(result.deletedFiles).toEqual([]);

    const yaml = await readFile(path.join(root, "ktx.yaml"), "utf8");
    expect(yaml).not.toContain("mysql-aliyun:");
    expect(yaml).not.toMatch(/-\s*mysql-aliyun\b/);
    expect(yaml).toContain("keep-me:");
    expect(yaml).toContain("- keep-me");
  });

  it("does not delete inline secrets or yaml assets by default", async () => {
    const root = await makeProject(baseYaml());
    await mkdir(path.join(root, "semantic-layer", "mysql-aliyun"), { recursive: true });
    const overlay = path.join(root, "semantic-layer", "mysql-aliyun", "superstore_orders.yaml");
    await writeFile(overlay, "grain: []\n", "utf8");

    await removeConnection(root, "mysql-aliyun", false);
    await expect(readFile(overlay, "utf8")).resolves.toBe("grain: []\n");
  });

  it("deletes conventional secret and yaml assets when opted in", async () => {
    const root = await makeProject(`connections:
  mysql-aliyun:
    driver: mysql
    host: localhost
    port: 3306
    database: dataforai
    username: sc
    password: file:PLACEHOLDER
    schemas: []
    enabled_tables: []
`);
    const secretRel = ".ktx/secrets/mysql-aliyun-password";
    const secretAbs = path.join(root, secretRel);
    await writeFile(
      path.join(root, "ktx.yaml"),
      (await readFile(path.join(root, "ktx.yaml"), "utf8")).replace("file:PLACEHOLDER", `file:${secretAbs}`),
      "utf8"
    );
    await mkdir(path.dirname(secretAbs), { recursive: true });
    await writeFile(secretAbs, "secret\n", { encoding: "utf8", mode: 0o600 });
    await mkdir(path.join(root, "semantic-layer", "mysql-aliyun", "_schema"), { recursive: true });
    const manifest = path.join(root, "semantic-layer", "mysql-aliyun", "_schema", "dataforai.yaml");
    await writeFile(manifest, "tables: {}\n", "utf8");

    const result = await removeConnection(root, "mysql-aliyun", false, {
      deleteSecret: true,
      deleteAssets: true
    });
    expect(result.deletedFiles).toEqual(
      expect.arrayContaining([secretRel, "semantic-layer/mysql-aliyun/_schema/dataforai.yaml"])
    );
    await expect(readFile(secretAbs, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(manifest, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects deleteSecret when password is not the conventional file", async () => {
    const root = await makeProject(baseYaml());
    await expect(
      removeConnection(root, "mysql-aliyun", false, { deleteSecret: true })
    ).rejects.toBeInstanceOf(ConnectionDeleteSecretNotEligibleError);
    const yaml = await readFile(path.join(root, "ktx.yaml"), "utf8");
    expect(yaml).toContain("mysql-aliyun:");
  });

  it("does not rewrite access.yaml", async () => {
    const root = await makeProject(baseYaml());
    await mkdir(path.join(root, "webui", "config"), { recursive: true });
    const accessPath = path.join(root, "webui", "config", "access.yaml");
    const accessYaml = `roles:
  finance_readonly:
    allow:
      connections:
        - mysql-aliyun
`;
    await writeFile(accessPath, accessYaml, "utf8");
    await removeConnection(root, "mysql-aliyun", false);
    expect(await readFile(accessPath, "utf8")).toBe(accessYaml);
  });
});
