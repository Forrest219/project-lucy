# Lucy Catalog 业务语义暴露 实施 Plan

| 元数据 | 内容 |
|---|---|
| 文档类型 | 实施计划（Plan） |
| 版本 / 日期 | **v0.6** / 2026-11-07（授权 2026-11-08） |
| 状态 | **v0.6；终稿已确权；O1／O2／O3 已闭合；R4 已授予（2026-11-08）；功能合同已收口（2026-11-13）；实现 CR 已落盘（PASS，2026-11-13）**（SC-01–SC-17；见 [证据审计](../reviews/2026-11-13-catalog-business-semantics-sc-evidence-audit.md)）。不表示可上线 |
| 授权边界 | R2-F＋R3＋R4 已闭合。授权实现本 Plan Task；不表示可上线。 |
| 验收 | Spec SC-01–SC-17 逐条有证据；`npm run lint:spec-docs` 退出 0；相关 vitest 全绿；D4a 装配隔离与 D10 绑定一致性（含 overlay **可信绑定依据**）断言通过。**不构成发布取证，不表示可上线** |
| 目标分支 / 产品线 | `lucy-v0.30` / `0.30.0` |
| 需求来源 | 清单 P0-2；需求池 REQ-030-023 |
| Spec | [lucy-20261107-catalog-business-semantics-spec.md](../specs/lucy-20261107-catalog-business-semantics-spec.md)（**v0.6-draft**） |
| 评审记录 | [Codex 对抗评审记录](../reviews/2026-11-08-catalog-business-semantics-codex-review.md)（过程；**不构成终稿确权**）；[实现 CR](../reviews/2026-11-13-p0-2-catalog-business-semantics-code-review.md)（Wave A；**不表示可上线**） |
| 与既有 Spec 的关系 | 串联 REQ-030-027／P0-1（口径轴）、REQ-030-024／P0-3（表级门闩）；**不冲突** REQ-030-012／P0-A（列级裁剪）——本条**不返回任何列**；若日后要在 catalog 返回列预览，须先复用 012 的暴露集读取器，不得另起裁剪口径 |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md) 落盘清单与 Plan Mode |

## 变更记录

| 版本 | 说明 |
|---|---|
| v0.2-draft | 批次 R1 后与 Spec v0.2 对齐 |
| v0.3-draft | Codex R1 triage 修订：F-01…F-09（见该版变更行） |
| v0.4-draft | Codex R2 CONDITIONAL 修订：**F-R2-01** 绑定一致性（D10）贯通 S0／S1／S2、SC-16 同键改绑夹具；**F-R2-02** D4a 读取／索引／装配／返回边界与 SC-06 专属标记；引用 Spec **v0.4-draft**；验收扩至 SC-16 |
| v0.5-draft | Codex R3 CONDITIONAL 修订（部分闭合 F-R2-01）：overlay 确认协议／`boundPhysicalTable`／SC-17 初版；引用 Spec v0.5-draft。后经 **R3b** 判定仅后读 manifest 仍不足 |
| **v0.6-draft** | **Codex R3b CONDITIONAL 修订（闭合 F-R2-01 时序变体）**：overlay **可信绑定依据**（自带 `table`／同发布世代／同源世代快照）；**禁止**仅复读 manifest 盖戳；无法证明归属不写 grain；SC-17 扩充「新 overlay 已落盘、新 manifest 未落盘」＋正常绑定对照；贯通 S0／S1／S2；引用 Spec **v0.6-draft**。**不宣称终稿确权；冻结落地；未授权实现** |

## 1. 目标

把语义层**已存在**但从未被暴露的表级业务描述与 overlay **grain**，装配进 MCP 目录响应，使 Agent 选表时不再只能靠表名字符串相似度猜测；同时守住「不装配不可见 source 的描述资产进响应（D4a）」、「目录条目与资产物理表绑定一致，且独立读取的 overlay grain 须凭**可信绑定依据**证明归属、禁止仅复读 manifest（D10）」与「新增描述字符载荷有预算（D6）」三条纪律。整包 MCP 响应硬上限与可见描述文本侧信道抑制（D4b）不在本 Plan 首期范围。无需另造发布锁／发布协调器。

## 2. 授权路径与开工前置

### 2.1 授权路径（三层，不得升格）

1. **过程评审**：形态／事实性与对抗式评审（含 Codex R1／R2／R3／R3b／**R3c** findings triage 修订）。**R3c＝PASS**；进入 R2-F 前须无 major（本轮范围内无）。
2. **R2-F 终稿确权**：Codex CLI 终审，或当时无 Codex 时委托人明示确权。**本 Plan／配套 Spec 现行版本均未完成 R2-F**（仅具备候选条件）。
3. **开发授权**：委托人另行明确授权后，方可执行下方 Task。

过程评审通过、O 项未闭合、或仅有 R2-F 而无开发授权，均**不得**开工改代码。

### 2.2 开工前置（功能合同）

1. 配套 Spec **v0.6-draft**（或其后修订版）完成 **R2-F 终稿确权**，且获得**开发授权**。
2. **O1**／**O2**／**O3** 由委托人裁定并回写 Spec §4.2（含义以 Spec §4.1 为准：O1／O2＝是否另开跟进；O3＝仅 `maxTotalDescriptionChars`）。
3. 术语标准补登记 Source Description／Source Grain／Description Coverage／Description Missing Marker。
4. 基线：`npm run lint:spec-docs` 绿（存量 WARN 除外）。

### 2.3 独立观测（不阻塞开工与功能收口）

- **客户现场 `_schema` 描述覆盖率**：可作为交付／治理观测，在有客户容器访问条件时统计 `descriptions.db` 非空比例。
- **明确**：该项**不是**本条实现或 SC 收口的硬前置；不得因缺少客户访问而阻塞本地可验证的描述装配。
- 本地用全缺失、部分覆盖、超长截断夹具验证 D5／D6 既定行为。

## 3. 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `webui/server/proxy/source-descriptions.ts`（建议） | 新建 | 按 Spec §6.1 读取器合同：manifest `descriptions.db` ＋ overlay `grain` 索引；**保留规范化 `physicalTable`**；overlay 条目凭**可信绑定依据**（首选 overlay 自带 `table`）盖 **`boundPhysicalTable`**；**禁止**仅复读 manifest 盖戳；`bindingsMatch`＋`overlayBindingsMatch`＋装配纯函数（可测、无违规 IO 副作用） |
| `webui/server/proxy/acl.ts` | 修改 | `lucyCatalog`：**先**现行降级／权限／连接未就绪过滤得到最终集合，**再**调用装配器（含 D10（1）（2））；既有四字段与排序不变 |
| `webui/server/paths.ts` | 复用 | 权威内容根；描述读取必须走 `loadContentPaths().semanticLayer`；索引记录内容根供必要时复核 |
| `webui/server/proxy/query-guardrails.ts` | 可选有限修改 | 仅当抽取可复用的读文件原语；**不得**把「跳过无列且无度量」的集合当作描述权威索引 |
| `webui/docs/00-product-terminology-standard.md` | 修改 | 新术语登记 |
| `webui/server/__tests__/catalog-business-semantics.test.ts` | 新建 | SC-01–SC-17 覆盖（SC-08 依赖 O3） |
| `webui/server/__tests__/kx-acl.test.ts` | 修改 | 保持既有形状断言不回归（增字段后仍需断言不含其它域名字样） |

**不修改**：`webui/server/proxy/mcp-proxy.ts` 的 `initialize` Visible Scope（D8）；ACL 裁决逻辑本身；KTX 源码；`live-tables.ts`（物理表注释兜底本期不接线）；发布协调器／发布锁（D10 明确不另造）。

## 4. 任务分解

### S0：决策闭合与夹具

- 回写 O1／O2／O3（按 Spec §4.1 含义）。
- 准备夹具：有描述、无描述、空／仅空白 `descriptions.db`、超长描述、不可见 source 有描述（双身份／同连接＋**专属标记**）、overlay 有／无 grain、无列但有描述的表、单文件损坏、内容根切换、大小写键、发布后描述更新、**取得最终集合后同键改绑再读**（`T_old`→`T_new`＋`M_new`，SC-16）、**SC-17**＝两次读取间改绑 ＋ **「新 overlay 已落盘、新 manifest 未落盘」**（overlay 自带 `table→T_new`＋`G_new`，旧目录不得出现 `G_new`）＋正常绑定对照。
- **验证**：Spec 决策表 O 行已裁定；夹具覆盖上列；§4.1 矩阵无互斥段落；D4a／D10（含 overlay 可信绑定依据）措辞与 Spec 一致。

### S1：描述装载（纯函数）＋ overlay grain ＋ 绑定一致性

- 实现读取器：权威根、键归一化、错误隔离、缓存／生效、索引保留 `physicalTable`（Spec §6.1）。
- 实现 overlay **可信绑定**：从所读 overlay 内容推导 `boundPhysicalTable`（首选路径 A：overlay 顶层 `table`；或 B／C 同世代／同源快照）。**禁止**仅复读／后读同键 manifest `table` 盖戳（R3b 反例）。无可信依据 → `boundPhysicalTable: null` → 不写 grain。
- 实现 `bindingsMatch(source, manifestEntry)`（D10（1））；失配 → missing、不写 grain。
- 实现 `overlayBindingsMatch(source, manifestEntry, overlayEntry)`（D10（2））；戳缺失／与 source 或已校验 manifest 不对齐 → **不写 grain**（不影响已通过的 description）。
- 索引同时覆盖 manifest `descriptions.db` 与 overlay `grain`；装配仅在对应绑定／可信确认通过后写入。
- 实现 `assembleSourceEntry(source, manifestEntry, overlayEntry, budget)` 与 `assembleCatalogSources(..., overlayIndex, limits)`：参数与返回类型贯通 grain；trim 仅判空、返回原值；描述字符预算截断。
- **验证**：SC-01、SC-03、SC-04、SC-05、SC-08（O3 后）、SC-10、SC-14、SC-15、**SC-16**、**SC-17**（含发布中间态路径）单测红→绿。

### S2：目录响应接线

- `lucyCatalog`：`degradedGlobal` → 空；`!resolved.ok` → 空；`applyCurrentCatalogFilters` → `finalSources`；再装配描述（含 D10（1）（2））。
- **既有四字段、顺序、排序键不变**；`examples` 基于最终 sources。
- **验证**：SC-02、SC-07（基准＝最终可返回集合）、SC-09、SC-11、SC-12；SC-16／SC-17 可在接线层复跑同键改绑夹具。

### S3：可见性纪律与回归

- **D4a**：按 Spec「读取／索引／装配／返回」边界实现；SC-06 用**隔离夹具专属标记**断言不可见资产未被错装配；不可见 `sourceName` 不作为目录条目出现。
- **D4b**：不在本阶段实现内容抑制；测试**不得**把「可见描述原文合法提及受限名」写成硬失败。
- 复核 `kx-acl.test.ts` 既有形状断言不回归。
- **验证**：SC-06 ＋ 现有用例全绿。

### S4：门禁与形态

- `npm run lint:spec-docs` / `lint:terminology` / `lint:ia-boundary` / `lint:spec` 全绿。
- **验证**：SC-13。

## 5. 验收

验收条目即 Spec §7 的 SC-01–SC-17。阶段对应关系：

| 阶段 | SC |
|---|---|
| S1 | SC-01、SC-03、SC-04、SC-05、SC-08、SC-10、SC-14、SC-15、SC-16、SC-17 |
| S2 | SC-02、SC-07、SC-09、SC-11、SC-12（＋SC-16／SC-17 接线复跑可选） |
| S3 | SC-06 |
| S4 | SC-13 |

任一 SC 未执行，不得把本 Plan 标成已完成。SC-08 在 O3 未闭合前保持未关闭。测试文件变绿**不等于**客户现场语义层描述已覆盖——客户侧覆盖率是 §2.3 独立观测项。

## 6. 完成定义

同时满足才算完成：

1. SC-01–SC-17 均有记录在案的通过结果（SC-08 含 O3 数值）。
2. 目录响应形状契约测试通过：既有四字段与排序不变，新增字段按 Spec §4.1／D2 命名。
3. D4a 装配隔离断言通过（专属标记，非整文禁词）。
4. D10 绑定一致性断言通过（SC-16 快照后改绑不错挂描述；SC-17 两次读取间改绑／「新 overlay 已落盘、新 manifest 未落盘」不错挂 `G_new`；正常绑定对照可写 grain）。
5. 描述载荷预算行为有测试覆盖（总量、截断前缀、零预算后续条；截断而非丢条目）。
6. grain 来自 overlay 的夹具通过（SC-14）；manifest 失配或不写 grain；overlay 无法证明归属不写 grain。
7. 用户可见文案与术语标准新增行一致；`lint:terminology` 退出码 0。
8. `lint:spec-docs` 对本 Spec 与本 Plan 无形态违规。

## 7. 风险

| 风险 | 表现 | 处置 |
|---|---|---|
| 装配越权 | 为不可见／未就绪 source 装配描述进响应 | D0 先过滤；SC-06 专属标记／SC-07 |
| 同键改绑错挂 | 目录快照仍为旧 table，文件已改绑新描述 | D10（1）；SC-16；必要时内容根复核 |
| 两次读取间／发布中间态错挂 grain | 新 overlay（含 `G_new`）已落盘而新 manifest 未落盘；或先读旧 manifest 再读新 overlay，把 `G_new` 挂到旧 table | D10（2）可信绑定依据（禁止仅复读 manifest）＋`overlayBindingsMatch`；SC-17 含发布中间态夹具 |
| 文本侧信道 | 可见描述提及受限名 | D4b defer；SC-06 不因合法原文失败 |
| 描述载荷膨胀 | 描述字段总量过大 | D6 字符预算；SC-08；不宣称整包上限 |
| 描述覆盖不均 | 客户侧大量 `missing` | D5 安全回退；覆盖率只观测（§2.3） |
| 与既有形状契约冲突 | `kx-acl.test.ts` 断言「catalog 只暴露 ID」 | 只**增**字段；SC-02 |
| 误把描述当权限 | Agent 用描述推断可见性 | 术语 Forbidden；D4a |
| 与 P0-1／P0-3 重复建设 | 三条都动「选表」 | 分工：P0-1＝命中后口径、P0-3＝多表命中门闩、本条＝选表前的信息供给 |
| 读取器误复用 | guardrails 丢无列表 | Spec §6.1；无列描述夹具 |
| 授权路径升格 | 把过程对抗当终稿或开发授权 | §2.1 显式 R2-F；状态行终稿未确权 |

回滚：S2 先撤装配调用（回到既有 `lucyCatalog` 组装），S1 纯函数无调用方时可保留。不需要数据迁移回滚——本条不改任何已发布资产，只读 manifest／overlay。
