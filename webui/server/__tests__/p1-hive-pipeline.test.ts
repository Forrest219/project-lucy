/**
 * P1-4 Hive 直连（编译侧）— H7 失败顺序与分类。
 *
 * 权威 Spec：docs/specs/lucy-20261025-v0p25-hive-direct-connection-spec.md §5
 * 实施计划：docs/plans/2026-10-25-lucy-v0.25-p1-implementation-plan.md §7.2（H7）
 */
import { describe, expect, it } from "vitest";
import {
  HIVE_PIPELINE_STAGES,
  HIVE_UNIMPLEMENTED_STAGES,
  isHiveStageImplemented,
  runHivePipeline,
  upstreamMayHaveExecuted,
  type HivePipelineClassification,
  type HivePipelineStep
} from "../hive/pipeline";

function step(
  stage: HivePipelineStep<string>["stage"],
  outcome:
    | { ok: true; value: string }
    | { ok: false; classification: HivePipelineClassification; reason: string },
  log: string[]
): HivePipelineStep<string> {
  return {
    stage,
    run: async () => {
      log.push(stage);
      return outcome;
    }
  };
}

describe("H7 失败顺序与分类", () => {
  it("阶段顺序与 Spec §5 一致", () => {
    expect(HIVE_PIPELINE_STAGES).toEqual([
      "audit_receive",
      "config_snapshot",
      "request_acl",
      "budget_concurrency",
      "source_closure",
      "compile",
      "ast_policy_check",
      "admission_ledger",
      "jdbc",
      "type_truncation",
      "response_prepared_ledger",
      "release"
    ]);
  });

  it("安全前置失败后不再执行后续阶段，不产生空结果成功", async () => {
    const log: string[] = [];
    const result = await runHivePipeline<string>([
      step("audit_receive", { ok: true, value: "received" }, log),
      step("config_snapshot", { ok: true, value: "snapshot" }, log),
      step(
        "request_acl",
        { ok: false, classification: "denied", reason: "table_forbidden:orders" },
        log
      ),
      step("source_closure", { ok: true, value: "closure" }, log),
      step("compile", { ok: true, value: "compiled" }, log)
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.stage).toBe("request_acl");
    expect(result.failure.classification).toBe("denied");
    expect(result.failure.reason).toBe("table_forbidden:orders");
    // 失败之后的阶段一个都没跑。
    expect(log).toEqual(["audit_receive", "config_snapshot", "request_acl"]);
    expect(result.executedStages).toEqual(["audit_receive", "config_snapshot", "request_acl"]);
    // 结果里没有"成功但为空"的载荷。
    expect("value" in result).toBe(false);
  });

  it("编译之前的失败不宣称上游执行过；编译之后的失败必须宣称可能执行过", () => {
    expect(upstreamMayHaveExecuted("request_acl")).toBe(false);
    expect(upstreamMayHaveExecuted("source_closure")).toBe(false);
    expect(upstreamMayHaveExecuted("compile")).toBe(true);
    expect(upstreamMayHaveExecuted("response_prepared_ledger")).toBe(true);
  });

  it("响应准备失败不释放载荷，也不宣称上游从未执行", async () => {
    const log: string[] = [];
    const result = await runHivePipeline<string>([
      step("audit_receive", { ok: true, value: "received" }, log),
      step("compile", { ok: true, value: "compiled" }, log),
      step(
        "response_prepared_ledger",
        { ok: false, classification: "admission_failed", reason: "ledger_write_failed" },
        log
      ),
      step("release", { ok: true, value: "released" }, log)
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.stage).toBe("response_prepared_ledger");
    expect(result.failure.upstreamMayHaveExecuted).toBe(true);
    // 释放阶段没有执行：载荷不被释放。
    expect(log).not.toContain("release");
  });

  it("JDBC 阶段本轮不实施：报 not_implemented，绝不报告为已执行", async () => {
    expect(isHiveStageImplemented("jdbc")).toBe(false);
    expect(HIVE_UNIMPLEMENTED_STAGES).toContain("jdbc");

    const log: string[] = [];
    const result = await runHivePipeline<string>([
      step("compile", { ok: true, value: "compiled" }, log),
      step("jdbc", { ok: true, value: "executed" }, log)
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.classification).toBe("not_implemented");
    expect(result.failure.reason).toBe("hive_stage_not_implemented:jdbc");
    // JDBC 阶段的 run 根本没有被调用。
    expect(log).toEqual(["compile"]);
    expect(result.executedStages).toEqual(["compile"]);
  });

  it("阶段抛异常被归类为内部错误，而不是伪装成成功", async () => {
    const result = await runHivePipeline<string>([
      {
        stage: "audit_receive",
        run: async () => {
          throw new Error("ledger unavailable");
        }
      }
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.classification).toBe("internal_error");
    expect(result.failure.reason).toBe("hive_stage_threw:audit_receive");
    expect(result.failure.detail).toContain("ledger unavailable");
  });

  it("全部阶段成功时返回载荷与执行过的阶段", async () => {
    const log: string[] = [];
    const result = await runHivePipeline<string>([
      step("audit_receive", { ok: true, value: "received" }, log),
      step("config_snapshot", { ok: true, value: "snapshot" }, log),
      step("compile", { ok: true, value: "compiled" }, log)
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe("compiled");
    expect(result.executedStages).toEqual(["audit_receive", "config_snapshot", "compile"]);
  });
});

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * P1-4 §7 验收矩阵 — 按编号命名的用例（V06 的「无 JDBC 分派」一半）。
 *
 * Authority:
 *   - docs/specs/lucy-20261025-v0p25-hive-direct-connection-spec.md §5（核心流程
 *     与失败顺序）、§7（验收矩阵 V06 的通过标准）
 *
 * V06：非法输入、编译异常、超时、超大输出 —— 无 JDBC 分派；不回退 Postgres、
 *       不返回未校验 SQL。「不回退 Postgres / 不返回未校验 SQL」由
 *       `p1-hive-compile-bridge.test.ts` 的 V06 用例断言；这里断言的是
 *       **失败顺序**保证这些失败之后从不进入 JDBC 阶段。
 * ─────────────────────────────────────────────────────────────────────────────
 */

describe("P1-4 §7 — V06 无 JDBC 分派", () => {
  it("V06 — 编译侧失败后不进入 JDBC 阶段；JDBC 本轮未实施，报 not_implemented 而非已执行", async () => {
    // ① 编译异常／超时／超大输出都在 compile 阶段 → 短路，JDBC 一次都没跑。
    const reasons = [
      "hive_compile_process_failed",
      "hive_compile_timeout",
      "hive_compile_output_too_large"
    ];
    const outcomes = [];
    for (const reason of reasons) {
      const log: string[] = [];
      const result = await runHivePipeline<string>([
        step("audit_receive", { ok: true, value: "received" }, log),
        step("source_closure", { ok: true, value: "closure" }, log),
        step("compile", { ok: false, classification: "compile_failed", reason }, log),
        step("jdbc", { ok: true, value: "executed" }, log)
      ]);
      outcomes.push({ result, log });
    }
    expect(outcomes).toHaveLength(reasons.length);
    for (const { result, log } of outcomes) {
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.failure.stage).toBe("compile");
      expect(result.failure.classification).toBe("compile_failed");
      // JDBC 阶段的 run 根本没有被调用 → 没有分派。
      expect(log).not.toContain("jdbc");
      expect(result.executedStages).not.toContain("jdbc");
      // 失败结果里没有「已执行」的载荷。
      expect("value" in result).toBe(false);
    }

    // ② 真的走到 JDBC 阶段 → 本轮未实施，报 not_implemented，绝不报告为已执行。
    const log: string[] = [];
    const result = await runHivePipeline<string>([
      step("compile", { ok: true, value: "compiled" }, log),
      step("jdbc", { ok: true, value: "executed" }, log)
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.stage).toBe("jdbc");
    expect(result.failure.classification).toBe("not_implemented");
    expect(result.failure.reason).toBe("hive_stage_not_implemented:jdbc");
    // JDBC 阶段的 run 根本没有被调用 → 没有分派，也没有伪造一次执行。
    expect(log).toEqual(["compile"]);
    expect(result.executedStages).not.toContain("jdbc");
    expect("value" in result).toBe(false);
  });
});
