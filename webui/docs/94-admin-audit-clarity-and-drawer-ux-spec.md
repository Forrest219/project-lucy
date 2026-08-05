# Admin Audit Clarity and Drawer UX Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Admin Audit Clarity and Drawer UX Spec |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-05 |
| 撰写人 | Auto |
| 委托人 | zhangxingchen |
| 基于材料 | 2026-08-05 浏览器核查 `/admin/audit` 反馈；`webui/docs/89-admin-audit-turn-drilldown-spec.md`；`docs/ui-ux-feedback/pages/admin-audit.md` |
| 适用范围 | `/admin/audit` 问询记录筛选/列表文案、列语义、Drawer 分区与关闭控件 |
| 输出位置 | `webui/docs/94-admin-audit-clarity-and-drawer-ux-spec.md` |

| 字段 | 内容 |
|---|---|
| Spec 编号 | 94 |
| 关联工单 | `webui/docs/plans/wo-202608-27-admin-audit-clarity-and-drawer-ux.md` |
| 关联页面 | `/admin/audit` |
| 关联台账 | `docs/ui-ux-feedback/pages/admin-audit.md`（`UX-ADMIN-AUDIT-011`～`017`） |
| 上游 Spec | Spec 89（turn drilldown 基线）；Spec 86/87（多数请求耗时口径，列表页不再重复展示） |
| 状态 | Implemented |
| 日期 | 2026-08-05 |

## 1. 背景

Spec 89 落地后，浏览器复核确认 Tab 与 24h/7d 控件设计感良好，但运维用户仍遇到：

1. 筛选框提示 `Agent ID`，与表格主展示（名称）不一致。
2. `Agent` 列仅显示 id，缺少名称 + id 组合展示。
3. 列表页「使用概况 · 近 7 天：多数请求耗时…」与 `/admin/usage` 重复，信息密度低。
4. `全部来源 / 推断` 缺少业务语义；`推断问询` 仅在 Drawer 内有解释。
5. 列名 `调用数`、`工具 / 表` 偏实现视角；列表应聚焦数据表而非工具。
6. Drawer 明细缺 `序号`、`数据库连接`，定位成本高。
7. Drawer 头部分区弱，`关闭` 与标题区脱节。

## 2. 目标

1. 问询 Tab 筛选：`Agent 名称或 ID`；来源筛选改 `来源类型` 选项文案并附 tooltip。
2. L1 列表新增 `序号`；`Agent` 列展示 `名称 (id)`（无名称时回退 id）。
3. 删除 L1 列表页 P95 参照整句（慢调用 badge 保留）。
4. 列名：`工具调用数`、`涉及数据表`（仅展示 physical table，不展示 tool）。
5. Drawer：卡片分区（基础信息 / 问询摘要 / 调用明细 / 触达表汇总）；表头含 `序号`、`数据库连接`、`涉及数据表`；移除工具列。
6. Drawer 头部：`问询详情` 与 `关闭` 同一工具栏行，右对齐关闭按钮。

## 3. 非目标

- 不改 turn 聚类算法与 P95 计算。
- 不新增 turn 级 CSV。
- 不调整调用流水 Tab 字段（本单仅问询记录 + Drawer）。
- 不做浏览器验证（本轮 Vitest + terminology + build + code review）。

## 4. Terminology Compliance

遵循 `webui/docs/00-product-terminology-standard.md` §4.7，并补充：

| Canonical Term | UI 主术语 | 禁止文案 |
|---|---|---|
| Source type filter | 来源类型 | 全部来源（无说明） |
| Reported turn (filter) | 用户原始问询 | 已上报（筛选项） |
| Inferred turn (filter) | 系统推断问询 | 推断（筛选项裸词） |
| Tool call count | 工具调用数 | 调用数 |
| Tables touched | 涉及数据表 | 工具 / 表 |
| Database connection | 数据库连接 | connection_id（裸露） |

来源 badge 仍用 `已上报问询` / `推断问询`（Spec 89），筛选项与 badge 分层表达。

## 5. UI 变更明细

### 5.1 问询 Tab 筛选

| 控件 | 旧 | 新 |
|---|---|---|
| Agent 搜索 | placeholder `Agent ID` | `Agent 名称或 ID` |
| 来源 | `全部来源 / 已上报 / 推断` | `全部 / 用户原始问询 / 系统推断问询` |
| 搜索框 | `搜索摘要 / 工具 / 表名` | `搜索摘要 / 表名` |

来源 `<select>` 增加 `title`：说明推断问询由工具调用参数自动生成，不等同用户原文。

### 5.2 L1 列表列

| 列 | 说明 |
|---|---|
| 序号 | 当前页内从 1 递增 |
| Agent | `{name} ({id})`，`name === id` 时仅显示 id |
| 工具调用数 | 原 `调用数` |
| 涉及数据表 | 仅 `sources[].physicalTable`，最多 2 条 + 省略 |

删除 `data-testid="audit-latency-reference"` 整段。

### 5.3 Drawer

- Header：`pl-trace-detail-header--toolbar` flex 布局。
- 调用明细表列：`序号 | 时间 | 数据库连接 | 涉及数据表 | 状态 | 耗时 | 操作`。
- `数据库连接` 来自 `access_log_sources.connection_id`（API 扩展 `connectionId` 字段）。
- 各区块使用 `pl-card` 包裹。

### 5.4 API

`GET /api/admin/audit/turns/:turnId` 的 `accessLogs[]` 增加可选字段 `connectionId`（按 `access_log_id` 关联 `access_log_sources` 取 DISTINCT 首条）。

## 6. 验收标准

- [ ] 问询 Tab 无 `Agent ID` placeholder、无列表页 P95 参照句。
- [ ] 表头含 `序号`、`工具调用数`、`涉及数据表`；Agent 列含括号 id。
- [ ] 来源筛选项为业务化文案；`推断问询` badge 仍可见。
- [ ] Drawer 含分区卡片、`序号` 与 `数据库连接` 列；关闭按钮与标题同行。
- [ ] `admin-audit-turns.test.tsx`、`admin-audit.test.ts`（如有）、`lint:terminology`、`build` 通过。
