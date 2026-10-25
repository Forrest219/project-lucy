// C2/C3/C4/C5 mainline scenarios (Spec §6.5 J-01, §7 UX-01/02/03/04/05).
//
// Pure module: each scenario is a declarative descriptor of one catalog variant's
// contract — which step of J-01 it covers, what UI/networking surface it drives,
// what the gold binding is, what the failure modes are, what the budget assertion
// is, and what the same-session continuation contract is. There is NO I/O here
// and NO fixture mutation; the orchestration glue (run-management / run-agent-
// journey) and the UI spec (webui/tests/real-e2e/mainline-journey.spec.ts)
// both consume this module so they share a single source of truth for "what does
// UX-01-V01 actually require?".
//
// Why this lives in its own module and not in lib/ask-plan.mjs:
//   * ask-plan.mjs is the per-ask Agent-runner registry (A7 owns it). C2-C5
//     variants include management-UI cases that have no Agent ask; the ask-plan
//     registry was never their home.
//   * scenarios describe the FULL contract (UI + network + agent + gold +
//     budget + multi-turn). Mixing that into ask-plan would re-introduce the
//     "rename handler into the ask-plan registry" path that A5 owns.
//   * this module is consumed by both the agent runner (for the Agent-side
//     asks of UX-02..05 / SEC-16..17) and the management runner (for the
//     real-UI flow of UX-01).
//
// Every variant in scope (UX-01-V01..V03, UX-02-V01..V06, UX-02-S01,
// UX-03-V01..V06, UX-03-S01..S03, UX-04-V01..V03, UX-04-S01..S02,
// UX-05-V01..V02) has a deterministic entry. New variants do NOT appear here
// silently; this module never invents a catalog id. Variants that are not yet
// owned by C2-C5 return `null` from `scenarioFor` so the runner treats them
// as the catalog's other owner (e.g. SEC-16) is responsible.

// The single user mainline's aggregate identity. J25-01 is a JOURNEY, not an
// execution item: the eight stages below are `stages[]` of one run-scoped
// state, and the three frozen UX-01 variants stay the catalog evidence.
// Never split J25-01 into eight executionIds (approved Spec §1.1 / §4.1-5).
export const JOURNEY_ID = "J25-01";

/** The three frozen UX-01 variants that carry J25-01's evidence. */
export const JOURNEY_CATALOG_EVIDENCE = Object.freeze(["UX-01-V01", "UX-01-V02", "UX-01-V03"]);

/**
 * The canonical J25-01 stage contract (approved Spec §4.2). This is the ONE
 * place the eight stages are named: the state handover (lib/j01-state.mjs),
 * the browser specs and the contract tests all read it from here, so the
 * stage ids / titles / owners cannot drift between the runner and the report.
 *
 * `requiredAssertions` uses the frozen catalog's assertion vocabulary
 * (scripts/e2e/lib/catalog.mjs ASSERTION_TOKENS) — no new token is invented.
 * `excludedFromMainline` records the low-frequency depth that belongs to a
 * branch (CONN / SEM / ACCESS / OBSERVE / AGENT / LIFECYCLE), never to J25-01.
 */
export const J01_STAGE_CONTRACT = Object.freeze([
  Object.freeze({
    stageId: "J01-01",
    title: "登录与准备",
    owner: "ACCESS",
    action: "新实例时经受控引导创建所有者；已有实例则正常登录",
    input: "run identity",
    output: "管理会话",
    requiredAssertions: Object.freeze(["allow_control", "consistency"]),
    excludedFromMainline: Object.freeze(["并发首建", "错误密钥", "撤权矩阵"]),
    dependsOn: Object.freeze([])
  }),
  Object.freeze({
    stageId: "J01-02",
    title: "新建连接",
    owner: "CONN",
    action: "在 /connections 通过真实向导新建 PostgreSQL 连接并执行连通测试",
    input: "测试库参数的秘密引用",
    output: "connectionId",
    requiredAssertions: Object.freeze(["allow_control", "real_query", "consistency"]),
    excludedFromMainline: Object.freeze(["MySQL／Hive／错误凭据／重复端点矩阵"]),
    dependsOn: Object.freeze(["J01-01"])
  }),
  Object.freeze({
    stageId: "J01-03",
    title: "启用表与 Manifest",
    owner: "CONN",
    action: "选择 Schema，获取或上传本阶段 Manifest，启用问题所需表",
    input: "connectionId",
    output: "Schema、规范源键集合",
    requiredAssertions: Object.freeze(["allow_control", "consistency"]),
    excludedFromMainline: Object.freeze(["多 Schema 全组合", "上传攻击", "容量边界"]),
    dependsOn: Object.freeze(["J01-02"])
  }),
  Object.freeze({
    stageId: "J01-04",
    title: "维护业务上下文",
    owner: "SEM",
    action: "在真实 UI 维护一个能回答问题的指标／度量及关联业务 Wiki；必要时使用一个最小业务 Skill",
    input: "规范源键",
    output: "语义版本、Wiki 路径、可选 Skill",
    requiredAssertions: Object.freeze(["allow_control", "consistency", "no_leak"]),
    excludedFromMainline: Object.freeze(["30 表批量", "200 文件", "复杂 Join／分群矩阵"]),
    dependsOn: Object.freeze(["J01-03"])
  }),
  Object.freeze({
    stageId: "J01-05",
    title: "校验并生效",
    owner: "SEM",
    action: "经发布工作台执行校验与“同步索引并生效”",
    input: "语义候选",
    output: "生效版本／索引状态",
    requiredAssertions: Object.freeze(["allow_control", "consistency", "server_trace"]),
    excludedFromMainline: Object.freeze(["并发写", "CAS", "崩溃恢复", "失败 reindex"]),
    dependsOn: Object.freeze(["J01-04"])
  }),
  Object.freeze({
    stageId: "J01-06",
    title: "新建访问主体",
    owner: "ACCESS",
    action: "在真实 UI 新建专用 Role、Agent、Token，限制到本问题所需范围；复制页面生成的 MCP 配置",
    input: "生效版本",
    output: "roleId、agentId、Token 秘密引用、MCP snippet",
    requiredAssertions: Object.freeze(["allow_control", "no_leak", "consistency"]),
    excludedFromMainline: Object.freeze(["多 Role 代数", "模板", "行权限深度", "Token 吊销"]),
    dependsOn: Object.freeze(["J01-05"])
  }),
  Object.freeze({
    stageId: "J01-07",
    title: "真实 Agent 问答",
    owner: "AGENT",
    action: "真实 Agent 使用复制配置提出高频问题，并在同会话自然追问一次",
    input: "MCP snippet＋问题",
    output: "最终答案、客户端 transcript、调用关系",
    requiredAssertions: Object.freeze(["typed_gold", "real_query", "server_trace", "consistency"]),
    excludedFromMainline: Object.freeze(["大量 Eval", "NULL／0／超时矩阵", "注入与预算耗尽"]),
    dependsOn: Object.freeze(["J01-06"])
  }),
  Object.freeze({
    stageId: "J01-08",
    title: "审计与对账",
    owner: "OBSERVE",
    action: "管理员在真实 UI 找到本次问询与调用，查看只读对账",
    input: "问询／调用关联",
    output: "审计详情与导出证据",
    requiredAssertions: Object.freeze(["consistency", "server_trace", "no_leak"]),
    excludedFromMainline: Object.freeze(["历史回放", "导出篡改", "13+ 表", "完整八桶矩阵"]),
    dependsOn: Object.freeze(["J01-07"])
  })
]);

/** The canonical stage ids, in order. */
export const J01_STAGE_IDS = Object.freeze(J01_STAGE_CONTRACT.map((s) => s.stageId));

/** The canonical stage titles, in order (the approved user-facing stage names). */
export const J01_STAGE_TITLES = Object.freeze(J01_STAGE_CONTRACT.map((s) => s.title));

/** Returns the canonical stage descriptor, or `null` for an unknown stage id. */
export function stageContractFor(stageId) {
  return J01_STAGE_CONTRACT.find((s) => s.stageId === stageId) ?? null;
}

const SCENARIOS = Object.freeze({
  // ============================================================================
  // C2: J-01 eight-stage user mainline (approved Spec §4.2, UX-01-V01..V03).
  // The eight stages are the canonical contract above; the three frozen
  // UX-01 variants are its evidence, not eight separate execution items.
  // ============================================================================
  "UX-01-V01": {
    catalog: "UX-01-V01",
    journeyId: JOURNEY_ID,
    j01Step: [1, 2, 3, 4, 5, 6, 7, 8],
    stages: J01_STAGE_IDS,
    // Canonical stage ids (the approved names live in J01_STAGE_CONTRACT).
    uiSteps: J01_STAGE_IDS,
    productType: "management",
    requires: ["lucy-http", "browser", "postgres", "ktx-upstream", "agent-client"],
    asserts: ["allow_control", "typed_gold", "real_query", "server_trace"],
    gold: "Q-CAC-28D",
    notes: [
      "Real UI writes only (no page.route / API-write mock).",
      "One continuous same-run journey: login → connection → tables/Manifest → business context → validate & publish → Role/Agent/Token + copied MCP config → real Agent ask & follow-up → audit reconciliation.",
      "First-owner login when the instance is fresh; ordinary login otherwise.",
      "Each configured client autonomously issues the question through its adapter.",
      "Depth (token revocation, sibling tokens, injection, NULL/0, timeout) belongs to the ACCESS / AGENT branches, not to this mainline."
    ]
  },
  "UX-01-V02": {
    catalog: "UX-01-V02",
    journeyId: JOURNEY_ID,
    j01Step: [1, 2, 3, 4, 5, 6, 7, 8],
    stages: J01_STAGE_IDS,
    uiSteps: J01_STAGE_IDS,
    productType: "management",
    requires: ["lucy-http", "browser", "postgres", "ktx-upstream", "agent-client"],
    asserts: ["consistency"],
    notes: [
      "Run-scoped instance marker must match the run.json the orchestrator loaded (verify-identity).",
      "Same candidate / instance / fixture digest for management + agent + security legs.",
      "Every stage of J25-01 consumes state produced by an earlier stage of the SAME run; cross-run state is rejected."
    ]
  },
  "UX-01-V03": {
    catalog: "UX-01-V03",
    journeyId: JOURNEY_ID,
    j01Step: [1, 2, 3, 4, 5, 6, 7, 8],
    stages: J01_STAGE_IDS,
    uiSteps: J01_STAGE_IDS,
    productType: "management",
    requires: ["lucy-http", "browser", "postgres", "ktx-upstream", "agent-client"],
    asserts: ["consistency"],
    notes: [
      "Audit ledger's appliedVersion (measure / policy / context) must match the version the Agent's bound query reported.",
      "If any appliedVersion disagrees, the case is failed (not silently accepted)."
    ]
  },

  // ============================================================================
  // C3: UX-02 business correctness, date/timezone, actual-vs-forecast, S01
  // ============================================================================
  "UX-02-V01": {
    catalog: "UX-02-V01",
    productType: "agent",
    requires: ["lucy-http", "agent-client", "ktx-upstream", "postgres"],
    asserts: ["typed_gold", "real_query", "server_trace", "no_leak", "repeat3"],
    gold: "Q-CAC-28D",
    notes: [
      "Default口径 = SUM(spend_cents)/SUM(new_customers) over 28 days; NULL new_customers rows excluded from BOTH numerator and denominator."
    ]
  },
  "UX-02-V02": {
    catalog: "UX-02-V02",
    productType: "agent",
    requires: ["lucy-http", "agent-client", "ktx-upstream", "postgres"],
    asserts: ["typed_gold", "real_query", "server_trace", "no_leak", "repeat3"],
    gold: "Q-CAC-EAST",
    notes: ["Same default口径, scoped to region='East'."]
  },
  "UX-02-V03": {
    catalog: "UX-02-V03",
    productType: "agent",
    requires: ["lucy-http", "agent-client", "ktx-upstream", "postgres"],
    asserts: ["typed_gold", "real_query", "server_trace", "no_leak", "repeat3"],
    gold: "Q-ORDERS-WEST-SALES",
    notes: ["sales-db 同名 source 'orders'; must equal sales.orders West row count, NOT fin-db count."]
  },
  "UX-02-V04": {
    catalog: "UX-02-V04",
    productType: "agent",
    requires: ["lucy-http", "agent-client", "ktx-upstream", "postgres"],
    asserts: ["typed_gold", "real_query", "server_trace", "repeat3"],
    gold: "Q-CAC-DT",
    notes: [
      "Date锚 = 2026-09-01..2026-09-28 (28 天) UTC; 时区锚定 UTC (matches computeGold dayString).",
      "Asking '最近 N 天' must use the documented window start (the dataset is anchored to 2026-09-01)."
    ]
  },
  "UX-02-V05": {
    catalog: "UX-02-V05",
    productType: "agent",
    requires: ["lucy-http", "agent-client", "ktx-upstream", "postgres"],
    asserts: ["typed_gold", "real_query", "server_trace", "repeat3"],
    gold: "Q-CAC-ACTUAL-FORECAST",
    notes: [
      "actual 与 forecast 口径分离: rows where is_forecast=false feed actual; is_forecast=true feed forecast.",
      "Independent typed gold for each口径, the runner MUST NOT mix them."
    ]
  },
  "UX-02-V06": {
    catalog: "UX-02-V06",
    productType: "agent",
    requires: ["lucy-http", "agent-client", "ktx-upstream", "postgres"],
    asserts: ["typed_gold", "real_query", "server_trace", "consistency", "repeat3"],
    gold: "Q-CAC-28D",
    notes: [
      "measureVersion in the audit ledger must equal the measure version the bound query saw.",
      "Independently typed gold; the runner cannot pass by re-stating the value with no measure version."
    ]
  },
  "UX-02-S01": {
    catalog: "UX-02-S01",
    productType: "agent",
    requires: ["lucy-http", "agent-client", "ktx-upstream", "postgres"],
    asserts: ["typed_gold", "real_query", "server_trace", "repeat3"],
    gold: "Q-ORDERS-EAST",
    notes: [
      "内建度量 count(*)/count(1) 引导 (the runner's lucy_query input uses count_distinct_order_id, equivalent to COUNT(DISTINCT order_id)).",
      "嵌套聚合拒绝 (a nested aggregate query is refused by the gate; the answer must NOT silently succeed).",
      "同名字段消歧 (region in marketing vs region in orders).",
      "中文度量 (the dataset's CN measure labels).",
      "Each sub-behavior has its own contract assertion; the runner cannot satisfy them all by passing one happy-path query."
    ]
  },

  // ============================================================================
  // C4: UX-03 空/NULL/0/失败, timeouts/cancel/concurrency, S01/S02/S03
  // ============================================================================
  "UX-03-V01": {
    catalog: "UX-03-V01",
    productType: "agent",
    requires: ["lucy-http", "agent-client", "ktx-upstream", "postgres"],
    asserts: ["typed_gold", "real_query", "server_trace", "repeat3"],
    gold: "Q-EMPTY-NORTH",
    notes: [
      "空结果 = 'no qualifying rows'; the answer MUST report no data and MUST NOT fabricate a number.",
      "When the bound query returns rows=[] AND aggregate=null AND value=null, typed_gold(empty) is satisfied."
    ]
  },
  "UX-03-V02": {
    catalog: "UX-03-V02",
    productType: "agent",
    requires: ["lucy-http", "agent-client", "ktx-upstream", "postgres"],
    asserts: ["typed_gold", "real_query", "server_trace", "repeat3"],
    gold: "Q-NULL-DAYS",
    notes: [
      "NULL 与 0 区分: COUNT(*) WHERE new_customers IS NULL is a positive integer, NOT zero.",
      "A result of '0 天 NULL' must FAIL; the answer must commit to the measured COUNT."
    ]
  },
  "UX-03-V03": {
    catalog: "UX-03-V03",
    productType: "agent",
    requires: ["lucy-http", "agent-client", "ktx-upstream", "postgres"],
    asserts: ["typed_gold", "real_query", "server_trace", "repeat3"],
    gold: "Q-ZERO-DAY",
    notes: [
      "零分母 = aggregate:null WITH denominator:0 (SQL NULL of a divide-by-zero).",
      "A result of '0 元' is a defined value and fails; the answer must explain cannot-be-computed."
    ]
  },
  "UX-03-V04": {
    catalog: "UX-03-V04",
    productType: "agent",
    requires: ["lucy-http", "agent-client", "ktx-upstream", "postgres"],
    asserts: ["no_leak", "server_trace", "consistency", "repeat3"],
    notes: [
      "失败可理解且不静默换题: the runner must NOT swap to a different question on error.",
      "Same prompt text in (prompt === gold.question); any drift fails the case.",
      "Server trace must be present (server_trace) and no credential/canary leak (no_leak)."
    ]
  },
  "UX-03-V05": {
    catalog: "UX-03-V05",
    productType: "agent",
    requires: ["lucy-http", "agent-client", "ktx-upstream", "postgres", "fault-control"],
    asserts: ["no_leak", "server_trace", "consistency", "repeat3"],
    notes: [
      "超时后重试可理解: timeout must surface as a partial/cancel verdict, not a fabricated completion.",
      "部分结果不冒充完整: a final answer that commits to 'TIMEOUT' or 'partial' is correct.",
      "fault-control present (the runner's native client timed out under real clock-control)."
    ]
  },
  "UX-03-V06": {
    catalog: "UX-03-V06",
    productType: "agent",
    requires: ["lucy-http", "agent-client", "ktx-upstream", "postgres", "fault-control"],
    asserts: ["no_leak", "server_trace", "consistency", "repeat3"],
    notes: [
      "截断与取消可理解: explicit cancel/截断 is a partial verdict; no silent completion.",
      "Server trace must include the cancel event; subsequent legal request must not be blocked by an unfreed slot."
    ]
  },
  "UX-03-S01": {
    catalog: "UX-03-S01",
    productType: "agent",
    requires: ["lucy-http", "agent-client", "ktx-upstream", "postgres"],
    asserts: ["no_leak", "server_trace", "consistency", "repeat3"],
    budget: { maxModelCallsPerCandidateRun: 400, maxAgentRunWallClockMinutes: 180 },
    notes: [
      "问询预算耗尽: register one question, exhaust the Lucy per-question budget (20 counted tool calls or 120000 ms), and verify the stop response.",
      "Spec 162 product thresholds are 20 counted tool calls / 120000 ms with one continuation. The profile limits (400 model calls / 180 run minutes) constrain the test runner separately; they do not prove the product budget.",
      "Budget-boundary test: with budget exhausted, one CONTINUE ask is allowed; the runner must NEVER spawn an infinite loop and must NEVER bypass the budget by raising the cap.",
      "The runner's modelCalls counter increments per ASK-PLAN ENTRY (not per client invocation), but each entry's wall-clock bound is the Spec profile value; measured actual model usage (num_turns / tool calls / retries) is captured from the adapter parseResult and recorded against the budget."
    ]
  },
  "UX-03-S02": {
    catalog: "UX-03-S02",
    productType: "security",
    requires: ["lucy-http"],
    asserts: ["no_leak", "server_trace", "consistency"],
    notes: [
      "查询并发上限与失败后释放执行槽: a configurable concurrent-query limit must reject excess requests with an explicit deny code.",
      "After one slot is released, a subsequent legal request MUST succeed (no permanent lock-out).",
      "Security runner (no Agent adapter) — verified through MCP protocol, not via an autonomous client ask."
    ]
  },
  "UX-03-S03": {
    catalog: "UX-03-S03",
    productType: "agent",
    requires: ["lucy-http", "agent-client", "ktx-upstream", "postgres", "fault-control"],
    asserts: ["no_leak", "server_trace", "consistency", "repeat3"],
    notes: [
      "取消、超时重试、空结果与慢调用 — same-session continuation contract: an Agent that issued a cancel must continue in the same session with the next legal ask.",
      "Each cancel/retry/slow path is its own contract assertion; the runner cannot satisfy them by passing one happy retry."
    ]
  },

  // ============================================================================
  // C5: UX-04 multi-turn / publish / recovery
  // ============================================================================
  "UX-04-V01": {
    catalog: "UX-04-V01",
    productType: "agent",
    requires: ["lucy-http", "agent-client", "ktx-upstream", "postgres"],
    asserts: ["typed_gold", "real_query", "server_trace", "repeat3"],
    gold: "Q-CAC-MULTITURN",
    multiTurn: {
      kind: "same-session",
      turns: [
        { prompt: "最近 28 天的获客成本是多少？默认口径是什么？", goldKey: "Q-CAC-28D", preserve: { days: 28, region: null, table: "marketing_daily" } },
        { prompt: "按华东区域呢？", goldKey: "Q-CAC-EAST", preserve: { days: 28, region: "East", table: "marketing_daily" } },
        { prompt: "改成 7 天呢？", goldKey: "Q-CAC-7D", preserve: { days: 7, region: null, table: "marketing_daily" } }
      ]
    },
    notes: [
      "同会话多轮日期粒度不漂移: each turn's filter/date/grain/metric is preserved through the same MCP session (no restart, no fresh session).",
      "The adapter MUST use the adapter's native continuation (claude-code -c / openclaw --resume / thread.id reuse); passing a synthetic transcript array is NOT a substitute."
    ]
  },
  "UX-04-V02": {
    catalog: "UX-04-V02",
    productType: "management",
    requires: ["lucy-http", "browser", "agent-client", "ktx-upstream", "postgres"],
    asserts: ["typed_gold", "real_query", "server_trace", "consistency"],
    gold: "Q-CAC-28D",
    notes: [
      "发布后新旧会话按实际版本查数: pre-publish sessions see version V; post-publish NEW sessions see version V+1 with the same business answer.",
      "Pre-publish session MUST still report V (the old version) when asked; the version drift between OLD and NEW sessions is the assertion."
    ]
  },
  "UX-04-V03": {
    catalog: "UX-04-V03",
    productType: "management",
    requires: ["lucy-http", "browser", "agent-client", "ktx-upstream", "postgres"],
    asserts: ["typed_gold", "real_query", "server_trace", "consistency"],
    gold: "Q-CAC-AFTER-RECOVERY",
    notes: [
      "版本恢复后语义 hash 与 gold 对得上: the catalog's measureHash (post-recovery) equals the gold's measureHash; the answer's typed-gold aggregate matches the post-recovery dataset."
    ]
  },
  "UX-04-S01": {
    catalog: "UX-04-S01",
    productType: "management",
    requires: ["lucy-http", "browser", "agent-client", "ktx-upstream", "postgres"],
    asserts: ["typed_gold", "real_query", "server_trace", "consistency"],
    gold: "Q-CAC-TEMPLATE",
    notes: [
      "认证路径与报告模板沿用原查询 ACL 不扩大来源: a saved report template that references 'CAC by region' must run with the same Role/Constraints as the original ask, NOT a wider role.",
      "The template's appliedVersion (per the audit ledger) must equal the catalog version, and the bound query must use the SAME region/days/measure as the original ask."
    ]
  },
  "UX-04-S02": {
    catalog: "UX-04-S02",
    productType: "management",
    requires: ["lucy-http", "browser", "agent-client", "ktx-upstream", "postgres"],
    asserts: ["typed_gold", "real_query", "server_trace", "consistency"],
    gold: "Q-CAC-28D",
    notes: [
      "模板口径与审计 appliedVersion 一致: the template's audit entry reports the same policyVersion + contextPolicyVersion as the template's current ask.",
      "模板错误/权限拒绝不静默改题: when the template fails (denial, compilation error, missing role) the runner MUST NOT silently swap to a different question."
    ]
  },

  // ============================================================================
  // C3 (continued): UX-05 multi-product consistency
  // ============================================================================
  "UX-05-V01": {
    catalog: "UX-05-V01",
    productType: "agent",
    requires: ["lucy-http", "agent-client", "ktx-upstream", "postgres"],
    asserts: ["typed_gold", "real_query", "server_trace", "repeat3", "consistency"],
    gold: "Q-CAC-28D",
    notes: [
      "每个 required 产品 (claude-code + openclaw) × 3 次独立运行 must produce the SAME business verdict on the SAME question.",
      "Wording may differ (CN/EN, short/long) but the typed_gold + real_query + no_leak + server_trace verdicts must agree across products.",
      "Failed attempts are PRESERVED (R9: first failed run is not overwritten); repeat3 enforces all 3/3."
    ]
  },
  "UX-05-V02": {
    catalog: "UX-05-V02",
    productType: "agent",
    requires: ["lucy-http", "agent-client", "ktx-upstream", "postgres"],
    asserts: ["deny", "no_leak", "server_trace", "repeat3", "consistency"],
    gold: "Q-CAC-EAST",
    notes: [
      "每个 required 产品 × 3 runs, SAME security verdict: zero unauthorized upstream executions, no canary/credential leak, server_trace bound.",
      "A product reporting ANY upstreamUnauthorized > 0 fails the security verdict and breaks consistency across products."
    ]
  }
});

/** Returns the scenario descriptor for a catalog id, or `null` when the variant is not
 *  owned by C2-C5 (e.g. SEC-16 belongs to D3). Pure: no mutation, no I/O. */
export function scenarioFor(testCase) {
  if (!testCase || typeof testCase.id !== "string") return null;
  return SCENARIOS[testCase.id] ?? null;
}

/** Returns the list of catalog ids owned by C2-C5. Used by the agent runner and the
 *  management runner to short-circuit handler lookup without duplicating the id list. */
export function ownedCatalogIds() {
  return Object.keys(SCENARIOS);
}

/** UX-04-V01 multi-turn shape: returns the array of `{prompt, goldKey, preserve}` turns
 *  for a scenario, or `null` when the variant is not multi-turn. The agent runner uses
 *  this to wire the adapter's native continuation (claude-code -c / openclaw --resume
 *  / thread.id reuse) and to verify that filter/date/grain/metric survives across turns. */
export function multiTurnFor(testCase) {
  const scn = scenarioFor(testCase);
  return scn?.multiTurn ?? null;
}

/** Per-variant catalog: returns the gold key the scenario binds to, or `null`. The
 *  gold key matches a question exported by examples/security-e2e/gold/compute-gold.mjs.
 *  Variants that have no typed_gold assertion (UX-03-V04..V06, UX-03-S01/S02/S03)
 *  return `null` because their contract is "no leak / no silent swap", not a typed
 *  numeric answer. */
export function goldKeyFor(testCase) {
  const scn = scenarioFor(testCase);
  return scn?.gold ?? null;
}

/** Spec §162 budget assertions, frozen per the customer-release profile. The agent
 *  runner reads the same profile (scripts/e2e/profiles/customer-release.yaml) so this
 *  is the consumer-side mirror used by scenario tests and the mainline spec. */
export const FROZEN_BUDGET = Object.freeze({
  maxModelCallsPerCandidateRun: 400,
  maxAgentCaseWallClockSeconds: 600,
  maxAgentRunWallClockMinutes: 180
});

/** Same-session continuation contract. Adapters that support native continuation
 *  (claude-code with `-c`, openclaw with `--resume <session_id>`, codex with
 *  `codex exec resume <thread_id>`) MUST use the adapter's continuation flag and
 *  pass the sessionId captured from the previous parseResult. Adapters that do not
 *  support continuation in their driver CLI MUST return `{ supported: false }` and
 *  the runner MUST record the variant as `blockUnless adapter supports continuation`
 *  rather than fake a transcript array. */
export const CONTINUATION = Object.freeze({
  adapterSupportsContinuation: {
    "claude-code": { supported: true, flag: "-c", env: null },
    openclaw: { supported: true, flag: "--resume", env: null },
    codex: { supported: true, flag: "exec resume", env: null }
  },
  contract: "the adapter MUST reuse the previous turn's sessionId/thread_id via its native continuation flag; passing a conversation array is NOT a substitute"
});