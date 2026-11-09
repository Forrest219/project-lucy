/**
 * P0-4 / REQ-030-022 — answer_verifiability 纯函数与投影夹具（Plan §4／§4.1）。
 */
import { describe, expect, it } from "vitest";
import type { SourceRef } from "../proxy/acl.js";
import {
  ANSWER_VERIFIABILITY_KEY,
  ANSWER_VERIFIABILITY_SCHEMA_VERSION,
  CUTOFF_NOTE_NOT_CHECKED,
  REASON_ASSEMBLE_FAILED,
  REASON_CALIBER_EVIDENCE_MISSING,
  REASON_SOURCE_UNRESOLVED,
  buildAnswerVerifiability,
  buildAnswerVerifiabilityErrorEnvelope,
  extractLucy018PreserveFields,
  buildPinnedCaliberEvidenceFromRecord,
  caliberBindingRefFromPinned,
  digestPinnedCaliberSnapshot,
  extractNumberLiteralsFromJsonText,
  extractTopLevelMemberRaw,
  injectJsonObjectKeyPreservingLiterals,
  projectBlockLossless,
  resolveAuthoritativeSourceIdentities,
  summarizeCaliber,
  summarizeUserFilterItem,
  systemConstraintsFromForcedFilters,
  toSourceIdentity,
  validateRequestPinnedCaliber,
  wireFidelityCheck,
  type AnswerVerifiabilityBlock,
  type RequestPinnedCaliberEvidence
} from "../proxy/answer-verifiability.js";
import type { BindingSessionRecord } from "../proxy/caliber-binding-session.js";

const BIG_INT_LITERAL = "9007199254740993";
const LONG_DECIMAL_LITERAL = "0.12345678901234567890123456789";

function sampleSources(): SourceRef[] {
  return [
    {
      connectionId: "demo-mysql",
      schema: "dataforai",
      sourceName: "superstore_orders",
      physicalTable: "dataforai.superstore_orders",
      extractionMethod: "args_source_name",
      confidence: "high"
    },
    {
      connectionId: "demo-mysql",
      schema: "dataforai",
      sourceName: "superstore_returns",
      physicalTable: "dataforai.superstore_returns",
      extractionMethod: "args_source_name",
      confidence: "high"
    }
  ];
}

function nonePinned(): RequestPinnedCaliberEvidence {
  return { status: "none" };
}

function activatedPinned(): RequestPinnedCaliberEvidence {
  const boundKey = {
    connectionId: "demo-mysql",
    schema: "dataforai",
    sourceName: "superstore_orders",
    physicalTable: "dataforai.superstore_orders"
  };
  const caliberSnapshot = {
    measures: ["superstore_orders.sales"],
    dimensions: ["superstore_orders.region"],
    segments: [],
    filterFields: ["superstore_orders.region"],
    requireMeasures: []
  };
  const bindingId = "bind-orders-v1";
  const digest = digestPinnedCaliberSnapshot({ bindingId, boundKey, caliberSnapshot });
  return {
    status: "activated_snapshot",
    bindingId,
    sessionGeneration: 3,
    registryGeneration: 11,
    digest,
    caliberSnapshot,
    boundKey
  };
}

function baseLucyMeta(): Record<string, unknown> {
  return {
    contract: "lucy-r1-controlled-data-service",
    tool: "lucy_query",
    upstreamTool: "sl_query",
    sources: sampleSources(),
    guardrails: { rawSqlAllowed: false },
    result: { rowCount: 1, columnCount: 2, truncated: false },
    repair: "聚合后再缩小范围重试",
    provenance: {
      freshness: { status: "not_checked", tool: "lucy_freshness" }
    }
  };
}

function makeEnvelope(opts: {
  textObj: Record<string, unknown>;
  structuredContent?: unknown;
  nextStep?: unknown;
}): string {
  const textPayload = { ...opts.textObj };
  if (opts.nextStep !== undefined) textPayload.next_step = opts.nextStep;
  const result: Record<string, unknown> = {
    content: [{ type: "text", text: JSON.stringify(textPayload) }]
  };
  if (opts.structuredContent !== undefined) {
    result.structuredContent = opts.structuredContent;
  }
  return JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    result
  });
}

describe("answer-verifiability sources（SC-02／SC-13）", () => {
  it("多源按权威全集输出完整 identity", () => {
    const resolved = resolveAuthoritativeSourceIdentities(sampleSources());
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.items).toHaveLength(2);
    expect(resolved.items[0]).toEqual({
      connectionId: "demo-mysql",
      schema: "dataforai",
      sourceName: "superstore_orders",
      table: "dataforai.superstore_orders",
      display: "demo-mysql.dataforai.superstore_orders"
    });
  });

  it("缺 table／connection → B-RESOLVE", () => {
    expect(toSourceIdentity({
      sourceName: "x",
      physicalTable: "t",
      extractionMethod: "unknown",
      confidence: "low"
    })).toBeNull();
    const bad = resolveAuthoritativeSourceIdentities([
      {
        connectionId: "c",
        sourceName: "s",
        physicalTable: "",
        extractionMethod: "unknown",
        confidence: "low"
      }
    ]);
    expect(bad).toEqual({ ok: false, reason: REASON_SOURCE_UNRESOLVED });
  });
});

describe("answer-verifiability caliber（SC-03／SC-04／SC-05／SC-22）", () => {
  it("口径最小集＋改写前 userFilters 可区分 >100 与 <100", () => {
    const argsBefore = {
      measures: [" orders.sales ", "", "orders.profit"],
      dimensions: [{ field: "orders.region" }],
      segments: ["orders.segment_a"],
      order_by: [{ field: "orders.sales", direction: "desc" }],
      filters: ["orders.sales > 100", "orders.sales < 100"]
    };
    const caliber = summarizeCaliber({
      argsBeforeRewrite: argsBefore,
      systemConstraints: systemConstraintsFromForcedFilters(["forced"]),
      requestPinnedCaliber: nonePinned()
    });
    expect(caliber.measures).toEqual(["orders.sales", "orders.profit"]);
    expect(caliber.dimensions).toEqual(["orders.region"]);
    expect(caliber.segments).toEqual(["orders.segment_a"]);
    expect(caliber.orderBy).toEqual([{ field: "orders.sales", direction: "desc" }]);
    expect(caliber.userFilters[0]).toMatchObject({
      form: "string",
      opsNormalized: expect.arrayContaining([">"])
    });
    expect(caliber.userFilters[1]).toMatchObject({
      form: "string",
      opsNormalized: expect.arrayContaining(["<"])
    });
    expect(JSON.stringify(caliber.userFilters)).not.toContain("100");
    expect(caliber.systemConstraints[0]?.kind).toBe("row_policy");
    expect(caliber.caliberBinding).toEqual({ status: "none" });
    expect(caliber.omissions).toEqual({});
  });

  it("结构化 filter 保留 field＋op，值脱敏", () => {
    const item = summarizeUserFilterItem({
      field: "orders.region",
      op: "eq",
      value: "机密区域"
    });
    expect(item).toEqual({
      form: "structured",
      field: "orders.region",
      op: "eq",
      valueRedacted: true,
      valueLength: 4
    });
    expect(JSON.stringify(item)).not.toContain("机密");
  });

  it("cutoff 一律 not_checked；注入假 mtime／businessDate 不改变", () => {
    const sources = resolveAuthoritativeSourceIdentities(sampleSources());
    expect(sources.ok).toBe(true);
    if (!sources.ok) return;
    const built = buildAnswerVerifiability({
      sources: sources.items,
      argsBeforeRewrite: { measures: ["m"] },
      systemConstraints: [],
      requestPinnedCaliber: nonePinned()
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.block.cutoff).toEqual({
      status: "not_checked",
      note: CUTOFF_NOTE_NOT_CHECKED
    });
    expect(built.block).not.toHaveProperty("cutoff.asOf");
    expect(built.block).not.toHaveProperty("cutoff.checkedAt");
    // 假新鲜度不得进入块
    const fake = {
      ...built.block,
      cutoff: built.block.cutoff,
      _probe_mtime: "2026-01-01",
      _probe_businessDate: "2026-11-01"
    };
    expect(fake.cutoff.status).toBe("not_checked");
  });

  it("请求 pin 证据校验：缺失／非法 digest → B-ASSEMBLE", () => {
    expect(validateRequestPinnedCaliber(undefined).ok).toBe(false);
    expect(validateRequestPinnedCaliber({
      status: "activated_snapshot",
      bindingId: "b",
      sessionGeneration: 1,
      registryGeneration: 2,
      digest: "deadbeef",
      caliberSnapshot: {
        measures: [],
        dimensions: [],
        segments: [],
        filterFields: [],
        requireMeasures: []
      },
      boundKey: {
        connectionId: "c",
        schema: "s",
        sourceName: "n",
        physicalTable: "t"
      }
    }).ok).toBe(false);
    expect(validateRequestPinnedCaliber(nonePinned())).toEqual({
      ok: true,
      evidence: { status: "none" }
    });
  });

  it("M5：begun_bound 字段残缺 → evidence_missing，禁止降成 none；B-ASSEMBLE", () => {
    const incomplete: BindingSessionRecord = {
      turnId: "t1",
      generation: 1,
      commitPhase: "committed",
      bindingId: "",
      boundKey: null,
      caliberSnapshot: null,
      registryGeneration: 1,
      updatedAt: "2026-11-09T00:00:00Z"
    };
    const pinned = buildPinnedCaliberEvidenceFromRecord(incomplete, "begun_bound");
    expect(pinned).toEqual({ status: "evidence_missing" });
    expect(pinned).not.toEqual({ status: "none" });
    const validated = validateRequestPinnedCaliber(pinned);
    expect(validated.ok).toBe(false);
    if (!validated.ok) {
      expect(validated.reason).toBe(REASON_CALIBER_EVIDENCE_MISSING);
    }

    expect(buildPinnedCaliberEvidenceFromRecord(null, "begun_bound")).toEqual({
      status: "evidence_missing"
    });
    expect(buildPinnedCaliberEvidenceFromRecord(incomplete, "never_begun")).toEqual({
      status: "none"
    });
    expect(buildPinnedCaliberEvidenceFromRecord(incomplete, "begun_no_hit")).toEqual({
      status: "none"
    });

    const sources = resolveAuthoritativeSourceIdentities([sampleSources()[0]!]);
    expect(sources.ok).toBe(true);
    if (!sources.ok) return;
    const built = buildAnswerVerifiability({
      sources: sources.items,
      argsBeforeRewrite: {},
      systemConstraints: [],
      requestPinnedCaliber: pinned
    });
    expect(built.ok).toBe(false);
    if (!built.ok) {
      expect(built.reason).toBe(REASON_CALIBER_EVIDENCE_MISSING);
    }
  });

  it("SC-22：pin 快照 A 不因后续 record 变化而改 digest／代次", () => {
    const recordA: BindingSessionRecord = {
      turnId: "t1",
      generation: 7,
      commitPhase: "committed",
      bindingId: "bind-a",
      boundKey: {
        connectionId: "c",
        schema: "s",
        sourceName: "orders",
        physicalTable: "s.orders"
      },
      caliberSnapshot: {
        measures: ["orders.sales"],
        dimensions: [],
        segments: [],
        filterFields: [],
        requireMeasures: []
      },
      registryGeneration: 100,
      updatedAt: "2026-11-09T00:00:00Z"
    };
    const pinnedA = buildPinnedCaliberEvidenceFromRecord(recordA, "begun_bound");
    expect(pinnedA.status).toBe("activated_snapshot");
    const recordB: BindingSessionRecord = {
      ...recordA,
      generation: 8,
      bindingId: "bind-b",
      caliberSnapshot: {
        measures: ["orders.profit"],
        dimensions: [],
        segments: [],
        filterFields: [],
        requireMeasures: []
      },
      registryGeneration: 101
    };
    const pinnedB = buildPinnedCaliberEvidenceFromRecord(recordB, "begun_bound");
    expect(pinnedA).not.toEqual(pinnedB);
    // 公开引用仍来自请求携带的 A
    expect(caliberBindingRefFromPinned(pinnedA)).toMatchObject({
      status: "activated_snapshot",
      bindingId: "bind-a",
      sessionGeneration: 7,
      registryGeneration: 100
    });
    if (pinnedA.status !== "activated_snapshot") return;
    expect(pinnedA.digest).toHaveLength(64);
    expect(pinnedA.digest).toBe(
      digestPinnedCaliberSnapshot({
        bindingId: "bind-a",
        boundKey: recordA.boundKey!,
        caliberSnapshot: recordA.caliberSnapshot!
      })
    );
  });
});

describe("answer-verifiability lossless projection（SC-01／06b／14／18／19／23）", () => {
  it("KTX JSON 成功：三载体同生；schema_version=1；Spec 162 字段保留", () => {
    const sources = resolveAuthoritativeSourceIdentities(sampleSources());
    expect(sources.ok).toBe(true);
    if (!sources.ok) return;
    const built = buildAnswerVerifiability({
      sources: sources.items,
      argsBeforeRewrite: { measures: ["sales"], filters: [{ field: "region", op: "eq", value: "东" }] },
      systemConstraints: [],
      requestPinnedCaliber: activatedPinned()
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.block.schema_version).toBe(ANSWER_VERIFIABILITY_SCHEMA_VERSION);

    const originalWire = makeEnvelope({
      textObj: {
        headers: ["sales"],
        rows: [[1]],
        totalRows: 1
      },
      structuredContent: {
        headers: ["sales"],
        rows: [[1]],
        totalRows: 1
      }
    });
    const projected = projectBlockLossless({
      originalWire,
      block: built.block,
      lucyMeta: baseLucyMeta(),
      requestId: 1
    });
    expect(projected.ok).toBe(true);
    if (!projected.ok) return;
    const envelope = JSON.parse(projected.finalWire) as {
      result: {
        content: Array<{ text: string }>;
        structuredContent: Record<string, unknown>;
        _meta: { lucy: Record<string, unknown> };
      };
    };
    const textObj = JSON.parse(envelope.result.content[0]!.text) as Record<string, unknown>;
    const textBlock = textObj[ANSWER_VERIFIABILITY_KEY] as AnswerVerifiabilityBlock;
    const metaBlock = envelope.result._meta.lucy[ANSWER_VERIFIABILITY_KEY];
    const scBlock = envelope.result.structuredContent[ANSWER_VERIFIABILITY_KEY];
    expect(textBlock).toEqual(metaBlock);
    expect(textBlock).toEqual(scBlock);
    expect(textBlock.carriers?.structuredContent).toBe("projected");
    expect(envelope.result._meta.lucy.contract).toBe("lucy-r1-controlled-data-service");
    expect(envelope.result._meta.lucy.repair).toBe("聚合后再缩小范围重试");
    expect(envelope.result._meta.lucy.provenance).toBeTruthy();
    expect(textObj).toHaveProperty("rows");
  });

  it("structuredContent 非对象 → omitted_not_object；text＋meta 仍有块", () => {
    const sources = resolveAuthoritativeSourceIdentities([sampleSources()[0]!]);
    expect(sources.ok).toBe(true);
    if (!sources.ok) return;
    const built = buildAnswerVerifiability({
      sources: sources.items,
      argsBeforeRewrite: {},
      systemConstraints: [],
      requestPinnedCaliber: nonePinned()
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const originalWire = makeEnvelope({
      textObj: { rows: [] },
      structuredContent: "not-an-object"
    });
    const projected = projectBlockLossless({
      originalWire,
      block: built.block,
      lucyMeta: baseLucyMeta(),
      requestId: 1
    });
    expect(projected.ok).toBe(true);
    if (!projected.ok) return;
    const envelope = JSON.parse(projected.finalWire) as {
      result: {
        content: Array<{ text: string }>;
        structuredContent: unknown;
        _meta: { lucy: Record<string, unknown> };
      };
    };
    const textBlock = (JSON.parse(envelope.result.content[0]!.text) as Record<string, unknown>)[
      ANSWER_VERIFIABILITY_KEY
    ] as AnswerVerifiabilityBlock;
    expect(textBlock.carriers?.structuredContent).toBe("omitted_not_object");
    expect(envelope.result._meta.lucy[ANSWER_VERIFIABILITY_KEY]).toEqual(textBlock);
    expect(envelope.result.structuredContent).toBe("not-an-object");
  });

  it("SC-18：与 next_step 双键共存", () => {
    const sources = resolveAuthoritativeSourceIdentities([sampleSources()[0]!]);
    expect(sources.ok).toBe(true);
    if (!sources.ok) return;
    const built = buildAnswerVerifiability({
      sources: sources.items,
      argsBeforeRewrite: {},
      systemConstraints: [],
      requestPinnedCaliber: nonePinned()
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const nextStep = { kind: "empty_result", summary: "0 行" };
    const originalWire = makeEnvelope({
      textObj: { rows: [], totalRows: 0 },
      structuredContent: { rows: [], totalRows: 0, next_step: nextStep },
      nextStep
    });
    const projected = projectBlockLossless({
      originalWire,
      block: built.block,
      lucyMeta: { ...baseLucyMeta(), next_step: nextStep },
      requestId: 1
    });
    expect(projected.ok).toBe(true);
    if (!projected.ok) return;
    const textObj = JSON.parse(
      (JSON.parse(projected.finalWire) as { result: { content: Array<{ text: string }> } })
        .result.content[0]!.text
    ) as Record<string, unknown>;
    expect(textObj.next_step).toEqual(nextStep);
    expect(textObj[ANSWER_VERIFIABILITY_KEY]).toBeTruthy();
  });

  it("extractTopLevelMemberRaw：按路径抽出 structuredContent 原始 token（禁 Number 化）", () => {
    const textInner = `{"rows":[[${BIG_INT_LITERAL}]]}`;
    const scInner = `{"headers":["id","amt"],"rows":[[${BIG_INT_LITERAL},${LONG_DECIMAL_LITERAL}]],"totalRows":1}`;
    const wire =
      `{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":${JSON.stringify(textInner)}}],` +
      `"structuredContent":${scInner}}}`;

    const raw = extractTopLevelMemberRaw(wire, ["result", "structuredContent"]);
    expect(raw).not.toBeNull();
    expect(raw).toBe(scInner);
    expect(raw).toContain(BIG_INT_LITERAL);
    expect(raw).toContain(LONG_DECIMAL_LITERAL);
    // 对照：parse→stringify 会损坏——提取路径不得走那条路
    expect(JSON.stringify(JSON.parse(scInner))).not.toContain(BIG_INT_LITERAL);
    expect(String(Number(BIG_INT_LITERAL))).toBe("9007199254740992");
  });

  it("SC-23：text 与 structuredContent 分别保留大整数与超长小数字面量", () => {
    const sources = resolveAuthoritativeSourceIdentities([sampleSources()[0]!]);
    expect(sources.ok).toBe(true);
    if (!sources.ok) return;
    const built = buildAnswerVerifiability({
      sources: sources.items,
      argsBeforeRewrite: {},
      systemConstraints: [],
      requestPinnedCaliber: nonePinned()
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    // 手写 wire，确保字面量不被 Number 化后再 stringify。
    const textInner = `{"headers":["id","amt"],"rows":[[${BIG_INT_LITERAL},${LONG_DECIMAL_LITERAL}]],"totalRows":1}`;
    const scInner = `{"headers":["id","amt"],"rows":[[${BIG_INT_LITERAL},${LONG_DECIMAL_LITERAL}]],"totalRows":1}`;
    const originalWire =
      `{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":${JSON.stringify(textInner)}}],` +
      `"structuredContent":${scInner}}}`;

    // 探针：投影前必须能从 originalWire 抽出 structuredContent 原文
    const scRawBefore = extractTopLevelMemberRaw(originalWire, ["result", "structuredContent"]);
    expect(scRawBefore).toBe(scInner);

    const projected = projectBlockLossless({
      originalWire,
      block: built.block,
      lucyMeta: baseLucyMeta(),
      requestId: 1
    });
    expect(projected.ok).toBe(true);
    if (!projected.ok) return;

    // 禁止用 Number deepEqual 假绿：直接查最终 wire 字面量。
    expect(projected.finalWire).toContain(BIG_INT_LITERAL);
    expect(projected.finalWire).toContain(LONG_DECIMAL_LITERAL);
    // Number 损坏形不得成为 structuredContent 的唯一残留
    expect(String(Number(BIG_INT_LITERAL))).toBe("9007199254740992");
    expect(String(Number(LONG_DECIMAL_LITERAL))).not.toBe(LONG_DECIMAL_LITERAL);

    const finalText = (
      JSON.parse(projected.finalWire) as { result: { content: Array<{ text: string }> } }
    ).result.content[0]!.text;
    expect(finalText).toContain(BIG_INT_LITERAL);
    expect(finalText).toContain(LONG_DECIMAL_LITERAL);

    // 分别断言 structuredContent 最终原文（不是 parse 后的对象）
    const finalScRaw = extractTopLevelMemberRaw(projected.finalWire, [
      "result",
      "structuredContent"
    ]);
    expect(finalScRaw).not.toBeNull();
    expect(finalScRaw).toContain(BIG_INT_LITERAL);
    expect(finalScRaw).toContain(LONG_DECIMAL_LITERAL);
    expect(finalScRaw).toContain(`"${ANSWER_VERIFIABILITY_KEY}"`);
    // 业务 rows 字面量仍在（字面量对照，禁止靠 Number deepEqual 假绿）
    expect(extractNumberLiteralsFromJsonText(finalScRaw!)).toEqual(
      expect.arrayContaining([BIG_INT_LITERAL, LONG_DECIMAL_LITERAL])
    );

    const fidelity = wireFidelityCheck({
      originalWire,
      finalWire: projected.finalWire,
      originalTextPayload: textInner,
      finalTextPayload: finalText,
      originalStructuredRaw: scInner,
      finalStructuredRaw: finalScRaw
    });
    expect(fidelity).toEqual({ ok: true });

    expect(extractNumberLiteralsFromJsonText(finalText)).toEqual(
      expect.arrayContaining([BIG_INT_LITERAL, LONG_DECIMAL_LITERAL])
    );
  });

  it("键冲突／text 非对象 → B-ASSEMBLE，不得 success", () => {
    const sources = resolveAuthoritativeSourceIdentities([sampleSources()[0]!]);
    expect(sources.ok).toBe(true);
    if (!sources.ok) return;
    const built = buildAnswerVerifiability({
      sources: sources.items,
      argsBeforeRewrite: {},
      systemConstraints: [],
      requestPinnedCaliber: nonePinned()
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const conflictWire = makeEnvelope({
      textObj: { [ANSWER_VERIFIABILITY_KEY]: { schema_version: "9" }, rows: [] }
    });
    const conflict = projectBlockLossless({
      originalWire: conflictWire,
      block: built.block,
      lucyMeta: baseLucyMeta(),
      requestId: 1
    });
    expect(conflict.ok).toBe(false);
    if (conflict.ok) return;
    expect(conflict.reason).toBe(REASON_ASSEMBLE_FAILED);

    const nonObjectWire = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: { content: [{ type: "text", text: "[1,2,3]" }] }
    });
    const nonObject = projectBlockLossless({
      originalWire: nonObjectWire,
      block: built.block,
      lucyMeta: baseLucyMeta(),
      requestId: 1
    });
    expect(nonObject.ok).toBe(false);

    const err = buildAnswerVerifiabilityErrorEnvelope({
      requestId: 1,
      reason: REASON_ASSEMBLE_FAILED,
      detail: "key_conflict"
    });
    expect(err).toContain(REASON_ASSEMBLE_FAILED);
    expect(err).not.toContain("demo-mysql");

    // P0-5 共存：AV 错误信封可保留 018 next_step／skipped_reason。
    const preserved = extractLucy018PreserveFields({
      jsonrpc: "2.0",
      id: 1,
      result: {
        _meta: {
          lucy: {
            next_step: { kind: "empty_result" },
            next_step_skipped_reason: "content_text_not_json_object"
          }
        }
      }
    });
    expect(preserved?.next_step).toEqual({ kind: "empty_result" });
    const errWith018 = buildAnswerVerifiabilityErrorEnvelope({
      requestId: 1,
      reason: REASON_ASSEMBLE_FAILED,
      detail: "content_text_not_json_object",
      lucy018: preserved
    });
    const errParsed = JSON.parse(errWith018) as {
      result: { isError: boolean; _meta?: { lucy?: { next_step?: unknown; next_step_skipped_reason?: string } } };
    };
    expect(errParsed.result.isError).toBe(true);
    expect(errParsed.result._meta?.lucy?.next_step).toEqual({ kind: "empty_result" });
    expect(errParsed.result._meta?.lucy?.next_step_skipped_reason).toBe("content_text_not_json_object");
  });

  it("inject 保留数字字面量；普通 parse→stringify 会损坏", () => {
    const raw = `{"n":${BIG_INT_LITERAL},"d":${LONG_DECIMAL_LITERAL}}`;
    const damaged = JSON.stringify({ ...JSON.parse(raw), x: 1 });
    expect(damaged.includes(BIG_INT_LITERAL)).toBe(false);

    const injected = injectJsonObjectKeyPreservingLiterals(raw, "x", { ok: true });
    expect(injected.ok).toBe(true);
    if (!injected.ok) return;
    expect(injected.text).toContain(BIG_INT_LITERAL);
    expect(injected.text).toContain(LONG_DECIMAL_LITERAL);
    expect(injected.text).toContain("\"x\":");
  });
});

describe("SC-25 precision wire fixture", () => {
  it("structured 无大整数时仍保留 text 内 9007199254740993", () => {
    const token = BIG_INT_LITERAL;
    const textInner = `{"headers":["dau"],"rows":[],"totalRows":${token}}`;
    const originalWire = JSON.stringify({
      jsonrpc: "2.0",
      id: "sc-25-precision",
      result: {
        content: [{ type: "text", text: textInner }],
        structuredContent: { headers: ["dau"], rows: [] }
      }
    });
    const sources = resolveAuthoritativeSourceIdentities([sampleSources()[0]!]);
    expect(sources.ok).toBe(true);
    if (!sources.ok) return;
    const built = buildAnswerVerifiability({
      sources: sources.items,
      argsBeforeRewrite: { measures: ["superstore_orders.sales"] },
      systemConstraints: [],
      requestPinnedCaliber: nonePinned()
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const projected = projectBlockLossless({
      originalWire,
      block: built.block,
      lucyMeta: baseLucyMeta(),
      requestId: "sc-25-precision"
    });
    expect(projected.ok).toBe(true);
    if (!projected.ok) {
      // eslint-disable-next-line no-console
      console.log("project fail", projected);
      return;
    }
    expect(projected.finalWire).toContain(token);
    expect(JSON.parse(projected.finalWire).result.content[0].text).toContain(token);
  });
});

describe("applyAnswerVerifiabilityToLucyQuery（与 018 合并／SSE raw）", () => {
  it("enriched 已含 next_step 时双键共存且保留大整数字面量", async () => {
    const { applyAnswerVerifiabilityToLucyQuery, extractSseJsonRpcResponseRaw } = await import(
      "../proxy/answer-verifiability.js"
    );
    const sources = resolveAuthoritativeSourceIdentities([sampleSources()[0]!]);
    expect(sources.ok).toBe(true);
    if (!sources.ok) return;
    const textInner = `{"rows":[[${BIG_INT_LITERAL}]],"totalRows":1}`;
    const scInner = `{"rows":[[${BIG_INT_LITERAL},${LONG_DECIMAL_LITERAL}]],"totalRows":1}`;
    const originalWire =
      `{"jsonrpc":"2.0","id":7,"result":{"content":[{"type":"text","text":${JSON.stringify(textInner)}}],` +
      `"structuredContent":${scInner}}}`;
    const nextStep = { kind: "empty_result", summary: "0 行" };
    const enriched = {
      jsonrpc: "2.0",
      id: 7,
      result: {
        content: [{ type: "text", text: textInner }],
        structuredContent: JSON.parse(scInner),
        _meta: {
          lucy: {
            contract: "lucy-r1-controlled-data-service",
            tool: "lucy_query",
            next_step: nextStep,
            provenance: { freshness: { status: "not_checked" } }
          }
        }
      }
    };
    const applied = applyAnswerVerifiabilityToLucyQuery({
      originalEnvelopeWire: originalWire,
      enrichedEnvelope: enriched,
      requestId: 7,
      sourceRefs: [sampleSources()[0]!],
      argsBeforeRewrite: { measures: ["sales"] },
      requestPinnedCaliber: nonePinned()
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.finalWire).toContain(BIG_INT_LITERAL);
    expect(applied.finalWire).toContain(LONG_DECIMAL_LITERAL);
    expect(applied.finalWire).toContain("answer_verifiability");
    expect(applied.finalWire).toContain("next_step");
    // P0-5 共存：meta／text 有 next_step；structuredContent 原文数字未损坏
    const finalSc = extractTopLevelMemberRaw(applied.finalWire, ["result", "structuredContent"]);
    expect(finalSc).toContain(BIG_INT_LITERAL);
    expect(finalSc).toContain(LONG_DECIMAL_LITERAL);
    expect(finalSc).toContain("next_step");
    expect(finalSc).toContain("answer_verifiability");
    const sse = `event: message\ndata: ${originalWire}\n\n`;
    expect(extractSseJsonRpcResponseRaw(sse, 7)).toBe(originalWire);
  });
});

describe("answer-verifiability 排除与错误形状（SC-07／SC-15／SC-16 文档夹具）", () => {
  it("错误信封不含来源泄露", () => {
    const body = buildAnswerVerifiabilityErrorEnvelope({
      requestId: "r1",
      reason: REASON_SOURCE_UNRESOLVED,
      detail: "missing_table"
    });
    expect(body).toContain(REASON_SOURCE_UNRESOLVED);
    expect(body).not.toContain("superstore");
    expect(body).not.toContain("demo-mysql");
    const parsed = JSON.parse(body) as {
      result: { isError: boolean; content: Array<{ text: string }> };
    };
    expect(parsed.result.isError).toBe(true);
    // 失败合同只有 reason／assemble_error，不得夹带可核对块本体
    const payload = JSON.parse(parsed.result.content[0]!.text) as Record<string, unknown>;
    expect(payload).not.toHaveProperty(ANSWER_VERIFIABILITY_KEY);
    expect(payload).not.toHaveProperty("sources");
  });

  it("caliber 证据缺失 reason 契约", () => {
    const built = buildAnswerVerifiability({
      sources: [
        {
          connectionId: "c",
          schema: null,
          sourceName: "s",
          table: "t",
          display: "c.s"
        }
      ],
      argsBeforeRewrite: {},
      systemConstraints: [],
      requestPinnedCaliber: {
        status: "activated_snapshot",
        bindingId: "",
        sessionGeneration: Number.NaN,
        registryGeneration: 1,
        digest: "x".repeat(64),
        caliberSnapshot: {
          measures: [],
          dimensions: [],
          segments: [],
          filterFields: [],
          requireMeasures: []
        },
        boundKey: {
          connectionId: "c",
          schema: null,
          sourceName: "s",
          physicalTable: "t"
        }
      }
    });
    expect(built).toEqual({ ok: false, reason: REASON_CALIBER_EVIDENCE_MISSING });
  });
});
