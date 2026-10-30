/**
 * L25-16 S2 — **非终态收敛入口**（Plan 第 30 项 / Spec §6.2，F6-01 / G33，F7-10）。
 *
 * 合同要求（Spec §6.2 / G33）：五态里的两种非终态不能只「拒绝新 attempt」，
 * 必须**显式存在收敛入口**：
 * 1. **恢复扫描入口**——按 operation 记录扫描非终态 operation，逐个走 §6.2 收敛顺序；
 * 2. **release 收敛入口**——把 release 终态回写到目标与 operation；
 * 3. 收敛动作的**排他所有权**（同一 operation 不得并发进入）；
 * 4. 收敛后按 `auditId` **更新既有审计行**（不重插）。
 *
 * 既有的 release 状态查询端点只返回记录、不回写控制面状态，**不能**充当收敛入口。
 *
 * 本文件直接构造「崩溃残留」的状态（已认领但未终结），然后驱动两个收敛入口。
 */

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { claimAttemptTransaction, persistTargetProgress } from "../ops-audit";
import {
  getOpsDatabase,
  loadOperationRow,
  loadTargetRow,
  operationKey,
  targetKey
} from "../ops-idempotency";
import { convergePendingActivation, recoverNonTerminalOperations } from "../ops-recovery";
import type {
  OpsGroupContext,
  OpsGroupVerifyResult,
  OpsPlanTarget,
  OpsToolAdapter
} from "../ops-batch";

const TOOL = "lucy_ops_connection_tables";
const IDEMPOTENCY_KEY = "idem-convergence";
const OP_KEY = operationKey(IDEMPOTENCY_KEY, TOOL);
const TARGET_ID = "tables:conn_a";
const TARGET_KEY = targetKey(IDEMPOTENCY_KEY, TOOL, TARGET_ID);

let projectRoot: string;
let previousRoot: string | undefined;
let previousAuditDb: string | undefined;

beforeAll(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "ktx-ops-convergence-"));
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
});

/** 一个只用于收敛测试的假适配器。 */
class ConvergenceFakeAdapter implements OpsToolAdapter {
  readonly toolName = TOOL;
  /** 核验结论——测试用它决定「已生效 / 未生效 / 不可判定」。 */
  verdict: "succeeded" | "failed" | "unknown" = "succeeded";
  /** 收敛时被调用过的 actor——用于断言归属。 */
  seenActors: string[] = [];

  operationAudit() {
    return { filePath: "ktx.yaml", changeType: "enabled_tables_update", assetKind: "governance" as const };
  }
  parseTargets(): unknown[] {
    return [];
  }
  targetId(): string {
    return TARGET_ID;
  }
  connectionId(): string {
    return "conn_a";
  }
  async buildPlan(): Promise<never> {
    throw new Error("not used");
  }
  async executeGroup(): Promise<void> {
    throw new Error("not used");
  }
  async rollbackGroup(): Promise<{ complete: boolean; detail?: unknown }> {
    this.seenActors.push("rollback");
    return { complete: true };
  }
  async verifyGroup(ctx: OpsGroupContext): Promise<OpsGroupVerifyResult> {
    this.seenActors.push(ctx.actor);
    return {
      members: ctx.members.map((member) => ({ id: member.id, state: this.verdict }))
    };
  }
}

function planTarget(): OpsPlanTarget {
  return {
    id: TARGET_ID,
    groupId: "g1",
    connectionId: "conn_a",
    payload: { connectionId: "conn_a", enabledTables: ["s1.orders"] },
    before: null,
    after: null,
    blockers: [],
    writeSet: ["ktx.yaml"],
    audit: {
      changeType: "enabled_tables_update",
      assetKind: "governance",
      targetId: "conn_a",
      filePath: "ktx.yaml"
    }
  };
}

/**
 * 构造「已认领但未终结」的崩溃残留：
 * operation 行 + 1 条 operation 级审计 + 1 条 target 行 + 1 条 target 级审计，
 * 全部停在 `pending`。
 */
async function claimPendingOperation(): Promise<void> {
  const database = await getOpsDatabase();
  claimAttemptTransaction(database, {
    operationKey: OP_KEY,
    toolName: TOOL,
    actor: "ops_agent",
    delegatedFrom: null,
    planId: "plan-convergence",
    planDigest: "digest-convergence",
    attempt: 1,
    execSet: [TARGET_ID],
    groupIds: ["g1"],
    plan: { perTarget: [planTarget()] },
    operationFilePath: "ktx.yaml",
    operationChangeType: "enabled_tables_update",
    operationAssetKind: "governance",
    targets: [
      {
        targetKey: TARGET_KEY,
        targetId: TARGET_ID,
        groupId: "g1",
        descriptor: {
          changeType: "enabled_tables_update",
          assetKind: "governance",
          targetId: "conn_a",
          filePath: "ktx.yaml"
        }
      }
    ]
  });
}

function auditRows(database: Awaited<ReturnType<typeof getOpsDatabase>>): Array<{
  id: number;
  write_status: string;
  target_id: string;
  actor: string;
}> {
  return database
    .prepare("SELECT id, write_status, target_id, actor FROM config_change_log ORDER BY id")
    .all() as Array<{ id: number; write_status: string; target_id: string; actor: string }>;
}

// ─── 恢复扫描入口 ────────────────────────────────────────────────────────────

describe("L25-16 S2 恢复扫描入口（非终态收敛）", () => {
  it("扫描到非终态 operation 并按 §6.2 收敛：目标终结、审计按 auditId 更新、operation 落终态", async () => {
    await claimPendingOperation();
    const database = await getOpsDatabase();
    const adapter = new ConvergenceFakeAdapter();
    adapter.verdict = "succeeded";

    const envelope = await recoverNonTerminalOperations({
      adapterFor: () => adapter,
      projectRoot,
      actor: "system",
      delegatedFrom: null,
      database
    });

    expect(envelope.ok).toBe(true);
    if (!envelope.ok) return;
    const data = envelope.data as { scanned: number };
    expect(data.scanned).toBe(1);

    // 目标终结为 succeeded。
    const target = loadTargetRow(database, TARGET_KEY);
    expect(target?.status).toBe("succeeded");

    // 审计按既有行更新（不重插）：仍是 2 行，target 行变 committed。
    const rows = auditRows(database);
    expect(rows).toHaveLength(2);
    const targetAudit = rows.find((row) => row.target_id === "conn_a");
    expect(targetAudit?.write_status).toBe("committed");

    // operation 落终态——否则恢复入口会反复扫描同一个 operation。
    const op = loadOperationRow(database, OP_KEY);
    expect(op?.status).toBe("succeeded");
  });

  it("核验为「未生效」⇒ 按组回滚并记 failed，operation 聚合为 failed", async () => {
    await claimPendingOperation();
    const database = await getOpsDatabase();
    const adapter = new ConvergenceFakeAdapter();
    adapter.verdict = "failed";

    const envelope = await recoverNonTerminalOperations({
      adapterFor: () => adapter,
      projectRoot,
      actor: "system",
      delegatedFrom: null,
      database
    });

    expect(envelope.ok).toBe(true);
    const target = loadTargetRow(database, TARGET_KEY);
    expect(target?.status).toBe("failed");

    const rows = auditRows(database);
    const targetAudit = rows.find((row) => row.target_id === "conn_a");
    expect(targetAudit?.write_status).toBe("failed");

    const op = loadOperationRow(database, OP_KEY);
    expect(op?.status).toBe("failed");
  });

  it("核验不可判定 ⇒ 保持 recovery_required 并阻断，不得静默重跑", async () => {
    await claimPendingOperation();
    const database = await getOpsDatabase();
    const adapter = new ConvergenceFakeAdapter();
    adapter.verdict = "unknown";

    await recoverNonTerminalOperations({
      adapterFor: () => adapter,
      projectRoot,
      actor: "system",
      delegatedFrom: null,
      database
    });

    const target = loadTargetRow(database, TARGET_KEY);
    expect(target?.status).toBe("recovery_required");
    // 不可判定 ⇒ 审计行不得被写成 committed。
    const rows = auditRows(database);
    const targetAudit = rows.find((row) => row.target_id === "conn_a");
    expect(targetAudit?.write_status).not.toBe("committed");
  });

  it("恢复归属**该 operation 自己的** actor，而不是扫描入口的入参", async () => {
    await claimPendingOperation();
    const database = await getOpsDatabase();
    const adapter = new ConvergenceFakeAdapter();

    await recoverNonTerminalOperations({
      adapterFor: () => adapter,
      projectRoot,
      actor: "system",
      delegatedFrom: null,
      database
    });

    // 认领时的 actor 是 ops_agent——恢复必须用它续接，而不是扫描入口的 "system"。
    expect(adapter.seenActors).toContain("ops_agent");
    expect(adapter.seenActors).not.toContain("system");
  });
});

// ─── release 收敛入口 ────────────────────────────────────────────────────────

describe("L25-16 S2 release 收敛入口（终态回写）", () => {
  it("把 pending_activation 的 release 终态回写到目标、审计与 operation", async () => {
    await claimPendingOperation();
    const database = await getOpsDatabase();

    // 制造 pending_activation 的目标（受理态已落盘、生效未确认）。
    persistTargetProgress(database, {
      targetKey: TARGET_KEY,
      status: "pending_activation",
      attempt: 1,
      auditId: loadTargetRow(database, TARGET_KEY)?.auditId ?? null,
      result: { kind: "pending_activation", ok: null },
      effectPhase: "written"
    });

    const adapter = new ConvergenceFakeAdapter();
    const envelope = await convergePendingActivation({
      adapterFor: () => ({
        ...adapter,
        resolveActivation: async () => "confirmed" as const
      } as unknown as OpsToolAdapter),
      database
    });

    expect(envelope.ok).toBe(true);
    if (!envelope.ok) return;
    const data = envelope.data as { converged: Array<{ target_id: string; state: string }> };
    expect(data.converged).toHaveLength(1);
    expect(data.converged[0]?.state).toBe("succeeded");

    // 目标终结 + 审计行更新。
    const target = loadTargetRow(database, TARGET_KEY);
    expect(target?.status).toBe("succeeded");
    const rows = auditRows(database);
    const targetAudit = rows.find((row) => row.target_id === "conn_a");
    expect(targetAudit?.write_status).toBe("committed");
    // operation 级审计行也收敛（合同：回写到目标**与 operation**）。
    const opAudit = rows.find((row) => row.target_id === "");
    expect(opAudit?.write_status).toBe("committed");
    // operation 记录本身也离开非终态。
    const op = loadOperationRow(database, OP_KEY);
    expect(op?.status).toBe("succeeded");
  });

  it("release 终态为「失败」⇒ 目标记 failed，不得留在受理态", async () => {
    await claimPendingOperation();
    const database = await getOpsDatabase();

    persistTargetProgress(database, {
      targetKey: TARGET_KEY,
      status: "pending_activation",
      attempt: 1,
      auditId: loadTargetRow(database, TARGET_KEY)?.auditId ?? null,
      result: { kind: "pending_activation", ok: null },
      effectPhase: "written"
    });

    const adapter = new ConvergenceFakeAdapter();
    await convergePendingActivation({
      adapterFor: () => ({
        ...adapter,
        resolveActivation: async () => "failed" as const
      } as unknown as OpsToolAdapter),
      database
    });

    const target = loadTargetRow(database, TARGET_KEY);
    expect(target?.status).toBe("failed");
  });
});
