# Catalog Connection → Schema Tree P0 Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Catalog Connection → Schema Tree P0 Spec |
| 文档类型 | Product / UX / Frontend / Observability Spec |
| 版本 | v1.0 |
| 日期 | 2026-09-27 |
| 关联页面 | `/catalog` |
| 关联实现 | `webui/src/pages/Catalog.tsx`、`webui/src/components/CatalogScopeTree.tsx`、`webui/server/admin/ui-usage.ts` |
| 状态 | Implemented（P0，待目标用户前后对照验证） |

## 1. 背景与目标

`/catalog` 与「启用表范围」都以表列表为主体。当前 `/catalog` 还需要反复打开连接与 Schema 下拉框，用户难以持续确认所在层级，容易为定位资产而跨页。

P0 将 `/catalog` 改为左侧 Connection → Schema 范围树、右侧语义资产表格，并通过前后任务测试和本机匿名交互事件验证它是否降低定位成本。

目标用户是需要跨多个 Connection / Schema 定位和维护语义资产的运维人员。单 Connection 场景收益可能有限，超大目录也可能增加滚动，因此 P0 不向其他工作台推广，必须先通过 §8 门槛。

## 2. 非目标

- 不增加 Table 层树节点。
- 不增加节点右键菜单、更多菜单或写操作。
- 不重构「启用表范围」或表语义编辑器。
- 不把现有 `WikiTree` 抽象成通用树。
- 不增加移动端或窄屏重排。

## 3. 页面结构

- Primary Workspace 使用双栏网格：左栏默认 `240px`，`>=1440px` 时 `260px`；右栏 `minmax(0, 1fr)`。
- 左栏独立纵向滚动并 sticky；右表保留局部横向滚动。全局仍遵循 `--layout-min-readable-width`。
- 左树是工作区内唯一的位置范围选择器，不构成与全局侧栏等价的第二导航。
- 右侧移除「连接筛选」「Schema 筛选」，保留搜索、启用范围、语义状态和结果数。
- 表格的分组行、列、空状态和行级动作保持不变。

## 4. 树模型与交互

树包含「全部连接」根节点、Connection 节点和 Schema 叶节点，按 `/api/sources` 中的首次出现顺序展示。

选择行为：

1. 选择根节点：清除 `connection` 和 `schema`。
2. 选择 Connection：写入 `connection`、清除 `schema`，并展开该分支。
3. 选择 Schema：写入对应 `connection` 和 `schema`，并展开父 Connection。
4. Connection 展开按钮只改变本地展开状态，不修改 URL 或筛选。

默认行为：

- 没有位置深链时，所有 Connection 初始收起。
- 有有效 Connection / Schema 深链时，自动展开所在 Connection；之后允许用户手动收起。
- 展开状态不持久化。
- 无效 Connection 会清除 Connection 和 Schema；Connection 有效而 Schema 无效时只清除 Schema。

计数行为：

- 树结构来自完整表集合。
- 节点计数跟随 `scope`、`completion`、`q`，但不受当前 Connection / Schema 选择影响。
- 0 条节点仍展示并可选择。
- 左树不增加独立搜索。

可访问性：

- 使用 WAI-ARIA Tree 语义。
- 上下键移动可见节点；左右键展开、收起或移动父子层级；Enter/Space 选择；Home/End 跳至首尾。
- Connection、Schema、表名和路径必须使用 `notranslate` 与 `translate="no"`。

## 5. URL 与数据契约

- `/api/sources` 与 `SourceSummary` 不变。
- URL 继续作为筛选事实源，沿用 `connection`、`schema`、`scope`、`completion`、`q`。
- 树选择使用 history `replace`，并保留未被本次动作修改的查询参数。
- 树由独立 `CatalogScopeTree` 组件实现；不得把语义资产特有规则注入 `WikiTree`。

## 6. 匿名交互观测

新增：

- `POST /api/admin/ui-usage/catalog-navigation-event`
- `GET /api/admin/ui-usage/catalog-navigation?hours=24|168`

POST 请求为 `{ visitId, eventType, contextLevel? }`：

- `eventType`：`visit_start | tree_select | tree_toggle | search_commit | scope_change | completion_change | row_open | enabled_scope_exit`
- `contextLevel`：`root | connection | schema`；`tree_select`、`row_open`、`enabled_scope_exit` 必填，`tree_toggle` 固定为 `connection`，其他事件禁止携带。
- 搜索在停止输入 500ms 后记录一次 `search_commit`；初始 URL 值不产生事件。

审计库表 `ui_catalog_navigation_events` 仅保存 `id`、`ts`、`visit_id`、`event_type`、`context_level`。不得保存账户、URL、查询串、搜索词或任何 Connection、Schema、Table 名。

GET 只返回聚合：`windowHours`、`visits`、`rowOpenVisits`、`enabledScopeExitVisits`、`medianSemanticActionsBeforeOutcome`、`p75SemanticActionsBeforeOutcome`、`actionCounts`、`treeSelectionsByLevel`。响应不得返回事件明细或 `visitId`。

事件发送是 best-effort；失败不得影响筛选或导航。

## 7. 核心流程（伪代码）

```text
after sources loaded:
  validate connection/schema against all tables
  baseRows = tables filtered by scope + completion + q
  treeStructure = group all tables by connection/schema
  treeCounts = count baseRows into root/connection/schema nodes
  visibleRows = baseRows filtered by URL connection/schema

on root select:
  replace URL, removing connection and schema

on connection select(conn):
  expand conn
  replace URL with connection=conn and without schema

on schema select(conn, schema):
  expand conn
  replace URL with connection=conn and schema=schema

on caret toggle(conn):
  update local expansion state only

on first row open or enabled-scope exit:
  emit outcome event without business object identifiers
```

## 8. 验证与验收

使用 4 个 Connection × 5 个 Schema × 12 张表的相同非生产夹具，覆盖启用状态和全部语义状态。至少 8 名目标用户参加交叉顺序对照；旧版和树版使用相同数据，不增加生产 feature flag。

固定任务覆盖精确定位、同 Connection 跨 Schema、跨 Connection 并结合字段搜索，以及先定位未启用资产、仅在明确要求时进入「启用表范围」。

通过门槛：

- 定位任务中位有效操作数下降至少 30%。
- 中位完成时长下降至少 20%。
- 任务成功率至少 90%。
- 非必要跨页率不高于旧版。

匿名聚合仅作为上线后 7 日观察信号，至少 30 次访问后再解释，不代替前后对照的因果结论。未通过门槛时不得向其他页面复制本模式。

## 9. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:
- None

用户可见文案使用「连接」「Schema」「语义资产」「启用表范围」等既有标准术语。

## 10. Design System Compliance

- 遵循 `design-system/02-foundations-grid-spacing.md` 的桌面最小可读宽度和滚动策略。
- 遵循 `design-system/20-patterns-page-layout.md` 的单一 Primary Workspace、键盘可达与列表工作台结构。
- 复用现有颜色、边框、间距和状态 token，不新增视觉语义。
