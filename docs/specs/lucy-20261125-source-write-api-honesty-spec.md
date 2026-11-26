# 语义层 source 写接口诚实响应与描述写入陷阱修复 Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | 语义层 source 写接口诚实响应与描述写入陷阱修复 Spec |
| 文档类型 / 版本 | Spec（API 契约诚实性／事故修复）／**v1.1** |
| 日期 / 目标版本 | 2026-11-25／产品线 `0.35.0`（`lucy-v0.35`；总账与需求池暂挂 `0.30` 池） |
| 功能编号 / 优先级 | **P1-89**／REQ-030-110／**P1（API 主路径诚实性／事故修复）**。**不入核心分母** |
| 台账号 | 无。挂现行 `0.30` 执行总账（P1-89） |
| 阶段 | S4 |
| 状态 | S4｜v1.1。**终稿已确权**（委托人 2026-11-26 明示「对剩余开放裁定项逐项拍板，完成终稿确权（S1 → S2）」；裁定见 [确权材料](../reviews/2026-11-26-p1-89-90-91-ratification-brief.md)；无 Codex CLI 复审，额度恢复后可补审）；**开发授权已获得**（2026-11-26）；**实现已落地，待验收**（Task 1–6 完成：单测/类型/术语/文档 lint 绿，code review PASS WITH WARN，浏览器保存提示验证 5/5；UAT 待跑）；测试台 registered（[UAT-SUITE-SOURCE-WRITE-HONESTY](../qa/uat/suites/source-write-honesty/suite.md)／UAT-SWH-01–06）；不入核心分母；≠ 功能合同收口；≠ UAT PASS；≠ 可上线 |
| 需求来源 | 2026-11-25 用户反馈报告 [`inbox/Lucy语义层source描述无法通过API修改_问题反馈.md`](../../inbox/Lucy语义层source描述无法通过API修改_问题反馈.md)：现场（`10.69.95.109:8276`，`kc-starrocks`／`dwd`）经 API 修改单表 `descriptions.human` 多次尝试均「返回成功但未落库」，仅 WebUI 生效；当日已完成逐条代码核查（见 §1） |
| 实施主体 | Lucy 服务端（`webui/server/index.ts`、`webui/server/semantic-layer.ts`、`webui/server/diff.ts`）、WebUI 表编辑器（`webui/src/pages/TableEditor.tsx`）、API 文档（`webui/docs/03-api-spec.md`）与 Spec 114 补录；不改 KTX 源码 |
| 配对计划 | [`docs/plans/lucy-20261125-source-write-api-honesty-plan.md`](../plans/lucy-20261125-source-write-api-honesty-plan.md) |
| 测试台 | registered（[UAT-SUITE-SOURCE-WRITE-HONESTY](../qa/uat/suites/source-write-honesty/suite.md)／用例 `UAT-SWH-01`–`06`，尚无跑次） |

### Changelog

| 版本 | 变更 |
|---|---|
| v1.1 | 2026-11-26 委托人明示开发授权（P1-89 → P1-90 → P1-91 串行落地）；测试台套件 `UAT-SUITE-SOURCE-WRITE-HONESTY`（`UAT-SWH-01`–`06`）建立并挂勾连；状态行更新。≠ 功能合同收口；≠ UAT PASS；≠ 可上线。 |
| v1.0 | 2026-11-26 **终稿确权**（委托人明示「逐项拍板，完成终稿确权（S1 → S2）」）：D1–D8 冻结；**D3＝D3a**；OQ-1＝仅文档注明 GET `?format=manifest` 未消费不报错；OQ-2＝随 D6 交叉引用关闭。阶段 S2；开发未授权；测试台 not_registered；≠ 功能合同收口；≠ UAT PASS；≠ 可上线。材料：[确权材料](../reviews/2026-11-26-p1-89-90-91-ratification-brief.md)。 |
| v0.2-draft | 2026-11-25 委托人授权跨 Spec（P1-89／P1-90／P1-91）边界优化：1) 确立「语义层写接口统一响应信封与引导惯例」（§2.1 D4/D8：`written`/`deleted`、`noChanges`、`writtenFiles`/`deletedFiles`、合同外字段 400、错误/成功机器可读 `data.nextSteps` / `nextSteps` 数组），供 P1-90 与 P1-91 复用；2) 明确三份 Spec 边界与推荐落地序（P1-89 → P1-90 → P1-91）；3) 补齐预定测试台套件 `UAT-SUITE-SOURCE-WRITE-HONESTY`（`UAT-SWH-01`–`06`）与 SC 映射，并在 `e2e-ledger.md` 补登勾连行。仍 S1、终稿未确权、开发未授权。 |
| v0.1-draft | 2026-11-25 登记立项初稿：依据反馈报告核查结论立项；D1–D7 为提案待终稿确权；入总账 P1-89／REQ-030-110。终稿未确权；开发未授权；≠ 功能合同收口；≠ UAT PASS；≠ 可上线。 |

## 闭口层级

- 层级：功能合同
- 本条承诺：语义层既有单表 source 写接口（`PUT /api/sources/:conn/:schema/:table` 与 `POST .../import`）的响应诚实反映实际写入——零文件写入时不得返回 `written: true` 且不得产生版本快照等副作用，请求体含合同外字段时不得静默忽略，导入被分流规则丢弃的 schema 键必须显式告警；同时确立语义层写接口统一响应信封与引导惯例供 P1-90／P1-91 复用，调用方仅凭响应即可判断「写了什么、没写什么、下一步怎么做」。
- 本条出口：SC-01–SC-10 的本机自动化测试、WebUI 组件测试与真实前台浏览器验证（含计时）、文档补录核对，以及终稿确权后所立测试台套件（预定 `UAT-SWH-*`）跑次。
- 不在本条出口：整库旅程、Agent 路径、跨模块或系统级故障演练、证据等级；`POST /api/schema-manifests/:conn/:schema/tables` 新增表追加与 schema 名大小写归一化（归 P1-90）；`POST /api/semantic-assets/*` 发布路径与 overlay 生命周期契约（归 P1-91）；`GET /api/catalog/assets/schema-manifest` 既有契约（本条只补交叉引用）；客户现场验证（归发布取证）。
- 上线关系：本条收口不表示可上线。

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- 「内容无变更，未写入」——表编辑器保存结果的提示文案（零写入分支），本条新增用户可见文案，在此登记；有写入分支保持既有「已保存到语义层」。
- `noChanges`／`writtenFiles`／`IMPORT_SCHEMA_KEYS_IGNORED`／`nextSteps` 为 API 响应字段与告警码（工程称谓），不作为 WebUI 对外主术语。

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/00-principles.md`
- `webui/docs/design-system/30-pr-compliance-template.md`

### What This Change Follows

- [ ] 复用既有 toast 组件与页头按钮规范，不新增组件、颜色、间距或视觉模式。
- [ ] 保存按钮保持页头 action group 唯一 primary，保存中禁用（既有行为，本条不改）。

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
| P1 问数方 | 问数读取路径与描述内容不经本条接口；报告面未触碰 | 问数读取路径不变；描述写入修复后治理方维护的描述可真正落库，属间接获益，不作为本条判定依据 | ＝ | SC-03（读取路径回归不变） | — |
| P2 治理方 | 经 API 修改单表描述反复「假成功」：`written: true` 但零落库；`changedFiles` 列出无关 wiki 脏文件误导判断；dryRun 空 diff 被误读为接口失效 | 零写入返回 `written: false`＋`noChanges: true`；未知字段 400 并指明正确字段；被丢弃的 schema 键有 `IMPORT_SCHEMA_KEYS_IGNORED` 告警；`writtenFiles` 列出本请求实际写入。**行为变更**：依赖旧假成功响应的脚本将观察到 `written: false`／400——属诚实化，被观察的调用此前从未真正生效，非功能损失 | ↑ | SC-01／SC-02／SC-05／SC-06 | — |
| P3 运维方 | 排障需逐行读服务端源码才能定位「写了哪个文件」；空保存产生无意义版本快照 | `writtenFiles`／`noChanges` 提供请求级可观测性；零写入不再产生版本快照与变更登记。**行为变更**同 P2 行注明 | ↑ | SC-01／SC-07 | — |
| P4 管理层 | 不触碰业务指标口径与概览／审计展示面 | 业务口径、数据范围与审计汇总行为不变 | ＝ | SC-03（未触碰查数口径与审计聚合逻辑） | — |

无 `↓`。

## 主路径可用性检查（第一性原理）

| # | 问题 | 回答 |
|---|---|---|
| 1 | 本条生效后，最终用户（含纯 MCP）原先能完成的主任务是否仍能完成？ | 是。WebUI 表编辑器保存／导入（合同内字段）与 API `patch.tableDescription` 路径行为不变（SC-03／SC-04／SC-06／SC-08） |
| 2 | 若增加拒绝／门禁，逃生或钉选路径是否在同一部署实况下可执行且纳入必做验收？ | 是。新增的 400（未知字段）错误消息指明正确字段名与文档锚点，并在 `data.nextSteps` 提供机器可读下一步；`IMPORT_SCHEMA_KEYS_IGNORED` 告警指明被忽略键与正确写入路径 |
| 3 | 验收是否同时覆盖「约束触发」与「合法路径成交」？ | 是。约束面 SC-01／SC-02／SC-05；合法面 SC-03／SC-04／SC-06／SC-08 |
| 4 | 是否避免把「宿主缺席／凭据缺席」记成用例前置 BLOCKED？ | 是。全部验收在本机 Docker demo 可执行，无宿主依赖 |

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

**与 P1-90／P1-91 的边界（MECE 分工）**：
- **P1-89（本条，推荐第 1 步落地）**：管既有单表写接口（`PUT /api/sources/:conn/:schema/:table`、`POST .../import`）的诚实响应、描述写入陷阱、WebUI 提示，并确立语义层写接口统一响应信封（D8）。
- **P1-90（REQ-030-111，推荐第 2 步）**：管 Schema Manifest 单表新增通道（`POST /api/schema-manifests/:conn/:schema/tables`）与 `semantic-layer.ts` 公共 schema 名大小写归一化（覆盖 `GET`/`PUT`/`import`/`tables` 全路径族）。
- **P1-91（REQ-030-112，推荐第 3 步）**：独占 `semantic-assets` 发布通道（`validate`/`publish`/`plans`）与 per-table overlay 生命周期（发现/护栏/删除）。

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

### 2.3 非目标

- 不改 `POST /api/semantic-assets/*` 发布路径与 overlay 生命周期契约（归 P1-91）。
- 不新增 Schema Manifest 单表追加端点，也不在本条处理 schema 名大小写归一化（归 P1-90，作为 `semantic-layer.ts` 公共底层能力覆盖全路径族）。
- 不改 P0 对 `columns`／`joins` 的保护性丢弃语义本身（防 `pk` 被 columns 子集冲掉）；D3 仅裁定表级 `descriptions` 是否豁免。
- 不新增「单表描述专用 PATCH 接口」——既有 `PUT patch.tableDescription` 即该能力，本条只消除其假成功陷阱。
- 不改 `changedFiles` 的既有语义与消费方，仅文档注记。

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

| 编号 | 验收项 | 层 | 对应 UAT（预定，套件待立） |
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

## 5. 风险与已闭合裁定

| 项 | 内容 | 处置／裁定结论 |
|---|---|---|
| R1 | `written` 语义诚实化后，依赖旧假成功响应的外部脚本将观察到 `written: false`／400 | 属诚实化修复：被观察的调用此前从未真正生效；文档 Changelog 显式标注；错误消息与 `data.nextSteps` 含逃生指引 |
| R2 | D3a（表级 descriptions 豁免合并）改变 2026-08-25 P0 裁定边界 | **已裁 D3a**；P0 对 `columns`／`joins` 的保护不在本条动摇 |
| OQ-1 | `GET /api/sources/:conn/:schema/:table` 的 `?format=manifest` 查询参数（反馈报告中出现）当前服务端未消费、静默忽略，是否一并纳入 D2 式显式化 | **已裁：仅文档注明未消费，不报错**（GET 幂等只读） |
| OQ-2 | 用户期望 3（`semantic-assets/validate → publish` 用于单表描述）是否需要文档级示例 | **已裁：随 D6 在 `03-api-spec.md` 补交叉引用关闭**；不新增接口 |
