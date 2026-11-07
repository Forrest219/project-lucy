# Lucy Catalog 业务语义暴露 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能设计草案 / **v0.2-draft** |
| 日期 / 目标版本 | 2026-11-07 / 产品线 `0.30.0`（分支 `lucy-v0.30`）。不进入 `v0.25` 升级台账，不占用 `L25-*` |
| 台账号 | 无（0.30 台账未建立） |
| 功能编号 / 优先级 | 清单 **P0-2**；需求池 **REQ-030-023** / **P0** |
| 状态 | **v0.2-draft，待严格评审／验收；冻结落地；未授权实现**。已并入 0.30 批次第 1 轮评审（形式合规 ＋ 事实性）并已修订；待 0.30 批次第 2 轮对抗式评审。分批 Spec 已批准撰写；委托人裁定本阶段**暂不开工实现**。须过对抗式评审 + O1／O2／O3 闭合 + **另授开发授权** 后才可改代码。本条不表示可上线 |
| 授权边界 | 本文件**不授权改代码**。现行阶段只接受评审与修订。实施须：§评审门禁 R1–R4（见功能清单池 §2.2）全部通过 |
| 决策来源 | 2026-11-06 CFO 误报事故 ＋ 2026-11-07 客户沟通实录（翊总／田总）：「AI 取数取错了表」；第二轮沟通自述「**表一多，AI 自己不知道该选哪张**」 |
| 需求来源 | [需求池 REQ-030-023](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md)；[误报防线 §4.1 G1](../plans/lucy-20261107-misreport-defense-and-stored-user-experience-plan.md)；[功能清单池 P0-2](../plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md)；[核心方向 §4.1 约束闸](../plans/lucy-20261107-lucy-0-30-core-direction.md) |
| 实施主体 | Lucy：MCP Proxy 目录装配层。**不改 KTX 源码**；不改 ACL 裁决口径；不把语义裁判塞进 ACL |
| 配套 Plan | [lucy-20261107-catalog-business-semantics-plan.md](../plans/lucy-20261107-catalog-business-semantics-plan.md) |
| 评审记录 | [第 1 轮评审记录](../reviews/2026-11-07-lucy-0-30-spec-plan-review-round1.md)（第 1 轮：形式合规 ＋ 事实性核验，13 块分块；**评审通过并另获开发授权后方可改代码**） |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」「功能闭口与发布取证」「伪代码」 |
| 与既有 Spec 的关系 | **串联，不吞并。** 表级歧义门闩属 REQ-030-024／P0-3（选错表时怎么办）；本条只解决「Agent 选表**之前**拿不到业务语义」。口径绑定属 REQ-030-027／P0-1（命中之后不得自行加工口径）。本条是**约束闸的输入侧**，不替代任何一条。另与 REQ-030-012／P0-A（语义层 Source 级字段暴露裁剪）**不冲突但相邻**：012 是**列级**裁剪（catalog 现行不返回列），本条是**表级**描述元数据；012 已规定「若后续 `lucy_catalog` 增加列预览，必须复用同一暴露集读取器，不得另起一套裁剪口径」——本条**不返回任何列**，该约束不触发；若后续要返回列或列样例，须先回 012 复用其暴露集读取器 |

## 闭口层级

- 层级：功能合同
- 本条承诺：`lucy_catalog`（及等价目录工具）对调用者**可见**的每个 source，除既有 `connectionId / schema / sourceName / table` 外，**携带该 source 的业务描述**（含粒度），使 Agent 不必再靠表名字符串相似度猜测表义；描述缺失时按既定规则回退且**显式标注缺失**；目录响应体积受硬上限约束。
- 本条出口：SC-01–SC-13（见 §7）。描述装配纯函数单测；目录响应形状契约测试；可见性裁剪与越权名不泄漏断言；体积上限截断断言；`lint:spec-docs` 通过。
- 不在本条出口：表级多表命中门闩（P0-3）、口径绑定（P0-1）、答复可核对块（P0-4）、Eval 选表断言（P0-6）、catalog 检索式入参（见 **O1**，首期不做）、同义词词典（见 **O2**，首期不做）、客户现场语义层描述覆盖率本身、镜像／部署／上线。
- 上线关系：本条收口不表示可上线

---

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- Source Description：中文主称「来源描述」。指语义层为某个 source 发布的**业务含义**文本，来源为 `_schema/<schema>.yaml` 的 `tables.<sourceName>.descriptions.{db,ai}`；运行时该对象还有第三个键 `human`（`AuthoredText{db?,ai?,human?}`，`webui/server/model.ts:3-7`、`webui/server/semantic-layer.ts:400`）——**首期只取 `db`**，不引入 `ai`／`human`。
- Source Grain：中文主称「来源粒度」。指该 source 的事实粒度说明（如「一行＝一台设备 × 一天」），取自语义层 `grain`。
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

---

## 1. 背景与取证

### 1.1 事故与自述

沟通实录第二轮，委托人自述根因：

> 「之前我们主要是把数据接进来，现在正在做的是让 AI 把数问对。**表一多，AI 自己不知道该选哪张，这次就是选错了**。」

⇒ 本条要解决的是**选表的信息不足**，不是选表的强制力（后者属 P0-3）。

### 1.2 现行缺口（已核实）

| # | 事实 | 证据 |
|---|---|---|
| E1 | `lucyCatalog` 的 source 条目只有四个字段：`connectionId / schema / sourceName / table`——**无描述、无粒度、无业务域** | `webui/server/proxy/acl.ts:1986-1990` |
| E2 | 目录条目排序键只有 `sourceName.localeCompare`——**纯字母序，无相关性** | `webui/server/proxy/acl.ts:2007-2015` |
| E3 | **描述在语义层已存在**：`_schema/<schema>.yaml` 的 `tables.<sourceName>.descriptions.{db,ai}`；本仓实测 **18/18 非空**（demo-mysql 3 ＋ lucy-ops 12 ＋ mysql-aliyun 3＝18 个 source／18 个表级 `descriptions.db` 非空）。⚠️ **副本不计**：`config/semantic-layer/lucy-ops/_schema/main.yaml` 与 `semantic-layer/lucy-ops/_schema/main.yaml` 逐字相同，重复计数会把分母虚增到 30 | `semantic-layer/mysql-aliyun/_schema/dataforai.yaml:169-171`；`semantic-layer/*/_schema/*.yaml`（本仓实测统计） |
| E4 | 目录组装只读 `permissions.sources`（编译后的 ACL 结果），**不读 manifest** ⇒ E3 的描述从不进入目录响应 | `webui/server/proxy/acl.ts:1996-2015` vs `_schema/*.yaml` |
| E5 | 歧义目录加载器同样只抽**名字**：`SourceYaml` 类型**连 description 字段都没有**，`namesOf` 只取 name | `webui/server/proxy/query-guardrails.ts:42-46`、`:59-65`、`:113-121` |
| E6 | `lucy_catalog` 的 `inputSchema.properties = {}`——**不能传查询词**，目录无法当检索／推荐用 | `webui/server/proxy/mcp-proxy.ts:930-940` |
| E7 | `initialize` 注入的 Visible Scope 每行同样只有四元组 | `webui/server/proxy/mcp-proxy.ts:1845-1847`（四元组模板 `connectionId.schema.sourceName -> table`）；`:1900-1901` 只是 "Sources:" 标题与其展开，**不是**四元组模板 |
| E8 | 运行时目录形状被**刻意固定为只暴露 ID**（测试断言 catalog JSON 不含其它域名字样） | `webui/server/__tests__/kx-acl.test.ts:646-663` |
| E9 | 数据库侧已有物理表注释采集（`table_comment`），可作描述兜底源 | `webui/server/live-tables.ts:73-81` |
| E10 | 元数据侧信道风险已被预警：描述进 prompt 须先过可见性裁剪 | `docs/specs/lucy-20261014-concept-dictionary-spec.md:38`（不得成为元数据侧信道）、`:149`（§7 ACL Consistency 侧信道防护）；⚠️ 同文件 `:13` 是**状态行**，不支撑该主张。三档门控与 "Ignorance is Bliss" 见 `docs/plans/wo-20261014-concept-dictionary.md:76-81` |

### 1.3 取证缺口（不得当事实）

- **客户现场 `_schema` 描述覆盖率未知**：本仓 30/30 是 demo/ops 口径，**不覆盖客户 `asset_finance`**。⇒ 不得假设客户侧也全覆盖；**描述缺失必须可安全回退**（见 D5）。
- KTX 上游 `sl_read_source` 是否已返回描述：**未取证**（Proxy 只做透传）。若上游已返回，本条价值降级为「代理层补齐目录面」，不重复造。
- 客户侧是否有其它目录工具（非 `lucy_catalog`）承载描述：**未取证**。

---

## 2. 目标

1. 目录对**可见** source 携带业务描述与粒度，使 Agent 无需靠表名猜测。
2. 描述**按 source 绑定可见性**：不可见 source 的描述**绝不**出现在响应中（E10 纪律）。
3. 描述缺失时**安全回退且显式标注**，Agent 与运维都能区分「无描述」与「未装配」。
4. 目录响应**体积有硬上限**，描述不得把响应撑爆。
5. **只增不改**：既有四字段与既有调用方行为不变。

---

## 3. 非目标

| 不做 | 原因 |
|---|---|
| 把描述做成 ACL 授权依据 | 职责边界（G4）：ACL 答「有没有权」，描述答「这是什么表」 |
| 运行时用描述做语义裁决 | 那是 P0-1（口径绑定）与 P0-3（表级门闩）的职责 |
| 首期给 catalog 加检索入参 | 见 O1；首期目录是「清单」不是「检索器」 |
| 首期引入同义词词典 | 见 O2；需 KTX 上游合同配合 |
| 描述覆盖率作发布硬门禁 | 首期只观测；语义层治理不应阻塞发布 |
| 修改客户现场语义层描述内容 | 本条只负责**暴露**；内容治理另议 |
| 自动生成描述 | 描述必须是人写的业务含义；自动生成会把猜测变成"事实" |

---

## 4. 设计决策

| 编号 | 决策 | 状态 |
|---|---|---|
| **D1** | 描述来源为**语义层 `_schema/<schema>.yaml` 的 `descriptions.db`（主）与 `descriptions.ai`（辅）**，Proxy 只做读取与装配，**不改写文案** | **冻结** |
| **D2** | 目录条目新增字段：`description`（主描述文本）、`grain`（可选）、`descriptionState`（`present` / `missing`）。既有四字段保留 | **冻结** |
| **D3** | **只暴露 `descriptions.db`**（业务中文描述）；`descriptions.ai` 保留在语义层但不进目录响应——避免同表双描述导致 Agent 取舍困难，并减小体积 | **冻结**；见 O3 |
| **D4** | 可见性纪律：描述随 **source 绑定**——只有出现在 `permissions.sources` 中的 source 才可能带描述。**不在目录中出现过的 source，其描述也不得出现**（不列举不可见表名） | **冻结** |
| **D5** | 描述缺失 → `description: null` + `descriptionState: "missing"`，**不静默回退为物理表名伪装成描述**；目录条目其余字段照常返回 | **冻结** |
| **D6** | 体积上限：目录响应中描述总长度设硬上限（见 O3），超限按**条目顺序**截断描述尾部，并对被截断条目标注 `descriptionState: "truncated"`；**条目本身不得被丢弃**（丢条目＝隐藏可见表） | **冻结** |
| **D7** | **首期不改变排序**：仍为 `sourceName.localeCompare` 字母序。本条只补信息，不补排序——排序属「相关性」问题，须在有检索入参（O1）后才有意义 | **冻结** |
| **D8** | `initialize` 的 Visible Scope **保持现状**（不带描述）：它是每次会话的固定 preamble，带描述会放大 initialize 体积。选表语义由 `lucy_catalog` 承担 | **冻结**；见 O3 |
| **D9** | 与 P0-1 口径绑定**共用同一套「可见 source 语义投影」装配**，但字段集不同（口径绑定读绑定资产，本条读 manifest 描述） | **冻结** |
| **O1** | 是否给 `lucy_catalog` 增加可选检索入参（如 `q`）做命中排序／过滤 | **开工前必答** |
| **O2** | 是否在语义层引入 `synonyms` 字段（需 KTX 上游合同配合） | **开工前必答** |
| **O3** | 描述长度上限的具体数值；是否把 `descriptions.ai` 与 `grain` 一并纳入（体积代价） | **开工前必答** |

> **开放决策守卫（本条统一，2026-11-07）**：本条所有 **O 项（开工前必答）在闭合前不得实现对应分支**——缺省一律 fail-closed（该分支不实现、依赖它的 SC 保持未关闭、不得以「评审已通过」当作已闭合）。闭合须由**委托人（PM）**在**开发授权前**书面裁定，并回写本表 O 行的状态格；**评审通过 ≠ O 项闭合**；未闭合即开工的，视为越权实现。


---

## 5. 数据模型（Normative）

### 5.1 描述来源（语义层既有，本条只读）

```yaml
# ① Manifest：semantic-layer/<connection>/_schema/<schema>.yaml  — 既有形状，本条不改
tables:
  <sourceName>:
    table: <physical_table>
    descriptions:
      db: "Demo 超市订单 ODS 明细表"      # 主描述（中文业务含义）
      ai: "Demo superstore order line items..."   # 辅描述（不进入目录响应，见 D3）
      human: "……"                        # ⚠️ 运行时存在第三键 AuthoredText.human
                                            #   （webui/server/model.ts:3-7、semantic-layer.ts:400）；
                                            #   **首期仍只取 db**，此处仅注明其存在
# ⚠️ Manifest 里**没有也不该有** grain/measures/segments —— 写进去会被硬失败：
#    catalog-assets.ts:492-499 的 classifyYaml 对 `grain`／`measures`／`segments`
#    返回 OVERLAY_FIELD_IN_MANIFEST「应写入 semantic overlay，不应写入 Schema Manifest」。

# ② Overlay：semantic-layer/<connection>/<source>.yaml  — 粒度写在这里
name: <sourceName>
grain: ["order_id", "order_date"]        # 粒度属 overlay 字段
#   本仓实例：semantic-layer/lucy-ops/ops_calls.yaml:7-8
#   运行时取值：overlay.grain ?? record.grain（webui/server/semantic-layer.ts:389）
#   ⇒ 本条要装配 grain，必须读 **overlay**，不能从 manifest 取。
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
      "description": "Demo 超市订单 ODS 明细表",   // 缺失时为 null
      "descriptionState": "present"                 // present | missing | truncated
      // "grain": ["order_id", "order_date"]         // 可选，见 O3
    }
  ],
  "examples": ["..."]
}
```

装配规则：

1. 只对**调用者可见**的 source 装配描述（D4）。描述与 source **同生共死**——不可见即不出现。
2. `description` 取 `descriptions.db`，**原样透传**，不改写、不摘要、不翻译（D1）。
3. `descriptions.db` 为空／缺失 → `description: null` ＋ `descriptionState: "missing"`（D5）。
4. 描述长度超上限 → 截断尾部 ＋ `descriptionState: "truncated"`（D6）。
5. **条目不得因描述被丢弃**——目录必须完整列出可见 source。

---

## 6. 核心流程（伪代码）

```text
# ── 装配侧（纯函数，便于单测） ──
function assembleSourceEntry(source, manifestEntry, budget):
  # source: permissions.sources 的一条（已过 ACL）
  # manifestEntry: _schema 中同名 source 的定义，可能为 null
  # budget: 剩余描述长度配额（可变引用）

  entry := {
    connectionId: source.connectionId,
    schema: source.schema,
    sourceName: source.sourceName,
    table: source.table
  }

  raw := manifestEntry?.descriptions?.db      # 只取 db（D3）；ai 不进响应
  if raw is null or trim(raw) == "":
    entry.description := null
    entry.descriptionState := "missing"      # D5：不伪装成描述
    return entry

  text := trim(raw)
  if length(text) > budget.remaining:
    text := truncate(text, budget.remaining)  # D6：截尾，不丢条目
    entry.descriptionState := "truncated"
  else:
    entry.descriptionState := "present"

  budget.remaining -= length(text)
  entry.description := text
  if manifestEntry?.grain and O3.includesGrain:
    entry.grain := manifestEntry.grain
  return entry


function assembleCatalogSources(visibleSources, manifestIndex, overlayIndex, limits):
  # visibleSources: permissions.sources（已过 ACL，可见性由 ACL 保证）
  # manifestIndex: **connectionId.schema.sourceName** → manifestEntry（来自 _schema 装配，不含不可见项）
  #   ⚠️ 键必须含连接与 schema：permissions.sources 的键含 connectionId/schema
  #      （webui/server/proxy/acl.ts:2010-2013），只按 sourceName 建键会让
  #      demo-mysql 与 mysql-aliyun 的同名 source（superstore_orders／people／returns）互相覆盖。
  # overlayIndex: 同一键 → overlay 记录（grain 在此，**不在 manifest**）
  budget := { remaining: limits.maxTotalDescriptionChars }
  entries := []
  for source in sortedBy(visibleSources, sourceName.localeCompare):   # D7：排序不变
    key := source.connectionId + "." + source.schema + "." + source.sourceName
    entries.push(assembleSourceEntry(source,
                                      manifestIndex.get(key),
                                      overlayIndex.get(key),      # grain 来自 overlay
                                      budget))
  return entries


# ── 运行时侧 ──
on lucy_catalog(args, identity):
  resolved := effectivePermissions(identity)
  if not resolved.ok:
    return { connections: [], sources: [], examples: [] }      # 现状不变

  manifestIndex := loadManifestDescriptions(resolved.permissions.connections)
  # ↑ 只为可见连接装载；装载失败 → 空索引（描述缺失），不失败整个目录

  sources := assembleCatalogSources(resolved.permissions.sources, manifestIndex, LIMITS)
  return { connections: resolved.permissions.connections, sources: sources, examples: existingExamples(...) }
```

关键失败分支均须映射到 §7 SC：

| 分支 | 行为 |
|---|---|
| manifest 装载失败／目录不存在 | 描述缺失回退（`missing`），**目录本体仍正常返回** |
| 描述超配额 | 截尾 + `truncated`，条目保留 |
| 某 source 无 manifest 条目 | `missing` |
| 不可见 source | **不出现在 sources 中**，其描述亦不出现 |
| 连接未就绪 | 沿用现状过滤（`acl.ts:2000-2006`），本条不改 |

---

## 7. 验收（SC-01–SC-13）

| ID | 断言 | 证据形态 |
|---|---|---|
| SC-01 | 可见 source 且 manifest 有非空 `descriptions.db` → 目录条目含 `description` 原文与 `descriptionState: "present"` | 单测（形状契约） |
| SC-02 | 目录条目**既有四字段仍在**，顺序与键名不变 | 形状契约测试 |
| SC-03 | 描述为**原文透传**：装配结果与 manifest 字符串逐字相等（不改写／不摘要／不翻译） | 单测 |
| SC-04 | manifest 无该 source 或 `descriptions.db` 为空 → `description: null` ＋ `descriptionState: "missing"` | 单测 |
| SC-05 | `descriptions.ai` **不进入**目录响应（只取 db） | 单测 |
| SC-06 | **不可见 source 的描述不泄漏**：可见目录响应全文不含不可见 source 的名称与描述文本 | 单测（越权名断言） |
| SC-07 | 目录条目**数量**等于可见 source 数量（描述不得导致条目丢失） | 单测 |
| SC-08 | 描述总量超上限 → 超限条目 `descriptionState: "truncated"`，且**条目数不变** | 单测 |
| SC-09 | manifest 装载失败（目录缺失／解析失败）→ 目录仍正常返回，全部描述为 `missing` | 故障注入单测 |
| SC-10 | 排序仍为 `sourceName.localeCompare`（本条不改排序） | 单测 |
| SC-11 | `lucy_read_source` 等其它工具行为**不受本条影响**（不回归） | 现有用例 |
| SC-12 | `initialize` 的 Visible Scope **不带描述**（体积不膨胀） | 单测 |
| SC-13 | `lint:spec-docs` 对本 Spec／Plan 退出码 0；术语小节形状合规 | 门禁 |

全部 SC **未执行**。本条收口不表示可上线。

---

## 8. 风险

| 风险 | 缓解 |
|---|---|
| **元数据侧信道**（描述泄漏不可见对象） | D4 硬纪律：描述与 source 同生共死；SC-06 断言响应全文不含不可见名 |
| **目录体积膨胀** | D3 只取 db ＋ D6 硬上限；SC-08 断言截断行为 |
| **描述陈旧反而误导** | 描述由语义层发布，**随发布工作台生效**；本条不引入独立缓存真相源 |
| **「有描述」被误读为「有权限」** | 术语 Forbidden 明写；描述不得用于推断权限；SC-06 兜底 |
| **描述缺失被误读为数据缺失** | `descriptionState: "missing"` 显式区分；术语 Forbidden 明写 |
| **与 E8 既有契约冲突**（catalog 刻意只暴露 ID） | 只**增**字段不改既有断言；SC-02 要求四字段与顺序不变 |
| **单表多描述取舍** | D3 只取 db，`ai` 不进响应；见 O3 |
| **描述覆盖不均**（客户侧未知） | D5 安全回退 ＋ 描述覆盖率只观测不阻断 |

---

## 9. 关联

- 清单：P0-2；上一批 P0-1（027，口径绑定）；下一批 P0-3（024，表级门闩）；串联 P0-1／P0-3
- 需求池：[`lucy-20261102-lucy-0-30-0-requirement-pool-plan.md`](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md) REQ-030-023
- 误报防线：[`lucy-20261107-misreport-defense-and-stored-user-experience-plan.md`](../plans/lucy-20261107-misreport-defense-and-stored-user-experience-plan.md) §4.1（G1）、§4.3（G3 互补）
- 核心方向：[`lucy-20261107-lucy-0-30-core-direction.md`](../plans/lucy-20261107-lucy-0-30-core-direction.md) §4.1 约束闸
- 方向参考（未实现）：[`docs/specs/lucy-20261014-concept-dictionary-spec.md`](lucy-20261014-concept-dictionary-spec.md)；[`docs/plans/wo-20261014-concept-dictionary.md`](wo-20261014-concept-dictionary.md)
- Plan：[`lucy-20261107-catalog-business-semantics-plan.md`](../plans/lucy-20261107-catalog-business-semantics-plan.md)
