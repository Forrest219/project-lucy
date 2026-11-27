# 语义层 overlay 发布通道冲突护栏与生命周期修复 Plan

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 分阶段实施计划 / **v1.2** |
| 日期 / 功能编号 | 2026-11-25／**P1-91**／REQ-030-112 |
| 状态 | S5｜v1.2。**功能合同已收口**（2026-11-28，[收口记录](../reviews/2026-11-28-p191-s5-closure-record.md)：SC-01–SC-09 全部关闭）；测试台 `UAT-SUITE-OVERLAY-PUBLISH-GUARD` **PASS**（R0／OPG-01–08 全绿；GAP-OPG-08-BATCH 2026-11-27 补跑关闭；GAP-OPG-02-ENGINE 2026-11-28 引擎面补验关闭）；终稿已确权（2026-11-26）；开发授权已获得（2026-11-26）；不入核心分母；≠ 可上线 |
| 授权边界 | **终稿已确权**；开发授权已获得（2026-11-26，Task 0 实证通过后落地），可修改 `webui/server/` 运行代码 |
| 验收 | Spec SC-01–SC-09；测试台套件 [UAT-SUITE-OVERLAY-PUBLISH-GUARD](../qa/uat/suites/overlay-publish-guard/suite.md)（`UAT-OPG-01`–`08`） |
| 关联 | [Spec](../specs/lucy-20261125-overlay-publish-guard-spec.md) · [客户修正版报告](../../inbox/Lucy新表接入_overlay与schema冲突_问题报告.md) · [P1-89 Spec](../specs/lucy-20261125-source-write-api-honesty-spec.md) · [P1-90 Spec](../specs/lucy-20261125-schema-manifest-table-append-spec.md) |

## 目标

作为语义层 API 三件套（P1-89 → P1-90 → P1-91）的**第 3 步**，本条**独占 `semantic-assets` 通道全部改动**（`semantic-assets.ts`、`semantic-batch-routes.ts`、新增 `semantic-overlay-lifecycle.ts`），在不改 KTX、不改 WebUI 运行导航、不触碰 `webui/server/proxy/**` 的前提下完成：

1. overlay 物理名契约（D1）：`table:` 支持三段名（OQ-4 已裁＝方案 A）；
2. publish 窗口双 409 门禁协同与 snapshot 保留（D2，含原 P1-90 F-b）：覆盖门禁与同名 shadow 护栏均不删 snapshot，同命中时返回 `data.pendingConfirmations` 支持单次组合确认重试；
3. `plans/:validationId` 非 batch 错误码区分（D3，原 P1-90 F-c）：区分 `409 PLAN_PREVIEW_NOT_AVAILABLE` 与 `404 VALIDATION_SNAPSHOT_NOT_FOUND`；
4. per-table overlay 只读发现（`GET /api/semantic-assets/overlays`）与受控删除（`DELETE /api/semantic-assets/overlay/:conn/:sourceName`，保护业务合并型 overlay 不被误删、复用 L25-16 完整写管线＋展示读屏障＋`reloadCatalog`）；
5. API 文档与手册契约登记（F-b）。

**技术栈：** Node.js／TypeScript（`webui/server/semantic-assets.ts`、`semantic-batch-routes.ts`、`index.ts`，提案新增 `semantic-overlay-lifecycle.ts`）、Vitest、Docker Compose、纯 MCP 探针（复用 `scripts/uat/mcp-*`）。

## 开工前置

1. ~~完成 Spec 评审与终稿确权（OQ-1～OQ-6 裁定）~~ **已完成**（2026-11-26；OQ-1 设计冻结方案 A，Task 0 改挂开发授权前置）。
2. 推荐 **P1-89 与 P1-90 先行落地**（复用 P1-89 `assertAllowedKeys` 与 D8 信封，且确保 `data.nextSteps` 指向的 P1-90 追加端点已上线；若单独先行落地，临时把 `nextSteps` 指向 `catalog/assets/upload` 与 `import`）。
3. ~~将本工作项登记至三台账与索引~~ **已完成**（2026-11-25）：`0.30` 执行总账 P1-91 行＋需求池 REQ-030-112；[`docs/README.md`](../README.md) 与 [`docs/plans/README.md`](README.md)；[`docs/governance/e2e-ledger.md`](../governance/e2e-ledger.md) 勾连行（测试台 not_registered）。
4. ~~**Task 0 引擎实证通过后**，取得委托人明示**开发授权**，方可修改 `webui/server/` 下运行代码。~~ **已完成**（2026-11-26：Task 0 实证通过（方案 A 成立，记录 [`inbox/p191-task0/RECORD.md`](../../inbox/p191-task0/RECORD.md)）；委托人明示开发授权）。
5. 开工前全量检索既有测试对以下行为的断言：`OVERLAY_MISSING_TABLE`、`QUALIFIED_TABLE_RE`／`parseTableRef`、`deleteSnapshot`（`semantic-assets.ts:3494`）、`VALIDATION_SNAPSHOT_NOT_FOUND`、`VALIDATION_GATE_FAILED`、维护包（batch）round-trip 夹具。

## 任务分解

### Task 0：OQ-1 引擎实证（开发授权前置的只读取证）

- **内容**：在隔离 Docker demo 手工落盘三段名 standalone 文件（不改任何代码，直接写临时环境的 `semantic-layer/` 内容卷），实证 `sl_query`／`lucy_query` 对三段名 standalone 的运行时行为；可用引擎优先级：Doris external catalog 三段名场景 → SQL Server UAT 环境 → 编译层断言兜底。
- **产出**：取证记录落 `inbox/`（临时产物），结论回写 Spec OQ-1；若实证推翻方案 A，Spec 升版改判后再提请开发授权。

### Task 1：overlay 物理名契约（D1，TDD）

- **目标文件**：`webui/server/semantic-assets.ts`（classify 的 semanticSource 分支，`:750-782`）。
- **内容**：
  1. 新增 overlay 专用 `table:` 解析（两段或三段，段字符白名单），**不改**共享 `parseTableRef`／`QUALIFIED_TABLE_RE`；`physicalTable` 原样记录。
  2. `OVERLAY_MISSING_TABLE` 文案更新为「两段或三段」；validate 响应如实标注 `table:` 将原样成为查询物理表名。
  3. 单测覆盖 SC-01（三段通过＋落盘原样；两段回归逐字节一致）与非法段数／非法字符拒绝。

### Task 2：publish 双 409 门禁协同＋snapshot 保留＋plans 409 区分（D2／D3，TDD）

- **目标文件**：`webui/server/semantic-assets.ts`（validate 流程、publish 窗口 `:3300-3507`、`describeSemanticBatchPlan` `:4378`）、`webui/server/semantic-batch-routes.ts`。
- **内容**：
  1. 移除覆盖门禁阻断路径的 `deleteSnapshot` 调用（原 P1-90 F-b），保留 blocked release 记录与锁释放。
  2. 实现 `checkManifestShadow`（连接内 manifest `tables` 键查找，复用 catalog 缓存）；validate 响应以 **warnings** 携带冲突信号（OQ-5 已裁）。
  3. publish 窗口内同步检查覆盖门禁与同名 shadow 冲突：任一未确认均不删 snapshot，同时未确认返回 `409 OVERLAY_MANIFEST_CONFLICT`＋`data.pendingConfirmations: ["confirmOverwrite", "allowManifestShadow"]`＋`data.nextSteps`；带齐确认参数一次重试成交。
  4. `describeSemanticBatchPlan` 对非 batch 快照改抛 `409 PLAN_PREVIEW_NOT_AVAILABLE`（原 P1-90 F-c），与 `404 VALIDATION_SNAPSHOT_NOT_FOUND` 分流。
  5. batch 通道按 OQ-5：**不硬阻断**，validate 报 warnings。
  6. 单测覆盖 SC-03、SC-06 与幂等回放／TOCTOU 回归（SC-08）。

### Task 3：per-table overlay 只读发现与受控删除端点（F-a，TDD）

- **目标文件**：提案新增 `webui/server/semantic-overlay-lifecycle.ts`；`webui/server/index.ts`（路由注册）；新增 `webui/server/__tests__/semantic-overlay-lifecycle.test.ts`。
- **内容**：
  1. 实现 `GET /api/semantic-assets/overlays?conn=`：扫描 per-table 文件，分类 `standalone` vs `merge_overlay` 并标注 `shadowsManifest`／`manifestPath`。
  2. 实现 `DELETE /api/semantic-assets/overlay/:conn/:sourceName`（OQ-6 已裁路径参数形态）：复用 P1-89 `assertAllowedKeys` 校验查询参数、路径段白名单、404／400 分流、`merge_overlay` 防误删保护（`409 OVERLAY_BUSINESS_ENRICHMENT_PROTECTED`，需 `confirmBusinessOverlayDelete=true`）、dryRun（对齐 P1-89 D8 信封）。
  3. 正式删除复用完整 L25-16 写管线（`withKtxYamlWriteLock → withDisplayWriteBarrier(["D"]) → withPublishCoordinator → release + recovery journal → auditedDeleteFile → closeContentBatch`）＋`reloadCatalog(projectRoot)`＋审计。
  4. 单测覆盖 SC-04（删除回落 manifest）、SC-05（安全边界、恢复日志、审计）、SC-07（列表发现＋业务 overlay 防误删）。

### Task 4：文档登记（F-b）

- **目标文件**：`webui/docs/03-api-spec.md`（物理名规则、双 409 门禁、plans 409/404、只读列表与删除端点契约）、`docs/SYSTEM_HANDBOOK.md`（数据接入节指引）。
- **内容**：与 P1-90 分工段交叉引用，明确「publish overlay＝发布独立命名 source，不是新表接收入口」；术语遵守「Schema Manifest 不译」。

### Task 5：本机测试与隔离 Docker UAT 验收

- **内容**：
  1. `cd webui && npm test -- semantic-assets semantic-overlay-lifecycle` 与 `./node_modules/.bin/tsc --noEmit`。
  2. 终稿确权后立测试台套件 `UAT-SUITE-OVERLAY-PUBLISH-GUARD`（cases 覆盖 SC-01–SC-08），在隔离 Docker demo 以纯 MCP＋API 全真跑次；含「manifest 100 表连接上误发同名 overlay→双 409 门禁拦截→组合确认放行→列表发现→安全删除回落」及「业务合并型 overlay 防误删」客户同形旅程。
  3. OQ-6 客户 `confirmOverwrite:true` 原始请求 payload 取证闭环。

## 浏览器验证

不适用：本条为纯服务端 API 能力，不触及 WebUI 用户可见面，按 `DEVELOPMENT.md`「非 WebUI 任务（默认）」不强制浏览器测试。若后续另案引入 WebUI 发布界面变更，届时按「WebUI 变更强制浏览器＋计时」单独约定。

## 验收

- Spec `SC-01`–`SC-09` 均有对应自动化测试、跑次证据、实证记录或文档审查记录。
- 测试台套件（预定 `UAT-OPG-01`–`08`）在隔离 Docker demo 全绿，同时覆盖「约束触发」（SC-03／05／06／07）与「合法路径成交」（SC-01／02／04／06）。
- `npm run lint:spec-docs`、`npm run lint:terminology` 全绿。

## 完成定义

终稿确权（已完成）→ Task 0 实证回写 → 开发授权 → Task 1–4 实施与单测全绿 → 立测试台套件并 Docker demo 跑次全绿 → 委托人验收与功能合同收口。

## 风险

| 风险 | 缓解 |
|---|---|
| OQ-1 实证推翻方案 A（三段名 standalone 运行时不可查询） | Task 0 前置于开发授权；推翻则 Spec 升版改判方案 B／C 后再授权，不带病开发 |
| 放开三段名污染共享 `parseTableRef` 语义 | overlay 专用解析独立实现，共享函数逐字节不动；开工前置 5 全量检索调用点；SC-08 回归锁定 |
| 移除阻断路径 `deleteSnapshot` 影响 L25-11 既有测试与快照一次性语义 | 开工前置 5 全量检索断言；保留 blocked release 记录与 opportunistic prune；幂等键检查与 TOCTOU 复验均不受影响 |
| 冲突护栏误伤既有自动化 | 显式确认参数保底放行；双 409 支持单次组合确认；维护包 round-trip **不硬阻断**（OQ-5 已裁） |
| 删除端点误删 WebUI 维护的业务合并型 overlay | 强制按文件内容区分 `standalone` vs `merge_overlay`，后者默认 `409 OVERLAY_BUSINESS_ENRICHMENT_PROTECTED` 拒绝，须 `confirmBusinessOverlayDelete=true`；SC-07 锁定 |
| 与 P1-89／P1-90 协调 | 原 P1-90 F-b／F-c 归口本条后，三份 Spec 在核心业务代码文件（`semantic-layer.ts` vs `semantic-assets.ts`）零交叉；仅共享 `index.ts` 路由注册与 `03-api-spec.md`，按 P1-89 → P1-90 → P1-91 落地即可零冲突 |
| 上游 KTX 行为取证基于 npm 包静态阅读（0.16.0），与运行时镜像内版本漂移 | 以 `LUCY_BUNDLED_KTX_VERSION`（当前 0.16.0，`deploy/k8s/K8S_CONTRACT.md`）为锚；Task 0 实证在运行镜像内执行，双重确认 |

## Changelog

| 版本 | 变更 |
|---|---|
| v1.2 | 2026-11-28 **功能合同收口（S4 → S5）**：SC-01–SC-09 全部关闭（[收口记录](../reviews/2026-11-28-p191-s5-closure-record.md)）；测试台 PASS——GAP-OPG-08-BATCH 2026-11-27 补跑关闭（Task 5.2 完成）；GAP-OPG-02-ENGINE 2026-11-28 引擎面补验关闭（隔离栈＋Doris 引擎 `lucy_query` 三段名全链路 `rows=[[142.5, 142.5]]`，跑次 [2026-11-28-claude-opg02-engine-doris](../qa/uat/suites/overlay-publish-guard/runs/2026-11-28-claude-opg02-engine-doris.md)）。≠ 可上线。 |
| v1.1 | 2026-11-26 Task 0 引擎实证通过（方案 A 成立，记录 [`inbox/p191-task0/RECORD.md`](../../inbox/p191-task0/RECORD.md)）；委托人明示开发授权；实现已落地（单测/类型检查绿，待验收）；测试台套件 `UAT-SUITE-OVERLAY-PUBLISH-GUARD`（`UAT-OPG-01`–`08`）建立并挂勾连；开工前置项 4 完成、状态行更新。≠ 功能合同收口；≠ UAT PASS；≠ 可上线。 |
| v1.0 | 2026-11-26 终稿确权（S1 → S2，OQ-1～OQ-6 已裁）。阶段 S2；开发未授权；测试台 not_registered。 |
