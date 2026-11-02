import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parse } from "yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ConnectionEndpointForbiddenError,
  ConnectionEndpointNoChangeError,
  ConnectionEndpointUnsupportedDriverError,
  ConnectionNotFoundError,
  ConnectionPasswordSourceNotEditableError,
  ConnectionTestFailedError,
  connectionSecretRelPath,
  updateConnectionEndpoint
} from "../project";
import { invalidateContentPathsCache } from "../paths";
import { OPS_EVIDENCE_CONNECTION_ID } from "../ops-evidence/contract";
import { safeWriteNewSecretPassword } from "../fs-safe";
import type { ConnectionTestResult } from "../ktx";
import { EndpointEditConflictError } from "../connection-endpoint-gate";

let projectRoot: string;
let previousRoot: string | undefined;

function baseYaml(overrides?: { host?: string; password?: string; secondConn?: boolean }): string {
  const host = overrides?.host ?? "db-prod.internal";
  const password = overrides?.password ?? "file:PLACEHOLDER";
  const second = overrides?.secondConn
    ? `
  other-mysql:
    driver: mysql
    host: db-other.internal
    port: 3306
    database: analytics
    username: lucy_ro
    password: file:/tmp/other-password
    schemas:
      - analytics
`
    : "";
  return `connections:
  mysql-aliyun:
    driver: mysql
    host: ${host}
    port: 3306
    database: dataforai
    username: sc
    password: ${password}
    schemas:
      - dataforai
    enabled_tables:
      - dataforai.superstore_orders
${second}
setup:
  database_connection_ids:
    - mysql-aliyun
`;
}

async function makeProject(yaml?: string) {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-endpoint-edit-"));
  await mkdir(path.join(projectRoot, ".ktx", "secrets"), { recursive: true });
  const secretRel = connectionSecretRelPath("mysql-aliyun");
  const absSecret = path.join(projectRoot, secretRel);
  const passwordRef = `file:${absSecret}`;
  const text = (yaml ?? baseYaml()).replace("file:PLACEHOLDER", passwordRef);
  await writeFile(path.join(projectRoot, "ktx.yaml"), text, "utf8");
  await safeWriteNewSecretPassword(projectRoot, secretRel, "old-secret");
}

function okTest(connId: string): ConnectionTestResult {
  return {
    status: "ok",
    latencyMs: 5,
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
    latencyMs: 3,
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
  process.env.KTX_PROJECT_ROOT = projectRoot;
  invalidateContentPathsCache();
});

afterEach(async () => {
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  invalidateContentPathsCache();
  if (projectRoot) await rm(projectRoot, { recursive: true, force: true });
});

describe("updateConnectionEndpoint (lucy-20261101)", () => {
  it("SC-01 dryRun includes current username and redacted diff without password", async () => {
    const preview = await updateConnectionEndpoint(
      projectRoot,
      "mysql-aliyun",
      { host: "db-test.internal", port: 3306, username: "sc" },
      true
    );
    expect(preview.current.username).toBe("sc");
    expect(preview.current.host).toBe("db-prod.internal");
    expect(preview.diff).toContain("db-test.internal");
    expect(JSON.stringify(preview)).not.toContain("old-secret");
    expect(preview.passwordAction).toBe("keep");
  });

  it("SC-02 no-change dryRun is empty; false rejects", async () => {
    const preview = await updateConnectionEndpoint(
      projectRoot,
      "mysql-aliyun",
      { host: "db-prod.internal", port: 3306, username: "sc" },
      true
    );
    expect(preview.diff).toBe("");
    await expect(
      updateConnectionEndpoint(
        projectRoot,
        "mysql-aliyun",
        { host: "db-prod.internal", port: 3306, username: "sc" },
        false,
        { testConnectionFn: async (_r, id) => okTest(id) }
      )
    ).rejects.toBeInstanceOf(ConnectionEndpointNoChangeError);
  });

  it("SC-03 host change keeps secret bytes", async () => {
    const before = await readFile(path.join(projectRoot, connectionSecretRelPath("mysql-aliyun")));
    const result = await updateConnectionEndpoint(
      projectRoot,
      "mysql-aliyun",
      { host: "db-test.internal", port: 3306, username: "sc" },
      false,
      {
        testConnectionFn: async (_r, id) => okTest(id),
        presenceCheckFn: async () => ({ status: "ok", missingEnabledTables: [] })
      }
    );
    expect(result.written).toBe(true);
    if (!("written" in result) || !result.written) throw new Error("expected write");
    expect(result.test.status).toBe("ok");
    const after = await readFile(path.join(projectRoot, connectionSecretRelPath("mysql-aliyun")));
    expect(Buffer.compare(before, after)).toBe(0);
    const yaml = parse(await readFile(path.join(projectRoot, "ktx.yaml"), "utf8")) as {
      connections: Record<string, { host: string; schemas: string[]; enabled_tables: string[] }>;
    };
    expect(yaml.connections["mysql-aliyun"].host).toBe("db-test.internal");
    expect(yaml.connections["mysql-aliyun"].schemas).toEqual(["dataforai"]);
    expect(yaml.connections["mysql-aliyun"].enabled_tables).toEqual(["dataforai.superstore_orders"]);
  });

  it("SC-04/05 replace password rolls back on test failure", async () => {
    await expect(
      updateConnectionEndpoint(
        projectRoot,
        "mysql-aliyun",
        { host: "db-test.internal", port: 3306, username: "sc", password: "new-secret" },
        false,
        { testConnectionFn: async (_r, id) => failTest(id) }
      )
    ).rejects.toBeInstanceOf(ConnectionTestFailedError);

    const secret = await readFile(path.join(projectRoot, connectionSecretRelPath("mysql-aliyun")), "utf8");
    expect(secret).toBe("old-secret");
    const yaml = parse(await readFile(path.join(projectRoot, "ktx.yaml"), "utf8")) as {
      connections: Record<string, { host: string }>;
    };
    expect(yaml.connections["mysql-aliyun"].host).toBe("db-prod.internal");
  });

  it("SC-06/07 endpoint conflict excludes self and allows ack", async () => {
    await makeProject(baseYaml({ secondConn: true }));
    process.env.KTX_PROJECT_ROOT = projectRoot;
    invalidateContentPathsCache();

    await expect(
      updateConnectionEndpoint(
        projectRoot,
        "mysql-aliyun",
        { host: "db-other.internal", port: 3306, username: "sc" },
        true
      )
    ).rejects.toBeInstanceOf(EndpointEditConflictError);

    const preview = await updateConnectionEndpoint(
      projectRoot,
      "mysql-aliyun",
      { host: "db-other.internal", port: 3306, username: "sc" },
      true,
      { endpointFlags: { acknowledgeSharedEndpoint: true } }
    );
    expect(preview.diff).toContain("db-other.internal");
  });

  it("SC-10 presence missing does not roll back endpoint", async () => {
    const result = await updateConnectionEndpoint(
      projectRoot,
      "mysql-aliyun",
      { host: "db-test.internal", port: 3306, username: "sc" },
      false,
      {
        testConnectionFn: async (_r, id) => okTest(id),
        presenceCheckFn: async () => ({
          status: "missing",
          missingEnabledTables: ["dataforai.superstore_orders"]
        })
      }
    );
    if (!("written" in result) || !result.written) throw new Error("expected write");
    expect(result.presence.status).toBe("missing");
    const yaml = parse(await readFile(path.join(projectRoot, "ktx.yaml"), "utf8")) as {
      connections: Record<string, { host: string }>;
    };
    expect(yaml.connections["mysql-aliyun"].host).toBe("db-test.internal");
  });

  it("SC-17 rejects non-canonical password replace", async () => {
    await makeProject(baseYaml({ password: "env:DB_PASSWORD" }));
    process.env.KTX_PROJECT_ROOT = projectRoot;
    invalidateContentPathsCache();
    await expect(
      updateConnectionEndpoint(
        projectRoot,
        "mysql-aliyun",
        { host: "db-test.internal", port: 3306, username: "sc", password: "x" },
        false,
        { testConnectionFn: async (_r, id) => okTest(id) }
      )
    ).rejects.toBeInstanceOf(ConnectionPasswordSourceNotEditableError);
  });

  it("SC-18/23 forbid sqlite-shaped and lucy-ops", async () => {
    await writeFile(
      path.join(projectRoot, "ktx.yaml"),
      `connections:
  local-sqlite:
    driver: sqlite
    database: /tmp/x.db
  ${OPS_EVIDENCE_CONNECTION_ID}:
    driver: mysql
    host: 127.0.0.1
    port: 3306
    database: ops
    username: ops
    password: file:/tmp/ops
`,
      "utf8"
    );
    await expect(
      updateConnectionEndpoint(
        projectRoot,
        "local-sqlite",
        { host: "x", port: 1, username: "u" },
        true
      )
    ).rejects.toBeInstanceOf(ConnectionEndpointUnsupportedDriverError);

    await expect(
      updateConnectionEndpoint(
        projectRoot,
        OPS_EVIDENCE_CONNECTION_ID,
        { host: "x", port: 3306, username: "u" },
        true
      )
    ).rejects.toBeInstanceOf(ConnectionEndpointForbiddenError);
  });

  it("SC-15 unknown connection 404", async () => {
    await expect(
      updateConnectionEndpoint(projectRoot, "missing", { host: "x", port: 3306, username: "u" }, true)
    ).rejects.toBeInstanceOf(ConnectionNotFoundError);
  });

  it("SC-08 keeps id/schemas/enabled_tables byte-identical after write", async () => {
    const before = parse(await readFile(path.join(projectRoot, "ktx.yaml"), "utf8")) as {
      connections: Record<string, { schemas: string[]; enabled_tables: string[] }>;
    };
    const result = await updateConnectionEndpoint(
      projectRoot,
      "mysql-aliyun",
      { host: "db-test.internal", port: 3307, username: "sc2" },
      false,
      {
        testConnectionFn: async (_r, id) => okTest(id),
        presenceCheckFn: async () => ({ status: "ok", missingEnabledTables: [] })
      }
    );
    if (!("written" in result) || !result.written) throw new Error("expected write");
    expect(result.connection.id).toBe("mysql-aliyun");
    const after = parse(await readFile(path.join(projectRoot, "ktx.yaml"), "utf8")) as {
      connections: Record<string, { schemas: string[]; enabled_tables: string[] }>;
    };
    expect(after.connections["mysql-aliyun"].schemas).toEqual(before.connections["mysql-aliyun"].schemas);
    expect(after.connections["mysql-aliyun"].enabled_tables).toEqual(
      before.connections["mysql-aliyun"].enabled_tables
    );
  });

  it("SC-09 audits without password and rolls back when audit fails", async () => {
    let captured: Record<string, unknown> | undefined;
    const ok = await updateConnectionEndpoint(
      projectRoot,
      "mysql-aliyun",
      { host: "db-test.internal", port: 3306, username: "sc" },
      false,
      {
        testConnectionFn: async (_r, id) => okTest(id),
        presenceCheckFn: async () => ({ status: "ok", missingEnabledTables: [] }),
        recordConfigChange: async (entry) => {
          captured = entry as unknown as Record<string, unknown>;
          return 42;
        }
      }
    );
    if (!("written" in ok) || !ok.written) throw new Error("expected write");
    expect(ok.auditId).toBe(42);
    expect(ok.executionRuntimePending).toBe(true);
    expect(captured?.changeType).toBe("connection_endpoint_update");
    expect(JSON.stringify(captured)).not.toMatch(/old-secret|new-secret/);

    await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;
    invalidateContentPathsCache();
    await expect(
      updateConnectionEndpoint(
        projectRoot,
        "mysql-aliyun",
        { host: "db-test.internal", port: 3306, username: "sc", password: "new-secret" },
        false,
        {
          testConnectionFn: async (_r, id) => okTest(id),
          presenceCheckFn: async () => ({ status: "ok", missingEnabledTables: [] }),
          recordConfigChange: async () => {
            throw new Error("audit boom");
          }
        }
      )
    ).rejects.toThrow(/audit boom/);
    const secret = await readFile(path.join(projectRoot, connectionSecretRelPath("mysql-aliyun")), "utf8");
    expect(secret).toBe("old-secret");
    const yaml = parse(await readFile(path.join(projectRoot, "ktx.yaml"), "utf8")) as {
      connections: Record<string, { host: string }>;
    };
    expect(yaml.connections["mysql-aliyun"].host).toBe("db-prod.internal");
  });

  it("SC-16 concurrent other-connection change survives this request rollback", async () => {
    await makeProject(baseYaml({ secondConn: true }));
    process.env.KTX_PROJECT_ROOT = projectRoot;
    invalidateContentPathsCache();

    const mutated = (await readFile(path.join(projectRoot, "ktx.yaml"), "utf8")).replace(
      "host: db-other.internal",
      "host: db-other-concurrent.internal"
    );
    await writeFile(path.join(projectRoot, "ktx.yaml"), mutated, "utf8");

    await expect(
      updateConnectionEndpoint(
        projectRoot,
        "mysql-aliyun",
        { host: "db-test.internal", port: 3306, username: "sc" },
        false,
        { testConnectionFn: async (_r, id) => failTest(id) }
      )
    ).rejects.toBeInstanceOf(ConnectionTestFailedError);

    const yaml = parse(await readFile(path.join(projectRoot, "ktx.yaml"), "utf8")) as {
      connections: Record<string, { host: string }>;
    };
    expect(yaml.connections["mysql-aliyun"].host).toBe("db-prod.internal");
    expect(yaml.connections["other-mysql"].host).toBe("db-other-concurrent.internal");
  });

  it("SC-19 rejects out-of-range port", async () => {
    await expect(
      updateConnectionEndpoint(
        projectRoot,
        "mysql-aliyun",
        { host: "db-test.internal", port: 70000, username: "sc" },
        true
      )
    ).rejects.toMatchObject({ code: "CONNECTION_ENDPOINT_INVALID_FIELD" });
  });

  it("SC-21 success body marks executionRuntimePending", async () => {
    const result = await updateConnectionEndpoint(
      projectRoot,
      "mysql-aliyun",
      { host: "db-test.internal", port: 3306, username: "sc" },
      false,
      {
        testConnectionFn: async (_r, id) => okTest(id),
        presenceCheckFn: async () => ({ status: "ok", missingEnabledTables: [] })
      }
    );
    if (!("written" in result) || !result.written) throw new Error("expected write");
    expect(result.executionRuntimePending).toBe(true);
  });
});
