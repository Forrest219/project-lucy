import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let projectRoot: string;
let previousRoot: string | undefined;

async function makeProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lucy-reindex-api-"));
  await writeFile(
    path.join(root, "ktx.yaml"),
    "connections:\n  customer-db:\n    driver: mysql\n    schemas:\n      - chatbi\n",
    "utf8"
  );
  await mkdir(path.join(root, "semantic-layer", "customer-db", "_schema"), {
    recursive: true
  });
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

beforeEach(() => {
  vi.resetModules();
  previousRoot = process.env.KTX_PROJECT_ROOT;
  vi.clearAllMocks();
});

afterEach(async () => {
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  if (projectRoot) {
    await rm(projectRoot, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50
    });
  }
});

describe("POST /api/semantic-assets/reindex", () => {
  it("runs incremental KTX reindex and returns the subprocess result", async () => {
    projectRoot = await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const reindexProject = vi.fn(async () => ({
      exitCode: 0,
      stdout: "indexed",
      stderr: ""
    }));
    vi.doMock("../ktx", async () => {
      const actual = await vi.importActual<typeof import("../ktx")>("../ktx");
      return { ...actual, reindexProject };
    });

    const app = await buildFreshServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/semantic-assets/reindex")
      .send({})
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(res.body.data.force).toBe(false);
    expect(res.body.data.reindex).toMatchObject({
      ok: true,
      exitCode: 0,
      stdout: "indexed",
      stderr: ""
    });
    expect(res.body.data.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(res.body.data.finishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(reindexProject).toHaveBeenCalledWith(projectRoot, { force: false });
    await app.close();
  });

  it("supports a forced rebuild and preserves non-zero exit status in data", async () => {
    projectRoot = await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const reindexProject = vi.fn(async () => ({
      exitCode: 2,
      stdout: "",
      stderr: "reindex failed"
    }));
    vi.doMock("../ktx", async () => {
      const actual = await vi.importActual<typeof import("../ktx")>("../ktx");
      return { ...actual, reindexProject };
    });

    const app = await buildFreshServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/semantic-assets/reindex")
      .send({ force: true })
      .expect(200);

    expect(res.body.data.force).toBe(true);
    expect(res.body.data.reindex).toMatchObject({
      ok: false,
      exitCode: 2,
      stderr: "reindex failed"
    });
    expect(reindexProject).toHaveBeenCalledWith(projectRoot, { force: true });
    await app.close();
  });

  it("writes a webui_manual_reindex history record visible from /api/semantic-assets/releases", async () => {
    projectRoot = await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const reindexProject = vi.fn(async () => ({
      exitCode: 0,
      stdout: "indexed",
      stderr: ""
    }));
    vi.doMock("../ktx", async () => {
      const actual = await vi.importActual<typeof import("../ktx")>("../ktx");
      return { ...actual, reindexProject };
    });

    const app = await buildFreshServer();
    await app.ready();
    const reindexRes = await request(app.server)
      .post("/api/semantic-assets/reindex")
      .send({})
      .expect(200);

    const historyRes = await request(app.server)
      .get("/api/semantic-assets/releases")
      .expect(200);

    expect(historyRes.body.data.records[0]).toMatchObject({
      trigger: "webui_manual_reindex",
      actor: expect.any(String),
      reindex: { ok: true, exitCode: 0 }
    });
    expect(historyRes.body.data.records[0].id).toBe(reindexRes.body.data.id);
    expect(historyRes.body.data.records[0].files).toEqual([]);
    expect(historyRes.body.data.records[0].changedSources).toEqual([]);
    await app.close();
  });

  it("records a failed manual reindex as reindex_failed and returns 409 when a publish lock is present", async () => {
    projectRoot = await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const reindexProject = vi.fn(async () => ({
      exitCode: 0,
      stdout: "indexed",
      stderr: ""
    }));
    vi.doMock("../ktx", async () => {
      const actual = await vi.importActual<typeof import("../ktx")>("../ktx");
      return { ...actual, reindexProject };
    });

    // Drop a synthetic publish lock file and confirm the route short-circuits
    // with the documented `REINDEX_IN_PROGRESS` error envelope.
    const lockDir = path.join(projectRoot, ".ktx-ui");
    await mkdir(lockDir, { recursive: true });
    await writeFile(
      path.join(lockDir, "semantic-publish.lock"),
      JSON.stringify({ validationId: "in-progress", releaseId: "rel_pending" }),
      "utf8"
    );

    const app = await buildFreshServer();
    await app.ready();
    const lockedRes = await request(app.server)
      .post("/api/semantic-assets/reindex")
      .send({})
      .expect(409);

    expect(lockedRes.body.error.code).toBe("REINDEX_IN_PROGRESS");
    // Reindex must not have run while the publish lock was held.
    expect(reindexProject).not.toHaveBeenCalled();

    // Remove the synthetic lock and re-run; this time it should succeed and
    // record a failed (non-zero exit) reindex entry into the history.
    reindexProject.mockResolvedValueOnce({
      exitCode: 1,
      stdout: "",
      stderr: "ktx admin reindex failed"
    });
    const { rm } = await import("node:fs/promises");
    await rm(path.join(lockDir, "semantic-publish.lock"), { force: true });

    const okRes = await request(app.server)
      .post("/api/semantic-assets/reindex")
      .send({})
      .expect(200);
    expect(okRes.body.data.reindex.ok).toBe(false);

    const historyRes = await request(app.server)
      .get("/api/semantic-assets/releases")
      .expect(200);
    expect(historyRes.body.data.records[0]).toMatchObject({
      trigger: "webui_manual_reindex",
      status: "reindex_failed",
      reindex: { ok: false, exitCode: 1 }
    });
    await app.close();
  });

  it("returns release records in newest-first order so the audit page renders latest at the top", async () => {
    projectRoot = await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;
    // The route only writes a single record, so we use the __test export to
    // seed multiple entries with explicit timestamps and verify the API
    // returns them sorted by `createdAt` descending.
    const { __test } = await import("../semantic-assets");
    const baseRecord = {
      actor: "local-admin",
      status: "published" as const,
      trigger: "webui_publish" as const,
      connectionIds: [],
      files: [],
      changedSources: [],
      validation: { ok: true, results: [] },
      reindex: { ok: true, exitCode: 0, stdout: "", stderr: "" }
    };
    await __test.appendReleaseRecord(projectRoot, {
      ...baseRecord,
      id: "rel_old",
      createdAt: "2026-07-31T01:00:00.000Z"
    });
    await __test.appendReleaseRecord(projectRoot, {
      ...baseRecord,
      id: "rel_new",
      createdAt: "2026-07-31T05:00:00.000Z"
    });
    await __test.appendReleaseRecord(projectRoot, {
      ...baseRecord,
      id: "rel_mid",
      createdAt: "2026-07-31T03:00:00.000Z"
    });

    const app = await buildFreshServer();
    await app.ready();
    const res = await request(app.server)
      .get("/api/semantic-assets/releases")
      .expect(200);
    const ids = res.body.data.records.map((r: { id: string }) => r.id);
    expect(ids).toEqual(["rel_new", "rel_mid", "rel_old"]);
    await app.close();
  });
});
