# 候选3短校准：拒绝证据采集不完整，保持 FAIL

| 项目 | 内容 |
|---|---|
| 日期／执行 | 2026-11-20／Codex，多 agent CA-01／08 前置校准 |
| 判定 | **FAIL**；工具计数／终结／清理资格 PASS，产品组合结果不通过；不是正式30分钟验证 |
| 候选 | sha256:3d91732888f47e7394254bcb07626830d2a179f528f075b0131f0d0e535498e5；[完整身份](2026-11-20-codex-followup-r3-calibration-artifacts/candidate-manifest.json) |
| 工具 | runner SHA256 4961eb787a0d189c9ddc1268aff5fb3da94a6b4bcb0a5dfc7b1908689e401530；Apple Python3.9；[冻结快照](2026-11-20-codex-followup-r3-calibration-artifacts/runner-snapshot.py) |
| 负载窗口 | 120秒／60秒周期，2次完整变更；1883表、12个合法身份、20万初始历史审计；无持续CPU profiler |
| 证据 | [终态](2026-11-20-codex-followup-r3-calibration-artifacts/summary.json) · [完整事件](2026-11-20-codex-followup-r3-calibration-artifacts/events.jsonl.gz) · [原始所有者日志](2026-11-20-codex-followup-r3-calibration-artifacts/contract-owner-log.txt) · [附件hash](2026-11-20-codex-followup-r3-calibration-artifacts/files.sha256) |

三个探针各120次，全部HTTP200；livez p99 339.63ms／max341.98ms，readyz p99 331.89ms。普通HTTP120／120成功，max1122.89ms。MCP24次＝17次成功（16次自然窗内、1次尾部完成）＋7次明确503 `EXECUTION_RUNTIME_RELOADING`，7次拒绝全部保留失败分母。预算核对、FIFO真实执行进程终结与自动恢复、203034条审计关联闭合通过；本任务容器／网络／卷与私有夹具清理全部完成。

7次拒绝未取得完整的所有者及同身份／同session／同问题显式恢复证明，故不得映射为合同内预期拒绝。原始日志实际有8条acquire／release记录，但Docker RFC3339Nano前缀含9位小数，工具依赖的Python3.9 `datetime.fromisoformat`拒绝该格式，导致采集器丢弃所有owner记录，恢复候选数为0。此结论解释证据缺失，不证明未执行的恢复已经通过。原FAIL与工具快照保持原样；修正后必须全新跑次，不追补改判本次。

完整SQLite备份仅含本任务合成数据，保存在本机临时证据目录 `inbox/core-availability-followup/20261120-execution/01-tools/calibration-r3-contract/audit-evidence.sqlite.gz`；压缩SHA256为33691b3332de9a3f4ec1af36c42c78398ffab2b0cd14575aa3601b2070b0d23b，原SQLite SHA256为45b7c7588a2f21cdd396fe87c570a89a34c7b1b54e7364813a927ad1777d9603。其独立全量SQL复核另行登记，不能仅凭本工具summary签验。

正式1800秒／150秒周期／12轮同候选组合、完整F69／F61／F62／F63与R-CAV仍未通过；本跑次不改变任何功能Spec现值，不签WebUI或客户交付结论。
