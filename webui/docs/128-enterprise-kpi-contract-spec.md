# Spec 128 — Enterprise KPI Contract

| 元数据 | 内容 |
|---|---|
| 文档名称 | Enterprise KPI Contract Spec |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-26 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | Gate A remediation plan; Spec 103; Spec 12; governance-observability.ts; agents.ts |
| 适用范围 | 所有 List KPI、Overview Ops 和 Permission Summary 指标卡的定义、状态、口径、渲染规则 |
| 输出位置 | `webui/docs/128-enterprise-kpi-contract-spec.md` |

## 1. 目的

本规范定义 Lucy WebUI 所有 KPI 指标卡的 **合约（Contract）**，防止以下回归：

- 前端用 `?? 0` 掩盖数据源不可用
- 通过率分母为 PASS/(PASS+FAIL)（不含 SKIP）
- 部分数据时渲染数值主值代替占位符
- Token prefix 映射不唯一时声称全局精确去重数

## 2. 锁定产品决策（代码与 Spec 注释必须编码）

### Decision 1 — Config 类 KPI

Connection count、Role count、Case total 等**配置类**指标（来自单一权威 API 响应）**可以直接展示字段值**，不得在前端二次聚合审计指标。每张配置类卡必须附带 `metricId + asOf + state`。

### Decision 2 — 通过率分母

```
passRate = PASS / total_cases   (total_cases = PASS + FAIL + SKIP)
```

**Trend 必须使用相同公式。** 禁止在「通过率」标签下使用 PASS/(PASS+FAIL)。

### Decision 3 — partial 状态渲染规则

`partial` 状态时：
- 主值 **必须** 渲染为 `—`（破折号，永远不展示数值估算作为主值）
- `warning` 或 `subValue` 可以说明部分原因

### Decision 4 — Token prefix 歧义

若 prefix→token 映射不唯一（一个 prefix 对应多个配置 Token），KPI `state=partial`，`value=null`；**永远不能声称精确的全局去重数**。

## 3. 类型定义

### 3.1 MetricState

```typescript
// webui/src/lib/kpiContracts.ts
export type MetricState =
  | "ok"           // 数据正常，value 有效
  | "no_data"      // 时间窗口内无记录，value = 0 或 null（非错误）
  | "unavailable"  // 数据源故障，value = null；UI 显示 — + "数据源不可用"
  | "partial";     // 数据不完整或存在歧义，value = null；UI 显示 — + warning
```

### 3.2 MetricResult

```typescript
export interface MetricResult {
  metricId: string;
  state: MetricState;
  value: number | null;
  asOf: string;            // ISO 8601，查询时刻
  windowStart?: string;    // ISO 8601，窗口起始（含）
  windowEnd?: string;      // ISO 8601，窗口结束（不含）
  unavailableReason?: string;
}
```

### 3.3 MetricContract

```typescript
export type MetricKind =
  | "list_kpi"   // List 页面顶部 KPI 卡（Spec 103）
  | "ops"        // Overview Ops 行（Spec 102）
  | "summary";   // Permission Summary 卡（非 List KPI，不参与聚合）

export interface MetricContract {
  id: string;
  kind: MetricKind;
  label: string;      // 中文显示名
  help: string;       // ⓘ tooltip 口径说明
  pages: string[];    // 出现在哪些路由
  windowed: boolean;  // true = 依赖时间窗口查询，false = 纯配置类
}
```

## 4. 硬规则（Hard Rules）

| # | 规则 | 违规表现 |
|---|---|---|
| HR-1 | 动态审计 KPI 的 state=unavailable 时，`value` 必须为 `null`，前端不得 `?? 0` | 主值显示 0 掩盖故障 |
| HR-2 | state=partial 时，主值必须渲染为 `—` | 主值显示估算数字 |
| HR-3 | 通过率分母包含 SKIP | 分母仅 PASS+FAIL |
| HR-4 | 活跃率 ≤ 100%；若分子 > 分母（active > configured），rate → partial | 活跃率 >100% |
| HR-5 | 时间窗口边界使用 `metric-window.ts` 统一生成；禁止在 SQL 里硬写 `datetime('now','-7 days')` | 窗口边界不一致 |
| HR-6 | Config 类 KPI 可以是 `ok` 状态的静态值，但必须携带 `metricId` 和 `asOf` | 无 metricId 的配置卡 |
| HR-7 | Token prefix 歧义时 state=partial，禁止声称精确去重数 | partial 时展示数值 |

## 5. 范围边界

### List KPI（kind: "list_kpi"）

出现在列表页顶部 `.pl-metric-grid`，使用 `MetricCard` 组件，**每张必须有 ⓘ**。

- AgentList: agent-count, active-agent-count, active-token-count, calls-7d
- GovernanceOverview: agent-count, active-agent-count, configured-token-count, active-token-count, configured-table-count, active-table-count, calls, p95-latency
- EvalRunList: total-cases, pass-rate, skip-count, fail-count

### Ops Metric（kind: "ops"）

出现在 `/overview` 快照行（Spec 102），不是 List KPI，不属于本 Spec 直接管辖，但 MetricState 规则同样适用。

### Summary 卡（kind: "summary"）

Permission Summary 等配置摘要卡（如 Role Source Count），`kind: "summary"`，不参与 List KPI 聚合，不受 HR-3/HR-4 约束。

## 6. 渲染规则摘要

| state | 主值 | subValue 或 warning |
|---|---|---|
| ok | `value`（数字或格式化字符串） | 正常口径说明 |
| no_data | `—` | "所选范围内无数据" |
| unavailable | `—` | "数据源不可用" |
| partial | `—` | warning 说明歧义原因 |

## 7. 窗口一致性

`agents.ts` 和 `governance-observability.ts` 的 7d 窗口查询**必须使用相同的 `metric-window.ts`** 生成，确保两页的 calls/active agents/active tokens 在同一时间窗口内一致。

跨页一致性由服务端测试 `webui/server/__tests__/metric-window.test.ts` 验证。
