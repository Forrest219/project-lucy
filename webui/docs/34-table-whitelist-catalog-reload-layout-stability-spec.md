# Table Whitelist Catalog Reload Layout Stability Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Table Whitelist Catalog Reload Layout Stability Spec |
| 文档类型 | Product / UX / Frontend Spec |
| 版本 | v0.2 |
| 撰写日期 | 2026-07-31 |
| 关联页面 | `/connections/whitelist` |
| 关联工单 | `webui/docs/plans/wo-M31-table-whitelist-catalog-reload-layout-stability.md` |
| 事实源 | 截图审阅：截图 1 `/connections` 连接概览、截图 2 `/connections/whitelist` 表白名单、截图 3 `/connections/whitelist` 点击 `刷新本地目录` 后 |
| 关联规范 | `webui/docs/00-product-terminology-standard.md`, `webui/docs/11-connection-whitelist-test-ux-refresh.md`, `webui/docs/17-static-catalog-loading-spec.md`, `webui/docs/25-connection-module-terminology-ia-refresh-spec.md`, `webui/docs/28-catalog-reload-result-ops-ux-spec.md`, `webui/docs/31-connection-manifest-upload-affordance-spec.md`, `docs/DEVELOPMENT.md` |

## 1. 背景

`/connections/whitelist` 表白名单页面已经具备搜索、Schema 筛选、可见结果批量选择、刷新本地目录、缺失 Manifest 占位和表格状态展示。但截图 3 暴露了一个高优先级体验问题：点击 `刷新本地目录` 后，刷新结果以内嵌大卡片形式进入筛选工具栏右侧，导致工具栏高度显著增加、右侧批量操作被挤压、页面主体整体下移。

该问题不是单纯视觉 polish，而是数据库接入运维页面的交互契约问题：

1. 操作成功反馈是短暂事件，不应改变筛选栏结构。
2. 缺失 Manifest 是 Schema 级诊断，不应挂在筛选工具栏内。
3. 工具栏是高频操作区域，高度必须稳定。
4. `/connections/whitelist` 与 `/connections` 对同一类缺失 Manifest 诊断应保持术语和视觉模式一致。

本规格收敛 `/connections/whitelist` 的刷新反馈、筛选工具栏、缺失 Manifest 占位和行内操作 affordance。

## 2. 决策摘要

本轮采用以下决策：

| 决策 | 说明 |
|---|---|
| 工具栏高度恒定 | `刷新本地目录` 的 loading、success、warning 结果不得在工具栏内展开大块内容 |
| 刷新成功走 Toast | 用户点击后短暂显示 Toast：`本地目录已刷新`，可附带 `3 张表`、`1 个提示` |
| 诊断留在 Schema 区域 | `openclaw_db` 缺失 Manifest 的常驻提示只出现在对应 Schema 分组内部 |
| 批量选择轻量化 | `已选 X/Y 张表 | 全选 | 反选` 为右侧轻量 Selection Bar，不使用额外完成 Badge |
| 缺失 Manifest 使用内嵌诊断 | 空 Schema 不是普通灰色大空状态，而是 Schema 分组内的紧凑诊断区 |
| 行内操作链接化 | `查看语义` 使用链接视觉，字段数不再显示无语义箭头 |
| 补充入口收敛 | `/connections/whitelist` 只做缺失 Manifest 诊断，不提供独立上传入口；Schema 级 YAML 回到 `/connections` 连接概览处理 |

## 3. 目标与非目标

### 3.1 目标

| 目标 | 说明 |
|---|---|
| 消除刷新后的布局重排 | 点击 `刷新本地目录` 后，筛选工具栏不得因 inline result panel 增高 |
| 建立可预测的 Toolbar 布局 | 左侧只放检索过滤，右侧只放选择批量动作和运维动作 |
| 保持诊断上下文 | 缺失 Manifest 明确归属到 `连接 + Schema` 分组 |
| 对齐连接概览 | 复用 `/connections` 已建立的 `缺少 Manifest` 诊断语言和动作层级 |
| 提升行级可点击性 | `查看语义` 和缺失 Manifest 诊断跳转具备链接 affordance 和键盘 focus |
| 加强术语治理 | 页面不引入术语标准禁用文案，专业术语和路径具备浏览器翻译防御 |

### 3.2 非目标

| 非目标 | 理由 |
|---|---|
| 不改变 Catalog reload 后端语义 | `刷新本地目录` 仍只读取 `ktx.yaml` 与 `semantic-layer` YAML，不连接数据库 |
| 不新增通知中心 | 本轮只要求复用现有 Toast 机制 |
| 不重构保存白名单流程 | `enabled_tables` 的 dry-run、保存、浮动保存栏保持现有边界 |
| 不改变 Schema Manifest 上传后端 | 上传路径、校验、asset kind 与审计不在本轮变更 |
| 不在表白名单页新增上传入口 | 表白名单页只跳转到连接概览补齐 Schema Manifest |
| 不新增物理表扫描能力 | 缺失 Manifest 只能通过上传或外部生成后刷新解决 |

## 4. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- None.

Required UI terms:

| 概念 | UI 主术语 | 禁止文案 |
|---|---|---|
| Page | `表白名单` | `白表`、`表白` |
| Schema Filter | `Schema 筛选` | `模式筛选`、`架构筛选` |
| Catalog Reload | `刷新本地目录` | `重新加载资产`、`触发 ingest` |
| Reload Success | `本地目录已刷新` | `本地 Catalog 已重新加载` 作为主标题常驻工具栏 |
| Missing Manifest | `缺失 Manifest` / `缺少 Manifest：<schema>` | `缺失清单`、`财政部舱单` |
| Schema Manifest Repair Link | `去连接概览上传 Manifest` / `打开连接概览` | `上传该 Schema 的 YAML`、裸用 `上传 YAML`、当前页独立 `上传 Manifest` 主按钮 |
| Semantic Detail | `查看语义` | `查看注释` 作为该列动作 |

Browser translation defense is mandatory for:

- `Schema`、`Manifest`、`Catalog`、`YAML`、`Table` 等专业英文术语。
- `demo-mysql`、`dataforai`、`openclaw_db`、`superstore_orders` 等连接、Schema 和表名。
- `ktx.yaml`、`enabled_tables`、`semantic-layer/demo-mysql/_schema/openclaw_db.yaml` 等文件名、字段名和路径。

## 5. UX Diagnosis

### 5.1 Screenshot 2 Baseline

截图 2 中的页面基础结构正确：页面标题、筛选区、按 `连接 + Schema` 分组的表格，以及缺失 Manifest 的 Schema 占位都已经存在。但仍有以下问题：

| 问题 | 影响 |
|---|---|
| 工具栏控件全部平铺在同一行 | 检索、选择和运维动作混在一起，视觉层级弱 |
| `已勾选` 重复展示 | 同时出现 label 和 summary，信息密度不经济 |
| `全选当前结果` / `反选当前结果` 按钮权重偏高 | 批量选择动作看起来接近主操作 |
| 缺失 Manifest 占位偏大 | 空 Schema 区域与表格结构脱节 |
| `上传该 Schema 的 YAML` 术语不一致 | 与连接概览和术语标准冲突，也让用户误以为表白名单页存在另一套 Schema YAML 补充流程 |
| `查看语义` 像正文 | 行内动作缺乏链接可点击感 |

### 5.2 Screenshot 3 Regression

截图 3 中点击 `刷新本地目录` 后新增的大块结果提示造成以下回归：

| 问题 | 影响 | 处理决议 |
|---|---|---|
| 工具栏右侧出现大块 warning 卡片 | 工具栏高度暴涨，筛选区不再稳定 | 禁止在工具栏内渲染 reload result panel |
| `完成 ✓ · 3 张表` 出现在操作区 | 看起来像批量动作或状态按钮 | 禁止在工具栏按钮上保留完成态文案 |
| warning 脱离 Schema 分组 | 用户无法直接把提示和下方 `openclaw_db` 区域建立关系 | 诊断锚定在 `OPENCLAW_DB` 分组 |
| 页面主体整体下移 | Reflow 破坏操作连续性 | Toast 负责瞬时反馈，常驻诊断保持在原本内容区 |

## 6. Target Information Architecture

`/connections/whitelist` 主体结构：

```text
PageHeader
└─ Panel
   ├─ Stable Toolbar
   │  ├─ Filter Area
   │  │  ├─ Search input
   │  │  └─ Schema select
   │  └─ Operations Area
   │     ├─ Selection summary
   │     ├─ Select all visible link
   │     ├─ Invert visible link
   │     └─ Refresh local catalog button
   ├─ Table Group: Connection + Schema with manifest
   │  └─ Table rows
   └─ Table Group: Connection + Schema missing Manifest
      └─ Compact diagnostic panel
```

Recommended toolbar copy:

```text
搜索表名/描述...    Schema 筛选: 全部 Schema      已选 3/3 张表 | 全选 | 反选      刷新本地目录
```

On narrow screens:

- Filter Area may wrap above Operations Area.
- Operations Area remains compact and right-aligned when width allows.
- No reload result content may appear inside the toolbar.

## 7. Component Contract

### 7.1 Stable Toolbar

Required behavior:

| Element | Required contract |
|---|---|
| Search input | Placeholder `搜索表名/描述...`; filters by table name and qualified name |
| Schema select | Label `Schema 筛选`; options include `全部 Schema` plus configured Schemas even if Manifest is missing |
| Selection summary | Copy `已选 X/Y 张表`; `Y` follows current visible table result |
| Select all visible | Copy `全选`; applies to visible rows only |
| Invert visible | Copy `反选`; applies to visible rows only |
| Reload button | Copy remains `刷新本地目录` before and after success |

Rendering rules:

- Toolbar must use two structural zones, for example `pl-whitelist-filter-area` and `pl-whitelist-ops-area`.
- `CatalogReloadButton` inside the toolbar must pass `showCompletionLabel={false}`.
- `CatalogReloadButton` inside the toolbar must pass `showInlineResult={false}`.
- Toolbar must not render `CatalogReloadResultPanel`.
- Toolbar must not render `本地 Catalog 已重新加载 · 1个提示` or equivalent warning card.
- Toolbar must not render a `完成 ✓ · N 张表` badge.

### 7.2 Refresh Feedback

When the user clicks `刷新本地目录`:

1. Button enters loading state: `刷新本地目录中...`.
2. Duplicate clicks are disabled.
3. On success, button returns to `刷新本地目录`.
4. A Toast appears in the app-standard Toast region.
5. Query caches for connections, sources and table inventory are invalidated or refreshed as currently implemented by the reload hook.
6. Any persistent warning is rendered only inside the related Schema section.

Recommended Toast copy:

| Result | Toast |
|---|---|
| Success, no warnings | `本地目录已刷新 · 3 张表` |
| Success, with warnings | `本地目录已刷新 · 3 张表 · 1 个提示` |
| Error | `本地目录刷新失败：<message>` |

The Toast is transient and does not replace the Schema-level diagnostic.

### 7.3 Manifest-Present Table Group

The normal table group keeps the existing table layout, with these refinements:

| Column | Contract |
|---|---|
| `选择` | Checkbox, stable dimensions, accessible label `选择 <table>` |
| `表名 (Table)` | Table name with `translate="no"` and `notranslate` |
| `字段数` | Numeric display only, for example `30` or `30 个`; no row-level arrow symbol |
| `状态` | Existing status Badge contract: `已纳入`, `待同步`, `已启用，待补语义`, `未启用` |
| `动作` | Row action links or lightweight text buttons |

`查看语义` must use link affordance:

- Brand or link color.
- Normal text weight.
- Hover underline or clear color transition.
- Keyboard focus ring.
- No button border or filled background.

### 7.4 Missing Manifest Schema Group

For a configured Schema with no local Manifest, render a compact diagnostic inside the group:

```text
连接：DEMO-MYSQL · Schema：OPENCLAW_DB

缺少 Manifest：openclaw_db
openclaw_db 已在连接配置中启用，但本地 schema 文件不存在。
路径：semantic-layer/demo-mysql/_schema/openclaw_db.yaml
展开详情    复制路径    去连接概览上传 Manifest
```

Required behavior:

| Element | Contract |
|---|---|
| Group heading | Keeps `连接：<CONNECTION> · Schema：<SCHEMA>` |
| Diagnosis title | `缺少 Manifest：<schema>` |
| Description | States the Schema is enabled in connection config and the local schema file is missing |
| Path | Exact expected path, `code`, `dir="ltr"`, `notranslate` |
| `展开详情` | Toggle with `aria-expanded`; reveals compact explanation |
| `复制路径` | Copies path when browser API is available; otherwise can no-op with error Toast |
| `去连接概览上传 Manifest` | Links to `/connections`; implementation may carry `connectionId` and `schema` as route state or query params if supported |

The empty state must not:

- Use a large gray block that visually outweighs the table.
- Refer to `上传该 Schema 的 YAML`.
- Open a Schema Manifest upload Drawer directly from `/connections/whitelist`.
- Include a duplicate `刷新本地目录` action inside every empty Schema block.
- Say the page will access the physical database.

## 8. Accessibility And Responsiveness

| Area | Requirement |
|---|---|
| Toolbar | `role="toolbar"` may remain, but controls need visible labels or aria labels |
| Toast | Success Toast should not be the only place where warnings are discoverable |
| Diagnostics | Missing Manifest panel uses semantic text and accessible buttons; warning color is not the only signal |
| Links | `查看语义` and `去连接概览上传 Manifest` expose correct hrefs |
| Keyboard | All row actions, selection actions and diagnostic actions are reachable by tab |
| Layout | Toolbar controls have stable min/max widths and do not overlap at 1440px, 1280px and mobile widths |
| Translation defense | Professional terms, object names and paths are protected per terminology standard |

## 9. Testing Requirements

Update `webui/src/__tests__/table-whitelist.test.tsx` to cover:

1. Toolbar renders stable zones and the reload button keeps copy `刷新本地目录` after success.
2. Clicking toolbar reload calls `/api/catalog/reload` but does not render `catalog-reload-inline` inside the toolbar.
3. Success Toast copy uses `本地目录已刷新`.
4. Missing Manifest Schema group renders `缺少 Manifest：openclaw_db`, expected path, `复制路径`, `去连接概览上传 Manifest`.
5. Missing Manifest group does not render `上传该 Schema 的 YAML`.
6. Missing Manifest group does not open or mount the Schema Manifest upload Drawer on `/connections/whitelist`.
7. `查看语义` is a link and does not use high-weight button classes.
8. Field count cells do not include arrow glyphs.
9. Terminology lint still passes.

If the Toast system is hard to assert directly in unit tests, assert the `toast.success` call by mocking `sonner`.

## 10. Acceptance Criteria

1. Clicking `刷新本地目录` on `/connections/whitelist` no longer increases the toolbar height by rendering an inline result card.
2. The reload button returns to `刷新本地目录` after success; no `完成 ✓ · N 张表` toolbar badge appears.
3. Refresh success is communicated by Toast.
4. Missing Manifest warnings remain discoverable in the related Schema section after Toast disappears.
5. The `openclaw_db` missing Manifest block is compact, aligned with the group content and visually consistent with `/connections` diagnostics.
6. `上传该 Schema 的 YAML` is removed from `/connections/whitelist`; the repair action routes users to `/connections` to upload Schema Manifest.
7. `/connections/whitelist` does not provide a second Schema Manifest upload Drawer or table-level YAML upload affordance.
8. `查看语义` uses link styling with hover/focus affordance.
9. Field count cells render clean numeric text without unexplained arrows.
10. DOM nodes containing `Schema`, `Manifest`, object names, filenames and paths include browser translation defense where applicable.
11. `cd webui && npm test -- table-whitelist catalog-reload-components` passes.
12. `cd webui && npm run lint:terminology` passes.

## 11. Risks And Boundaries

| Risk | Mitigation |
|---|---|
| Toast-only feedback could hide warnings | Keep persistent Schema-level diagnostics |
| Link-styled actions may look too subtle | Use brand/link color, hover underline and focus ring |
| Toolbar wrapping may still occur on small screens | Allow controlled two-row responsive layout, but no reload result content in toolbar |
| Copy path may fail without Clipboard API | Show error Toast; path remains visible in code text |
| Existing `CatalogReloadButton` is shared by `/connections` | Add props or use existing props without breaking card-local reload UX on `/connections` |
