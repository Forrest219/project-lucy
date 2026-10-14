# 20261014-REL-01 Release BOM Work Order

| Metadata | Content |
|---|---|
| Document name | 20261014-REL-01 Release BOM Work Order |
| Document type | Work Order |
| Version | v0.1 |
| Written date | 2026-10-14 |
| Spec | `docs/specs/lucy-20261014-release-bom-spec.md` v0.1 |
| Priority | P0（第二批） |
| Depends on | 20261014-QE-01（覆盖率数据来源） |

---

## 前置存在性校验（开工必跑）

```bash
cd /Users/forrest/GitHub/project-lucy

# 质量用例资产必须已存在——覆盖率映射依赖它
test -d webui/server/eval \
  && echo "OK: eval 模块存在" \
  || { echo "FAIL: eval 模块缺失"; exit 1; }

grep -q "expected_measures" webui/server/eval/cases.ts \
  && echo "OK: 覆盖侧字段可用" \
  || { echo "FAIL: cases.ts 缺 expected_measures，覆盖映射无法建立"; exit 1; }

# BOM 必须尚不存在
test -f webui/server/release/bom.ts \
  && echo "FAIL: bom.ts 已存在" \
  || echo "OK: BOM 待建"
```

## 必读

- `AGENTS.md` → `docs/governance/DEVELOPMENT.md`（**重点：语义层分层、manifest/overlay 双层设计**）
- `webui/docs/00-product-terminology-standard.md`
- `webui/docs/64-tiered-publish-gate-spec.md` v0.2（BOM 输出的消费场景）
- `docs/specs/lucy-20261014-release-bom-spec.md`（本单权威 Spec）
- `docs/specs/lucy-20261014-safe-log-to-quality-eval-spec.md`（质量契约定义）
- `webui/server/semantic-layer.ts`（**AST 能力复用对象**）
- `webui/server/overlay.ts`、`webui/server/project.ts`（既有 parseDocument 用法参考）
- `webui/server/eval/cases.ts`（`EvalCase.executable` 结构）

## 目标

实现 Measure 语义 Diff 引擎与双覆盖率计算，输出发布事件驱动的 BOM v1 静态审计摘要。

## 范围（文件所有权）

**允许修改/新建**：
- `webui/server/release/semantic-diff.ts`（新建，语义 Diff 引擎）
- `webui/server/release/bom.ts`（新建，覆盖率计算与 BOM 生成）
- `webui/server/__tests__/semantic-diff.test.ts`（新建）
- `webui/server/__tests__/release-bom.test.ts`（新建）
- `webui/src/pages/release/**` 或既有发布页面（最小展示，形态自行评估）
- `scripts/smoke/verify-20261014-release-bom.mjs`（新建）

**禁止触碰**：
- `webui/server/eval/**`（只读消费 `EvalCase`）
- `webui/docs/64-tiered-publish-gate-spec.md` 描述的既有 deny 语义
- 任何 manifest 文件（`semantic-layer/*/_schema/*.yaml`）

## 实施要点

1. **语义 Diff（Spec §4.2）**：`parseDocument` → 反序列化 → `normalizeMeasure`（剔除 description / 注释 / 字段序 / 缩进）→ `sha256(stableStringify)`。**严禁使用 Git 文本行级 diff。**
2. **只针对 overlay**：manifest 由 `ktx ingest` 自动生成，每次扫描可能重写，纳入差分会产大量假变更（SC-6）。
3. **双覆盖率（Spec §5）**：
   - 变更口径覆盖率：分母 = `changedMeasures.size`（**固定不可剔除**）
   - 基线回归通过率：分母 = 全部存量 case 数
4. **反向利用防护（Spec §5.1，三条不可弱化）**：
   - `changedMeasures` 计算全程固定，**任何剔除未覆盖项的实现都是错误实现**
   - 仅关联无 `executable` 契约 case 的 measure 计为未覆盖，不入分子
   - `evaluateGate()` **只读** Targeted Coverage，基线数据仅作 `note` 输出，不参与判定
5. **不引入新依赖**：仅用既有 `yaml` 包（`semantic-layer.ts:3` 已引入完整 AST API）。

## 验收（Spec §8 SC-1..SC-8）

其中四条为反作弊验证，必须逐条实现：

| 验收项 | 测试要点 |
|---|---|
| **SC-1** | 构造「仅改 description / 缩进 / 字段顺序」前后对 → `modified` 必须为空 |
| **SC-3** | 构造「变更 3 measure，1 个只关联无断言 case」→ **必须得 0/3**，不得为 1/2 |
| **SC-5** | 存量 149/149 全绿 + 变更口径 0 覆盖 → gate 必须**不通过** |
| **SC-8** | 确认未新增任何 package 依赖（diff `package.json`） |
| 其余 | SC-2 / SC-4 / SC-6 / SC-7 按 Spec 覆盖 |

## 验证命令

```bash
cd webui
npx vitest run server/__tests__/semantic-diff.test.ts \
                server/__tests__/release-bom.test.ts
npm run lint:terminology

cd ..
node scripts/smoke/verify-20261014-release-bom.mjs

# 确认未新增依赖
git diff --stat package.json webui/package.json
```

## 不做浏览器测试

依据 `DEVELOPMENT.md`「验证策略：浏览器测试约束」，本工单默认**不做**浏览器 / E2E / 移动窄屏验证。

## 附：待产品裁定

`TARGETED_COVERAGE_THRESHOLD` 具体取值 Spec 列为 Open Question 1。开工前须确认，或先按建议值 80% 实现并标注 `TODO(产品裁定)`。