# M34 Sidebar Navigation IA Consolidation Work Order

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Consolidate Lucy WebUI's left sidebar from 7 first-level groups to 5 lifecycle-aligned groups plus a top-level Dashboard entry, and harmonize the 6 second-level item names whose current wording is too technical / security-flavored for a B-end data-semantics product.

> **v0.2 (2026-08-01)**: Data Heatmap 已下沉为 `/admin/audit?tab=heatmap` 内的 Tab，由 `wo-M35-data-heatmap-tab-subsumption` 跟踪实施。访问治理分组从 5 项收敛为 4 项（移除"数据热力"主导航项），原独立路由 `/admin/audit-sources` 保留为兼容重定向。

**Architecture:** Frontend-only change. The `navGroups` array and each page's `<PageHeader breadcrumbs={...} />` are updated to reflect the new IA. All existing routes remain reachable, including the previously first-class `/connections/test` which becomes a compatibility entry. No backend API change, no new dependency, no new CSS class.

**Tech Stack:** React, TypeScript, React Router, TanStack Query, existing PageHeader component, Vitest, Testing Library, existing `app.css`.

**Source Spec:** [../37-sidebar-navigation-ia-consolidation-spec.md](../37-sidebar-navigation-ia-consolidation-spec.md)

---

## Context For Developer

Read these documents before editing:

- `AGENTS.md`
- `docs/DEVELOPMENT.md`
- `webui/docs/00-product-terminology-standard.md`
- `webui/docs/06-navigation-ia.md`
- `webui/docs/37-sidebar-navigation-ia-consolidation-spec.md`

Inspect these implementation files:

- `webui/src/app/App.tsx` (navGroups, Routes, AppFrame)
- `webui/src/app/app.css` (`.pl-nav-section`, `.pl-nav-link`, `.pl-sidebar`)
- `webui/src/components/PageHeader.tsx` (breadcrumbs contract)
- `webui/src/pages/Onboarding.tsx`
- `webui/src/pages/Catalog.tsx`
- `webui/src/pages/WikiEditor.tsx`
- `webui/src/pages/connections/ConnectionOverview.tsx`
- `webui/src/pages/connections/TableWhitelist.tsx`
- `webui/src/pages/connections/ConnectionTest.tsx`
- `webui/src/pages/publish/PublishWorkbench.tsx`
- `webui/src/pages/publish/PublishHistory.tsx`
- `webui/src/pages/eval/CaseList.tsx`
- `webui/src/pages/eval/CaseEditor.tsx`
- `webui/src/pages/eval/RunList.tsx`
- `webui/src/pages/eval/RunDetail.tsx`
- `webui/src/pages/eval/Monitor.tsx`
- `webui/src/pages/admin/AgentList.tsx`
- `webui/src/pages/admin/AgentDetail.tsx`
- `webui/src/pages/admin/RoleList.tsx`
- `webui/src/pages/admin/RoleDetail.tsx`
- `webui/src/pages/admin/Audit.tsx`
- `webui/src/pages/admin/AuditSources.tsx`
- `webui/src/pages/admin/ConfigAudit.tsx`
- `webui/docs/user-guide.html`

Inspect these tests (update assertions for new IA, not new behavior):

- `webui/src/__tests__/app-shell.test.tsx`
- `webui/src/__tests__/connection-overview.test.tsx`
- `webui/src/__tests__/table-whitelist.test.tsx`
- `webui/src/__tests__/connection-test.test.tsx`
- `webui/src/__tests__/wiki.test.tsx`
- `webui/src/__tests__/eval-cases.test.tsx`
- `webui/src/__tests__/admin-agents.test.tsx`
- `webui/src/__tests__/admin-roles.test.tsx`
- `webui/src/__tests__/admin-audit.test.tsx`
- `webui/src/__tests__/admin-audit-sources.test.tsx`
- `webui/src/__tests__/admin-config-audit.test.tsx`

Non-negotiable boundaries:

- Do not remove any route. All existing paths remain reachable.
- Do not modify any `<Route element={...} />` element component.
- Do not change any API path, status code, or payload.
- Do not introduce a new CSS class. Reuse existing `.pl-nav-section`, `.pl-nav-section-title`, `.pl-nav-link`, `.pl-brand-block`, `.pl-sidebar`.
- Do not translate `Schema` as `架构` or `模式`.
- Do not translate `Manifest` as `舱单` or `清单`.
- Do not introduce a new runtime dependency.
- Do not modify `access.yaml`, `ktx.yaml`, MCP proxy code, or `data-qa-instructions.md`.
- Treat existing dirty worktree changes as user-owned unless directly part of this work order.

---

## Codex Direct Prompt

你在 `/Users/zhangxingchen/Projects/project-lucy` 工作。请按本工单实现 `webui/docs/37-sidebar-navigation-ia-consolidation-spec.md`。

交付：

1. 侧边栏收敛为 5+1：`系统概览（置顶独立项） / 数据接入 / 语义建模 / 语义发布 / 质量评测 / 访问治理`。
2. 删除 `运行状态` 分组标题；`系统概览` 提升为置顶 Section。
3. 6 个二级项文案精细化：`表白名单 → 启用表范围`、`Wiki 文档 → 业务 Wiki`、`Case 管理 → 评测用例`、`角色配置 → 角色权限`、`数据源热力 → 数据热力`、`配置变更（标题层） → 配置审计`。
4. `连通测试` 降级为 `连通测试（兼容）`，仍保留路由与页面。
5. 全部 PageHeader `breadcrumbs` 同步更新为新一级标题。
6. `00-product-terminology-standard.md` 同步登记 6 个新术语。
7. `app-shell.test.tsx` 与各页面测试增加侧边栏 / 面包屑断言。
8. `06-navigation-ia.md` "全局导航结构"小节与新 IA 对齐。

收尾说明必须列出修改文件、验证命令与结果。

---

## Task 1: Sidebar Restructure — 7 Groups To 5+1

**Files:**

- Modify: `webui/src/app/App.tsx`
- Possibly modify: `webui/src/app/app.css` (only if existing classes cannot express the top-level separator)
- Test: `webui/src/__tests__/app-shell.test.tsx`

**Step 1: Write failing tests for the new sidebar shape**

In `app-shell.test.tsx`, assert:

```ts
// 5 first-level groups present
const groups = ["数据接入", "语义建模", "语义发布", "质量评测", "访问治理"];
for (const g of groups) {
  expect(screen.getByRole("heading", { name: g })).toBeInTheDocument();
}

// System Overview is a top-level standalone link, not nested under a group
const overviewLink = screen.getByRole("link", { name: "系统概览" });
expect(overviewLink).toBeInTheDocument();
expect(overviewLink.closest(".pl-nav-section")?.querySelector(".pl-nav-section-title")).toBeNull();

// Forbidden old first-level titles
for (const t of ["运行状态", "语义层维护", "业务文档", "数据库接入"]) {
  expect(screen.queryByRole("heading", { name: t })).not.toBeInTheDocument();
}

// Renamed second-level items
for (const t of ["启用表范围", "业务 Wiki", "评测用例", "角色权限", "数据热力", "配置审计"]) {
  expect(screen.getByRole("link", { name: t })).toBeInTheDocument();
}

// Compat entry
expect(screen.getByRole("link", { name: /连通测试/ })).toBeInTheDocument();
expect(screen.getByRole("link", { name: /连通测试/ })).toHaveTextContent("兼容");

// Forbidden old second-level titles
for (const t of ["表白名单", "Wiki 文档", "Case 管理", "角色配置", "数据源热力"]) {
  expect(screen.queryByRole("link", { name: new RegExp(`^${t}$`) })).not.toBeInTheDocument();
}
```

**Step 2: Run tests to verify failure**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run src/__tests__/app-shell.test.tsx
```

Expected: FAIL.

**Step 3: Replace `navGroups` in `App.tsx`**

```ts
type NavItem = { label: string; to: string; active: (pathname: string) => boolean; compatibility?: boolean };

// 系统概览 as top-level standalone entry; rendered separately from navGroups.
const topLevelEntry: NavItem = {
  label: "系统概览",
  to: "/onboarding",
  active: (path) => path === "/onboarding"
};

const navGroups: Array<{ title: string; items: NavItem[] }> = [
  {
    title: "数据接入",
    items: [
      { label: "连接概览", to: "/connections", active: (path) => path === "/connections" },
      { label: "启用表范围", to: "/connections/whitelist", active: (path) => path === "/connections/whitelist" },
      {
        label: "连通测试（兼容）",
        to: "/connections/test",
        active: (path) => path === "/connections/test",
        compatibility: true
      }
    ]
  },
  {
    title: "语义建模",
    items: [
      {
        label: "表目录",
        to: "/",
        active: (path) => path === "/" || path.startsWith("/sources/") || path.startsWith("/joins/")
      },
      { label: "业务 Wiki", to: "/wiki", active: (path) => path.startsWith("/wiki") }
    ]
  },
  {
    title: "语义发布",
    items: [
      { label: "发布工作台", to: "/publish/workbench", active: (path) => path.startsWith("/publish/workbench") },
      { label: "发布记录", to: "/publish/history", active: (path) => path.startsWith("/publish/history") }
    ]
  },
  {
    title: "质量评测",
    items: [
      { label: "评测用例", to: "/eval/cases", active: (path) => path.startsWith("/eval/cases") },
      { label: "运行历史", to: "/eval/runs", active: (path) => path.startsWith("/eval/runs") },
      { label: "趋势监控", to: "/eval/monitor", active: (path) => path === "/eval/monitor" }
    ]
  },
  {
    title: "访问治理",
    items: [
      { label: "Agent 实例", to: "/admin/agents", active: (path) => path.startsWith("/admin/agents") },
      { label: "角色权限", to: "/admin/roles", active: (path) => path.startsWith("/admin/roles") },
      { label: "访问日志", to: "/admin/audit", active: (path) => path === "/admin/audit" },
      { label: "数据热力", to: "/admin/audit-sources", active: (path) => path === "/admin/audit-sources" },
      { label: "配置审计", to: "/admin/config-audit", active: (path) => path === "/admin/config-audit" }
    ]
  }
];
```

**Step 4: Render `topLevelEntry` as a separate section above `navGroups`**

In `AppFrame`, before the `navGroups.map(...)` block, render a dedicated section for the top-level entry:

```tsx
<nav className="pl-nav" aria-label="主导航">
  <section className="pl-nav-section pl-nav-section--top" key="top">
    <div className="grid gap-1">
      <Link
        aria-current={topLevelEntry.active(location.pathname) ? "page" : undefined}
        className={navLinkClass(topLevelEntry.active(location.pathname))}
        to={topLevelEntry.to}
      >
        {topLevelEntry.label}
      </Link>
    </div>
  </section>
  {navGroups.map((group) => (
    <section className="pl-nav-section" key={group.title}>
      <h2 className="pl-nav-section-title">{group.title}</h2>
      <div className="grid gap-1">
        {group.items.map((item) => {
          const active = item.active(location.pathname);
          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={
                navLinkClass(active) +
                (item.compatibility ? " pl-nav-link--compat" : "")
              }
              key={item.to}
              to={item.to}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </section>
  ))}
</nav>
```

**Step 5: Add minimal CSS for the top separator and compat label**

In `app.css`, only if not already expressed via existing utility classes:

```css
.pl-nav-section--top {
  @apply mb-3 border-b border-border-default pb-3;
}
.pl-nav-link--compat {
  @apply text-fg-muted;
}
```

If `border-border-default` or `text-fg-muted` does not exist in the current utility layer, reuse the existing border / muted color tokens already in use elsewhere in `app.css`. Do not invent new design tokens.

**Step 6: Run tests**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run src/__tests__/app-shell.test.tsx
```

Expected: PASS.

**Step 7: Register the v1.9.0 cleanup milestone for `连通测试（兼容）`**

`连通测试（兼容）` 是过渡期兼容项，必须在 v1.9.0 节点从主导航彻底下线。

约束：

1. **触发条件**：M25"连接概览-卡片内测试 Drawer"上线并通过验证。
2. **下线节点**：Lucy v1.9.0。
3. **依赖关系**：v1.9.0 的侧边栏清理工单必须将 M25 完成列为前置依赖；若 M25 未完成，v1.9.0 延期，不允许跳过 Drawer 验证而仓促下线。
4. **保留路由**：`/connections/test` 仍保留为兼容跳转页（渲染引导文案指向 `/connections`），不删除。
5. **后续审计**：每次主导航重构须 grep `连通测试` 出现位置；若仅剩路由兼容页 + PageHeader breadcrumb，即视为彻底收敛。
6. **悬挂禁止**：不允许写"v1.9+ / 后续"等软目标占位；时间节点必须硬挂在 v1.9.0。

落地动作（本 Task 范围内）：

- 在 `webui/docs/05-task-list.md` 或 `docs/DEVELOPMENT.md` 的 v1.9.0 区块中显式登记 `M34-cleanup-compat-connection-test`，描述 = `移除侧边栏 "连同测试（兼容）" 主导航项，依赖 M25 完成`。
- 提交时在 PR 描述里附这条登记项的 diff。

**Step 8: Run tests**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run src/__tests__/app-shell.test.tsx
```

Expected: PASS.

---

## Task 2: PageHeader Breadcrumbs Across All Pages

**Files:**

- Modify: each page file in §"Inspect these implementation files" of Context above
- Test: each page's existing test (or new breadcrumb assertion block in `app-shell.test.tsx`)

**Step 1: Write failing assertions for each page's breadcrumb**

In each page's test (or a consolidated `breadcrumbs.test.tsx`), assert that the rendered PageHeader's breadcrumb array equals the new strings from spec §4.5.

Example for `table-whitelist.test.tsx`:

```ts
const crumbs = await screen.findAllByRole("listitem");
// Or whichever query matches the existing PageHeader markup.
expect(crumbs.map((c) => c.textContent)).toEqual(["数据接入", "启用表范围"]);
```

Pages and their expected new breadcrumbs:

| Page | New breadcrumb |
|---|---|
| Onboarding | `["系统概览"]` |
| ConnectionOverview | `["数据接入", "连接概览"]` |
| TableWhitelist | `["数据接入", "启用表范围"]` |
| ConnectionTest | `["数据接入", "连通测试"]` (compat suffix only in sidebar) |
| Catalog | `["语义建模", "表目录"]` |
| TableEditor | `["语义建模", "<schema>", "<table>"]` |
| JoinEditor | `["语义建模", "关联关系", "<table>"]` |
| WikiEditor | `["语义建模", "业务 Wiki"]` |
| PublishWorkbench | `["语义发布", "发布工作台"]` |
| PublishHistory | `["语义发布", "发布记录"]` |
| CaseList / CaseEditor | `["质量评测", "评测用例"]` |
| RunList | `["质量评测", "运行历史"]` |
| RunDetail | `["质量评测", "运行历史", "Run #<id>"]` |
| Monitor | `["质量评测", "趋势监控"]` |
| AgentList / AgentDetail / NewToken | `["访问治理", "Agent 实例"]` |
| RoleList / RoleDetail | `["访问治理", "角色权限"]` |
| Audit | `["访问治理", "访问日志"]` |
| AuditSources | `["访问治理", "数据热力"]` |
| ConfigAudit | `["访问治理", "配置审计"]` |

**Step 2: Run tests to verify failure**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run \
  src/__tests__/app-shell.test.tsx \
  src/__tests__/connection-overview.test.tsx \
  src/__tests__/table-whitelist.test.tsx \
  src/__tests__/connection-test.test.tsx \
  src/__tests__/wiki.test.tsx \
  src/__tests__/eval-cases.test.tsx \
  src/__tests__/admin-agents.test.tsx \
  src/__tests__/admin-roles.test.tsx \
  src/__tests__/admin-audit.test.tsx \
  src/__tests__/admin-audit-sources.test.tsx \
  src/__tests__/admin-config-audit.test.tsx
```

Expected: FAIL on every page whose `breadcrumbs` was hardcoded.

**Step 3: Update `breadcrumbs={...}` in each page**

Apply the table from Step 1 to the corresponding `<PageHeader ... breadcrumbs={...} />`. Do not change the `title` here; the title is updated in later tasks.

**Step 4: Run tests**

Same command as Step 2.

Expected: PASS.

---

## Task 3: Rename Page Titles And Sidebar-Visible Copy

**Files:**

- Modify: `webui/src/pages/connections/TableWhitelist.tsx`
- Modify: `webui/src/pages/WikiEditor.tsx`
- Modify: `webui/src/pages/eval/CaseList.tsx`
- Modify: `webui/src/pages/eval/CaseEditor.tsx`
- Modify: `webui/src/pages/admin/RoleList.tsx`
- Modify: `webui/src/pages/admin/RoleDetail.tsx`
- Modify: `webui/src/pages/admin/AuditSources.tsx`
- Modify: `webui/src/pages/admin/ConfigAudit.tsx`
- Test: each affected page's test

**Step 1: Write failing tests for renamed titles**

```ts
// table-whitelist.test.tsx
expect(screen.getByRole("heading", { name: "启用表范围" })).toBeInTheDocument();
expect(screen.queryByRole("heading", { name: "表白名单" })).not.toBeInTheDocument();

// wiki.test.tsx
expect(screen.getByRole("heading", { name: "业务 Wiki" })).toBeInTheDocument();
expect(screen.queryByText("Wiki 文档")).not.toBeInTheDocument();

// eval-cases.test.tsx
expect(screen.getByRole("heading", { name: "评测用例" })).toBeInTheDocument();
expect(screen.queryByRole("heading", { name: "Case 管理" })).not.toBeInTheDocument();

// admin-roles.test.tsx
expect(screen.getByRole("heading", { name: "角色权限" })).toBeInTheDocument();
expect(screen.queryByRole("heading", { name: "角色配置" })).not.toBeInTheDocument();

// admin-audit-sources.test.tsx
expect(screen.getByRole("heading", { name: "数据热力" })).toBeInTheDocument();
expect(screen.queryByRole("heading", { name: "数据源热力" })).not.toBeInTheDocument();

// admin-config-audit.test.tsx
expect(screen.getByRole("heading", { name: "配置审计" })).toBeInTheDocument();
expect(screen.queryByRole("heading", { name: "配置变更" })).not.toBeInTheDocument();
```

**Step 2: Run tests to verify failure**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run \
  src/__tests__/table-whitelist.test.tsx \
  src/__tests__/wiki.test.tsx \
  src/__tests__/eval-cases.test.tsx \
  src/__tests__/admin-roles.test.tsx \
  src/__tests__/admin-audit-sources.test.tsx \
  src/__tests__/admin-config-audit.test.tsx
```

Expected: FAIL.

**Step 3: Update `<PageHeader title=...>` strings**

Apply this mapping only to the `PageHeader` `title` prop. Do not rewrite internal headings, button labels or detail fields unless the spec explicitly requires it.

| File | Old title | New title |
|---|---|---|
| `TableWhitelist.tsx` | `表白名单` | `启用表范围` |
| `WikiEditor.tsx` | `业务 Wiki 工作台` | `业务 Wiki` |
| `CaseList.tsx` | `Case 管理` | `评测用例` |
| `CaseEditor.tsx` | `编辑 Case` | `编辑评测用例` (or align with new domain naming) |
| `RoleList.tsx` | `角色配置` | `角色权限` |
| `RoleDetail.tsx` | `角色配置` | `角色权限` |
| `AuditSources.tsx` | `数据源热力视图` | `数据热力` |
| `ConfigAudit.tsx` | `配置变更日志` | `配置审计` |

For `CaseEditor.tsx`, if the existing title pattern is `新建 Case` / `编辑 Case`, change to `新建评测用例` / `编辑评测用例`. Do not change any other heading inside the page.

**Step 4: Add `Case` keyword lint for action buttons**

In the relevant page test, ensure no new `Case 管理` strings appear:

```ts
expect(screen.queryByText("Case 管理")).not.toBeInTheDocument();
```

This guards against regression when a button or row label is later added.

**Step 5: Run tests**

Same command as Step 2.

Expected: PASS.

---

## Task 4: Connection Test Compatibility Hint

**Files:**

- Modify: `webui/src/pages/connections/ConnectionTest.tsx`
- Possibly modify: `webui/src/pages/connections/ConnectionOverview.tsx` (test drawer hint)
- Test: `webui/src/__tests__/connection-test.test.tsx`

**Step 1: Write failing test for the hint text**

```ts
// connection-test.test.tsx
expect(
  screen.getByText(/也可以在连接概览中对单个连接执行测试/)
).toBeInTheDocument();
```

**Step 2: Run test to verify failure**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run src/__tests__/connection-test.test.tsx
```

Expected: FAIL.

**Step 3: Add the hint**

In `ConnectionTest.tsx`, near the top of the page body, add a small hint block:

```tsx
<p className="text-sm text-fg-muted">
  也可以在连接概览中对单个连接执行测试。
</p>
```

Do not add a primary CTA. The Compatibility entry in the sidebar already points users to `/connections/test`; this is a soft hint for users who landed here directly.

**Step 4: Run test**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run src/__tests__/connection-test.test.tsx
```

Expected: PASS.

---

## Task 5: Guard Against Stale Hardcoded Group Names

**Files:**

- Possibly modify: any source file containing a hardcoded group name (only the user-visible text cases, not internal code identifiers)
- Test: `webui/src/__tests__/app-shell.test.tsx`
- Test: `webui/src/__tests__/terminology-lint.test.ts` (new test file, optional but recommended)

**Step 1: Add forbidden-term assertions**

```ts
const sidebarForbiddenTerms = [
  "运行状态",
  "语义层维护",
  "业务文档",
  "数据库接入",
  "表白名单",
  "Wiki 文档",
  "Case 管理",
  "角色配置",
  "数据源热力"
];
```

In `app-shell.test.tsx` (or a new `terminology-lint.test.ts`), assert these terms do not appear in the rendered sidebar / breadcrumbs / PageHeader titles for each route.

**Step 2: Add a small source scan (optional)**

If a Vitest test for static scanning is added, scope it to `webui/src/**/*.{ts,tsx}` and `webui/src/**/*.{ts,tsx}`. Forbid matches outside of:

- `webui/src/app/App.tsx` (which must keep `运行状态` ONLY in the migration comments, never in rendered output)
- `webui/src/__tests__/app-shell.test.tsx` (which must keep these strings in the `sidebarForbiddenTerms` array itself)
- `webui/docs/**` (where historical references are acceptable)

The implementation can simply read the file and assert `forbidden.every((t) => !content.includes(t))` for any non-allowlisted file.

**Step 3: Run tests**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run src/__tests__/app-shell.test.tsx
```

Expected: PASS (assuming Task 1-4 already landed). If the static scan test was added, also:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run src/__tests__/terminology-lint.test.ts
```

---

## Task 6: Terminology Standard Sync

**Files:**

- Modify: `webui/docs/00-product-terminology-standard.md`
- Possibly modify: `webui/docs/06-navigation-ia.md`

**Step 1: Update §3 Global Fixed Terms table**

In `00-product-terminology-standard.md` §3, make these edits:

- `Whitelist` row: change `UI 主术语` from `表白名单` to `启用表范围`, and add `表白名单（兼容）` to `允许补充说法`.
- Add new rows:
  - `Enabled Tables | 启用表范围 | 启用的表 | 表白名单（主导航禁用）、白表、表白 | 控制进入语义层的表范围`
  - `Evaluation Case | 评测用例 | 评测集 | Case 管理、案例管理 | 数据问答 / 语义质量评测的单条样例`
  - `Role Permission | 角色权限 | Role、RBAC 角色 | 角色配置、角色模板 | access.yaml 中的 role 模板`
  - `Data Heatmap | 数据热力 | 表级访问热力 | 数据源热力、源热力 | 从访问审计派生的表级访问与拒绝分布`
  - `Config Audit | 配置审计 | 配置变更审计 | 配置变更（仅限主导航/PageHeader 标题） | 访问配置写入的审计记录`
  - `Semantic Modeling | 语义建模 | 语义模型 | 语义层维护 + 业务文档作为两个分组 | 涵盖结构化语义（YAML Overlay）与非结构化业务文档（Markdown Wiki）`

**Step 2: Update §4.1 数据库接入**

- `Table Whitelist` row: change `UI 主术语` to `启用表范围`, add `表白名单（仅兼容期）` to `禁止文案`.

**Step 3: Update §4.2 语义层维护 → rename section to "§4.2 语义建模"**

- Rename the section header.
- In the renamed section, add a new `Business Wiki` row with `UI 主术语` = `业务 Wiki` and `禁止文案` = `Wiki 文档（仅兼容期）`.

**Step 4: Update §4.4 质量评测**

- `Evaluation Case` row: change `UI 主术语` to `评测用例 / 评测集`, `禁止文案` add `Case 管理、案例管理`.

**Step 5: Update §4.5 系统与运维**

- Add a `Sidebar Group` row documenting the 5+1 structure and the main terms used in each.

**Step 6: Update `06-navigation-ia.md` "全局导航结构"小节**

Replace the existing structure (7 groups) with the new 5+1 structure, mirroring spec §4.1.

**Step 7: Verify terminology standard renders**

```bash
cd /Users/zhangxingchen/Projects/project-lucy
grep -n "启用表范围" webui/docs/00-product-terminology-standard.md
grep -n "评测用例" webui/docs/00-product-terminology-standard.md
grep -n "角色权限" webui/docs/00-product-terminology-standard.md
grep -n "数据热力" webui/docs/00-product-terminology-standard.md
grep -n "配置审计" webui/docs/00-product-terminology-standard.md
grep -n "语义建模" webui/docs/00-product-terminology-standard.md
```

Expected: each term appears at least once in the file (registration is complete).

**Step 8: Lock 00 修订到本 PR**

`00-product-terminology-standard.md` 的修改必须与代码、导航、UI 标题刷新合并到 **同一个 Commit / PR**。禁止拆成两个 PR（先代码后文档，或反过来），否则 `00` 事实源与代码不同步，会让读取 `00` 的 Agent / 开发者出现断层。

具体做法：

- Task 6 的 `00` 修订与 Task 1-5 的代码改动在最终 commit 时一起 `git add`。
- PR 描述必须列出 6 个新术语的注册位置（§3 行号）与 4 个老术语的更新位置（§4.1 / §4.2 / §4.4 / §4.5）。
- Code review 阶段，reviewer 必须先确认 `00` 修订到位，再放行代码合并。

---

## Task 7: User Guide Sync

**Files:**

- Modify: `webui/docs/user-guide.html`

**Step 1: Identify the affected blocks**

Open `user-guide.html` and find:

- The left-side table of contents / sidebar screenshot.
- Any inline screenshot showing the 7-group sidebar.
- Any breadcrumb string in code samples (e.g. "数据库接入 / 表白名单").

**Step 2: Replace affected strings**

Apply the same mapping as Tasks 1-3 to user-facing content only. Do not change technical samples (URL paths, API endpoints, file paths).

**Step 3: Verify with grep**

```bash
cd /Users/zhangxingchen/Projects/project-lucy
grep -nE "运行状态|语义层维护|业务文档|数据库接入|表白名单|Wiki 文档|Case 管理|角色配置|数据源热力" webui/docs/user-guide.html
```

Expected: no output (the user guide is fully aligned). If a historical reference inside a "version history" or "v1.7 changelog" block is intentionally retained, exclude those lines from the grep scope.

---

## Task 8: Final Regression And Commit Strategy

**Files:**

- All files touched in Tasks 1-7.

**Step 1: Run the focused test suite**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run \
  src/__tests__/app-shell.test.tsx \
  src/__tests__/connection-overview.test.tsx \
  src/__tests__/table-whitelist.test.tsx \
  src/__tests__/connection-test.test.tsx \
  src/__tests__/wiki.test.tsx \
  src/__tests__/eval-cases.test.tsx \
  src/__tests__/admin-agents.test.tsx \
  src/__tests__/admin-roles.test.tsx \
  src/__tests__/admin-audit.test.tsx \
  src/__tests__/admin-audit-sources.test.tsx \
  src/__tests__/admin-config-audit.test.tsx
```

Expected: PASS.

**Step 2: Run the full test suite**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run
```

Expected: PASS.

**Step 3: Run type check and build**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npx tsc --noEmit
npm run build
```

Expected: PASS. Vite chunk-size warnings are acceptable if unchanged and unrelated.

**Step 4: Manual QA checklist**

Open the WebUI and verify:

- The sidebar shows `系统概览` as a top-level link, no `运行状态` heading.
- The sidebar has 5 groups: `数据接入 / 语义建模 / 语义发布 / 质量评测 / 访问治理`.
- 6 renamed second-level items appear with the new wording.
- `连通测试（兼容）` is visible in `数据接入`.
- Every page's breadcrumb matches spec §4.5.
- `/connections/test` still loads and the new hint is shown.
- The user guide HTML reflects the new IA.

**Step 5: Commit**

Recommended commit shape (small commits, but `00-product-terminology-standard.md` MUST be in the last commit, NOT split into a separate later PR):

```bash
git add webui/src/app/App.tsx webui/src/app/app.css webui/src/__tests__/app-shell.test.tsx
git commit -m "refactor(webui): collapse sidebar to 5+1 IA"

git add webui/src/pages webui/src/__tests__
git commit -m "refactor(webui): align PageHeader breadcrumbs and titles with new IA"

# 00 must land in the same PR as the code; do NOT defer to a follow-up PR.
git add webui/docs/00-product-terminology-standard.md webui/docs/06-navigation-ia.md webui/docs/user-guide.html webui/docs/05-task-list.md
git commit -m "docs(lucy): register new sidebar IA terms + v1.9.0 cleanup milestone"
```

If all tasks land together:

```bash
git add webui/src webui/docs
git commit -m "refactor(webui): consolidate sidebar to 5 lifecycle groups + 1 dashboard"
```

---

## Reviewer Checklist

- [ ] Sidebar has 1 top-level entry + 5 lifecycle groups, no `运行状态` heading.
- [ ] 6 second-level items use the new wording; forbidden old wording is gone.
- [ ] `连通测试（兼容）` is rendered with a `（兼容）` suffix.
- [ ] All 16+ PageHeader `breadcrumbs` match spec §4.5.
- [ ] 9 page titles match spec §6 (Onboarding, ConnectionOverview, TableWhitelist, ConnectionTest, Catalog, WikiEditor, PublishWorkbench, PublishHistory, CaseList, RunList, Monitor, AgentList, RoleList, Audit, AuditSources, ConfigAudit).
- [ ] `/connections/test` still loads and shows the compatibility hint.
- [ ] `00-product-terminology-standard.md` registers 6 new terms and updates 4 existing rows.
- [ ] `00-product-terminology-standard.md` is committed in the **same PR** as the code changes; reviewer blocks merge if 00 is out of sync.
- [ ] `06-navigation-ia.md` reflects the 5+1 structure.
- [ ] `webui/docs/user-guide.html` is aligned.
- [ ] v1.9.0 cleanup entry for `连通测试（兼容）` is registered in `05-task-list.md` / `docs/DEVELOPMENT.md`, with M25 完成 as a hard dependency.
- [ ] No route, no API path, no API payload was modified.
- [ ] No new CSS class was invented beyond the two scoped ones (`pl-nav-section--top`, `pl-nav-link--compat`).
- [ ] `npm test`, `npx tsc --noEmit`, `npm run build` pass.
