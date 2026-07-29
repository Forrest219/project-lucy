import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// M14: the WebUI route must NEVER shell out to ktx. The mocks throw if any
// WebUI code accidentally calls into ktx, so the test fails loudly instead of
// silently passing.
vi.mock("../ktx", async () => {
  const actual = await vi.importActual<typeof import("../ktx")>("../ktx");
  const failIfCalled = () => {
    throw new Error("M14: WebUI must not call runIngest from /api/connections/:connId/ingest");
  };
  return {
    ...actual,
    testConnection: vi.fn(failIfCalled),
    runIngest: vi.fn(failIfCalled),
    validateSource: vi.fn(failIfCalled)
  };
});

let projectRoot: string;
let auditDbPath: string;
let previousRoot: string | undefined;
let previousAuditDb: string | undefined;

async function makeProject(yaml: string) {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-api-ingest-alias-"));
  await writeFile(path.join(projectRoot, "ktx.yaml"), yaml, "utf8");
  auditDbPath = path.join(projectRoot, ".ktx-ui", "audit.sqlite");
  await mkdir(path.dirname(auditDbPath), { recursive: true });
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

describe("POST /api/connections/:connId/ingest (M14 deprecated alias)", () => {
  it("returns deprecated: true + replacement and never shells out", async () => {
    await makeProject(
      `connections:\n  demo-mysql:\n    schemas: [dataforai]\n    enabled_tables: [dataforai.superstore_orders]\n`
    );
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const app = await buildFreshServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/connections/demo-mysql/ingest")
      .send({})
      .expect(200);

    expect(res.body.ok).toBe(true);
    const data = res.body.data;
    expect(data.deprecated).toBe(true);
    expect(data.replacement).toBe("/api/catalog/reload");
    expect(data.message).toMatch(/no longer executes ktx ingest/i);
    expect(data.reload).toBeDefined();
    expect(data.reload.source).toBe("static-yaml");
    expect(data.reload.deprecatedIngestAlias).toBe(true);
    expect(data.reload.requestedConnectionId).toBe("demo-mysql");
    // CLI-shaped fields must NOT appear in the response.
    expect(data.command).toBeUndefined();
    expect(data.exitCode).toBeUndefined();
    expect(data.stdout).toBeUndefined();
    expect(data.stderr).toBeUndefined();
    expect(data.scannedTableCount).toBeUndefined();

    const ktx = await import("../ktx");
    expect(vi.mocked(ktx.runIngest)).not.toHaveBeenCalled();

    await app.close();
  });

  it("forwards the optional schema filter into the static reload run", async () => {
    await makeProject(
      `connections:\n  demo-mysql:\n    schemas: [dataforai]\n    enabled_tables: [dataforai.superstore_orders]\n`
    );
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const app = await buildFreshServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/connections/demo-mysql/ingest")
      .send({ schema: "dataforai" })
      .expect(200);

    expect(res.body.ok).toBe(true);
    const data = res.body.data;
    expect(data.deprecated).toBe(true);
    expect(data.reload.requestedConnectionId).toBe("demo-mysql");
    expect(data.reload.requestedSchema).toBe("dataforai");

    await app.close();
  });
});

describe("GET /api/connections/ingest-runs (legacy)", () => {
  it("still serves the legacy sidecar for backward compatibility", async () => {
    await makeProject(
      `connections:\n  demo-mysql:\n    schemas: [dataforai]\n    enabled_tables: [dataforai.superstore_orders]\n`
    );
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const app = await buildFreshServer();
    await app.ready();
    const res = await request(app.server).get("/api/connections/ingest-runs").expect(200);

    expect(res.body.ok).toBe(true);
    // M14 stopped writing the ingest sidecar. Legacy runs may exist from M13
    // history, but new reloads do not append to it.
    expect(Array.isArray(res.body.data.runs)).toBe(true);
    expect(res.body.data.lastByConnection).toBeDefined();

    await app.close();
  });
});
