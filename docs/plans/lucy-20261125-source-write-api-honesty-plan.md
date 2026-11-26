# 语义层 source 写接口诚实响应与描述写入陷阱修复 Plan

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 分阶段实施计划 / **v1.1** |
| 日期 / 功能编号 | 2026-11-25／**P1-89**／REQ-030-110 |
| 状态 | S4｜v1.1。**终稿已确权**（委托人 2026-11-26 明示「逐项拍板，完成终稿确权（S1 → S2）」；D3＝D3a；见 [确权材料](../reviews/2026-11-26-p1-89-90-91-ratification-brief.md)）；**开发授权已获得**（2026-11-26）；**实现已落地，待验收**（单测/浏览器验证通过；code review PASS WITH WARN；UAT 待跑）；测试台 registered（[UAT-SUITE-SOURCE-WRITE-HONESTY](../qa/uat/suites/source-write-honesty/suite.md)／UAT-SWH-01–06）；≠ 功能合同收口；≠ UAT PASS；≠ 可上线 |
| 授权边界 | **终稿已确权**；开发授权已获得（2026-11-26），可修改 `webui/server/` 与 `webui/src/` 运行代码 |
| 验收 | Spec SC-01–SC-10；测试台套件 [UAT-SUITE-SOURCE-WRITE-HONESTY](../qa/uat/suites/source-write-honesty/suite.md)（`UAT-SWH-01`–`06`）；浏览器验证 E1–E4（真实前台＋计时） |
| 关联 | [Spec](../specs/lucy-20261125-source-write-api-honesty-spec.md) · [P1-90 Spec](../specs/lucy-20261125-schema-manifest-table-append-spec.md) · [P1-91 Spec](../specs/lucy-20261125-overlay-publish-guard-spec.md) |

## 目标

依据 2026-11-25 用户反馈报告（[`inbox/Lucy语义层source描述无法通过API修改_问题反馈.md`](../../inbox/Lucy语义层source描述无法通过API修改_问题反馈.md)）与当日代码核查结论（Spec §1 F1–F8），作为语义层 API 三件套（P1-89 → P1-90 → P1-91）的**第 1 步**，在不改变既有合同内调用行为的前提下完成：

1. PUT／import 零写入时返回 `written: false`＋`noChanges: true`＋`writtenFiles: []`，并消除零写入副作用（版本快照／`changedSources`／显示缓存失效）；
2. 抽出公共请求体键白名单校验 `assertAllowedKeys`，合同外请求字段显式 400 并带 `data.nextSteps`（供 P1-90／P1-91 复用）；
3. import 被分流规则丢弃的 schema 键输出 `IMPORT_SCHEMA_KEYS_IGNORED` 告警；按已裁 **D3a** 对表级 `descriptions` 豁免合并；
4. 响应新增 `writtenFiles`，dryRun 新增 `noChanges`，确立 D8 语义层写接口统一信封；
5. WebUI 表编辑器无变更保存提示「内容无变更，未写入」；
6. `03-api-spec.md` 与 Spec 114 文档补录。

**技术栈：** Node.js／TypeScript（`webui/server/index.ts`、`webui/server/semantic-layer.ts`）、React（`webui/src/pages/TableEditor.tsx`）、Vitest、Docker Compose、真实前台浏览器。

## 开工前置

1. ~~完成 Spec 评审与终稿确权（含 D3a／D3b 裁定、D8 信封冻结、OQ-1／OQ-2 关闭）~~ **已完成**（2026-11-26；D3＝D3a）。
2. ~~测试台补建套件 `UAT-SUITE-SOURCE-WRITE-HONESTY`（`UAT-SWH-01`–`06`）并更新 [`docs/governance/e2e-ledger.md`](../governance/e2e-ledger.md) P1-89 勾连行（当前 not_registered）。~~ **已完成**（2026-11-26；套件见 [suites/source-write-honesty](../qa/uat/suites/source-write-honesty/suite.md)）。
3. ~~取得委托人明示**开发授权**后，方可修改 `webui/server/` 与 `webui/src/` 下的运行代码。~~ **已完成**（2026-11-26 委托人明示授权）。

## 任务分解

### Task 1：零写入诚实响应与副作用消除（TDD）

- **目标文件**：`webui/server/index.ts`（PUT `1162-1217`、import `1219-1278` 路由）、`webui/server/__tests__/api.save.test.ts`、`api.source-import.test.ts`。
- **内容**：
  1. 路由在 `preview.files.length === 0` 时短路：返回 `written: false`＋`noChanges: true`＋`writtenFiles: []`，跳过 `createTableYamlVersionSnapshot`、`changedSources.set` 与显示缓存失效；validation 仍返回当前源有效性。
  2. 有写入时响应新增 `noChanges: false`、`writtenFiles: preview.files.map(f => f.filePath)`。
  3. 补齐 SC-01／SC-03／SC-06 单测。

### Task 2：公共合同外字段 400 校验（D2／D8）

- **目标文件**：`webui/server/index.ts` 两路由入口（抽出共用 `assertAllowedKeys` 帮助函数，供 P1-90／P1-91 复用）。
- **内容**：PUT 允许键 `{patch, dryRun, restoredFromVersionId}`，import 允许键 `{yaml, dryRun, sourceFileName, restoredFromVersionId}`；合同外键 → 400 `INVALID_SOURCE_PATCH_BODY`，消息含正确字段指引且 `data.nextSteps` 为数组；dryRun 与落盘同样校验。补 SC-02 单测。

### Task 3：import 分流告警与 D3a 落地

- **目标文件**：`webui/server/semantic-layer.ts`（`planSourceYamlImport` `995-1058`、`previewSourceYamlImport`／`writeSourceYamlImport`）、`webui/server/__tests__/api.source-import.test.ts`。
- **内容**：`SourceYamlImportDelta` 增加 `warnings`；按已裁 **D3a** 实现表级 `descriptions` 豁免合并；被忽略 schema 键输出 `IMPORT_SCHEMA_KEYS_IGNORED`；warnings 透传 PUT／import 响应。补 SC-04／SC-05 单测。

### Task 4：dryRun `noChanges` 与文档补录

- **目标文件**：`webui/server/semantic-layer.ts`（`SourcePreview` 类型与两处 preview 函数）、`webui/docs/03-api-spec.md`、`webui/docs/114-table-editor-overlay-safe-yaml-import-spec.md`。
- **内容**：preview 响应增加 `noChanges`；`03-api-spec.md` PUT 小节展开 `TablePatch` 字段表、import 小节补 P0/P1 分流与告警契约、D8 写接口统一信封约定、`changedFiles` 语义注记、`GET /api/catalog/assets/schema-manifest` 交叉引用；Spec 114 加 Changelog。补 SC-07 单测与 SC-09 核对。

### Task 5：WebUI 无变更提示

- **目标文件**：`webui/src/pages/TableEditor.tsx`（`saveMutation.onSuccess` `1321-1324`）与 `webui/src/__tests__/table-editor.test.tsx`。
- **内容**：`SourceSaveResponse` 类型补 `noChanges`／`writtenFiles`；成功回调按 `noChanges` 分支提示「内容无变更，未写入」／「已保存到语义层」；组件测试＋真实前台浏览器验证（E1–E4，含计时）。补 SC-08。

### Task 6：回归与 UAT

- **内容**：`cd webui && npm test -- api.save api.source-import table-editor` 及相关套件、`tsc --noEmit`、`npm run lint:spec-docs`／`lint:terminology`；测试台套件 `UAT-SUITE-SOURCE-WRITE-HONESTY` 建立后在隔离 Docker demo 执行 UAT 并登记跑次（SC-10）。

## 浏览器验证

- 路由：/catalog/:conn/:schema/:table
- 视口：1920×1080
- 状态：E1、E2、E3、E4
- 证据：未执行

## 验收

- Spec `SC-01`–`SC-10` 均有对应自动化测试、文档核对或浏览器证据。
- 测试台套件（预定 `UAT-SWH-01`–`06`）在隔离 Docker demo 执行并通过。
- 浏览器验证 E1–E4 在真实前台浏览器执行并记录导航→关键内容可见计时，与 API 耗时分列。
- 同时覆盖「约束生效」（SC-01／SC-02／SC-05）与「合法用户仍可用」（SC-03／SC-04／SC-06／SC-08）。
- `npm run lint:spec-docs`、`npm run lint:terminology` 全绿。

## 完成定义

终稿确权（已完成；D3＝D3a／D8 冻结）→ 测试台补建套件并挂勾连 → 开发授权 → Task 1–6 实施与单测全绿 → 真实前台浏览器验证 E1–E4 → Docker demo UAT 全绿 → 委托人验收与功能合同收口。

## 风险

| 风险 | 缓解 |
|---|---|
| `written` 语义诚实化影响依赖旧假成功的外部脚本 | 属诚实化修复（旧调用从未真正生效）；错误消息与 `data.nextSteps` 含逃生指引；文档 Changelog 显式标注行为变更 |
| D3a 扩大 2026-08-25 P0 裁定边界 | **已裁 D3a**；`columns`／`joins` 保护不在本条动摇；SC-05 覆盖 |
| 既有测试断言 `written: true` 的用例被短路分支打破 | 开工前全量检索 `written` 断言；仅在零文件预览时改变响应 |
| 与 P1-90 共享 `semantic-layer.ts`（`import` 族）与 `03-api-spec.md` | 推荐落地序：P1-89 先行冻结 D8 信封与 `import` 诚实化，P1-90 在其上叠加公共 schema 归一化与新追加端点，减少 rebase 冲突 |
| 浏览器验证环境不可用导致 SC-08 缺口 | 按测试台第一性原则：无法全真时向委托人独立授权后方可降级，未授权不得主张已验证 |
