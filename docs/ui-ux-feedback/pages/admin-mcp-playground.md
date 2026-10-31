# Admin MCP Playground Feedback

本页记录 `/admin/mcp-playground`（MCP 调试台）相关 UI/UX 反馈。条目随 Spec 99 / `wo-202608-32` 落地后更新状态。

## UX-ADMIN-MCP-PLAYGROUND-001: 缺少协议级 ACL 调试面

Status: Fixed
Route: /admin/mcp-playground
Area: 访问治理 / MCP 调试台
Severity: P0
Reported: 2026-08-05

### Feedback
运维与接入协作者无法在 WebUI 内对选定 Agent 预览 MCP 工具 ACL 裁决（允许/拒绝 + `decision_reason`），只能依赖外部客户端试错；访问日志中的裁决原因亦偏机器码。

### Expected
- 侧栏「访问治理」提供 `MCP 调试台`。
- 默认 **ACL 裁决预览**：选择 Agent / 工具 / 参数后返回与 Proxy 一致的裁决与中文原因，并给出 Role/Agent/审计修复深链。
- 访问日志调用流水与 Drawer 裁决原因主行中文化、次行保留机器码。
- 不引入内嵌 LLM；Token 不落盘。

### Browser Check
1. Open `/admin/mcp-playground` from sidebar.
2. Select an enabled Agent and a forbidden tool; run preview; verify Chinese decision reason + remediation links.
3. Open `/admin/audit?tab=calls` and confirm decision reason column shows Chinese primary label.
4. From Agent detail, follow deep link and verify `agentId` is prefilled.

### Notes
- Spec: `webui/docs/99-mcp-playground-acl-decision-visibility-spec.md`
- Plan: `webui/docs/plans/wo-202608-32-mcp-playground-acl-decision-visibility.md`
- Fix（2026-08-05）: `registerMcpPlaygroundRoutes`（acl-preview + tools/list live-smoke）、`DecisionReasonCell`、侧栏/路由/Agent 详情入口、Audit「在调试台复现」。本轮不做浏览器验证，状态保持 `Fixed`。
- Tests: `mcp-playground.test.tsx`、`decision-reason-cell.test.tsx`、`mcp-playground-acl-preview.test.ts`、`navigation.test.ts`、`app-shell.test.tsx`。

## UX-ADMIN-MCP-PLAYGROUND-002: 受控试调写入访问日志后无法区分来源

Status: Fixed
Route: /admin/mcp-playground
Area: 受控试调归因 / 访问日志深链
Severity: P2
Reported: 2026-08-05

### Feedback
用户不清楚权限预览与受控试调是否记日志；试调与真实 Agent 调用混在访问日志中。

### Expected
- DryRun 不写日志；受控试调写日志并标记 `mcp-playground`。
- 试调成功深链打开调用流水并预筛「MCP 调试台受控试调」。

### Notes
- Spec 99 v1.2 §7.3。
- Fix（2026-08-05）: `x-lucy-platform: mcp-playground` + `auditHref` 带 `callSource=playground`。

## UX-ADMIN-MCP-PLAYGROUND-003: 连上检查没有结果，查表结论没有颜色

Status: Fixed
Route: /admin/mcp-playground
Area: 裁决卡
Severity: P1
Reported: 2026-10-19

### Feedback
hehe 检查能不能连上时，问数进程未就绪只显示一行灰字；重新检测的 canary 结果不渲染。检查能不能查某张表时，「允许查这张表」「允许执行」和详情里的 `allowed` 重复，且没有绿/红提示。允许时仍给出「编辑 Role 表范围」。

### Expected
- 未就绪本身是一张黄/红裁决卡，重新检测后换成 pass / fail / blocked 和分项。
- 查表和接入结果写明 Agent 与对象，用绿/红诊断条。允许时不重复访问日志双行，也不给修复主动作。
- 访问日志「允许执行」+ `allowed` 保持不变。

### Notes
- Spec 99 v1.3 §6.6。
- 验证：`mcp-playground.test.tsx`、`decision-reason-cell.test.tsx`。本轮不做 Docker 重建。

## UX-ADMIN-MCP-PLAYGROUND-004: 连上检查把一条连接的查数记录说成通过

Status: Fixed
Route: /admin/mcp-playground
Area: 裁决卡
Severity: P1
Reported: 2026-10-19

### Feedback
重新检测 `demo-mysql` 后，黄条写「重新检测通过了这条连接」，下一句又说 `invest-db` 没加载。五项机器名与标题并列，其中一项写明这次检查不证明连接已加载。按钮「重新检测」再次打到已经有查数记录的 `demo-mysql`。

### Expected
- 未就绪时标题保持「还不能检查能不能连上」。补充只点名还挡住的连接。
- 没有加载记录写成「还没有 {连接} 的加载记录」。「没加载」只用于确认未加载。
- 按钮为「检测 {连接}」。先检测确认未加载的连接，再检测没有加载记录的连接。
- 刚检测的连接和查数记录收在「这次检测了什么」。机器名、reload 编号和 UTC 时间收在「技术详情」。
- 全部连接都有记录后，绿条为「可以检查能不能连上」，并出现 Token。

### Notes
- Spec 99 v1.4 §6.6。
- 验证：`mcp-playground.test.tsx`。本轮不做 Docker 重建。
- 后续（v1.5）：分项折叠仍让用户读到探测清单。连上检查改为只回答能连上或不能连上。见 UX-ADMIN-MCP-PLAYGROUND-005。

## UX-ADMIN-MCP-PLAYGROUND-005: 连上检查展示探测清单

Status: Fixed
Route: /admin/mcp-playground
Area: 裁决卡
Severity: P1
Reported: 2026-10-19

### Feedback
「这次检测了什么」和「技术详情」把配置、Catalog reload、生效权限、问数进程和查数记录摊开。用户要的是能连上或不能连上。没有加载记录时仍出现黄条「还不能确认 demo-mysql 是否已加载」。

### Expected
- 没有加载记录、也无法自省时不出现裁决卡，直接给出 Token。
- 确认未加载：不能连上。问数进程还没加载该连接。按钮「检测 {连接}」。
- 问数进程不可用：不能连上。问数进程不可用。
- 受控试调成功为「{Agent}能连上」，失败为「{Agent}不能连上」加一句原因。
- 连上检查不渲染探测分项。查表拒绝仍保留裁决原因码。

### Notes
- Spec 99 v1.5 §6.6。
- 验证：`mcp-playground.test.tsx`。本轮不做 Docker 重建。

## UX-ADMIN-MCP-PLAYGROUND-006: 未选 Agent 时页面是空的，选中后状态用英文芯片

Status: Open
Route: /admin/mcp-playground
Feedback: 2026-10-30 走查。未选择 Agent 时主工作区是空的。选择后，状态芯片是 Config、Catalog、Policy Runtime、MCP Execution。主按钮是「重载执行层」。
Expected: 未选择时，空态在面板内并指出要先选择 Agent。状态芯片使用中文产品文案。
Browser Check: 发版走查打开调试台并选择已有 Agent。不粘贴 Token，不执行检查。
