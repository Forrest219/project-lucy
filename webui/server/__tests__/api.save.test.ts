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
`;

async function makeProject() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ktx-webui-api-save-"));
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

describe("source save API", () => {
  it("keeps dryRun as the default and does not write disk files", async () => {
    const app = buildServer();
    await app.ready();
    const response = await request(app.server)
      .put("/api/sources/mysql-aliyun/dataforai/superstore_orders")
      .send({ patch: { tableDescription: "Human description." } })
      .expect(200);

    expect(response.body.data.diff).toContain("+      human: Human description.");
    await expect(readFile(path.join(projectRoot, schemaRelPath), "utf8")).resolves.toBe(schemaYaml);
    expect(validateSource).not.toHaveBeenCalled();
    await app.close();
  });

  it("writes through the save path only when dryRun is explicitly false and validates", async () => {
    const app = buildServer();
    await app.ready();
    const response = await request(app.server)
      .put("/api/sources/mysql-aliyun/dataforai/superstore_orders")
      .send({
        dryRun: false,
        patch: {
          tableDescription: "Human description.",
          grain: ["id"],
          columns: [{ name: "id", description: "Human id." }]
        }
      })
      .expect(200);

    expect(response.body.data.written).toBe(true);
    expect(response.body.data.validation.ok).toBe(true);
    expect(validateSource).toHaveBeenCalledWith(projectRoot, "mysql-aliyun", "dataforai", "superstore_orders");
    await expect(readFile(path.join(projectRoot, schemaRelPath), "utf8")).resolves.toContain("human: Human description.");
    await expect(readFile(path.join(projectRoot, "semantic-layer", "mysql-aliyun", "superstore_orders.yaml"), "utf8")).resolves.toContain("grain:");
    await app.close();
  });

  it("rejects unsafe source path segments with the forbidden-path envelope", async () => {
    const app = buildServer();
    await app.ready();
    const response = await request(app.server)
      .put("/api/sources/bad..conn/dataforai/superstore_orders")
      .send({ dryRun: false, patch: { tableDescription: "Nope" } })
      .expect(403);

    expect(response.body).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN_PATH" }
    });
    await app.close();
  });
});

describe("connection enabled_tables API", () => {
  async function writeConnectionProject() {
    await writeFile(path.join(projectRoot, "ktx.yaml"), `connections:
  mysql-aliyun:
    driver: mysql
    enabled_tables:
      - dataforai.superstore_orders
`, "utf8");
  }

  it("keeps dryRun as the default and returns a diff", async () => {
    await writeConnectionProject();
    const app = buildServer();
    await app.ready();
    const response = await request(app.server)
      .put("/api/connections/mysql-aliyun/enabled-tables")
      .send({ enabledTables: [] })
      .expect(200);

    expect(response.body.ok).toBe(true);
    expect(response.body.data.diff).toContain("-      - dataforai.superstore_orders");
    expect(response.body.data.oldEnabledTables).toEqual(["dataforai.superstore_orders"]);
    expect(response.body.data.newEnabledTables).toEqual([]);
    await expect(readFile(path.join(projectRoot, "ktx.yaml"), "utf8")).resolves.toContain("dataforai.superstore_orders");
    await app.close();
  });

  it("rejects invalid enabled table input", async () => {
    await writeConnectionProject();
    const app = buildServer();
    await app.ready();
    const response = await request(app.server)
      .put("/api/connections/mysql-aliyun/enabled-tables")
      .send({ dryRun: true, enabledTables: ["../bad"] })
      .expect(400);

    expect(response.body.error.code).toBe("INVALID_ENABLED_TABLE");
    await app.close();
  });

  it("rejects tables that are not in scanned schema files", async () => {
    await writeConnectionProject();
    const app = buildServer();
    await app.ready();
    const response = await request(app.server)
      .put("/api/connections/mysql-aliyun/enabled-tables")
      .send({ dryRun: true, enabledTables: ["dataforai.not_scanned"] })
      .expect(400);

    expect(response.body.error.code).toBe("TABLE_NOT_SCANNED");
    await app.close();
  });

  it("writes only when dryRun:false and returns an audit id", async () => {
    await writeConnectionProject();
    const app = buildServer();
    await app.ready();
    const response = await request(app.server)
      .put("/api/connections/mysql-aliyun/enabled-tables")
      .send({ dryRun: false, enabledTables: [] })
      .expect(200);

    expect(response.body.data.written).toBe(true);
    expect(response.body.data.auditId).toBeTruthy();
    await expect(readFile(path.join(projectRoot, "ktx.yaml"), "utf8")).resolves.not.toContain("dataforai.superstore_orders");
    await app.close();
  });
});
