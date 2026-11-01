/**
 * Lucy v0.25 / L25-09 — S01–S07 功能合同层的**边界与写路径**落点。
 *
 * 本文件补的是收口前**没有任何自动化断言**的几处冻结合同：
 *   - §4.3(c) U11 预览／摘要边界（500 码点、512 字节、maxKeys=8、存在性标记）
 *   - §4.3(e) reported / observed / inferred 三族分离
 *   - §4.3(b) U1 `acknowledged` 写路径（三重比对）与「不推导 unacknowledged」
 *   - §10.2 U8 统一错误七分类 → Spec 162 四维映射
 *
 * 这些是**纯函数与只读判定**，不涉及运行时取证（A01–A12）。
 */
import { describe, expect, it } from "vitest";
import {
  ARGS_VALUE_MAX_BYTES,
  LEGACY_QUERY_PREVIEW_MAX_CODEPOINTS,
  QUERY_PREVIEW_MAX_CODEPOINTS,
  REDACTED_VALUE_MARKER,
  boundAuditValue,
  buildQueryPreview,
  summarizeArgsForAudit,
  truncateByCodePoints
} from "../proxy/audit-privacy";
import {
  ERROR_CATEGORIES,
  buildEvidenceFamilies,
  classifyErrorCategory
} from "../proxy/audit-classification";
import {
  resolveDeliveryStatus,
  resolveVisibleParentIds,
  validateAcknowledgement
} from "../admin/agent-audit-events";

// ─── §4.3(c) U11 预览与摘要边界 ──────────────────────────────────────────────

describe("§4.3(c) U11 — query_preview 与 args_summary 边界", () => {
  it("预览上限为 500 个 Unicode 码点，历史旧上限 180 保留为只读基线", () => {
    expect(QUERY_PREVIEW_MAX_CODEPOINTS).toBe(500);
    expect(LEGACY_QUERY_PREVIEW_MAX_CODEPOINTS).toBe(180);
  });

  it("按码点截断，不切断字符（emoji 边界不产生半个代理对）", () => {
    const emoji = "😀"; // 1 码点 / 2 UTF-16 码元
    const text = emoji.repeat(501);
    const cut = truncateByCodePoints(text, QUERY_PREVIEW_MAX_CODEPOINTS);
    expect(Array.from(cut)).toHaveLength(500);
    // 末位必须是完整码点：取最后一个码元判断它不是落在代理对区间。
    const last = cut.charCodeAt(cut.length - 1);
    expect(last < 0xd800 || last > 0xdbff).toBe(true);
  });

  it("中文边界同样按码点截断", () => {
    const text = "数".repeat(501);
    const cut = truncateByCodePoints(text, QUERY_PREVIEW_MAX_CODEPOINTS);
    expect(Array.from(cut)).toHaveLength(500);
    expect(cut).toBe("数".repeat(500));
  });

  it("预览记录 truncated 与原始输入的 UTF-8 字节长度", () => {
    const text = "a".repeat(600);
    const built = buildQueryPreview(text, { previewVersion: "v2p5-1" });
    expect(built.truncated).toBe(true);
    expect(built.originalBytes).toBe(Buffer.byteLength(text, "utf8"));
    expect(Array.from(built.preview)).toHaveLength(500);
  });

  it("未超限时 truncated 为 false，且原文原样返回", () => {
    const text = "a".repeat(500);
    const built = buildQueryPreview(text);
    expect(built.truncated).toBe(false);
    expect(built.preview).toBe(text);
    expect(built.originalBytes).toBe(500);
  });

  it("预览版本标记为 v2p5-1（默认与显式传入一致）", () => {
    expect(buildQueryPreview("x").previewVersion).toBe("v2p5-1");
    expect(buildQueryPreview("x", { previewVersion: "v2p5-1" }).previewVersion).toBe("v2p5-1");
  });

  it("多字节字符的原始字节长度按 UTF-8 计，不是按码元", () => {
    const built = buildQueryPreview("😀".repeat(3));
    expect(built.originalBytes).toBe(3 * 4);
    expect(built.truncated).toBe(false);
  });

  it("args_summary 单值序列化后上限 512 UTF-8 字节", () => {
    expect(ARGS_VALUE_MAX_BYTES).toBe(512);
    // 序列化后正好 512 字节（510 个 ASCII 字符 + 一对引号）→ 原样保留。
    const atLimit = "a".repeat(510);
    expect(JSON.stringify(atLimit)).toHaveLength(512);
    expect(boundAuditValue(atLimit)).toBe(atLimit);
  });

  it("超过 512 字节的字符串按类型收敛，不截断出半个值", () => {
    const over = "a".repeat(511);
    expect(JSON.stringify(over)).toHaveLength(513);
    const bounded = boundAuditValue(over) as Record<string, unknown>;
    expect(bounded.kind).toBe("omitted");
    expect(bounded.truncated).toBe(true);
    expect(bounded.bytes).toBe(513);
  });

  it("超限的结构化值改为摘要标记，序列化后仍是合法 JSON", () => {
    const bounded = boundAuditValue({ big: "x".repeat(600) }) as Record<string, unknown>;
    expect(bounded.kind).toBe("object");
    expect(bounded.truncated).toBe(true);
    expect(bounded.keyCount).toBe(1);
    expect(() => JSON.parse(JSON.stringify(bounded))).not.toThrow();
  });

  it("超限的数组改为摘要标记并保留元素个数", () => {
    const bounded = boundAuditValue(["x".repeat(600)]) as Record<string, unknown>;
    expect(bounded.kind).toBe("array");
    expect(bounded.count).toBe(1);
    expect(() => JSON.parse(JSON.stringify(bounded))).not.toThrow();
  });

  it("args_summary 最多保留 8 个键", () => {
    const args: Record<string, unknown> = {};
    for (let i = 0; i < 12; i += 1) args[`k${i}`] = i;
    const summary = summarizeArgsForAudit("lucy_query", args);
    expect(Object.keys(summary)).toHaveLength(8);
  });

  it("被脱敏的键保留存在性标记，而不是丢弃（参数缺失与已脱敏可区分）", () => {
    const summary = summarizeArgsForAudit("lucy_query", {
      password: "hunter2",
      sql: "select 1",
      source: "orders"
    });
    expect(summary.password).toBe(REDACTED_VALUE_MARKER);
    // 原始 SQL 不进热审计存储，但「参数存在」这一事实保留。
    expect(summary.sql).toBe(REDACTED_VALUE_MARKER);
    expect(summary.source).toBe("orders");
  });

  it("自由文本参数不进入 args_summary", () => {
    const summary = summarizeArgsForAudit("lucy_begin_question", {
      question: "今天销售额多少",
      intentSummary: "查销售额",
      source: "orders"
    });
    expect(summary.question).toBeUndefined();
    expect(summary.intentSummary).toBeUndefined();
    expect(summary.source).toBe("orders");
  });
});

// ─── §4.3(e) reported / observed / inferred 三族分离 ─────────────────────────

describe("§4.3(e) — reported / observed / inferred 三族分离", () => {
  it("三族互不串填：声明值不覆盖生效事实", () => {
    const families = buildEvidenceFamilies({
      reportedClient: "workbuddy",
      observedProtocol: "mcp-http",
      inferredClient: "workbuddy-like"
    });
    expect(families.reported.client).toBe("workbuddy");
    expect(families.observed.protocol).toBe("mcp-http");
    expect(families.inferred.client).toBe("workbuddy-like");
    // 声明值不得渗进 observed 族，观测值不得渗进 reported 族。
    expect(Object.keys(families.reported)).not.toContain("protocol");
    expect(Object.keys(families.observed)).not.toContain("client");
    expect(Object.keys(families.inferred)).not.toContain("protocol");
  });

  it("inferred 置信度缺省为 none（推断不是确认事实）", () => {
    const families = buildEvidenceFamilies({ inferredClient: "x" });
    expect(families.inferred.confidence).toBe("none");
    expect(families.inferred.inferenceMethod).toBeNull();
    expect(families.inferred.ruleVersion).toBeNull();
  });

  it("observed 角色带权限快照哈希", () => {
    const families = buildEvidenceFamilies({
      observedRoleIds: ["admin", "analyst"],
      permissionSnapshotHash: "sha256:abc"
    });
    expect(families.observed.roleIds).toEqual(["admin", "analyst"]);
    expect(families.observed.permissionSnapshotHash).toBe("sha256:abc");
  });
});

// ─── §4.3(b) U1 acknowledged 写路径 ───────────────────────────────────────────

describe("§4.3(b) U1 — acknowledged 写路径的三重比对", () => {
  const visible = new Set(["ingress-1"]);
  const valid = {
    parentEventId: "ingress-1",
    visibleParentIds: visible,
    declaredAttemptId: "attempt-1",
    parentAttemptId: "attempt-1",
    parentPreparedDigest: "sha256:prepared",
    declaredDigest: "sha256:prepared"
  };

  it("父可见 + attempt 一致 + 摘要一致才升级 acknowledged", () => {
    const result = validateAcknowledgement(valid);
    expect(result.upgraded).toBe(true);
    expect(result.reason).toBe("acknowledged");
    expect(result.parentIngressEventId).toBe("ingress-1");
    expect(result.parentAttemptId).toBe("attempt-1");
  });

  it("父不在适配器可见集合内 → 不升级", () => {
    const result = validateAcknowledgement({ ...valid, parentEventId: "ingress-other" });
    expect(result.upgraded).toBe(false);
    expect(result.reason).toBe("parent_not_visible");
  });

  it("父 attempt 与观测声明不一致 → 不升级", () => {
    const result = validateAcknowledgement({ ...valid, declaredAttemptId: "attempt-2" });
    expect(result.upgraded).toBe(false);
    expect(result.reason).toBe("parent_attempt_mismatch");
  });

  it("响应摘要与持久 response_prepared 摘要不一致 → 不升级", () => {
    const result = validateAcknowledgement({ ...valid, declaredDigest: "sha256:other" });
    expect(result.upgraded).toBe(false);
    expect(result.reason).toBe("parent_digest_mismatch");
  });

  it("缺父 / 缺父 attempt / 缺观测 attempt / 缺摘要 → 各自原因，一律不升级", () => {
    expect(validateAcknowledgement({ ...valid, parentEventId: null }).reason).toBe("parent_event_id_missing");
    expect(validateAcknowledgement({ ...valid, parentAttemptId: null }).reason).toBe("parent_attempt_unknown");
    expect(validateAcknowledgement({ ...valid, declaredAttemptId: null }).reason).toBe("declared_attempt_missing");
    expect(validateAcknowledgement({ ...valid, parentPreparedDigest: null }).reason).toBe(
      "parent_response_prepared_missing"
    );
    expect(validateAcknowledgement({ ...valid, declaredDigest: null }).reason).toBe("declared_digest_missing");
  });

  it("校验不通过时送达状态是 unknown，绝不是 unacknowledged", () => {
    const status = resolveDeliveryStatus({
      eventType: "result_received",
      acknowledgement: validateAcknowledgement({ ...valid, declaredDigest: "sha256:other" })
    });
    expect(status).toBe("unknown");
  });

  it("非 result_received 观测一律 unknown（无 ACK 超时，不推导 unacknowledged）", () => {
    for (const eventType of ["heartbeat", "preflight_rejected", "artifact_created", "egress_observed"] as const) {
      expect(resolveDeliveryStatus({ eventType })).toBe("unknown");
    }
  });

  it("有效回执升级为 acknowledged", () => {
    const status = resolveDeliveryStatus({
      eventType: "result_received",
      acknowledgement: validateAcknowledgement(valid)
    });
    expect(status).toBe("acknowledged");
  });

  it("可见父集合只收同主体同会话且在账本中存在的父", async () => {
    const lookup = async (id: string) => {
      if (id === "p1") return { operationId: "op-1", actor: "actor-a", sessionFingerprint: "sess-1" };
      if (id === "p2") return { operationId: "op-2", actor: "actor-b", sessionFingerprint: "sess-1" };
      if (id === "p3") return { operationId: "op-3", actor: "actor-a", sessionFingerprint: "sess-2" };
      return null;
    };
    const visibleIds = await resolveVisibleParentIds(["p1", "p2", "p3", "missing", ""], lookup, {
      actor: "actor-a",
      sessionFingerprint: "sess-1"
    });
    expect([...visibleIds]).toEqual(["p1"]);
  });
});

// ─── §10.2 U8 统一错误七分类 ─────────────────────────────────────────────────

describe("§10.2 U8 — 统一错误七分类与 162 四维映射", () => {
  it("七分类枚举固定，不静默增加旧枚举", () => {
    expect(ERROR_CATEGORIES).toEqual([
      "client_schema_failure",
      "validation_failed",
      "policy_denied",
      "upstream_failed",
      "cancelled",
      "timeout",
      "budget_stopped"
    ]);
  });

  it("预算终止归 budget_stopped，且不留四维", () => {
    const r = classifyErrorCategory({ outcome: "budget_stop", decisionReason: "question_budget_exhausted" });
    expect(r.category).toBe("budget_stopped");
    expect(r.failureDimension).toBe("");
    expect(r.nullReason).toBe("not_applicable");
  });

  it("并发超限归 upstream_failed（引擎超时与并发），不消耗调用额度语义", () => {
    const r = classifyErrorCategory({ decisionReason: "question_budget_concurrency_exceeded" });
    expect(r.category).toBe("upstream_failed");
    expect(r.failureDimension).toBe("引擎超时与并发");
  });

  it("续查声明被拒归 validation_failed（用法与语义）", () => {
    for (const reason of ["pending_exists", "no_credit", "not_exhausted", "mismatch"]) {
      const r = classifyErrorCategory({ decisionReason: reason });
      expect(r.category).toBe("validation_failed");
      expect(r.failureDimension).toBe("用法与语义");
    }
  });

  it("取消归 cancelled：四维留空 + null_reason=not_applicable", () => {
    const r = classifyErrorCategory({ decisionReason: "cancelled" });
    expect(r.category).toBe("cancelled");
    expect(r.failureDimension).toBe("");
    expect(r.nullReason).toBe("not_applicable");
  });

  it("超时归 timeout（引擎超时与并发）", () => {
    const r = classifyErrorCategory({ decisionReason: "timeout" });
    expect(r.category).toBe("timeout");
    expect(r.failureDimension).toBe("引擎超时与并发");
  });

  it("命名表缺失归 policy_denied（权限拒绝）", () => {
    const r = classifyErrorCategory({ decisionReason: "explicit_table_required:orders" });
    expect(r.category).toBe("policy_denied");
    expect(r.failureDimension).toBe("权限拒绝");
  });

  it("explicit_table_required:<empty> 归 validation_failed，不是权限拒绝", () => {
    const r = classifyErrorCategory({ decisionReason: "explicit_table_required:<empty>" });
    expect(r.category).toBe("validation_failed");
    expect(r.failureDimension).toBe("用法与语义");
  });

  it("入参 schema 失败归 client_schema_failure（用法与语义）", () => {
    const r = classifyErrorCategory({ decisionReason: "invalid_arguments" });
    expect(r.category).toBe("client_schema_failure");
    expect(r.failureDimension).toBe("用法与语义");
  });

  it("语义校验失败归 validation_failed（用法与语义）", () => {
    const r = classifyErrorCategory({ decisionReason: "ambiguous_field" });
    expect(r.category).toBe("validation_failed");
    expect(r.failureDimension).toBe("用法与语义");
  });

  it("无维度线索的普通错误归 upstream_failed", () => {
    const r = classifyErrorCategory({ outcome: "error" });
    expect(r.category).toBe("upstream_failed");
    expect(r.failureDimension).toBe("用法与语义");
  });

  it("完全无法判定时分类留空，而不是硬塞一类", () => {
    const r = classifyErrorCategory({});
    expect(r.category).toBeNull();
    expect(r.failureDimension).toBe("");
  });
});
