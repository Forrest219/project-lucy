# Sidebar Brand Navigation Polish Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Sidebar Brand Navigation Polish Spec |
| 文档类型 | Product / UX / Navigation / Brand Spec |
| 版本 | v0.1 |
| 撰写日期 | 2026-08-03 |
| 参考对象 | `https://docs.kaelio.com/ktx/docs/getting-started/quickstart` |
| 关联工单 | `webui/docs/plans/wo-M60-sidebar-brand-navigation-polish.md` |
| 适用范围 | Lucy WebUI 左侧侧栏、品牌区、主导航分组、active 状态、全局搜索入口、Help Center 文档阅读体验 |

## 1. Background

Kaelio ktx Docs 的 UI/UX 风格给 Lucy WebUI 提供了三个可借鉴方向：

1. 品牌区：左上角通过 mascot / wordmark / byline / Docs 标签形成强识别。
2. 菜单：侧栏是可折叠文档树，分组、缩进、active 细线和轻底色形成稳定位置感。
3. 体验：搜索入口、折叠按钮、当前页高亮和阅读型内容区域协同工作。

Lucy WebUI 当前已经完成 5+1 信息架构和全站 PageHeader 标准化。现状更偏企业运维控制台：稳定、克制、信息密度高，但品牌区偏占位，主导航缺少折叠和搜索入口，active 状态缺少产品识别。

本 spec 的目标是把 Kaelio 的品牌温度和导航细节转译到 Lucy，而不是照搬文档站布局。

## 2. Goals

1. 将左上角 `Lucy WebUI` 文本块升级为更明确的 Lucy 品牌区。
2. 保留当前 5+1 信息架构，同时让主导航分组支持折叠。
3. 用品牌色细线和浅底色增强 active 状态。
4. 在侧栏品牌区下方提供全局搜索 / 命令入口占位，可展示 `⌘ K`。
5. Help Center 可进一步参考文档站阅读体验；普通控制台页面保持操作密度。
6. 所有新增用户可见文案遵守 `webui/docs/00-product-terminology-standard.md`。

## 3. Non-goals

- 不重做全站信息架构。
- 不改变现有路由。
- 不把 Lucy 主体页面改成文档站 prose 布局。
- 不引入新的 UI 框架。
- 不要求移动窄屏适配作为本轮验收项。
- 不要求浏览器测试作为本轮默认验证。
- 不实现完整跨资源搜索后端；本轮可先提供前端入口和 command palette shell。

## 4. Design Direction

### 4.1 Brand Area

当前：

- `webui/src/app/App.tsx` 在 `.pl-brand-block` 中显示 `Lucy WebUI` 和 `Data Agent 运维控制台`。
- 视觉层级低，缺少图形锚点。

目标：

- 左侧品牌区由 logo mark、`Lucy` wordmark 和产品定位组成。
- 推荐结构：
  - logo mark：32-40px，避免 Kaelio 80px mascot 那种文档站尺寸。
  - wordmark：`Lucy`，主视觉文本。
  - subtitle：`Data Agent 运维控制台`。
- logo mark 可以先用 CSS / text mark / 简化几何图形实现；后续替换为正式品牌资产。
- 品牌区 hover 可以有轻微 transform，但不得影响布局稳定。

### 4.2 Sidebar Navigation

当前：

- `.pl-app-shell` 固定 `216px` 侧栏。
- 导航是分组标题 + 扁平链接。
- active 状态仅使用灰色背景和字重。

目标：

- 侧栏建议扩至 240-268px 区间，优先 248px，给折叠按钮、搜索入口和中文导航留空间。
- 分组标题成为可点击折叠按钮，右侧展示 chevron。
- 默认展开当前路由所在分组；其它分组可保持上次折叠状态。
- `系统概览` 仍保持顶部独立入口。
- 分组内容使用轻缩进，避免出现二级菜单错觉过强。

### 4.3 Active State

目标 active 样式：

- 背景：品牌色 8-12% alpha 或当前 `bg-bg-selected` 的品牌化版本。
- 左侧：2-3px 品牌色竖线。
- 文本：`text-fg-default`，字重 500。
- hover：保持轻底色，不覆盖 active 竖线。
- focus：沿用或增强 `focus-visible:ring-2`。

### 4.4 Search / Command Entry

目标：

- 在品牌区下方放置搜索入口。
- 文案建议：MVP 使用 `搜索页面和导航入口`；后续接入资源级搜索后，再扩展为表、Wiki 文档和 Agent 搜索。
- 右侧展示 `⌘ K`。
- 本轮最低可行范围：
  - 点击后打开本地 command palette shell。
  - palette 至少能列出现有导航项并跳转。
  - 资源级搜索可以后续接入。

### 4.5 Icons

目标：

- 使用 `lucide-react` 图标增强扫描性。
- 图标只用于主导航入口和按钮，不用于装饰。
- 推荐映射：

| 导航 | 图标建议 |
|---|---|
| 系统概览 | `LayoutDashboard` |
| 数据接入 | `Database` |
| 连接概览 | `Cable` |
| 启用表范围 | `TableProperties` |
| 语义建模 | `Network` |
| 语义资产 | `Boxes` |
| 业务 Wiki | `BookOpen` |
| 语义发布 | `Rocket` |
| 质量评测 | `ChartNoAxesCombined` |
| 访问治理 | `ShieldCheck` |

图标颜色默认继承文本色。active 状态不做多彩 icon，避免控制台变重。

### 4.6 Help Center

Help Center 是最适合参考 Kaelio 文档站的区域。

目标：

- 保留左侧目录 + 正文布局。
- 增强当前章节定位：active toc 细线 + 浅底。
- 代码块和 YAML 示例保留复制能力。
- 可考虑增加 `Copy as Markdown`，但不作为本轮强制范围。

## 5. Interaction Rules

1. 折叠分组点击区域必须覆盖标题整行。
2. chevron 旋转必须表达 open / closed 状态。
3. 当前路由所在分组不可被初始化为关闭；用户手动关闭后，切换到组内路由应重新展开。
4. 折叠状态存入 `localStorage`，key 建议 `lucy.sidebar.collapsedGroups.v1`。
5. command palette 打开后：
   - `Escape` 关闭。
   - 上下方向键移动。
   - `Enter` 跳转。
   - 输入框 autofocus。
6. 侧栏滚动区域不得遮挡底部 `系统手册` 入口。
7. 所有按钮必须有可访问名称。

## 6. Visual Tokens

新增或调整 token 建议：

```css
:root {
  --token-color-nav-active-bg: color-mix(in srgb, var(--token-color-brand) 10%, #ffffff);
  --token-color-nav-active-marker: var(--token-color-brand);
  --token-color-brand-muted: color-mix(in srgb, var(--token-color-brand) 16%, #ffffff);
}
```

实现时如需兼容测试环境，可直接落为静态色值：

| Token | 建议值 | 用途 |
|---|---|---|
| `--token-color-brand` | 现有 `#ff5a3d` 可保留 | 品牌主色 |
| `--token-color-nav-active-bg` | `#fff0ec` | 导航 active 弱底 |
| `--token-color-nav-active-marker` | `#ff5a3d` | active 竖线 |
| `--token-sidebar-width` | `248px` | 默认侧栏宽度 |

## 7. Implementation Surface

优先触达文件：

- `webui/src/app/App.tsx`
- `webui/src/app/navigation.ts`
- `webui/src/app/app.css`
- `webui/src/__tests__/app-shell.test.tsx`
- `webui/src/__tests__/navigation.test.ts`
- 如实现 command palette：新增 `webui/src/components/CommandPalette.tsx` 和对应测试。

## 8. Acceptance Criteria

1. 左上角品牌区不再只是 `Lucy WebUI` 文本块，能清楚表达 Lucy + Data Agent 运维控制台。
2. 主导航分组可折叠，且当前路由所在分组默认展开。
3. active 导航项有品牌色竖线和弱底色。
4. 侧栏顶部存在搜索 / 命令入口，MVP 文案不得承诺资源级搜索，且至少支持导航项搜索跳转。
5. `系统手册` 入口仍在侧栏底部稳定可见。
6. PageHeader 和各业务页面主体布局不被重写。
7. 新增文案通过术语治理，不出现弃用别名。
8. 不新增浏览器窄屏验收要求。

## 9. Risks And Guardrails

- 风险：文档站风格过强，削弱 Lucy 运维控制台密度。
  - Guardrail：品牌感集中在侧栏和少量交互状态，不重做主体卡片。
- 风险：折叠菜单隐藏关键入口。
  - Guardrail：当前路由所在分组自动展开；搜索入口可兜底定位。
- 风险：图标过多造成视觉噪音。
  - Guardrail：图标继承文本色，尺寸 16px，禁用多彩装饰。
- 风险：中文长文案在 216px 侧栏中拥挤。
  - Guardrail：侧栏宽度提升到 248px，并用 ellipsis / tooltip 兜底。

## 10. Verification

默认验证：

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm run lint:terminology
npm test -- src/__tests__/app-shell.test.tsx src/__tests__/navigation.test.ts
npm run build
```

浏览器验证：

- 本轮默认不要求。
- 如后续实施包含复杂 command palette 交互，可由实现计划显式补充 Playwright smoke。

## 11. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

Protected terms: `Lucy`、`Data Agent 运维控制台`、`Schema`、`Manifest`、`Catalog`、`MCP`、`Agent`、`Wiki`、`Help Center`。

New terms:

- `Command Palette`：UI 主术语建议为 `命令面板`，用于 `⌘ K` 打开的页面 / 资源跳转面板。
