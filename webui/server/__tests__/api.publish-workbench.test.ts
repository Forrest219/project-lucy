// Spec `lucy-20261030-publish-workbench-three-column-spec.md` §6 — the
// publish workbench API contract.
//
// Coverage:
//  - `/api/diff` returns the unified pending result plus the snapshot version,
//    the baseline state and the server-computed impact.
//  - `/api/validate-changed` derives its scope from the CONTENT SNAPSHOT, so a
//    file edited outside this process is validated too.
//  - `/api/semantic-assets/releases?businessChangesOnly=true` filters the
//    maintenance runs on the server, BEFORE the limit.
//  - The evidence endpoint resolves a reference inside the snapshot and refuses
//    an unknown one.

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let projectRoot: string;
let previousRoot: string | undefined;
let previousContentRoot: string | undefined;

const MANIFEST = `tables:
  ai_intl_ad_daily:
    table: chatbi.ai_intl_ad_daily
    columns:
      - name: date
        type: time
`;

const OVERLAY = `name: ai_intl_ad_daily
grain:
  - date
measures:
  - name: spend
    expr: sum(spend)
`;

async function makeProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lucy-pwb-api-"));
  await writeFile(
    path.join(root, "ktx.yaml"),
    `connections:
  demo:
    driver: mysql
    schemas:
      - chatbi
    enabled_tables:
      - chatbi.ai_intl_ad_daily
`,
    "utf8"
  );
  await mkdir(path.join(root, "semantic-layer", "demo", "_schema"), { recursive: true });
  await writeFile(path.join(root, "semantic-layer", "demo", "_schema", "chatbi.yaml"), MANIFEST, "utf8");
  await writeFile(path.join(root, "semantic-layer", "demo", "ai_intl_ad_daily.yaml"), OVERLAY, "utf8");
  return root;
}

async function buildFreshServer() {
  const { buildServer } = await import("../index");
  return buildServer();
}

beforeEach(async () => {
  vi.resetModules();
  previousRoot = process.env.KTX_PROJECT_ROOT;
  previousContentRoot = process.env.LUCY_CONTENT_ROOT;
  vi.clearAllMocks();
});

afterEach(async () => {
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  if (previousContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = previousContentRoot;
  if (projectRoot) {
    await rm(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

function mockKtx() {
  vi.doMock("../ktx", async () => {
    const actual = await vi.importActual<typeof import("../ktx")>("../ktx");
    return {
      ...actual,
      reindexProject: vi.fn(async () => ({ exitCode: 0, stdout: "indexed", stderr: "" })),
      validateSource: vi.fn(async () => ({
        ok: true,
        exitCode: 0,
        stdout: "Valid semantic-layer source",
        stderr: "",
        issues: []
      }))
    };
  });
}

describe("GET /api/diff", () => {
  it("returns the pending result, the snapshot version, the baseline state and the impact", async () => {
    projectRoot = await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    mockKtx();

    const app = await buildFreshServer();
    await app.ready();

    const res = await request(app.server).get("/api/diff").expect(200);
    const data = res.body.data;

    expect(data.pendingDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(data.baselineState).toBe("uninitialized");
    expect(data.baselineGeneration).toBe(0);
    expect(data.impact.pendingDigest).toBe(data.pendingDigest);
    expect(data.impact.counts.tables).toBe(1);
    expect(data.impact.tables[0].identity).toEqual({
      connectionId: "demo",
      schema: "chatbi",
      table: "ai_intl_ad_daily"
    });
    expect(data.impact.tables[0].reasons[0].kind).toBe("first_verification");
    expect(data.files.map((file: { filePath: string }) => file.filePath)).toContain(
      "semantic-layer/demo/ai_intl_ad_daily.yaml"
    );

    await app.close();
  });

  it("reports the manifest and wiki parts of the impact separately from the tables", async () => {
    projectRoot = await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    await mkdir(path.join(projectRoot, "wiki", "global"), { recursive: true });
    await writeFile(path.join(projectRoot, "wiki", "global", "sales.md"), "# 销售口径\n", "utf8");
    mockKtx();

    const app = await buildFreshServer();
    await app.ready();

    const res = await request(app.server).get("/api/diff").expect(200);
    expect(res.body.data.impact.counts.wikiPages).toBe(1);
    expect(res.body.data.impact.wikiChanges[0].title).toBe("销售口径");
    expect(res.body.data.impact.counts.manifests).toBe(1);

    await app.close();
  });
});

describe("POST /api/validate-changed", () => {
  it("validates a table that was edited outside this process", async () => {
    projectRoot = await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    mockKtx();

    const app = await buildFreshServer();
    await app.ready();

    // The file is edited on disk — no WebUI write happened in this process.
    await writeFile(
      path.join(projectRoot, "semantic-layer", "demo", "ai_intl_ad_daily.yaml"),
      `${OVERLAY}\n  - name: extra\n    expr: count(*)\n`,
      "utf8"
    );

    const res = await request(app.server).post("/api/validate-changed").send({}).expect(200);
    expect(res.body.data.results).toHaveLength(1);
    expect(res.body.data.results[0]).toMatchObject({
      conn: "demo",
      schema: "chatbi",
      table: "ai_intl_ad_daily"
    });
    expect(res.body.data.pendingDigest).toMatch(/^[0-9a-f]{64}$/);

    await app.close();
  });

  it("does not block a Wiki-only batch with an empty table validation result", async () => {
    projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-pwb-wiki-"));
    await writeFile(
      path.join(projectRoot, "ktx.yaml"),
      `connections:
  demo:
    driver: mysql
    schemas:
      - chatbi
    enabled_tables:
      - chatbi.ai_intl_ad_daily
`,
      "utf8"
    );
    // A Wiki-only content root: no semantic layer at all.
    await mkdir(path.join(projectRoot, "wiki", "global"), { recursive: true });
    await writeFile(path.join(projectRoot, "wiki", "global", "sales.md"), "# 销售口径\n", "utf8");
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    mockKtx();

    const app = await buildFreshServer();
    await app.ready();

    const res = await request(app.server).post("/api/validate-changed").send({}).expect(200);
    expect(res.body.data.results).toHaveLength(0);
    expect(res.body.data.baselineState).toBe("uninitialized");

    await app.close();
  });
});

describe("GET /api/semantic-assets/releases", () => {
  it("filters the maintenance runs before the limit", async () => {
    projectRoot = await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    mockKtx();

    const app = await buildFreshServer();
    await app.ready();

    // A maintenance-only run: no business change was written through the WebUI.
    await request(app.server).post("/api/semantic-assets/reindex").send({}).expect(200);
    // A batch that carries a business change.
    await request(app.server)
      .post("/api/sources/demo/chatbi/ai_intl_ad_daily/import")
      .send({ dryRun: false, yaml: `${OVERLAY}\n  - name: extra\n    expr: count(*)\n` })
      .expect(200);
    await request(app.server).post("/api/semantic-assets/reindex").send({}).expect(200);

    const all = await request(app.server).get("/api/semantic-assets/releases").expect(200);
    expect(all.body.data.records.length).toBeGreaterThanOrEqual(2);

    const business = await request(app.server)
      .get("/api/semantic-assets/releases?businessChangesOnly=true&limit=5")
      .expect(200);
    // The maintenance-only run carries no business change and is filtered out.
    expect(
      business.body.data.records.every(
        (record: { files?: unknown[]; changedSources?: unknown[]; connectionIds?: unknown[] }) =>
          (record.files?.length ?? 0) > 0 ||
          (record.changedSources?.length ?? 0) > 0 ||
          (record.connectionIds?.length ?? 0) > 0
      )
    ).toBe(true);
    expect(
      business.body.data.records.some(
        (record: { files?: unknown[] }) => (record.files?.length ?? 0) === 0
      )
    ).toBe(false);
    expect(business.body.data.records.length).toBeLessThan(all.body.data.records.length);

    await app.close();
  });
});

describe("GET /api/publish-workbench/evidence", () => {
  it("resolves a reference inside the snapshot and refuses an unknown one", async () => {
    projectRoot = await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    mockKtx();

    const app = await buildFreshServer();
    await app.ready();

    const diff = await request(app.server).get("/api/diff").expect(200);
    const evidenceRef = diff.body.data.impact.tables[0].reasons[0].evidenceRef as string;

    const res = await request(app.server)
      .get(`/api/publish-workbench/evidence?ref=${encodeURIComponent(evidenceRef)}`)
      .expect(200);
    expect(res.body.data.logicalPath).toBe("semantic-layer/demo/ai_intl_ad_daily.yaml");

    await request(app.server)
      .get(`/api/publish-workbench/evidence?ref=${encodeURIComponent("diff:../../etc/passwd")}`)
      .expect(404);
    await request(app.server).get("/api/publish-workbench/evidence").expect(400);

    await app.close();
  });
});
