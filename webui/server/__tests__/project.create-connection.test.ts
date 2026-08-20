import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parse } from "yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONNECTION_ID_PATTERN,
  ConnectionAlreadyExistsError,
  ConnectionIdInvalidError,
  ConnectionPasswordRequiredError,
  ConnectionTestFailedError,
  createConnection,
  connectionSecretRelPath
} from "../project";
import type { ConnectionTestResult } from "../ktx";

let projectRoot: string;

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
  await makeProject();
});

afterEach(async () => {
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

  it("rolls back secret and yaml when connection test fails", async () => {
    const before = await readFile(path.join(projectRoot, "ktx.yaml"), "utf8");
    const testFn = vi.fn(async () => failTest("bad-mysql"));

    await expect(
      createConnection(
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
      )
    ).rejects.toBeInstanceOf(ConnectionTestFailedError);

    await expect(readFile(path.join(projectRoot, "ktx.yaml"), "utf8")).resolves.toBe(before);
    await expect(
      access(path.join(projectRoot, ".ktx", "secrets", "bad-mysql-password"))
    ).rejects.toMatchObject({ code: "ENOENT" });
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

  it("requires password on write path", async () => {
    await expect(
      createConnection(
        projectRoot,
        {
          id: "demo-mysql",
          driver: "mysql",
          host: "db.internal",
          port: 3306,
          database: "analytics",
          username: "lucy_ro"
        },
        false,
        { testConnectionFn: vi.fn(async () => okTest("demo-mysql")) }
      )
    ).rejects.toBeInstanceOf(ConnectionPasswordRequiredError);
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
});
