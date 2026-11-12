# Lucy 轻量概念注册表（ontology-lite）Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能 Spec／**v0.7** |
| 日期 / 目标版本 | 2026-11-08／修订 2026-11-13 / 产品线 `0.30.0`（分支 `lucy-v0.30`）；**P1 辅线，不挡原 P0**；不进入 `v0.25` 台账 |
| 台账号 | 无（0.30 台账未建立） |
| 功能编号 / 优先级 | 清单 **P1-10**；需求池 **REQ-030-031**／**P1** |
| 状态 | **委托人结案（2026-11-13）**：本分支明确**不做** ontology-lite **CLI／WebUI** 交付与效果门跟进；产品交付只走 **P1-11／REQ-030-032 Ops MCP**。P1-10 保留上游数据／语义合同（纯计算核心可被 Ops 复用）；既有 `npm run concepts` **不作为本分支交付出口**。本条不表示可上线 |
| 授权边界 | 本分支**不再授权** P1-10 CLI／WebUI／效果门跟进。历史 R4（2026-11-09）仅覆盖当时一期 CLI 试验实现；交付与后续改动以 **P1-11 Ops MCP** 为准 |
| 决策来源 | 2026-11-08 头脑风暴：指标权威解释面 × 知识图谱／本体论是否值得；结论＝不做形式化 KG／OWL，做轻量概念注册表；人审优先、MCP 更后。**交付序（同日确认）**：先 CLI 跑通并验证效果，效果可接受后再做 WebUI 人审页 |
| 需求来源 | [需求池 REQ-030-031](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md)；[功能清单池 P1-10](../plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md)；对话结论（选错表／口径加工为最贵失败；缺口＝人审权威面 + 自动冲突发现；CLI 先） |
| 实施主体 | Lucy：内容根概念注册表 + **一期 CLI** 扫描／人审。**不改 KTX 源码**；不替代 semantic-layer 计算语义；**一期不改 WebUI** |
| 配套 Plan | [lucy-20261108-concept-registry-ontology-lite-plan.md](../plans/lucy-20261108-concept-registry-ontology-lite-plan.md)（**v0.4-draft**） |
| 评审记录 | [Codex 对抗评审](../reviews/2026-11-09-concept-registry-ontology-lite-codex-review.md)（过程对抗；**不构成终稿确权**） |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」「功能闭口与发布取证」「伪代码」 |
| 与既有 Spec 的关系 | **串联，不吞并、不替代。** 0.30 约束闸（口径绑定 P0-1／catalog 业务语义 P0-2／歧义门闩 P0-3）仍是选表与口径运行时主杠杆；本条提供概念权威与冲突治理面，一期不注入 MCP 热路径。不做独立指标计算平台 |

## 变更记录

| 版本 | 说明 |
|---|---|
| v0.1-draft | 头脑风暴设计落盘：目标／非目标、Concept／Binding／Conflict 模型、一期扫描与人审流程、成功标准与二期边界 |
| v0.2-draft | 补「WebUI 影响」专节；交付序改为 **CLI 先验证 → 效果可接受后再上 WebUI 人审页**；一期对 WebUI **零变更**；WebUI 与 MCP 均不在一期出口。同日登记入池：**清单 P1-10／REQ-030-031**（入池 ≠ 开发授权） |
| v0.3-draft | 配套 Plan 已开（v0.1-draft，2026-11-09）；状态改为「Spec＋Plan 草案齐，待评审」；仍冻结落地、未授权实现 |
| v0.4-draft | Codex R1 过程对抗修订：闭合 F-01…F-09（内容根唯一解析、Binding 身份、匹配／置信、权威一致性、broken_canonical 扫描覆盖、原子写、差分边界、门禁登记、状态镜像同句） |
| v0.5-draft | Codex R2 修订：闭合 R1 残留＋F-R2-01／02（项目根入口对齐、确定性置信、权威不变量改写、候选失效计入规则、差分含未跟踪／package 内容级、concept id 文法与路径围栏、list／show 即时冲突） |
| v0.6-draft | Codex R3 后作者侧闭合（第 3 轮为上限，不再开 R4 Codex）：F-05 现匹配有效性、F-07 固定 diff 基线、F-R2-01 文件名／id 一致＋conceptsDir 禁 symlink；SC-15–17 |
| v0.6 | **R2-F**：委托人 2026-11-09 明示认可 Spec v0.6／Plan v0.4；同日 **R4** 授权进入开发（Cursor 实现） |
| v0.7 | **委托人结案（2026-11-13）**：本分支不做 ontology-lite CLI／WebUI／效果门跟进；交付只走 P1-11 Ops MCP；头部状态与授权边界同句改写 |

---

## 闭口层级

- 层级：功能合同
- 本条承诺：从现有 semantic-layer 与 Wiki **派生**业务概念候选与冲突；人经 **CLI** 指定权威解释（canonical + summary）；机器**不得**自动裁定权威；一期不改变 `lucy_query`／选表门闩／口径绑定的运行时行为；**一期不改变任何用户可见 WebUI 表面**。
- 本条出口：试点概念（至少「收入」「资产」）经 CLI 可复核盘点；冲突状态可见（含 `needs_authority`／`broken_canonical`）；权威指定不被扫描覆盖；`rejected` 可保留；自动化能打假「机器覆盖权威」「无证据候选」「权威不一致」「无证据／子串噪声候选」「内容根解析」「原子写失败保权威」「差分越界」；WebUI／MCP 热路径无本功能引入的产品行为变更（一期）。
- 不在本条出口：WebUI 人审页（效果门通过后另开／升版）；`possible_merge`（一期不做）；`skill` kind（一期不做）；形式化知识图谱／OWL；统一指标计算与下发；MCP 注入；准备率数值提升承诺；上线／发布取证；宣称 0.30 核心主线因此完成。
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
| D6 | **2026-11-13 结案**：本分支不做 CLI／WebUI／效果门跟进；产品交付只走 **P1-11／REQ-030-032 Ops MCP**。历史「CLI→效果门→WebUI」序作废为现值 | 委托人明示本分支范围 |
| D7 | 试点白名单概念起步（至少收入、资产） | 控制噪声与人审成本 |
| D8 | 一期不改变 MCP 查询／选表／口径绑定热路径行为 | 与 0.30 主线解耦；避免未授权运行时副作用 |
| D9 | 对外主称「概念注册表／口径权威面」，不用「知识图谱」作主称 | 预期管理 |
| D10 | 已入池（P1-10／031）；未终稿确权／未开发授权前不排期实现 | 入池 ≠ 可改代码；不挡原 P0 |
| D11 | 一期对 WebUI **零变更**（无新路由、无导航、无 API 给人审页用） | 先验证注册表／扫描价值，避免未证明效果就铺 UI |
| D12 | WebUI 形态预留为瘦身管理端「概念权威」页（列表／定权威／summary／reject）；**不**默认塞进发布工作台 | 效果门通过后另开 Spec 升版或跟进条；本条只冻结预留，不实现 |
| D13 | **项目根**优先级：`--project` → `KTX_PROJECT_ROOT`／`LUCY_PROJECT_ROOT` → 自 cwd 向上找含 `ktx.yaml` 的目录；找不到 → 失败关闭。**内容根**优先级：`--content-root` → `LUCY_CONTENT_ROOT` → 该项目根下 `ktx.yaml` 的 `paths.content_root` → `<projectRoot>/config`。相对路径相对 `projectRoot`。内容根不存在／不可读 → scan／list／show **失败关闭**（非 0） | 对齐 paths.ts＋project 入口；闭合 F-01 残留 |
| D14 | Binding 身份：`sourceName`＝overlay／逻辑源名（如 `superstore_orders`），**不是**物理表 `schema.table`；物理表另存 `ref.physicalTable`（可空）。一期 kind 仅 `measure`／`source`／`wiki`；**不做** `skill` | 闭合 F-02 |
| D15 | 匹配与置信：见 §4.4（**确定性赋值**，非「最高可达」）；子串噪声不得 candidate；`sl_refs` alone 不产 candidate | 闭合 F-03 残留 |
| D16 | 权威不变量见 §4.5（互斥两条，禁止「或」歧义）；扫描禁止改 summary／role／canonical；受保护 binding 仅 evidence 追加去重 | 闭合 F-04 残留 |
| D17 | `needs_authority` 只计 `currentlyMatches` 的 high candidate（§4.3）；`present` 不够；unknown→degraded；整根不可读失败关闭 | 闭合 F-05（R3） |
| D18 | 写盘：校验 → 同目录临时文件 → `rename`；失败不得报成功 | 闭合 F-06 |
| D19 | 差分：S0 固定基线；检查 BASE..HEAD 已提交∪staged∪unstaged∪untracked；白名单见 Plan | 闭合 F-07（R3） |
| D20 | id 文法；文件名＝对象 id＝请求 id；id 唯一；`conceptsDir` 禁 symlink；路径围栏 | 闭合 F-R2-01（R3） |
| D21 | list／show 即时冲突＋ live rematch | 闭合 F-R2-02 |

---

## 4. 数据模型

### 4.1 Concept

| 字段 | 含义 |
|---|---|
| `id` | 稳定键；须匹配 `^[a-z][a-z0-9_]{0,63}$`（D20）；如 `revenue`、`total_assets` |
| `label` | 主显示名（中文优先） |
| `aliases` | 别名列表（白名单种子可覆盖／合并） |
| `status` | `draft` \| `active` \| `deprecated` |
| `canonical` | 权威 `bindingId`；可空 |
| `summary` | 给人看的权威解释短文；**扫描不得改写** |
| `domain` | 可选业务域标签 |

### 4.2 Binding

| 字段 | 含义 |
|---|---|
| `bindingId` | 稳定 id（见 §4.2.1） |
| `kind` | `measure` \| `source` \| `wiki`（一期；禁止 `skill`） |
| `ref` | 见 §4.2.1 |
| `evidence` | 非空数组；每项含 `type`／`path`／`alias`／`field`／`snippet` |
| `confidence` | `high` \| `medium` \| `low`；≠ 权威 |
| `role` | `candidate` \| `canonical` \| `rejected` \| `related` |

#### 4.2.1 kind 合同与 `bindingId`／`sameRef`

| kind | `bindingId` | `ref` 必填 | `sameRef` |
|---|---|---|---|
| `measure` | `measure:{connectionId}/{sourceName}/{measureKey}` | `connectionId`，`sourceName`（逻辑名），`measureKey`；可选 `physicalTable` | 三键全等 |
| `source` | `source:{connectionId}/{sourceName}` | `connectionId`，`sourceName`；可选 `physicalTable` | 两键全等 |
| `wiki` | `wiki:{posixRelPathFromWikiRoot}` | `relPath`（posix，相对 `wiki/`） | `relPath` 全等 |

- Overlay 文件路径：`semantic-layer/{connectionId}/{sourceName}.yaml`（逻辑名）。
- Manifest 物理表仅作证据／可选 `physicalTable`，**不得**写入 `sourceName` 位。
- 同源多证据：同一 `bindingId` 合并为一条 binding，evidence 追加去重。
- 重复扫描：`bindingId` 必须稳定；不得因 evidence 路径微调而改 id。

### 4.3 Conflict（一期仅两种）

输入：`deriveConflicts(concept, assetIndex)`。  
`assetIndex[ref] ∈ {present, absent, unknown}`。

- `currentlyMatches(binding)`：对 binding.ref 指向的**现**资产字段，按 §4.4 对白名单中该 concept 的 aliases **重新匹配**；仅当仍得到与磁盘 `confidence` 同级或更高级的 candidate 命中时为 true。资产 `absent` → false；`unknown` → 不计入 needs，并触发 degraded。
- `needs_authority`：`canonical == null`，且 `role=candidate` ∧ `confidence=high` ∧ `currentlyMatches` 的条数 ≥ 2
- `broken_canonical`：`canonical` 非空，且对应 binding 缺失或其 ref 为 `absent`（`unknown` 不记 broken）

若计算所用任一相关 ref 为 `unknown`：附加 `conflicts_status=degraded`。整根不可读：失败关闭。

一期**不做** `possible_merge`。  
历史 candidate 可保留磁盘；**未** live 命中者不得计入 `needs_authority`（路径仍在但标题已改无关词 → 不计）。

### 4.4 白名单、匹配与置信（D15）

白名单 schema：`concepts[].id` 必须符合 D20；`aliases` 为非空字符串数组。

```yaml
concepts:
  - id: revenue
    label: 收入
    aliases: [收入, GMV, revenue, 营业收入]
    domain: finance
  - id: total_assets
    label: 资产
    aliases: [资产, total_assets, 总资产]
    domain: finance
```

**匹配谓词（确定性）**

1. 归一化：`trim`；拉丁 `toLowerCase`；CJK 原样；无拼音／无模糊编辑距离。  
2. `exactField(alias, field)`：归一化后整字段等于 alias。  
3. `boundedField(alias, field)`：归一化后，alias 在 field 中出现，且左右边界为：字符串端、或非字母数字非 CJK 字符（`[^\p{L}\p{N}\u4e00-\u9fff]`）。纯 CJK 连接（如「资产」∈「资产管理人员」）**不**构成 bounded。  
4. 英文标识符：`snake_case`／`camelCase` 按非字母数字切分后的 token 精确等于 alias（大小写不敏感）→ 视为 exact。

**字段 → 置信赋值（唯一，禁止另选）**

| 命中条件 | `confidence` | `role` 初值 |
|---|---|---|
| measure key／name：`exactField` | `high` | `candidate` |
| overlay 逻辑 `sourceName`：`exactField` | `high` | `candidate` |
| wiki 标题／第一 H1：`exactField` | `high` | `candidate` |
| measure `description`：`boundedField` | `medium` | `candidate` |
| manifest／overlay `descriptions.db`：`boundedField` | `medium` | `candidate` |
| wiki 正文任意命中 | — | **忽略**（不建 binding） |
| 仅 `sl_refs` | — | **不建**；若同学源已有 candidate／related，追加 evidence |

同一 binding 多证据：取证据中**最高**置信（high＞medium＞low）；role 仍按上表，不得因 medium 证据把 high 降级。  
未落入上表的命中：**丢弃**（不得标 high／medium）。

### 4.5 权威不变量与扫描写策略（D16）

加载／保存前**必须同时**满足下列互斥之一（禁止模糊「或」误读）：

- **空权威**：`canonical === null` **且** `count(role===canonical)===0`  
- **单权威**：`canonical !== null` **且** 存在唯一 binding `b` 满足 `b.bindingId===canonical && b.role===canonical` **且** 不存在其他 `role===canonical`

任一违例 → **失败关闭**。

扫描对已有 binding：

| 现 role | 允许 |
|---|---|
| `canonical`／`rejected` | 保留 role；**禁止**改 `summary`／`canonical`；evidence 仅追加去重 |
| `candidate`／`related` | 可按本轮 proposal upsert |

保存路径：`conceptsDir / (id + ".yaml")` 经 `realpath` 后必须仍以 `realpath(conceptsDir)+sep` 为前缀（D20）。  

---

## 5. 核心流程（伪代码）

### 5.1 Concept Scan（CLI／离线）

```text
function resolveProjectRoot(cliProject, env, cwd):
  # D13: --project > KTX_PROJECT_ROOT|LUCY_PROJECT_ROOT > walkUp(cwd, ktx.yaml) > fail

function resolveContentRoot(cliFlag, env, projectRoot):
  # --content-root > LUCY_CONTENT_ROOT > ktx.yaml paths.content_root > projectRoot/config
  # missing/unreadable => fail closed

function scanConcepts(contentRoot, whitelist):
  assertValidWhitelistIds(whitelist)  # D20
  assets = readSemanticLayer(contentRoot) + readWiki(contentRoot)  # file unread => mark unknown in index; root fail => abort
  assetIndex = indexExistingAssets(assets)
  proposals = []
  for asset in assets:
    for hit in matchAliasesDeterministic(asset, whitelist):  # §4.4
      proposals.append(BindingProposal(hit))

  conceptIds = union(listConceptFiles(contentRoot), groupByConcept(proposals).keys)
  for conceptId in conceptIds:
    assertValidConceptId(conceptId)
    c = loadOrCreateConcept(conceptId)
    for p in proposals[conceptId] or []:
      existing = findBySameRef(c, p)
      if existing and existing.role in {canonical, rejected}:
        existing.evidence = unionEvidence(existing.evidence, p.evidence)
      else:
        upsertCandidateOrRelated(c, p)
    # absent candidates kept; needs_authority ignores them via assetIndex
    conflicts = deriveConflicts(c, assetIndex)
    atomicSaveConcept(contentRoot, c)
    appendReport(conflicts)
  assert no binding gained role=canonical by scan
```

### 5.2 人审定权威（一期 = CLI）

```text
function atomicSaveConcept(contentRoot, c):
  assertAuthorityInvariant(c)
  assertValidConceptId(c.id)
  target = resolveInsideConceptsDir(contentRoot, c.id)  # D20 path fence
  writeTempAndRename(target, serialize(c))

function listOrShow(conceptId?):
  # D21: rebuild assetIndex live; deriveConflicts; no stale scan report
  # if any unknown => conflicts_status=degraded; exit 0 unless root unreadable

function setCanonical(conceptId, bindingId, summary):
  c = loadConcept(conceptId)
  assert bindingId in c.bindings
  for b in c.bindings:
    if b.role == canonical and b.bindingId != bindingId:
      b.role = candidate
  target = c.bindings[bindingId]
  target.role = canonical
  c.canonical = bindingId
  c.summary = summary
  atomicSaveConcept(c)

function rejectBinding(conceptId, bindingId):
  c = loadConcept(conceptId)
  b = c.bindings[bindingId]
  b.role = rejected
  if c.canonical == bindingId:
    c.canonical = null
  atomicSaveConcept(c)
```

### 5.3 一期运行时边界

```text
# MCP / lucy_query / 歧义门闩 / 口径绑定：一期不读取 concepts/
# WebUI：一期无读取、无写入、无导航入口（D11）
# 差分白名单：scripts/concepts/**、package.json 的 concepts 脚本键、术语标准、本条 docs
# 禁止：webui/server/proxy/**、webui/src/**、新增 server 路由、CONTENT_DIR_NAMES 加入 concepts
# 反哺：人可手工写回 Wiki／overlay／P0-1——不在本条自动完成
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
| SC-01 | 每个试点 Concept 经 CLI 可列出 binding 数、kind、证据（含 alias／field／path），并点回源资产路径 |
| SC-02 | 未定权威且 ≥2 条 **当前仍匹配** 的 high `candidate` 时出现 `needs_authority` |
| SC-03 | 人设 canonical＋summary 后，再扫描：`canonical` 指针、对应 `role=canonical`、`summary` 不变；仅允许该 binding 的 evidence 追加去重 |
| SC-04 | `rejected` 在再扫描／再命中后仍为 `rejected`；不得因新 candidate 同 ref 复活为 candidate |
| SC-05 | 一期不改变 `lucy_query`／选表门闩／口径绑定行为；差分落在 D19 白名单外则失败（含仅改 proxy 依赖模块读 concepts 的反例） |
| SC-06 | 无证据命中不得写入 `candidate`／`related` |
| SC-07 | 权威不变量违例（双 canonical role、指针与 role 不一致）→ 加载／保存失败关闭 |
| SC-08 | 一期变更不含 WebUI 产品行为（无新路由／导航／本功能浏览器 API） |
| SC-09 | 已定 canonical 的概念在资产被删除至零命中后，扫描仍报告 `broken_canonical`，且不清除人审 canonical／summary |
| SC-10 | 项目根／内容根解析夹具：`--project`／env／向上查找／默认内容根；缺失不可读失败关闭；cwd≠projectRoot 仍正确 |
| SC-11 | 原子写失败（临时写或 rename 失败）→ 命令非 0；原 YAML 字节级不变 |
| SC-12 | 别名「资产」不得因「资产管理人员」成为 candidate；收入／measure key 精确命中必为 high |
| SC-13 | 非法 `concept.id`、文件名≠id、id 冲突、`conceptsDir` 为 symlink、或目标逃出目录 → 非 0；另一概念／P0 文件字节不变 |
| SC-14 | `set-canonical` 后不重跑 scan，`list --conflicts-only`／`show` 不再报该概念的 `needs_authority` |
| SC-15 | Wiki／字段路径不变但命中文本改为无关词后，scan 与 list 均不再因历史 high 报 `needs_authority` |
| SC-16 | 差分检查：基线之后**已提交**越界改动（如 proxy 依赖）必须失败；不仅查脏工作区 |
| SC-17 | `revenue.yaml` 内 `id: total_assets` → 加载／保存失败；不得覆盖 `total_assets.yaml` |

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
