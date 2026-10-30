# 访问分级与日真实问询 KPI 实施 Plan

| 元数据 | 内容 |
|---|---|
| 文档版本 / 日期 | **v1.0** / 2026-10-30 |
| 目标版本 / 优先级 | 不绑定产品版本号 / **P0**（S1–S2）+ P1（S3） |
| 主 Spec | [访问分级与日真实问询 KPI Spec](../specs/lucy-20261030-access-grade-and-daily-question-kpi-spec.md)（**v1.0**） |
| 功能编号 | **Spec 194**。WebUI 流水号，`webui/docs/` 已占用至 193，本项取下一号。不进入 v0.25 升级台账，不占用 `L25-*` |
| 需求来源 | 2026-10-30 客户反馈：每天要统计真实问询数，而不是把连接、浏览和查数混在一个用量里 |
| 状态 | **S1–S3 已落地**（2026-10-30）。未做浏览器验证，未做 Docker 重建 |
| 授权边界 | 2026-10-30 授权实现 Spec。不包含 Docker 重建，也不包含浏览器验证 |
| 验收 | SC-01–SC-24、SC-26 已由自动化测试覆盖。SC-25 沿用 `webui/server/__tests__/proxy-audit.test.ts` 中「会话建立：claude-code」的既有断言，本轮未改问询重建 |
| 实施主体 | Lucy（用量分类读取层 + 使用概况 API 与数据访问视图）。不修改 KTX 源码 |
| 已拍板决策 | Spec §4 的 D1–D9 已冻结 |
| 待确认 | 没有未决项。功能编号已取 Spec 194 |

---

## 1. 目标

在使用概况的数据访问视图上给出「近 N 真实问询」，并把仅连接、浏览未问、未上报查数会话分开计数。访问等级在读取时从工具名派生。Spec 189 的调用量恒等式和活跃 Agent 分子保持原样。

四个交付物：

1. **访问等级**（S1）——与 `classifyUsage` 同一模块，SQL 与 TypeScript 同一份名单。
2. **窗口聚合**（S2）——扩展现有 overview 接口，不新增路由，不新增表。
3. **数据访问视图**（S3）——四张 Metric Card 和按日问询表。界面使用视图不展示。
4. **口径不漂移**（S2）——同一夹具上 Spec 189 的 `usageCalls` 与恒等式在改动前后一致。

实施原则：

- 先有等级和聚合测试，再上卡片。
- 真实问询只数已落库的 `reported_tool` 与历史 `reported`。
- 不把四个数加总成一个「总访问」。
- 不改审计问询重建，不改问询预算工具集。
- 术语标准已在本 Plan 落盘时登记。实现时只消费这些主术语，不另起译名。

## 2. 开工前置

### S0 开工裁决（实现已授权）

D1–D9 已按 Spec §4 冻结。2026-10-30 授权实现，不含 Docker 重建。

开工后仍须遵守：

- `buildMetricWindow` 是唯一窗口生成器。
- 上海日固定 UTC+8，不用容器本地时区。
- 评测探针沿用 `isEvalProbeCall`，不新写一套探针规则。
- 控制面名单只引用 `CONTROL_PLANE_TOOL_NAMES`，不复制第二份。
- 空 `intentSummary` 继续不落问询、不拒绝其后的查数。
- 单实例部署边界不变。验收不要求多副本一致性。

**退出条件**：设计裁决已满足。实现已按 2026-10-30 的授权完成，不含 Docker 重建。

## 3. 现状依赖与文件落点

### 3.1 复用

| 复用 | 位置 | 说明 |
|---|---|---|
| 用量三层 | `webui/server/proxy/usage-classification.ts` | 在此文件增加等级函数与 SQL 条件，不另建分类模块 |
| 探针判定 | 同文件 `isEvalProbeCall` | 新 KPI 先排除探针 |
| 协议判定 | 同文件 `isMcpProtocolMethod` | 连接级只走这里 |
| 控制面名单 | `webui/server/ops/control-plane.ts` | 等级跟随该常量 |
| 原文问询写入 | `webui/server/proxy/mcp-proxy.ts` 的 `questionSource: "reported_tool"` | 分子接受 `reported_tool` 与 `reported` |
| 问询表 | `conversation_turns` | 只读。可加 `session_id` 索引，不新建表，不改已有行 |
| 窗口 | `webui/server/admin/metric-window.ts` | 24 与 168 小时 |
| Overview | `GET /api/admin/governance/overview`，`webui/server/admin/governance-observability.ts` | 加字段，不改既有字段的查询 |
| 指标契约 | `webui/src/lib/kpiContracts.ts` | 新指标注册标题与帮助文案 |
| 使用概况页 | `webui/src/pages/admin/GovernanceOverview.tsx` | 数据访问视图加一组卡片和表 |

### 3.2 计划新增文件

| 文件 | 用途 | 阶段 |
|---|---|---|
| `webui/server/__tests__/access-grade.test.ts` | 等级名单、未分级、与用量类正交、TS/SQL 一致 | S1 |
| `webui/server/__tests__/daily-question-kpi.test.ts` | SC-04–SC-23 的窗口聚合 | S2 |

### 3.3 计划修改文件

| 文件 | 改动 | 阶段 |
|---|---|---|
| `webui/server/proxy/usage-classification.ts` | 导出等级常量、`accessGrade`、SQL 条件 | S1 |
| `webui/server/proxy/audit.ts` | 若 `conversation_turns.session_id` 无索引，则 `CREATE INDEX IF NOT EXISTS` | S2 |
| `webui/server/admin/governance-observability.ts` | overview 增加 Spec §6.5 字段；失败时 `unavailable` | S2 |
| `webui/server/__tests__/usage-governance.test.ts` | 断言 Spec 189 恒等式未被新聚合改写 | S2 |
| `webui/src/lib/kpiContracts.ts` | 登记新指标 | S3 |
| `webui/src/__tests__/kpi-contracts.test.ts` | 守卫新标题与禁止混称 | S3 |
| `webui/src/pages/admin/GovernanceOverview.tsx` | 四张卡与按日表；界面使用不渲染 | S3 |
| `webui/src/__tests__/admin-governance-observability.test.tsx` | SC-24 的视图分界 | S3 |

本落盘已经修改、实现阶段只核对不重写口径的文件：

| 文件 | 已写入的内容 |
|---|---|
| `webui/docs/00-product-terminology-standard.md` | §4.5 新术语行 |
| `webui/docs/189-usage-metrics-truthfulness-and-cross-page-consistency-spec.md` | 尚未实现的交叉引用 |
| `webui/docs/156-runtime-status-usage-boundary-spec.md` | 尚未实现的修订声明 |
| `docs/README.md`、`docs/plans/README.md` | 索引 |

不修改：`question-experience.ts`、`turn-correlation.ts`、`acl.ts` 的授权分类、审计问询重建、`data-qa-instructions.md`、KTX。

## 4. 阶段

### S1 访问等级

1. 在 `usage-classification.ts` 按 Spec §5.1 导出浏览、准备、问询动作、查数名单。运维操作引用 `CONTROL_PLANE_TOOL_NAMES`。
2. 实现 `accessGrade`。协议判定先于名单。未知名返回 `unclassified`。
3. 为每个等级提供 `?`-free 的 SQL `IN` 列表，字面量来自同一常量。连接级 SQL 复用 `protocolConditionSql`。
4. 测试覆盖 SC-01、SC-02、SC-03、SC-16、SC-26。

**退出条件**：上述 SC 通过。Spec 189 既有分类测试不需要改期望。

### S2 窗口聚合

1. 按 Spec §6 与 §7 在 overview 的同一次窗口上计算新字段。会话是否「曾经有原文问询」按 `session_id` 查全表，不把查找限制在窗口内。
2. 按日切分使用 UTC+8，不用 `localtime`。
3. 无法解析的时间戳计入 `skippedBadTimestamp`，不把整卡打成 `partial`。库不可读时四张主卡为 `unavailable` / `null`。
4. 真实问询为 0 且查询成功时是 `ok` / `0`。每问询查数在分母为 0 时是 `no_data` / `null`。
5. 测试覆盖 SC-04–SC-15、SC-17–SC-23。SC-17 使用现有混合夹具，断言 `usageCalls` 与恒等式不变。

**退出条件**：上述 SC 通过。overview 的既有 `activeAgentCount` 在同一夹具上与改动前一致。

### S3 数据访问视图

1. 在三张资产卡下方增加四张 Metric Card 和按日问询表。顺序与文案以术语标准为准。
2. `partialDay` 为真的日期显示「未覆盖全天」。
3. 副文按 Spec §6.5 显示问询活跃 Agent、每问询查数、未挂接查数、未归属查数。次数为 0 时不写出那一句。
4. `?view=interface` 不渲染这组 UI。
5. 测试覆盖 SC-24。SC-25 用现有审计问询测试确认会话访问仍在列表中；本阶段不改那条重建路径。若现有测试已覆盖，不重复造一份重建测试，只在本阶段记录所引用的测试名。

**退出条件**：SC-24、SC-25 通过。`cd webui && npm run lint:terminology` 通过。

## 5. 验收

验收条目就是 Spec §8 的 SC-01–SC-26。阶段对应关系：

| 阶段 | SC |
|---|---|
| S1 | SC-01、SC-02、SC-03、SC-16、SC-26 |
| S2 | SC-04–SC-15、SC-17–SC-23 |
| S3 | SC-24、SC-25 |

任一 SC 未执行，不得把本 Plan 标成已完成。测试文件变绿不等于客户现场已经对上某一天的问询数。

## 6. 完成定义

同时满足才算完成：

1. SC-01–SC-26 均有记录在案的通过结果。
2. Spec 189 混合夹具上的调用量恒等式与 `usageCalls` 不变。
3. 数据访问视图能看出真实问询、未上报查数会话、仅连接会话、浏览未问会话和按日分布。
4. 界面使用、调用监控、审计问询列表的既有主指标没有改口径。
5. 用户可见文案与术语标准 §4.5 的新行一致。
6. 功能编号为 **Spec 194**，已回写本 Plan 与 Spec 头部，并占用 `webui/docs/194-access-grade-and-daily-question-kpi-spec.md`。不写入 v0.25 升级台账。

## 7. 风险

| 风险 | 表现 | 处置 |
|---|---|---|
| 客户端经常不调用 `lucy_begin_question` | 真实问询偏低 | 未上报查数会话单独成卡，禁止加进主值 |
| 回填注释写 `reported`，写入值是 `reported_tool` | 只认其中一个会把分子打成 0，或把历史行漏掉 | 两个值都进入分子。本期不改回填代码 |
| 滚动窗口跨过上海日界 | 边缘日看起来像一整天 | `partialDay` 与「未覆盖全天」 |
| 空会话 ID | 若按行造会话，未上报数会被放大 | 未归属查数按调用计 |
| 同一会话先浏览后查数 | 两天各算一次会让按日合计大于卡片 | 会话类互斥，归到决定该类的最早一行 |
| 新工具未归级 | 若默认成查数，KPI 会悄悄变大 | 未分级，主 KPI 不增加 |
| Spec 189 尚未验收 | 若顺手改活跃 Agent，两次数值迁移叠在一起 | D5：活跃 Agent 的查询不改 |
| 问询表按 `session_id` 全表查找 | 窗口很长时变慢 | S2 允许补索引；不建汇总表 |
| 有人把四张卡加总 | 运维会得到一个新的混合数 | 卡片之间不提供合计；帮助文案写明不能相加 |

回滚：S3 先撤 UI，S2 再撤 overview 新字段。S1 的等级函数没有调用方时可以保留。不需要数据迁移回滚，因为没有写新的业务行。

## 8. 落盘清单勾销

对照 [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「新增 Spec / Plan 的落盘清单」：

| # | 结果 |
|---|---|
| 1 | Spec 在 `docs/specs/lucy-20261030-access-grade-and-daily-question-kpi-spec.md`，Plan 在 `docs/plans/2026-10-30-lucy-access-grade-and-daily-question-kpi-plan.md` |
| 2 | Spec 含「核心流程（伪代码）」 |
| 3 | Spec 头部有文档类型 / 版本与状态；Plan 头部有状态、授权边界、验收 |
| 4 | 本 Plan 含目标、开工前置、验收、完成定义、风险 |
| 5 | Spec 的 Terminology Compliance 含 `This feature follows` 与 `New terms:` |
| 6 | Spec 的 Design System Compliance 含规定四段 |
| 7 | 已登记 `docs/README.md` 与 `docs/plans/README.md` |
| 8 | 不适用。本功能不新增命令或 CI job |
| 9 | 功能编号 **Spec 194**。已回写 Spec、本 Plan，并占用 WebUI 流水号文件。不写入 v0.25 升级台账 |
| 10 | 2026-10-30 已跑。`lint:terminology`、`lint:spec`、`lint:ia-boundary` 通过。`lint:spec-docs` 对本 Spec 与本 Plan 无形态违规。同一次命令还报了仓库里已有的 `docs/specs/lucy-ci-restoration-spec.md` 与 `docs/plans/2026-10-29-ci-restoration-plan.md`，与本功能无关，不写入基线。门禁结果不代替本表 |
