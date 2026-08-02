# Help Center Layout Polish Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Help Center Layout Polish Spec |
| 文档类型 | Product / UX / Frontend Contract / Help Center Spec |
| 版本 | v0.1 |
| 撰写日期 | 2026-07-31 |
| 适用范围 | Lucy WebUI Help Center：`/help`、Help Header、TOC、正文阅读区、Markdown 表格、深链滚动与相关前端测试 |
| 架构决议 | Help Center 必须从“Markdown 原文展示页”升级为可长期自助阅读的企业级文档中心；优先修复深链定位、Header metadata、双侧栏拥挤、正文阅读宽度和首屏信息噪音，不改变 Help API 的固定单一事实源 |
| 事实源 | 浏览器审阅 `http://127.0.0.1:55176/help?section=database-connection-acl-sync`、用户截图、`webui/src/pages/HelpCenter.tsx`、`webui/src/components/MarkdownPreview.tsx`、`webui/src/app/app.css`、`docs/SYSTEM_HANDBOOK.md` |
| 关联文档 | `webui/docs/00-product-terminology-standard.md`、`webui/docs/30-help-markdown-rendering-spec.md`、`docs/design-system-handbook-help.md`、`docs/DEVELOPMENT.md` |

## 1. 决策摘要

M26 已让 Help Center 支持真实 Markdown 表格，但 `/help` 的整体阅读体验仍存在明显布局问题：

1. URL 深链为 `?section=database-connection-acl-sync` 时，左侧 TOC 高亮目标章节，但右侧正文仍停留在文档顶部，用户会认为目录跳转失效。
2. Header 右上角 `docs/SYSTEM_HANDBOOK.md` 与更新时间连在一起，缺少分隔、标签和 chip 样式。
3. 首屏正文直接显示文档元数据表格，与页面 Header 信息重复，视觉上像 Markdown 原文转储。
4. 页面左侧已有全局 App 导航，Help 内又展示完整长 TOC，形成双侧栏拥挤。
5. 正文阅读区过宽，段落行长偏长；表格虽然可渲染，但阅读密度与文档节奏仍需优化。

本规格将 Help Center P0 聚焦为“布局可信 + 阅读可用”：深链必须定位到正确章节，Header metadata 必须清晰，正文宽度必须适合阅读，TOC 必须降低层级噪音，首屏不得被重复 metadata 表格占据。

## 2. 目标与非目标

### 2.1 目标

| 目标 | 说明 |
|---|---|
| 修复深链定位 | `?section=<id>` 必须滚动到对应章节，当前 TOC 高亮与正文位置一致 |
| 整理 Header metadata | source path、更新时间、返回工作台必须分区展示，不得粘连 |
| 降低首屏噪音 | 文档 metadata 表格不得作为 Help 正文首屏主视觉 |
| 优化阅读宽度 | 正文设置最大阅读宽度，表格独立横向滚动 |
| 收敛 TOC 密度 | TOC 只展示适合导航的层级，当前项更明显 |
| 保留安全边界 | 不改变 Help API、SSOT、Markdown 安全渲染与 MCP 隔离 |
| 建立回归测试 | 用布局结构测试和滚动测试覆盖 P0 行为 |

### 2.2 非目标

| 非目标 | 理由 |
|---|---|
| 不改 Help API | `/api/help/handbook` fixed-source envelope 已稳定 |
| 不新增搜索 | 搜索属于后续增强，不阻塞布局 P0 |
| 不重写手册内容 | `docs/SYSTEM_HANDBOOK.md` 仍为单一事实源，本轮只处理呈现 |
| 不新增外部 Markdown 依赖 | M26 已采用本地 renderer，本轮继续沿用 |
| 不重做全站导航 | 本轮只处理 Help 页面内布局，不改 App Shell 主导航架构 |

## 3. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- None.

Required UI terms:

| 概念 | UI 主术语 | 备注 |
|---|---|---|
| Help Center | `系统手册` | 左下入口、页面标题和 Tooltip 沿用 |
| Table of Contents | `目录` | 页面内 TOC 标题 |
| Source Path | `来源` | Header metadata label |
| Updated At | `更新时间` | Header metadata label |

Browser translation defense is mandatory for:

- `docs/SYSTEM_HANDBOOK.md` 等文件路径。
- `/help?section=...` 等 URL。
- `Schema`、`Manifest`、`Catalog`、`MCP`、`Agent`、`KTX` 等专业术语。
- Markdown 表格、代码块和 inline code 中的路径、配置键、数据库对象名。

## 4. Current UX Diagnosis

### 4.1 Screenshot Findings

| 问题 | 表现 | 用户影响 |
|---|---|---|
| 深链不可信 | URL 与 TOC 当前项指向 `Agent 可见性与 ACL 同步`，正文仍在顶部 | 用户认为目录不可用 |
| Header metadata 粘连 | `docs/SYSTEM_HANDBOOK.md2026/7/31 13:40:36` 无间距 | 信息难读，像渲染 bug |
| 双侧栏拥挤 | App nav + Help TOC 同时占据左侧 | 文档阅读区被挤压，视觉压力大 |
| 首屏信息重复 | Header 已显示系统手册，正文又显示 metadata table | 用户进入后看不到实际帮助内容 |
| 正文行长过长 | 右侧正文横向铺满卡片 | 长段落扫描困难 |
| 表格权重偏重 | metadata table 灰底边框很强 | 文档开头过于沉重 |

### 4.2 Code Diagnosis

| 文件 | 观察 | 决策 |
|---|---|---|
| `webui/src/pages/HelpCenter.tsx` | Header 直接渲染 `pl-page-header-cell--badges` 下的裸 `span` | 改为 `.pl-page-header-badges` 包裹，或补兼容样式 |
| `webui/src/pages/HelpCenter.tsx` | `scrollIntoView` 在 sections ready 后触发，但当前页面可能受滚动容器/布局时序影响 | 增加稳定滚动时机与测试 |
| `webui/src/app/app.css` | `.pl-help-layout` 固定 `260px + 1fr`，正文无最大阅读宽度 | 设置整体布局最大宽、正文 max-width 与表格滚动 |
| `webui/src/app/app.css` | `.pl-help-toc` 长目录直接全部展示 | 降低层级噪音，当前项样式增强 |
| `MarkdownPreview` | 现在能渲染表格，但没有 Help 特定首屏 metadata 降噪 | 在 Help 页面层过滤或弱化文档 metadata block |

## 5. P0 UX Contract

### 5.1 Deep Link Contract

Required behavior:

1. 访问 `/help?section=database-connection-acl-sync` 后，页面必须滚动到 `Agent 可见性与 ACL 同步` section。
2. 左侧 TOC 中同一项必须 `aria-current="location"`。
3. 页面滚动结束后目标 section 的顶部不能被 Header 或容器遮挡。
4. 如果 section id 不存在，页面保留全文内容并停留顶部，不显示空白页。

Implementation guidance:

- Prefer `requestAnimationFrame` or short post-render effect to wait for Markdown sections mounted.
- Keep `.pl-help-section { scroll-margin-top: ... }` large enough for app chrome.
- If the scroll container is not `window`, scroll the correct container explicitly.

### 5.2 Header Contract

Header layout:

```text
系统帮助 / 系统手册                         [来源 docs/SYSTEM_HANDBOOK.md] [更新时间 2026/7/31 13:40:36]
系统手册
Project Lucy 系统使用与运维手册             [返回工作台]
```

Rules:

- Source path and updated time must be separate chips.
- Chips must wrap gracefully on narrow widths.
- File paths use `translate="no"` and `notranslate`.
- `返回工作台` remains an action button, visually separate from metadata.

### 5.3 Body Start Contract

The Help page should not open with a large metadata table that duplicates the header.

Acceptable P0 options:

| 方案 | 行为 |
|---|---|
| A. Hide handbook metadata block in Help rendering | Remove the top metadata table from rendered sections only; Markdown source unchanged |
| B. Convert metadata table to compact summary strip | Render as subdued metadata block below title |
| C. Collapse metadata block by default | Show `查看文档元数据` disclosure |

P0 推荐 A：在 Help page splitting/rendering 层识别文档开头 metadata table，避免首屏重复；不改 `docs/SYSTEM_HANDBOOK.md`。

### 5.4 Reading Width Contract

| 区域 | 约束 |
|---|---|
| Help page max width | 可利用大屏，但不让正文无限拉伸 |
| Help content | `max-width` 约 `960px-1120px`，居中或左对齐 |
| Markdown paragraph | 正文行长适合中文阅读，不超过约 90-110 个汉字 |
| Table wrapper | `overflow-x:auto`，表格可超出正文阅读宽度但不得撑破页面 |
| Code block | 独立横向滚动，不影响页面整体宽度 |

### 5.5 TOC Contract

Rules:

- TOC 默认展示 H2 / H3；H4 只展示当前章节附近或保持更弱样式。
- 当前项必须比普通项更明显，至少具备背景、字重、左侧 indicator 三者中的两项。
- TOC 自身可滚动，但不能让当前项被隐藏后用户无上下文。
- 长标题允许两行，不应挤出容器。

## 6. P1 UX Contract

| 项 | 建议 |
|---|---|
| 标题锚点 | 标题 hover 时显示复制链接按钮 |
| 当前阅读提示 | TOC 顶部显示 `当前阅读：<section>` |
| 表格视觉 | 降低 header 灰底权重，增加 zebra 或 hover 时的行扫描 |
| 空 section 处理 | section 不存在时显示非阻断提示 |
| 内容分组 | H2 section 可以增加轻量间距，不做嵌套卡片 |

## 7. P2 UX Contract

| 项 | 建议 |
|---|---|
| 搜索手册 | Header 增加本地搜索，不引入网络或 LLM |
| 只看当前章节 | 支持当前章节聚焦阅读 |
| 移动端 TOC Drawer | 小屏将 TOC 折叠为 Drawer / popover |
| 章节复制 | 支持复制 section link |
| 阅读位置记忆 | 回到 Help 时恢复最近章节 |

## 8. Test Contract

### 8.1 Required Tests

| 测试文件 | 覆盖点 |
|---|---|
| `webui/src/__tests__/help-center.test.tsx` | Header metadata 分离、TOC 当前项、深链滚动、metadata table 不占首屏 |
| `webui/src/__tests__/app-shell.test.tsx` | 全局 `? 系统手册` 入口仍指向 `/help` |
| `webui/src/__tests__/wiki.test.tsx` | Markdown renderer 表格能力不回归 |

### 8.2 Required Commands

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- help-center
npm test -- app-shell
npm test -- --run src/__tests__/wiki.test.tsx
npm run build
```

If the implementation touches shared CSS or shell layout, also run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run
```

## 9. Acceptance Criteria

| 验收项 | 标准 |
|---|---|
| 深链定位 | `/help?section=database-connection-acl-sync` 打开后正文定位到对应章节 |
| Header metadata | source path 与更新时间分离显示，不粘连 |
| 首屏 | 首屏优先显示可阅读正文，不被重复 metadata 表格占据 |
| TOC | 当前项清晰，高层级目录不造成视觉拥挤 |
| 阅读宽度 | 正文不无限拉伸，表格和代码块不撑破页面 |
| 安全边界 | Help API fixed-source、Markdown escaping、MCP 隔离不变 |
| 回归 | focused tests 和 build 通过 |

## 10. Rollout Notes

本规格是 Help Center P0 布局修复，不需要数据迁移，不需要修改 Help API，不需要重启 KTX daemon。上线后用户刷新 `/help` 或带 `section` 的 Help 深链即可看到新的阅读布局。若后续新增搜索、章节复制或移动端 Drawer，应另立增强工单。
