# Help Markdown Rendering Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Help Markdown Rendering Spec |
| 文档类型 | Product / Frontend Contract / Security / Help Center Spec |
| 版本 | v0.1 |
| 撰写日期 | 2026-07-31 |
| 适用范围 | Lucy WebUI Help Center：`/help`、`docs/SYSTEM_HANDBOOK.md`、Help Markdown 渲染器、目录深链与相关前端测试 |
| 架构决议 | Help Center 必须把系统手册按实际 Markdown 渲染，尤其是表格、代码块、列表、链接和标题；P0 阶段采用本地、无外部依赖的受控 Markdown 渲染增强，不改变 Help API 的单一事实源与只读边界 |
| 事实源 | `docs/SYSTEM_HANDBOOK.md`、`docs/design-system-handbook-help.md`、`webui/src/pages/HelpCenter.tsx`、`webui/src/components/MarkdownPreview.tsx`、`webui/src/__tests__/help-center.test.tsx`、`webui/src/__tests__/wiki.test.tsx` |
| 关联文档 | `webui/docs/00-product-terminology-standard.md`、`webui/docs/24-yaml-delivery-runbook-spec.md`、`docs/design-system-handbook-help.md`、`docs/DEVELOPMENT.md` |

## 1. 决策摘要

当前 `/help?section=deployment-checklist` 的正文没有完整按 Markdown 渲染：系统手册里的表格会以 `| 列 | 列 |` 原始文本形式显示。根因是 Help Center 复用了 `MarkdownPreview` 的轻量预览能力，该组件只覆盖标题、段落、列表、代码块、引用、链接等基础语法，没有 GFM pipe table 解析。

Help Center 是长期自助运维入口，系统手册中的部署向导、YAML 规范、权限配置、排障 checklist 都依赖表格表达。如果表格不渲染，用户和 Agent 都无法稳定读取 checklist 结构。因此本规格将 Markdown 渲染能力列为 M26 P0 修复：在不改变后端 Help API、不引入外部网络或 LLM 依赖、不暴露 raw HTML 的前提下，补齐表格渲染与测试护栏。

## 2. 目标与非目标

### 2.1 目标

| 目标 | 说明 |
|---|---|
| 渲染系统手册表格 | `docs/SYSTEM_HANDBOOK.md` 中的 GFM pipe table 必须渲染成 HTML table |
| 保持单一事实源 | Help API 仍只读取固定 `docs/SYSTEM_HANDBOOK.md`，前端不接收任意路径 |
| 保持只读隔离 | Help 仍是独立只读端点，不进入 `wiki/`，不暴露给 MCP 工具面 |
| 保持安全渲染 | raw HTML 必须转义；禁止执行内联脚本；危险链接协议不生成可点击链接 |
| 支持深链阅读 | `?section=<sectionId>` 仍能滚动到对应章节，表格渲染不得破坏标题锚点 |
| 提供回归测试 | 用 `/help?section=deployment-checklist` 覆盖真实表格场景，并补 Markdown renderer 单测 |
| 术语与翻译防御 | `Markdown`、`Schema`、`Manifest`、路径、URL、代码节点必须使用 `translate="no"` / `notranslate` |

### 2.2 非目标

| 非目标 | 理由 |
|---|---|
| 不改 Help API envelope | `GET /api/help/handbook` 的 `{ ok, data }` 结构已经稳定 |
| 不新增 Help 搜索 | 搜索、侧边 Drawer、复制代码按钮属于后续体验增强，不阻塞 P0 |
| 不把手册改写成 HTML | Markdown 文件仍是文档单一事实源 |
| 不在 P0 引入完整 Markdown 依赖 | 当前目标是受控补齐核心语法；依赖评估可作为 P2 技术债处理 |
| 不改变 Wiki 写入能力 | 本轮只增强预览渲染，不改变 Wiki 编辑、保存、frontmatter 等行为 |

## 3. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- None.

Required UI terms:

| 概念 | UI 主术语 | 备注 |
|---|---|---|
| Help Center | `系统手册` | 顶部入口、Tooltip 和页面标题沿用既有术语 |
| Markdown | `Markdown` | 保留英文，不翻译为“标记文本” |
| Table | `表格` | 面向用户描述渲染结果时使用 |
| Deep Link | `深链` | Spec / Plan 中可使用，UI 中优先不暴露 |

Browser translation defense is mandatory for:

- `Markdown`、`Schema`、`Manifest`、`Catalog`、`Endpoint` 等专业英文术语。
- `docs/SYSTEM_HANDBOOK.md`、`semantic-layer/...`、`/help?section=deployment-checklist` 等路径和 URL。
- `<code>`、`<pre>`、`<table>`、`<th>`、`<td>` 中承载的数据库对象名、文件名和配置键。

Example:

```tsx
<code translate="no" className="notranslate">docs/SYSTEM_HANDBOOK.md</code>
<table translate="no" className="pl-markdown-table notranslate">...</table>
```

## 4. Current Diagnosis

| 现象 | 事实源 | 影响 |
|---|---|---|
| `/help` 正文表格显示为原始 pipe 文本 | `docs/SYSTEM_HANDBOOK.md` 的部署 checklist 表格 | 用户无法按列读取 Ready 条件、检查方法和异常处理 |
| Help Center 复用轻量 Markdown preview | `webui/src/pages/HelpCenter.tsx` 调用 `MarkdownPreview` | Help 文档复杂度已经超过 Wiki 预览最小能力 |
| 现有 renderer 缺少 table block | `webui/src/components/MarkdownPreview.tsx` | 所有系统手册表格都会退化 |
| 现有测试没有覆盖表格 | `webui/src/__tests__/help-center.test.tsx`、`webui/src/__tests__/wiki.test.tsx` | 回归无法被自动发现 |
| 设计规范已预留 P1 表格增强 | `docs/design-system-handbook-help.md` | 本次 M26 将该项提前作为 P0 修复 |

## 5. Rendering Contract

### 5.1 P0 Supported Syntax

| Markdown 语法 | P0 行为 |
|---|---|
| `#` 到 `######` 标题 | 渲染为 heading，保留稳定锚点 ID |
| 段落 | 渲染为 `<p>` |
| 无序 / 有序列表 | 渲染为 `<ul>` / `<ol>`，P0 不要求复杂嵌套 |
| fenced code block | 渲染为 `<pre><code>`，内容必须转义 |
| inline code | 渲染为 `<code>`，内容必须转义 |
| blockquote | 渲染为 `<blockquote>` |
| link | 安全协议渲染为 `<a>`；危险协议渲染为普通文本 |
| horizontal rule | 渲染为 `<hr>` |
| GFM pipe table | 渲染为 `<table>`，支持 header、body 和对齐标记 |

### 5.2 Table Parsing Rules

P0 表格识别必须满足：

1. 当前行是 pipe row，下一行是 separator row。
2. separator cell 匹配 `:?-{3,}:?`，可识别左 / 中 / 右对齐。
3. 表格不在 fenced code block 内解析。
4. 行首 / 行尾 pipe 可有可无，但解析时需要归一化。
5. 表头列数以第一行为准；body 行缺列时补空字符串，多列时截断或按实现保持但不得破坏 DOM。
6. cell 内容走既有 inline renderer，必须先 escape raw HTML。

Example:

```md
| 步骤 | Ready 条件 | 异常处理 |
|---|---|---|
| 1 | `ktx.yaml` 已配置 | 检查路径 |
```

Required DOM shape:

```html
<div class="pl-markdown-table-wrap">
  <table class="pl-markdown-table notranslate" translate="no">
    <thead>
      <tr>
        <th>步骤</th>
        <th>Ready 条件</th>
        <th>异常处理</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>1</td>
        <td><code>ktx.yaml</code> 已配置</td>
        <td>检查路径</td>
      </tr>
    </tbody>
  </table>
</div>
```

## 6. Security Contract

| 风险 | P0 要求 |
|---|---|
| raw HTML 注入 | Markdown 文本中的 `<script>`、`<img onerror>` 等必须显示为文本，不生成真实 HTML 节点 |
| 危险链接协议 | `javascript:`、`data:` 等不得生成可点击 `<a href>` |
| 外部依赖漂移 | P0 不新增网络依赖，不在运行时访问外网 |
| 路径穿越 | 不改 Help API；前端仍消费固定手册响应，不传 path |
| MCP 暴露 | Help 文档不进入 `lucy_*` 工具面，不作为 MCP 动态读取路径 |
| Wiki 语域污染 | 不把系统手册复制到 `wiki/`，不走 Wiki 保存链路 |

Safe link policy:

- `#section-id`、`?section=...`、`/help?...` 可作为内部链接。
- `http://`、`https://` 可作为外部链接，外部链接使用 `target="_blank"` 与 `rel="noreferrer"`。
- 其它协议默认降级为文本。

## 7. UX Contract

### 7.1 Help Page Table Presentation

| UI 元素 | 要求 |
|---|---|
| Table wrapper | 横向可滚动，避免小屏撑破正文 |
| Header row | 使用轻量背景和边框，便于 scan |
| Cell padding | 保持运维文档密度，不做营销式大卡片 |
| Code in cells | 使用等宽字体与 `notranslate` |
| Long path / URL | 可换行或横向滚动，不遮挡相邻内容 |

### 7.2 `/help?section=deployment-checklist`

验收目标页面必须满足：

1. 页面不长时间停留在 `系统手册加载中...`。
2. `deployment-checklist` 深链滚动到部署向导章节。
3. 部署 checklist 以真实表格呈现。
4. 表格中的路径、命令、配置键不会被浏览器自动翻译。
5. 若 section 不存在，应保留现有手册内容，并给出非阻断式提示或停留顶部；不得空白。

## 8. Architecture Options

| 方案 | 内容 | 优点 | 风险 / 代价 | 决策 |
|---|---|---|---|---|
| A. 扩展 `MarkdownPreview` | 在现有无依赖 renderer 中加入 table block | 改动小，Wiki / Help 共用能力，离线稳定 | 自维护 parser，需要测试兜底 | M26 P0 推荐 |
| B. 新建 `HelpMarkdown` | Help 独立 renderer，Wiki 保持原样 | Help 风险隔离，样式更聚焦 | 重复解析逻辑，后续维护两个 renderer | 可作为重构备选 |
| C. 引入 `react-markdown` + `remark-gfm` + sanitizer | 使用成熟 Markdown 生态 | 语法完整 | 新依赖、安全配置和 bundle 变更，需要额外评审 | P2 评估 |

M26 P0 采用方案 A：在现有 renderer 中补受控 GFM table 支持。如果实现后 `MarkdownPreview.tsx` 超过合理复杂度，可在同一工单内抽出纯函数模块，例如 `webui/src/components/markdown/renderMarkdown.ts`，但不得改变对外 API。

## 9. Test Contract

### 9.1 Required Tests

| 测试文件 | 覆盖点 |
|---|---|
| `webui/src/__tests__/help-center.test.tsx` | `/help?section=deployment-checklist` 渲染真实 table，TOC 和深链仍可用 |
| `webui/src/__tests__/wiki.test.tsx` 或新增 renderer test | `MarkdownPreview` 支持 table、raw HTML 转义、危险链接降级 |
| `webui/server/__tests__/help.test.ts` | Help API envelope 和固定手册路径保持不变；本轮只需确认不回归 |

### 9.2 Required Commands

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- help-center
npm test -- --run src/__tests__/wiki.test.tsx
npm test -- help
npm run build
```

如果测试文件名调整，应在收尾说明中列出等价命令和原因。

## 10. Acceptance Criteria

| 验收项 | 标准 |
|---|---|
| 表格渲染 | `/help?section=deployment-checklist` 中 checklist 不是 raw pipe 文本，而是 `<table>` |
| 安全 | raw HTML 只显示为文本；`javascript:` 链接不可点击 |
| 单一事实源 | `GET /api/help/handbook` 仍只读取 `docs/SYSTEM_HANDBOOK.md` |
| 深链 | `?section=deployment-checklist` 可定位章节，不破坏 TOC |
| 术语 | UI 文案遵守 `00-product-terminology-standard.md`，专业英文和路径具备翻译防御 |
| 回归 | focused tests 和 build 通过 |

## 11. Rollout Notes

本规格是 Help Center 可用性的 P0 修复，不需要迁移数据，不需要改 `docs/SYSTEM_HANDBOOK.md` 内容。上线后用户刷新 `/help?section=deployment-checklist` 即可看到表格化 checklist。若后续系统手册继续增加 Mermaid、任务列表、脚注等高级语法，应另立 Spec 评估完整 Markdown renderer 与 sanitizer 方案。
