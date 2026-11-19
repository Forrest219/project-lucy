# 错题：宽表修复后，单表权限拒绝和 100 次请求上限仍会中止合法读表

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-11-19 |
| 标签 | `gate-gap` `contract-stack` `ux-regression` `sev-high` |
| 环境 | 本机 arm64。修复提交 `d8c3f097`。Codex 复测镜像 `sha256:08be21d3dd0a9867ce113f1c82f837592040cc8091f54efff4b2eaa038b880f4`，health `gitSha=3b1c62af`、`gitDirty=true`；四处运行修复的文件哈希与该提交一致，镜像不是该提交的干净构建。Node 22 跑原 FDE 用例与 600 表边界 |
| 相关 | 前序错题 [5 个缺陷没被 UAT 拦住](2026-11-19-fde-3b1c62af-defects-missed-by-uat.md)；总账 P1-56／REQ-030-077；[整改 Plan](../plans/lucy-20261119-fde-3b1c62af-contract-remediation-plan.md)；[P1-34 §11](../specs/lucy-20261115-large-schema-ingestion-spec.md) LS-19／LS-20；评审 `inbox/codex-fde-review-20261119/review.md`；跑次 [2026-11-19-codex-fix-review](../qa/uat/suites/fde-packcheck-3b1c62af/runs/2026-11-19-codex-fix-review.md)（正式套件 **BLOCKED**） |
| 状态 | `open`（两处读表阻塞未修。登记 ≠ 开发授权。不改 Spec） |

## 1. 症状与影响

`d8c3f097` 落地后，FDE 原复现里 F01、F02 翻绿，AUDIT-01 在同镜像上真实等待 35 秒后归属唯一。宽表主路径仍有两处会让合法表读不完。正式套件保持 BLOCKED，不能回复「阻塞已全部修复」。

| 编号 | 用户可观察行为 | 本轮证据 |
|---|---|---|
| 混合权限（LS-20／F04 第二条） | 30 张表里只有 `t0` 无权限。缩到单表后读表直接停止，其余 29 张合法表不再查询。报「没有权限读取表「t0」的字段。」，不是汇总「有 1 张表没有读到字段」 | `seen=["t0"]`。`original-vitest-node22.log` |
| 请求次数上限（新引入） | 600 张合法表一直在读完单表，第 101 次请求被打断。当时已成功 95 张，函数抛错后已读结果一并丢掉，调用方得到 0 张 | `request-boundary.log`：`calls=101`，`singletonResultsRead=95`，`returnedTables=0` |

同轮不要并案：当前 demo 正式 CSV／ZIP 仍 409，原因是 `attribution_journal_baseline_unknown`（归属修订基线缺失），投影 lag=0。这不是 F01 的 lag 误拒。证据 `export-proof.log`。

## 2. 复现要点

1. 混合权限：FDE `skipped-public-behavior.test.ts` 第二条。多于一张表的字段查询返回截断，逼客户端对半缩批；只剩一张时，`t0` 抛 `permission denied`，其余表应继续。实际只见到 `t0`。
2. 600 表：批次大于 1 时全部 deferred，缩到 1 后每张都成功。期望 600 张读完；实际第 101 次抛「读取表结构请求次数超过上限，请稍后重试。」

50×400 的原第一条本轮通过。这两条失败不推翻那一条。

## 3. 根因

| 层 | 结论 |
|---|---|
| 实现（混合权限） | 单表准备表结构的原合同是：有拒绝就抛 400，不把拒绝放进响应体。见 `webui/server/schema-structure.ts` 的 `previewSchemaStructure`：`requested.length > 1` 才回传 `rejections`，单表且无 `deferred` 时抛「没有权限读取表…」。新客户端把批量缩到 1 之后，这条单表抛错变成整批的正常续读。`readCheckedTableColumns` 对 `fetchSchemaStructure` 的异常不接住，循环退出。 |
| 实现（次数上限） | `prepareSchemaStructure.ts` 在每次请求后执行 `requestCount > 100` 即抛错。LS-19 写的「≤ 100」是 50 张表夹具的防无限重试上界。实现把它做成所有输入共用的硬顶。600 张从 50 对半缩到 1 需要 6 次整批 deferred 加 600 次单表。次数一超，已经累积的表被整段丢掉。 |
| 测试 | LS-20 mock 了 `apiPost`，单表也返回带 `rejections` 的成功体。真实 `previewSchemaStructure` 在单表上不会返回这个体。LS-19 只断言 50 张表的 mock 调用次数 ≤ 100，没有 600 张合法表，也没有连续三次截断树和每次响应 ≤ 20 秒。 |
| 合同 | LS-20 要求 29 张读到、最终汇总点名 `t0`、`seen` 覆盖 30 张。LS-19 的次数上界写在 50 张表那一条里。实现把夹具上界提升成产品常量，和既有 600／1200 张规模要求相撞。 |

SC-16、SC-12、N26-6 是同一轮指出的验收缺口，不是这两处用户可见中止的根因：SC-16 只有 6 条调用，断言的是旧调用没有被新关联；SC-12 没有详情与调用呈现的用例；N26-6 在追平夹具上只期望 200。两条导出路由的代码是先记起点再取水位，该测试没有让投影读取变慢，错的起点也能绿。

## 4. 为何漏检

1. **新测试替服务端配合了客户端。** LS-20 证明的是「如果响应体里有 `rejections`，客户端会汇总」。FDE 原用例走的是真实 `previewSchemaStructure`，缩到单表后抛错。mock 成功体把这条抛错绕开了。
2. **夹具上的数字被写成了产品上限。** 「50 张表不要无限重试，100 次够用」落到代码里变成任意表集最多 100 次。没有一条用 Spec 已有的 600 张规模去打这个上限，所以上限在有进展时切断主路径，默认测试仍然全绿。
3. **和今早同一类漏检。** 绿灯来自我们构造的响应，不是 FDE 那条真实客户端加真实预览的路径。原 `skipped-public-behavior.test.ts` 本轮一跑，第二条立刻失败。
4. **抛错丢掉已读结果。** 95 张已经读完，对外仍是 0 张。只看最终 `tableCount` 会把「读到一半被上限打断」看成「一张都没读」。

## 5. 举一反三

1. **批量循环缩到单条接口时，测试必须走真实单条错误合同。** 不允许 mock 一个批量才会返回的成功体来证明单条失败仍能继续。
2. **为一个夹具写的次数上界，不得原样变成所有输入的硬顶。** 同一改动要带一条 Spec 已有大规模（这里是 600 张）且持续有进展的用例；该用例必须跑完。
3. **循环中途抛错前，先定已读结果留不留。** 留，就要有断言；丢，就要在合同里写明，并且不能把「已读 95 张」实现成调用方看到 0 张还不自知。
4. **宣称某个原缺陷已关闭之前，重跑发现它的那条原用例。** 新文件全绿不能代替原 harness。
5. **同一个 409 要看原因码。** `projection_lag_exceeded` 与 `integrity_or_relation_failed`／`attribution_journal_baseline_unknown` 不是同一件事。

## 6. 后续动作

| 动作 | 状态 | 说明 |
|---|---|---|
| 批量缩到单表后，已知的单表拒绝进入汇总并继续其余表；单表入口自身的抛错合同保持 | **未开** | 登记 ≠ 授权。验收用 FDE 原第二条：`seen` 覆盖 30 张，29 张读到，最后只汇总 `t0` |
| 去掉与输入规模无关的 100 次硬顶；50 张原用例的 ≤ 100 断言保留 | **未开** | 600 张缩到单表后须全部完成；已读结果不得因超限被丢成 0 |
| 补 LS-19 连续三次截断树与每次响应 ≤ 20 秒；补 SC-12、SC-16 满量与 N26-6 的计时起点对抗 | **未开** | 本轮评审已指出测试缺口。补测试本身不授权改产品合同 |

## 7. 证据指针

- 评审：`inbox/codex-fde-review-20261119/review.md`（R1、R2、R3）。
- 原用例日志：`inbox/codex-fde-review-20261119/original-vitest-node22.log`；夹具 `inbox/codex-fde-review-20261119/functional-skipped/skipped-public-behavior.test.ts`。
- 600 表边界：`inbox/codex-fde-review-20261119/request-boundary.log`。
- 正式导出 409 的基线证明：`inbox/codex-fde-review-20261119/export-proof.log`。
- 代码锚点：`webui/server/schema-structure.ts` 单表拒绝抛错；`webui/src/lib/prepareSchemaStructure.ts` 的 `fetchSchemaStructure` 调用与 `requestCount > 100`。
- 提交：`d8c3f097`。
