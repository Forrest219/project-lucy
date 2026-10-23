import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ConnectionDeleteSecretNotEligibleError,
  ConnectionIdInvalidError,
  ConnectionNotFoundError,
  ConnectionReferencesRemainError,
  KtxYamlParseError,
  removeConnection
} from "../project";
import { invalidateContentPathsCache } from "../paths";

let tempRoot: string | undefined;
let previousRoot: string | undefined;
let previousContentRoot: string | undefined;

async function makeProject(yaml: string): Promise<string> {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-remove-connection-"));
  await writeFile(path.join(tempRoot, "ktx.yaml"), yaml, "utf8");
  process.env.KTX_PROJECT_ROOT = tempRoot;
  process.env.LUCY_CONTENT_ROOT = ".";
  invalidateContentPathsCache();
  return tempRoot;
}

beforeEach(() => {
  previousRoot = process.env.KTX_PROJECT_ROOT;
  previousContentRoot = process.env.LUCY_CONTENT_ROOT;
});

afterEach(async () => {
  invalidateContentPathsCache();
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  if (previousContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = previousContentRoot;
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

  it("rejects the write when a semantic asset still exists and deleteAssets is unset", async () => {
    const root = await makeProject(baseYaml());
    await mkdir(path.join(root, "semantic-layer", "mysql-aliyun"), { recursive: true });
    const overlay = path.join(root, "semantic-layer", "mysql-aliyun", "superstore_orders.yaml");
    await writeFile(overlay, "grain: []\n", "utf8");

    // Spec 179: semantic_asset is the only kind that deleteAssets can override.
    // With it unset, the confirmation is rejected before ktx.yaml touches disk
    // and the asset on disk is left intact.
    const rejected = removeConnection(root, "mysql-aliyun", false);
    await expect(rejected).rejects.toBeInstanceOf(ConnectionReferencesRemainError);
    await expect(rejected).rejects.toMatchObject({
      code: "connection_references_remain",
      message: "无法删除连接 mysql-aliyun。本地语义文件可勾选「同时删除本地 YAML 资产」后一并删除。",
      detail: {
        blockers: [
          { kind: "semantic_asset", id: "semantic-layer/mysql-aliyun/superstore_orders.yaml" }
        ]
      }
    });
    await expect(readFile(overlay, "utf8")).resolves.toBe("grain: []\n");
    const yaml = await readFile(path.join(root, "ktx.yaml"), "utf8");
    expect(yaml).toContain("mysql-aliyun:");
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

  it("does not rewrite access.yaml when the connection is cleanly removed", async () => {
    const root = await makeProject(baseYaml());
    await mkdir(path.join(root, "webui", "config"), { recursive: true });
    const accessPath = path.join(root, "webui", "config", "access.yaml");
    // The role below references *another* connection so it does not act as a
    // blocker for `mysql-aliyun`; this isolates the "access.yaml is untouched"
    // contract from the reference guard introduced by Spec 179.
    const accessYaml = `roles:
  finance_readonly:
    allow:
      connections:
        - keep-me
`;
    await writeFile(accessPath, accessYaml, "utf8");
    await removeConnection(root, "mysql-aliyun", false);
    expect(await readFile(accessPath, "utf8")).toBe(accessYaml);
  });
});

describe("removeConnection — Spec 179 reference guard", () => {
  it("blocks confirmation when a role selector still points at the connection", async () => {
    const root = await makeProject(baseYaml());
    // No semantic-layer/<connId>/ directory: the guard must still fire.
    await mkdir(path.join(root, "webui", "config"), { recursive: true });
    await writeFile(
      path.join(root, "webui", "config", "access.yaml"),
      `roles:
  finance_readonly:
    allow:
      tableSelectors:
        - connection: mysql-aliyun
          schema: dataforai
          names: [superstore_orders]
users:
  - id: demo_agent
    name: Demo Agent
    enabled: true
    tokens: []
    role: finance_readonly
`,
      "utf8"
    );

    const preview = await removeConnection(root, "mysql-aliyun", true);
    expect(preview.blocked).toBe(true);
    expect(preview.impact.blocked).toBe(true);
    expect(preview.impact.blockers).toEqual([
      { kind: "role_selector", id: "finance_readonly" },
      { kind: "identity", id: "demo_agent" }
    ]);

    const rejected = removeConnection(root, "mysql-aliyun", false);
    await expect(rejected).rejects.toBeInstanceOf(ConnectionReferencesRemainError);
    await expect(rejected).rejects.toMatchObject({
      code: "connection_references_remain",
      statusCode: 409,
      message: "无法删除连接 mysql-aliyun。它仍被角色和用户 引用，需要先改掉这些引用。",
      detail: {
        blockers: [
          { kind: "role_selector", id: "finance_readonly" },
          { kind: "identity", id: "demo_agent" }
        ]
      }
    });
    const yaml = await readFile(path.join(root, "ktx.yaml"), "utf8");
    expect(yaml).toContain("mysql-aliyun:");
  });

  it("blocks when the role references the connection via allow.connections", async () => {
    const root = await makeProject(baseYaml());
    await mkdir(path.join(root, "webui", "config"), { recursive: true });
    await writeFile(
      path.join(root, "webui", "config", "access.yaml"),
      `roles:
  finance_readonly:
    allow:
      connections:
        - mysql-aliyun
users:
  - id: demo_agent
    name: Demo Agent
    enabled: true
    tokens: []
    role: finance_readonly
`,
      "utf8"
    );

    const preview = await removeConnection(root, "mysql-aliyun", true);
    expect(preview.blocked).toBe(true);
    expect(preview.impact.blockers.map((b) => b.kind)).toEqual(
      expect.arrayContaining(["role_connection", "identity"])
    );
    await expect(
      removeConnection(root, "mysql-aliyun", false, { deleteAssets: true })
    ).rejects.toBeInstanceOf(ConnectionReferencesRemainError);
  });

  it("blocks when a Wiki page lists the connection in sl_refs", async () => {
    const root = await makeProject(baseYaml());
    const wikiList = async () => [
      {
        key: "global/playbook.md",
        summary: "",
        tags: [],
        slRefs: ["mysql-aliyun/dataforai/superstore_orders"]
      },
      { key: "global/other.md", summary: "", tags: [], slRefs: ["keep-me/other/t"] }
    ];
    const preview = await removeConnection(root, "mysql-aliyun", true, {
      listWikiFn: wikiList
    });
    expect(preview.blocked).toBe(true);
    expect(preview.impact.blockers).toContainEqual({
      kind: "wiki",
      id: "wiki/global/playbook.md"
    });

    await expect(
      removeConnection(root, "mysql-aliyun", false, { listWikiFn: wikiList })
    ).rejects.toBeInstanceOf(ConnectionReferencesRemainError);
    const yaml = await readFile(path.join(root, "ktx.yaml"), "utf8");
    expect(yaml).toContain("mysql-aliyun:");
  });

  it("deleteAssets:true removes semantic_asset from the block set but keeps role refs blocking", async () => {
    const root = await makeProject(baseYaml());
    await mkdir(path.join(root, "semantic-layer", "mysql-aliyun", "_schema"), { recursive: true });
    await writeFile(
      path.join(root, "semantic-layer", "mysql-aliyun", "_schema", "dataforai.yaml"),
      "tables: {}\n",
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
`,
      "utf8"
    );

    const preview = await removeConnection(root, "mysql-aliyun", true, { deleteAssets: true });
    // semantic_asset is still in `blockers` for visibility but no longer drives `blocked`.
    expect(preview.impact.blockers).toContainEqual({
      kind: "semantic_asset",
      id: "semantic-layer/mysql-aliyun/_schema/dataforai.yaml"
    });
    expect(preview.impact.blockers).toContainEqual({
      kind: "role_connection",
      id: "finance_readonly"
    });
    expect(preview.blocked).toBe(true);

    // Adding the role reference means deleteAssets alone cannot unblock.
    await expect(
      removeConnection(root, "mysql-aliyun", false, { deleteAssets: true })
    ).rejects.toBeInstanceOf(ConnectionReferencesRemainError);
  });

  it("reports role_selector blockers even when the semantic-layer directory is absent", async () => {
    const root = await makeProject(baseYaml());
    // No semantic-layer/, no access.yaml — ensure absence of files does NOT
    // hide the role reference; here we only set access.yaml.
    await mkdir(path.join(root, "webui", "config"), { recursive: true });
    await writeFile(
      path.join(root, "webui", "config", "access.yaml"),
      `roles:
  finance_readonly:
    allow:
      tableSelectors:
        - connection: mysql-aliyun
          schema: dataforai
          names: [superstore_orders]
`,
      "utf8"
    );

    const preview = await removeConnection(root, "mysql-aliyun", true);
    expect(preview.impact.blockers).toEqual([
      { kind: "role_selector", id: "finance_readonly" }
    ]);
    expect(preview.blocked).toBe(true);
  });

  it("allows the delete when no references remain (deleteAssets completes the run)", async () => {
    const root = await makeProject(`connections:
  mysql-aliyun:
    driver: mysql
    host: localhost
    port: 3306
    database: dataforai
    username: sc
    password: inline-secret
    schemas: []
    enabled_tables: []
`);
    await mkdir(path.join(root, "semantic-layer", "mysql-aliyun", "_schema"), { recursive: true });
    const manifest = path.join(root, "semantic-layer", "mysql-aliyun", "_schema", "dataforai.yaml");
    await writeFile(manifest, "tables: {}\n", "utf8");

    // No access.yaml, no wiki refs → no role/identity/wiki blockers; the
    // semantic_asset blocker is the only entry and is unblocked by deleteAssets.
    const preview = await removeConnection(root, "mysql-aliyun", true, { deleteAssets: true });
    expect(preview.blocked).toBe(false);
    expect(preview.impact.blockers).toContainEqual({
      kind: "semantic_asset",
      id: "semantic-layer/mysql-aliyun/_schema/dataforai.yaml"
    });

    const result = await removeConnection(root, "mysql-aliyun", false, { deleteAssets: true });
    expect(result.written).toBe(true);
    await expect(readFile(manifest, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });
});
