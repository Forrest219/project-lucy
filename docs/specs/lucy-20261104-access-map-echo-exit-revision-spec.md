# 访问关系图口径对齐 — 收口前出口修订 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能设计基线 / **v0.1** |
| 日期 / 目标版本 | 2026-11-04 / 不绑定产品版本号。不进入 v0.25 登记册 |
| 功能编号 / 优先级 | **无** / **P1**（主 Spec 收口前出口修订） |
| 状态 | **v0.1 功能合同已收口（2026-11-04）**。SC-14 逐边断言在仓；SC-12 页序子句已拆出；主 Spec 已按另行批准收口。本条收口不表示可上线 |
| 决策来源 | 2026-11-04 对主 Spec 实施笔记已知缺口的取舍：SC-14 逐边 `I(e)` 支撑 E 对账承诺，须保留在出口并有自动化；SC-12「先开关系图／先开审计页」页序属低性价比集成场景，从主 Spec 出口拆出。用户批准落盘本 Spec／Plan 并交付开发 |
| 需求来源 | 主 Spec [`lucy-20261102-access-map-audit-echo-spec.md`](lucy-20261102-access-map-audit-echo-spec.md) 收口前须出口诚实：能打假的留下，性价比低的拆出并标明 |
| 实施主体 | Lucy：主 Spec 验收矩阵修订、服务端逐边断言、索引与实施笔记。不修改 KTX |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」 |
| 与既有 Spec 的关系 | **修订**主 Spec 的验收出口归属，不改 D1–D13 产品语义、不改集合 E 算法。主 Spec 路径／trust／inquiryKind／accessGrade 合同不变 |
| 实施计划 | [`docs/plans/lucy-20261104-access-map-echo-exit-revision-plan.md`](../plans/lucy-20261104-access-map-echo-exit-revision-plan.md) |

## 闭口层级

- 层级：功能合同
- 本条承诺：主 Spec 收口前，SC-14 逐边 `accessCalls(e)=\|I(e)\|` 有本机自动化打假；SC-12 中「先开关系图／先开审计页」页序子句从主 Spec 出口拆出，主 Spec 仍保留关联五态与重建失败 → unavailable。
- 本条出口：SC-01–SC-06。
- 不在本条出口：主 Spec 全量重跑以外的浏览器／Playwright／镜像／部署／客户环境；主 Spec 的 C 类功能合同收口签字（须用户另行批准）。
- 上线关系：本条收口不表示可上线；亦不自动构成主 Spec 已收口

---

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- None. 沿用主 Spec 与术语标准 §4.8「关联口径」。

Forbidden:

- 借拆出页序子句削弱 SC-12 关联五态或重建失败 → unavailable。
- 用 Σ `accessCalls` 冒充 `\|E\|` 或省略逐边 `accessCalls(e)=\|I(e)\|` 断言仍声称 SC-14 关闭。

---

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/30-pr-compliance-template.md`

### What This Change Follows

- [ ] 本条无 UI 改动；不新增控件族或色值

### Exceptions (If Any)

- None. 纯验收出口与测试证据修订。

### Follow-up Needed

- None

---

## 伪代码豁免

本条只修订验收出口归属与证据要求，**不改变**主 Spec §6 `buildBandED`／路径构建控制流。豁免「核心流程（伪代码）」；算法仍以主 Spec §6 为准。

---

## 1. 背景

主 Spec S1–S3 已落地。实施笔记曾登记两处收口前缺口：SC-12 页序、SC-14 逐边。2026-11-04 拍板：

1. **补** SC-14 逐边（对账承诺的核心打假）。
2. **拆出** SC-12「页序」子句（生产两边已共用 `rebuildInferredTurns`；五态 + unavailable 已盖主风险）。

仓内若已存在页序夹具，可作过程证据保留，**不**再作为主 Spec 收口阻塞项。

## 2. 目标

1. 主 Spec §7 SC-14 含逐边 `accessCalls(e)=\|I(e)\|` 的自动化证据（预写期望或内部 `accessCallIds` 对照）。
2. 主 Spec §7 SC-12 正文与出口：页序子句标记 **拆出**；关联五态 + 重建失败 → unavailable **留下**。
3. 出口修订落地时，主 Spec 先保持未收口。2026-11-04 用户批准 C 类闭口后，主 Spec 头部改为功能合同已收口。过渡态「功能合同未收口」已作废，不得当作现值。

## 3. 非目标

| 不做 | 原因 |
|---|---|
| 改 D1–D13 或集合 E 算法 | 本条只改出口 |
| 删除已有页序测试文件 | 可留作过程证据 |
| 主 Spec C 类收口签字 | 须用户另行批准 |
| 浏览器／镜像／部署 | 不在出口 |

## 4. 已冻结决策

| ID | 决策 | 取舍 |
|---|---|---|
| D1 | SC-14 逐边留在主 Spec 出口，必须有自动化 | 拒绝只比数量 |
| D2 | SC-12 页序子句从主 Spec 出口拆出 | 五态 + unavailable 留下 |
| D3 | 主 Spec 在本条出口修订落地前不得登记「功能合同已收口」 | 2026-11-04 出口修订落地后，用户批准 C 类收口，该约束已完成 |
| D4 | 页序夹具若已存在，降为过程证据，不阻塞、不要求删 | |

## 5. 对主 Spec 的修订要点

### 5.1 SC-12（主 Spec）

留下：显式／仅推断／二者同时（显式优先）／悬空显式键／无关联；management 下无关联不进 E；all 下可进；重建失败 → unavailable。

**拆出：**「覆盖先开关系图／先开审计页顺序下重建准备后结果一致」。

### 5.2 SC-14（主 Spec）

完整留下，且证据必须包含：对返回的每条访问边，`accessCalls(e)` 等于该边内部调用 id 集合大小；禁止仅用 Σ `accessCalls` 与 `\|E\|` 的偶然相等冒充通过。

## 6. 验收矩阵

| ID | 断言 | 证据 |
|---|---|---|
| SC-01 | 主 Spec §7 SC-14 行仍要求逐边 `accessCalls(e)=\|I(e)\|` | 主 Spec 正文 |
| SC-02 | `p1-access-map.test.ts`（或等价）有断言：序列化边 `accessCalls` 与内部 `accessCallIds.size` 逐边相等；夹具含同路径多调用 | 服务端测试 |
| SC-03 | 同一夹具证明不得用 Σ `accessCalls` 冒充 `enteringAllowCallCount`／`\|E\|` | 服务端测试 |
| SC-04 | 主 Spec §7 SC-12 行已去掉页序子句或标明 **拆出**；五态 + unavailable 仍在 | 主 Spec 正文 |
| SC-05 | 主 Spec 头部「状态」为功能合同已收口（2026-11-04 批准 C 类闭口之后）。收口前须保持未收口的过渡约束已完成 | 主 Spec + 索引镜像 |
| SC-06 | `docs/README.md`／`docs/plans/README.md`／本条 Plan 与主 Spec 状态镜像一致 | 索引 |

## 7. 风险

| 风险 | 缓解 |
|---|---|
| 拆出页序被误读为取消关联合同 | SC-04 强制留下五态文案 |
| 逐边只测条数不测集合 | SC-02 要求对照 `accessCallIds` |

---

**定稿条件：** 用户 2026-11-04 批准交付开发。定稿不表示主 Spec 已收口，也不表示可上线。
