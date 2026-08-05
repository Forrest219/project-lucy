import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../index";
import { validateSource } from "../ktx";

vi.mock("../ktx", () => ({
  validateSource: vi.fn(async () => ({
    ok: true,
    exitCode: 0,
    stdout: "Valid semantic-layer source",
    stderr: "",
    issues: []
  }))
}));

let projectRoot: string;
let previousRoot: string | undefined;

const schemaRelPath = "semantic-layer/mysql-aliyun/_schema/dataforai.yaml";
const schemaYaml = `tables:
  superstore_orders:
    table: dataforai.superstore_orders
    columns:
      - name: id
        type: number
        descriptions:
          ai: Machine text.
    descriptions:
      ai: Demo table.
  superstore_people:
    table: dataforai.superstore_people
    columns:
      - name: id
        type: number
    descriptions:
      ai: Demo people table.
`;

const importedTableYaml = `table: dataforai.superstore_orders
grain:
  - id
columns:
  - name: id
    type: number
descriptions:
  human: Imported table description.
`;

async function makeProject() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ktx-webui-api-import-"));
  await mkdir(path.join(root, "semantic-layer", "mysql-aliyun", "_schema"), { recursive: true });
  await writeFile(path.join(root, "ktx.yaml"), "connections: {}\n", "utf8");
  await writeFile(path.join(root, schemaRelPath), schemaYaml, "utf8");
  return root;
}

beforeEach(async () => {
  projectRoot = await makeProject();
  previousRoot = process.env.KTX_PROJECT_ROOT;
  process.env.KTX_PROJECT_ROOT = projectRoot;
  vi.clearAllMocks();
});

afterEach(async () => {
  if (previousRoot === undefined) {
    delete process.env.KTX_PROJECT_ROOT;
  } else {
    process.env.KTX_PROJECT_ROOT = previousRoot;
  }
  await rm(projectRoot, { recursive: true, force: true });
});

describe("source YAML import API", () => {
  it("returns rawYaml as a re-importable table snippet", async () => {
    const app = buildServer();
    await app.ready();
    const sourceResponse = await request(app.server)
      .get("/api/sources/mysql-aliyun/dataforai/superstore_orders")
      .expect(200);

    const rawYaml = sourceResponse.body.data.rawYaml;
    expect(rawYaml).toContain("table: dataforai.superstore_orders");
    expect(rawYaml).toContain("\ncolumns:");

    const importResponse = await request(app.server)
      .post("/api/sources/mysql-aliyun/dataforai/superstore_orders/import")
      .send({
        yaml: rawYaml.replace("Demo table.", "Re-imported table description.")
      })
      .expect(200);

    expect(importResponse.body.data.diff).toContain("Re-imported table description.");
    await app.close();
  });

  it("previews imported table YAML by default without writing disk files", async () => {
    const app = buildServer();
    await app.ready();
    const response = await request(app.server)
      .post("/api/sources/mysql-aliyun/dataforai/superstore_orders/import")
      .send({ yaml: importedTableYaml })
      .expect(200);

    expect(response.body.data.diff).toContain("+      human: Imported table description.");
    expect(response.body.data.files[0].filePath).toBe(schemaRelPath);
    await expect(readFile(path.join(projectRoot, schemaRelPath), "utf8")).resolves.toBe(schemaYaml);
    expect(validateSource).not.toHaveBeenCalled();
    await app.close();
  });

  it("writes imported table YAML only when dryRun:false and validates the source", async () => {
    const app = buildServer();
    await app.ready();
    const response = await request(app.server)
      .post("/api/sources/mysql-aliyun/dataforai/superstore_orders/import")
      .send({ dryRun: false, yaml: importedTableYaml, sourceFileName: "superstore_orders.yaml" })
      .expect(200);

    expect(response.body.data.written).toBe(true);
    expect(response.body.data.version).toMatchObject({
      key: "mysql-aliyun/dataforai/superstore_orders",
      operation: "import",
      sourceFileName: "superstore_orders.yaml"
    });
    expect(validateSource).toHaveBeenCalledWith(projectRoot, "mysql-aliyun", "dataforai", "superstore_orders");
    await expect(readFile(path.join(projectRoot, schemaRelPath), "utf8")).resolves.toContain("human: Imported table description.");
    await expect(readFile(path.join(projectRoot, "semantic-layer", "mysql-aliyun", "superstore_orders.yaml"), "utf8")).resolves.toContain("grain:");
    await app.close();
  });

  it("does not wipe schema columns when importing overlay-only YAML", async () => {
    const overlayOnly = `name: superstore_orders
table: dataforai.superstore_orders
grain:
  - id
measures:
  - name: order_count
    expr: count(*)
    description: Count of orders.
`;
    const app = buildServer();
    await app.ready();
    const response = await request(app.server)
      .post("/api/sources/mysql-aliyun/dataforai/superstore_orders/import")
      .send({ dryRun: true, yaml: overlayOnly })
      .expect(200);

    const schemaFiles = response.body.data.files.filter(
      (file: { filePath: string }) => file.filePath === schemaRelPath
    );
    expect(schemaFiles).toHaveLength(0);
    expect(response.body.data.files.some((file: { filePath: string }) => file.filePath.includes("superstore_orders.yaml"))).toBe(
      true
    );
    await expect(readFile(path.join(projectRoot, schemaRelPath), "utf8")).resolves.toBe(schemaYaml);
    await expect(readFile(path.join(projectRoot, schemaRelPath), "utf8")).resolves.toContain("columns:");
    await app.close();
  });
});
