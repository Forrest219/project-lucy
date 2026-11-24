# P0-3 表级歧义门闩 · Codex 对抗式评审记录

| 元数据 | 内容 |
|---|---|
| 文档类型 | 评审记录（**不是** Spec） |
| 版本 / 日期 | v0.4 / 2026-11-08 |
| 对象 | [Spec](../specs/lucy-20261107-source-ambiguity-gate-spec.md) · [Plan](../plans/lucy-20261107-source-ambiguity-gate-plan.md)（现行 **v0.5-draft**） |
| 清单／REQ | P0-3／REQ-030-024 |
| 授权边界 | **过程对抗 ≠ 终稿确权 ≠ 开发授权** |

## 总览

| 轮 | 输入稿 | 结果 | 原始产物 |
|---|---|---|---|
| R1 | v0.2-draft | **BLOCK**（blocker 2，major 7，minor 2） | `inbox/2026-11-08-p0-3-codex-r1-last.txt` |
| 修订 | → **v0.3-draft** | F-01…F-11 triage 已落 | Spec／Plan 变更行 |
| R2 | v0.3-draft | **BLOCK**（blocker 1，major 6；R1 六项全闭、五项部分） | `inbox/2026-11-08-p0-3-codex-r2-last.txt` |
| 修订 | → **v0.4-draft** | F-R2-01…F-R2-07 设计合同首轮回写 | Spec／Plan 变更行 |
| R3 | v0.4-draft | **BLOCK**（blocker 0，major 4；F-R2-01／02／07 已闭合，03–06 部分） | `inbox/2026-11-08-p0-3-codex-r3-last.txt` |
| 修订 | → **v0.5-draft** | F-R2-03…06 设计合同回写（[architect](3e88c530-cfae-4464-869e-d9922cb57ef5)） | Spec／Plan 变更行 |
| R3b | v0.5-draft | **PASS**（R3 四 major 设计合同闭合；0 blocker／0 major） | `inbox/2026-11-08-p0-3-codex-r3b-last.txt` |
| R2-F | **已闭合** | 委托人明示确权（2026-11-08） | — |
| O 项闭合 | **已闭合** | O1＝`confirmedSourceKey`；O2＝否；O4＝8 | Spec §4 |
| R4 | **已授予** | Cursor coder 实现；Cursor reviewer CR（2026-11-08） | — |

## 门禁状态

| 项 | 状态 |
|---|---|
| R1 形态／事实性（批次） | 已有第 1 轮记录；本条另经 Codex R1 |
| R1–R3／R3b 过程对抗 | **可收束**；R3b=**PASS** |
| R2-F 终稿确权 | **已闭合（2026-11-08）**：委托人明示确权 |
| R3 O 项闭合 | **已闭合**：O1＝旅程字段 `confirmedSourceKey`；O2＝否（read_source 不纳入）；O4＝8 |
| R4 开发授权 | **已授予（2026-11-08）**：Cursor coder 实现；Cursor reviewer CR |

## R1 要点与修订闭合

见 `inbox/2026-11-08-p0-3-codex-r1-last.txt`。v0.3-draft 闭合摘要：

| ID | 级别 | 修订闭合（v0.3-draft） |
|---|---|---|
| F-01 | blocker | D10／§4.3 无 begin 分态 fail-closed；SC-15 |
| F-02 | blocker | §5 展示名与 Source Identity 分离；SC-16 |
| F-03 | major | O1／O2 无默认执行；伪代码确认载体互斥；§7.1 |
| F-04 | major | §4.1 确定性命中算法与失败分支；SC-20／SC-24 |
| F-05 | major | D11／§4.4 确认主体与失效；SC-17 |
| F-06 | major | D14 repair 五项证据；SC-18 |
| F-07 | major | §4.2 BindingSession 四态；SC-10 |
| F-08 | major | §6.1 插入点；SC-04／19／23 |
| F-09 | major | D12 对齐 P0-2 `description`；SC-12 |
| F-10 | minor | D13 事实源与四路径；SC-01／02／22 |
| F-11 | minor | Plan／Spec 门禁链 R1→R2→R2-F→R3→R4 |

## R2 要点与修订闭合（v0.4-draft）

见 `inbox/2026-11-08-p0-3-codex-r2-last.txt`。

| ID | 级别 | 修订闭合（v0.4-draft） | R3 再审 |
|---|---|---|---|
| F-R2-01 | blocker | §4.3 互斥优先级；SC-15 | **已闭合** |
| F-R2-02 | major | §4.1 CJK n-gram；SC-20 | **已闭合** |
| F-R2-03 | major | §4.4 可核验确认／generation 快照 | **R3 判部分** → v0.5 再闭 |
| F-R2-04 | major | §4.5 全量 collectCanonicalSourceKeys | **R3 判部分** → v0.5 再闭 |
| F-R2-05 | major | §4.7／D14 五项装配 | **R3 判部分** → v0.5 再闭 |
| F-R2-06 | major | §4.6 描述健康态；SC-25 | **R3 判部分** → v0.5 再闭 |
| F-R2-07 | major | D15 对象级安全边界；SC-13／26 | **已闭合** |

## R3 要点与修订闭合（v0.5-draft）

见 `inbox/2026-11-08-p0-3-codex-r3-last.txt`。结论：**BLOCK**（blocker 0，major 4）。

| ID | 级别 | 修订闭合（v0.5-draft） |
|---|---|---|
| F-R2-03 | major | §4.4 拆 **载体（O1）** 与 **宿主 attested 用户参与证据**；定义 `UserParticipationEvidence` 与 Proxy 核验路径；禁止 Agent 自述／Agent 可写提交记录／拒绝 nonce 回传冒充确认；SC-17 扩反例 |
| F-R2-04 | major | §4.5 授权 **修订 `acl.collect*`**；未知 filter／order_by 保留进 `unresolved` 并 deny；SC-16 固定 `ghost.amount`；Plan 改「复用并修订」共享采集器 |
| F-R2-05 | major | §4.7／D14：五项失败对象不得进 `availableCandidates`／「可用候选」文案；与 `usableTargets` 一致；全体失败时两者皆 `[]`；SC-18 |
| F-R2-06 | major | 移除 Plan 对 SC-25／26 接线状态 skip；Spec／Plan 统一必验出口；P0-2 未接线用同构直读夹具 |

O1／O2 保持互斥待决；伪代码 `PENDING_CARRIER`，不得默认选边。O 项未裁定**不单独构成 BLOCK**。

**本记录不构成终稿确权或开发授权。** 以上关闭针对 Spec／Plan 修订；不建议在未获 R4 前修改运行代码。对 v0.5-draft 再审清零后方可评估是否接近 **R2-F** 候选。
