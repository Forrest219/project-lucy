# Admin Usage Overview UX Refinement Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Admin Usage Overview UX Refinement Spec |
| 文档类型 | Spec |
| 版本 | v1.1 |
| 撰写日期 | 2026-08-05 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | 浏览器核查 `http://127.0.0.1:55176/admin/governance`（含 24h/7d 切换对比）；用户 8 条反馈与已批准改善方案；交付质量交叉评估（API 字段兼容、表统计互斥低估、IA/Help 同步、P95 空态、enabled 边界）；`webui/docs/75-admin-governance-usage-overview-spec.md`；`webui/src/pages/admin/GovernanceOverview.tsx`；`webui/server/admin/governance-observability.ts`；`webui/docs/00-product-terminology-standard.md` |
| 适用范围 | 指导 `/admin/governance` 使用概况页命名、顶栏精简、窗口全局化、KPI 重组（含表指标与 P95）与文案去技术化；修订 Spec 75 中已被本轮反馈证伪的口径 |
| 输出位置 | `webui/docs/78-admin-usage-overview-ux-refinement-spec.md` |

| 字段 | 内容 |
|---|---|
| Spec 编号 | 78 |
| 关联工单 | `webui/docs/plans/wo-202608-10-admin-usage-overview-ux-refinement.md` |
| 关联页面 | `/admin/governance`（路由保持；用户可见名称改为「使用概况」） |
| 关联台账 | `docs/ui-ux-feedback/pages/admin-governance.md`（`UX-ADMIN-GOV-001` ~ `UX-ADMIN-GOV-008`） |
| 上游 Spec | `webui/docs/75-admin-governance-usage-overview-spec.md`（usage-first 一期；本 Spec 对其 KPI/窗口/命名做局部修订）；`webui/docs/69-admin-governance-observability-spec.md`（风险深挖能力仍不进主屏） |
| 状态 | Draft (v1.1 review-hardened) |
| 日期 | 2026-08-05 |
| 范围 | 命名与导航文案、顶栏去冗余、窗口全局联动、KPI 合并与第二排表指标、P95 替换均值、用户友好 hint、列表区口径对齐 |

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | 初稿：8 条反馈核查结论 + 已批准改善方案落盘 |
| v1.1 | 钉死：`activeInWindow` + 同响应双发废弃 `activeInLast7d`；`activeTableCount` 两源并集；`popularTables` 互斥主路径但暴露 `tableStatsSource`；P95 无样本显示「—」；配置存量含未启用；Phase 0 同步 IA/术语 |

## 1. 背景

Spec 75 / GOV-02a 已将 `/admin/governance` 从风险巡检首屏改为 **usage-first**「使用概况」：8 项 KPI、Agent 使用排行、Token 使用摘要、最受访问表。

2026-08-05 浏览器核查（默认 7 天 → 切换 24 小时）确认：一期交付可用，但命名仍像治理门户、窗口只联动调用量/均值、活跃指标文案与技术 hint 不友好，且缺少表级存量 KPI。用户 8 条反馈核查结论：

| # | 反馈摘要 | 核查结论 |
|---|---|---|
| 1 | 「治理概览」与 `governance` 后缀不匹配本页内容 | **属实**。标题/侧栏为「治理概览」；正文为 Agent / Token / 调用 / 热门表使用概况 |
| 2 | 右上角「N 小时窗口」与「访问日志」冗余 | **属实**。badge 与窗口切换重复；「访问日志」与侧栏入口重复 |
| 3 | 24h/7d 应全局有效（除 Agent 总数、配置 Token） | **属实**。切 24h 后仅调用量/平均时长变化；活跃 Agent/Token 与热门表仍钉死近 7 天（`ACTIVE_WINDOW_HOURS=168`） |
| 4 | 「最近活跃」不够具体，需与窗口对齐 | **属实**。主标签模糊，hint 硬编码「近 7 天有调用」 |
| 5 | `access_log 去重 prefix`、`AVG(duration_ms)` 太技术 | **属实** |
| 6 | 希望增加配置表 / 活跃表作为第二排指标 | **属实**。KPI 区无表存量；仅底部 Top 10 |
| 7 | 活跃数与活跃率整合为第一排 | **属实**。现拆成 4 张独立卡 |
| 9 | 第二排应用「95% 访问低于 xx ms」替代平均 | **属实**。UI 用 `avgLatencyMs`；API `cards.p95LatencyMs` 已算好未展示 |

本 Spec 是 Spec 75 的**局部修订与二轮打磨**，不推翻 usage-first 心智，只修正窗口口径、KPI 结构与用户可见命名/文案。

## 2. 目标

1. **命名对齐使用心智**：页面标题与侧栏改为「使用概况」；副标题说明 Agent / Token / 表的访问使用；路由可继续用 `/admin/governance`。
2. **顶栏去冗余**：删除窗口 badge 与顶栏「访问日志」；保留 `24 小时 | 7 天` 切换与必要次级动作。
3. **窗口全局化**：除配置存量（Agent 总数、配置 Token、配置表）外，活跃数/率、调用量、P95、热门表、列表活跃列均跟随 `hours`。
4. **KPI 重组为 2×4**：第一排整合活跃 Agent / Token；第二排加入配置表 / 活跃表，并以 P95 替换平均响应时长。
5. **文案去技术化**：hint 不出现 `access_log` 字段名、`AVG(...)`、`prefix` 等实现细节。
6. **列表区与顶栏口径一致**：去掉「固定近 7 天」说明；Token「最近活跃」改为窗口内语义。

## 3. 非目标

- 不改 `access.yaml` schema，不改 Lucy MCP Proxy ACL。
- 不把风险排行 / Role 边界 / 拒绝原因重新拉回主屏（仍属 Spec 69 深挖路径）。
- 不强制改动 URL path（本轮不迁到 `/admin/usage`）；若后续迁路径，另开 Spec。
- 不新增长期趋势图、不展示 token 明文 / SQL 原文。
- 不把「配置表」做成启用表范围（`enabled_tables`）目录统计——本页统计的是**访问授权配置**与**访问日志中的活跃表**。
- 不做移动窄屏专项验证；本轮验收以 Vitest + `lint:terminology` + `build` 为准，不强制浏览器复核。

## 4. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`，并修订 Spec 75 §4 中与本轮冲突的 UI 主术语。

| Canonical Term | UI 主术语（本轮） | 允许补充说法 | 禁止文案 | 说明 |
|---|---|---|---|---|
| Usage Overview Page | 使用概况 | 访问使用概况 | 治理概览（本页主标题）、风控看板 | 页面标题与侧栏 `admin-governance` 项 |
| Configured Agent Count | Agent 总数 | 已配置实例 | access.yaml 中的实例（主 hint） | 不随窗口变 |
| Active Agent | 活跃 Agent | 近 N 有调用 | 最近活跃 Agent（主标签）、活跃实例 | N = 当前窗口 |
| Agent Active Rate | Agent 活跃率 | 活跃 / 总数 | — | 并入「活跃 Agent」卡副行，不再独立成卡 |
| Configured Token Count | 配置 Token | 已下发凭证 | access.yaml 配置数（主 hint） | 不随窗口变 |
| Active Token | 活跃 Token | 近 N 有使用 | 近 7 天活跃 Token（写死）、活跃密钥 | N = 当前窗口 |
| Token Active Rate | Token 活跃率 | 活跃 / 配置 | access_log 去重 prefix | 并入「活跃 Token」卡副行 |
| Configured Table Count | 配置表 | 角色已授权表 | 白名单表、启用表（本页禁止混用） | 授权配置去重；不随窗口变 |
| Active Table Count | 活跃表 | 近 N 有访问 | 热门表（与 Top 10 列表区分） | N = 当前窗口 |
| Call Volume | 调用量 | 近 N MCP 调用 | 最近调用 | 跟随窗口 |
| P95 Response Latency | 响应上限（P95） | 95% 的访问低于此值 | 平均响应时长（本页主 KPI）、AVG(duration_ms) | 跟随窗口；禁止用 avg 顶替 |
| Top Used Tables | 最受访问表 | Top 10 | 热门对象 | **跟随窗口**（修订 Spec 75 固定 7 天） |

Protected terms（DOM 需 `translate="no"` + `notranslate`）：

- `Agent`、`Token`、`MCP`、`P95`
- 表名 / physical table、token hash prefix、role id、Agent id

实现本 Spec 时，须在同一 PR 内将上表写入 `00-product-terminology-standard.md`（至少覆盖本页主标题与 KPI 主术语），避免术语标准与 UI 漂移。Spec 75 §4 中「活跃固定近 7 天 / 平均响应时长为主 KPI」视为被本表覆盖。

## 5. 对 Spec 75 的修订点

| Spec 75 原文 | 本 Spec 修订 |
|---|---|
| 页面标题「治理概览」（实现现状；Spec 75 目标称使用概况） | 标题与侧栏统一为「使用概况」 |
| §5 活跃 Agent/Token 固定近 7 天；独立活跃率卡 | 活跃跟随 `hours`；活跃率并入活跃卡 |
| §5 第 8 项「平均响应时长」 | 主 KPI 改为「响应上限（P95）」；avg 可保留在 API 兼容字段，不驱动主 UI |
| §6.0 / §6.1 `popularTables` 固定 7 天 | `popularTables` 跟随 `hours` |
| §6.0 `activeAgentCount` / `activeTokenCount` 固定 7 天 | 改为传入查询 `hours` |
| §9.1 顶部 8 卡拆分活跃数与活跃率 | 第一排 4 卡：总数 / 活跃(含率) / 配置 Token / 活跃 Token(含率)；第二排：配置表 / 活跃表 / 调用量 / P95 |
| Token 列表 `activeInLast7d` | **废弃**：新增 `activeInWindow`（语义 = 请求 `hours`）；同响应双发 `activeInLast7d = activeInWindow` 一个版本，前端/测试只读新字段 |
| 顶栏可含访问日志入口 | 删除顶栏「访问日志」与窗口 badge |
| §6.1 popularTables 互斥回退 | `popularTables` 仍互斥主路径，但响应必须含 `tableStatsSource`；**`activeTableCount` 改为两源去重并集**（避免部分 sources 时低估） |

交叉引用统一写 **Spec 78** / **Spec 75**，不以工单号作为边界主称。

## 6. 窗口规则

`hours ∈ {24, 168}`，默认 `168`（近 7 天）。

| 类别 | 字段 / UI | 是否跟随 `hours` |
|---|---|---|
| 配置存量 | `agentCount`、`configuredTokenCount`、`configuredTableCount` | **否** |
| 使用活跃 | `activeAgentCount`、`agentActiveRate`、`activeTokenCount`、`tokenActiveRate`、`activeTableCount` | **是** |
| 流量质量 | `calls`、`p95LatencyMs` | **是** |
| 热门表 | `popularTables[]` | **是** |
| Agent 排行 | `calls`、`avgLatencyMs` 或 `p95LatencyMs`、`activeTokenCount` | **是**（活跃 Token 列跟窗口） |
| Token 摘要 | 窗口内活跃标记 | **是** |

文案规则：凡「活跃 / 有调用 / 有访问 / 近窗口」必须写出当前窗口自然语言：

- `hours=24` →「近 24 小时…」
- `hours=168` →「近 7 天…」

禁止主标签使用含糊的「最近活跃」而不带窗口。

## 7. KPI 布局与口径

仍使用 `pl-metric-grid`（4 列 × 2 行），不使用 `pl-metric-grid--three`。

### 7.1 第一排

| 顺序 | 主标签 | 主值 | 副行 / hint |
|---|---|---|---|
| 1 | Agent 总数 | `agentCount` | 「已配置实例（含未启用）」 |
| 2 | 活跃 Agent | `activeAgentCount` | 副行：`活跃率 {agentActiveRate}% · 共 {agentCount} 个`；hint：`近 {窗口} 有调用` |
| 3 | 配置 Token | `configuredTokenCount` | 「已下发凭证（含未启用 Agent）」 |
| 4 | 活跃 Token | `activeTokenCount` | 副行：`活跃率 {tokenActiveRate}% · 共 {configuredTokenCount} 个`；hint：`近 {窗口} 有使用` |

### 7.2 第二排

| 顺序 | 主标签 | 主值 | 副行 / hint |
|---|---|---|---|
| 5 | 配置表 | `configuredTableCount` | 「角色已授权」；若存在开放式授权（prefix / `*`）可附加「含前缀授权」 |
| 6 | 活跃表 | `activeTableCount` | 「近 {窗口} 有访问」；可选副行活跃率 = 活跃表 / 配置表（配置表为 0 时显示 `0%`） |
| 7 | 调用量 | `calls` | 「近 {窗口} MCP 调用」 |
| 8 | 响应上限（P95） | 有样本：`{p95LatencyMs} ms`；无调用：`—` | 有样本：「95% 的访问低于此值」；无调用：「当前窗口无调用」 |

### 7.3 计算口径

- `agentCount` = `access.yaml` `users.length`（**含 `enabled: false`**；已配置容量，非「当前可服务」）
- `activeAgentCount` = `COUNT(DISTINCT user_id)` where `ts >= now - hours` 且 user_id 非空
- `agentActiveRate` = `pct(activeAgentCount, agentCount)`
- `configuredTokenCount` = 各 user（含未启用）`tokens.length` 之和
- `activeTokenCount` = `COUNT(DISTINCT token_hash_prefix)` where `ts >= now - hours` 且 prefix 非空（兼容 `sha256:` 有/无形态的既有匹配规则不变）
- `tokenActiveRate` = `pct(activeTokenCount, configuredTokenCount)`
- `calls` = 窗口内 `COUNT(*)` on `access_log`
- `p95LatencyMs` = 窗口内真实 P95（沿用既有 `queryP95LatencyMs`）；**禁止**用 `AVG` 顶替；`calls === 0` 时 API 仍可返回 `0`，UI 必须显示 `—` /「暂无样本」
- `configuredTableCount` = 全部正式 Role（`access.yaml` `roles`）显式授权表去重：
  - 统计 `tableSelectors.names` 与 legacy `allow.tables` 中的显式表名（展开为可读 ref 后 union）；**禁止**按 role 数远程 N+1
  - `prefix` / `*` 不虚增精确张数，但置 `hasOpenEndedTableScope=true`
- `activeTableCount` = 窗口内 **两源去重并集**：`access_log_sources.physical_table` ∪ `access_log.tables` JSON 展开（避免部分 sources 时低估）
- `popularTables`：Top 10，按 `calls desc`，窗口 = `hours`；排序仍走互斥主路径（有 sources 行则只用 sources，否则回退 tables）；响应须含 `tableStatsSource: "access_log_sources" | "access_log.tables"`；当为 sources 且可能不完整时，列表 notice 可用「仅统计已结构化访问记录」类用户友好提示（不暴露表名）

`usageOverview` 必须成为前端主渲染源；`cards` 仅兼容，不驱动主 UI。`avgLatencyMs` 可继续出现在兼容 payload / Agent 排行列，但顶栏第 8 卡不得再以均值为准。

## 8. API Surface 变更

`GET /api/admin/governance/overview?hours=<24|168>`

`usageOverview` 目标形状：

```json
{
  "agentCount": 3,
  "activeAgentCount": 1,
  "agentActiveRate": 33.3,
  "configuredTokenCount": 3,
  "activeTokenCount": 1,
  "tokenActiveRate": 33.3,
  "configuredTableCount": 12,
  "activeTableCount": 1,
  "hasOpenEndedTableScope": false,
  "calls": 10,
  "p95LatencyMs": 80,
  "avgLatencyMs": 54.7
}
```

overview 根级另含：`tableStatsSource`（见 §7.3）。

约束：

- `active*`、`calls`、`p95LatencyMs`、`popularTables` 必须使用请求 `hours`。
- `agents`：`activeTokenCount` 改为按 `hours`；排行可继续返回 `avgLatencyMs`，并应保证 `p95LatencyMs` 可用（已有则展示 P95 列或与顶栏一致）。
- `tokens`：**必须**返回 `activeInWindow`（布尔，语义 = 请求 `hours` 内有调用）。同响应双发废弃字段 `activeInLast7d`（值等于 `activeInWindow`）一个版本；本 PR 前端与测试**只读** `activeInWindow`，禁止再按「固定 7 天」解释旧字段名。

## 9. UI UX

### 9.1 Header

- `title`：使用概况
- `description`：查看 Agent、Token 和数据表的活跃度、调用量与响应耗时（专业词保留 `notranslate`）
- `badges`：删除窗口 badge
- `actions`：仅保留窗口切换；「管理角色」可选保留为次级；**删除「访问日志」**

### 9.2 列表区

- Agent 使用排行说明：改为「按近窗口调用量排序；活跃 Token 与顶部窗口一致。」
- Token 使用摘要说明：去掉「活跃判定固定近 7 天」；列「最近活跃」改为「窗口内活跃」或等价，badge 文案「活跃 / 未活跃」保留。
- 最受访问表说明：改为「近 {窗口} 按调用次数排序」；禁止主文案暴露 `access_log_sources`；空态「暂无表访问数据（近 {窗口}）」。

### 9.3 空态与零值

- 无调用时：活跃类指标为 0，比率为 `0%`；P95 主值显示 `—`（或「暂无样本」），hint「当前窗口无调用」——**禁止**展示「0 ms」+「95% 的访问低于此值」。
- 配置表为 0 时不除零；活跃表率显示 `0%`。

### 9.4 命名同步范围

同 PR 必须同步用户可见/索引文案：

- `docs/00-product-terminology-standard.md`
- `docs/06-navigation-ia.md`（补「使用概况」→ `/admin/governance`）
- 侧栏 `navigation.ts` + 相关 Vitest
- `rg`「治理概览」命中的用户可见文案 / docs 索引（历史工单文件名可保留）

## 10. Acceptance Criteria

- [ ] 侧栏与页面标题均为「使用概况」；不再以「治理概览」作为本页主标题；`06-navigation-ia.md` 已登记。
- [ ] 顶栏无「N 小时窗口」badge，无「访问日志」按钮；有 `24 小时` / `7 天` 切换。
- [ ] 切换到 24 小时后：活跃 Agent/Token/表、调用量、P95、热门表文案与数值均按 24 小时；Agent 总数 / 配置 Token / 配置表不变。
- [ ] KPI 为 8 卡两排：活跃 Agent/Token 卡内含活跃率；第二排含配置表、活跃表、调用量、响应上限（P95）。
- [ ] 用户可见 hint 不出现 `access_log`、`AVG(duration_ms)`、`去重 prefix`、`access_log_sources`。
- [ ] `p95LatencyMs` 为真实 P95，非 avg 顶替；无调用时 UI 不为「0 ms + 95% 文案」。
- [ ] `activeTableCount` 为两源并集；`popularTables` 含 `tableStatsSource`。
- [ ] tokens 返回 `activeInWindow`；前端不依赖「固定 7 天」解释。
- [ ] 配置存量口径明确含未启用 Agent。
- [ ] 术语已写入 `00-product-terminology-standard.md`；`lint:terminology` 通过。
- [ ] 相关 Vitest（`admin-governance-observability` 前后端）与 `build` 通过。
- [ ] 未把 Role 边界 / 拒绝原因拉回主屏；未改 ACL / `access.yaml` schema。
- [ ] 本轮不强制浏览器复核；合入后台账标 `Fixed`。

## 11. Design System Compliance

- 引用：`webui/docs/design-system/` Foundations / Patterns（page stack、metric grid、panel）。
- 根容器 `pl-page-stack`；指标 `pl-metric-grid`；列表 `pl-panel` + `pl-section-heading` / `pl-panel-title`。
- 不引入新视觉模式；MetricCard 副行可用既有 `<small>` / 次级文本，不新增卡片变体规范。

## 12. Out of Scope

- Risk Review / 拒绝原因趋势 / Release readiness。
- URL 重命名到 `/admin/usage`。
- 启用表范围（数据接入）统计混入本页「配置表」。
- 浏览器 E2E / 移动窄屏。
- Agent 排行强制删除 `avgLatencyMs` 列（可选保留为次级列；顶栏必须以 P95 为准）。
