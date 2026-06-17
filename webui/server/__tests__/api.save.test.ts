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

const schemaRelPath = "semantic-layer/mysql-aliyun/_schema/yihe_poc_demo.yaml";
const schemaYaml = `tables:
  accrual_demo:
    table: yihe_poc_demo.accrual_demo
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
      .put("/api/sources/mysql-aliyun/yihe_poc_demo/accrual_demo")
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
      .put("/api/sources/mysql-aliyun/yihe_poc_demo/accrual_demo")
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
    expect(validateSource).toHaveBeenCalledWith(projectRoot, "mysql-aliyun", "yihe_poc_demo", "accrual_demo");
    await expect(readFile(path.join(projectRoot, schemaRelPath), "utf8")).resolves.toContain("human: Human description.");
    await expect(readFile(path.join(projectRoot, "semantic-layer", "mysql-aliyun", "accrual_demo.yaml"), "utf8")).resolves.toContain("grain:");
    await app.close();
  });

  it("rejects unsafe source path segments with the forbidden-path envelope", async () => {
    const app = buildServer();
    await app.ready();
    const response = await request(app.server)
      .put("/api/sources/bad..conn/yihe_poc_demo/accrual_demo")
      .send({ dryRun: false, patch: { tableDescription: "Nope" } })
      .expect(403);

    expect(response.body).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN_PATH" }
    });
    await app.close();
  });
});
