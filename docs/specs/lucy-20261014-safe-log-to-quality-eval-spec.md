# Lucy Safe Log-to-Quality-Eval Feedback Loop Spec（P0-1）

| Metadata | Content |
|---|---|
| Document name | Lucy Safe Log-to-Quality-Eval Feedback Loop Spec |
| Document type | Product / API / Quality Eval Data Contract Spec |
| Version | v0.1 |
| Written date | 2026-10-14 |
| Related blueprint | `docs/specs/lucy-20261014-fivetran-context-layer-competitive-analysis.md` v1.4 §3 P0-1、§7.4 |
| Predecessor (security domain) | `webui/docs/65-safe-log-to-Security-Eval-spec.md` v0.3；实现见 `webui/server/eval/security-candidates.ts` |
| Related work order | `docs/plans/wo-20261014-safe-log-to-quality-eval.md` |
| Scope | Quality Candidate Pool、L1 断言型候选、L2 Intent Gap Draft、L3 人工补全、质量 `executable` 契约晋升 |

---

## 1. Background

`webui/docs/65-safe-log-to-eval-spec.md` 建立了安全域的「日志 → 候选 → 人工审 → 晋升」范式，并在 `server/eval/security-candidates.ts` 中落地。该范式的**流转骨架**（候选池、审阅分离、晋升预览、幂等保护）具备跨域复用价值，但其**断言构造不可复用**：

| 维度 | 安全域现状 | 质量域需求 | 可否复用 |
|---|---|---|---|
| 断言 | `formalCaseFor()` 只产出 `value_type: "text"` + `compare_mode: "denied"` | `ResultAssertion` 支持 `scalar` / `dataframe` / `text` / `empty_result`，可带 `numeric_tolerance` / `check_schema` / `check_row_count` / `key_columns` | 不可复用 |
| 执行契约 | 无 | `executable` 需 `required_measures` / `grain` / `required_columns` / `required_filters` / `reconciliation` | 不可复用 |
| 语义绑定 | `decision_reason` 即全部语义 | `expected_measures` / `skill_version` / `semantic_version` / `as_of_binding` | 不可复用 |

**核心事实（信息论层面）**：审计日志只记录 Execution Trace（发生了什么），不包含 Ground Truth（原本期望发生什么）。**质量断言无法从审计日志自动推导。** 这决定了质量域必须强制人工补全 `executable` 契约，而非依赖自动映射。

## 2. Goals

1. 建立与安全候选池**物理隔离**的 Quality Candidate Pool，复用其流转骨架。
2. 实现 L1（确定性失败）/ L2（意向未覆盖）/ L3（人工标注）三层取样。
3. L1 产出断言型候选；**L2 仅产出无断言草稿，禁止绕过 L3 直接晋升**。
4. 人工补全质量 `executable` 契约后方可晋升为正式 Eval Case。
5. 晋升前产出 preview / diff；durable write 需显式确认。
6. 候选生成全程 fail-closed，敏感载荷按安全域同标准脱敏或拒绝。

## 3. Non-goals

- **不**把全部用户提问自动转成 Eval。
- **不**让模型输出充当 reviewer evidence。
- **不**实现 BOM 或覆盖率计算（属 `spec-p0-2-release-bom.md`）。
- **不**实现概念字典（属 `spec-p1-concept-dictionary.md`）。
- **不**改变安全域 `security-candidates.ts` 的既有行为。
- **不**引入对运行时 ACL 判定语义的改动。

## 4. Candidate Sources（三层取样）

| 层 | 信号来源 | 产物类型 | 可自动生成断言 |
|---|---|---|---|
| **L1 确定性运行时失败** | `outcome ∈ {error, denied, budget_stop}`；`decision_reason` / `error_detail` / `failure_dimension` 非空 | **断言型候选**（Assertion Candidate） | 失败维度可映射；`executable` 仍需人工补全 |
| **L2 意向未覆盖** | 同 turn 内多次 `wiki_search` / `lucy_catalog` 但无 `lucy_query`；或 `result_empty`；或 `call_count` 逼近预算上限 | **Intent Gap Draft**（无断言） | **否** |
| **L3 人工标注** | 管理员主动捞取；或补全 L2 草稿 | 断言型候选 | 人工提供 |

**已核实的数据可得性**：L1 所需字段全部已在 `server/proxy/audit.ts` 的 access_log 表落库，含 `outcome`、`decision_reason`、`error_detail`、`failure_dimension`、`result_empty`、`lucy_turn_id`；turn 级聚合可用 `inferred_turns.call_count`。

## 5. Core Algorithm

```ts
// ── 候选生成 ──────────────────────────────────────────────
function classifyCandidate(event: AccessLogRow): Tier | "skip" {
  // L1：确定性失败
  if (event.outcome === "denied" || event.outcome === "error" || event.outcome === "budget_stop") {
    return "L1_assertion_candidate";
  }
  // L2：意向未覆盖（turn 级聚合，见 §6）
  return null; // 单行无法判定，须走 turn 聚合
}

function generateL1Candidate(event: AccessLogRow): QualityCandidate {
  return {
    kind: "assertion_candidate",
    // 可自动映射的部分：失败维度
    derived_failure_dimension: event.failure_dimension,      // "权限拒绝" | "用法与语义" | null
    derived_decision_reason: event.decision_reason,          // 仅作 metadata，不作断言
    // 人工补全部分（必须）
    executable_contract: null,        // ← L3 填写；未填写不得晋升
    expected_measures: null,          // ← L3 填写
  };
}

function generateL2Draft(turn: InferredTurnRow): IntentGapDraft {
  return {
    kind: "intent_gap_draft",         // ← 硬约束：此类型无 executable 字段
    explored_tools: turn.tools_used,  // catalog / wiki_search 等
    budget_consumed: turn.call_count,
    termination_reason: turn.last_outcome,
    // 无 measure / filter / grain —— 系统无从得知 Agent 意图
    executable_contract: FORBIDDEN,   // Schema 层禁止该字段出现在此类型
  };
}

// ── 晋升（强制 L3 闸门）────────────────────────────────────
function promote(candidateId: string): PromotionResult {
  const c = loadCandidate(candidateId);

  // 闸门 1：草稿类型不可直接晋升
  if (c.kind === "intent_gap_draft") {
    return { ok: false, code: "L2_DRAFT_REQUIRES_L3_COMPLETION" };
  }

  // 闸门 2：人工审阅记录必须存在且为 accept
  if (!hasAcceptedReview(candidateId)) {
    return { ok: false, code: "REVIEW_REQUIRED" };
  }

  // 闸门 3：质量 executable 契约必须完整 —— 本 Spec 的核心新增约束
  if (!isExecutableContractComplete(c.executable_contract)) {
    return { ok: false, code: "EXECUTABLE_CONTRACT_INCOMPLETE" };
  }
  // isExecutableContractComplete 要求同时具备：
  //   required_measures[]、grain[]、required_columns[] 非空
  //   required_filters[] 至少一条或显式声明为空集
  //   且至少一条 result_assertion 存在

  // 幂等保护（复用安全域模式）
  if (hasAcceptedReview(candidateId) && formalCaseExists(c.id)) {
    return { ok: true, code: "ALREADY_PROMOTED", noop: true };
  }

  const preview = buildPromotionPreview(c);   // YAML 合并去重，同安全域
  if (!preview.confirmed) {
    return { ok: false, code: "PREVIEW_CONFIRMATION_REQUIRED", preview };
  }
  return writeFormalCase(preview.yaml);
}
```

**分支顺序不可调换**：`L2 草稿闸门` 必须先于 `审阅检查`，否则 L2 草稿在「恰好有 accept 记录」时会绕过契约完整性检查。

## 6. Data Model

新增表（与 `security_eval_candidate` 物理隔离，独立命名空间）：

| 表 | 用途 |
|---|---|
| `quality_eval_candidate` | L1 断言型候选与 L2 草稿统一存储，`kind` 区分 |
| `quality_eval_candidate_review` | 审阅记录，`decision ∈ {accept, reject}` |

**Schema 约束（数据库层强制）**：`kind = 'intent_gap_draft'` 时，`executable_contract` 字段必须为 NULL —— 即便应用层绕过，`isExecutableContractComplete` 亦无法通过。

**可复用组件**（直接引用，不重复实现）：
- `hasAcceptedReview()` — `security-candidates.ts:310`
- `buildPromotionPreview()` — `security-candidates.ts:339`
- `formalCaseFor()` 的 YAML 合并去重逻辑 — `security-candidates.ts:321`

## 7. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

| English | 中文主术语 | 说明 | 禁止混淆 |
|---|---|---|---|
| Quality Candidate | 质量候选 | 待审阅的质量域回归素材 | Security Candidate（安全候选，不同域） |
| Intent Gap Draft | 意向缺口草稿 | L2 无断言草稿，不可直接晋升 | Candidate（泛称，易与断言型混淆） |
| Executable Contract | 执行契约 | `executable` 结构，含 measures/grain/columns/filters/reconciliation | Assertion（断言，是契约的一部分） |
| Assertion Candidate | 断言型候选 | 含失败维度、待补全契约 | Intent Gap Draft |

## 8. Acceptance Criteria

| ID | 准则 | 验证方式 |
|---|---|---|
| SC-1 | L2 草稿无法绕过 L3 直接晋升 | 构造「L2 草稿 + 已有 accept 记录」场景，`promote()` 必须返回 `L2_DRAFT_REQUIRES_L3_COMPLETION` |
| SC-2 | `executable` 契约不完整时晋升失败 | 缺 `grain` 或缺 `result_assertion` 时返回 `EXECUTABLE_CONTRACT_INCOMPLETE` |
| SC-3 | 无断言用例严禁入库 | Schema 层 + 应用层双重约束；DB 写入后断言 `executable_contract IS NULL` 的行不存在 |
| SC-4 | 闸门顺序不可绕过 | 「L2 草稿 + accept 记录 + 完整契约」组合仍必须失败 |
| SC-5 | 晋升幂等 | 同一 candidate 重复晋升返回 `ALREADY_PROMOTED`，YAML 不产生重复条目 |
| SC-6 | 敏感载荷脱敏 | 复用安全域 redaction 规则；未脱敏原文不得落盘 |
| SC-7 | 候选池与安全池物理隔离 | 质量候选不出现在安全候选列表接口，反之亦然 |
| SC-8 | 运行时 ACL 语义未变更 | 本 Spec 不改 `acl.ts` / `mcp-proxy.ts` 判定路径；回归跑既有 ACL 单测全绿 |

## 9. Open Questions

1. L3 人工补全界面的最小可用形态——是否需要独立页面，或挂在现有 `/eval/cases` 编辑器内？（Spec 不锁定，留给工单评估）
2. L2 草稿的保留期与清理策略（候选池会持续增长）。
3. 是否允许对同一 measure 的多次 L1 失败做去重聚合，避免刷屏。