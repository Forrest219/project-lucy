/**
 * L25-16 S2 — 认领事务、attempt 生命周期与双层审计（Spec §4.4 / §6.2，G34 / R10，Q01 / Q02）。
 *
 * 覆盖本阶段仍缺的直接测试：
 * - **认领事务失败不留行不写文件**（G34）：认领与审计同事务；事务回滚后既没有幂等行、
 *   也没有审计行，且绝不产生文件效果。
 * - **失败成员可进入新 attempt**：失败的成员保留失败痕迹在旧 attempt，本次范围内的失败成员
 *   进入**新** attempt 重新认领。
 * - **attempt 审计与全集 operation 记录分开**：审计事件键含 attempt ⇒ 同一目标的每次 attempt
 *   各有**一行**审计（互不覆盖）；而全集 operation 记录**只有一行**，反映跨成员跨 attempt 的聚合。
 *
 * 本文件用**假适配器**驱动编排层：既要能精确注入「认领事务失败」，又不能把
 * 连接表 / 源表导入的真实写路径混进来（那两条路径各有自己的测试文件）。
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getOpsToolSpec } from "../control-plane";
import {
  runOpsCommit,
  runOpsPreview,
  type OpsGroupContext,
  type OpsPlanBuildContext,
  type OpsPlanDraft,
  type OpsRollbackResult,
  type OpsToolAdapter
} from "../ops-batch";
import { getOpsDatabase } from "../ops-idempotency";
import type { OpsGrant } from "../ops-grants";
import type { OpsTargetAuditDescriptor } from "../ops-audit";

const TOOL = "lucy_ops_connection_tables";

const GRANTS: OpsGrant[] = [
  { tools: [TOOL], asset_kinds: ["governance"], connections: ["conn_a"] }
];

// ─── 假适配器 ────────────────────────────────────────────────────────────────

interface FakeTargetInput {
  id: string;
  connectionId: string;
}

interface FakeGroupPlan {
  id: string;
  memberIds: string[];
}

/**
 * 假适配器：
 * - 每个目标独占一个组（便于构造「一个组失败、另一个组成功」）；
 * - `failGroups` 里的组执行即抛错（模拟效果前异常）；
 * - `executeGroup` 成功时写一个文件（用于断言「认领失败 ⇒ 不写文件」）。
 */
class FakeAdapter implements OpsToolAdapter {
  readonly toolName = TOOL;

  /** 执行过的组 id（按顺序）。 */
  readonly executedGroups: string[] = [];
  /** 需要失败的组 id。 */
  failGroups = new Set<string>();
  /** 每个目标归属的组（默认一个目标一组）。 */
  groupOf = new Map<string, string>();

  operationAudit() {
    return {
      filePath: "fake/operation.yaml",
      changeType: "ops_fake_batch",
      assetKind: "governance" as const
    };
  }

  parseTargets(request: Record<string, unknown>): unknown[] {
    const raw = request.targets;
    return Array.isArray(raw) ? raw : [];
  }

  targetId(target: unknown): string {
    return (target as FakeTargetInput).id;
  }

  connectionId(target: unknown): string {
    return (target as FakeTargetInput).connectionId;
  }

  async buildPlan(_ctx: OpsPlanBuildContext): Promise<OpsPlanDraft> {
    const targets = this.parseTargets({ targets: [] }) as FakeTargetInput[];
    void targets;
    return { perTarget: [], groups: [] };
  }

  async executeGroup(ctx: OpsGroupContext): Promise<void> {
    this.executedGroups.push(ctx.group.id);
    if (this.failGroups.has(ctx.group.id)) {
      throw new Error(`injected group failure for ${ctx.group.id}`);
    }
    await writeFile(path.join(ctx.projectRoot, "fake-effect.txt"), "written", "utf8");
  }

  async rollbackGroup(_ctx: OpsGroupContext): Promise<OpsRollbackResult> {
    return { complete: true };
  }
}

/** 目标 → 组 的映射可配置版本（buildPlan 需要真实的 request）。 */
class PlannedFakeAdapter extends FakeAdapter {
  planTargets: FakeTargetInput[] = [];
  targetGroups = new Map<string, string>();

  override async buildPlan(ctx: OpsPlanBuildContext): Promise<OpsPlanDraft> {
    const targets = this.parseTargets(ctx.request) as FakeTargetInput[];
    const groupIds = new Set<string>();
    for (const target of targets) {
      const groupId = this.targetGroups.get(target.id) ?? `g:${target.id}`;
      groupIds.add(groupId);
    }
    const perTarget = targets.map((target) => {
      const groupId = this.targetGroups.get(target.id) ?? `g:${target.id}`;
      const audit: OpsTargetAuditDescriptor = {
        changeType: "ops_fake_target",
        assetKind: "governance",
        targetId: target.id,
        filePath: `fake/${target.id}.yaml`
      };
      return {
        id: target.id,
        groupId,
        connectionId: target.connectionId,
        payload: { id: target.id },
        before: { v: 0 },
        after: { v: 1 },
        blockers: [] as string[],
        writeSet: [`fake/${target.id}.yaml`],
        audit
      };
    });
    const groups: FakeGroupPlan[] = [...groupIds].map((id) => ({
      id,
      memberIds: perTarget.filter((t) => t.groupId === id).map((t) => t.id)
    }));
    return { perTarget, groups } as unknown as OpsPlanDraft;
  }
}

// ─── 测试脚手架 ──────────────────────────────────────────────────────────────

let projectRoot: string;
let previousRoot: string | undefined;
let previousAuditDb: string | undefined;

const KTX_YAML = `connections:
  conn_a:
    driver: duckdb
    schemas:
      - s1
    enabled_tables:
      - s1.orders
`;

beforeAll(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "ktx-ops-claim-"));
  await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
  await mkdir(path.join(projectRoot, "semantic-layer", "conn_a", "_schema"), { recursive: true });
  await writeFile(path.join(projectRoot, "ktx.yaml"), KTX_YAML, "utf8");
  await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), "roles: {}\nusers: []\n", "utf8");
  await writeFile(path.join(projectRoot, "semantic-layer", "conn_a", "_schema", "s1.yaml"), "tables: {}\n", "utf8");
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
  const database = await getOpsDatabase();
  database.exec(
    "DELETE FROM ops_operations; DELETE FROM ops_targets; DELETE FROM ops_plans; DELETE FROM config_change_log;"
  );
  await rm(path.join(projectRoot, "fake-effect.txt"), { force: true });
});

afterEach(async () => {
  const { resetAuditDbForTests } = await import("../../admin/audit");
  resetAuditDbForTests();
});

async function tableCount(database: Awaited<ReturnType<typeof getOpsDatabase>>, sql: string): Promise<number> {
  const row = database.prepare(sql).get() as { n: number } | undefined;
  return row?.n ?? 0;
}

async function previewPlan(
  adapter: PlannedFakeAdapter,
  targets: FakeTargetInput[]
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

// ─── 测试 ────────────────────────────────────────────────────────────────────

describe("L25-16 S2 认领事务（G34）", () => {
  it("认领事务失败：既不留幂等行 / 审计行，也不写任何文件", async () => {
    const adapter = new PlannedFakeAdapter();
    adapter.targetGroups.set("t1", "g1");
    const { planId, digest } = await previewPlan(adapter, [{ id: "t1", connectionId: "conn_a" }]);

    // 注入：审计行写入失败 → 认领事务必须整段回滚。
    const database = await getOpsDatabase();
    const proto = Object.getPrototypeOf(database) as {
      prepare: (sql: string) => unknown;
    };
    const originalPrepare = proto.prepare;
    proto.prepare = function patched(this: unknown, sql: string) {
      if (/INSERT INTO config_change_log/i.test(sql)) {
        throw new Error("injected config_change_log insert failure");
      }
      return originalPrepare.call(this, sql);
    };

    let envelope: Awaited<ReturnType<typeof runOpsCommit>>;
    try {
      envelope = await runOpsCommit({
        adapter,
        projectRoot,
        actor: "ops_agent",
        delegatedFrom: null,
        idempotencyKey: "idem-claim-fail",
        planId,
        confirmDigest: digest,
        requestTargetIds: ["t1"],
        grants: GRANTS,
        tool: getOpsToolSpec(TOOL)
      });
    } finally {
      proto.prepare = originalPrepare;
    }

    expect(envelope.ok).toBe(false);
    if (envelope.ok) return;
    expect(envelope.error.code).toBe("ops_claim_failed");

    // 不留行：幂等记录与审计行都必须为空。
    expect(await tableCount(database, "SELECT COUNT(*) AS n FROM ops_operations")).toBe(0);
    expect(await tableCount(database, "SELECT COUNT(*) AS n FROM ops_targets")).toBe(0);
    expect(await tableCount(database, "SELECT COUNT(*) AS n FROM config_change_log")).toBe(0);

    // 不写文件：组执行根本没有被调用。
    expect(adapter.executedGroups).toEqual([]);
    await expect(
      import("node:fs/promises").then((fs) => fs.stat(path.join(projectRoot, "fake-effect.txt")))
    ).rejects.toThrow();
  });
});

describe("L25-16 S2 attempt 生命周期", () => {
  it("失败成员可进入新 attempt：失败痕迹留在旧 attempt，新 attempt 重新认领并成功", async () => {
    const adapter = new PlannedFakeAdapter();
    adapter.targetGroups.set("t1", "g1");
    adapter.targetGroups.set("t2", "g2");
    adapter.failGroups.add("g1");

    const { planId, digest } = await previewPlan(adapter, [
      { id: "t1", connectionId: "conn_a" },
      { id: "t2", connectionId: "conn_a" }
    ]);

    // ── attempt 1：t1 所在组失败，t2 成功 ────────────────────────────────
    const first = await runOpsCommit({
      adapter,
      projectRoot,
      actor: "ops_agent",
      delegatedFrom: null,
      idempotencyKey: "idem-attempt",
      planId,
      confirmDigest: digest,
      requestTargetIds: ["t1", "t2"],
      grants: GRANTS,
      tool: getOpsToolSpec(TOOL)
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const firstData = first.data as {
      per_target: Array<{ id: string; kind: string; attempt: number }>;
      succeeded: number;
      failed: number;
      operation_state: string;
    };
    expect(firstData.succeeded).toBe(1);
    expect(firstData.failed).toBe(1);
    expect(firstData.operation_state).toBe("failed");
    const t1First = firstData.per_target.find((item) => item.id === "t1");
    const t2First = firstData.per_target.find((item) => item.id === "t2");
    expect(t1First?.kind).toBe("failed");
    expect(t1First?.attempt).toBe(1);
    expect(t2First?.kind).toBe("succeeded");
    expect(t2First?.attempt).toBe(1);

    const database = await getOpsDatabase();
    const failedTarget = database
      .prepare("SELECT status, attempt FROM ops_targets WHERE target_id = 't1'")
      .get() as { status: string; attempt: number };
    expect(failedTarget.status).toBe("failed");
    expect(failedTarget.attempt).toBe(1);

    // ── attempt 2：只重提失败的 t1 ──────────────────────────────────────
    adapter.failGroups.delete("g1");
    const second = await runOpsCommit({
      adapter,
      projectRoot,
      actor: "ops_agent",
      delegatedFrom: null,
      idempotencyKey: "idem-attempt",
      planId,
      confirmDigest: digest,
      requestTargetIds: ["t1"],
      grants: GRANTS,
      tool: getOpsToolSpec(TOOL)
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const secondData = second.data as {
      per_target: Array<{ id: string; kind: string; attempt: number }>;
      operation_state: string;
    };
    expect(secondData.operation_state).toBe("succeeded");
    const t1Second = secondData.per_target.find((item) => item.id === "t1");
    expect(t1Second?.kind).toBe("succeeded");
    expect(t1Second?.attempt).toBe(2);

    // t1 的幂等行被**同一行**更新到 attempt 2 / succeeded（不是新行）。
    const rows = database
      .prepare("SELECT status, attempt FROM ops_targets WHERE target_id = 't1'")
      .all() as Array<{ status: string; attempt: number }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("succeeded");
    expect(rows[0].attempt).toBe(2);
  });
});

describe("L25-16 S2 attempt 审计与全集 operation 记录分开", () => {
  it("同一目标的每次 attempt 各有独立审计行（互不覆盖），全集 operation 记录只有一行", async () => {
    const adapter = new PlannedFakeAdapter();
    adapter.targetGroups.set("t1", "g1");
    adapter.targetGroups.set("t2", "g2");
    adapter.failGroups.add("g1");

    const { planId, digest } = await previewPlan(adapter, [
      { id: "t1", connectionId: "conn_a" },
      { id: "t2", connectionId: "conn_a" }
    ]);

    await runOpsCommit({
      adapter,
      projectRoot,
      actor: "ops_agent",
      delegatedFrom: null,
      idempotencyKey: "idem-audit-layer",
      planId,
      confirmDigest: digest,
      requestTargetIds: ["t1", "t2"],
      grants: GRANTS,
      tool: getOpsToolSpec(TOOL)
    });

    adapter.failGroups.delete("g1");
    await runOpsCommit({
      adapter,
      projectRoot,
      actor: "ops_agent",
      delegatedFrom: null,
      idempotencyKey: "idem-audit-layer",
      planId,
      confirmDigest: digest,
      requestTargetIds: ["t1"],
      grants: GRANTS,
      tool: getOpsToolSpec(TOOL)
    });

    const database = await getOpsDatabase();

    // ── 全集 operation 记录：一行，反映跨成员跨 attempt 的聚合 ────────────
    const operations = database.prepare("SELECT * FROM ops_operations").all() as Array<{
      status: string;
      attempt: number;
    }>;
    expect(operations).toHaveLength(1);
    expect(operations[0].status).toBe("succeeded");
    expect(operations[0].attempt).toBe(2);

    // ── operation 级审计：按 attempt 分行，attempt 1 失败、attempt 2 成功 ──
    const opAudits = database
      .prepare(
        "SELECT write_status, error_reason, idempotency_key FROM config_change_log WHERE target_id = '' ORDER BY id"
      )
      .all() as Array<{ write_status: string; error_reason: string | null; idempotency_key: string }>;
    expect(opAudits).toHaveLength(2);
    expect(opAudits[0].write_status).toBe("failed");
    expect(opAudits[0].error_reason).toBe("ops_attempt_failed");
    expect(opAudits[1].write_status).toBe("committed");
    // 审计事件键含 attempt ⇒ 两行的幂等键必须不同（否则第二行会被静默丢弃）。
    expect(opAudits[0].idempotency_key).not.toBe(opAudits[1].idempotency_key);

    // ── target 级审计：t1 有两行（attempt 1 失败 / attempt 2 成功）────────
    const t1Audits = database
      .prepare(
        "SELECT write_status, error_reason, idempotency_key FROM config_change_log WHERE target_id = 't1' ORDER BY id"
      )
      .all() as Array<{ write_status: string; error_reason: string | null; idempotency_key: string }>;
    expect(t1Audits).toHaveLength(2);
    expect(t1Audits[0].write_status).toBe("failed");
    expect(t1Audits[1].write_status).toBe("committed");
    expect(t1Audits[0].idempotency_key).not.toBe(t1Audits[1].idempotency_key);

    // t2 只成功过一次 ⇒ 只有一行审计。
    const t2Audits = database
      .prepare("SELECT write_status FROM config_change_log WHERE target_id = 't2'")
      .all() as Array<{ write_status: string }>;
    expect(t2Audits).toHaveLength(1);
    expect(t2Audits[0].write_status).toBe("committed");
  });
});
