# Help Sidebar Entry Map Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Help Sidebar Entry Map Spec |
| 文档类型 | Product / UX / IA / Documentation Spec |
| 版本 | v0.2-cross-review |
| 撰写日期 | 2026-08-02；v0.2-cross-review 2026-08-02（吸收 Codex 交叉审阅：5 项发现全部接受——① 事实源改单源 App.tsx 并降级 06 spec；② 新增 SECTION_ALIASES 锚定 section id；③ 抽 navigation.ts 共享导航配置；④ 删除 selector 契约引用；⑤ 措辞统一为"侧栏可见入口"并登记新章节术语） |
| 适用范围 | Lucy WebUI Help Center：`/help`、`docs/SYSTEM_HANDBOOK.md` §1 系统概述与架构拓扑、Help TOC、目录深链与相关测试 |
| 关联工单 | `webui/docs/plans/wo-M59-help-sidebar-entry-map.md`（待 v0.2 spec 批准后落盘） |
| 架构决议 | 在 handbook §1 末尾新增一节「WebUI 入口速查（5+1 侧栏地图）」，作为面向三类用户的"全局功能模块入口"结构表；保留 §0 Q&A / §3 主题小节 / §6 故障排查三套入口的职责分工；不动 Help API、不动 Markdown 渲染器、不引入搜索；**事实源唯一为 `webui/src/app/App.tsx` `navGroups` + `topLevelEntry`**；`webui/docs/06-navigation-ia.md` §3 当前仍保留旧路径（`/onboarding` / `/connections/whitelist` / `表目录` / `连通测试（兼容）`），属于"待同步 IA 文档"，**不**与 `navGroups` 并列称为权威源；引入共享导航配置 `webui/src/app/navigation.ts` 让 App 与测试共用同一份事实 |
| 事实源 | `webui/src/app/App.tsx` line 39–43（`topLevelEntry`）、line 88–146（`navGroups` 5 组共 13 项二级菜单 + 1 个顶部一级入口 = 14 个侧栏可见入口）、`webui/docs/06-navigation-ia.md` §3 line 25–54 与 §4 line 80–101（**待同步**，含旧路径）、`webui/docs/60-help-qa-section-spec.md` v0.2（§0 / §6 边界与翻译防御）、`webui/server/help.ts` `parseHelpToc` line 116–144 + `SECTION_ALIASES` line 12–54、`webui/server/help.ts` `stableSlug` line 94–99（**ASCII-only**）、`webui/src/lib/wiki.ts` `slugifyHeading` line 210–218（**保 Unicode**）、`webui/src/components/MarkdownPreview.tsx` line 59 / 328 / 348（翻译防御范围）、`docs/ui-ux-feedback/pages/catalog.md` line 24 / `wiki.md` line 25（侧栏缺位历史修复）、2026-08-02 用户反馈 + Codex 交叉审阅 5 项发现 |
| 关联文档 | `webui/docs/00-product-terminology-standard.md`、`webui/docs/06-navigation-ia.md`（待同步）、`webui/docs/30-help-markdown-rendering-spec.md`、`webui/docs/33-help-center-layout-polish-spec.md`、`webui/docs/60-help-qa-section-spec.md`、`webui/docs/37-sidebar-navigation-ia-consolidation-spec.md`、`docs/DEVELOPMENT.md` |

## 1. 背景

Lucy WebUI 当前侧栏采用 **5+1 信息架构**：1 个顶部一级入口（`系统概览`）+ 5 个一级分组（`数据接入` / `语义建模` / `语义发布` / `质量评测` / `访问治理`），共 **14 个侧栏可见入口**（1 个顶部入口 + 5 组共 13 项二级菜单）。当前代码事实源为 `webui/src/app/App.tsx` `topLevelEntry`（line 39–43）与 `navGroups`（line 88–146）。

现状调研（2026-08-02）：

1. **handbook 缺一张全局地图**：`docs/SYSTEM_HANDBOOK.md` §3 各小节（数据库接入 / 语义建模 / 发布 / 评测 / 访问治理）按**主题视角**分散，每节自带一张二级页面表，但**没有任何一节给"全局 5+1 鸟瞰"**。新用户、接入 Agent 的协作者或排查人员打开 `/help`，先看到的是 0/1/2/3/4/5/6 七章内容，**侧栏长什么样、5+1 是怎么分的**完全靠他自己在 WebUI 侧栏里摸索。
2. **验收口径与帮助内容不对齐**：`webui/docs/06-navigation-ia.md` §7 把"普通用户从左侧导航能识别 5+1 结构"列为**显式验收项**，但 handbook 没有给读者一份对应的视图。
3. **§0 Q&A 不替代结构地图**：spec 60 v0.2 把 §0 升级为按角色（开发者 / 管理员 / 接入 Agent 的协作者）的问题清单；§0 是**问 → 答**的一对一入口，与"全局功能模块地图 / 入口速查"语义不重叠。
4. **历史修复表明侧栏可识别性是真诉求**：`docs/ui-ux-feedback/pages/catalog.md` line 24 / `wiki.md` line 25 显示侧栏分组缺失 / 错位曾被修过。
5. **事实源唯一性说明**：`webui/docs/06-navigation-ia.md` §3 当前仍保留旧路径（`/onboarding` / `/connections/whitelist` / `表目录` / `连通测试（兼容）`），**与 `navGroups` 当前实现不一致**（代码已迁到 `/overview` / `/connections/enabled-tables` / `语义资产`，且 v1.9.0 移除了连通测试主导航）。本 spec 实施后，必须以**单独的 follow-up 工单**修订 06 spec §3 / §4 与代码对齐；本 spec 不背"06 是权威源"的口径，仅**镜像 `navGroups`**。

## 2. 决策摘要

1. **位置**：`docs/SYSTEM_HANDBOOK.md` §1「系统概述与架构拓扑」末尾新增 `### 1.X WebUI 入口速查（5+1 侧栏地图）` H3 子节，挂在 §1 下既不抢 §0 的 Q&A 入口，也不与 §3 各主题分散的二级表撞；§1 的"架构拓扑"语义最契合"全局地图"。
2. **范围**：只列**侧栏可见的 14 项入口**（1 条顶部一级入口 + 5 个一级分组下 13 项二级菜单）；**不列** `/wiki` 编辑态、`/admin/agents/:id/tokens/new` 等"路由存在但未进导航"的子页；不重复 §3 各小节内的页面表细节。
3. **表格结构**：GFM table 四列——「分组 / 二级菜单 / 路径 / 一句话用途」。
4. **事实源声明**（v0.2 修订）：
   - 表格下方一行明确「事实源唯一为 `webui/src/app/App.tsx` `navGroups` + `topLevelEntry`；`webui/docs/06-navigation-ia.md` §3 当前为待同步 IA 文档（含旧路径），不与代码并列称为权威源」，避免读者把 help 表格误读为 IA 规范源。
   - **抽离共享导航配置**：本 spec 实施时新增 `webui/src/app/navigation.ts` 导出 `topLevelEntry` 与 `navGroups`；`App.tsx` 从该模块 import，测试也从该模块 import，实现"单一事实源 + 自动对齐"。
   - **后续 IA 调整必须**：（a）改 `webui/src/app/navigation.ts`；（b）同步改 §1.X 表格；（c）单独 follow-up 工单修订 `06-navigation-ia.md` §3 / §4（不在本 spec 范围）。
5. **翻译防御**：所有路径、英文产品名（`Agent` / `MCP` / `YAML` / `Catalog` / `Schema` / `Manifest` / `KTX` / `Runtime` / `Token` / `Endpoint` / `Eval Run` 等）一律写 inline code（`` `Agent` `` 等），沿用 spec 60 v0.2 §5 的 renderer 边界要求。
6. **新增 SECTION_ALIASES 锚定章节 id**（v0.2 修订）：
   - 后端 `webui/server/help.ts` `stableSlug`（line 94–99）只保 ASCII `[a-z0-9-]`，中文字符会被吞；正文章节本地锚点走 `webui/src/lib/wiki.ts` `slugifyHeading`（line 210–218，保 Unicode `[\p{L}\p{N}]`）。**两个 slug 规则不一致**，依赖自动派生会导致 TOC / 深链 / 测试各说各话。
   - 本 spec 实施时**必须**在 `webui/server/help.ts` `SECTION_ALIASES`（line 12–54）新增一条：`[/WebUI 入口速查/, "webui-entry-map"]`，显式锚定 §1.X 的 section id 为 `webui-entry-map`，避免依赖中英混排自动 slug。
7. **不动 Help API / 渲染器 / §0–§6 锚点**：保持 `webui/server/help.ts` envelope 与 `parseHelpToc` 行为不变；新增 H3 子节通过新增 `SECTION_ALIASES` 锚定 id；handbook 顶部目录按现有约定补一行。

## 3. 目标与非目标

### 3.1 目标

| 目标 | 说明 |
|---|---|
| 新增 5+1 入口速查章节 | `docs/SYSTEM_HANDBOOK.md` §1 末尾新增 `### 1.X WebUI 入口速查（5+1 侧栏地图）` H3 子节 |
| 覆盖侧栏可见 14 项 | 1 条顶部一级入口（`系统概览`） + 5 组共 13 项二级菜单；分组标题与 `navGroups.title` 逐字一致 |
| 路径与代码事实源对齐 | 表格路径字段必须等于 `navGroups[i].items[j].to` 的当前值；禁止使用 `06-navigation-ia.md` 中已废弃的旧路径（如 `/onboarding`、`/connections/whitelist`） |
| 一句话用途 | 每行第四列不超过两行；详细操作仍跳到 §3 各小节，不重复展开 |
| 引用权威源 | 表格下方一行显式声明事实源唯一为 `webui/src/app/App.tsx` `navGroups` + `topLevelEntry`（v0.2 起由 `webui/src/app/navigation.ts` 导出）；`webui/docs/06-navigation-ia.md` §3 当前为待同步 IA 文档，不与代码并列称为权威源 |
| 翻译防御 | 路径、英文产品名、配置名（`ktx.yaml` / `access.yaml` 等）写 inline code |
| TOC 渲染 | `/help` TOC 出现 `WebUI 入口速查` 新条目，与 §1.1 / §1.2 等同级显示 |
| 顶部目录补链 | handbook 顶部目录 line 10–25 补一行 `[1.X WebUI 入口速查](#1x-webui-入口速查5+1-侧栏地图)` |
| 不破坏既有验收 | §0 / §3 / §6 锚点、内容、顺序不变；spec 60 v0.2 的硬验收项继续生效 |

### 3.2 非目标

| 非目标 | 理由 |
|---|---|
| 不在 §0 新增 Q&A 入口 | spec 60 v0.2 已明确"不新增第二份 Q&A"；§0 与 §1.X 是"问 → 答"和"全局地图"两种语义 |
| 不引入搜索 / 全文索引 | spec 33 §6 P2 已把搜索列为未来增强；本轮只做结构表 |
| 不替代码事实源 / 不与 06 spec 双向漂移 | 表格是镜像视图；IA 改动必须以 `06-navigation-ia.md` 与 `navGroups` 为准，handbook 不反向定义 |
| 不动 Help API envelope | `/api/help/handbook` fixed-source envelope 稳定（spec 30 §2.2） |
| 不动 Markdown 渲染器 | `MarkdownPreview` 已支持 GFM table / code / pre 的 notranslate；不扩展 renderer |
| 不在 §3 任意小节新增二级表 | §3 各小节已自带二级页面表；新章节在 §1 末尾，不重复 |
| 不列路由存在但未进导航的子页 | `/wiki` 编辑态、`/admin/agents/:id/tokens/new`、`/admin/audit-sources` 等"兼容与未进导航"路由不进本表（已在 spec 60 v0.2 §4.1 边界外的概念） |
| 不暴露到 MCP 工具面 | Help 内容不进入 `lucy_*` 工具（spec 30 §6） |
| 不做概念辨析 | "角色权限 vs Agent 实例的差别"等对比属于正文章节，不进 §1.X |

## 4. 范围

### 4.1 In Scope

- `docs/SYSTEM_HANDBOOK.md` §1 末尾新增 `### 1.X WebUI 入口速查（5+1 侧栏地图）` H3 子节。
- 表格行覆盖（**14 个侧栏可见入口**）：
  - 顶部一级入口：`系统概览` → `/overview`
  - 数据接入：`连接概览` → `/connections`、`启用表范围` → `/connections/enabled-tables`
  - 语义建模：`语义资产` → `/catalog`、`业务 Wiki` → `/wiki`
  - 语义发布：`发布工作台` → `/publish/workbench`、`发布记录` → `/publish/history`
  - 质量评测：`评测用例` → `/eval/cases`、`运行历史` → `/eval/runs`、`趋势监控` → `/eval/monitor`
  - 访问治理：`Agent 实例` → `/admin/agents`、`角色权限` → `/admin/roles`、`访问日志` → `/admin/audit`、`配置审计` → `/admin/config-audit`
- 表格下方一行引用「事实源唯一为 `webui/src/app/App.tsx` `navGroups` + `topLevelEntry`；`webui/docs/06-navigation-ia.md` §3 当前为待同步 IA 文档（含旧路径），不与代码并列称为权威源。」
- `docs/SYSTEM_HANDBOOK.md` 顶部目录 line 10–25 补一行 §1.X 锚点。
- **v0.2 新增**：抽离共享导航配置 `webui/src/app/navigation.ts`，导出 `topLevelEntry`、`navGroups`、`NavItem`、`NavGroup` 类型；`webui/src/app/App.tsx` 改为从该模块 import，不在 App.tsx 内重声明。
- **v0.2 新增**：在 `webui/server/help.ts` `SECTION_ALIASES`（line 12–54）追加一条 `[/WebUI 入口速查/, "webui-entry-map"]`，显式锚定 §1.X 的 section id。
- `webui/src/__tests__/help-center.test.tsx` 新增以下断言：
  - §1.X 渲染存在 H3 标题 `WebUI 入口速查（5+1 侧栏地图）`。
  - 表格列数为 4（分组 / 二级菜单 / 路径 / 一句话用途）。
  - 表格包含 14 行（顶部 1 + 5 组 13 项）；分组标题与 `webui/src/app/navigation.ts` `navGroups.title` 逐字一致（**通过 import 共享常量比较，不硬编码**）。
  - 关键路径以 inline code 形式渲染（`/catalog` / `/admin/agents` 等成对出现 `<code>` 节点）。
  - 引用段落含 `webui/src/app/App.tsx` / `webui/src/app/navigation.ts` 文本锚点（inline code 形式）。
- `webui/src/__tests__/navigation.test.ts`（**v0.2 新增**）新增断言：
  - `topLevelEntry.label` / `topLevelEntry.to` 与 §1.X 表格第 1 行逐字一致。
  - `navGroups[*].title` 与 §1.X 表格分组列逐字一致。
  - `navGroups[*].items[*].label` / `.to` 与 §1.X 表格二级菜单列 / 路径列逐字一致。
  - 测试用例数量等于 14（顶部 1 + 5 组 13 项）。
- `webui/server/__tests__/help.test.ts` 新增断言：
  - `parseHelpToc` 输出包含 `webui-entry-map` 条目（来自 `SECTION_ALIASES`）；与 H3 标题 `1.X WebUI 入口速查（5+1 侧栏地图）` 一一对应。
  - 现有 §0 / §3 / §6 锚点集不变（diff 集合比对）。
- `webui/docs/README.md` 不需要新增索引行（spec 61 由对应 plan M59 引用）。

### 4.2 Out of Scope

- 不引入搜索框 / 全文索引。
- 不改 `webui/server/help.ts` 的 `parseHelpToc` 行为；**新增** `SECTION_ALIASES` 一条（v0.2 修订：`[/WebUI 入口速查/, "webui-entry-map"]`），不修改其他已有 alias 条目。
- 不改 `webui/src/components/MarkdownPreview.tsx` 渲染器。
- 不改 `/api/help/handbook` envelope。
- 不在 §3 / §6 新增章节。
- 不展示 `/wiki` 编辑态、`/admin/agents/:id/tokens/new`、`/admin/audit-sources` 等"路由存在但未进导航"的子页。
- 不引入链接校验工具（验收靠手动锚点对照 + 既有 vitest 套件）。
- 不暴露 §1.X 内容到 MCP 工具面。
- 不做"角色权限 vs Agent 实例"等概念辨析。

## 5. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

| 章节术语 | 备注 |
|---|---|
| `WebUI 入口速查（5+1 侧栏地图）` | 新增 H3 章节标题；TOC 出现同一字符串 |
| `5+1 侧栏地图` | 新增章节别名；与 `WebUI 入口速查` 同义，用于引言段与引用段 |
| `侧栏可见入口` | v0.2 引入的统计口径（替换 v0.1 的"14 个二级菜单项"）；1 个顶部入口 + 13 项二级菜单 = 14 |

Required UI terms（表格列名与分组标题）：

| 概念 | UI 主术语 | 备注 |
|---|---|---|
| 侧栏分组 | `数据接入` / `语义建模` / `语义发布` / `质量评测` / `访问治理` | 分组标题与 `webui/src/app/navigation.ts` `navGroups[*].title` 逐字一致 |
| 顶部一级入口 | `系统概览` | 与 `topLevelEntry.label` 逐字一致 |
| 新章节 | `WebUI 入口速查（5+1 侧栏地图）` | H3 标题；TOC 出现同一字符串 |
| 表格列 | `分组` / `二级菜单` / `路径` / `一句话用途` | 沿用现有 GFM 表格命名习惯 |

Allowed supplements:

- 章节内允许出现"事实源"、"镜像视图"、"待同步 IA 文档"等说明性措辞；不出现"权威定义"（v0.2 起该措辞仅用于 `06-navigation-ia.md` 自身作为 IA spec 的内部定义，不再外溢到 §1.X）。
- 表格行内允许出现"v1.9.x 已从导航移除"等历史注释（仅在一句话用途内一句话内简述，不展开）。

Forbidden terms（参考 `00` §3 全局术语表与 §6.1 forbidden list）：

- `财政部舱单`、`舱单`、`替代测试`、`上传报价包`、`添加架构`、`目标架构`、`模式清单`、`重新加载资产` —— 沿用 spec 30 / spec 60 禁止项。

Browser translation defense：

> **重要约束：** 现有 `MarkdownPreview` 翻译防御仅覆盖 `code` / `pre` / `table` 三类 block（`webui/src/components/MarkdownPreview.tsx` line 59 / 328 / 348）；普通文本段落（`<p>`）无法通过 markdown 内容附加 DOM 属性。
>
> 因此本规格对翻译防御的要求**收窄为**：表格内所有路径（`/catalog` / `/admin/agents` / `/overview` 等）、英文产品名（`Agent` / `MCP` / `YAML` / `Catalog` / `Schema` / `Manifest` / `KTX` / `Runtime` / `Token` / `Endpoint` / `Eval Run` 等）、配置文件名（`ktx.yaml` / `access.yaml` 等）必须写 inline code 或 fenced code block，依赖现有 renderer 的 notranslate 兜底。
>
> 不接受"在普通文本段落里靠 markdown 加 DOM 属性"的承诺——这是 renderer 能力边界。
>
> Linter 范围对齐：`scripts/lint-terminology.mjs` line 174–181 高风险词扫描只覆盖 `.tsx`；本轮 §1.X 改动在 `.md` 内，linter 不会扫到，必须靠 review 阶段人工对照 + 既有 `webui/src/__tests__/help-center.test.tsx` 自动化断言。

Mandatory inline-code 列表（§1.X 表格行内遇到这些字符串必须写 `` `字符串` ``）：

- 路径集合：`/overview` / `/connections` / `/connections/enabled-tables` / `/catalog` / `/wiki` / `/publish/workbench` / `/publish/history` / `/eval/cases` / `/eval/runs` / `/eval/monitor` / `/admin/agents` / `/admin/roles` / `/admin/audit` / `/admin/config-audit`。
- 英文产品名：`Agent` / `MCP` / `YAML` / `Catalog` / `Schema` / `Manifest` / `KTX` / `Runtime` / `Token` / `Endpoint` / `Eval Run` / `Role` / `ACL` / `Bearer`。
- 配置文件名：`ktx.yaml` / `access.yaml`。
- 引用权威源（v0.2 修订）：`webui/src/app/App.tsx` / `webui/src/app/navigation.ts` / `webui/server/help.ts`。

## 6. 内容结构

### 6.1 §1.X 大纲（v0.2）

```text
## 1. 系统概述与架构拓扑

### 1.1 Lucy 是什么
### 1.2 …
…
### 1.X WebUI 入口速查（5+1 侧栏地图）

本节是侧栏可见入口的镜像视图。
事实源唯一为 `webui/src/app/App.tsx` `navGroups` + `topLevelEntry`（v0.2 起由 `webui/src/app/navigation.ts` 导出）。
`webui/docs/06-navigation-ia.md` §3 当前为待同步 IA 文档（含旧路径），不与代码并列称为权威源。
架构调整时，请先改 `webui/src/app/navigation.ts`，再同步 §1.X 表格，最后开 follow-up 工单修 06 spec §3 / §4。

| 分组 | 二级菜单 | 路径 | 一句话用途 |
| --- | --- | --- | --- |
| 系统概览 | 系统概览 | `/overview` | … |
| 数据接入 | 连接概览 | `/connections` | … |
| 数据接入 | 启用表范围 | `/connections/enabled-tables` | … |
| 语义建模 | 语义资产 | `/catalog` | … |
| 语义建模 | 业务 Wiki | `/wiki` | … |
| 语义发布 | 发布工作台 | `/publish/workbench` | … |
| 语义发布 | 发布记录 | `/publish/history` | … |
| 质量评测 | 评测用例 | `/eval/cases` | … |
| 质量评测 | 运行历史 | `/eval/runs` | … |
| 质量评测 | 趋势监控 | `/eval/monitor` | … |
| 访问治理 | Agent 实例 | `/admin/agents` | … |
| 访问治理 | 角色权限 | `/admin/roles` | … |
| 访问治理 | 访问日志 | `/admin/audit` | … |
| 访问治理 | 配置审计 | `/admin/config-audit` | … |

> 事实源唯一为 `webui/src/app/App.tsx` `navGroups` + `topLevelEntry`（`webui/src/app/navigation.ts` 导出）；`webui/docs/06-navigation-ia.md` §3 当前为待同步 IA 文档。
```

### 6.2 表格行填表约定

- 分组列：与 `webui/src/app/navigation.ts` `navGroups[i].title` 逐字一致（v0.2 起由该模块共享导出）；"系统概览"作为顶部一级入口单独一行，分组列填 `系统概览`。
- 二级菜单列：与 `topLevelEntry.label` 或 `navGroups[i].items[j].label` 逐字一致。
- 路径列：必须等于 `topLevelEntry.to` 或 `navGroups[i].items[j].to` 的当前值；写成 inline code（`` `/catalog` ``）。
- 一句话用途列：每行不超过两行；不展开操作步骤（操作步骤在 §3 各小节）。

### 6.3 深链锚点（v0.2 修订）

`### 1.X WebUI 入口速查（5+1 侧栏地图）` 的 section ID **不依赖自动 stableSlug**：

- `webui/server/help.ts` `stableSlug`（line 94–99）只保 ASCII `[a-z0-9-]`，中文字符会被吞；正文章节本地锚点走 `webui/src/lib/wiki.ts` `slugifyHeading`（line 210–218，保 Unicode `[\p{L}\p{N}]`）。两个 slug 规则不一致，依赖自动派生会让 TOC / 深链 / 测试各说各话。
- 本 spec 实施时**必须**在 `webui/server/help.ts` `SECTION_ALIASES`（line 12–54）追加一条 `[/WebUI 入口速查/, "webui-entry-map"]`，显式锚定 §1.X 的 section id 为 `webui-entry-map`。
- 深链形如 `/help?section=webui-entry-map`，由 `parseHelpToc` 通过 `sectionIdFor` + alias 匹配返回。

## 7. UX 契约

### 7.1 TOC 与深链

| UI 元素 | 要求 |
|---|---|
| TOC §1 条目 | 已存在（`[1. 系统概述与架构拓扑]`）；保留不删 |
| TOC §1.X 条目 | 新增 `[1.X WebUI 入口速查（5+1 侧栏地图）]`；按现有 TOC 规则展示 |
| 深链定位 | `/help?section=webui-entry-map` 滚动到 §1.X 顶部（v0.2 起由 `SECTION_ALIASES` 显式锚定，不依赖自动 slug） |
| 当前项高亮 | TOC 中当前 section 子节 `aria-current="location"`（沿用 spec 33 §5.1） |
| §0 / §3 / §6 保持 | §0 Q&A / §3 各主题小节 / §6 FAQ 全部不变（spec 60 v0.2 硬约束） |

### 7.2 §1.X 阅读体验

| UI 元素 | 要求 |
|---|---|
| 引言段 | 明确说"§1.X 是侧栏可见入口的镜像视图；事实源唯一为 `navGroups` + `topLevelEntry`（v0.2 起由 `navigation.ts` 导出）；06 spec §3 当前为待同步 IA 文档；架构调整需先改 `navigation.ts` 再同步 §1.X，最后开 follow-up 工单修 06 spec" |
| 表格 | GFM pipe table，四列 14 行；表格本身由 renderer 的 table-block notranslate 兜底 |
| 关键术语 | 必须 inline code；依赖现有 renderer 兜底 |
| 一句话用途 | 不超过两行；详细操作跳到 §3 |
| 引用 | 表格下方一行 `> 事实源唯一为 \`webui/src/app/App.tsx\` \`navGroups\` + \`topLevelEntry\`（\`webui/src/app/navigation.ts\` 导出）；\`webui/docs/06-navigation-ia.md\` §3 当前为待同步 IA 文档。` |

### 7.3 Help 页导航

| 项 | 要求 |
|---|---|
| 顶部入口 | 不新增；`? 系统手册` 仍是唯一定位 |
| HelpButton | 不改 |
| 搜索入口 | 不新增；与 spec 33 §6 P2 保持一致 |

## 8. 安全契约

| 风险 | 要求 |
|---|---|
| raw HTML 注入 | §1.X Markdown 文本中的 `<script>` 等必须显示为文本，不生成真实 HTML 节点（沿用 spec 30 §6） |
| 死链 | 表格路径必须等于当前 `navGroups` 的活跃路径；handbook 顶部目录补链到稳定锚点；Phase 4 跑手动锚点对照 |
| 路径穿越 | 不改 Help API；§1.X 不传 path，只传 section id |
| MCP 暴露 | §1.X 不进入 `lucy_*` 工具面（沿用 spec 30 §6） |
| 真实 ID / token / connection 泄露 | §1.X 不展示真实示例 ID；统一用 inline code + 占位符 |
| 翻译防御 | 路径、英文产品名、配置名必须 inline code；不接受普通文本段落里的术语承诺（renderer 边界） |
| 双向漂移 | IA 调整顺序：① 改 `webui/src/app/navigation.ts`；② 同步 §1.X 表格；③ 开 follow-up 工单修 `06-navigation-ia.md` §3 / §4；plan M59 验收项显式列出 |
| 自动 stableSlug 中英混排不稳定 | v0.2 起改用 `SECTION_ALIASES` 显式锚定 `webui-entry-map`，不依赖自动 slug |
| `navGroups` 模块私有导致测试无法对齐 | v0.2 起抽离 `webui/src/app/navigation.ts`，App 与测试共用同一份事实 |

## 9. 测试契约

### 9.1 必跑测试

| 测试文件 | 覆盖点 |
|---|---|
| `webui/src/__tests__/help-center.test.tsx` | §1.X H3 标题渲染；表格 4 列 14 行；分组标题与 `webui/src/app/navigation.ts` `navGroups[*].title` 一致（**通过 import 共享常量**，不硬编码）；关键路径 inline code；引用段落含 `webui/src/app/App.tsx` / `webui/src/app/navigation.ts` inline code |
| `webui/src/__tests__/help-center.test.tsx` | §1.X 不出现 forbidden 术语（沿用 spec 30 §6.1） |
| `webui/src/__tests__/navigation.test.ts`（**v0.2 新增**） | `topLevelEntry.label` / `.to` 与 §1.X 表格第 1 行逐字一致；`navGroups[*].title` 与分组列一致；`navGroups[*].items[*].label` / `.to` 与二级菜单列 / 路径列一致；用例数 == 14 |
| `webui/server/__tests__/help.test.ts` | `parseHelpToc` 输出包含 `webui-entry-map` 条目（来自 `SECTION_ALIASES`），与 H3 标题 `1.X WebUI 入口速查（5+1 侧栏地图）` 一一对应；现有 §0 / §3 / §6 锚点集不变（diff 集合比对） |

### 9.2 推荐命令（**不用 pretest**）

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
# 直接跑 focused tests，跳过 pretest lint（避免无关脏改动阻塞）
npx vitest run src/__tests__/help-center.test.tsx
npx vitest run src/__tests__/navigation.test.ts
npx vitest run server/__tests__/help.test.ts
```

**禁止**使用 `npm test -- help-center` 或 `npm test` 的形式——`pretest` 会跑 `npm run lint:terminology && npm run lint:ia-boundary`，当前工作区有 90+ 个无关脏改动，lint 必挂。验收仅以 focused vitest 为准。

### 9.3 推荐命令（build）

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm run build
```

build 不依赖 pretest；用于回归渲染管线。

## 10. 验收标准

| 验收项 | 标准 |
|---|---|
| §1.X 子节存在 | `docs/SYSTEM_HANDBOOK.md` §1 末尾新增 `### 1.X WebUI 入口速查（5+1 侧栏地图）` |
| 表格覆盖 14 行 | 1 条顶部一级入口 + 5 组共 13 项二级菜单；分组标题与 `webui/src/app/navigation.ts` `navGroups[*].title` 逐字一致 |
| 路径对齐代码事实源 | 每行路径列等于 `navGroups[i].items[j].to` 或 `topLevelEntry.to` 当前值；不允许旧路径（如 `/onboarding` / `/connections/whitelist`） |
| 一句话用途 | 每行不超过两行；不展开操作步骤 |
| 事实源单一 | 表格下方含引用行：`事实源唯一为 ... （navigation.ts 导出）；06 spec 为待同步 IA 文档` |
| 共享导航配置 | `webui/src/app/navigation.ts` 导出 `topLevelEntry` / `navGroups` / `NavItem` / `NavGroup`；`App.tsx` 不再内联声明 |
| SECTION_ALIASES 锚点 | `webui/server/help.ts` `SECTION_ALIASES` 追加 `[/WebUI 入口速查/, "webui-entry-map"]`；TOC / 深链 / 测试用同一 id |
| TOC 渲染 | `/help` TOC 中 `WebUI 入口速查` 出现，level 3；深链 `/help?section=webui-entry-map` 正确滚动 |
| 顶部目录补链 | handbook line 10–25 顶部目录补一行 §1.X 锚点 |
| 翻译防御 | 关键路径 / 英文产品名 / 配置文件名 / 模块路径全部在 `<code>` 节点内 |
| 现有 §0 / §3 / §6 不变 | spec 60 v0.2 硬约束继续生效；line 1585–1742 §6 内容、顺序、9 个 H3 锚点全部不变 |
| §0 现有 13 条 Q&A 不丢 | spec 60 v0.2 §10 验收项继续生效 |
| 双向漂移防护 | plan M59 验收项显式列出 "IA 调整顺序：navigation.ts → §1.X → 06 spec follow-up" |
| 测试 | `npx vitest run src/__tests__/help-center.test.tsx` 通过 |
| 测试 | `npx vitest run src/__tests__/navigation.test.ts` 通过（v0.2 新增） |
| 测试 | `npx vitest run server/__tests__/help.test.ts` 通过 |
| 构建 | `npm run build` 通过 |
| lint 防御 | §1.X 不出现 forbidden 术语；专业术语 inline code 化由 Phase 3 Step 3.3 grep 自检 |

## 11. Rollout Notes

本规格是 Help Center §1 内容扩展：

- 不需要数据迁移。
- 不修改 Help API。
- 不修改 KTX daemon。
- 不引入新依赖。
- 不修改 Markdown 渲染器。
- **修改** `webui/server/help.ts` `SECTION_ALIASES` 一条（v0.2：`[/WebUI 入口速查/, "webui-entry-map"]`），不修改其他已有 alias 条目；§1.X 子节深链稳定为 `/help?section=webui-entry-map`。

上线后用户：

1. 在 `/help` 顶部目录看到新增的 `1.X WebUI 入口速查（5+1 侧栏地图）` 条目。
2. 滚动到 §1.X 看到完整 5+1 入口速查表；任一路径点开跳到对应页面。
3. 任何时候原有 §0 Q&A / §3 各主题小节 / §6 故障排查照常可用。

后续 IA 调整流程（不在本 spec 范围）：

1. 改 `webui/src/app/navigation.ts`。
2. 同步 §1.X 表格（标题 / 路径 / 一句话用途）。
3. 开 follow-up 工单修 `webui/docs/06-navigation-ia.md` §3 / §4（路径迁移历史在 06 spec 内追溯）。

## 12. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 表格路径与代码事实源漂移 | Phase 1 Step 1.2 直接从 `webui/src/app/navigation.ts`（v0.2 起抽离共享）读出当前 `to` 字段，逐行落表；不允许人工猜测 |
| 双向漂移（IA 改了 §1.X / `navigation.ts` 没改） | v0.2 起三处事实源统一：① `navigation.ts`（代码） ② §1.X 表格（handbook） ③ 06 spec（IA 文档）。review 阶段强制 diff 三处表格一致 |
| `navGroups` 仍是 App.tsx 私有常量 | v0.2 抽离 `webui/src/app/navigation.ts`；App 与测试共用，避免漂移检测形同虚设 |
| spec 60 v0.2 硬验收项被破坏 | review 阶段对照 spec 60 §10 验收项逐条确认；§0 / §3 / §6 锚点集做 diff 集合比对 |
| §1.X section id 自动 slug 中英混排不稳定 | v0.2 起改用 `SECTION_ALIASES` 显式锚定 `webui-entry-map`，不依赖自动 stableSlug |
| 普通文本段落里的术语被浏览器翻译 | §1.X 表格所有专业术语全部 inline code，依赖现有 renderer 兜底；spec §5、§7、§8 三处重复强调 |
| Forbidden 术语回流 | Phase 3 Step 3.3 单独 grep 自检 forbidden list；不依赖 lint |
| 与既有 §3 二级表重复 | §1.X 仅给"路径 + 一句话用途"，不展开操作；§3 各小节仍是操作主战场 |
| 用户期待搜索 | 引言段明确"§1.X 是结构表，不是搜索"；搜索仍走 spec 33 §6 P2 |

## 13. Definition Of Done

- `docs/SYSTEM_HANDBOOK.md` §1 末尾新增 `### 1.X WebUI 入口速查（5+1 侧栏地图）`；表格 4 列 14 行，分组标题与 `webui/src/app/navigation.ts` `navGroups[*].title` 逐字一致；路径列与 `navGroups[*].items[*].to` 当前值一致。
- 表格下方含引用行：`> 事实源唯一为 \`webui/src/app/App.tsx\` \`navGroups\` + \`topLevelEntry\`（\`webui/src/app/navigation.ts\` 导出）；\`webui/docs/06-navigation-ia.md\` §3 当前为待同步 IA 文档。`
- handbook line 10–25 顶部目录补一行 §1.X 锚点。
- 新增 `webui/src/app/navigation.ts`，导出 `topLevelEntry` / `navGroups` / `NavItem` / `NavGroup`；`webui/src/app/App.tsx` 改为从该模块 import，不再内联声明。
- `webui/server/help.ts` `SECTION_ALIASES` 追加 `[/WebUI 入口速查/, "webui-entry-map"]`；§1.X 子节深链稳定为 `/help?section=webui-entry-map`；既有 §0 / §3 / §6 锚点不变。
- `npx vitest run src/__tests__/help-center.test.tsx` 通过。
- `npx vitest run src/__tests__/navigation.test.ts` 通过（v0.2 新增）。
- `npx vitest run server/__tests__/help.test.ts` 通过。
- `npm run build` 通过。
- §1.X 不出现 forbidden 术语。
- 关键路径 / 英文产品名 / 配置文件名 / 模块路径全部 inline code 化通过 Phase 3 Step 3.3 grep 自检。
- spec 60 v0.2 §10 硬验收项继续生效（§0 13 条 Q&A 不丢 / §6 line 1585–1742 锚点不变 / 顶部目录保留 §0 条目）。
- 06 spec §3 / §4 与代码事实源不一致是已知遗留；本 spec **不**负责同步 06 spec，由独立 follow-up 工单承接（不在 DoD 内）。