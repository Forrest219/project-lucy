# Help Center Feedback

本页记录 `/help`（系统手册）相关 UI/UX 反馈。

## UX-HELP-001: 系统手册页头未复用统一 PageHeader 组件

Status: Fixed
Route: `/help`
Area: Header implementation consistency
Severity: P3
Reported: 2026-08-05

### Feedback
`/help` 页头仍在 `HelpCenter.tsx` 内手写 `pl-page-header` 结构，未复用 `PageHeader` 组件；虽然当前无冗余条数 badge，但组件实现路径与全站一级/二级页面不一致，后续样式演进存在漂移风险。

### Evidence
- 代码：`webui/src/pages/HelpCenter.tsx` 使用 `<header className="pl-page-header">` 手写 breadcrumbs/badges/title/actions。
- 检查结论：右上角为“来源路径 + 更新时间”上下文信息，不属于纯计数冗余。

### Expected
后续 wave 评估是否收敛到统一 `PageHeader` 组件，或明确将 `/help` 作为特殊页保留手写实现并补充维护规则。

### Browser Check
1. Open `/help`.
2. Verify header contains title/description/context/actions and no count badge.
3. Verify no duplicate page-title chips in top-right corner.

### Notes
Spec 92 / `wo-202608-25` 已落地：`HelpCenter.tsx` 改为复用 `PageHeader` 组件（本轮不做浏览器验证，仅 code review）。

## UX-HELP-002: 面包屑末项与 H1 重复（“系统手册”双重出现）

Status: Fixed
Route: `/help`
Area: Header information hierarchy
Severity: P2
Reported: 2026-08-05

### Feedback
页头同时出现 `系统帮助 / 系统手册` 与 H1 `系统手册`，末项与标题重复，形成可见冗余。

### Evidence
- 代码：`HelpCenter.tsx` 手写 breadcrumbs 末项固定为“系统手册”，且 H1 也是“系统手册”。
- 统一规则参考：`PageHeader` 标准中同名末项应抑制 breadcrumbs，避免标题重复。

### Expected
二选一：
1. 复用统一 `PageHeader` 并使用同名抑制规则；
2. 保留手写实现但删除末项同名 breadcrumb（或只保留“系统帮助”单项）。

### Browser Check
1. Open `/help`.
2. Verify header no longer shows duplicated “系统手册” at both breadcrumb tail and H1.

### Notes
Spec 92 / `wo-202608-25` 已落地：breadcrumbs 收敛为单项“系统帮助”，去除末项同名重复（本轮不做浏览器验证）。

## UX-HELP-003: 顶部返回动作语义与落点不一致

Status: Fixed
Route: `/help`
Area: Header action semantics
Severity: P3
Reported: 2026-08-05

### Feedback
按钮文案为“返回工作台”，但路由跳转到 `/`（当前会重定向到 `/catalog`），与全局“系统概览 /overview”心智不一致；用户容易误解为返回首页总览。

### Evidence
- 代码：`HelpCenter.tsx` 使用 `<Link ... to=\"/\">返回工作台</Link>`。
- 现网导航：品牌区主返回是“返回系统概览”，help 页动作语义与其不一致。

### Expected
明确统一策略：
1. 若期望返回总览：文案/路由统一到“返回系统概览”→`/overview`；
2. 若期望返回语义资产：文案明确“返回语义资产”→`/catalog`。

### Browser Check
1. Click header action on `/help`.
2. Verify destination matches button text semantics.

### Notes
Spec 92 / `wo-202608-25` 已落地：动作改为“返回系统概览”并跳转 `/overview`（本轮不做浏览器验证）。

## UX-HELP-004: 系统手册缺少关键词搜索，连接 KPI 术语无处可查

Status: Fixed
Route: `/help`
Area: Handbook search / connection KPI glossary
Severity: P2
Reported: 2026-08-05

### Feedback
`/help` 仅有 TOC 跳转，无法按 UI 文案搜索。连接概览「已发现表数」等 KPI 术语不在手册字面中，用户不知道去哪里查。

### Expected
1. `/help` 支持手册内关键词搜索，结果跳转 `?section=`。
2. 手册写明「已发现表数 / 已启用表数 / 服务器目录已发现表 / 未启用表」含义。

### Notes
Spec 111 / `wo-202608-44` 已落地：`GET /api/help/search` + HelpCenter 搜索 UI + 手册「连接概览指标说明」（本轮不做浏览器验证，仅 code review）。
