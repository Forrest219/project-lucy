# Admin Data Grid Frame Consistency Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让 `/admin/agents`、`/admin/config-audit` 与 `/admin/audit` 复用同一套数据网格外框与密度语言，同时为配置审计和访问日志保留适合各自内容规模的列宽与滚动策略。

**Architecture:** 保留现有原生 `<table>`、`pl-data-grid` 和页面级语义类，不引入新的 React 表格组件或数据层。新增共享的 `pl-data-grid-frame` / `pl-data-grid-scroll` 布局契约：Agent 和配置审计使用普通横向滚动框，访问日志在同一视觉外框内叠加唯一的 `pl-audit-grid-scroll` 有界双向滚动行为。配置审计通过固定语义列模板和长标识换行控制在 1280 桌面基线内，访问日志不强行压缩宽表（调用流水 L1 含「访问上下文」，共 13 列）。

**Tech Stack:** React 19、TypeScript、React Router 7、Tailwind/CSS、Vitest + Testing Library、Playwright。

---

## 0. Verified baseline and decision

### 0.1 Browser evidence

2026-08-26 在 `http://127.0.0.1:55176`、1280×720 视口实测：

| 页面 | 表格类 | 内容宽 / 容器宽 | 横向溢出 | 外框 |
|---|---|---:|---:|---|
| `/admin/agents` | `pl-data-grid pl-data-table pl-agent-list-table` | 934 / 934 px | 0 px | 有 1px 边框、8px 圆角、16px padding |
| `/admin/config-audit` | `pl-data-grid pl-data-table pl-config-audit-table pl-audit-table` | 1204 / 953 px | 251 px | 无 |
| `/admin/audit?range=7d` | `pl-data-grid pl-data-table pl-audit-table` | 1401 / 953 px | 448 px | 无 |

补充事实：

- 三页表头和正文已经共享 12px 字号、8×12px 单元格 padding 与 1px 行分隔线，因此“完全没有复用 Agent 表格样式”不成立。
- 视觉与滚动容器确实不一致；配置审计的“文件路径”不能完整进入首屏。
- 访问日志首屏仅完整显示前六列，横向滚动条位于约 2400px 的长页面底部。
- 三页当时均无浏览器 console error / warning。

### 0.2 Decision

采用以下方案：

1. **共享视觉外框**：三页统一 `pl-data-grid-frame`，以 Agent 当前外观为基准。
2. **共享普通滚动层**：三页统一 `pl-data-grid-scroll`，替代散落的 `overflow-x-auto`。
3. **配置审计适配内容**：在 1280 桌面宽度尽量无横向溢出；长 target/path 必须换行且完整保留。
4. **访问日志保留宽表**：不把调查列硬塞进一屏；叠加 `pl-audit-grid-scroll`、sticky header 和可聚焦命名区域，让横向滚动无需先到页面底部。调用流水 L1 列顺序（含访问上下文）：

```text
序号 | 时间 | 事件 ID | 问询 ID | Agent | 访问上下文 | 状态 | 耗时 | 工具 | 涉及数据表 | 裁决原因 | 调用来源 | 生成 SQL
```

Drawer 内明细小表不属于本计划；只改 L1 问询记录 / 调用流水 wrapper。
5. **不抽象 React 组件**：三处只有一层稳定结构，CSS 语义类足够；避免为纯视觉框架增加组件 API。

### 0.3 Relationship to existing work

本计划是跨页面数据网格一致性的事实源，并扩展现有 `docs/plans/2026-08-26-admin-audit-uiux-remediation.md` 的 Task 6：

- 现有 Audit 计划继续负责时间、URL、列顺序、键盘操作、复制反馈与 Drawer 修复。
- 本计划负责三页共享外框、配置审计列模板，以及 Audit Task 6 的滚动容器接入共享外框。
- `.pl-audit-grid-scroll` 只能定义一次；执行两个计划时，以本计划 Task 4 的组合方式为准，不要建立嵌套滚动区。

### 0.4 Preconditions

当前工作树已有未提交且重叠的 `webui/src/app/app.css`、`webui/src/pages/admin/Audit.tsx` 修改。实施前必须满足其一：

1. 先完成并提交现有 Audit/Branding 工作，再从包含这些提交的基线创建专用 worktree；或
2. 将本计划交给当前改动所有者串行合并。

禁止在当前脏工作树直接按本计划的 `git add` 示例提交整个重叠文件；不得覆盖、回滚或夹带现有用户改动。

## 1. Scope

### In scope

- `/admin/agents` 列表表格外框语义化，但视觉保持不变。
- `/admin/config-audit` 表格外框、列宽、长 target/path 换行和滚动可达性。
- `/admin/audit` 问询记录、调用流水两张 L1 表格的共享外框和有界滚动区。
- 数据网格设计系统契约、三页 Vitest 与桌面 Playwright 回归。

### Out of scope

- 不改 API、分页、筛选、排序、导出 CSV 字段或审计数据口径。
- 不删除或合并访问日志列，不新增“数据库连接”等服务端未提供字段。
- 不统一 Drawer 内的明细小表格；它们不属于页面 L1 列表。
- 不做移动端或窄于 1280px 的响应式重构。
- 不把本次视觉回归宣称为 `CFG-AUDIT-01` 企业级签字。

## 2. Target contract

### 2.1 Shared frame CSS

在 `webui/src/app/app.css` 的数据网格基础规则附近增加：

```css
.pl-data-grid-frame {
  @apply rounded-md border border-border-default bg-bg-surface p-4;
}

.pl-data-grid-scroll {
  @apply max-w-full overflow-x-auto;
}

.pl-data-grid-scroll:focus-visible {
  @apply outline-none ring-2 ring-primary ring-offset-2;
}
```

约束：

- `pl-data-grid-frame` 是视觉容器，不设置固定高度。
- `pl-data-grid-scroll` 是唯一的普通横向滚动容器；不得在其外层再包 `overflow-x-auto`。
- 只有确实可能滚动的配置审计与访问日志区域设置 `tabIndex={0}`、`role="region"` 和业务化 `aria-label`。
- 不写裸色值，不创建第二套表格 typography。

### 2.2 Config Audit column template

配置审计使用固定语义列模板，总最小宽度 56rem；在 1280×800 项目视口中应适配共享外框内容区：

```css
.pl-config-audit-table {
  min-width: 56rem;
  table-layout: fixed;
}

.pl-config-audit-col-index { width: 3rem; }
.pl-config-audit-col-time { width: 8.5rem; }
.pl-config-audit-col-actor { width: 4.5rem; }
.pl-config-audit-col-source { width: 4.5rem; }
.pl-config-audit-col-asset { width: 4.5rem; }
.pl-config-audit-col-change { width: 5.5rem; }
.pl-config-audit-col-target { width: 12.5rem; }
.pl-config-audit-col-path { width: 13rem; }

.pl-config-audit-table-target,
.pl-config-audit-table-path {
  overflow-wrap: anywhere;
  word-break: break-word;
}
```

对应 `<colgroup>`：

```tsx
<colgroup>
  <col className="pl-config-audit-col-index" />
  <col className="pl-config-audit-col-time" />
  <col className="pl-config-audit-col-actor" />
  <col className="pl-config-audit-col-source" />
  <col className="pl-config-audit-col-asset" />
  <col className="pl-config-audit-col-change" />
  <col className="pl-config-audit-col-target" />
  <col className="pl-config-audit-col-path" />
</colgroup>
```

target 与 path 的 DOM 必须保留完整字符串；不得以视觉截断、substring 或只保留文件名替代换行。

### 2.3 Audit bounded scroll

访问日志在共享滚动类上叠加有界行为，不建立第二层滚动元素：

```css
.pl-audit-grid-scroll {
  max-height: clamp(20rem, calc(100vh - 20rem), 44rem);
  overflow: auto;
  overscroll-behavior: contain;
}

.pl-audit-grid-scroll .pl-data-grid thead {
  position: sticky;
  top: 0;
  z-index: 1;
}

.pl-audit-grid-scroll .pl-data-grid thead th {
  @apply bg-bg-base;
}
```

问询记录与调用流水分别使用：

```tsx
<section className="pl-data-grid-frame">
  <div
    className="pl-data-grid-scroll pl-audit-grid-scroll"
    role="region"
    aria-label="问询记录表格，可横向和纵向滚动"
    tabIndex={0}
  >
    {/* existing table */}
  </div>
</section>
```

调用流水只替换 `aria-label` 为“调用流水表格，可横向和纵向滚动”。

## Task 1: Register the shared frame contract

**Files:**

- Modify: `webui/docs/design-system/11-components-data-grid.md`
- Reference: `webui/docs/design-system/01-foundations-color.md`
- Reference: `webui/docs/design-system/02-foundations-grid-spacing.md`
- Reference: `docs/plans/2026-08-26-admin-audit-uiux-remediation.md:480`

**Step 1: Add the frame and overflow contract**

在 Data Grid 规范的 Base Contract 后新增“Frame and Overflow”小节，逐字登记：

- L1 数据网格使用 `pl-data-grid-frame` 作为边框、圆角、surface 与 padding 契约。
- `pl-data-grid-scroll` 是唯一普通横向滚动层。
- 高列数/高行数审计网格可叠加 `pl-audit-grid-scroll`，但禁止嵌套滚动层。
- 宽表允许横向滚动，禁止为了单屏展示牺牲完整 ID、调查列或可读性。
- 可滚动区域必须可聚焦并具备业务化 accessible name；普通不滚动表格不增加无意义 tab stop。

**Step 2: Add desktop acceptance rules**

记录桌面基线：1440×900、1280×800；移动端不在本契约范围内。配置审计的关键字段可换行，访问日志保留宽表滚动。

**Step 3: Run terminology lint**

Run:

```bash
cd webui
npm run lint:terminology
```

Expected: exit 0。

**Step 4: Commit**

```bash
git add webui/docs/design-system/11-components-data-grid.md
git commit -m "docs(webui): define shared data grid frame"
```

## Task 2: Convert Agent list to the semantic baseline

**Files:**

- Modify: `webui/src/pages/admin/AgentList.tsx:596-729`
- Modify: `webui/src/app/app.css:729-800`
- Test: `webui/src/__tests__/agent-list.test.tsx`

**Step 1: Write the failing structure test**

在现有“renders agent list as pl-data-grid table”用例中增加：

```tsx
const section = screen.getByTestId("agent-list-section");
expect(section).toHaveClass("pl-data-grid-frame");
expect(section).not.toHaveClass("rounded-md", "border", "p-4");

const scroll = screen.getByTestId("agent-list-grid-scroll");
expect(scroll).toHaveClass("pl-data-grid-scroll");
```

**Step 2: Run the test to verify it fails**

Run:

```bash
cd webui
npx vitest run src/__tests__/agent-list.test.tsx --maxWorkers=1
```

Expected: FAIL，因为 `pl-data-grid-frame` / `agent-list-grid-scroll` 尚不存在。

**Step 3: Add the shared CSS and replace utility markup**

将 Agent 列表外层：

```tsx
<section
  className="rounded-md border border-border-default bg-bg-surface p-4"
  data-testid="agent-list-section"
>
  <div className="overflow-x-auto">
```

替换为：

```tsx
<section className="pl-data-grid-frame" data-testid="agent-list-section">
  <div className="pl-data-grid-scroll" data-testid="agent-list-grid-scroll">
```

在 `app.css` 增加 §2.1 的三条共享规则。Agent 表格、列、行和操作内容不改。

**Step 4: Run the test to verify it passes**

Run:

```bash
cd webui
npx vitest run src/__tests__/agent-list.test.tsx --maxWorkers=1
```

Expected: PASS。

**Step 5: Commit**

仅在专用干净 worktree 执行：

```bash
git add webui/src/pages/admin/AgentList.tsx webui/src/app/app.css webui/src/__tests__/agent-list.test.tsx
git commit -m "refactor(admin): name shared data grid frame"
```

## Task 3: Apply the frame and fit Config Audit content

**Files:**

- Modify: `webui/src/pages/admin/ConfigAudit.tsx:95-122`
- Modify: `webui/src/pages/admin/ConfigAudit.tsx:345-378`
- Modify: `webui/src/app/app.css:768-788`
- Test: `webui/src/__tests__/admin-config-audit.test.tsx`

**Step 1: Write failing structure and content tests**

扩展 `admin-config-audit.test.tsx` 的第一条用例：

```tsx
const frame = screen.getByTestId("config-audit-grid-frame");
expect(frame).toHaveClass("pl-data-grid-frame");

const region = screen.getByRole("region", {
  name: "配置审计表格，可横向滚动"
});
expect(region).toHaveClass("pl-data-grid-scroll");
expect(region).toHaveAttribute("tabindex", "0");

const table = screen.getByTestId("config-audit-table");
expect(table.querySelector("colgroup")).not.toBeNull();
expect(table.querySelector(".pl-config-audit-col-target")).not.toBeNull();
expect(table.querySelector(".pl-config-audit-col-path")).not.toBeNull();
expect(table.querySelector("td.pl-config-audit-table-target")).not.toBeNull();
expect(table.querySelector("td.pl-config-audit-table-path")).not.toBeNull();
```

将测试 fixture 的首条记录改为长 target/path，并继续断言完整文本存在，证明未截断数据。

**Step 2: Run the test to verify it fails**

Run:

```bash
cd webui
npx vitest run src/__tests__/admin-config-audit.test.tsx --maxWorkers=1
```

Expected: FAIL，缺少 frame、region、colgroup 和专用 cell class。

**Step 3: Add frame and accessible scroll region**

将当前裸滚动 wrapper 替换为：

```tsx
<section className="pl-data-grid-frame" data-testid="config-audit-grid-frame">
  <div
    className="pl-data-grid-scroll"
    role="region"
    aria-label="配置审计表格，可横向滚动"
    tabIndex={0}
    data-testid="config-audit-grid-scroll"
  >
    <table
      className="pl-data-grid pl-data-table pl-config-audit-table pl-audit-table w-full"
      data-testid="config-audit-table"
    >
      {/* §2.2 colgroup, existing thead/tbody */}
    </table>
  </div>
</section>
```

结果计数和分页仍留在 frame 外，保持现有信息层级与分页布局。

**Step 4: Add column template and long-value classes**

在 `ChangeRow` 中修改两格：

```tsx
<td className="pl-config-audit-table-target font-mono">
  {/* existing target link/content */}
</td>
<td className="pl-config-audit-table-path font-mono">
  {entry.filePath}
</td>
```

加入 §2.2 的 CSS 与 `<colgroup>`。不要在 JSX 中新增 `truncate`、`line-clamp` 或 substring。

**Step 5: Run the test to verify it passes**

Run:

```bash
cd webui
npx vitest run src/__tests__/admin-config-audit.test.tsx --maxWorkers=1
```

Expected: PASS。

**Step 6: Commit**

```bash
git add webui/src/pages/admin/ConfigAudit.tsx webui/src/app/app.css webui/src/__tests__/admin-config-audit.test.tsx
git commit -m "fix(config-audit): align data grid frame and columns"
```

## Task 4: Integrate Audit tables with the shared frame

**Files:**

- Modify: `webui/src/pages/admin/Audit.tsx:1634-1775`
- Modify: `webui/src/app/app.css:768-799`
- Test: `webui/src/__tests__/admin-audit-turns.test.tsx`
- Coordinate: `docs/plans/2026-08-26-admin-audit-uiux-remediation.md:480-609`

**Step 1: Add failing frame and scroll-region tests**

对问询记录断言：

```tsx
const turnsFrame = screen.getByTestId("audit-turns-grid-frame");
expect(turnsFrame).toHaveClass("pl-data-grid-frame");

const turnsRegion = screen.getByRole("region", {
  name: "问询记录表格，可横向和纵向滚动"
});
expect(turnsRegion).toHaveClass("pl-data-grid-scroll", "pl-audit-grid-scroll");
expect(turnsRegion).toHaveAttribute("tabindex", "0");
```

切换至调用流水后，用相同结构断言 `audit-calls-grid-frame` 和名称“调用流水表格，可横向和纵向滚动”。

**Step 2: Run the test to verify it fails**

Run:

```bash
cd webui
npx vitest run src/__tests__/admin-audit-turns.test.tsx --maxWorkers=1
```

Expected: FAIL，因为两个 Audit frame/region 尚未使用共享契约。

**Step 3: Replace both Audit wrappers**

问询记录：

```tsx
<section className="pl-data-grid-frame" data-testid="audit-turns-grid-frame">
  <div
    className="pl-data-grid-scroll pl-audit-grid-scroll"
    role="region"
    aria-label="问询记录表格，可横向和纵向滚动"
    tabIndex={0}
    data-testid="audit-turns-grid-scroll"
  >
    {/* existing audit-turns-table */}
  </div>
</section>
```

调用流水使用同构结构与自己的 test id / aria-label。实现 §2.3 CSS；不得再保留外层 `overflow-x-auto`。

**Step 4: Preserve the existing Audit remediation contract**

若现有 Audit 计划 Task 6 已进入实施，合并而不是覆盖以下行为：

- `AuditDateTime` 日期/时刻分行。
- 完整可复制问询 ID。
- 来源 badge 单行。
- 调用流水调查优先列顺序。
- 清除筛选和 localStorage 行为。

本步骤不修改任何 API query、列字段集合或 Drawer 状态。

**Step 5: Run the test to verify it passes**

Run:

```bash
cd webui
npx vitest run src/__tests__/admin-audit-turns.test.tsx --maxWorkers=1
```

Expected: PASS。

**Step 6: Commit**

只有现有 Audit 改动已经提交或已在同一专用 worktree 中完成时执行：

```bash
git add webui/src/pages/admin/Audit.tsx webui/src/app/app.css webui/src/__tests__/admin-audit-turns.test.tsx
git commit -m "fix(audit): keep wide grids operable in shared frame"
```

## Task 5: Add cross-page browser regression coverage

**Files:**

- Create: `webui/tests/e2e/specs/admin-data-grid-consistency.spec.ts`
- Modify if selectors are registered: `webui/docs/qa/selector-contract.md`
- Modify if selector registry requires it: `webui/scripts/check-selector-contract.mjs`
- Verify: `webui/playwright.config.ts:44-45`

**Step 1: Add the Playwright spec**

创建 `@pr-impacted` 用例，按三个 URL 逐页验证：

```ts
import { expect, test } from "@playwright/test";

test("@pr-impacted admin data grids share one frame contract", async ({ page }) => {
  await page.goto("/admin/agents");
  const agentsFrame = page.getByTestId("agent-list-section");
  await expect(agentsFrame).toBeVisible();
  await expect(agentsFrame).toHaveClass(/pl-data-grid-frame/);

  await page.goto("/admin/config-audit");
  const configFrame = page.getByTestId("config-audit-grid-frame");
  const configScroll = page.getByTestId("config-audit-grid-scroll");
  await expect(configFrame).toBeVisible();
  await expect(configFrame).toHaveClass(/pl-data-grid-frame/);
  await expect(configScroll).toHaveAttribute("role", "region");

  await page.goto("/admin/audit?range=7d");
  const auditFrame = page.getByTestId("audit-turns-grid-frame");
  const auditScroll = page.getByTestId("audit-turns-grid-scroll");
  await expect(auditFrame).toBeVisible();
  await expect(auditFrame).toHaveClass(/pl-data-grid-frame/);
  await expect(auditScroll).toHaveClass(/pl-audit-grid-scroll/);
});

test("@pr-impacted grid geometry is usable at the project desktop viewport", async ({ page }) => {
  await page.goto("/admin/config-audit");
  const configGeometry = await page.getByTestId("config-audit-grid-scroll").evaluate((node) => ({
    clientWidth: node.clientWidth,
    scrollWidth: node.scrollWidth
  }));
  expect(configGeometry.scrollWidth).toBeLessThanOrEqual(configGeometry.clientWidth + 1);

  await page.goto("/admin/audit?range=7d");
  const auditGeometry = await page.getByTestId("audit-turns-grid-scroll").evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return {
      bottom: rect.bottom,
      clientHeight: node.clientHeight,
      scrollHeight: node.scrollHeight,
      viewportHeight: window.innerHeight
    };
  });
  expect(auditGeometry.bottom).toBeLessThanOrEqual(auditGeometry.viewportHeight);
  expect(auditGeometry.clientHeight).toBeLessThanOrEqual(auditGeometry.scrollHeight);
});
```

如果 E2E fixture 的配置审计没有长记录，保留结构测试，并在 Step 5 的真实服务验收中证明长内容几何；不要在生产数据目录造假记录。

**Step 2: Run selector contract**

```bash
cd webui
npm run e2e:selector-contract
```

Expected: exit 0；若新增 test id 必须先登记 selector contract。

**Step 3: Run focused unit tests together**

```bash
cd webui
npx vitest run \
  src/__tests__/agent-list.test.tsx \
  src/__tests__/admin-config-audit.test.tsx \
  src/__tests__/admin-audit-turns.test.tsx \
  --maxWorkers=1
```

Expected: all pass。

**Step 4: Run static and build gates**

```bash
cd webui
npm run lint:terminology
npm run lint:ia-boundary
npm run e2e:selector-contract
npm run build
```

Expected: 全部 exit 0。

**Step 5: Run the two desktop browser projects**

```bash
cd webui
npm run e2e:fixture
npx playwright test tests/e2e/specs/admin-data-grid-consistency.spec.ts --project=chromium
npx playwright test tests/e2e/specs/admin-data-grid-consistency.spec.ts --project=chromium-narrow
```

Expected: 1440×900 与 1280×800 均通过。不得把 `LUCY_E2E_PROJECT_DIR` 指向真实 `/Users/zhangxingchen/Projects/project-lucy`。

**Step 6: Verify the requested local service manually**

对 `http://127.0.0.1:55176` 逐页复核：

```text
/admin/agents
/admin/config-audit
/admin/audit?range=7d
/admin/audit?range=7d&view=calls
```

验收清单：

- [ ] 三页数据网格均有相同的 1px 边框、8px 圆角、surface 背景和 16px padding。
- [ ] 三页表头/正文仍保持现有 12px 密度、8×12px cell padding 与分隔线。
- [ ] 配置审计的 target/path 完整保留并可换行；1280 项目下表格不产生非必要横向溢出。
- [ ] 访问日志保留全部调查列，不因适配而截断 ID 或删除列。
- [ ] 问询记录和调用流水横向滚动区底部位于首屏可达范围，表头在纵向滚动时保持可见。
- [ ] 两个 Audit 滚动区可通过键盘聚焦，并有正确 accessible name。
- [ ] 页面没有新增 console error / warning。

**Step 7: Commit browser coverage**

```bash
git add webui/tests/e2e/specs/admin-data-grid-consistency.spec.ts webui/docs/qa/selector-contract.md webui/scripts/check-selector-contract.mjs
git commit -m "test(admin): cover data grid frame consistency"
```

只 add 实际发生变更的 selector contract 文件。

## Final verification matrix

| Requirement | Automated evidence | Browser evidence |
|---|---|---|
| Shared visual frame | 三页 test id + `pl-data-grid-frame` 断言 | border/radius/background/padding computed style 一致 |
| Existing typography preserved | `pl-data-grid` class tests | th/td computed font、padding、border 不漂移 |
| Config Audit fits content | colgroup/cell-class tests | 1280 下 `scrollWidth <= clientWidth + 1`，长值完整换行 |
| Audit remains readable | region/class/column tests | 全列仍在，横向滚动可达，sticky header 可见 |
| Accessibility | role/name/tabIndex tests | Tab 可聚焦，ARIA snapshot 名称正确 |
| No regression | focused Vitest + lint + build + Playwright | 三页无新增 console error/warning |

## Design System Compliance

- 复用 `pl-data-grid`，不创建第二套表格视觉语言。
- 共享外框使用既有 radius、border、surface、focus token，不写裸色值。
- Agent 页面只做语义类替换，渲染结果保持当前基线。
- 配置审计采用内容感知换行；访问日志采用 desktop-first 宽表滚动，不用强制压缩。
- 仅验证项目正式桌面档 1440×900、1280×800，不扩展移动端范围。

