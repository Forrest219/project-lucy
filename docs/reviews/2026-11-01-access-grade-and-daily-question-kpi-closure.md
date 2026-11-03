# 访问分级与日真实问询 KPI — 功能合同收口

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-11-01 |
| 授权 | PM 于 2026-11-01 选定收口范围（先收两条快的样板，本条为下一批的唯一有真实实现缺口者） |
| 对象 | [访问分级与日真实问询 KPI](../specs/lucy-20261030-access-grade-and-daily-question-kpi-spec.md) v1.0，功能编号 **Spec 194**；[配套 Plan](../plans/2026-10-30-lucy-access-grade-and-daily-question-kpi-plan.md) |
| 结论 | **功能合同收口。** SC-01–SC-26 全部有记录在案的通过结果，阻塞 0。**本条收口不表示可上线。** 不进入 v0.25 升级台账 |

## 出口

本条闭口层级声明的出口：SC-01–SC-24、SC-26 的自动化用例（等级一致性 `access-grade.test.ts`、窗口聚合 `daily-question-kpi.test.ts`、与 Spec 189 的正交性 `usage-governance.test.ts`、页面渲染分流 `admin-governance-observability.test.tsx`），SC-25 沿用既有审计问询测试（`proxy-audit.test.ts` 的问询重建用例，本轮未改该路径），加 `npm run lint:terminology`。

不在本条出口：浏览器与移动窄屏验证；镜像构建与部署；客户环境验证；真实实例写入；全仓 typecheck 基线（当前 89 个既存错误，非本功能引入）。

SC 编号跨 Spec 串号，**逐条落点以主 Spec §8.1 为准**。

## 这次跑过的测试

```bash
cd webui && npx vitest run --maxWorkers=1 \
  server/__tests__/access-grade.test.ts \
  server/__tests__/daily-question-kpi.test.ts \
  server/__tests__/usage-governance.test.ts \
  server/__tests__/proxy-audit.test.ts \
  src/__tests__/admin-governance-observability.test.tsx
```

**5 个文件 / 57 条通过。**

## 本轮补的三条用例

收口前实测的覆盖是 22/26：SC-17、SC-20、SC-24 没有可打假的用例。本轮补齐三条。

### SC-17 — 混合夹具上 Spec 189 的分层恒等式仍成立

落点 `webui/server/__tests__/usage-governance.test.ts`。用 Spec 189 既有的混合夹具（协议 + 默认用量 + 评测探针三层齐备），在同一窗口上算四层计数，并同时读 overview：

- `原始审计 = 原始业务 + 协议`
- `原始业务 = 默认用量 + 评测探针`
- `overview.usageCalls` 仍等于默认用量口径，**问询 KPI 不改变调用量恒等式**
- 夹具三层均非空（否则恒等式是空转）
- 问询 KPI 此时也是非平凡值（本次断言 `realQuestions = 1`）

### SC-20 — 活跃 Agent 与真实问询互不换算

落点同上。夹具只有一次握手（协议级）与一条原文问询，没有任何默认用量业务调用：

- `usageOverview.calls = 0`、`usageOverview.activeAgentCount = 0`——握手是协议事件，不是业务调用，该 Agent 不是近 N 活跃 Agent
- `realQuestions = 1`——真实问询是独立单位，照常计入
- `questionActiveAgents = 1`——新指标「问询活跃 Agent」不替换 Spec 189 的「近 N 活跃 Agent」

### SC-24 — 数据访问视图与界面使用视图的渲染分流

落点 `webui/src/__tests__/admin-governance-observability.test.tsx`。该行为此前已被同文件既有用例覆盖，但**没有 SC 编号，无法追溯**；本轮补一条带编号的专门用例：

- 数据访问视图有四张问询卡（真实问询、未上报查数会话、仅连接会话、浏览未问会话）与按日问询表
- 调用量、ACL 拒绝、多数请求耗时三张卡**仍然不在数据访问视图**
- 切到界面使用视图后，这组数据一张卡和按日表都不展示

## 逐条结论

SC-01–SC-26 的逐条落点见主 Spec §8.1。其中：

- SC-01、SC-02、SC-03、SC-16、SC-26 → `access-grade.test.ts`
- SC-04–SC-15、SC-18、SC-19、SC-21、SC-22、SC-23 → `daily-question-kpi.test.ts`
- SC-17、SC-20 → `usage-governance.test.ts`（本轮补）
- SC-24 → `admin-governance-observability.test.tsx`（本轮补）
- SC-25 → 沿用 `proxy-audit.test.ts` 的三条问询重建用例（会话访问仍聚成 inferred turn、仍用固定摘要、已有原文问询时不另开不改写），KPI 侧由 SC-07 同一条覆盖。**按配套 Plan §4 S3 第 5 条，不重复造重建测试，只记录所引用的测试名。**

## 残余，不打回本条

- **全仓 typecheck 当前 89 个既存错误**，其中落在本功能相关文件的为 0。全仓 typecheck 不在本条出口，属发布取证层的证据等级。
- `npm run lint:spec` 仍报 `webui/docs/03-api-spec.md: missing /api/publish-workbench/evidence`。该路由由提交 `6040ef7a`（发布工作台三栏）引入，登记缺口属那条功能，与本条无关。
- `npm run e2e:selector-contract` 当前整体为红（201 条）。逐条核对后**没有一条指向本功能涉及的组件**；其中 3 条来自 `DisplayRefreshNotice.tsx`（Spec 195 的实现），同样与本条无关。
- 浏览器与 Playwright、移动窄屏验证、镜像构建、部署、客户交付、真实实例写入均未执行，按本条出口定义不在范围内。
- `dailyQuestions` 的「按日问询」表在本轮只做了渲染分流断言；按日切分的时区与求和由 SC-18／SC-19 覆盖（Asia/Shanghai、按日合计等于卡片、边缘日 `partialDay`）。

## 不在收口里

客户镜像、Helm、集群部署、客户环境验证与客户交付，都不在这条里。本条收口不表示可上线，也不构成客户包验收。
