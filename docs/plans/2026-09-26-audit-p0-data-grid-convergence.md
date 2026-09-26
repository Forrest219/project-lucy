# Audit P0 and Data Grid Convergence Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use @executing-plans to implement this plan task-by-task.

**Goal:** 修复访问日志页面级横向溢出和按钮语义问题，并在最后一个批次完成指定页面的 Data Grid 视觉与结构收口。

**Architecture:** 先在共享样式层修复 Data Grid 容器的 grid/flex 最小宽度约束，再在页面层收敛按钮和选择控件语义；跨页面表格迁移保持为独立末批，统一使用 `pl-data-grid-frame -> pl-data-grid-scroll -> pl-data-grid pl-data-table`。所有改动测试先行，保持现有 API、查询参数、导出链接、权限和行交互不变。

**Tech Stack:** React 18、TypeScript、Tailwind/CSS utilities、Vitest、Testing Library、Playwright。

---

## 实施边界与安全约束

- 本计划只覆盖审阅报告 P0：访问日志布局、访问日志按钮层级、状态选择按钮语义，以及明确要求置于最后批次的跨页面 Data Grid 收口。
- 不处理报告中的 P1/P2 项，不改移动窄屏，不修改 KTX，不修改 API 或服务端数据契约。
- 当前工作区已有未提交修改，且 `webui/src/pages/admin/Audit.tsx`、`webui/src/pages/admin/Tokens.tsx` 及对应测试与本计划重叠。实施必须在当前 checkout 增量修改，不得 reset、checkout、stash 或覆盖现有内容。
- 特别保留 Audit 中已有的 `tokenHashPrefix` 筛选与导出参数改动；每个批次结束后使用 `git diff -- <本批文件>` 检查差异。
- 未经用户单独授权不创建提交；下文的“检查点”替代自动 commit，避免把用户既有修改混入提交。
- 用户可见文案遵循 `webui/docs/00-product-terminology-standard.md`；组件实现遵循 `webui/docs/design-system/10-components-button.md` 和 `11-components-data-grid.md`。

## 批次一：修复访问日志页面级横向溢出

### Task 1：先补充失败的几何回归测试

**Files:**

- Modify: `webui/tests/e2e/specs/admin-data-grid-consistency.spec.ts`

**Step 1: 为两种访问日志视图增加页面根节点宽度断言**

在 `/admin/audit?range=7d` 与 `/admin/audit?range=7d&view=calls` 分别读取：

```ts
const pageGeometry = await page.evaluate(() => ({
  clientWidth: document.documentElement.clientWidth,
  scrollWidth: document.documentElement.scrollWidth
}));
expect(pageGeometry.scrollWidth).toBeLessThanOrEqual(pageGeometry.clientWidth + 1);
```

**Step 2: 断言横向溢出被限制在访问日志滚动层**

对 `audit-turns-grid-scroll` 和 `audit-calls-grid-scroll` 读取 `clientWidth`、`scrollWidth`，断言 fixture 数据下 `scrollWidth > clientWidth`。继续保留现有首屏高度和纵向滚动断言。

**Step 3: 运行测试并确认修复前失败**

Run:

```bash
cd webui
npx playwright test tests/e2e/specs/admin-data-grid-consistency.spec.ts --project=chromium --grep "grid geometry"
```

Expected: FAIL，访问日志页面的 `documentElement.scrollWidth` 大于 `clientWidth + 1`；失败应来自新增页面级宽度断言。

### Task 2：修复共享 Data Grid 容器宽度约束

**Files:**

- Modify: `webui/src/app/app.css`，现有 `.pl-data-grid-frame` 与 `.pl-data-grid-scroll`
- Verify only: `webui/src/pages/admin/Audit.tsx`，现有两套 Audit Grid DOM

**Step 1: 修改 frame 样式**

在现有视觉样式基础上追加最小宽度和最大宽度约束，目标等价于：

```css
.pl-data-grid-frame {
  @apply min-w-0 max-w-full rounded-md border border-border-default bg-bg-surface p-4;
}
```

不得删除现有圆角、边框、背景或内边距 token。

**Step 2: 修改 scroll 样式**

目标等价于：

```css
.pl-data-grid-scroll {
  @apply w-full min-w-0 max-w-full overflow-x-auto;
}
```

保持 `.pl-data-grid-scroll:focus-visible` 与 `.pl-audit-grid-scroll` 的有界高度、`overflow: auto` 和 sticky header 行为。

**Step 3: 验证 Audit DOM 不需要结构性重写**

两种视图都必须保持：

```tsx
<section className="pl-data-grid-frame" ...>
  <div className="pl-data-grid-scroll pl-audit-grid-scroll" ...>
    <table className="pl-data-grid pl-data-table pl-audit-table w-full">
```

不得隐藏列、缩短内容、降低表格最小宽度或将横向滚动放回页面根节点。

**Step 4: 运行几何测试并确认通过**

Run:

```bash
cd webui
npx playwright test tests/e2e/specs/admin-data-grid-consistency.spec.ts --project=chromium --grep "grid geometry"
npx playwright test tests/e2e/specs/admin-data-grid-consistency.spec.ts --project=chromium-narrow --grep "grid geometry"
```

Expected: PASS；两个桌面 viewport 下页面无横向溢出，访问日志宽表只在本地滚动层溢出。

**检查点 1:**

```bash
git diff -- webui/src/app/app.css webui/tests/e2e/specs/admin-data-grid-consistency.spec.ts
```

确认本批只修改共享宽度约束和几何测试。

## 批次二：修复按钮层级与状态选择语义

### Task 3：先锁定访问日志按钮和时间选择的目标行为

**Files:**

- Modify: `webui/src/__tests__/admin-audit-turns.test.tsx`
- Modify: `webui/src/__tests__/audit.test.tsx`

**Step 1: 更新导出按钮测试标识**

将现有引用统一改为：

- 当前视图导出：`audit-export-current`
- 关联视图导出：`audit-export-related`
- 证据包：保留 `audit-export-pack`

**Step 2: 增加按钮层级断言**

对三个 Header 导出入口断言均包含 `pl-btn--secondary`，且均不包含 `pl-btn--primary`。继续断言调用/问询视图切换后链接文案和 `href` 与当前行为一致。

**Step 3: 增加时间选择语义测试**

断言 `audit-time-presets`：

- 包含 `pl-segmented-control` 与 `pl-segmented-control--auto`。
- 具有 `role="group"` 和 `aria-label="时间范围"`。
- 当前选项具有 `pl-segmented-control-item--active`、`aria-pressed="true"`。
- 其他选项具有 `aria-pressed="false"`。
- 所有选项均不使用 `pl-btn--primary`。
- 点击“近 24 小时”“近 7 天”“今天”和“自定义”仍按现有逻辑更新查询范围或展示自定义控件。

**Step 4: 确认修复前测试失败**

Run:

```bash
cd webui
npx vitest run src/__tests__/admin-audit-turns.test.tsx src/__tests__/audit.test.tsx
```

Expected: FAIL，原因应为旧测试标识、主按钮类或时间预设仍使用按钮样式。

### Task 4：实现访问日志 Header 与时间选择收口

**Files:**

- Modify: `webui/src/pages/admin/Audit.tsx`，Header actions 与 `audit-time-presets`
- Modify: `webui/src/app/app.css`，segmented control modifier

**Step 1: 增加动态数量 segmented control modifier**

在基础 segmented control 和 `--cols-2` 后增加：

```css
.pl-segmented-control--auto {
  @apply flex w-fit max-w-full flex-wrap;
}
```

基础 item 和 active 样式继续复用，不建立第二套选中颜色。

**Step 2: 移除 Header 中重复的 24h/7d 选择器**

删除 PageHeader actions 内的 `pl-segmented-control--cols-2` 时间范围控件。保留调用/问询视图切换控件，不改变 `view` 参数行为。

**Step 3: 调整三个导出入口**

- 当前视图 CSV：`pl-btn pl-btn--secondary`，`data-testid="audit-export-current"`。
- 关联视图 CSV：`pl-btn pl-btn--secondary`，`data-testid="audit-export-related"`。
- 审计证据包 Manifest：`pl-btn pl-btn--secondary`，保留 `audit-export-pack`。

保持现有 href 生成函数、过滤条件、`tokenHashPrefix`、下载行为和不同视图的文案映射。

**Step 4: 将快速时间范围改为 segmented control**

外层目标结构：

```tsx
<div
  className="pl-segmented-control pl-segmented-control--auto"
  data-testid="audit-time-presets"
  role="group"
  aria-label="时间范围"
>
```

每个 button 使用 `pl-segmented-control-item`；选中项追加 `pl-segmented-control-item--active`，并设置 `aria-pressed={timePreset === preset}`。不得再使用 `pl-btn--primary` 或 `pl-btn--ghost` 表示选中状态。

**Step 5: 移动辅助统计信息**

将 Header 中的命中数量和更新时间移动到时间范围控件相邻区域，使用辅助文本样式；内容和刷新逻辑不变，不新增第二个时间选择入口。

**Step 6: 运行目标测试**

Run:

```bash
cd webui
npx vitest run src/__tests__/admin-audit-turns.test.tsx src/__tests__/audit.test.tsx
```

Expected: PASS，包括现有 tokenHashPrefix、导出 URL、视图切换和新增语义断言。

### Task 5：将评测域切换改为同一选择语义

**Files:**

- Modify: `webui/src/__tests__/eval-cases.test.tsx`
- Modify: `webui/src/pages/eval/CaseList.tsx`，评测域切换区

**Step 1: 写失败测试**

为评测域容器补充稳定的 `data-testid="eval-domain-selector"`，测试期望：

- 容器使用 `pl-segmented-control pl-segmented-control--auto`。
- 容器具有 `role="group"` 和 `aria-label="评测域"`。
- 当前域为 active 且 `aria-pressed="true"`。
- 其他域 `aria-pressed="false"`。
- 域按钮不使用 `pl-btn--primary`。
- 点击另一个域仍更新现有路由/筛选状态。

Run:

```bash
cd webui
npx vitest run src/__tests__/eval-cases.test.tsx
```

Expected: FAIL，当前页面仍使用 `pl-btn--primary/pl-btn--ghost`。

**Step 2: 修改评测域控件**

将当前 `flex gap-2 flex-wrap` 容器替换为 auto segmented control；按钮复用与 Audit 相同的 item/active 规则。保留域数量、现有 click handler、加载状态和当前域判定。

**Step 3: 运行目标测试**

Run:

```bash
cd webui
npx vitest run src/__tests__/eval-cases.test.tsx
```

Expected: PASS。

### Task 6：更新按钮规范

**Files:**

- Modify: `webui/docs/design-system/10-components-button.md`

**Step 1: 登记 auto segmented control**

补充 `pl-segmented-control--auto` 的适用场景：动态选项数量、内容自适应、空间不足时换行；示例使用时间范围和评测域。

**Step 2: 明确 Header 操作层级**

确认同一组平行导出/维护操作统一为 secondary，选择状态不得借用 primary button；Header 可见动作仍不超过三个。

**Step 3: 运行第二批测试和规范检查**

Run:

```bash
cd webui
npx vitest run src/__tests__/admin-audit-turns.test.tsx src/__tests__/audit.test.tsx src/__tests__/eval-cases.test.tsx
npm run lint:terminology
npm run lint:ia-boundary
```

Expected: 全部 PASS。

**检查点 2:**

```bash
git diff -- \
  webui/src/pages/admin/Audit.tsx \
  webui/src/pages/eval/CaseList.tsx \
  webui/src/app/app.css \
  webui/src/__tests__/admin-audit-turns.test.tsx \
  webui/src/__tests__/audit.test.tsx \
  webui/src/__tests__/eval-cases.test.tsx \
  webui/docs/design-system/10-components-button.md
```

确认 Audit 既有安全筛选改动仍存在，且无 API/服务端文件变更。

## 批次三：跨页面 Data Grid 收口（必须最后执行）

### Task 7：为四类页面建立共享结构测试

**Files:**

- Modify: `webui/src/__tests__/eval-cases.test.tsx`
- Modify: `webui/src/__tests__/monitor.test.tsx`
- Modify: `webui/src/__tests__/tokens-page.test.tsx`
- Create: `webui/src/__tests__/admin-accounts.test.tsx`

**Step 1: 评测用例列表测试**

新增断言：

- `eval-cases-grid-frame` 使用 `pl-data-grid-frame`。
- `eval-cases-grid-scroll` 使用 `pl-data-grid-scroll`。
- `eval-cases-table` 使用 `pl-data-grid pl-data-table`。
- 整行点击与行内操作 `stopPropagation` 行为仍通过现有测试。

**Step 2: 评测监控测试**

为失败用例排行和告警阈值表分别增加 frame/scroll/table 测试标识，断言共享类；继续验证阈值输入框可按 label 访问和编辑。

**Step 3: Token 管理测试**

保留现有 `tokens-table`，新增 `tokens-grid-frame`、`tokens-grid-scroll`；断言 overflow 不再直接挂载在 frame，表格使用共享类，现有安全字段和操作仍呈现。

**Step 4: 管理员账号测试**

创建页面测试，提供 open mode/owner fixture，验证：

- `admin-accounts-grid-frame`、`admin-accounts-grid-scroll`、`admin-accounts-table` 的共享结构。
- 所有者条件列、创建表单和行操作按当前权限呈现。
- 测试不依赖具体列宽或像素值。

**Step 5: 运行并确认失败**

Run:

```bash
cd webui
npx vitest run \
  src/__tests__/eval-cases.test.tsx \
  src/__tests__/monitor.test.tsx \
  src/__tests__/tokens-page.test.tsx \
  src/__tests__/admin-accounts.test.tsx
```

Expected: FAIL，原因仅为四类页面尚未满足共享 Data Grid DOM/class contract。

### Task 8：迁移评测用例与评测监控表格

**Files:**

- Modify: `webui/src/pages/eval/CaseList.tsx`，用例列表表格
- Modify: `webui/src/pages/eval/Monitor.tsx`，失败用例排行与告警阈值表格

**Step 1: 迁移评测用例列表**

目标结构：

```tsx
<section className="pl-data-grid-frame" data-testid="eval-cases-grid-frame">
  <div
    className="pl-data-grid-scroll"
    data-testid="eval-cases-grid-scroll"
    role="region"
    aria-label="评测用例列表"
    tabIndex={0}
  >
    <table
      className="pl-data-grid pl-data-table w-full"
      data-testid="eval-cases-table"
    >
```

移除手写 `w-full text-sm` 基线，保留业务列宽、mono ID、muted 详情、行 hover、整行导航及操作按钮事件隔离。

**Step 2: 迁移评测监控两张表**

两张表分别建立 frame/scroll/table 结构。普通表格不额外增加 tab stop；只有设置明确最小宽度并可能横向滚动的区域才增加 `role="region"`、`aria-label`、`tabIndex={0}`。

阈值输入控件保持当前高度和可访问 label，表格行高允许被表单控件自然撑开，不新建另一套全局 density。

**Step 3: 运行页面测试**

Run:

```bash
cd webui
npx vitest run src/__tests__/eval-cases.test.tsx src/__tests__/monitor.test.tsx
```

Expected: PASS。

### Task 9：迁移 Token 与管理员账号表格

**Files:**

- Modify: `webui/src/pages/admin/Tokens.tsx`，Token 表格
- Modify: `webui/src/pages/admin/AdminAccounts.tsx`，管理员账号表格

**Step 1: 迁移 Token 表格**

将现有：

```tsx
<div className="pl-data-grid-frame overflow-x-auto">
  <table className="pl-table w-full ...">
```

改为独立 frame 和 scroll 层；表格类使用 `pl-data-grid pl-data-table w-full`。Token 多行信息按内容自然增高，不为迁移压缩安全信息；保留现有 `tokenHashPrefix` 等用户改动和操作逻辑。

**Step 2: 迁移管理员账号表格**

将现有 `pl-card overflow-x-auto` 改为统一 frame/scroll/table 结构。保留所有者模式、条件列、创建表单以及禁用/删除等权限判断，不将表单卡片迁移为 Data Grid。

**Step 3: 运行页面测试**

Run:

```bash
cd webui
npx vitest run src/__tests__/tokens-page.test.tsx src/__tests__/admin-accounts.test.tsx
```

Expected: PASS。

### Task 10：扩展跨页面 E2E 一致性验证

**Files:**

- Modify: `webui/tests/e2e/specs/admin-data-grid-consistency.spec.ts`

**Step 1: 增加路由契约检查**

依次访问：

- `/eval/cases`
- `/eval/monitor`
- `/admin/tokens`
- `/admin/admins`

检查对应 frame/scroll/table test id 可见且具有共享类。不得使用 DOM 层级序号定位。

**Step 2: 增加宽度边界检查**

每个路由都断言页面根节点没有横向溢出。对确实宽于容器的 CaseList/Token 表格，断言溢出发生在 `pl-data-grid-scroll`；若 fixture 内容不足以制造溢出，应通过稳定 API route fixture 构造长内容，不使用随机数据。

**Step 3: 运行双 viewport E2E**

Run:

```bash
cd webui
npx playwright test tests/e2e/specs/admin-data-grid-consistency.spec.ts --project=chromium
npx playwright test tests/e2e/specs/admin-data-grid-consistency.spec.ts --project=chromium-narrow
```

Expected: PASS。项目未要求移动窄屏，不运行 mobile project。

### Task 11：更新 Data Grid 规范

**Files:**

- Modify: `webui/docs/design-system/11-components-data-grid.md`

**Step 1: 明确宽度约束**

登记 frame 和 scroll 层在 grid/flex 页面中必须具有 `min-width: 0`，页面根节点不得因宽表格出现横向滚动。

**Step 2: 明确滚动区可访问性**

只有真实或高概率产生横向滚动的区域才设置 `role="region"`、可读 `aria-label` 和 `tabIndex={0}`；普通不滚动表格不得产生额外 Tab 停靠点。

**Step 3: 明确行高例外**

默认表格复用共享字号、表头、边框和行态；多行安全信息与表单控件可自然撑高，但不得通过页面私有样式重建整套表格基线。

**检查点 3:**

```bash
git diff -- \
  webui/src/pages/eval/CaseList.tsx \
  webui/src/pages/eval/Monitor.tsx \
  webui/src/pages/admin/Tokens.tsx \
  webui/src/pages/admin/AdminAccounts.tsx \
  webui/src/__tests__/eval-cases.test.tsx \
  webui/src/__tests__/monitor.test.tsx \
  webui/src/__tests__/tokens-page.test.tsx \
  webui/src/__tests__/admin-accounts.test.tsx \
  webui/tests/e2e/specs/admin-data-grid-consistency.spec.ts \
  webui/docs/design-system/11-components-data-grid.md
```

确认第三批没有反向修改前两批按钮语义，也没有触碰服务端接口。

## 最终验证与验收

### Task 12：执行完整回归

**Step 1: 运行目标单测**

```bash
cd webui
npx vitest run \
  src/__tests__/admin-audit-turns.test.tsx \
  src/__tests__/audit.test.tsx \
  src/__tests__/eval-cases.test.tsx \
  src/__tests__/monitor.test.tsx \
  src/__tests__/tokens-page.test.tsx \
  src/__tests__/admin-accounts.test.tsx
```

Expected: PASS，0 failed。

**Step 2: 运行治理检查与全量测试**

```bash
cd webui
npm run lint:terminology
npm run lint:ia-boundary
npm test
npm run build
```

Expected: 全部退出码为 0；build 无 TypeScript 或 Vite 错误。

**Step 3: 运行浏览器验收**

```bash
cd webui
npx playwright test tests/e2e/specs/admin-data-grid-consistency.spec.ts --project=chromium
npx playwright test tests/e2e/specs/admin-data-grid-consistency.spec.ts --project=chromium-narrow
```

Expected: 全部 PASS。

**Step 4: 人工检查 1440x900 与 1280x800**

逐项确认：

- 访问日志调用/问询视图均无页面级横向滚动。
- 宽表格只在表格区域横向滚动，sticky header 和有界纵向滚动正常。
- Header 中三个导出操作均为 secondary，不存在同组多个 primary。
- 时间范围和评测域均以 segmented control 表达状态，键盘焦点清晰。
- CaseList、Monitor、Tokens、AdminAccounts 的边框、表头、字号、行态和操作按钮视觉一致。
- 多行 Token 信息与阈值输入未被截断或压缩。

**Step 5: 最终差异审查**

```bash
git status --short
git diff --check
git diff --stat
```

Expected: `git diff --check` 无输出；仅出现本计划列出的预期修改以及实施前已经存在的用户改动。不得自动清理或提交无关文件。

## 完成定义

- P0 三项均有自动化回归：页面横向溢出、选择态误用主按钮、Header 多主按钮。
- 跨页面 Data Grid 收口严格在最后一批实施并单独验证。
- 不改变 API、数据契约、筛选参数、导出链接、权限或业务交互。
- 设计规范与实现同步，术语和 IA 治理检查通过。
- 所有目标单测、全量测试、构建和双桌面 viewport E2E 通过。
