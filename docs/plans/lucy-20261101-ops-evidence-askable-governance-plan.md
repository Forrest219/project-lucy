# 运维问数可问治理面 Implementation Plan

> 定稿已批准；开发已授权。按本 Plan 落地；收口 ≠ 上线。

| 元数据 | 内容 |
|---|---|
| 文档版本 / 日期 | **v0.9.2** / 2026-11-02（功能合同收口） |
| 优先级 | P0＝W1；P1＝W2；P2 不实施。功能编号无 |
| 主 Spec | [Spec v0.9.2](../specs/lucy-20261101-ops-evidence-askable-governance-spec.md) |
| 状态 | **功能合同收口（2026-11-02）**。部署项已拆出。收口 ≠ 上线 |
| 授权边界 | 可改运行代码／语义／Skill／Wiki／测试／文档；不 commit、不出客户包（除非另授） |
| 验收 | Spec v0.9.2 出口：SC-01–SC-18、SC-20–SC-24（SC-17d／17f／19 已拆出） |
| 审阅 | [Codex 审阅](../reviews/2026-11-01-codex-review-ops-evidence-askable-governance.md)；[收口](../reviews/2026-11-02-ops-evidence-askable-governance-closure.md) |

**Goal:** 可问治理面落地合同可定稿；实现时复用 access-map builder、修正 Token 归因键、旧源与治理源查询分支分离。

**Architecture:** D13／D25–D28 物化快照；D23＝E 问数侧 `(agent,label)`（不改图）；D22 运营显式扩 Role；图≠论述。

## Global Constraints

- 旧两视图不走 snapshot 过滤（SC-01）
- 禁止伪 0；禁止第二套路径算法
- ensure 不写 access.yaml
- 收口 ≠ 上线

## 1. 目标

冻结合同经第 3 轮可定稿；W1／W2／Skill；SC-01–SC-22。

## 2. 开工前置

| ID | 条件 | 状态 |
|---|---|---|
| P1 | 索引登记 | 满足 |
| P2 | 文档定稿 + Codex 复审小修 | **满足**（v0.9.1） |
| P3 | 术语登记 | **满足**（术语标准 §4.7.3） |
| P4 | 用户授开发 | **满足（2026-11-01）** |

## 3. 实施落点（预告）

- `ops-evidence/**`、`audit.ts` 禁列扩展
- 问数侧 `ops_tokens` 按 `(agent_id, token_label)` 聚合（**不**改 access-map 图凭证 GROUP BY；D23＝E）
- 语义／Skill／Wiki／role-templates／demo access
- 对账与并发／半份发布／日历窗边界测试
- Spec 149 交叉引用；术语标准

## 4. 阶段

### S0 定稿

- [x] 第 3／4 轮 Codex；v0.9.1 定稿小修
- [x] 术语登记（§4.7.3）；Spec 149 交叉修订；落盘清单记在收口审阅
- [x] 用户批准定稿并授开发（2026-11-01）

### S1 W1

- [x] 快照框架骨架 D25–D27；旧／新查询分支；gov 剥离（SC-18／20／21 见 s2 与收口测试）
- [x] agents／tokens／activity／kpi 表＋语义；SC-03–07／05b／10b／16／24 见 s1 与收口测试
- [x] enabled_tables union＋模板全源；SC-17a／b／c（ensure 不改 Role）；SC-17d／17f 于 v0.9.2 拆出本条出口
- [x] Skill／Wiki Q1–Q6 路由（SC-13–15／22 见收口测试）

### S2 W2 可问治理结构＋Token（E）

- [x] `ops_tokens` Agent 归因；SC-10／10b／10c（不对齐图）— S1 已落地 D23＝E；本阶段不对账图
- [x] paths／edges／nodes／meta（复用 builder）；SC-08＊／09／08i

### S3 表采用

- [x] Q5 近窗未访问（授权面 anti-join）；SC-11
- [x] Q6；SC-12

### S4 收口

- [x] 本条出口 SC 证据（SC-17d／17f／19 按 Spec v0.9.2 拆出）
- [x] 四门禁与落盘清单记在收口审阅，不再当作产品 SC

## 5. 验收

Spec §9；Q5 不得答成「从未／上线满 30 天从未」。

## 6. 完成定义

功能合同出口的 SC 有本机自动化证据；部署与客户环境已拆出；未宣称可上线。

## 7. 风险

| 风险 | 缓解 |
|---|---|
| 图与问数 Token 数字不一致 | D23＝E 预期行为；Wiki 披露；SC-10c |

| 旧 Role 未扩权 | D22／SC-17c–d／Wiki |
| 快照串读 | D25／SC-20 |

## 8. 背景备忘

图静态／论述动态不必对等；六问为样例；行级／原文 P2。

## 9. 审阅对照

### 第 2 轮 → v0.3

| 项 | 处理 |
|---|---|
| R01 | D25–D27、§4.1、SC-20–22 |
| R03 | §5.4＋raw／denied／confirmedUnauthorized／D28 |
| R05 | D17 历史完整；deferred_history；SC-11 |
| R08 | D22 运营显式扩权；SC-17a–e |
| R09 | 后被 PM 定夺 E 覆盖：问数归因、不改图；见 v0.7 |
| N01 | 旧源分支；SC-01 |
| N02 | 六问原文（决策全文仍在第 3 轮补齐） |

### 第 3 轮 → v0.4（最小定稿补丁）

| 项 | 处理 |
|---|---|
| N02 | §3 决策全文展开；D16／D18／D19 正文；SC-07／12 可判 |
| R01-a | §4.1 `gov.*` 剥离顺序 + 四则真实 `lucy_query` JSON；SC-22／23 |
| R01-b | D25／D26 区分 `query_key` 与 `materialization_id`；SC-20b |
