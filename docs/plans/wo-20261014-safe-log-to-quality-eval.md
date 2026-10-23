# 20261014-QE-01 Safe Log-to-Quality-Eval Work Order

| Metadata | Content |
|---|---|
| Document name | 20261014-QE-01 Safe Log-to-Quality-Eval Work Order |
| Document type | Work Order |
| Version | v0.1 |
| Written date | 2026-10-14 |
| Spec | `docs/specs/lucy-20261014-safe-log-to-quality-eval-spec.md` v0.1 |
| Priority | P0（第一批） |
| Depends on | `webui/docs/65-safe-log-to-eval-spec.md` v0.3（安全域，已落地） |

---

## 前置存在性校验（开工必跑）

```bash
cd /Users/forrest/GitHub/project-lucy

# 安全域范式必须已存在——本工单依赖它
test -f webui/server/eval/security-candidates.ts \
  && echo "OK: 安全域范式已存在" \
  || { echo "FAIL: security-candidates.ts 缺失，安全域尚未落地，本工单不可开工"; exit 1; }

# 质量域必须尚不存在——本工单是新增
test -f webui/server/eval/quality-candidates.ts \
  && echo "FAIL: quality-candidates.ts 已存在，请确认是否重复施工" \
  || echo "OK: 质量域待建"
```

## 必读

- `AGENTS.md` → `docs/governance/DEVELOPMENT.md`
- `docs/governance/eval-quiz-conventions.md`
- `webui/docs/00-product-terminology-standard.md`
- `webui/docs/65-safe-log-to-eval-spec.md`（安全域范式来源）
- `docs/specs/lucy-20261014-safe-log-to-quality-eval-spec.md`（本单权威 Spec）
- `webui/server/eval/security-candidates.ts`（**复用对象，勿重写**）
- `webui/server/eval/cases.ts`（`EvalCase` / `ResultAssertion` / `executable` 定义）
- `webui/server/proxy/audit.ts`（L1/L2 数据来源字段）

## 目标

复用安全域流转骨架，新建物理隔离的 Quality Candidate Pool，实现 L1/L2/L3 三层取样与强制人工补全的质量 `executable` 契约晋升。

## 范围（文件所有权）

**允许修改/新建**：
- `webui/server/eval/quality-candidates.ts`（新建）
- `webui/server/eval/db.ts`（**仅新增** `quality_eval_candidate` / `quality_eval_candidate_review` 两表，不改既有表）
- `webui/server/__tests__/quality-eval-candidates.test.ts`（新建）
- `webui/src/pages/eval/**`（L3 补全界面，最小形态自行评估）
- `scripts/smoke/verify-20261014-safe-log-to-quality-eval.mjs`（新建）

**禁止触碰**：
- `webui/server/eval/security-candidates.ts`（只读复用）
- `webui/server/proxy/acl.ts`、`mcp-proxy.ts` 的 ACL 判定路径
- `webui/docs/07-mcp-auth-proxy-spec.md`

## 实施要点

1. **建表**：`quality_eval_candidate` / `quality_eval_candidate_review`，命名空间与安全域物理隔离（SC-7）。
2. **复用而非重写**：`hasAcceptedReview()`（`security-candidates.ts:310`）、`buildPromotionPreview()`（`:339`）的 YAML 合并去重与幂等逻辑，抽为共享工具或直接调用，不得复制粘贴改写。
3. **L1 生成**：从 `audit.ts` 的 access_log 按 `outcome ∈ {error, denied, budget_stop}` 筛选，携带 `decision_reason` / `failure_dimension` 作 metadata。
4. **L2 生成**：基于 turn 级聚合（同 turn 多 `wiki_search`/`lucy_catalog` 但无 `lucy_query`；或 `result_empty`；或 `call_count` 逼近上限）。产物 `kind = "intent_gap_draft"`，**Schema 层禁止携带 `executable_contract`**。
5. **三道晋升闸门**（顺序不可调换，Spec §5）：
   - 闸门 1：`intent_gap_draft` → 直接返回 `L2_DRAFT_REQUIRES_L3_COMPLETION`
   - 闸门 2：无 accept 审阅记录 → `REVIEW_REQUIRED`
   - 闸门 3：`isExecutableContractComplete()` 不通过 → `EXECUTABLE_CONTRACT_INCOMPLETE`
6. **契约完整性判定**：`required_measures[]` / `grain[]` / `required_columns[]` 非空，`required_filters[]` 至少一条或显式空集，且至少一条 `result_assertion` 存在。
7. **脱敏**：复用安全域 redaction 规则（SC-6）。

## 验收（Spec §8 SC-1..SC-8）

必须逐条实现测试，其中三条为硬性反作弊验证：

| 验收项 | 测试要点 |
|---|---|
| **SC-1** | 构造「L2 草稿 + 已有 accept 记录」→ 必须返回 `L2_DRAFT_REQUIRES_L3_COMPLETION`，**不得**通过 |
| **SC-4** | 构造「闸门顺序」场景（L2 草稿 + accept + 完整契约）→ 仍必须失败 |
| **SC-5** | 同一 candidate 重复晋升 → `ALREADY_PROMOTED`，YAML 无重复条目 |
| 其余 | 按 Spec §8 逐条覆盖 |

## 验证命令

```bash
cd webui
npx vitest run server/__tests__/quality-eval-candidates.test.ts
npm run lint:terminology

cd ..
node scripts/smoke/verify-20261014-safe-log-to-quality-eval.mjs

# ACL 未变更回归（SC-8）
cd webui && npx vitest run server/__tests__/acl-capability.test.ts \
  server/__tests__/kx-acl.test.ts server/__tests__/mcp-proxy-acl.test.ts
```

## 不做浏览器测试

除非任务明确要求，本工单**不做**浏览器 / E2E / 移动窄屏验证（依据 `DEVELOPMENT.md`「验证策略：浏览器测试约束」）。