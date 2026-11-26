# Schema Manifest 按表追加与路径归一化 Plan

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 分阶段实施计划 / **v1.1** |
| 日期 / 功能编号 | 2026-11-25／**P1-90**／REQ-030-111 |
| 状态 | S4｜v1.1。**终稿已确权**（委托人 2026-11-26 明示「逐项拍板，完成终稿确权（S1 → S2）」；OQ-1–OQ-3 已裁；见 [确权材料](../reviews/2026-11-26-p1-89-90-91-ratification-brief.md)）；**开发授权已获得**（2026-11-26）；**实现已落地，待验收**（单测绿；code review PASS WITH WARN；UAT 待跑）；测试台 registered（[UAT-SUITE-SCHEMA-TABLE-APPEND](../qa/uat/suites/schema-table-append/suite.md)／UAT-STA-01–07）；≠ 功能合同收口；≠ UAT PASS；≠ 可上线 |
| 授权边界 | **终稿已确权**；开发授权已获得（2026-11-26），可修改 `webui/server/` 运行代码 |
| 验收 | Spec SC-01–SC-08；测试台套件 [UAT-SUITE-SCHEMA-TABLE-APPEND](../qa/uat/suites/schema-table-append/suite.md)（`UAT-STA-01`–`07`） |
| 关联 | [Spec](../specs/lucy-20261125-schema-manifest-table-append-spec.md) · [客户 Bug 报告](../../inbox/Lucy语义层新表接入_覆盖门禁死锁_Bug报告.md) · [P1-89 Spec](../specs/lucy-20261125-source-write-api-honesty-spec.md) · [P1-91 Spec](../specs/lucy-20261125-overlay-publish-guard-spec.md) |

## 目标

基于客户 Bug 报告（v0.25.0 实测新表接入四路径死锁）与跨 Spec MECE 边界收口，作为语义层 API 三件套（P1-89 → P1-90 → P1-91）的**第 2 步**，在不改 KTX、不改 WebUI 运行导航、**不触碰 `semantic-assets.ts` 与 `semantic-batch-routes.ts`**（publish 覆盖门禁与 plans 错误码已整体归口 P1-91）的前提下，完成：

1. 在 `webui/server/semantic-layer.ts` 抽出公共 `resolveSchemaManifestPath` 大小写归一化，覆盖 `GET`/`PUT`/`import`/`tables` 四条路径；
2. 新增 create-only 按表追加端点 `POST /api/schema-manifests/:conn/:schema/tables`（复用 P1-89 D8 信封、兼容 1/2/3 段物理表名、按表合并不整文件替换、overlay-only 键拒绝、反向 standalone shadow 告警、L25-16 写管线＋catalog reload＋审计）；
3. 配套 `import` `SOURCE_NOT_FOUND` 返回 `data.nextSteps` 指引，以及 `03-api-spec.md` 与 `SYSTEM_HANDBOOK.md` 流程分工登记。

**技术栈：** Node.js／TypeScript（`webui/server/semantic-layer.ts`、新增 `webui/server/schema-manifest-append.ts`、`webui/server/index.ts`）、Vitest、Docker Compose、纯 MCP 探针（复用 `scripts/uat/mcp-*`）。

## 开工前置

1. ~~完成 Spec 评审与终稿确权（OQ-1～OQ-3 裁定）~~ **已完成**（2026-11-26）。
2. 建议 **P1-89 先行落地**（或同批共享 `assertAllowedKeys` 与 D8 响应信封），避免 `semantic-layer.ts` 与 `index.ts` 重复冲突。
3. ~~将本工作项登记至三台账与索引~~ **已完成**（2026-11-25）：`0.30` 执行总账 P1-90 行＋需求池 REQ-030-111；[`docs/README.md`](../README.md) 与 [`docs/plans/README.md`](README.md)；[`docs/governance/e2e-ledger.md`](../governance/e2e-ledger.md) 勾连行（测试台 not_registered）。
4. ~~取得委托人明示**开发授权**后，方可修改 `webui/server/` 下运行代码。~~ **已完成**（2026-11-26 委托人明示授权）。
5. 开工前先全量检索既有测试对 `SOURCE_NOT_FOUND` 及 `GET`/`PUT`/`import` schema 路径错误的断言，评估归一化切换影响面。

## 任务分解

### Task 1：公共 schema 名大小写归一化与全路径族接入（TDD）

- **目标文件**：`webui/server/semantic-layer.ts`、`webui/server/index.ts`、`webui/server/__tests__/api.save.test.ts`、`api.source-import.test.ts`。
- **内容**：
  1. 实现 `resolveSchemaManifestPath`（基于 `readdir` 大小写不敏感匹配，无匹配 `404 SCHEMA_MANIFEST_NOT_FOUND`、多义 `409 AMBIGUOUS_SCHEMA`）。
  2. 将 `GET /api/sources/:conn/:schema/:table`、`PUT /api/sources/:conn/:schema/:table`、`POST .../import` 统一接入该解析函数。
  3. `import` `SOURCE_NOT_FOUND` 响应补 `data.nextSteps: ["POST /api/schema-manifests/<conn>/<schema>/tables"]`。
  4. 补 SC-05 及 SC-06 归一化部分单测（含大小写多义夹具）。

### Task 2：create-only 按表追加端点与反向 shadow 检测（TDD）

- **目标文件**：新增 `webui/server/schema-manifest-append.ts`、`webui/server/index.ts`（路由注册）、新增 `webui/server/__tests__/schema-manifest-append.test.ts`。
- **内容**：
  1. 复用 P1-89 `assertAllowedKeys` 实现合同外顶层字段 `400 INVALID_SCHEMA_APPEND_BODY`。
  2. 实现单表节点抽取与 1/2/3 段物理表名末尾段一致性校验、`TABLE_KEYS` 白名单、column `expr`／`role` 拒绝、create-only `409 TABLE_ALREADY_EXISTS`（`data.nextSteps` 指向 `import`）。
  3. 实现只读反向 shadow 检查 `detectExistingStandaloneShadow`，检出同连接同名 standalone 文件时返回 `EXISTING_STANDALONE_SHADOW` 告警（不阻断）。
  4. 实现 dryRun（`{ diff, proposedYaml, files, noChanges: false, warnings }`）与正式写（复用 L25-16 写管线＋display write barrier＋catalog reload＋审计）。
  5. 单测覆盖 SC-01–SC-04、SC-06（三段名＋反向 shadow）、SC-07（含既有 100+ 表夹具下「其余表节点逐字节不变」与中断恢复断言）。

### Task 3：文档登记

- **目标文件**：`webui/docs/03-api-spec.md`（新端点契约、四路径归一化说明、「向既有 Schema 新增表」追加／import 更新／upload 整文件替换分工）、`docs/SYSTEM_HANDBOOK.md`（数据接入节一句指引）。
- **内容**：按 SC-08 完成文档审查；术语遵守「Schema Manifest 不译」。

### Task 4：本机测试与隔离 Docker UAT 验收

- **内容**：
  1. `cd webui && npm test -- semantic-layer schema-manifest-append api.save api.source-import` 与 `./node_modules/.bin/tsc --noEmit`。
  2. 终稿确权后立测试台套件 `UAT-SUITE-SCHEMA-TABLE-APPEND`（cases 覆盖 SC-01–SC-07），在隔离 Docker demo 以纯 MCP＋API 全真跑次；含「既有 100 表三段名 Manifest 追加 1 表」及「预置同名 standalone 触发反向告警」夹具。

## 浏览器验证

不适用：本条为纯服务端 API 能力，不触及 WebUI 用户可见面，按 `DEVELOPMENT.md`「非 WebUI 任务（默认）」不强制浏览器测试。若 OQ-2 另案引入 WebUI 入口，届时按「WebUI 变更强制浏览器＋计时」单独约定。

## 验收

- Spec `SC-01`–`SC-08` 均有对应自动化测试、跑次证据或文档审查记录。
- 测试台套件（预定 `UAT-STA-01`–`07`）在隔离 Docker demo 全绿，同时覆盖「约束触发」（SC-03／04／05）与「合法路径成交」（SC-01／02／06）。
- `npm run lint:spec-docs`、`npm run lint:terminology` 全绿。

## 完成定义

终稿确权（已完成）→ 开发授权 → Task 1–3 实施与单测全绿 → 立测试台套件并 Docker demo 跑次全绿 → 委托人验收与功能合同收口。

## 风险

| 风险 | 缓解 |
|---|---|
| 新端点与 `catalog/assets/upload`／import 职责混淆 | F-b 文档明确三者分工（追加＝单表新增、import＝单表更新、upload＝整文件受控替换）；端点 create-only 拒绝时通过 `data.nextSteps` 指引 import |
| 大小写归一化在 macOS（大小写不敏感）与 Linux 客户机行为差异 | 归一化只在服务端显式 `readdir` 匹配，不依赖文件系统语义；单测覆盖多义（`BIDW.yaml`＋`bidw.yaml` 并存）→ 409 |
| 追加内容把派生列误写进 Manifest（F6 静默丢弃 gotcha） | 端点显式拒绝 column `expr`／`role` 并指向 overlay；SC-04 锁定 |
| 与 P1-89 同文件协调：`semantic-layer.ts`（`import` 族）、`index.ts`、`03-api-spec.md` | 推荐按 P1-89 → P1-90 顺序落地；本条直接复用 P1-89 抽出的 `assertAllowedKeys` 与 D8 响应信封 |
| 原 F-b／F-c 移交 P1-91 后，旧客户报告死锁链需两条合计闭环 | 已在总账、需求池与两份 Spec 显式互挂：新表正确通道归 P1-90，publish 覆盖门禁确认链与 plans 409 归 P1-91，彼此不重叠、代码文件零交叉 |
