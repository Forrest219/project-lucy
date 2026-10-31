// Spec `lucy-20261030-publish-workbench-three-column-spec.md` §5.3 / §6 —
// the publish workbench lifecycle: consuming a content version, advancing the
// baseline, and refusing to fake a success.
//
// Coverage:
//  - A successful sync clears the pending list and advances the baseline.
//  - A failed sync keeps the pending list AND the baseline.
//  - A confirmation bound to an older content version is refused with 409.
//  - Content that changes while the index runs is NOT consumed: the baseline
//    stays put and the range stays pending.
//  - A crash between "the terminal record is durable" and "the baseline
//    advanced" is closed idempotently at startup.
//  - Missing evidence never produces a fabricated success.

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  listPublishAttempts,
  readPublishBaseline,
  writePublishAttempt,
  type PublishAttempt
} from "../publish-workbench-state";
import { reconcilePublishWorkbenchAttempts } from "../semantic-assets";

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
  const root = await mkdtemp(path.join(os.tmpdir(), "lucy-pwb-lifecycle-"));
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

function mockKtx(reindexImpl: () => Promise<{ exitCode: number; stdout: string; stderr: string }>) {
  vi.doMock("../ktx", async () => {
    const actual = await vi.importActual<typeof import("../ktx")>("../ktx");
    return {
      ...actual,
      reindexProject: vi.fn(reindexImpl),
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

describe("publish workbench lifecycle", () => {
  it("clears the pending list and advances the baseline after a successful sync", async () => {
    projectRoot = await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    mockKtx(async () => ({ exitCode: 0, stdout: "indexed", stderr: "" }));

    const app = await buildFreshServer();
    await app.ready();

    const before = await request(app.server).get("/api/diff").expect(200);
    expect(before.body.data.files.length).toBeGreaterThan(0);
    expect(before.body.data.baselineState).toBe("uninitialized");

    await request(app.server).post("/api/semantic-assets/reindex").send({}).expect(200);

    const after = await request(app.server).get("/api/diff").expect(200);
    expect(after.body.data.files).toEqual([]);
    expect(after.body.data.baselineState).toBe("ready");
    expect(after.body.data.baselineGeneration).toBe(1);

    const baseline = await readPublishBaseline(projectRoot);
    expect(baseline?.generation).toBe(1);
    expect(baseline?.files["semantic-layer/demo/ai_intl_ad_daily.yaml"]).toMatch(/^[0-9a-f]{64}$/);

    await app.close();
  });

  it("keeps the pending list and the baseline when the index fails", async () => {
    projectRoot = await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    mockKtx(async () => ({ exitCode: 1, stdout: "", stderr: "reindex failed" }));

    const app = await buildFreshServer();
    await app.ready();

    const res = await request(app.server).post("/api/semantic-assets/reindex").send({}).expect(200);
    expect(res.body.data.reindex.ok).toBe(false);

    const after = await request(app.server).get("/api/diff").expect(200);
    expect(
      after.body.data.files.map((file: { filePath: string }) => file.filePath)
    ).toContain("semantic-layer/demo/ai_intl_ad_daily.yaml");
    expect(after.body.data.baselineState).toBe("uninitialized");
    expect(await readPublishBaseline(projectRoot)).toBeNull();

    await app.close();
  });

  it("refuses a confirmation that was bound to an older content version", async () => {
    projectRoot = await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    mockKtx(async () => ({ exitCode: 0, stdout: "indexed", stderr: "" }));

    const app = await buildFreshServer();
    await app.ready();

    const stale = await request(app.server).get("/api/diff").expect(200);
    const staleDigest = stale.body.data.pendingDigest as string;

    // The content moves on after the confirmation was made.
    await writeFile(
      path.join(projectRoot, "semantic-layer", "demo", "ai_intl_ad_daily.yaml"),
      `${OVERLAY}\n# changed after the confirmation\n`,
      "utf8"
    );

    const res = await request(app.server)
      .post("/api/semantic-assets/reindex")
      .send({ pendingDigest: staleDigest })
      .expect(409);
    expect(res.body.error.code).toBe("PUBLISH_CONTENT_VERSION_CHANGED");

    // Nothing was consumed: the baseline did not move.
    expect(await readPublishBaseline(projectRoot)).toBeNull();
    const after = await request(app.server).get("/api/diff").expect(200);
    expect(after.body.data.files.length).toBeGreaterThan(0);

    await app.close();
  });

  it("does not consume content that changes while the index runs", async () => {
    projectRoot = await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    mockKtx(async () => {
      // A concurrent edit lands DURING the index run.
      await writeFile(
        path.join(projectRoot, "semantic-layer", "demo", "ai_intl_ad_daily.yaml"),
        `${OVERLAY}\n# concurrent edit during the index\n`,
        "utf8"
      );
      return { exitCode: 0, stdout: "indexed", stderr: "" };
    });

    const app = await buildFreshServer();
    await app.ready();

    await request(app.server).post("/api/semantic-assets/reindex").send({}).expect(200);

    // The baseline did not advance: the range stays pending.
    expect(await readPublishBaseline(projectRoot)).toBeNull();
    const after = await request(app.server).get("/api/diff").expect(200);
    expect(
      after.body.data.files.map((file: { filePath: string }) => file.filePath)
    ).toContain("semantic-layer/demo/ai_intl_ad_daily.yaml");

    const attempts = await listPublishAttempts(projectRoot);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.status).toBe("uncertain");
    expect(attempts[0]?.drift?.length).toBeGreaterThan(0);

    await app.close();
  });

  it("completes a crashed attempt at startup when the terminal evidence proves it", async () => {
    projectRoot = await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    mockKtx(async () => ({ exitCode: 0, stdout: "indexed", stderr: "" }));

    const app = await buildFreshServer();
    await app.ready();

    // First sync: everything works, and the baseline advances.
    await request(app.server).post("/api/semantic-assets/reindex").send({}).expect(200);
    expect((await readPublishBaseline(projectRoot))?.generation).toBe(1);

    // Simulate the crash window: a prepared attempt whose release record says
    // the index succeeded, but whose baseline advance never happened.
    const attempts = await listPublishAttempts(projectRoot);
    const committed = attempts[0]!;
    const crashed: PublishAttempt = {
      ...committed,
      attemptId: "att_crashed",
      status: "prepared",
      releaseId: committed.releaseId,
      expectedBaselineGeneration: 1,
      consumedFiles: { ...committed.consumedFiles }
    };
    await writePublishAttempt(projectRoot, crashed);

    const result = await reconcilePublishWorkbenchAttempts(projectRoot);
    expect(result.committed).toContain("att_crashed");
    expect((await readPublishBaseline(projectRoot))?.generation).toBe(2);

    // Idempotent: a second reconciliation does not advance again.
    const again = await reconcilePublishWorkbenchAttempts(projectRoot);
    expect(again.committed).toEqual([]);
    expect((await readPublishBaseline(projectRoot))?.generation).toBe(2);

    await app.close();
  });

  it("never fabricates a success when the terminal evidence is missing", async () => {
    projectRoot = await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    // A failed index leaves a prepared attempt with no terminal evidence.
    mockKtx(async () => ({ exitCode: 1, stdout: "", stderr: "reindex failed" }));

    const app = await buildFreshServer();
    await app.ready();

    await request(app.server).post("/api/semantic-assets/reindex").send({}).expect(200);

    const attempts = await listPublishAttempts(projectRoot);
    const source = attempts[0];
    expect(source).toBeTruthy();
    expect(source?.status).toBe("prepared");
    expect(await readPublishBaseline(projectRoot)).toBeNull();

    // A prepared attempt with NO release record: the index outcome was never
    // proven, so the baseline must not move.
    await writePublishAttempt(projectRoot, {
      ...source!,
      attemptId: "att_no_evidence",
      status: "prepared",
      releaseId: "rel_missing",
      expectedBaselineGeneration: 0
    });

    const result = await reconcilePublishWorkbenchAttempts(projectRoot);
    expect(result.committed).toEqual([]);
    expect(result.uncertain).toContain("att_no_evidence");
    expect(await readPublishBaseline(projectRoot)).toBeNull();

    await app.close();
  });
});
