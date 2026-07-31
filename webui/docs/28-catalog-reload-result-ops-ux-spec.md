# Catalog Reload Result Operations UX Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Catalog Reload Result Operations UX Spec |
| 文档类型 | Product / UX / Frontend Contract / Operations Spec |
| 版本 | v0.1 |
| 撰写日期 | 2026-07-31 |
| 适用范围 | Lucy WebUI 数据库接入模块：`/connections` 连接卡片、本地目录刷新结果、Schema 资产列表、Manifest 缺失诊断与相关测试 |
| 架构决议 | `刷新本地目录` 的结果必须回到当前 Connection Card 内展示；状态摘要、Schema 资产上下文和 warning 诊断按从结论到排障的顺序渐进呈现，不再使用悬浮式状态控件或独立的大块结果面板 |
| 事实源 | `webui/src/pages/connections/ConnectionOverview.tsx`、`webui/src/components/catalog/*`、`webui/src/lib/types.ts`、`webui/server/ktx.ts`、`ktx.yaml`、`semantic-layer/<connection>/_schema/<schema>.yaml` |
| 关联文档 | `webui/docs/00-product-terminology-standard.md`、`webui/docs/21-connection-catalog-upload-ux-spec.md`、`webui/docs/25-connection-module-terminology-ia-refresh-spec.md`、`webui/docs/27-connection-overview-ops-ux-cleanup-spec.md`、`docs/DEVELOPMENT.md` |

## 1. 决策摘要

用户在 `/connections` 点击 `刷新本地目录` 后，当前界面会出现一个视觉上漂浮的 `完成 ✓ · 3 张表` 状态块，以及一个偏离连接上下文的大型 warning 面板。该形态在 DataOps 运维场景中有三个问题：

1. `完成 ✓ · 3 张表` 看起来像可点击按钮，但语义实际是刷新状态，造成控件 affordance 错配。
2. 连接卡片中部出现大量空白，刷新结果被推到右侧，用户视线需要在连接身份、状态和 warning 之间跳跃。
3. 缺失 Manifest 的提示没有先给出 Schema 资产上下文，运维人员无法一眼判断该 warning 对应哪个 Schema、是否影响表白名单维护、下一步动作是什么。

本规格将刷新结果重构为 Connection Card 内的 DataOps 状态区：

```text
[MySQL] demo-mysql                                      预期只读
配置来源：ktx.yaml。凭据不在 WebUI 中编辑。
Host demo-db:3306    Database dataforai

本地目录已刷新 · 11:54     已完成     3 张表     1 个提示

关联 Schema 资产列表
Schema         Manifest 状态       本地表数       操作
dataforai      已存在              3 张表        维护白名单
openclaw_db    缺失 Manifest       0 张表        上传 Manifest

缺少 Manifest：openclaw_db
openclaw_db 已在连接配置中启用，但本地 schema 文件不存在。
路径：semantic-layer/demo-mysql/_schema/openclaw_db.yaml
展开详情                                      打开目录    重新检查
```

核心产品原则：刷新结果不是新页面、不是右侧浮层、不是孤立控件，而是当前 Connection 的一次状态更新和排障入口。

## 2. 目标与非目标

### 2.1 目标

| 目标 | 说明 |
|---|---|
| 收拢刷新反馈 | 将 `刷新本地目录` 的完成、表数、提示数放回连接卡片上下文 |
| 消除伪按钮 | 将 `完成 ✓ · 3 张表` 从按钮形态改为只读 Badge / Tag / status text |
| 保留资产上下文 | warning 之前必须展示 `关联 Schema 资产列表`，让用户先看到 `openclaw_db` 的行级状态 |
| 形成排障闭环 | 缺失 Manifest 行提供 `上传 Manifest`，warning 面板提供 `打开目录`、`重新检查` 和可展开详情 |
| 统一术语层级 | 主视图面向用户使用 `本地目录`；二级详情可显示 `Catalog`、`Manifest`、`schema 文件` 和路径 |
| 提升信息密度 | 卡片高度由内容自然撑开，不再为了右侧提示制造大面积空白 |

### 2.2 非目标

| 非目标 | 理由 |
|---|---|
| 不改变 reload 语义 | `刷新本地目录` 仍只读 `ktx.yaml` 与 `semantic-layer` YAML，不连接数据库，不执行 ingest |
| 不新增物理扫描 | 缺失 Manifest 的修复入口是上传或打开目录，不自动扫描物理数据库生成 manifest |
| 不改变 YAML 写入边界 | 上传 Manifest 仍走既有受控上传路径和校验 |
| 不引入复杂通知中心 | 本轮只处理 Connection Card 内结果展示，不新增全局通知系统 |

## 3. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- None.

Required UI terms:

| 概念 | UI 主术语 | 备注 |
|---|---|---|
| Catalog Reload | `刷新本地目录` | 按钮和主反馈使用该术语 |
| Reload Success | `本地目录已刷新` | 不使用 `本地 Catalog 已重新加载` 作为主标题 |
| Reload Warning Count | `1 个提示` | warning 是成功后的提示，不等同失败 |
| Schema Asset List | `关联 Schema 资产列表` | 保留 `Schema` 英文 |
| Manifest Status | `Manifest 状态` | 表头和 Tag 均保留 `Manifest` |
| Missing Manifest | `缺失 Manifest` / `缺少 Manifest：<schema>` | 不使用术语标准中禁用的 Manifest 误译 |

Browser translation defense is mandatory for:

- `Schema`、`Manifest`、`Catalog` 等专业英文术语。
- `demo-mysql`、`dataforai`、`openclaw_db` 等连接、Schema、数据库对象名。
- `semantic-layer/demo-mysql/_schema/openclaw_db.yaml` 等路径。

Example:

```tsx
<span translate="no" className="notranslate">缺失 Manifest</span>
<code translate="no" className="notranslate">
  semantic-layer/demo-mysql/_schema/openclaw_db.yaml
</code>
```

## 4. UX Diagnosis

### 4.1 Current Anti-Patterns

| 问题 | 影响 | 处理决议 |
|---|---|---|
| 中间漂浮状态控件 | 用户误以为 `完成 ✓ · 3 张表` 可点击 | 改为状态栏 Badge，不绑定 click |
| 右侧大型结果面板 | 破坏连接卡片阅读顺序，制造空白 | 改为卡片内 inline 诊断 |
| `详情` 居中孤立 | 不像按钮，也不像内容标题 | 改为 `展开详情`，带折叠状态和 aria-expanded |
| Warning 先于资产列表 | 用户缺少 Schema 上下文 | 先展示资产列表，再展示 warning 诊断 |
| 术语并列过多 | `Catalog / 本地目录 / Manifest / schema` 混用 | 主视图使用 `本地目录`，详情显示技术对象 |

### 4.2 DataOps Reading Order

运维人员在刷新后需要按以下顺序完成判断：

1. 操作是否完成：`本地目录已刷新 · 11:54`。
2. 影响范围多大：`3 张表`、`1 个提示`。
3. 哪个 Schema 有问题：资产列表中 `openclaw_db` 为 `缺失 Manifest`、`0 张表`。
4. 具体缺什么：warning 面板显示缺失文件路径。
5. 下一步怎么修：行级 `上传 Manifest`，面板级 `打开目录` / `重新检查`。

UI 必须服务这个顺序，不应把 warning 做成脱离列表上下文的独立消息。

## 5. Page Contract

### 5.1 Connection Card Layout

Connection Card uses this order after reload:

```text
Card
├─ Header
│  ├─ Engine badge
│  ├─ Connection name
│  ├─ Read-only status
│  └─ Connection-level actions if screen width allows
├─ Connection metadata
│  ├─ 配置来源
│  ├─ Host
│  └─ Database / default schema
├─ Reload status bar
│  ├─ 本地目录已刷新 · <time>
│  ├─ 已完成
│  ├─ <N> 张表
│  └─ <M> 个提示
├─ Schema asset table
│  ├─ Schema
│  ├─ Manifest 状态
│  ├─ 本地表数
│  └─ 操作
└─ Inline diagnostic panel, only when warning or error exists
```

The reload status bar must not be rendered as a floating center block. It should be aligned with card content and wrap gracefully on narrow screens.

### 5.2 Reload Status Bar

Recommended states:

| State | Main text | Badges | Notes |
|---|---|---|---|
| Idle | `本地目录未刷新` | `尚未读取本地 YAML` | Optional if card already has initial loaded data |
| Loading | `正在刷新本地目录...` | disabled action state | Button disabled, spinner allowed |
| Success | `本地目录已刷新 · HH:mm` | `已完成`、`N 张表` | No warning badge if zero warnings |
| Success with warnings | `本地目录已刷新 · HH:mm` | `已完成`、`N 张表`、`M 个提示` | Warning badge uses amber, not red |
| Error | `本地目录刷新失败 · HH:mm` | `失败` | Error panel replaces warning panel |

`已完成` should be visually a Badge / Tag, not a button. If using a `<button>` for implementation convenience, it must be replaced with a non-interactive element.

### 5.3 Schema Asset Table

The `关联 Schema 资产列表` remains visible after reload and must appear above any warning panel.

Columns:

| Column | Content | Required behavior |
|---|---|---|
| `Schema` | Schema name | `notranslate`, stable test id |
| `Manifest 状态` | `已存在`、`缺失 Manifest`、`解析失败` | Tag color communicates state |
| `本地表数` | `0 张表` / `3 张表` | Numeric text, not a progress bar |
| `操作` | `维护白名单`、`上传 Manifest`、`查看错误` | Row action only targets current Schema |

Missing Manifest row:

- May use a very light warning background.
- Must keep normal row height.
- Must expose `上传 Manifest` as the most direct fix.

### 5.4 Inline Warning Panel

Warning panel renders inside the same card and below the Schema asset table.

Required content:

```text
缺少 Manifest：openclaw_db
openclaw_db 已在连接配置中启用，但本地 schema 文件不存在。
路径：semantic-layer/demo-mysql/_schema/openclaw_db.yaml
展开详情                                      打开目录    重新检查
```

Rules:

- The panel is compact and inline, not a large side card.
- Warning is amber / neutral-warning, not destructive red.
- The first line is a clear diagnosis, not a generic `1 个提示`.
- `展开详情` uses a button with `aria-expanded`.
- `打开目录` opens or reveals the local folder when the environment supports it; if not supported, it can copy the path and show an inline fallback.
- `重新检查` re-runs the same reload / local check without requiring the user to click the top-level reload button.

### 5.5 Expanded Details

Expanded details are for technical diagnosis. They may include:

- Missing file path.
- Source config entry, for example the Schema is enabled in `ktx.yaml`.
- Expected manifest location.
- A short explanation that reload does not connect to the database.
- Raw warning code if backend exposes one, for example `missing_manifest`.

Do not put long stack traces in the collapsed panel. If stack traces are needed for true reload failures, use a scrollable log frame in the expanded section.

## 6. Interaction Contract

### 6.1 Refresh Flow

1. User clicks `刷新本地目录`.
2. Button enters loading state and duplicate clicks are disabled.
3. Reload result updates the status bar inside the same Connection Card.
4. Schema asset table updates from the returned local Catalog data.
5. If warnings exist, render inline warning panel below the table.
6. If the user fixes the issue via `上传 Manifest`, upload success triggers reload and updates the same status bar and table.

### 6.2 Warning Fix Flow

For missing Manifest:

```text
缺失 Manifest row -> 上传 Manifest -> locked upload Drawer -> upload success -> auto reload -> row becomes 已存在
```

For local filesystem investigation:

```text
Warning panel -> 打开目录 -> user checks semantic-layer path -> 重新检查 -> reload result updates
```

If opening a folder is unavailable in browser-only deployments, `打开目录` may become `复制路径` with the same visual priority.

## 7. Visual Design Requirements

1. Card radius follows existing system tokens and must not exceed existing card radius.
2. Do not place a card inside another card. The warning panel is an inline alert surface, not a nested card.
3. Status bar uses compact horizontal groups with wrapping, not absolute positioning.
4. Table and warning panel share the same left content edge.
5. Avoid a one-note amber page: warning color is reserved for the Tag and the alert accent, not the whole card background.
6. Button text must fit at desktop and mobile widths; row actions may collapse into an action menu on narrow screens.
7. No visible text should explain generic UI mechanics such as “点击按钮查看详情”; use standard labels and affordances.

## 8. Accessibility And Responsive Behavior

- `展开详情` must expose `aria-expanded`.
- Warning panel uses `role="status"` for non-blocking warnings after successful reload, and `role="alert"` only for reload failures.
- Loading state must be announced through button text or an aria-live region.
- Keyboard order follows visual order: status bar -> table -> warning panel actions.
- Schema table remains horizontally usable on narrow screens.
- Professional terms, paths and object names must use translation defense.

## 9. Acceptance Criteria

### 9.1 Product Acceptance

- Clicking `刷新本地目录` no longer creates a floating `完成 ✓ · 3 张表` control.
- Reload result appears inside the current Connection Card as a status bar.
- `关联 Schema 资产列表` remains visible and appears above warning diagnostics.
- Missing Manifest appears both as a row status (`缺失 Manifest`) and as an inline diagnostic (`缺少 Manifest：openclaw_db`).
- Warning panel shows the missing manifest path and provides `展开详情` plus a remediation action.
- `展开详情` is visibly a control, not centered plain text.
- Main view uses `本地目录` for the reload concept; `Manifest` and `Schema` remain untranslated.
- The layout has no large unexplained blank area at the tested desktop viewport.

### 9.2 Testing Acceptance

Required focused tests:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run src/__tests__/connection-overview.test.tsx
npm run lint:terminology
```

Recommended verification:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test
npm run build
```

Manual smoke:

- Open `/connections`.
- Click `刷新本地目录` on `demo-mysql`.
- Verify status bar, Schema asset table and inline warning order.
- Verify `上传 Manifest` opens the locked upload flow for `openclaw_db`.
- Verify `展开详情` expands and collapses without layout overlap.

### 9.3 Non-Regression

- Catalog reload remains local-only and does not connect to the database.
- No user-visible copy uses banned terminology from `00-product-terminology-standard.md`.
- No secret, token or password file content appears in warning details.
- Existing upload validation and overwrite confirmation remain intact.
- Existing M23 connection-level action separation remains compatible with this layout.
