# Cases — UAT-SUITE-PAGE-DOM-SCALE

规模、参照线与清理规则以 [fixtures](fixtures.md) 为准。编号前缀 UAT-PDS 只用于本套件。判定口径：PASS（参照线内）／FAIL-OBSERVE（超线，观察级，建议立项）／BLOCKED（无法全真造数）／SKIPPED（范围外）。

## UAT-PDS-R0 — 环境与基线（必做，每批前置）

1. 记录候选 gitSha/dirty、容器 healthy、浏览器前台断言（visibilityState=visible）。
2. 逐页记录现状数据量（对应列表 API 的 total）与 primaryReady 基线（colder + 3×SPA）。
3. 现状数据为空的页面照测（空态计时），但主张必须写"现值非上限"。

期望：环境健康；基线可复现（同页同态两轮 primaryReady 波动 <2×）。

## UAT-PDS-01 — Token 凭据页（/admin/tokens）

1. 按 [WebUI 性能复测指南](../../webui-performance-retest.md) 冻结候选和环境。在专用本机 Docker 实例用管理员登录，记录 `/api/admin/tokens` 返回的基线总数、当前审计行数和一个基线凭据标签。若基线为空，核对真实 API 返回空列表及页面空态。
2. 造数前用该基线执行一次浏览器冷进入。从另一个新上下文登录后，执行一次首次侧栏进入和三次前台侧栏回访。每轮记录导航到指定凭据行可见或真实空态的耗时。回访每轮先离开页面，再从侧栏进入。
3. 通过真实 `POST /api/admin/agents/:id/tokens` 给启用的测试 Agent **新增 200 条**。请求体使用 `label`、`expires_in: "30d"`、`device_name: "uat-pds"`，每条标签含本次唯一前缀及序号。遵守 [造数纪律](fixtures.md#3-造数纪律r-2-教训)。保存所属 Agent ID、标签和签发结果，丢弃响应里的明文凭据。用列表 API 核对新增标签、所属 Agent 和实际新增数量。造数失败停表记录原因，并清理已产生对象。
4. 保存当前种子与基线审计行数量，在规模档重复第 2 步。就绪点为 `tokens-table` 内的真实凭据行可见，按本轮响应预先选定应出现的标签。另做一次搜索指定标签、核对命中行、清空恢复列表。交接记录页面耗时、HTTP 状态／耗时／条数、DOM、长任务及搜索结果。新增的浏览器冷进入与搜索单独列出，历史 `colder` 仅用于首次站内进入对照。
5. 通过真实 `DELETE /api/admin/agents/:id/tokens/:label` 吊销本次签发的凭据，再用列表 API 核对本次标签清零且总数恢复基线。只清理本次清单内对象。

判定：规模与内容断言通过，首次站内进入和回访满足 [既有 SPA 参照线](fixtures.md#1-参照线观测口径不新立合同)，记本用例规模观察 `PASS`。浏览器冷进入和搜索记录可用性与耗时。待有对应的修复合同时，引用其预算与触发夹具做修复前后对照。高审计量、并发与 1,000+ 凭据若未运行，注明覆盖缺口。

### 审计历史对照

复测已测高档时，在独立 Compose 项目准备 2 条基线凭据并签发 200 条，冻结 202 条凭据清单。用本轮已签发的凭据执行真实只读 MCP 调用，累积至 0／1,500／5,000／10,000 条成功访问审计，按 [造数纪律](fixtures.md#3-造数纪律r-2-教训) 控制每会话间隔和查健康。每档停发调用并确认落盘计数稳定，再测冷进入、首次侧栏进入、三次热回访、搜索和清空。清理时核对原清单恢复，再回收本轮专用卷。记录近期历史的窗口和分布，便于下次比较。[已验跑次与原始证据](runs/2026-11-22-kscc-token-audit-5k-10k.md)

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

每选择器、每档位分别记录 PASS／FAIL-OBSERVE／BLOCKED；参照线超线即 FAIL-OBSERVE，建议立项但本套件不判功能缺陷。测后逐批按 [fixtures §5](fixtures.md#5-清理) 清理并核对。不可删数据（审计/run/release）如实记录为观测样本。
