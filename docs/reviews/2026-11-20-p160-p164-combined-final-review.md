# P1-60／P1-64 同候选整包最终评审

| 元数据 | 内容 |
|---|---|
| 类型／日期／审阅人 | Final Review／2026-11-20／Codex |
| 评审时间 | 2026-11-20T05:25:29.374971+00:00 |
| 授权范围 | P1-60剩余评审整改、必要回归、完整Docker UAT；合并P1-64，核对类型及前台浏览器计时，三台账同步后整包终审；本轮不提交／推送／发布 |
| 评审对象 | `project-lucy:p160-p164-final-v5`；`sha256:30ec4ae032db81201f35f78a8c1b56592ada53d5577862b1d6e7879db25fec3a`；`77e2ad84…-dirty`；产品0.30.0 |
| 功能结论 | **P1-60／P1-64功能合同收口通过，原四项、SC-09及相关预算可用性缺口关闭。** |
| 整包结论 | **不批准当前候选交付用户更新。** 包内仍有已知核心可用性修复版本未对齐，以及已纳入功能的完整验收缺口，详见下两项。 |
| 测试台 | [P1-60完整R](../qa/uat/suites/begin-zero-binding/runs/2026-11-20-codex-combined-final.md)／[P1-64与浏览器](../qa/uat/suites/source-shortname-conflict/runs/2026-11-20-codex-combined-final.md)／[INDEX](../qa/uat/INDEX.md) |

## 阻断整包更新的发现

### [P1] 核心可用性的新修复没有进入实际评审镜像

本候选确实包含P1-61诊断快照与P1-63排空实现。对照已归档的真实故障源`6b8deec4`：index、mcp-runtime-state、mcp-proxy、diagnostic-snapshot、entrypoint、process-drain六份现存关键文件逐份一致；diagnostic-collector、collector-worker、mcp-process-work三份新文件仍缺失。与[另一任务修复manifest](../qa/uat/suites/begin-zero-binding/runs/2026-11-20-codex-combined-final-artifacts/referenced-core-evidence/repair-source-manifest.json)的9份修复文件无一匹配。[本候选逐份比对](../qa/uat/suites/begin-zero-binding/runs/2026-11-20-codex-combined-final-artifacts/included-core-availability-review.json)。

[既有真实反例](../qa/uat/suites/begin-zero-binding/runs/2026-11-20-codex-combined-final-artifacts/referenced-core-evidence/prior-repro-report.md.txt)已证明：诊断读取超时后底层工作不退出、仅恢复路径仍无法自动fresh；真实10秒MCP查询在TERM后约0.7–1.6秒被截断。后续局部修复PASS只属于其单独镜像，不能计到当前候选。P1-60的R11检验空闲重启与状态持久化，不能代替有业务在途时的排空。

交付前须把已获授权且验证过的核心修复按精确来源纳入最终整包，再补齐合同要求的F61／F62／F63及相关组合证据。当前测试台核心可用性仍为局部PASS WITH GAP、R-CAV NOT RUN；本评审未修改这些条目的状态。

### [P1] 已纳入的P1-58／P1-59完整合同验收没有在本候选上闭合

实际镜像含Agents统计读取及Role／Agent对象版本、previewToken和并发编辑实现，已固定对应服务端／前端文件hash。[纳入证据与台账快照](../qa/uat/suites/begin-zero-binding/runs/2026-11-20-codex-combined-final-artifacts/included-p58-p59-review.json)。评审时[读取响应Spec](../specs/lucy-20261119-roles-agent-read-responsiveness-spec.md)与[多人编辑Spec](../specs/lucy-20261119-roles-agent-concurrent-edit-spec.md)仍在实现补齐与验收中；测试台只有smoke／GAP，完整F58／F59、真实前台浏览器、规模与DEP组合尚未取得本候选证据。

本轮类型修复包含预览依赖摘要外壳误用的实际修正，相关反例回归通过；这不能证明整个角色编辑／Agent读取功能已满足自己的合同。交付前须完成对应任务的实现与完整验收，并与两项修复合为同一实际候选复核。不能借用不同代码／不同镜像的PASS。

## 本轮修复审阅

| 项目 | 已核对实现与反例 | 结果 |
|---|---|---|
| P1-60 R-01 | 只有完整历史、空可选preparing且全局可信零才走普通路径；口径和表级歧义两道门禁一致；保留源歧义检查及持久化历史；真实L0重启同会话查询成交，L1／U0仍拒绝并保留既有强状态恢复限制 | 关闭 |
| P1-60 R-02 | 旧committed空凭据在作者元数据变化与重启后恢复，始终可信零；无凭据published／不完整历史保持unknown | 关闭 |
| P1-60 R-03 | 分类异常时工具与指导隐藏begin，continue保持；不暴露备用指导中的begin | 关闭 |
| P1-60 R-04 | 身份／ACL先行，inactive业务缺参及不存在bindingId在D2结束；有正控的loader／commit计数0，turn／预算／绑定无写入副作用 | 关闭 |
| 预算持久化 | 真实WAL锁竞争先红后绿；immediate事务只前移写锁取得时机，幂等回放、写入失败原子回滚、G3拒绝及恢复均保持 | 关闭 |
| P1-64 R1–R3 | 先保留全部有效旧别名；物理大小写保持；上传并发失败候选原样重试必须DUPLICATE_SOURCE_NAME且零写入，任意5xx不能充当正确拒绝 | 关闭 |
| SC-09 | 49条原类型诊断清零；全库检查范围、严格配置、依赖锁未变；声明对应实际MJS接口；没有排除文件或以缩小检查范围凑绿 | 关闭 |
| WebUI反馈 | 启用表及创建连接各成功／未确认／恢复六组真实前台验证；ack=false时明确问题且无成功Toast；截图实际查看 | 关闭 |

## 同一候选的实测证据

P1-60与P1-64各R0＋01–12，合计26个必做用例均在`30ec4ae0…`上PASS。P1-60是单次连续完整执行，无partial／skip或历史PASS拼接。真实MySQL全量4／100与North2／30逐次核对；身份拒绝、行隔离、启用／撤销、预算触顶及continue、故障恢复、公开审计补偿、旧会话系统重启和RC1真实Codex纯MCP查询均取得证据。

三轮N性能：两组各300个正式问题成功，60个预热问题成功，0非预期拒绝；每轮p95同时通过预先冻结的250ms及50%容差。原镜像与候选共同的SQLite故障未删除，已前瞻冻结相同持久化修复的对照再采样，未用较快延迟掩盖失败样本。

最终镜像及导出固定源码的全库TypeScript均0错误；42个文件782项Vitest、实际概念模块29项通过。38份关键独立输入hash匹配；实际server/src/scripts相对已提交基线的30份源码差异已完整归档，可用补丁还原并逐份hash核对；已提交Wiki基线6份文件完成对齐。当前共享工作树其他权限／诊断改动未混入这个候选，整包评审也因此明确记录其版本差集。

Chrome157真实前台、1440×1000、visible且focus：六组导航关键行／入口82–840ms，提交至同次反馈1557–2464ms；与同次API耗时分列。没有API拦截、假DOM或后台页计时；没有本合同之外的通用p95或UI性能承诺。

## 三台账、画像与最终处置

已先把需求台P1-60／P1-64及需求池、开发台Spec／Plan与现值镜像、测试台INDEX／e2e-ledger同步为同候选验收完成、待整包终审，再进行本次评审。现批准两项功能合同收口并更新最终状态镜像；GAP-UAT-P1-60与SC-09缺口关闭，历史FAIL、中断跑次与错误构建身份均保留。核心可用性及角色／Agent任务的GAP保持各自现值，不被两套PASS冲掉。

差集核对：本轮新增事实均归既有P1-60的SC-05／10持久化可用性支持修复与P1-64的SC-09／10；无新增产品能力或核心分母条目。问数与治理主路径的合法成交、约束生效同时验证；运维／管理因隐藏可选上报而失去原文的补偿经公开只读审计任务验证，不虚构显式原问。

本轮请求的P1-60整改、回归、完整Docker UAT、同制品短名／浏览器／类型复核、三台账和最终评审已完成。**当前整包不放行用户更新。** 需将上述已纳入模块的版本与合同验收缺口闭合后，再基于新的精确整包候选作放行判断。未提交、推送、发布或改客户部署；不以额外客户环境门槛替代这里已经查明的实际差集。

## 最终登记核验

需求／开发现值镜像逐行一致、两套INDEX最新跑次与实际digest一致，86条本轮本地链接核对通过。Spec文档、Spec、术语、IA、三台账勾连五项门禁退出0；文档门禁仅余他人未跟踪性能草稿的一条非阻塞WARN。本轮改动范围及冻结补丁新增行空白检查通过；全工作树格式检查另发现并行P1-58／59的agents.ts一处尾空格，该行未纳入本候选，未代改其在途源码。

## 后续提交授权（2026-11-20）

上述评审与UAT对应提交前冻结镜像。随后委托人明确要求“commit 本进程”，本次按作用域归档代码、测试、证据和三台账，不纳入并行任务的运行修改，不推送／发布。整包不放行结论保持；不把提交动作解释为放行批准。

提交前隔离复核：以a30599db为父基线，仅叠入本进程改动，568份运行源码及依赖锁／类型配置与已验镜像逐字节一致；类型0错误、42文件782项回归通过。四项Spec／术语／IA／勾连门禁通过；全库Spec文档门禁的PDS计划5项既存违规与HEAD完全相同，本次未新增，另一任务的修订未混入。[提交核验记录](../qa/uat/suites/begin-zero-binding/runs/2026-11-20-codex-combined-final-artifacts/commit-checks/checks.json)。
