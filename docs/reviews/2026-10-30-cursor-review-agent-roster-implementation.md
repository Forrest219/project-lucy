结论：可交付
🔴 0 / 🟡 1 / 🟢 1

审阅提交 `a4b3e3a7`（父提交 `90b3828b`），只看该提交里的名册实现与测试。工作区其它未提交改动未纳入。D1–D13 未重开。

## 对齐与越界

**[🟢] 同一提交里仍写着名册尚未改代码**

位置：`webui/docs/00-product-terminology-standard.md:519`；同句还有 `:549`。`webui/docs/155-agent-admin-usage-truthfulness-remediation-spec.md:14`。`webui/docs/189-usage-metrics-truthfulness-and-cross-page-consistency-spec.md:18`

问题：`a4b3e3a7` 已经改了 `/admin/agents` 的四张卡、六列表和抽屉三行，但这三处仍写「名册页面尚未按该 Spec 改版」「名册改版前页面尚未展示」「该呈现尚未改代码」。读术语标准或 Spec 155 / 189 的人会以为页面还是旧版。指标口径本身没有被改写。

最小修复：把这三句改成名册呈现已按 `docs/specs/lucy-20261030-agent-roster-spec.md` v1.2 落地；Spec 155 / 189 的用量定义保持不变。

其余对齐项成立：SC-01–SC-15 都有对应测试或既有接口测试；`webui/server/admin/agents.ts` 未改；没有新接口字段、拒绝列、闲置列或排序；没有流水号和升级台账。活跃 Agent 卡读 `summary.usageActiveAgentCountLast7d`，不读分档结果。

## 分类、Token 与抽屉

无

`classifyAgentActivity` 与 Spec §6 一致：缺 `windowStart` 或 `windowEnd` 时时间条款不成立；`lastSeen` 等于起点算窗口内、等于终点不算；`metricsState == "unavailable"` 与 `usageCallsLast7d` 缺失或 `null` 都进 `unknown`，只有不可用才写「数据不可用」；`unknown` 只留在「全部」。Token 回退与「无可用 Token」的条件符合 §5.3。抽屉先看 `metricsState`，不可用时五个值都是「—」；可用时业务调用量读 `usageCallsLast7d`，协议量 `null` 或缺失写「—」。

## 测试有效性

**[🟡] 抽屉在指标可用时，协议量为 null 或缺失没有断言**

位置：`webui/src/__tests__/object-detail-drawer.test.tsx:320`

问题：SC-10 的三支现在是：可用且协议量为 3，断言「3」；可用且协议量为 0，断言「0」；不可用且协议量为 `null`，靠 `metricsState == "unavailable"` 得到「—」。把 `ObjectDetailDrawer.tsx:277` 改成「不可用才写「—」，否则 `protocolCallsLast7d ?? 0`」后，这三支仍然通过。Spec §5.5 要求指标可用且协议量为 `null` 或字段缺失时写「—」，不写 0。当前实现是对的，这支输入没有被测试锁住。

最小修复：在 SC-10 增加一支 `metricsState: "ok"`、不带 `protocolCallsLast7d` 或将其设为 `null` 的夹具，断言「近 7 天协议请求量」为「—」。

其余必查断言有牙齿：SC-09 三支缺窗口都会在「把缺失起点当成没有下界」时失败；SC-14 把 `a-time.lastSeen` 改到窗口终点后必须离开仅连接并进入闲置；SC-15 锁住窗口内业务时间与协议量大于 0；SC-05 在三行仅连接仍在表上时，活跃 Agent 卡必须是「1」；SC-08 用行 id 和顺序锁住四档，`unknown` 进不了后三档。

未改产品代码、测试或合同。跑了测试：`cd webui && npx vitest run src/__tests__/agent-list.test.tsx src/__tests__/kpi-contracts.test.ts src/__tests__/object-detail-drawer.test.tsx --maxWorkers=1`，3 个文件 / 80 条通过。这 6 个文件相对 `a4b3e3a7` 无后续差异。

## 收口

2026-10-30 已按本审阅改完。术语标准 §4.5、Spec 155、Spec 189 改为名册呈现已落地，用量口径不变。SC-10 增加指标可用且协议量为 `null` 或字段缺失时必须写「—」的断言。产品实现未改。复跑 `cd webui && npx vitest run src/__tests__/object-detail-drawer.test.tsx --maxWorkers=1`，1 个文件 / 23 条通过。
