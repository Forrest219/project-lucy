# 外部目录单表读字段 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

| 元数据 | 内容 |
|---|---|
| 状态 | **v0.2；开发授权已获得（2026-11-13，委托人同句「批准修复」）；实现已落地（2026-11-13）**。vitest 5 文件 76/76；客户 live 未验；**不表示可上线** |
| 主 Spec | [`docs/specs/lucy-20261113-external-catalog-column-read-spec.md`](../specs/lucy-20261113-external-catalog-column-read-spec.md) **v0.2** |
| 总账 | **P1-20**／REQ-030-041；**不入核心分母**；事故续作（P1-16 Follow-up） |
| 授权边界 | 只改外部目录**单表字段**直连读法与直连白名单。不改 KTX、不问数、不改无点号 MySQL 字段 SQL、不改页面组件、不做浏览器测试 |
| 验收 | Spec EC-01–EC-13 |

## 1. 目标

准备表结构侧边栏对 SelectDB／Doris 外部 Catalog（如 `hive-1`／`dim`）选中单表时能读到字段，不再因 `ktx sql` 拒绝 `DESC` 而固定报「没有读到字段」。

**Architecture:** 扩展 `runCatalogShow` 白名单，允许 `DESC`／`SHOW COLUMNS`／`DESCRIBE` 三段名语句；`readCatalogTableColumns` 改为经该直连按序探针，**不再**对外部目录调用 `runSql`。凭据、超时、关连接、脱敏与列库 `SHOW` 共用。

**Tech Stack:** 现有 Vitest、`mysql2` 直连适配器、既有 `catalog-database.ts` SQL 生成函数。

## 2. 开工前置

- [x] Spec v0.2 终稿确权 ＋ 委托人开发授权（2026-11-13「批准修复」）
- [x] 总账 P1-20 跟进状态与 Spec 头部同句镜像
- [x] Global Constraints 已确认：
  - 不修改 KTX 源码，不升级 KTX
  - 外部目录字段探针不得进入 `runSql`／`ktx sql`
  - 外部目录失败不得回退到 `information_schema`
  - 密码不得进入错误文本、日志、审计和测试快照
  - `chatbi` 等无点号连接读字段路径保持改前行为
  - 不改 MCP／问数

## 3. 文件地图与任务

| 文件 | 职责 | EC |
|---|---|---|
| `webui/server/catalog-show.ts` | 扩展 SQL 白名单；共用连接／超时／脱敏 | EC-06／08 |
| `webui/server/schema-structure.ts` | `readCatalogTableColumns` 改直连多探针＋回退规则＋失败日志；`sqlFailureReason` 识别 too_large | EC-01–05／07／09／13 |
| `webui/server/catalog-database.ts` | 复用既有 `describeCatalogTableSql`／`showColumnsSql`／`describeTableSql`，无改动 | — |
| `webui/server/__tests__/doris-external-catalog.simulation.test.ts` | `ktx()` 替身对齐真实 KTX；字段经 `runCatalogShowImpl`；回退、终止类失败、结构 diff、日志 | EC-01–05／07／09／11–13 |
| `webui/server/__tests__/catalog-show.test.ts` | 白名单放行／拒绝；探针脱敏、关连接、超时 | EC-06／08 |

不改 `webui/src` 业务组件（`prepareSchemaStructure` 已逐表调 API）。

- [x] **Task 1 红灯：** 先改测试，实现前 12＋8 条红（旧路径仍走 `runSql`、白名单未放行）
- [x] **Task 2 白名单：** `catalog-show.ts` 正则扩展，仅三段名
- [x] **Task 3 接线：** `readCatalogTableColumns` 按序探针；终止类失败不回退；失败探针写日志
- [x] **Task 4 文档镜像：** Spec／Plan／总账／需求池／P1-16 Follow-up 指针同步
- [ ] **Task 5 收口证据（可选）：** `docs/reviews/` 增 EC 证据审计；测试台 `UAT-SUITE-CATALOG-SCAN` 增可选 EXT 单表字段用例，无 live 时保持 GAP，不得写成 EXT PASS

## 4. 验收

按 Spec EC-01–EC-13。本机命令：

```bash
cd webui && npx vitest run \
  server/__tests__/catalog-show.test.ts \
  server/__tests__/doris-external-catalog.simulation.test.ts \
  server/__tests__/schema-structure.test.ts \
  server/__tests__/live-tables-wide-schema.test.ts \
  server/__tests__/live-catalog.test.ts
```

结果（2026-11-13）：5 文件 76/76。`live-tables.test.ts` 25/25。

## 浏览器验证

不适用：本条只改服务端读字段通道，不改变用户可见 WebUI 表面；验收以 vitest 替身为准。

## 5. 完成定义

- 功能合同：EC-01–EC-13 全绿，且 `runSql` 在外部目录字段路径零调用。
- 文档：Spec 头部、本 Plan、总账 P1-20、需求池 REQ-030-041 同句。
- **不含：** 客户 live、UAT PASS、可上线。完成定义达成仅代表**功能合同收口**。

## 6. 风险与回滚

- 直连字段失败时行为回到「没有读到字段」——不静默写空列 Manifest（`previewSchemaStructure` 对 rejection 抛错）。
- 失败探针日志（EC-13）留下真实原因，客户复测失败时据此定位。
- 紧急回退：还原 `readCatalogTableColumns`、`catalog-show.ts` 白名单两处改动。注意回退后字段读法恢复为被 KTX 拒绝的 `ktx sql`＋`DESC`，**不推荐**，仅事故开关级说明。

## 7. 非本 Plan

客户 SelectDB live 必测、浏览器 UAT、整库批量超时产品策略、Hive HS2 直连晋级、Hive 字段注释读取。
