# runs

跑次命名：`YYYY-MM-DD-<agent>-<short>.md`。

- 改前基线：[2026-11-20-cursor-docker-baseline.md](2026-11-20-cursor-docker-baseline.md)＝FAIL，原始记录不改写。对应 v0.1：01 为默认保留路径缺陷；02–05 API PASS；06–07 NOT RUN。
- v0.2 用例（已定稿／终稿确权）：R0／01–12 及全部子例；01 为 API 显式保留结果，默认 UI 门禁由 07 证明；08–12 为新增用例。不得把旧跑次套入新定义后声称通过。
- 改后 verify：[2026-11-20-cursor-docker-verify.md](2026-11-20-cursor-docker-verify.md)＝PASS WITH GAP（子例未穷尽）。
- GAP 补跑：[2026-11-20-cursor-docker-gap-fill.md](2026-11-20-cursor-docker-gap-fill.md)＝历史 **PASS 主张**（本轮复核发现证据缺口，现值由新跑次替代）。

- 本轮四项整改收口复核：[2026-11-20-codex-closure-recheck.md](2026-11-20-codex-closure-recheck.md)＝**PASS（INDEX 现值）**；真实前台浏览器、遗漏子例、严格 MCP 与最终清理零残留。中间失败原始记录保留，不改写历史基线。
