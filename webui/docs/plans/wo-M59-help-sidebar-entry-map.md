# M59 Help Sidebar Entry Map Work Order

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 `docs/SYSTEM_HANDBOOK.md` §1 末尾新增 `### 1.5 WebUI 入口速查（5+1 侧栏地图）` H3 子节，作为面向三类用户的全局功能模块入口结构表；抽离 `webui/src/app/navigation.ts` 共享导航配置；在 `webui/server/help.ts` `SECTION_ALIASES` 追加锚定 id；新增 `webui/src/__tests__/navigation.test.ts` 自动对齐测试；不引入搜索、不暴露到 MCP 工具面、不改 Help API、不改 Markdown 渲染器。

**Architecture:** 文档层（handbook §1.5 新增 + 14 行 4 列表格 + 顶部目录补链）+ 代码层（`navigation.ts` 抽离 + App.tsx 改 import + help.ts SECTION_ALIASES 追加一条）+ 测试层（`navigation.test.ts` 新增 + `help-center.test.tsx` 扩展 + `help.test.ts` 扩展）。06 spec §3 / §4 与代码事实源不一致由独立 follow-up 工单承接，**不在本 plan 范围**。

**Tech Stack:** Markdown, TypeScript, React, Fastify, Vitest, Testing Library. No new runtime dependency.

**Source Spec:** [../61-help-sidebar-entry-map-spec.md](../61-help-sidebar-entry-map-spec.md)（v0.2-cross-review）

---

## Context For Developer

Read these documents before editing:

- `webui/docs/61-help-sidebar-entry-map-spec.md` v0.2-cross-review
- `webui/docs/06-navigation-ia.md` §3 line 25–54 与 §4 line 80–101（**待同步**，含旧路径，本 plan 不修）
- `webui/docs/00-product-terminology-standard.md`
- `webui/docs/30-help-markdown-rendering-spec.md`
- `webui/docs/33-help-center-layout-polish-spec.md`
- `webui/docs/60-help-qa-section-spec.md` v0.2（§0 / §6 边界与翻译防御）
- `docs/SYSTEM_HANDBOOK.md` §1 line 47–129 与顶部目录 line 10–25
- `docs/DEVELOPMENT.md`

Inspect these implementation files:

- `webui/src/app/App.tsx` line 33–43（`NavItem` type / `topLevelEntry`）、line 88–146（`navGroups` 私有常量）、line 175–206（侧栏渲染）
- `webui/server/help.ts` `parseHelpToc` line 116–144 / `SECTION_ALIASES` line 12–54 / `sectionIdFor` line 103–107 / `stableSlug` line 94–99
- `webui/src/lib/wiki.ts` `slugifyHeading` line 210–218（保 Unicode slug，与 `help.ts` `stableSlug` ASCII-only 规则不一致）
- `webui/src/components/MarkdownPreview.tsx` line 59 / 328 / 348（翻译防御覆盖范围）
- `webui/src/__tests__/help-center.test.tsx`
- `webui/server/__tests__/help.test.ts`

Non-negotiable boundaries:

- Do not change the Help API route or response envelope (`/api/help/handbook` 固定结构不能动)。
- Do not introduce a second fact source for Help content；§1.5 必须住在 `docs/SYSTEM_HANDBOOK.md`。
- Do not add search, full-text index, or any external dependency.
- Do not expose Help content (including §1.5) through MCP tools.
- Do not render raw HTML from Markdown.
- Do not edit `.ktx/secrets/**`, `ktx.yaml`, or semantic YAML for this work order.
- Do not modify §0 / §3 / §6 任何内容、顺序、锚点（spec 60 v0.2 硬约束 + spec 61 v0.2 §12 风险项）。
- Do not modify `MarkdownPreview.tsx`；本轮翻译防御依赖现有 renderer 能力（`code` / `pre` / `table` block 已带 notranslate）。
- Do not modify `06-navigation-ia.md`（**待同步 IA 文档**，由独立 follow-up 工单承接，本 plan 不修）。
- Do not modify `webui/server/help.ts` 已有 `SECTION_ALIASES` 条目；**只新增一条** `[/WebUI 入口速查/, "webui-entry-map"]`。
- Do not modify `webui/server/help.ts` 的 `parseHelpToc` / `sectionIdFor` / `stableSlug` 行为；新增 H3 走 `SECTION_ALIASES` 锚定，不依赖自动 slug。
- Do not use real role id / token hash / connection id in §1.5 examples; use inline code references.
- Do not skip the "§1.5 是侧栏可见入口的镜像视图；事实源唯一为 navGroups + topLevelEntry（navigation.ts 导出）；06 spec §3 当前为待同步 IA 文档" 引言段。
- Do not use `npm test -- ...` form（pretest 会跑 lint 阻塞无关脏改动）；本任务验收**只用** `npx vitest run <file>` 直接跑 focused tests。
- Do not use 占位编号（`§1.5` `1.5`）；必须写实编号 `§1.5`。
- Do not introduce a circular import between `webui/src/app/App.tsx` and `webui/src/app/navigation.ts`；navigation.ts 只导出纯常量与类型，不依赖 React。
- Do not break the existing `App.tsx` `navLinkClass` / `isHelpRoute` / `isWikiRoute` / `appShellClass` 计算逻辑；本 plan 只动常量导入路径与一个 H3 章节渲染。
- Treat existing dirty worktree changes as user-owned unless directly part of this work order.

---

## Phase 1: 共享导航配置抽离

### Task 1.1: 新增 `webui/src/app/navigation.ts`

**Files:**

- Create: `webui/src/app/navigation.ts`

**Step:**

1. 新建文件 `webui/src/app/navigation.ts`，从 `webui/src/app/App.tsx` line 33–146 抽出以下符号：
   - `export type NavItem = { label: string; to: string; active: (pathname: string) => boolean; };`
   - `export const topLevelEntry: NavItem = { label: "系统概览", to: "/overview", active: (path) => path === "/overview" };`
   - `export const navGroups: Array<{ title: string; items: NavItem[] }> = [ ... ]`（与 `App.tsx` 当前 `navGroups` **逐字一致**）
2. 文件内容只导出常量与类型，不依赖 React；不引入任何 runtime 副作用。
3. 顶部加一行 `// Mirror of `webui/src/app/App.tsx` line 39–43 + line 88–146 — single source of truth for Help §1.5 alignment.`

**Expected:** 新文件可被 App.tsx 与测试 import；不引入循环依赖。

**Commit:** `feat(webui): extract shared navigation config (webui/src/app/navigation.ts)`

---

### Task 1.2: 修改 `webui/src/app/App.tsx` 改用共享常量

**Files:**

- Modify: `webui/src/app/App.tsx` line 33–146

**Step:**

1. 删除 `webui/src/app/App.tsx` 内联的 `NavItem` 类型定义（line 33–37）、`topLevelEntry` 常量（line 39–43）、`navGroups` 常量（line 88–146）。
2. 在 `webui/src/app/App.tsx` 顶部 import 改为：
   ```ts
   import { topLevelEntry, navGroups, type NavItem } from "./navigation";
   ```
3. 不修改 `navLinkClass`（line 148–150）、`AppFrame` 函数体（line 152+）、侧栏渲染（line 175–206）、任何其他代码。
4. 跑 `npx tsc --noEmit -p webui` 验证 import 路径正确（允许的 lint 报错继续忽略，本轮不走 pretest）。

**Expected:** `App.tsx` 通过共享常量 import；`topLevelEntry` / `navGroups` 与 `navigation.ts` 完全等价；侧栏 UI 渲染未变。

**Commit:** `feat(webui): rewire App.tsx to import navGroups from shared navigation.ts`

---

## Phase 2: Handbook §1.5 新增 + 顶部目录补链

### Task 2.1: 在 §1 末尾新增 `### 1.5 WebUI 入口速查（5+1 侧栏地图）`

**Files:**

- Modify: `docs/SYSTEM_HANDBOOK.md` §1 末尾

**Step:**

1. **确定 §1 最后一个 H3 子节编号**：用 `grep -n "^### 1\." docs/SYSTEM_HANDBOOK.md` 找到 §1 现有 H3 子节的最大编号。本 plan 假设最后一个子节是 `### 1.5`（line 128 附近），新章节编号为 **`### 1.5`**。若实际最大编号是其他值（例如 `### 1.4`），请相应替换为 `### 1.5`，并在 commit message 与 Phase 3 测试中保持一致。**禁止**使用占位编号 `§1.5`。
2. 在 `### 1.5`（或最后一个 H3）后的空行后插入以下 markdown（**严格保留中文标点与路径 inline code**）：
   ```md
   ### 1.5 WebUI 入口速查（5+1 侧栏地图）

   本节是侧栏可见入口的镜像视图。
   事实源唯一为 `webui/src/app/App.tsx` `navGroups` + `topLevelEntry`（v0.2 起由 `webui/src/app/navigation.ts` 导出）。
   `webui/docs/06-navigation-ia.md` §3 当前为待同步 IA 文档（含旧路径），不与代码并列称为权威源。
   架构调整时，请先改 `webui/src/app/navigation.ts`，再同步 §1.5 表格，最后开 follow-up 工单修 06 spec §3 / §4。

   | 分组 | 二级菜单 | 路径 | 一句话用途 |
   | --- | --- | --- | --- |
   | 系统概览 | 系统概览 | `/overview` | 聚合 Lucy MCP、KTX Runtime、语义资产与 Agent 接入的当前健康状态 |
   | 数据接入 | 连接概览 | `/connections` | 查看每个连接的 Schema、YAML 资产与本地目录刷新状态 |
   | 数据接入 | 启用表范围 | `/connections/enabled-tables` | 维护进入语义层的表范围，保存后写入 `ktx.yaml` 的 `enabled_tables` 字段 |
   | 语义建模 | 语义资产 | `/catalog` | 维护当前 KTX 项目的结构化 semantic-layer YAML 模型，按搜索 / 连接 / Schema / 语义状态定位对象 |
   | 语义建模 | 业务 Wiki | `/wiki` | 管理业务口径、指标说明和分析 Playbook 的 Markdown 文档 |
   | 语义发布 | 发布工作台 | `/publish/workbench` | 查看并发布当前待生效的语义资产；发布后自动重建 KTX 索引 |
   | 语义发布 | 发布记录 | `/publish/history` | 查看历史发布批次、Reindex 执行结果及当前版本快照 |
   | 质量评测 | 评测用例 | `/eval/cases` | 管理各 domain 的 `Eval` case 定义（YAML 源文件） |
   | 质量评测 | 运行历史 | `/eval/runs` | 查看评测运行历史与单次运行的详情 |
   | 质量评测 | 趋势监控 | `/eval/monitor` | 查看 `Eval` 质量趋势、失败集中度与 drift 分布 |
   | 访问治理 | `Agent` 实例 | `/admin/agents` | 配置每个 `Agent` 实例能用哪些 `MCP` 工具和访问哪些表 |
   | 访问治理 | 角色权限 | `/admin/roles` | 管理 `access.yaml` 中的 `Role` 模板：新建 / 编辑 / 删除 / 复制 |
   | 访问治理 | 访问日志 | `/admin/audit` | 查看 `MCP` Proxy 记录的工具调用，可按用户 / 工具 / 状态过滤 |
   | 访问治理 | 配置审计 | `/admin/config-audit` | 查看访问配置写入历史，当前 actor 为单管理员本机语义 |

   > 事实源唯一为 `webui/src/app/App.tsx` `navGroups` + `topLevelEntry`（`webui/src/app/navigation.ts` 导出）；`webui/docs/06-navigation-ia.md` §3 当前为待同步 IA 文档。
   ```
3. **不要**修改 §0 / §3 / §6 任何内容、顺序、锚点。
4. **不要**新增 H4 子节；表格是 §1.5 唯一子结构。

**Expected:** `docs/SYSTEM_HANDBOOK.md` §1 末尾出现 `### 1.5 WebUI 入口速查（5+1 侧栏地图）`；表格 4 列 14 行（顶部 1 + 5 组 13 项）；引用段含 `navigation.ts` / `App.tsx` inline code。

**Commit:** `docs(spec): add Handbook §1.5 WebUI Entry Map (5+1 sidebar)`

---

### Task 2.2: 顶部目录 line 10–25 补一行 §1.5 锚点

**Files:**

- Modify: `docs/SYSTEM_HANDBOOK.md` 顶部目录 line 10–25

**Step:**

1. 打开 `docs/SYSTEM_HANDBOOK.md` line 10–25，找到 `- [1. 系统概述与架构拓扑](#1-系统概述与架构拓扑)` 这一行。
2. 在该行**下方**新增一行：
   ```md
     - [1.5 WebUI 入口速查（5+1 侧栏地图）](#15-webui-入口速查5+1-侧栏地图)
   ```
   注意 2 空格缩进（与现有 `- [1.1 ...]` 缩进一致）。
3. **不要**修改其他目录行；**不要**重排已有顺序。

**Expected:** handbook 顶部目录新增一行 §1.5 锚点；其余行不变。

**Commit:** `docs(spec): add Handbook §1.5 anchor to top-of-doc TOC`

---

## Phase 3: 后端 SECTION_ALIASES 锚定 + 测试覆盖

### Task 3.1: 在 `webui/server/help.ts` `SECTION_ALIASES` 追加 `webui-entry-map`

**Files:**

- Modify: `webui/server/help.ts` line 12–54（`SECTION_ALIASES`）

**Step:**

1. 在 `SECTION_ALIASES` 数组**末尾**追加一条：
   ```ts
   [/WebUI 入口速查/, "webui-entry-map"],
   ```
2. 保持 `SECTION_ALIASES` 类型 `Array<[RegExp, string]>` 不变；保持其他已有 alias 条目不变。
3. **不要**修改 `parseHelpToc` / `sectionIdFor` / `stableSlug` / `readHelpHandbook` / `resolveHelpAppRoot` / `dedupeId` / `handbookPathForTests` 任何函数。

**Expected:** `parseHelpToc` 处理 `### 1.5 WebUI 入口速查（5+1 侧栏地图）` 时，`sectionIdFor("1.5 WebUI 入口速查（5+1 侧栏地图）")` 经过 `cleanTitle` 去前导编号 → 匹配 `[/WebUI 入口速查/, "webui-entry-map"]` → 返回 id `"webui-entry-map"`；TOC 与深链 `/help?section=webui-entry-map` 一致。

**Commit:** `feat(webui): add webui-entry-map alias to SECTION_ALIASES`

---

### Task 3.2: 新增 `webui/src/__tests__/navigation.test.ts`

**Files:**

- Create: `webui/src/__tests__/navigation.test.ts`

**Step:**

1. 新建文件，import `webui/src/app/navigation.ts` 的 `topLevelEntry` / `navGroups` / `NavItem`。
2. 编写以下断言（**通过 import 共享常量比较，不硬编码期望值**）：
   - `topLevelEntry.label === "系统概览"`
   - `topLevelEntry.to === "/overview"`
   - `topLevelEntry.active("/overview") === true` 且 `topLevelEntry.active("/catalog") === false`
   - `navGroups.length === 5`
   - 5 个分组 `title` 依次等于 `["数据接入", "语义建模", "语义发布", "质量评测", "访问治理"]`
   - `navGroups[*].items[*]` 总数为 13
   - 抽平后的 `[{ group, label, to }]` 数组**逐项**对应 §1.5 表格第 2–14 行的 13 项二级菜单（含分组名 / label / to 三元组）
   - 抽平后数组**长度等于 14**（顶部 1 + 13 项二级菜单）
   - `topLevelEntry` / `navGroups` 在测试运行时**仍可被 App.tsx 使用同一引用**（用 `Object.is` 或 import 同一模块）
3. **不要**依赖任何 DOM / React；纯常量断言。

**Expected:** `npx vitest run src/__tests__/navigation.test.ts` 通过；用 import 共享常量比较，navGroups / topLevelEntry 漂移会被立即捕获。

**Commit:** `test(webui): add navigation.test.ts for shared nav config`

---

### Task 3.3: 扩展 `webui/src/__tests__/help-center.test.tsx` 覆盖 §1.5

**Files:**

- Modify: `webui/src/__tests__/help-center.test.tsx`

**Step:**

1. 新增以下断言：
   - 在 `/help` 渲染后，`screen.getByRole('heading', { name: /WebUI 入口速查（5\+1 侧栏地图）/ })` 存在。
   - 表格列数为 4：分组 / 二级菜单 / 路径 / 一句话用途（用 GFM 渲染后是 `<table>`，列数 = 首个 `<thead>` 下的 `<th>` 节点数）。
   - 表格行数（`<tbody>` 下的 `<tr>` 数）等于 14（顶部 1 + 5 组 13 项）。
   - 表格内出现 14 个 unique `<code>` 节点对应 14 条路径（`/overview` / `/connections` / `/connections/enabled-tables` / `/catalog` / `/wiki` / `/publish/workbench` / `/publish/history` / `/eval/cases` / `/eval/runs` / `/eval/monitor` / `/admin/agents` / `/admin/roles` / `/admin/audit` / `/admin/config-audit`）。
   - 分组标题与 `webui/src/app/navigation.ts` `navGroups[*].title` 逐字一致（**通过 import 共享常量**，不硬编码期望值数组）。
   - 引用段落（`>` blockquote 内）含 `webui/src/app/App.tsx` 与 `webui/src/app/navigation.ts` 两个 inline code 锚点。
   - **不**出现 forbidden 术语（沿用 spec 30 §6.1 列表：`财政部舱单` / `舱单` / `替代测试` / `上传报价包` / `添加架构` / `目标架构` / `模式清单` / `重新加载资产`）。
2. **不要**修改现有断言；**不要**新增依赖。
3. 跑 `npx vitest run src/__tests__/help-center.test.tsx` 验证通过。

**Expected:** `npx vitest run src/__tests__/help-center.test.tsx` 通过；§1.5 H3 / 14 行 / 路径 inline code / forbidden 缺席全部覆盖。

**Commit:** `test(webui): extend help-center.test.tsx to cover §1.5`

---

### Task 3.4: 扩展 `webui/server/__tests__/help.test.ts` 覆盖 `webui-entry-map` alias

**Files:**

- Modify: `webui/server/__tests__/help.test.ts`

**Step:**

1. 新增断言：`parseHelpToc(markdownWithSection16)` 输出包含 `id === "webui-entry-map"`、`level === 3`、`title` 含 `WebUI 入口速查（5+1 侧栏地图）`。
2. 构造最小 handbook fixture：包含至少一个 `### 1.5 …` 与新 `### 1.5 WebUI 入口速查（5+1 侧栏地图）` 行；调用 `parseHelpToc`；断言返回数组中能找到对应条目。
3. **不要**修改现有断言；**不要**新增依赖。
4. 跑 `npx vitest run server/__tests__/help.test.ts` 验证通过。

**Expected:** `npx vitest run server/__tests__/help.test.ts` 通过；§1.5 通过 `SECTION_ALIASES` 锚定为 `webui-entry-map`；现有 §0 / §3 / §6 锚点集不变（diff 集合比对）。

**Commit:** `test(webui): extend help.test.ts to cover webui-entry-map alias`

---

## Phase 4: 翻译防御 + Forbidden 自检

### Task 4.1: §1.5 关键术语 inline code 化 grep 自检

**Files:**

- Read: `docs/SYSTEM_HANDBOOK.md` §1.5

**Step:**

1. 跑以下命令（不依赖 lint，跨 `.md` 范围手工 grep）：
   ```bash
   cd /Users/zhangxingchen/Projects/project-lucy
   grep -nE "(?<!\`)Agent(?!\`)" docs/SYSTEM_HANDBOOK.md | awk -F: '$2 >= 1300' || true
   grep -nE "(?<!\`)MCP(?!\`)" docs/SYSTEM_HANDBOOK.md | awk -F: '$2 >= 1300' || true
   grep -nE "(?<!\`)YAML(?!\`)" docs/SYSTEM_HANDBOOK.md | awk -F: '$2 >= 1300' || true
   grep -nE "(?<!\`)Role(?!\`)" docs/SYSTEM_HANDBOOK.md | awk -F: '$2 >= 1300' || true
   grep -nE "(?<!\`)Schema(?!\`)" docs/SYSTEM_HANDBOOK.md | awk -F: '$2 >= 1300' || true
   grep -nE "(?<!\`)Manifest(?!\`)" docs/SYSTEM_HANDBOOK.md | awk -F: '$2 >= 1300' || true
   grep -nE "(?<!\`)KTX(?!\`)" docs/SYSTEM_HANDBOOK.md | awk -F: '$2 >= 1300' || true
   grep -nE "(?<!\`)Token(?!\`)" docs/SYSTEM_HANDBOOK.md | awk -F: '$2 >= 1300' || true
   grep -nE "(?<!\`)Runtime(?!\`)" docs/SYSTEM_HANDBOOK.md | awk -F: '$2 >= 1300' || true
   grep -nE "(?<!\`)Endpoint(?!\`)" docs/SYSTEM_HANDBOOK.md | awk -F: '$2 >= 1300' || true
   grep -nE "(?<!\`)Eval Run(?!\`)" docs/SYSTEM_HANDBOOK.md | awk -F: '$2 >= 1300' || true
   ```
2. 若任一术语在 §1.5（line ≥ 1300 近似判断）出现且**未被 `` ` `` `` ` `` 包裹**，立即补 inline code。
3. **不要**修改 §1.5 之外的章节。

**Expected:** §1.5 内所有 `Agent` / `MCP` / `YAML` / `Role` / `Schema` / `Manifest` / `KTX` / `Token` / `Runtime` / `Endpoint` / `Eval Run` 等术语 100% 在 `<code>` 节点内。

**Commit:** `docs(spec): enforce inline-code for §1.5 key terms`

---

### Task 4.2: Forbidden 术语回流 grep 自检

**Files:**

- Read: `docs/SYSTEM_HANDBOOK.md` §1.5

**Step:**

1. 跑以下命令：
   ```bash
   cd /Users/zhangxingchen/Projects/project-lucy
   grep -nE "财政部舱单|舱单|替代测试|上传报价包|添加架构|目标架构|模式清单|重新加载资产" docs/SYSTEM_HANDBOOK.md | awk -F: '$2 >= 1300' || true
   ```
2. 若 §1.5 出现任一 forbidden 术语，立即替换为合规措辞。
3. **不要**修改 §1.5 之外的章节。

**Expected:** §1.5 不出现 forbidden 术语。

**Commit:** `docs(spec): §1.5 forbidden-terms self-check pass`

---

## Phase 5: 最终验收

### Task 5.1: Focused vitest 三件套 + build

**Files:**

- Run: focused vitest + build

**Step:**

1. 跑测试（**跳过 pretest lint**）：
   ```bash
   cd /Users/zhangxingchen/Projects/project-lucy/webui
   npx vitest run src/__tests__/navigation.test.ts
   npx vitest run src/__tests__/help-center.test.tsx
   npx vitest run server/__tests__/help.test.ts
   ```
2. 跑 build：
   ```bash
   cd /Users/zhangxingchen/Projects/project-lucy/webui
   npm run build
   ```
3. **不要**跑 `npm test` / `npm run lint`（pretest 会因工作区脏改动阻塞）。
4. **不要**做任何浏览器验证（用户明确约束：只做 code review）。

**Expected:** 三个 vitest 全部通过；`npm run build` 退出码 0。

**Commit:** `chore(webui): M59 focused vitest + build green`

---

### Task 5.2: spec 60 v0.2 硬验收项二次确认

**Files:**

- Read: `docs/SYSTEM_HANDBOOK.md` §0 / §6 / 顶部目录

**Step:**

1. 跑以下命令确认 §0 13 条 Q&A 仍在（spec 60 v0.2 §10 硬验收项）：
   ```bash
   cd /Users/zhangxingchen/Projects/project-lucy
   awk '/^## 0\. /,/^## 1\. /' docs/SYSTEM_HANDBOOK.md | grep -c "^### 0\.[123] "
   ```
   期望输出：3（§0.1 / §0.2 / §0.3 三个 H3 子节）。
2. 跑以下命令确认 §6 line 1585–1742 内容未动：
   ```bash
   cd /Users/zhangxingchen/Projects/project-lucy
   sed -n '1585,1742p' docs/SYSTEM_HANDBOOK.md > /tmp/m59-section6-snapshot.txt
   git -C /Users/zhangxingchen/Projects/project-lucy diff --stat HEAD -- docs/SYSTEM_HANDBOOK.md | grep -E "1585|1742" || echo "§6 line range untouched (by region)"
   ```
   注意：本机工作区有 90+ 脏改动，`git diff` 输出可能不纯净；以"§6 line 1585–1742 文件区域未被本 plan 的 commit 修改"为标准（即本 plan 只新增 §1.5 + 顶部目录补链，不改 §6）。
3. 跑以下命令确认顶部目录保留 §0 条目：
   ```bash
   cd /Users/zhangxingchen/Projects/project-lucy
   sed -n '10,25p' docs/SYSTEM_HANDBOOK.md | grep -E "0\. 常见问题速查"
   ```
   期望：包含 `[0. 常见问题速查]` 行。

**Expected:** §0 三个 H3 子节仍在；§6 line 1585–1742 未被本 plan 改动；顶部目录保留 §0 条目 + 新增 §1.5 锚点。

**Commit:** `chore(spec): M59 spec-60-hard-checks pass`

---

## Final Verification Checklist

执行人需在每条完成后勾选；reviewer 在合并前再次对照。

- [ ] **F1** `webui/src/app/navigation.ts` 新增，导出 `NavItem` / `topLevelEntry` / `navGroups`，内容与原 `App.tsx` line 33–146 逐字一致。
- [ ] **F2** `webui/src/app/App.tsx` 删除内联常量，改为 `import { topLevelEntry, navGroups, type NavItem } from "./navigation";`，侧栏 UI 渲染未变。
- [ ] **F3** `docs/SYSTEM_HANDBOOK.md` §1 末尾新增 `### 1.5 WebUI 入口速查（5+1 侧栏地图）` H3 子节。
- [ ] **F4** §1.5 表格 4 列 14 行，分组标题与 `navGroups[*].title` 逐字一致，路径列与 `navGroups[*].items[*].to` 当前值一致。
- [ ] **F5** §1.5 引言段明确"事实源唯一为 navGroups + topLevelEntry（navigation.ts 导出）；06 spec §3 当前为待同步 IA 文档"。
- [ ] **F6** §1.5 引用 blockquote 含 `webui/src/app/App.tsx` 与 `webui/src/app/navigation.ts` 两个 inline code 锚点。
- [ ] **F7** handbook 顶部目录 line 10–25 补一行 §1.5 锚点。
- [ ] **F8** `webui/server/help.ts` `SECTION_ALIASES` 末尾追加 `[/WebUI 入口速查/, "webui-entry-map"]` 一条；其他已有 alias 条目不变。
- [ ] **F9** `webui/src/__tests__/navigation.test.ts` 新增；用 import 共享常量比较，覆盖 14 个侧栏可见入口与 5+1 分组结构。
- [ ] **F10** `webui/src/__tests__/help-center.test.tsx` 扩展；覆盖 §1.5 H3 / 14 行 / 路径 inline code / forbidden 缺席。
- [ ] **F11** `webui/server/__tests__/help.test.ts` 扩展；覆盖 `webui-entry-map` alias 解析。
- [ ] **F12** §1.5 内 `Agent` / `MCP` / `YAML` / `Role` / `Schema` / `Manifest` / `KTX` / `Token` / `Runtime` / `Endpoint` / `Eval Run` 等术语 100% 在 inline code 内。
- [ ] **F13** §1.5 不出现 forbidden 术语（spec 30 §6.1 列表）。
- [ ] **F14** `npx vitest run src/__tests__/navigation.test.ts` 通过。
- [ ] **F15** `npx vitest run src/__tests__/help-center.test.tsx` 通过。
- [ ] **F16** `npx vitest run server/__tests__/help.test.ts` 通过。
- [ ] **F17** `npm run build` 退出码 0。
- [ ] **F18** spec 60 v0.2 硬验收项继续生效（§0 三个 H3 子节 / §6 line 1585–1742 未改 / 顶部目录保留 §0 条目）。
- [ ] **F19** `webui/docs/06-navigation-ia.md` §3 / §4 与代码事实源不一致是已知遗留；本 plan **不**改 06 spec，由独立 follow-up 工单承接。
- [ ] **F20** 未跑浏览器验证（用户明确约束）；视觉验收由 reviewer 在合并前补做。

---

## Reviewer Checklist

reviewer 在合并前必须逐条对照；任一项未通过即打回。

- [ ] **R1** §1.5 章节编号是 `### 1.5`（**实编号**，非占位）；若 §1 实际最大 H3 不是 `1.4`，需先确认新章节编号并同步本 plan / commit / 测试。
- [ ] **R2** `navigation.ts` 与 `App.tsx` 内容**逐字一致**；用 `git diff` 确认删除的内联常量文本等于 navigation.ts 导出文本。
- [ ] **R3** §1.5 表格行**逐项**与 `navigation.ts` 对照：分组 / 二级菜单 / 路径 三列与 `navGroups[*].title` / `topLevelEntry.label` / `navGroups[*].items[*].label` / `.to` 100% 一致。
- [ ] **R4** §1.5 不使用 06 spec 已废弃的旧路径（`/onboarding` / `/connections/whitelist` / `表目录` / `连通测试（兼容）`）。
- [ ] **R5** `SECTION_ALIASES` 只新增一条 `[/WebUI 入口速查/, "webui-entry-map"]`；其他已有 alias 条目**未动**。
- [ ] **R6** `navigation.test.ts` 用 import 共享常量比较，**不硬编码**期望值数组。
- [ ] **R7** `help-center.test.tsx` 用 navigation.ts import 共享常量比较分组标题，**不硬编码**期望值数组。
- [ ] **R8** `help.test.ts` 验证 `parseHelpToc` 输出 `id === "webui-entry-map"`；同时验证现有 §0 / §3 / §6 锚点集未变（diff 集合比对）。
- [ ] **R9** §1.5 翻译防御：所有 `Agent` / `MCP` / `YAML` / `Role` / `Schema` / `Manifest` / `KTX` / `Token` / `Runtime` / `Endpoint` / `Eval Run` 等术语 inline code 化（Phase 4 Step 4.1 grep 自检）。
- [ ] **R10** §1.5 不出现 forbidden 术语（Phase 4 Step 4.2 grep 自检）。
- [ ] **R11** spec 60 v0.2 硬验收项二次确认（§0 三个 H3 子节 / §6 line 1585–1742 未改 / 顶部目录保留 §0 条目）。
- [ ] **R12** 未做浏览器视觉验证；reviewer 在合并前需补浏览器对照（spec 30 §6 + spec 33 §5）。
- [ ] **R13** commit message 规范：`feat(webui):` / `docs(spec):` / `test(webui):` / `chore(webui):` / `chore(spec):` 前缀；与本 plan 各 Task Commit 一致。
- [ ] **R14** 06 spec 同步是独立 follow-up 工单；本 plan 不背这个债（DoD 已显式说明）。
- [ ] **R15** reviewer 报告结尾必须含 `git status --porcelain` 输出（用户工作流硬约束）。