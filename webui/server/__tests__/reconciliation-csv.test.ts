/**
 * Lucy v0.25 — P0-4 对账 CSV 构造器（E9）单元测试。
 *
 * 覆盖 Spec §4.3：
 *   - 至少五类文件：问询摘要、完整表清单、调用／尝试、Token 对账、差异集合
 *   - 全部文件携带同一 `reconciliationContext`（Manifest 关联）
 *   - 保留 null 与空值原因（空单元格、0、false 与未知不得混用）
 *   - 防公式注入
 *   - 不导出凭据值、秘密或超授权原文
 */

import { describe, expect, it } from "vitest";
import {
  buildDifferenceSetCsv,
  buildReconciliationCsvBundle,
  reconciliationCsvCell,
  type CallAttemptRow,
  type InquirySummaryRow,
  type TableListRow
} from "../admin/reconciliation-csv";
import { reconcileTokens, type ConfiguredTokenSnapshot } from "../admin/reconciliation";
import {
  createReconciliationContext,
  normalizeReconciliationFilter
} from "../admin/reconciliation-context";

function makeContext() {
  const filter = normalizeReconciliationFilter({ user: "agent-a" });
  return createReconciliationContext({
    instanceId: "lucy-test",
    filter,
    timeRange: {
      from: "2026-10-01T00:00:00.000Z",
      to: "2026-10-25T00:00:00.000Z",
      timezone: "Asia/Shanghai"
    },
    watermarkSeq: 4242,
    snapshotId: "snap-xyz",
    rowBoundAccessLogId: 100,
    metricUnit: "tool_call",
    completeness: {
      complete: true,
      combined_complete: true,
      dataScope: { ok: true, reason: null },
      associationQuality: {
        confirmed: 1,
        candidate: 0,
        unassigned: 0,
        conflict: 0,
        legacy_unverified: 0
      },
      clientCoverage: { observed: false, gapWindows: [], unknownReason: null },
      integrityVerification: { fileHashOk: true, relationCheckOk: true },
      reasons: []
    },
    auditCoverage: {
      version: "v2p5-1",
      seqUpperBound: 4242,
      checks: [],
      allConclusive: false,
      combined: "unknown"
    }
  });
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

function parseCsv(csv: string): string[][] {
  return csv
    .split("\n")
    .filter((line) => line.length > 0)
    .map(parseCsvLine);
}

const configured: ConfiguredTokenSnapshot = {
  capturedAt: "2026-10-25T00:00:00.000Z",
  configVersion: "cfg-v1",
  identityAmbiguity: false,
  available: true,
  tokens: [
    {
      identity: "sha256:abc",
      identityKind: "hash_prefix",
      userId: "agent-a",
      label: "primary",
      enabled: true,
      expired: false,
      createdAt: "2026-01-01T00:00:00.000Z"
    },
    {
      identity: "sha256:def",
      identityKind: "hash_prefix",
      userId: "agent-a",
      label: "disabled",
      enabled: false,
      expired: false,
      createdAt: "2026-01-01T00:00:00.000Z"
    }
  ]
};

describe("reconciliationCsvCell", () => {
  it("null / undefined 渲染为空单元格（配合独立 null_reason 列）", () => {
    expect(reconciliationCsvCell(null)).toBe("");
    expect(reconciliationCsvCell(undefined)).toBe("");
  });

  it("0 与 false 不被当成空值", () => {
    expect(reconciliationCsvCell(0)).toBe("0");
    expect(reconciliationCsvCell(false)).toBe("false");
  });

  it("防公式注入", () => {
    expect(reconciliationCsvCell("=1+1")).toBe("'=1+1");
    expect(reconciliationCsvCell("+SUM(A1)")).toBe("'+SUM(A1)");
    expect(reconciliationCsvCell("-2")).toBe("'-2");
    expect(reconciliationCsvCell("@cmd")).toBe("'@cmd");
  });

  it("含逗号 / 引号 / 换行时按 RFC 4180 转义", () => {
    expect(reconciliationCsvCell("a,b")).toBe('"a,b"');
    expect(reconciliationCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(reconciliationCsvCell("line1\nline2")).toBe('"line1\nline2"');
  });
});

describe("buildReconciliationCsvBundle", () => {
  const context = makeContext();
  const tokenReconciliation = reconcileTokens({
    context,
    configured,
    active: [
      {
        identity: "sha256:abc",
        identityKind: "hash_prefix",
        toolCallCount: 3,
        firstSeenAt: "2026-10-10T10:00:00.000Z",
        lastSeenAt: "2026-10-10T11:00:00.000Z"
      }
    ],
    unknownIdentity: [
      {
        reason: "missing_persistent_identity",
        callCount: 2,
        distinctRequestIds: 2,
        lastSeenAt: "2026-10-10T11:30:00.000Z"
      }
    ],
    protocolEventCount: 5
  });

  const inquirySummary: InquirySummaryRow[] = [
    {
      turnId: "turn-1",
      registrationSource: "reported",
      originalTextAvailable: true,
      associationStatus: "confirmed",
      candidateTurn: false,
      primaryStatus: "succeeded",
      primaryStatusNullReason: null,
      confirmedCallCount: 3,
      candidateCallCount: 1,
      attemptCount: null,
      attemptCountNullReason: "not_collected",
      completeTableCount: 2,
      unknownTableCallCount: 1,
      inquiryDurationMs: null,
      inquiryDurationNullReason: "not_collected",
      budgetStatus: "not_exhausted",
      budgetTerminated: false,
      watermarkSeq: 4242,
      metricUnit: "tool_call"
    }
  ];

  const tableList: TableListRow[] = [
    {
      turnId: "turn-1",
      connectionId: "mysql",
      schema: "sales",
      table: "orders",
      identityComplete: true,
      missingIdentityParts: [],
      physicalTable: "sales.orders",
      extractionMethod: "catalog",
      confidence: "high",
      firstObservedAt: "2026-10-10T10:00:00.000Z",
      lastObservedAt: "2026-10-10T10:05:00.000Z",
      callCount: 2,
      callIds: ["1", "2"],
      sourceStatus: "resolved",
      sourceStatusNullReason: null
    }
  ];

  const calls: CallAttemptRow[] = [
    {
      turnId: "turn-1",
      unitId: "1",
      ts: "2026-10-10T10:00:00.000Z",
      tool: "lucy_query",
      requestId: "req-1",
      attemptId: null,
      attemptIdNullReason: "not_collected",
      parentAttemptId: null,
      associationStatus: "confirmed",
      legacyOutcome: "ok",
      decisionReason: null,
      primaryStatus: "succeeded",
      primaryStatusNullReason: null,
      authorization: "allowed",
      execution: "succeeded",
      delivery: "unknown",
      durationMs: 120,
      durationNullReason: null,
      sourceIdentityCount: 1
    }
  ];

  const bundle = buildReconciliationCsvBundle({
    context,
    inquirySummary,
    tableList,
    calls,
    tokenReconciliation,
    configuredIdentities: configured.tokens.map((token) => ({
      identity: token.identity,
      identityKind: token.identityKind,
      userId: token.userId,
      enabled: token.enabled,
      expired: token.expired,
      createdAt: token.createdAt
    })),
    activeIdentities: [
      {
        identity: "sha256:abc",
        identityKind: "hash_prefix",
        toolCallCount: 3,
        firstSeenAt: "2026-10-10T10:00:00.000Z",
        lastSeenAt: "2026-10-10T11:00:00.000Z"
      }
    ],
    extraDifferences: [
      { id: "calls_without_source_identity", detail: "1 条调用无来源引用", affectedCallIds: ["3"] }
    ],
    exclusions: [{ id: "protocol_events_excluded", detail: "5 条协议事件不进分母" }],
    complete: true
  });

  it("产出五类文件", () => {
    expect(bundle.files.map((file) => file.name)).toEqual([
      "inquiry-summary.csv",
      "complete-table-list.csv",
      "calls-attempts.csv",
      "token-reconciliation.csv",
      "difference-sets.csv"
    ]);
    for (const file of bundle.files) {
      expect(file.sha256).toHaveLength(64);
      expect(file.csv.endsWith("\n")).toBe(true);
    }
  });

  it("Manifest 携带同一上下文与规则版本", () => {
    expect(bundle.manifest.context.watermarkSeq).toBe(4242);
    expect(bundle.manifest.context.snapshotId).toBe("snap-xyz");
    expect(bundle.manifest.context.derivationVersion).toBe("v2p5-1");
    expect(bundle.manifest.completeness.watermarkSeq).toBe(4242);
    expect(bundle.manifest.files).toHaveLength(5);
    expect(bundle.manifest.exclusions[0]?.id).toBe("protocol_events_excluded");
  });

  it("CSV 行携带同一 S 与计量单位", () => {
    for (const file of bundle.files) {
      expect(file.csv).toContain("4242");
    }
  });

  it("保留 null 与空值原因（空值与 0 不混用）", () => {
    const rows = parseCsv(bundle.files[0]!.csv);
    const header = rows[0]!;
    const row = rows[1]!;
    const attemptIndex = header.indexOf("attempt_count");
    const reasonIndex = header.indexOf("attempt_count_null_reason");
    expect(row[attemptIndex]).toBe("");
    expect(row[reasonIndex]).toBe("not_collected");
    const confirmedIndex = header.indexOf("confirmed_call_count");
    expect(row[confirmedIndex]).toBe("3");
  });

  it("完整表清单保留完整 connectionId / schema / table", () => {
    const rows = parseCsv(bundle.files[1]!.csv);
    const header = rows[0]!;
    const row = rows[1]!;
    expect(row[header.indexOf("connection_id")]).toBe("mysql");
    expect(row[header.indexOf("schema_name")]).toBe("sales");
    expect(row[header.indexOf("table_name")]).toBe("orders");
    expect(row[header.indexOf("identity_complete")]).toBe("true");
  });

  it("Token 对账只使用受保护摘要，不导出凭据值", () => {
    const csv = bundle.files[3]!.csv;
    expect(csv).toContain("sha256:abc");
    expect(csv).not.toContain("secret");
    // 配置 Token 的完整 hash 从未进入本模块输入
    const rows = parseCsv(csv);
    const header = rows[0]!;
    const identityIndex = header.indexOf("token_identity");
    for (const row of rows.slice(1)) {
      const identity = row[identityIndex];
      if (identity) expect(identity.length).toBeLessThanOrEqual(19);
    }
  });

  it("差异集合包含 Token 四类差异与已声明差异", () => {
    const csv = bundle.files[4]!.csv;
    expect(csv).toContain("configured_not_active");
    expect(csv).toContain("active_not_in_current_config");
    expect(csv).toContain("disabled_or_deleted");
    expect(csv).toContain("identity_unverified");
    expect(csv).toContain("calls_without_source_identity");
  });

  it("分页结果导出的 Manifest 不宣称完整", () => {
    const partial = buildReconciliationCsvBundle({
      context,
      inquirySummary: [],
      tableList: [],
      calls: [],
      tokenReconciliation,
      configuredIdentities: [],
      activeIdentities: [],
      complete: false
    });
    expect(partial.manifest.completeness.complete).toBe(false);
    expect(partial.manifest.completeness.note).toContain("分页");
  });
});

describe("buildDifferenceSetCsv", () => {
  it("空差异集合也产出一行说明，不静默省略", () => {
    const context = makeContext();
    const file = buildDifferenceSetCsv(
      [
        {
          id: "configured_not_active",
          label: "已配置未活跃",
          count: 0,
          nullReason: null,
          identities: [],
          reasons: [],
          evidenceRefs: []
        }
      ],
      [],
      context
    );
    const rows = parseCsv(file.csv);
    expect(rows).toHaveLength(2);
    expect(rows[1]!.some((cell) => cell === "empty")).toBe(true);
  });

  it("不可观测的差异集合写空值原因，不写 empty", () => {
    // count = null = 不可观测（配置读不到）。写 "empty" 等于宣称「没有差异」，
    // 那是拿空配置顶替真实配置。
    const context = makeContext();
    const file = buildDifferenceSetCsv(
      [
        {
          id: "active_not_in_current_config",
          label: "活跃但当前配置不可见",
          count: null,
          nullReason: "not_collected",
          identities: [],
          reasons: [],
          evidenceRefs: []
        }
      ],
      [],
      context
    );
    const rows = parseCsv(file.csv);
    expect(rows).toHaveLength(2);
    expect(rows[1]!.some((cell) => cell === "empty")).toBe(false);
    expect(rows[1]!.some((cell) => cell === "not_collected")).toBe(true);
  });
});
