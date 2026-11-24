# P0-2 Catalog 业务语义暴露 · Codex 对抗式评审记录

| 元数据 | 内容 |
|---|---|
| 文档类型 | 评审记录（**不是** Spec） |
| 版本 / 日期 | v0.6 / 2026-11-08 |
| 对象 | [Spec](../specs/lucy-20261107-catalog-business-semantics-spec.md) · [Plan](../plans/lucy-20261107-catalog-business-semantics-plan.md)（现行 **v0.6-draft**） |
| 清单／REQ | P0-2／REQ-030-023 |
| 授权边界 | **过程对抗 ≠ 终稿确权 ≠ 开发授权** |

## 总览

| 轮 | 输入稿 | 结果 | 原始产物 |
|---|---|---|---|
| R1 | v0.2-draft | **BLOCK**（blocker 1，major 5，minor 3） | `inbox/2026-11-08-p0-2-codex-r1-last.txt` |
| 修订 | → v0.3-draft | F-01…F-09 triage 已落 Spec／Plan | Spec／Plan 变更行 |
| R2 | v0.3-draft | **CONDITIONAL**（blocker 0，major 1，minor 1；R1 七项全闭、两项部分） | `inbox/2026-11-08-p0-2-codex-r2-last.txt` |
| 修订 | → v0.4-draft | F-R2-01／F-R2-02 已修订（D10＋SC-16；D4a 边界＋SC-06）；**F-R2-01 后经 R3 判定仍有残留** | Spec／Plan v0.4-draft 变更行 |
| R3 | v0.4-draft | **CONDITIONAL**（blocker 0，major 1，minor 0；F-R2-02 已闭；F-R2-01 **部分闭合**） | `inbox/2026-11-08-p0-2-codex-r3-last.txt` |
| 修订 | → v0.5-draft | F-R2-01 残留修订（overlay 后读 manifest 盖戳＋SC-17）；后经 **R3b** 判定仍不足 | Spec／Plan v0.5-draft 变更行 |
| R3b | v0.5-draft | **CONDITIONAL**（blocker 0，major 1，minor 0；F-R2-01 时序变体：新 overlay 先于新 manifest 落盘仍可错挂 `G_new`） | `inbox/2026-11-08-p0-2-codex-r3b-last.txt` |
| 修订 | → **v0.6-draft** | F-R2-01 时序变体修订（[architect](0926746e-9d91-4adf-9c9e-489b1a416a23)：可信绑定依据；禁止仅复读 manifest；SC-17 扩充） | Spec／Plan v0.6-draft 变更行 |
| R3c | v0.6-draft | **PASS**（blocker 0，major 0，minor 0，low 0；R3b 残留设计层已闭；新发现无） | `inbox/2026-11-08-p0-2-codex-r3c-last.txt` |

## 门禁状态

| 项 | 状态 |
|---|---|
| R1／R2／R3／R3b／R3c 过程对抗 | **多轮过程对抗已跑完**。**R3c＝PASS**；v0.6 可信绑定依据已关掉 R3b 时序反例 |
| R2-F 终稿确权 | **已闭合（2026-11-08）**：委托人明示确权 |
| R3 O 项闭合 | **已闭合**：O1＝否；O2＝否；O3＝8192 |
| R4 开发授权 | **已授予（2026-11-08）**：Cursor coder 实现；Cursor reviewer CR |

## R1 要点

见 `inbox/2026-11-08-p0-2-codex-r1-last.txt`。v0.3-draft 已 triage F-01…F-09。

## R2 残留 → v0.4 修订

| Finding | 级别 | v0.4 处置 |
|---|---|---|
| **F-R2-01** | major | Spec 增 **D10** 绑定一致性（规范化物理表；必要时内容根／版本）；§6.1／伪代码／失败分支／风险同步；**SC-16**「取得最终集合后同键改绑再读」；Plan S0／S1／S2／验收贯通 |
| **F-R2-02** | minor | Spec **D4a** 统一「读取／索引／装配／返回」保证边界；**SC-06** 改用隔离夹具专属标记，禁止因合法原文提及受限名误判；Plan S3 对齐 |

## R3 结论 → v0.5 修订

R3 全文：`inbox/2026-11-08-p0-2-codex-r3-last.txt`。结论 **CONDITIONAL**（blocker 0，major 1）。

| Finding | 级别 | R3 判定 | v0.5 处置 |
|---|---|---|---|
| **F-R2-02** | （原 minor） | **已闭合** | 保持 v0.4；无需再改 |
| **F-R2-01** | major（部分闭合） | manifest 描述路径已闭；**残留**：绑定校验不覆盖独立读取的 overlay grain；两次读取之间同键改绑可将新 grain 挂到旧 table | Spec **D10（2）**＋§6.1 overlay 确认协议（overlay 内容已读后观察同键 manifest，盖 `boundPhysicalTable`）；伪代码增 `overlayBindingsMatch`／`loadOverlayEntry`；失败分支「Overlay 无法确认」；**SC-17** 专属 grain 标记夹具；Plan S0／S1／S2／验收扩至 SC-17 |

## R3b 结论 → v0.6 修订

R3b 全文：`inbox/2026-11-08-p0-2-codex-r3b-last.txt`。结论 **CONDITIONAL**（blocker 0，major 1，minor 0，low 0）。

| Finding | 级别 | R3b 判定 | v0.6 处置 |
|---|---|---|---|
| **F-R2-01（时序变体）** | major | v0.5 后读 manifest 盖戳仍不足：新 overlay（含 `G_new`）已落盘、新 manifest 未落盘时，后读仍得 `T_old`，确认戳／旧 manifest／目录三者相等 → **`G_new` 挂到旧 table**。SC-17 未覆盖该发布中间态 | Spec **D10（2）／§6.1**：`boundPhysicalTable` 须来自所读 overlay 的**可信绑定依据**（A overlay 自带 `table`／B 同发布世代共绑／C 与已 pin 目录条目同源世代快照）；**禁止**仅复读／后读同键 manifest 表值当作确认；无法证明归属 → **不写 grain**。伪代码改 `loadOverlayEntry`（路径 A 示意）。**SC-17** 扩充「新 overlay 已落盘、新 manifest 未落盘」断言旧目录不得出现 `G_new`，并保留正常绑定对照。Plan S0／S1／验收／风险同步 |

本轮**不**构成终稿确权或开发授权。O1／O2／O3 保持开放。**冻结落地。** **建议再核验一轮后再谈 R2-F。**

## R3c 结论

R3c 全文：`inbox/2026-11-08-p0-2-codex-r3c-last.txt`。结论 **PASS**（blocker 0，major 0，minor 0，low 0）。

| 项 | 判定 |
|---|---|
| R3b 残留（F-R2-01 时序变体） | **设计层已闭合**：可信绑定依据 A／B／C；禁止仅复读 manifest；装配三者对齐；SC-17 覆盖中间态＋对照 |
| 新发现 | **无** |
| R2-F 前必关 | **本轮范围内无** |

具备 **R2-F 候选**条件；**不构成终稿确权或开发授权**。O1／O2／O3 仍须在开发授权前裁定。**冻结落地。**
