# P0-A Source 级字段暴露裁剪 · Codex 对抗式评审记录

| 元数据 | 内容 |
|---|---|
| 文档类型 | 评审记录（**不是** Spec） |
| 版本 / 日期 | **v0.7-draft** / 2026-11-08 |
| 对象 | [Spec](../specs/lucy-20261107-semantic-source-field-exposure-spec.md) · [Plan](../plans/lucy-20261107-semantic-source-field-exposure-plan.md)（现行 **v0.7-draft**） |
| 清单／REQ | P0-A／REQ-030-012 |
| 授权边界 | **过程对抗 ≠ 终稿确权 ≠ 开发授权** |

## 总览

| 轮 | 输入稿 | 结果 | 原始产物 |
|---|---|---|---|
| R1 | v0.2-draft | **BLOCK**（blocker 2，major 7） | `inbox/2026-11-08-p0-a-codex-r1-last.txt` |
| 修订 | → v0.3-draft | F-01…F-09 triage（[architect](50aa1426-0205-4f72-a52f-a3a15906dd28)） | Spec／Plan 变更行 |
| R2 | v0.3-draft | **BLOCK**（blocker 1，major 3） | `inbox/2026-11-08-p0-a-codex-r2-last.txt` |
| 修订 | → v0.4-draft | 声称闭合 F-R2-01…04（[architect](6d0e61f1-81b8-4bee-b264-012a783768c5)） | — |
| R3 | v0.4-draft | **BLOCK**：变更行写了 D23–D26／SC-25–30，**正文未贯通**；Plan 头部仍 v0.3／v0.4 漂移 | `inbox/2026-11-08-p0-a-codex-r3-last.txt` |
| 修订 | → v0.5-draft | 正文实写 D23–D26／§3.1c／SC-25–30；Plan 头部对齐（[architect](e9fac6e1-9fe3-403b-9481-7f2528955f8f)） | Spec／Plan |
| R3b | v0.5-draft | **BLOCK**（blocker 1＝F-R2-01 部分闭合；major 1＝F-R2-04 部分闭合；F-R2-02／03 已闭） | `inbox/2026-11-08-p0-a-codex-r3b-last.txt` |
| 修订 | → **v0.6-draft** | 闭合 F-R2-01／F-R2-04 残留；版本对齐（[architect](eb74bf6e-3c9a-45b1-9d10-8f2b269f97d1)） | Spec／Plan／本评审 |
| R3c | v0.6-draft | **CONDITIONAL**（F-R2-01 闭；F-R2-04 部分闭，major 1＝空抽取放行） | `inbox/2026-11-08-p0-a-codex-r3c-last.txt` |
| 修订 | → **v0.7-draft** | 闭合 F-R2-04 空作用域残留（EMPTY→`INSTANCE_WIDE`；SC-30／S3c）（[architect](f35b659a-cf34-4891-b3b7-7a424626ae96)） | Spec／Plan／本评审 |
| R3d | v0.7-draft | **PASS**（R3c 残留闭；blocker／major 0；minor 1＝ACL 身份措辞，已校正为 ∧） | `inbox/2026-11-08-p0-a-codex-r3d-last.txt` |
| R2-F | （待） | **具备候选条件，终稿未确权** | — |
| R4 | （待） | **未授予开发授权** | — |

## 门禁状态

| 项 | 状态 |
|---|---|
| R1–R3d 过程对抗 | 已跑；**R3d＝PASS** |
| R2-F 终稿确权 | **已闭合（2026-11-08）**：委托人明示确权 |
| R4 开发授权 | **已授予（2026-11-08）**：Cursor coder 实现；Cursor reviewer CR |

## R3b 要点与 v0.6 闭合（保留）

见 `inbox/2026-11-08-p0-a-codex-r3b-last.txt`。

| Finding | R3b 判定 | v0.6-draft 闭合动作 |
|---|---|---|
| F-R2-02 | 已闭 | 不回退 |
| F-R2-03 | 已闭 | 不回退 |
| F-R2-01 | blocker 残留：仅 Proxy 快照一致，未绑实际上游 KTX 执行 | D23／§3.1b／§3.1c／S2b／SC-25／SC-26：`upstreamExecutionGenerationId`；Strat-A 隔离或 Strat-B STOP→DRAIN→回滚；索引成功＋激活失败硬禁令；验收观察实际消费定义 |
| F-R2-04 | major 残留：四工具嵌在 tableTouching；`dictionary_search`／`discover_data` 漏路径；`scope.unavailable` 未定义 | D26／§3.3／S3c／SC-30：路径 A／B 分接必经钩子；`resolvePassthroughScope`；逐工具零上游＋未裁剪对照＋插入点锁 |
| 版本漂移 | Spec／Plan 标 v0.4、评审标 v0.5 | 三者统一 **v0.6-draft** |

## R3c 结论与 v0.7 闭合

R3c 全文：`inbox/2026-11-08-p0-a-codex-r3c-last.txt`。结论 **CONDITIONAL**（blocker 0，major 1；F-R2-01 设计层已闭；F-R2-04 部分闭）。

| Finding | R3c 判定 | v0.7-draft 闭合动作 |
|---|---|---|
| F-R2-01 | **设计层闭合** | 保持；**不回退** |
| F-R2-02／03 | 过程已闭 | **不回退** |
| F-R2-04 | **部分闭合**→本版修订残留：`entity_details`／`sl_validate` 无 Source／空抽取时 `involved=[]` → `touchesTrimmed=false` 直接放行；ACL 通配／全敏感表显式授权可越过空表拒绝 | D26／§3.3 `resolvePassthroughScope`：空抽取归 `INSTANCE_WIDE`；实例有 trimmed／期望故障则拒；禁止空循环放行；SC-30 补「已通过 ACL＋空作用域」逐工具零上游＋无 trimmed／故障兼容对照；Plan S3c／前置第 5 项同步 |
| 版本漂移 | — | Spec／Plan／评审统一 **v0.7-draft** |

**本轮不宣称**：R2-F 终稿确权、R4 开发授权、实现已完成。

## 空作用域裁决摘要（v0.7）

- **裁决**：`entity_details`／`sl_validate` 无 Source 或抽取结果为空 → **`INSTANCE_WIDE`**（与敏感 Meta 同保守语义）。
- **拒绝条件**：该路径下实例存在任一 `trimmed` Source 或期望集合故障 → `field_exposure_unavailable`、零上游。
- **兼容对照**：实例无 trimmed／无期望故障时，空抽取不因本条新增拒绝。
- **硬禁令**：不得让 `involved=[]` 落入逐源空循环得 `touchesTrimmed=false` 放行；不得依赖 ACL 空表拒绝堵洞。
- **ACL 夹具身份（R3d minor 校正）**：有效越过空表拒绝需 **通配 ∧ 全敏感表显式授权 ∧ 其余准入**（不是「或」）。

## R3d 结论

R3d 全文：`inbox/2026-11-08-p0-a-codex-r3d-last.txt`。结论 **PASS**（blocker 0，major 0；minor 1 已校正）。

| 项 | 判定 |
|---|---|
| R3c 空作用域残留 | **设计层已闭合** |
| F-R2-01／02／03／必经路径 | **未回退** |
| minor（ACL「或」措辞） | **已校正为 ∧**（D26／伪代码／SC-30／Plan／本评审） |

具备 **R2-F 候选**条件；**≠ 终稿确权或开发授权**。**冻结落地。**
