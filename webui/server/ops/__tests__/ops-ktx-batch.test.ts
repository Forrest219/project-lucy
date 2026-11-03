/**
 * L25-16 S3 — `lucy_ops_connection_tables` 批量写（Spec §3.3 / §6.3，R07 / R15，G17 / G26）。
 *
 * 覆盖本阶段仍缺的直接测试：
 * - **控制面拒绝 `deleteManifest` / `deleteOverlays`**：控制面只改 ktx.yaml，不删语义文件。
 * - **连接表任一失败 ⇒ 整批不写**：组内任一成员不可执行（校验失败）时，同组全部成员都不写，
 *   ktx.yaml 保持字节不变。
 * - **预览后被外部修改 ⇒ 整批不写**：锁内复算基线时发现外部修改即整批拒绝，且**不得**用回滚
 *   覆盖别人的外部修改（回滚不是"补偿写入"）。
 *
 * 原子性口径是 `batch_all_or_nothing`：全部 KTX 连接配置在同一份 ktx.yaml，一次合并写就是一个
 * 原子组，组内不能报告部分成功。
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getOpsToolSpec } from "../control-plane";
import { runOpsCommit, runOpsPreview } from "../ops-batch";
import { getOpsDatabase } from "../ops-idempotency";
import type { OpsGrant } from "../ops-grants";
import { OpsConnectionTablesAdapter, parseConnectionTableTargets } from "../ops-ktx-batch";

const TOOL = "lucy_ops_connection_tables";

const GRANTS: OpsGrant[] = [
  { tools: [TOOL], asset_kinds: ["governance"], connections: ["conn_a", "conn_b"] }
];

const KTX_YAML = `connections:
  conn_a:
    driver: duckdb
    schemas:
      - s1
    enabled_tables:
      - s1.orders
  conn_b:
    driver: duckdb
    schemas:
      - s1
    enabled_tables:
      - s1.orders
`;

const MANIFEST = `tables:
  orders:
    table: orders
    columns:
      - name: id
        type: integer
`;

let projectRoot: string;
let previousRoot: string | undefined;
let previousAuditDb: string | undefined;
let ktxPath: string;

beforeAll(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "ktx-ops-ktx-"));
  await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
  await mkdir(path.join(projectRoot, "semantic-layer", "conn_a", "_schema"), { recursive: true });
  await mkdir(path.join(projectRoot, "semantic-layer", "conn_b", "_schema"), { recursive: true });
  ktxPath = path.join(projectRoot, "ktx.yaml");
  await writeFile(ktxPath, KTX_YAML, "utf8");
  await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), "roles: {}\nusers: []\n", "utf8");
  await writeFile(path.join(projectRoot, "semantic-layer", "conn_a", "_schema", "s1.yaml"), MANIFEST, "utf8");
  await writeFile(path.join(projectRoot, "semantic-layer", "conn_b", "_schema", "s1.yaml"), MANIFEST, "utf8");
  previousRoot = process.env.KTX_PROJECT_ROOT;
  previousAuditDb = process.env.LUCY_AUDIT_DB;
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_AUDIT_DB = path.join(projectRoot, ".ktx-ui", "audit.sqlite");
});

afterAll(async () => {
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  if (previousAuditDb === undefined) delete process.env.LUCY_AUDIT_DB;
  else process.env.LUCY_AUDIT_DB = previousAuditDb;
  await rm(projectRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  await writeFile(ktxPath, KTX_YAML, "utf8");
  const database = await getOpsDatabase();
  database.exec(
    "DELETE FROM ops_operations; DELETE FROM ops_targets; DELETE FROM ops_plans; DELETE FROM config_change_log;"
  );
});

async function preview(
  adapter: OpsConnectionTablesAdapter,
  targets: unknown[]
): Promise<{ planId: string; digest: string }> {
  const envelope = await runOpsPreview({
    adapter,
    projectRoot,
    actor: "ops_agent",
    delegatedFrom: null,
    request: { targets }
  });
  expect(envelope.ok).toBe(true);
  if (!envelope.ok) throw new Error("preview failed");
  const data = envelope.data as { plan_id: string; confirm_digest: string };
  return { planId: data.plan_id, digest: data.confirm_digest };
}

describe("L25-16 S3 控制面不提供语义内容删除", () => {
  it("target 带 deleteManifest → 拒绝（ops_schema_content_delete_unsupported）", () => {
    expect(() =>
      parseConnectionTableTargets({
        targets: [{ connectionId: "conn_a", removeSchema: "s1", deleteManifest: true }]
      })
    ).toThrowError(
      expect.objectContaining({ code: "ops_schema_content_delete_unsupported" })
    );
  });

  it("target 带 deleteOverlays → 拒绝（ops_schema_content_delete_unsupported）", () => {
    expect(() =>
      parseConnectionTableTargets({
        targets: [{ connectionId: "conn_a", enabledTables: ["s1.orders"], deleteOverlays: true }]
      })
    ).toThrowError(
      expect.objectContaining({ code: "ops_schema_content_delete_unsupported" })
    );
  });

  it("拒绝发生在解析阶段 ⇒ 计划不会产生，ktx.yaml 不动", async () => {
    const before = await readFile(ktxPath, "utf8");
    const adapter = new OpsConnectionTablesAdapter();
    await expect(
      runOpsPreview({
        adapter,
        projectRoot,
        actor: "ops_agent",
        delegatedFrom: null,
        request: { targets: [{ connectionId: "conn_a", removeSchema: "s1", deleteManifest: true }] }
      })
    ).rejects.toThrowError(expect.objectContaining({ code: "ops_schema_content_delete_unsupported" }));
    expect(await readFile(ktxPath, "utf8")).toBe(before);
  });
});

describe("L25-16 S3 连接表整批全成或全拒", () => {
  it("任一连接的启用表校验失败 ⇒ 整批不写（两个目标都判失败，ktx.yaml 字节不变）", async () => {
    const adapter = new OpsConnectionTablesAdapter();
    const before = await readFile(ktxPath, "utf8");

    const { planId, digest } = await preview(adapter, [
      { connectionId: "conn_a", enabledTables: ["s1.orders"] },
      // conn_b 请求一张既没被扫描到、也不在原启用列表里的表 → 校验失败。
      { connectionId: "conn_b", enabledTables: ["s9.not_scanned"] }
    ]);

    const envelope = await runOpsCommit({
      adapter,
      projectRoot,
      actor: "ops_agent",
      delegatedFrom: null,
      idempotencyKey: "idem-ktx-invalid",
      planId,
      confirmDigest: digest,
      requestTargetIds: ["tables:conn_a", "tables:conn_b"],
      grants: GRANTS,
      tool: getOpsToolSpec(TOOL)
    });

    expect(envelope.ok).toBe(true);
    if (!envelope.ok) return;
    const data = envelope.data as {
      per_target: Array<{ id: string; kind: string; code: string | null }>;
      succeeded: number;
      failed: number;
    };
    // 整批不写：没有任何成员成功，**连本来合法的 conn_a 也不能成功**。
    expect(data.succeeded).toBe(0);
    expect(data.failed).toBe(2);
    for (const item of data.per_target) {
      expect(item.kind).toBe("failed");
      expect(item.code).toBe("ops_group_blocked");
    }

    expect(await readFile(ktxPath, "utf8")).toBe(before);
  });

  it("预览后被外部修改 ⇒ 整批不写，且不得用回滚覆盖外部修改", async () => {
    const adapter = new OpsConnectionTablesAdapter();
    const { planId, digest } = await preview(adapter, [
      { connectionId: "conn_a", enabledTables: ["s1.orders"] }
    ]);

    // 外部修改：在预览之后改了 conn_a 的 enabled_tables。
    const externallyModified = KTX_YAML.replace(
      "  conn_a:\n    driver: duckdb\n    schemas:\n      - s1\n    enabled_tables:\n      - s1.orders\n",
      "  conn_a:\n    driver: duckdb\n    schemas:\n      - s1\n    enabled_tables:\n      - s1.orders\n      - s1.externally_added\n"
    );
    await writeFile(ktxPath, externallyModified, "utf8");

    const envelope = await runOpsCommit({
      adapter,
      projectRoot,
      actor: "ops_agent",
      delegatedFrom: null,
      idempotencyKey: "idem-ktx-external",
      planId,
      confirmDigest: digest,
      requestTargetIds: ["tables:conn_a"],
      grants: GRANTS,
      tool: getOpsToolSpec(TOOL)
    });

    expect(envelope.ok).toBe(true);
    if (!envelope.ok) return;
    const data = envelope.data as {
      per_target: Array<{ id: string; kind: string }>;
      succeeded: number;
      failed: number;
    };
    expect(data.succeeded).toBe(0);
    expect(data.failed).toBe(1);

    // 整批不写：ktx.yaml 必须仍是**外部修改之后**的内容（回滚不得覆盖别人的改动）。
    expect(await readFile(ktxPath, "utf8")).toBe(externallyModified);
  });

  it("写入成功后效果阶段按目标 id 落成 activated，而不是停在 none", async () => {
    const adapter = new OpsConnectionTablesAdapter();
    const { planId, digest } = await preview(adapter, [
      { connectionId: "conn_a", enabledTables: ["s1.orders"] }
    ]);

    const envelope = await runOpsCommit({
      adapter,
      projectRoot,
      actor: "ops_agent",
      delegatedFrom: null,
      idempotencyKey: "idem-ktx-effect-phase",
      planId,
      confirmDigest: digest,
      requestTargetIds: ["tables:conn_a"],
      grants: GRANTS,
      tool: getOpsToolSpec(TOOL)
    });

    expect(envelope.ok).toBe(true);
    if (!envelope.ok) return;
    const data = envelope.data as { per_target: Array<{ id: string; kind: string }> };
    expect(data.per_target.map((item) => item.kind)).toEqual(["succeeded"]);

    const database = await getOpsDatabase();
    const row = database
      .prepare("SELECT target_id, effect_phase, status FROM ops_targets WHERE target_id = ?")
      .get("tables:conn_a") as { target_id: string; effect_phase: string; status: string };
    expect(row.effect_phase).toBe("activated");
    expect(row.status).toBe("succeeded");
  });

  it("catalog 重载失败后 effect_phase 停在 written，收尾不得写回 none", async () => {
    const catalog = await import("../../catalog-reload.js");
    const reload = vi.spyOn(catalog, "reloadCatalog").mockRejectedValueOnce(new Error("reload failed"));
    try {
      const adapter = new OpsConnectionTablesAdapter();
      const { planId, digest } = await preview(adapter, [
        { connectionId: "conn_a", enabledTables: ["s1.orders"] }
      ]);
      const envelope = await runOpsCommit({
        adapter,
        projectRoot,
        actor: "ops_agent",
        delegatedFrom: null,
        idempotencyKey: "idem-ktx-reload-fail",
        planId,
        confirmDigest: digest,
        requestTargetIds: ["tables:conn_a"],
        grants: GRANTS,
        tool: getOpsToolSpec(TOOL)
      });
      expect(envelope.ok).toBe(true);
      if (!envelope.ok) return;
      const data = envelope.data as { per_target: Array<{ kind: string }> };
      expect(data.per_target.map((item) => item.kind)).toEqual(["recovery_required"]);
      const database = await getOpsDatabase();
      const row = database
        .prepare("SELECT effect_phase, status FROM ops_targets WHERE target_id = ?")
        .get("tables:conn_a") as { effect_phase: string; status: string };
      expect(row.status).toBe("recovery_required");
      expect(row.effect_phase).toBe("written");
    } finally {
      reload.mockRestore();
    }
  });
});
