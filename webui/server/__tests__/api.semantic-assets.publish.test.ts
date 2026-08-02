// M19 — POST /api/semantic-assets/publish and release status polling.
//
// Coverage:
//  - validate gate is re-run on publish (TOCTOU defense).
//  - promote writes only after gate passes; symlinked targets are rejected.
//  - confirmOverwrite is required when an existing target would be overwritten.
//  - publish response returns immediately with `accepted: true` and
//    `release.status === "reindexing"` even when reindex is slow.
//  - GET /api/semantic-assets/releases/:id/status eventually reflects
//    `published` (or `reindex_failed`).
//  - 409 PUBLISH_IN_PROGRESS when a second publish runs while the lock is held.
//  - release sidecar never includes uploaded YAML content.

import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../index";

let projectRoot: string;
let previousRoot: string | undefined;

const BASE_KTX_YAML = `connections:
  customer-db:
    driver: mysql
    schemas:
      - chatbi
    enabled_tables:
      - chatbi.ai_metric_international_country_daily
`;

const MANIFEST_YAML = `tables:
  international_country_metrics:
    table: chatbi.ai_metric_international_country_daily
    columns:
      - name: date
        type: time
`;

const OVERLAY_YAML = `name: international_country_metrics
table: chatbi.ai_metric_international_country_daily
grain:
  - date
measures:
  - name: dau
    expr: sum(dau)
`;

async function makeProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lucy-m19-publish-"));
  await writeFile(path.join(root, "ktx.yaml"), BASE_KTX_YAML, "utf8");
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

beforeEach(async () => {
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

async function validate(
  app: Awaited<ReturnType<typeof buildServer>>,
  files: Array<{ filename: string; content: string }>
): Promise<string> {
  const res = await request(app.server)
    .post("/api/semantic-assets/validate")
    .send({ files });
  expect(res.status).toBe(200);
  expect(res.body.data.valid).toBe(true);
  return res.body.data.validationId as string;
}

describe("POST /api/semantic-assets/publish", () => {
  it("returns reindexing immediately, finishes async reindex, and updates release status to published", async () => {
    projectRoot = await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;

    // Slow reindex to prove the response is not blocked.
    let resolveReindex: () => void = () => undefined;
    const reindexDone = new Promise<void>((r) => {
      resolveReindex = r;
    });
    vi.doMock("../ktx", async () => {
      const actual = await vi.importActual<typeof import("../ktx")>("../ktx");
      return {
        ...actual,
        validateSource: vi.fn(async () => ({
          ok: true,
          exitCode: 0,
          stdout: "",
          stderr: "",
          issues: []
        })),
        reindexProject: vi.fn(async () => {
          await reindexDone;
          return { exitCode: 0, stdout: "indexed", stderr: "" };
        })
      };
    });

    const app = await buildFreshServer();
    await app.ready();
    const validationId = await validate(app, [
      { filename: "chatbi.yaml", content: MANIFEST_YAML },
      { filename: "international_country_metrics.yaml", content: OVERLAY_YAML }
    ]);

    const publishRes = await request(app.server)
      .post("/api/semantic-assets/publish")
      .send({ validationId, confirmOverwrite: true });

    expect(publishRes.status).toBe(200);
    expect(publishRes.body.ok).toBe(true);
    expect(publishRes.body.data.accepted).toBe(true);
    expect(publishRes.body.data.release.status).toBe("reindexing");
    const releaseId = publishRes.body.data.release.id as string;
    expect(releaseId).toMatch(/^rel_/);

    // The HTTP response returned BEFORE the reindex resolves.
    const onDisk = await readFile(
      path.join(projectRoot, "semantic-layer/customer-db/international_country_metrics.yaml"),
      "utf8"
    );
    expect(onDisk).toContain("dau");

    // Status endpoint still reports reindexing.
    const before = await request(app.server).get(
      `/api/semantic-assets/releases/${releaseId}/status`
    );
    expect(before.status).toBe(200);
    expect(before.body.data.release.status).toBe("reindexing");

    // Let the reindex finish.
    resolveReindex();
    await new Promise((r) => setTimeout(r, 50));

    const after = await request(app.server).get(
      `/api/semantic-assets/releases/${releaseId}/status`
    );
    expect(after.status).toBe(200);
    expect(after.body.data.release.status).toBe("published");
    expect(after.body.data.release.reindex?.ok).toBe(true);

    await app.close();
  }, 30000);

  it("marks the release as reindex_failed when the reindex subprocess returns non-zero", async () => {
    projectRoot = await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;

    vi.doMock("../ktx", async () => {
      const actual = await vi.importActual<typeof import("../ktx")>("../ktx");
      return {
        ...actual,
        validateSource: vi.fn(async () => ({
          ok: true,
          exitCode: 0,
          stdout: "",
          stderr: "",
          issues: []
        })),
        reindexProject: vi.fn(async () => ({
          exitCode: 2,
          stdout: "",
          stderr: "ktx reindex crashed"
        }))
      };
    });

    const app = await buildFreshServer();
    await app.ready();
    const validationId = await validate(app, [
      { filename: "chatbi.yaml", content: MANIFEST_YAML },
      { filename: "international_country_metrics.yaml", content: OVERLAY_YAML }
    ]);

    const publishRes = await request(app.server)
      .post("/api/semantic-assets/publish")
      .send({ validationId, confirmOverwrite: true });
    const releaseId = publishRes.body.data.release.id as string;
    await new Promise((r) => setTimeout(r, 50));

    const status = await request(app.server).get(
      `/api/semantic-assets/releases/${releaseId}/status`
    );
    expect(status.body.data.release.status).toBe("reindex_failed");
    expect(status.body.data.release.reindex?.ok).toBe(false);
    expect(status.body.data.release.reindex?.exitCode).toBe(2);

    await app.close();
  }, 30000);

  it("returns 409 PUBLISH_IN_PROGRESS when a second publish runs while the first lock is held", async () => {
    projectRoot = await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;

    // Hold the publish lock by pre-creating it on disk.
    await mkdir(path.join(projectRoot, ".ktx-ui"), { recursive: true });
    await writeFile(
      path.join(projectRoot, ".ktx-ui", "semantic-publish.lock"),
      JSON.stringify({ validationId: "other", releaseId: "other", acquiredAt: new Date().toISOString() }),
      "utf8"
    );

    vi.doMock("../ktx", async () => {
      const actual = await vi.importActual<typeof import("../ktx")>("../ktx");
      return {
        ...actual,
        validateSource: vi.fn(async () => ({ ok: true, exitCode: 0, stdout: "", stderr: "", issues: [] })),
        reindexProject: vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" }))
      };
    });

    const app = await buildFreshServer();
    await app.ready();
    const validationId = await validate(app, [
      { filename: "chatbi.yaml", content: MANIFEST_YAML },
      { filename: "international_country_metrics.yaml", content: OVERLAY_YAML }
    ]);

    const res = await request(app.server)
      .post("/api/semantic-assets/publish")
      .send({ validationId, confirmOverwrite: true });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("PUBLISH_IN_PROGRESS");

    await app.close();
  }, 30000);

  it("keeps the publish lock while async reindex is still running", async () => {
    projectRoot = await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;

    let resolveReindex: () => void = () => undefined;
    const reindexDone = new Promise<void>((resolve) => {
      resolveReindex = resolve;
    });
    vi.doMock("../ktx", async () => {
      const actual = await vi.importActual<typeof import("../ktx")>("../ktx");
      return {
        ...actual,
        validateSource: vi.fn(async () => ({ ok: true, exitCode: 0, stdout: "", stderr: "", issues: [] })),
        reindexProject: vi.fn(async () => {
          await reindexDone;
          return { exitCode: 0, stdout: "indexed", stderr: "" };
        })
      };
    });

    const app = await buildFreshServer();
    await app.ready();
    const firstValidationId = await validate(app, [
      { filename: "chatbi.yaml", content: MANIFEST_YAML },
      { filename: "international_country_metrics.yaml", content: OVERLAY_YAML }
    ]);

    const firstPublish = await request(app.server)
      .post("/api/semantic-assets/publish")
      .send({ validationId: firstValidationId, confirmOverwrite: true })
      .expect(200);
    expect(firstPublish.body.data.release.status).toBe("reindexing");

    const secondValidationId = await validate(app, [
      {
        filename: "international_country_metrics_v2.yaml",
        content: OVERLAY_YAML.replace("international_country_metrics", "international_country_metrics_v2")
      }
    ]);
    const secondPublish = await request(app.server)
      .post("/api/semantic-assets/publish")
      .send({ validationId: secondValidationId, confirmOverwrite: true })
      .expect(409);
    expect(secondPublish.body.error.code).toBe("PUBLISH_IN_PROGRESS");

    resolveReindex();
    await new Promise((r) => setTimeout(r, 50));
    await app.close();
  }, 30000);

  it("returns 409 VALIDATION_GATE_FAILED when an overwrite is needed and confirmOverwrite is missing", async () => {
    projectRoot = await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;

    // Pre-populate the overlay target so the publish path will demand
    // confirmOverwrite.
    await writeFile(
      path.join(projectRoot, "semantic-layer/customer-db/international_country_metrics.yaml"),
      "name: international_country_metrics\ntable: chatbi.ai_metric_international_country_daily\n",
      "utf8"
    );

    vi.doMock("../ktx", async () => {
      const actual = await vi.importActual<typeof import("../ktx")>("../ktx");
      return {
        ...actual,
        validateSource: vi.fn(async () => ({ ok: true, exitCode: 0, stdout: "", stderr: "", issues: [] })),
        reindexProject: vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" }))
      };
    });

    const app = await buildFreshServer();
    await app.ready();
    const validationId = await validate(app, [
      { filename: "chatbi.yaml", content: MANIFEST_YAML },
      { filename: "international_country_metrics.yaml", content: OVERLAY_YAML }
    ]);

    const res = await request(app.server)
      .post("/api/semantic-assets/publish")
      .send({ validationId });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("VALIDATION_GATE_FAILED");
    expect(res.body.data.release.status).toBe("blocked");

    // The formal file is unchanged.
    const onDisk = await readFile(
      path.join(projectRoot, "semantic-layer/customer-db/international_country_metrics.yaml"),
      "utf8"
    );
    expect(onDisk).toContain("name: international_country_metrics");

    await app.close();
  });

  it("blocks publish when re-run validate gate fails on a tampered snapshot", async () => {
    projectRoot = await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;

    // The validate HTTP route never calls `ktx sl validate` — only the
    // publish re-validation does. So the mocked `validateSource` here only
    // runs at publish time. Make it fail so the gate blocks the promote.
    const validateSource = vi.fn(async () => ({
      ok: false,
      exitCode: 1,
      stdout: "",
      stderr: "expr is invalid",
      issues: [{ message: "expr is invalid" }]
    }));
    vi.doMock("../ktx", async () => {
      const actual = await vi.importActual<typeof import("../ktx")>("../ktx");
      return {
        ...actual,
        validateSource,
        reindexProject: vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" }))
      };
    });

    const app = await buildFreshServer();
    await app.ready();
    const validationId = await validate(app, [
      { filename: "chatbi.yaml", content: MANIFEST_YAML },
      { filename: "international_country_metrics.yaml", content: OVERLAY_YAML }
    ]);

    const before = await readFile(
      path.join(projectRoot, "semantic-layer/customer-db/international_country_metrics.yaml"),
      "utf8"
    ).catch(() => "");
    const res = await request(app.server)
      .post("/api/semantic-assets/publish")
      .send({ validationId, confirmOverwrite: true });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("VALIDATION_GATE_FAILED");
    const after = await readFile(
      path.join(projectRoot, "semantic-layer/customer-db/international_country_metrics.yaml"),
      "utf8"
    ).catch(() => "");
    expect(after).toBe(before);

    await app.close();
  });

  it("blocks manifest-only publish when the re-run validate gate fails", async () => {
    projectRoot = await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;

    const validateSource = vi.fn(async () => ({
      ok: false,
      exitCode: 1,
      stdout: "",
      stderr: "manifest broke international_country_metrics",
      issues: [{ message: "manifest broke international_country_metrics" }]
    }));
    const reindexProject = vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" }));
    vi.doMock("../ktx", async () => {
      const actual = await vi.importActual<typeof import("../ktx")>("../ktx");
      return { ...actual, validateSource, reindexProject };
    });

    const app = await buildFreshServer();
    await app.ready();
    const validationId = await validate(app, [
      { filename: "chatbi.yaml", content: MANIFEST_YAML }
    ]);

    const before = await readFile(
      path.join(projectRoot, "semantic-layer/customer-db/_schema/chatbi.yaml"),
      "utf8"
    );
    const res = await request(app.server)
      .post("/api/semantic-assets/publish")
      .send({ validationId, confirmOverwrite: true })
      .expect(422);

    expect(res.body.error.code).toBe("VALIDATION_GATE_FAILED");
    expect(validateSource).toHaveBeenCalledWith(
      expect.stringContaining(".ktx-ui/staging/semantic-publish"),
      "customer-db",
      "",
      "international_country_metrics"
    );
    expect(reindexProject).not.toHaveBeenCalled();
    await expect(
      readFile(path.join(projectRoot, "semantic-layer/customer-db/_schema/chatbi.yaml"), "utf8")
    ).resolves.toBe(before);

    await app.close();
  }, 30000);

  it("refuses to promote when an existing target is a symlink", async () => {
    projectRoot = await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;

    // Make the overlay target a symlink.
    const realTarget = path.join(projectRoot, "real-overlay.yaml");
    await writeFile(realTarget, "name: international_country_metrics\n", "utf8");
    await symlink(
      realTarget,
      path.join(projectRoot, "semantic-layer/customer-db/international_country_metrics.yaml")
    );

    vi.doMock("../ktx", async () => {
      const actual = await vi.importActual<typeof import("../ktx")>("../ktx");
      return {
        ...actual,
        validateSource: vi.fn(async () => ({ ok: true, exitCode: 0, stdout: "", stderr: "", issues: [] })),
        reindexProject: vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" }))
      };
    });

    const app = await buildFreshServer();
    await app.ready();
    const validationId = await validate(app, [
      { filename: "chatbi.yaml", content: MANIFEST_YAML },
      { filename: "international_country_metrics.yaml", content: OVERLAY_YAML }
    ]);

    const res = await request(app.server)
      .post("/api/semantic-assets/publish")
      .send({ validationId, confirmOverwrite: true });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("PATH_NOT_ALLOWED");

    await app.close();
  });

  it("release sidecar never stores uploaded YAML content as a `content` field", async () => {
    projectRoot = await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;

    vi.doMock("../ktx", async () => {
      const actual = await vi.importActual<typeof import("../ktx")>("../ktx");
      return {
        ...actual,
        validateSource: vi.fn(async () => ({ ok: true, exitCode: 0, stdout: "", stderr: "", issues: [] })),
        reindexProject: vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" }))
      };
    });

    const app = await buildFreshServer();
    await app.ready();
    const validationId = await validate(app, [
      { filename: "chatbi.yaml", content: MANIFEST_YAML },
      { filename: "international_country_metrics.yaml", content: OVERLAY_YAML }
    ]);

    const publishRes = await request(app.server)
      .post("/api/semantic-assets/publish")
      .send({ validationId, confirmOverwrite: true });
    await new Promise((r) => setTimeout(r, 50));

    const sidecarRaw = await readFile(
      path.join(projectRoot, ".ktx-ui", "semantic-asset-releases.json"),
      "utf8"
    );
    const sidecar = JSON.parse(sidecarRaw) as { records: Array<Record<string, unknown>> };
    expect(sidecar.records.length).toBe(1);
    const record = sidecar.records[0] ?? {};
    // Hard rule: the sidecar must not store the raw uploaded YAML body.
    expect("content" in record).toBe(false);
    for (const f of (record.files as Array<Record<string, unknown>>) ?? []) {
      expect("content" in f).toBe(false);
    }
    // The diff field is allowed (per spec §5.5) because it is a derived
    // artifact, not the raw YAML body.
    expect(typeof record.diff).toBe("string");
    // File metadata is preserved.
    expect(sidecarRaw).toContain("sha256");

    void publishRes;

    await app.close();
  });
});
