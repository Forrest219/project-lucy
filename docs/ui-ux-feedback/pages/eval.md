# Eval Module Feedback

本页记录质量评测模块（`/eval/*`）相关 UI/UX 反馈。

## UX-EVAL-001: 运行历史 PageHeader 冗余条数 badge

Status: Fixed
Route: `/eval/runs`
Area: PageHeader badges
Severity: P1
Reported: 2026-08-05

### Feedback
右上角 `N / total 条` 与表格空态/行数重复。

### Expected
删除 PageHeader count badge；根容器改 `pl-page-stack`。

### Browser Check
1. Open `/eval/runs`.
2. Verify no count badge in PageHeader; empty state still shows when no runs.

### Notes
Spec 91 / `wo-202608-24` 已落地（本轮不做浏览器验证，待复核后升 Verified）。

## UX-EVAL-002: 评测用例 PageHeader 冗余 case 数 badge

Status: Fixed
Route: `/eval/cases`
Area: PageHeader badges
Severity: P2
Reported: 2026-08-05

### Feedback
Header `N 个 case` 与表尾 `共 N 个 case` 重复；Run 通过率摘要 badge 有独立价值可保留。

### Expected
删除 case 数 badge，保留 `case-list-coverage` Run 摘要；根容器改 `pl-page-stack`。

### Browser Check
1. Open `/eval/cases` with cases loaded.
2. Verify Header has no `N 个 case` badge; table footer count may remain.

### Notes
Spec 91 / `wo-202608-24` 已落地（本轮不做浏览器验证，待复核后升 Verified）。

## UX-EVAL-003: 安全候选页容器与按钮体系分裂

Status: Fixed
Route: `/eval/security-candidates`
Area: Page root container / PageHeader / primary button
Severity: P2
Reported: 2026-08-05

### Feedback
根容器用 `p-6` 而非 `pl-page-stack`；一级页仍传 breadcrumbs；主按钮未走 `pl-btn` 体系。

### Expected
`pl-page-stack`；无 breadcrumbs；「抽取候选」为 `pl-btn pl-btn--primary`。

### Browser Check
1. Open `/eval/security-candidates`.
2. Verify no breadcrumb nav; extract button uses design-system button classes.

### Notes
Spec 91 / `wo-202608-24` 已落地（本轮不做浏览器验证，待复核后升 Verified）。

## UX-EVAL-004: 评测用例域名切换误用 primary 表示选中

Status: Pending
Route: `/eval/cases`
Area: Domain filter / selection control
Severity: P1
Reported: 2026-08-05

### Feedback
域名 Tab 使用 `pl-btn--primary` 表示当前选中、`pl-btn--ghost` 表示未选中，把「选中态」做成了「主按钮」，违反 Design System 按钮层级，并与 Attu segmented 选中分离模式冲突。

### Expected
域名切换改为 `pl-segmented-control` + `--active`；禁止用 primary 表达选中。「新建 Case」保持独立动作按钮。主题：`selection-control not primary`。

### Browser Check
1. Open `/eval/cases` with multiple domains.
2. Verify domain switcher uses segmented control; active item is not `pl-btn--primary`.
3. Switch domain; list filters accordingly.
4. Verify 「新建 Case」 remains a distinct action button.

### Notes
Spec 101 / `wo-202608-34` Phase 2（Draft，待实现）。

## UX-EVAL-005: 评测用例 KPI 缺 ⓘ 且标题层级偏离 Connections

Status: Fixed
Route: `/eval/cases`
Area: Coverage metric grid
Severity: P2
Reported: 2026-08-05

### Feedback
三卡使用裸 16px 标题、无 ⓘ，与 Connections KPI 模板不一致。

### Expected
采用共享 MetricCard：标题行 + ⓘ + 主值 + 副文；保留 `pl-metric-grid--three`。

### Browser Check
1. Open `/eval/cases`.
2. Verify three KPI cards each expose help ⓘ.
3. Verify grid remains three columns on desktop.

### Notes
Spec 103 / `wo-202608-36` 已落地（本轮不做浏览器验证，结束后只做 code review）。

## UX-EVAL-006: 趋势监控 KPI 缺 ⓘ 且健康态整卡 success 染色

Status: Fixed
Route: `/eval/monitor`
Area: Top metric grid / tone
Severity: P2
Reported: 2026-08-05

### Feedback
四卡无 ⓘ；「失败 case=0 / 正常」使用整卡 success 绿底；并挂载未定义 `--default`。

### Expected
共享 MetricCard + ⓘ；健康态无 tone；失败集中用 warning（只染主值）；禁止 `--default`。

### Browser Check
1. Open `/eval/monitor` with empty and with failing data.
2. Verify help ⓘ on all four cards.
3. Verify zero-fail / 正常 path has no green card shell.

### Notes
Spec 103 / `wo-202608-36` 已落地（本轮不做浏览器验证，结束后只做 code review）。
