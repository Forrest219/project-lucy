# UAT-SUITE-CORE-AVAILABILITY — 轻探针、重任务容量与进程排空

| 元数据 | 内容 |
|---|---|
| Suite ID | `UAT-SUITE-CORE-AVAILABILITY` |
| 总账 / REQ | P1-61／REQ-030-082；P1-62／REQ-030-083；P1-63／REQ-030-084 |
| 功能合同 | [轻探针](../../../../specs/lucy-20261119-memory-probe-diagnostics-isolation-spec.md) · [重任务容量](../../../../specs/lucy-20261119-heavy-work-capacity-control-spec.md) · [关停排空](../../../../specs/lucy-20261119-process-drain-lifecycle-spec.md) |
| Plan | [P1-61](../../../../plans/lucy-20261119-memory-probe-diagnostics-isolation-plan.md) · [P1-62](../../../../plans/lucy-20261119-heavy-work-capacity-control-plan.md) · [P1-63](../../../../plans/lucy-20261119-process-drain-lifecycle-plan.md) |
| 用例 / 夹具 / 跑次 | [cases](cases.md) · [fixtures](fixtures.md) · [最新修复跑次](runs/2026-11-20-codex-readyz-diagnostic-repair.md) · [首轮反例](runs/2026-11-20-codex-readyz-diagnostic-repro.md) |
| 当前判定 | F61目标缺口局部PASS WITH GAP（真实停止／自动恢复）；F63目标缺口局部PASS WITH GAP（MCP登记／实际Node PID等待，三轮TERM）；F62仅导出局部PASS WITH GAP；完整矩阵未完成；R-CAV NOT RUN |

## 真实性与授权

遵守 [CONVENTIONS](../../CONVENTIONS.md)。功能单测中的替身不算UAT；UAT使用隔离Docker真实服务、原生SQLite和可用业务数据库、真实HTTP/MCP及进程信号。不能造成功JSON、改旧时间戳凑窗口、mock权限结果或用CR冒充执行。缺少环境/权限则BLOCKED；受控替身降级须委托人另行授权并独立标注。

起草时仅文档授权，首轮仅复现；2026-11-20后续委托人明示修复两缺口并本机Docker全真复测，见原Spec／Plan及执行Plan。`scripts/uat/readyz-diagnostic-repro.py`新增 `--verify-repair` 并登记Current Commands／CI Mapping，无CI job；完整入口尚不存在。不改客户环境，不提交、不推送、不发布，不移用其他任务授权。

## 分层与必做

| 选择器 | 必做用例 | 证明 | 不证明 |
|---|---|---|---|
| F61 | R0、61-01…61-06 | P1-61 SC-01–09，诊断/响应局部不变量 | 系统重负载或网关零503 |
| F62 | R0、62-01…62-06 | P1-62 SC-01–10，三类真实入口许可/语义 | 原模块所有算法均达标、任意负载不拒绝 |
| F63 | R0、63-01…63-06 | P1-63 SC-01–09，真实信号与请求排空 | 零中断升级、SIGKILL/OOM无损 |
| R-CAV | R0、R-01…R-03 | 同一候选的组合发布取证补充证据；由P1-13消费 | 任一模块SC、P1-52客户升级或P1-53真实Agent题库已通过 |

功能子集独立判定，只能写“F61 PASS”等，不写整套PASS；其他子集不倒挂为其前置。全套必做均通过方可写整套PASS。R-CAV作为同候选组合主张的必做补充，触发点为三个模块形成候选并准备提交组合结论，负责人为候选测试执行者；没有执行授权时保持NOT RUN。客户升级仍由P1-52原A/B/C边界负责，不重复创建“零503升级门禁”。

## 判定与回归

- 正常窗HTTP错误/超时/内容错误均计失败；容量饱和的预期429、启动/排空503与故障注入错误单列，不能混入成功分位数或从总请求数消失。
- “拦住”之后必须有恢复后的合法成交；F61诊断慢/陈旧及恢复后、F62容量饱和及恢复后、F63重启后，均须由不带WebUI Cookie的纯MCP完成 `initialize`→`tools/list`→合法轻量数据查询并核对结果。写入成功以原持久化回执/实际结果判定，不以网络回包次数判定；无原回执的模块不得新造job API凑证据。
- P1-61轻探针预算只用于F61；R-CAV沿用原P1-39／47适用窗口门槛，禁止将轻负载100ms预算倒挂成其他合同新要求。
- 原P1-21、39、45、46、47及Spec174／190作为回归依赖消费现有测试，不复制编号或覆盖历史跑次。P1-57 D7正式完整导出仍延期，R-01使用已证明可用的导出范围，不宣称覆盖D7。
- 单模块失败映射对应SC；组合失败先定位被证伪合同，再回写原条目，不整批重新打开所有模块。

## 证据

每次runs记录SHA、dirty、镜像digest、镜像架构、资源/卷/限速、fixture指纹、采集时间、选择器、实际请求清单、实际工作启动/终结、完整状态/耗时样本、计数oracle、权限/重试恢复结果和退出顺序。预期429/503必须标具体用例和窗口。原始数据可落inbox，正式跑次保留摘要/指纹与可复查结论，不以可删临时文件作为唯一证据；不含凭据、DSN或业务原始内容。

## 文档落盘检查

以下为本批17项逐项核对入口；检查结论见配套 [文档核对报告](../../../../reviews/2026-11-19-core-availability-doc-check.md)，不当行为验收。

| 项 | 本批处理 |
|---|---|
| 1 文件名 | 三组同日期同slug，Spec在docs/specs，Plan在docs/plans |
| 2 核心流程 | 三Spec均含成功/拒绝/超时/恢复顺序伪代码 |
| 3 元数据 | Spec与Plan含状态；Plan含授权边界/验收 |
| 4 Plan结构 | 目标/开工前置/验收/完成定义/风险齐全 |
| 5 术语 | 三份固定格式；拟API字段/机器码在Spec登记 |
| 6 设计系统 | 不改WebUI；不新增设计系统小节或视觉模式 |
| 7 索引 | docs README、plans README、概览§9同句登记 |
| 8 命令/CI | 起草时无新命令；2026-11-20局部runner已登记并执行，完整入口未实现，无CI job |
| 9 身份 | 文件名为身份；台账号无；P1-61…63仅为总账行 |
| 10 门禁 | 按报告记录实际文档检查；不以未跟踪只WARN绕过 |
| 11 闭口层级 | 三份功能合同；系统组合归R-CAV和既有发布条目 |
| 12 现值 | 本批状态镜像同句，历史与当前严格分开 |
| 13 交互 | 三份有效豁免，两行固定格式；Plan浏览器不适用 |
| 14 总账 | 先入总账/REQ，再写草案；不入核心分母 |
| 15 三台 | suite/cases/fixtures/runs、INDEX、e2e指针及缺口齐全 |
| 16 主路径 | 拒绝后恢复成交、纯MCP无WebUI前置、权限不陈旧放行 |
| 17 画像 | 三份四画像；↓逐项有补偿及SC编号；设计目标非实测 |

## 2026-11-20 本次执行授权

委托人明示本机Docker全真复现readyz挂起，重点第一批及超时恢复，再评估二三批。授权上述局部场景、具名隔离资源、合成数据与真实文件系统故障；不含客户变更/发布/产品修复。上文“本轮未授权执行”仅为起草时历史；本次以[执行Plan](../../../../plans/lucy-20261120-readyz-diagnostic-repro-uat-plan.md)为准。全套其他用例不自动视为已执行或通过。

## 首轮跑次及缺口（历史）

[2026-11-20 局部跑次](runs/2026-11-20-codex-readyz-diagnostic-repro.md)保留真实FIFO、全部240个探针样本、恢复与三轮真实DB查询TERM证据。F61 §2.5／SC-05、F63 SC-03已有反例，不能被局部成功抵消；F62仅导出真实入口，三类别容量合同未全验。完整矩阵与R-CAV保持未完成，不回写整套PASS。

## 最新修复复测

[修复跑次](runs/2026-11-20-codex-readyz-diagnostic-repair.md)在同一最终候选完成真实工作进程回收、120秒探针、两轮无需释放旧FIFO的自动恢复，以及诊断正常／挂起共三轮MySQL10秒查询TERM和同卷恢复。CAV-01／02目标反例已通过；前次FAIL不改写。F61／63其他分支与F62完整容量矩阵、R-CAV仍未全验，不能主张功能合同收口或整套UAT PASS。

## R-CAV-FDE-1883执行登记

2026-11-20委托人明示本机1883表持续运行补验。[具名跑次](runs/2026-11-20-codex-fde-1883-soak.md)原计划至少7200秒，委托人约1h止测，实际59分45秒、局部FAIL；使用正式HTTP修改／保存／重载、20万合成历史审计与实际维护、合法HTTP／纯MCP及探针并行，独立采集事件循环、主线程CPU与诊断进程。入口 `scripts/uat/core-availability-1883-soak.py`，细节见原执行Plan；不改变前次判定，不代表完整R-CAV已经执行。

收敛结果：1883–1884启用表、12次真实提交／重载、8次完整恢复；预算相关503、HTTP超时与观测开销单列。候选未含后续18b63d01已登记预算修复，优先整合同候选而不重复立项。1883表后置FIFO、原2h和最终审计闭包GAP保留；前次第一／三批目标修复证据不改写，完整矩阵未完成。

## 0.30本轮合入复测

[整合候选复测](runs/2026-11-20-codex-availability-merge-recheck.md)局部PASS WITH GAP；同一最终镜像复验真实诊断执行上界、120秒探针、两轮仅恢复路径自动fresh，以及正常／故障三轮真实MCP查询TERM和原卷恢复。原1883表FAIL及完整矩阵GAP保留。[后续Plan](../../../../plans/lucy-20261120-core-availability-followup-plan.md)明确下次开发，本次不实施新热点／热重载整改。
