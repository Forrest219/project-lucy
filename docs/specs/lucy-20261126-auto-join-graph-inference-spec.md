# 自动 Join Graph 推断与辅助标注 Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | 自动 Join Graph 推断与辅助标注 Spec |
| 文档类型 / 版本 | Spec（语义层关系发现与多表问数增强）／**v0.1-draft** |
| 日期 / 目标版本 | 2026-11-26／产品线 `0.35.0`（`lucy-v0.35`） |
| 功能编号 / 优先级 | **REQ-0116**／**P1（计划纳入本期开发）**。**不入核心分母** |
| 台账号 | 无。挂常青需求池 `REQ-0116` |
| 阶段 | S1 |
| 状态 | S1｜v0.1-draft。草案；终稿未确权；未获开发授权；测试台 `not_registered`；≠ 功能合同收口；≠ UAT PASS；≠ 可上线 |
| 需求来源 | 对标 [ktx Cloud](https://www.kaelio.com/products/ktx-cloud)「自动生成 Join Graph 与关系推荐」能力，结合 Lucy `REQ-030-024`（多表命中连通性放行）痛点：目前 Join 完全依赖手工填写，未声明 Join 会导致合法多表查询触发额外披露与审计 |
| 实施主体 | `webui/server/semantic-layer.ts`（或新增 `webui/server/join-inference.ts`）、`webui/server/index.ts`、`webui/src/pages/TableEditor.tsx`（`关联` Tab）；不改 KTX 源码；不改 WebUI 运行导航 |
| 配对计划 | [`docs/plans/lucy-20261126-auto-join-graph-inference-plan.md`](../plans/lucy-20261126-auto-join-graph-inference-plan.md) |
| 测试台 | `not_registered`（计划随本套件新建 `UAT-SUITE-AUTO-JOIN-INFERENCE`） |

### Changelog

| 版本 | 变更 |
|---|---|
| v0.1-draft | 2026-11-26 初稿落盘。定义基于 Schema Manifest、字段命名与审计历史 SQL 的三路启发式 Join 推断及 WebUI 一键采纳机制。 |
| v0.1-draft | 2026-11-26 修订：补齐交互合同／元素清单／交互评审（Q1–Q6 未评）；配对 Plan「浏览器验证」节改为四行标签格式；消除 `lint:spec-docs` interaction-contract 警告。 |

## 闭口层级

- 层级：功能合同
- 本条承诺：系统可基于 Schema Manifest 外键约束、字段命名规范与审计库成功查询中的 `JOIN` 条件，离线推断单连接内的候选 Join 关系（含推荐基数与置信度来源），并在表编辑器「关联」页签展示为“推荐关联”，经治理方一键采纳后写入对应 overlay YAML 并刷新索引；未采纳的推荐不自动生效，不改变既有静态 Join 语义。
- 本条出口：三路启发式推断准确率、跨连接隔离、已存在 Join 去重、一键采纳写入 overlay 与索引刷新的本机自动化及浏览器验证（`SC-01`–`SC-07`）。
- 不在本条出口：跨数据源联邦 Join（`vision.md` §5 明确禁止）；未采纳推荐自动放行 `REQ-030-024` 门闩；全库可视化的 ER 图大画布重构。
- 上线关系：本条收口不表示可上线。

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:
- None（复用「Schema Manifest」「overlay」「关联」等既有术语；推荐来源标签使用「外键约束」「审计高频关联」「字段命名匹配」，目标表与列名 DOM 节点须加 `translate="no"` 与 `notranslate`）。

## 交互合同

- 路由：/catalog/:conn/:schema/:table
- 基准页：/catalog
- 一件事：治理方在表编辑器关联页签查看推断出的候选关联并一键采纳或忽略，使多表问数连通路径更完整。
- 状态：首访：不适用：本条不改首访、页头结构与主任务入口；空：当前表无外键、审计 JOIN 或命名匹配依据时推荐区展示空态说明，已配置关联区不受影响；加载：进入关联页签读取推荐期间展示加载占位，不阻塞手工配置；错误：推荐读取失败展示错误提示并保留手工配置入口，不静默吞错；0 条：不适用：推荐区无候选按「空」态呈现，不单列 0 条态；成功：采纳后推荐行移入已配置关联区并提示写入成功，索引刷新后生效；部分：并发冲突返回 409 时提示冲突原因且不破坏既有 overlay 文件
- 主动作：推荐行的「采纳」为该行唯一 primary 操作，「忽略」为同组次要操作；不做未采纳推荐自动生效。
- 决定信息：用户凭推荐卡片上的目标表、连接键、推荐基数与依据来源（外键约束／审计高频关联／字段命名匹配）决定采纳或忽略。
- 术语：「关联」「Schema Manifest」「overlay」已登记；推荐来源标签按本条 Terminology Compliance 登记。
- 台账：无新台账
- 状态维度：采纳成功与 409 冲突提示互斥且文案可区分，同一状态维度不得互相否定。

## 元素清单

- E1｜/catalog/:conn/:schema/:table｜空｜表编辑器关联页签推荐区｜无候选依据时展示空态说明（无外键、审计 JOIN 或命名匹配依据），已配置关联区不受影响
- E2｜/catalog/:conn/:schema/:table｜加载｜表编辑器关联页签推荐区｜读取推荐期间展示加载占位，手工配置入口保持可用
- E3｜/catalog/:conn/:schema/:table｜错误｜表编辑器关联页签推荐区｜推荐读取失败展示错误提示并保留手工配置入口，不静默吞错
- E4｜/catalog/:conn/:schema/:table｜成功｜表编辑器关联页签｜采纳后推荐行移入已配置关联区并提示写入成功，索引刷新后生效
- E5｜/catalog/:conn/:schema/:table｜部分｜表编辑器关联页签推荐行｜并发冲突返回 409 时提示冲突原因且不破坏既有 overlay 文件
- E6｜/catalog/:conn/:schema/:table｜主动作｜推荐关联行操作区｜「采纳」为该行唯一 primary，「忽略」为次要操作；不做未采纳自动生效
- E7｜/catalog/:conn/:schema/:table｜决定信息｜推荐关联候选卡片｜展示目标表、连接键、推荐基数与依据来源，用户可据此决定采纳或忽略

## 交互评审

- Q1 主任务能否从页头和主工作区开始，而不必先读 Spec：未评
- Q2 PageHeader 是否满足按钮规范 §3 第 8 条，其他 action group 是否各自最多一个 primary，并且与「不做」不冲突：未评
- Q3 空、错误、0 条是否在面板内写明原因；不适用是否写了原因：未评
- Q4 决定信息是否足够；截断或隐藏时能否看见原因：未评
- Q5 控件是否与基准页同一套；新模式是否指向已存在的设计系统章节：未评
- Q6 用户可见术语是否已登记，或已写在本 Spec 的 Terminology Compliance：未评

## 受影响画像

> 事实源：[`docs/governance/user-personas.md`](../governance/user-personas.md)。4 画像逐行判定；不得写「所有用户」。

| 画像 | 变更前体验 | 变更后体验 | 判定 | 依据（验收编号／证据） | 负向时的补偿路径 |
|---|---|---|---|---|---|
| P1 问数方 | **问数面**：因治理方漏配 Join，多表关联问数频繁落入未连通分支产生额外披露；**报告面**：未触碰 | **问数面**：治理方采纳推荐 Join 后，语义层连通图更完整，正常多表查询直接按连通路径放行；**报告面**：未触碰 | P1·问数面 ↑／P1·报告面 ＝ | `SC-06`（采纳后连通路径直接放行） | — |
| P2 治理方 | **语义口径面**：需在表编辑器逐一手动查找目标表、列名并填写 Join；**权限授权面**：独立配置 ACL | **语义口径面**：在 `关联` Tab 直接看到推断出的候选关联并一键采纳，大幅降低配置工作量；**权限授权面**：未触碰 | P2·语义口径面 ↑／P2·权限授权面 ＝ | `SC-01`、`SC-02`、`SC-04` | — |
| P3 运维方 | **交付运维面**：无额外部署依赖；**运行观察面**：审计日志正常记录 | **交付运维面**：推断按需/轻量执行，不增加后台常驻服务；**运行观察面**：采纳动作写入配置变更审计 | P3·交付运维面 ＝／P3·运行观察面 ＝ | `SC-05`（写入走既有审计与写锁管线） | — |
| P4 管理层 | 多表分析体验受限于人工 Join 覆盖率 | Join 覆盖率提升，多表分析回答更稳定 | P4·业务结果面 ↑／P4·口径质量面 ＝ | `SC-06`（采纳后多表查询按连通路径放行） | — |

## 第一性原理检查（主路径可用性优先）

| # | 问题 | 回答 |
|---|---|---|
| 1 | 本条生效后，最终用户（含纯 MCP）原先能完成的主任务是否仍能完成？ | 是。未采纳的推荐仅停留在 UI 候选区，对 MCP 运行时零影响 |
| 2 | 若增加拒绝／门禁，逃生或钉选路径是否在同一部署实况下可执行且纳入必做 UAT？ | 是。推断失败或无推荐时，`关联` Tab 仍可正常手工新增/编辑 Join |
| 3 | 验收是否同时覆盖「约束触发」与「合法路径成交」？ | 是。`SC-03` 验跨连接/已存在/已忽略过滤，`SC-04` 验一键采纳成交 |
| 4 | 是否避免把「宿主缺席／凭据缺席」记成用例前置 BLOCKED？ | 是。仅依赖本地 `_schema/` 与 `audit.sqlite` 夹具即可全真测试 |

## 1. 需求摘要

1. **三路启发式 Join 推断引擎（只读分析）**：
   - **信号 1（物理外键）**：读取 `_schema/*.yaml` 中的外键约束定义（置信度最高，默认 `many_to_one`）。
   - **信号 2（审计历史 `JOIN`）**：扫描 `.ktx-ui/audit.sqlite` 中近期执行成功的 SQL，提取高频 `JOIN ... ON a.col = b.col` 条件（仅限同连接内表）。
   - **信号 3（命名规范启发）**：匹配同连接内表之间的 `<table_singular>_id` / `<pk>` 同类型字段（低置信度兜底，仅展示前 N 条）。
2. **去重、忽略与安全边界**：
   - 严格限定在**同一 `connectionId` 内部**推断，绝不生成跨连接推荐。
   - 自动过滤已在 `<table>.yaml` overlay 中声明的 Join，以及治理方已点击「忽略」的边（持久化至 `.ktx-ui/ignored-joins.json` 或等价轻存储）。
3. **只读推荐接口与一键采纳**：
   - 新增 `GET /api/sources/:conn/:schema/:table/join-suggestions` 返回候选列表。
   - 采纳时复用现有 overlay 写入管线（带写锁、合法性校验与 `reindex` 触发），并记录配置变更审计。

## 核心流程（伪代码）

```text
function inferJoinSuggestions(connId, schema, table):
  manifest = loadSchemaManifest(connId)
  targetTable = manifest.findTable(schema, table)
  existingJoins = loadOverlayJoins(connId, schema, table)
  ignoredSet = loadIgnoredJoins(connId, schema, table)

  rawCandidates = []
  // 1. 物理外键
  for fk in targetTable.foreignKeys:
    rawCandidates.push({ to: fk.refTable, on: [fk.col, fk.refCol], source: "foreign_key", score: 1.0 })
  // 2. 审计成功 SQL 中的同连接 JOIN
  for joinEdge in extractAuditJoinEdges(connId, table):
    if manifest.hasTable(joinEdge.to):
      rawCandidates.push({ to: joinEdge.to, on: joinEdge.on, source: "audit_sql", score: 0.85 })
  // 3. 字段命名匹配（如 customer_id -> dim_customer.id）
  for col in targetTable.columns:
    for candidateTable in manifest.tablesInSameConn():
      if matchesIdNamingAndType(col, candidateTable):
        rawCandidates.push({ to: candidateTable.name, on: [col.name, candidateTable.pk], source: "naming", score: 0.5 })

  return deduplicateAndSort(rawCandidates)
    .filter(c => !isInExisting(c, existingJoins) and !isInIgnored(c, ignoredSet))
    .slice(0, 20)
```

## 验收（SC）

| ID | 合同 |
|---|---|
| SC-01 | 给定含外键的 Schema Manifest，`join-suggestions` 能准确返回高置信度候选 Join 及推荐基数 |
| SC-02 | 给定含历史成功 `JOIN` 查询的 `audit.sqlite`，能提取出同连接内的有效关联条件并标注来源为 `audit_sql` |
| SC-03 | 跨连接表名、已在 overlay 中配置的 Join、以及被用户「忽略」的 Join 均不会出现在推荐列表中 |
| SC-04 | 在 WebUI 表编辑器 `关联` Tab 点击「采纳」后，Join 正确写入 overlay YAML、触发索引刷新并从推荐区移至已配置区（含前台浏览器计时） |
| SC-05 | 采纳写入复用既有写锁与配置变更审计，并发编辑冲突时安全返回 `409` 不破坏文件 |
| SC-06 | 采纳推荐 Join 后，原本因未连通而触发披露的多表 `lucy_query` 查询可按连通路径直接放行 |
| SC-07 | `GET /join-suggestions` 在无外键、无审计记录的空库场景下正常返回空数组，不报错且不阻塞 `关联` Tab 手工配置 |
