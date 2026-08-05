# Agent Admin Stability and Adoption KPI Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Agent Admin Stability and Adoption KPI Spec |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-05 |
| 撰写人 | Auto |
| 委托人 | zhangxingchen |
| 基于材料 | 2026-08-05 用户反馈；`/admin/agents`、`/admin/usage`、`/catalog` 核查；`webui/docs/88-agent-admin-list-ia-terminology-and-table-grid-spec.md`；`docs/ui-ux-feedback/pages/admin-agents.md` |
| 适用范围 | `/admin/agents` KPI、明细表字段与筛选器结构（稳定性/使用率优先） |
| 输出位置 | `webui/docs/93-agent-admin-stability-adoption-kpi-and-filters-spec.md` |

| 字段 | 内容 |
|---|---|
| Spec 编号 | 93 |
| 关联工单 | `webui/docs/plans/wo-202608-26-agent-admin-stability-adoption-kpi-and-filters.md` |
| 关联页面 | `/admin/agents` |
| 关联台账 | `docs/ui-ux-feedback/pages/admin-agents.md`（`UX-ADMIN-AGENTS-031`～`033`） |
| 状态 | Implemented |
| 日期 | 2026-08-05 |

## 1. 背景

Agent 列表页当前仍保留“拒绝向”指标与旧字段顺序。新起步系统阶段，运维优先级应从“拦截审计”转向“稳定可用 + 被持续使用”：

1. KPI 以稳定性、活跃率、使用率为主。
2. 明细表优先暴露“谁在服务、是否活跃、配置是否有变化”。
3. 筛选器应从单一状态筛选升级为多维治理筛选，结构对齐 `/catalog` 的「搜索 + 多下拉」。

## 2. 目标

1. KPI 四卡调整为：
   - `Agent 总数`
   - `近 7 天调用量`
   - `近 7 天活跃 Agent`
   - `近 7 天活跃 Token`
2. 明细表重排为稳定性/使用率优先视角，并补齐时间字段。
3. 增加关键维度筛选器：角色、近 7 天活跃。（**注**：Spec 95 已删除「配置 Token 分层」筛选。）

## 3. 非目标

- 不新增 24h/7d 窗口切换。
- 不删除后端 `deniedLast7d` 数据字段（仅从列表 KPI/表格主视图移除）。
- 不做浏览器验证（本轮按要求仅 code review + 测试命令）。

## 4. 指标口径

| 指标 | 定义 |
|---|---|
| Agent 总数 | `agents.length` |
| 近 7 天调用量 | `sum(agent.stats.callsLast7d)` |
| 近 7 天活跃 Agent | `count(agent.stats.callsLast7d > 0)` |
| 近 7 天活跃 Token | `sum(agent.stats.activeTokensLast7d)` |

说明：`近 7 天活跃 Agent` 新增到 `GET /api/admin/agents` summary（并保留前端 fallback 计算）。

## 5. 明细表字段与顺序

按业务价值与相似性重排为：

1. `序号`
2. `Agent 名称`
3. `角色`
4. `当前状态`
5. `近 7 天访问次数`
6. `近 7 天活跃的 Token 数`
7. `最近访问时间`
8. `配置 Token 数`
9. `配置最后变更时间`
10. `创建日期`
11. `操作`

后端补充：

- `createdAt`: `config_change_log` 中该 Agent `change_type='agent_create'` 最早 `ts`。
- `configUpdatedAt`: `agent_create / agent_patch / token_create / token_revoke` 最大 `ts`。

## 6. 筛选器结构

筛选条保持与 `/catalog` 一致的「搜索 + 维度下拉」：

- 搜索：`搜索显示名或用户 ID`（Spec 95 统一命名）
- 状态：`全部 / 已启用 / 已禁用`
- 角色：`全部角色 / 未绑定角色 / 具体 role`
- 活跃：`近 7 天活跃：全部 / 有访问 / 无访问`

（配置 Token 分层已由 Spec 95 删除。）

## 7. 验收标准

- [ ] 顶部 KPI 不再出现 `近 7 天拒绝`。
- [ ] `metric-active-agent-count` 存在且口径正确。
- [ ] 表头含 `序号`、`当前状态`、`配置最后变更时间`、`创建日期`。
- [ ] 表头不再出现 `近 7 天拒绝`。
- [ ] 筛选条存在「角色」「近 7 天活跃」下拉（配置 Token 分层已由 Spec 95 移除）。
- [ ] `agent-list.test.tsx`、`lint:terminology`、`build` 通过。
