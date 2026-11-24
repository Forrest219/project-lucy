# Lucy 核心可用性：既有能力核对与剩余缺口

日期：2026-11-19；基线 `6208ea5727bd`，另有共享工作树中的 P1-58／59 实现。本文是设计核对快照，不是功能状态 SOT 或 UAT 结果。各功能现值仍取 Spec 头部，测试判定取 [INDEX](../qa/uat/INDEX.md)。

## 事实与归因边界

- 腾讯云已用现有登录态读取概览、版本、使用概况、连接概览；构建 `6208ea57`，health/livez/readyz 为 200，事件循环最近 60 秒 p99 约 22ms。云端近 7 天业务活动很轻。
- 委托人确认客户也已升级 `6208ea57`；同窗客户入口仍为 OpenResty HTML 503，未取得现场 Pod、EndpointSlice、资源或日志。**版本差异退出当前原因排序；本轮没有证明 503 的具体根因。**
- 详细临时证据见 `inbox/20261119-2250-cloud-vs-private-availability-analysis.md`；只读转发单见 `inbox/20261119-customer-lucy-503-readonly-checklist.md`。它们不是收口证据。
- 本轮授权是 Spec／Plan 与配套登记，不含运行代码、配置、runner、Docker 构建、压测、现场变更或发布。

## 去重核对

| 建议 / 已有归属 | 已有合同、实现或证据 | 剩余工作与归属 |
|---|---|---|
| 探针拆分、健康缓存：[P1-21](../specs/lucy-20261113-heavy-read-path-and-probe-relief-spec.md) SC-10–12 | 已有 livez/readyz/health 拆分及缓存；SC-11 不要求 readyz 完全不读文件 | 只补“探针不触发配置/诊断 I/O”的 P1-61，不重开原拆分 |
| 启动监听一致：[P1-46](../specs/lucy-20261118-readyz-mcp-listen-consistency-spec.md) | Ready 必须晚于 Web 与 MCP 两端监听；已有实现和独立套件 | P1-61／63 必须保留这一前置，不另立启动一致性项目 |
| 审计重读／导出／概览：[P1-31–33](../specs/lucy-20261115-audit-export-scale-and-equivalence-guard-spec.md) | 已有逐页排查、查询减负和等价守卫；部分结果有 GAP | 模块算法与等价性继续由原合同承担，不把所有读取迁 worker 重新立项 |
| 重建与冷启动：[P1-38](../specs/lucy-20261117-inferred-turn-rebuild-yield-spec.md)、[P1-39](../specs/lucy-20261117-cold-start-audit-scan-spec.md)、[P1-47](../specs/lucy-20261118-rebuild-probe-budget-spec.md) | 分页、时间预算、冷启动扫描、写片 worker 已存在；测试台已有默认配置 PASS；P1-38 主体与后续修订授权边界不同 | 保留原状态与测试分母；既有重建预算、worker 不重复开发。当前 PASS 不能解释今天现网故障 |
| 恢复、水位：[P1-45／50](../specs/lucy-20261118-inferred-turn-rebuild-recovery-spec.md) | 已有中断恢复与 ceilingId 完成水位；测试台有真实中断证据 | P1-63 消费恢复入口，不新增恢复表、不重写水位 |
| 自动探测队列：[Spec 174](../../webui/docs/174-webui-entry-performance-spec.md) SC-09／20 | `background-probes.ts` 已有并发 2、队列 64、超时/取消/公平/代次；`live-table-queue.ts` 独立并发 1、队列 16 | 不以“Lucy 没有队列”立项；P1-62 只补重建/导出/批量发现跨类别总容量与许可接缝，保留已有探测独立配额 |
| MCP 预算与恢复：[P1-37](../specs/lucy-20261116-mcp-ux-resilience-spec.md)、question-experience | 已有问询预算、并发限制及有限会话恢复；U3b 曾明确不实现 | 不新增全局 MCP 限流或重新启用 U3b，不借本轮改变授权与工具暴露 |
| 页面部分失败：[Spec 174](../../webui/docs/174-webui-entry-performance-spec.md)、[P1-58](../specs/lucy-20261119-roles-agent-read-responsiveness-spec.md) | 已有分区展示、快照代次、准确错误分类；P1-58 为共享工作树实现，尚无 Docker/UAT 证据 | 不重复新建全站缓存/错误提示功能；P1-58 的 F58／浏览器与 R 证据继续归原条目 |
| 退出清理：[Spec 191](../../webui/docs/191-execution-runtime-reload-spec.md) §4.2／4.4 | entrypoint 已有信号、supervisor 清理和超时兜底；现序先停 KTX 再停 Lucy，缺全进程准入关闭/在途排空承诺 | P1-63 仅补 drain 协议；旧顺序是显式合同，须同次评审其修订，不能直接宣称原实现错误 |
| 组合与升级：[P1-13](../specs/lucy-20261113-release-perf-baseline-gate-spec.md)、[P1-52](../specs/lucy-20261118-customer-upgrade-reliability-gate-spec.md)、[P1-53／54](../specs/lucy-20261118-mcp-upgrade-compatibility-spec.md) | 已有性能门禁与升级可靠性/真实旅程设计；后两类仍有未授权实施项 | 复用其证据归属；不再新建一个“零503发布门禁”Spec，不将客户取证倒挂到功能合同 |
| 正式完整审计导出：[P1-57 D7](../plans/lucy-20261119-fde-acceptance-remediation-plan.md) | 基线缺口明示延期，原完整范围 FAIL 保留 | 不通过 P1-62 的排队功能偷偷恢复开发或改写延期结论；只能检查入队/许可接缝，成功内容沿原可用范围 |
| 多副本／节点高可用：[治理边界](../governance/DEVELOPMENT.md) | 当前仅单实例单副本；共享可写配置不支持多写者 | 本轮不立 HA 项，不修改拓扑，不承诺升级/节点故障零中断 |

## 剩余缺口与优先级

| 总账 / REQ | 建议优先级、顺序 | 新合同的唯一承诺 | 验收真源 |
|---|---|---|---|
| P1-61／REQ-030-082 | P1，第一批 | 探针响应只依赖内存生命周期，详细诊断 I/O 不在请求路径 | [Spec](../specs/lucy-20261119-memory-probe-diagnostics-isolation-spec.md) SC-01–09 |
| P1-62／REQ-030-083 | P1，第二批 | 已登记重任务的总容量与许可生命周期有界，取消不产生隐形执行 | [Spec](../specs/lucy-20261119-heavy-work-capacity-control-spec.md) SC-01–10 |
| P1-63／REQ-030-084 | P2，第三批 | 可捕获关停先关闭新准入，保留依赖以排空在途请求，再有界清理 | [Spec](../specs/lucy-20261119-process-drain-lifecycle-spec.md) SC-01–09 |

优先级为方案建议，不代表委托人已批准立项或开发。三个合同相互引用，独立收口；P1-61 可先行，不等待 P1-62／63。现场紧急故障的只读取证继续进行，不由本方案代替。

## 验收归属与替代方案

- 功能：共享 [core-availability suite](../qa/uat/suites/core-availability/suite.md) 的 F61／F62／F63 分别打假本模块，不将整套并行旅程塞进任何一个功能出口。
- 组合：同一候选形成后由候选验证负责人消费上述局部证据，并在 P1-13 的组合层取 R-CAV；客户升级交付仍归 P1-52，真实 Agent 问数题库仍归 P1-53／54。当前均未执行。
- 仅调大超时：实现成本低，但不能消除同步阻塞或无限排队，不作为本轮功能收口方式。
- 在现单实例内做有界隔离：推荐，复用既有 worker/队列/恢复，保留运行成本和单写者边界。
- 多副本或外置全部状态：另一个架构范围，当前没有授权与交付契约，本轮不采用。

## 未决决策

### 架构决策记录（ADR 提案，均未确权）

| 决策 | 选择 / 原因 | 代价与替代方案 |
|---|---|---|
| 轻探针与诊断分离 | 同进程内存响应，详细采集后台单在途；保留主事件循环卡死可被探测 | 诊断超过30秒仍陈旧且首次失败立即标stale；既有data.status语义不变；不采用仅加TTL或另起永远健康进程 |
| 跨类容量 | 复用既有局部队列，增加三类总配额接缝 | 重任务可能排队/429，必须恢复可成交；不引入分布式任务系统，不加MCP总门禁 |
| 整实例排空 | 先准入关闭/在途终结，再原依赖清理 | 延长关停预算并修订Spec191顺序；不以固定睡眠或多副本替代正确性 |

1. P1-61 新增诊断时间元数据与失效边界是否接受；提案见该 Spec，不降低权限新鲜度要求。
2. P1-62 默认并发 2／排队 16／等待 5 秒为设计起点，需冻结基线和真实许可接缝；不能靠更改阈值追样本关单。
3. P1-63 关停顺序需批准修订 Spec 191；20 秒排空、40 秒总退出上界及外部 grace 要求需同次确认，标准 Docker demo 的 Compose 配置须同次补齐至少 45 秒。不得新增第二个公开关停端点。

三份均是草案，终稿未确权、开发未授权。文档门禁只证明文档合规，不证明功能可用或可上线。
