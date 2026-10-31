# L25-11 落地 Task：功能合同收口

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 落地 Task / v1.0 |
| 日期 | 2026-10-30 |
| 状态 | **已关闭（2026-10-31）**。用户批准拆分。FC-01–FC-32 有直接通过检查。`SEM25` 由 E2E Spec 持有且未执行。G30 仍开。不关闭 G31，不打开 W-B。本条关闭不表示可上线 |
| 授权边界 | 2026-10-30 用户授权制定本 Task 并推进落地。授权范围：冻结本条出口、用仓库内直接检查补齐功能合同、检查齐了之后把本条标成功能合同已收口。**不授权**把批量校验改成可发布计划、关闭 L25-16 的 G30 或 G31、打开 W-B、解锁 Wave 0b、客户 linux/amd64、桌面浏览器、移动窄屏、Agent 检索、30 表旅程、修改 KTX、把任一 V 行或 `SEM25-*` 改成通过 |
| 验收 | 功能合同以本文 FC-01–FC-32 为准。每一条有直接检查且该检查通过，才算这一条落地。`SEM25-V01`…`SEM25-V22` 的执行状态不回开本条。本条收口不表示可上线 |
| 合同 | [语义资产批量维护 Spec](../specs/lucy-20261020-v2p5-semantic-batch-operations-spec.md) §3–§7、§10.3 · [功能闭口与发布取证](../governance/DEVELOPMENT.md) · [E2E Spec](../specs/lucy-20261025-v0p25-e2e-mainline-and-branch-optimization-spec.md) §7.2 的 `SEM25` 行 |

## 目标

把 L25-11 收成一条功能合同。维护者按完整表身份下载可往返的语义维护包，导入只进入暂存，确认后的完整计划在同一发布窗口内写入、索引并留下可核对的终态；失败先回滚或进入待恢复，不把未生效记成已发布。

能在本模块自己的接口上打假这条承诺的检查留在本条。30 表旅程、Agent 检索、桌面跨页、真实打包 KTX 的命令输出、客户单副本，以及在已部署进程上强杀再拉起，留在 `SEM25`。

## 开工前置

- 产品语义以 Spec §3–§7 与 2026-10-27 独立审阅为准，不放宽。
- [发布窗口 Task](2026-10-30-l25-11-publish-window-task.md) 的三处收口仍然有效。发布锁留到终态摘要、终态审计、`published` 和恢复日志完成之后。
- [交付 UAT Task](lucy-20261030-l25-11-uat-delivery-task-plan.md) 的波次 E 不再要求 22 个 V 项全部通过才关闭本条。该 Task 已落盘的取证保持原判：没有一条 V 项因此改成通过。
- 批量校验继续只返回任务与报告。G30 仍开，W-B 仍关。本 Task 不改这个端点。
- 局部故障注入留在功能合同。已部署进程上的强杀留在 `SEM25`。

## 波次

顺序固定。后一波不得先于前一波的退出条件。

| 波次 | 依赖 | 这一波交付 | 退出 |
|---|---|---|---|
| A | 无 | Spec 写入「闭口层级」和 §10.3。建议书 §2.5、概览 L25-11 行、`docs/README.md` 与本目录索引改成「出口已切分，尚未收口」。V 矩阵行保持未执行 | 登记与 §10.3 的出口清单一致。没有把本条写成已收口，没有把 `SEM25` 写成通过 |
| B | A | 按下表把已有测试登记为对应 FC 的直接检查。标成「待补」的行补仓库内测试。测试走本模块的 HTTP 入口或该不变量所在的进程内接口。局部故障注入用现有恢复、镜像和日志测试，不新开一套故障框架 | 32 条都有测试名、命令和通过输出。失败的条保持未落地，不整批标成收口 |
| C | B 的 32 条都通过 | 实读建议书与概览顶部版本行，各取 current+1。状态改为「功能合同已收口」。写明 `SEM25` 仍未执行，G30 仍开，W-B 仍关，Wave 0b 仍是 `blocked_delivery` | 登记、Spec 状态行和测试三者一致。本条收口不表示可上线 |

## 功能合同

「已有」指 2026-10-30 工作区里能对上该断言的测试。波次 B 先复核断言是否真的打到这一条，复核失败就改成待补。待补行才写新测试。

| 编号 | 断言 | 2026-10-30 落点 |
|---|---|---|
| FC-01 | 两个连接的同名表精确隔离 | `semantic-batch-identity.test.ts` 已有 |
| FC-02 | 同连接两个 Schema 的同名表精确隔离 | `semantic-batch-identity.test.ts` 精确解析 public 与 archive |
| FC-03 | 无 Schema 的文件名不造成误归属 | `semantic-batch-identity.test.ts` 已有 |
| FC-04 | 身份歧义整批阻断，不猜表 | `semantic-batch-identity.test.ts`、`api.semantic-batch.test.ts` 已有 |
| FC-05 | 服务端范围快照等于筛选全集，不是当前页 | `catalog.test.tsx` 只选中筛选结果；`api.semantic-batch.test.ts` 保存全部提交身份。桌面跨页点击不在本条 |
| FC-06 | 筛选变化后，旧范围不能再当作当前选择 | `catalog.test.tsx` 清空后批量下载与批量校验不可用 |
| FC-07 | 维护未启用表不改变启用范围 | `api.semantic-batch.test.ts` 导出未启用表后 `enabled_tables` 不变 |
| FC-08 | 一个文件多表时，选择未覆盖全部写入影响则阻断 | `semantic-batch-identity.test.ts` 已有 |
| FC-09 | 只读依赖不扩写；缺失或歧义依赖整批阻断 | `semantic-batch-identity.test.ts` 已有 |
| FC-10 | 错形条目或错形包整批拒绝，正式目录不写 | `api.semantic-batch.test.ts` 已有 |
| FC-11 | 原包不改导回为无变化，且不发布、不索引 | `api.semantic-batch.test.ts` 已有 |
| FC-12 | 无 overlay 模板不改导回为无变化 | `api.semantic-batch.test.ts` 未改模板导回为 `no_change`，不创建 overlay |
| FC-13 | 计划包含本次候选和既有无关待同步变更；空 diff 不发布 | `api.semantic-batch.test.ts` 列出无关待同步变更；空 diff 不写发布记录、不索引 |
| FC-14 | 改角色、删 entry、改绑身份或 digest、过期、异实例、未知目标，整包拒绝 | `semantic-batch-package.test.ts` 已有 |
| FC-15 | `planDigest` 不符或精确覆盖集合变化时，旧确认失效 | `api.semantic-batch.test.ts`、`semantic-batch-scope.test.ts` 已有 |
| FC-16 | 绝对路径、`..`、链接、重复路径、重复身份、未登记 entry、嵌套包在导入入口拒绝，正式效果为零 | 解包拒绝已有。HTTP 导入拒绝 `..` 且正式文件不变 |
| FC-17 | 200 条、8 MiB、16 MiB 与共享限额的 +1 拒绝且不截断；导出与导入用同一限额 | `semantic-batch-identity.test.ts`、`semantic-batch-package.test.ts` 已有 |
| FC-18 | `selected = passed + failed + not_run + stale`；`not_run` 或 `stale` 阻断提交；实库证据不进入提交结论 | `semantic-batch-checks.test.ts` 已有 |
| FC-19 | 并行上限 4、单表 30 秒、任务 10 分钟来自同一限额；超时项失败且不写正式文件 | `semantic-batch-tasks.test.ts` 超时后哨兵文件不变 |
| FC-20 | 同键同计划只写一次并返回同一 release；同键异计划冲突 | `api.semantic-batch.test.ts` 已有 |
| FC-21 | 容量达到 500 且仍有未满 24 小时的键时，拒绝新意图，不提前淘汰 | `semantic-batch-idempotency-audit.test.ts` 已有 |
| FC-22 | 进程重启、校验快照已消费之后，同键仍重放同一个 release，不第二次写盘 | `semantic-batch-idempotency-audit.test.ts` 卸载模块后从磁盘重放。已部署进程强杀不在本条 |
| FC-23 | 镜像同步失败不得把日志记成 `restored`，不得把发布记成 `published` | `semantic-batch-mirror-failure.test.ts` 已有 |
| FC-24 | 失败记录写入失败时，回滚或 `recovery_required` 已经发生 | `semantic-batch-recovery.test.ts` 已有 |
| FC-25 | `recovery_required` 与 `write_in_progress` 关闭后续发布、手动索引和受影响读取；日志读失败按关闭处理 | 恢复准入测试已有 |
| FC-26 | 索引命令返回不等于 `published`；`files_saved` 与 `activation_pending` 不把日志提前完成 | `semantic-batch-journal-lifecycle.test.ts` 已有 |
| FC-27 | 索引失败保留已保存文件，生效状态为待确认；重试沿用原 release、使用新 attempt，不重复写入 | `semantic-batch-journal-lifecycle.test.ts` 保留文件且生效待确认；`semantic-release-restore-contract.test.ts` 同一 release、新 attempt、不重写 |
| FC-28 | 终态审计或状态还没写完时，单表保存、Manifest 上传、批量导入、角色保存仍忙 | `publish-coordinator.test.ts` 窗口持有时四类写入均为 `PUBLISH_COORDINATOR_BUSY` |
| FC-29 | 未登录、失效会话、跨操作者不能消费 scope、校验、导出、导入和发布 | `semantic-batch-functional-contract.test.ts` 五个入口 401；跨操作者导出与校验 409 |
| FC-30 | 合法性、完整度、执行证据分开；CSV 做公式转义且不含凭据 | `semantic-batch-checks.test.ts`、`semantic-batch-tasks.test.ts` 已有 |
| FC-31 | 默认、定制、旧布局只读写解析出的事实源和受控镜像；无硬编码仓库路径 | `paths.test.ts` 默认、相对定制与 `LUCY_CONTENT_ROOT=.`。镜像失败由 FC-23 覆盖 |
| FC-32 | 单表、批量、导入预检和发布最终校验调用同一套合法性规则 | `semantic-batch-functional-contract.test.ts` 同一非法列类型打到单表、批量与导入；发布终检调用 `runSemanticTableCheck` |

## 不在本条出口

这些继续由 [E2E Spec](../specs/lucy-20261025-v0p25-e2e-mainline-and-branch-optimization-spec.md) 的 `SEM25-V01`…`SEM25-V22` 持有。本 Task 不跑它们，也不把它们改成通过。

| 来源 | 留下的内容 |
|---|---|
| V02 的桌面部分、V20 | 跨页点击、清空提示文案、页面对象预览、工作台按钮、离开再返回 |
| V03(a)、V12(a) 的 30 表实例 | 30 张表走完下载、修改、导入、确认、索引 |
| V03(d) | 合成 Agent 经 Lucy Proxy 检索新语义 |
| V15 的拓扑演练 | 在已部署进程上强杀再拉起。本进程内的不猜 `published` 仍是 FC-26 |
| V21(a)(c) | 真实打包 KTX 的命令输出，以及不支持方言的明确失败。规则是否同一个实现仍是 FC-32 |
| V22 | 客户 linux/amd64 单副本上的往返和中断恢复 |

## 验收

- 波次 B 的一条测试只证明它点名的 FC。通过 31 条不关闭剩下的 1 条。
- 直接调用 helper 的测试，只有在它打到的就是该不变量本身时才算数。导入入口的拒绝以 HTTP 为准，解包 helper 不能单独关闭 FC-16。
- 页面截图、Docker 健康和 `SEM25` 的未执行状态都不进入本条出口。
- G30 保持开放。终态窗口是 FC-26 与 FC-28 的对象，不据此关闭 L25-16 登记里的 G31，也不打开 W-B。

## 完成定义

本 Task 完成，须同时满足：

1. 波次 A 的出口清单已写进 Spec §10.3，且与建议书 §2.5 一致。
2. FC-01–FC-32 每条都有直接检查，并且该检查通过。证据写在 `docs/reviews/`，文件名带日期，包含命令和结果。
3. Spec 状态行、建议书 §2.5、概览 L25-11 行都写成功能合同已收口。
4. `SEM25` 仍未执行。V03(d)、V22 与客户交付仍是 `blocked_delivery`。
5. 本条收口不表示可上线。

## 风险

- 用「测试文件里出现过 V 编号」代替上表的断言，会把窄子场景收成整条功能合同。
- 在 FC 未齐时把状态写成已收口，会把尚未打假的失败关闭说成已经成立。
- 为了收口去改批量校验，使它产出可发布计划，会改掉 Spec §6，并碰 G30。
- 顺手把 L25-16 的 G31 行改成关闭，会打开尚未授权的 W-B。
- 用本机 Compose 填写 V22，或用桌面观察填写 V20，会把发布取证写进本条出口。

## 落盘清单

| # | 要求 | 本文件 |
|---|---|---|
| 1 | Plan 落在 `docs/plans/`，文件名 `lucy-20261030-semantic-batch-functional-contract-plan.md` | 本文件 |
| 2 | 伪代码 | 不适用。本 Task 不新写 Spec 控制流 |
| 3 | 头部含状态、授权边界、验收 | 文首元数据表 |
| 4 | 目标、开工前置、验收、完成定义、风险 | 以上同名小节 |
| 5 | Terminology Compliance | 未新增该小节，无新术语 |
| 6 | Design System Compliance | 未新增该小节，无界面改版 |
| 7 | 登记 `docs/plans/README.md` | 与波次 A 同一次落盘 |
| 8 | 新命令 / CI | 无 |
| 9 | 功能编号 | 台账号 L25-11 写在元数据，不另派编号 |
| 10 | 机器门禁 | 落盘后对本文件跑 `lint:spec-docs` |
| 11 | 闭口层级 | 写在主 Spec，不写在本 Task |
