# Schema Manifest 按表追加与覆盖门禁逃生修复 Plan

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 分阶段实施计划 / **v0.1-draft** |
| 日期 / 功能编号 | 2026-11-25／**P1-90**／REQ-030-111 |
| 状态 | S1｜v0.1-draft。**终稿未确权**；**开发未授权**；测试台 not_registered；≠ 功能合同收口；≠ UAT PASS；≠ 可上线 |
| 授权边界 | 本文件仅为规划草案；**取得委托人终稿确权与开发授权前，禁止修改任何运行代码** |
| 验收 | Spec SC-01–SC-08；测试台套件待立（预定 `UAT-SUITE-SCHEMA-TABLE-APPEND`／`UAT-STA-*`） |
| 关联 | [Spec](../specs/lucy-20261125-schema-manifest-table-append-spec.md) · [客户 Bug 报告](../../inbox/Lucy语义层新表接入_覆盖门禁死锁_Bug报告.md) |

## 目标

基于客户 Bug 报告（v0.25.0 实测新表接入四路径死锁）与代码核查，在不改 KTX、不改 WebUI 运行导航的前提下，在 Lucy 服务端完成：

1. 新增 create-only 按表追加端点 `POST /api/schema-manifests/:conn/:schema/tables`（按表合并、dryRun 预览、schema 名归一化、overlay-only 键拒绝、L25-16 写管线＋catalog reload＋审计）；
2. 配套契约修复：import 拒绝指引与归一化（F-a）、publish 覆盖门禁阻断不删 snapshot（F-b）、plans 错误码区分（F-c）、API 文档与手册流程段（F-d）。

**技术栈：** Node.js／TypeScript（`webui/server/semantic-layer.ts`、`semantic-assets.ts`、`semantic-batch-routes.ts`、`index.ts`）、Vitest、Docker Compose、纯 MCP 探针（复用 `scripts/uat/mcp-*`）。

## 开工前置

1. 完成 Spec 评审与**终稿确权**（OQ-1～OQ-3 裁定）；**未确权前禁止改运行代码**。
2. ~~将本工作项登记至三台账与索引~~ **已完成**（2026-11-25 随起草同批登记）：`0.30` 执行总账 P1-90 行＋需求池 REQ-030-111；[`docs/README.md`](../README.md) 与 [`docs/plans/README.md`](README.md)；[`docs/governance/e2e-ledger.md`](../governance/e2e-ledger.md) 勾连行（测试台 not_registered）。
3. 取得委托人明示**开发授权**后，方可修改 `webui/server/` 下运行代码。
4. 开工前先全量检索既有测试对以下行为的断言，评估 F-b／F-c 影响面：`deleteSnapshot`（`semantic-assets.ts:3494` 阻断路径）、`VALIDATION_SNAPSHOT_NOT_FOUND`、`VALIDATION_GATE_FAILED`、`SOURCE_NOT_FOUND`。

## 任务分解

### Task 1：schema 名归一化与 create-only 追加端点（TDD）

- **目标文件**：`webui/server/semantic-layer.ts`（归一化解析、`TABLE_KEYS` 复用）、`webui/server/index.ts`（路由注册）、新增 `webui/server/schema-manifest-append.ts`（端点实现，复用 `writeSourceYamlImport` 的锁序与恢复管线）。
- **内容**：
  1. 实现 `resolveSchemaManifestPath`（大小写不敏感匹配、404／409 分流），import 路径（`previewSourceYamlImport`／`writeSourceYamlImport`）同批切换复用。
  2. 实现追加端点：单表节点抽取与物理表名一致性校验、`TABLE_KEYS` 白名单、column `expr`／`role` 拒绝、create-only 409、dryRun diff、正式写管线、catalog reload、审计。
  3. 单测覆盖 SC-01–SC-05（含既有 100+ 表夹具下「其余表节点逐字节不变」断言）。

### Task 2：publish 门禁阻断不删 snapshot＋plans 错误码区分

- **目标文件**：`webui/server/semantic-assets.ts`（`:3474-3507` 阻断路径、`:4378` `describeSemanticBatchPlan`）。
- **内容**：
  1. 移除阻断路径的 `deleteSnapshot` 调用，保留 release blocked 记录与锁释放；补单测：阻断后同一 validationId `confirmOverwrite:true` 重试成交（SC-06 前半）。
  2. `describeSemanticBatchPlan` 对非 batch 快照改抛 `PLAN_PREVIEW_NOT_AVAILABLE`（409），与 404 `VALIDATION_SNAPSHOT_NOT_FOUND` 分流；补单测（SC-06 后半）。
  3. 回归既有幂等回放（`:3311-3337`）与 TOCTOU 复验（`:3510`）相关测试全绿。

### Task 3：文档登记

- **目标文件**：`webui/docs/03-api-spec.md`（新端点契约＋「向既有 Schema 新增表」流程段：追加／import 更新／upload 整文件替换分工）、`docs/SYSTEM_HANDBOOK.md`（数据接入节一句指引）。
- **内容**：按 SC-08 完成文档审查；术语遵守「Schema Manifest 不译」。

### Task 4：本机测试与隔离 Docker UAT 验收

- **内容**：
  1. `cd webui && npm test -- semantic-layer semantic-assets schema-manifest-append` 与 `./node_modules/.bin/tsc --noEmit`。
  2. 终稿确权后立测试台套件 `UAT-SUITE-SCHEMA-TABLE-APPEND`（cases 覆盖 SC-01–SC-07），在隔离 Docker demo 以纯 MCP＋API 全真跑次；含「既有 100 表 Manifest 追加 1 表」客户同形夹具。
  3. 向报告人索取 `confirmOverwrite:true` 原始请求 payload，闭环 OQ-5。

## 浏览器验证

不适用：本条为纯服务端 API 能力，不触及 WebUI 用户可见面，按 `DEVELOPMENT.md`「非 WebUI 任务（默认）」不强制浏览器测试。若 OQ-4 另案引入 WebUI 入口，届时按「WebUI 变更强制浏览器＋计时」单独约定。

## 验收

- Spec `SC-01`–`SC-08` 均有对应自动化测试、跑次证据或文档审查记录。
- 测试台套件（待立）在隔离 Docker demo 全绿，同时覆盖「约束触发」（SC-03／04／05）与「合法路径成交」（SC-01／02／06）。
- `npm run lint:spec-docs`、`npm run lint:terminology` 全绿。

## 完成定义

终稿确权 → 开发授权 → Task 1–3 实施与单测全绿 → 立测试台套件并 Docker demo 跑次全绿 → 委托人验收与功能合同收口。

## 风险

| 风险 | 缓解 |
|---|---|
| F-b 移除阻断路径 `deleteSnapshot` 影响 L25-11 既有测试与「快照一次性」设计意图 | 开工前置 4 先全量检索断言；保留 blocked release 记录与 opportunistic prune；幂等键检查在 snapshot 读取之前不受影响；TOCTOU 由 `runValidateGate` 重跑兜底；评审时显式核对 L25-11 D15 注释语义 |
| 新端点与 `catalog/assets/upload`／import 职责混淆 | F-d 文档明确三者分工（追加＝单表新增、import＝单表更新、upload＝整文件受控替换）；端点 create-only 拒绝时指引 import |
| 大小写归一化在大小写不敏感文件系统（macOS 开发机）与 Linux 客户机行为差异 | 归一化只在服务端显式 `readdir` 匹配，不依赖文件系统语义；单测覆盖多义（`BIDW.yaml`＋`bidw.yaml` 并存）→ 409 |
| 追加内容把派生列误写进 Manifest（F9 静默丢弃 gotcha） | 端点显式拒绝 column `expr`／`role` 并指向 overlay；SC-04 锁定 |
| 客户报告与代码矛盾点（OQ-5）未闭环 | F-b 消除该歧义类别；Task 4 向报告人索取原始 payload 作闭环确认，不阻塞本条设计与实现 |
| 与 P1-89（REQ-030-110，写接口诚实性）同文件协调：import 族函数（`semantic-layer.ts`）、`index.ts` 路由、`03-api-spec.md` import 小节、`api.source-import` 等共享测试文件 | 两条 Spec 均为 S1 草案，评审互相知会；后落地一方 rebase；新端点响应惯例（`writtenFiles`／`noChanges`／合同外字段 400）与 P1-89 保持一致，已在 Spec §2.1 登记 |
