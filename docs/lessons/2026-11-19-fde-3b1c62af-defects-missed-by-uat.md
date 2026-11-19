# 错题：5 个缺陷本机可复现，旧 UAT 与默认套件都没拦住（只测快路径、代码晚于 UAT、症状被记成「既有行为」、移植时关掉了探测用例）

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-11-19 |
| 标签 | `gate-gap` `contract-stack` `ux-regression` `ops-delivery` `sev-high` |
| 环境 | 本机 arm64 原生，Node `v22.23.5`；候选 `lucy-v0.30@3b1c62af32af7b6d045caef7fa10ccc92300ae97`（干净 worktree）；对照 ff `ff4762c9`、3a9 `3a9f0711`、84 `84becc34`。源码级复现（函数级、Fastify 内存路由、真实 SQLite），**未构建镜像，无容器 L2**；F01 投影进度、F02／F03 SQL 延迟、F04／AUDIT-01 时钟均为受控 |
| 相关 | 总账 **P1-56**／REQ-030-077、**P1-55**／REQ-030-076；FDE 报告 `Lucy升级检查_3b1c62af_20261119`；本机复核回复 `inbox/uat-fde-3b1c62af-2026-11-19/reply-差异复核.md`；契约修订草案与整改 Plan 见 §6 |
| 状态 | `open`（缺陷未修；契约修订草案与整改 Plan 已起草，**未终稿确权、未开发授权**；治理类后续动作均未开） |

## 1. 症状与影响

候选 `3b1c62af` 上，下列 5 个问题在本机逐项复现成立；它们此前都没有被任何 UAT 套件或默认测试拦住（默认全量 6550 通过、8 跳过）。

| 编号 | 用户可观察行为 | 本机证据（候选） |
|---|---|---|
| F02 慢合法 Hive 语法 | 首个语法被服务端慢拒绝（7.1 秒）后，合法的第三个语法不再尝试，页面报「读取超时」 | 只发 1 条 SQL，7105ms，`READ_FAILED`；ff 同输入发 3 条、7310ms 读到字段 |
| F04 宽表整批 deferred | 勾选 50 表×400 列，预算耗尽后客户端报「读取表结构没有进展」，一张都读不完；30 表中 1 张无权限时其余 29 张也不继续 | 2/2 失败；84 原始用例通过 |
| F03 单表 deferred | 单表预算耗尽时服务端不披露 `deferred`；**真实客户端把它当成功**：`tableCount=1`、`columnCount=0`、YAML 里没有这张表（本机补验，比 FDE 描述更重） | `l1/f03-client-impact-cand.log` |
| F01 正式导出 | 投影等待追平（lag 1→0）后，正式 CSV／ZIP 仍返回 409；真正未追平时拒绝是对的 | 12 个 HTTP 场景中追平与 ledger 前进两类 409；84 绿 |
| AUDIT-01 滚动窗口 | 30 天窗口滚动后，同一调用同时属于两个问询，两个详情都 200、编号 1／2，调用流水又显示 1 | 候选红、3a9 红、84 绿；3 条原始调用保留 |

影响面：本机／客户升级候选的源码级缺陷；是否在客户现场已发生**未验证**。F03 的「静默假成功」是主路径上最该优先复评的一条。

## 2. 复现要点

最短入口见本机复核回复的「复现命令清单」。判定条件：

1. F02：`[7100,100,100]` 毫秒的三次探针，期望 3 次尝试、读到字段；实际 1 次。
2. F04：每次 SQL 模拟 6000ms、50 表×400 列，期望 20000 列读完；实际报「没有进展」。
3. F03：同 F02 的 `[6000,6000,6000]`，经 `readCheckedTableColumns` 走完整链，期望表被读到或被告知没读到；实际静默成功。
4. F01：复用 FDE `functional-export-catchup.test.ts`（受控投影进度）。
5. AUDIT-01：`audit-rolling-window.mts`（受控时钟），对 3a9／84／候选各一次。

## 3. 根因

| 层 | 结论 |
|---|---|
| 实现（F02） | `schema-structure.ts:294`：`!result.ok && latencyMs >= timeoutMs - 1500` 把任何「接近预算的失败」判成超时，包括语法拒绝。该行最早在 `2b7ceed3`（2026-11-10）。 |
| 实现（F04） | `schema-structure-batch.ts` 的 `columnsAttempted` 把「被截断的首块」也算成已尝试，随后预算检查把所有拆分子块置 `deferred`，零进度；客户端固定每批 50、不缩批，整批 `deferred` 即报「没有进展」。**同一缺陷 v0.2.1 修过一次**（Spec Changelog：「首块被截断对半拆分后，子块的预算检查会让全部表落入 `deferred`、零进展」），v0.2.2（`784e7f7e`，11-18）改预算逻辑时又引入。 |
| 实现（F03） | `previewSchemaStructure` 的 `batch = requested.length > 1`，单表路径既不抛错也不回传 `deferred`；客户端对「请求了、响应里没有」的表不校验。 |
| 实现（F01） | `audit.ts:4791` 在等待追平**之前**取 `projection.lag`，等待成功后仍把旧值传给 `performExportV2`。等待逻辑 `211f2d64`（11-14）引入；84 改用 `catchUp.lag`，0.30 分支未合入。 |
| 实现（AUDIT-01） | 重建删除 `started_at >= cutoff`，跨边界旧簇留下；窗口内后半段被重建为新簇，同一调用落在两个问询。3a9 基线就有，不是 0.30 引入；84 有跨界闭包扩展，当前分支没有。 |
| 合同 | 各 Spec 的出口都只证明「读得出／导得出」，没有断言「预算耗尽后仍收敛」「追平后用追平后的 lag」「窗口滑动后归属唯一」。P1-34 §5.2 写了不变量「每次调用至少读完一张表」，但验收 LS-01–LS-18 没有一条断言进度本身。 |
| 流程 | 见 §4。 |

## 4. 为何漏检

1. **用例只覆盖快路径。** `UAT-SCAN-EXT-03-DUAL`（11-18、11-19 两次 lab PASS）全是快速读取（9–12ms）；`UAT-SCALE-*` 是单表宽列或 600 表×10／30 列，从未构造「50 表×400 列同时触发行数截断与预算耗尽」；`UAT-IRR-*` 测的是重建中断恢复，不是窗口滑动。我搜 `慢拒绝／延迟注入／预算耗尽／deferred／滚动／追平` 等词，这几个套件的 `cases.md` 零命中。
2. **缺陷代码晚于最后一次 UAT。** `UAT-SUITE-LARGE-SCHEMA` 最后一次完整跑在 11-16；`deferred` 逻辑是 11-18 的 `784e7f7e`；之后没有复跑。没有机制把「改了 `schema-structure*.ts`／`prepareSchemaStructure.ts`」绑定到该套件复跑。
3. **症状被看见却被记成「既有行为」。** `UAT-TRC-05`（11-17）跑次写：F-5「管理员登录后立即导出会撞 `projection_lag_exceeded`——既有行为」，处理是让脚本登录后等待投影追平再导出；没有开缺陷行，也没有挂总账。F-5 与 F01 **同一错误码、同一触发场景**，路由当时已含等待逻辑（`211f2d64`，11-14），因此高度同型，但该跑次没有记录请求时序，**是否同一根因未经复核**。同一跑次的 F-2（complete 导出 409 `integrity_or_relation_failed`，因 `access_log_asof_meta` 为空）是**另一个缺陷**，与 F01 无关，此处不并案。
4. **移植他人测试时关掉了探测用例。** 2026-11-18 的 [`ff4762c9` 集成 Plan](../plans/lucy-20261118-ff4762c9-upgrade-blocker-integration-plan.md) Task 5 把「table-preparation 在 defer 后收敛」「单表 defer 不得空成功」标「保留」、「singleton batch」标「保留／微调」，对「inquiry／cluster／page-budget 生长」类只在与主线常量策略冲突时允许 skip，且要求写原因并「开子项」。同日提交 `a9052b27` 把 8 个用例全改成 `it.skip`（注释如「needs batchRead; not on lucy tip」「colleague assertion diverges … needs dedicated audit investigation」）。逐个对照计划：被标「保留」的 3 个（table-preparation 在 defer 后收敛、单表 defer 不得空成功、singleton batch）**与计划相反**；其余 5 个（含跨回看边界的簇）属于计划允许 skip 的类别，但要求的「子项」**一个也没开**，总账到 FDE 报告出来之前没有对应行。Task 6（导出 lag）被标「若无失败用例驱动则 deferred」，而驱动它的用例正是被跳过的那批。验收写的是「PASS（允许已记录的 skip）」，skip 越多越容易 PASS。
5. **UAT 准则让难造的状态更难进套件（推断，未获直接证据）。** [`CONVENTIONS.md`](../qa/uat/CONVENTIONS.md) 要求全真、做不到停表并另申请降级。慢 SQL、投影 lag 竞态、30 天边界天然难全真构造，可能因此没被写成用例，而不是以 `BLOCKED` 留在套件里。
6. **UAT runner 的判定缺陷。** `scripts/uat/run-large-schema-ingestion.mts` 的 `readTables` 只要不是 HTTP≥400 就 `done += slice.length`，不看 `deferred`／`rejections`，`ok04`／`ok06` 也不校验字段数；全部延期时仍判 600/600、PASS。历史真实跑次耗时极短（172／487ms），不像发生过延期，但记录里没有字段总数，所以「历史是否漏字段」既无证据说漏，也无证据说没漏。
7. **FDE 报告自身的数字误差。** 摘要写「漏登记 4 个 concepts 测试」，原始日志与本机比对均为 6 个（另有 `mcp-client-config-guard`、`mcp-ux-metrics`）。

## 5. 举一反三

1. **每个带预算、超时、`deferred`、窗口滑动或等待追平的机制，验收必须含一条「机制被触发」的用例，且断言「合法用户最终仍能完成」。** 只测快路径等于没测该机制。
2. **进度类不变量必须有断言。** 「每次调用至少读完一张」「循环有限步结束」写在合同正文里不算数，要有一条在最坏输入上会失败的验收；计数必须数「终态结果」，不能数「尝试次数」。
3. **UAT 套件登记其守护的源码路径；改了这些路径的提交必须复跑该套件或写明豁免。** 没有这条绑定，PASS 只对当时的代码有效。
4. **移植他人分支的测试，逐条对账「采纳／改写／不采纳」。** 不采纳要有人签字并入总账；`it.skip` 必须带总账 ID 和原因，不允许无 ID 的 skip；计划里写「保留」的，实际 skip 视为偏离计划。
5. **UAT 跑次里出现「既有行为／既有缺陷／绕过」措辞，必须同时附总账行或写明为何不是缺陷。** 「改用 diagnostic 绕过」只能证明备用路径可用，不能证明主路径正常。
6. **UAT runner 的 PASS 判定要以产出物为准（读到的表与字段），不以「请求了多少」为准。** 判定逻辑本身要有红绿自检。
7. **客户端对「请求了但响应里没有」的对象必须显式处理。** 静默当成功比报错危害更大。
8. **难造的状态不得静默消失：** 要么写成 `BLOCKED` 用例留在套件里，要么在授权流程里有固定的延迟注入通道。
9. **登记本错题 ≠ 授权改代码。** 契约修订、整改与治理改进均须另走终稿确权与开发授权。

## 6. 后续动作

| 动作 | 状态 | 说明 |
|---|---|---|
| 契约修订草案：P1-20 EC-14–EC-17（F02） | 已起草，待确权 | [P1-20 Spec §8](../specs/lucy-20261113-external-catalog-column-read-spec.md) |
| 契约修订草案：P1-34 LS-19–LS-24（F03／F04＋runner 判定） | 已起草，待确权 | [P1-34 Spec §11](../specs/lucy-20261115-large-schema-ingestion-spec.md) |
| 契约修订草案：L25-09 N26（F01） | 已起草，待确权 | [v2p5 Spec §18.19](../specs/lucy-20261020-v2p5-audit-increment-spec.md) |
| 契约修订草案：P1-38 SC-11–SC-15（AUDIT-01） | 已起草，待确权 | [P1-38 Spec §8](../specs/lucy-20261117-inferred-turn-rebuild-yield-spec.md) |
| 整改 Plan（测试先行→修复→复验） | 已起草，待确权 | [整改 Plan](../plans/lucy-20261119-fde-3b1c62af-contract-remediation-plan.md) |
| 修历史 Plan 的文档形态违规（`ff4762c9` 集成 Plan、P1-47 削峰 Plan）并更正 Task 5 偏差记录 | 已完成（仅文档） | 对应 `lint:spec-docs` 的 7 条违规 |
| `it.skip` 必须带总账 ID 的 lint；移植对账表模板 | **未开** | 治理类；需另立总账行与授权 |
| UAT 套件登记守护源码路径＋改动触发复跑 | **未开** | 同上；落点候选 `e2e-ledger.md` |
| 根测试登记补 6 个漏登记文件（`root-test-registry.json`） | **未开** | 属门禁配置，非本次文档授权范围 |
| UAT 套件补「预算耗尽／慢拒绝／滚动窗口」用例；`run-large-schema-ingestion.mts` 判定修正 | **未开** | 由整改 Plan Task 6 承接，待授权 |
| 更正 `UAT-TRC-05` 跑次 F-5 的归类 | 已写入 `e2e-ledger.md` 变更表（仅文档；F-5 与 F01 高度同型，根因未复核） | 历史跑次不改写 |

登记 ≠ 授权开工。

## 7. 证据指针

- 本机复核回复：`inbox/uat-fde-3b1c62af-2026-11-19/reply-差异复核.md`；原始日志 `inbox/uat-fde-3b1c62af-2026-11-19/l1/*-cand.log`（临时文件，可删）。
- FDE 原始证据：`Lucy升级检查_3b1c62af_20261119/证据/`（`root-contracts-full-history.log` 1059–1078 行列出 6 个漏登记文件）。
- 代码锚点：`webui/server/schema-structure.ts:294`、`webui/server/schema-structure-batch.ts:116–121`、`webui/src/lib/prepareSchemaStructure.ts:110–120`、`webui/server/schema-structure.ts:1090–1109`、`webui/server/admin/audit.ts:4791／4796／4808`、`webui/server/proxy/audit.ts`（重建删除与聚类）。
- 提交：`2b7ceed3`（11-10）、`211f2d64`（11-14）、`054ccbe3`（11-16）、`784e7f7e`／`a9052b27`（11-18）。
- 前序错题：[2026-11-17 K8s 升级 event loop](2026-11-17-k8s-upgrade-event-loop-readiness-timeout.md)（同属「夹具／UAT 绿 ≠ 客户升级可上线」）。
