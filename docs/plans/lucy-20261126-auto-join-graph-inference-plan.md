# 自动 Join Graph 推断与辅助标注 Plan

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 分阶段实施计划 / **v0.1-draft** |
| 日期 / 功能编号 | 2026-11-26／**REQ-0116**（P1，计划纳入 `v0.35.0`） |
| 状态 | S1｜v0.1-draft。草案；终稿未确权；未获开发授权；测试台 `not_registered`；≠ 功能合同收口；≠ UAT PASS；≠ 可上线 |
| 授权边界 | 草案；终稿未确权；未获开发授权，禁止修改运行代码 |
| 验收 | Spec `SC-01`–`SC-07`；计划新建测试台套件 `UAT-SUITE-AUTO-JOIN-INFERENCE` |
| 关联 | [Spec](../specs/lucy-20261126-auto-join-graph-inference-spec.md) · [多表命中门闩 Spec](../specs/lucy-20261107-source-ambiguity-gate-spec.md) |

## 目标

在不改 KTX 源码、不新增独立导航菜单的前提下，在表编辑器 `关联` Tab 内提供基于外键、审计 SQL 与字段命名的三路 Join 推断推荐与一键采纳能力，降低治理方手工维护 Join 的门槛，并提升 `REQ-030-024`（多表命中连通性放行）的覆盖率。

## 开工前置

1. 完成 Spec 终稿确权（确认推荐上限、忽略状态存储位置）并取得委托人开发授权。
2. 核查现有 `webui/server/overlay.ts` 中 Join 读写逻辑与 `TableEditor.tsx` `关联` Tab 组件结构，确保采纳动作复用现有保存管线。
3. 确认已入常青需求池（`REQ-0116`）及 `v0.35.0-scope.md` 拉取列表。

## 任务分解

### Task 1：Join 推断引擎实现（TDD）

- **目标文件**：新增 `webui/server/join-inference.ts`、新增对应单测文件。
- 实现外键读取、审计库 `JOIN ON` 轻量正则/AST 提取、以及同连接内 `*_id` 命名匹配三路打分合并逻辑。
- 实现跨连接隔离、已存在 Join 过滤与忽略列表持久化读取。

### Task 2：只读推荐与忽略 API 端点

- **目标文件**：`webui/server/index.ts`、`webui/docs/03-api-spec.md`。
- 新增 `GET /api/sources/:conn/:schema/:table/join-suggestions` 与 `POST /api/sources/:conn/:schema/:table/join-suggestions/ignore`。
- 采纳动作直接复用既有 Join/Overlay 保存端点，不造第二套写路径，并在 `03-api-spec.md` 登记。

### Task 3：WebUI 表编辑器 `关联` Tab 集成

- **目标文件**：`webui/src/pages/TableEditor.tsx` 及关联子组件。
- 在 `关联` Tab 增加「推荐关联」折叠/分区列表，展示目标表、连接键、推荐基数与依据来源，提供「采纳」「忽略」按钮。
- 确保所有表名、列名 DOM 节点携带 `translate="no"` 与 `notranslate`，通过 `lint:terminology`。

### Task 4：端到端联动验证

- 在隔离 Docker demo 环境验证：推断推荐 → 前台浏览器点击采纳 → 索引刷新 → 多表 `lucy_query` 按连通路径放行（`SC-06`）。

## 浏览器验证

- 路由：/catalog/:conn/:schema/:table
- 视口：1920×1080
- 状态：E1、E2、E3、E4、E5、E6、E7
- 证据：未执行

## 验收

- Spec `SC-01`–`SC-07` 全部有自动化测试、浏览器验证与隔离 Docker 跑次证据；浏览器验证须真实前台执行并记录即时计时（进入关联页签到推荐列表就绪及点击采纳完成刷新的前端耗时），本计划处于 S1 草案阶段，证据待开发授权后补齐。
- `npm run lint:spec-docs`、`npm run lint:terminology`、`npm run typecheck` 全绿。

## 完成定义

Spec 终稿确权 → 开发授权 → Task 1–4 实施与单测全绿 → 前台浏览器验证与多表 MCP 联动验证通过 → 委托人验收与功能合同收口。

## 风险

| 风险 | 缓解 |
|---|---|
| 审计 SQL 数量庞大时每次打开 `关联` Tab 扫描 `audit.sqlite` 导致接口超时 | 限制只扫描最近 7 天或最近 2000 条 `outcome = 'ok'` 的记录，并加查询超时保护与本地短期缓存，绝不阻塞事件循环 |
| 命名启发式误推荐同名的无关维表（如 `type_id`） | 将命名匹配置信度设为最低档（0.5），UI 明确标注“字段命名匹配（需人工确认）”，且绝不自动生效 |
