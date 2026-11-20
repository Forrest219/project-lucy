# Core Availability 跑次

- [2026-11-20 Codex — FDE 1883 表持续运行补验与收敛](2026-11-20-codex-fde-1883-soak.md)：局部FAIL；用户59分45秒收敛，12次提交重载／8次完整恢复；预算503与采样因素分列，2h／后置I/O及最终审计闭包仍GAP。

- [2026-11-20 Codex — 诊断真实停止与MCP排空修复](2026-11-20-codex-readyz-diagnostic-repair.md)：目标缺口局部PASS WITH GAP；完整F61／F63未完成，R-CAV NOT RUN。

- [2026-11-20 Codex — readyz真实I/O阻塞与恢复](2026-11-20-codex-readyz-diagnostic-repro.md)：F61局部FAIL、F62局部PASS WITH GAP、F63局部FAIL；完整矩阵未完成，R-CAV NOT RUN。

按 `YYYY-MM-DD-<executor>-<selector>.md` 留存真实结果，记录选择器、候选/fixture身份、实际结果与原始证据；局部通过不代表整套PASS。
