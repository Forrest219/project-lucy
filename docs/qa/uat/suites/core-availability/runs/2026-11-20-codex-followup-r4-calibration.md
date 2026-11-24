# 候选4短校准：重载恢复可核对，正常写入期查询仍失败

| 项目 | 内容 |
|---|---|
| 日期／执行 | 2026-11-20／Codex，多 agent CA-01／08 前置校准 |
| 判定 | **FAIL**；独立证据完整性VALID，严格组合验收FAIL；不是正式30分钟窗口 |
| 候选 | sha256:6c32cddd5bd8186b7c15d218dd5cef9d53b895a0eb54a40331d7a5f7ed99fdc2；[完整身份](2026-11-20-codex-followup-r4-calibration-artifacts/candidate-manifest.json)；与候选3仅两工具文件不同，运行代码相同 |
| 工具 | runner SHA256 a9a94633a350c9060dbd3a4be43d8e3466268e732546f7f3fe79a5ef76766790；[源码](2026-11-20-codex-followup-r4-calibration-artifacts/runner-snapshot.py) · [三工具冻结身份](2026-11-20-codex-followup-r4-calibration-artifacts/source-freeze.json) |
| 自然窗 | 120秒、60秒间隔、2次完整变更；1883表／12身份／20万初始合成审计；无持续CPU profiler |
| 证据 | [终态](2026-11-20-codex-followup-r4-calibration-artifacts/summary.json) · [完整事件](2026-11-20-codex-followup-r4-calibration-artifacts/events.jsonl.gz) · [独立全量复核](2026-11-20-codex-followup-r4-calibration-artifacts/independent-review.json) · [附件hash](2026-11-20-codex-followup-r4-calibration-artifacts/files.sha256) |

普通MCP共24次：16次成功（15次自然窗内、1次尾部完成），8次失败，失败分母完整保留。7次精确重载503均有真实owner／deadline／server rejectedAt绑定与完整释放；随后7次同身份、同session、同问题显式恢复均成功。独立备份SQL逐项确认这7次恢复预算calls＝attempts＝1、唯一实际query及同用户有效关联，故可按P1-69映射为合同内拒绝，仍计用户可见失败。另1次 `semantic_recovery_required` 不能豁免，严格组合结果仍FAIL。

120条普通HTTP全部通过实际payload核验；探针、预算性能门槛、FIFO真实进程终结与自动恢复局部通过。203055条原始审计完整闭合，无孤儿、重复或错误用户，水位覆盖；独立审计使用一致备份并核对双hash，解压临时数据库已删除。本任务容器／网络／卷／私有夹具清理全部true。

## 真实业务失败及合同差集

[原始失败回执](2026-11-20-codex-followup-r4-calibration-artifacts/unexpected-query.json)为HTTP200、`result.isError=true`；不能因HTTP成功而当业务成功。[逐时序诊断](2026-11-20-codex-followup-r4-calibration-artifacts/semantic-recovery-diagnosis.md)确认：普通查询期间，正常目录Manifest上传正在写入／镜像；既有恢复读屏障把活跃WAL判为未决并拒绝查询。上传随后成功，无恢复故障注入；拒绝早于实际reload owner acquire，不能套用重载503合同。

当前D3要求真实写入未完成时失败关闭，不能删除连接提示、关闭屏障或按“维护期”宽泛豁免。写后过晚推进files_saved另有可修空间，但本次拒绝早于mirror结束，不能宣称仅前移状态即可修复该次反例。若增加“只等待本实例真实活跃写入所有者，结束后重新核对权威；孤儿／损坏／失败日志仍关闭”的行为，须先按后续Plan的CA-03式差集流程明确合同与开发授权，未实施即不得叙事为已修。

## 工具问题与历史保留

本轮修正了Python3.9的Docker纳秒时间解析，实际取得8条owner及7次恢复。生产者随后读取WAL封闭备份时报 `unable to open database file`，故其summary未能写出审计证明；独立复核已从同一完整备份证明上述7次恢复闭包。工具后续只读封闭快照修正另设离线真WAL反例，不回写本轮summary或FAIL。

正式1800秒／150秒周期／12轮尚未执行；完整F69／F61／F62／F63／R-CAV及上线结论未签。既有局部PASS不覆盖此处真实业务失败，功能Spec现值不因本次短校准自动改变。
