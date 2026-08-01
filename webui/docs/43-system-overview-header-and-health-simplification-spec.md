# System Overview Header And Health Simplification Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | System Overview Header And Health Simplification Spec |
| 文档类型 | Product / UX / Frontend Spec |
| 版本 | v0.1 |
| 撰写日期 | 2026-08-01 |
| 适用范围 | Lucy WebUI `/overview` 路由（`webui/src/pages/Onboarding.tsx`、`webui/src/lib/opsDashboard.ts`、相关测试） |
| 关联工单 | `webui/docs/plans/wo-M41-system-overview-header-and-health-simplification.md` |
| 事实源 | 截图反馈 + M39 polish v2 后续观察 + 现存 Onboarding RefreshMenu 实现 |
| 关联规范 | `webui/docs/00-product-terminology-standard.md`、`webui/docs/19-system-overview-runtime-monitoring-spec.md`、`webui/docs/27-connection-overview-ops-ux-cleanup-spec.md`、`webui/docs/39-data-agent-ops-platform-global-ux-spec.md`、`webui/docs/41-system-overview-enterprise-ops-polish-spec.md`（如存在）、`webui/docs/42-page-header-standardization-spec.md` |
| 上游工单 | M40（`webui/docs/42-page-header-standardization-spec.md`，已完成） |

## 1. 背景

M39 / M40 之后，`/overview`（`Onboarding.tsx`）顶部信息密度仍偏高。截图反馈与代码复核集中指出五个企业级 SaaS 后台细节问题：

1. **「刷新状态」按钮位置 + 下拉形态突兀**：现 `RefreshMenu` 是一个 secondary 按钮 + ▾ 下拉箭头，里面挂「立即刷新 / 自动刷新」两个 `role="menuitem"`。自动刷新虽然已开发（每 60s 触发 `setInterval` + `visibilitychange`），但用户当前阶段不知道何时自动刷新，本质是超前功能。
2. **「N 活跃 Token」视觉突兀 + 语义不准**：
   - 现 `enabledTokenCount` 只排除 `token.revoked`，没有排除 `token.expires_at < now`。
   - Demo 数据中 `demo_huadong_manager` 的 token `expires_at=2026-06-24T00:00:00Z`，截至 2026-08-01 已过期，仍被计入「活跃」。
3. **顶部胶囊「KTX 可用」「4/66 语义完成」与下方「系统状态 / 质量快照」重复**：同一指标在两处同时出现，浪费顶部视觉权重。
4. **「环境: Local」「上次更新: HH:mm:ss」作为顶部强信息**：环境属 MCP 接入区，上次更新属于反馈而非状态，不应作为胶囊占用标题栏。
5. **「系统状态」紧凑四卡片挤在标题和正文之间**：信息密度高且重复；ready / warning 状态下应改为一句清爽摘要，danger 才升级为 alert。

本规格在 **M40 PageHeader 标准化的基础上**，继续对 `/overview` 做信息层级与 token 语义收敛；不推翻路由、不改 IA、不动控制台定位。

## 2. 决策摘要

| 优先级 | 决策 | 说明 |
|---|---|---|
| P0 | 顶部 badges 全部移除 | 环境 / 上次更新 / KTX / 语义完成 都不再作为 PageHeader 胶囊 |
| P0 | RefreshMenu 改为单一 secondary 按钮 | 文案「刷新」/「刷新中...」；删除下拉箭头、删除 menu 角色、删除自动刷新入口 |
| P0 | 删除 `autoRefresh` 状态、`setInterval`、`visibilitychange` 监听 | 自动刷新作为超前功能移除 |
| P0 | Token 计数语义改为「可用 Token」 | 排除 `enabled === false` Agent、`revoked === true`、`expires_at <= now`；无效 `expires_at` 字符串保守为不可用 |
| P0 | 「系统状态」改为一句摘要 | ready / warning 用一句可读中文摘要替代现有 `ServiceHealthStrip`；danger 仍升级为 alert |
| P1 | MCP 接入区为唯一显示 Endpoint 的位置 | 顶部不再展示 endpoint；fallback / 未配置提示仍留在 MCP 接入区 |
| P1 | 保留最近刷新时间作为弱反馈 | 通过 `toast.success` 传达；不进入顶部胶囊 |

## 3. 目标与非目标

### 3.1 目标

| 目标 | 说明 |
|---|---|
| 顶部清爽 | `/overview` 顶部仅含 title + description + 一个「刷新」按钮 |
| 信息层级清晰 | 顶部不再堆叠状态胶囊；状态信息下沉到正文区 |
| Token 语义真实 | 「可用 Token」真正代表「现在能用来调用 Lucy MCP 的 token 数」 |
| 自动刷新不再超前展示 | UI 上彻底移除入口；保留后端 refetch 能力供测试与后续扩展 |
| 系统状态可读 | 一句摘要让用户 1 秒判断健康度；异常才升级为高权重 alert；不再保留四项紧凑状态条造成重复 |

### 3.2 非目标

- 不修改 `/overview` 路由（仍由 `webui/src/app/App.tsx` `<Route path="/overview" element={<Onboarding />} />`）。
- 不修改 Lucy MCP Proxy 鉴权语义（`webui/docs/07-mcp-auth-proxy-spec.md`）。
- 不修改 KTX 上游 API（`/api/admin/agents` 返回结构）。
- 不新增或删除 `/overview` 上的任何主要区块（待处理事项 / 质量快照 / 访问风险 / MCP 接入全部保留）。
- 不调整 M40 已落地的 PageHeader 组件契约（仅 Onboarding 这一处调用方收敛）。
- 不引入自动刷新相关的新测试场景。

## 4. 组件与状态变更

### 4.1 Onboarding.tsx — 顶部 PageHeader

```diff
  <PageHeader
    title="系统概览"
    description={...}
-   badges={
-     <>
-       <span data-testid="onboarding-env-badge">{environmentLabel}</span>
-       <span data-testid="onboarding-last-updated">{lastUpdatedLabel}</span>
-       <span>KTX {ktxAvailable ? "可用" : "不可用"}</span>
-       <span>{doneSources}/{sources.length} 语义完成</span>
-     </>
-   }
    actions={
-     <div className="pl-page-header-actions pl-page-header-actions--stacked">
-       <RefreshMenu ... />
-     </div>
+     <button
+       type="button"
+       className="pl-btn pl-btn--secondary text-sm"
+       onClick={refreshStatus}
+       disabled={coreFetching}
+       data-testid="onboarding-refresh-button"
+     >
+       {coreFetching ? "刷新中..." : "刷新"}
+     </button>
    }
  />

- <div className="pl-page-intro ..." data-testid="onboarding-active-token-meta">
-   <span>{enabledTokenCount} 活跃 Token</span>
- </div>
+ {/* active-token meta 行整段删除 */}
```

### 4.2 Onboarding.tsx — RefreshMenu 删除

删除 `RefreshMenu` 组件实现（约 90 行）。删除以下状态与副作用：

| 项 | 处理 |
|---|---|
| `const [autoRefresh, setAutoRefresh] = useState(false)` | 整段删除 |
| `AUTO_REFRESH_INTERVAL_MS = 60_000` 常量 | 删除 |
| `AUTO_REFRESH_FAILURE_TOAST_THRESHOLD = 2` 常量 | 删除 |
| `useEffect(() => { ...setInterval... visibilitychange... }, [autoRefresh])` | 整段删除 |
| `previousSettledRef` + 自动刷新里调用的 `setLastUpdatedAt` | 删除（保留初始 settlement 的逻辑可选，见 §4.5） |
| `lastUpdatedAt` state | 保留仅供 `refreshStatus()` 内部 `toast.success` 使用；不渲染到 UI |

### 4.3 Onboarding.tsx — `refreshStatus()`

简化（保留成功 / 失败 toast，不刷新 `lastUpdatedAt` UI）：

```ts
async function refreshStatus() {
  const settled = await Promise.allSettled([
    projectQuery.refetch(),
    sourcesQuery.refetch(),
    diffQuery.refetch(),
    agentsQuery.refetch(),
    evalLastRunQuery.refetch()
  ]);
  const failed = settled.find((r) => r.status === "rejected");
  const queryErrors = settled.flatMap((r) => {
    if (r.status !== "fulfilled") return [];
    const value = r.value as { error?: unknown } | undefined;
    return value?.error ? [value.error] : [];
  });
  if (failed || queryErrors.length > 0) {
    toast.error("系统概览刷新失败");
    return;
  }
  toast.success("系统概览已刷新");
}
```

### 4.4 Onboarding.tsx — `deriveEnvironmentLabel` 与 `formatTimestamp`

- `deriveEnvironmentLabel` 整段删除（MCP 接入区已有等价提示）。
- `formatTimestamp` 整段删除（不再被引用）。
- `environmentLabel` / `lastUpdatedLabel` 局部变量删除。

### 4.5 `coreSettled` 副作用处理

现 `useEffect` 中基于 `coreSettled` 写 `lastUpdatedAt`（仅首次 settle 时写一次）。删除 `autoRefresh` 时一并删除此 effect 与 `previousSettledRef`、`lastUpdatedAt` state（不再用于 UI，只用于 toast 的需求不存在）。

### 4.6 Token 计数语义

将 `enabledTokenCount` 改为 `availableTokenCount`，定义：

```ts
function isTokenAvailable(token: Agent["tokens"][number], now: Date = new Date()): boolean {
  if (token.revoked) return false;
  if (!token.expires_at) return true; // 永不过期
  const expiresAt = new Date(token.expires_at);
  if (Number.isNaN(expiresAt.getTime())) return false; // 无效字符串保守为不可用
  return expiresAt.getTime() > now.getTime();
}

function availableTokenCount(agents: Agent[], now: Date = new Date()): number {
  return agents
    .filter((agent) => agent.enabled)
    .reduce((sum, agent) => sum + agent.tokens.filter((t) => isTokenAvailable(t, now)).length, 0);
}
```

**位置**：放进 `webui/src/lib/opsDashboard.ts`，作为 `buildServiceHealth` 的输入 `availableTokenCount`（替换原 `enabledTokenCount`）。

**调用方替换**：

- `webui/src/pages/Onboarding.tsx`：`enabledTokenCount` → `availableTokenCount`
- 「访问风险」区文案：`{availableTokenCount} 个可用 Token`（替换 `N 个活跃 Token`）
- 「MCP 接入」区事实：`Agent: N 个、Token: N 可用`（保留 N 可用措辞，不写"活跃"）
- 删除 PageHeader 下方的 meta 行

### 4.7 Onboarding.tsx — 系统状态摘要

新增一行 `serviceHealthSummary`（轻量，无组件），在 ready / warning 态替代现有 `ServiceHealthStrip`。`ServiceHealthStrip` 不再渲染；如无其他引用，可删除组件实现。

`danger` 态不走摘要行，仍渲染现有高权重 alert，并在 alert 文案中指出具体失败组件。

```ts
type ServiceHealthSummary = {
  tone: "ready" | "warning";
  semantic: { done: number; total: number; gap: number };
  agents: { enabled: number; total: number; gap: number };
};

function summarizeServiceHealth(
  mcpReady: boolean,
  ktxAvailable: boolean,
  semantic: { done: number; total: number },
  agents: { enabled: number; total: number }
): ServiceHealthSummary | null {
  if (!mcpReady || !ktxAvailable) return null;
  const semanticGap = Math.max(0, semantic.total - semantic.done);
  const agentGap = Math.max(0, agents.total - agents.enabled);
  const tone = semanticGap > 0 || agentGap > 0 ? "warning" : "ready";
  return {
    tone,
    semantic: { ...semantic, gap: semanticGap },
    agents: { ...agents, gap: agentGap }
  };
}
```

React 渲染层负责拼接文案并给专业术语加 `notranslate` / `translate="no"`，不要从 helper 返回 plain string 后直接渲染。示意：

```jsx
{summary ? (
  <div
    className="pl-page-intro text-sm text-fg-default"
    data-testid="ops-service-health-summary"
    data-tone={summary.tone}
  >
    <span className="notranslate" translate="no">Lucy MCP</span> 可用，
    <span className="notranslate" translate="no">KTX Runtime</span> 可用；
    语义覆盖 <span className="notranslate" translate="no">{summary.semantic.done}/{summary.semantic.total}</span>
    {summary.semantic.gap > 0 ? <>，仍有 <span className="notranslate" translate="no">{summary.semantic.gap}</span> 张表待补</> : null}
    ；<span className="notranslate" translate="no">Agent</span>{" "}
    <span className="notranslate" translate="no">{summary.agents.enabled}/{summary.agents.total}</span> 启用
    {summary.agents.gap > 0 ? <>，仍有 <span className="notranslate" translate="no">{summary.agents.gap}</span> 个未启用</> : null}
    {" · "}
    <Link to="/admin/audit" className="pl-card-cta">控制台日志 ↗</Link>
  </div>
) : null}
```

`danger` alert 文案建议由失败组件具体化：

```ts
function systemAlertText(mcpReady: boolean, ktxAvailable: boolean): string {
  if (!mcpReady || !ktxAvailable) {
    if (!mcpReady && !ktxAvailable) return "系统异常：Lucy MCP 与 KTX Runtime 不可用，请检查接入。";
    if (!mcpReady) return "系统异常：Lucy MCP 未就绪，请检查 Endpoint 配置。";
    return "系统异常：KTX Runtime 不可用，请检查运行时配置。";
  }
  return "系统状态正常。";
}
```

**位置**：放进 `webui/src/lib/opsDashboard.ts`，导出。

### 4.8 MCP 接入区 fallback 提示

保留现有文案，不变：

> 当前使用本地默认 MCP Endpoint。客户部署请配置 LUCY_PUBLIC_MCP_URL...

仅由 `endpointInfo.status === "fallback"` 或 `configured === false` 触发。

## 5. 测试要求

### 5.1 onboarding.test.tsx

更新 / 新增断言：

| # | 断言 |
|---|---|
| 1 | 顶部不出现「环境:」文本 |
| 2 | 顶部不出现「上次更新」文本 |
| 3 | 不出现 `data-testid="onboarding-env-badge"` 与 `onboarding-last-updated` |
| 4 | 不出现 `data-testid="onboarding-refresh-menu"`（menu 已删除） |
| 5 | 不出现「自动刷新」文本 |
| 6 | 刷新按钮是普通 `<button>`，文本为「刷新」或「刷新中...」，无 `aria-haspopup`、无 ▾ |
| 7 | `data-testid="onboarding-active-token-meta"` 不存在 |
| 8 | 顶部不再有「活跃 Token」字样 |
| 9 | 出现「可用 Token」（在访问风险区） |
| 10 | 出现「Agent」+「Token」+「可用」事实文本（在 MCP 接入区 meta 行） |
| 11 | ready / warning 态系统状态摘要存在 `data-testid="ops-service-health-summary"`，文本含「Lucy MCP 可用」与「KTX Runtime 可用」 |
| 12 | 过期 token 不计入「可用 Token」（注入 `expires_at = past` 的 token，断言数量不增） |
| 13 | ready / warning 态不再渲染 `data-testid="ops-service-health"` 的旧紧凑状态条 |
| 14 | danger 态渲染 `data-testid="ops-service-health-critical"`，且不渲染 `ops-service-health-summary` |

顶部相关断言必须 scope 到 `data-testid="page-header"`，避免误伤正文中的「语义覆盖」「KTX Runtime」「可用 Token」等合法文案。

### 5.2 ops-dashboard.test.ts

新增 / 更新断言：

| # | 断言 |
|---|---|
| 1 | `availableTokenCount([{ enabled, tokens: [{ revoked, expires_at }] }], now)` 单元测试覆盖：enabled=false、revoked=true、expires_at past、expires_at future、expires_at invalid 字符串、expires_at null |
| 2 | `summarizeServiceHealth` 单元测试覆盖：ready / semantic-gap / agent-gap / both-gap / mcp-not-ready / ktx-not-ready；mcp / ktx 不就绪时返回 `null` |
| 3 | `buildServiceHealth` 输入从 `enabledTokenCount` 改为 `availableTokenCount`；断言字段仍能正确计算 accessStatus |

### 5.3 执行命令

```bash
cd webui && npm test -- src/__tests__/onboarding.test.tsx src/__tests__/ops-dashboard.test.ts
```

如 CSS / PageHeader 相关测试受影响，再跑：

```bash
cd webui && npm test -- src/__tests__/page-header.test.tsx
```

## 6. 验收标准

1. `/overview` 顶部清爽：H1 + 描述 + 一个 secondary「刷新」按钮；无任何胶囊。
2. 顶部不出现「环境:」「上次更新:」「KTX 可用」「语义完成」字样。
3. 顶部不出现下拉菜单、无 ▾ 箭头、无 `aria-haspopup="menu"`。
4. 顶部不出现「自动刷新」字样；不出现 `autoRefresh` 入口。
5. 不出现 `data-testid="onboarding-active-token-meta"` 元行。
6. 顶部不出现「活跃 Token」字样；访问风险 / MCP 接入区出现「可用 Token」。
7. 注入 `expires_at = 2026-06-24` 的过期 token，「可用 Token」计数不增。
8. 注入 `expires_at = "not-a-date"` 的无效字符串，「可用 Token」计数不增。
9. 系统状态区在 ready / warning 态渲染一句摘要（`ops-service-health-summary`），且不再渲染旧 `ops-service-health` 紧凑状态条。
10. danger 态保留现有高权重 alert（`ops-service-health-critical`），不渲染摘要行；alert 文案指出 `Lucy MCP`、`KTX Runtime` 或二者同时异常。
11. 控制台日志链接保留为摘要行尾部的弱链接。
12. MCP 接入区仍是 Endpoint / fallback 提示的唯一出现位置。
13. `cd webui && npx tsc --noEmit` 通过。
14. `cd webui && npm test` 全绿（含 onboarding + ops-dashboard + page-header + 其他受影响测试）。
15. `cd webui && npm run lint:terminology` 通过。
16. `cd webui && npm run build` 通过。

## 7. 风险与边界

| 风险 | 处理 |
|---|---|
| 删除 RefreshMenu 影响 e2e / 视觉快照测试 | 由测试更新同步处理；本次不保留 `onboarding-refresh-menu-*` testid |
| 摘要文案触发术语 lint 警告 | helper 返回结构化 view model；React 渲染层为 `Agent` / `Token` / `Lucy MCP` / `KTX Runtime` 等英文加 `notranslate` |
| 自动刷新后端逻辑被一并删除，未来需要恢复 | 保留 `refreshStatus()` 函数 + `coreFetching` 计算；如需恢复自动刷新只需新增 `useEffect`，不破坏 API |
| Token 计数口径变化影响外部 dashboard | 本工单只影响 `/overview`；其他模块（如 `/admin/agents`）独立显示 |
| `expires_at` 解析失败的 token 静默被排除 | 在「访问风险」区显示「可用 Token：N 个」，N 不含无效 token；这是 spec §4.6 决策 |

## 8. 实施分步（对应 wo-M41 工单）

1. 改 `webui/src/lib/opsDashboard.ts`：
   - 新增 `isTokenAvailable` + `availableTokenCount` + `summarizeServiceHealth`；
   - `summarizeServiceHealth` 在 `mcpReady=false` 或 `ktxAvailable=false` 时返回 `null`，避免 danger 态同时渲染摘要和 alert；
   - `ServiceHealthInput.enabledTokenCount` 字段名改为 `availableTokenCount`（或保留兼容别名，看实现）；
   - `buildServiceHealth` 内部按 `availableTokenCount` 计算 accessStatus。
2. 改 `webui/src/pages/Onboarding.tsx`：
   - 删除 `RefreshMenu` 组件（整段）；
   - 删除 `autoRefresh` 状态、`setInterval`、`visibilitychange` 监听、`previousSettledRef`、`lastUpdatedAt` state、`AUTO_REFRESH_INTERVAL_MS`、`AUTO_REFRESH_FAILURE_TOAST_THRESHOLD`；
   - 删除 `deriveEnvironmentLabel`、`formatTimestamp`、`environmentLabel`、`lastUpdatedLabel`；
   - 删除 `deriveEnvironmentLabel` 中的 endpoint host 判断（顶部不再用）；
   - `enabledTokenCount` → `availableTokenCount`（用 `lib/opsDashboard.ts` 导出）；
   - 顶部 PageHeader：删除 `badges`，`actions` 改为单一 secondary「刷新」按钮；
   - 删除 PageHeader 下方的 meta 行（`onboarding-active-token-meta`）；
   - 渲染 `summarizeServiceHealth(...)` 摘要行，ready / warning 态替代 `ServiceHealthStrip`；
   - 不再渲染旧 `ServiceHealthStrip`；如无引用可删除组件；
   - danger 态保留 alert，并使用具体失败组件文案。
3. 改 `webui/src/__tests__/onboarding.test.tsx`：
   - 删除 / 替换基于 `onboarding-env-badge`、`onboarding-last-updated`、`onboarding-refresh-menu-*`、`onboarding-active-token-meta`、`自动刷新` 的断言；
   - 新增「顶部无环境 / 上次更新 / 自动刷新 / 活跃 Token」断言；
   - 新增「刷新按钮是普通按钮」断言；
   - 新增「过期 token 不计入可用 Token」断言。
4. 改 `webui/src/__tests__/ops-dashboard.test.ts`：
   - 新增 `availableTokenCount` 单元测试；
   - 新增 `summarizeServiceHealth` 单元测试（含 mcp / ktx 不就绪返回 `null`）；
   - 更新 `buildServiceHealth` 测试中 `enabledTokenCount` → `availableTokenCount` 字段。
5. 必要时微调 `webui/src/app/app.css`：
   - 如摘要行需要新 token，复用 `.pl-page-intro`；仅当 `data-tone` 影响样式时再加 modifier。
6. 跑 `tsc / vitest / lint:terminology / build` 四件套。
7. 准备 `IMPLEMENTATION_NOTES.md` + `RELEASE_NOTES.md`，按 mulan-task-force 提交。

## 9. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:
- None

Required UI terms:

| 概念 | UI 文案 |
|---|---|
| Token 计数 | `可用 Token：N 个`（替换原 `活跃 Token`） |
| 刷新按钮 | `刷新` / `刷新中...` |
| 系统状态摘要（ready） | `Lucy MCP 可用，KTX Runtime 可用；语义覆盖 D/T，Agent E/A 启用。` |
| 系统状态摘要（warning，含语义缺口） | `Lucy MCP 可用，KTX Runtime 可用；语义覆盖 D/T，仍有 G 张表待补。` |
| 系统状态摘要（warning，含 Agent 缺口） | `Lucy MCP 可用，KTX Runtime 可用；Agent E/A 启用，仍有 G 个未启用。` |
| 系统异常 Alert（mcp 异常） | `系统异常：Lucy MCP 未就绪，请检查 Endpoint 配置。` |
| 系统异常 Alert（ktx 异常） | `系统异常：KTX Runtime 不可用，请检查运行时配置。` |
| 系统异常 Alert（二者异常） | `系统异常：Lucy MCP 与 KTX Runtime 不可用，请检查接入。` |
| 控制台日志链接 | `控制台日志 ↗`（保留现有名） |

DOM 防御要求：

- `Agent` / `Token` / `KTX` / `MCP` / `Endpoint` / `expires_at` 等专业术语、API 字段维持既有 `notranslate` / `translate="no"`。
- 摘要文案中的英文术语（`Lucy MCP` / `KTX Runtime`）需 `notranslate`。

## 10. 待澄清问题（移交 coder 前必答）

| 编号 | 问题 | 默认建议 |
|---|---|---|
| Q1 | 「系统状态」摘要行是否要替代现有 `ServiceHealthStrip`？ | 是；ready / warning 态用一句摘要替代旧紧凑状态条，避免再次重复 `Lucy MCP / KTX / 语义覆盖 / Agent` |
| Q2 | danger 态（mcpReady=false 或 ktxAvailable=false）是否渲染摘要行？ | 否；只渲染现有高权重 alert（`ops-service-health-critical`），并按失败组件具体化文案 |
| Q3 | 自动刷新彻底删除后，是否仍保留 `coreFetching` 计算？ | 保留；它仍是「刷新」按钮的 disabled + 文案依据 |
| Q4 | 「刷新」按钮放在右侧 actions 区还是标题下方？ | 右侧 actions 区；与现有「打开发布工作台」「查看访问日志」等 CTA 同一视觉锚点 |
| Q5 | 摘要行是否需要视觉强调（如左边色条）？ | 否；用现有 `data-tone` 给 `pl-page-intro` 加 modifier；不引入新边框 |
| Q6 | 测试中 `expires_at = 2026-06-24T00:00:00Z` 的断言如何写？ | 直接构造 fixture；用 `Date` 注入当前时间（如 `vi.useFakeTimers().setSystemTime(new Date("2026-08-01T00:00:00Z"))`）让断言可重复 |
| Q7 | demo 数据中 `demo_huadong_manager` 的 token `expires_at=2026-06-24T00:00:00Z` 当前是否计入？ | 默认建议改为：不计入；这是 spec §1 背景明确要求的 |
| Q8 | `summarizeServiceHealth` 是否独立成组件 / 工具函数？ | 纯函数返回结构化 view model；React 层渲染 JSX，保证英文术语可加 `notranslate` |
| Q9 | 顶部清爽化测试是否全局查询文本？ | 否；顶部断言必须 scope 到 `data-testid="page-header"`，正文仍允许出现 `KTX Runtime`、语义覆盖、可用 Token 等合法信息 |

## 11. Backout Plan

按 §12 M40 Backout 策略走：

1. 整体回滚：`git revert -m 1 <merge-sha>`。
2. 局部回滚：
   - 从合并前 commit 恢复 `webui/src/lib/opsDashboard.ts` 与 `webui/src/pages/Onboarding.tsx`；
   - 测试单独 revert。
3. 不依赖任何 tag/branch，避免 agent 操作风险。

预计回滚耗时：≤ 30 分钟（git 单文件还原 + 视觉验证）。
