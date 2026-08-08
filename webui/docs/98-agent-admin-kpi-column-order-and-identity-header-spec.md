# Agent Admin KPI Column Order & Identity Header Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Agent Admin KPI Column Order & Identity Header Spec |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-05 |
| 撰写人 | Auto |
| 委托人 | zhangxingchen |
| 基于材料 | 2026-08-05 浏览器核查 `http://127.0.0.1:55176/admin/agents`；用户反馈三点；Spec 93 / Spec 95；`docs/ui-ux-feedback/pages/admin-agents.md` |
| 适用范围 | `/admin/agents` KPI 顺序、明细表指标/时间列顺序、主列表头命名 |
| 输出位置 | `webui/docs/98-agent-admin-kpi-column-order-and-identity-header-spec.md` |

| 字段 | 内容 |
|---|---|
| Spec 编号 | 98 |
| 关联工单 | `webui/docs/plans/wo-202608-31-agent-admin-kpi-column-order-and-identity-header.md` |
| 关联页面 | `/admin/agents` |
| 关联台账 | `docs/ui-ux-feedback/pages/admin-agents.md`（`UX-ADMIN-AGENTS-037`～`039`） |
| 上游 Spec | Spec 93（KPI/表字段）；Spec 95（显示名/用户 ID） |
| 状态 | Implemented |
| 日期 | 2026-08-05 |
| 范围 | KPI 重排；表指标/时间列重排；主列改为「显示名/用户 ID」 |

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | 初稿并落地 |

## 1. 背景

浏览器核查确认（2026-08-05）：

1. **KPI 叙事打断**：当前为 `Agent 总数` → `近 7 天调用量` → `近 7 天活跃 Agent` → `近 7 天活跃 Token`。调用量夹在「存量」与「活跃覆盖」之间，不符合「先看有多少/谁在用，再看用了多少」。
2. **表列分组混乱**：指标列为 `近 7 天调用量` → `近 7 天活跃 Token` → `最近访问时间` → `配置 Token` → `配置最后变更时间` → `创建日期`。配置 Token 与活跃 Token 不相邻；时间列未按生命周期顺序。
3. **主列名与单元格不对齐**：表头为 `显示名`，单元格双行展示显示名 + 用户 ID；搜索已是「搜索显示名或用户 ID」。

## 2. 目标

1. KPI 顺序改为：**存量 → 活跃覆盖 → 使用强度**。
2. 明细表指标/时间列改为：**配置 Token → 活跃 Token → 调用量 → 创建 → 配置变更 → 最近访问**。
3. 列表主列头改为 **`显示名/用户 ID`**（详情可编辑字段仍叫「显示名」）。

## 3. 非目标

- 不改 KPI 口径、筛选器、操作列。
- 不拆「显示名」「用户 ID」为两列。
- 不改详情页 H1 / 表单字段标签。
- 不做浏览器验证（本轮结束后只做 code review）。

## 4. Terminology Compliance

| Canonical Term | UI 主术语 | 禁止 | 说明 |
|---|---|---|---|
| Agent List Identity Column | 显示名/用户 ID | 列表主列仅写「显示名」且忽略次行用户 ID | 列表主列头；双行单元格：主行显示名、次行用户 ID |
| Agent Display Name | 显示名 | — | 详情可编辑字段、新建表单；不变 |
| Agent User ID | 用户 ID | — | 详情只读、搜索；不变 |
| Agent List Search | 搜索显示名或用户 ID | — | placeholder；不变 |

文案统一：表头用「近 7 天活跃 Token」「近 7 天调用量」「配置 Token」「配置最后变更时间」（与术语 §4.5 / Spec 93 一致）；禁止「7 天活跃 Token」「近 7 天调用」（缺「量」）作为表头。

## 5. UI 变更

### 5.1 KPI 顺序

| 位次 | testId | 主标签 |
|---|---|---|
| 1 | `metric-agent-count` | Agent 总数 |
| 2 | `metric-active-agent-count` | 近 7 天活跃 Agent |
| 3 | `metric-active-token-count` | 近 7 天活跃 Token |
| 4 | `metric-calls` | 近 7 天调用量 |

### 5.2 明细表列顺序

固定列序：

1. `序号`
2. `显示名/用户 ID`
3. `角色`
4. `当前状态`
5. `配置 Token`
6. `近 7 天活跃 Token`
7. `近 7 天调用量`
8. `创建日期`
9. `配置最后变更时间`
10. `最近访问时间`
11. `操作`

单元格双行结构不变（主行 `agent.name`，次行 `agent.id` + `notranslate`）。

## 6. 验收标准

- [x] KPI DOM 顺序为：总数 → 活跃 Agent → 活跃 Token → 调用量。
- [x] 表头列为 §5.2 顺序；主列为 `显示名/用户 ID`。
- [x] `agent-list.test.tsx` 覆盖顺序与列名；`lint:terminology`、`build` 通过。
- [x] 台账 `UX-ADMIN-AGENTS-037`～`039` → `Fixed`；本轮不做浏览器验证。

## 7. 对上游 Spec 的澄清

### Spec 93

- §2 KPI 四卡**内容**不变；**顺序**以本 Spec §5.1 为准（调用量移至末位）。
- §5 明细表字段**集合**不变；**指标/时间列顺序**以本 Spec §5.2 为准。

### Spec 95

- §5.1「表头主列：`显示名`」修订为「表头主列：`显示名/用户 ID`」；次行仍展示用户 ID。
- 搜索 / 详情「显示名」字段标签不变。
