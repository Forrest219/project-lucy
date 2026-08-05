# Admin Usage Overview Table Grid Light Conformance Spec

> **Supersession (2026-08-05):** Spec 84 将本页三块使用列表改为调用排行条形图，**废止**本节对 `/admin/governance` 三表 `pl-data-grid` 的现行实现契约。本文档保留为 Spec 82 交付史；新实现以 `84-admin-usage-overview-activity-rank-and-header-polish-spec.md` 为准。

| 元数据 | 内容 |
|---|---|
| 文档名称 | Admin Usage Overview Table Grid Light Conformance Spec |
| 文档类型 | Spec |
| 版本 | v1.1 |
| 撰写日期 | 2026-08-05 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | 浏览器评估 `/admin/governance` 与 `/connections` 表格；定位判断「轻量遵从、不必工作台全套」；`webui/docs/design-system/11-components-data-grid.md`；`webui/docs/72-connections-catalog-grid-visual-consistency-spec.md`；`webui/docs/78-admin-usage-overview-ux-refinement-spec.md`；`GovernanceOverview.tsx` |
| 适用范围 | （历史）指导 `/admin/governance` 三张使用向表格收敛到共享 `pl-data-grid` 基线；现行 UI 见 Spec 84 |
| 输出位置 | `webui/docs/82-admin-usage-overview-table-grid-light-conformance-spec.md` |

| 字段 | 内容 |
|---|---|
| Spec 编号 | 82 |
| 关联工单 | `webui/docs/plans/wo-202608-14-admin-usage-overview-table-grid-light-conformance.md` |
| 关联页面 | `/admin/governance` |
| 关联台账 | `docs/ui-ux-feedback/pages/admin-governance.md`（新增 `UX-ADMIN-GOV-009`） |
| 上游 Spec | Spec 78（使用概况 KPI）；`11-components-data-grid.md`（网格事实源）；Spec 72（connections/catalog 网格先例） |
| 状态 | Draft (v1.0) |
| 日期 | 2026-08-05 |
| 范围 | Agent 使用排行 / Token 使用摘要 / 最受访问表：`pl-data-grid` 基线、12px 密度、主标识>数量层级、操作链弱强调、翻译防御；测试断言 class 契约 |

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | 初稿：基于定位评估的轻量遵从范围 |
| v1.1 | 标注被 Spec 84 废止现行三表实现契约；本文档保留为交付史 |

## 1. 背景

浏览器与源码核查确认：`/admin/governance` 三张表仍使用手写 `min-w-full divide-y … text-sm` 基线（表头约 14px/700、正文 14px/400），未使用 `pl-data-grid`，与 `/connections` 的 Schema 资产表（`pl-data-grid` + 12px 密度）不一致。

定位评估结论（2026-08-05）：

- 本页是 **dashboard 使用概况**：主信息在 KPI；表格是证据与下钻。
- 行数通常很少，不是高密度资产管理。
- **需要遵从**共享网格基线（避免跨模块像另一产品）。
- **不必**按 connections 工作台做完整 `colgroup`、多操作链、极致数值列策略。

## 2. 目标

1. 三张表改用 `pl-data-grid`（+ `pl-data-table` + 页面语义类 `pl-usage-overview-table`）。
2. 表头/正文密度对齐 Data Grid 规范：约 `12px` 字号与规范行高节奏（相对现网 14px 大表格收敛）。
3. 保持「主标识 > 数量/时长」视觉层级；数量列使用 `tabular-nums` + 次级色重。
4. 行内「查看日志」等下钻使用弱强调行内链接样式（`pl-row-action-link` 在 usage 表上的 12px 变体），不与页级主操作抢层级。
5. 测试断言结构契约：`pl-data-grid` 存在。

## 3. 非目标

- 不把 `pl-schema-asset-table` 的列宽模板 / Manifest 操作链搬到本页。
- 不强制数值列右对齐（connections 先例为左对齐 + tabular-nums；本页同口径）。
- 不改 KPI、窗口口径、API（Spec 78 范围）。
- 不重做 Token badge / 空态文案业务语义。
- 不做浏览器复核 / 移动窄屏；验收以 Vitest + `lint:terminology` + `build` 为准。

## 4. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`。本轮不新增产品主术语。

Protected terms（DOM 需 `translate="no"` + `notranslate`）延续 Spec 78：

- `Agent`、`Token`、`MCP`、`P95`
- Agent id、Token label / hash prefix、表名 / physical table

## 5. Design System Compliance

- 引用：`11-components-data-grid.md` §3–§5、§8–§10；`20-patterns-page-layout.md`（dashboard：Summary + Secondary lists）。
- **轻量遵从映射：**

| Data Grid 要求 | 本页落地 |
|---|---|
| 基类 `pl-data-grid` | 必须 |
| 语义扩展类 | `pl-data-table` + `pl-usage-overview-table` |
| 12px 表头/正文密度 | `pl-usage-overview-table` 覆盖 tbody 为 `text-xs font-medium leading-4`（表头复用 `pl-data-grid thead th`） |
| 主标识 > 数量 | 名称列 `font-medium` / 链接；数量列 `pl-usage-overview-table-num` |
| 操作列弱强调 | `.pl-usage-overview-table .pl-row-action-link`（对齐 schema 资产表的弱链视觉） |
| 完整 colgroup 模板 | **不做** |
| 结构测试契约 | 断言三表含 `pl-data-grid` |

## 6. UI 变更

### 6.1 三表共同结构

```tsx
<div className="overflow-x-auto">
  <table className="pl-data-grid pl-data-table pl-usage-overview-table" data-testid="…">
    <thead>…</thead>
    <tbody>…</tbody>
  </table>
</div>
```

- 去掉手写 `min-w-full divide-y … text-sm` 与 thead/td 上重复的 `px-3 py-2` / `bg-bg-subtle` 堆叠（改由 `pl-data-grid` token 承担）。
- 外层保留 `overflow-x-auto`；**去掉**额外 `rounded-md border` 盒子（面板已有边框，避免「表外再套卡片框」）。
- 为三表分别保留/补充 `data-testid`：`governance-agent-table`、`governance-token-table`、`governance-popular-tables-table`（或挂在既有 section 内查询 `table.pl-data-grid`）。

### 6.2 列角色

| 表 | 主标识列 | 数量/次级列 | 状态/操作 |
|---|---|---|---|
| Agent 使用排行 | Agent 名链 + id 次行 | 近窗口调用、平均响应时长、活跃/配置 Token → num class | 查看日志 → row-action-link |
| Token 使用摘要 | Token label + hash 次行 | （无数量主列） | 窗口内活跃 badge；Agent 链 |
| 最受访问表 | 表名 | 调用次数 → num class | 最近访问时间 |

### 6.3 CSS（`app.css`）

新增最小语义块（不得复制整套 schema-asset 列宽）：

- `.pl-usage-overview-table tbody td` → `text-xs font-medium leading-4`
- `.pl-usage-overview-table-num` → `tabular-nums font-normal text-fg-body whitespace-nowrap`
- `.pl-usage-overview-table .pl-row-action-link` → 与 schema 资产表弱链同级（`text-xs font-medium text-fg-default` + hover primary/underline）
- 对象名链可用 `.pl-usage-overview-table-name-link`：`text-xs font-medium text-fg-default no-underline hover:underline`（避免过亮 accent 压过主标识层级）

## 7. Acceptance Criteria

- [ ] 三张表 `class` 均含 `pl-data-grid`。
- [ ] 源码不再使用 `min-w-full divide-y divide-border-default text-sm` 作为本页表格基线。
- [ ] 数量列使用 `pl-usage-overview-table-num`（或等价 class）。
- [ ] 「查看日志」使用 `pl-row-action-link`。
- [ ] Protected terms 翻译防御不回退。
- [ ] Vitest 断言 `pl-data-grid`；`lint:terminology` + `build` 通过。
- [ ] 未改 Spec 78 KPI/API 口径；未引入 schema-asset colgroup。
- [ ] 台账 `UX-ADMIN-GOV-009` → `Fixed`（本轮不强制 Verified）。

## 8. Out of Scope

- Spec 78 已交付项的再改口径。
- `/admin/agents`、`/admin/audit` 等其他 admin 表。
- 浏览器 E2E / 移动窄屏。
