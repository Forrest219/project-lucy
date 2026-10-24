/**
 * Lucy v0.25 / L25-09 S08 / B17 —— 故障注入与历史回放测试骨架。
 *
 * Spec §11.4 的硬规则：
 *   - 历史静态回放与在线故障注入使用**独立测试数据目录 / 账本命名空间**及
 *     `test_run_id`；**不向历史样本写测试事件**。
 *   - 在线故障调用按**真实事件类型**计入本次测试集合（工具仍是
 *     `tool_call`），另标 `fault_injected`；**不得以协议类型伪装**、
 *     不得删除账本、不得临时调分母掩盖失败。
 *   - 历史样本只读；测试清理只作用于隔离环境。
 *
 * 本模块只提供**骨架**：命名空间隔离、test_run_id、fault_injected 登记簿。
 * 具体 A01–A12 场景的期望结果登记按 Spec §13.2 模板另行补齐（验收矩阵
 * 当前一律「未执行」）。
 */

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { openSecurityStore, type SecurityStore } from "../security/store.js";
import { SECURITY_DB_FILE } from "../security/schema.js";

/** 故障注入登记条目。 */
export type FaultInjectionRecord = {
  /** 本次测试运行标识。 */
  testRunId: string;
  /** 被注入故障的调用。 */
  tool: string;
  /** 故障种类（如 `crash_after_received`、`store_unavailable`）。 */
  faultKind: string;
  /**
   * 真实事件类型。**工具调用仍是 `tool_call`** —— 不得用协议类型伪装
   * （Spec §11.4）。
   */
  eventType: "tool_call";
  /** 故障标记：在线故障调用另标此字段。 */
  faultInjected: true;
  /** 观测时间（测试自己的时钟）。 */
  observedAt: number;
};

export type FaultInjectionRun = {
  /** 本次测试运行标识（§11.4）。 */
  testRunId: string;
  /** 独立测试数据目录（临时目录，绝不指向项目根）。 */
  root: string;
  /** 该命名空间下的账本文件路径。 */
  ledgerPath: string;
  /** 该命名空间下的审计库路径（隔离环境内）。 */
  auditDbPath: string;
  /** 该命名空间下的账本。 */
  store: SecurityStore;
  /** 本次测试集合里被标记为 `fault_injected` 的调用。 */
  faults: FaultInjectionRecord[];
  /** 登记一个故障注入调用。 */
  registerFault(input: { tool: string; faultKind: string; observedAt: number }): FaultInjectionRecord;
  /** 关闭并清理隔离环境（只作用于隔离目录）。 */
  close(): Promise<void>;
};

/**
 * 创建一次隔离的故障注入运行。
 *
 * 隔离保证：
 *   - 账本落在 `mkdtemp` 出来的临时目录下，与项目 `.ktx-ui/security.sqlite`
 *     **不是同一个文件**；
 *   - 审计库路径同样落在隔离目录内；
 *   - 关闭时只删除该临时目录，不触碰任何历史样本。
 */
export async function createFaultInjectionRun(options: {
  testRunId?: string;
  /** 注入的时钟（便于确定性断言）。 */
  now?: () => number;
} = {}): Promise<FaultInjectionRun> {
  const testRunId = options.testRunId ?? `test_run_${randomUUID()}`;
  const root = await mkdtemp(path.join(os.tmpdir(), "lucy-audit-fault-"));
  const opened = openSecurityStore(root, options.now ? { now: options.now } : {});
  if (!opened.ok) {
    await rm(root, { recursive: true, force: true });
    throw new Error(`fault_injection_store_open_failed:${opened.reason}`);
  }
  const store = opened.value;
  const faults: FaultInjectionRecord[] = [];
  const ledgerPath = path.join(root, ".ktx-ui", SECURITY_DB_FILE);

  return {
    testRunId,
    root,
    ledgerPath,
    auditDbPath: path.join(root, ".ktx-ui", "audit.sqlite"),
    store,
    faults,
    registerFault(input) {
      const record: FaultInjectionRecord = {
        testRunId,
        tool: input.tool,
        faultKind: input.faultKind,
        eventType: "tool_call",
        faultInjected: true,
        observedAt: input.observedAt
      };
      faults.push(record);
      return record;
    },
    async close() {
      try {
        store.close();
      } catch {
        // 关闭失败不阻断清理。
      }
      await rm(root, { recursive: true, force: true });
    }
  };
}

/**
 * 追加一条带 `test_run_id` / `fault_injected` 标记的账本事件。
 *
 * 标记写在 `resultSummary` 内 —— 不新增生产 schema 列（测试标记不进入
 * 生产数据面）。
 */
export function appendMarkedEvent(
  store: SecurityStore,
  input: {
    testRunId: string;
    eventId: string;
    operationId: string;
    phase: "received" | "request_admitted" | "response_prepared" | "interrupted";
    actor?: string;
    faultInjected?: boolean;
    extra?: Record<string, unknown>;
  }
): { ok: true; seq: number } | { ok: false; reason: string } {
  const appended = store.appendEvent({
    eventId: input.eventId,
    operationId: input.operationId,
    phase: input.phase,
    actor: input.actor ?? "test_run",
    actorType: "system",
    verdict: input.faultInjected ? "fault_injected" : "observed",
    resultSummary: JSON.stringify({
      test_run_id: input.testRunId,
      fault_injected: input.faultInjected === true,
      ...(input.extra ?? {})
    })
  });
  if (!appended.ok) return { ok: false, reason: appended.reason };
  return { ok: true, seq: appended.value.seq };
}
