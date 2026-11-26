# 资产列表 Zoom 交互 · 实施计划

| 元数据 | 内容 |
|---|---|
| 文档名称 | 资产列表 Zoom 交互 · 实施计划 |
| 文档类型 / 版本 | Plan／**v1.0** |
| 日期 / 功能编号 | 2026-11-27／**REQ-0120**（P1，计划纳入 `v0.35.0`） |
| 阶段 | S2 |
| 状态 | S2｜v1.0。配对 Spec **终稿已确权**（委托人 2026-11-27）。本 Plan／UAT 经 Kimi Code 对抗后定稿（见[评审](../reviews/2026-11-27-asset-list-zoom-plan-uat-adversarial-review.md)）。**未获开发授权**；浏览器验证未执行；测试台 `UAT-SUITE-ASSET-LIST-ZOOM`＝**NOT RUN**。≠ 功能合同收口；≠ UAT PASS；≠ 可上线 |
| 授权边界 | Spec 终稿已确权 ≠ 开发授权。未获委托人另发开发授权前禁止改 `webui/src/**` 与运行时配置 |
| 验收 | Spec `SC-01`–`SC-15`；交互合同 E1–E16；测试台 `UAT-SUITE-ASSET-LIST-ZOOM`（`UAT-ALZ-R0`／01–12） |
| 关联 | [Spec](../specs/lucy-20261127-asset-list-zoom-ux-spec.md) · [REQ-0120](../backlog/entries/REQ-0120-asset-list-zoom-ux.md) · [UAT](../qa/uat/suites/asset-list-zoom/suite.md) · [INDEX](../qa/uat/INDEX.md) |

## 目标

按 Spec §3–§6 在 WebUI 落地资产列表 Zoom：家族 A（启用表／Catalog）单 Schema 组 + 默认 5 表行 +「显示更多」+ 挂载合同 + 搜索优先；家族 B（角色／Agent）硬 50 表行分页；连接概览 Schema 摘要 20 cap、表点开再看。不改 ACL／启用表后端语义、不改 Sankey、不改导航 IA。

## 开工前置

1. **Spec 终稿确权已取得**（2026-11-27）。
2. **开发授权尚未取得**——改运行代码前须委托人另发明示开发授权。
3. 术语「显示更多」「显示 a / b」须在实现 PR 同批登记进 `webui/docs/00-product-terminology-standard.md`（Spec N1）。
4. 测试台套件已登记：`UAT-SUITE-ASSET-LIST-ZOOM`（本批）；宣称 UAT PASS 前须真实前台浏览器跑次。
5. 核对既有单测：`table-whitelist.test.tsx`（旧 50 全展开／折叠断言）须随 Task 2 改写，避免假红。
6. 核对 P1-80 三态诚实：本条不得削弱 loading／error 与缺 Manifest 分流。

## 任务分解

### Task 1：共享有界列表原语（纯前端）

- **目标文件**（建议）：`webui/src/components/ShowMoreList.tsx`（或 hook `useShowMoreWindow`）、`webui/src/components/PagedTableRows.tsx`（或 hook `usePagedRows`）、共享常数模块（`LIST_CAP_SCHEMA_SUMMARY=20`、`LIST_CAP_TABLE_WORKBENCH=5`、`LIST_PAGE_SIZE_GRANTS=50`）。
- **合同**：可见窗口外表行不入文档（Spec §3.0）；计数「显示 a / b」或页码；筛选／搜索变更重置窗口。
- **单测**：窗口扩张、重置、DOM 行数上限断言。

### Task 2：家族 A — 启用表范围

- **目标文件**：`webui/src/pages/connections/TableWhitelist.tsx` 及 `table-whitelist.test.tsx`。
- **废止**：`visibleTotal ≤ WHITELIST_ROW_BUDGET(50)` 时全 Schema 组展开。
- **落地**：同时只展开一组；组内默认 5 +「显示更多」+5；搜索引导（过滤总量 >5 时）；深链 `?schema=` 优先该组仍受 5 cap；保留 P1-80 三态文案。
- **验收挂接**：SC-04／05／06／14／15；`UAT-ALZ-01`–`04`。

### Task 3：家族 A — Catalog

- **目标文件**：`webui/src/pages/Catalog.tsx`、`CatalogScopeTree.tsx`（左树 Schema 20 cap）。
- **落地**：右表按 `conn/schema` 分组；同时只展开一组；组内 5 +「显示更多」；`schema=all` 不得多组挂表行；搜索引导。
- **验收挂接**：SC-07／14；`UAT-ALZ-05`–`06`。

### Task 4：连接概览（管连接）

- **目标文件**：`ConnectionOverview.tsx`、`SchemaDiscoveryCells.tsx`。
- **落地**：Schema 摘要 20 +「显示更多」；表默认折叠；展开后 5 +「显示更多」+ 单元格内最小搜索。
- **验收挂接**：SC-01／02／03；`UAT-ALZ-07`–`08`。

### Task 5：家族 B — 角色／Agent

- **目标文件**：`RoleTableGrants.tsx`、`AgentDetail.tsx`（权限预览表名行）。
- **落地**：过滤后表行 >50 必须分页；单页 ≤50；搜索先过滤再分页；已选计数全局可见；已选摘要展开后 >50 分页。
- **验收挂接**：SC-08／09／10；`UAT-ALZ-09`–`11`。

### Task 6：术语、门禁与测试台执行

- 登记术语标准；`lint:terminology`／`lint:spec-docs` 绿。
- 开发授权后在 lean demo 执行 `UAT-SUITE-ASSET-LIST-ZOOM` 前台浏览器跑次（1920×1080，计时与 API 分列），结果回写 INDEX。

## 浏览器验证

- 路由：/connections/enabled-tables、/admin/roles/:roleId
- 视口：1920×1080
- 状态：E1、E2、E3、E4、E5、E6、E7、E8、E9、E10、E11、E12、E13、E14、E15、E16
- 证据：未执行

## 验收

- Spec `SC-01`–`SC-15` 有单测与／或前台浏览器证据。
- 交互合同 E1–E16 前台浏览器验证通过并留证据路径；扩路由（连接概览／Catalog／Agent）由 UAT `UAT-ALZ-05`–`08`／`11` 覆盖，不替代 E1–E16。
- `UAT-SUITE-ASSET-LIST-ZOOM` 必做用例判定写入 INDEX（不得以 CR 冒充）。
- `npm run lint:spec-docs`、`lint:inventory-stage`、相关单测绿。

## 完成定义

Spec 终稿确权（已）→ 委托人另发开发授权 → Task 1–5 实现与单测 → Task 6 术语＋UAT 前台跑次 → 委托人验收 → 功能合同收口（S5）。本 Plan 定稿**不**表示可开发或可上线。

## 风险

| 风险 | 缓解 |
|---|---|
| 旧 whitelist 测试锁定 50 全展开 | Task 2 同批改写断言；CI 先改测再改行为或同 PR |
| 角色分页导致「已选表不在当前页」误判未选 | 全局已选计数 + 已选摘要分页（SC-09） |
| Catalog `schema=all` 漏单组约束回退表墙 | SC-07／UAT-ALZ-05 必做；DOM 行数断言 |
| 「显示更多」被做成 CSS 隐藏全量 | Spec §3.0／SC-13；单测断言窗外无节点 |
| 与 P1-80 三态冲突 | Task 2 回归 ETL 文案；禁止用缺 Manifest 描述 loading |

## Changelog

| 版本 | 日期 | 说明 |
|---|---|---|
| v0.1-draft | 2026-11-27 | 交互合同门禁配对最小稿 |
| v1.0 | 2026-11-27 | Spec 终稿后补全任务／风险／UAT 挂钩；Kimi Code 三轮对抗结论 **Approve with nits**（[评审](../reviews/2026-11-27-asset-list-zoom-plan-uat-adversarial-review.md)）；仍未获开发授权 |
