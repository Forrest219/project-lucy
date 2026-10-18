import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parse } from "yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONNECTION_ID_PATTERN,
  ConnectionAlreadyExistsError,
  ConnectionIdInvalidError,
  addSchema,
  createConnection,
  connectionSecretRelPath,
  probeConnection,
  readProject
} from "../project";
import { invalidateContentPathsCache } from "../paths";
import type { ConnectionTestResult } from "../ktx";

let projectRoot: string;
let previousRoot: string | undefined;

function baseYaml(): string {
  return `connections:
  mysql-aliyun:
    driver: mysql
    host: localhost
    port: 3306
    database: dataforai
    username: sc
    password: file:/tmp/existing-password
    schemas:
      - dataforai
    enabled_tables:
      - dataforai.superstore_orders

setup:
  database_connection_ids:
    - mysql-aliyun
`;
}

async function makeProject(yaml = baseYaml()) {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-create-connection-"));
  await writeFile(path.join(projectRoot, "ktx.yaml"), yaml, "utf8");
  await mkdir(path.join(projectRoot, ".ktx", "secrets"), { recursive: true });
}

function okTest(connId: string): ConnectionTestResult {
  return {
    status: "ok",
    latencyMs: 12,
    detail: "ok",
    command: `ktx connection test ${connId}`,
    args: ["connection", "test", connId],
    exitCode: 0,
    stdout: "ok",
    stderr: ""
  };
}

function failTest(connId: string): ConnectionTestResult {
  return {
    status: "error",
    latencyMs: 8,
    reason: "Access denied",
    command: `ktx connection test ${connId}`,
    args: ["connection", "test", connId],
    exitCode: 1,
    stdout: "",
    stderr: "Access denied"
  };
}

beforeEach(async () => {
  previousRoot = process.env.KTX_PROJECT_ROOT;
  await makeProject();
  // Confirm-write goes through loadContentPaths(), which resolves the project
  // root from KTX_PROJECT_ROOT rather than the root argument.
  process.env.KTX_PROJECT_ROOT = projectRoot;
  invalidateContentPathsCache();
});

afterEach(async () => {
  if (previousRoot === undefined) {
    delete process.env.KTX_PROJECT_ROOT;
  } else {
    process.env.KTX_PROJECT_ROOT = previousRoot;
  }
  invalidateContentPathsCache();
  if (projectRoot) {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

describe("createConnection (Spec 124 Phase A)", () => {
  it("dryRun previews file: password ref without writing secret or yaml", async () => {
    const before = await readFile(path.join(projectRoot, "ktx.yaml"), "utf8");
    const preview = await createConnection(
      projectRoot,
      {
        id: "demo-mysql",
        driver: "mysql",
        host: "db.internal",
        port: 3306,
        database: "analytics",
        username: "lucy_ro",
        password: "should-not-be-written",
        schemas: ["analytics"]
      },
      true
    );

    expect(preview.secretRelPath).toBe(".ktx/secrets/demo-mysql-password");
    expect(preview.proposedYaml).toContain("demo-mysql:");
    expect(preview.proposedYaml).toContain("file:");
    expect(preview.proposedYaml).toContain("demo-mysql-password");
    expect(preview.proposedYaml).not.toContain("should-not-be-written");
    expect(preview.diff).toContain("demo-mysql");
    expect(preview.connection.passwordSource).toBe("file");
    expect(JSON.stringify(preview)).not.toContain("should-not-be-written");

    await expect(readFile(path.join(projectRoot, "ktx.yaml"), "utf8")).resolves.toBe(before);
    await expect(
      access(path.join(projectRoot, ".ktx", "secrets", "demo-mysql-password"))
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("writes secret + yaml and appends setup.database_connection_ids on success", async () => {
    const testFn = vi.fn(async () => okTest("demo-mysql"));
    const result = await createConnection(
      projectRoot,
      {
        id: "demo-mysql",
        driver: "mysql",
        host: "db.internal",
        port: 3306,
        database: "analytics",
        username: "lucy_ro",
        password: "s3cret-value",
        schemas: ["analytics"]
      },
      false,
      { testConnectionFn: testFn }
    );

    expect(result.written).toBe(true);
    expect(result.secretRelPath).toBe(".ktx/secrets/demo-mysql-password");
    expect(result.test.status).toBe("ok");
    expect(testFn).toHaveBeenCalledOnce();

    const secretAbs = path.join(projectRoot, ".ktx", "secrets", "demo-mysql-password");
    await expect(readFile(secretAbs, "utf8")).resolves.toBe("s3cret-value");

    const yamlText = await readFile(path.join(projectRoot, "ktx.yaml"), "utf8");
    expect(yamlText).not.toContain("s3cret-value");
    const parsed = parse(yamlText) as {
      connections: Record<string, Record<string, unknown>>;
      setup: { database_connection_ids: string[] };
    };
    expect(parsed.connections["demo-mysql"]).toMatchObject({
      driver: "mysql",
      host: "db.internal",
      port: 3306,
      database: "analytics",
      username: "lucy_ro",
      readonly: true
    });
    expect(String(parsed.connections["demo-mysql"].password)).toMatch(
      /file:.*\/\.ktx\/secrets\/demo-mysql-password$/
    );
    expect(parsed.connections["demo-mysql"].schemas).toEqual(["analytics"]);
    expect(parsed.connections["demo-mysql"].enabled_tables).toEqual([]);
    expect(parsed.setup.database_connection_ids).toEqual(["mysql-aliyun", "demo-mysql"]);
  });

  it("writes KTX athena keys and reads Glue databases back as schemas", async () => {
    const testFn = vi.fn(async () => okTest("moji-intl"));
    const result = await createConnection(
      projectRoot,
      {
        id: "moji-intl",
        driver: "athena",
        region: "eu-west-1",
        s3StagingDir: "s3://moji-results/athena/",
        workgroup: "primary",
        catalog: "AwsDataCatalog",
        database: "da_moji",
        schemas: ["da_moji", "idm"]
      },
      false,
      { testConnectionFn: testFn }
    );

    expect(result.written).toBe(true);
    expect(result.secretRelPath).toBe("");
    expect(result.connection.engine).toBe("athena");
    await expect(
      access(path.join(projectRoot, ".ktx", "secrets", "moji-intl-password"))
    ).rejects.toMatchObject({ code: "ENOENT" });

    const yamlText = await readFile(path.join(projectRoot, "ktx.yaml"), "utf8");
    const parsed = parse(yamlText) as {
      connections: Record<string, Record<string, unknown>>;
    };
    expect(parsed.connections["moji-intl"]).toEqual({
      driver: "athena",
      readonly: true,
      enabled_tables: [],
      region: "eu-west-1",
      s3_staging_dir: "s3://moji-results/athena/",
      workgroup: "primary",
      catalog: "AwsDataCatalog",
      database: "da_moji",
      databases: ["da_moji", "idm"]
    });
    expect(yamlText).not.toMatch(/moji-intl:[\s\S]*\n\s+schemas:/);
    expect(yamlText).not.toMatch(/moji-intl:[\s\S]*\n\s+host:/);

    const project = await readProject(projectRoot);
    expect(project.connections.find((row) => row.id === "moji-intl")?.schemas).toEqual(["da_moji", "idm"]);

    await addSchema(projectRoot, "moji-intl", "ods", true);
    const after = parse(await readFile(path.join(projectRoot, "ktx.yaml"), "utf8")) as {
      connections: Record<string, { databases?: string[] }>;
    };
    expect(after.connections["moji-intl"].databases).toEqual(["da_moji", "idm"]);

    await addSchema(projectRoot, "moji-intl", "ods", false, { testConnectionFn: testFn });
    const added = parse(await readFile(path.join(projectRoot, "ktx.yaml"), "utf8")) as {
      connections: Record<string, { databases?: string[] }>;
    };
    expect(added.connections["moji-intl"].databases).toEqual(["da_moji", "idm", "ods"]);
  });

  it("probes athena without a password and without host fields", async () => {
    let captured = "";
    const testFn = vi.fn(async (root: string) => {
      captured = await readFile(path.join(root, "ktx.yaml"), "utf8");
      return okTest("probe");
    });
    const result = await probeConnection(
      {
        driver: "athena",
        region: "eu-west-1",
        s3StagingDir: "s3://moji-results/athena/",
        database: "da_moji",
        workgroup: "primary",
        catalog: "AwsDataCatalog"
      },
      { testConnectionFn: testFn }
    );
    expect(result.status).toBe("ok");
    const parsed = parse(captured) as { connections: { probe: Record<string, unknown> } };
    expect(parsed.connections.probe).toMatchObject({
      driver: "athena",
      region: "eu-west-1",
      s3_staging_dir: "s3://moji-results/athena/",
      database: "da_moji",
      databases: []
    });
    expect(parsed.connections.probe).not.toHaveProperty("host");
    expect(parsed.connections.probe).not.toHaveProperty("password");
    expect(parsed.connections.probe).not.toHaveProperty("schemas");
  });

  it("keeps secret and yaml when connection test fails", async () => {
    const testFn = vi.fn(async () => failTest("bad-mysql"));
    const result = await createConnection(
      projectRoot,
      {
        id: "bad-mysql",
        driver: "mysql",
        host: "db.internal",
        port: 3306,
        database: "analytics",
        username: "lucy_ro",
        password: "wrong-password"
      },
      false,
      { testConnectionFn: testFn }
    );

    expect(result.written).toBe(true);
    expect(result.test.status).toBe("error");
    expect(result.test.message).toContain("Access denied");
    expect(testFn).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain("wrong-password");

    await expect(
      readFile(path.join(projectRoot, ".ktx", "secrets", "bad-mysql-password"), "utf8")
    ).resolves.toBe("wrong-password");
    const yamlText = await readFile(path.join(projectRoot, "ktx.yaml"), "utf8");
    expect(yamlText).toContain("bad-mysql:");
    expect(yamlText).not.toContain("wrong-password");
  });

  it("rejects duplicate connection id before writing secret", async () => {
    await expect(
      createConnection(
        projectRoot,
        {
          id: "mysql-aliyun",
          driver: "mysql",
          host: "db.internal",
          port: 3306,
          database: "analytics",
          username: "lucy_ro",
          password: "x"
        },
        false,
        { testConnectionFn: vi.fn(async () => okTest("mysql-aliyun")) }
      )
    ).rejects.toBeInstanceOf(ConnectionAlreadyExistsError);

    await expect(
      access(path.join(projectRoot, ".ktx", "secrets", "mysql-aliyun-password"))
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects invalid connection id", async () => {
    await expect(
      createConnection(
        projectRoot,
        {
          id: "Bad_ID",
          driver: "mysql",
          host: "db.internal",
          port: 3306,
          database: "analytics",
          username: "lucy_ro"
        },
        true
      )
    ).rejects.toMatchObject({
      name: "ConnectionIdInvalidError",
      detail: { pattern: CONNECTION_ID_PATTERN }
    });
    expect(() => connectionSecretRelPath("Bad_ID")).toThrow(ConnectionIdInvalidError);
  });

  it("requires password on write path before touching yaml or secrets", async () => {
    const before = await readFile(path.join(projectRoot, "ktx.yaml"), "utf8");
    const drivers = [
      { driver: "mysql" as const, port: 3306 },
      { driver: "postgres" as const, port: 5432 },
      { driver: "sqlserver" as const, port: 1433 },
      { driver: "oracle" as const, port: 1521 }
    ];

    for (const { driver, port } of drivers) {
      await expect(
        createConnection(
          projectRoot,
          {
            id: "demo-db",
            driver,
            host: "db.internal",
            port,
            database: "analytics",
            username: "lucy_ro"
          },
          false,
          { testConnectionFn: vi.fn(async () => okTest("demo-db")) }
        )
      ).rejects.toMatchObject({
        name: "ConnectionPasswordRequiredError",
        statusCode: 400
      });
    }

    await expect(
      createConnection(
        projectRoot,
        {
          id: "demo-mysql",
          driver: "mysql",
          host: "db.internal",
          port: 3306,
          database: "analytics",
          username: "lucy_ro",
          password: ""
        },
        false,
        { testConnectionFn: vi.fn(async () => okTest("demo-mysql")) }
      )
    ).rejects.toMatchObject({
      name: "ConnectionPasswordRequiredError",
      statusCode: 400
    });

    await expect(readFile(path.join(projectRoot, "ktx.yaml"), "utf8")).resolves.toBe(before);
    await expect(
      access(path.join(projectRoot, ".ktx", "secrets", "demo-db-password"))
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      access(path.join(projectRoot, ".ktx", "secrets", "demo-mysql-password"))
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses overwrite when secret file already exists", async () => {
    await writeFile(
      path.join(projectRoot, ".ktx", "secrets", "demo-mysql-password"),
      "preexisting",
      "utf8"
    );
    const before = await readFile(path.join(projectRoot, "ktx.yaml"), "utf8");

    await expect(
      createConnection(
        projectRoot,
        {
          id: "demo-mysql",
          driver: "mysql",
          host: "db.internal",
          port: 3306,
          database: "analytics",
          username: "lucy_ro",
          password: "new-password"
        },
        false,
        { testConnectionFn: vi.fn(async () => okTest("demo-mysql")) }
      )
    ).rejects.toMatchObject({ code: "SECRET_ALREADY_EXISTS" });

    await expect(readFile(path.join(projectRoot, "ktx.yaml"), "utf8")).resolves.toBe(before);
    await expect(
      readFile(path.join(projectRoot, ".ktx", "secrets", "demo-mysql-password"), "utf8")
    ).resolves.toBe("preexisting");
  });

  it("writes block-style YAML when starting from empty flow connections: {}", async () => {
    await writeFile(
      path.join(projectRoot, "ktx.yaml"),
      "connections: {}\nsetup:\n  database_connection_ids: []\n",
      "utf8"
    );
    await createConnection(
      projectRoot,
      {
        id: "demo-mysql",
        driver: "mysql",
        host: "db.internal",
        port: 3306,
        database: "analytics",
        username: "lucy_ro",
        password: "s3cret-value",
        schemas: ["analytics"]
      },
      false,
      { testConnectionFn: vi.fn(async () => okTest("demo-mysql")) }
    );

    const yamlText = await readFile(path.join(projectRoot, "ktx.yaml"), "utf8");
    expect(yamlText).not.toMatch(/connections:\s*\n\s*\{/);
    expect(yamlText).toContain("  demo-mysql:\n    driver: mysql");
    expect(yamlText).toContain("    enabled_tables: []");
    expect(() => parse(yamlText)).not.toThrow();
    const parsed = parse(yamlText) as {
      connections: Record<string, { schemas: string[] }>;
    };
    expect(parsed.connections["demo-mysql"].schemas).toEqual(["analytics"]);
  });

  it("supports sqlite connections without host, port, username, or password", async () => {
    const testFn = vi.fn(async () => okTest("local-sqlite"));
    const audit = vi.fn(async () => 7);
    const result = await createConnection(
      projectRoot,
      {
        id: "local-sqlite",
        driver: "sqlite",
        database: "data/app.sqlite",
        schemas: ["main"]
      },
      false,
      { testConnectionFn: testFn, recordConfigChange: audit }
    );

    expect(result.written).toBe(true);
    expect(result.auditId).toBe(7);
    expect(audit).toHaveBeenCalledOnce();
    const summary = audit.mock.calls[0]?.[0].newSummary as Record<string, unknown>;
    expect(summary.passwordBytes).toBe(0);
    expect(summary).not.toHaveProperty("password");
    expect(JSON.stringify(result)).not.toContain("passwordBytes");
    const yamlText = await readFile(path.join(projectRoot, "ktx.yaml"), "utf8");
    const parsed = parse(yamlText) as {
      connections: Record<string, { driver: string; path: string; database?: string; password?: string }>;
    };
    expect(parsed.connections["local-sqlite"]).toMatchObject({
      driver: "sqlite",
      path: "data/app.sqlite"
    });
    expect(parsed.connections["local-sqlite"].database).toBeUndefined();
    expect(parsed.connections["local-sqlite"].password).toBeUndefined();
    await expect(
      access(path.join(projectRoot, ".ktx", "secrets", "local-sqlite-password"))
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rolls back yaml and the secret created by this call when recordConfigChange throws", async () => {
    const before = await readFile(path.join(projectRoot, "ktx.yaml"), "utf8");
    const plaintext = "s3cret-value";
    const audit = vi.fn(async () => {
      throw new Error("audit summary failed");
    });

    await expect(
      createConnection(
        projectRoot,
        {
          id: "demo-mysql",
          driver: "mysql",
          host: "db.internal",
          port: 3306,
          database: "analytics",
          username: "lucy_ro",
          password: plaintext
        },
        false,
        {
          testConnectionFn: vi.fn(async () => okTest("demo-mysql")),
          recordConfigChange: audit
        }
      )
    ).rejects.toThrow("audit summary failed");

    expect(audit).toHaveBeenCalledOnce();
    const summary = audit.mock.calls[0]?.[0].newSummary as Record<string, unknown>;
    expect(summary.passwordBytes).toBe(Buffer.byteLength(plaintext, "utf8"));
    expect(summary).not.toHaveProperty("password");
    expect(JSON.stringify(audit.mock.calls)).not.toContain(plaintext);
    await expect(readFile(path.join(projectRoot, "ktx.yaml"), "utf8")).resolves.toBe(before);
    await expect(
      access(path.join(projectRoot, ".ktx", "secrets", "demo-mysql-password"))
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rolls back sqlite yaml when recordConfigChange throws and no secret was created", async () => {
    const before = await readFile(path.join(projectRoot, "ktx.yaml"), "utf8");
    const audit = vi.fn(async () => {
      throw new Error("audit summary failed");
    });

    await expect(
      createConnection(
        projectRoot,
        {
          id: "local-sqlite",
          driver: "sqlite",
          database: "data/app.sqlite"
        },
        false,
        {
          testConnectionFn: vi.fn(async () => okTest("local-sqlite")),
          recordConfigChange: audit
        }
      )
    ).rejects.toThrow("audit summary failed");

    const summary = audit.mock.calls[0]?.[0].newSummary as Record<string, unknown>;
    expect(summary.passwordBytes).toBe(0);
    expect(summary).not.toHaveProperty("password");
    await expect(readFile(path.join(projectRoot, "ktx.yaml"), "utf8")).resolves.toBe(before);
    await expect(
      access(path.join(projectRoot, ".ktx", "secrets", "local-sqlite-password"))
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("supports sqlserver and oracle drivers", async () => {
    const testFn = vi.fn(async () => okTest("dw-sqlserver"));
    const result = await createConnection(
      projectRoot,
      {
        id: "dw-sqlserver",
        driver: "sqlserver",
        host: "sql.internal",
        port: 1433,
        database: "dw",
        username: "sa",
        password: "sa-password"
      },
      false,
      { testConnectionFn: testFn }
    );
    expect(result.written).toBe(true);
    const yamlText = await readFile(path.join(projectRoot, "ktx.yaml"), "utf8");
    expect(yamlText).toContain("driver: sqlserver");
  });
});

describe("probeConnection", () => {
  const probeInput = {
    driver: "mysql" as const,
    host: "db.internal",
    port: 3306,
    database: "analytics",
    username: "lucy_ro",
    password: "s3cret"
  };

  it("runs ktx against a temp project and does not write the real project", async () => {
    const before = await readFile(path.join(projectRoot, "ktx.yaml"), "utf8");
    let seenRoot = "";
    const result = await probeConnection(probeInput, {
      testConnectionFn: async (root, connId) => {
        seenRoot = root;
        expect(connId).toBe("probe");
        expect(root).not.toBe(projectRoot);
        const yaml = await readFile(path.join(root, "ktx.yaml"), "utf8");
        expect(yaml).toContain("host: db.internal");
        expect(yaml).not.toContain("s3cret");
        expect(await readFile(path.join(root, ".ktx", "secrets", "probe-password"), "utf8")).toBe(
          "s3cret"
        );
        return okTest(connId);
      }
    });

    expect(result).toMatchObject({ status: "ok", message: "连接成功" });
    expect(JSON.stringify(result)).not.toContain("s3cret");
    await expect(readFile(path.join(projectRoot, "ktx.yaml"), "utf8")).resolves.toBe(before);
    await expect(
      access(path.join(projectRoot, ".ktx", "secrets", "probe-password"))
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(seenRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("returns status error without throwing when the probe test fails", async () => {
    const before = await readFile(path.join(projectRoot, "ktx.yaml"), "utf8");
    const result = await probeConnection(probeInput, {
      testConnectionFn: async (_root, connId) => failTest(connId)
    });
    expect(result).toMatchObject({
      status: "error",
      message: "用户名或密码不正确，或账号无目标库权限。 建议：核对凭据与 schema"
    });
    await expect(readFile(path.join(projectRoot, "ktx.yaml"), "utf8")).resolves.toBe(before);
  });
});
