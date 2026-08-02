# WO-M41 System Overview Header And Health Simplification

| 元数据 | 内容 |
|---|---|
| 工单号 | M41 |
| 标题 | /overview 顶部清爽化 + 可用 Token 语义修正 + 系统状态摘要 |
| 来源 Spec | `webui/docs/43-system-overview-header-and-health-simplification-spec.md` |
| 撰写日期 | 2026-08-01 |
| 适用范围 | `webui/src/lib/opsDashboard.ts`、`webui/src/pages/Onboarding.tsx`、`webui/src/__tests__/onboarding.test.tsx`、`webui/src/__tests__/ops-dashboard.test.ts`、必要时 `webui/src/app/app.css` |
| 上游工单 | M40 PageHeader 标准化（已完成，dbb3894） |

## 目标

按 SPEC 落地：

1. 顶部 PageHeader 仅保留 title + description + 单个「刷新」按钮，移除 4 个胶囊 + RefreshMenu 下拉 + 自动刷新入口。
2. 删除 `autoRefresh` 状态、`setInterval`、`visibilitychange`、相关常量与 effect。
3. Token 计数改为「可用 Token」语义，排除 `enabled=false` / `revoked=true` / `expires_at <= now` / 无效 `expires_at` 字符串。
4. 系统状态 ready / warning 态改为一句摘要并替代旧 `ServiceHealthStrip`；danger 保留 alert。
5. MCP 接入区仍是 Endpoint / fallback 提示的唯一位置。
6. 测试更新覆盖上述变更 + 过期 token 排除。

## 任务清单

- [ ] **T1** `webui/src/lib/opsDashboard.ts`：新增 `isTokenAvailable` / `availableTokenCount` / `summarizeServiceHealth`；`summarizeServiceHealth` 返回结构化 view model，mcp / ktx 不就绪时返回 `null`；`buildServiceHealth` 输入改 `availableTokenCount`
- [ ] **T2** `webui/src/pages/Onboarding.tsx`：删除 `RefreshMenu` 组件、`autoRefresh` 状态、`setInterval` / `visibilitychange`、`previousSettledRef`、`lastUpdatedAt`、`deriveEnvironmentLabel`、`formatTimestamp`、顶部 badges、active-token meta 行；接入 `availableTokenCount`；刷新按钮改单一 secondary；ready / warning 态用 `summarizeServiceHealth` 摘要行替代旧 `ServiceHealthStrip`；danger 态仅保留具体化 alert
- [ ] **T3** `webui/src/__tests__/onboarding.test.tsx`：删除旧断言；新增 / 调整顶部清爽化、系统状态摘要替代旧 strip、danger 仅 alert、可用 Token 口径等断言
- [ ] **T4** `webui/src/__tests__/ops-dashboard.test.ts`：新增 `availableTokenCount` + `summarizeServiceHealth` 单测（含 mcp / ktx 不就绪返回 `null`）；更新 `buildServiceHealth` 测试
- [ ] **T5** 必要时 `webui/src/app/app.css`：`pl-page-intro` 加 `data-tone` modifier
- [ ] **T6** tsc / vitest / lint:terminology / build 四件套绿
- [ ] **T7** 落盘 `IMPLEMENTATION_NOTES.md` + `RELEASE_NOTES.md`；commit

## 验收口径

详见 SPEC §6。

## 风险与边界

详见 SPEC §7。

## Backout

按 SPEC §11 走。
