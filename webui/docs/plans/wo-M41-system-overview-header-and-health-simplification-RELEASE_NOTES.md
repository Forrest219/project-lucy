# M41 System Overview Header And Health Simplification — Release Notes

| 元数据 | 内容 |
|---|---|
| 工单号 | M41 |
| 类型 | UX Polish / Frontend |
| 影响面 | `/overview` 路由（Onboarding 页面） |
| Breaking Change | 无；语义层 token 计数口径对外收紧，但 UI 暴露面只有「活跃 → 可用」一处文案变更 |
| Backout | `git revert` 即可（详见 SPEC §11） |

## 用户可见变化

### /overview 顶部清爽化

| 维度 | Before | After |
|---|---|---|
| 顶部 badges | 4 个（环境 / 上次更新 / KTX / 语义完成） | 0 个 |
| 刷新按钮 | secondary + ▾ 下拉（立即刷新 / 自动刷新） | 单一 secondary（`刷新` ↔ `刷新中...`） |
| 自动刷新入口 | 有（每 60s `setInterval`） | 删除 |
| 「N 活跃 Token」meta 行 | 有 | 删除 |
| 系统状态 | 4 卡片紧凑条 | ready / warning 一句摘要；danger 升级为具体化 alert |
| Endpoint | 顶部展示 env badge | 仅在 MCP 接入区出现 |

### Token 计数语义收紧

| 维度 | Before | After |
|---|---|---|
| 文案 | `活跃 Token` | `可用 Token` |
| 计入规则 | `enabled && !revoked` | `enabled && !revoked && expires_at > now && expires_at 合法字符串` |
| 无效 expires_at | 静默计入 | 保守排除 |
| `demo_huadong_manager`（expires_at=2026-06-24） | 计入 | 截至 2026-08-01 不计入 |

### 系统状态摘要（ready 态）

> Lucy MCP 可用，KTX Runtime 可用；语义覆盖 4/66，Agent 6/7 启用。 · 控制台日志 ↗

### 系统状态摘要（warning 态）

> Lucy MCP 可用，KTX Runtime 可用；语义覆盖 4/66，仍有 62 张表待补。 · 控制台日志 ↗

### 系统状态（danger 态）

高权重 alert，文案按失败组件具体化：

- `系统异常：Lucy MCP 未就绪，请检查 Endpoint 配置。`
- `系统异常：KTX Runtime 不可用，请检查运行时配置。`
- `系统异常：Lucy MCP 与 KTX Runtime 不可用，请检查接入。`

### 保留行为

- 「待处理事项」「质量快照」「访问风险」「MCP 接入」四个主要区块完整保留。
- MCP 接入区的 fallback / 未配置提示保留。
- 复制 MCP 配置 / Drawer 查看 JSON 行为保留。

## 开发可见变化

- `webui/src/lib/opsDashboard.ts` 新增 4 个导出函数：
  - `isTokenAvailable(token, now?)`
  - `availableTokenCount(agents, now?)`
  - `summarizeServiceHealth(mcpReady, ktxAvailable, semantic, agents)`
  - `systemAlertText(mcpReady, ktxAvailable)`
- `ServiceHealthInput.enabledTokenCount` → `availableTokenCount`（破坏性内部字段，调用方已同步）。
- Onboarding 删除：`RefreshMenu` 组件、`autoRefresh` state、`setInterval` effect、`visibilitychange` 监听、`lastUpdatedAt` state、`previousSettledRef`、`AUTO_REFRESH_INTERVAL_MS`、`AUTO_REFRESH_FAILURE_TOAST_THRESHOLD`、`deriveEnvironmentLabel`、`formatTimestamp`。

## 验收

| 项 | 结果 |
|---|---|
| `npx tsc --noEmit` | ✅ |
| `npx vitest run` | ✅ 756 / 756 |
| `npm run lint:terminology` | ✅ 212 文件扫描 |
| `npm run build` | ✅ 846 kB / 164 kB CSS |
| 浏览器视觉（1440 / 1366 px） | 待人类验收 |

## 回滚

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