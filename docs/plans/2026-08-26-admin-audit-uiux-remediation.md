# Admin Audit UI/UX Remediation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复 `/admin/audit` 浏览器核查中确认的时区、URL 上下文、键盘可达性、复制反馈、问询表格列宽与时间排版、空 Trace 抽屉和宽表滚动问题，使问询记录、调用流水及其二级 Drawer 在桌面端可理解、可操作、可回退。

**Architecture:** 保留现有 React Router URL 驱动筛选和 Radix Dialog 架构；在 `Audit.tsx` 内分离“本地时间输入值”和“API UTC ISO 值”，用已有的 query merge helper 保留审计页面上下文，并为列表引入统一的有界滚动容器。跨页面对象 Drawer 只增加审计事件的上下文感知行为，不改变其他对象类型。

**Tech Stack:** React 19、TypeScript、React Router 7、TanStack Query、Radix Dialog、Sonner、Tailwind/CSS、Vitest + Testing Library、Playwright。

---

## Review verdict (2026-08-26 code validation)

对照 `Audit.tsx`、`objectDetail.ts`、`ObjectDetailDrawer.tsx`、Spec 89/94/106 与术语标准后的结论：

| 结论 | 项 |
|---|---|
| **认同并保留** | P0 时区混用；P0 `buildObjectDetailSearch` 丢上下文；P0 `turnId` 深链不约束调用列表；P1 问询行仅鼠标可达、复制无 toast；P1 Trace header 缺 `--toolbar`；P1 仅 `overflow-x-auto` 导致横滚难触达；P1 问询 ID truncate / 时间单行 / 来源列过窄；Task 顺序（先 Spec 再 TDD）；复用 `mergeObjectDetailSearch` / Sonner / `pl-data-grid` |
| **反对并已改写** | 调用流水列优先级中的「数据库连接 / Reason」与删列；`turnId` 兼作 effective key 与关闭 Drawer 的语义冲突；证据 #3/#8 的表述精度 |
| **补充约束** | 清除筛选必须同步清 `lucy:webui:audit:filters:v3`；列表展示时间仍走 Asia/Shanghai `formatConfigAuditTs`，与 `datetime-local` 浏览器本地时区并存；不把本轮升格为服务端字段扩展 |

验证锚点（代码现状，非猜测）：

- `sinceIsoFromHours(...).toISOString().slice(0, 16)` 直接写入 `datetime-local`（约 L551–L1169）。
- 调用详情链使用 `buildObjectDetailSearch`（约 L917），`deepLinkHref(auditEvent)` 指向裸 `/admin/audit`。
- `calls`/`export` 的 `key` 只读 `keySearch`，与 Drawer 的 `turnId` 无关（约 L1280、L1337）。
- Trace header 为 `pl-trace-detail-header`（无 `--toolbar`）；问询 Drawer 已用 toolbar（约 L379 vs L644）。
- `AuditLogEntry` L1 **无** `connectionId`；「数据库连接」仅在问询详情 Drawer 的调用明细表（Spec 94）。

---

## 0. Scope and evidence baseline

### In scope

- `/admin/audit`
- `/admin/audit?range=24h&view=calls`
- `/admin/audit?range=24h&view=calls&turnId=<id>`
- 从问询记录、调用流水继续打开的问询详情、Trace 详情、审计事件对象详情
- 桌面端 1440×900、1280×800 浏览器回归

### Out of scope

- 不改审计数据聚类、P95、分页、服务端数据口径。
- 不重做后台导航或移动端布局；本项目以 MacBook 桌面端为基线。
- 不把本次页面回归视为 `CFG-AUDIT-01` 企业级签字；完整签字仍须按 `PKG → CONN → WIKI → ADM(prod_min) → MCP → EVAL(full) → AUDIT` 执行。
- 不顺手处理当前工作树中的其他未提交改动。

### Browser evidence to preserve

实施前后都使用同一组事实作为验收基线：

1. 页面当前无运行时 console error。
2. `range=24h` 在 Asia/Shanghai 浏览器中把本地时间错误显示成 UTC，偏差 8 小时（根因：UTC ISO 截断后塞进 `datetime-local`）。
3. 问询表格行仅有 `onClick`，**不可键盘聚焦**（无显式 `tabIndex`，亦非 button）；复制 ID 后没有可见反馈（无 Sonner）。
4. 调用流水表在约 953px 可视宽度下总宽约 1730px，横向滚动条只能在 50 行末尾触达。
5. 直接打开带 `turnId` 的调用流水时 Drawer 正确打开，但背景仍展示全部调用；精确 key 筛选实际只有 2 条。
6. 从调用流水打开审计事件时丢失 `range`、`view`、`key`，关闭 Drawer 后落回默认 7 天问询记录。
7. 空 Trace Drawer 出现大面积空白，关闭按钮因 header **grid**（缺 `--toolbar`）落到底部。
8. 时间窗口容器已有 `aria-label="统计窗口"`，但范围按钮**缺少** `aria-pressed` / 等价选中态；高级筛选开关缺 `aria-expanded`/`aria-controls`；工具名、Session ID、摘要搜索等仍主要依赖 placeholder。
9. 问询记录中的问询 ID 被单行省略；开始/结束时间把日期和时刻挤在同一行；来源列过窄，`已上报问询` badge 被压成多行。

### Known gaps explicitly deferred

- `since`/`until` 仍只活在 React state，不进入可分享 URL（Spec 106 提过，本轮不扩）。
- 调用流水 L1 **不新增**「数据库连接」列（`AuditLogEntry` 无该字段；该列属问询详情 Drawer，见 Spec 94）。
- 不改服务端 since 解析、聚类、P95、分页。

## 1. Design decisions

### 1.1 Priority

| Priority | Problem | Why |
|---|---|---|
| P0 | 本地时间显示与 UTC 查询混用 | 会让管理员错误理解审计窗口，并把错误时间发送给 API/CSV |
| P0 | 二级 Drawer 丢失列表 URL 上下文 | 关闭详情后返回错误视图，破坏调查路径 |
| P0 | `turnId` 深链未约束调用流水背景 | Drawer 与背景数据不一致，容易误判调用范围 |
| P1 | 问询行不可键盘打开、复制无反馈 | 核心操作不可达且缺少结果确认 |
| P1 | 空 Trace Drawer 布局失真 | 空状态被误认为加载失败，关闭路径远离标题 |
| P1 | 宽表滚动条不可及时触达 | 状态、耗时、详情等信息在常用窗口被隐藏 |
| P1 | 问询 ID、时间、来源列缺少内容感知布局 | 完整 ID 不可见，日期/时刻占宽，来源 badge 被拆成多行 |
| P2 | 控件缺语义状态和稳定 label | 屏幕阅读器、自动化测试和键盘用户难以理解控件 |

### 1.2 URL contract

审计页面保留以下独立状态：

```text
range=24h|7d
view=turns|calls
key=<审计检索键>
turnId=<当前问询 Drawer>
object=auditEvent&eventId=<当前对象 Drawer>
```

- 打开对象详情只能 merge `object/eventId`，不得重建整个 query string（必须用 `mergeObjectDetailSearch`，禁止 `buildObjectDetailSearch` 单独导航）。
- 关闭对象详情只删除 `object/eventId`，其他审计参数保持原值。
- **`turnId` 与 `key` 语义分离（反对原“静默 effective key”方案）：**
  1. `turnId` 只表示问询 Drawer 打开态。
  2. `key` 才是调用流水 / CSV 的检索键。
  3. 当进入 `view=calls` 且 URL 含 `turnId`、但**没有**显式 `key` 时，**一次性 seed** `key=<turnId>`（`replace: true`），输入框同步显示该值。
  4. 之后以显式 `key` 为准；用户改 key 不被 `turnId` 覆盖。
  5. 关闭问询 Drawer 只删 `turnId`，**不得**清除 `key`，背景筛选保持。
- 这样深链 `?view=calls&turnId=<id>` 与“关闭 Drawer 仍保留调查范围”同时成立，且不把路由状态伪装成未写入 URL 的隐式筛选。

### 1.3 Time contract

`datetime-local` 永远显示**浏览器本地时间**；API 和 CSV 永远发送 **UTC ISO**：

```ts
function toLocalDateTimeValue(date: Date): string {
  const localMs = date.getTime() - date.getTimezoneOffset() * 60_000;
  return new Date(localMs).toISOString().slice(0, 16);
}

function localDateTimeValueToIso(value: string): string | undefined {
  return value ? new Date(value).toISOString() : undefined;
}
```

状态中保存本地输入字符串；仅在构造 API query 和 export URL 时转换，避免同一个值同时承担 UI 与传输语义。

**双时区并存（保留现状、写入 Spec 129）：**

- 筛选输入：浏览器本地（`datetime-local`）。
- 表格/Drawer 展示时间：继续 `formatConfigAuditTs` → 固定 `Asia/Shanghai` + `zh-CN`（运维口径）。
- 不在本轮把列表展示改成浏览器本地，也不把筛选输入改成强制上海；验收以 Asia/Shanghai 浏览器为准。

`AuditDateTime` 拆分日期/时刻时，优先对 `formatConfigAuditTs` 的输出做稳健拆分（例如最后一个空白处切开，或 `formatToParts`）；不要假设永远是单一空格且无意外字符。

### 1.4 Interaction contract

- **统计窗口**（24h/7d）：从伪 `role="tablist"` 改为命名 button group + `aria-pressed`。容器上已有 `aria-label="统计窗口"`，保留。
- **访问日志视图**（问询记录 / 调用流水）：保持真正的 tabs（`role="tablist"` + `aria-selected`），本轮不改语义。
- 问询详情提供显式“查看详情”按钮；整行点击可作为鼠标便利能力，但不能是唯一入口；不要给 `<tr>` 伪造 button role。
- 所有 icon-only / 复制按钮保留可读 `aria-label` 和可见 focus ring。
- 复制成功/失败通过现有 Sonner 在右下角反馈；文案区分「问询 ID」与「事件 ID」。
- 可滚动数据区可聚焦，并有说明横向/纵向滚动能力的 accessible name。

### 1.5 Calls column contract（反对原草案后的定稿）

**不得**删除 Spec 106 身份列，**不得**在 L1 调用流水新增服务端未下发的「数据库连接」，**不得**使用英文列名 `Reason`。

调用流水列顺序（调查优先级重排，字段集合与 Spec 106/125 对齐，并含运行时访问上下文）：

```text
序号 | 时间 | 事件 ID | 问询 ID | Agent | 访问上下文 | 状态 | 耗时 | 工具 | 涉及数据表 | 裁决原因 | 调用来源 | 生成 SQL
```

- 「事件详情」入口与 **事件 ID** 同 cell（或紧随其后的早期操作），避免滚到表尾才打开。
- 「表」列头与问询侧对齐为 **涉及数据表**（若本轮改文案，须在 Spec 129 登记对 Spec 106 §6.2 的覆盖）。
- 「数据库连接」留在问询详情 Drawer 调用明细（Spec 94），本轮不动。

问询记录表：在 Spec 106 列集合上**追加**「操作」列（查看详情）；其余列集合不变，只做内容感知布局。

### 1.6 Terminology Compliance

遵循 `webui/docs/00-product-terminology-standard.md` §4.7：

- 页面主术语使用“访问日志 / 问询记录 / 调用流水 / 问询详情 / Trace 详情”。
- ID 使用“问询 ID / 事件 ID”，不新增“会话日志”等近义词。
- 裁决列使用「裁决原因」，不用 `Reason`。
- Agent、Token、MCP、P95、Trace、SQL、Session ID 等专业词保持 `notranslate` 保护规则。
- 新增 aria-label 也采用相同术语，不用内部变量名代替用户语言。
- 来源 badge 继续 `已上报问询` / `推断问询`（与筛选项「用户原始问询 / 系统推断问询」分层，Spec 94）。

## Task 1: Write the remediation contract before code changes

**Files:**

- Create: `webui/docs/129-admin-audit-browser-remediation-spec.md`
- Modify: `webui/docs/design-system/11-components-data-grid.md`
- Reference: `webui/docs/89-admin-audit-turn-drilldown-spec.md`
- Reference: `webui/docs/94-admin-audit-clarity-and-drawer-ux-spec.md`
- Reference: `webui/docs/106-admin-audit-identity-filters-and-url-spec.md`

**Step 1: Create Spec 129**

写明本计划 §1 的 URL、时间、交互、调用流水列契约和 Terminology Compliance，并声明：

- Spec 129 只在“URL 上下文、时间转换、列表可操作性、Trace 空状态、宽表滚动、调用流水列**顺序**”方面补充或覆盖 Spec 89/94/106。
- 不改变 Spec 106 的筛选字段和服务端查询含义；**不删除** Spec 106 身份列（序号 / 事件 ID / 问询 ID）。
- 调用流水列顺序按 §1.5；明确「数据库连接」仍仅属于问询详情 Drawer（Spec 94），L1 不新增。
- 问询记录表采用内容感知列契约：问询 ID 完整显示并在固定上限内自然断行；开始/结束时间均为“日期在上、时刻在下”；来源列设置 `6.5rem` 最小宽度，来源 badge 不在词内或逐字换行；**追加**「操作」列。
- 新增“清除筛选”只在至少一个非默认筛选生效时出现；清除时同步清空 `lucy:webui:audit:filters:v3` 快照中的筛选字段，避免下次空 URL 水合把旧筛选写回。
- 登记 `turnId` → seed `key` 的一次性行为，避免实现时再发明隐式 effective key。

**Step 2: Extend the data-grid design-system contract**

在数据网格规范中增加“高且宽的数据表”章节：

- 使用单一 `overflow: auto` 有界容器，不嵌套横向和纵向滚动区。
- 容器可聚焦、有 accessible name；表头在容器内 sticky。
- 1280px 桌面端允许横向滚动，不压缩 ID、SQL 到不可读。
- 横向滚动条必须在当前 viewport 内可触达，不能要求用户先滚过整页 50 行。
- ID 列允许在字符边界自然断行，不能使用 `truncate` 隐藏主键；日期时间列允许用上下两行减少横向占用；状态/badge 类单元格应有合理的最小宽度并保持短语完整。

**Step 3: Review terminology and conflicts**

Run:

```bash
cd webui
npm run lint:terminology
```

Expected: exit 0；Spec 中没有受禁术语或未保护的专业词。

**Step 4: Commit**

```bash
git add webui/docs/129-admin-audit-browser-remediation-spec.md webui/docs/design-system/11-components-data-grid.md
git commit -m "docs(audit): define browser remediation contract"
```

## Task 2: Separate local time input from UTC API values

**Files:**

- Modify: `webui/src/pages/admin/Audit.tsx`
- Modify: `webui/src/__tests__/admin-audit-turns.test.tsx`

**Step 1: Add failing time-zone regression tests**

在 `admin-audit-turns.test.tsx` 冻结系统时间并覆盖两个方向：

```ts
vi.useFakeTimers();
vi.setSystemTime(new Date("2026-08-26T05:03:00.000Z"));
```

以 `TZ=Asia/Shanghai` 运行时断言：

- 24 小时窗口的开始输入显示 `2026-08-25T13:00`，不是 `2026-08-25T05:00`。
- 请求 URL 中的 `since` 为 `2026-08-25T05:00:00.000Z`。
- 用户输入 `2026-08-25T14:30` 后，请求和 CSV URL 使用 `2026-08-25T06:30:00.000Z`。
- 测试结束恢复 real timers。

Run:

```bash
cd webui
TZ=Asia/Shanghai npx vitest run src/__tests__/admin-audit-turns.test.tsx --maxWorkers=1
```

Expected: 新断言先失败，失败值体现 UTC 文本被直接放进 `datetime-local`。

**Step 2: Implement pure conversion helpers**

在 `Audit.tsx` 顶部的时间 helper 区域：

- 将 `sinceIsoFromHours(...).slice(0, 16)` 替换为 `sinceLocalFromHours()`。
- 添加 `toLocalDateTimeValue()` 和 `localDateTimeValueToIso()`。
- helper 接受可选 `now`，便于测试且不引入第三方日期库。
- `since` / `until` state 继续存储 `YYYY-MM-DDTHH:mm` 本地字符串。

**Step 3: Convert only at transport boundaries**

在 turns query、calls query、turn count query 与 export URL 构造处统一使用：

```ts
const sinceIso = localDateTimeValueToIso(since);
const untilIso = localDateTimeValueToIso(until);
```

不要把 UTC 值再写回 input state。

**Step 4: Run focused tests**

```bash
cd webui
TZ=Asia/Shanghai npx vitest run src/__tests__/admin-audit-turns.test.tsx --maxWorkers=1
```

Expected: pass，且现有 24h/7d、筛选、CSV 测试不回归。

**Step 5: Commit**

```bash
git add webui/src/pages/admin/Audit.tsx webui/src/__tests__/admin-audit-turns.test.tsx
git commit -m "fix(audit): preserve local time semantics"
```

## Task 3: Preserve URL context across calls and nested drawers

**Files:**

- Modify: `webui/src/pages/admin/Audit.tsx`
- Modify: `webui/src/components/ObjectDetailDrawer.tsx`
- Modify: `webui/src/__tests__/admin-audit-turns.test.tsx`
- Modify: `webui/src/__tests__/object-detail-drawer.test.tsx`
- Reference: `webui/src/lib/objectDetail.ts`

**Step 1: Add failing deep-link tests**

增加以下回归用例：

1. 初始 URL 为 `?range=24h&view=calls&turnId=lucy_test` 且无 key 时，组件在一次 `replace` 后 URL 含 `key=lucy_test`；随后 calls API 与 CSV href 都带 `key=lucy_test`。
2. URL 已有显式 `key=manual` 时，以 `manual` 为准，不被 `turnId` 覆盖或改写。
3. 关闭问询 Drawer 后 URL 去掉 `turnId`，但 **保留** `key`（以及 `range`/`view`）；背景仍是筛选后的调用流水。
4. 从调用流水点击事件详情后，URL 同时保留 `range=24h&view=calls&key=manual`，并新增 `object=auditEvent&eventId=92`。
5. 关闭对象 Drawer 后，只移除 `object/eventId`，背景仍是同一个调用流水筛选结果。
6. 审计事件对象不展示误导性的通用“打开完整页面 →”链接；改成上下文内关闭/返回，不导航到裸 `/admin/audit`。

Run:

```bash
cd webui
npx vitest run src/__tests__/admin-audit-turns.test.tsx src/__tests__/object-detail-drawer.test.tsx --maxWorkers=1
```

Expected: query preservation、key seed 与 close 断言先失败。

**Step 2: Seed key from turnId when missing**

在 `Audit` 组件中用 effect（或等价一次同步）实现 §1.2：

```ts
// when tab === "calls" && turnId && !keySearch → setSearchParams key=turnId (replace)
```

调用流水请求和 CSV 导出只使用 URL 中的 `key`（即 `keySearch`），**不再**维护单独的隐式 `effectiveCallsKey`。输入框显示 `keySearch`。

打开问询 Drawer（`openTurnDrawer`）在 `view=calls` 且当前无 key 时，可一并写入 `key`，与深链 seed 行为一致。

**Step 3: Merge object-detail parameters**

- 将 `Audit.tsx` 中审计事件链接从 `buildObjectDetailSearch(...)` 改为已有 `mergeObjectDetailSearch(searchParams, target)`。
- 如果 `EntryRow` 无法访问当前 query，父组件传入已构造的 `auditEventHref` 或一个纯函数 callback；不要让行组件自己读取全局 location。
- 保持 `ObjectDetailDrawer.close()` 使用 `clearObjectDetailSearch()`。

**Step 4: Make the audit-event footer context-aware**

在 `ObjectDetailDrawer.tsx` 中对 `auditEvent` 分支隐藏通用 deep-link footer，或显示一个不导航的“返回调用流水”关闭动作。其他 `table` / `agent` / `evalRun` 对象保持现状。

**Step 5: Run focused tests**

```bash
cd webui
npx vitest run src/__tests__/admin-audit-turns.test.tsx src/__tests__/object-detail-drawer.test.tsx --maxWorkers=1
```

Expected: pass；close 后 URL 仍含审计列表上下文。

**Step 6: Commit**

```bash
git add webui/src/pages/admin/Audit.tsx webui/src/components/ObjectDetailDrawer.tsx webui/src/__tests__/admin-audit-turns.test.tsx webui/src/__tests__/object-detail-drawer.test.tsx
git commit -m "fix(audit): retain investigation context in drawers"
```

## Task 4: Make primary audit actions keyboard-accessible and observable

**Files:**

- Modify: `webui/src/pages/admin/Audit.tsx`
- Modify: `webui/src/__tests__/admin-audit-turns.test.tsx`

**Step 1: Add failing interaction tests**

覆盖：

- 每条问询记录有可聚焦的“查看详情”按钮。
- Tab 到该按钮后按 Enter 可打开“问询详情”。
- 时间范围容器有 `aria-label="统计窗口"`，当前范围按钮 `aria-pressed="true"`。
- 高级筛选按钮包含 `aria-expanded` 和 `aria-controls`。
- Agent、摘要、工具名、Session ID、起止时间控件都有稳定的 label/aria-label。
- 复制问询 ID 成功调用 `toast.success`；clipboard reject 时调用 `toast.error`。

Run:

```bash
cd webui
npx vitest run src/__tests__/admin-audit-turns.test.tsx --maxWorkers=1
```

Expected: 新的 role/name、pressed state 和 toast 断言先失败。

**Step 2: Add explicit row actions**

- 问询表新增“操作”列和 `查看详情` button。
- 复用现有 `openTurnDetail(turnId)`；按钮点击时阻止 row click 冒泡。
- 若保留整行 click，只作为鼠标便利能力；不要给 `<tr>` 伪造 button role。
- 更新 loading/empty `colSpan`。

**Step 3: Add accessible control states**

- 时间范围从伪 `role="tablist"` 调整为命名的 button group；按钮使用 `aria-pressed`；保留 `aria-label="统计窗口"`。
- 视图切换（问询记录 / 调用流水）保持 tabs + `aria-selected`。
- 高级筛选区域分配稳定 id，并连接 `aria-controls` / `aria-expanded`。
- 为只依赖 placeholder 的输入补充 label（工具名、Session ID、搜索摘要等）；可使用视觉隐藏 label，不能仅通过 test id 补救。

**Step 4: Add copy feedback**

在 `CopyableId` 中使用现有 Sonner：

```ts
void navigator.clipboard.writeText(value)
  .then(() => toast.success("已复制问询 ID"))
  .catch(() => toast.error("复制失败，请重试"));
```

组件需接收可读对象名，以便事件 ID、问询 ID 使用正确反馈文案。

**Step 5: Run focused tests**

```bash
cd webui
npx vitest run src/__tests__/admin-audit-turns.test.tsx --maxWorkers=1
```

Expected: pass，且鼠标 row click 的既有测试仍通过。

**Step 6: Commit**

```bash
git add webui/src/pages/admin/Audit.tsx webui/src/__tests__/admin-audit-turns.test.tsx
git commit -m "fix(audit): expose accessible detail and copy actions"
```

## Task 5: Repair Trace drawer layout and empty states

**Files:**

- Modify: `webui/src/pages/admin/Audit.tsx`
- Modify: `webui/src/app/app.css`
- Modify: `webui/src/__tests__/admin-audit-trace-drawer.test.tsx`
- Modify: `webui/src/__tests__/admin-audit-trace-link.test.tsx`

**Step 1: Add failing drawer tests**

断言：

- Trace Dialog 有 accessible name 和 modal semantics。
- header 使用 `pl-trace-detail-header--toolbar`，关闭按钮与标题处于同一 header。
- 0 Span / 0 Evidence 时显示明确空状态：`该 Trace 暂无 Span 或 Evidence 记录。`
- 空状态不生成占满抽屉高度的空 grid track。
- 嵌套问询 Drawer → Trace Drawer 时，第一次 Escape 只关闭 Trace，focus 返回触发链接；第二次 Escape 再关闭问询 Drawer。

Run:

```bash
cd webui
npx vitest run src/__tests__/admin-audit-trace-drawer.test.tsx src/__tests__/admin-audit-trace-link.test.tsx --maxWorkers=1
```

Expected: toolbar class、空状态和 modal 断言先失败；已有 focus restore 测试保持绿灯。

**Step 2: Use the established drawer toolbar pattern**

- Trace header 与 Turn Detail header 统一使用 `pl-trace-detail-header pl-trace-detail-header--toolbar`。
- close button 放在 `Dialog.Title` 同行，继续使用明确 `aria-label="关闭 Trace 详情"`。
- `Dialog.Content` 的 modal 语义以浏览器可观测 DOM 为准；Radix 已提供时**不要**为了断言而重复硬编码冲突属性。

**Step 3: Add bounded empty-state styling**

在 `app.css` 添加审计 Drawer 专用空状态 class：

- 使用内容区内的短卡片/提示块，不设置 `height: 100%`。
- 文案同时覆盖 Span 与 Evidence，避免统计为 0 但提示只提 Span。
- 保留当前 Drawer 自身滚动，不引入第二个全高滚动容器。

**Step 4: Run tests**

```bash
cd webui
npx vitest run src/__tests__/admin-audit-trace-drawer.test.tsx src/__tests__/admin-audit-trace-link.test.tsx --maxWorkers=1
```

Expected: pass。

**Step 5: Commit**

```bash
git add webui/src/pages/admin/Audit.tsx webui/src/app/app.css webui/src/__tests__/admin-audit-trace-drawer.test.tsx webui/src/__tests__/admin-audit-trace-link.test.tsx
git commit -m "fix(audit): tighten trace drawer empty state"
```

## Task 6: Make wide audit tables usable inside the viewport

**Files:**

- Modify: `webui/src/pages/admin/Audit.tsx`
- Modify: `webui/src/app/app.css`
- Modify: `webui/src/__tests__/admin-audit-turns.test.tsx`

**Step 1: Add failing structure tests**

断言两个表格容器：

- 使用统一 `pl-audit-grid-scroll` class。
- `tabIndex={0}`、`role="region"`，名称分别为“问询记录表格，可横向和纵向滚动”和“调用流水表格，可横向和纵向滚动”。
- 调用流水前五组核心调查列在序号之后为：`时间 / 事件 ID / 问询 ID / Agent / 访问上下文`（完整顺序见 §1.5）；不得断言不存在的「数据库连接」或 `Reason`。
- 问询 ID cell 使用专用 `pl-audit-turn-id-cell`，复制按钮保留完整 ID 文本和 `aria-label="复制问询 ID …"`，不再带 `truncate` / `whitespace-nowrap`。
- 开始时间、结束时间均由 `AuditDateTime` 渲染为两个可断言的元素：`data-part="date"` 在上、`data-part="time"` 在下。
- 来源 header/cell 使用 `pl-audit-turn-source-cell`；badge 保持 `whitespace-nowrap`，避免 `已上报问询` 被拆成多行。
- 至少一个筛选项生效时出现“清除筛选”，点击后回到当前 range/view 的默认筛选，不关闭已由 URL 指定的 Drawer；并清空 filter localStorage 快照中的对应字段。

Run:

```bash
cd webui
npx vitest run src/__tests__/admin-audit-turns.test.tsx --maxWorkers=1
```

Expected: scroll region、问询 ID 换行策略、日期/时刻分行、来源列宽、列顺序和清除动作断言先失败。

**Step 2: Introduce one bounded scroll frame**

将两个现有 `overflow-x-auto` wrapper 换成同一个审计表格容器。CSS 目标：

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
```

实现时使用项目现有颜色 token 为 sticky header 设置不透明背景，不写裸色值；focus-visible 使用 design system 现有 focus token。

**Step 3: Reorder calls columns by investigation priority**

按 §1.5 / Spec 129 顺序调整 header 和 `EntryRow` cell，保持字段内容、排序和 API 不变。事件详情入口与事件 ID 放在同一个早期 cell，避免必须滚到表尾才能打开。不得引入「数据库连接」L1 列。

**Step 4: Give the turn table content-aware column layouts**

在 `Audit.tsx` 增加复用组件，避免开始/结束时间各自手写拆分逻辑：

```tsx
function AuditDateTime({ value }: { value: string }) {
  const formatted = formatConfigAuditTs(value);
  const [date, ...timeParts] = formatted.split(" ");
  return (
    <span className="pl-audit-date-time">
      <span data-part="date">{date}</span>
      <span data-part="time">{timeParts.join(" ") || "—"}</span>
    </span>
  );
}
```

替换问询记录中开始/结束时间的单行 `formatConfigAuditTs(...)`，并在 `app.css` 增加：

```css
.pl-audit-date-time {
  @apply grid min-w-[5.5rem] whitespace-nowrap tabular-nums leading-4;
}

.pl-audit-date-time [data-part="time"] {
  @apply text-fg-muted;
}

.pl-audit-turn-id-cell {
  width: 14rem;
  min-width: 11rem;
  max-width: 14rem;
}

.pl-audit-turn-id-cell .pl-audit-id-copy {
  @apply block max-w-none whitespace-normal break-all leading-4;
}

.pl-audit-turn-source-cell {
  min-width: 6.5rem;
}

.pl-audit-turn-source-cell .pl-status-badge {
  @apply whitespace-nowrap;
}
```

同时：

- 问询 ID 的 DOM 保留完整文本，不使用省略号；长 ID 预计在 1280px 下自然排成约两行。
- `CopyableId` 的 clipboard + toast 行为复用 Task 4，不另建复制组件。
- 只对问询表的来源列加宽，不全局放大所有 status badge。
- 不压缩问询摘要到不可读；总宽超出时由 `pl-audit-grid-scroll` 接管横向滚动。

**Step 5: Add an explicit clear-filters action**

- 生效条件包括 Agent、key、工具名、Session ID、状态、时间自定义值等非默认筛选。
- 清除时保留 `range`、`view`，并按 §1.2 谨慎保留当前 Drawer 参数（`turnId` / `object`/`eventId`）。
- 同步清理 `AUDIT_FILTER_STORAGE_KEY`（`lucy:webui:audit:filters:v3`）中的筛选字段，避免空 URL 回访时被 storage 水合重新污染。
- 不使用 `window.location` 刷新；更新本地 state / search params，让 React Query 自然重取。
- 注意：当前 `FILTER_PERSIST_FIELDS` 含 `turnId`；清除筛选**不要**误删正在打开的 Drawer `turnId`，除非产品明确要求连 Drawer 一起关（默认保留）。

**Step 6: Run focused tests**

```bash
cd webui
npx vitest run src/__tests__/admin-audit-turns.test.tsx --maxWorkers=1
```

Expected: pass。

**Step 7: Commit**

```bash
git add webui/src/pages/admin/Audit.tsx webui/src/app/app.css webui/src/__tests__/admin-audit-turns.test.tsx
git commit -m "fix(audit): keep wide grids operable in viewport"
```

## Task 7: Add browser regression coverage and run delivery gates

**Files:**

- Create: `webui/tests/e2e/specs/admin-audit-browser-remediation.spec.ts`
- Modify if selectors are added: `webui/docs/qa/selector-contract.md`
- Modify if selector registry requires it: `webui/scripts/check-selector-contract.mjs`
- Verify: `webui/src/pages/admin/Audit.tsx`
- Verify: `webui/src/components/ObjectDetailDrawer.tsx`
- Verify: `webui/src/app/app.css`

**Step 1: Add a focused Playwright spec**

使用当前 E2E fixture，不连接真实项目数据。测试标记 `@pr-impacted`，覆盖：

1. `?range=24h&view=calls` 的范围状态可读，调用流水表滚动区域在 viewport 内，sticky header 可见。
2. `?range=24h&view=calls&turnId=<fixture-id>` 自动 seed `key`，背景列表受问询 ID 约束；关闭问询 Drawer 后 key 仍在。
3. 从调用流水打开事件对象，再关闭，URL 的 range/view/key 不变。
4. 键盘 Tab + Enter 打开问询详情；复制 ID 出现 toast。
5. 打开空 Trace 时关闭按钮位于 Drawer 顶部；Escape 关闭顶层并恢复 focus。
6. 问询记录在 1440 与 1280 两档都完整显示可复制的问询 ID；开始/结束时间日期在上、时刻在下；`已上报问询` 保持单行。
7. 调用流水在窄桌面下无需滚到表尾即可看到状态/耗时，并仍保有事件 ID 与问询 ID 列。

不要依赖像素坐标或中文 DOM 顺序；优先 role/name 和 selector contract。

**Step 2: Run focused unit tests**

```bash
cd webui
npx vitest run \
  src/__tests__/admin-audit-turns.test.tsx \
  src/__tests__/admin-audit-trace-drawer.test.tsx \
  src/__tests__/admin-audit-trace-link.test.tsx \
  src/__tests__/object-detail-drawer.test.tsx \
  --maxWorkers=1
```

Expected: all pass。

**Step 3: Run static and build gates**

```bash
cd webui
npm run lint:terminology
npm run lint:ia-boundary
npm run e2e:selector-contract
npm run build
```

Expected: 全部 exit 0；Vite build 无 TypeScript/build error。

**Step 4: Run the targeted browser suite at both desktop widths**

初始化隔离 fixture 后运行现有两个 Chromium 桌面项目：

```bash
cd webui
npm run e2e:fixture
npx playwright test tests/e2e/specs/admin-audit-browser-remediation.spec.ts --project=chromium
npx playwright test tests/e2e/specs/admin-audit-browser-remediation.spec.ts --project=chromium-narrow
```

Expected: 1440×900 与 1280×800 均通过；不得把 `LUCY_E2E_PROJECT_DIR` 指向真实 `/Users/zhangxingchen/Projects/project-lucy`。

**Step 5: Manual browser acceptance against the requested local service**

若 `http://127.0.0.1:55176` 仍在运行，逐一复核：

```text
/admin/audit
/admin/audit?range=24h&view=calls
/admin/audit?range=24h&view=calls&turnId=lucy_d573b7db-73ba-4306-bdca-5ccf0743a36b
```

验收清单：

- [ ] 24h 起始值按 Asia/Shanghai 显示，网络请求仍使用 UTC ISO。
- [ ] 时间范围的当前状态可由 accessible tree 读取。
- [ ] 问询详情可只用键盘打开和关闭，focus 返回触发点。
- [ ] 复制问询 ID / 事件 ID 有成功或失败 toast。
- [ ] 问询 ID 不再显示省略号，长 ID 自然换行且复制结果仍为完整原值。
- [ ] 开始时间、结束时间均为日期在上、时刻在下，日期与时刻没有被截断。
- [ ] 来源列比当前略宽，`已上报问询` / `推断问询` badge 均保持单行。
- [ ] 带 `turnId` 的调用流水会 seed `key`；背景只展示对应调用；关闭 Drawer 后 key 仍在；CSV 口径一致。
- [ ] 打开/关闭事件对象不丢 range/view/key。
- [ ] 空 Trace 不再出现大面积无意义空白，关闭按钮位于标题行。
- [ ] 1280 宽度无需滚到第 50 行底部即可横向滚动；状态、耗时和事件详情可快速触达；序号/事件 ID/问询 ID 仍在。
- [ ] 高级筛选有展开状态和稳定 label；“清除筛选”行为可预测且不被 localStorage 水合打回。
- [ ] console 无新增 error/warning。

**Step 6: Record Design System Compliance**

在交付说明中逐项记录：

- 使用 `pl-data-grid`，未创建第二套表格视觉语言。
- 使用 design-system token，未引入裸色值。
- 复用 `pl-trace-detail-header--toolbar` 与现有 Sonner。
- 只验证桌面 1440/1280；横向滚动符合 desktop-first 策略。
- 所有新增交互都具备键盘、focus-visible 和 accessible name。

**Step 7: Optional enterprise audit sign-off**

只有在本轮目标升级为企业级签字时，回到测试工程并完整执行：

```text
CFG-PKG-01 → CFG-CONN-01 → CFG-WIKI-01 → CFG-ADM-01(prod_min)
→ CFG-MCP-01 → CFG-EVAL-01(full) → CFG-AUDIT-01
```

证据落在 `auto-config/evidence/<TASK_ID>/<yyyymmdd-hhmm>/`，不得跳过 PKG/CONN，不把 Token 明文写入 `auto-config/`。

**Step 8: Commit**

```bash
git add webui/tests/e2e/specs/admin-audit-browser-remediation.spec.ts webui/docs/qa/selector-contract.md webui/scripts/check-selector-contract.mjs
git commit -m "test(audit): cover browser remediation flows"
```

仅 add 实际发生变更的 selector contract 文件；不要制造空白改动。

## Final verification matrix

| Area | Automated proof | Browser proof |
|---|---|---|
| Local time ↔ UTC | Vitest frozen-time request/export assertions | 24h input and network query inspection |
| Direct turn deep-link | Vitest key-seed + close-keeps-key assertions | Background row count matches key; drawer close keeps filter |
| Object Drawer context | Vitest query merge/clear assertions | Open/close URL remains on calls view |
| Keyboard and copy | Testing Library role/keyboard/toast tests | Tab/Enter/Escape + visible toast |
| Trace empty state | Drawer unit tests | Header close placement and compact empty card |
| Turn-table column layout | ID/full-copy + date/time parts + source-width tests | 1440/1280 下 ID 换行、时间上下排、来源单行 |
| Wide tables | DOM/class/column-order tests | 1440 and 1280 in-viewport horizontal scroll |
| Terminology/design | terminology + IA lint + build | visual and accessible tree review |

## Rollback strategy

- 每个 Task 单独提交，出现回归时按 Task 粒度 revert，不使用 `git reset --hard`。
- 时间 helper、URL merge、Drawer 布局、表格 CSS 彼此解耦；不得通过回滚整个审计页面覆盖工作树中的用户改动。
- 若列顺序引发运营口径争议，可仅回滚 Task 6 的列重排，保留有界滚动和可访问性改进。
