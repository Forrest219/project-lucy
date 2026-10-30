# Agent 名册实施 Plan

| 元数据 | 内容 |
|---|---|
| 文档版本 / 日期 | **v1.2** / 2026-10-30 |
| 目标版本 / 优先级 | 不绑定产品版本号 / P1 |
| 主 Spec | [Agent 名册 Spec](../specs/lucy-20261030-agent-roster-spec.md)（**v1.2**） |
| 台账号 | 无。不进入 v0.25 升级台账，不另派 WebUI 流水号 |
| 需求来源 | 2026-10-30：`/admin/agents` 对数据平台经理来说指标过多。名册只回答谁能访问、凭据还能不能用、这周有没有在查数 |
| 状态 | **v1.2 已定稿**。S1、S2 已按本 Plan 实现，SC-01–SC-15 已执行并通过（2026-10-30，记录见 §5） |
| 授权边界 | 2026-10-30 定稿。第 3 轮 Codex 确认可定稿。可以按本 Plan 的 S1、S2 改页面。审阅回合本身不改页面 |
| 验收 | SC-01–SC-15 已执行并通过。命令与结果见 §5 |
| 实施主体 | Lucy WebUI。不修改 KTX 源码 |
| 已拍板决策 | Spec §4 的 D1–D13 已冻结。D13 只补抽屉在不可用与空值上的顺序 |
| 待确认 | 无 |

## 1. 目标

把 `/admin/agents` 收成六列名册和四张卡。仅连接可以看见、可以筛选，并且不进入近 7 天活跃 Agent。协议请求量和最近 MCP 访问改到对象详情抽屉。接口字段保留。

四个交付物：

1. **名册呈现**（S1）——四张卡、六列表、Token 格、已禁用标记、仅连接标记。
2. **筛选**（S1）——全部、有业务调用、仅连接、闲置。指标不可用只留在全部。
3. **抽屉**（S2）——补协议请求量、最近业务使用、最近 MCP 访问。
4. **口径不漂移**（S1）——活跃 Agent 仍只数 `usageCallsLast7d > 0`。契约里本页不再登记「使用过的凭据」。

实施原则：

- 分类在页面派生，不新增接口字段。
- 窗口只用响应里的 `windowStart` / `windowEnd`。
- 术语以术语标准 §4.5 已登记的主术语为准，不另起译名。
- 不改 Token 清单、Agent 详情、使用概况和调用监控。

## 2. 开工前置

D1–D13 已按 Spec §4 冻结。术语标准 §4.5 已登记仅连接、闲置、无可用 Token、Token 列和已禁用标记。2026-10-30 已定稿，可以按 S1、S2 开发。实现时仍须遵守：

- 活跃 Agent 与业务调用量继续读 `usage*` 字段。
- 仅连接不参与活跃 Agent 的分子。
- 缺窗口时不启用时间条款。
- 不删除 `protocolCallsLast7d`、`lastSeen`、`usedCredentialCountLast7d`。
- 不把近 7 天拒绝放回主表。
- 不做移动窄屏验收，不改壳层最小宽度。

**退出条件**：设计已定稿。实现从 S1 开始。

## 3. 现状依赖与文件落点

### 3.1 复用

| 复用 | 位置 | 说明 |
|---|---|---|
| 用量字段 | `GET /api/admin/agents` 已有的 `usageCallsLast7d`、`protocolCallsLast7d`、`lastBusinessSeen`、`lastSeen`、`metricsState` | 不新算一套 |
| 窗口 | 同一响应的 `summary.windowStart` / `windowEnd` | 半开区间 |
| 可用 Token | `stats.availableTokens` 与 `tokens.length` | Token 格不读访问日志 |
| 指标卡 | `MetricCard` 与默认 `pl-metric-grid` | 去掉 `--three` |
| 最近业务使用的空值 | 现有 `LastSeen` 的「未使用」 | 仅连接标在它旁边 |
| 抽屉 | `ObjectDetailDrawer.tsx` 的 `AgentDetailBody` | 加三行，保留拒绝和业务调用量 |

### 3.2 计划修改文件

| 文件 | 改动 | 阶段 |
|---|---|---|
| `webui/src/pages/admin/AgentList.tsx` | 四张卡、六列表、Token 格、已禁用、仅连接、四档筛选；去掉凭据冲突提示 | S1 |
| `webui/src/lib/kpiContracts.ts` | `used-credential-count.pages` 去掉 `/admin/agents` | S1 |
| `webui/src/__tests__/agent-list.test.tsx` | SC-01–SC-09、SC-11、SC-14、SC-15，并替换下面点名的旧断言 | S1 |
| `webui/src/__tests__/kpi-contracts.test.ts` | SC-12。`every entry has required fields` 里「至少一页」为 `used-credential-count` 放行空 `pages` | S1 |
| `webui/src/components/ObjectDetailDrawer.tsx` | 抽屉三行。不可用先于空值 | S2 |
| `webui/src/__tests__/object-detail-drawer.test.tsx` | SC-10 | S2 |

本落盘已经修改、实现阶段只核对不重写口径的文件：

| 文件 | 已写入的内容 |
|---|---|
| `webui/docs/00-product-terminology-standard.md` | §4.5 新术语，以及协议请求、最近 MCP 访问、使用过的凭据的展示位置 |
| `webui/docs/155-agent-admin-usage-truthfulness-remediation-spec.md` | 名册呈现改由本 Spec 规定；指标定义仍有效 |
| `webui/docs/189-usage-metrics-truthfulness-and-cross-page-consistency-spec.md` | 用量口径不变；名册不再渲染协议卡和主表上的最近 MCP 访问 |
| `docs/README.md`、`docs/plans/README.md` | 索引 |

不修改：`webui/server/admin/agents.ts` 的聚合、`/admin/tokens`、Agent 详情页、使用概况、调用监控、KTX。

## 4. 阶段

### S1 名册

1. 按 Spec §5.1–§5.4、§6 和核心流程改 `AgentList.tsx`。窗口只读 `summary.windowStart` 与 `summary.windowEnd`。
2. 更新 `kpiContracts.ts`：`used-credential-count.pages` 去掉 `/admin/agents`。
3. 改写 `agent-list.test.tsx` 里这些必然冲突的旧断言，不保留旧列或旧卡的期望：
   - `renders 未访问 for agents that have never been seen`：主表空的最近业务使用改为「未使用」。「未访问」不再出现在主表。
   - `renders relative last seen and keeps full timestamp in title attribute`：可见相对时间改由 `lastBusinessSeen` 驱动。
   - `renders stability-and-adoption top metrics`：六张卡、`metric-used-credentials`、`metric-protocol-calls` 和 `pl-metric-grid--three` 改为 SC-01 的四张卡。
   - `renders prioritized table columns for ops value`：十二列表头改为 SC-02 的六列。
4. 用 Spec §7.1 的同一组 id 覆盖 SC-05–SC-09、SC-14、SC-15。筛选断言比较行 id 集合和顺序，不只比较选项文字。SC-09 必须包含：去掉 `windowStart` 后，协议量大于 0 仍为仅连接；`a-time` 在同一缺口下进入闲置。
5. 测试覆盖 SC-01–SC-04、SC-11、SC-12。SC-13 用现有接口测试确认三个字段仍在响应中；若现有测试已覆盖，不另写一份服务端测试，只记下所引用的测试名。

**退出条件**：上述 SC 通过。删掉时间条款后，`a-time` 不再进入仅连接，SC-08 与 SC-14 失败。把缺失的 `windowStart` 当成没有下界后，`a-time` 仍被标成仅连接，SC-09 失败。把闲置写成「业务调用量为 0」后，SC-08 失败。

### S2 抽屉

1. 按 Spec §5.5 给 `AgentDetailBody` 增加三行。`metricsState == "unavailable"` 时五个审计派生值都是「—」。
2. 测试覆盖 SC-10，包括可用且时间为空，以及不可用时抽屉正文没有「未使用」和「未访问」。

**退出条件**：SC-10 通过。抽屉的近 7 天业务调用量仍断言 `usageCallsLast7d`。

## 5. 验收

验收条目就是 Spec §7 的 SC-01–SC-15。

| 阶段 | SC |
|---|---|
| S1 | SC-01–SC-09、SC-11–SC-15 |
| S2 | SC-10 |

任一 SC 未执行，不得把本 Plan 标成已完成。组件测试通过不等于这一页已经在运行中的容器里改版。

### 5.1 执行记录（2026-10-30）

改动的文件：

| 文件 | 改动 |
|---|---|
| `webui/src/pages/admin/AgentList.tsx` | 四张卡、六列表、Token 格、已禁用标记、仅连接标记、四档筛选、分类函数 `classifyAgentActivity`；去掉凭据冲突提示 |
| `webui/src/lib/kpiContracts.ts` | `used-credential-count.pages` 去掉 `/admin/agents`（该条允许 `pages` 为空） |
| `webui/src/__tests__/agent-list.test.tsx` | SC-01–SC-09、SC-11、SC-14、SC-15；替换 §3 S1 点名的旧断言 |
| `webui/src/__tests__/kpi-contracts.test.ts` | SC-12 |
| `webui/src/components/ObjectDetailDrawer.tsx` | 抽屉三行；不可用先于空值；`DetailRow` 标签接受节点以保留 `MCP` 的翻译防御 |
| `webui/src/__tests__/object-detail-drawer.test.tsx` | SC-10 四支 |

SC 与测试的对应：

| SC | 测试 |
|---|---|
| SC-01 | `agent-list.test.tsx` → `renders stability-and-adoption top metrics（SC-01）` |
| SC-02 | `agent-list.test.tsx` → `renders prioritized table columns for ops value（SC-02）` |
| SC-03 | `agent-list.test.tsx` → `SC-03 已启用的行没有状态标记，未启用的行在显示名旁标「已禁用」` |
| SC-04 | `agent-list.test.tsx` → `SC-04 Token 格按可用数与配置数写主行与次行` |
| SC-05 | `agent-list.test.tsx` → `SC-05 仅连接可以被看见，但不进活跃 Agent 分子` |
| SC-06 | `agent-list.test.tsx` → `SC-06 闲置行不带「仅连接」标记` |
| SC-07 | `agent-list.test.tsx` → `SC-07 指标不可用的行显示「—」，只有 metricsState=unavailable 写「数据不可用」` |
| SC-08 | `agent-list.test.tsx` → `SC-08 近 7 天活跃四档互斥、且不改变行序` |
| SC-09 | `agent-list.test.tsx` → 三支：`去掉 windowStart 时协议量大于 0 仍是仅连接，协议量为 0 不再是` / `去掉 windowEnd 时协议量为 0 不标仅连接` / `缺整个 summary 时协议量大于 0 可标仅连接，协议量为 0 不标` |
| SC-10 | `object-detail-drawer.test.tsx` → 四支：`指标可用时抽屉展示协议请求量与两个时间，业务调用量读 usageCallsLast7d` / `指标可用但时间为空时写「未使用」和「未访问」` / `指标可用且协议量为 null 或缺失时写「—」，不写成 0` / `指标不可用时五个值都是「—」，正文不出现「未使用」或「未访问」` |
| SC-11 | `agent-list.test.tsx` → `SC-11 名册不再提示凭据 prefix 冲突` |
| SC-12 | `kpi-contracts.test.ts` → `SC-12 名册不再登记「近 N 使用过的凭据」，其它条目仍指向本页` |
| SC-13 | 既有接口测试，未另写服务端测试：`server/__tests__/admin-agents.test.ts` → `separates protocol requests from business usage and keeps all-time last access`（`protocolCallsLast7d`、`lastSeen`）、`marks used-credential metrics partial when configured token prefixes collide`（`usedCredentialCountLast7d`） |
| SC-14 | `agent-list.test.tsx` → `SC-14 a-time 在窗口内是仅连接，最近 MCP 访问改成窗口终点后不再是` |
| SC-15 | `agent-list.test.tsx` → `SC-15 窗口内的业务时间不构成仅连接，协议量大于 0 仍是` |

S1 退出条件（反证）：

| 反证 | 结果 |
|---|---|
| 删掉时间条款 | SC-07、SC-08、SC-14、SC-15 失败 |
| 把缺失的 `windowStart` 当成没有下界 | SC-09 失败 |
| 把闲置写成「业务调用量为 0」 | SC-05、SC-07、SC-08、SC-09（两支）、SC-14、SC-15 失败 |
| 抽屉去掉「先判指标是否可用」的守卫 | SC-10 不可用分支失败 |

命令与结果：

| 命令 | 结果 |
|---|---|
| `cd webui && npx vitest run src/__tests__/agent-list.test.tsx src/__tests__/kpi-contracts.test.ts src/__tests__/object-detail-drawer.test.tsx --maxWorkers=1` | 3 文件 / 80 用例全绿 |
| `cd webui && npx vitest run server/__tests__/admin-agents.test.ts --maxWorkers=1` | 1 文件 / 37 用例全绿（SC-13） |
| `cd webui && npx vitest run --maxWorkers=1` | 411 文件 / 4933 用例；12 条失败全部落在本次改动之外（见下） |
| `cd webui && npm run lint:terminology` | 通过（1075 文件） |
| `cd webui && npm run lint:ia-boundary` | 通过 |
| `cd webui && npm run e2e:selector-contract` | 本次改动新增 0 条违规；存量 188 条失败不在本次改动文件内 |
| `cd webui && npm run build` | 构建通过 |
| `cd webui && npx tsc --noEmit --incremental false -p tsconfig.json` | 本次改动的 6 个文件 0 条类型错误 |
| `npm run lint:spec` | 通过 |

全量套件里 12 条失败的归属：`api.semantic-assets.reindex.test.ts`（发布记录 CSV 表头「重建索引状态」与存量断言不一致，HEAD 已存在）、`admin-accounts-oidc.test.tsx` 与 `admin-accounts.test.tsx`（其它会话未提交的 OIDC 改动）、`navigation.test.ts` 与 `help.test.ts`（其它会话未提交的侧栏与手册改动）、`release-ux-invariants.test.ts`（其它会话未跟踪的新测试）、`display-rollback-races.test.ts`（其它会话未提交的 `webui/server/index.ts` 改动）。没有一条来自本功能改动的文件。

未做：浏览器走查、移动窄屏、Docker 重建、客户交付，均不在本 Plan 的完成定义内。

2026-10-30 审阅收口：SC-10 补上指标可用且协议量为 `null` 或字段缺失时写「—」的断言。术语标准与 Spec 155 / 189 改为名册呈现已落地，用量口径不变。产品实现未改。

## 6. 完成定义

同时满足才算完成：

1. SC-01–SC-15 均有记录在案的通过结果。
2. 仅协议请求的 Agent 不增加近 7 天活跃 Agent，主表能看出「仅连接」。
3. 主表没有协议请求量、最近 MCP 访问、使用过的凭据和序号。
4. 抽屉能看到协议请求量、最近业务使用和最近 MCP 访问。
5. 用户可见文案与术语标准 §4.5 的新行一致。
6. `GET /api/admin/agents` 仍返回 Spec SC-13 点名的字段。

完成定义不包含浏览器走查、移动窄屏和 Docker 重建。若实现会话的工作约定要求看页面，只看桌面宽度的 `/admin/agents` 主路径，不把窄屏写入验收。

## 7. 风险

| 风险 | 表现 | 处置 |
|---|---|---|
| 时间条款自造 7 天 | 和卡片窗口不一致，边界行进错档 | D12：只用响应里的 `windowStart` / `windowEnd`；缺窗口则时间条款不成立 |
| 仅连接被算进活跃 | 握手又变回「这周有人在用」 | 活跃分子继续只读 `usageCallsLast7d > 0`，不读 bucket |
| 指标不可用被筛进闲置 | 「—」被读成十天没人用 | `unknown` 只出现在「全部」 |
| 列头写成凭据 | 和已撤掉的「使用过的凭据」混称 | 列头固定为 Token；禁止文案进术语标准 |
| 启用行仍放绿标或圆点 | 首列每一行都有记号 | SC-03：已启用的行没有状态节点 |
| 无可用 Token 用新颜色 | 和设计系统的 warning 色分叉 | 只用 `text-warning-strong` |
| 删掉接口字段 | 抽屉和其它页面失去协议数 | S1 不改 `agents.ts` 的响应形状；SC-13 守字段 |
| 有人按最近 MCP 访问重排 | 心跳行回到第一行 | D8：保持接口顺序 |

回滚：先恢复 `AgentList.tsx` 与抽屉的呈现，再恢复 `kpiContracts.ts` 的 `pages`。没有数据迁移。术语标准里的新行可以留下，因为它们描述的是已批准的呈现，不改变旧页面的运行。

## 8. 落盘清单勾销

对照 [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「新增 Spec / Plan 的落盘清单」：

| # | 结果 |
|---|---|
| 1 | Spec 在 `docs/specs/lucy-20261030-agent-roster-spec.md`，Plan 在 `docs/plans/lucy-20261030-agent-roster-plan.md` |
| 2 | Spec 含「核心流程（伪代码）」 |
| 3 | Spec 头部有文档类型 / 版本与状态；Plan 头部有状态、授权边界、验收 |
| 4 | 本 Plan 含目标、开工前置、验收、完成定义、风险 |
| 5 | Spec 的 Terminology Compliance 含 `This feature follows` 与 `New terms:` |
| 6 | Spec 的 Design System Compliance 含规定四段 |
| 7 | 已登记 `docs/README.md` 与 `docs/plans/README.md` |
| 8 | 不适用。本功能不新增命令或 CI job |
| 9 | 台账号无。文件名是本功能的身份。不写入 v0.25 升级台账，不另派 WebUI 流水号 |
| 10 | 2026-10-30 已跑。本 Spec 与本 Plan 无形态违规。`lint:terminology`、`lint:spec`、`lint:ia-boundary` 通过。`lint:spec-docs` 仍报仓库里已有的 `docs/specs/lucy-ci-restoration-spec.md`、`docs/plans/2026-10-29-ci-restoration-plan.md`、`docs/plans/2026-10-30-l25-11-publish-window-task.md`，与本功能无关，不写入基线。门禁结果不代替本表 |
| 11 | Spec 含「闭口层级」。层级是功能合同。出口是 SC-01–SC-15。上线关系写明本条收口不表示可上线 |
