# 候选5短校准：代码终审发现问题后受控中止

| 项目 | 内容 |
|---|---|
| 日期／执行 | 2026-11-20／Codex，多 agent 前置校准 |
| 原始判定 | **FAIL**，原 summary 不改写；后置恢复／取证被主动中止，非正式30分钟验收 |
| 候选 | `sha256:a321311d286316aa53fe19288859d6f833d9a7251a18f0e1309ddf58b24c1f54` |
| 工具 | runner `e7bd5471b97bb6e9325409587197da3f12951fac651ff4df05daa6b92294d090`；[原三工具身份](2026-11-20-codex-followup-r5-calibration-artifacts/source-freeze.json) |
| 自然窗 | 18:48:56.187806–18:50:56.187806 CST，120秒／60秒间隔／2次完整变更；无持续 CPU profiler |
| 证据 | [原终态](2026-11-20-codex-followup-r5-calibration-artifacts/summary.json) · [SIGTERM 控止请求](2026-11-20-codex-followup-r5-calibration-artifacts/controlled-stop-request.json) · [恢复终态摘录](2026-11-20-codex-followup-r5-calibration-artifacts/recovery-terminal-extract.json) · [附件身份](2026-11-20-codex-followup-r5-calibration-artifacts/files.sha256) |

M 在最终代码终审指出两项 P2 后，于18:51:15.822188 CST 向校准宿主进程发送 SIGTERM，停止已被新修订取代的跑次，保留全部原始结果。两项分别是写后语义核验沿用旧目录缓存，以及 owned process group 超时可能遗留重定向标准流的孙进程；后续修复另有代码与真实反例，不回写本轮。

自然120秒已实际完成；停止发生在自然窗之后的显式合同恢复阶段。原普通 MCP24次，16次成功（14次自然窗内、2次尾部完成）、8次失败，分母不删；HTTP及三探针各120次完成且原计数成功，2次变更完成。显式恢复8项中2项成功返回，余6项在中止／清理期间以连接关闭终结。没有完成最终 owner／恢复／只读审计闭包和预算判定，不能把这些失败直接定性为自然期产品违反验收，也不能据计数补写产品通过。

原 summary 的错误是 `InterruptedError`／`explicit signal/deadline 15`，且保留 `toolQualification.controlledStop:false`；外部人工控止事实以独立 SIGTERM 请求记录为准，不篡改该原字段。summary 中计数／终结／清理资格的 PASS 也不覆盖已发现的工具缺陷或缺失的最终取证。清理记录显示任务自有容器、数据库、网络、卷和私有目录均已移除，收尾工作线程为0。

本页保留小型原 summary、源码冻结身份与控止请求；恢复摘录明确标为从原事件选取字段的派生记录。完整 raw 已由 M 迁移至[原始证据档案](2026-11-20-codex-followup-r5-calibration-artifacts/raw-evidence.tar.gz)，身份见[附件索引](2026-11-20-codex-followup-r5-calibration-artifacts/artifact-index.json)与既有 files.sha256；本轮中止未形成最终审计备份，不补写闭包。原 inbox 跑次目录作为来源保留，已非唯一归档载体。本次仅更新小文本链接和索引，沿用 M 已记录的大档 hash，未重读、重hash或重新压缩大档。本次不是正式1800秒／12轮结果，不签 UAT、F69／F70完整矩阵或发布结论，历史 FAIL 保留。
