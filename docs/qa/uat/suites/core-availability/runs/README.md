# Core Availability 跑次

- [2026-11-22 KSCC — STD 正式 30 分钟](2026-11-22-kscc-cav-formal.md)：FAIL／证据 VALID。STD-02 的直连 livez 最大值超线，其他 STD 用例通过。

- [2026-11-22 Codex — 标准复测交接校准](2026-11-22-codex-cav-retest-standard.md)：CALIBRATION PASS／证据 VALID，移动证据后离线重算一致；正式档位独立登记。

- [2026-11-20 Codex — 0.30合入候选修复复测](2026-11-20-codex-availability-merge-recheck.md)：局部PASS WITH GAP；120秒I/O、两轮自动恢复、三轮真实查询TERM／原卷恢复；原1883表FAIL保留，后续开发延期。

- [2026-11-20 Codex — FDE 1883 表持续运行补验与收敛](2026-11-20-codex-fde-1883-soak.md)：局部FAIL；用户59分45秒收敛，12次提交重载／8次完整恢复；预算503与采样因素分列，2h／后置I/O及最终审计闭包仍GAP。

- [2026-11-20 Codex — 诊断真实停止与MCP排空修复](2026-11-20-codex-readyz-diagnostic-repair.md)：目标缺口局部PASS WITH GAP；完整F61／F63未完成，R-CAV NOT RUN。

- [2026-11-20 Codex — readyz真实I/O阻塞与恢复](2026-11-20-codex-readyz-diagnostic-repro.md)：F61局部FAIL、F62局部PASS WITH GAP、F63局部FAIL；完整矩阵未完成，R-CAV NOT RUN。

- [2026-11-20 Codex — r3短校准](2026-11-20-codex-followup-r3-calibration.md)：FAIL，所有者及恢复取证不足。
- [2026-11-20 Codex — r4短校准](2026-11-20-codex-followup-r4-calibration.md)：FAIL，发现正常语义写入期合法查询被拒绝，后立P1-70。
- [2026-11-20 Codex — r5短校准](2026-11-20-codex-followup-r5-calibration.md)：FAIL，代码终审发现P2后中止后置取证，保留原记录。
- [2026-11-20 Codex — r6短校准](2026-11-20-codex-followup-r6-calibration.md)：CALIBRATION PASS／独立VALID，非正式30分钟。
- [2026-11-20 Codex — r6正式30分钟](2026-11-20-codex-followup-r6-1800.md)：独立严格FAIL／证据VALID，业务与性能及完整审计通过，诊断进度采集1超时＋2漏采保留。

- [2026-11-20 Codex — r6同镜像定向](2026-11-20-codex-followup-r6-directed.md)：重载10／25与直接CLI局部通过；P170五项实测及独立SQL有效、局部功能收口；原夹具FAIL、范围外GAP及正式组合严格FAIL保留。

按 `YYYY-MM-DD-<executor>-<selector>.md` 留存真实结果，记录选择器、候选/fixture身份、实际结果与原始证据；局部通过不代表整套PASS。
