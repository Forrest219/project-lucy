# 语义层 source 写接口诚实响应与描述写入陷阱修复 Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | 语义层 source 写接口诚实响应与描述写入陷阱修复 Spec |
| 文档类型 / 版本 | Spec（API 契约诚实性／事故修复＋**查数拉数形状增量**）／**v1.4** |
| 日期 / 目标版本 | 2026-11-25／产品线 `0.35.0`（`lucy-v0.35`；总账与需求池暂挂 `0.30` 池） |
| 功能编号 / 优先级 | **P1-89**／REQ-030-110／**P1（API 主路径诚实性／事故修复）**。**不入核心分母**。增量：查数／拉数 API 不得强制业务 measures |
| 台账号 | 无。挂现行 `0.30` 执行总账（P1-89） |
| 阶段 | S4（写诚实子集）｜增量 **S4**（UAT PASS；功能合同收口未做） |
| 状态 | **写诚实子集**保持 S4｜v1.3 出口不重开。**增量 v1.4-r5（2026-11-27）**：形状 [`UAT-QDE`](../qa/uat/suites/query-detail-escape/suite.md) **PASS**；压力基准 [`UAT-SUITE-QUERY-DETAIL-STRESS`](../qa/uat/suites/query-detail-stress/suite.md)（**QDE-STRESS-B**，`baseline.json` 可演进）已登记／**NOT RUN**。OQ-3 仍待重裁；SC-09／10 证据缺口仍在；不入核心分母；**形状 UAT PASS ≠ 压力已验 ≠ 功能合同收口**；≠ 可上线 |
| 需求来源 | （写诚实）2026-11-25 用户反馈报告 [`inbox/Lucy语义层source描述无法通过API修改_问题反馈.md`](../../inbox/Lucy语义层source描述无法通过API修改_问题反馈.md)。（增量）2026-11-27 委托人：系统／脚本调查数接口是为**拿到表数据**，不是 Agent 式指标分析；`lucy_query` 强制非空 `measures` 导致接口频繁报错，属严重主路径误伤；指示在**本 API Spec** 增量优化，不另开 Spec |
| 实施主体 | （写诚实）Lucy 服务端写路径、WebUI 表编辑器、`03-api-spec.md`、Spec 114。（增量）Lucy MCP Proxy 查数形状（`webui/server/proxy/mcp-proxy.ts` 的 `lucy_query` 门禁／改写）＋开发者／API 文档；**不改 KTX 源码** |
| 配对计划 | [`docs/plans/lucy-20261125-source-write-api-honesty-plan.md`](../plans/lucy-20261125-source-write-api-honesty-plan.md) |
| 测试台 | **写诚实 PASS**（[UAT-SUITE-SOURCE-WRITE-HONESTY](../qa/uat/suites/source-write-honesty/suite.md)）。**增量形状 PASS**（[UAT-SUITE-QUERY-DETAIL-ESCAPE](../qa/uat/suites/query-detail-escape/suite.md)／[2026-11-27-cursor-qde-lean](../qa/uat/suites/query-detail-escape/runs/2026-11-27-cursor-qde-lean.md)）。**增量压力基准 NOT RUN**（[UAT-SUITE-QUERY-DETAIL-STRESS](../qa/uat/suites/query-detail-stress/suite.md)／**QDE-STRESS-B**／[`baseline.json`](../qa/uat/suites/query-detail-stress/baseline.json) 可演进） |

### Changelog

| 版本 | 变更 |
|---|---|
| v1.4-r5 | 2026-11-27 委托人：案 B 升格为可复用压力 UAT 基准线 `UAT-SUITE-QUERY-DETAIL-STRESS`（QDE-STRESS-B；scale＋Hive＋多形态；`baseline.json` 演进）；INDEX NOT RUN。写诚实／形状出口不重开。 |
| v1.4-r4 | 2026-11-27 委托人明示「授权跑真实的 UAT」：增量 `UAT-QDE` lean 全真 PASS（R0／01–04）；阶段增量 S3→S4；≠ 功能合同收口。写诚实出口不重开。 |
| v1.4-r3 | 2026-11-27 委托人明示「授权推进」：增量测试台登记 `UAT-SUITE-QUERY-DETAIL-ESCAPE`（SC-11–14）；INDEX／e2e-ledger／suite-faces 已挂；仍 NOT RUN。写诚实出口不重开。 |
| v1.4-r2 | 2026-11-27 增量实现落地：PRE-Q1 确认 KTX 0.16.0 仍硬要非空 measures；OQ-4 锁死 `count(source.anchor)`＋`_lucy_detail_count`＋`_meta.lucy.detailMode`；Proxy／指引／单测已合入。增量仍 S3；UAT／功能合同收口未做。写诚实出口不重开。 |
| v1.4-r1 | 2026-11-27 委托人明示「授权开发」：增量 S2→S3；允许改 Proxy 查数形状；须先完成 PRE-Q1 再锁 OQ-4 技术性投影细节。写诚实出口不重开。 |
| v1.4 | 2026-11-27 委托人明示「接受推荐」：**D9–D12 全案采纳 (a)**，增量终稿确权（S1→S2）；开发未授权；PRE-Q1／OQ-4 仍为开工前置。写诚实出口不重开。 |
| v1.4-draft | 2026-11-27 委托人指示：在本 Spec 增量优化「查数／拉数不得强制业务 measures」（不另开 Spec）。新增 §2.4／§6／F9／SC-11–SC-14／OQ-4；写诚实 D1–D8 与已 PASS UAT **不重开**。覆盖 [REQ-0119 OQ-6](lucy-20261127-integration-mcp-capacity-backpressure-spec.md)「无 measures 纯明细另立需求」指针——本条为该指针的挂靠 Spec。 |
| v1.3 | 2026-11-27 对抗 R2 修订：P1-89 PUT／import／WebUI 已 PASS 出口不重开；D8 广义“全部写/删接口”与本条非目标边界的矛盾升 OQ-3 待委托人重裁，禁止用 SC-09 文档 lint 冒充广义端点已实现。 |
| v1.2 | 2026-11-27 Codex CLI 三轮对抗过程评审修订：修正 Spec／Plan 与测试台 SOT 的现值分叉，登记既有 UAT PASS 跑次；不重开已通过的 UAT；补 SC-01–10 证据矩阵与 SC-09／10 当前证据缺口。阶段仍 S4；UAT PASS ≠ 功能合同收口；≠ 可上线。 |
| v1.1 | 2026-11-26 委托人明示开发授权（P1-89 → P1-90 → P1-91 串行落地）；测试台套件 `UAT-SUITE-SOURCE-WRITE-HONESTY`（`UAT-SWH-01`–`06`）建立并挂勾连；状态行更新。≠ 功能合同收口；≠ UAT PASS；≠ 可上线。 |
| v1.0 | 2026-11-26 **终稿确权**（委托人明示「逐项拍板，完成终稿确权（S1 → S2）」）：D1–D8 冻结；**D3＝D3a**；OQ-1＝仅文档注明 GET `?format=manifest` 未消费不报错；OQ-2＝随 D6 交叉引用关闭。阶段 S2；开发未授权；测试台 not_registered；≠ 功能合同收口；≠ UAT PASS；≠ 可上线。材料：[确权材料](../reviews/2026-11-26-p1-89-90-91-ratification-brief.md)。 |
| v0.2-draft | 2026-11-25 委托人授权跨 Spec（P1-89／P1-90／P1-91）边界优化：1) 确立「语义层写接口统一响应信封与引导惯例」（§2.1 D4/D8：`written`/`deleted`、`noChanges`、`writtenFiles`/`deletedFiles`、合同外字段 400、错误/成功机器可读 `data.nextSteps` / `nextSteps` 数组），供 P1-90 与 P1-91 复用；2) 明确三份 Spec 边界与推荐落地序（P1-89 → P1-90 → P1-91）；3) 补齐预定测试台套件 `UAT-SUITE-SOURCE-WRITE-HONESTY`（`UAT-SWH-01`–`06`）与 SC 映射，并在 `e2e-ledger.md` 补登勾连行。仍 S1、终稿未确权、开发未授权。 |
| v0.1-draft | 2026-11-25 登记立项初稿：依据反馈报告核查结论立项；D1–D7 为提案待终稿确权；入总账 P1-89／REQ-030-110。终稿未确权；开发未授权；≠ 功能合同收口；≠ UAT PASS；≠ 可上线。 |

## 闭口层级

- 层级：功能合同（**两段出口，不得混收**）
- **写诚实承诺（已落地子集）**：语义层既有单表 source 写接口（`PUT /api/sources/:conn/:schema/:table` 与 `POST .../import`）的响应诚实反映实际写入——零文件写入时不得返回 `written: true` 且不得产生版本快照等副作用，请求体含合同外字段时不得静默忽略，导入被分流规则丢弃的 schema 键必须显式告警；同时确立语义层写接口统一响应信封与引导惯例供 P1-90／P1-91 复用。
- **写诚实出口**：SC-01–SC-10；测试台 `UAT-SWH-*` 已 PASS；功能合同收口仍须以 §4 完整证据链判断（含 SC-09／10 缺口）。
- **增量承诺（v1.4，终稿已确权）**：面向系统／脚本／集成方的查数拉数主路径，**不得**把「必须提供业务 measures」当作拿到表数据的前置条件；合法拉数请求应成交或得到可执行下一步，而不是反复 `measures_required`（D9–D12＝(a)）。
- **增量出口**：SC-11–SC-14 → [`UAT-SUITE-QUERY-DETAIL-ESCAPE`](../qa/uat/suites/query-detail-escape/suite.md) **PASS**（[2026-11-27-cursor-qde-lean](../qa/uat/suites/query-detail-escape/runs/2026-11-27-cursor-qde-lean.md)；**禁止**用 `UAT-SWH-*` 冒充）。
- 不在本条出口：整库旅程；改 KTX 源码；REQ-0119 容量／背压实现；REQ-0122 问询预算默认档；`POST /api/schema-manifests/...`（P1-90）；`POST /api/semantic-assets/*`（P1-91）；客户现场验证（归发布取证）；原生无限分页／无界明细（仍受 `limit` 与容量 Spec 约束）。
- 上线关系：任一段收口都不表示可上线。

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- 「内容无变更，未写入」——表编辑器保存结果的提示文案（零写入分支），本条新增用户可见文案，在此登记；有写入分支保持既有「已保存到语义层」。
- `noChanges`／`writtenFiles`／`IMPORT_SCHEMA_KEYS_IGNORED`／`nextSteps` 为 API 响应字段与告警码（工程称谓），不作为 WebUI 对外主术语。
- **拉数／明细查询**（增量）：以拿到表行／投影数据为目的的查数调用，**不是**业务指标分析；协议标识保持 `lucy_query`（或经本增量裁定的等价工具名），`translate="no"`。
- **业务 measure**（增量）：语义层已登记的业务度量键（如 `source.revenue`）；与 Proxy 为适配上游而注入的**技术性投影／占位**区分——后者不得冒充业务口径。

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/00-principles.md`
- `webui/docs/design-system/30-pr-compliance-template.md`

### What This Change Follows

- [x] 复用既有 toast 组件与页头按钮规范，不新增组件、颜色、间距或视觉模式（UAT-SWH-06 已验证三态）。
- [x] 保存按钮保持页头 action group 唯一 primary，保存中禁用（既有行为，本条不改；UAT-SWH-06 回归通过）。

### Exceptions (If Any)

- 无。

### Follow-up Needed

- 无。

## 交互合同

- 路由：/catalog/:conn/:schema/:table
- 基准页：/catalog
- 一件事：保存结果提示诚实区分「已写入」与「无变更未写入」，不再对零写入保存报成功。
- 状态：首访：不适用：本条不改首访、页头结构与主任务入口；空：不适用：本条不触及空态；加载：不适用：本条不触及加载态；错误：保存失败沿用既有错误 toast 与校验面板，本条不新增错误态；0 条：不适用：本条不触及 0 条态；成功：有实际写入时提示「已保存到语义层」，零写入时提示「内容无变更，未写入」；部分：不适用：本条不触及部分态
- 主动作：保存按钮保持页头 action group 唯一 primary、保存中禁用；不做第二同组 primary。
- 决定信息：用户凭提示文案即可区分本次保存「已写入语义层」与「内容无变更，未写入」。
- 术语：本条新增「内容无变更，未写入」，已写在本 Spec Terminology Compliance；其余已登记。
- 台账：无新台账
- 状态维度：成功（已写入）与成功（无变更）在提示文案上区分，同一状态维度不得互相否定。

## 元素清单

- E1｜/catalog/:conn/:schema/:table｜错误｜页头操作区与检查器｜保存失败仍显示错误 toast 并展开校验面板，无新增错误态
- E2｜/catalog/:conn/:schema/:table｜成功｜页头操作区｜有实际写入时提示「已保存到语义层」
- E3｜/catalog/:conn/:schema/:table｜主动作｜页头操作区｜保存按钮为唯一 primary，保存中禁用
- E4｜/catalog/:conn/:schema/:table｜决定信息｜页头操作区｜零写入保存提示「内容无变更，未写入」，用户能区分已写入与无变更

## 交互评审

- Q1 主任务能否从页头和主工作区开始，而不必先读 Spec：通过
- Q2 PageHeader 是否满足按钮规范 §3 第 8 条，其他 action group 是否各自最多一个 primary，并且与「不做」不冲突：通过
- Q3 空、错误、0 条是否在面板内写明原因；不适用是否写了原因：通过
- Q4 决定信息是否足够；截断或隐藏时能否看见原因：通过
- Q5 控件是否与基准页同一套；新模式是否指向已存在的设计系统章节：通过
- Q6 用户可见术语是否已登记，或已写在本 Spec 的 Terminology Compliance：通过

## 受影响画像

> 事实源：[`docs/governance/user-personas.md`](../governance/user-personas.md)。

| 画像 | 变更前体验 | 变更后体验 | 判定 | 依据（验收编号／证据） | 负向时的补偿路径 |
|---|---|---|---|---|---|
| P1 问数方 | （写诚实）问数读取路径与描述内容不经写接口；报告面未触碰。（增量前）系统／脚本经 MCP `lucy_query` 拉表数据时，缺业务 `measures` 即 `measures_required`，与「拿行」意图冲突，频繁报错 | （写诚实）读取路径不变。（增量后）拉数可用 dimensions／filters 等成形请求成交，**不必**先编造业务指标；Agent 指标分析路径仍可用显式业务 measures | **写＝；增量·问数面 ↑** | 写：SC-03；增量：SC-11／SC-12 | — |
| P2 治理方 | 经 API 修改单表描述反复「假成功」：`written: true` 但零落库；`changedFiles` 列出无关 wiki 脏文件误导判断；dryRun 空 diff 被误读为接口失效 | 零写入返回 `written: false`＋`noChanges: true`；未知字段 400 并指明正确字段；被丢弃的 schema 键有 `IMPORT_SCHEMA_KEYS_IGNORED` 告警；`writtenFiles` 列出本请求实际写入。**行为变更**：依赖旧假成功响应的脚本将观察到 `written: false`／400——属诚实化，被观察的调用此前从未真正生效，非功能损失 | ↑ | SC-01／SC-02／SC-05／SC-06 | — |
| P3 运维方 | 排障需逐行读服务端源码才能定位「写了哪个文件」；空保存产生无意义版本快照。（增量）集成方报错洪水消耗支持带宽 | `writtenFiles`／`noChanges` 提供请求级可观测性；零写入不再产生版本快照与变更登记。增量后拉数错误率预期下降；技术性适配须可审计／可回退 | **写 ↑；增量·运行观察面 ↑** | SC-01／SC-07；增量 SC-13／SC-14 | 增量环境变量／开关回退到「强制业务 measures」旧行为（SC-14） |
| P4 管理层 | 不触碰业务指标口径与概览／审计展示面 | 业务口径、数据范围与审计汇总行为不变；技术性占位不得计入业务指标成功叙事 | ＝ | SC-03；增量 SC-13 | — |

写诚实子集无 `↓`。增量若选「Proxy 注入技术性投影」须在 SC-13 披露，避免把适配结果误读为业务度量。

## 主路径可用性检查（第一性原理）

| # | 问题 | 回答 |
|---|---|---|
| 1 | 本条生效后，最终用户（含纯 MCP）原先能完成的主任务是否仍能完成？ | **写诚实**：是（SC-03／04／06／08）。**增量**：是——拉数主路径应成交；显式业务 measures 的指标分析路径不得回归（SC-12） |
| 2 | 若增加拒绝／门禁，逃生或钉选路径是否在同一部署实况下可执行且纳入必做验收？ | **写诚实**：是（400＋`nextSteps`）。**增量**：拒绝须可执行下一步；不得仅 `measures_required` 无逃生（SC-11） |
| 3 | 验收是否同时覆盖「约束触发」与「合法路径成交」？ | **写诚实**：是。**增量**：约束面＝无成形查询仍拒；合法面＝无业务 measures 的拉数成交＋有业务 measures 的分析成交（SC-11／12） |
| 4 | 是否避免把「宿主缺席／凭据缺席」记成用例前置 BLOCKED？ | 是。写诚实与增量验收均在本机 Docker demo／纯 MCP 可执行；增量不得要求 WebUI person 宿主 |

## 1. 背景与已核实事实

2026-11-25 用户反馈：现场需经 API 修改 `kc-starrocks`／`dwd` 库 `dwd_ksc_finreport_6k_metric_sum` 表的 `descriptions.human`，`PUT`／`import` 均返回 `written: true` 但回读描述不变，仅 WebUI 生效。当日逐条代码核查结论：**单表描述修改的 API 能力存在（WebUI 即经 `PUT` + `patch.tableDescription` 写入），用户失败的直接原因是请求体不符合接口合同；但产品侧存在下列真实缺陷，放大了误解**。

| # | 已核实事实 | 代码 / 证据锚点 | 问题 |
|---|---|---|---|
| F1 | PUT 合同为 `{ patch: TablePatch, dryRun }`；`TablePatch = { tableDescription?, grain?, measures?, segments?, joins?, columns?[{name, description?}] }`；WebUI 表编辑器即以 `patch.tableDescription` 保存描述 | `webui/server/index.ts:1162-1217`；`webui/server/model.ts:151-161`；`webui/src/pages/TableEditor.tsx:135-136` | 用户传 `yaml`／`model` 字段（合同外），`request.body?.patch ?? {}` 得空补丁，**静默忽略、不报 400** |
| F2 | 空补丁时 `buildSourcePatchPreview` 产出零文件（`hasSchemaPatch` 为假、`previewOverlayUpdate` 全 undefined 返回 `null`），`writeSourcePatch` 跳过写盘；但路由**无条件**返回 `written: true`，并无条件创建版本快照、登记 `changedSources` | `webui/server/semantic-layer.ts:733-759`、`overlay.ts:70-73`；`webui/server/index.ts:1208-1216` | **假成功**：零写入返回 `written: true`＋`validation.ok`，并产生无意义版本快照 |
| F3 | import 分流规则（2026-08-25 P0/P1）：扁平导入 YAML 含 `grain`／`measures`／`segments` 任一即判为业务 source 导入，`shouldPatchManifest` 为假，**`descriptions`／`columns`／`joins` 被静默丢弃**，只写 overlay | `webui/server/semantic-layer.ts:1011-1037`（`isBusinessSourceImport`）；测试 `webui/server/__tests__/api.source-import.test.ts:196` | GET 导出的合并 `rawYaml`（含 grain/measures＋descriptions）改完描述回导即丢描述——**round-trip 不保真且无告警**；P0 本意是防 columns 子集冲掉 Manifest `pk` |
| F4 | `changedFiles` 是 `git diff --name-status -- semantic-layer wiki .ktx-ui` 的**全工作树脏文件列表**（含历史遗留改动），非本请求写入清单 | `webui/server/diff.ts:50-85`；`webui/server/index.ts:946` | 用户据此误判「写了 wiki 没写 source」 |
| F5 | dryRun 对零变更请求如实返回空 `diff`／`files`，但无显式「无变更」信号 | `webui/server/semantic-layer.ts:1079-1135` | 行为正确但被误读为「dryRun 形同虚设」 |
| F6 | 整库 Manifest 读取接口**存在**：`GET /api/catalog/assets/schema-manifest?connectionId&schema`；`03-api-spec.md:639` 已记载 | `webui/server/index.ts:2681-2701`；`webui/server/catalog-assets.ts:911` | 用户试 6 条路由均未命中——可发现性不足，但非能力缺失 |
| F7 | 文档脱节：`03-api-spec.md:377-395` 仍写 import「只替换当前表对应的 Schema Manifest 节点」，未记录 P0/P1 分流；Spec 114 Changelog 无 2026-08-25 修订条目 | `webui/docs/03-api-spec.md`、`webui/docs/114-table-editor-overlay-safe-yaml-import-spec.md` | 调用方无法从文档得知正确用法 |
| F8 | WebUI 保存按钮无脏检查：表单无变更也可点保存，`patchFromForm` 得空补丁，`onSuccess` 不检查响应 `written`，统一 toast「已保存到语义层」 | `webui/src/pages/TableEditor.tsx:1302-1331`、`1752`、`1865` | UI 主路径同样存在「零写入报成功」 |
| F9 | （增量·已落地适配）历史：MCP `lucy_query` 转发前强制非空 `measures`；KTX `sl_query` 亦硬要非空 measures。现行：成形拉数（dimensions／filters／segments）缺／空业务 measures 时 Proxy 注入技术性 `count(source.anchor)`（`_lucy_detail_count`）并披露 `detailMode`；无成形要素仍 `measures_required`；`LUCY_QUERY_REQUIRE_BUSINESS_MEASURES=1` 可回退旧门禁 | `mcp-proxy.ts` `prepareLucyQueryForUpstream`；[REQ-0119 §OQ-6](lucy-20261127-integration-mcp-capacity-backpressure-spec.md) | **拉数主路径可成交**；业务口径不得把技术性 count 当 measure |

**与 P1-90／P1-91／REQ-0119 的边界（MECE 分工）**：
- **P1-89 写诚实（已落地）**：单表写接口诚实响应、描述陷阱、WebUI 提示、D8 写信封。
- **P1-89 增量（v1.4，终稿已确权；开发授权已获得；实现已落地；UAT 未跑）**：查数拉数形状——调用方拿到表数据**不必**先提供业务 measures（D9–D12＝(a)）；挂靠本 Spec，吸收 REQ-0119 OQ-6「另立」指针。
- **P1-90**：Schema Manifest 单表追加与 schema 名归一化。
- **P1-91**：`semantic-assets` 发布与 overlay 生命周期。
- **REQ-0119**：容量／workload／大响应背压；**不**再承载查数形状变更（OQ-6 非目标维持）；本增量落地后 0119 开发者指引须交叉引用本条，而非重复发明形状合同。

## 2. 需求摘要

### 2.1 功能需求（D1–D8 已终稿冻结）

| 编号 | 决策 | 裁定（v1.0） |
|---|---|---|
| D1 | 零写入诚实响应 | PUT／import 在预览零文件时不写盘，返回 HTTP 200 `{ written: false, noChanges: true, writtenFiles: [], validation, changedFiles }`；**不创建版本快照、不登记 `changedSources`、不触发显示缓存失效**。有写入时 `written: true`、`noChanges: false` 且 `writtenFiles` 为本请求实际写入的仓库相对路径列表。HTTP 状态与既有字段保留，响应可加法扩展 |
| D2 | 合同外字段报错 | PUT body 含合同外顶层字段（如 `yaml`／`model`）→ 400 `INVALID_SOURCE_PATCH_BODY`，消息指明正确字段（`patch.tableDescription` 等）且 `data.nextSteps` 给出可执行指引；import body 含合同外字段（如 `patch`／`model`／`confirmOverwrite`）→ 400 同理。dryRun 与落盘同样校验 |
| D3 | import 描述陷阱修复 | **已裁 D3a**：业务 source 导入（含 `grain`／`measures`／`segments`）同时含表级 `descriptions` 时，将 `descriptions` 合并入 Manifest（表级描述不涉 `pk`／columns 风险）；`columns`／`joins` 保持 P0 丢弃。被丢弃的 schema 键须在响应 `warnings[]` 输出 `IMPORT_SCHEMA_KEYS_IGNORED`（列出被忽略键与正确写入路径） |
| D4 | 响应可观测 | PUT／import 响应新增 `writtenFiles: string[]`；`changedFiles` 保留现语义并在文档注明为「工作树白名单目录脏文件列表」，不得再被误读为本请求写入清单 |
| D5 | dryRun 明示 | dryRun 响应零变更时返回 `noChanges: true`（`diff`／`proposedYaml`／`files` 仍为空），有变更时 `noChanges: false` |
| D6 | 文档补录 | `03-api-spec.md`：PUT 小节展开 `TablePatch` 字段表；import 小节补 P0/P1 分流规则、告警契约、「整库 Manifest 读取走 `GET /api/catalog/assets/schema-manifest`」交叉引用、`changedFiles` 语义注记与 D8 写接口信封约定。Spec 114 加 Changelog 记录 2026-08-25 P0/P1 修订与本条行为变更 |
| D7 | WebUI 无变更提示 | 表编辑器保存成功回调按响应 `noChanges` 分支：零写入提示「内容无变更，未写入」，有写入保持「已保存到语义层」。不改页面结构、路由、导航与按钮规范 |
| D8 | 语义层写接口统一信封（供 P1-90／P1-91 复用） | 约定语义层全部写/删接口共享同一套响应信封：① 写接口用 `written` + `noChanges` + `writtenFiles`，删接口用 `deleted` + `noChanges` + `deletedFiles`；② dryRun 统一含 `diff`、`files`、`noChanges`；③ 请求体/查询参数含合同外字段一律返回 400（各端点使用自身清晰错误码，并携带合法字段清单）；④ 机器可读下一步指引统一使用 `data.nextSteps: string[]`（错误响应）与 `nextSteps: string[]`（成功响应），禁止另造单数字段名（如 `nextEndpoint`）；⑤ 非阻断提示统一走 `warnings: [{ code, ... }]` |

### 2.2 非功能需求

| 维度 | 要求 |
|---|---|
| 兼容 | HTTP 状态码与既有响应字段保留，仅加法扩展（`noChanges`／`writtenFiles`／`warnings`／`data.nextSteps`）；`written` 语义诚实化是唯一行为变更，须在 Changelog 与文档显式标注 |
| 安全 | 不放宽任何路径校验、发布协调器、恢复日志与审计写入契约；零写入路径不得产生版本快照／审计写事件 |
| 性能 | 零写入路径不新增磁盘写；`writtenFiles` 复用预览结果，不新增 git 调用 |

### 2.3 非目标（写诚实子集；增量另见 §2.4）

- 不改 `POST /api/semantic-assets/*` 发布路径与 overlay 生命周期契约（归 P1-91）。
- 不新增 Schema Manifest 单表追加端点，也不在本条处理 schema 名大小写归一化（归 P1-90，作为 `semantic-layer.ts` 公共底层能力覆盖全路径族）。
- 不改 P0 对 `columns`／`joins` 的保护性丢弃语义本身（防 `pk` 被 columns 子集冲掉）；D3 仅裁定表级 `descriptions` 是否豁免。
- 不新增「单表描述专用 PATCH 接口」——既有 `PUT patch.tableDescription` 即该能力，本条只消除其假成功陷阱。
- 不改 `changedFiles` 的既有语义与消费方，仅文档注记。
- **不**在写诚实子集内改 MCP 查数形状（查数形状仅由 §2.4 增量管辖）。

### 2.4 增量：查数／拉数不得强制业务 measures（v1.4 · 已裁定）

> 问题定性：调接口是为了**拿到数据**，不是 Agent 式指标分析。把业务 `measures` 设成硬前置，会使合法拉数频繁 `measures_required`，违反主路径可用性优先。  
> **2026-11-27 委托人明示「接受推荐」：D9–D12 全案采纳 (a)。**

| 编号 | 决策项 | 选项 | 推荐 | 状态 |
|---|---|---|---|---|
| **D9** | 拉数形状合同 | (a) **拉数逃生**：允许无业务 `measures` 的成形拉数（至少含可解析的 `dimensions` 和／或 `filters`／`segments`，且能钉到可见 source）。若上游 KTX 仍硬要非空 measures，由 **Lucy Proxy 注入技术性、与业务口径无关的有界投影／占位** 完成转发，并在响应 `_meta.lucy`（或等价）披露 `detailMode`／适配事实；调用方**不必**编造 `source.revenue` 一类业务度量。<br>(b) 仅文档教调用方「随便填一个 measure」——不改门禁<br>(c) 新建独立工具（如 `lucy_read_rows`），`lucy_query` 维持强制 measures | **(a)** | **已裁定（采纳 a，2026-11-27）** |
| **D10** | 与指标分析路径共存 | (a) 显式业务 measures 的分析路径语义 100% 不变；空／缺 measures 走拉数合同（D9）；禁止把技术性占位登记进业务度量目录或审计「业务指标」桶<br>(b) 放宽后不再区分拉数／分析 | **(a)** | **已裁定（采纳 a，2026-11-27）** |
| **D11** | 有界与回退 | (a) 拉数仍受既有 `limit` 硬顶（默认 ≤1000）与容量／背压 Spec 约束；提供环境变量一键回退「强制非空业务 measures」旧门禁（默认关＝新合同）<br>(b) 拉数无 limit | **(a)** | **已裁定（采纳 a，2026-11-27）** |
| **D12** | 文档与指引 | (a) `03-api-spec.md`（若暴露对等 REST）／MCP `initialize` 指引／REQ-0119 开发者指引交叉引用：写明「拉数不必业务 measures；分析才需要」＋反例<br>(b) 只改代码不改文档 | **(a)** | **已裁定（采纳 a，2026-11-27）** |

**开工前置（增量）**：

- **PRE-Q1**：**已完成（2026-11-27）**——KTX 0.16.0 对缺／空 measures 均 `-32602`；走 **Proxy 技术性适配**分支（见 OQ-4）。证据：`inbox/2026-11-27-pre-q1-ktx-measures.txt`。

**不变式（增量）**：

1. 不改 KTX 源码。
2. 不放宽 ACL／行权限／表级歧义门闩。
3. 不把本增量做成取消 `limit` 或绕过 REQ-0119 容量／体量门。
4. 写诚实 D1–D8 与 `UAT-SWH-*` **不因本增量重开或改判**。

## 3. 核心流程（伪代码）

```text
// 0. 公共请求体键白名单校验（供 P1-89 / P1-90 / P1-91 复用）
function assertAllowedKeys(obj, allowedKeys, errorCode, hint, nextSteps):
  unknownKeys = keys(obj ?? {}) - allowedKeys
  if unknownKeys 非空:
    throw 400 errorCode(
      message = "无法识别的字段 " + unknownKeys + "；" + hint,
      data = { unknownKeys, allowedKeys, nextSteps })

// 1. PUT /api/sources/:conn/:schema/:table（index.ts 路由；import 同构）
function putSource(request):
  body = request.body ?? {}
  assertAllowedKeys(body, {patch, dryRun, restoredFromVersionId},
    "INVALID_SOURCE_PATCH_BODY",
    "修改表描述请用 patch.tableDescription，列描述请用 patch.columns[].description，详见 03-api-spec.md PUT 小节",
    ["PUT /api/sources/<conn>/<schema>/<table> with { patch: { tableDescription }, dryRun }"])

  patch = body.patch ?? {}
  preview = buildSourcePatchPreview(conn, schema, table, patch)   // 既有：空补丁 → 零文件

  if body.dryRun !== false:                                        // dryRun 分支
    return 200 { diff, proposedYaml, files, noChanges: preview.files.length === 0 }

  if preview.files.length === 0:                                   // D1：零写入诚实响应
    return 200 { written: false, noChanges: true, writtenFiles: [],
                 validation: validateSource(...), changedFiles: changedFiles(...) }
    // 副作用禁止：不创建版本快照、不登记 changedSources、不触发显示缓存失效

  preview = writeSourcePatch(...)                                  // 既有：发布协调器＋恢复日志＋审计
  return 200 { written: true, noChanges: false, writtenFiles: preview.files.map(f => f.filePath),
               validation, changedFiles, version }

// 2. POST .../import 的分流与告警（semantic-layer.ts planSourceYamlImport）
function planImport(yaml, table):
  imported = parseImportedTable(yaml, table)
  isBusiness = imported 含 grain|measures|segments
  schemaKeys = imported 含有的 {descriptions, columns, joins} 子集

  if imported.fromSchemaManifest 或 !isBusiness:
    manifestPatch = schemaKeys 全量合并（P1：columns 保留既有 pk/nullable）   // 既有
  else if schemaKeys 含 descriptions:                                // D3a（已冻结）
    manifestPatch = { descriptions }                                // 表级描述豁免，columns/joins 仍丢弃
  else:
    manifestPatch = 无                                               // P0 既有

  ignoredKeys = schemaKeys - manifestPatch 实际合并键
  warnings = ignoredKeys 非空
    ? [{ code: "IMPORT_SCHEMA_KEYS_IGNORED", keys: ignoredKeys,
         hint: "业务 source 导入（含 grain/measures/segments）时 " + ignoredKeys +
               " 不写入 Manifest；结构片段（仅 descriptions/columns/joins）导入或 PUT patch 可写" }]
    : []
  return { manifestPatch, overlayPatch, warnings }                   // warnings 透传至响应
```

## 4. 验收标准

| 编号 | 验收项 | 层 | 对应证据 |
|---|---|---|---|
| SC-01 | PUT 空补丁（或无实际变更补丁）落盘请求 → 200＋`written: false`＋`noChanges: true`＋`writtenFiles: []`；无新版本快照、无 `changedSources` 登记、无显示缓存失效 | 服务端单测 | UAT-SWH-01 |
| SC-02 | PUT body 含 `yaml`／`model` 等合同外字段 → 400 `INVALID_SOURCE_PATCH_BODY`，消息含正确字段指引且 `data.nextSteps` 为数组；import body 含 `patch`／`model`／`confirmOverwrite` → 400 同理 | 服务端单测 | UAT-SWH-02 |
| SC-03 | PUT `patch.tableDescription` → Manifest `descriptions.human` 更新、`written: true`、`noChanges: false`、`writtenFiles` 含 `semantic-layer/<conn>/_schema/<schema>.yaml`、`descriptions.db`／`ai` 子键保留 | 服务端单测（回归） | UAT-SWH-03 |
| SC-04 | import 结构片段（仅 `descriptions`，不含 grain/measures/segments）→ 写 Manifest，既有 columns／joins／pk 保留 | 服务端单测（回归） | UAT-SWH-04 |
| SC-05 | import 业务 source（含 grain/measures）＋`descriptions`（＋`columns`）→ 表级 `descriptions` 落 Manifest（D3a）；`columns`／`joins` 被忽略时响应含 `IMPORT_SCHEMA_KEYS_IGNORED` 且列出被忽略键 | 服务端单测 | UAT-SWH-04 |
| SC-06 | import 业务 source 无 schema 键 → overlay-only、无 `warnings`、`written`／`noChanges`／`writtenFiles` 按实际写入 | 服务端单测（回归） | UAT-SWH-04 |
| SC-07 | dryRun：零变更 → `noChanges: true` 且 `files: []`；有变更 → `noChanges: false` 且 diff／files 非空 | 服务端单测 | UAT-SWH-05 |
| SC-08 | WebUI：无变更保存提示「内容无变更，未写入」；有变更保存提示「已保存到语义层」；保存失败错误面不变 | 组件测试＋真实前台浏览器验证（E1–E4，含计时） | UAT-SWH-06 |
| SC-09 | 文档：`03-api-spec.md` PUT／import 小节、D8 写接口统一信封约定与 `changedFiles` 注记补录完成；Spec 114 Changelog 补记；`npm run lint:spec-docs` 绿 | 文档核对 | 文档审查 |
| SC-10 | 回归：`api.save`／`api.source-import`／`table-editor` 等相关套件全绿 | 服务端＋前端单测 | 回归门禁 |
| SC-11 | **（增量）** 无业务 `measures`、但含可解析 dimensions／filters 的 `lucy_query` 拉数请求：不得以 `measures_required` 硬拒；须成交出数，或返回可执行 `next_step`（不得只有「请填 measures」） | 纯 MCP | [UAT-QDE-01](../qa/uat/suites/query-detail-escape/cases.md)／[2026-11-27-cursor-qde-lean](../qa/uat/suites/query-detail-escape/runs/2026-11-27-cursor-qde-lean.md) **PASS** |
| SC-12 | **（增量）** 显式业务 measures 的分析查询回归成交；与 SC-11 同窗不互相破坏 | 纯 MCP | [UAT-QDE-02](../qa/uat/suites/query-detail-escape/cases.md)／同上 **PASS** |
| SC-13 | **（增量）** 若走 Proxy 技术性适配：响应披露适配事实；审计／元数据不得把占位记成业务度量成功 | 纯 MCP＋审计 | [UAT-QDE-03](../qa/uat/suites/query-detail-escape/cases.md)／同上 **PASS** |
| SC-14 | **（增量）** 回退开关打开后恢复「强制非空业务 measures」旧门禁；默认关闭时 SC-11 成立 | 纯 MCP | [UAT-QDE-04](../qa/uat/suites/query-detail-escape/cases.md)／同上 **PASS** |

### 4.1 SC-01–10 证据矩阵（2026-11-27 过程评审）

| SC | 现有证据 | 当前判定 |
|---|---|---|
| SC-01–08 | [`UAT-SUITE-SOURCE-WRITE-HONESTY` PASS 跑次](../qa/uat/suites/source-write-honesty/runs/2026-11-26-claude-p19x-isolated.md)（SWH-01–06；真实 API／落盘／浏览器三态＋计时） | 已有持久证据；不重跑 |
| SC-09 | `webui/docs/03-api-spec.md` PUT／import／D8 信封与 `changedFiles` 注记、`webui/docs/114-table-editor-overlay-safe-yaml-import-spec.md` Changelog 已静态复核；2026-11-27 `npm run lint:spec-docs` 尚未因下列 SC-10 环境缺依赖而执行到该步 | 文档内容已对齐；须在收口证据中补一次成功 lint 输出 |
| SC-10 | 2026-11-27 过程评审重放指定三套件：`table-editor` 31 tests PASS；`api.save`／`api.source-import` 在测试收集阶段因本机缺少未安装依赖 `mysql2` 而失败，未形成行为反例 | **证据缺口**；不得把环境失败写成实现失败，也不得据此声称 SC-10 已绿；补齐依赖环境后重放相关套件即可，无需重跑已 PASS 的 UAT |

## 5. 风险与已闭合裁定

| 项 | 内容 | 处置／裁定结论 |
|---|---|---|
| R1 | `written` 语义诚实化后，依赖旧假成功响应的外部脚本将观察到 `written: false`／400 | 属诚实化修复：被观察的调用此前从未真正生效；文档 Changelog 显式标注；错误消息与 `data.nextSteps` 含逃生指引 |
| R2 | D3a（表级 descriptions 豁免合并）改变 2026-08-25 P0 裁定边界 | **已裁 D3a**；P0 对 `columns`／`joins` 的保护不在本条动摇 |
| OQ-1 | `GET /api/sources/:conn/:schema/:table` 的 `?format=manifest` 查询参数（反馈报告中出现）当前服务端未消费、静默忽略，是否一并纳入 D2 式显式化 | **已裁：仅文档注明未消费，不报错**（GET 幂等只读） |
| OQ-2 | 用户期望 3（`semantic-assets/validate → publish` 用于单表描述）是否需要文档级示例 | **已裁：随 D6 在 `03-api-spec.md` 补交叉引用关闭**；不新增接口 |
| OQ-3 | D8 的“语义层全部写/删接口”究竟是立即覆盖所有既有端点（含本条非目标的 `POST /api/semantic-assets/*`），还是仅约束明确采纳 D8 的端点？ | **待委托人重裁**。现行 P1-89 仅证明 PUT／import；不得用其 UAT 或 SC-09 lint 推定 publish 等端点已实现未知字段 400。若维持广义范围，须另由 P1-91／新需求补实现与验收；若缩窄范围，属于修改已冻结 D8，亦须委托人明示。两案都不重开 P1-89 已 PASS 的 PUT／import／WebUI 出口 |
| OQ-4 | D9(a) 技术性投影／占位的具体形状及披露字段名 | **已锁死（PRE-Q1，KTX 0.16.0，2026-11-27）**：缺／空 measures 上游均 `-32602`（expected array／Too small >=1）。成形拉数注入 `{expr:"count(<source>.<anchor>)",name:"_lucy_detail_count"}`，`anchor`＝首个 dimensions／filters／segments 的 source-qualified 字段；响应 `_meta.lucy.detailMode` 披露。证据：`inbox/2026-11-27-pre-q1-ktx-measures.txt`。不得回退为 D9(b)/(c) |

## 6. 增量伪代码（查数拉数 · 示意）

```text
// mcp-proxy.ts tools/call lucy_query（v1.4-r2 已落地；PRE-Q1＝须注入）
function onLucyQuery(args):
  if hasNonEmptyBusinessMeasures(args.measures):
    return forwardSlQuery(args)                         // 分析路径不变

  if REQUIRE_BUSINESS_MEASURES:                         // D11 回退
    return client_schema_failure(measures_required)

  if not isFormedDetailQuery(args):                     // 无 dimensions/filters/segments
    return client_schema_failure(measures_required, hint=detail_or_measures)

  adapted = inject count(source.anchor) as _lucy_detail_count
  result = forwardSlQuery(adapted)
  return attachMeta(result, detailMode={mode, injectedMeasure, anchorField, reason})
```

## 7. 授权边界（强制）

- 写诚实子集：既有实现与 UAT PASS 有效；**不**因 v1.4 增量重跑 `UAT-SWH-01–06`。
- §2.4 增量：D9–D12 已确权；开发授权已获得；PRE-Q1／OQ-4 已锁死；实现已落地；测试台 **PASS**（v1.4-r4）；**功能合同收口未做**。
- 开发授权 ≠ 功能合同收口 ≠ 可上线；两段 UAT PASS 仍可分收。
