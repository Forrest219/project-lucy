// P1-91 — overlay 发布护栏与 per-table overlay 生命周期（SC-01～SC-07）。
// 覆盖：三段名 overlay 表达（方案 A）、validate MANIFEST_SHADOW warnings、
// publish 双 409 组合确认（保留 snapshot）、plans 409/404 区分、
// overlays 只读盘点与受控删除（业务合并型防误删）。

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../index";

let projectRoot: string | undefined;
let previousRoot: string | undefined;
let previousContentRoot: string | undefined;

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

const OVERLAY_TWO_PART = `name: international_country_metrics
table: chatbi.ai_metric_international_country_daily
grain:
  - date
measures:
  - name: dau
    expr: sum(dau)
`;

const OVERLAY_THREE_PART = `name: international_country_metrics
table: chatbi.dbo.international_country_metrics
grain:
  - date
measures:
  - name: dau
    expr: sum(dau)
`;

async function makeProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lucy-p191-guard-"));
  await writeFile(path.join(root, "ktx.yaml"), BASE_KTX_YAML, "utf8");
  await mkdir(path.join(root, "semantic-layer", "customer-db", "_schema"), { recursive: true });
  await writeFile(
    path.join(root, "semantic-layer", "customer-db", "_schema", "chatbi.yaml"),
    MANIFEST_YAML,
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
  vi.doMock("../ktx", async () => {
    const actual = await vi.importActual<typeof import("../ktx")>("../ktx");
    return {
      ...actual,
      validateSource: vi.fn(async () => ({ ok: true, exitCode: 0, stdout: "", stderr: "", issues: [] })),
      reindexProject: vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" }))
    };
  });
  previousRoot = process.env.KTX_PROJECT_ROOT;
  previousContentRoot = process.env.LUCY_CONTENT_ROOT;
});

afterEach(async () => {
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  if (previousContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = previousContentRoot;
  if (projectRoot) {
    await rm(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    projectRoot = undefined;
  }
});

async function validate(app: Awaited<ReturnType<typeof buildServer>>, files: Array<{ filename: string; content: string }>) {
  const res = await request(app.server).post("/api/semantic-assets/validate").send({ files });
  expect(res.status).toBe(200);
  return res.body.data as {
    valid: boolean;
    validationId: string;
    warnings: Array<{ code: string; message: string }>;
    files: Array<{ kind: string; physicalTable?: string; sourceName?: string }>;
  };
}

describe("P1-91 overlay publish guard", () => {
  it("SC-01: a three-part physical name validates, publishes verbatim, and two-part behavior is unchanged", async () => {
    projectRoot = await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    const app = await buildFreshServer();
    await app.ready();

    // 三段名：validate 通过且 physicalTable 原样。
    const data = await validate(app, [{ filename: "international_country_metrics.yaml", content: OVERLAY_THREE_PART }]);
    expect(data.valid).toBe(true);
    expect(data.files[0].physicalTable).toBe("chatbi.dbo.international_country_metrics");

    // 三段名：publish 落盘后 table: 原样三段（sourceName 命中 manifest，需带 shadow 确认）。
    const publishRes = await request(app.server)
      .post("/api/semantic-assets/publish")
      .send({ validationId: data.validationId, allowManifestShadow: true });
    expect(publishRes.status).toBe(200);
    expect(publishRes.body.data.accepted).toBe(true);
    const onDisk = await readFile(
      path.join(projectRoot, "semantic-layer/customer-db/international_country_metrics.yaml"),
      "utf8"
    );
    expect(onDisk).toContain("table: chatbi.dbo.international_country_metrics");
    await app.close();

    // 两段名回归：physicalTable 与既有行为一致。
    projectRoot = await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    const app2 = await buildFreshServer();
    await app2.ready();
    const data2 = await validate(app2, [{ filename: "international_country_metrics.yaml", content: OVERLAY_TWO_PART }]);
    expect(data2.valid).toBe(true);
    expect(data2.files[0].physicalTable).toBe("chatbi.ai_metric_international_country_daily");
    await app2.close();
  });

  it("SC-03: validate warns MANIFEST_SHADOW; publish blocks with 409 OVERLAY_MANIFEST_CONFLICT, keeps the snapshot, and a confirmed retry succeeds", async () => {
    projectRoot = await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    const app = await buildFreshServer();
    await app.ready();

    const data = await validate(app, [{ filename: "international_country_metrics.yaml", content: OVERLAY_TWO_PART }]);
    expect(data.valid).toBe(true);
    const shadow = data.warnings.find((w) => w.code === "MANIFEST_SHADOW");
    expect(shadow).toBeDefined();
    expect(shadow?.message).toContain("standalone shadow");
    expect(shadow?.message).toContain("allowManifestShadow");

    // publish 未确认 → 409，不落盘。
    const blocked = await request(app.server)
      .post("/api/semantic-assets/publish")
      .send({ validationId: data.validationId });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("OVERLAY_MANIFEST_CONFLICT");
    expect(blocked.body.data.pendingConfirmations).toEqual(["allowManifestShadow"]);
    expect(Array.isArray(blocked.body.data.nextSteps)).toBe(true);
    await expect(
      readFile(path.join(projectRoot, "semantic-layer/customer-db/international_country_metrics.yaml"), "utf8")
    ).rejects.toMatchObject({ code: "ENOENT" });

    // snapshot 保留：同一 validationId 带确认重试成交。
    const retry = await request(app.server)
      .post("/api/semantic-assets/publish")
      .send({ validationId: data.validationId, allowManifestShadow: true });
    expect(retry.status).toBe(200);
    expect(retry.body.data.accepted).toBe(true);
    expect(retry.body.data.release.shadowWarnings).toHaveLength(1);
    expect(retry.body.data.release.shadowWarnings[0].code).toBe("MANIFEST_SHADOW");
    const onDisk = await readFile(
      path.join(projectRoot, "semantic-layer/customer-db/international_country_metrics.yaml"),
      "utf8"
    );
    expect(onDisk).toContain("dau");
    await app.close();
  });

  it("SC-06: overwrite + shadow gates combine into one 409 with both confirmations, and one combined retry settles; overwrite-only keeps the snapshot too", async () => {
    projectRoot = await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    // 预置同名目标文件（触发覆盖门禁）＋ sourceName 命中 manifest（触发 shadow 门禁）。
    await writeFile(
      path.join(projectRoot, "semantic-layer/customer-db/international_country_metrics.yaml"),
      "name: international_country_metrics\ntable: chatbi.ai_metric_international_country_daily\n",
      "utf8"
    );
    const app = await buildFreshServer();
    await app.ready();

    const data = await validate(app, [{ filename: "international_country_metrics.yaml", content: OVERLAY_TWO_PART }]);
    const blocked = await request(app.server)
      .post("/api/semantic-assets/publish")
      .send({ validationId: data.validationId });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("OVERLAY_MANIFEST_CONFLICT");
    expect(blocked.body.data.pendingConfirmations).toEqual(["confirmOverwrite", "allowManifestShadow"]);

    // 单次带齐两参数成交。
    const retry = await request(app.server)
      .post("/api/semantic-assets/publish")
      .send({
        validationId: data.validationId,
        confirmOverwrite: true,
        allowManifestShadow: true
      });
    expect(retry.status).toBe(200);
    expect(retry.body.data.accepted).toBe(true);
    await app.close();

    // 仅覆盖门禁：409 VALIDATION_GATE_FAILED + pendingConfirmations 一项 + snapshot 保留。
    projectRoot = await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    await writeFile(
      path.join(projectRoot, "semantic-layer/customer-db/unrelated_source.yaml"),
      "name: unrelated_source\ntable: chatbi.ai_metric_international_country_daily\n",
      "utf8"
    );
    const app2 = await buildFreshServer();
    await app2.ready();
    const data2 = await validate(app2, [{ filename: "unrelated_source.yaml", content: OVERLAY_TWO_PART.replace("international_country_metrics", "unrelated_source") }]);
    const blocked2 = await request(app2.server)
      .post("/api/semantic-assets/publish")
      .send({ validationId: data2.validationId });
    expect(blocked2.status).toBe(409);
    expect(blocked2.body.error.code).toBe("VALIDATION_GATE_FAILED");
    expect(blocked2.body.data.pendingConfirmations).toEqual(["confirmOverwrite"]);
    const retry2 = await request(app2.server)
      .post("/api/semantic-assets/publish")
      .send({ validationId: data2.validationId, confirmOverwrite: true });
    expect(retry2.status).toBe(200);
    await app2.close();
  });

  it("SC-06: plans distinguishes a legacy snapshot (409 PLAN_PREVIEW_NOT_AVAILABLE) from a missing one (404)", async () => {
    projectRoot = await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    const app = await buildFreshServer();
    await app.ready();
    const data = await validate(app, [{ filename: "international_country_metrics.yaml", content: OVERLAY_TWO_PART }]);

    const legacy = await request(app.server).get(`/api/semantic-assets/plans/${data.validationId}`);
    expect(legacy.status).toBe(409);
    expect(legacy.body.error.code).toBe("PLAN_PREVIEW_NOT_AVAILABLE");
    expect(Array.isArray(legacy.body.data.nextSteps)).toBe(true);

    const missing = await request(app.server).get("/api/semantic-assets/plans/val_does_not_exist");
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("VALIDATION_SNAPSHOT_NOT_FOUND");
    await app.close();
  });
});

describe("P1-91 per-table overlay lifecycle", () => {
  async function seedOverlayFiles() {
    await mkdir(path.join(projectRoot!, "semantic-layer", "customer-db"), { recursive: true });
    // standalone（遮蔽 manifest 表）
    await writeFile(
      path.join(projectRoot!, "semantic-layer", "customer-db", "international_country_metrics.yaml"),
      "name: international_country_metrics\ntable: chatbi.dbo.international_country_metrics\ngrain:\n  - date\n",
      "utf8"
    );
    // 业务合并型 overlay（无 table/sql；不遮蔽 manifest）
    await writeFile(
      path.join(projectRoot!, "semantic-layer", "customer-db", "biz_overlay.yaml"),
      "name: biz_overlay\ngrain:\n  - date\nmeasures:\n  - name: dau\n    expr: sum(dau)\n",
      "utf8"
    );
  }

  it("SC-07: list marks standalone vs merge_overlay and shadowsManifest; delete protects business overlays", async () => {
    projectRoot = await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    await seedOverlayFiles();
    const app = await buildFreshServer();
    await app.ready();

    const list = await request(app.server).get("/api/semantic-assets/overlays?conn=customer-db").expect(200);
    const items = list.body.data.items as Array<{
      connectionId: string;
      sourceName: string;
      kind: string;
      physicalTable: string | null;
      shadowsManifest: boolean;
      manifestPath?: string;
    }>;
    const standalone = items.find((i) => i.sourceName === "international_country_metrics");
    const merge = items.find((i) => i.sourceName === "biz_overlay");
    expect(standalone).toMatchObject({
      connectionId: "customer-db",
      kind: "standalone",
      physicalTable: "chatbi.dbo.international_country_metrics",
      shadowsManifest: true
    });
    expect(standalone?.manifestPath).toBe("semantic-layer/customer-db/_schema/chatbi.yaml");
    expect(merge).toMatchObject({ kind: "merge_overlay", physicalTable: null, shadowsManifest: false });

    // 无 conn 参数列全连接。
    const listAll = await request(app.server).get("/api/semantic-assets/overlays").expect(200);
    expect(listAll.body.data.items.length).toBeGreaterThanOrEqual(items.length);

    // 未知查询参数 → 400。
    const badQuery = await request(app.server).get("/api/semantic-assets/overlays?conn=customer-db&extra=1");
    expect(badQuery.status).toBe(400);
    expect(badQuery.body.error.code).toBe("INVALID_OVERLAY_LIST_QUERY");

    // DELETE 业务合并型：未确认 → 409 不删盘。
    const protectedRes = await request(app.server).delete("/api/semantic-assets/overlay/customer-db/biz_overlay");
    expect(protectedRes.status).toBe(409);
    expect(protectedRes.body.error.code).toBe("OVERLAY_BUSINESS_ENRICHMENT_PROTECTED");
    expect(protectedRes.body.data.kind).toBe("merge_overlay");
    await expect(
      readFile(path.join(projectRoot, "semantic-layer/customer-db/biz_overlay.yaml"), "utf8")
    ).resolves.toContain("dau");

    // DELETE standalone：dryRun 默认 true，不删盘。
    const dryRun = await request(app.server).delete("/api/semantic-assets/overlay/customer-db/international_country_metrics");
    expect(dryRun.status).toBe(200);
    expect(dryRun.body.data).toMatchObject({
      files: ["semantic-layer/customer-db/international_country_metrics.yaml"],
      noChanges: false,
      kind: "standalone",
      dryRun: true
    });
    await expect(
      readFile(path.join(projectRoot, "semantic-layer/customer-db/international_country_metrics.yaml"), "utf8")
    ).resolves.toContain("chatbi.dbo");

    // DELETE standalone 正式：删除成功 + fallback 文案。
    const del = await request(app.server)
      .delete("/api/semantic-assets/overlay/customer-db/international_country_metrics?dryRun=false")
      .expect(200);
    expect(del.body.data).toMatchObject({
      deleted: true,
      noChanges: false,
      deletedFiles: ["semantic-layer/customer-db/international_country_metrics.yaml"],
      kind: "standalone"
    });
    expect(del.body.data.fallback).toContain("回落 Schema Manifest");
    await expect(
      readFile(path.join(projectRoot, "semantic-layer/customer-db/international_country_metrics.yaml"), "utf8")
    ).rejects.toMatchObject({ code: "ENOENT" });

    // 业务合并型带确认后可删。
    const delMerge = await request(app.server)
      .delete(
        "/api/semantic-assets/overlay/customer-db/biz_overlay?dryRun=false&confirmBusinessOverlayDelete=true"
      )
      .expect(200);
    expect(delMerge.body.data.deleted).toBe(true);
    expect(delMerge.body.data.fallback).toContain("业务合并口径已清除");
    await app.close();
  });

  it("SC-05: delete safety boundaries — unknown params 400, unsafe segment 400, missing file 404", async () => {
    projectRoot = await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    const app = await buildFreshServer();
    await app.ready();

    const unknown = await request(app.server)
      .delete("/api/semantic-assets/overlay/customer-db/some_overlay?dryRun=false&force=1");
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.code).toBe("INVALID_OVERLAY_DELETE_QUERY");
    expect(Array.isArray(unknown.body.data.nextSteps)).toBe(true);

    const unsafe = await request(app.server)
      .delete("/api/semantic-assets/overlay/customer-db/..%2F_schema%2Fchatbi");
    expect(unsafe.status).toBe(400);
    expect(unsafe.body.error.code).toBe("OVERLAY_DELETE_FORBIDDEN");

    const missing = await request(app.server)
      .delete("/api/semantic-assets/overlay/customer-db/no_such_overlay");
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("OVERLAY_NOT_FOUND");
    await app.close();
  });

  it("records the delete recovery journal with newContent null (review BLOCK regression: crash after delete must not latch recovery_required)", async () => {
    projectRoot = await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    await seedOverlayFiles();
    const capturedTargets: Array<Record<string, unknown>> = [];
    vi.doMock("../semantic-recovery-journal", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../semantic-recovery-journal")>();
      return {
        ...actual,
        createRecoveryJournal: vi.fn(async (
          root: string,
          input: Parameters<typeof actual.createRecoveryJournal>[1]
        ) => {
          capturedTargets.push(...(input.targets as unknown as Array<Record<string, unknown>>));
          return actual.createRecoveryJournal(root, input);
        })
      };
    });
    const app = await buildFreshServer();
    await app.ready();
    await request(app.server)
      .delete("/api/semantic-assets/overlay/customer-db/international_country_metrics?dryRun=false")
      .expect(200);
    expect(capturedTargets).toHaveLength(1);
    // journal 合同：null 才是删除标记（"" 会被启动恢复误判 conflict 而锁死写路径）。
    expect(capturedTargets[0].newContent).toBeNull();
    await app.close();
  });

  it("re-validates the file kind inside the window: a preview-then-rewritten target aborts with 409", async () => {
    projectRoot = await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    await seedOverlayFiles();
    // 直接以「预览时是 standalone、窗口内已是 merge_overlay」的过期 outcome 驱动
    // 窗口内复验（API 层无法确定性构造该竞态）。
    const { deletePerTableOverlay } = await import("../semantic-overlay-lifecycle");
    const staleOutcome = {
      relPath: "semantic-layer/customer-db/international_country_metrics.yaml",
      kind: "standalone" as const,
      diff: "-"
    };
    // 先把文件改写为业务合并型（模拟预览后的并发写）。
    await writeFile(
      path.join(projectRoot, "semantic-layer", "customer-db", "international_country_metrics.yaml"),
      "name: international_country_metrics\ngrain:\n  - date\nmeasures:\n  - name: dau\n    expr: sum(dau)\n",
      "utf8"
    );
    await expect(
      deletePerTableOverlay(projectRoot, "customer-db", "international_country_metrics", staleOutcome, undefined)
    ).rejects.toMatchObject({
      code: "OVERLAY_BUSINESS_ENRICHMENT_PROTECTED",
      message: expect.stringContaining("已变化")
    });
    // 文件未被删除。
    await expect(
      readFile(path.join(projectRoot, "semantic-layer/customer-db/international_country_metrics.yaml"), "utf8")
    ).resolves.toContain("dau");
  });
});
