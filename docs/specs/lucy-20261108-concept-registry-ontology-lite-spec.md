# Lucy 轻量概念注册表（ontology-lite）Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能 Spec／**v0.2-draft** |
| 日期 / 目标版本 | 2026-11-08 / 产品线 `0.30.0`（分支 `lucy-v0.30`）；**P1 辅线，不挡原 P0**；不进入 `v0.25` 台账 |
| 台账号 | 无（0.30 台账未建立） |
| 功能编号 / 优先级 | 清单 **P1-10**；需求池 **REQ-030-031**／**P1** |
| 状态 | **v0.2-draft，头脑风暴设计已批准；2026-11-08 已入 0.30 清单／需求池；交付序＝CLI→效果门→WebUI→MCP；待严格评审／验收；终稿未确权；冻结落地；未授权实现**。本条不表示可上线 |
| 授权边界 | 本文件**不授权改代码**。入池 ≠ 立项实现。实现须：Plan → 终稿确权（§2.2）→ 委托人明确开发授权 |
| 决策来源 | 2026-11-08 头脑风暴：指标权威解释面 × 知识图谱／本体论是否值得；结论＝不做形式化 KG／OWL，做轻量概念注册表；人审优先、MCP 更后。**交付序（同日确认）**：先 CLI 跑通并验证效果，效果可接受后再做 WebUI 人审页 |
| 需求来源 | [需求池 REQ-030-031](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md)；[功能清单池 P1-10](../plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md)；对话结论（选错表／口径加工为最贵失败；缺口＝人审权威面 + 自动冲突发现；CLI 先） |
| 实施主体 | Lucy：内容根概念注册表 + **一期 CLI** 扫描／人审。**不改 KTX 源码**；不替代 semantic-layer 计算语义；**一期不改 WebUI** |
| 配套 Plan | 未开。设计批准后按 `writing-plans` 另开；未开 Plan 不得开工 |
| 评审记录 | 无（头脑风暴设计批准 ≠ 终稿确权） |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」「功能闭口与发布取证」「伪代码」 |
| 与既有 Spec 的关系 | **串联，不吞并、不替代。** 0.30 约束闸（口径绑定 P0-1／catalog 业务语义 P0-2／歧义门闩 P0-3）仍是选表与口径运行时主杠杆；本条提供概念权威与冲突治理面，一期不注入 MCP 热路径。不做独立指标计算平台 |

## 变更记录

| 版本 | 说明 |
|---|---|
| v0.1-draft | 头脑风暴设计落盘：目标／非目标、Concept／Binding／Conflict 模型、一期扫描与人审流程、成功标准与二期边界 |
| v0.2-draft | 补「WebUI 影响」专节；交付序改为 **CLI 先验证 → 效果可接受后再上 WebUI 人审页**；一期对 WebUI **零变更**；WebUI 与 MCP 均不在一期出口。同日登记入池：**清单 P1-10／REQ-030-031**（入池 ≠ 开发授权） |

---

## 闭口层级

- 层级：功能合同
- 本条承诺：从现有 semantic-layer 与 Wiki **派生**业务概念候选与冲突；人经 **CLI** 指定权威解释（canonical + summary）；机器**不得**自动裁定权威；一期不改变 `lucy_query`／选表门闩／口径绑定的运行时行为；**一期不改变任何用户可见 WebUI 表面**。
- 本条出口：试点概念（至少「收入」「资产」）经 CLI 可复核盘点；冲突状态可见；权威指定不被扫描覆盖；`rejected` 可保留；自动化能打假「机器覆盖权威」「无证据候选」「双 canonical」；WebUI 相关文件无本功能引入的产品行为变更（一期）。
- 不在本条出口：WebUI 人审页（效果门通过后另开／升版）；形式化知识图谱／OWL；统一指标计算与下发；MCP 注入；准备率数值提升承诺；上线／发布取证；宣称 0.30 核心主线因此完成。
- 上线关系：本条收口不表示可上线

---

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- Concept：中文主称「业务概念」。跨表／跨文件收敛的业务词（如收入、资产），不是物理表名，也不是一次查询结果。
- Concept Registry：中文主称「概念注册表」。存放 Concept、Binding、权威状态的薄层资产（建议内容根 `concepts/`）。
- Binding：中文主称「概念绑定」。Concept 与既有语义／Wiki／（可选）Skill 的一次出现关系，含证据与角色。
- Canonical Binding：中文主称「权威绑定」。人指定的、该 Concept 当前唯一权威出现；空表示尚未定权威。
- Conflict：中文主称「概念冲突」。派生状态（如未定权威的多候选、别名重叠、权威悬空），可计算不必强持久化。

Forbidden:

- 把本条写成「知识图谱」「本体论平台」「指标平台」作为对外主称——易造成完整 KG／统一计算的预期。
- 把机器 `confidence` 写成「权威」。
- 把 Concept Registry 当作度量公式或查询执行的第二真相源——计算语义仍只信 semantic-layer overlay。
- 用「元数据仓库」作主术语替代「概念注册表」。

落位：术语属内容治理／语义相邻；实现前补术语标准分区条目。机器可读字段名保持 `translate="no"`。

---

## 1. 背景与判断

### 1.1 要回答的问题

传统指标平台用统一注册与计算收敛口径。Lucy 已有大量语义与 Wiki，不必另建指标平台；但需要从既有资产抽出**可复核的权威解释面**（例如：问「收入／资产」时有多少表、多少语义约定）。

另行讨论知识图谱／本体论对准备率与 MCP 效果时，对齐结论：

| 失败类型 | 形式化 KG／OWL | 轻量概念注册表 |
|---|---|---|
| A 选错表 | 非最短路径；0.30 约束闸为主 | 可提供概念→候选 source 清单，一期不直接裁判 |
| B 口径被加工 | 非最短路径；固定口径绑定为主 | 权威 summary／canonical 供人审与二期 Agent |
| 人审权威面 + 自动挖冲突 | 过重 | **本条主目标** |

### 1.2 方案选择（已批准）

- **采用**：方案 2 — ontology-lite 概念注册表；人审优先，MCP 二期。
- **不采用**：方案 3 — Neo4j／RDF／OWL 正式图谱（现期 ROI 不足）。
- **不采用单独做**：方案 1 仅扫描报告（可作实现切片，但合同目标仍是可持久的注册表 + 权威状态）。

---

## 2. 目标与非目标

### 2.1 目标（一期）

1. 自动扫描 semantic-layer 与 Wiki，提议 Concept／Binding 与 Conflict。
2. 人指定 canonical、撰写／修订 summary、拒绝误挂。
3. 试点概念盘点可复核（绑定数量、证据、点回源资产）。
4. 扫描可更新 candidate，**不得**覆盖人设权威与 `rejected` 结论（除非人显式重置）。

### 2.2 非目标（一期）

- WebUI 人审页、新路由、导航入口、为本功能新增的浏览器 API（效果门前一律不做）。
- 独立指标计算平台／统一计算引擎／指标审批流。
- 形式化知识图谱、OWL 推理、多跳实体问答引擎。
- 替换或旁路 0.30 P0-1／P0-2／P0-3。
- MCP initialize／工具注入。
- 机器自动裁定 canonical。
- 全库无白名单地自动新建全部 Concept（噪声不可控）。

---

## 3. 设计决策

| 编号 | 决策 | 理由 |
|---|---|---|
| D1 | 持久化 Concept + Binding；Conflict 可派生计算 | 权威状态需稳定；冲突随扫描变化 |
| D2 | 落位建议内容根 `concepts/`，随内容备份；扫描报告可落 `inbox/` | 与语义资产同运维域；过程产物可删 |
| D3 | 不把权威状态写回每条 overlay 当第二公式源 | 避免双源真理；overlay 仍是计算语义 |
| D4 | 同一 Concept 最多一条 `role=canonical` | 权威唯一；空 = 尚未定权威（显式，不假装收敛） |
| D5 | 扫描只产生／更新 `candidate`；人设 `canonical`／`rejected` 受保护 | 机器提议、人裁定 |
| D6 | 交付序固定：**CLI 一期 →（效果门）→ WebUI 人审页 → MCP 注入**；不得跳过效果门先做 WebUI | 2026-11-08 委托人确认：先跑 CLI，效果可以再放 WebUI |
| D7 | 试点白名单概念起步（至少收入、资产） | 控制噪声与人审成本 |
| D8 | 一期不改变 MCP 查询／选表／口径绑定热路径行为 | 与 0.30 主线解耦；避免未授权运行时副作用 |
| D9 | 对外主称「概念注册表／口径权威面」，不用「知识图谱」作主称 | 预期管理 |
| D10 | 已入池（P1-10／031）；未终稿确权／未开发授权前不排期实现 | 入池 ≠ 可改代码；不挡原 P0 |
| D11 | 一期对 WebUI **零变更**（无新路由、无导航、无 API 给人审页用） | 先验证注册表／扫描价值，避免未证明效果就铺 UI |
| D12 | WebUI 形态预留为瘦身管理端「概念权威」页（列表／定权威／summary／reject）；**不**默认塞进发布工作台 | 效果门通过后另开 Spec 升版或跟进条；本条只冻结预留，不实现 |

---

## 4. 数据模型

### 4.1 Concept

| 字段 | 含义 |
|---|---|
| `id` | 稳定键（如 `revenue`、`total_assets`） |
| `label` | 主显示名（中文优先） |
| `aliases` | 别名列表 |
| `status` | `draft` \| `active` \| `deprecated` |
| `canonical` | 权威 Binding id；可空 |
| `summary` | 给人看的权威解释短文 |
| `domain` | 可选业务域标签 |

### 4.2 Binding

| 字段 | 含义 |
|---|---|
| `bindingId` | 稳定 id |
| `kind` | `measure` \| `source` \| `wiki` \| `skill`（一期主做前三者） |
| `ref` | 指向现有资产的指针 |
| `evidence` | 命中依据（可点回） |
| `confidence` | 机器置信；≠ 权威 |
| `role` | `candidate` \| `canonical` \| `rejected` \| `related` |

### 4.3 Conflict（派生示例）

- `needs_authority`：≥2 高置信 candidate 且未定 canonical
- `possible_merge`：两 Concept 别名重度重叠
- `broken_canonical`：canonical 指向的 ref 已从语义／Wiki 消失

---

## 5. 核心流程（伪代码）

### 5.1 Concept Scan（CLI／离线）

```text
# 输入：内容根、概念白名单（一期必填）
# 输出：更新 concepts/ 中 candidate；写 CLI 可读报告；不改 canonical／rejected

function scanConcepts(contentRoot, whitelist):
  assets = readSemanticLayer(contentRoot) + readWiki(contentRoot)
  proposals = []
  for asset in assets:
    for hit in matchAliases(asset, whitelist):
      if hit.evidence is empty:
        skip  # 无证据不算候选
      proposals.append(BindingProposal(hit))

  for conceptId in groupByConcept(proposals):
    registry = loadOrCreateConcept(conceptId)
    for p in proposals[conceptId]:
      if existing.role in {canonical, rejected} and sameRef(existing, p):
        keep human role; maybe refresh evidence only if policy allows
      else:
        upsert candidate binding
    conflicts = deriveConflicts(registry)
    writeRegistry(registry)
    appendReport(conflicts)
  assert no automatic canonical assignment
```

### 5.2 人审定权威（一期 = CLI）

```text
# 一期仅 CLI 子命令（示意）：list / show / set-canonical / reject / summary
# 不提供 WebUI 写路径

function setCanonical(conceptId, bindingId, summary):
  c = loadConcept(conceptId)
  assert bindingId in c.bindings
  clear other bindings' role from canonical -> candidate (unless rejected)
  binding.role = canonical
  c.canonical = bindingId
  c.summary = summary
  save(c)

function rejectBinding(conceptId, bindingId):
  binding.role = rejected
  if c.canonical == bindingId:
    c.canonical = null
  save(c)
```

### 5.3 一期运行时边界

```text
# MCP / lucy_query / 歧义门闩 / 口径绑定：一期不读取 concepts/
# WebUI：一期无读取、无写入、无导航入口（D11）
# 反哺：人可手工把结论写回 Wiki、overlay 描述或 P0-1 绑定候选——不在本条自动完成
```

---

## 6. 交付分期与效果门

| 阶段 | 交付 | 进入条件 |
|---|---|---|
| **一期（本条出口）** | `concepts/` 注册表 + CLI：scan／list／show／set-canonical／reject／summary + 报告 | 清单＋终稿确权＋开发授权 |
| **效果门（人工）** | 试点「收入／资产」人审后判定：冲突是否可懂、噪声是否可接受、权威是否值得保留 | 一期 SC 通过后由委托人判定「效果可以」 |
| **WebUI 跟进** | 瘦身管理端「概念权威」人审页（见 §6.1 预留） | **效果门通过**后另开／升版 Spec，并走交互合同 |
| **MCP 跟进** | canonical／冲突摘要注入 | WebUI 或等价人审路径稳定后，再开条 |

一期交付面一览：

| 面 | 一期 | 说明 |
|---|---|---|
| CLI 扫描 + 人审写操作 | 要 | 本条主表面 |
| 注册表资产 `concepts/` | 要 | 与语义同内容根域 |
| WebUI | **不要** | 零变更（D11） |
| MCP 注入 | 不要 | 更后 |
| 与 0.30 硬约束自动联动 | 不要 | 人可手工反哺 |

### 6.1 WebUI 影响（明示）

**一期（本条）对 WebUI 的影响：无。**

| 类别 | 一期 | 说明 |
|---|---|---|
| 路由／导航／菜单 | 不新增、不修改 | 无「概念权威」入口 |
| 页面／组件 | 不新增、不修改 | 不改发布工作台、语义相关页、问答页、MCP 调试台 |
| 浏览器可调 API | 不为本功能新增 | 人审写路径只走 CLI |
| 文案／空态／权限模型（WebUI） | 不变 | — |
| Design System／交互合同 | 一期不适用 | 无用户可见 WebUI 表面变更；WebUI 跟进条再触发交互合同与 DS 合规 |

**效果门通过后的 WebUI 预留（非本条实现、非本条出口）：**

- 独立管理端「概念权威」页：概念列表、冲突标记、binding／证据、指定 canonical、编辑 summary、reject
- 角色：管理员／内容治理；不问数用户默认暴露未授权 source 的绑定细节
- **不**默认嵌入发布工作台核心流（D12）
- 须另开／升版 Spec：补路由、交互合同、元素清单、Design System Compliance

**为何先 CLI：** 用最低成本验证「自动盘点 + 人定权威」是否真能降低口径混乱；未证明前不把治理台做进 WebUI。

---

## 7. 成功标准（试点）

试点概念至少包含 **收入**、**资产**：

| 编号 | 标准 |
|---|---|
| SC-01 | 每个试点 Concept 经 CLI 可列出 binding 数、kind、证据，并点回源资产路径 |
| SC-02 | 未定权威且多高置信候选时出现 `needs_authority` |
| SC-03 | CLI 人设 canonical + summary 后，再扫描不清除、不改写权威指向 |
| SC-04 | `rejected` 保留；可选「已拒绝不重复告警」 |
| SC-05 | 一期不改变 `lucy_query`／选表门闩／口径绑定行为（契约或差分可证） |
| SC-06 | 无证据的命中不得写入 candidate |
| SC-07 | 同一 Concept 无法稳定存在两条 `role=canonical` |
| SC-08 | 一期变更不包含 WebUI 产品行为（无新路由／导航／本功能浏览器 API） |

观测（非硬门禁）：已定权威比例、冲突可读性、CLI 人审耗时、噪声比。**不**把准备率提升写为一期出口。  
**效果门**（非自动化 SC）：委托人基于试点结论判定是否进入 WebUI 跟进。

---

## 8. 风险

| 风险 | 缓解 |
|---|---|
| 别名归并过猛 | 证据必显；默认可疑进 candidate；合并需人确认 |
| 与 semantic-layer 双源真理 | D3：注册表不管公式 |
| 扫描噪声压垮人审 | D7 白名单；高置信阈值；CLI 先暴露噪声再决定是否上 UI |
| 范围蔓延成指标平台／KG | 非目标与 D9 |
| 未验证就铺 WebUI | D6／D11／效果门 |
| 误以为一期提升准备率 | 闭口层级与 SC-05 写明 |

---

## 9. 后续边界（非本条出口）

- **WebUI 人审页**（效果门后；预留见 §6.1）
- canonical／冲突摘要注入 MCP
- 与 P0-1／P0-3 候选联动（注册表建议，硬约束仍在绑定／门闩）
- Concept 合并 UX、跨 connection 去重策略
- 仍不做：完整 KG、OWL 推理、独立指标计算平台

---

## 10. 收口判断（对原问题）

> 知识图谱或本体论对 Lucy 建立／优化语义、提升问答准备率与 Agent MCP 效果有用吗？

- **形式化 KG／OWL**：对最贵的选错表／口径加工失败，现期**不作为建设目标**。
- **轻量概念层（本 Spec）**：对人审权威面与自动冲突发现**值得做**；对选表／口径是增强输入，**不能**替代 0.30 约束闸。
- 对外称呼优先「概念注册表／口径权威面」。
