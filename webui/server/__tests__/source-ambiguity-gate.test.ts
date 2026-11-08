/**
 * P0-3 表级歧义门闩 — SC-01–SC-26（O2＝否时 SC-21 按「不纳入」关闭）。
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { invalidateContentPathsCache } from "../paths";
import {
  collectCanonicalSourceKeys,
  resetEffectivePolicyForTests
} from "../proxy/acl";
import {
  beginBindingSessionPreparation,
  commitBindingSession,
  readBindingSession,
  setCaliberBindingStateDir
} from "../proxy/caliber-binding-session";
import { denialAllowList, buildRepairClosure } from "../proxy/question-experience";
import {
  ASK_FIRST_SECTION,
  MEASURE_SUMMARY_MAX,
  SOURCE_AMBIGUITY_GATE,
  SOURCE_AMBIGUITY_MESSAGE,
  ambiguityScopeKey,
  attestSourceConfirmation,
  buildAmbiguityRepairClosure,
  buildMatchableSourcesForGate,
  buildRepairEvidenceForGate,
  checkSourceAmbiguityGate,
  extractTerms,
  matchVisibleSources,
  persistAmbiguityCandidateSnapshot,
  projectDescriptionForGate,
  requestAssertsSource,
  resolveBusinessTermsByPriority,
  setSourceAmbiguityStateDir,
  sourceAmbiguityGateAppliesToTool,
  toRepairTargetEvidence,
  upsertJourneyOnBegin,
  type MatchableSource
} from "../proxy/source-ambiguity-gate";

const CONNECTION = "demo-mysql";
const OTHER_CONNECTION = "mysql-other";

function id(
  connectionId: string,
  schema: string,
  sourceName: string,
  physicalTable: string
) {
  return { connectionId, schema, sourceName, physicalTable };
}

function matchable(
  connectionId: string,
  schema: string,
  sourceName: string,
  physicalTable: string,
  extra: Partial<MatchableSource> = {}
): MatchableSource {
  return {
    identity: id(connectionId, schema, sourceName, physicalTable),
    sourceName,
    table: physicalTable,
    descriptionHealth: { status: "ok" },
    descriptionState: "missing",
    description: null,
    measureNames: [],
    dimensionNames: [],
    ...extra
  };
}

describe("P0-3 source ambiguity gate", () => {
  let tmpRoot: string;
  let sagDir: string;
  let cbDir: string;

  let previousProjectRoot: string | undefined;
  let previousContentRoot: string | undefined;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(os.tmpdir(), "sag-"));
    sagDir = path.join(tmpRoot, "sag");
    cbDir = path.join(tmpRoot, "cb");
    await mkdir(sagDir, { recursive: true });
    await mkdir(cbDir, { recursive: true });
    await writeFile(path.join(tmpRoot, "ktx.yaml"), "connections: {}\n", "utf8");
    await mkdir(path.join(tmpRoot, "webui", "config"), { recursive: true });
    await writeFile(
      path.join(tmpRoot, "webui", "config", "access.yaml"),
      `users:\n  - id: sag_agent\n    enabled: true\n    tokens: []\n    allow:\n      tables:\n        - dataforai.orders\n        - s.a\n        - s.b\n      tools:\n        - lucy_query\n        - lucy_explain_query\n`,
      "utf8"
    );
    const schemaDir = path.join(tmpRoot, "semantic-layer", CONNECTION, "_schema");
    await mkdir(schemaDir, { recursive: true });
    await writeFile(
      path.join(schemaDir, "dataforai.yaml"),
      `tables:\n  orders:\n    table: dataforai.orders\n  a:\n    table: s.a\n  b:\n    table: s.b\n`,
      "utf8"
    );
    setSourceAmbiguityStateDir(sagDir);
    setCaliberBindingStateDir(cbDir);
    previousProjectRoot = process.env.KTX_PROJECT_ROOT;
    previousContentRoot = process.env.LUCY_CONTENT_ROOT;
    process.env.KTX_PROJECT_ROOT = tmpRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    invalidateContentPathsCache();
    resetEffectivePolicyForTests();
  });

  afterEach(async () => {
    setSourceAmbiguityStateDir(null);
    setCaliberBindingStateDir(null);
    resetEffectivePolicyForTests();
    invalidateContentPathsCache();
    if (previousProjectRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
    else process.env.KTX_PROJECT_ROOT = previousProjectRoot;
    if (previousContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
    else process.env.LUCY_CONTENT_ROOT = previousContentRoot;
    await rm(tmpRoot, { recursive: true, force: true });
  });

  // ─── SC-01 / SC-02 / SC-22：instructions 事实源 ───────────────────────────

  it("SC-01/02/22: ASK_FIRST fragment matches md and forbids silent auto-pick", async () => {
    const md = await readFile(
      path.join(process.cwd(), "config", "data-qa-instructions.md"),
      "utf8"
    );
    expect(md).toContain("问询范围确认／多表命中先问");
    expect(md).toContain("source_ambiguity_gate");
    expect(md).toContain("不得自行挑选最高分表");
    expect(ASK_FIRST_SECTION).toContain("多表命中先问");
    expect(ASK_FIRST_SECTION).toContain("source_ambiguity_gate");
    expect(ASK_FIRST_SECTION).toContain("指代");
    expect(ASK_FIRST_SECTION).toContain("两个意图");
    // 与 md 同事实源：关键规则不得漂移
    for (const needle of [
      "多个可见来源表都可能回答同一业务词",
      "Proxy 硬门闩",
      "不得自行挑选最高分表"
    ]) {
      expect(md).toContain(needle);
      expect(ASK_FIRST_SECTION).toContain(needle);
    }
    const proxy = await readFile(path.join(process.cwd(), "server", "proxy", "mcp-proxy.ts"), "utf8");
    expect(proxy).toContain("ASK_FIRST_SECTION");
    expect(proxy).toContain("Skipping begin does not bypass the source ambiguity gate");
    expect(proxy).not.toMatch(/Skipping this call never blocks catalog or query tools/);
    expect(proxy).not.toMatch(/可省略.*门闩|never blocks catalog or query tools/);
  });

  // ─── SC-20：CJK n-gram 命中 ─────────────────────────────────────────────

  it("SC-20: Chinese sentence hits two description-backed sources", () => {
    const terms = extractTerms(["今年收入是多少"]);
    expect(terms).toContain("收入");
    expect(terms).toContain("今年");
    const sources = [
      matchable(CONNECTION, "dataforai", "sales_rev", "dataforai.sales_rev", {
        description: "销售收入金额",
        descriptionState: "present",
        measureNames: ["amount_usd"]
      }),
      matchable(CONNECTION, "dataforai", "ops_rev", "dataforai.ops_rev", {
        description: "营业收入金额",
        descriptionState: "present",
        measureNames: ["amount_usd"]
      })
    ];
    const outcome = matchVisibleSources(terms, sources);
    expect(outcome.kind).toBe("hits");
    if (outcome.kind === "hits") expect(outcome.hits).toHaveLength(2);
  });

  it("SC-20 production: bare permissions allow; buildMatchableSourcesForGate denies Chinese description dual-hit", async () => {
    // 中文业务词只打在 descriptions.db；英文 sourceName／table／度量。
    await writeFile(
      path.join(tmpRoot, "semantic-layer", CONNECTION, "_schema", "dataforai.yaml"),
      `tables:
  sales_rev:
    table: dataforai.sales_rev
    descriptions:
      db: 销售收入金额
  ops_rev:
    table: dataforai.ops_rev
    descriptions:
      db: 营业收入金额
`,
      "utf8"
    );
    const visibleSources = [
      { connectionId: CONNECTION, schema: "dataforai", sourceName: "sales_rev", table: "dataforai.sales_rev" },
      { connectionId: CONNECTION, schema: "dataforai", sourceName: "ops_rev", table: "dataforai.ops_rev" }
    ];
    const permissions = {
      roleIds: [],
      tools: ["lucy_query"],
      tables: [],
      connections: [CONNECTION],
      sources: visibleSources,
      capabilities: [],
      metaTools: [],
      opsTools: []
    } as never;

    const identityKey = "agent:sc20prod";
    const sessionId = "s20p";
    const cbScope = `cb:${identityKey}:${sessionId}`;
    const sagScope = ambiguityScopeKey(identityKey, sessionId);
    await beginBindingSessionPreparation(cbScope, {
      turnId: "t",
      registryGeneration: 1,
      bindingId: null,
      boundKey: null,
      caliberSnapshot: null
    });
    await commitBindingSession(cbScope, {
      turnId: "t",
      registryGeneration: 1,
      bindingId: null,
      boundKey: null,
      caliberSnapshot: null
    });
    const sess = await readBindingSession(cbScope);
    await upsertJourneyOnBegin({
      scopeKey: sagScope,
      generation: sess.record!.generation,
      intentSummary: "今年收入是多少"
    });

    // 假绿对照：生产若未传 matchableSources → 只匹配英文名 → zero_hits → allow
    const bare = await checkSourceAmbiguityGate({
      identityKey,
      sessionId,
      toolName: "lucy_query",
      args: {},
      permissions
    });
    expect(bare.kind).toBe("allow");

    // 生产装配路径：同构直读 P0-2 投影 → 双命中 deny
    const enriched = await buildMatchableSourcesForGate(visibleSources, {
      semanticLayerRoot: path.join(tmpRoot, "semantic-layer")
    });
    expect(enriched.matchableSources.every((s) => s.descriptionHealth?.status === "ok")).toBe(true);
    expect(enriched.matchableSources.map((s) => s.description).sort()).toEqual([
      "营业收入金额",
      "销售收入金额"
    ]);
    const gated = await checkSourceAmbiguityGate({
      identityKey,
      sessionId,
      toolName: "lucy_query",
      args: {},
      permissions,
      matchableSources: enriched.matchableSources
    });
    expect(gated.kind).toBe("deny");
    if (gated.kind === "deny") {
      expect(gated.executed).toBe(false);
      expect(gated.denial.reason).toBe(SOURCE_AMBIGUITY_GATE);
      expect(gated.denial.candidates).toHaveLength(2);
    }

    // mcp-proxy 生产接线必须调用装配函数（不得只传 permissions）
    const proxy = await readFile(path.join(process.cwd(), "server", "proxy", "mcp-proxy.ts"), "utf8");
    expect(proxy).toContain("buildMatchableSourcesForGate");
    expect(proxy).toContain("matchableSources: enriched.matchableSources");
    expect(proxy).toContain("SOURCE_AMBIGUITY_CONFIRM_PATH");
  });

  // ─── SC-06：零／单命中不触发；失败不得伪装 ───────────────────────────────

  it("SC-06: true zero/single hit allows; read_failed does not fake single hit", () => {
    const terms = extractTerms(["唯一专用词XYZ"]);
    const only = [
      matchable(CONNECTION, "s", "only", "s.only", {
        description: "唯一专用词XYZ表",
        descriptionState: "present"
      })
    ];
    const single = matchVisibleSources(terms, only);
    expect(single.kind).toBe("hits");
    if (single.kind === "hits") expect(single.hits).toHaveLength(1);

    const zero = matchVisibleSources(extractTerms(["完全不相关问句"]), only);
    expect(zero.kind).toBe("zero_hits");

    // 两表本应双命中；其一 read_failed → 不可判定（SC-25）
    const dual = [
      matchable(CONNECTION, "s", "a", "s.a", {
        description: "销售收入金额",
        descriptionState: "present"
      }),
      matchable(CONNECTION, "s", "b", "s.b", {
        description: null,
        descriptionState: "missing",
        descriptionHealth: { status: "read_failed", reason: "parse_error" }
      })
    ];
    const bad = matchVisibleSources(extractTerms(["今年收入是多少"]), dual);
    expect(bad.kind).toBe("description_read_unreliable");
  });

  // ─── SC-25／SC-26：描述健康态与对象级安全 ────────────────────────────────

  it("SC-25: description read_failed projected as missing still denies", async () => {
    const scope = ambiguityScopeKey("id:t", "sess-1");
    await upsertJourneyOnBegin({
      scopeKey: scope,
      generation: 1,
      intentSummary: "今年收入是多少"
    });
    // begun_no_hit session
    await beginBindingSessionPreparation("cb:id:t:sess-1", {
      turnId: "t1",
      registryGeneration: 1,
      bindingId: null,
      boundKey: null,
      caliberSnapshot: null
    });
    await commitBindingSession("cb:id:t:sess-1", {
      turnId: "t1",
      registryGeneration: 1,
      bindingId: null,
      boundKey: null,
      caliberSnapshot: null
    });

    const a = projectDescriptionForGate({ descriptionDb: "销售收入金额" });
    const b = projectDescriptionForGate({
      descriptionDb: "营业收入金额",
      health: { status: "read_failed", reason: "io" }
    });
    expect(b.descriptionState).toBe("missing");
    expect(b.descriptionHealth.status).toBe("read_failed");

    const outcome = await checkSourceAmbiguityGate({
      identityKey: "id:t",
      sessionId: "sess-1",
      toolName: "lucy_query",
      args: {},
      permissions: {
        roleIds: [],
        tools: ["lucy_query"],
        tables: [],
        connections: [CONNECTION],
        sources: [
          { connectionId: CONNECTION, schema: "s", sourceName: "a", table: "s.a" },
          { connectionId: CONNECTION, schema: "s", sourceName: "b", table: "s.b" }
        ],
        capabilities: [],
        metaTools: [],
        opsTools: []
      } as never,
      matchableSources: [
        matchable(CONNECTION, "s", "a", "s.a", {
          description: a.description,
          descriptionState: a.descriptionState,
          descriptionHealth: a.descriptionHealth
        }),
        matchable(CONNECTION, "s", "b", "s.b", {
          description: b.description,
          descriptionState: b.descriptionState,
          descriptionHealth: b.descriptionHealth
        })
      ]
    });
    expect(outcome.kind).toBe("deny");
    if (outcome.kind === "deny") {
      expect(outcome.denial.reason).toBe(SOURCE_AMBIGUITY_GATE);
      expect(outcome.executed).toBe(false);
    }
  });

  it("SC-26: description text may mention hidden table; object sets stay clean", () => {
    const hidden = "secret_hidden_table_xyz";
    const sources = [
      matchable(CONNECTION, "s", "vis_a", "s.vis_a", {
        description: `销售收入金额；另见 ${hidden}`,
        descriptionState: "present"
      }),
      matchable(CONNECTION, "s", "vis_b", "s.vis_b", {
        description: "营业收入金额",
        descriptionState: "present"
      })
    ];
    const outcome = matchVisibleSources(extractTerms(["收入"]), sources);
    expect(outcome.kind).toBe("hits");
    if (outcome.kind === "hits") {
      expect(outcome.hits).toHaveLength(2);
      expect(outcome.hits.every((h) => h.sourceName !== hidden)).toBe(true);
      // 文本侧信道允许出现受限名字面（D15）——不得因此失败
      const withSideChannel = outcome.matched.find((m) => m.description?.includes(hidden));
      expect(withSideChannel).toBeTruthy();
      expect(withSideChannel!.description).toContain(hidden);
    }
  });

  // ─── SC-12：missing／truncated ────────────────────────────────────────────

  it("SC-12: missing skips description; truncated matches only prefix", () => {
    const missing = matchVisibleSources(extractTerms(["唯一缺失描述词"]), [
      matchable(CONNECTION, "s", "m", "s.m", {
        description: null,
        descriptionState: "missing",
        sourceName: "english_only"
      })
    ]);
    expect(missing.kind).toBe("zero_hits");

    const trunc = projectDescriptionForGate({
      descriptionDb: "前缀ABCD尾巴专名",
      maxChars: 6
    });
    expect(trunc.descriptionState).toBe("truncated");
    expect(trunc.description).toBe("前缀ABCD");
    const hitTrunc = matchVisibleSources(extractTerms(["前缀"]), [
      matchable(CONNECTION, "s", "t", "s.t", {
        description: trunc.description,
        descriptionState: trunc.descriptionState
      })
    ]);
    expect(hitTrunc.kind).toBe("hits");
    // 截断后不可见的尾巴不得参与匹配
    const missTail = matchVisibleSources(extractTerms(["尾巴专名"]), [
      matchable(CONNECTION, "s", "t", "s.t", {
        description: trunc.description,
        descriptionState: trunc.descriptionState
      })
    ]);
    expect(missTail.kind).toBe("zero_hits");
  });

  // ─── SC-08／SC-09／SC-11／SC-13／SC-18：候选与 repair ─────────────────────

  it("SC-08/09/11/13/18: allow-list + repair five-evidence; no auto-pick; no usableCandidates text", () => {
    const permissions = {
      connections: [CONNECTION],
      sources: [
        { sourceName: "orders", table: "dataforai.orders" },
        { sourceName: "returns", table: "dataforai.returns" }
      ]
    };
    const allow = denialAllowList(permissions);
    expect(allow.sources).toEqual(["orders", "returns"]);

    const candidates = [
      {
        sourceKey: id(CONNECTION, "dataforai", "orders", "dataforai.orders"),
        displayName: "orders",
        allowListName: "orders",
        measures: ["revenue"],
        description: null as string | null
      },
      {
        sourceKey: id(CONNECTION, "dataforai", "returns", "dataforai.returns"),
        displayName: "returns",
        allowListName: "returns",
        measures: ["qty"],
        description: null as string | null
      }
    ];
    // 五项全失败
    const evidenceMap = new Map([
      ["orders", {
        schemaExists: false as boolean | null,
        visibleToPrincipal: true,
        compiled: false,
        parameterShapeValid: true,
        callable: true
      }],
      ["returns", {
        schemaExists: true as boolean | null,
        visibleToPrincipal: true,
        compiled: false,
        parameterShapeValid: true,
        callable: true
      }]
    ]);
    const evidences = toRepairTargetEvidence(candidates, evidenceMap);
    const closure = buildAmbiguityRepairClosure(evidences);
    expect(closure.usableTargets).toEqual([]);
    expect(closure.text).not.toContain("可用候选：");
    expect(closure.factualError).toContain("当前没有可用的合法目标");
    // spy：走既有 buildRepairClosure
    const spy = buildRepairClosure({
      failureDimension: "source_selection",
      candidates: evidences,
      availableCandidates: []
    });
    expect(spy.usableTargets).toEqual([]);
    expect(MEASURE_SUMMARY_MAX).toBe(8);
    expect(SOURCE_AMBIGUITY_MESSAGE).toContain("表级歧义");
  });

  // ─── SC-15／§4.3：无 begin＋已断言 source → context_missing ─────────────

  it("SC-15: never_begun + asserted source is context_missing even for single lexical hit", () => {
    const outcome = resolveBusinessTermsByPriority({
      bindingState: "never_begun",
      args: { sourceName: "wrong_table", measures: ["wrong_table.amt"] },
      journey: {
        scopeKey: "x",
        generation: 0,
        intentSummary: null,
        question: null,
        confirmedSourceKey: null,
        candidateSnapshot: null,
        userParticipation: null,
        updatedAt: new Date().toISOString()
      }
    });
    expect(outcome.kind).toBe("context_missing");
    expect(requestAssertsSource({ sourceName: "a" })).toBe(true);
    expect(requestAssertsSource({ measures: ["a.b"] })).toBe(true);
    expect(requestAssertsSource({})).toBe(false);
  });

  // ─── SC-10：BindingSession 四态 ──────────────────────────────────────────

  it("SC-10: begun_bound skips gate; lost_or_conflict → caliber unresolved; never_begun gates", async () => {
    const identityKey = "agent:tok";
    const sessionId = "s10";
    const cbScope = `cb:${identityKey}:${sessionId}`;
    const sagScope = ambiguityScopeKey(identityKey, sessionId);

    // never_begun
    const never = await checkSourceAmbiguityGate({
      identityKey,
      sessionId,
      toolName: "lucy_query",
      args: { sourceName: "orders" },
      permissions: {
        roleIds: [],
        tools: [],
        tables: [],
        connections: [],
        sources: [],
        capabilities: [],
        metaTools: [],
        opsTools: []
      } as never,
      matchableSources: []
    });
    expect(never.kind).toBe("deny");
    if (never.kind === "deny") expect(never.denial.detail).toBe("need_begin_or_confirm");

    // begun_no_hit + dual hit → deny ambiguity
    await beginBindingSessionPreparation(cbScope, {
      turnId: "t",
      registryGeneration: 1,
      bindingId: null,
      boundKey: null,
      caliberSnapshot: null
    });
    await commitBindingSession(cbScope, {
      turnId: "t",
      registryGeneration: 1,
      bindingId: null,
      boundKey: null,
      caliberSnapshot: null
    });
    const sess = await readBindingSession(cbScope);
    expect(sess.state).toBe("begun_no_hit");
    await upsertJourneyOnBegin({
      scopeKey: sagScope,
      generation: sess.record!.generation,
      intentSummary: "今年收入是多少"
    });
    const dual = await checkSourceAmbiguityGate({
      identityKey,
      sessionId,
      toolName: "lucy_query",
      args: {},
      permissions: {
        roleIds: [],
        tools: ["lucy_query"],
        tables: [],
        connections: [CONNECTION],
        sources: [
          { connectionId: CONNECTION, schema: "s", sourceName: "a", table: "s.a" },
          { connectionId: CONNECTION, schema: "s", sourceName: "b", table: "s.b" }
        ],
        capabilities: [],
        metaTools: [],
        opsTools: []
      } as never,
      matchableSources: [
        matchable(CONNECTION, "s", "a", "s.a", {
          description: "销售收入金额",
          descriptionState: "present"
        }),
        matchable(CONNECTION, "s", "b", "s.b", {
          description: "营业收入金额",
          descriptionState: "present"
        })
      ]
    });
    expect(dual.kind).toBe("deny");
    if (dual.kind === "deny") {
      expect(dual.denial.reason).toBe(SOURCE_AMBIGUITY_GATE);
      expect(dual.denial.candidates.length).toBeGreaterThanOrEqual(2);
      expect(dual.denial.candidates.every((c) => c.sourceKey.connectionId)).toBe(true);
      // SC-11：无「已选定成交」
      expect(JSON.stringify(dual.denial)).not.toMatch(/已选定|auto.?select|chosenSource/i);
    }

    // begun_bound → skip
    const boundKey = id(CONNECTION, "s", "a", "s.a");
    await beginBindingSessionPreparation(cbScope, {
      turnId: "t2",
      registryGeneration: 1,
      bindingId: "bind-a",
      boundKey,
      caliberSnapshot: {
        measures: ["a.m"],
        dimensions: [],
        segments: [],
        filterFields: [],
        requireMeasures: []
      }
    });
    await commitBindingSession(cbScope, {
      turnId: "t2",
      registryGeneration: 1,
      bindingId: "bind-a",
      boundKey,
      caliberSnapshot: {
        measures: ["a.m"],
        dimensions: [],
        segments: [],
        filterFields: [],
        requireMeasures: []
      }
    });
    const bound = await checkSourceAmbiguityGate({
      identityKey,
      sessionId,
      toolName: "lucy_query",
      args: { sourceName: "a" },
      permissions: {
        roleIds: [],
        tools: [],
        tables: [],
        connections: [],
        sources: [],
        capabilities: [],
        metaTools: [],
        opsTools: []
      } as never
    });
    expect(bound.kind).toBe("skip_bound");

    // lost_or_conflict：preparing 未提交
    await beginBindingSessionPreparation(cbScope, {
      turnId: "t3",
      registryGeneration: 1,
      bindingId: "x",
      boundKey,
      caliberSnapshot: {
        measures: [],
        dimensions: [],
        segments: [],
        filterFields: [],
        requireMeasures: []
      }
    });
    const lost = await checkSourceAmbiguityGate({
      identityKey,
      sessionId,
      toolName: "lucy_explain_query",
      args: {},
      permissions: {
        roleIds: [],
        tools: [],
        tables: [],
        connections: [],
        sources: [],
        capabilities: [],
        metaTools: [],
        opsTools: []
      } as never
    });
    expect(lost.kind).toBe("deny_caliber_unresolved");
  });

  // ─── SC-07／SC-17：确认正反例 ────────────────────────────────────────────

  it("SC-07/17: host attested confirmation allows; agent self-fill / stale generation deny", async () => {
    const identityKey = "agent:tok17";
    const sessionId = "s17";
    const cbScope = `cb:${identityKey}:${sessionId}`;
    const sagScope = ambiguityScopeKey(identityKey, sessionId);
    // schema 必须与 _schema/<schema>.yaml 文件名一致，否则 collectCanonicalSourceKeys 身份对不上
    const a = id(CONNECTION, "dataforai", "a", "s.a");
    const b = id(CONNECTION, "dataforai", "b", "s.b");

    await beginBindingSessionPreparation(cbScope, {
      turnId: "t",
      registryGeneration: 1,
      bindingId: null,
      boundKey: null,
      caliberSnapshot: null
    });
    await commitBindingSession(cbScope, {
      turnId: "t",
      registryGeneration: 1,
      bindingId: null,
      boundKey: null,
      caliberSnapshot: null
    });
    const sess = await readBindingSession(cbScope);
    await upsertJourneyOnBegin({
      scopeKey: sagScope,
      generation: sess.record!.generation,
      intentSummary: "今年收入是多少"
    });

    const sources = [
      matchable(CONNECTION, "dataforai", "a", "s.a", {
        description: "销售收入金额",
        descriptionState: "present"
      }),
      matchable(CONNECTION, "dataforai", "b", "s.b", {
        description: "营业收入金额",
        descriptionState: "present"
      })
    ];
    const permissions = {
      roleIds: [],
      tools: ["lucy_query"],
      tables: [],
      connections: [CONNECTION],
      sources: [
        { connectionId: CONNECTION, schema: "dataforai", sourceName: "a", table: "s.a" },
        { connectionId: CONNECTION, schema: "dataforai", sourceName: "b", table: "s.b" }
      ],
      capabilities: [],
      metaTools: [],
      opsTools: []
    } as never;

    // 首次歧义
    const first = await checkSourceAmbiguityGate({
      identityKey,
      sessionId,
      toolName: "lucy_query",
      args: { sourceName: "a", connectionId: CONNECTION },
      permissions,
      matchableSources: sources
    });
    expect(first.kind).toBe("deny");

    // 拒绝后立即自填（无宿主证据）→ 仍 deny
    const selfFill = await checkSourceAmbiguityGate({
      identityKey,
      sessionId,
      toolName: "lucy_query",
      args: { sourceName: "a", connectionId: CONNECTION, measures: ["a.amt"] },
      permissions,
      matchableSources: sources
    });
    expect(selfFill.kind).toBe("deny");

    // 宿主 attested 正例（进程内 API；HTTP 路径见 SOURCE_AMBIGUITY_CONFIRM_PATH）
    const snap = await persistAmbiguityCandidateSnapshot({
      scopeKey: sagScope,
      generation: sess.record!.generation,
      candidates: [a, b],
      issuedAt: new Date(Date.now() - 5_000).toISOString()
    });
    expect(snap.candidateIdentities).toHaveLength(2);
    const attested = await attestSourceConfirmation({
      scopeKey: sagScope,
      generation: sess.record!.generation,
      selectedIdentity: a,
      attestedAt: new Date().toISOString()
    });
    expect(attested.ok).toBe(true);

    const { verifyUserParticipationEvidence, readSourceAmbiguityJourney } = await import(
      "../proxy/source-ambiguity-journey"
    );
    const journey = await readSourceAmbiguityJourney(sagScope);
    const verified = verifyUserParticipationEvidence({
      journey,
      expectedGeneration: sess.record!.generation,
      confirmedKey: a
    });
    expect(verified.ok).toBe(true);

    // SC-07 完整门闩：宿主 attested 后单身份引用 → allow
    resetEffectivePolicyForTests();
    const collected = await collectCanonicalSourceKeys("lucy_query", {
      connectionId: CONNECTION,
      sourceName: "a",
      measures: ["a.amt"]
    }, { fresh: true });
    expect(collected.unresolved).toEqual([]);
    expect(collected.keys).toHaveLength(1);
    expect(collected.keys[0]!.sourceName).toBe("a");

    const allowed = await checkSourceAmbiguityGate({
      identityKey,
      sessionId,
      toolName: "lucy_query",
      args: { connectionId: CONNECTION, sourceName: "a", measures: ["a.amt"] },
      permissions,
      matchableSources: sources
    });
    expect(allowed.kind).toBe("allow");

    // 旧 generation 重放
    const stale = await attestSourceConfirmation({
      scopeKey: sagScope,
      generation: sess.record!.generation - 1,
      selectedIdentity: a
    });
    expect(stale.ok).toBe(false);

    // supersede begin → 旧确认失效
    await upsertJourneyOnBegin({
      scopeKey: sagScope,
      generation: sess.record!.generation + 1,
      intentSummary: "新问题"
    });
    const afterSuper = await readSourceAmbiguityJourney(sagScope);
    expect(afterSuper.confirmedSourceKey).toBeNull();
    expect(afterSuper.userParticipation).toBeNull();
  });

  // ─── SC-16：未知 filter／双连接同名／多引用冲突 ──────────────────────────

  it("SC-16: unknown filter/order_by ghost.amount retained as unresolved", async () => {
    resetEffectivePolicyForTests();
    const collected = await collectCanonicalSourceKeys("lucy_query", {
      connectionId: CONNECTION,
      sourceName: "orders",
      filters: [{ field: "ghost.amount", op: "eq", value: 1 }]
    }, { fresh: true });
    expect(collected.unresolved.some((u) => /ghost/i.test(u))).toBe(true);
  });

  it("SC-16: dual-connection same name + multi-ref conflict denies", async () => {
    const identityKey = "agent:tok16id";
    const sessionId = "s16id";
    const cbScope = `cb:${identityKey}:${sessionId}`;
    const sagScope = ambiguityScopeKey(identityKey, sessionId);
    const aDemo = id(CONNECTION, "s", "orders", "s.orders");
    const aOther = id(OTHER_CONNECTION, "s", "orders", "s.orders");

    await beginBindingSessionPreparation(cbScope, {
      turnId: "t",
      registryGeneration: 1,
      bindingId: null,
      boundKey: null,
      caliberSnapshot: null
    });
    await commitBindingSession(cbScope, {
      turnId: "t",
      registryGeneration: 1,
      bindingId: null,
      boundKey: null,
      caliberSnapshot: null
    });
    const sess = await readBindingSession(cbScope);
    await upsertJourneyOnBegin({
      scopeKey: sagScope,
      generation: sess.record!.generation,
      intentSummary: "今年收入是多少"
    });

    const sources = [
      matchable(CONNECTION, "s", "orders", "s.orders", {
        description: "销售收入金额",
        descriptionState: "present"
      }),
      matchable(OTHER_CONNECTION, "s", "orders", "s.orders", {
        description: "营业收入金额",
        descriptionState: "present"
      })
    ];
    const permissions = {
      roleIds: [],
      tools: ["lucy_query"],
      tables: [],
      connections: [CONNECTION, OTHER_CONNECTION],
      sources: [
        { connectionId: CONNECTION, schema: "s", sourceName: "orders", table: "s.orders" },
        { connectionId: OTHER_CONNECTION, schema: "s", sourceName: "orders", table: "s.orders" }
      ],
      capabilities: [],
      metaTools: [],
      opsTools: []
    } as never;

    const ambiguous = await checkSourceAmbiguityGate({
      identityKey,
      sessionId,
      toolName: "lucy_query",
      args: {},
      permissions,
      matchableSources: sources
    });
    expect(ambiguous.kind).toBe("deny");
    if (ambiguous.kind === "deny") {
      expect(ambiguous.executed).toBe(false);
      const keys = ambiguous.denial.candidates.map((c) => c.sourceKey.connectionId).sort();
      expect(keys).toEqual([CONNECTION, OTHER_CONNECTION].sort());
    }

    // 确认 A 后仍引用 B → 冲突 deny（多 source 引用）
    await persistAmbiguityCandidateSnapshot({
      scopeKey: sagScope,
      generation: sess.record!.generation,
      candidates: [aDemo, aOther],
      issuedAt: new Date(Date.now() - 5_000).toISOString()
    });
    const attested = await attestSourceConfirmation({
      scopeKey: sagScope,
      generation: sess.record!.generation,
      selectedIdentity: aDemo,
      attestedAt: new Date().toISOString()
    });
    expect(attested.ok).toBe(true);

    // 顶层写 A、度量引用另一连接同名 → 采集多键／冲突 → 不得因确认 A 放行
    // 无完整 sourceMap 时 unresolved／多键均 deny
    const conflict = await checkSourceAmbiguityGate({
      identityKey,
      sessionId,
      toolName: "lucy_query",
      args: {
        connectionId: CONNECTION,
        sourceName: "orders",
        measures: ["orders.amt"],
        filters: [{ field: `${OTHER_CONNECTION}.orders.amt`, op: "gt", value: 0 }]
      },
      permissions,
      matchableSources: sources
    });
    expect(conflict.kind).toBe("deny");
  });

  // ─── SC-03／SC-04：多命中零上游／explain 同拦 ───────────────────────────

  it("SC-03/04: dual description hit denies query and explain with executed=false", async () => {
    const identityKey = "agent:tok0304";
    const sessionId = "s0304";
    const cbScope = `cb:${identityKey}:${sessionId}`;
    const sagScope = ambiguityScopeKey(identityKey, sessionId);
    await beginBindingSessionPreparation(cbScope, {
      turnId: "t",
      registryGeneration: 1,
      bindingId: null,
      boundKey: null,
      caliberSnapshot: null
    });
    await commitBindingSession(cbScope, {
      turnId: "t",
      registryGeneration: 1,
      bindingId: null,
      boundKey: null,
      caliberSnapshot: null
    });
    const sess = await readBindingSession(cbScope);
    await upsertJourneyOnBegin({
      scopeKey: sagScope,
      generation: sess.record!.generation,
      intentSummary: "今年收入是多少"
    });
    const sources = [
      matchable(CONNECTION, "s", "a", "s.a", {
        description: "销售收入金额",
        descriptionState: "present"
      }),
      matchable(CONNECTION, "s", "b", "s.b", {
        description: "营业收入金额",
        descriptionState: "present"
      })
    ];
    const permissions = {
      roleIds: [],
      tools: ["lucy_query", "lucy_explain_query"],
      tables: [],
      connections: [CONNECTION],
      sources: [
        { connectionId: CONNECTION, schema: "s", sourceName: "a", table: "s.a" },
        { connectionId: CONNECTION, schema: "s", sourceName: "b", table: "s.b" }
      ],
      capabilities: [],
      metaTools: [],
      opsTools: []
    } as never;

    for (const toolName of ["lucy_query", "lucy_explain_query"] as const) {
      const outcome = await checkSourceAmbiguityGate({
        identityKey,
        sessionId,
        toolName,
        args: {},
        permissions,
        matchableSources: sources
      });
      expect(outcome.kind, toolName).toBe("deny");
      if (outcome.kind === "deny") {
        expect(outcome.executed, toolName).toBe(false);
        expect(outcome.denial.reason, toolName).toBe(SOURCE_AMBIGUITY_GATE);
        expect(outcome.denial.candidates.length, toolName).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("SC-18 defaults: unwired evidence is fail-closed unknown, not all-true", () => {
    const candidates = [
      {
        sourceKey: id(CONNECTION, "s", "a", "s.a"),
        displayName: "a",
        allowListName: "a",
        measures: [] as string[]
      }
    ];
    const evidences = toRepairTargetEvidence(candidates, new Map());
    expect(evidences[0]!.schemaExists).toBeNull();
    expect(evidences[0]!.visibleToPrincipal).toBe(false);
    expect(evidences[0]!.compiled).toBe(false);
    const closure = buildAmbiguityRepairClosure(evidences);
    expect(closure.usableTargets).toEqual([]);

    const probed = buildRepairEvidenceForGate({
      candidates,
      permissions: {
        sources: [{ connectionId: CONNECTION, schema: "s", sourceName: "a", table: "s.a" }],
        tools: ["lucy_query"]
      },
      toolName: "lucy_query"
    });
    const live = toRepairTargetEvidence(candidates, probed);
    expect(live[0]!.schemaExists).toBe(true);
    expect(live[0]!.visibleToPrincipal).toBe(true);
    expect(live[0]!.callable).toBe(true);
  });

  // ─── SC-19／SC-03／SC-05：字段歧义并存；限定名不豁免 ─────────────────────

  it("SC-05/19: qualified source does not exempt; field ambiguity may ride along", async () => {
    const identityKey = "agent:tok5";
    const sessionId = "s5";
    const cbScope = `cb:${identityKey}:${sessionId}`;
    const sagScope = ambiguityScopeKey(identityKey, sessionId);
    await beginBindingSessionPreparation(cbScope, {
      turnId: "t",
      registryGeneration: 1,
      bindingId: null,
      boundKey: null,
      caliberSnapshot: null
    });
    await commitBindingSession(cbScope, {
      turnId: "t",
      registryGeneration: 1,
      bindingId: null,
      boundKey: null,
      caliberSnapshot: null
    });
    const sess = await readBindingSession(cbScope);
    await upsertJourneyOnBegin({
      scopeKey: sagScope,
      generation: sess.record!.generation,
      intentSummary: "今年收入是多少"
    });
    const outcome = await checkSourceAmbiguityGate({
      identityKey,
      sessionId,
      toolName: "lucy_explain_query",
      args: {
        connectionId: CONNECTION,
        sourceName: "a",
        measures: ["a.revenue"]
      },
      permissions: {
        roleIds: [],
        tools: ["lucy_explain_query"],
        tables: [],
        connections: [CONNECTION],
        sources: [
          { connectionId: CONNECTION, schema: "s", sourceName: "a", table: "s.a" },
          { connectionId: CONNECTION, schema: "s", sourceName: "b", table: "s.b" }
        ],
        capabilities: [],
        metaTools: [],
        opsTools: []
      } as never,
      matchableSources: [
        matchable(CONNECTION, "s", "a", "s.a", {
          description: "销售收入金额",
          descriptionState: "present"
        }),
        matchable(CONNECTION, "s", "b", "s.b", {
          description: "营业收入金额",
          descriptionState: "present"
        })
      ],
      fieldAmbiguity: { field: "revenue", repair: "列 revenue 在多个来源中存在" }
    });
    expect(outcome.kind).toBe("deny");
    if (outcome.kind === "deny") {
      expect(outcome.denial.reason).toBe(SOURCE_AMBIGUITY_GATE);
      expect(outcome.denial.fieldAmbiguity?.field).toBe("revenue");
      expect(outcome.executed).toBe(false);
    }
  });

  // ─── SC-21：O2＝否 ───────────────────────────────────────────────────────

  it("SC-21: lucy_read_source is not gated (O2=no)", () => {
    expect(sourceAmbiguityGateAppliesToTool("lucy_query")).toBe(true);
    expect(sourceAmbiguityGateAppliesToTool("lucy_explain_query")).toBe(true);
    expect(sourceAmbiguityGateAppliesToTool("lucy_read_source")).toBe(false);
  });

  // ─── SC-23：explain 插入点在本地成功体之前 ───────────────────────────────

  it("SC-23: mcp-proxy inserts gate before local explain success body", async () => {
    const source = await readFile(path.join(process.cwd(), "server", "proxy", "mcp-proxy.ts"), "utf8");
    const gateAt = source.indexOf("checkSourceAmbiguityGate");
    const explainBodyAt = source.indexOf("await lucyExplainQuery(identity, toolArgs)");
    expect(gateAt).toBeGreaterThan(0);
    expect(explainBodyAt).toBeGreaterThan(0);
    expect(gateAt).toBeLessThan(explainBodyAt);
    // 不得只挂在共享 query guard（applyLucyCallGuard 段）之后才对 explain 生效
    expect(source).toContain("sourceAmbiguityGateAppliesToTool");
  });

  // ─── SC-24：目录读取失败 ─────────────────────────────────────────────────

  it("SC-24: catalog_read_failure denies (no fake zero/single hit)", async () => {
    const identityKey = "agent:tok24";
    const sessionId = "s24";
    const cbScope = `cb:${identityKey}:${sessionId}`;
    const sagScope = ambiguityScopeKey(identityKey, sessionId);
    await beginBindingSessionPreparation(cbScope, {
      turnId: "t",
      registryGeneration: 1,
      bindingId: null,
      boundKey: null,
      caliberSnapshot: null
    });
    await commitBindingSession(cbScope, {
      turnId: "t",
      registryGeneration: 1,
      bindingId: null,
      boundKey: null,
      caliberSnapshot: null
    });
    const sess = await readBindingSession(cbScope);
    await upsertJourneyOnBegin({
      scopeKey: sagScope,
      generation: sess.record!.generation,
      intentSummary: "收入"
    });
    const outcome = await checkSourceAmbiguityGate({
      identityKey,
      sessionId,
      toolName: "lucy_query",
      args: {},
      permissions: {
        roleIds: [],
        tools: [],
        tables: [],
        connections: [],
        sources: [],
        capabilities: [],
        metaTools: [],
        opsTools: []
      } as never,
      matchableSources: [],
      catalogReadFailed: true,
      catalogReadReason: "yaml_load_failed"
    });
    expect(outcome.kind).toBe("deny");
  });

  // ─── O4 度量摘要上限 ─────────────────────────────────────────────────────

  it("O4: measure summary cap=8; gate reason stable", () => {
    expect(MEASURE_SUMMARY_MAX).toBe(8);
    expect(SOURCE_AMBIGUITY_GATE).toBe("source_ambiguity_gate");
  });
});
