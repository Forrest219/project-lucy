import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// M17 mirror of the M14 ingest-route defense: the WebUI catalog-asset routes
// must never shell out to the ktx CLI. Mock the whole ktx module so any
// accidental call to testConnection, runIngest, or validateSource throws and
// surfaces in the test output.
vi.mock("../ktx", async () => {
  const actual = await vi.importActual<typeof import("../ktx")>("../ktx");
  const failIfCalled = () => {
    throw new Error("M17: WebUI must not call ktx helpers from /api/catalog/assets/*");
  };
  return {
    ...actual,
    runIngest: vi.fn(failIfCalled),
    testConnection: vi.fn(failIfCalled),
    validateSource: vi.fn(failIfCalled)
  };
});

let projectRoot: string;
let auditDbPath: string;
let previousRoot: string | undefined;
let previousAuditDb: string | undefined;

async function makeProject(
  yaml: string,
  manifestFiles: Record<string, string> = {}
): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lucy-api-catalog-assets-"));
  await writeFile(path.join(root, "ktx.yaml"), yaml, "utf8");
  await mkdir(path.join(root, ".ktx-ui"), { recursive: true });
  const connId = "demo-mysql";
  const dir = path.join(root, "semantic-layer", connId, "_schema");
  await mkdir(dir, { recursive: true });
  for (const [name, content] of Object.entries(manifestFiles)) {
    await writeFile(path.join(dir, `${name}.yaml`), content, "utf8");
  }
  return root;
}

beforeEach(async () => {
  vi.resetModules();
  previousRoot = process.env.KTX_PROJECT_ROOT;
  previousAuditDb = process.env.LUCY_AUDIT_DB;
  vi.clearAllMocks();
});

afterEach(async () => {
  if (previousRoot === undefined) {
    delete process.env.KTX_PROJECT_ROOT;
  } else {
    process.env.KTX_PROJECT_ROOT = previousRoot;
  }
  if (previousAuditDb === undefined) {
    delete process.env.LUCY_AUDIT_DB;
  } else {
    process.env.LUCY_AUDIT_DB = previousAuditDb;
  }
  if (projectRoot) {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

async function buildFreshServer() {
  const { buildServer } = await import("../index");
  return buildServer();
}

function baseYaml(): string {
  return `connections:
  demo-mysql:
    driver: mysql
    schemas:
      - dataforai
      - openclaw_db
    enabled_tables:
      - dataforai.superstore_orders
`;
}

const SAMPLE_MANIFEST = "tables:\n  customers:\n    table: openclaw_db.customers\n";

describe("POST /api/catalog/assets/validate", () => {
  it("accepts canonical assetKind schema_manifest", async () => {
    projectRoot = await makeProject(baseYaml());
    auditDbPath = path.join(projectRoot, ".ktx-ui", "audit.sqlite");
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const app = await buildFreshServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/catalog/assets/validate")
      .send({
        connectionId: "demo-mysql",
        schema: "openclaw_db",
        assetKind: "schema_manifest",
        filename: "openclaw_db.yaml",
        content: SAMPLE_MANIFEST
      })
      .expect(200);

    expect(res.body.data.valid).toBe(true);
    expect(res.body.data.assetKind).toBe("schema_manifest");
    expect(res.body.data.assetType).toBe("schemaManifest");
    await app.close();
  });

  it("returns valid payload without writing the file", async () => {
    projectRoot = await makeProject(baseYaml());
    auditDbPath = path.join(projectRoot, ".ktx-ui", "audit.sqlite");
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const app = await buildFreshServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/catalog/assets/validate")
      .send({
        connectionId: "demo-mysql",
        schema: "openclaw_db",
        assetKind: "schema_manifest",
        filename: "openclaw_db.yaml",
        content: SAMPLE_MANIFEST
      })
      .expect(200);

    expect(res.body.ok).toBe(true);
    const data = res.body.data;
    expect(data.valid).toBe(true);
    expect(data.assetKind).toBe("schema_manifest");
    expect(data.assetType).toBe("schemaManifest");
    expect(data.targetPath).toBe("semantic-layer/demo-mysql/_schema/openclaw_db.yaml");
    expect(data.tables).toBe(1);
    expect(data.tableNames).toEqual(["customers"]);
    expect(data.exists).toBe(false);
    expect(data.warnings).toEqual([]);
    expect(data.errors).toEqual([]);
    expect(data.sizeBytes).toBe(Buffer.byteLength(SAMPLE_MANIFEST, "utf8"));
    expect(typeof data.sha256).toBe("string");
    expect(data.sha256).toMatch(/^[0-9a-f]{64}$/);

    // File must not have been written.
    const manifestPath = path.join(
      projectRoot,
      "semantic-layer/demo-mysql/_schema/openclaw_db.yaml"
    );
    await expect(readFile(manifestPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });

    await app.close();
  });

  it("reports UNKNOWN_CONNECTION when the connectionId is not declared in ktx.yaml", async () => {
    projectRoot = await makeProject(baseYaml());
    auditDbPath = path.join(projectRoot, ".ktx-ui", "audit.sqlite");
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const app = await buildFreshServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/catalog/assets/validate")
      .send({
        connectionId: "ghost-conn",
        schema: "openclaw_db",
        assetType: "schemaManifest",
        filename: "openclaw_db.yaml",
        content: SAMPLE_MANIFEST
      })
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(res.body.data.valid).toBe(false);
    const codes = (res.body.data.errors as Array<{ code: string }>).map((e) => e.code);
    expect(codes).toContain("UNKNOWN_CONNECTION");
    await app.close();
  });

  it("reports SCHEMA_NOT_CONFIGURED when the schema is not in the connection's list", async () => {
    projectRoot = await makeProject(baseYaml());
    auditDbPath = path.join(projectRoot, ".ktx-ui", "audit.sqlite");
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const app = await buildFreshServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/catalog/assets/validate")
      .send({
        connectionId: "demo-mysql",
        schema: "ghost_schema",
        assetType: "schemaManifest",
        filename: "ghost_schema.yaml",
        content: SAMPLE_MANIFEST
      })
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(res.body.data.valid).toBe(false);
    const codes = (res.body.data.errors as Array<{ code: string }>).map((e) => e.code);
    expect(codes).toContain("SCHEMA_NOT_CONFIGURED");
    await app.close();
  });

  it("rejects filename with the wrong extension", async () => {
    projectRoot = await makeProject(baseYaml());
    auditDbPath = path.join(projectRoot, ".ktx-ui", "audit.sqlite");
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const app = await buildFreshServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/catalog/assets/validate")
      .send({
        connectionId: "demo-mysql",
        schema: "openclaw_db",
        assetType: "schemaManifest",
        filename: "openclaw_db.txt",
        content: SAMPLE_MANIFEST
      })
      .expect(200);

    expect(res.body.data.valid).toBe(false);
    const codes = (res.body.data.errors as Array<{ code: string }>).map((e) => e.code);
    expect(codes).toContain("INVALID_FILENAME");
    await app.close();
  });

  it("reports ASSET_KIND_UNSUPPORTED instead of coercing unknown asset types", async () => {
    projectRoot = await makeProject(baseYaml());
    auditDbPath = path.join(projectRoot, ".ktx-ui", "audit.sqlite");
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const app = await buildFreshServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/catalog/assets/validate")
      .send({
        connectionId: "demo-mysql",
        schema: "openclaw_db",
        assetType: "overlayYaml",
        filename: "openclaw_db.yaml",
        content: SAMPLE_MANIFEST
      })
      .expect(200);

    expect(res.body.data.valid).toBe(false);
    const codes = (res.body.data.errors as Array<{ code: string }>).map((e) => e.code);
    expect(codes).toContain("ASSET_KIND_UNSUPPORTED");
    await app.close();
  });

  it("reports ASSET_KIND_ROUTE_MISMATCH for semantic overlay on the catalog upload route", async () => {
    projectRoot = await makeProject(baseYaml());
    auditDbPath = path.join(projectRoot, ".ktx-ui", "audit.sqlite");
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const app = await buildFreshServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/catalog/assets/validate")
      .send({
        connectionId: "demo-mysql",
        schema: "openclaw_db",
        assetKind: "semantic_overlay",
        filename: "openclaw_db.yaml",
        content: SAMPLE_MANIFEST
      })
      .expect(200);

    expect(res.body.data.valid).toBe(false);
    const codes = (res.body.data.errors as Array<{ code: string }>).map((e) => e.code);
    expect(codes).toContain("ASSET_KIND_ROUTE_MISMATCH");
    await app.close();
  });

  it("reports ASSET_KIND_REQUIRED when no asset kind or legacy asset type is provided", async () => {
    projectRoot = await makeProject(baseYaml());
    auditDbPath = path.join(projectRoot, ".ktx-ui", "audit.sqlite");
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const app = await buildFreshServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/catalog/assets/validate")
      .send({
        connectionId: "demo-mysql",
        schema: "openclaw_db",
        filename: "openclaw_db.yaml",
        content: SAMPLE_MANIFEST
      })
      .expect(200);

    expect(res.body.data.valid).toBe(false);
    const codes = (res.body.data.errors as Array<{ code: string }>).map((e) => e.code);
    expect(codes).toContain("ASSET_KIND_REQUIRED");
    await app.close();
  });

  it("rejects oversize content (over 512 KB)", async () => {
    projectRoot = await makeProject(baseYaml());
    auditDbPath = path.join(projectRoot, ".ktx-ui", "audit.sqlite");
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const app = await buildFreshServer();
    await app.ready();
    const big = "x".repeat(513 * 1024);
    const res = await request(app.server)
      .post("/api/catalog/assets/validate")
      .send({
        connectionId: "demo-mysql",
        schema: "openclaw_db",
        assetType: "schemaManifest",
        filename: "openclaw_db.yaml",
        content: big
      })
      .expect(200);

    expect(res.body.data.valid).toBe(false);
    const codes = (res.body.data.errors as Array<{ code: string }>).map((e) => e.code);
    expect(codes).toContain("FILE_TOO_LARGE");
    await app.close();
  });

  it("rejects YAML that fails to parse", async () => {
    projectRoot = await makeProject(baseYaml());
    auditDbPath = path.join(projectRoot, ".ktx-ui", "audit.sqlite");
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const app = await buildFreshServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/catalog/assets/validate")
      .send({
        connectionId: "demo-mysql",
        schema: "openclaw_db",
        assetType: "schemaManifest",
        filename: "openclaw_db.yaml",
        content: ":\n: this is broken yaml [\n"
      })
      .expect(200);

    expect(res.body.data.valid).toBe(false);
    const codes = (res.body.data.errors as Array<{ code: string }>).map((e) => e.code);
    expect(codes).toContain("YAML_PARSE_FAILED");
    await app.close();
  });

  it("rejects semantic overlay YAML in the Schema Manifest upload route", async () => {
    projectRoot = await makeProject(baseYaml());
    auditDbPath = path.join(projectRoot, ".ktx-ui", "audit.sqlite");
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const overlayYaml = [
      "name: superstore_orders",
      "grain:",
      "  - order_id",
      "measures:",
      "  - name: total_sales",
      "    expr: sum(sales)",
      ""
    ].join("\n");

    const app = await buildFreshServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/catalog/assets/validate")
      .send({
        connectionId: "demo-mysql",
        schema: "openclaw_db",
        assetKind: "schema_manifest",
        filename: "superstore_orders.yaml",
        content: overlayYaml
      })
      .expect(200);

    expect(res.body.data.valid).toBe(false);
    const errors = res.body.data.errors as Array<{ code: string; message: string }>;
    expect(errors.map((e) => e.code)).toContain("OVERLAY_FIELD_IN_MANIFEST");
    expect(errors.map((e) => e.message).join("\n")).toContain("semantic overlay");
    await app.close();
  });

  it("rejects YAML without tables as not a Schema Manifest", async () => {
    projectRoot = await makeProject(baseYaml());
    auditDbPath = path.join(projectRoot, ".ktx-ui", "audit.sqlite");
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const app = await buildFreshServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/catalog/assets/validate")
      .send({
        connectionId: "demo-mysql",
        schema: "openclaw_db",
        assetKind: "schema_manifest",
        filename: "openclaw_db.yaml",
        content: "name: openclaw_db\n"
      })
      .expect(200);

    expect(res.body.data.valid).toBe(false);
    const codes = (res.body.data.errors as Array<{ code: string }>).map((e) => e.code);
    expect(codes).toContain("SCHEMA_MANIFEST_EXPECTED");
    await app.close();
  });

  it("reports TARGET_EXISTS warning when the file already exists", async () => {
    projectRoot = await makeProject(baseYaml(), {
      openclaw_db: SAMPLE_MANIFEST
    });
    auditDbPath = path.join(projectRoot, ".ktx-ui", "audit.sqlite");
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const app = await buildFreshServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/catalog/assets/validate")
      .send({
        connectionId: "demo-mysql",
        schema: "openclaw_db",
        assetType: "schemaManifest",
        filename: "openclaw_db.yaml",
        content: SAMPLE_MANIFEST
      })
      .expect(200);

    expect(res.body.data.valid).toBe(true);
    expect(res.body.data.exists).toBe(true);
    const warnCodes = (res.body.data.warnings as Array<{ code: string }>).map((w) => w.code);
    expect(warnCodes).toContain("TARGET_EXISTS");
    await app.close();
  });

  it("rejects with PATH_NOT_ALLOWED when the target file is a symlink", async () => {
    projectRoot = await makeProject(baseYaml());
    auditDbPath = path.join(projectRoot, ".ktx-ui", "audit.sqlite");
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_AUDIT_DB = auditDbPath;

    // Create a symlink in place of the target manifest.
    const targetLink = path.join(
      projectRoot,
      "semantic-layer/demo-mysql/_schema/openclaw_db.yaml"
    );
    await writeFile(path.join(projectRoot, "real-target.yaml"), SAMPLE_MANIFEST, "utf8");
    await symlink(path.join(projectRoot, "real-target.yaml"), targetLink);

    const app = await buildFreshServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/catalog/assets/validate")
      .send({
        connectionId: "demo-mysql",
        schema: "openclaw_db",
        assetType: "schemaManifest",
        filename: "openclaw_db.yaml",
        content: SAMPLE_MANIFEST
      })
      .expect(200);

    expect(res.body.data.valid).toBe(false);
    const codes = (res.body.data.errors as Array<{ code: string }>).map((e) => e.code);
    expect(codes).toContain("PATH_NOT_ALLOWED");
    await app.close();
  });

  it("does not create missing target directories during validate", async () => {
    projectRoot = await makeProject(baseYaml());
    await rm(path.join(projectRoot, "semantic-layer/demo-mysql"), {
      recursive: true,
      force: true
    });
    auditDbPath = path.join(projectRoot, ".ktx-ui", "audit.sqlite");
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const app = await buildFreshServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/catalog/assets/validate")
      .send({
        connectionId: "demo-mysql",
        schema: "openclaw_db",
        assetType: "schemaManifest",
        filename: "openclaw_db.yaml",
        content: SAMPLE_MANIFEST
      })
      .expect(200);

    expect(res.body.data.valid).toBe(true);
    await expect(
      lstat(path.join(projectRoot, "semantic-layer/demo-mysql"))
    ).rejects.toMatchObject({ code: "ENOENT" });
    await app.close();
  });

  it("rejects with PATH_NOT_ALLOWED when a target parent component is a symlink", async () => {
    projectRoot = await makeProject(baseYaml());
    await rm(path.join(projectRoot, "semantic-layer/demo-mysql"), {
      recursive: true,
      force: true
    });
    const outside = path.join(projectRoot, "outside-demo-mysql");
    await mkdir(path.join(outside, "_schema"), { recursive: true });
    await symlink(outside, path.join(projectRoot, "semantic-layer/demo-mysql"));
    auditDbPath = path.join(projectRoot, ".ktx-ui", "audit.sqlite");
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const app = await buildFreshServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/catalog/assets/validate")
      .send({
        connectionId: "demo-mysql",
        schema: "openclaw_db",
        assetType: "schemaManifest",
        filename: "openclaw_db.yaml",
        content: SAMPLE_MANIFEST
      })
      .expect(200);

    expect(res.body.data.valid).toBe(false);
    const codes = (res.body.data.errors as Array<{ code: string }>).map((e) => e.code);
    expect(codes).toContain("PATH_NOT_ALLOWED");
    await app.close();
  });
});

describe("POST /api/catalog/assets/upload", () => {
  it("writes the manifest, records an audit row, and triggers catalog reload", async () => {
    projectRoot = await makeProject(baseYaml());
    auditDbPath = path.join(projectRoot, ".ktx-ui", "audit.sqlite");
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const app = await buildFreshServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/catalog/assets/upload")
      .send({
        connectionId: "demo-mysql",
        schema: "openclaw_db",
        assetType: "schemaManifest",
        filename: "openclaw_db.yaml",
        content: SAMPLE_MANIFEST
      })
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(res.body.data.uploaded).toBe(true);
    const record = res.body.data.record;
    expect(record.connectionId).toBe("demo-mysql");
    expect(record.schema).toBe("openclaw_db");
    expect(record.assetKind).toBe("schema_manifest");
    expect(record.assetType).toBe("schemaManifest");
    expect(record.tables).toBe(1);
    expect(record.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(record.overwritten).toBe(false);
    expect(record.targetPath).toBe("semantic-layer/demo-mysql/_schema/openclaw_db.yaml");

    // File is on disk.
    const onDisk = await readFile(
      path.join(projectRoot, record.targetPath),
      "utf8"
    );
    expect(onDisk).toBe(SAMPLE_MANIFEST);

    // Audit sidecar was written.
    const sidecarPath = path.join(projectRoot, ".ktx-ui/catalog-asset-uploads.json");
    const sidecar = JSON.parse(await readFile(sidecarPath, "utf8")) as {
      records: Array<{ id: string; targetPath: string }>;
    };
    expect(sidecar.records).toHaveLength(1);
    expect(sidecar.records[0]?.targetPath).toBe(record.targetPath);

    // Reload is the new static catalog run.
    const reload = res.body.data.reload;
    expect(res.body.data.validation.assetKind).toBe("schema_manifest");
    expect(reload.source).toBe("static-yaml");
    expect(reload.requestedConnectionId).toBe("demo-mysql");
    expect(reload.requestedSchema).toBe("openclaw_db");
    expect(record.reloadRunId).toBe(reload.id);

    // No `ktx ingest` was ever invoked.
    const ktx = await import("../ktx");
    expect(vi.mocked(ktx.runIngest)).not.toHaveBeenCalled();

    await app.close();
  });

  it("returns 409 and does not modify the file when the target exists and confirmOverwrite is missing", async () => {
    projectRoot = await makeProject(baseYaml(), {
      openclaw_db: "tables: {}\n"
    });
    auditDbPath = path.join(projectRoot, ".ktx-ui", "audit.sqlite");
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const beforeContent = await readFile(
      path.join(projectRoot, "semantic-layer/demo-mysql/_schema/openclaw_db.yaml"),
      "utf8"
    );

    const app = await buildFreshServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/catalog/assets/upload")
      .send({
        connectionId: "demo-mysql",
        schema: "openclaw_db",
        assetType: "schemaManifest",
        filename: "openclaw_db.yaml",
        content: SAMPLE_MANIFEST
      })
      .expect(409);

    expect(res.body.ok).toBe(false);
    const code = (res.body.error as { code?: string }).code;
    expect(["PATH_NOT_ALLOWED", "TARGET_EXISTS", "OVERWRITE_REQUIRED"]).toContain(code);

    // File unchanged.
    const afterContent = await readFile(
      path.join(projectRoot, "semantic-layer/demo-mysql/_schema/openclaw_db.yaml"),
      "utf8"
    );
    expect(afterContent).toBe(beforeContent);

    // No sidecar was written.
    const sidecarPath = path.join(projectRoot, ".ktx-ui/catalog-asset-uploads.json");
    await expect(readFile(sidecarPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await app.close();
  });

  it("overwrites and records overwritten=true when confirmOverwrite is true", async () => {
    projectRoot = await makeProject(baseYaml(), {
      openclaw_db: "tables: {}\n"
    });
    auditDbPath = path.join(projectRoot, ".ktx-ui", "audit.sqlite");
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const app = await buildFreshServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/catalog/assets/upload")
      .send({
        connectionId: "demo-mysql",
        schema: "openclaw_db",
        assetType: "schemaManifest",
        filename: "openclaw_db.yaml",
        content: SAMPLE_MANIFEST,
        confirmOverwrite: true
      })
      .expect(200);

    expect(res.body.data.record.overwritten).toBe(true);
    const onDisk = await readFile(
      path.join(projectRoot, "semantic-layer/demo-mysql/_schema/openclaw_db.yaml"),
      "utf8"
    );
    expect(onDisk).toBe(SAMPLE_MANIFEST);
    await app.close();
  });

  it("refuses to overwrite when the existing target is a symlink, even with confirmOverwrite=true", async () => {
    projectRoot = await makeProject(baseYaml());
    auditDbPath = path.join(projectRoot, ".ktx-ui", "audit.sqlite");
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const linkPath = path.join(
      projectRoot,
      "semantic-layer/demo-mysql/_schema/openclaw_db.yaml"
    );
    await writeFile(path.join(projectRoot, "real-target.yaml"), "tables: {}\n", "utf8");
    await symlink(path.join(projectRoot, "real-target.yaml"), linkPath);

    const app = await buildFreshServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/catalog/assets/upload")
      .send({
        connectionId: "demo-mysql",
        schema: "openclaw_db",
        assetType: "schemaManifest",
        filename: "openclaw_db.yaml",
        content: SAMPLE_MANIFEST,
        confirmOverwrite: true
      })
      .expect(403);

    expect(res.body.ok).toBe(false);
    const code = (res.body.error as { code?: string }).code;
    expect(code).toBe("PATH_NOT_ALLOWED");

    // The real target file behind the symlink must remain unchanged.
    const real = await readFile(path.join(projectRoot, "real-target.yaml"), "utf8");
    expect(real).toBe("tables: {}\n");
    await app.close();
  });
});

describe("GET /api/catalog/assets/uploads", () => {
  it("returns the latest record and lastBySchema for the connection.schema key", async () => {
    projectRoot = await makeProject(baseYaml());
    auditDbPath = path.join(projectRoot, ".ktx-ui", "audit.sqlite");
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const app = await buildFreshServer();
    await app.ready();
    await request(app.server)
      .post("/api/catalog/assets/upload")
      .send({
        connectionId: "demo-mysql",
        schema: "openclaw_db",
        assetType: "schemaManifest",
        filename: "openclaw_db.yaml",
        content: SAMPLE_MANIFEST
      })
      .expect(200);

    const res = await request(app.server)
      .get("/api/catalog/assets/uploads")
      .expect(200);

    expect(res.body.ok).toBe(true);
    const records = res.body.data.records as Array<{ targetPath: string }>;
    expect(records.length).toBeGreaterThan(0);
    const lastBySchema = res.body.data.lastBySchema as Record<
      string,
      { targetPath: string }
    >;
    const key = "demo-mysql.openclaw_db";
    expect(lastBySchema[key]).toBeDefined();
    expect(lastBySchema[key]?.targetPath).toBe(
      "semantic-layer/demo-mysql/_schema/openclaw_db.yaml"
    );
    await app.close();
  });

  it("caps the records at 50", async () => {
    projectRoot = await makeProject(baseYaml());
    auditDbPath = path.join(projectRoot, ".ktx-ui", "audit.sqlite");
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_AUDIT_DB = auditDbPath;

    // Seed 55 records directly into the sidecar.
    const sidecar = {
      version: 1,
      records: Array.from({ length: 55 }, (_, i) => ({
        id: `rec_${i}`,
        createdAt: new Date(2026, 0, 1, 0, 0, i).toISOString(),
        connectionId: "demo-mysql",
        schema: "openclaw_db",
        assetType: "schemaManifest" as const,
        targetPath: "semantic-layer/demo-mysql/_schema/openclaw_db.yaml",
        originalFilename: "openclaw_db.yaml",
        sizeBytes: 10,
        sha256: "0".repeat(64),
        tables: 0,
        overwritten: false,
        warnings: []
      }))
    };
    await mkdir(path.join(projectRoot, ".ktx-ui"), { recursive: true });
    await writeFile(
      path.join(projectRoot, ".ktx-ui/catalog-asset-uploads.json"),
      JSON.stringify(sidecar),
      "utf8"
    );

    const app = await buildFreshServer();
    await app.ready();
    const res = await request(app.server)
      .get("/api/catalog/assets/uploads")
      .expect(200);

    expect(res.body.data.records.length).toBeLessThanOrEqual(50);
    await app.close();
  });
});
