// Spec `lucy-20261030-publish-workbench-three-column-spec.md` §4.4 / §5.5 —
// the remaining acceptance rows that had no dedicated case.
//
// Coverage:
//  - PWB-15: the pending list is a CONTENT difference — crossing midnight or a
//    year boundary never empties it, and the release history is not silently
//    limited to "today".
//  - PWB-26: a staged batch and a plain disk sync explain their scope with the
//    SAME rules. Only the change-source label differs; the range, the reasons
//    and the totals are identical.

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  advancePublishBaseline,
  capturePublishConsumption,
  readPublishPendingSnapshot
} from "../publish-workbench-state";
import { buildPublishImpact } from "../publish-impact";

let projectRoot: string;
let previousContentRoot: string | undefined;
let previousRoot: string | undefined;

const MANIFEST = `tables:
  orders:
    table: sales.orders
    columns:
      - name: id
        type: string
`;

const OVERLAY = `name: orders
grain:
  - id
measures:
  - name: total
    expr: sum(amount)
`;

async function writeContent(relPath: string, content: string): Promise<void> {
  const abs = path.join(projectRoot, relPath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content, "utf8");
}

async function seedBase(): Promise<void> {
  // `resolveProjectRoot` 要求项目根下有 ktx.yaml。
  await writeFile(
    path.join(projectRoot, "ktx.yaml"),
    `connections:
  conn-a:
    driver: mysql
    schemas:
      - sales
    enabled_tables:
      - sales.orders
`,
    "utf8"
  );
  await writeContent("semantic-layer/conn-a/_schema/sales.yaml", MANIFEST);
  await writeContent("semantic-layer/conn-a/orders.yaml", OVERLAY);
}

async function commitBaseline(): Promise<void> {
  const capture = await capturePublishConsumption(projectRoot);
  await advancePublishBaseline(projectRoot, {
    expectedGeneration: capture.baselineGeneration,
    files: capture.files
  });
}

async function buildFreshServer() {
  const { buildServer } = await import("../index");
  return buildServer();
}

// 本文件不安装宿主 ktx CLI：CI 的 spec-and-webui job 从不装它（只有 Dockerfile 里
// 钉版本），真调 execFile("ktx") 会得到 ENOENT → KtxCliError → 503。故与同族用例
// （api.publish-workbench / publish-workbench-lifecycle）一样把 ../ktx 打桩。
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

beforeEach(async () => {
  vi.resetModules();
  previousContentRoot = process.env.LUCY_CONTENT_ROOT;
  previousRoot = process.env.KTX_PROJECT_ROOT;
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-pwb-closure-"));
  process.env.LUCY_CONTENT_ROOT = ".";
  process.env.KTX_PROJECT_ROOT = projectRoot;
  await seedBase();
});

afterEach(async () => {
  vi.useRealTimers();
  if (previousContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = previousContentRoot;
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  if (projectRoot) {
    await rm(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

describe("PWB-15 — 待办与时间无关，历史不固定限制为今天", () => {
  it("keeps the pending list and its digest across midnight and a year boundary", async () => {
    const before = await readPublishPendingSnapshot(projectRoot);
    expect(before.changes).toHaveLength(2);

    // 把时钟推到跨年的午夜之后。只 fake Date——文件系统与计时器不受影响。
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-01-01T00:00:30+08:00"));
    const after = await readPublishPendingSnapshot(projectRoot);
    vi.useRealTimers();

    expect(after.changes.map((change) => change.logicalPath)).toEqual(
      before.changes.map((change) => change.logicalPath)
    );
    // 待办由内容差异决定，时钟不参与摘要计算。
    expect(after.pendingDigest).toBe(before.pendingDigest);
    expect(after.baselineState).toBe(before.baselineState);
  });

  it("does not limit the release history to today", async () => {
    mockKtx();
    const { buildServer } = await import("../index");
    const app = await buildServer();
    await app.ready();

    await request(app.server).post("/api/semantic-assets/reindex").send({}).expect(200);

    // 不带日期参数 = 全部历史。
    const all = await request(app.server).get("/api/semantic-assets/releases").expect(200);
    // 带一个覆盖一切的显式窗口 = 同一批记录。
    const wide = await request(app.server)
      .get("/api/semantic-assets/releases?since=2000-01-01T00:00:00.000Z&until=2100-01-01T00:00:00.000Z")
      .expect(200);

    expect(all.body.data.records.length).toBeGreaterThan(0);
    expect(wide.body.data.records.length).toBe(all.body.data.records.length);
    expect(wide.body.data.records.map((r: { id: string }) => r.id)).toEqual(
      all.body.data.records.map((r: { id: string }) => r.id)
    );

    await app.close();
  });
});

describe("PWB-26 — 常规同步与 staged 批次复用同一影响说明规则", () => {
  it("gives the same range, reasons and totals for a staged batch and a plain sync", async () => {
    await writeContent(
      "semantic-layer/conn-a/orders.yaml",
      `${OVERLAY}\n  - name: extra\n    expr: count(*)\n`
    );

    const snapshot = await readPublishPendingSnapshot(projectRoot);
    const plain = await buildPublishImpact({ projectRoot, snapshot });
    const staged = await buildPublishImpact({
      projectRoot,
      snapshot,
      stagedPaths: new Set(["semantic-layer/conn-a/orders.yaml"])
    });

    // 范围一致。
    expect(staged.tables.map((table) => table.identity)).toEqual(
      plain.tables.map((table) => table.identity)
    );
    // 计数一致。
    expect(staged.counts).toEqual(plain.counts);
    // 原因一致——不是从文件名猜出来的另一套说法。
    expect(staged.tables[0]?.reasons.map((reason) => ({ kind: reason.kind, summary: reason.summary }))).toEqual(
      plain.tables[0]?.reasons.map((reason) => ({ kind: reason.kind, summary: reason.summary }))
    );
    // 唯一差别是「变更来源」的标记。
    expect(plain.tables[0]?.reasons[0]?.source).toBe("pending_disk_change");
    expect(staged.tables[0]?.reasons[0]?.source).toBe("staged_candidate");
  });

  it("keeps the same rules after a baseline exists — the reason is derived, not guessed", async () => {
    await commitBaseline();
    await writeContent(
      "semantic-layer/conn-a/orders.yaml",
      `${OVERLAY}\n  - name: extra\n    expr: count(*)\n`
    );

    const snapshot = await readPublishPendingSnapshot(projectRoot);
    const plain = await buildPublishImpact({ projectRoot, snapshot });
    const staged = await buildPublishImpact({
      projectRoot,
      snapshot,
      stagedPaths: new Set(["semantic-layer/conn-a/orders.yaml"])
    });

    expect(staged.tables.map((table) => table.identity)).toEqual(
      plain.tables.map((table) => table.identity)
    );
    expect(staged.counts).toEqual(plain.counts);
    // 有可信前版本时，原因说的是实际发生的定义变更，而不是「首次核对」。
    expect(plain.tables[0]?.reasons[0]?.kind).not.toBe("first_verification");
    expect(staged.tables[0]?.reasons[0]?.summary).toBe(plain.tables[0]?.reasons[0]?.summary);
  });
});
