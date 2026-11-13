# P0-6 O1–O3 决策纸（建议包 S）

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-11-13 |
| 面向 | 委托人（裁定 O1–O3） |
| 对象 | 清单 **P0-6**／REQ-030-025；Spec／Plan **v0.4-draft**（本轮过程修订） |
| 性质 | **过程决策纸**。推荐整包采纳建议包 S。**不构成** R2-F、**不构成** R3、**不构成** R4。本文件**不授权改代码** |
| Spec | [lucy-20261107-eval-source-selection-correctness-spec.md](../specs/lucy-20261107-eval-source-selection-correctness-spec.md) §4 O1–O3／§4.1 |
| 过程前序 | [2026-11-09 过程推进](2026-11-09-p0-6-p0-7-p0-b-spec-advance.md)（ES-05：建议包 S 已写出、**未闭合**） |

---

## 一句话结论

请委托人**整包采纳建议包 S**（或逐条改写后书面回写）。未书面裁定前，O1–O3 仍是开工前必答；SC-05／SC-08 目录名与调用方保持未关闭。**本条仍不可闭口、不可实现。**

门禁现状（§2.2）：**不是 R2-F**（须 Codex CLI 终审或委托人明示确权）→ **不是 R3 闭合**（须本纸裁定落笔）→ **不是 R4**（须另发开发授权）→ **不可功能合同收口／不可上线**。

---

## 建议包 S（推荐整包采纳）

| 项 | 建议裁定 | 若不采纳时的替代（须书面另选） |
|---|---|---|
| **O1** 五域 domain id | slug：`pl`／`cash`／`asset`／`token`／`gpu`。中文「损益／资金／资产／Token／GPU」只作 title。客户内容根映射可空；映射为空的域只保留 `review_status: needs_review` 骨架用例 | A′：与客户用语同形的长 id（如 `损益`）——不推荐（URL／路径／跨系统易碎）；B′：复用既有 `evals/` 名（`agent_reliability` 等）——不满足五域承诺 |
| **O2** 候选表来源 | prompt 候选**只**来自用例字段 `candidate_sources`；缺失 → 空列表 → D4 中性模板。**禁止** `composeQuestion` 读在线 catalog | A′：跑批时读可见 catalog 填充候选——扩大非确定性、ACL／可见性漂移进 Eval；B′：硬编码域级候选表——与用例断言脱节 |
| **O3** 谁调用 enqueue | **服务端**在 `mapImpactToEvalDomains` 结果上调用 enqueue；客户端不得把物理表名当 domain。无映射 → **不入队**（禁止入队 `all`）。`eval_run.trigger` 必须写 `publish_smoke`（D14 已冻） | A′：仅客户端在 Publish 成功后调 enqueue——易再把表名当 domain（现状缺陷）；B′：只靠外部 cron 调同一 API、Publish 路径不入队——削弱 G8「发布后 smoke」 |

整包采纳后的合同后果（授权后才实现）：

1. 五域目录对齐 `evals/pl|cash|asset|token|gpu/...`（或等价稳定映射表，id 字符串不变）。
2. `composeQuestion` 只消费 `candidate_sources`；无字段＝空候选，永不回落 `superstore_orders`。
3. Publish 成功路径：服务端映射 → 仅对映射出的 domain enqueue；空映射静默不入队；`trigger=publish_smoke`。

---

## 请委托人勾选

- [ ] **整包采纳 S**（推荐）
- [ ] 逐条改写：O1＝____；O2＝____；O3＝____（写清替代项）
- [ ] 本轮不裁定（P0-6 继续冻结；SC-05／SC-08 保持未关闭）

裁定后须：**回写 Spec §4 O 行状态为已闭合** → 再走 **R2-F**（Codex CLI 或委托人明示确权）→ 另发 **R4** 后才可改运行代码。

---

## 本轮文档侧已处理（不代替 O 闭合）

v0.4-draft 已对齐 D13／SC-15 与仓内 `review_status`（废除虚构的 `status: executable|draft`）；证据行号 2026-11-13 复核仍成立。详见 Spec 变更记录。

**签署栏（委托人）**：________________  日期：________
