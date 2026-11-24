# 候选6短校准：CALIBRATION PASS，独立证据 VALID

| 项目 | 内容 |
|---|---|
| 日期／执行 | 2026-11-20／Codex，多 agent CA-01／08 前置校准 |
| 判定 | 原生产者 **CALIBRATION PASS**；独立重算 **VALID／CALIBRATION EVIDENCE VALID**；不是正式30分钟 PASS |
| 候选 | `sha256:ae0eb26a73d9331f45e4276f9839c442f9c8ada0ff2701366c7c2b099b8f7a4f` |
| 工具 | runner `38a37d780aabb62d047e19484d9da97651fa233f5708bbcb04262733ac9095b4`；[三工具冻结身份](2026-11-20-codex-followup-r6-calibration-artifacts/source-freeze.json) |
| 自然窗 | 19:07:40.923888–19:09:40.923888 CST，120秒／60秒间隔／2次完整变更；1883表／12身份；无持续 CPU profiler |
| 证据 | [原终态](2026-11-20-codex-followup-r6-calibration-artifacts/summary.json) · [独立重算](2026-11-20-codex-followup-r6-calibration-artifacts/independent-review.json) · [审计一致备份身份](2026-11-20-codex-followup-r6-calibration-artifacts/audit-evidence.json) · [附件hash](2026-11-20-codex-followup-r6-calibration-artifacts/files.sha256) |

普通 MCP24次全部终结：17次成功，其中16次在自然窗内、1次尾部完成；7次精确503 `EXECUTION_RUNTIME_RELOADING`。这7次仍完整计入用户可见失败分母，不宣称零失败。每项均有真实 owner acquire／release、原 requestId／deadlineAt／rejectedAt 归属，后置同身份、同session、同问题的显式恢复及独立只读审计证明；7项完整闭环，按批准的 P1-69 合同单列 expected，unexpected 为0。分类不靠维护宽窗、消息字符串或自动重放。

独立重算核对全部24条普通查询及120条 HTTP payload，正确成功行为与失败分类一致。显式恢复位于19:09:43–19:10:25 CST，诊断 FIFO 故障／恢复位于19:10:25–19:11:10 CST，均独立于自然性能窗，不计自然吞吐。真实诊断进程终态／自动恢复、计数守恒与预算门槛通过；清理后自有容器、网络、卷、私有目录均不存在，工作线程为0。

| 自然窗指标 | 实际值（毫秒） |
|---|---|
| livez p99／最大 | 274.360／280.662 |
| readyz p99／最大 | 270.450／279.516 |
| health p99／最大 | 280.327／306.209 |
| HTTP自然成功120次 p95／p99 | 603.060／893.422 |
| MCP自然成功16次 p95／最大 | 26715.598／26715.598 |

审计一致备份由 SQLite backup API 获取，独立复核先校验 gzip 与解压数据库的双hash／字节数，再读取封闭只读视图全量重算。203055条符合范围的原始行均唯一有效关联；missing／duplicates／wrongUser／orphan均0，79用户水位覆盖。本量级包含203000条合成历史夹具（初始20万及后续增量），不是203055次真实用户调用。7次恢复分别证明预算 calls＝attempts＝1、current_concurrency＝0，以及唯一实际成功query和同用户有效关联；临时解压快照已删除。

备份元数据记录 SQLite 2205515776字节、gzip 79533330字节，采集19.181秒／90秒截止内。完整 raw／owner日志／事件已由 M 迁移至[原始证据档案](2026-11-20-codex-followup-r6-calibration-artifacts/raw-evidence.tar.gz)，[一致审计备份 gzip](2026-11-20-codex-followup-r6-calibration-artifacts/audit-evidence.sqlite.gz)亦已归档；身份见[附件索引](2026-11-20-codex-followup-r6-calibration-artifacts/artifact-index.json)、既有 files.sha256与审计双hash元数据。原 inbox 跑次目录及 `09-review/calibration-r6-independent*` 保留来源身份，已非唯一归档载体。本次仅更新小文本链接和索引，沿用 M 已记录的大档 hash，未重读、重hash或重新压缩大档。原 summary 按字节保留，不补写或更改。

本结果仅证明该120秒短校准及其取证可用。正式1800秒／150秒周期／至少12轮、完整F69／F70及其他主路径矩阵、整套UAT与发布结论仍须独立门禁；不将本页 CALIBRATION PASS 或代码 APPROVED 写成正式验收 PASS，也不改写候选4／5历史 FAIL。
