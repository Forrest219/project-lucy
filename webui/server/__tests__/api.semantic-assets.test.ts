// M19 — POST /api/semantic-assets/validate
// Server-computed target paths; never accept client paths. Multi-file payload
// classifies into schemaManifest vs semanticSource based on YAML shape.

import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../index";
import { validateSource, reindexProject } from "../ktx";

// M19 backend guarantees: validate is purely local — no ktx subprocess must
// ever run. Mock the whole ktx module so any accidental call to validateSource
// or reindexProject throws and surfaces in the test output.
vi.mock("../ktx", async () => {
  const actual = await vi.importActual<typeof import("../ktx")>("../ktx");
  const failIfCalled = () => {
    throw new Error("M19: WebUI must not call ktx helpers from /api/semantic-assets/validate");
  };
  return {
    ...actual,
    validateSource: vi.fn(failIfCalled),
    reindexProject: vi.fn(failIfCalled),
    testConnection: vi.fn(failIfCalled),
    runIngest: vi.fn(failIfCalled)
  };
});

let projectRoot: string;
let previousRoot: string | undefined;
let previousAuditDb: string | undefined;

const BASE_KTX_YAML = `connections:
  customer-db:
    driver: mysql
    schemas:
      - chatbi
    enabled_tables:
      - chatbi.ai_metric_international_country_daily
      - chatbi.ai_metric_international_active_user_30d
`;

const MANIFEST_YAML = `tables:
  international_country_metrics:
    table: chatbi.ai_metric_international_country_daily
    columns:
      - name: date
        type: time
      - name: country
        type: string
`;

const OVERLAY_YAML = `name: international_country_metrics
table: chatbi.ai_metric_international_country_daily
grain:
  - date
  - country
measures:
  - name: dau
    expr: sum(dau)
segments:
  - name: valid_rows
    expr: date is not null
`;

async function makeProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lucy-m19-validate-"));
  await writeFile(path.join(root, "ktx.yaml"), BASE_KTX_YAML, "utf8");
  await mkdir(path.join(root, "semantic-layer", "customer-db", "_schema"), { recursive: true });
  await writeFile(
    path.join(root, "semantic-layer", "customer-db", "_schema", "chatbi.yaml"),
    "tables: {}\n",
    "utf8"
  );
  return root;
}

async function buildFreshServer() {
  const { buildServer } = await import("../index");
  return buildServer();
}

function buildStoredZip(entries: Array<{ name: string; data: string }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, "utf8");
    const data = Buffer.from(entry.data, "utf8");
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt32LE(0, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBytes.length, 26);
    localParts.push(localHeader, nameBytes, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt32LE(0, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBytes.length, 28);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBytes);
    offset += localHeader.length + nameBytes.length + data.length;
  }
  const centralStart = offset;
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralStart, 16);
  return Buffer.concat([...localParts, ...centralParts, eocd]);
}

beforeEach(async () => {
  vi.resetModules();
  previousRoot = process.env.KTX_PROJECT_ROOT;
  previousAuditDb = process.env.LUCY_AUDIT_DB;
  vi.clearAllMocks();
});

afterEach(async () => {
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  if (previousAuditDb === undefined) delete process.env.LUCY_AUDIT_DB;
  else process.env.LUCY_AUDIT_DB = previousAuditDb;
  if (projectRoot) await rm(projectRoot, { recursive: true, force: true });
});

describe("POST /api/semantic-assets/validate", () => {
  it("classifies manifest + overlay, computes server-side target paths, and writes no formal file", async () => {
    projectRoot = await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;

    const app = await buildFreshServer();
    await app.ready();

    const res = await request(app.server)
      .post("/api/semantic-assets/validate")
      .send({
        files: [
          { filename: "chatbi.yaml", content: MANIFEST_YAML },
          { filename: "international_country_metrics.yaml", content: OVERLAY_YAML }
        ]
      })
      .expect(200);

    expect(res.body.ok).toBe(true);
    const data = res.body.data;
    expect(data.valid).toBe(true);
    expect(typeof data.validationId).toBe("string");
    expect(data.validationId).toMatch(/^val_/);

    const files = data.files as Array<{
      originalFilename: string;
      kind: string;
      targetPath: string;
      connectionId: string;
      schema?: string;
      sourceName?: string;
    }>;
    expect(files).toHaveLength(2);
    const manifest = files.find((f) => f.kind === "schemaManifest");
    const overlay = files.find((f) => f.kind === "semanticSource");
    expect(manifest).toBeDefined();
    expect(overlay).toBeDefined();
    expect(manifest!.targetPath).toBe("semantic-layer/customer-db/_schema/chatbi.yaml");
    expect(manifest!.connectionId).toBe("customer-db");
    expect(manifest!.schema).toBe("chatbi");
    expect(overlay!.targetPath).toBe(
      "semantic-layer/customer-db/international_country_metrics.yaml"
    );
    expect(overlay!.sourceName).toBe("international_country_metrics");
    expect(overlay!.physicalTable).toBe("chatbi.ai_metric_international_country_daily");

    const changedSources = data.changedSources as Array<{ connectionId: string; sourceName: string }>;
    expect(changedSources).toEqual([
      { connectionId: "customer-db", sourceName: "international_country_metrics" }
    ]);

    // Diff is a non-empty pure-JS unified diff containing the new measure.
    expect(typeof data.diff).toBe("string");
    expect(data.diff).toContain("international_country_metrics");
    expect(data.diff).toContain("dau");

    // No formal file written.
    const onDisk = await readFile(
      path.join(projectRoot, "semantic-layer/customer-db/international_country_metrics.yaml"),
      "utf8"
    ).catch((err: NodeJS.ErrnoException) => {
      expect(err.code).toBe("ENOENT");
      return null;
    });
    expect(onDisk).toBeNull();

    // No ktx subprocess was called.
    expect(vi.mocked(validateSource)).not.toHaveBeenCalled();
    expect(vi.mocked(reindexProject)).not.toHaveBeenCalled();

    await app.close();
  });

  it("adds manifest table names to changedSources so manifest-only publish cannot skip the gate", async () => {
    projectRoot = await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;

    const app = await buildFreshServer();
    await app.ready();

    const res = await request(app.server)
      .post("/api/semantic-assets/validate")
      .send({
        files: [{ filename: "chatbi.yaml", content: MANIFEST_YAML }]
      })
      .expect(200);

    expect(res.body.data.valid).toBe(true);
    expect(res.body.data.changedSources).toEqual([
      { connectionId: "customer-db", sourceName: "international_country_metrics" }
    ]);
    await app.close();
  });

  it("rejects duplicate filenames before persisting a validation snapshot", async () => {
    projectRoot = await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;

    const app = await buildFreshServer();
    await app.ready();

    const res = await request(app.server)
      .post("/api/semantic-assets/validate")
      .send({
        files: [
          { filename: "same.yaml", content: MANIFEST_YAML },
          { filename: "same.yaml", content: OVERLAY_YAML }
        ]
      })
      .expect(200);

    expect(res.body.data.valid).toBe(false);
    expect((res.body.data.errors as Array<{ code: string }>).map((e) => e.code)).toContain(
      "DUPLICATE_FILENAME"
    );
    await app.close();
  });

  it("extracts YAML files from a zip package and still computes target paths server-side", async () => {
    projectRoot = await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const zip = buildStoredZip([
      { name: "semantic-layer/customer-db/_schema/chatbi.yaml", data: MANIFEST_YAML },
      { name: "semantic-layer/customer-db/international_country_metrics.yaml", data: OVERLAY_YAML }
    ]);

    const app = await buildFreshServer();
    await app.ready();

    const res = await request(app.server)
      .post("/api/semantic-assets/validate")
      .send({
        files: [],
        packages: [{ filename: "semantic-assets.zip", contentBase64: zip.toString("base64") }]
      })
      .expect(200);

    expect(res.body.data.valid).toBe(true);
    expect((res.body.data.files as Array<{ targetPath: string }>).map((f) => f.targetPath)).toEqual([
      "semantic-layer/customer-db/_schema/chatbi.yaml",
      "semantic-layer/customer-db/international_country_metrics.yaml"
    ]);
    await app.close();
  });

  it("flags UNKNOWN_CONNECTION when the connection id is not in ktx.yaml", async () => {
    projectRoot = await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;

    const app = await buildFreshServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/semantic-assets/validate")
      .send({
        defaultConnectionId: "ghost-conn",
        defaultSchema: "chatbi",
        files: [{ filename: "chatbi.yaml", content: MANIFEST_YAML }]
      })
      .expect(200);

    expect(res.body.data.valid).toBe(false);
    const codes = (res.body.data.errors as Array<{ code: string }>).map((e) => e.code);
    expect(codes).toContain("UNKNOWN_CONNECTION");
    await app.close();
  });

  it("flags SCHEMA_NOT_CONFIGURED when the schema is missing from the connection's schemas", async () => {
    projectRoot = await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;

    const app = await buildFreshServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/semantic-assets/validate")
      .send({
        defaultConnectionId: "customer-db",
        defaultSchema: "ghost_schema",
        files: [{ filename: "chatbi.yaml", content: MANIFEST_YAML }]
      })
      .expect(200);

    expect(res.body.data.valid).toBe(false);
    const codes = (res.body.data.errors as Array<{ code: string }>).map((e) => e.code);
    expect(codes).toContain("SCHEMA_NOT_CONFIGURED");
    await app.close();
  });

  it("flags UNSAFE_SOURCE_NAME when the overlay's name contains path separators", async () => {
    projectRoot = await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;

    const app = await buildFreshServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/semantic-assets/validate")
      .send({
        defaultConnectionId: "customer-db",
        files: [
          {
            filename: "bad.yaml",
            content: `name: "../escape"\ntable: chatbi.foo\n`
          }
        ]
      })
      .expect(200);

    expect(res.body.data.valid).toBe(false);
    const codes = (res.body.data.errors as Array<{ code: string }>).map((e) => e.code);
    expect(codes).toContain("UNSAFE_SOURCE_NAME");
    await app.close();
  });

  it("flags OVERLAY_MISSING_TABLE when the overlay has no table key", async () => {
    projectRoot = await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;

    const app = await buildFreshServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/semantic-assets/validate")
      .send({
        defaultConnectionId: "customer-db",
        files: [
          {
            filename: "missing_table.yaml",
            content: `name: international_country_metrics\ngrain:\n  - date\n`
          }
        ]
      })
      .expect(200);

    expect(res.body.data.valid).toBe(false);
    const codes = (res.body.data.errors as Array<{ code: string }>).map((e) => e.code);
    expect(codes).toContain("OVERLAY_MISSING_TABLE");
    await app.close();
  });

  it("flags UNKNOWN_SHAPE when the YAML cannot be classified as manifest or overlay", async () => {
    projectRoot = await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;

    const app = await buildFreshServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/semantic-assets/validate")
      .send({
        defaultConnectionId: "customer-db",
        files: [
          {
            filename: "weird.yaml",
            content: `title: just a doc\nversion: 1\n`
          }
        ]
      })
      .expect(200);

    expect(res.body.data.valid).toBe(false);
    const codes = (res.body.data.errors as Array<{ code: string }>).map((e) => e.code);
    expect(codes).toContain("UNKNOWN_SHAPE");
    await app.close();
  });

  it("returns YAML_PARSE_FAILED with line/column when the YAML is malformed", async () => {
    projectRoot = await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;

    const app = await buildFreshServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/semantic-assets/validate")
      .send({
        defaultConnectionId: "customer-db",
        files: [
          {
            filename: "broken.yaml",
            content: ":\n  - a\n  : b\n   - c\n"
          }
        ]
      })
      .expect(200);

    expect(res.body.data.valid).toBe(false);
    const codes = (res.body.data.errors as Array<{ code: string }>).map((e) => e.code);
    expect(codes).toContain("YAML_PARSE_FAILED");
    const err = (res.body.data.errors as Array<{ code: string; line?: number; column?: number }>).find(
      (e) => e.code === "YAML_PARSE_FAILED"
    );
    expect(err).toBeDefined();
    expect(typeof err!.line).toBe("number");
    await app.close();
  });

  it("warns TARGET_EXISTS when the proposed target already exists on disk", async () => {
    projectRoot = await makeProject();
    // Pre-populate the overlay target with a placeholder so the warning fires.
    await writeFile(
      path.join(projectRoot, "semantic-layer/customer-db/international_country_metrics.yaml"),
      "name: international_country_metrics\ntable: chatbi.ai_metric_international_country_daily\n",
      "utf8"
    );
    process.env.KTX_PROJECT_ROOT = projectRoot;

    const app = await buildFreshServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/semantic-assets/validate")
      .send({
        defaultConnectionId: "customer-db",
        files: [
          { filename: "chatbi.yaml", content: MANIFEST_YAML },
          { filename: "international_country_metrics.yaml", content: OVERLAY_YAML }
        ]
      })
      .expect(200);

    expect(res.body.data.valid).toBe(true);
    const warnCodes = (res.body.data.warnings as Array<{ code: string }>).map((w) => w.code);
    expect(warnCodes).toContain("TARGET_EXISTS");
    await app.close();
  });
});
