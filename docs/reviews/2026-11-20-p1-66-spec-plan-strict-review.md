# P1-66 Spec／Plan 严格过程评审与修订

| 元数据 | 内容 |
|---|---|
| 日期 / 文档类型 | 2026-11-20 / 设计过程评审 |
| 范围 | P1-66／REQ-030-087；[Spec](../specs/lucy-20261120-agent-roster-summary-projection-spec.md)、[Plan](../plans/lucy-20261120-agent-roster-summary-projection-plan.md)、[UAT](../qa/uat/suites/agent-roster-summary/suite.md) |
| 授权 | 委托人要求严格评审、发现问题直接修订，暂不开发 |
| 原稿结论 | v0.1-draft **不通过**：存在会令统计永久待配对、保留隐藏全量读取、详情失效遗漏及夹具几何不明确的设计缺口 |
| 修订结论 | v0.2-draft 已在设计层处理下列 8 项；当前静态复核无剩余同类阻断。仍为 draft，待终稿确权；不是 Codex CLI 终审、开发授权或 UAT PASS |
| 测试证据 | 仅文档门禁、相对链接／状态镜像检查；未开发、未造数、未启动 Docker 或浏览器 UAT |

## 评审方法

从旧完整 API 与实际消费者向设计反推：检查 Fastify route、共享 display snapshot 的版本生成、statistics 的内部依赖、React Query 的版本 join／失效前缀、Drawer 的数据来源、凭据计数时刻；再检查 fixture 是否能用合法实际编译产生预期宽度，以及测试是否有办法推翻假的“变快”。

未以“有兼容表”“有 capability 总数”“文档 lint 绿”作为内容通过依据。未读取凭据或重新访问 109；现场事实沿用已核实的非敏感总量。

## 发现与处理

| ID / 级别 | 原稿问题及证据 | 修订与可证伪出口 |
|---|---|---|
| R1 / P1 | **独立 section 会改变配对版本，统计可能永远 pending。** `display-snapshot.ts` keyFor 含 name，versionOf 为 key hash；`agents.ts` agentListSnapshotVersion 再使用该版本；前端 agentStatisticsVersionsMatch 要求全等。v0.1 另建 summary section 却要求保持原 statistics，不能满足。 | Spec §4 改为原 agent-permissions 同槽 `{payload,sidecar}` 原子双表示；摘要／旧 roster／statistics 复用同一 raw version 和原公开版本公式。ARS-04 必须实际 join 成功；不允许删掉版本校验修绿。 |
| R2 / P1 | **只裁摘要请求，statistics 仍 parse 整份权限。** `readAgentStatisticsDisplay` 在查统计缓存前先调用 agentPermissionSection；后者无条件 JSON.parse(snapshot.payload)。因此第二个首屏请求仍搬运服务端大 JSON，原“热命中轻路径”不成立。 | Plan T2 明确迁移 statistics 内部版本读取到小 sidecar，业务 SQL／公共 envelope／TTL 不动；整段 summary＋statistics 热旅程 full parse=0。冷构建仍一次全量序列化／驻留，Spec 明示兼容成本，不能虚报完全消除全量数据。 |
| R3 / P1 | **legacy adapter 没有可执行的 join／能力状态机。** 109 旧完整响应可无新 snapshot 标识；直接套新端匹配会永久 pending；笼统 404 降级可能掩盖新服务故障；换 range／刷新未说明该重读什么。 | Spec §3.2 定义 summary-v1／legacy-roster／legacy-full；旧原子完整 body 可用自身正确窗口，禁止拼接；仅已识别旧端精确 statistics JSON 404 可缺席。新端缺版本或 404 为错误；补身份失效、刷新、range 与 malformed 正反例，ARS-09。 |
| R4 / P1 | **统计晚到会覆盖更准确的凭据数，且摘要无法传给旧 Agent[] helper。** 当前 AgentList 取 stats.availableTokens 优先；statistics 可复用缓存，摘要 available 在到期后已为 0 时可能被旧 1 覆盖。旧 summarizeAgents／configuredTokenCount 依赖 tokens[]。 | 行与顶卡配置类数始终取 credentialSummary；独立摘要汇总 helper，不伪造 tokens[]，旧端证据不足为 null。available 沿用现存配置／过期／禁用逻辑，不新加审计扫描。ARS-03 加到期后旧统计晚到负控。 |
| R5 / P1 | **Drawer 从 plural 列表改成普通单对象键会漏失效和请求隔离。** 现行 DISPLAY_SCOPE_QUERY_KEYS.agents 为 adminAgents 前缀，而编辑页 detail 为 admin,agent 单数；v0.1 只写“带 ID／7d”不能保证 Role／Token 更新、关闭、快速换对象后的正确性。 | Drawer 用 adminAgents/detail/id/7d 展示键和 agents displayRead／AbortSignal；不共享编辑缓存，写后失效、身份 epoch、关闭取消、A 晚到不显示为 B；保留原 7d 标签。ARS-04／06／07 检查正反例与错误恢复。 |
| R6 / P1 | **“总 capability＋字节”不能单独证明保留每人宽度，倍率同时放大每人来源会混淆。** v0.1 只有下限，少数巨型对象／名称或谓词填充可掩盖其他窄账号；W2/W5 没约定绑定图如何复制，不能证明是可比的增长。现场逐人分布本来未知。 | fixtures §2 引入 BAL／SKEW、每人及单角色已知 207 source／9 conn 门槛、共享和分散子组、合法谓词与去重；倍率为互不相交 71 人副本，保留每人图谱，逐人 normalized fingerprint。字节有统一公式、防填充、测前封存；功能坏样本隔离，ARS-R0／10 负控。仅主张保留已知总量，不声称精确复刻现场。 |
| R7 / P2 | **只列 primaryReady，统计永远不成交或详情样本不足仍可能被判性能通过。** v0.1 无 statsReady 预算，Drawer／编辑的次数未规定，5× 还写“B 的最宽对象”；所有 HTTP 100% 与预定拒绝用例互相冲突。 | fixtures 增加 statsReady 出口，各档最宽对象 Drawer／编辑各≥20次，场景／profile 独立 p95；正常性能 100%，预定错误与故障正确性另组。版本补读耗尽为局部不可用和重试，不自动循环；ARS-08／10。 |
| R8 / P2 | **Docker 时钟与 A/B 测程不可复现。** 原稿要求固定 asOf／时间种子但未说明不改产品时钟如何做到；A/B opaque 版本含路径／mtime，不能直接跨容器对齐；10s 读取＋最多一次重试也不能自动推出 15s 总上界。 | fixtures §5.1 使用真实 T0、边界空带、24h 成组运行、原始 ts／id 快照和每轮实际窗口 oracle；单元时钟与 Docker 实时分开。opaque 版本仅候选内比较；whole read 15s 硬截止，重试用剩余预算。冷 oracle 采集不能先预热再称冷。 |

## 关键取舍

同槽 sidecar 使用当前 `DisplayBuild` 已支持的 `{payload,sidecar}`；`DisplayPolicyInputs` 仅 accessConfigDigest、sourceMapVersion、enabledTablesDigest、toolClassificationVersion，小元数据足以让 statistics 避免 parse 全量 payload。没有为修版本失配另造公开 permissionVersion、第二套统计 API 或权限事实源。

兼容代价是冷构建仍生成原完整 payload，既有 prewarmer 也仍可能执行一次；v0.2 明确记录构建时间和驻留内存。若后续要求进一步取消这项冷成本，需要另评懒惰投影／缓存结构，并先证明旧接口和代次一致性；本次没有暗中把该扩展当作已交付。

sidecar 异常的恢复也写实：按 section＋捕获槽 incarnation／内部引用 CAS 淘汰整对坏槽，至多一次共享重建、总预算不增加；不能只写“重试”却永远命中同一个坏槽；原 versionOf(key) 同代重建仍相同，故不能仅以公开 version 作 CAS 条件误删新实例。

## 修订边界与后续

- Spec／Plan／suite／cases／fixtures 升 v0.2-draft；总账、需求池、两级索引、project-overview、e2e-ledger 同句镜像同步；INDEX 保持 NOT RUN。
- 8 项是在**设计层**处理，不代表新接口、legacy adapter、sidecar 重建、fixture 生成器或浏览器验证已经实现／通过。
- 剩余明确不确定性：现场逐人分布／审计规模未知；BAL／SKEW 的实际构造与 2 CPU／4 GiB 预算未测；旧构建兼容须真实容器核对。它们均已挂到可执行验收，不被假装为现有证据。
- 本过程评审不触发终稿确权，不触发开发授权；按委托人“暂不开发”继续保持冻结。

## 本轮静态验证结果

- `lint:spec-docs`：本条 Spec／Plan 0 违规，仓库 0 blocking；其他未跟踪 page-dom-scale 草稿仍有 5 条既有告警，未纳入本条修订。
- `lint:spec`、`lint:terminology`、`lint:ia-boundary`、`check-e2e-ledger`：命令通过；不把既有全局基线豁免解释成新功能正确性。
- 本条新增／修订文档相对链接与空白检查通过；7 处状态镜像同句；E1–E18 与 ARS-R0／01–12 完整；`git diff --check` 无本次文档空白错误。
- 上述均为文档静态检查。运行接口、缓存并发、legacy 容器、六组权限 fixture、前台浏览器和纯 MCP 新验收全部未执行，INDEX 仍为 NOT RUN。
