# 2026-11-22 KSCC 本机 Docker 核心可用性正式复测

| 项目 | 结果 |
|---|---|
| 用例 | [UAT-CAV-STD-01～05](../cases.md#标准复测档位)，按 [复测标准](../retest.md) 的 `formal` 档 |
| 执行与审阅 | 本机 KSCC CLI 1.3.8 派发和交接，Codex 使用派发前冻结的核验器从原始回执独立重算。[执行回执](2026-11-22-kscc-cav-formal-artifacts/executor-receipt.json) |
| 冻结候选 | `lucy-v0.30` 派发时 HEAD `8fe7cebc0e73d98aba3e687899fb83e34651e0aa`，干净 stamp。Linux arm64，镜像 ID `sha256:e4ad33064b9cb6df1451cbe4141a33118c24e5c2657d40c83b79c5bb32bd7713`。6 个记录的运行源码哈希及测程哈希全部一致 |
| 自然窗 | 北京时间 18:14:57.333–18:44:57.333，共 1800 秒。每 150 秒一轮，12／12 真实保存／重载／查询恢复。物理表、Manifest 和启用表各自至少 1883 |
| 独立判定 | **FAIL / VALID**，出口 1。STD-02 的直连 livez 最大耗时超线，STD-01／03／04／05 均通过。 |
| 复核时分支 | HEAD 已前进至 `bc0afabc`，差异为治理文档与 MCP 兼容测试。相关 Lucy 运行时、Dockerfile 及应用配置无提交差异，本跑次仍绑定 `8fe7cebc`。[独立核验汇总](2026-11-22-kscc-cav-formal-artifacts/review.json) |

## 正式用例结果

| 用例 | 判定 | 证据 |
|---|---|---|
| STD-01 身份和基线 | PASS | 冻结 Lucy／MySQL 镜像身份匹配，入口预检、鉴权读项目、纯 MCP 握手列工具及查询 4／100 通过 |
| STD-02 稳态请求和探针预算 | **FAIL** | 3 路直连探针、反代 readyz 和鉴权 HTTP 各 1800／1800 成功，无漏发。直连 livez p99 292.44 ms，**最大 1215.47 ms，门槛 1000 ms**。直连／反代 readyz p99 分别 299.56／336.26 ms。鉴权 HTTP 最大 1962.19 ms，全部在 3 秒内。 |
| STD-03 保存、热重载和纯 MCP 恢复 | PASS | 12／12 成功，保存路径无 503。纯 MCP 360 次，321 次成交，39 次 `EXECUTION_RUNTIME_RELOADING`。39 次均按 P1-69 核验 owner、原身份／session／问题恢复、唯一执行及预算，所有拒绝留在原分母。 |
| STD-04 真实诊断阻塞及恢复 | PASS | 单在途限制生效，被阻塞的诊断进程全部实际终止，旧 FIFO 未释放时已恢复 fresh，Lucy 原 PID 未变，合法 HTTP／纯 MCP 恢复。 |
| STD-05 采集、闭包及清理 | PASS | 360／360 在线审计采集收齐，全部具备终态票据。233,495 条原始审计全量有效关联，同窗隔离的容器、网络、卷和私密夹具清理，独立查询未发现残留。 |

只有一次 livez 超过 1000 ms。峰值 `probe:/api/livez-58` 在北京时间 18:15:56.552 返回 200，HTTP 请求本身耗时 1214.59 ms。同期直连与反代 readyz 及基础 API 同步出现约 1.15～1.24 秒延迟，health 的 60 秒事件循环最大值为 1227.88 ms。cgroup 样本显示同期存在 CPU 限流和后续内存限额压力，未见 OOM。不把容器资源相关性当作已定位的阻塞函数，也不将该点归因于 24 秒前已结束的显式重载。正式窗关闭 CPU profiler，进程采样与 HTTP 回执已保留。 [峰值原始观测](2026-11-22-kscc-cav-formal-artifacts/peak-observations.json)

运行器因预算未达标返回失败，核验 JSON 的 `runner did not complete its checks` 是对该非零出口的概括。自然窗、FIFO、审计及清理均有终态，失败归属是上述一个预算违例。

## 历史故障对照

11 月 17 日升级时，`readyz` 最慢手测 7.55 秒，约 18 分钟内重复探针超时，Pod 失去就绪状态，随后出现入口 502／503 和回滚。后一次运行期挂站回传记录了 `readyz` 请求长期无完成及单副本 Service 摘流。 [升级事故复盘](../../../../../lessons/2026-11-17-k8s-upgrade-event-loop-readiness-timeout.md) · [运行期回传记录](2026-11-20-codex-readyz-diagnostic-repair.md#7-fde最新回传补充3577png3578png)

本轮直连和反代 `readyz` 各 1,800 次均返回 200，最大值分别为 1.153 秒和 1.214 秒。按历史记录与仓库默认的 3 秒探针超时，观测到的单点长尾本身不足以触发探针失败、摘流或由此引发的回滚。历史入口故障链路在本机正式跑次未复现。`FAIL` 继续反映既有 1 秒性能预算的违例。 [独立核验汇总](2026-11-22-kscc-cav-formal-artifacts/review.json) · [仓库探针默认值](../../../../../../deploy/k8s/helm/lucy/values.yaml)

## MJ 503 对应的本机结论

| 归属 | 现有合同与本次支持 | 仍需补齐 |
|---|---|---|
| 11 月 17 日升级／慢盘，P1-39／46／47 | 已有冷启动、重建及 MCP 就绪 Spec 和各自 Docker PASS。 | 本跑次是运行期组合，用例边界独立，保留原冷启动判定。 |
| 运行期诊断隔离，[P1-61](../../../../../specs/lucy-20261119-memory-probe-diagnostics-isolation-spec.md) | 既有合同承接受控诊断读挂起，STD-04 已在冻结候选通过。 | 完整 F61 的路径 I/O 计数、代次切换与撤权对照等必做项仍需补验。当前长尾出在自然窗，不能据此打回已通过的诊断隔离路径。 |
| 热重载、保存 ack 与语义等待，[P1-69](../../../../../specs/lucy-20261120-runtime-reload-drain-spec.md)／[P1-64](../../../../../specs/lucy-20261120-source-shortname-uniqueness-runtime-ack-spec.md)／[P1-70](../../../../../specs/lucy-20261120-semantic-read-write-settle-spec.md) | 现有合同覆盖具名行为。12 轮保存通过，未复现上一校准的 `EXECUTION_RUNTIME_NOT_LOADED`。39 次合同拒绝全部恢复，未观察到这些路径的额外产品失败。 | F69 仍须验默认总截止、迟到回执归属、撤权以及自动和手动重载并发。历史校准失败继续保留。 |
| 重负载事件循环长尾，[FUP-03](../../../../../plans/lucy-20261120-core-availability-followup-plan.md#验收矩阵)／P1-13／P1-47 | 已有 1 秒最大值、400 ms p99 和相关合法业务门槛。本机标准正式跑次命中一次最大值反例。 | **开发缺口是重负载下的探针长尾**。先定位可测的同步工作、调度或资源压力，再确定最小运行修复，按原预算复验。现有证据没有把根因收敛到哪个模块。 |
| P1-62／P1-63 | 已有容量与关停合同。 | 三类重任务容量与 TERM 完整生命周期继续各自验证，本次标准组合没有覆盖这些独立出口。 |

本机已证明诊断恢复和热重载受测路径可用。正式组合有必做性能项失败，MJ 运行期可用性修复整体仍待收口。

## 证据复算

- [原始跑次压缩包](2026-11-22-kscc-cav-formal-artifacts/raw-run.tar.gz)与[一致审计库备份](2026-11-22-kscc-cav-formal-artifacts/audit-evidence.sqlite.gz)成套。
- [附件哈希](2026-11-22-kscc-cav-formal-artifacts/files.sha256)核对归档字节，原始包内还包含测程冻结和逐文件证据哈希。
- 在附件目录运行 `shasum -a 256 -c files.sha256`。将原始包解压到新目录，再将审计备份放入解压出的 `formal/`。用可信且与冻结哈希一致的核验器运行 `python3 scripts/uat/core-availability-uat.py verify --run <解压目录>/formal`。可重算同一 `FAIL / VALID`，无需 Docker。
