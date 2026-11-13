# Lucy Catalog 业务语义暴露 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能 Spec／**v0.6**（已获开发授权；实现已合入） |
| 日期 / 目标版本 | 2026-11-07（v0.6-draft 修订 2026-11-08）/ 产品线 `0.30.0`（分支 `lucy-v0.30`）。不进入 `v0.25` 升级台账，不占用 `L25-*` |
| 台账号 | 无（0.30 台账未建立） |
| 功能编号 / 优先级 | 清单 **P0-2**；需求池 **REQ-030-023** / **P0** |
| 状态 | **v0.6；R2-F＋R3（O1–O3）＋R4 已闭合（2026-11-08）；功能合同已收口（2026-11-13）**（SC-01–SC-17 证据关闭；见 [证据审计](../reviews/2026-11-13-catalog-business-semantics-sc-evidence-audit.md)）。**本条收口不表示可上线** |
| 授权边界 | R2-F＋R3＋R4 已闭合（R4：2026-11-08）。授权范围＝本 Spec／Plan 实现与测试；**不**表示可上线／发布取证。实现由 Cursor coder；Cursor reviewer 做 code review。 |
| 决策来源 | 2026-11-06 CFO 误报事故 ＋ 2026-11-07 客户沟通实录（翊总／田总）：「AI 取数取错了表」；第二轮沟通自述「**表一多，AI 自己不知道该选哪张**」 |
| 需求来源 | [需求池 REQ-030-023](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md)；[误报防线 §4.1 G1](../plans/lucy-20261107-misreport-defense-and-stored-user-experience-plan.md)；[功能清单池 P0-2](../plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md)；[核心方向 §4.1 约束闸](../plans/lucy-20261107-lucy-0-30-core-direction.md) |
| 实施主体 | Lucy：MCP Proxy 目录装配层。**不改 KTX 源码**；不改 ACL 裁决口径；不把语义裁判塞进 ACL |
| 配套 Plan | [lucy-20261107-catalog-business-semantics-plan.md](../plans/lucy-20261107-catalog-business-semantics-plan.md)（**v0.6-draft**） |
| 评审记录 | [第 1 轮评审记录](../reviews/2026-11-07-lucy-0-30-spec-plan-review-round1.md)（形式合规 ＋ 事实性）；[Codex 对抗评审记录](../reviews/2026-11-08-catalog-business-semantics-codex-review.md)（过程对抗；**不构成终稿确权**） |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」「功能闭口与发布取证」「伪代码」 |
| 与既有 Spec 的关系 | **串联，不吞并。** 表级歧义门闩属 REQ-030-024／P0-3（选错表时怎么办）；本条只解决「Agent 选表**之前**拿不到业务语义」。口径绑定属 REQ-030-027／P0-1（命中之后不得自行加工口径）。本条是**约束闸的输入侧**，不替代任何一条。另与 REQ-030-012／P0-A（语义层 Source 级字段暴露裁剪）**不冲突但相邻**：012 是**列级**裁剪（catalog 现行不返回列），本条是**表级**描述元数据；012 已规定「若后续 `lucy_catalog` 增加列预览，必须复用同一暴露集读取器，不得另起一套裁剪口径」——本条**不返回任何列**，该约束不触发；若后续要返回列或列样例，须先回 012 复用其暴露集读取器 |

## 变更记录

| 版本 | 说明 |
|---|---|
| v0.1-draft | 初稿 |
| v0.2-draft | 0.30 批次 R1（形式合规＋事实性）修订：三段身份键、`human` 存在说明、grain 属 overlay |
| v0.3-draft | Codex R1 triage 修订：F-01…F-09（见该版变更行） |
| v0.4-draft | Codex R2 CONDITIONAL 修订：**F-R2-01** 目录条目与 manifest／overlay **绑定一致性检查**及失配回退；「取得最终集合后同键改绑再读」夹具（SC-16）；同步读取器合同／伪代码／Plan。**F-R2-02** 统一 D4a「读取／索引／装配／返回」保证边界；SC-06 改用隔离夹具专属标记，避免合法原文提及受限名误判 |
| v0.5-draft | Codex R3 CONDITIONAL 修订（部分闭合 F-R2-01 残留）：绑定校验覆盖独立读取的 overlay grain；两次读取之间同键改绑；`boundPhysicalTable`／`overlayBindingsMatch`；**SC-17** 初版。后经 **R3b** 判定：仅后读 manifest 表值盖戳仍不足 |
| **v0.6-draft** | **Codex R3b CONDITIONAL 修订（闭合 F-R2-01 时序变体）**：为所读 overlay 内容提供**可信绑定依据**（overlay 自带物理表字段／同发布世代共绑／与已 pin 目录条目同源世代快照）；**禁止**仅复读同键 manifest 表值作为确认。无法证明归属 → **不写 grain**。同步 D10／§6.1／伪代码／失败分支；**SC-17** 扩充「新 overlay 已落盘、新 manifest 未落盘」夹具（旧目录不得出现 `G_new`）＋正常绑定对照。**不宣称终稿确权；冻结落地；未授权实现** |

## 闭口层级

- 层级：功能合同
- 本条承诺：`lucy_catalog`（及等价目录工具）对调用者**现行目录最终可返回**的每个 source，除既有 `connectionId / schema / sourceName / table` 外，**携带该 source 的业务描述与粒度（grain）**，使 Agent 不必再靠表名字符串相似度猜测表义；描述缺失时按既定规则回退且**显式标注缺失**；**新增描述载荷**受字符预算约束（非整包 MCP 响应硬上限，见 D6／§6）。
- 本条出口：SC-01–SC-17（见 §7）。描述装配纯函数单测；目录响应形状契约测试；现行目录过滤后的可见性装配隔离；描述载荷预算截断断言；读取器合同与绑定一致性夹具（含 overlay **可信绑定依据**；禁止仅复读 manifest）；`lint:spec-docs` 通过。
- 不在本条出口：表级多表命中门闩（P0-3）、口径绑定（P0-1）、答复可核对块（P0-4）、Eval 选表断言（P0-6）、catalog 检索式入参（**首期基线不做**；是否另开跟进见 **O1**）、同义词词典（**首期基线不做**；是否另开跟进见 **O2**）、清单出口「业务相关排序优于字母序」（**首期显式降级**为字母序，见 D7／§4.1）、客户现场语义层描述覆盖率本身、可见描述文本的内容级侧信道抑制（**defer**，见 D4b）、镜像／部署／上线、**整包** MCP `content[0].text` 序列化体积硬上限（本条只约束新增描述字符预算）。
- 上线关系：本条收口不表示可上线
- 清单出口对齐说明：功能清单池 P0-2 出口写「业务相关排序优于纯字母序」。**首期合同显式降级**：仍用 `sourceName.localeCompare`（D7）；业务相关排序推迟到检索入参（O1）闭合并另开跟进后回写清单出口。本条不以清单理想出口覆盖首期实现合同。

---

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- Source Description：中文主称「来源描述」。指语义层为某个 source 发布的**业务含义**文本，来源为 `_schema/<schema>.yaml` 的 `tables.<sourceName>.descriptions.{db,ai}`；运行时该对象还有第三个键 `human`（`AuthoredText{db?,ai?,human?}`，`webui/server/model.ts:3-7`、`webui/server/semantic-layer.ts:400`）——**首期只取 `db`**，不引入 `ai`／`human`。
- Source Grain：中文主称「来源粒度」。指该 source 的事实粒度说明（如「一行＝一台设备 × 一天」），取自语义层 **overlay** 的 `grain`（非 manifest）。
- Description Coverage：中文主称「描述覆盖率」。指**可见** source 中携带非空描述的比例；低于阈值即视为语义层治理缺口，**不是**产品缺陷。
- Description Missing Marker：中文主称「描述缺失标记」。描述缺失时目录条目上显式标注的机器可读标记，用于让 Agent 与运维区分「无描述」与「未装配」。

Forbidden:

- 把「来源描述」写成授权信息——描述是**语义**，可见性仍由 ACL 决定；描述不得用于推断权限。
- 把「描述缺失」写成数据缺失——表存在但描述没填，不是表没有数据。
- 把「描述覆盖率」写成质量门禁指标——首期只观测，不阻断发布。
- 用「元数据」「schema 说明」作主术语。

落位：本条术语属 **MCP 目录／语义层暴露面**，落术语标准 §4.8（MCP 调试台 / ACL 裁决可见性）相邻分区登记（实现前补标准条目）；机器可读字段名保持 `translate="no"`。

---

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/00-principles.md`
- `webui/docs/07-mcp-auth-proxy-spec.md`
- `webui/docs/162-customer-query-experience-and-usage-evidence-spec.md`
- `webui/docs/00-product-terminology-standard.md`

### What This Change Follows

- [ ] 首期**无新 WebUI 页面**：目录形状变更只在 MCP 工具响应面；作者面仍是既有语义层发布工作台。
- [ ] 目录条目**只增字段不改字段**：既有 `connectionId / schema / sourceName / table` 一律保留，老客户端忽略新增字段。
- [ ] 描述文本沿用语义层既有 `descriptions.db / descriptions.ai` 双写约定，**不在 Proxy 侧另造文案**。
- [ ] 不引入仪表盘式卡片堆砌；本条无营销面。

### Exceptions (If Any)

- 首期无 WebUI 作者面：描述由语义层 YAML 提供，随既有发布工作台生效。

### Follow-up Needed

- 目录条目展示页 / 描述覆盖看板 → 另立 Spec。
- 与 P0-1 口径绑定、P0-3 表级门闩的组合用例（描述命中 → 绑定 → 门闩）→ 两 Spec 收口后联测。
- 可见描述文本侧信道的发布侧约束／内容抑制 → 另议（本条 D4b defer）。
- 清单出口「业务相关排序」→ 依赖 O1 跟进后回写清单池。

---

## 1. 背景与取证

### 1.1 事故与自述

沟通实录第二轮，委托人自述根因：

> 「之前我们主要是把数据接进来，现在正在做的是让 AI 把数问对。**表一多，AI 自己不知道该选哪张，这次就是选错了**。」

⇒ 本条要解决的是**选表的信息不足**，不是选表的强制力（后者属 P0-3）。

### 1.2 现行缺口（已核实）

| # | 事实 | 证据 |
|---|---|---|
| E1 | `lucyCatalog` 的 source 条目只有四个字段：`connectionId / schema / sourceName / table`——**无描述、无粒度、无业务域** | `webui/server/proxy/acl.ts`（`lucyCatalog` 返回类型与组装） |
| E2 | 目录条目排序键只有 `sourceName.localeCompare`——**纯字母序，无相关性** | 同上 |
| E3 | **描述在语义层已存在**：`_schema/<schema>.yaml` 的 `tables.<sourceName>.descriptions.{db,ai}`；本仓实测 **18/18 非空**（demo-mysql 3 ＋ lucy-ops 12 ＋ mysql-aliyun 3＝18 个 source／18 个表级 `descriptions.db` 非空）。⚠️ **副本不计**：`config/semantic-layer/lucy-ops/_schema/main.yaml` 与 `semantic-layer/lucy-ops/_schema/main.yaml` 逐字相同，重复计数会把分母虚增到 30 | `semantic-layer/mysql-aliyun/_schema/dataforai.yaml`；`semantic-layer/*/_schema/*.yaml`（本仓实测统计） |
| E4 | 目录组装只读 `permissions.sources`（编译后的 ACL 结果），**不读 manifest** ⇒ E3 的描述从不进入目录响应 | `acl.ts` `lucyCatalog` vs `_schema/*.yaml` |
| E5 | 歧义目录加载器同样只抽**名字**：`SourceYaml` 类型**连 description 字段都没有**，`namesOf` 只取 name | `webui/server/proxy/query-guardrails.ts` |
| E6 | `lucy_catalog` 的 `inputSchema.properties = {}`——**不能传查询词**，目录无法当检索／推荐用 | `webui/server/proxy/mcp-proxy.ts` |
| E7 | `initialize` 注入的 Visible Scope 每行同样只有四元组 | `mcp-proxy.ts` Visible Scope 模板 |
| E8 | 运行时目录形状被**刻意固定为只暴露 ID**（测试断言 catalog JSON 不含其它域名字样） | `webui/server/__tests__/kx-acl.test.ts` |
| E9 | 数据库侧已有物理表注释采集（`table_comment`），可作描述兜底源 | `webui/server/live-tables.ts` |
| E10 | 元数据侧信道风险已被预警：描述进 prompt 须先过可见性裁剪 | `docs/specs/lucy-20261014-concept-dictionary-spec.md`；三档门控见 `docs/plans/wo-20261014-concept-dictionary.md` |
| E11 | 现行 `lucyCatalog` **先**判 `degradedGlobal` 返回空目录，再 `effectivePermissions`；降级时 `effectivePermissions` 仍可能返回 LKG 权限——**不得**在描述接线时绕过降级直接装配 LKG | `acl.ts:2100–2107`、`:2167–2171` |
| E12 | 现行目录在权限之后还有**连接未就绪**过滤，最终返回的 connections／sources 可以小于 `permissions.*` | `acl.ts:2109–2124` |

### 1.3 取证缺口（不得当事实）

- **客户现场 `_schema` 描述覆盖率未知**：本仓 demo/ops 口径**不覆盖**客户 `asset_finance`。⇒ 不得假设客户侧也全覆盖；**描述缺失必须可安全回退**（见 D5）。覆盖率是**独立观测／交付事项**，**不阻塞**本条功能合同（见 Plan）。
- KTX 上游 `sl_read_source` 是否已返回描述：**未取证**（Proxy 只做透传）。若上游已返回，本条价值降级为「代理层补齐目录面」，不重复造。
- 客户侧是否有其它目录工具（非 `lucy_catalog`）承载描述：**未取证**。

---

## 2. 目标

1. 目录对**现行过滤后最终可返回**的 source 携带业务描述与粒度，使 Agent 无需靠表名猜测。
2. **装配隔离**：不得把不可见／未进入最终目录集合的 source 的描述资产写入响应（D4a；读取／索引／装配／返回分层）。
3. **绑定一致**：不得把同键改绑后的新目标描述／grain 挂到仍携带旧物理表的目录条目；独立读取的 overlay grain 须凭**可信绑定依据**证明归属（不得仅复读 manifest 表值），无法证明则不写 grain（D10）。
4. 描述缺失时**安全回退且显式标注**，Agent 与运维都能区分「无描述」与「未装配」。
5. **新增描述字符载荷有预算**，描述不得把描述字段总量撑爆；条目本身不得因描述被丢弃。
6. **只增不改**：既有四字段与既有调用方行为不变。

---

## 3. 非目标

| 不做 | 原因 |
|---|---|
| 把描述做成 ACL 授权依据 | 职责边界（G4）：ACL 答「有没有权」，描述答「这是什么表」 |
| 运行时用描述做语义裁决 | 那是 P0-1（口径绑定）与 P0-3（表级门闩）的职责 |
| 首期给 catalog 加检索入参 | **首期基线锁定不做**；是否另开跟进见 O1（O1 不改写首期基线） |
| 首期引入同义词词典 | **首期基线锁定不做**；是否另开跟进见 O2 |
| 首期改变排序为业务相关序 | **首期基线锁定字母序**（D7）；清单理想出口显式降级 |
| 描述覆盖率作发布硬门禁 | 首期只观测；语义层治理不应阻塞发布 |
| 修改客户现场语义层描述内容 | 本条只负责**暴露**；内容治理另议 |
| 自动生成描述 | 描述必须是人写的业务含义；自动生成会把猜测变成"事实" |
| 首期整包 MCP 响应体积硬上限 | 本条只约束新增描述字符预算（D6）；整包上限另议 |
| 首期对可见描述做内容级抑制 | 文本侧信道见 D4b defer |

---

## 4. 设计决策

### 4.1 首期字段／排序／状态矩阵（唯一合同）

本表是**首期唯一有效合同**。伪代码、SC、Plan 不得另写互斥承诺。开放决策（O）只影响表中标注为「条件化」的行；**不得**在正文其它段落同时承诺互斥答案。

| 维度 | 首期基线（已冻结） | 条件化／跟进 | 对应 SC |
|---|---|---|---|
| 既有字段 | `connectionId / schema / sourceName / table` 保留 | — | SC-02 |
| `description` | 取 `descriptions.db`；trim **仅用于判空**；返回**原值**（F-07） | — | SC-01、SC-03、SC-04、SC-15 |
| `descriptionState` | 枚举 **`present` \| `missing` \| `truncated`**（D2／D6） | — | SC-01、SC-04、SC-08 |
| `grain` | **首期必选装配**：有 overlay.grain 则返回；无则字段省略或 `null`（实现择一并在夹具固定），**不**阻塞条目 | — | SC-14 |
| `descriptions.ai` | **不进入**目录响应 | 若未来要纳入，须新 Spec／新决策行，**不是** O3 可静默改写首期基线 | SC-05 |
| 排序 | `sourceName.localeCompare` 字母序 | 业务相关排序 **不在首期**；清单出口降级说明见闭口层级；依赖 O1 跟进 | SC-10 |
| 检索入参 | 无 | O1＝是否**另开跟进**增加；首期基线不因 O1 未答而双写 | —（首期无对应 SC 开启） |
| 同义词 | 不暴露 | O2＝是否**另开跟进**；同上 | — |
| 描述载荷预算数值 | 算法与计量已冻结（D6）；**具体字符上限数值**待 O3 | O3 **仅**裁定 `maxTotalDescriptionChars` 正整数；闭合前依赖预算数值的 SC-08 保持未关闭 | SC-08（O3 闭合后） |
| Visible Scope | 不带描述（D8） | — | SC-12 |
| 目录过滤顺序 | 先现行目录最终集合，再增补描述（D0） | — | SC-07、SC-09 |
| 绑定一致性 | 装配前校验规范化物理表绑定（D10）；manifest 失配按缺失回退；overlay grain 另须凭**可信绑定依据**与 source／已校验 manifest 对齐，无法证明归属则不写 grain（**禁止**仅复读 manifest 表值） | — | SC-16、SC-17 |

> **O 项与首期基线的关系**：O1／O2 回答的是「要不要另开跟进扩展」，**不是**「首期到底做不做」——首期答案已由上表锁定。O3 只填预算数值，**不得**再用来决定是否带 `ai` 或是否带 `grain`（二者已由上表冻结）。伪代码与 SC **不得**在 O 未裁定时默认选边实现可选项。

### 4.2 决策表

| 编号 | 决策 | 状态 |
|---|---|---|
| **D0** | **装配顺序**：先得到与现行 `lucyCatalog` 相同的最终可返回 `connections`／`sources`（含全局降级空目录、身份解析失败空目录、连接未就绪过滤），**再**仅对这些 source 增补描述／grain。禁止在降级时用 `effectivePermissions` 的 LKG 权限重建目录 | **冻结** |
| **D1** | 描述来源为语义层 `_schema/<schema>.yaml` 的 `descriptions.db`；Proxy 只做读取与装配，**不改写文案**（判空用 trim，返回原值） | **冻结** |
| **D2** | 目录条目新增字段：`description`、`grain`（按 §4.1）、`descriptionState`（**`present` / `missing` / `truncated`**）。既有四字段保留 | **冻结** |
| **D3** | **只暴露 `descriptions.db`**；`descriptions.ai`／`human` 不进目录响应 | **冻结**（不再挂靠 O3） |
| **D4a** | **装配隔离（硬保证）**：保证边界按「读取／索引／装配／返回」分层，**不得**用「不装载」一词同时覆盖扫盘与响应写入。（1）**返回**：不可见／被过滤的 source 不得作为目录条目出现；其专属描述／grain 不得写入任何最终条目。（2）**装配**：仅对 D0 最终 `sources` 做 lookup 并写入字段；禁止把不可见键的资产装配进可见条目。（3）**读取／索引**：允许在 `connectionScope ⊆ finalConnections` 内扫盘建键→资产索引（索引可含同连接下暂不可见 source 的映射）；**不**要求「磁盘上从未打开过不可见文件」；assemble 不得把这些键写入响应。禁止把「可见描述原文提及受限名」与「资产错装配」混为一谈（见 D4b／SC-06） | **冻结** |
| **D4b** | **可见描述文本侧信道（非本条硬保证）**：可见表的 `descriptions.db` 原文仍可能提及不可见表名或受限片段。首期**不做**运行时内容抑制（与原文透传冲突）。**Defer** 为发布侧／语义层治理约束；**不**由 SC-06 宣称「响应全文无任何受限字符串」。SC-06 只覆盖 D4a，且用隔离夹具专属标记断言错装配 | **冻结（defer 内容抑制）** |
| **D5** | 描述缺失 → `description: null` + `descriptionState: "missing"`，**不静默回退为物理表名伪装成描述**；目录条目其余字段照常返回 | **冻结** |
| **D6** | **新增描述载荷预算**（非整包响应上限）：计量单位＝装配进响应的各条 `description` 字符串的 **UTF-16 code unit 长度之和**（与 JS `String.length` 一致）；不含既有四字段、`grain`、`examples`、JSON 结构开销、MCP `content[0].text` 再序列化开销。超限按**条目顺序**截断当前条描述为剩余预算的**前缀**，标 `truncated`；预算耗尽后后续有描述的条目写 `description: null`（或空串——实现择一并在 SC 固定）且 `descriptionState: "truncated"` 或保持可区分的零预算截断语义（SC-08 夹具固定一种）。**条目本身不得被丢弃** | **冻结**；数值见 O3 |
| **D7** | **首期不改变排序**：仍为 `sourceName.localeCompare`。清单「业务相关排序」显式降级（见闭口层级） | **冻结** |
| **D8** | `initialize` 的 Visible Scope **保持现状**（不带描述） | **冻结** |
| **D9** | 与 P0-1 口径绑定**共用「可见 source 语义投影」意图**，但**本条读取器合同独立**（见 §6.1）：本条所有者＝catalog 描述装配；P0-1 不得 silently 改本条键归一化／缓存语义。可复用路径解析与遍历原语，**不得**直接复用会跳过「无列且无度量」表的 guardrails 过滤结果作为描述索引权威 | **冻结** |
| **D10** | **绑定一致性（硬保证）**：按三段键 lookup 到的资产，在写入字段前必须通过绑定一致性检查；**manifest 路径与 overlay grain 路径分列，不得假定「manifest 已通过 ⇒ overlay 可直接写入」**。（1）**Manifest／描述**：写入 `description` 前至少校验 `normalizeRef(manifestEntry.table) === normalizeRef(source.table)`（归一化与 `acl.ts` `normalizeRef`／sourceMap 一致）。manifest 缺失、`table` 缺失／非字符串、或规范化后不等 → **失配**：`description: null` ＋ `descriptionState: "missing"`，且**不**写 grain。（2）**Overlay／grain（独立读取）**：写入 `grain` 前，除（1）已通过外，还必须为**所读 overlay 内容**提供**可信绑定依据**，并据此得到规范化 `boundPhysicalTable`；该戳须等于 `normalizeRef(source.table)` **且**等于该次用于描述的 `manifestEntry` 规范化物理表。可信依据与禁止项见 §6.1（**禁止**把「读 overlay 后再复读／后读同键 manifest 表值」单独当作确认）。无可信依据、戳缺失、或戳与 source／已校验 manifest 不对齐 → **无法证明归属**：**不写 grain**（省略或 `null`，夹具固定一种）；**不得**在「新 overlay 已落盘、新 manifest 未落盘」窗口把 `G_new` 挂到仍携带旧 `table` 的目录条目。仅 overlay 无法确认时，**不**仅因此把已通过（1）的 description 改成 missing。（3）必要时可复核内容根身份或索引／sourceMap 版本戳；内容根不一致则整次索引不可用（全部按缺失）。**不**另造发布锁或发布协调器。夹具见 SC-16／SC-17 | **冻结** |
| **O1** | 是否**另开跟进**给 `lucy_catalog` 增加可选检索入参（如 `q`）并引入业务相关排序 | **已闭合（2026-11-08）**＝**否**（本波次不另开跟进；首期基线「无检索／字母序」不变） |
| **O2** | 是否**另开跟进**在语义层引入 `synonyms` 并暴露 | **已闭合（2026-11-08）**＝**否**（本波次不另开跟进） |
| **O3** | `maxTotalDescriptionChars` 的具体正整数 | **已闭合（2026-11-08）**＝**8192**（UTF-16 code unit；仅预算数值） |

> **开放决策守卫（本条统一）**：O 项在闭合前不得实现**其对应扩展分支**；首期基线（§4.1）不因 O 未闭合而悬空。依赖 O3 数值的 SC-08 在 O3 闭合前保持未关闭。闭合须由**委托人（PM）**在**开发授权前**书面裁定并回写本表；**过程评审通过 ≠ O 项闭合 ≠ 终稿确权 ≠ 开发授权**。

---

## 5. 数据模型（Normative）

### 5.1 描述来源（语义层既有，本条只读）

```yaml
# ① Manifest：<semanticLayerRoot>/<connection>/_schema/<schema>.yaml  — 既有形状，本条不改
#    semanticLayerRoot 权威解析见 §6.1（默认 <projectRoot>/config/semantic-layer）
tables:
  <sourceName>:
    table: <physical_table>
    descriptions:
      db: "Demo 超市订单 ODS 明细表"      # 主描述（中文业务含义）
      ai: "Demo superstore order line items..."   # 辅描述（不进入目录响应，见 D3）
      human: "……"                        # ⚠️ 运行时存在第三键 AuthoredText.human
                                            #   **首期仍只取 db**
# ⚠️ Manifest 里**没有也不该有** grain/measures/segments —— 写进去会被硬失败：
#    catalog-assets.ts classifyYaml 对 `grain`／`measures`／`segments`
#    返回 OVERLAY_FIELD_IN_MANIFEST。

# ② Overlay：<semanticLayerRoot>/<connection>/<source>.yaml  — 粒度写在这里
name: <sourceName>
table: <schema.physical_table>           # 可信绑定依据（首选）：overlay 自带物理表
                                         # 上传 classifyYaml 已要求；缺失／非法 → 无法证明归属 → 不写 grain
grain: ["order_id", "order_date"]        # 粒度属 overlay 字段
#   本仓实例：semantic-layer/lucy-ops/ops_calls.yaml（部分遗留 overlay 可能缺 table → fail-closed 不写 grain）
#   运行时取值：overlay.grain ?? record.grain（webui/server/semantic-layer.ts）
#   ⇒ 本条要装配 grain，必须读 **overlay**，不能从 manifest 取；
#   ⇒ boundPhysicalTable 须来自 overlay 内容可信依据，禁止仅复读同键 manifest.table。
```

### 5.2 目录响应形状（变更后）

```jsonc
{
  "connections": ["mysql-aliyun"],
  "sources": [
    {
      "connectionId": "mysql-aliyun",
      "schema": "dataforai",
      "sourceName": "superstore_orders",
      "table": "superstore_orders",
      // —— 以下为新增字段 ——
      "description": "Demo 超市订单 ODS 明细表",   // 缺失时为 null；截断时为原值前缀
      "descriptionState": "present",              // present | missing | truncated
      "grain": ["order_id", "order_date"]         // 首期装配；overlay 缺失则省略或 null（夹具固定）
    }
  ],
  "examples": ["..."]
}
```

装配规则：

1. **D0**：只对现行目录最终可返回 source 装配（先过滤，再描述）。
2. **D10（manifest）**：装配 `description` 前校验规范化物理表绑定；失配则按缺失回退，且不写 grain。
3. `description` 取 `descriptions.db`：**trim 仅判空**；非空则返回**原值**（可含首尾空白）；不改写、不摘要、不翻译（D1／F-07）。预算计量对**实际写入响应的字符串**计长。
4. `descriptions.db` 为空／缺失／仅空白（trim 后空）→ `description: null` ＋ `descriptionState: "missing"`（D5）。
5. 描述载荷超预算 → 截断为剩余预算前缀 ＋ `descriptionState: "truncated"`（D6）；后续零预算条目按 D6 约定处理。
6. **条目不得因描述被丢弃**——最终目录集合必须完整列出。
7. `grain` 取自 **overlayIndex**（§6.1）；仅在 **D10 overlay 可信绑定**通过后写入（`overlayBindingsMatch`）；无法证明归属或不写 grain 时，不影响已通过 manifest 绑定的 description 状态；无 overlay.grain → 省略或 `null`（夹具固定）。

---

## 6. 核心流程（伪代码）

### 6.1 描述读取器合同（Normative）

| 项 | 合同 |
|---|---|
| **权威根** | 必须经 `resolveContentPaths`／`loadContentPaths`（`webui/server/paths.ts`）得到 `semanticLayer`。优先级：`LUCY_CONTENT_ROOT` → `ktx.yaml` `paths.content_root` → 默认 `<projectRoot>/config`。权威路径＝`<configDir>/semantic-layer`。**禁止**硬编码仓库根下裸 `semantic-layer/...` 作为生产读取根（测试夹具可注入根）。 |
| **索引键** | `connectionId + "." + schema + "." + sourceName`，三段均经与 ACL sourceMap **相同的归一化**（大小写／空白规则与 `acl.ts` sourceMap 构建一致）。YAML 原始键须归一化后再匹配；夹具覆盖大小写差异键。 |
| **绑定一致性（manifest）** | **D10（1）**：三段键命中**不足以**装配描述。写入 `description` 前必须 `normalizeRef(manifestEntry.table) === normalizeRef(source.table)`。失配／manifest 无 `table` → 按缺失回退，禁止错挂。manifest 索引条目应保留规范化后的 `physicalTable` 供装配侧比对。 |
| **绑定一致性（overlay grain）** | **D10（2）**：manifest 已通过**不足以**写入 grain。overlay 与 manifest 为**独立文件／独立读取**；索引／装载须为每个 overlay 条目建立 `boundPhysicalTable`，且该戳必须来自所读 overlay 内容的**可信绑定依据**。**可信依据（normative；满足其一即可）**：（A）**overlay 自带物理表字段**——从所读 overlay YAML 顶层 `table` 规范化得到戳（与上传 `classifyYaml`／`OVERLAY_MISSING_TABLE` 一致；缺字段／非字符串／不可解析 → 无法证明）；（B）**同发布世代共绑**——证明该 overlay blob 与同键匹配 manifest 同属一次发布／世代，并用该世代内为键 K 记录的物理表作戳；（C）**与已 pin 目录条目同源世代快照**——目录条目已 pin 某内容快照，overlay 必须从**同一快照**读取（不得从发布中途的 live 盘面单独拼装）。**明确不足（禁止单独当作确认）**：仅复读／后读同键 manifest 的 `table` 值（含「先读 overlay、再观察 manifest、用观察结果盖戳」的 v0.5 协议）——该路径在「新 overlay 已落盘、新 manifest 未落盘」窗口仍会把 `G_new` 盖上旧 `T_old` 戳。装配侧：戳与 `source.table`／已校验 `manifestEntry.physicalTable` 三者对齐才写 grain；否则**不写 grain**。 |
| **完整可见表集合** | 索引**必须**能覆盖 D0 最终 sources 中每一项（含「有描述但无列／无度量」的表）。**不得**把 `query-guardrails`「跳过无列且无度量」的过滤集当作描述权威全集。 |
| **错误隔离** | **单文件**损坏／解析失败 → 跳过该文件，受影响 source 记为描述／grain 缺失；**不得**因单文件失败清空全部描述索引。整根目录不存在 → 空索引，目录本体仍返回（SC-09）。 |
| **非法值** | `descriptions.db` 非字符串 → 视为缺失。`grain` 非数组／非法 → 该条不写 grain（或 null），不影响 description。 |
| **缓存／生效** | 本条描述索引**不得**引入长于发布可见性的陈旧窗口作为真相源。若复用带 TTL 的遍历缓存，发布／内容根变更后必须能在**同进程下次 catalog 调用**读到更新（或显式 invalidate）。夹具：发布更新后再次 `lucy_catalog` 见新描述。绑定一致性（D10）补齐「目录快照未刷新、文件已改绑」「两次读取间改绑」以及「overlay 先于 manifest 落盘」的错挂防护，**不**替代缓存失效。 |
| **D9 复用边界** | 允许复用：内容根解析、YAML 读文件原语。禁止：把口径绑定资产读取器与描述索引混为同一可变单例而不划分所有者；禁止直接采用会丢表的 guardrails 目录快照。P0-1 若共享投影，须另立共享合同；本条首期以本读取器合同为准。无需另造发布锁。必要时复核：索引构建时记录的内容根路径＝当次权威根；可选记录内容摘要／sourceMap 版本戳，根不一致则整次索引不可用。 |

夹具点（实现前准备，见 Plan S0／S1）：内容根切换；大小写键匹配；无列但有描述的表；单文件损坏隔离；发布后描述更新；首尾空白描述（F-07）；**取得最终集合后同键改绑再读**（SC-16）；**SC-17**＝两次读取间改绑 ＋ **「新 overlay 已落盘、新 manifest 未落盘」**时序变体 ＋ 专属 grain 标记 `G_new` ＋正常绑定对照；隔离夹具专属标记（F-R2-02／SC-06）。

### 6.2 装配伪代码

```text
# ── 装配侧（纯函数，便于单测） ──
# 参数契约（F-03）：assembleSourceEntry 接收 source, manifestEntry, overlayEntry, budget
#                 assembleCatalogSources 接收 visibleSources, manifestIndex, overlayIndex, limits

function bindingsMatch(source, manifestEntry):
  # D10（1）：manifest／描述路径 —— 至少校验规范化物理表绑定
  if manifestEntry is null: return false
  assetTable := manifestEntry.physicalTable ?? manifestEntry.table
  if assetTable is null or typeof assetTable != string: return false
  return normalizeRef(assetTable) == normalizeRef(source.table)


function overlayBindingsMatch(source, manifestEntry, overlayEntry):
  # D10（2）：overlay／grain 路径 —— 不得因 manifest 已通过就直接写 grain
  # overlayEntry.boundPhysicalTable 须来自 §6.1 可信绑定依据（A／B／C）；禁止仅复读 manifest 盖戳
  if overlayEntry is null: return false
  if not bindingsMatch(source, manifestEntry): return false
  stamp := overlayEntry.boundPhysicalTable
  if stamp is null or typeof stamp != string: return false   # 戳缺失 ⇒ 无法证明归属
  manifestTable := manifestEntry.physicalTable ?? manifestEntry.table
  return normalizeRef(stamp) == normalizeRef(source.table)
     and normalizeRef(stamp) == normalizeRef(manifestTable)


function assembleSourceEntry(source, manifestEntry, overlayEntry, budget):
  # source: D0 最终可返回集合中的一条
  # manifestEntry: _schema 中同名 source 定义（含 physicalTable），可能为 null
  # overlayEntry: overlay 记录（grain ＋ 可信依据得出的 boundPhysicalTable），可能为 null
  # budget: { remaining: number } 可变引用；计量见 D6

  entry := {
    connectionId: source.connectionId,
    schema: source.schema,
    sourceName: source.sourceName,
    table: source.table
  }

  # F-R2-01／D10（1）：同键命中但物理表改绑 → 不得装配新目标描述／grain
  if not bindingsMatch(source, manifestEntry):
    entry.description := null
    entry.descriptionState := "missing"
    return entry                    # 不写 grain；条目本身保留

  raw := manifestEntry?.descriptions?.db      # 只取 db（D3）；ai 不进响应
  if raw is null or typeof raw != string or trim(raw) == "":
    entry.description := null
    entry.descriptionState := "missing"      # D5；trim 仅判空
  else:
    # F-07：返回原值，不做 trim 规范化
    text := raw
    if budget.remaining <= 0:
      entry.description := null               # 零预算：夹具固定一种空值形态
      entry.descriptionState := "truncated"
    else if length(text) > budget.remaining:
      text := prefix(text, budget.remaining)  # D6：UTF-16 前缀截断
      entry.descriptionState := "truncated"
      budget.remaining := 0
      entry.description := text
    else:
      entry.descriptionState := "present"
      budget.remaining -= length(text)
      entry.description := text

  # F-R2-01／R3b／D10（2）：所读 overlay 须凭可信绑定依据证明归属后才写 grain
  if overlayBindingsMatch(source, manifestEntry, overlayEntry):
    grain := overlayEntry.grain
    if grain is valid non-empty array:
      entry.grain := grain
  # else: 无法证明归属 → 不写 grain（省略或 null，夹具固定）；不影响已写入的 descriptionState

  return entry


function assembleCatalogSources(visibleSources, manifestIndex, overlayIndex, limits):
  # visibleSources: **D0 最终集合**（不是 raw permissions.sources）
  # manifestIndex / overlayIndex: 键＝归一化后的 connectionId.schema.sourceName
  # overlayIndex 条目须含来自可信依据的 boundPhysicalTable（§6.1）
  # D4a 边界（F-R2-02）：
  #   读取／索引 — 允许在 finalConnections 范围内扫盘建索引（可含同连接暂不可见键）
  #   装配 — 只 lookup visibleSources 键，且须通过 D10（manifest ＋ overlay 分列）
  #   返回 — 不可见 source 不作为条目出现；其专属资产不得写入任何最终条目
  budget := { remaining: limits.maxTotalDescriptionChars }   # 数值来自 O3；未闭合不得声称 SC-08 已关
  entries := []
  for source in sortedBy(visibleSources, sourceName.localeCompare):   # D7
    key := normalize(source.connectionId) + "." + normalize(source.schema) + "." + normalize(source.sourceName)
    entries.push(assembleSourceEntry(
      source,
      manifestIndex.get(key),
      overlayIndex.get(key),
      budget))
  return entries


# ── 索引装载（§6.1 overlay 可信绑定；首选路径 A 示意） ──
# boundPhysicalTable 必须来自所读 overlay 内容的可信依据。
# 禁止：readOverlay 后再 observeManifestTable，仅用后读 manifest.table 盖戳（R3b 反例）。
function loadOverlayEntry(key, readOverlay):
  overlayContent := readOverlay(key)           # 用于 grain 的 overlay 内容
  if overlayContent is null: return null
  # 路径 A：overlay 自带 table（首选；与上传 classifyYaml 一致）
  intrinsic := overlayContent.table
  if intrinsic is null or typeof intrinsic != string:
    return { ...overlayContent, boundPhysicalTable: null }   # 无法证明归属
  stamp := normalizeRef(intrinsic)
  if stamp is null:
    return { ...overlayContent, boundPhysicalTable: null }
  return { ...overlayContent, boundPhysicalTable: stamp }
# 路径 B／C（同发布世代共绑／同源世代快照）若选用，须能证明 overlay blob 归属该世代；
# 仍禁止把「单独后读 live manifest.table」当作唯一依据。


# ── 运行时侧（F-01：先现行目录过滤，再增补描述） ──
on lucy_catalog(args, identity):
  runtime := ensurePolicyRuntime()
  if runtime.degradedGlobal:
    return { connections: [], sources: [], examples: [] }    # 与现行一致；禁止用 LKG 装配

  resolved := effectivePermissions(identity)
  if not resolved.ok:
    return { connections: [], sources: [], examples: [] }

  # 连接未就绪等现行过滤 —— 得到最终可返回集合（acl.ts 现行逻辑）
  finalConnections, finalSources := applyCurrentCatalogFilters(resolved.permissions)
  # ↑ 含 opsEvidence／连接未就绪等；本条不改过滤口径，只复用结果

  manifestIndex, overlayIndex := loadDescriptionIndexes(
    contentRoot := loadContentPaths().semanticLayer,
    connectionScope := finalConnections
  )
  # overlay 条目须经可信绑定依据盖 boundPhysicalTable；装载失败／单文件损坏 → §6.1 隔离

  sources := assembleCatalogSources(finalSources, manifestIndex, overlayIndex, LIMITS)
  return {
    connections: finalConnections,
    sources: sources,
    examples: existingExamples(finalSources)   # 现状 examples 逻辑，基于最终 sources
  }
```

关键失败分支均须映射到 §7 SC：

| 分支 | 行为 |
|---|---|
| 全局降级 `degradedGlobal` | 空目录；**不**装配 LKG 描述 |
| 身份解析失败 `!resolved.ok` | 空目录 |
| 连接未就绪等现行过滤 | 从最终集合排除；其描述亦不装配进响应（D4a 返回边界） |
| manifest／overlay 单文件损坏 | 受影响 source → 描述／grain 缺失；其它条目正常 |
| 整根装载失败／目录不存在 | 全部描述 `missing`，目录本体仍返回 |
| 描述超配额 | 截前缀 + `truncated`，条目保留 |
| 某 source 无 manifest 条目 | `missing` |
| **绑定失配**（同键、manifest 物理表与 source.table 不等） | `description: null` ＋ `missing`；**不**写 grain；条目保留旧 `table`（D10（1）／SC-16） |
| **Overlay 无法证明归属**（无可信依据／戳缺失／戳与 source 或已校验 manifest 不对齐；含 overlay 先于 manifest 落盘窗口） | **不**写 grain（省略或 null）；已通过 D10（1）的 description 保留；不得把 `G_new` 挂到旧 table（D10（2）／SC-17） |
| 内容根与索引记录不一致 | 整次索引不可用 → 全部描述 `missing`（D10 必要时复核） |
| 不可见 source | **不出现在最终 sources**；其专属描述资产**不装配进任何最终条目**（D4a）；索引阶段允许同连接扫盘 |

---

## 7. 验收（SC-01–SC-17）

| ID | 断言 | 证据形态 |
|---|---|---|
| SC-01 | 可见（D0 最终集合内）source 且绑定一致、manifest 有非空 `descriptions.db`，**且未被截断** → `description` 为**原值**且 `descriptionState: "present"` | 单测（形状契约） |
| SC-02 | 目录条目**既有四字段仍在**，顺序与键名不变 | 形状契约测试 |
| SC-03 | 在**未截断**前提下，`description` 与 manifest 字符串**逐字相等**（含首尾空白；不改写／不摘要／不翻译） | 单测 |
| SC-04 | manifest 无该 source 或 `descriptions.db` 为空／仅空白 → `description: null` ＋ `descriptionState: "missing"` | 单测 |
| SC-05 | `descriptions.ai` **不进入**目录响应（只取 db） | 单测 |
| SC-06 | **D4a 装配隔离**：双身份／同连接夹具。不可见 source 的 `descriptions.db` 写入**专属标记**（仅该不可见资产持有，不出现在任何可见 source 的合法原文中）。断言：（a）最终目录**条目**中不出现不可见 `sourceName`；（b）最终目录 JSON **不出现该专属标记**（证明未错装配）。**禁止**把「可见描述原文合法提及受限名／受限 sourceName 字符串」写成硬失败（D4b） | 单测（越权装配隔离） |
| SC-07 | 目录条目**数量与成员**等于 **D0 现行目录最终可返回集合**（不是 raw `permissions.sources` 数量）；描述不得导致条目丢失或把已过滤连接／source 加回 | 单测（含降级空集、未就绪过滤） |
| SC-08 | 在 O3 数值下：描述字符总量 ≤ 预算；超限条为目标前缀；其后零预算条目按 D6 约定；**条目数不变**；`descriptionState: "truncated"` 出现在截断路径 | 单测（O3 闭合前保持未关闭） |
| SC-09 | 整根缺失／解析失败 → 目录仍正常返回，描述为 `missing`；**单文件损坏不清空**其它 source 描述 | 故障注入单测 |
| SC-10 | 排序仍为 `sourceName.localeCompare`（本条不改排序） | 单测 |
| SC-11 | `lucy_read_source` 等其它工具行为**不受本条影响**（不回归） | 现有用例 |
| SC-12 | `initialize` 的 Visible Scope **不带描述**（体积不膨胀） | 单测 |
| SC-13 | `lint:spec-docs` 对本 Spec／Plan 退出码 0；术语小节形状合规 | 门禁 |
| SC-14 | 有 overlay.grain 的可见 source **且** `overlayBindingsMatch` 通过 → 目录条目携带同等 grain；无 overlay.grain → 按夹具固定的省略／null；grain **不从 manifest** 读取；**manifest 绑定失配或 overlay 无法证明归属时不写 grain** | 单测 |
| SC-15 | 仅空白差异：`descriptions.db` 为 `"  x  "` → trim 判为非空，返回原值 `"  x  "` 且 `present`（未截断时） | 单测 |
| SC-16 | **绑定一致性·快照后改绑（D10（1））**：先取得含 `{key=K, table=T_old}` 的 D0 最终集合快照；同键 K 的 manifest／overlay 改绑到 `T_new` 并写入仅新目标持有的描述专属标记 `M_new`；再对该快照继续装配／读取。断言：响应条目仍为 `table=T_old`；`descriptionState: "missing"`；**不出现** `M_new`；不得把新目标描述挂到旧 table 条目。对照路径：绑定一致时 `M_new`（或匹配描述）可正常出现 | 单测（同键改绑夹具） |
| SC-17 | **绑定一致性·overlay 可信归属（D10（2）／F-R2-01／R3b）**，含两条反例路径＋一条对照：（1）**两次读取之间改绑**：目录快照 `{key=K, table=T_old}`；先读与 `T_old` 匹配的旧 manifest；之后同键改绑为 `T_new` 并写入仅新目标持有的专属 grain 标记 `G_new`；再读新 overlay。断言：条目仍为 `table=T_old`；**不出现** `G_new`。（2）**发布中间态（R3b 时序变体）**：目录与 manifest 仍为 `K → T_old`；**仅**落盘新 overlay（自带 `table → T_new` 与 `G_new`），**新 manifest 未落盘**。断言：旧目录条目仍为 `table=T_old`；**不得出现** `G_new`（禁止用后读旧 manifest 表值给新 overlay 盖戳后写 grain）。（3）**正常绑定对照**：overlay 可信依据、已校验 manifest、`source.table` 三者对齐时，匹配 grain 可正常出现。路径（1）（2）若旧 manifest 仍通过 D10（1），description 可按旧 manifest 装配，但 grain 必须省略／null | 单测（跨文件时序＋专属 grain 标记＋对照） |

全部 SC **已关闭**（2026-11-13 证据审计；vitest `catalog-business-semantics.test.ts` 23/23；O3＝8192）。本条收口不表示可上线。

---

## 8. 风险

| 风险 | 缓解 |
|---|---|
| **装配越权**（为不可见 source 装配描述） | D0＋D4a（返回／装配边界）；SC-06 专属标记／SC-07 以最终集合为基准 |
| **同键改绑错挂描述／grain** | D10（1）manifest 物理表绑定＋D10（2）overlay 可信绑定依据；SC-16／SC-17；必要时内容根复核 |
| **两次读取间／发布中间态错挂 grain** | `boundPhysicalTable` 须来自 overlay 内容可信依据（A／B／C）；**禁止**仅复读 manifest；无法证明不写 grain；SC-17 含「新 overlay 已落盘、新 manifest 未落盘」夹具 |
| **可见描述文本侧信道** | D4b defer 发布侧约束；本条不伪称内容级零泄漏；SC-06 不因合法原文提及受限名失败 |
| **描述载荷膨胀** | D3 只取 db ＋ D6 描述字符预算；SC-08；不宣称整包硬上限 |
| **描述陈旧反而误导** | §6.1 缓存／生效；随发布工作台生效；夹具覆盖更新；D10 补齐快照／文件时序反例 |
| **「有描述」被误读为「有权限」** | 术语 Forbidden；描述不得用于推断权限 |
| **描述缺失被误读为数据缺失** | `descriptionState: "missing"`；术语 Forbidden |
| **与 E8 既有契约冲突** | 只**增**字段；SC-02 |
| **单表多描述取舍** | D3 只取 db |
| **描述覆盖不均**（客户侧未知） | D5 安全回退；覆盖率只观测、不阻塞开工 |
| **降级时 LKG 误装配** | D0 先 `degradedGlobal`；SC-07 |
| **读取器误用 guardrails 丢表** | §6.1 完整可见表集合；SC-14／无列描述夹具 |

---

## 9. 关联

- 清单：P0-2；上一批 P0-1（027，口径绑定）；下一批 P0-3（024，表级门闩）；串联 P0-1／P0-3
- 需求池：[`lucy-20261102-lucy-0-30-0-requirement-pool-plan.md`](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md) REQ-030-023
- 误报防线：[`lucy-20261107-misreport-defense-and-stored-user-experience-plan.md`](../plans/lucy-20261107-misreport-defense-and-stored-user-experience-plan.md) §4.1（G1）、§4.3（G3 互补）
- 核心方向：[`lucy-20261107-lucy-0-30-core-direction.md`](../plans/lucy-20261107-lucy-0-30-core-direction.md) §4.1 约束闸
- 方向参考（未实现）：[`docs/specs/lucy-20261014-concept-dictionary-spec.md`](lucy-20261014-concept-dictionary-spec.md)；[`docs/plans/wo-20261014-concept-dictionary.md`](wo-20261014-concept-dictionary.md)
- Plan：[`lucy-20261107-catalog-business-semantics-plan.md`](../plans/lucy-20261107-catalog-business-semantics-plan.md)
- Codex 对抗评审（过程，含 R1／R2／R3；**非终稿确权**）：[`docs/reviews/2026-11-08-catalog-business-semantics-codex-review.md`](../reviews/2026-11-08-catalog-business-semantics-codex-review.md)
