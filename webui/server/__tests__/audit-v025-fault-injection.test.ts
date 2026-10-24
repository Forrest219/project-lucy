/**
 * Lucy v0.25 / L25-09 S08 / B17 —— 故障注入与历史回放测试骨架。
 *
 * 本文件只验证**骨架能力**（命名空间隔离 / test_run_id / fault_injected /
 * 恢复扫描幂等），不代表 A01–A12 验收已执行 —— 验收矩阵当前一律「未执行」。
 */

import { describe, expect, it } from "vitest";
import { appendMarkedEvent, createFaultInjectionRun } from "./audit-v025-fault-injection-harness.js";
import {
  deriveUnclosedReceivedOperations,
  recoverUnclosedReceivedOperations
} from "../proxy/ingress-registry.js";

describe("S08 故障注入与历史回放骨架", () => {
  it("使用独立测试账本命名空间，不写入项目账本", async () => {
    const run = await createFaultInjectionRun({ testRunId: "run_ns_1" });
    try {
      expect(run.ledgerPath).toContain(run.root);
      expect(run.ledgerPath).not.toContain("/Users/");
      expect(run.testRunId).toBe("run_ns_1");
      // 命名空间内的账本是空的（历史样本未被触碰）。
      expect(run.store.maxEventSeq()).toMatchObject({ ok: true, value: 0 });
    } finally {
      await run.close();
    }
  });

  it("故障注入调用按真实事件类型登记并标记 fault_injected", async () => {
    const run = await createFaultInjectionRun({ testRunId: "run_fault_1" });
    try {
      const record = run.registerFault({
        tool: "lucy_query",
        faultKind: "crash_after_received",
        observedAt: 1
      });
      // 工具仍是 tool_call —— 不得以协议类型伪装。
      expect(record.eventType).toBe("tool_call");
      expect(record.faultInjected).toBe(true);
      expect(record.testRunId).toBe("run_fault_1");
      expect(run.faults).toHaveLength(1);
    } finally {
      await run.close();
    }
  });

  it("崩溃后可解释：received 未闭合的操作由账本扫描幂等关闭", async () => {
    const run = await createFaultInjectionRun({ testRunId: "run_crash_1" });
    try {
      const appended = appendMarkedEvent(run.store, {
        testRunId: run.testRunId,
        eventId: "op_crash_1:received",
        operationId: "op_crash_1",
        phase: "received",
        faultInjected: true,
        extra: { attempt_id: "attempt_1" }
      });
      expect(appended.ok).toBe(true);

      const first = await recoverUnclosedReceivedOperations(run.store);
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      expect(first.value.closed).toEqual(["op_crash_1"]);
      expect(first.value.alreadyClosed).toEqual([]);

      // 幂等：重复扫描不重复追加、不报错。
      const second = await recoverUnclosedReceivedOperations(run.store);
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.value.closed).toEqual([]);
      expect(second.value.alreadyClosed).toEqual([]);

      const trail = run.store.listEventsByOperation("op_crash_1");
      expect(trail.ok).toBe(true);
      if (!trail.ok) return;
      const interrupted = trail.value.filter((event) => event.phase === "interrupted");
      expect(interrupted).toHaveLength(1);
      expect(interrupted[0].verdict).toBe("received_only");
      // 恢复标记不重放业务：没有 request_admitted / response_prepared。
      expect(trail.value.some((event) => event.phase === "request_admitted")).toBe(false);
      expect(trail.value.some((event) => event.phase === "response_prepared")).toBe(false);
    } finally {
      await run.close();
    }
  });

  it("派生逻辑只看账本阶段，不看时间戳", () => {
    const unclosed = deriveUnclosedReceivedOperations([
      [
        { eventId: "op_1:received", operationId: "op_1", phase: "received", seq: 1, createdAt: 1000 },
        { eventId: "op_1:request_admitted", operationId: "op_1", phase: "request_admitted", seq: 2, createdAt: 2000 }
      ],
      [
        { eventId: "op_2:received", operationId: "op_2", phase: "received", seq: 3, createdAt: 5000 },
        { eventId: "op_2:interrupted", operationId: "op_2", phase: "interrupted", seq: 4, createdAt: 9000 }
      ]
    ]);
    // op_2 已有终态 → 不算未闭合；op_1 未闭合但已分派。
    expect(unclosed.map((item) => item.operationId)).toEqual(["op_1"]);
    expect(unclosed[0].dispatched).toBe(true);
    expect(unclosed[0].phases).toEqual(["received", "request_admitted"]);
  });
});
