# Lucy Release Bill of Materials Spec（P0-2）

| Metadata | Content |
|---|---|
| Document name | Lucy Release Bill of Materials Spec |
| Document type | Product / Release Governance Spec |
| Version | v0.1 |
| Written date | 2026-10-14 |
| Related blueprint | `docs/specs/lucy-20261014-fivetran-context-layer-competitive-analysis.md` v1.4 §3 P0-2、§8.1 |
| Related gate | `webui/docs/64-tiered-publish-gate-spec.md` v0.2 |
| Related spec | `docs/specs/lucy-20261014-safe-log-to-quality-eval-spec.md`（覆盖率数据来源） |
| Related work order | `docs/plans/wo-20261014-release-bom.md` |
| Scope | 语义 Diff 引擎、变更口径覆盖率、基线回归通过率、BOM v1 静态输出、BOM v2 延期 |

---

## 1. Background

`webui/docs/64-tiered-publish-gate-spec.md` 已建立 Agent / Role / Token 变更的分级门禁（P0 拦截 / P1 复核 / P2 告警），但其输入是**治理变更事件**，不覆盖语义层口径变更。客户决策层在发布审批时缺少一份可归档的「这一版发布改了什么、覆盖到哪、还差什么」凭证。

**明确不做实时 Dashboard**——私有化交付团队维护长期看板是沉重包袱。改由发布事件驱动的静态审计摘要。

## 2. Goals

1. 建立 **Measure 语义 Diff**：YAML AST 反序列化后比对业务语义值，排除格式噪声。
2. 输出 **变更口径覆盖率**（Targeted Coverage）作为门禁阈值判定依据。
3. 输出 **基线回归通过率**（Baseline Pass Rate）作为存量健康度参考。
4. 两项指标**分母不同、不可互相抵消**。
5. 变更 measure 集合**任何情况下不得剔除未覆盖项**。
6. BOM v1 须在无任何 trace 聚合能力的环境下可运行。

## 3. Non-goals

- **不**实现实时聚合 Dashboard（已评估否决，见 §10）。
- **不**用 Git 文本行级 diff 作为变更判定依据。
- **不**改动 tiered publish gate 的既有三级模型与 deny 语义。
- **不**在本 Spec 内实现质量候选生成（属 P0-1）。
- **不**将调用频次类指标纳入 BOM v1（属 BOM v2）。

## 4. Measure Semantic Diff

### 4.1 硬约束：禁止文本行级 diff

开发人员格式化缩进、修改注释、调整字段顺序，都**不得**触发 measure 变更判定，否则门禁被噪声淹没并最终被绕过。

### 4.2 差分算法

```ts
// ── 规范化：剥离格式噪声，仅保留业务语义 ────────────────────
function normalizeMeasure(m: RawMeasure): CanonicalMeasure {
  return {
    name: m.name,
    expr: normalizeExpr(m.expr),        // 去空白、统一大小写、折叠等价写法
    grain: sortKeys(m.grain),           // grain 顺序不影响语义
    filters: sortAndNormalize(m.filters),// filter 顺序不影响语义
    segments: sortKeys(m.segments ?? []),
  };
  // 刻意不包含：description、注释、字段书写顺序、缩进、空白
}

function measureHash(m: CanonicalMeasure): string {
  return sha256(stableStringify(m));    // stableStringify 保证键序稳定
}

// ── 差分 ────────────────────────────────────────────────
function diffMeasures(before: Measure[], after: Measure[]): MeasureDelta {
  const hBefore = new Map(before.map(m => [m.name, measureHash(normalizeMeasure(m))]));
  const hAfter  = new Map(after.map(m  => [m.name, measureHash(normalizeMeasure(m))]));

  return {
    added:   [...hAfter.keys()].filter(k => !hBefore.has(k)),
    removed: [...hBefore.keys()].filter(k => !hAfter.has(k)),
    // 仅业务语义哈希变化才计入变更 —— 纯格式调整不进此集合
    modified: [...hAfter.keys()].filter(k =>
      hBefore.has(k) && hBefore.get(k) !== hAfter.get(k)),
  };
}
```

**现有基础设施可复用（已核实）**：`server/semantic-layer.ts:3` 已引入 `yaml` 包完整 AST 能力（`parse` / `parseDocument` / `Scalar` / `YAMLMap` / `YAMLSeq`）；`server/overlay.ts:3,25` 已实现 overlay parse 路径；`server/project.ts` 有大量 `parseDocument` 用法。**不引入新依赖。**

### 4.3 manifest / overlay 分层注意

差分须针对 **overlay**（业务扩展层），而非 manifest。manifest 由 `ktx ingest` 自动生成，每次扫描可能重写，若纳入差分将产生大量假变更。依据 `docs/governance/DEVELOPMENT.md`「语义层（semantic-layer）分层」。

## 5. Core Algorithm（双覆盖率计算）

```ts
function computeBOM(delta: MeasureDelta, evalSuite: EvalCase[]): BOM {
  const changedMeasures = new Set([...delta.added, ...delta.modified]);

  // ── 覆盖侧：case → measures 映射（数据已现成）────────────
  // 来源：EvalCase.expected_measures[] 与 executable.required_measures[]
  const coveredBy = new Map<string, EvalCase[]>();   // measure → cases
  for (const c of evalSuite) {
    for (const m of c.expected_measures ?? []) coveredBy.getOrSet(m, []).push(c);
  }

  // ── 变更口径覆盖率（Targeted Coverage）─────────────────
  // 分母 = 本次变更涉及的 measure 数，固定不可剔除
  const denominator = changedMeasures.size;

  const numerator = [...changedMeasures].filter(m => {
    const cases = coveredBy.get(m) ?? [];
    // 只关联了「无断言 case」的 measure 视为未覆盖 —— 不得计入分子
    return cases.some(c => isExecutableContractComplete(c.executable));
  }).length;

  // ── 基线回归通过率（Baseline Pass Rate）─────────────────
  // 分母 = 全部存量 case 数，与上者不可互相抵消
  const baseline = {
    passed: latestRunResults.filter(r => r.status === "passed").length,
    total:  latestRunResults.length,
  };

  return {
    changed: delta,
    targeted_coverage: denominator === 0 ? null : { covered: numerator, total: denominator },
    baseline_pass_rate: baseline.total === 0 ? null
      : { passed: baseline.passed, total: baseline.total },
    gate: evaluateGate(numerator, denominator, baseline),
  };
}

function evaluateGate(n: number, d: number, b: {passed:number,total:number}): GateDecision {
  if (d === 0) return { level: "N/A", pass: true, reason: "no_measure_change" };

  // 门禁只看 Targeted Coverage —— 存量全绿不得抵消新增未覆盖
  if (n / d < TARGETED_COVERAGE_THRESHOLD) {
    return {
      level: "P0",
      pass: false,
      reason: "targeted_coverage_below_threshold",
      // 基线数据仅作附注，不参与判定
      note: `baseline_pass_rate=${b.passed}/${b.total} (informational only)`,
    };
  }
  return { level: "pass", pass: true, reason: "targeted_coverage_ok" };
}
```

### 5.1 反向利用防护（本 Spec 核心约束）

以下三条是**门禁的反向利用防线**，实现时不得弱化：

1. **分母不可剔除**：`changedMeasures` 集合在计算全程固定。任何「剔除未覆盖项」「仅统计已覆盖项」「只统计新增项」的实现都是**错误实现**——它们会让覆盖率虚高。
2. **无断言 case 不计入分子**：仅关联无 `executable` 契约的 case，其 measure 计为未覆盖。
3. **双指标不可抵消**：基线回归通过率**不参与** gate 判定，仅作附注输出。

## 6. BOM Output Format

**BOM v1（零运行时依赖）**：

```
本次发布审计摘要
  口径变更        12 项（新增 3 / 修改 6 / 下线 3）
  变更口径覆盖率   67%（3 个新增口径中 2 个有 eval case）  ← 门禁阈值判定
  基线回归通过率   85%（127/149 case）                    ← 存量健康度，仅附注
  跨域概念冲突消解  2 项（来自 P1 概念字典，未上线则显示 N/A）
  权限变更        新增 role × 1，表级授权扩大 × 2（P0 门禁已拦截 × 1）
```

**BOM v2（依赖用量反向清理，本期不实现）**：追加 `零调用口径`、`未覆盖高频口径` 两类运行时指标。

## 7. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

| English | 中文主术语 | 说明 | 禁止混淆 |
|---|---|---|---|
| Release Bill of Materials (BOM) | 发布物料清单 | 发布事件驱动的静态审计摘要 | Manifest（KTX manifest，物理表结构，二者无关） |
| Measure Semantic Diff | 指标语义差分 | AST 归一化后的业务语义比对 | Git diff / 文本差分 |
| Targeted Coverage | 变更口径覆盖率 | 分母＝本次变更 measure 数 | Baseline Pass Rate（分母不同） |
| Baseline Pass Rate | 基线回归通过率 | 分母＝全部存量 case 数 | Targeted Coverage（不可抵消） |

## 8. Acceptance Criteria

| ID | 准则 | 验证方式 |
|---|---|---|
| SC-1 | 格式变更不触发 measure 变更判定 | 构造「仅改 description / 缩进 / 字段顺序」前后对，`modified` 必须为空 |
| SC-2 | 业务语义变更必然被捕获 | 改 `expr` / `grain` / `filters` 任一 → 该 measure 必须出现在 `modified` |
| SC-3 | 分母不可剔除 | 构造「变更 3 measure，1 个只关联无断言 case」→ 必须得 **0/3**，不得为 1/2 |
| SC-4 | 无断言 case 不计入分子 | 同 SC-3；且该 measure 不得出现在 `covered` 中 |
| SC-5 | 双指标不可抵消 | 存量 149/149 全绿 + 变更口径 0 覆盖 → gate 必须 **不通过** |
| SC-6 | manifest 重生成不产生假变更 | 差分只针对 overlay；manifest 变化不得进入 delta |
| SC-7 | BOM v1 零运行时依赖 | 在无 trace 聚合表的环境下可正常产出全部 v1 指标 |
| SC-8 | 不引入新依赖 | 语义差分仅用既有 `yaml` 包 AST 能力 |

## 9. Open Questions

1. `TARGETED_COVERAGE_THRESHOLD` 的具体取值需产品裁定（建议 80%，待确认）。
2. BOM 是否需要机器可读格式（JSON）以供 CI 消费，还是仅人类可读文本即可。
3. 「跨域概念冲突消解」指标在 P1 概念字典落地前显示 N/A 还是隐藏该行。

## 10. 设计取舍记录

**为何不做实时 Dashboard**：私有化交付团队需长期维护聚合视图与查询优化；改为发布事件驱动的静态输出后，与既有 `publish history` 天然对齐，零新增运维负担，消费场景也正好落在已有 tiered publish gate 的位置。

**为何 BOM 拆 v1/v2**：v1 的四项指标均可从「发布产物 + eval 套件」静态比对得出，不依赖任何运行时 trace 聚合，因此可在 P1 用量反向清理之前独立交付；v2 追加而非重做，避免返工。