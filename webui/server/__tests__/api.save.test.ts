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

function expectNoUnrelatedEnabledTablesDiff(diff: string) {
  expect(diff).not.toMatch(/^[+-]\s+(driver|host|schemas):/m);
  expect(diff).not.toMatch(/^[+-]\s+other-pg:/m);
  expect(diff).not.toMatch(/^[+-]\s+- public\.orders$/m);
}

function changedDiffBodyLines(diff: string): string[] {
  return diff.split("\n").filter((line) => /^[+-](?![+-]{2})/.test(line));
}

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
    expect(response.body.data.version).toMatchObject({
      key: "mysql-aliyun/dataforai/superstore_orders",
      operation: "save"
    });
    expect(validateSource).toHaveBeenCalledWith(projectRoot, "mysql-aliyun", "dataforai", "superstore_orders");
    await expect(readFile(path.join(projectRoot, schemaRelPath), "utf8")).resolves.toContain("human: Human description.");
    await expect(readFile(path.join(projectRoot, "semantic-layer", "mysql-aliyun", "superstore_orders.yaml"), "utf8")).resolves.toContain("grain:");

    const versionId = response.body.data.version.versionId;
    const listResponse = await request(app.server)
      .get("/api/sources/mysql-aliyun/dataforai/superstore_orders/versions")
      .expect(200);
    expect(listResponse.body.data.versions[0].versionId).toBe(versionId);

    const detailResponse = await request(app.server)
      .get(`/api/sources/mysql-aliyun/dataforai/superstore_orders/versions/${versionId}`)
      .expect(200);
    expect(detailResponse.body.data.rawYaml).toContain("human: Human description.");
    expect(detailResponse.body.data.rawYaml).toContain("grain:");
    expect(detailResponse.body.data.rawYaml).toContain("- id");

    const restoreResponse = await request(app.server)
      .post(`/api/sources/mysql-aliyun/dataforai/superstore_orders/versions/${versionId}/restore`)
      .send({})
      .expect(200);
    expect(restoreResponse.body.data.restoredFromVersionId).toBe(versionId);
    expect(restoreResponse.body.data.rawYaml).toContain("human: Human description.");
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

  // Spec 116: grandfather previously-enabled unscanned tables; warn, do not block.
  it("allows retaining previously enabled unscanned tables with warnings when adding scanned tables", async () => {
    await writeFile(
      path.join(projectRoot, "ktx.yaml"),
      `connections:
  mysql-aliyun:
    driver: mysql
    enabled_tables:
      - demo_finance.ads_finance_revenue_day
      - meta.field_abbr_dict
`,
      "utf8"
    );
    const app = buildServer();
    await app.ready();
    const response = await request(app.server)
      .put("/api/connections/mysql-aliyun/enabled-tables")
      .send({
        dryRun: true,
        enabledTables: [
          "demo_finance.ads_finance_revenue_day",
          "meta.field_abbr_dict",
          "dataforai.superstore_orders"
        ]
      })
      .expect(200);

    expect(response.body.data.newEnabledTables).toEqual([
      "demo_finance.ads_finance_revenue_day",
      "meta.field_abbr_dict",
      "dataforai.superstore_orders"
    ]);
    expect(response.body.data.warnings).toEqual([
      {
        code: "ENABLED_TABLE_NOT_SCANNED",
        table: "demo_finance.ads_finance_revenue_day",
        message: "Table 'demo_finance.ads_finance_revenue_day' is enabled but not present in scanned semantic-layer schema"
      },
      {
        code: "ENABLED_TABLE_NOT_SCANNED",
        table: "meta.field_abbr_dict",
        message: "Table 'meta.field_abbr_dict' is enabled but not present in scanned semantic-layer schema"
      }
    ]);
    await app.close();
  });

  it("still rejects newly added unscanned tables even when orphans exist", async () => {
    await writeFile(
      path.join(projectRoot, "ktx.yaml"),
      `connections:
  mysql-aliyun:
    driver: mysql
    enabled_tables:
      - demo_finance.ads_finance_revenue_day
`,
      "utf8"
    );
    const app = buildServer();
    await app.ready();
    const response = await request(app.server)
      .put("/api/connections/mysql-aliyun/enabled-tables")
      .send({
        dryRun: true,
        enabledTables: ["demo_finance.ads_finance_revenue_day", "dataforai.brand_new_unscanned"]
      })
      .expect(400);

    expect(response.body.error.code).toBe("TABLE_NOT_SCANNED");
    await app.close();
  });

  it("allows removing invalid enabled tables without warnings", async () => {
    await writeFile(
      path.join(projectRoot, "ktx.yaml"),
      `connections:
  mysql-aliyun:
    driver: mysql
    enabled_tables:
      - demo_finance.ads_finance_revenue_day
      - dataforai.superstore_orders
`,
      "utf8"
    );
    const app = buildServer();
    await app.ready();
    const response = await request(app.server)
      .put("/api/connections/mysql-aliyun/enabled-tables")
      .send({
        dryRun: true,
        enabledTables: ["dataforai.superstore_orders"]
      })
      .expect(200);

    expect(response.body.data.newEnabledTables).toEqual(["dataforai.superstore_orders"]);
    expect(response.body.data.warnings).toEqual([]);
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

  // M45: enabled_tables patch must be AST-local so dry-run diff never
  // churns unrelated connections, fields or comments.
  it("emits a minimal diff for adding a single enabled table", async () => {
    await writeFile(
      path.join(projectRoot, "ktx.yaml"),
      `# header comment
connections:
  mysql-aliyun:
    driver: mysql
    enabled_tables:
      - dataforai.superstore_orders
  other-pg:
    driver: postgres
    enabled_tables:
      - public.orders
schemas:
  - mysql-aliyun
`,
      "utf8"
    );
    const app = buildServer();
    await app.ready();
    const response = await request(app.server)
      .put("/api/connections/mysql-aliyun/enabled-tables")
      .send({
        dryRun: true,
        enabledTables: ["dataforai.superstore_orders", "dataforai.superstore_people"]
      })
      .expect(200);

    const diff = response.body.data.diff as string;
    // The actual structural change must be a single added enabled_table line.
    expect(diff).toContain("+      - dataforai.superstore_people");
    expectNoUnrelatedEnabledTablesDiff(diff);
    expect(changedDiffBodyLines(diff)).toEqual(["+      - dataforai.superstore_people"]);
    await app.close();
  });

  it("emits a minimal diff for removing a single enabled table", async () => {
    await writeFile(
      path.join(projectRoot, "ktx.yaml"),
      `connections:
  mysql-aliyun:
    driver: mysql
    host: example.com
    schemas: ['dataforai']
    enabled_tables:
      - dataforai.superstore_orders
      - dataforai.superstore_people
  other-pg:
    driver: postgres
    enabled_tables:
      - public.orders
`,
      "utf8"
    );
    const app = buildServer();
    await app.ready();
    const response = await request(app.server)
      .put("/api/connections/mysql-aliyun/enabled-tables")
      .send({
        dryRun: true,
        enabledTables: ["dataforai.superstore_orders"]
      })
      .expect(200);

    const diff = response.body.data.diff as string;
    expect(diff).toContain("-      - dataforai.superstore_people");
    expectNoUnrelatedEnabledTablesDiff(diff);
    expect(changedDiffBodyLines(diff)).toEqual(["-      - dataforai.superstore_people"]);
    await app.close();
  });

  it("uses the same patch function for dryRun:true and dryRun:false", async () => {
    await writeConnectionProject();
    const app = buildServer();
    await app.ready();

    const dryRunResponse = await request(app.server)
      .put("/api/connections/mysql-aliyun/enabled-tables")
      .send({
        dryRun: true,
        enabledTables: ["dataforai.superstore_orders", "dataforai.superstore_people"]
      })
      .expect(200);
    const proposed = dryRunResponse.body.data.proposedYaml as string;

    const writeResponse = await request(app.server)
      .put("/api/connections/mysql-aliyun/enabled-tables")
      .send({
        dryRun: false,
        enabledTables: ["dataforai.superstore_orders", "dataforai.superstore_people"]
      })
      .expect(200);
    expect(writeResponse.body.data.written).toBe(true);
    const written = await readFile(path.join(projectRoot, "ktx.yaml"), "utf8");

    // dryRun and write should produce the same body (modulo final newline).
    expect(written.replace(/\s+$/g, "")).toBe(proposed.replace(/\s+$/g, ""));
    await app.close();
  });
});
