/**
 * P1-4 Hive 直连 — 失败顺序与分类（编译侧 + 执行波阶段表）。
 *
 * 权威 Spec：
 *   - docs/specs/lucy-20261025-v0p25-hive-direct-connection-spec.md §5
 *   - docs/specs/lucy-20261030-hive-query-execution-spec.md §6
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
  it("阶段顺序与执行波 Spec §6 一致", () => {
    expect(HIVE_PIPELINE_STAGES).toEqual([
      "audit_receive",
      "config_snapshot",
      "request_acl",
      "budget_concurrency",
      "source_closure",
      "partition_status",
      "compile",
      "ast_policy_check",
      "partition_predicate_gate",
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
    expect(log).toEqual(["audit_receive", "config_snapshot", "request_acl"]);
    expect(result.executedStages).toEqual(["audit_receive", "config_snapshot", "request_acl"]);
    expect("value" in result).toBe(false);
  });

  it("编译之前的失败不宣称上游执行过；编译之后的失败必须宣称可能执行过", () => {
    expect(upstreamMayHaveExecuted("request_acl")).toBe(false);
    expect(upstreamMayHaveExecuted("source_closure")).toBe(false);
    expect(upstreamMayHaveExecuted("partition_status")).toBe(false);
    expect(upstreamMayHaveExecuted("compile")).toBe(true);
    expect(upstreamMayHaveExecuted("partition_predicate_gate")).toBe(true);
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
    expect(log).not.toContain("release");
  });

  it("执行波 JDBC 阶段可实施：注入的 step 会被调用", async () => {
    expect(isHiveStageImplemented("jdbc")).toBe(true);
    expect(HIVE_UNIMPLEMENTED_STAGES).not.toContain("jdbc");

    const log: string[] = [];
    const result = await runHivePipeline<string>([
      step("compile", { ok: true, value: "compiled" }, log),
      step("partition_predicate_gate", { ok: true, value: "gated" }, log),
      step("jdbc", { ok: true, value: "executed" }, log)
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe("executed");
    expect(log).toEqual(["compile", "partition_predicate_gate", "jdbc"]);
    expect(result.executedStages).toContain("jdbc");
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

describe("P1-4 §7 — V06 无 JDBC 分派", () => {
  it("V06 — 编译侧失败后不进入 JDBC 阶段", async () => {
    const reasons = [
      "hive_compile_process_failed",
      "hive_compile_timeout",
      "hive_compile_output_too_large"
    ];
    for (const reason of reasons) {
      const log: string[] = [];
      const result = await runHivePipeline<string>([
        step("audit_receive", { ok: true, value: "received" }, log),
        step("source_closure", { ok: true, value: "closure" }, log),
        step("compile", { ok: false, classification: "compile_failed", reason }, log),
        step("jdbc", { ok: true, value: "executed" }, log)
      ]);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.failure.stage).toBe("compile");
      expect(result.failure.classification).toBe("compile_failed");
      expect(log).not.toContain("jdbc");
      expect(result.executedStages).not.toContain("jdbc");
      expect("value" in result).toBe(false);
    }
  });

  it("分区门禁失败后不进入 JDBC", async () => {
    const log: string[] = [];
    const result = await runHivePipeline<string>([
      step("compile", { ok: true, value: "compiled" }, log),
      step(
        "partition_predicate_gate",
        { ok: false, classification: "partition_gate_failed", reason: "hive_partition_predicate_required" },
        log
      ),
      step("jdbc", { ok: true, value: "executed" }, log)
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.stage).toBe("partition_predicate_gate");
    expect(log).not.toContain("jdbc");
    expect(result.executedStages).not.toContain("jdbc");
  });
});
