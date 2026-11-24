# P0-1 问题类型口径绑定 · Codex 对抗式评审记录

| 元数据 | 内容 |
|---|---|
| 文档类型 | 评审记录（**不是** Spec） |
| 版本 / 日期 | v0.7 / 2026-11-08 |
| 对象 | [Spec](../specs/lucy-20261107-question-type-caliber-binding-spec.md) · [Plan](../plans/lucy-20261107-question-type-caliber-binding-plan.md)（现行 **v0.9**） |
| 清单／REQ | P0-1／REQ-030-027 |
| 授权边界 | 终稿确权 ≠ O1／O2 闭合 ≠ 开发授权 |

## 总览

| 轮 | 输入稿 | 结果 |
|---|---|---|
| 1–3（主线 D／SC） | v0.2→v0.4 | Codex 均 BLOCK；达三轮上限 |
| 裁决 | — | 委托人按综合推荐 **1A–4A** → v0.5-draft |
| **定稿** | v0.5 | **委托人明示「确认定稿」（2026-11-07）→ R2-F 闭合** |
| O1／O2 R1 | v0.5 | **CONDITIONAL**；推荐 first-class `caliber_binding`＋NFKC 子串／四码点 |
| O1／O2 R2 | v0.6 | **CONDITIONAL**；补内容有效性、`activeGeneration`、唯一 `toLowerCase` |
| O1／O2 R3 | v0.7 | **O1 PASS／O2 PASS** |
| **O1／O2 闭合** | v0.8 | **委托人明示选项「1」＝全采纳闭合包（2026-11-07）→ R3 闭合** |

## 委托人裁决（1A–4A）

| # | 裁定 | Spec |
|---|---|---|
| 1 | 固化 `CanonicalSourceKey`（含 connection） | D3／D7 |
| 2 | 额外键一律 violation | D12 |
| 3 | `commitPhase` | D11 |
| 4 | begin 深拷贝快照 | D5 |

## 门禁状态

| 项 | 状态 |
|---|---|
| R2-F 终稿确权 | **已闭合** — 委托人 2026-11-07 明示「确认定稿」 |
| O1／O2（R3） | **已闭合** — 委托人 2026-11-07 明示选项「1」＝全采纳闭合包；落笔 Spec §4.1／§4.2 |
| 开发授权（R4） | **已授予** — 委托人 2026-11-08：Claude Code 实现；Cursor Agent code review |
| 实现 | **进行中**（授权范围内）；不表示可上线 |

## O1／O2 三轮对抗

| 轮 | 产物 | 要点 |
|---|---|---|
| R1 | `inbox/2026-11-07-p0-1-o1o2-codex-r1-last.txt` | 否决「存在即加载」；否决 KTX 镜像充当绑定源；否决分词首期；推荐子串＋四码点 |
| R2 | `inbox/2026-11-07-p0-1-o1o2-codex-r2-last.txt` | F-R2-01 内容核验；F-R2-02 注册表 durable commit；F-R2-03 `casefold` vs `toLowerCase` |
| R3 | `inbox/2026-11-07-p0-1-o1o2-codex-r3-last.txt` | F-R2-01…03 **全部 CLOSED**；无新 blocker／major |

### 委托人闭合包（已全采纳）

**O1**

- [x] 采纳第一类发布种类 `caliber_binding`，走既有整批同步；直接改盘不自动发布，发现差异先拒绝新 begin。
- [x] Lucy 消费权威提交快照；不加入 KTX 镜像、不读 sibling 回退，不以 KTX 成功替代绑定消费成功。
- [x] 新 begin 在任何 D11 写入前，于注册表激活互斥区内核验 generation、当前内容及解析依赖；失败返回 unresolved，旧 Session 不变。
- [x] 采纳 `activeGeneration` 持久化提交点与恢复顺序；①–③协调区间完成、未决解除后才放行新 begin；失败不得用旧注册表恢复新旅程服务。
- [x] 旧旅程保持 begin 快照＋当前 ACL；接受失败关闭造成的新 begin 暂停；SC-29／30 为后续功能验收硬项。

**O2**

- [x] 采纳 NFKC → ECMAScript `toLowerCase()` → Unicode 空白折叠 → trim；保留内部标点。
- [x] 每词规范化后至少四个 Unicode 字母／数字码点；非法词拒绝候选发布；空数组仅显式激活。
- [x] 两字段分别匹配，仅扫描 triggers；显式 id 优先，失败不回退触发匹配。
- [x] 当前 ACL 排除不可见绑定后，按 bindingId 去重计数；多绑定命中一律 ambiguous。
- [x] 接受否定、引用及英文词边界的字面子串行为，不把最小长度当作误命中保证。

### residual（不阻断 R3；R4 后验收）

- O1：现有 ACL／发布分步写入须按合同新做；由 SC-29／30 验收。
- O2：子串对否定／引用／英文词内部误命中为已知产品边界。

原始 Codex：`inbox/2026-11-07-p0-1-codex-r{1,2,3}-last.txt`（主线）；`inbox/2026-11-07-p0-1-o1o2-codex-r{1,2,3}-last.txt`（O1／O2）。
