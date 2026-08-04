# Sidebar Brand Navigation Follow-up Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Sidebar Brand Navigation Follow-up Spec |
| 文档类型 | Product / UX / Visual QA Follow-up Spec |
| 版本 | v0.1 |
| 撰写日期 | 2026-08-03 |
| 前置规格 | `webui/docs/67-sidebar-brand-navigation-polish-spec.md` |
| 关联工单 | `webui/docs/plans/wo-M61-sidebar-brand-navigation-followup.md` |
| 反馈来源 | 2026-08-03 浏览器核查 + 用户截图反馈 |
| 适用范围 | Lucy WebUI 左上角品牌区、Logo 返回行为、命令面板初始态、侧栏一级 / 二级菜单字体体系 |

## 1. Background

M60 已完成侧栏品牌化、折叠菜单、active 状态和命令面板 MVP。但 2026-08-03 浏览器核查暴露出二轮体验问题：

1. 左上角 Logo 区无法点击回到 `/overview`。
2. 命令面板初始态过于混乱，默认列出全部导航项和 URL，缺少参考系统截图中的聚焦搜索体验。
3. 一级菜单与二级菜单字体大小、字重和视觉节奏不均匀。
4. 左上角品牌应显示 `Lucy WebUI`，不是 `Lucy`；`Lucy WebUI` 与 `Data Agent 运维控制台` 两行需要左右视觉对齐。

本 spec 是 M60 的 follow-up，只修复已确认的视觉 / 交互问题，不扩展资源级搜索。

## 2. Goals

1. 品牌区整体可点击，点击返回 `/overview`。
2. 品牌名显示为 `Lucy WebUI`。
3. 品牌标题和副标题在同一文本容器内左右视觉对齐。
4. 命令面板打开时默认只展示搜索输入，不直接铺满所有导航结果。
5. 命令面板参考系统搜索框风格：弱化背景、突出输入、右侧 `ESC` keycap。
6. 统一侧栏一级菜单与二级菜单的字体体系，避免字号、字重、letter-spacing 混乱。
7. 保持 M60 的折叠、active 状态、快捷键和导航跳转能力。

## 3. Non-goals

- 不新增表、Wiki 文档、Agent 资源级搜索。
- 不改变现有路由。
- 不重做 PageHeader。
- 不改变 5+1 信息架构。
- 不做移动窄屏适配。
- 不引入新的 UI 框架或图标库。
- 不修改后端 API。

## 4. Findings From Browser QA

| 反馈 | 核查结论 | 当前原因 | 修正方向 |
|---|---|---|---|
| Logo 不能返回主界面 | 属实 | `.pl-brand-block` 是普通 `div` | 改为 `Link to="/overview"` |
| 搜索弹窗混乱 | 属实 | 默认展示 14 个导航项 + URL 右列 | 默认空态只显示大搜索框；输入后最多展示 5-7 条 |
| 菜单字体不均匀 | 属实 | 一级 `text-xs uppercase tracking-wider`，二级 `text-sm` | 统一 14px 基线，靠颜色 / 背景 / 缩进区分 |
| 品牌名不对齐 | 属实 | 当前为 `Lucy`，未做两行宽度约束 | 显示 `Lucy WebUI`，两行统一固定文本宽度 |

## 5. UX Requirements

### 5.1 Brand Link

品牌区必须改为可点击链接：

- Target：`/overview`
- Accessible name：`返回系统概览`
- 点击范围：Logo mark + 两行文字整体。
- active / hover 不得造成布局跳动。
- 不得嵌套在其它 link 内。

### 5.2 Brand Copy

品牌区文案：

```text
Lucy WebUI
Data Agent 运维控制台
```

要求：

- 两行左边缘对齐。
- 两行右边缘视觉上对齐。
- 推荐使用固定宽度文本容器，例如 152-168px。
- `Lucy WebUI` 可以用微小正向 letter spacing 或 flex distribution 达成视觉宽度。
- `Data Agent 运维控制台` 必须加 `notranslate` / `translate="no"`。
- 品牌链接 hover 可轻微改变背景或文本色，但不要放大。

### 5.3 Command Palette Initial State

打开命令面板时：

- 默认只显示搜索输入区域和轻提示，不显示完整导航列表。
- 输入框应成为视觉主体。
- 右侧显示 `ESC` keycap。
- Overlay 背景参考系统截图：半透明、轻 blur、不要全黑压暗。
- 输入框 focus ring 不应出现粗黑描边。

空查询状态建议：

```text
输入页面或导航名称
```

该提示是辅助说明，不是结果列表。

### 5.4 Command Palette Results

用户输入后才显示结果：

- 最多展示 7 条。
- 不默认展示右侧 URL 大列。
- 可在结果二级文本中显示所属分组，例如 `语义建模`。
- 如需要展示路径，放在更弱的 metadata 行，不能抢主标签注意力。
- 无匹配时显示 `没有匹配的入口`。
- 保持键盘交互：`ArrowUp` / `ArrowDown` / `Enter` / `Escape`。

### 5.5 Sidebar Typography

统一菜单字体体系：

| 元素 | 字号 | 字重 | 颜色 | 说明 |
|---|---:|---:|---|---|
| 一级分组标题 | 14px | 600 | `fg-muted` / active group `fg-default` | 不使用 uppercase，不使用 tracking-wider |
| 二级导航项 | 14px | 500 | `fg-body` | active 使用 `fg-default` |
| 图标 | 16px | N/A | 继承文本色 | 一级 / 二级尺寸一致或只差 1px |
| chevron | 16px | N/A | `fg-subtle` | 只表达折叠状态 |

一级 / 二级区分主要依靠：

- 一级标题背景或 hover 底色。
- 二级缩进。
- active 竖线和弱底。
- 图标 tone，而不是字号剧烈变化。

## 6. Implementation Surface

优先触达文件：

- `webui/src/app/App.tsx`
- `webui/src/components/CommandPalette.tsx`
- `webui/src/app/app.css`
- `webui/src/__tests__/app-shell.test.tsx`
- `webui/src/__tests__/command-palette.test.tsx`

通常不需要修改：

- `webui/src/app/navigation.ts`
- 后端 `server/**`

## 7. Acceptance Criteria

1. 点击左上角品牌区任意位置会跳转到 `/overview`。
2. 品牌区显示 `Lucy WebUI` 和 `Data Agent 运维控制台`。
3. 两行品牌文案左右视觉对齐。
4. 命令面板打开后默认不展示完整导航列表。
5. 命令面板输入框接近系统搜索风格：大输入、搜索图标、右侧 `ESC` keycap、轻 overlay。
6. 输入查询后最多展示 7 条结果。
7. 结果主文案优先显示页面 / 导航名称，不让 URL 路径成为主视觉。
8. 一级 / 二级菜单统一 14px 基线，不再出现 `uppercase tracking-wider` 中文标题。
9. M60 已有快捷键、折叠状态、active 导航项仍可用。
10. 新增 / 修改文案通过术语检查。

## 8. Verification

默认非浏览器验证：

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm run lint:terminology
npm test -- src/__tests__/app-shell.test.tsx src/__tests__/command-palette.test.tsx
npm run build
```

桌面浏览器视觉核查：

- 本轮是视觉 follow-up，实施完成后建议在桌面浏览器核查 `/overview`。
- 不做移动窄屏核查。
- 核查项只限本 spec 的 4 条反馈，不扩展 E2E。

## 9. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

Protected terms: `Lucy WebUI`、`Data Agent 运维控制台`、`Agent`、`Wiki`。

New terms:

- None.
