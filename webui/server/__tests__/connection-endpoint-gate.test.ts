import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  EndpointAlreadyConnectedError,
  EndpointSchemaCountError,
  SameServerDifferentDatabaseError,
  SchemaAlreadyOnConnectionError,
  decideEndpointGate
} from "../connection-endpoint-gate";
import { addSchema, createConnection, writeKtxYaml, type CreateConnectionInput } from "../project";
import type { ConnectionTestResult } from "../ktx";

let projectRoot = "";

const baseInput: CreateConnectionInput = {
  id: "warehouse-mysql",
  driver: "mysql",
  host: "localhost",
  port: 3306,
  database: "other_schema",
  username: "sc",
  password: "secret-value",
  schemas: ["other_schema"]
};

function yaml(extra = ""): string {
  return `connections:
  mysql-aliyun:
    driver: mysql
    host: localhost
    port: 3306
    database: dataforai
    username: sc
    schemas:
      - dataforai
${extra}`;
}

async function makeProject(text = yaml()) {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-endpoint-gate-"));
  await writeFile(path.join(projectRoot, "ktx.yaml"), text, "utf8");
  await mkdir(path.join(projectRoot, ".ktx", "secrets"), { recursive: true });
}

function okTest(connId: string): ConnectionTestResult {
  return {
    status: "ok",
    latencyMs: 1,
    detail: "ok",
    command: "ktx",
    args: ["connection", "test", connId],
    exitCode: 0,
    stdout: "ok",
    stderr: ""
  };
}

afterEach(async () => {
  if (projectRoot) await rm(projectRoot, { recursive: true, force: true });
});

describe("decideEndpointGate", () => {
  const existing = {
    id: "mysql-aliyun",
    driver: "mysql",
    host: "localhost",
    port: "3306",
    database: "dataforai",
    username: "sc",
    schemas: ["dataforai"]
  };

  it("treats host case as the same endpoint and keeps localhost distinct from 127.0.0.1", () => {
    expect(() =>
      decideEndpointGate([existing], { ...baseInput, host: "LocalHost" })
    ).toThrow(EndpointAlreadyConnectedError);
    expect(
      decideEndpointGate([existing], { ...baseInput, host: "127.0.0.1" })
    ).toEqual({ action: "create" });
  });

  it("rejects more than one schema on a matching endpoint", () => {
    expect(() =>
      decideEndpointGate([existing], { ...baseInput, schemas: ["a", "b"] })
    ).toThrow(EndpointSchemaCountError);
  });

  it("does not let acknowledgeSeparateConnection create a third connection", () => {
    const second = { ...existing, id: "mysql-copy" };
    expect(() =>
      decideEndpointGate([existing, second], baseInput, { acknowledgeSeparateConnection: true })
    ).toThrow(EndpointAlreadyConnectedError);
  });

  it("requires a server flag for another PostgreSQL database on the same server", () => {
    const pg = { ...existing, driver: "postgres", database: "app", port: "5432" };
    const input: CreateConnectionInput = {
      ...baseInput,
      driver: "postgres",
      port: 5432,
      database: "other",
      schemas: ["public"]
    };
    expect(() => decideEndpointGate([pg], input)).toThrow(SameServerDifferentDatabaseError);
    expect(
      decideEndpointGate([pg], input, { acknowledgeDifferentDatabase: true })
    ).toEqual({ action: "create", acknowledgedDifferentDatabase: true });
  });

  it.each([
    { label: "empty", schemas: [] },
    { label: "multiple", schemas: ["analytics", "reporting"] }
  ])(
    "rejects invalid schema count before acknowledging another database: $label",
    ({ schemas }) => {
      const pg = { ...existing, driver: "postgres", database: "app", port: "5432" };
      const input: CreateConnectionInput = {
        ...baseInput,
        driver: "postgres",
        port: 5432,
        database: "other",
        schemas
      };
      expect(() =>
        decideEndpointGate([pg], input, { acknowledgeDifferentDatabase: true })
      ).toThrow(EndpointSchemaCountError);
    }
  );

  it("validates schema count before asking the user to choose among multiple matches", () => {
    const second = { ...existing, id: "mysql-copy" };
    expect(() =>
      decideEndpointGate([existing, second], { ...baseInput, schemas: ["a", "b"] })
    ).toThrow(EndpointSchemaCountError);
  });
});

describe("createConnection endpoint gate", () => {
  it("rejects a dry run and a write for the same MySQL endpoint without touching files", async () => {
    await makeProject();
    const before = await readFile(path.join(projectRoot, "ktx.yaml"), "utf8");
    await expect(createConnection(projectRoot, baseInput, true)).rejects.toMatchObject({
      code: "ENDPOINT_ALREADY_CONNECTED",
      detail: { reason: "reuse_existing_credentials", schema: "other_schema" }
    });
    await expect(
      createConnection(projectRoot, baseInput, false, { testConnectionFn: async () => okTest(baseInput.id) })
    ).rejects.toBeInstanceOf(EndpointAlreadyConnectedError);
    expect(await readFile(path.join(projectRoot, "ktx.yaml"), "utf8")).toBe(before);
    await expect(readFile(path.join(projectRoot, ".ktx", "secrets", "warehouse-mysql-password"), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("reports a schema that is already on the connection", async () => {
    await makeProject();
    await expect(
      createConnection(projectRoot, { ...baseInput, database: "dataforai", schemas: ["dataforai"] }, true)
    ).rejects.toBeInstanceOf(SchemaAlreadyOnConnectionError);
  });

  it("refuses reuse when the username differs until the caller acknowledges a separate connection", async () => {
    await makeProject();
    const input = { ...baseInput, username: "other_user" };
    await expect(createConnection(projectRoot, input, true)).rejects.toMatchObject({
      detail: { reason: "username_differs" }
    });
    const created = await createConnection(projectRoot, input, false, {
      endpointFlags: { acknowledgeSeparateConnection: true },
      testConnectionFn: async (_root, connId) => okTest(connId)
    });
    expect(created.written).toBe(true);
    const text = await readFile(path.join(projectRoot, "ktx.yaml"), "utf8");
    expect(text).toContain("warehouse-mysql:");
    expect(text).toContain("mysql-aliyun:");
  });

  it("keeps the first concurrent create and rejects the second without overwriting it", async () => {
    await makeProject();
    const shared = {
      driver: "mysql" as const,
      host: "10.1.1.8",
      port: 3306,
      database: "analytics",
      username: "reader",
      password: "secret-value",
      schemas: ["analytics"]
    };
    const results = await Promise.allSettled([
      createConnection(projectRoot, { ...shared, id: "alpha" }, false, {
        testConnectionFn: async (_root, connId) => okTest(connId)
      }),
      createConnection(projectRoot, { ...shared, id: "beta" }, false, {
        testConnectionFn: async (_root, connId) => okTest(connId)
      })
    ]);
    const fulfilled = results.filter((item) => item.status === "fulfilled");
    const rejected = results.filter((item) => item.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(SchemaAlreadyOnConnectionError);
    const text = await readFile(path.join(projectRoot, "ktx.yaml"), "utf8");
    expect(text).toContain("mysql-aliyun:");
    const createdIds = ["alpha:", "beta:"].filter((id) => text.includes(id));
    expect(createdIds).toHaveLength(1);
  });

  it("serializes all formal ktx.yaml writes, not only connection creates", async () => {
    await makeProject();
    await Promise.all([
      writeKtxYaml(projectRoot, (doc) => doc.set("write_marker_a", true), { dryRun: false }),
      writeKtxYaml(projectRoot, (doc) => doc.set("write_marker_b", true), { dryRun: false })
    ]);
    const text = await readFile(path.join(projectRoot, "ktx.yaml"), "utf8");
    expect(text).toContain("write_marker_a: true");
    expect(text).toContain("write_marker_b: true");
  });

  it("preserves an added schema while another connection is being created", async () => {
    await makeProject();
    const createInput = {
      ...baseInput,
      id: "analytics-mysql",
      host: "10.1.1.8",
      database: "analytics",
      schemas: ["analytics"]
    };
    const [created, added] = await Promise.all([
      createConnection(projectRoot, createInput, false, {
        testConnectionFn: async (_root, connId) => okTest(connId)
      }),
      addSchema(projectRoot, "mysql-aliyun", "reporting", false, {
        testConnectionFn: async (_root, connId) => okTest(connId)
      })
    ]);
    expect(created.written).toBe(true);
    expect(added.written).toBe(true);
    const text = await readFile(path.join(projectRoot, "ktx.yaml"), "utf8");
    expect(text).toContain("analytics-mysql:");
    expect(text).toContain("- reporting");
  });
});
