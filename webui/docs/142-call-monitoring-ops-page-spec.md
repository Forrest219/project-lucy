# Call Monitoring Ops Page Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | 调用监控运维页 Spec (Call Monitoring Ops Page Spec) |
| 文档类型 | Product / API / UX Spec |
| Spec 编号 | 142 |
| 版本 | v0.1 |
| 撰写日期 | 2026-09-04 |
| 委托人 | xingchen |
| 状态 | Draft / Ready for Review |
| 输出位置 | `webui/docs/142-call-monitoring-ops-page-spec.md` |
| 上游 Spec / 事实源 | Spec 07（MCP Proxy audit）、Spec 08（问询追溯）、Spec 19/41/100（系统概览 / 运行状态）、Spec 69（governance observability）、Spec 75/78/86/87（使用概况）、Spec 89/94/106（访问日志）、`webui/server/observability.ts`、`webui/server/proxy/audit.ts` |
| 关联术语 | `webui/docs/00-product-terminology-standard.md` §4.6 / 本 Spec Terminology Compliance |
| 关联 IA | `webui/docs/06-navigation-ia.md`（本 Spec 修订「运行状态」分组） |

## 1. 背景与问题

运维与数据分析需要**实时盯盘 MCP 工具调用的流量与时效**，但现有能力被拆在多处：

| 现有能力 | 定位 | 缺口 |
|---|---|---|
| `/overview` 系统概览 | 服务可交付性、语义覆盖、待办 | 不展示 MCP 调用吞吐 / 延迟 / 错误趋势 |
| `/admin/usage` 使用概况 | Agent / Token / 表活跃与排行 | 治理视角，非实时盯盘；无失败短列表下钻闭环 |
| `/admin/audit` 访问日志 | 取证列表与 Trace | 明细优先，不是首屏体征 |
| `GET /api/observability` | 流量 / 延迟 / SLO 快照 | 几乎无一等 WebUI；且 payload 混入 Eval |
| `/eval/monitor` 趋势监控 | 评测质量漂移 | 明确排除在本需求外 |

本 Spec 定义独立运维页 **调用监控**：只读、准实时、只看 MCP 工具调用与时效，挂在 **运行状态** 导航分组。

## 2. Goals

1. 为运维与数据分析提供独立页 `/ops/calls`，主标题 **调用监控**。
2. 默认时间窗 **近 24 小时**；可选 **近 1 小时** 用于盯当前尖峰。
3. 页面打开后 **30s 自动轮询**（可手动刷新）；准实时即可，不做 SSE / WebSocket。
4. 首屏回答：近窗调用量、成功率、错误率、拒绝率、多数请求耗时（P95）、慢于多数请求数量、Top 工具、最近失败/拒绝短列表。
5. 时效口径统一为 **单次 MCP 工具调用** 的 `durationMs`（非 Turn 端到端）。
6. 图表 / 排行 / 列表可下钻到 **访问日志 · 调用流水**（同过滤）并进入 Trace。
7. 阈值超阈仅做 **页内红标 / 高亮**；不接邮件 / Slack。
8. 事实源复用现有 `audit.sqlite` / observability 聚合；**不新造采集管道**。

## 3. Non-goals

- 不覆盖 Eval 跑批、质量趋势、Hermes / R1 release signals。
- 不覆盖 WebUI / Admin HTTP 自身请求、配置审计写入。
- 不覆盖 LLM prompt / completion / token 用量（Lucy 不采集模型侧）。
- 不做 SSE / WebSocket 真推送、多实例日志聚合、对象存储归档、容量规划。
- 不做邮件 / Slack / Webhook 告警通道。
- 不替代 `/admin/usage`（资产活跃与治理排行）或 `/admin/audit`（取证主场）。
- 不修改 ACL / Proxy 裁决语义；只读展示。

## 4. 用户与场景

| 角色 | 场景 |
|---|---|
| 运维 | 打开调用监控，确认近 24h / 近 1h MCP 调用是否健康；错误率或 P95 飙高时下钻到调用流水 |
| 数据分析 | 查看 Top 工具与失败短列表，判断是工具故障、权限拒绝还是慢查询集中 |

权限：与现有 Admin 运维页一致（需已登录的 WebUI admin session）。不新增细粒度只读角色。

## 5. IA / 路由 / 导航

### 5.1 路由

| 项 | 值 |
|---|---|
| Canonical route | `/ops/calls` |
| Page title（H1） | 调用监控 |
| Breadcrumb | `运行状态 / 调用监控` |
| Query | `range=24h\|1h`（默认 `24h`）；兼容读 `hours=24\|1` |

### 5.2 导航分组修订

将现有置顶单项 **系统概览** 升级为分组 **运行状态**：

```text
运行状态
- 系统概览      /overview
- 调用监控      /ops/calls
```

约束：

- 分组标题 UI 主术语：**运行状态**（Canonical: Runtime Status Group）。
- **禁止**用「看板」「大屏」「监控中心」作侧栏或 H1。
- 命令面板：调用监控需可搜（keywords 含 `MCP`、调用、延迟、P95、失败、拒绝）。
- `06-navigation-ia.md` 与 `navigation.ts` 的 6+1 结构在实现时改为：**运行状态 + 数据接入 + … + 系统设置**（原「系统概览」单项并入「运行状态」分组；分组数仍为 6+1 心智：运行状态取代原置顶单项）。

### 5.3 与相邻页边界

| 页 | 一句话边界 |
|---|---|
| 系统概览 | 「能不能交付」：健康、覆盖、待办 |
| **调用监控** | 「MCP 调用现在是否健康、是否慢」：吞吐 / 错误 / 拒绝 / 时效 |
| 使用概况 | 「谁在用、用哪些表」：Agent / Token / 表活跃与排行 |
| 访问日志 | 「某次调用发生了什么」：问询 / 流水 / Trace / 导出 |
| 趋势监控 | 「评测质量漂了没有」：Eval pass-rate |

## 6. 数据口径

### 6.1 事实源

- 表：`.ktx-ui/audit.sqlite` → `access_log`（及既有关联源表，若聚合需要）。
- 复用 / 薄封装：`readR1AuditObservability`、既有 SLO 阈值环境变量、访问日志列表 API。
- **不**写入新事件；**不**依赖 Eval DB。

### 6.2 计入集合（Business MCP Calls）

与 `readR1AuditObservability` 一致：

- 计入：`access_log` 中 **非协议工具** 的行（排除 `PROTOCOL_TOOLS`）。
- outcome 仅使用：`ok` | `error` | `denied`。
- **不计入**：auth 失败专用表（若与 access_log 分离）、配置审计、WebUI 自身 API、Eval runner。

### 6.3 时间窗

| `range` | `hours` | 用途 |
|---|---|---|
| `24h`（默认） | 24 | 主盯盘窗 |
| `1h` | 1 | 当前尖峰 |

顶栏 segmented control 切换；写入 URL `range=`，刷新后保持。

### 6.4 指标定义

| Canonical | UI 主术语 | 定义 |
|---|---|---|
| Call Volume | 近 N 调用量 | `businessCalls` 计数；N 来自当前窗 |
| Success Rate | 成功率 | `okCalls / businessCalls`；分母 0 → 展示「暂无调用」态 |
| Error Rate | 错误率 | `errorCalls / businessCalls` |
| Denied Rate | 拒绝率 | `deniedCalls / businessCalls` |
| Typical Request Latency | 多数请求耗时 | 窗内 `durationMs` 的 P95；次级括注 `P95` |
| Slow Call Count | 慢于多数请求 | `durationMs > slowMs` 的调用数；`slowMs` 默认 `LUCY_OBSERVABILITY_SLOW_MS` 或现网等价（默认 30000） |
| Top Tools | 工具调用排行 · 近 N | 按 calls 降序 Top 10；附带 errors / denied |
| Recent Failures | 最近失败与拒绝 | 最近最多 20 条 `outcome ∈ {error,denied}`，按 `ts` 降序 |

### 6.5 阈值（页内红标）

复用 observability SLO（仅 MCP 相关，忽略 eval_*）：

| 信号 | 默认阈值来源 | 违规时 UI |
|---|---|---|
| `latency_p95` | `p95Ms > slowMs`（`LUCY_OBSERVABILITY_SLOW_MS`，默认 30000） | 「多数请求耗时」卡 warn / 红标 |
| `error_rate` | `LUCY_OBSERVABILITY_MAX_ERROR_RATE`（默认 0.02） | 「错误率」卡 warn |
| `denied_rate` | `LUCY_OBSERVABILITY_MAX_DENIED_RATE`（默认 0.1） | 「拒绝率」卡 warn |

无调用（`businessCalls == 0`）：整体 **暂无数据**，不记违规。

## 7. API Surface

### 7.1 首选：专用只读聚合（推荐实现）

```http
GET /api/ops/call-monitor?range=24h|1h&slowMs=<optional>
```

响应（示意，字段名稳定即可；数值口径见 §6）：

```json
{
  "ok": true,
  "data": {
    "generatedAt": "ISO-8601",
    "window": { "range": "24h", "hours": 24, "since": "...", "slowMs": 30000 },
    "traffic": {
      "businessCalls": 1280,
      "okCalls": 1200,
      "errorCalls": 40,
      "deniedCalls": 40,
      "successRate": 0.9375,
      "errorRate": 0.03125,
      "deniedRate": 0.03125
    },
    "latency": {
      "p50Ms": 120,
      "p95Ms": 1800,
      "slowCalls": 12
    },
    "slo": {
      "thresholds": {
        "p95LatencyMs": 30000,
        "maxErrorRate": 0.02,
        "maxDeniedRate": 0.1
      },
      "status": "ok|warn|no_data",
      "violations": ["error_rate"]
    },
    "topTools": [
      { "tool": "lucy_query", "calls": 900, "errors": 10, "denied": 5 }
    ],
    "recentFailures": [
      {
        "id": 123,
        "ts": "...",
        "tool": "lucy_query",
        "outcome": "error",
        "durationMs": 4500,
        "userId": "...",
        "decisionReason": "...",
        "requestId": "...",
        "traceId": "..."
      }
    ]
  }
}
```

约束：

- **禁止**在本 API 返回 Eval / Hermes / releaseSignals。
- 敏感字段遵循既有 audit 脱敏（Token 明文、原始攻击 payload、结果行等禁止出现）。
- `recentFailures` 有界（≤20）；`topTools` 有界（≤10）。

### 7.2 兼容复用路径（允许过渡）

实现可先组合：

- `GET /api/observability?hours=…&slowMs=…`（**前端必须忽略** `eval` / eval 相关 `slo.violations`）
- `GET /api/observability/logs?outcome=error|denied&…` 或既有 `GET /api/admin/audit` 调用流水查询

但验收以 §7.1 语义为准：页面契约不得依赖 Eval 字段；长期应收敛到 `/api/ops/call-monitor`，避免运维页被 release/eval payload 污染。

### 7.3 下钻 URL 契约

从本页跳转访问日志时，必须使用规范 query（与 Spec 106 对齐）：

| 动作 | URL |
|---|---|
| 查看窗内全部调用 | `/admin/audit?view=calls&range=24h`（1h 窗用等价 `hours=1` 或实现约定的 range；若访问日志尚无 `1h` preset，则用起止时间参数或 `hours=1` 兼容读） |
| 仅错误 | `…&outcome=error` |
| 仅拒绝 | `…&outcome=denied` |
| 按工具 | `…&tool=<toolName>`（若现网 filter 已支持；否则先落地 tool 后再链） |
| 打开 Trace | 进入调用流水后走既有 TraceLink / Drawer（Spec 62 / 69） |

实现时若访问日志缺少某 filter，允许本页先带齐已支持参数，并在 Spec 实现 PR 中补齐最小 filter，而不是在本页重做取证 UI。

## 8. UI 结构

```text
调用监控
├─ PageHeader
│  ├─ Breadcrumbs: 运行状态 / 调用监控
│  ├─ Title: 调用监控
│  ├─ Description: 准实时查看 MCP 工具调用量、成败与请求时效。
│  ├─ Badges: 统计时间 · SLO 状态（正常 / 需关注 / 暂无数据）
│  └─ Actions: 时间窗 segmented（近 24 小时 | 近 1 小时）· 自动刷新开关（默认开，30s）· 刷新
├─ Primary KPI row（MetricCard）
│  ├─ 近 N 调用量
│  ├─ 成功率
│  ├─ 错误率
│  ├─ 拒绝率
│  ├─ 多数请求耗时（P95）
│  └─ 慢于多数请求
├─ Secondary row
│  ├─ 工具调用排行 · 近 N（Top 10；点击行 → 访问日志带 tool 过滤）
│  └─ 最近失败与拒绝（短表；点击行 → 访问日志 / Trace）
└─ Empty / Error
   ├─ 暂无调用：说明窗内无 MCP 业务调用，链到系统概览检查接入
   └─ 加载失败：Toast + 页内错误，可重试
```

设计约束：

- 复用 `PageHeader`、`MetricCard`、既有 panel / data-grid 密度；不引入新设计体系。
- 不做卡片堆叠式营销布局；一屏一个盯盘职责。
- Protected DOM：`MCP`、`P95`、tool name、`Agent` / `Token` 相关值、`requestId` / `traceId` → `translate="no"` + `notranslate`。
- 自动刷新：默认开启；用户关闭后保持到离开页面（session 内即可，不必持久化到服务端）。

## 9. 核心流程（伪代码）

```text
function loadCallMonitor(range, slowMs):
  hours := range == "1h" ? 1 : 24
  snapshot := readBusinessMcpObservability(hours, slowMs)
    // access_log WHERE ts >= now-hours
    // exclude PROTOCOL_TOOLS
  traffic := aggregate(outcome counts + rates)
  latency := { p50, p95, slowCalls: count(durationMs > slowMs) }
  topTools := topN(groupBy tool, n=10)
  recentFailures := latest(outcome in {error,denied}, n=20)

  slo := {
    thresholds: fromEnv(slowMs, maxErrorRate, maxDeniedRate),
    violations: []
  }
  if traffic.businessCalls == 0:
    slo.status := no_data
  else:
    if latency.p95 > thresholds.p95LatencyMs: violations += latency_p95
    if traffic.errorRate > thresholds.maxErrorRate: violations += error_rate
    if traffic.deniedRate > thresholds.maxDeniedRate: violations += denied_rate
    slo.status := violations.empty ? ok : warn

  return { traffic, latency, topTools, recentFailures, slo }
  // MUST NOT attach eval / hermes fields

function pageLoop():
  state.autoRefresh := true (default)
  state.range := url.range ?? "24h"
  fetchAndRender(loadCallMonitor(...))
  every 30s:
    if state.autoRefresh and document.visible:
      fetchAndRender(...)   // soft refresh; keep scroll if possible
  on KPI/tool/failure click:
    navigate(/admin/audit?view=calls&<same window>&<filters>)
```

## 10. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms（须同步登记到术语标准 §4.6）：

| Canonical Term | UI 主术语 | 允许补充说法 | 禁止文案 | 说明 |
|---|---|---|---|---|
| Call Monitoring Page | 调用监控 | MCP 调用监控（叙述） | 日志调用监控看板、调用看板、流量大屏 | 主路由 `/ops/calls`；侧栏与 H1 |
| Runtime Status Group | 运行状态 | — | 把「系统概览」继续当作分组名承载多页 | 侧栏分组；含系统概览 + 调用监控 |
| Call Monitor Success Rate | 成功率 | — | 与评测「通过率」混用 | MCP 工具调用 `ok / businessCalls` |
| Call Monitor Error Rate | 错误率 | — | 失败率（与拒绝混用） | `error / businessCalls` |
| Call Monitor Denied Rate | 拒绝率 | ACL 拒绝率（叙述） | 拦截率作唯一主标签 | `denied / businessCalls` |
| Recent Failures List | 最近失败与拒绝 | 失败短列表 | 告警列表、incident | 有界短表，非告警通道 |
| Auto Refresh | 自动刷新 | 30 秒刷新（hint） | 实时推送（暗示 SSE） | 默认 30s 轮询 |

既有术语沿用（不得改译）：

- 近 N 调用量、多数请求耗时、慢于多数请求、访问日志、调用流水、统计时间、系统概览、P95、MCP。

Protected terms：`MCP`、`P95`、tool name、`requestId`、`traceId`、Agent / Token 标识值。

## 11. Design System Compliance

- Foundations / Patterns：PageHeader、MetricCard、segmented window、data-grid 短表（引用 `webui/docs/design-system/` 既有章节与 `/admin/usage`、`/overview` 既有实现）。
- 不新增未登记的视觉模式；阈值态使用既有 warn / danger token。
- PR 交付须含 Design System Compliance 小节。

## 12. Acceptance Criteria

1. 侧栏 **运行状态** 下可见 **调用监控**，路由 `/ops/calls`；面包屑为 `运行状态 / 调用监控`。
2. 默认 `range=24h`；可切 `1h`；URL 可分享并恢复。
3. 首屏展示 §6.4 全部 KPI + Top 工具 + 最近失败与拒绝；无 Eval / 跑批 / WebUI 自身指标。
4. 自动刷新默认 30s；可关闭；手动刷新更新「统计时间」。
5. 错误率 / 拒绝率 / P95 超阈时对应卡片红标；`businessCalls=0` 为暂无数据而非误报。
6. 点击失败行或工具排行可进入 `/admin/audit?view=calls` 并带过滤；可继续打开 Trace。
7. API（或过渡组合）不泄露 Token 明文 / 结果行；`lint:terminology` 通过。
8. 单元 / 组件测试覆盖：口径聚合、SLO 违规映射、导航 IA、深链 query。
9. 默认不要求浏览器 E2E（除非实现 PR 明确要求）；以 API + 组件测试为主。

## 13. 实现切片建议

| Slice | 内容 |
|---|---|
| S1 | 术语标准 + IA（navigation / 06 / Help 侧栏映射）+ 空页壳 |
| S2 | `/api/ops/call-monitor`（或过渡复用）+ KPI + 轮询 |
| S3 | Top 工具 + 最近失败短表 + 访问日志深链 |
| S4 | SLO 红标 + 测试与 README / feature-map 索引 |

## 14. 文档联动（实现时必改）

- `webui/docs/00-product-terminology-standard.md` §4.6（本 Spec 已要求登记）
- `webui/docs/06-navigation-ia.md`（运行状态分组）
- `webui/src/app/navigation.ts` + navigation / Help 测试
- `docs/webui-feature-map.md` / `docs/webui-impl-status.md`（若仍维护）
- 本文件收入 `webui/docs/README.md` 索引
