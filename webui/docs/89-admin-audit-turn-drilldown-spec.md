# Admin Audit Turn Drilldown Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Admin Audit Turn Drilldown Spec |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-05 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | 浏览器核查 `/admin/audit` 与 `/admin/usage`；访问日志两级明细设计讨论；`webui/docs/08-mcp-audit-question-tracing-spec.md` §9；`webui/docs/86-admin-usage-overview-route-and-kpi-clarity-spec.md`（多数请求耗时）；`webui/docs/87-admin-usage-overview-stats-time-spec.md` |
| 适用范围 | `/admin/audit` 问询记录 + 调用流水双 Tab、起止时间拆分、与使用概况 P95 交叉验证 |
| 输出位置 | `webui/docs/89-admin-audit-turn-drilldown-spec.md` |

| 字段 | 内容 |
|---|---|
| Spec 编号 | 89 |
| 关联工单 | `webui/docs/plans/wo-202608-22-admin-audit-turn-drilldown.md` |
| 关联页面 | `/admin/audit` |
| 关联台账 | `docs/ui-ux-feedback/pages/admin-audit.md`（`UX-ADMIN-AUDIT-001`～`010`） |
| 上游 Spec | Spec 08（turn API / inferred vs reported）；Spec 86/87（使用概况 P95 / 统计时间 / 24h·7d 窗口） |
| 状态 | Implemented |
| 日期 | 2026-08-05 |
| 范围 | 访问日志 IA 重构、turn 列表 + Drawer、调用流水取证 Tab、删 heatmap / KPI badge、导出按钮统一 |

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | 初稿并落地 |

## 1. 背景

2026-08-05 浏览器核查确认 `/admin/audit` 仍停留在 flat `access_log` 流水视图：四个开发者向 KPI、heatmap Tab、Header「0 条记录」badge、secondary 导出按钮，均不利于构建可信任 data agent MCP 的运维叙事。

后端已具备 `GET /api/admin/audit/turns` 与 `GET /api/admin/audit/turns/:turnId`（Spec 08），但 UI 未接入。用户要求两级明细：

1. **L1 问询记录**：每个 Agent、每次问询（inferred / reported turn）
2. **L2 调用明细**：每次问询内的工具与触达表（Drawer）
3. **L3 调用流水**：保留 flat access_log 供 CSV 导出与 Trace 深挖

时间字段须拆分起止，并与 `/admin/usage`「多数请求耗时」（P95）可交叉验证。

## 2. 目标

1. 默认 Tab 改为 **问询记录**（`?tab=turns`），次 Tab **调用流水**（`?tab=calls`）。
2. L1 列表列：**开始时间 / 结束时间 / 问询时长 / Agent / 问询摘要 / 调用数 / 工具·表 / 慢调用 / 结果 / 来源**。
3. 点击问询行打开 L2 Drawer：调用序列表 + 触达表汇总 + Trace / 对象详情入口。
4. 顶栏 **24 小时 | 7 天** 与使用概况对齐；展示 **统计时间** 与 **多数请求耗时参照线**（同 P95 算法）。
5. 删除 heatmap Tab、四个 KPI 卡、Header `{total} 条记录` badge。
6. 调用流水 Tab：`导出 CSV` 使用 `pl-btn--primary`（与「新建 Role」一致）。
7. `/admin/audit-sources` redirect 至 `/admin/audit`（不再带 `tab=heatmap`）。

## 3. 非目标

- 不重建 turn 聚类算法（复用 `rebuildInferredTurns`）。
- 不展示结果行 / Token 明文；**生成 SQL**（Spec 125）可在调用流水列表与 CSV 直展。
- 不把 inferred summary 表述为用户原文。
- 不做 turn 级 CSV（Phase 2 另开）。
- 不做浏览器验证（本轮 Vitest + terminology + build）。

## 4. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

| Canonical Term | UI 主术语 | 禁止文案 |
|---|---|---|
| Turn / Question cluster | 问询记录 | 问题簇、turn |
| Reported turn | 已上报问询 | reported turn |
| Inferred turn | 推断问询 | 推断问题（无来源标注） |
| Business call | 业务调用 | 业务 calls |
| Access log row | 工具调用 | access_log 行 |
| Typical Request Latency | 多数请求耗时 | 响应上限（P95）作主标签 |
| Slow call | 慢于多数请求 | 慢查询 |

Protected terms（DOM 需 `translate="no"` + `notranslate`）：`Agent`、`Token`、`MCP`、`P95`、tool name、physical table、Agent id。

## 5. 窗口与 P95 交叉验证

| 项 | 口径 |
|---|---|
| 时间窗 | `hours ∈ {24, 168}`，URL `hours=`，默认 `168` |
| P95 | 与 `governance-observability.ts` 相同：`access_log.duration_ms` 升序第 `ceil(n×0.95)` 个 |
| 参照线文案 | `使用概况 · 近 N 天：多数请求耗时 {p95} ms · 本页 {slow} 次慢于此值` |
| L1 慢调用 | `maxCallDurationMs > p95Ms` → badge「含 N 次慢调用」 |
| L2 行 | `durationMs > p95Ms` → badge「慢于多数请求」 |
| 深链 | usage KPI → `/admin/audit?tab=calls&hours=&slowOnly=1`（后续可选） |

## 6. API 扩展

`GET /api/admin/audit/turns` 新增：

- Query：`hours=24|168`（映射 `since`）
- 每条 entry：`turnSpanMs`、`totalCallDurationMs`、`maxCallDurationMs`、`slowCallCount`、`outcomeSummary`
- 响应根：`referenceLatency: { windowHours, p95Ms, totalCallsInWindow, slowCallsInFilter }`

`GET /api/admin/audit/turns/:turnId` 每条 accessLog 增加 `durationMs`、`isSlowCall`（需 `hours` query）。

## 7. UI 结构

### 7.1 Tab

| Tab | URL | 默认 |
|---|---|---|
| 问询记录 | `?tab=turns` | ✅ |
| 调用流水 | `?tab=calls` | |

### 7.2 L1 列

见 §2；起止时间分列，禁止 `16:14 ~ 16:18` 合并写法。

### 7.3 L2 Drawer

- 来源 badge + 推断 disclaimer
- 调用列表（时间、工具、表、状态、耗时、慢调用、操作）
- 触达表 distinct 汇总

### 7.4 调用流水 Tab

保留现有 filter + 表 + 分页 + CSV；无 KPI 卡。

## 8. 验收

1. 默认打开问询记录 Tab；无 heatmap / 四 KPI / count badge。
2. L1 起止时间分列；含 P95 参照线与慢调用 badge。
3. L2 Drawer 展示工具与表；慢调用与 P95 一致。
4. 导出 CSV 为 primary；`/admin/audit-sources` → `/admin/audit`。
5. `admin-audit-turns.test.tsx`、`admin-audit.test.tsx`、`lint:terminology`、`build` 通过。
