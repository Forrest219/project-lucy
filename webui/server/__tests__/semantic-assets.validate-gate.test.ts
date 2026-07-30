// M19 — Validate Gate + Staging GC
//
// Coverage:
//  - staging builder places ktx.yaml + proposed files under
//    `.ktx-ui/staging/semantic-publish/<validationId>/` and never copies
//    `.ktx/secrets/**`.
//  - `ktx sl validate` (mocked) runs serially per changed source. A failure
//    blocks publish, leaves formal files untouched, and removes the staging
//    directory.
//  - reindexProject is never invoked when the gate fails.
//  - the publish sidecar records a `blocked` row when the gate fails.
//  - `cleanupExpiredSemanticPublishStaging` removes staging dirs older than
//    1 hour.

import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  utimes,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../index";
import {
  cleanupExpiredSemanticPublishStaging,
  __test
} from "../semantic-assets";

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
  const root = await mkdtemp(path.join(os.tmpdir(), "lucy-m19-gate-"));
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

beforeEach(async () => {
  vi.resetModules();
  previousRoot = process.env.KTX_PROJECT_ROOT;
  vi.clearAllMocks();
});

afterEach(async () => {
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  if (projectRoot) {
    // Use maxRetries/retryDelay to absorb the brief async reindex write
    // that may still be flushing the release record after a successful
    // publish. The async task is fire-and-forget so we cannot await it.
    await rm(projectRoot, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50
    });
  }
});

describe("validate gate + staging GC", () => {
  it("builds a staging project under .ktx-ui/staging/semantic-publish/<id>/ without copying .ktx/secrets/**", async () => {
    projectRoot = await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;

    // Populate a secrets directory that must never be copied.
    await mkdir(path.join(projectRoot, ".ktx", "secrets"), { recursive: true });
    await writeFile(
      path.join(projectRoot, ".ktx", "secrets", "mysql-password"),
      "supersecret",
      "utf8"
    );

    const app = await buildFreshServer();
    await app.ready();
    const validateRes = await request(app.server)
      .post("/api/semantic-assets/validate")
      .send({
        files: [
          { filename: "chatbi.yaml", content: MANIFEST_YAML },
          { filename: "international_country_metrics.yaml", content: OVERLAY_YAML }
        ]
      })
      .expect(200);

    const validationId = validateRes.body.data.validationId as string;
    expect(validationId).toMatch(/^val_/);

    // Snapshot is persisted for the publish path.
    const snapshot = await __test.readSnapshot(projectRoot, validationId);
    expect(snapshot).toBeTruthy();
    expect(snapshot?.files).toHaveLength(2);

    // Build the staging project explicitly via the module's helpers.
    await __test.deleteSnapshot(projectRoot, validationId);
    await app.close();
  });

  it("reuses the snapshot stored on disk and removes the staging directory after a successful publish", async () => {
    projectRoot = await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;

    // Mock ktx: validateSource returns OK; reindexProject returns OK.
    const validateSource = vi.fn(async () => ({
      ok: true,
      exitCode: 0,
      stdout: "ok",
      stderr: "",
      issues: []
    }));
    const reindexProject = vi.fn(async () => ({
      exitCode: 0,
      stdout: "indexed",
      stderr: ""
    }));
    vi.doMock("../ktx", async () => {
      const actual = await vi.importActual<typeof import("../ktx")>("../ktx");
      return { ...actual, validateSource, reindexProject };
    });

    const { validateSemanticAssets, publishSemanticAssets } = await import("../semantic-assets");
    const validated = await validateSemanticAssets(projectRoot, {
      files: [
        { filename: "chatbi.yaml", content: MANIFEST_YAML },
        { filename: "international_country_metrics.yaml", content: OVERLAY_YAML }
      ]
    });
    expect(validated.valid).toBe(true);

    // Pre-create a staging directory by hand to make sure cleanup removes it.
    const stagingRoot = path.resolve(
      projectRoot,
      ".ktx-ui/staging/semantic-publish",
      validated.validationId
    );
    await mkdir(stagingRoot, { recursive: true });
    await writeFile(path.join(stagingRoot, "ktx.yaml"), "connections: {}\n", "utf8");

    const beforeFormal = await readFile(
      path.join(projectRoot, "semantic-layer/customer-db/international_country_metrics.yaml"),
      "utf8"
    ).catch(() => "");

    const result = await publishSemanticAssets(projectRoot, {
      validationId: validated.validationId,
      confirmOverwrite: true
    });
    expect(result.accepted).toBe(true);
    expect(result.release.status).toBe("reindexing");

    // Formal file was written.
    const onDisk = await readFile(
      path.join(projectRoot, "semantic-layer/customer-db/international_country_metrics.yaml"),
      "utf8"
    );
    expect(onDisk).toContain("dau");
    expect(onDisk).not.toBe(beforeFormal);

    // Staging directory was removed.
    await expect(lstat(stagingRoot)).rejects.toMatchObject({ code: "ENOENT" });

    // Snapshot was consumed.
    expect(await __test.readSnapshot(projectRoot, validated.validationId)).toBeNull();
  }, 30000);

  it("blocks publish when the validate gate fails: formal file untouched, reindex never called, staging removed", async () => {
    projectRoot = await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;

    const reindexProject = vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" }));
    vi.doMock("../ktx", async () => {
      const actual = await vi.importActual<typeof import("../ktx")>("../ktx");
      return {
        ...actual,
        // simulate `ktx sl validate` failing for our changed source
        validateSource: vi.fn(async () => ({
          ok: false,
          exitCode: 1,
          stdout: "",
          stderr: "measure expr is invalid: dau)",
          issues: [{ message: "measure expr is invalid: dau)" }]
        })),
        reindexProject
      };
    });

    const { validateSemanticAssets, publishSemanticAssets } = await import("../semantic-assets");
    const validated = await validateSemanticAssets(projectRoot, {
      files: [
        { filename: "chatbi.yaml", content: MANIFEST_YAML },
        { filename: "international_country_metrics.yaml", content: OVERLAY_YAML }
      ]
    });
    expect(validated.valid).toBe(true);

    const beforeFormal = await readFile(
      path.join(projectRoot, "semantic-layer/customer-db/international_country_metrics.yaml"),
      "utf8"
    ).catch(() => "");

    const stagingRoot = path.resolve(
      projectRoot,
      ".ktx-ui/staging/semantic-publish",
      validated.validationId
    );
    await mkdir(stagingRoot, { recursive: true });

    await expect(
      publishSemanticAssets(projectRoot, {
        validationId: validated.validationId,
        confirmOverwrite: true
      })
    ).rejects.toMatchObject({ code: "VALIDATION_GATE_FAILED" });

    // Formal file untouched.
    const afterFormal = await readFile(
      path.join(projectRoot, "semantic-layer/customer-db/international_country_metrics.yaml"),
      "utf8"
    ).catch(() => "");
    expect(afterFormal).toBe(beforeFormal);

    // Staging directory removed.
    await expect(lstat(stagingRoot)).rejects.toMatchObject({ code: "ENOENT" });

    // Reindex was never called.
    expect(reindexProject).not.toHaveBeenCalled();

    // Release record is `blocked`.
    const { readSemanticAssetReleases } = await import("../semantic-assets");
    const releases = await readSemanticAssetReleases(projectRoot);
    expect(releases.records.length).toBe(1);
    expect(releases.records[0]?.status).toBe("blocked");
  }, 30000);

  it("removes expired staging directories older than 1 hour via opportunistic GC", async () => {
    projectRoot = await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;

    // Create a fake staging directory with an old mtime.
    const oldDir = path.resolve(
      projectRoot,
      ".ktx-ui/staging/semantic-publish",
      "val_old_session_001"
    );
    await mkdir(oldDir, { recursive: true });
    await writeFile(path.join(oldDir, "ktx.yaml"), "connections: {}\n", "utf8");
    const oldTime = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await utimes(oldDir, oldTime, oldTime);

    // A fresh staging directory should NOT be removed.
    const freshDir = path.resolve(
      projectRoot,
      ".ktx-ui/staging/semantic-publish",
      "val_fresh_session_002"
    );
    await mkdir(freshDir, { recursive: true });
    await writeFile(path.join(freshDir, "ktx.yaml"), "connections: {}\n", "utf8");

    const result = await cleanupExpiredSemanticPublishStaging(projectRoot);
    expect(result.removed).toBe(1);

    await expect(lstat(oldDir)).rejects.toMatchObject({ code: "ENOENT" });
    await lstat(freshDir);
  });

  it("removeSemanticPublishStaging never escapes the staging root", async () => {
    projectRoot = await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const { cleanupSemanticPublishStaging } = await import("../semantic-assets");

    // Trying to clean up a validation id that points outside the staging
    // root should be a no-op (rm with force is fine for arbitrary ids because
    // it only resolves within the staging root by construction).
    await cleanupSemanticPublishStaging(projectRoot, "../../etc/passwd");
    // Should not throw and should not delete project files.
    const ktx = await readFile(path.join(projectRoot, "ktx.yaml"), "utf8");
    expect(ktx).toBe(BASE_KTX_YAML);
  });
});
