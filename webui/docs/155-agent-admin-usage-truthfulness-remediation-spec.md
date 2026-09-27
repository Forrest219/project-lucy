# Agent Admin 使用真实性修复 Spec

| 元数据 | 内容 |
|---|---|
| Spec 编号 | 155 |
| 版本 | v1.0 |
| 日期 | 2026-09-27 |
| 状态 | Implemented |
| 页面 | `/admin/agents` |
| 关联 Spec | 07、128、143 |

## 1. 背景与决策

MCP 客户端配置 Lucy 后，初始化握手、工具发现和真实业务工具调用都会进入 `access_log`。旧 Agent 页把这些记录统一计为“调用”，并把最近 7 天窗口内的 `MAX(ts)` 当成“最近访问”，会造成协议握手被误判为真实使用、历史用户被显示为“未访问”、数据库故障被显示为 0。

本修复认同保留全量日志用于审计，但反对用全量日志直接表达业务活跃。页面同时提供审计视角和业务视角：

- 协议请求：`initialize`、`notifications/initialized`、`tools/list`。
- 业务调用：`access_log` 中除协议请求外的记录。
- 最近 MCP 访问：该 Agent 全历史最后一条访问日志时间。
- 最近业务使用：该 Agent 全历史最后一条业务调用时间。
- 近 7 天活跃 Agent：窗口内至少一次业务调用的去重 Agent。

## 2. Token 生命周期与统计

| 指标 | 定义 |
|---|---|
| 配置 Token | 当前仍存在于 `access.yaml` 的 Token 行数，不考虑是否过期 |
| 可用 Token | Agent 已启用且 Token 未过期的当前配置数 |
| 近 7 天使用过的凭据 | 窗口内 `access_log.token_hash_prefix` 的去重数；可含已删除或已吊销凭据 |

凭据日志只保存 hash prefix。当当前配置存在相同 prefix 时，近窗凭据数不能可靠映射到唯一 Token，状态必须为 `partial`，UI 显示破折号和原因，不得展示为精确值。

## 3. 状态与兼容

- `ok`：审计库读取成功，指标可按定义计算。
- `partial`：数据可读但存在已知歧义或当前进程观察到审计写入失败/尚未完成。
- `unavailable`：审计库读取失败，窗口指标返回 `null`。
- 旧字段 `callsLast7d`、`activeTokensLast7d` 保留兼容；分别继续表示全量调用与使用过的凭据。新 UI 只消费语义明确的新字段。
- 所有窗口指标使用同一个 `windowStart/windowEnd`。

## 4. 刷新与完整性

- 页面默认每 30 秒轮询，可关闭自动刷新并可手动刷新。
- 顶部展示“统计时间”。
- 完整性只报告当前 Lucy 进程可观察到的审计写入 pending / failed 状态；不得宣称覆盖进程启动前、其他实例或外部删除造成的缺口。

## 5. Terminology Compliance

新增术语已先登记到 `00-product-terminology-standard.md`：近 N 业务调用量、近 N 协议请求量、最近 MCP 访问、最近业务使用、可用 Token、近 N 使用过的凭据、审计写入完整性。`Agent`、`Token`、`MCP` 与 hash prefix 继续使用翻译防御。

## 6. 核心流程（伪代码）

```text
window = build7dWindowOnce()
config = readAccessYaml()
health = readCurrentProcessAuditWriteHealth()

try:
  rows = aggregate access_log by user_id using window
  for agent in config.users:
    total = protocol + business
    lastMcp = MAX(all rows)
    lastBusiness = MAX(non-protocol rows)
    configured = agent.tokens.length
    available = agent.enabled ? count(non-expired tokens) : 0
    usedCredentials = COUNT(DISTINCT prefix in window)
    credentialState = prefixCollision(agent/config) ? partial : ok
catch audit database error:
  all audit-derived values = null
  metricsState = unavailable

summary.businessActiveAgents = count(agent.businessCalls > 0)
summary.auditCompleteness = unavailable | partial | ok
UI never converts null or partial to zero
```

## 7. 验收标准

1. 仅握手会增加协议请求，不增加业务调用或业务活跃 Agent。
2. 7 天前有日志的 Agent 显示历史“最近 MCP 访问”，近 7 天业务调用为 0。
3. 审计库不可用时，行与汇总显示“— / 数据不可用”，不显示 0 或“不活跃”。
4. Agent 禁用或 Token 过期时，可用 Token 为 0；配置 Token 仍保留。
5. prefix 碰撞时凭据指标显示部分可信，不输出伪精确值。
6. 页面可手动刷新，默认 30 秒自动刷新，并显示统计时间与完整性提示。
