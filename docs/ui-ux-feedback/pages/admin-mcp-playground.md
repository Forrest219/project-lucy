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
