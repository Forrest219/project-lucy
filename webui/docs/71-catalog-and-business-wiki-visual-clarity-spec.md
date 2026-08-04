# Catalog and Business Wiki Visual Clarity Spec

| 字段 | 内容 |
| --- | --- |
| Spec 编号 | 71 |
| 关联工单 | `webui/docs/plans/wo-M64-catalog-and-business-wiki-visual-clarity.md` |
| 关联页面 | `/catalog`、`/wiki` |
| 关联台账 | `docs/ui-ux-feedback/pages/catalog.md`、`docs/ui-ux-feedback/pages/wiki.md` |
| 状态 | Draft |
| 日期 | 2026-08-03 |
| 范围 | Catalog 表格字重、Business Wiki 文档库首页、目录树视觉、上传 Markdown 预检 |

## 1. 背景

2026-08-03 浏览器核查确认 `/catalog` 与 `/wiki` 存在一组视觉层级和交互 affordance 问题：

1. `/catalog` 表名列 `superstore_orders`、`superstore_people` 为链接，实际 `font-weight: 500`；同一行的结构列为 `400`，用户感知为表名过重。
2. `/wiki` 中 `目录`、`Markdown 文档库`、目录名称、文档库分组名称等多处为 `600`，同屏层级过多，视觉上混乱。
3. `/wiki` 右侧 Markdown 文档库中的小三角是非交互装饰；左侧目录树的小三角虽可点击，但交互语义和光标反馈弱。用户明确要求本轮去掉小三角。
4. `/wiki` 首页的 `Markdown 文档库 / 按目录管理业务口径文档` hero 块信息价值低，只有 `当前收录 N 篇 Markdown 文档，分布在 N 个目录中。` 有保留价值。
5. `/wiki` 首页右侧再次用树形结构展示完整目录层级，和左侧目录重复；右侧重点应转为 Markdown 文档本身。
6. `上传 Markdown 预检` 里 `目标 / 目标目录 / 将新建 Markdown 文档。` 信息重复；`解析摘要` 的标签和值缺少层级，阅读成本高。

本 Spec 是 M47 / M50 / M56 后续 polish，不改变 Wiki 存储、安全边界或后端 API 主契约。

## 2. 目标

1. 统一 `/catalog` 表格正文的信息权重，让表名链接与结构列、状态列保持同等级视觉密度。
2. 降低 `/wiki` 默认首页和目录树的粗体数量，只保留必要标题层级。
3. 从 Wiki 目录相关 UI 中移除小三角 glyph；不再出现看起来能展开但实际不可点的视觉符号。
4. 将 `/wiki` 首页从“目录树复述”改为“Markdown 文档列表”，目录路径作为次级 metadata。
5. 精简 `/wiki` 首页 hero，只保留文档数 / 目录数统计价值。
6. 重构上传预检的信息架构，让目标、状态、解析摘要、Diff 各自清楚。
7. 保持既有上传 / 新建 / 覆盖 / 移动 / 删除目录功能和安全校验不回归。

## 3. 非目标

- 不新增后端 API。
- 不改变 `wiki/` 物理目录、Markdown key、版本记录或上传写入流程。
- 不实现右侧文档列表的排序 / 筛选 / 批量操作。
- 不改变 `/catalog` 表格字段、链接目标或维护语义入口。
- 不重做全局导航、命令面板或移动窄屏体验。
- 不做移动窄屏专项验证，除非后续任务明确要求。

## 4. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:
- None

文案要求：

- 继续使用 `业务 Wiki`、`Markdown 文档库`、`Markdown 文档`、`目录`、`目标 Wiki 路径`、`本地文件名`、`关联表`。
- 不使用 `sl_ref`、`folder`、`project`、`导入 Markdown` 作为用户可见主文案。
- `Markdown`、`Wiki`、`Schema`、`Table`、`Agent`、`MCP`、路径、文件名、目录 key、表名必须添加 `notranslate` / `translate="no"`。

## 5. `/catalog` 表格视觉规则

### 5.1 表名链接字重

`.pl-catalog-table-name-link` 应从 `font-medium` 调整为常规正文权重：

- 目标 `font-weight`: `400`。
- 保留 `text-fg-default`、hover underline 和链接行为。
- 表名仍需 `notranslate` / `translate="no"`。

### 5.2 表格正文层级

表格正文默认层级：

| 内容 | 视觉权重 |
|---|---|
| 表名链接 | 14px / 400 |
| 语义状态 badge | 允许 500，但不能比表名更像主标题 |
| 结构列 | 12px / 400 / muted |
| Agent 引用 | 14px / 400 |
| 更新时间 | 12px / 400 / tabular |

本轮不改变表头 `font-semibold`，表头仍可作为列名层级。

## 6. `/wiki` 字体和目录视觉规则

### 6.1 字体层级

`/wiki` 页面目标层级：

| 区域 | 目标样式 |
|---|---|
| 页面标题 `业务 Wiki` | 维持全局 PageHeader 规范 |
| 左侧标题 `目录` | 16px / 500 |
| 左侧目录名 | 12-13px / 500，禁止全量 `600` |
| 左侧文档名 | 14px / 400；当前选中时可 500 |
| 首页统计文字 | 14px / 400 / muted |
| 右侧文档标题 | 14px / 500 |
| 右侧路径 metadata | 12px / 400 / muted / monospace |

目标是让“可操作文档”成为视觉焦点，而不是让每个目录节点都像标题。

### 6.2 去掉小三角

所有 Wiki 首页和目录树中的小三角 glyph 必须移除，包括但不限于：

- 左侧 `.pl-wiki-tree-group-toggle` 中的 `▼` / `▶`。
- 右侧 `.pl-wiki-library-folder-icon` 中的 `▾`。

替代要求：

- 左侧目录仍可保留展开 / 收起能力，但 row 内不显示三角；如果需要图形提示，使用 folder / open-folder 图标或缩进层级，不使用 triangle / chevron 字形。
- 左侧目录 row 必须有 `cursor: pointer`、`aria-expanded` 和可访问名称，例如 `展开 global 目录` / `收起 global 目录`。
- 右侧文档库首页不再展示可误认为可展开的目录 header，所以不需要展开 / 收起控件。

## 7. `/wiki` 首页信息架构

### 7.1 精简 hero

当前 hero 中：

```text
Markdown 文档库
按目录管理业务口径文档
当前收录 2 篇 Markdown 文档，分布在 11 个目录中。
```

目标改为紧凑 summary band，只保留统计句：

```text
当前收录 2 篇 Markdown 文档，分布在 11 个目录中。
```

规则：

- 不再显示 `按目录管理业务口径文档`。
- `Markdown 文档库` 不再作为大块 hero 的主标题；如果保留，只能作为 `aria-label` 或轻量 section label，不与页面标题竞争。
- Summary band 按内容高度自然收缩，不使用卡片式 hero 视觉。

### 7.2 右侧改为 Markdown 文档列表

右侧首页应展示 Markdown 文档，而不是重复完整目录树。

推荐行结构：

```text
MD  demo-superstore
    wiki/global/demo-superstore.md

MD  m56-msbye4tr upload validation
    wiki/m56-msbye4tr-top/moved/m56-msbye4tr-upload-validation.md
```

规则：

- 每篇 Markdown 文档是一行或一个轻量列表项。
- 文档标题为主视觉。
- 完整 Wiki 路径为次级 metadata，`font-mono`、muted、单行截断、翻译防御。
- 目录层级通过路径 metadata 表达，不再渲染嵌套目录 group。
- 列表为空时显示 `还没有 Wiki 文档。`，并保留主操作入口。

## 8. 上传 Markdown 预检

### 8.1 目标区

目标区应避免重复标题与说明。

推荐结构：

```text
目标 Wiki 路径
wiki/global/codex-upload-preview-smoke.md

[新建文档]
```

规则：

- `目标` section 标题可改为 `目标 Wiki 路径`，或保留 section 标题但内部不再重复 `目标目录` 作为首个 label。
- 新建上传时，目录输入 label 使用 `目标目录`，但路径预览 label 必须是 `目标 Wiki 路径` 或 `目标文件`，不要把完整 `.md` 文件路径标成 `目标目录`。
- `将新建 Markdown 文档。` / `将覆盖现有 Markdown 文档。` 改为紧凑状态 badge 或状态行，不再作为大段说明。

### 8.2 解析摘要

`解析摘要` 改为稳定的两列 description list：

| Label | Value |
|---|---|
| 本地文件名 | `codex-upload-preview-smoke.md` |
| 目标 Wiki 路径 | `wiki/global/codex-upload-preview-smoke.md` |
| 目标位置 / 当前被覆盖文档 | `新建文档` / 当前文档标题 |
| 上传后标题 | `Codex Upload Preview Smoke` |
| 关联表 | `未声明关联表` 或表名 chips |

样式要求：

- `dt`: 12px / 400 / muted。
- `dd`: 14px / 400 或 500，仅标题值可 500。
- 桌面宽度使用 `grid-template-columns: 128px minmax(0, 1fr)` 或等价布局。
- 窄容器可自然堆叠，但标签和值仍需有颜色和间距区分。
- 文件名、路径、关联表必须翻译防御。

### 8.3 Diff 区

Diff 保持独立 section，不和摘要混排。

要求：

- 继续使用现有 `DiffViewer`。
- 保持横向滚动能力。
- 不因摘要两列布局压缩 Diff 可读性。

## 9. 测试要求

### 9.1 Unit / Component Tests

更新 `webui/src/__tests__/catalog.test.tsx`：

- 表名链接存在并保留 `notranslate` / `translate="no"`。
- 表名链接不再带 `font-medium` class。
- 结构列和表名列视觉权重不被表名链接拉开。

更新 `webui/src/__tests__/wiki.test.tsx`：

- `/wiki` 首页只展示统计摘要，不再出现 `按目录管理业务口径文档`。
- 首页右侧 `wiki-library-groups` 不再渲染完整目录 group；改为 Markdown 文档列表 test id，例如 `wiki-library-documents`。
- 文档列表展示文档标题和完整 Wiki 路径 metadata。
- Wiki 首页和目录树可见文本中不包含 `▼`、`▶`、`▾`、`▸`。
- 左侧目录 row 仍有可访问展开状态或等价可访问语义。
- 上传预检目标区区分 `目标目录` 与 `目标 Wiki 路径`，不把 `.md` 文件路径标成 `目标目录`。
- 上传预检 `解析摘要` 使用稳定 row class / test id，标签和值层级可断言。

### 9.2 Verification Commands

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm run lint:terminology
npm test -- src/__tests__/catalog.test.tsx src/__tests__/wiki.test.tsx
npm run build
git diff --check
```

`npm run build` 允许保留当前已知 Vite chunk size warning。

## 10. 浏览器验收

本轮属于用户明确要求过浏览器核查的问题，实施后需要桌面浏览器复核：

1. 打开 `http://127.0.0.1:55176/catalog`。
2. 确认 `superstore_orders`、`superstore_people` 表名视觉不再比结构列明显更粗。
3. 打开 `http://127.0.0.1:55176/wiki`。
4. 确认页面不再出现目录小三角。
5. 确认目录、文档库、目录名不再大面积粗体化。
6. 确认首页只保留 `当前收录 N 篇 Markdown 文档，分布在 N 个目录中。` 作为 summary。
7. 确认右侧重点为 Markdown 文档列表，不再重复完整目录树。
8. 触发 `上传 Markdown` 预检，不点击最终确认。
9. 确认目标区没有 `目标 / 目标目录 / 将新建 Markdown 文档。` 的重复堆叠。
10. 确认 `解析摘要` 标签和值层级清晰。

不做移动窄屏专项验证。

## 11. 风险与边界

- 去掉左侧小三角后，展开 / 收起 affordance 需要靠 row hover、folder icon、缩进和 `aria-expanded` 维持；否则会从“误点”变成“不可发现”。
- 右侧改为文档列表后，用户需要从路径 metadata 理解目录归属；路径必须可见但不能抢主视觉。
- 降低字重可能影响链接可发现性；需要用 hover underline、focus ring 和 cursor 弥补。
- 上传预检样式与保存 / 恢复 / 移动预检共用 `.pl-wiki-preflight-*` class，CSS 必须 scoped，避免污染其他 Modal。
