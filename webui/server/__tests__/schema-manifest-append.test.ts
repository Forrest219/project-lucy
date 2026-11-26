import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../index";
import { validateSource } from "../ktx";
import { resolveSchemaManifestPath, SchemaManifestNotFoundError, AmbiguousSchemaError } from "../semantic-layer";

vi.mock("../ktx", () => ({
  validateSource: vi.fn(async () => ({
    ok: true,
    exitCode: 0,
    stdout: "Valid semantic-layer source",
    stderr: "",
    issues: []
  }))
}));

// macOS APFS 大小写不敏感，无法落盘两个仅大小写不同的文件；
// readdir 通过 vi.mock 代理，歧义用例在其上注入两个大小写变体。
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, readdir: vi.fn(actual.readdir) };
});

let projectRoot: string;
let previousRoot: string | undefined;
let previousContentRoot: string | undefined;

const manifestRelPath = "semantic-layer/sql_server/_schema/BIDM.yaml";
const manifestYaml = `tables:
  dm_cpu_asset_cost:
    table: dbo.dm_cpu_asset_cost
    columns:
      - name: id
        type: number
    descriptions:
      ai: Existing table.
  dm_disk_usage:
    table: dbo.dm_disk_usage
    columns:
      - name: id
        type: number
  hs_sy_company_metric:
    table: BIDW.dbo.hs_sy_company_metric
    columns:
      - name: company_id
        type: number
`;

const appendTableYaml = `table: dbo.v_token_income_unified
columns:
  - name: token_id
    type: number
  - name: income
    type: number
descriptions:
  ai: Token income unified view.
`;

function makeProject() {
  return (async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ktx-webui-schema-append-"));
    await mkdir(path.join(root, "semantic-layer", "sql_server", "_schema"), { recursive: true });
    await writeFile(path.join(root, "ktx.yaml"), "connections: {}\n", "utf8");
    await writeFile(path.join(root, manifestRelPath), manifestYaml, "utf8");
    return root;
  })();
}

beforeEach(async () => {
  projectRoot = await makeProject();
  previousRoot = process.env.KTX_PROJECT_ROOT;
  previousContentRoot = process.env.LUCY_CONTENT_ROOT;
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_CONTENT_ROOT = ".";
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

describe("POST /api/schema-manifests/:conn/:schema/tables (P1-90)", () => {
  it("SC-01: dryRun (default) previews the appended node without writing disk", async () => {
    const app = buildServer();
    await app.ready();
    const first = await request(app.server)
      .post("/api/schema-manifests/sql_server/BIDM/tables")
      .send({ table: "v_token_income_unified", yaml: appendTableYaml })
      .expect(200);

    expect(first.body.data.noChanges).toBe(false);
    expect(first.body.data.files).toHaveLength(1);
    expect(first.body.data.files[0].filePath).toBe(manifestRelPath);
    expect(first.body.data.diff).toContain("v_token_income_unified");
    expect(first.body.data.diff).toContain("dbo.v_token_income_unified");
    expect(first.body.data.warnings).toEqual([]);

    // 同一 payload 重复 dryRun 结果一致。
    const second = await request(app.server)
      .post("/api/schema-manifests/sql_server/BIDM/tables")
      .send({ table: "v_token_income_unified", yaml: appendTableYaml })
      .expect(200);
    expect(second.body.data.diff).toBe(first.body.data.diff);

    await expect(readFile(path.join(projectRoot, manifestRelPath), "utf8")).resolves.toBe(manifestYaml);
    await app.close();
  });

  it("SC-02: appends only the new table node, keeps existing tables byte-identical, and exposes the table via /api/sources", async () => {
    const app = buildServer();
    await app.ready();
    const response = await request(app.server)
      .post("/api/schema-manifests/sql_server/bidm/tables")
      .send({ dryRun: false, table: "v_token_income_unified", yaml: appendTableYaml })
      .expect(200);

    expect(response.body.data).toMatchObject({
      written: true,
      noChanges: false,
      writtenFiles: [manifestRelPath]
    });
    expect(response.body.data.warnings).toEqual([]);
    expect(response.body.data.nextSteps).toEqual([
      "PUT /api/connections/sql_server/enabled-tables",
      "POST /api/semantic-assets/reindex"
    ]);
    expect(Array.isArray(response.body.data.changedFiles)).toBe(true);
    expect(response.body.data.validation).toBeDefined();

    const written = await readFile(path.join(projectRoot, manifestRelPath), "utf8");
    expect(written).toContain("v_token_income_unified");
    expect(written).toContain("BIDW.dbo.hs_sy_company_metric");
    // 既有表节点逐字节不动：解析后逐一比对既有表节点。
    const { parse } = await import("yaml");
    const before = parse(manifestYaml) as { tables: Record<string, unknown> };
    const after = parse(written) as { tables: Record<string, unknown> };
    expect(Object.keys(after.tables).sort()).toEqual([...Object.keys(before.tables), "v_token_income_unified"].sort());
    for (const key of Object.keys(before.tables)) {
      expect(after.tables[key]).toEqual(before.tables[key]);
    }

    // /api/sources 立即可见新表。
    const sources = await request(app.server).get("/api/sources").expect(200);
    const names = sources.body.data.tables.map((t: { conn: string; table: string }) => `${t.conn}/${t.table}`);
    expect(names).toContain("sql_server/v_token_income_unified");
    await app.close();
  });

  it("SC-03: rejects appending an existing table with 409 and points at import; manifest bytes unchanged", async () => {
    const app = buildServer();
    await app.ready();
    const response = await request(app.server)
      .post("/api/schema-manifests/sql_server/BIDM/tables")
      .send({ dryRun: false, table: "dm_cpu_asset_cost", yaml: "table: dbo.dm_cpu_asset_cost\ncolumns:\n  - name: id\n    type: number\n" })
      .expect(409);

    expect(response.body.error.code).toBe("TABLE_ALREADY_EXISTS");
    expect(response.body.data.nextSteps).toEqual(["POST /api/sources/sql_server/BIDM/dm_cpu_asset_cost/import"]);
    await expect(readFile(path.join(projectRoot, manifestRelPath), "utf8")).resolves.toBe(manifestYaml);
    await app.close();
  });

  it("SC-04: rejects unknown body fields, overlay-only column keys, name mismatch, bad YAML and non-whitelist node keys", async () => {
    const app = buildServer();
    await app.ready();

    const unknownField = await request(app.server)
      .post("/api/schema-manifests/sql_server/BIDM/tables")
      .send({ table: "t1", yaml: appendTableYaml, confirmOverwrite: true })
      .expect(400);
    expect(unknownField.body.error.code).toBe("INVALID_SCHEMA_APPEND_BODY");
    expect(Array.isArray(unknownField.body.data.nextSteps)).toBe(true);

    const overlayOnly = `${appendTableYaml}
derived_marker: 1`;
    // 先构造含 expr 列的节点
    const exprYaml = `table: dbo.v_expr
columns:
  - name: margin
    expr: income - cost
`;
    const exprRes = await request(app.server)
      .post("/api/schema-manifests/sql_server/BIDM/tables")
      .send({ table: "v_expr", yaml: exprYaml })
      .expect(422);
    expect(exprRes.body.error.code).toBe("OVERLAY_ONLY_KEY");

    const mismatch = await request(app.server)
      .post("/api/schema-manifests/sql_server/BIDM/tables")
      .send({ table: "v_token_income_unified", yaml: "table: dbo.different_name\ncolumns:\n  - name: id\n    type: number\n" })
      .expect(422);
    expect(mismatch.body.error.code).toBe("TABLE_NAME_MISMATCH");

    const badYaml = await request(app.server)
      .post("/api/schema-manifests/sql_server/BIDM/tables")
      .send({ table: "v_bad", yaml: "table: [unclosed" })
      .expect(422);
    expect(badYaml.body.error.code).toBe("YAML_PARSE_ERROR");

    const unknownKey = await request(app.server)
      .post("/api/schema-manifests/sql_server/BIDM/tables")
      .send({ table: "v_extra", yaml: "table: dbo.v_extra\nnot_a_real_key: 1\ncolumns:\n  - name: id\n    type: number\n" })
      .expect(422);
    expect(unknownKey.body.error.code).toBe("SCHEMA_APPEND_UNKNOWN_KEY");
    void overlayOnly;

    // 全部拒绝路径不落盘。
    await expect(readFile(path.join(projectRoot, manifestRelPath), "utf8")).resolves.toBe(manifestYaml);
    await app.close();
  });

  it("SC-05: import points unregistered tables at the append endpoint; missing schema is 404 not 500", async () => {
    const app = buildServer();
    await app.ready();

    const importMissing = await request(app.server)
      .post("/api/sources/sql_server/BIDM/v_missing_table/import")
      .send({ yaml: "table: dbo.v_missing_table\ncolumns:\n  - name: id\n    type: number\n" })
      .expect(404);
    expect(importMissing.body.error.code).toBe("SOURCE_NOT_FOUND");
    expect(importMissing.body.data.nextSteps).toEqual(["POST /api/schema-manifests/sql_server/BIDM/tables"]);

    const getMissing = await request(app.server).get("/api/sources/sql_server/NO_SUCH_SCHEMA/some_table").expect(404);
    expect(getMissing.body.error.code).toBe("SCHEMA_MANIFEST_NOT_FOUND");
    const putMissing = await request(app.server)
      .put("/api/sources/sql_server/NO_SUCH_SCHEMA/some_table")
      .send({ dryRun: true, patch: {} })
      .expect(404);
    expect(putMissing.body.error.code).toBe("SCHEMA_MANIFEST_NOT_FOUND");
    const importMissingSchema = await request(app.server)
      .post("/api/sources/sql_server/NO_SUCH_SCHEMA/some_table/import")
      .send({ yaml: "table: dbo.x\n" })
      .expect(404);
    expect(importMissingSchema.body.error.code).toBe("SCHEMA_MANIFEST_NOT_FOUND");
    const appendMissingSchema = await request(app.server)
      .post("/api/schema-manifests/sql_server/NO_SUCH_SCHEMA/tables")
      .send({ table: "x", yaml: "table: dbo.x\n" })
      .expect(404);
    expect(appendMissingSchema.body.error.code).toBe("SCHEMA_MANIFEST_NOT_FOUND");
    await app.close();
  });

  it("SC-06: three-part physical name is preserved verbatim; case-insensitive schema resolution across all four paths", async () => {
    const app = buildServer();
    await app.ready();
    // 四路径均以小写 schema 名命中 BIDM.yaml。
    const got = await request(app.server).get("/api/sources/sql_server/bidm/hs_sy_company_metric").expect(200);
    expect(got.body.data.model.table).toBe("hs_sy_company_metric");
    await request(app.server)
      .put("/api/sources/sql_server/bidm/hs_sy_company_metric")
      .send({ dryRun: true, patch: {} })
      .expect(200);
    await request(app.server)
      .post("/api/sources/sql_server/bidm/hs_sy_company_metric/import")
      .send({ yaml: "table: BIDW.dbo.hs_sy_company_metric\n" })
      .expect(200);

    const response = await request(app.server)
      .post("/api/schema-manifests/sql_server/bidm/tables")
      .send({ dryRun: false, table: "v_token_income_unified", yaml: appendTableYaml })
      .expect(200);
    expect(response.body.data.written).toBe(true);
    const written = await readFile(path.join(projectRoot, manifestRelPath), "utf8");
    expect(written).toContain("table: dbo.v_token_income_unified");
    await app.close();
  });

  it("SC-06: warns EXISTING_STANDALONE_SHADOW when a same-name standalone file exists, without blocking the append", async () => {
    await writeFile(
      path.join(projectRoot, "semantic-layer", "sql_server", "v_token_income_unified.yaml"),
      `name: v_token_income_unified
table: BIDM.dbo.v_token_income_unified
grain:
  - token_id
`,
      "utf8"
    );
    const app = buildServer();
    await app.ready();
    const dryRun = await request(app.server)
      .post("/api/schema-manifests/sql_server/BIDM/tables")
      .send({ table: "v_token_income_unified", yaml: appendTableYaml })
      .expect(200);
    expect(dryRun.body.data.warnings).toEqual([
      {
        code: "EXISTING_STANDALONE_SHADOW",
        file: "semantic-layer/sql_server/v_token_income_unified.yaml",
        hint: expect.stringContaining("standalone")
      }
    ]);

    const response = await request(app.server)
      .post("/api/schema-manifests/sql_server/BIDM/tables")
      .send({ dryRun: false, table: "v_token_income_unified", yaml: appendTableYaml })
      .expect(200);
    expect(response.body.data.written).toBe(true);
    expect(response.body.data.warnings).toHaveLength(1);
    expect(response.body.data.warnings[0].code).toBe("EXISTING_STANDALONE_SHADOW");
    const written = await readFile(path.join(projectRoot, manifestRelPath), "utf8");
    expect(written).toContain("v_token_income_unified");
    await app.close();
  });
});

describe("resolveSchemaManifestPath (P1-90 unit)", () => {
  it("matches case-insensitively and returns the on-disk name", async () => {
    const rel = await resolveSchemaManifestPath(projectRoot, "sql_server", "bidm");
    expect(rel).toBe(manifestRelPath);
    await expect(resolveSchemaManifestPath(projectRoot, "sql_server", "nope")).rejects.toBeInstanceOf(
      SchemaManifestNotFoundError
    );
  });

  it("reports ambiguity when two case variants coexist", async () => {
    const fsp = await import("node:fs/promises");
    const mocked = vi.mocked(fsp.readdir);
    const delegate = mocked.getMockImplementation();
    mocked.mockImplementation(((dir: unknown, options: unknown) => {
      if (String(dir).includes(path.join("sql_server", "_schema"))) {
        return Promise.resolve([
          { isFile: () => true, name: "BIDM.yaml" },
          { isFile: () => true, name: "bidm.yaml" }
        ] as never);
      }
      return delegate?.(dir as never, options as never) as never;
    }) as never);
    try {
      await expect(resolveSchemaManifestPath(projectRoot, "sql_server", "BIDM")).rejects.toBeInstanceOf(
        AmbiguousSchemaError
      );
    } finally {
      if (delegate) {
        mocked.mockImplementation(delegate as never);
      }
    }
  });
});
