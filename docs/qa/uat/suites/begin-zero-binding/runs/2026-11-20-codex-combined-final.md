# P1-60 与 P1-64 合并最终候选：完整 Docker R

| 元数据 | 内容 |
|---|---|
| 类型／日期／执行人 | Test Report／2026-11-20／Codex |
| 套件／合同 | UAT-SUITE-BEGIN-ZERO-BINDING v0.6；P1-60／REQ-030-081 |
| 判定 | **PASS**：R0＋01–12，共13项；单次完整执行，无partial／skip；整包交付另见最终评审 |
| 最终候选 | `project-lucy:p160-p164-final-v5`；`sha256:30ec4ae032db81201f35f78a8c1b56592ada53d5577862b1d6e7879db25fec3a`；linux/arm64 |
| 构建身份 | `77e2ad8425ae0e7a2918803e497da10636b14e5a-dirty`；Lucy0.30.0／KTX0.16.0 |
| 执行窗口 | 2026-11-20T05:08:05.230401+00:00 → 2026-11-20T05:22:59.948619+00:00 |
| 同制品短名／浏览器 | [P1-64完整13项＋六组前台计时](../../source-shortname-conflict/runs/2026-11-20-codex-combined-final.md) |
| 原始证据 | [summary](2026-11-20-codex-combined-final-artifacts/docker/summary.json)；[全制品及清理核对](2026-11-20-codex-combined-final-artifacts/final-evidence-qualification.json) |
| 执行入口 | 固定[runner](2026-11-20-codex-combined-final-artifacts/runner-pinned.py)，`--image project-lucy:p160-p164-final-v5 --baseline-image project-lucy:p160-control-budget-fixed --out <隔离证据目录>`；旧格式生成器用原c1cd基线 |

## 完整必做矩阵

| 用例 | 结果 |
|---|---|
| UAT-ZB-R0 | PASS |
| UAT-ZB-01 | PASS |
| UAT-ZB-02 | PASS |
| UAT-ZB-03 | PASS |
| UAT-ZB-04 | PASS |
| UAT-ZB-05 | PASS |
| UAT-ZB-06 | PASS |
| UAT-ZB-07 | PASS |
| UAT-ZB-08 | PASS |
| UAT-ZB-09 | PASS |
| UAT-ZB-10 | PASS |
| UAT-ZB-11 | PASS |
| UAT-ZB-12 | PASS |

I0–I3在初始／首次／再次普通发布、新旧会话逐格查询；无效业务字段draft与有效draft分别验证；invalid draft真实reindex被拒但N仍可用。发布走validate→publish，启用／撤销走真实YAML＋HTTP reindex；draft与删除最后绑定各自覆盖。每次 query 核对真实MySQL独立SQL oracle：全量4／100、North2／30，普通Bearer MCP无WebUI Session或宿主attestation。

强制begin分别带正常参数、缺intentSummary、不存在bindingId，均在inactive精确返回begin_not_available；turn、注册表与BindingSession不写入，预算只因实际查询计费。真实60次预算触顶、重连不清零、continue续查通过。过期／吊销／disabled／global deny、行隔离与真实预算存储不可用G3拒绝、修复后旧窗口保留均通过。

unknown／无凭据published／作者Source Map编译故障与已生效ACL故障分开验；保留现有数据门禁。注册表loader／commit零调用另由有正控的F回归证明，不能单凭文件无变化推断没有读。运维／管理补偿另用公开只读审计HTTP接口，按D2真实trace定位，同身份会话后续成交，六个事实查询独立对账，显式原问覆盖为0，不伪造未上报原文。

## 预算持久化实故障与修正

原候选和改前基线均出现question_budget_unavailable。隔离真实进程捕获SQLITE_BUSY，WAL deferred事务先读幂等键后升级写锁，无法等待并发writer。saveBudgetState只改为immediate事务，在读取幂等键前取得写保留；额度、续查、幂等键、ACL与失败拒绝不变。

真实worker持写锁回归先红后绿；另验证存储写入失败同时回滚预算与幂等键，恢复后可用。历史[真实SQLite诊断](2026-11-20-codex-combined-final-artifacts/sqlite-contention-diagnostic/)与[红](2026-11-20-codex-combined-final-artifacts/budget-contention-red.log)／[绿](2026-11-20-codex-combined-final-artifacts/budget-contention-green.log)保留。

原c1cd镜像因该共同故障无法作为健康性能对照，原失败不删除。采样前重新冻结d4ee128c对照：原P1-64候选＋完全相同的预算持久化修复，不含P1-60 R-01–04；与最终候选用相同资源／新I0原生卷比较P1-60增量。[前瞻冻结](2026-11-20-codex-combined-final-artifacts/frozen-comparison-v5.json)。没有改变阈值或只选成功样本。

## 三轮性能与真实计数

每组2 CPU／2GiB；随机种子60120；每轮每组10问预热＋100问采样，三轮；一个问题包含catalog／read_source／query。nearest-rank p95必须同时满足绝对增加≤250ms、相对增加≤50%；任一非预期拒绝即FAIL。全部600个正式问题成功，60个预热问题成功，无重试或删除失败。

| 轮次 | 对照p95 ms | 候选p95 ms | 对照／候选失败 | 判定 |
|---|---:|---:|---|---|
| 1 | 639.791 | 773.366 | 0／0 | PASS |
| 2 | 780.151 | 806.683 | 0／0 | PASS |
| 3 | 740.149 | 876.858 | 0／0 | PASS |

[全部样本](2026-11-20-codex-combined-final-artifacts/docker/candidate/r10-performance.json)。该对照不外推为相对原故障基线的通用性能改善。

## 系统重启、强状态与真实客户端

完整R11逐一真实Docker restart：I0／I1／I2／I3／无效draft／有效draft／L0／L1／U0，加T0主实例。重启前后预算行和绑定文件hash一致。L0同一legacy会话经强制begin拒绝后query成交，持久化历史仍在；L1／U0旧强旅程拒绝，健康新active旅程可用，既有D11恢复后仍受旧口径限制。T0旧快照允许／偏离拒绝继续有效。

RC1固定Codex CLI0.165.0及二进制hash；真实客户端只通过本次MCP完成catalog／source／query并回答4／100，无begin、无shell。客户端事件与生产审计双重核对，[完整客户端证据](2026-11-20-codex-combined-final-artifacts/docker/candidate/r12-client-trace.json)。

## 来源、回归、失败与清理

最终镜像38份关键独立输入hash匹配；server/src/scripts相对77e2ad84完整30文件差集归档，[补丁](2026-11-20-codex-combined-final-artifacts/candidate-overlay-v5.patch)已从提交基线还原并逐份hash复核。类型检查容器内及固定检出0错误，严格／include／依赖锁不变；42文件782项Vitest与实际概念模块29项通过。共享工作树其他未提交改动没有混入候选。

v3完整跑次R11真实FAIL保留：候选遗漏77e2ad84的第二道歧义门禁适配；v4补齐，但整包差集发现继承6份Wiki文件落后于已提交基线，主动中断该P1-60跑次，资源已清理；v5对齐这6份文件并重新完整执行两套UAT，不拼接旧PASS。早期dirty参数误传的镜像未用作最终证据。

最终核对18份清理记录全部通过；独立容器、网络、命名数据卷与私有凭据目录销毁。认证材料脱敏，额外去除已失效的continueToken，不改状态／oracle／计数。未替换共享demo，未提交、推送或发布。构建复用既有依赖层，不声称标准Dockerfile冷构建。

本报告只判定两条修复的真实验收。[整包最终评审](../../../../../reviews/2026-11-20-p160-p164-combined-final-review.md)独立检查已纳入候选的其他功能，不能由本套PASS推导用户更新放行。
