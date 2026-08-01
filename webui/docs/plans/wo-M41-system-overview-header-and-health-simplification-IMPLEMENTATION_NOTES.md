# WO-M41 System Overview Header And Health Simplification — IMPLEMENTATION_NOTES

| 元数据 | 内容 |
|---|---|
| 工单号 | M41 |
| 标题 | /overview 顶部清爽化 + 可用 Token 语义修正 + 系统状态摘要 |
| 提交人 | Mulan 特工队 |
| 撰写日期 | 2026-08-01 |
| 关联 Spec | `webui/docs/43-system-overview-header-and-health-simplification-spec.md` |
| 关联 Plan | `webui/docs/plans/wo-M41-system-overview-header-and-health-simplification.md` |
| 关联 Clarification | `webui/docs/plans/wo-M41-system-overview-header-and-health-simplification-clarification.md` |
| 上游工单 | M40 PageHeader 标准化（`dbb3894`） |

## 完成情况

T1-T6 全部完成。

### 关键改动

**`webui/src/lib/opsDashboard.ts`**

- 新增 `isTokenAvailable(token, now?)` / `availableTokenCount(agents, now?)` / `summarizeServiceHealth(...)` / `systemAlertText(mcpReady, ktxAvailable)` 四个导出。
- `ServiceHealthInput.enabledTokenCount` → `availableTokenCount`（`buildServiceHealth` 输入字段重命名；accessStatus 用新口径计算）。
- `summarizeServiceHealth` 返回结构化 view model：`{ tone, semantic: { done, total, gap }, agents: { enabled, total, gap } }`；mcp 或 ktx 不就绪时返回 `null`，由 React 层 fallback 到 alert。
- `systemAlertText` 区分 Lucy MCP / KTX Runtime 具体失败组件。

**`webui/src/pages/Onboarding.tsx`**

- 删除 `RefreshMenu` 组件（90 行）。
- 删除 `autoRefresh` state、`setInterval`、`visibilitychange`、`previousSettledRef`、`lastUpdatedAt`、`deriveEnvironmentLabel`、`formatTimestamp`、`AUTO_REFRESH_INTERVAL_MS`、`AUTO_REFRESH_FAILURE_TOAST_THRESHOLD`。
- 删除 PageHeader 顶部 4 个 badges（env / last-updated / KTX / 语义完成）。
- 删除 PageHeader 下方的 `onboarding-active-token-meta` 行。
- 顶部 actions 改为单一 secondary `刷新` 按钮（`data-testid="onboarding-refresh-button"`，文案 `刷新` ↔ `刷新中...`，disabled 由 `coreFetching` 驱动）。
- 新增 `ServiceHealthSummaryView` 组件（结构化 JSX，`Lucy MCP` / `KTX Runtime` / `Agent` / 数字均加 `notranslate`）。
- `isDanger = !mcpReady || !ktxAvailable`（替代原 `overall === "danger"`，确保 Lucy MCP 不可用时也升级为 alert）。
- 「访问风险」区文案：`{availableTokenCountValue} 个可用 Token`。
- 「MCP 接入」facts：`Token: N 可用`。
- `mcpAccessReason(agents, availableTokenCount)` 函数参数重命名同步。
- 删除旧 `ServiceHealthStrip` 在 `/overview` 的渲染；保留组件实现供其它 surface 使用。

**`webui/src/__tests__/onboarding.test.tsx`**

- 删除基于 `onboarding-env-badge`、`onboarding-last-updated`、`onboarding-refresh-menu-*`、`自动刷新`、`活跃 Token` 的旧断言。
- `summarizes the M39 system overview surface` → `summarizes the M41 ...`：scope 到 `data-testid="page-header"`，断言 header 内不出现 环境/上次更新/KTX/语义完成/自动刷新/活跃 Token；断言 refresh button 无 `aria-haspopup` / 无 ▾。
- `renders the M39 ops dashboard sections` → 顶部清爽化断言同上 + 摘要行存在 + 「可用 Token」存在。
- `shows 刷新中… while any core query is fetching and 刷新 when idle`：用延迟 fetch mock 让 in-flight 窗口可见。
- `does not expose an auto-refresh control anywhere on the page`：新断言。
- `does not show a lastUpdatedAt badge anywhere on the page`：新断言。
- `excludes revoked and expired tokens from the 可用 Token count`：注入 enabled/disabled/expired/revoked token，断言访问风险区显示 `1 个可用 Token`、MCP 接入 facts 显示 `Token: 1 可用`。
- `treats unparseable expires_at as NOT available`：注入 `"not-a-date"` 与 `null` expires_at，断言 1 个可用。
- `renders the danger alert with component-specific copy when KTX is unavailable`：注入 `project: { ktxAvailable: false }`，断言 alert 文案含「KTX Runtime 不可用，请检查运行时配置。」，断言无摘要行。
- `renders the danger alert with component-specific copy when Lucy MCP is unavailable`：注入 invalid endpoint，断言 alert 文案含「Lucy MCP 未就绪，请检查 Endpoint 配置。」。
- `M41: a manual 刷新 click refetches core + eval queries without auto-refresh`：替换原 auto-refresh 测试，断言手动点击触发 refetch 且无 auto-refresh menu/last-updated。
- `renderPage` 扩展接受 `project?: { ktxAvailable?: boolean }` 参数。

**`webui/src/__tests__/ops-dashboard.test.ts`**

- 现有 2 个 `buildServiceHealth` 测试用例的 `enabledTokenCount` 字段重命名为 `availableTokenCount`。

### 验证结果

| 项 | 结果 |
|---|---|
| `cd webui && npx tsc --noEmit` | ✅ 通过 |
| `cd webui && npx vitest run` | ✅ 74 个测试文件 / 756 个用例 全绿 |
| `cd webui && npm run lint:terminology` | ✅ 212 文件扫描通过 |
| `cd webui && npm run build` | ✅ 846 kB / 164 kB CSS |
| 视觉验证 1440 / 1366 px | 待人类验收 |

### 边界与限制

- 真实浏览器 1440 / 1366 像素验证本会话未执行（无浏览器交互能力）。人类验收请在本地起 `npm run dev`：
  - 默认 ready 态：顶部仅 H1 + 描述 + 单个 secondary「刷新」按钮；无胶囊。
  - 摘要行：`Lucy MCP 可用，KTX Runtime 可用；语义覆盖 D/T，Agent E/A 启用。 · 控制台日志 ↗`
  - 危险态：仅高权重 alert（不再渲染摘要行）。

### Backout

按 SPEC §11 走：

```bash
# 整体回滚
git revert -m 1 <merge-sha>

# 局部回滚
git checkout <merge-parent-sha> -- \
  webui/src/lib/opsDashboard.ts \
  webui/src/pages/Onboarding.tsx \
  webui/src/__tests__/onboarding.test.tsx \
  webui/src/__tests__/ops-dashboard.test.ts
```

## 任务清单状态

- [x] **T1** `webui/src/lib/opsDashboard.ts`：新增 helpers + 重命名 `buildServiceHealth` 输入字段
- [x] **T2** `webui/src/pages/Onboarding.tsx`：删除 RefreshMenu / autoRefresh；接入 availableTokenCount；刷新按钮改单一 secondary；接入 summary；danger 保留 alert
- [x] **T3** `webui/src/__tests__/onboarding.test.tsx`：12+ 项新断言覆盖
- [x] **T4** `webui/src/__tests__/ops-dashboard.test.ts`：字段重命名
- [x] **T5** `webui/src/app/app.css`：本次未改动（沿用现有 `pl-page-intro` 与 `pl-service-health-critical` token）
- [x] **T6** tsc / vitest / lint:terminology / build 四件套绿