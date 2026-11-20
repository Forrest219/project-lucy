# Cases — UAT-SUITE-PAGE-DOM-SCALE

规模、参照线与清理规则以 [fixtures](fixtures.md) 为准。编号前缀 UAT-PDS 只用于本套件。判定口径：PASS（参照线内）／FAIL-OBSERVE（超线，观察级，建议立项）／BLOCKED（无法全真造数）／SKIPPED（范围外）。

## UAT-PDS-R0 — 环境与基线（必做，每批前置）

1. 记录候选 gitSha/dirty、容器 healthy、浏览器前台断言（visibilityState=visible）。
2. 逐页记录现状数据量（对应列表 API 的 total）与 primaryReady 基线（colder + 3×SPA）。
3. 现状数据为空的页面照测（空态计时），但主张必须写"现值非上限"。

期望：环境健康；基线可复现（同页同态两轮 primaryReady 波动 <2×）。

## UAT-PDS-01 — Token 凭据页（/admin/tokens）

- 造数：真实签发（`POST /api/admin/agents/:id/tokens`），目标 ≥200 tokens；可多 agent 分布。
- 测量：基线 → 加压 colder+3×SPA；记录行数/DOM/longtask/API（`/api/admin/tokens`）分列。
- 清理：吊销/删除所签 token（真实 API），verify 还原。
- 回链：P1-59 token 生命周期合同（展示风险）。

## UAT-PDS-02 — 调用监控/调用流水（/ops/calls）

- 造数：经 MCP Proxy 真实只读调用（fixture token，`lucy_catalog`/`connection_list`），目标 ≥300 audit rows；写间隔 ≥500 ms（R-2 纪律）。
- 测量：基线 → 加压；行数/DOM/longtask + `/api/admin/audit` 分列。
- 清理：审计行不可删——本页**不清理数据**，跑次注明"数据留作观测样本"，仅清理 MCP 会话；主张受"现值为下限"限制。
- 回链：`UAT-SUITE-TRACE-LEDGER`（调用流水）/`UAT-SUITE-EVENT-LOOP-RELIEF`（P1-21）。

## UAT-PDS-03 — 发布记录（/publish/history）

- 造数：走真实发布流程产出 semantic-asset release 记录；若单条成本过高，允许少量真实记录 + 线性外推并在跑次写明 GAP（不得以 mock/直插库凑数）。
- 测量：基线 → 加压；行数/DOM/longtask + `/api/semantic-assets/releases` 分列。
- 清理：release 记录通常不可删——留作观测样本并注明。
- 回链：语义发布相关套件。

## UAT-PDS-04 — 评测运行历史（/eval/runs）

- 造数：`POST /api/eval/runs`（domain `demo_superstore`，真实执行 7 cases/轮）；允许少量真实 run + 外推 + GAP（run 执行成本高）。
- 测量：基线 → 加压；行数/DOM/longtask + `/api/eval/runs` 分列。
- 清理：run 记录不可删——留作观测样本并注明。
- 回链：评测套件。

## UAT-PDS-05 — 启用表范围（/connections/enabled-tables）

- 造数：在 demo-db 真实建表（`uat_pds_` 前缀）→ 触发 catalog 扫描 → PUT `/api/connections/demo-mysql/enabled-tables` 启用，目标 ≥200 张启用表。
- 测量：基线 → 加压；行数/DOM/longtask + enabled-tables API 分列。
- 清理：DROP 所建表 + 重置启用范围回基线（先记录基线值）。
- 回链：`UAT-SUITE-CATALOG-SCAN`／P1-64 相关。

## UAT-PDS-06 — 访问关系图（/admin/access-map）

- 造数：复用 PDS-02 审计行 + 如需再补 agent 引用配置；sankey/canvas 形态，行数门槛不适用——就绪表达式改"svg/canvas 出现 + DOM 稳定"。
- 测量：基线 → 加压；DOM/longtask + access-map API 分列。
- 清理：随 PDS-02 数据自然保留；配置类造数需还原。
- 回链：`UAT-SUITE-ACCESS-MAP-SANKEY`。

## UAT-PDS-07 — T2 页冒烟（每页一轮 primaryReady + DOM）

连接概览、语义资产、业务 Wiki、业务 Skill、AdminAccounts、ConfigAudit、GovernanceOverview、使用概况、发布工作台、评测用例、趋势监控。不造数，只记录现状固定开销；consoleErrors>0 记观察。

## 判定与清理

每选择器、每档位分别记录 PASS／FAIL-OBSERVE／BLOCKED；参照线超线即 FAIL-OBSERVE，建议立项但本套件不判功能缺陷。测后逐批 fixtures §7 清理并 verify；不可删数据（审计/run/release）如实写"留作观测样本"，不算清理豁免其它项。
