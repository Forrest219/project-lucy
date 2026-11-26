# 渐进开放 KTX 已内置分析型连接器（ClickHouse / DuckDB）Plan

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 分阶段实施计划 / **v0.1-draft** |
| 日期 / 功能编号 | 2026-11-26／**REQ-0115**（P0，计划纳入 `v0.35.0`） |
| 状态 | S1｜v0.1-draft。草案；终稿未确权；未获开发授权；测试台 `not_registered`；≠ 功能合同收口；≠ UAT PASS；≠ 可上线 |
| 授权边界 | 草案；终稿未确权；未获开发授权，禁止修改运行代码 |
| 验收 | Spec `SC-01`–`SC-08`；计划新建测试台套件 `UAT-SUITE-ANALYTICAL-CONNECTORS` |
| 关联 | [Spec](../specs/lucy-20261126-ktx-analytical-connectors-rollout-spec.md) · [数据库支持矩阵](../governance/database-support-matrix.md) |

## 目标

在不修改上游 `@kaelio/ktx@0.16.0` 源码的前提下，将 KTX 已内置的 `clickhouse` 与 `duckdb` 驱动安全开放至 Lucy 服务端、WebUI 新建连接表单与 MCP 运行时，补齐沙箱路径校验、只读守卫、Docker Compose 验证夹具与支持矩阵登记，使两类分析型引擎达到 `gated` 受控可用标准。

## 开工前置

1. 完成 Spec 终稿确权（确认 DuckDB 沙箱根目录约定及 ClickHouse HTTP/HTTPS 端口表单字段）并取得委托人开发授权。
2. 只读核查 `@kaelio/ktx@0.16.0` 中 `dist/connectors/clickhouse/` 与 `dist/connectors/duckdb/` 的实际连接参数、超时参数与只读标志，确认无需上游改码即可跑通 `testConnection`、`ingest` 与 `query`。
3. 确认已入常青需求池（`REQ-0115`）及 `v0.35.0-scope.md` 拉取列表。

## 任务分解

### Task 1：驱动参数与协议兼容性探测（TDD 前置）

- 核对 KTX `clickhouse` / `duckdb` 连接器入参格式、SQL 方言（如 `SHOW TABLES` / `information_schema` 差异）及超时行为。
- 形成兼容探测报告；若存在类似 StarRocks 的方言兼容问题，设计 Lucy 侧适配补丁方案。

### Task 2：服务端配置校验、沙箱与只读守卫

- **目标文件**：`webui/server/project.ts`、`webui/server/connections/`、`webui/server/proxy/`。
- 扩展服务端连接类型白名单与 `ktx.yaml` 生成逻辑，支持 `clickhouse` 与 `duckdb`。
- 为 `duckdb` 实现受控目录路径白名单与 `.duckdb`/`.db` 扩展名校验，阻断路径穿越与敏感文件读取。
- 验证 MCP Proxy 只读守卫对 `ATTACH`、`COPY`、DDL/DML 的拦截。

### Task 3：WebUI 新建/编辑连接表单适配

- **目标文件**：`webui/src/lib/connectionId.ts`、连接表单组件。
- 在 `DATABASE_TYPES` 注册 `clickhouse` 与 `duckdb`；选择 `duckdb` 时切换为文件路径输入模式。
- 为类型标识与数据库对象名添加 `translate="no"` 与 `notranslate`，满足 `lint:terminology`。
- 在连接列表与详情中准确展示 `gated` 支持状态提示。

### Task 4：Docker Compose 夹具、冒烟脚本与文档矩阵

- **目标文件**：`deploy/compose/docker-compose.clickhouse-demo.yml`（新增）、`scripts/smoke/`、`docs/governance/database-support-matrix.md`、`docs/user-guide/data-sources.html`。
- 搭建轻量 ClickHouse + DuckDB 样本数据夹具与自动化 smoke 脚本，验证 `ingest → sl_query → lucy_query → ACL/Row Policy`。
- 更新支持矩阵，将两引擎状态登记为 `gated` 并注明 `verified` 所需实机证据清单。

## 浏览器验证

- 路由：/connections
- 视口：1920×1080
- 状态：E1、E2、E3、E4
- 证据：未执行

## 验收

- Spec `SC-01`–`SC-08` 全部有自动化测试、隔离 Docker Compose 跑次与浏览器验证证据；浏览器验证须真实前台执行并记录即时计时（表单切换与连通测试端到端时延，与 API 耗时分列），本计划处于 S1 草案阶段，证据待开发授权后补齐。
- `npm run lint:spec-docs`、`npm run lint:terminology`、`npm run typecheck` 全绿。

## 完成定义

Spec 终稿确权 → 开发授权 → Task 1–4 实施与单测全绿 → 隔离 Docker Compose 冒烟与前台浏览器验证通过 → 更新 `database-support-matrix.md` → 委托人验收与功能合同收口。

## 风险

| 风险 | 缓解 |
|---|---|
| KTX `0.16.0` 的 `duckdb` 原生二进制绑定在容器 `linux/amd64` 或 `arm64` 下缺失或加载失败 | 在 Task 1 即验证容器内 `node` 加载 `duckdb` 原生模块；若依赖特定构建工具，提前纳入 `Dockerfile` 依赖层并走 G1–G4 架构检查 |
| ClickHouse 在多节点或 HTTPS 自签证书环境下连接参数不统一 | 首期限定单节点 HTTP/HTTPS 标准端口，支持可选 TLS 开关与 CA 路径，复杂集群路由列为非目标 |
| DuckDB 文件被多进程并发打开导致文件锁冲突 | 强制以只读模式（`READ_ONLY`）打开 DuckDB 连接，并复用 Lucy 单实例单副本边界 |
